import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import { listen } from './helpers';

// Drives POST /api/admin/login through the real router and the real
// limiters. The pg pool is replaced by a fake that serves the users lookup and
// an in-memory rate_limits table for PgRateLimitStore.
const query = vi.fn();

vi.mock('../db/connection', () => {
  const pool = { query, connect: vi.fn() };
  return { __esModule: true, default: pool, pool };
});

// Turnstile verdicts are scripted per test.
const verifyTurnstile = vi.fn();
vi.mock('../lib/turnstile', () => ({
  isTurnstileConfigured: () => !!process.env.TURNSTILE_SECRET_KEY,
  verifyTurnstile: (...args: unknown[]) => verifyTurnstile(...args),
}));

const PASSWORD = 'correct horse battery staple';
const hash = bcrypt.hashSync(PASSWORD, 4);

let users: Record<string, Record<string, unknown>>;
let hits: Map<string, number>;

function fakeQuery(sql: string, params: unknown[] = []) {
  if (/FROM users WHERE email/.test(sql)) {
    const row = users[params[0] as string];
    return Promise.resolve({ rows: row ? [row] : [] });
  }
  if (/INSERT INTO rate_limits/.test(sql)) {
    const key = params[0] as string;
    hits.set(key, (hits.get(key) ?? 0) + 1);
    return Promise.resolve({ rows: [{ hits: hits.get(key), reset_at: params[1] }] });
  }
  if (/UPDATE rate_limits SET hits = GREATEST/.test(sql)) {
    const key = params[0] as string;
    hits.set(key, Math.max((hits.get(key) ?? 0) - 1, 0));
  }
  return Promise.resolve({ rows: [] });
}

describe('POST /api/admin/login', () => {
  const ORIGINAL_ENV = process.env;
  let url: string;
  let close: () => Promise<void>;

  async function start(env: Record<string, string> = {}) {
    process.env = {
      ...ORIGINAL_ENV,
      JWT_SECRET: 'a-valid-secret-that-is-long-enough',
      PASSWORD_LOGIN_ENABLED: 'true',
      ...env,
    };
    const { default: adminRoutes } = await import('../routes/admin');
    const { accountClientLimiter } = await import('../lib/loginThrottle');
    const app = express();
    // The test client is always 127.0.0.1, so trust it and let each test pick
    // its "client address" with X-Forwarded-For.
    app.set('trust proxy', ['loopback']);
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/admin/login', accountClientLimiter);
    app.use('/api/admin', adminRoutes);
    ({ url, close } = await listen(app));
  }

  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    query.mockImplementation(fakeQuery);
    verifyTurnstile.mockReset();
    users = {
      'admin@example.edu': { id: 'u1', email: 'admin@example.edu', role: 'super_admin', hashed_password: hash, token_version: 0 },
      'sso-only@example.edu': { id: 'u2', email: 'sso-only@example.edu', role: 'admin', hashed_password: null, token_version: 0 },
    };
    hits = new Map();
  });

  afterEach(async () => {
    await close?.();
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  function login(email: string, password: string, ip: string, extra: Record<string, unknown> = {}) {
    return fetch(`${url}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ email, password, ...extra }),
    });
  }

  it('is disabled unless PASSWORD_LOGIN_ENABLED=true', async () => {
    await start({ PASSWORD_LOGIN_ENABLED: '' });
    const compare = vi.spyOn(bcrypt, 'compare');
    const res = await login('admin@example.edu', PASSWORD, '198.51.100.1');
    expect(res.status).toBe(403);
    expect(compare).not.toHaveBeenCalled();
    expect(query.mock.calls.some((c) => /FROM users/.test(c[0]))).toBe(false);
  });

  it('runs a bcrypt comparison even when the email is unknown', async () => {
    await start();
    const compare = vi.spyOn(bcrypt, 'compare');
    const res = await login('nobody@example.edu', 'whatever-password', '198.51.100.1');
    expect(res.status).toBe(401);
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('answers a password-less account exactly like a wrong password', async () => {
    await start();
    const res = await login('sso-only@example.edu', 'whatever-password', '198.51.100.1');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid credentials' });
  });

  it('sets the session cookies on success', async () => {
    await start();
    const res = await login('admin@example.edu', PASSWORD, '198.51.100.1');
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join('\n')).toMatch(/hsp_session=/);
  });

  it('bounds password checks per account however many addresses guess in parallel', async () => {
    await start();
    const compare = vi.spyOn(bcrypt, 'compare');
    const attempts = Array.from({ length: 40 }, (_, i) =>
      login('admin@example.edu', `wrong-${i}`, `203.0.${Math.floor(i / 200)}.${(i % 200) + 1}`)
    );
    const statuses = (await Promise.all(attempts)).map((r) => r.status);
    expect(compare).toHaveBeenCalledTimes(10);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(30);
  });

  it('past the budget, the owner gets through with a solved CAPTCHA', async () => {
    await start({ TURNSTILE_SECRET_KEY: 'secret' });
    for (let i = 0; i < 10; i++) await login('admin@example.edu', `wrong-${i}`, `203.0.113.${i + 1}`);

    // Without a challenge: refused, password not checked.
    expect((await login('admin@example.edu', PASSWORD, '198.51.100.9')).status).toBe(429);

    // A forged or failed challenge does not help.
    verifyTurnstile.mockResolvedValueOnce(false);
    expect((await login('admin@example.edu', PASSWORD, '198.51.100.9', { turnstileToken: 'bad' })).status).toBe(429);

    // A solved challenge does.
    verifyTurnstile.mockResolvedValueOnce(true);
    const res = await login('admin@example.edu', PASSWORD, '198.51.100.9', { turnstileToken: 'good' });
    expect(res.status).toBe(200);
  });

  it('ignores CAPTCHA tokens when Turnstile is not configured', async () => {
    await start();
    for (let i = 0; i < 10; i++) await login('admin@example.edu', `wrong-${i}`, `203.0.113.${i + 1}`);
    verifyTurnstile.mockResolvedValue(true);
    expect((await login('admin@example.edu', PASSWORD, '198.51.100.9', { turnstileToken: 'x' })).status).toBe(429);
  });

  it('limits failures per account from a single address', async () => {
    await start();
    for (let i = 0; i < 5; i++) {
      expect((await login('admin@example.edu', `wrong-${i}`, '203.0.113.50')).status).toBe(401);
    }
    expect((await login('admin@example.edu', PASSWORD, '203.0.113.50')).status).toBe(429);
  });

  it('treats a whole IPv6 /64 as one client', async () => {
    await start();
    for (let i = 1; i <= 5; i++) {
      expect((await login('admin@example.edu', `wrong-${i}`, `2001:db8:0:0::${i}`)).status).toBe(401);
    }
    // Another address in the same /64 is the same client...
    expect((await login('admin@example.edu', 'wrong-6', '2001:db8::ffff:1')).status).toBe(429);
    // ...a different /64 is not.
    expect((await login('admin@example.edu', 'wrong-7', '2001:db8:0:1::1')).status).toBe(401);
  });

  it('reports whether password login is available', async () => {
    await start({ PASSWORD_LOGIN_ENABLED: '' });
    const body = (await (await fetch(`${url}/api/admin/auth/providers`)).json()) as { password: boolean };
    expect(body.password).toBe(false);
  });
});

describe('clientKey', () => {
  it('keeps IPv4 and reduces IPv6 to its /64', async () => {
    const { clientKey } = await import('../lib/clientKey');
    expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('2001:db8:0:0:ffff:ffff:ffff:ffff')).toBe('2001:db8:0:0::/64');
    expect(clientKey('2001:db8:0:1::1')).toBe('2001:db8:0:1::/64');
    expect(clientKey(undefined)).toBe('unknown');
  });
});
