import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// authCookies imports ./config, which validates JWT_SECRET at import time, and
// reads JWT_EXPIRES_IN (a module const evaluated on import). csrf.ts pulls in
// authCookies transitively. We reset modules and set env per test, then import
// dynamically so each scenario re-evaluates against its own process.env.
// No live DB is touched by either module.

describe('backend/src/lib/authCookies', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('sessionCookieOptions is HttpOnly, Lax, path=/ with a 7d Max-Age by default', async () => {
    delete process.env.JWT_EXPIRES_IN;
    const { sessionCookieOptions } = await import('../lib/authCookies');
    const opts = sessionCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('csrfCookieOptions is readable (NOT HttpOnly) but shares the other flags', async () => {
    const { csrfCookieOptions, sessionCookieOptions } = await import('../lib/authCookies');
    const csrf = csrfCookieOptions();
    const session = sessionCookieOptions();
    expect(csrf.httpOnly).toBe(false);
    expect(csrf.sameSite).toBe('lax');
    expect(csrf.path).toBe('/');
    expect(csrf.maxAge).toBe(session.maxAge);
    expect(csrf.secure).toBe(session.secure);
  });

  it('Secure defaults to true in production and false otherwise', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COOKIE_SECURE;
    const prod = await import('../lib/authCookies');
    expect(prod.sessionCookieOptions().secure).toBe(true);

    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough', NODE_ENV: 'development' };
    delete process.env.COOKIE_SECURE;
    const dev = await import('../lib/authCookies');
    expect(dev.sessionCookieOptions().secure).toBe(false);
  });

  it('COOKIE_SECURE=false forces insecure even in production (local http dev)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECURE = 'false';
    const { sessionCookieOptions } = await import('../lib/authCookies');
    expect(sessionCookieOptions().secure).toBe(false);
  });

  it('COOKIE_DOMAIN is applied when set and omitted (host-only) when unset', async () => {
    process.env.COOKIE_DOMAIN = 'status.example.edu';
    const withDomain = await import('../lib/authCookies');
    expect(withDomain.sessionCookieOptions().domain).toBe('status.example.edu');

    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough' };
    delete process.env.COOKIE_DOMAIN;
    const noDomain = await import('../lib/authCookies');
    expect(noDomain.sessionCookieOptions().domain).toBeUndefined();
  });

  it('Max-Age tracks JWT_EXPIRES_IN units (1h => 3600s)', async () => {
    process.env.JWT_EXPIRES_IN = '1h';
    const { sessionCookieOptions } = await import('../lib/authCookies');
    expect(sessionCookieOptions().maxAge).toBe(60 * 60 * 1000);
  });

  it('issueSession sets both cookies (session HttpOnly + a fresh csrf); clearSession clears both', async () => {
    const { issueSession, clearSession, SESSION_COOKIE, CSRF_COOKIE, generateCsrfToken } =
      await import('../lib/authCookies');

    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const res = { cookie, clearCookie } as unknown as import('express').Response;

    issueSession(res, 'the.jwt.value');
    expect(cookie).toHaveBeenCalledTimes(2);
    const sessionCall = cookie.mock.calls.find((c) => c[0] === SESSION_COOKIE)!;
    const csrfCall = cookie.mock.calls.find((c) => c[0] === CSRF_COOKIE)!;
    expect(sessionCall[1]).toBe('the.jwt.value');
    expect(sessionCall[2].httpOnly).toBe(true);
    // CSRF value is 32 random bytes hex = 64 chars, readable (not HttpOnly).
    expect(csrfCall[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(csrfCall[2].httpOnly).toBe(false);

    clearSession(res);
    expect(clearCookie).toHaveBeenCalledTimes(2);
    expect(clearCookie.mock.calls.map((c) => c[0]).sort()).toEqual([CSRF_COOKIE, SESSION_COOKIE].sort());

    // Each generated token is unique.
    expect(generateCsrfToken()).not.toBe(generateCsrfToken());
  });
});

describe('backend/src/routes/middleware/csrf requireCsrf', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // Build a fake (req, res, next) triple. `header`/`cookie` seed the request.
  function harness(opts: {
    method?: string;
    authVia?: string;
    header?: string | null;
    cookie?: string | null;
  }) {
    const req = {
      method: opts.method ?? 'POST',
      authVia: opts.authVia,
      get: (name: string) =>
        name.toLowerCase() === 'x-csrf-token' ? (opts.header ?? undefined) : undefined,
      cookies: opts.cookie == null ? {} : { hsp_csrf: opts.cookie },
    };
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status, json };
    const next = vi.fn();
    return { req, res, next, status, json };
  }

  it('passes when header matches the cookie (cookie auth, mutating method)', async () => {
    const { requireCsrf } = await import('../routes/middleware/csrf');
    const token = 'a'.repeat(64);
    const { req, res, next, status } = harness({ authVia: 'cookie', header: token, cookie: token });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireCsrf(req as any, res as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('403s when header and cookie differ', async () => {
    const { requireCsrf } = await import('../routes/middleware/csrf');
    const { req, res, next, status, json } = harness({
      authVia: 'cookie',
      header: 'a'.repeat(64),
      cookie: 'b'.repeat(64),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireCsrf(req as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'CSRF token invalid' });
  });

  it('403s when the header is missing', async () => {
    const { requireCsrf } = await import('../routes/middleware/csrf');
    const { req, res, next, status } = harness({ authVia: 'cookie', header: null, cookie: 'a'.repeat(64) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireCsrf(req as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('403s when the cookie is missing', async () => {
    const { requireCsrf } = await import('../routes/middleware/csrf');
    const { req, res, next, status } = harness({ authVia: 'cookie', header: 'a'.repeat(64), cookie: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireCsrf(req as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('403s when tokens differ in length (timingSafeEqual length guard)', async () => {
    const { requireCsrf } = await import('../routes/middleware/csrf');
    const { req, res, next, status } = harness({ authVia: 'cookie', header: 'abc', cookie: 'a'.repeat(64) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requireCsrf(req as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('skips (passes) for Bearer/API-key auth even without any CSRF token', async () => {
    const { requireCsrf } = await import('../routes/middleware/csrf');
    for (const authVia of ['bearer', 'apikey', undefined]) {
      const { req, res, next, status } = harness({ authVia, header: null, cookie: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requireCsrf(req as any, res as any, next);
      expect(next).toHaveBeenCalledOnce();
      expect(status).not.toHaveBeenCalled();
    }
  });

  it('skips safe methods (GET/HEAD) for cookie auth', async () => {
    const { requireCsrf } = await import('../routes/middleware/csrf');
    for (const method of ['GET', 'HEAD']) {
      const { req, res, next, status } = harness({ method, authVia: 'cookie', header: null, cookie: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requireCsrf(req as any, res as any, next);
      expect(next).toHaveBeenCalledOnce();
      expect(status).not.toHaveBeenCalled();
    }
  });
});
