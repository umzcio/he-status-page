import axios from 'axios';
import { MAX_VENDOR_FEED_BYTES, fetchDeadline } from '../lib/endpointHttp';
import { libreNmsSegment, parseLibreNmsEndpoint } from '@he-status/shared';
import { UpstreamError } from '../lib/fetchErrors';

/**
 * Adapter for LibreNMS API
 * Monitors devices, services, and device groups via LibreNMS.
 *
 * Endpoint format (stored in services.status_api_endpoint):
 *   device:<hostname_or_id>         — single device up/down + maintenance
 *   service:<hostname>              — all service checks on a device (worst wins)
 *   service:<hostname>:<type>       — specific service type on a device (e.g. http, ssh)
 *   group:<group_name>              — all devices in a group (worst wins)
 *
 * Requires env vars: LIBRENMS_URL, LIBRENMS_API_TOKEN
 */

const LIBRENMS_URL = () => (process.env.LIBRENMS_URL || '').replace(/\/+$/, '');
const LIBRENMS_TOKEN = () => process.env.LIBRENMS_API_TOKEN || '';

interface LibreNMSDevice {
  device_id: number;
  hostname: string;
  sysName: string;
  status: number | boolean;  // 1/true = up, 0/false = down
  status_reason: string;
  disabled: number | boolean;
  ignore: number | boolean;
  uptime: number;
  last_polled: string;
  hardware: string;
  os: string;
  location: string;
}

// LibreNMS API returns booleans or numbers depending on endpoint/version
function isTruthy(val: number | boolean): boolean {
  return val === true || val === 1;
}

function isFalsy(val: number | boolean): boolean {
  return val === false || val === 0;
}

interface LibreNMSService {
  service_id: number;
  device_id: number;
  service_ip: string;
  service_type: string;
  service_status: number; // 0 = OK, 1 = Warning, 2 = Critical, 3 = Unknown
  service_message: string;
  service_disabled: number;
}

interface LibreNMSAlert {
  id: number;
  device_id: number;
  hostname: string;
  severity: string;      // 'ok', 'warning', 'critical'
  name: string;
  state: number;
  timestamp: string;
}

interface FetchResult {
  mode: 'device' | 'service' | 'group';
  device?: LibreNMSDevice;
  maintenance?: boolean;
  alerts?: LibreNMSAlert[];
  services?: LibreNMSService[];
  devices?: LibreNMSDevice[];
}

// Sensitive fields to strip before logging raw_response
const SENSITIVE_KEYS = ['community', 'authname', 'authpass', 'authalgo', 'cryptopass', 'cryptoalgo', 'service_param'];

function sanitize(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === 'object') {
    const clean: any = {};
    for (const [k, v] of Object.entries(obj)) {
      clean[k] = SENSITIVE_KEYS.includes(k) ? '[REDACTED]' : sanitize(v);
    }
    return clean;
  }
  return obj;
}

async function apiGet<T>(path: string): Promise<T> {
  const baseUrl = LIBRENMS_URL();
  const token = LIBRENMS_TOKEN();

  if (!baseUrl || !token) {
    throw new Error('LibreNMS credentials not configured (LIBRENMS_URL / LIBRENMS_API_TOKEN)');
  }

  try {
    const response = await axios.get(`${baseUrl}${path}`, {
      timeout: 15000,
      maxContentLength: MAX_VENDOR_FEED_BYTES,
      signal: fetchDeadline(),
      headers: {
        'X-Auth-Token': token,
        'User-Agent': 'HE-Status-Poller/1.0',
      },
    });
    return response.data;
  } catch (err: any) {
    // Never let the AxiosError escape: its config carries the X-Auth-Token
    // header, and its message can name the LibreNMS host.
    const status = err?.response?.status;
    throw new UpstreamError(
      status ? `LibreNMS API returned HTTP ${status}` : `LibreNMS API request failed (${err?.code || 'network error'})`,
      { status, code: err?.code }
    );
  }
}

async function fetchDevice(hostname: string): Promise<FetchResult> {
  const deviceData = await apiGet<{ devices: LibreNMSDevice[] }>(`/api/v0/devices/${libreNmsSegment(hostname)}`);
  const device = deviceData.devices?.[0];

  if (!device) {
    throw new Error('Device not found in LibreNMS');
  }

  // Check maintenance status
  let maintenance = false;
  try {
    const maint = await apiGet<{ is_under_maintenance: boolean }>(`/api/v0/devices/${libreNmsSegment(hostname)}/maintenance`);
    maintenance = maint.is_under_maintenance === true;
  } catch {
    // Maintenance endpoint may not be available — not critical
  }

  // Check active alerts for this device
  let alerts: LibreNMSAlert[] = [];
  try {
    const alertData = await apiGet<{ alerts: LibreNMSAlert[] }>(`/api/v0/alerts?state=1`);
    alerts = (alertData.alerts || []).filter(a => a.device_id === device.device_id);
  } catch {
    // Alerts are supplementary info
  }

  return sanitize({ mode: 'device', device, maintenance, alerts });
}

async function fetchServices(hostname: string, serviceType?: string): Promise<FetchResult> {
  let path = `/api/v0/services/${libreNmsSegment(hostname)}`;
  if (serviceType) {
    path += `?type=${encodeURIComponent(serviceType)}`;
  }

  const data = await apiGet<{ services: LibreNMSService[][] | LibreNMSService[] }>(path);

  // LibreNMS returns services as nested array or flat array depending on version
  let services: LibreNMSService[] = [];
  const raw = data.services;
  if (Array.isArray(raw) && raw.length > 0) {
    if (Array.isArray(raw[0])) {
      services = (raw as LibreNMSService[][]).flat();
    } else {
      services = raw as LibreNMSService[];
    }
  }

  // Filter out disabled services
  services = services.filter(s => s.service_disabled === 0);

  if (serviceType) {
    services = services.filter(s => s.service_type === serviceType);
  }

  return sanitize({ mode: 'service', services });
}

async function fetchGroup(groupName: string): Promise<FetchResult> {
  // One request, whatever the group's size: `full=1` returns every member's
  // device record. (Fetching members one by one let the size of the LibreNMS
  // reply decide how many requests a check made.) The reply is bounded by
  // MAX_VENDOR_FEED_BYTES, and only the fields the status needs are kept.
  const groupData = await apiGet<{ devices: Partial<LibreNMSDevice>[] }>(
    `/api/v0/devicegroups/${libreNmsSegment(groupName)}?full=1`
  );

  const members = Array.isArray(groupData.devices) ? groupData.devices : [];
  if (members.length > 0 && members.every((d) => d.status === undefined)) {
    throw new Error('LibreNMS did not return device details for the group (devicegroups ?full=1 unsupported)');
  }

  const devices = members
    .filter((d) => isFalsy(d.disabled ?? 0) && isFalsy(d.ignore ?? 0))
    .map((d) => ({ device_id: d.device_id, status: d.status, disabled: d.disabled, ignore: d.ignore }));

  return { mode: 'group', devices: devices as LibreNMSDevice[] };
}

export async function fetchStatus(endpoint: string): Promise<FetchResult> {
  const { mode, target, subtype } = parseLibreNmsEndpoint(endpoint);

  switch (mode) {
    case 'device':
      return fetchDevice(target);
    case 'service':
      return fetchServices(target, subtype);
    case 'group':
      return fetchGroup(target);
    default:
      throw new Error(`Unknown LibreNMS monitor mode: "${mode}". Use device, service, or group.`);
  }
}

export function normalizeStatus(data: FetchResult): { status: string; message: string } {
  switch (data.mode) {
    case 'device':
      return normalizeDevice(data);
    case 'service':
      return normalizeServices(data);
    case 'group':
      return normalizeGroup(data);
    default:
      return { status: 'unknown', message: 'Unknown monitor mode' };
  }
}

function normalizeDevice(data: FetchResult): { status: string; message: string } {
  const device = data.device!;

  // Public-safe messages — never expose hostnames, sysNames, or alert rule names

  if (data.maintenance) {
    return { status: 'maintenance', message: 'System is under scheduled maintenance' };
  }

  if (isFalsy(device.status)) {
    return { status: 'outage', message: 'System is unreachable' };
  }

  const alerts = data.alerts || [];
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');

  if (criticalAlerts.length > 0) {
    return {
      status: 'outage',
      message: `${criticalAlerts.length} critical issue(s) detected`,
    };
  }

  if (warningAlerts.length > 0) {
    return {
      status: 'degraded',
      message: `${warningAlerts.length} warning(s) detected`,
    };
  }

  return { status: 'operational', message: 'System is operational' };
}

function normalizeServices(data: FetchResult): { status: string; message: string } {
  const services = data.services || [];

  if (services.length === 0) {
    return { status: 'unknown', message: 'No service checks found' };
  }

  // Find worst status (2=critical > 1=warning > 3=unknown > 0=ok)
  let worstStatus = 0;
  let worstService: LibreNMSService | null = null;

  for (const svc of services) {
    if (svc.service_status === 2) {
      worstStatus = 2;
      worstService = svc;
      break; // Can't get worse
    }
    if (svc.service_status === 1 && worstStatus < 1) {
      worstStatus = 1;
      worstService = svc;
    }
    if (svc.service_status === 3 && worstStatus < 1) {
      worstStatus = 3;
      worstService = svc;
    }
  }

  const statusMap: { [key: number]: string } = {
    0: 'operational',
    1: 'degraded',
    2: 'outage',
    3: 'unknown',
  };

  // Public-safe messages — never expose service_message (contains software versions, credentials)
  const messageMap: { [key: number]: string } = {
    0: `All ${services.length} service check(s) passing`,
    1: `${services.filter(s => s.service_status === 1).length} of ${services.length} check(s) reporting warnings`,
    2: `${services.filter(s => s.service_status === 2).length} of ${services.length} check(s) failing`,
    3: `${services.filter(s => s.service_status === 3).length} of ${services.length} check(s) in unknown state`,
  };

  return {
    status: statusMap[worstStatus] || 'unknown',
    message: messageMap[worstStatus] || 'Status unknown',
  };
}

function normalizeGroup(data: FetchResult): { status: string; message: string } {
  const devices = data.devices || [];

  if (devices.length === 0) {
    return { status: 'unknown', message: 'No devices found in group' };
  }

  const downDevices = devices.filter(d => isFalsy(d.status));
  const totalDevices = devices.length;

  // Public-safe messages — never expose hostnames or sysNames
  if (downDevices.length === totalDevices) {
    return {
      status: 'outage',
      message: `All ${totalDevices} system(s) are unreachable`,
    };
  }

  if (downDevices.length > 0) {
    return {
      status: 'degraded',
      message: `${downDevices.length} of ${totalDevices} system(s) experiencing issues`,
    };
  }

  return {
    status: 'operational',
    message: `All ${totalDevices} system(s) operational`,
  };
}
