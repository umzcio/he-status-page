import axios from 'axios';

/**
 * Adapter for Ellucian Banner Managed Cloud services
 *
 * Supports two monitoring modes:
 * - Actuator mode: endpoints containing /actuator/health return {"status":"UP"|"DOWN"|...}
 * - HTTP mode: any other URL — checks for HTTP 2xx/3xx response
 *
 * Endpoint format: full URL to health check
 *   e.g. https://appnav.example.edu/applicationNavigator/actuator/health
 *   e.g. https://degreeworks.example.edu/responsiveDashboard/
 */

interface EllucianResponse {
  mode: 'actuator' | 'http';
  actuatorStatus?: string;   // UP, DOWN, OUT_OF_SERVICE, UNKNOWN
  httpStatus?: number;
}

export async function fetchStatus(endpoint: string): Promise<EllucianResponse> {
  const isActuator = endpoint.includes('/actuator/health');

  try {
    const response = await axios.get(endpoint, {
      timeout: 15000,
      maxRedirects: 3,
      validateStatus: () => true, // Don't throw on any HTTP status
      headers: {
        'User-Agent': 'HE-Status-Poller/1.0'
      }
    });

    if (isActuator) {
      return {
        mode: 'actuator',
        actuatorStatus: response.data?.status || 'UNKNOWN',
        httpStatus: response.status
      };
    }

    return {
      mode: 'http',
      httpStatus: response.status
    };
  } catch (error: any) {
    // Network-level errors (DNS, connection refused, timeout) — throw so the
    // caller's retry/circuit-breaker (resilientFetch) can retry before giving up,
    // instead of silently treating the failure as a successful fetch.
    throw new Error(`Failed to fetch Ellucian status from ${endpoint}: ${error.code || error.message || 'Unknown error'}`);
  }
}

export function normalizeStatus(data: EllucianResponse): { status: string; message: string } {
  // Actuator mode — parse Spring Boot health response
  if (data.mode === 'actuator') {
    const s = (data.actuatorStatus || '').toUpperCase();

    if (s === 'UP') {
      return { status: 'operational', message: 'Service is healthy' };
    }
    if (s === 'DOWN') {
      return { status: 'outage', message: 'Service reports DOWN' };
    }
    if (s === 'OUT_OF_SERVICE') {
      return { status: 'maintenance', message: 'Service is out of service (maintenance)' };
    }
    return { status: 'unknown', message: `Actuator status: ${data.actuatorStatus}` };
  }

  // HTTP mode — check status code
  const code = data.httpStatus || 0;

  if (code >= 200 && code < 400) {
    return { status: 'operational', message: `HTTP ${code} — Service is reachable` };
  }
  if (code >= 400 && code < 500) {
    return { status: 'degraded', message: `HTTP ${code} — Service returned client error` };
  }
  if (code >= 500) {
    return { status: 'outage', message: `HTTP ${code} — Service returned server error` };
  }

  return { status: 'unknown', message: `Unexpected HTTP status: ${code}` };
}
