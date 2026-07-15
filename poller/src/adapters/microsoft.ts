import axios from 'axios';

/**
 * Adapter for Microsoft 365 Graph API
 * Requires OAuth 2.0 authentication
 */

interface MicrosoftTokenResponse {
  access_token: string;
  expires_in: number;
}

interface MicrosoftHealthOverview {
  service: string;
  status: string;
  id: string;
}

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft 365 credentials not configured');
  }

  try {
    const response = await axios.post<MicrosoftTokenResponse>(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Expire 1 min early

    return cachedToken;
  } catch (error: any) {
    throw new Error(`Failed to get Microsoft access token: ${error.message}`);
  }
}

export async function fetchStatus(endpoint: string): Promise<any> {
  try {
    const token = await getAccessToken();

    const response = await axios.get(
      'https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      }
    );

    return response.data;
  } catch (error: any) {
    if (error.message.includes('credentials not configured')) {
      // Return mock data if credentials not set up yet
      return {
        value: [{
          service: 'Microsoft 365',
          status: 'serviceOperational',
          id: 'Office365'
        }]
      };
    }
    throw new Error(`Failed to fetch Microsoft status: ${error.message}`);
  }
}

export function normalizeStatus(data: any): { status: string; message: string } {
  // Microsoft returns an array of service health overviews
  const services = data.value || [];

  if (services.length === 0) {
    return {
      status: 'unknown',
      message: 'No status data available'
    };
  }

  // Get overall status (worst status wins)
  let worstStatus = 'operational';

  for (const service of services) {
    const status = service.status;

    if (status === 'serviceInterruption') {
      worstStatus = 'outage';
      break;
    } else if (status === 'serviceDegradation' && worstStatus === 'operational') {
      worstStatus = 'degraded';
    } else if (status === 'restoringService' && worstStatus === 'operational') {
      worstStatus = 'degraded';
    }
  }

  const statusMap: { [key: string]: string } = {
    'operational': 'All systems operational',
    'degraded': 'Some services experiencing degraded performance',
    'outage': 'Service interruption detected'
  };

  return {
    status: worstStatus,
    message: statusMap[worstStatus] || 'Status unknown'
  };
}
