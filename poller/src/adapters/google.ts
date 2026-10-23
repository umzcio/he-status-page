import axios from 'axios';
import { endpointHttp } from '../lib/endpointHttp';

/**
 * Adapter for Google Workspace Status Dashboard
 * Fetches the public JSON feed from the Google Workspace Status Dashboard.
 * Falls back to direct HTTP probe of the endpoint if JSON parsing fails.
 */

const GOOGLE_STATUS_URL = 'https://www.google.com/appsstatus/dashboard/incidents.json';

export async function fetchStatus(endpoint: string): Promise<any> {
  try {
    // Try fetching the Google Workspace status JSON feed
    const response = await axios.get(GOOGLE_STATUS_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'HE-Status-Poller/1.0' },
    });

    // The feed returns an array of recent incidents
    // Filter to only active/recent incidents (last 24 hours)
    const incidents = Array.isArray(response.data) ? response.data : [];
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const activeIncidents = incidents.filter((inc: any) => {
      // Check if incident has no end time or ended recently
      const modified = inc.modified ? new Date(inc.modified).getTime() : Date.now();
      const isRecent = modified > oneDayAgo;
      const isOngoing = !inc.end;
      return isRecent || isOngoing;
    });

    return {
      source: 'google_status_feed',
      total_incidents: incidents.length,
      active_incidents: activeIncidents.length,
      incidents: activeIncidents.slice(0, 10), // Cap at 10 for logging
    };
  } catch (error: any) {
    // Fallback: probe the endpoint directly if provided
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

    throw new Error(`Failed to fetch Google status: ${error.message}`);
  }
}

export function normalizeStatus(data: any): { status: string; message: string } {
  // HTTP probe fallback
  if (data.source === 'http_probe') {
    if (data.ok) {
      return { status: 'operational', message: 'Service responding normally' };
    }
    if (data.status_code >= 500) {
      return { status: 'outage', message: `Service returned HTTP ${data.status_code}` };
    }
    if (data.status_code >= 400) {
      return { status: 'degraded', message: `Service returned HTTP ${data.status_code}` };
    }
    return { status: 'outage', message: data.error || 'Service unreachable' };
  }

  // Google status feed
  const activeIncidents = data.active_incidents || 0;

  if (activeIncidents === 0) {
    return { status: 'operational', message: 'All Google Workspace services operational' };
  }

  // Check severity of active incidents
  const incidents = data.incidents || [];
  let hasOutage = false;
  let hasDegraded = false;

  for (const inc of incidents) {
    const severity = (inc.severity || '').toUpperCase();
    const isOngoing = !inc.end;

    if (!isOngoing) continue;

    if (severity === 'HIGH' || severity === 'SERVICE_OUTAGE') {
      hasOutage = true;
    } else {
      hasDegraded = true;
    }
  }

  if (hasOutage) {
    return { status: 'outage', message: `${activeIncidents} active incident(s) — service outage detected` };
  }
  if (hasDegraded) {
    return { status: 'degraded', message: `${activeIncidents} active incident(s) — service disruption detected` };
  }

  // Recent but resolved incidents
  return { status: 'operational', message: `${activeIncidents} recent incident(s), all resolved` };
}
