import axios from 'axios';
import pool from '../db/connection';

// CAS is optional. It is considered configured only when CAS_BASE_URL is set.
// Reading env at call time (not import time) keeps the app from crashing when
// CAS is unconfigured.
function getCasBaseUrl(): string | undefined {
  const base = process.env.CAS_BASE_URL;
  return base ? base.replace(/\/$/, '') : undefined;
}

export function isCasConfigured(): boolean {
  return !!getCasBaseUrl();
}

function getServiceUrl(): string {
  return process.env.CAS_SERVICE_URL || 'http://localhost:3000/api/admin/cas/callback';
}

export function getLoginUrl(): string {
  const base = getCasBaseUrl();
  if (!base) throw new Error('CAS not configured: CAS_BASE_URL is required');
  return `${base}/login?service=${encodeURIComponent(getServiceUrl())}`;
}

export function getLogoutUrl(): string {
  const base = getCasBaseUrl();
  return process.env.CAS_LOGOUT_URL || (base ? `${base}/logout` : '');
}

function parseXMLResponse(xmlData: string): { success: boolean; username?: string; attributes?: Record<string, string> } {
  try {
    if (xmlData.includes('<cas:authenticationSuccess>')) {
      const userMatch = xmlData.match(/<cas:user>(.*?)<\/cas:user>/);
      if (!userMatch) return { success: false };

      const attributes: Record<string, string> = {};
      const cnMatch = xmlData.match(/<cas:commonName>(.*?)<\/cas:commonName>/);
      if (cnMatch) attributes.commonName = cnMatch[1];
      const mailMatch = xmlData.match(/<cas:mail>(.*?)<\/cas:mail>/);
      if (mailMatch) attributes.mail = mailMatch[1];

      return { success: true, username: userMatch[1], attributes };
    }

    // Fallback: plaintext response (yes\nusername)
    if (xmlData.startsWith('yes')) {
      const lines = xmlData.split('\n');
      const username = lines[1]?.trim();
      if (username) return { success: true, username, attributes: {} };
    }

    return { success: false };
  } catch {
    return { success: false };
  }
}

// Validate a CAS ticket and authorize the user against the users table.
//
// This function only *authenticates* (via CAS) and *authorizes* (the email must
// already exist in the users table). It intentionally does NOT sign a JWT: after
// a successful CAS validation the callback issues a one-time auth code, and the
// JWT is minted only at the /api/admin/auth/exchange step. This keeps the JWT
// out of the redirect URL. last_login_at is likewise updated at exchange time.
export async function validateTicket(ticket: string): Promise<{
  success: boolean;
  error?: string;
  user?: { id: string; email: string; name: string; role: string };
}> {
  try {
    const base = getCasBaseUrl();
    if (!base) {
      return { success: false, error: 'CAS is not configured' };
    }

    const validateUrl = `${base}/serviceValidate?service=${encodeURIComponent(getServiceUrl())}&ticket=${encodeURIComponent(ticket)}`;
    const response = await axios.get(validateUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'HE-Status-CAS-Client/1.0' },
    });

    if (response.status !== 200) {
      return { success: false, error: 'CAS validation failed' };
    }

    const result = parseXMLResponse(response.data);
    if (!result.success || !result.username) {
      return { success: false, error: 'CAS authentication failed' };
    }

    // Build email from CAS attributes or username
    const email = result.attributes?.mail
      || `${result.username}@${process.env.CAS_EMAIL_DOMAIN || 'example.edu'}`;

    // Look up user in the database by email
    const userResult = await pool.query(
      'SELECT id, email, name, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      console.log(`CAS user ${result.username} (${email}) not authorized in HE Status`);
      return { success: false, error: 'User not authorized. Contact your administrator for access.' };
    }

    const user = userResult.rows[0];

    return {
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  } catch (err: any) {
    console.error('CAS validation error:', err.message);
    return { success: false, error: 'Authentication service temporarily unavailable' };
  }
}
