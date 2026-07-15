import { Router } from 'express';
import * as oidc from '../lib/oidc';
import { issueAuthCode } from '../lib/authCode';
import pool from '../db/connection';

// OIDC SSO routes, mounted under /api/admin/oidc.
//
// The flow mirrors CAS exactly on the security-sensitive parts:
//  - authenticate via the IdP, then look the user up by lowercased email;
//  - unknown users get the SAME "not authorized" error redirect CAS uses
//    (SSO never auto-creates users);
//  - on success we issue a one-time code and redirect with ONLY ?code=...
//    (never a JWT/token/user in the URL).
const router = Router();

function adminPath(): string {
  const frontendUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
  return `${frontendUrl}/admin/`;
}

// GET /api/admin/oidc/login - Begin the OIDC authorization-code flow.
router.get('/login', async (req, res) => {
  if (!oidc.isOidcConfigured()) {
    return res.status(503).json({ error: 'OIDC SSO is not configured' });
  }

  try {
    const { url, state, nonce, codeVerifier } = await oidc.getAuthUrl();
    await oidc.saveOidcFlow({ state, nonce, codeVerifier });
    res.redirect(url);
  } catch (err) {
    console.error('OIDC login error:', err);
    res.redirect(`${adminPath()}?error=${encodeURIComponent('SSO service error')}`);
  }
});

// GET /api/admin/oidc/callback - IdP redirects back here with code + state.
router.get('/callback', async (req, res) => {
  const admin = adminPath();

  try {
    const state = req.query.state as string | undefined;
    if (!state) {
      return res.redirect(`${admin}?error=${encodeURIComponent('Invalid SSO response')}`);
    }

    // Consume the flow state atomically. Missing/expired => reject.
    const flow = await oidc.consumeOidcFlow(state);
    if (!flow) {
      return res.redirect(`${admin}?error=${encodeURIComponent('SSO session expired, please try again')}`);
    }

    // client.callback validates signature/iss/aud/exp/nonce/state/PKCE and
    // throws on any failure.
    const { email } = await oidc.handleCallback(req.query as Record<string, string>, flow);

    // Authorization model (unchanged): the user must already exist by email.
    const userResult = await pool.query(
      'SELECT id, email, name, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      console.log(`OIDC user ${email} not authorized in HE Status`);
      return res.redirect(
        `${admin}?error=${encodeURIComponent('User not authorized. Contact your administrator for access.')}`
      );
    }

    const user = userResult.rows[0];
    console.log(`OIDC auth: ${user.email} authenticated`);

    // Issue a one-time code; ONLY the code goes in the URL (never a JWT/user).
    const code = await issueAuthCode(user.id);
    res.redirect(`${admin}?code=${encodeURIComponent(code)}`);
  } catch (err) {
    console.error('OIDC callback error:', err);
    res.redirect(`${admin}?error=${encodeURIComponent('Authentication failed')}`);
  }
});

export default router;
