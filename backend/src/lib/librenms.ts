import axios from 'axios';
import { libreNmsSegment } from '@he-status/shared';

const LIBRENMS_URL = () => (process.env.LIBRENMS_URL || '').replace(/\/+$/, '');
const LIBRENMS_TOKEN = () => process.env.LIBRENMS_API_TOKEN || '';

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
      headers: {
        'X-Auth-Token': token,
        'User-Agent': 'HE-Status-Backend/1.0',
      },
    });
    return response.data;
  } catch (err: any) {
    // Never let the AxiosError escape: its config carries the X-Auth-Token header.
    const status = err?.response?.status;
    throw new Error(
      status ? `LibreNMS API returned HTTP ${status}` : `LibreNMS API request failed (${err?.code || 'network error'})`
    );
  }
}

export async function listDevices(): Promise<any[]> {
  const data = await apiGet<{ devices: any[] }>('/api/v0/devices');
  return sanitize(data.devices || []).map((d: any) => ({
    device_id: d.device_id,
    hostname: d.hostname,
    sysName: d.sysName,
    status: d.status,
    os: d.os,
    hardware: d.hardware,
    location: d.location,
  }));
}

export async function listGroups(): Promise<any[]> {
  const data = await apiGet<{ groups: any[] }>('/api/v0/devicegroups');
  return (data.groups || []).map((g: any) => ({
    id: g.id,
    name: g.name,
    description: g.desc,
  }));
}

export async function listServicesForDevice(hostname: string): Promise<any[]> {
  const data = await apiGet<{ services: any }>(`/api/v0/services/${libreNmsSegment(hostname)}`);
  let services = data.services || [];
  if (Array.isArray(services) && services.length > 0 && Array.isArray(services[0])) {
    services = services.flat();
  }
  return sanitize(services).map((s: any) => ({
    service_id: s.service_id,
    service_type: s.service_type,
    service_status: s.service_status,
    service_disabled: s.service_disabled,
  }));
}
