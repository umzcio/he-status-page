import { Issuer, generators, Client } from 'openid-client';
import pool from '../db/connection';

// OIDC SSO provider (works with Entra ID, Okta, Google Workspace, Keycloak,
// Shibboleth-OIDC, etc). OIDC is OPTIONAL and is considered configured only when
// OIDC_ISSUER + OIDC_CLIENT_ID + OIDC_CLIENT_SECRET are all set. All env is read
// at call time (not import time) so an unconfigured deploy never crashes.
//
// Like CAS, OIDC only *authenticates*. Authorization is unchanged: the callback
// route requires the account to already exist in the users table, else the same
// "not authorized" path is taken. This module never touches the users table and
// never auto-creates accounts.
//
// The e-mail used to find that account must be one the IdP vouches for: by
// default the `email` claim, accepted only with `email_verified: true`. IdPs
// that don't send email_verified but whose usernames are admin-controlled (e.g.
// Entra ID's UPN) can opt in via OIDC_EMAIL_CLAIM / OIDC_REQUIRE_EMAIL_VERIFIED.

function getIssuerUrl(): string | undefined {
  return process.env.OIDC_ISSUER || undefined;
}

function getClientId(): string | undefined {
  return process.env.OIDC_CLIENT_ID || undefined;
}

function getClientSecret(): string | undefined {
  return process.env.OIDC_CLIENT_SECRET || undefined;
}

export function getRedirectUri(): string {
  if (process.env.OIDC_REDIRECT_URI) return process.env.OIDC_REDIRECT_URI;
  const publicUrl = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${publicUrl}/api/admin/oidc/callback`;
}

function getScopes(): string {
  return process.env.OIDC_SCOPES || 'openid email profile';
}

export interface OidcIdentity {
  email: string;
  name: string;
  issuer: string;
  subject: string;
}

/**
 * Pick the account e-mail out of validated id_token claims. Throws when the
 * claim is missing, or when it is the `email` claim and the IdP has not marked
 * it verified (unless OIDC_REQUIRE_EMAIL_VERIFIED=false). A different claim
 * (OIDC_EMAIL_CLAIM, e.g. preferred_username) is used only when the operator
 * names it explicitly.
 */
export function resolveOidcIdentity(
  claims: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): OidcIdentity {
  const claimName = env.OIDC_EMAIL_CLAIM || 'email';
  const requireVerified = env.OIDC_REQUIRE_EMAIL_VERIFIED !== 'false';

  const issuer = claims.iss;
  const subject = claims.sub;
  if (typeof issuer !== 'string' || !issuer || typeof subject !== 'string' || !subject) {
    throw new Error('OIDC id_token is missing iss or sub');
  }

  const email = claims[claimName];
  if (typeof email !== 'string' || !email.includes('@')) {
    throw new Error(`OIDC id_token did not contain an e-mail in the "${claimName}" claim`);
  }

  if (claimName === 'email' && requireVerified && claims.email_verified !== true) {
    throw new Error('OIDC id_token e-mail is not verified (email_verified is not true)');
  }

  const name = typeof claims.name === 'string' && claims.name ? claims.name : email;
  return { email, name, issuer, subject };
}

export function isOidcConfigured(): boolean {
  return !!(getIssuerUrl() && getClientId() && getClientSecret());
}

// Lazily-discovered client, cached across requests. Reset (undefined) forces a
// rediscovery — e.g. after config changes in tests.
let cachedClient: Client | undefined;

async function getClient(): Promise<Client> {
  if (cachedClient) return cachedClient;

  const issuerUrl = getIssuerUrl();
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!issuerUrl || !clientId || !clientSecret) {
    throw new Error('OIDC is not configured');
  }

  const issuer = await Issuer.discover(issuerUrl);
  cachedClient = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [getRedirectUri()],
    response_types: ['code'],
  });

  return cachedClient;
}

export interface OidcFlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Build the authorization URL to redirect the browser to, along with the
 * transient flow state (state/nonce/codeVerifier) that must be persisted
 * server-side and re-supplied on callback. Uses PKCE S256.
 */
export async function getAuthUrl(): Promise<{ url: string } & OidcFlowState> {
  const client = await getClient();

  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const url = client.authorizationUrl({
    scope: getScopes(),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url, state, nonce, codeVerifier };
}

/**
 * Validate the callback. client.callback verifies the id_token signature,
 * issuer, audience, expiry, and the supplied nonce/state, and (with PKCE)
 * checks the code_verifier. Throws on any validation failure — callers must
 * treat a throw as an authentication failure. Returns the identity from
 * resolveOidcIdentity (verified e-mail plus the stable iss/sub pair).
 */
export async function handleCallback(
  params: Record<string, string>,
  flow: OidcFlowState
): Promise<OidcIdentity> {
  const client = await getClient();

  const tokenSet = await client.callback(getRedirectUri(), params, {
    state: flow.state,
    nonce: flow.nonce,
    code_verifier: flow.codeVerifier,
  });

  return resolveOidcIdentity(tokenSet.claims());
}

// --- Transient flow-state persistence (oidc_flows table) --------------------

/** Persist per-login flow state so it survives the redirect to the IdP. */
export async function saveOidcFlow(flow: OidcFlowState): Promise<void> {
  await pool.query(
    `INSERT INTO oidc_flows (state, nonce, code_verifier, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
    [flow.state, flow.nonce, flow.codeVerifier]
  );

  // Best-effort opportunistic cleanup of expired flows.
  pool.query('DELETE FROM oidc_flows WHERE expires_at < NOW()').catch(() => {});
}

/**
 * Atomically claim-and-delete a flow by state. Returns null if the state is
 * unknown or expired (both are single-statement enforced: the DELETE only
 * matches an unexpired row, and deleting it makes replay impossible).
 */
export async function consumeOidcFlow(state: string): Promise<OidcFlowState | null> {
  if (!state) return null;

  const result = await pool.query(
    `DELETE FROM oidc_flows
      WHERE state = $1 AND expires_at > NOW()
      RETURNING state, nonce, code_verifier`,
    [state]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return { state: row.state, nonce: row.nonce, codeVerifier: row.code_verifier };
}
