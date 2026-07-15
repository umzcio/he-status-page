import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  SAML,
  generateServiceProviderMetadata,
  ValidateInResponseTo,
  type SamlConfig,
  type CacheItem,
  type CacheProvider,
  type Profile,
} from '@node-saml/node-saml';
import pool from '../db/connection';

// SAML 2.0 SSO provider (works with Shibboleth, ADFS, Entra ID SAML, Okta,
// Keycloak, etc). SAML is OPTIONAL and is considered configured only when the
// required trio SAML_ENTRY_POINT + (SAML_IDP_CERT | SAML_IDP_CERT_FILE) +
// SAML_ISSUER is set. All env is read at call time (not import time) so an
// unconfigured deploy never crashes.
//
// Like CAS and OIDC, SAML only *authenticates*. Authorization is unchanged: the
// callback route requires the (lowercased) email to already exist in the users
// table, else the same "not authorized" path is taken. This module never
// touches the users table and never auto-creates accounts.
//
// Signature/XML-dsig validation is delegated entirely to @node-saml/node-saml
// (a maintained xml-crypto based library) — we never hand-roll XML signature
// checking. We require signed assertions (wantAssertionsSigned) and validate
// the audience against SAML_ISSUER, the assertion's NotBefore/NotOnOrAfter
// conditions, and InResponseTo (against the DB-backed cache below).

// Match the DB row TTL (015_saml_flows.sql: NOW() + 10 min) so node-saml's
// in-memory age check and our persisted expiry agree.
const REQUEST_ID_TTL_MS = 10 * 60 * 1000;

function getEntryPoint(): string | undefined {
  return process.env.SAML_ENTRY_POINT || undefined;
}

function getIssuer(): string | undefined {
  return process.env.SAML_ISSUER || undefined;
}

// Read the IdP signing certificate. Supports either a single-line env value
// with literal "\n" escapes (SAML_IDP_CERT) or a PEM file path read at call
// time (SAML_IDP_CERT_FILE). Returns undefined when neither is set.
function getIdpCert(): string | undefined {
  const inline = process.env.SAML_IDP_CERT;
  if (inline) return inline.replace(/\\n/g, '\n');

  const file = process.env.SAML_IDP_CERT_FILE;
  if (file) return readFileSync(file, 'utf8');

  return undefined;
}

// Optional SP private key for signing our AuthnRequests. Same inline/file rules.
function getSpPrivateKey(): string | undefined {
  const inline = process.env.SAML_SP_PRIVATE_KEY;
  if (inline) return inline.replace(/\\n/g, '\n');

  const file = process.env.SAML_SP_PRIVATE_KEY_FILE;
  if (file) return readFileSync(file, 'utf8');

  return undefined;
}

export function getCallbackUrl(): string {
  if (process.env.SAML_CALLBACK_URL) return process.env.SAML_CALLBACK_URL;
  const publicUrl = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${publicUrl}/api/admin/saml/callback`;
}

export function isSamlConfigured(): boolean {
  return !!(getEntryPoint() && getIdpCert() && getIssuer());
}

// --- DB-backed CacheProvider (backs InResponseTo/replay validation) ---------
//
// node-saml calls saveAsync(requestId, instant) when building the AuthnRequest
// and getAsync/removeAsync(requestId) when validating the SAMLResponse's
// InResponseTo. Backing this with saml_flows (rather than the default
// in-memory provider) makes validation survive restarts and multi-instance
// deployments. getAsync returns created_at as an ISO string: for the primary
// InResponseTo check node-saml only needs a truthy value, and for the
// SubjectConfirmation path it parses the value as a Date and compares it to
// requestIdExpirationPeriodMs — created_at is the (essentially identical)
// request issue time, so the age check stays correct without a value column.
const dbCacheProvider: CacheProvider = {
  async saveAsync(key: string): Promise<CacheItem | null> {
    await pool.query(
      `INSERT INTO saml_flows (request_id, expires_at)
       VALUES ($1, NOW() + INTERVAL '10 minutes')
       ON CONFLICT (request_id) DO NOTHING`,
      [key]
    );

    // Best-effort opportunistic cleanup of expired request IDs.
    pool.query('DELETE FROM saml_flows WHERE expires_at < NOW()').catch(() => {});

    return { value: key, createdAt: Date.now() };
  },

  async getAsync(key: string): Promise<string | null> {
    const result = await pool.query(
      `SELECT created_at FROM saml_flows WHERE request_id = $1 AND expires_at > NOW()`,
      [key]
    );
    if (result.rows.length === 0) return null;
    return new Date(result.rows[0].created_at).toISOString();
  },

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const result = await pool.query(
      `DELETE FROM saml_flows WHERE request_id = $1 RETURNING request_id`,
      [key]
    );
    return result.rows.length > 0 ? result.rows[0].request_id : null;
  },
};

// Lazily-constructed SAML instance, cached across requests. Reset (undefined)
// forces a rebuild — e.g. after config changes in tests.
let cachedSaml: SAML | undefined;

// Records the ID of the most recently generated AuthnRequest so getAuthorizeUrl
// can return it for logging. This is best-effort under high concurrency (the
// SAML instance is shared): it does NOT affect security or persistence, which
// are keyed off the exact ID node-saml stored in saml_flows via saveAsync.
let lastRequestId = '';

// xsd:ID-compatible unique request ID (must not start with a digit).
function generateRequestId(): string {
  const id = `_${randomBytes(21).toString('hex')}`;
  lastRequestId = id;
  return id;
}

function buildConfig(): SamlConfig {
  const entryPoint = getEntryPoint();
  const idpCert = getIdpCert();
  const issuer = getIssuer();
  if (!entryPoint || !idpCert || !issuer) {
    throw new Error('SAML is not configured');
  }

  const privateKey = getSpPrivateKey();

  const config: SamlConfig = {
    entryPoint,
    idpCert,
    issuer,
    callbackUrl: getCallbackUrl(),
    // The assertion carrying identity MUST be signed; node-saml validates that
    // signature against idpCert. We do not additionally require the response
    // envelope to be signed (wantAuthnResponseSigned: false) so IdPs that sign
    // only the assertion (the common .edu / Shibboleth default) interoperate —
    // the signed assertion is the trust anchor.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    // Validate audience === our SP entity ID.
    audience: issuer,
    // Enforce InResponseTo on every response, checked against the DB cache.
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_ID_TTL_MS,
    cacheProvider: dbCacheProvider,
    generateUniqueId: generateRequestId,
    // Small clock skew tolerance for NotBefore/NotOnOrAfter comparisons.
    acceptedClockSkewMs: 5000,
    ...(process.env.SAML_LOGOUT_URL ? { logoutUrl: process.env.SAML_LOGOUT_URL } : {}),
    ...(privateKey ? { privateKey, signatureAlgorithm: 'sha256' } : {}),
  };

  return config;
}

function getSaml(): SAML {
  if (cachedSaml) return cachedSaml;
  cachedSaml = new SAML(buildConfig());
  return cachedSaml;
}

/**
 * Build the IdP redirect URL for a new login. node-saml generates a unique
 * AuthnRequest ID and persists it via our CacheProvider (saml_flows) inside
 * this call, so InResponseTo can be validated on callback. The returned
 * requestId is informational/for logging; persistence and validation are keyed
 * off the ID node-saml itself stored, not off this value.
 */
export async function getAuthorizeUrl(): Promise<{ url: string; requestId: string }> {
  const saml = getSaml();
  const url = await saml.getAuthorizeUrlAsync('', undefined, {});
  return { url, requestId: lastRequestId };
}

// Common email claim URIs tried (in order) when SAML_EMAIL_ATTRIBUTE is unset.
const EMAIL_CLAIM_KEYS = [
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3', // RFC 2798 "mail"
  'email',
  'mail',
];

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Coerce a SAML attribute value (string | array) to a single string.
function attrToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

/**
 * Extract the email from a validated SAML profile. Uses SAML_EMAIL_ATTRIBUTE
 * when set; otherwise tries common email claim URIs and finally falls back to
 * the NameID when it looks like an email. Throws if no email can be found.
 * Email is ONLY ever read from an already-validated assertion.
 */
export function extractEmail(profile: Profile): string {
  const configured = process.env.SAML_EMAIL_ATTRIBUTE;
  if (configured) {
    const val = attrToString(profile[configured]);
    if (val) return val;
  } else {
    for (const key of EMAIL_CLAIM_KEYS) {
      const val = attrToString(profile[key]);
      if (val) return val;
    }
  }

  const nameId = attrToString(profile.nameID);
  if (nameId && looksLikeEmail(nameId)) return nameId;

  throw new Error('SAML assertion did not contain an email attribute or email-like NameID');
}

/**
 * Validate a POSTed SAMLResponse and return the authenticated email/name.
 * validatePostResponseAsync verifies the XML signature (against idpCert),
 * the assertion conditions (NotBefore/NotOnOrAfter), the audience, and
 * InResponseTo (against our DB cache). It throws on any validation failure —
 * callers MUST treat a throw as an authentication failure.
 */
export async function handleCallback(
  body: Record<string, string>
): Promise<{ email: string; name: string }> {
  const saml = getSaml();

  const { profile } = await saml.validatePostResponseAsync(body);
  if (!profile) {
    throw new Error('SAML response did not yield a profile');
  }

  const email = extractEmail(profile);
  const name =
    attrToString(profile.displayName) ||
    attrToString(profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']) ||
    email;

  return { email, name };
}

/**
 * Generate SP metadata XML to ease IdP configuration. When an SP private key is
 * configured we advertise wantAssertionsSigned in the metadata.
 */
export function getServiceProviderMetadata(): string {
  const issuer = getIssuer();
  if (!issuer) throw new Error('SAML is not configured');

  return generateServiceProviderMetadata({
    issuer,
    callbackUrl: getCallbackUrl(),
    wantAssertionsSigned: true,
    identifierFormat: null,
  });
}
