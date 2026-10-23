import axios from 'axios';
import { endpointHttp, MAX_VENDOR_FEED_BYTES, fetchDeadline } from '../lib/endpointHttp';

/**
 * Adapter for AWS Service Health Dashboard
 * Fetches the public AWS health status JSON from the global status page.
 * Falls back to HTTP probe of the endpoint if JSON parsing fails.
 */

const AWS_STATUS_URL = 'https://health.aws.amazon.com/health/status';

export async function fetchStatus(endpoint: string): Promise<any> {
  try {
    // Fetch the AWS global health status page data
    const response = await axios.get(AWS_STATUS_URL, {
      timeout: 10000,
      maxContentLength: MAX_VENDOR_FEED_BYTES,
      signal: fetchDeadline(),
      headers: {
        'User-Agent': 'HE-Status-Poller/1.0',
        'Accept': 'application/json',
      },
    });

    return {
      source: 'aws_health',
      data: response.data,
      status_code: response.status,
    };
  } catch (error: any) {
    // Fallback: if a specific endpoint was given, probe it directly
    if (endpoint && endpoint.startsWith('http')) {
      try {
        const probe = await endpointHttp.get(endpoint, {
          timeout: 10000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'HE-Status-Poller/1.0' },
        });
        return {
          source: 'http_probe',
          status_code: probe.status,
          ok: probe.status >= 200 && probe.status < 400,
        };
      } catch (probeErr: any) {
        return {
          source: 'http_probe',
          status_code: 0,
          ok: false,
          error: probeErr.message,
        };
      }
    }

    throw new Error(`Failed to fetch AWS status: ${error.message}`, { cause: error });
  }
}

export function normalizeStatus(data: any): { status: string; message: string } {
  // HTTP probe fallback
  if (data.source === 'http_probe') {
    if (data.ok) {
      return { status: 'operational', message: 'AWS service responding normally' };
    }
    if (data.status_code >= 500) {
      return { status: 'outage', message: `AWS service returned HTTP ${data.status_code}` };
    }
    if (data.status_code >= 400) {
      return { status: 'degraded', message: `AWS service returned HTTP ${data.status_code}` };
    }
    return { status: 'outage', message: 'AWS service unreachable' };
  }

  // AWS health data — check for current events
  const healthData = data.data;

  if (!healthData || typeof healthData !== 'object') {
    // Got a response but couldn't parse — assume operational if status code was OK
    if (data.status_code >= 200 && data.status_code < 400) {
      return { status: 'operational', message: 'AWS health dashboard accessible' };
    }
    return { status: 'unknown', message: 'Unable to parse AWS health status' };
  }

  // Check archive/current_events structure
  const events = healthData.archive || healthData.current || [];
  const activeEvents = Array.isArray(events)
    ? events.filter((e: any) => e.status !== 'resolved' && e.status !== 0)
    : [];

  if (activeEvents.length === 0) {
    return { status: 'operational', message: 'All AWS services operational' };
  }

  // Check severity
  const hasCritical = activeEvents.some((e: any) =>
    e.status === 2 || (e.summary || '').toLowerCase().includes('disruption')
  );

  if (hasCritical) {
    return { status: 'outage', message: `${activeEvents.length} active AWS event(s)` };
  }

  return { status: 'degraded', message: `${activeEvents.length} active AWS event(s)` };
}
