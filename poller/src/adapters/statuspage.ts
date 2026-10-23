import { endpointHttp } from '../lib/endpointHttp';

/**
 * Adapter for Statuspage.io format
 * Used by: Zoom, Canvas (Instructure), Qualtrics
 */

interface StatusPageResponse {
  status: {
    indicator: string;
    description: string;
  };
}

export async function fetchStatus(endpoint: string): Promise<StatusPageResponse> {
  try {
    const response = await endpointHttp.get(endpoint, {
      timeout: 10000,
      headers: {
        'User-Agent': 'HE-Status-Poller/1.0'
      }
    });
    return response.data;
  } catch (error: any) {
    throw new Error(`Failed to fetch status: ${error.message}`, { cause: error });
  }
}

export function normalizeStatus(data: StatusPageResponse): { status: string; message: string } {
  const indicator = data.status?.indicator || 'unknown';

  const statusMap: { [key: string]: string } = {
    'none': 'operational',
    'minor': 'degraded',
    'major': 'outage',
    'critical': 'outage',
    'maintenance': 'maintenance'
  };

  return {
    status: statusMap[indicator] || 'unknown',
    message: data.status?.description || 'Status unknown'
  };
}
