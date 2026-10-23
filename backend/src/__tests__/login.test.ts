import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import { listen } from './helpers';

// Drives POST /api/admin/login through the real router and the real
// per-account limiters. The pg pool is replaced by a fake that serves the
// users lookup and an in-memory rate_limits table for PgRateLimitStore.
const query = vi.fn();

vi.mock('../db/connection', () => {
  const pool = { query, connect: vi.fn() };
  return { __esModule: true, default: pool, pool };
});

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
  if (/SELECT hits, reset_at FROM rate_limits/.test(sql)) {
    const hit = hits.get(params[0] as string);
    return Promise.resolve({ rows: hit ? [{ hits: hit, reset_at: new Date(Date.now() + 60_000) }] : [] });
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
  let delays: number[];

  beforeEach(async () => {
    vi.resetModules();
    query.mockReset();
    query.mockImplementation(fakeQuery);
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough' };
    users = {
      'admin@example.edu': { id: 'u1', email: 'admin@example.edu', role: 'super_admin', hashed_password: hash, token_version: 0 },
      'sso-only@example.edu': { id: 'u2', email: 'sso-only@example.edu', role: 'admin', hashed_password: null, token_version: 0 },
    };
    hits = new Map();

    const { default: adminRoutes } = await import('../routes/admin');
    const throttle = await import('../lib/loginThrottle');
    const { accountClientLimiter } = throttle;
    // Record the per-account delays instead of actually waiting.
    delays = [];
    vi.spyOn(throttle.timing, 'sleep').mockImplementation(async (ms: number) => {
      delays.push(ms);
    });
    const app = express();
    // The test client is always 127.0.0.1, so trust it and let each test pick
    // its "client address" with X-Forwarded-For.
    app.set('trust proxy', ['loopback']);
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/admin/login', accountClientLimiter);
    app.use('/api/admin', adminRoutes);
    ({ url, close } = await listen(app));
  });

  afterEach(async () => {
    await close();
    process.env = ORIGINAL_ENV;
  });

  function login(email: string, password: string, ip: string, cookie?: string) {
    return fetch(`${url}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': ip,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ email, password }),
    });
  }

  it('runs a bcrypt comparison even when the email is unknown', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const res = await login('nobody@example.edu', 'whatever-password', '198.51.100.1');
    expect(res.status).toBe(401);
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });

  it('answers a password-less account exactly like a wrong password', async () => {
    const res = await login('sso-only@example.edu', 'whatever-password', '198.51.100.1');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid credentials' });
  });

  it('sets only the session cookies on success', async () => {
    const res = await login('admin@example.edu', PASSWORD, '198.51.100.1');
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(/hsp_session=/);
    expect(cookies).not.toMatch(/hsp_device=/);
  });

  it("an attacker's failures slow the account down but never lock the owner out", async () => {
    for (let i = 0; i < 12; i++) {
      expect((await login('admin@example.edu', `wrong-${i}`, `203.0.113.${i + 1}`)).status).toBe(401);
    }
    // Attempts past the threshold were delayed, with a growing delay.
    expect(delays.length).toBeGreaterThan(0);
    expect(delays[1]).toBeGreaterThan(delays[0]);

    // The owner: a fresh client, no cookies, right password, still gets in.
    const before = delays.length;
    const res = await login('admin@example.edu', PASSWORD, '198.51.100.200');
    expect(res.status).toBe(200);
    expect(delays.length).toBe(before + 1); // delayed like everyone else, not refused
  });

  it('limits failures per account from a single address', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('admin@example.edu', `wrong-${i}`, '203.0.113.50')).status).toBe(401);
    }
    expect((await login('admin@example.edu', PASSWORD, '203.0.113.50')).status).toBe(429);
  });

  it('treats a whole IPv6 /64 as one client', async () => {
    for (let i = 1; i <= 5; i++) {
      expect((await login('admin@example.edu', `wrong-${i}`, `2001:db8:0:0::${i}`)).status).toBe(401);
    }
    // Another address in the same /64 is the same client...
    expect((await login('admin@example.edu', 'wrong-6', '2001:db8::ffff:1')).status).toBe(429);
    // ...a different /64 is not.
    expect((await login('admin@example.edu', 'wrong-7', '2001:db8:0:1::1')).status).toBe(401);
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
