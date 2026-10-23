import axios from 'axios';
import { endpointHttp, MAX_VENDOR_FEED_BYTES } from '../lib/endpointHttp';

/**
 * Adapter for Apple System Status
 * Fetches Apple's developer system status feed which provides JSON data.
 * Falls back to HTTP probe if the JSON feed is unavailable.
 */

const APPLE_STATUS_URL = 'https://www.apple.com/support/systemstatus/data/system_status_en_US.js';

export async function fetchStatus(endpoint: string): Promise<any> {
  try {
    // Apple's system status page loads data from a JS file that contains JSON
    const response = await axios.get(APPLE_STATUS_URL, {
      timeout: 10000,
      maxContentLength: MAX_VENDOR_FEED_BYTES,
      headers: { 'User-Agent': 'HE-Status-Poller/1.0' },
    });

    // The response is a JSONP-like format: jsonCallback({...})
    // Extract the JSON from within the callback wrapper
    let rawData = response.data;
    if (typeof rawData === 'string') {
      const jsonMatch = rawData.match(/jsonCallback\(([\s\S]+)\)/);
      if (jsonMatch) {
        rawData = JSON.parse(jsonMatch[1]);
      } else {
        // Try parsing as plain JSON
        try {
          rawData = JSON.parse(rawData);
        } catch {
          // Not JSON — treat as HTML/text response
          return {
            source: 'http_probe',
            status_code: response.status,
            ok: response.status >= 200 && response.status < 400,
          };
        }
      }
    }

    return {
      source: 'apple_status',
      data: rawData,
    };
  } catch (error: any) {
    // Fallback: probe the endpoint directly
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

    throw new Error(`Failed to fetch Apple status: ${error.message}`, { cause: error });
  }
}

export function normalizeStatus(data: any): { status: string; message: string } {
  // HTTP probe fallback
  if (data.source === 'http_probe') {
    if (data.ok) {
      return { status: 'operational', message: 'Apple services responding normally' };
    }
    if (data.status_code >= 500) {
      return { status: 'outage', message: `Apple service returned HTTP ${data.status_code}` };
    }
    if (data.status_code >= 400) {
      return { status: 'degraded', message: `Apple service returned HTTP ${data.status_code}` };
    }
    return { status: 'outage', message: 'Apple service unreachable' };
  }

  // Apple status feed
  const statusData = data.data;
  if (!statusData || !statusData.services) {
    return { status: 'operational', message: 'Apple services status available' };
  }

  const services = Array.isArray(statusData.services) ? statusData.services : [];
  let hasOutage = false;
  let hasDegraded = false;
  let issueCount = 0;

  for (const service of services) {
    const events = service.events || [];
    for (const event of events) {
      const status = (event.eventStatus || event.statusType || '').toLowerCase();
      if (status === 'ongoing' || status === 'outage') {
        hasOutage = true;
        issueCount++;
      } else if (status === 'issue' || status === 'performance') {
        hasDegraded = true;
        issueCount++;
      }
    }
  }

  if (hasOutage) {
    return { status: 'outage', message: `${issueCount} Apple service issue(s) detected` };
  }
  if (hasDegraded) {
    return { status: 'degraded', message: `${issueCount} Apple service issue(s) detected` };
  }

  return { status: 'operational', message: 'All Apple services operational' };
}
