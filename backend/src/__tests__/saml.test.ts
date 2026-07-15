import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// SAML unit tests. We do NOT hit a live IdP or a live database:
//  - @node-saml/node-saml is mocked so we control validatePostResponseAsync and
//    never perform real XML-dsig validation here (that library is trusted).
//  - ../db/connection (the pg Pool) is mocked; `query` is a vi.fn driven per test.
// isSamlConfigured() and extractEmail() are exercised against the REAL lib code
// (neither constructs a SAML instance), while the callback route is exercised
// through the real handler with the two dependencies above mocked.

const validatePostResponseAsync = vi.fn();
const getAuthorizeUrlAsync = vi.fn();

vi.mock('@node-saml/node-saml', () => {
  return {
    SAML: class {
      getAuthorizeUrlAsync(...args: unknown[]) {
        return getAuthorizeUrlAsync(...args);
      }
      validatePostResponseAsync(...args: unknown[]) {
        return validatePostResponseAsync(...args);
      }
    },
    generateServiceProviderMetadata: vi.fn(() => '<EntityDescriptor/>'),
    ValidateInResponseTo: { never: 'never', ifPresent: 'ifPresent', always: 'always' },
  };
});

const query = vi.fn();
vi.mock('../db/connection', () => {
  const pool = { query };
  return { __esModule: true, default: pool, pool };
});

const CONFIGURED_ENV = {
  JWT_SECRET: 'a-valid-secret-that-is-long-enough',
  SAML_ENTRY_POINT: 'https://idp.example.edu/idp/profile/SAML2/Redirect/SSO',
  SAML_ISSUER: 'https://status.example.edu/saml',
  SAML_IDP_CERT: '-----BEGIN CERTIFICATE-----\\nMIIFAKE\\n-----END CERTIFICATE-----',
  PUBLIC_URL: 'https://status.example.edu',
};

describe('backend/src/lib/saml isSamlConfigured gating', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...CONFIGURED_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('is true only when entry point + issuer + a cert are all set', async () => {
    const { isSamlConfigured } = await import('../lib/saml');
    expect(isSamlConfigured()).toBe(true);
  });

  it('is false when SAML_ENTRY_POINT is missing', async () => {
    delete process.env.SAML_ENTRY_POINT;
    const { isSamlConfigured } = await import('../lib/saml');
    expect(isSamlConfigured()).toBe(false);
  });

  it('is false when the issuer is missing', async () => {
    delete process.env.SAML_ISSUER;
    const { isSamlConfigured } = await import('../lib/saml');
    expect(isSamlConfigured()).toBe(false);
  });

  it('is false when no IdP cert (inline or file) is set', async () => {
    delete process.env.SAML_IDP_CERT;
    delete process.env.SAML_IDP_CERT_FILE;
    const { isSamlConfigured } = await import('../lib/saml');
    expect(isSamlConfigured()).toBe(false);
  });

  it('is true when the cert is supplied via SAML_IDP_CERT_FILE', async () => {
    delete process.env.SAML_IDP_CERT;
    const dir = mkdtempSync(join(tmpdir(), 'saml-test-'));
    const certPath = join(dir, 'idp-cert.pem');
    writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----');
    process.env.SAML_IDP_CERT_FILE = certPath;

    const { isSamlConfigured } = await import('../lib/saml');
    expect(isSamlConfigured()).toBe(true);
  });
});

describe('backend/src/lib/saml extractEmail', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...CONFIGURED_ENV };
    delete process.env.SAML_EMAIL_ATTRIBUTE;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // Minimal Profile-shaped fixture; extractEmail only reads attribute keys.
  function profile(extra: Record<string, unknown>) {
    return { issuer: 'idp', nameID: '', nameIDFormat: '', ...extra } as never;
  }

  it('uses SAML_EMAIL_ATTRIBUTE when set', async () => {
    process.env.SAML_EMAIL_ATTRIBUTE = 'urn:custom:mail';
    const { extractEmail } = await import('../lib/saml');
    expect(extractEmail(profile({ 'urn:custom:mail': 'Alice@Example.edu' }))).toBe('Alice@Example.edu');
  });

  it('falls back to the xmlsoap emailaddress claim', async () => {
    const { extractEmail } = await import('../lib/saml');
    const email = extractEmail(
      profile({ 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'bob@example.edu' })
    );
    expect(email).toBe('bob@example.edu');
  });

  it('reads the first value of an array-valued attribute', async () => {
    const { extractEmail } = await import('../lib/saml');
    expect(extractEmail(profile({ email: ['carol@example.edu', 'other@example.edu'] }))).toBe(
      'carol@example.edu'
    );
  });

  it('falls back to NameID when it looks like an email', async () => {
    const { extractEmail } = await import('../lib/saml');
    expect(extractEmail(profile({ nameID: 'dave@example.edu' }))).toBe('dave@example.edu');
  });

  it('throws when no email attribute or email-like NameID is present', async () => {
    const { extractEmail } = await import('../lib/saml');
    expect(() => extractEmail(profile({ nameID: 'not-an-email' }))).toThrow(/did not contain an email/);
  });
});

// Pull the POST /callback handler out of the router so we can drive it with a
// fake (req, res) — mirrors the harness style used in authCookies.test.ts.
async function getCallbackHandler() {
  const mod = await import('../routes/saml');
  const router = mod.default as unknown as {
    stack: { route?: { path: string; stack: { handle: (req: unknown, res: unknown) => Promise<void> }[] } }[];
  };
  const layer = router.stack.find((l) => l.route?.path === '/callback');
  if (!layer?.route) throw new Error('POST /callback route not found');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  const redirect = vi.fn();
  return { res: { redirect } as unknown as import('express').Response, redirect };
}

describe('backend/src/routes/saml POST /callback authorization', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    validatePostResponseAsync.mockReset();
    process.env = { ...ORIGINAL_ENV, ...CONFIGURED_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejects an unknown user with a "not authorized" ?error redirect (never auto-creates)', async () => {
    // Valid signed assertion → email, but the user is not in the DB.
    validatePostResponseAsync.mockResolvedValue({ profile: { nameID: 'ghost@example.edu' }, loggedOut: false });
    query.mockResolvedValue({ rows: [] }); // users lookup returns nothing

    const handler = await getCallbackHandler();
    const { res, redirect } = fakeRes();

    await handler({ body: { SAMLResponse: 'base64...' } }, res);

    expect(redirect).toHaveBeenCalledOnce();
    const target = redirect.mock.calls[0][0] as string;
    expect(target).toContain('?error=');
    expect(decodeURIComponent(target)).toContain('not authorized');
    // Must NOT issue an auth code (no INSERT) for an unauthorized user.
    const insert = query.mock.calls.find((c) => /INSERT INTO auth_codes/i.test(c[0]));
    expect(insert).toBeUndefined();
  });

  it('on a known user issues a one-time code and redirects with ONLY ?code=', async () => {
    validatePostResponseAsync.mockResolvedValue({ profile: { nameID: 'known@example.edu' }, loggedOut: false });
    query.mockImplementation((sql: string) => {
      if (/SELECT id, email, name, role FROM users/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'u1', email: 'known@example.edu', name: 'K', role: 'admin' }] });
      }
      return Promise.resolve({ rows: [] }); // INSERT auth_codes + cleanup
    });

    const handler = await getCallbackHandler();
    const { res, redirect } = fakeRes();

    await handler({ body: { SAMLResponse: 'base64...' } }, res);

    expect(redirect).toHaveBeenCalledOnce();
    const target = redirect.mock.calls[0][0] as string;
    expect(target).toContain('?code=');
    // No token/JWT/user ever appears in the redirect.
    expect(target).not.toMatch(/token|jwt|user=/i);
  });

  it('treats a thrown validation failure as an auth failure (?error redirect)', async () => {
    validatePostResponseAsync.mockRejectedValue(new Error('Invalid signature'));

    const handler = await getCallbackHandler();
    const { res, redirect } = fakeRes();

    await handler({ body: { SAMLResponse: 'tampered' } }, res);

    expect(redirect).toHaveBeenCalledOnce();
    const target = redirect.mock.calls[0][0] as string;
    expect(target).toContain('?error=');
    expect(target).not.toContain('?code=');
    // Never looked up / created a user off an invalid assertion.
    expect(query).not.toHaveBeenCalled();
  });
});
