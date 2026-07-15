import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// backend/src/lib/cas.ts imports ../db/connection (pg Pool) and ./config (which
// fail-fast validates JWT_SECRET at import time). `new Pool(...)` in pg is lazy —
// it does not open a connection until a query is issued — so importing cas.ts
// is safe without a live database. We still must provide a valid JWT_SECRET so
// config.ts's module-level validation doesn't throw on import.

describe('backend/src/lib/cas URL building', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('getLoginUrl throws when CAS_BASE_URL is unset', async () => {
    delete process.env.CAS_BASE_URL;
    const { getLoginUrl } = await import('../lib/cas');
    expect(() => getLoginUrl()).toThrow(/CAS not configured/);
  });

  it('getLoginUrl builds a service URL from CAS_BASE_URL when set', async () => {
    process.env.CAS_BASE_URL = 'https://login.example.edu/cas';
    process.env.CAS_SERVICE_URL = 'https://status.example.edu/api/admin/cas/callback';
    const { getLoginUrl } = await import('../lib/cas');
    expect(getLoginUrl()).toBe(
      `https://login.example.edu/cas/login?service=${encodeURIComponent(
        'https://status.example.edu/api/admin/cas/callback'
      )}`
    );
  });

  it('getLoginUrl strips a trailing slash from CAS_BASE_URL', async () => {
    process.env.CAS_BASE_URL = 'https://login.example.edu/cas/';
    process.env.CAS_SERVICE_URL = 'https://status.example.edu/api/admin/cas/callback';
    const { getLoginUrl } = await import('../lib/cas');
    expect(getLoginUrl()).toContain('https://login.example.edu/cas/login?service=');
  });

  it('isCasConfigured reflects whether CAS_BASE_URL is set', async () => {
    delete process.env.CAS_BASE_URL;
    let mod = await import('../lib/cas');
    expect(mod.isCasConfigured()).toBe(false);

    vi.resetModules();
    process.env.CAS_BASE_URL = 'https://login.example.edu/cas';
    mod = await import('../lib/cas');
    expect(mod.isCasConfigured()).toBe(true);
  });
});
