import { Router } from 'express';
import * as saml from '../lib/saml';
import { issueAuthCode } from '../lib/authCode';
import pool from '../db/connection';

// SAML 2.0 SSO routes, mounted under /api/admin/saml.
//
// The flow mirrors CAS/OIDC exactly on the security-sensitive parts:
//  - authenticate via the IdP (validate a signed assertion), then look the user
//    up by lowercased email;
//  - unknown users get the SAME "not authorized" error redirect (SSO never
//    auto-creates users);
//  - on success we issue a one-time code and redirect with ONLY ?code=...
//    (never a JWT/token/user in the URL).
//
// The POST /callback is an UNAUTHENTICATED cross-site POST from the IdP. It is
// intentionally NOT behind authMiddleware, so the double-submit CSRF middleware
// (which only guards cookie-authenticated mutating requests) does not apply —
// which is correct: the SAML XML signature on the assertion is the protection,
// not a CSRF token. The IdP posts SAMLResponse as application/x-www-form-
// urlencoded; the global express.urlencoded() parser in index.ts populates
// req.body for it, so no body parser is registered here.
const router = Router();

function adminPath(): string {
  const frontendUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
  return `${frontendUrl}/admin/`;
}

// GET /api/admin/saml/login - Begin the SAML authentication flow.
router.get('/login', async (req, res) => {
  if (!saml.isSamlConfigured()) {
    return res.status(503).json({ error: 'SAML SSO is not configured' });
  }

  try {
    // node-saml persists the AuthnRequest ID to the saml_flows cache inside
    // getAuthorizeUrl so InResponseTo can be validated on callback.
    const { url } = await saml.getAuthorizeUrl();
    res.redirect(url);
  } catch (err) {
    console.error('SAML login error:', err);
    res.redirect(`${adminPath()}?error=${encodeURIComponent('SSO service error')}`);
  }
});

// POST /api/admin/saml/callback - IdP posts the signed SAMLResponse here.
router.post('/callback', async (req, res) => {
  const admin = adminPath();

  try {
    // handleCallback validates the XML signature, assertion conditions
    // (NotBefore/NotOnOrAfter), audience, and InResponseTo; it throws on any
    // failure. Email is only read from the validated assertion.
    const { email } = await saml.handleCallback(req.body as Record<string, string>);

    // Authorization model (unchanged): the user must already exist by email.
    const userResult = await pool.query(
      'SELECT id, email, name, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      console.log(`SAML user ${email} not authorized in HE Status`);
      return res.redirect(
        `${admin}?error=${encodeURIComponent('User not authorized. Contact your administrator for access.')}`
      );
    }

    const user = userResult.rows[0];
    console.log(`SAML auth: ${user.email} authenticated`);

    // Issue a one-time code; ONLY the code goes in the URL (never a JWT/user).
    const code = await issueAuthCode(user.id);
    res.redirect(`${admin}?code=${encodeURIComponent(code)}`);
  } catch (err) {
    console.error('SAML callback error:', err);
    res.redirect(`${admin}?error=${encodeURIComponent('Authentication failed')}`);
  }
});

// GET /api/admin/saml/metadata - SP metadata XML to ease IdP configuration.
// No auth: metadata is public, non-sensitive descriptor data.
router.get('/metadata', (req, res) => {
  if (!saml.isSamlConfigured()) {
    return res.status(503).json({ error: 'SAML SSO is not configured' });
  }

  try {
    const metadata = saml.getServiceProviderMetadata();
    res.type('application/xml').send(metadata);
  } catch (err) {
    console.error('SAML metadata error:', err);
    res.status(500).json({ error: 'Could not generate SAML metadata' });
  }
});

export default router;
