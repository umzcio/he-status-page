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
    const { accountClientLimiter, accountLimiter } = await import('../lib/loginThrottle');
    const app = express();
    // The test client is always 127.0.0.1, so trust it and let each test pick
    // its "client address" with X-Forwarded-For.
    app.set('trust proxy', ['loopback']);
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/admin/login', accountClientLimiter, accountLimiter);
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

  it('sets the session and device cookies on success', async () => {
    const res = await login('admin@example.edu', PASSWORD, '198.51.100.1');
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(/hsp_session=/);
    expect(cookies).toMatch(/hsp_device=/);
  });

  it('locks out guessing against one account from rotating addresses', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await login('admin@example.edu', `wrong-${i}`, `203.0.113.${i + 1}`);
      expect(res.status).toBe(401);
    }
    const blocked = await login('admin@example.edu', PASSWORD, '203.0.113.200');
    expect(blocked.status).toBe(429);
  });

  it("does not lock out the real admin's known browser", async () => {
    const first = await login('admin@example.edu', PASSWORD, '198.51.100.7');
    const device = first.headers.getSetCookie().find((c) => c.startsWith('hsp_device='))!.split(';')[0];

    for (let i = 0; i < 12; i++) {
      await login('admin@example.edu', `wrong-${i}`, `203.0.113.${i + 1}`);
    }

    const res = await login('admin@example.edu', PASSWORD, '198.51.100.7', device);
    expect(res.status).toBe(200);
  });

  it('limits failures per account from a single address', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('admin@example.edu', `wrong-${i}`, '203.0.113.50')).status).toBe(401);
    }
    expect((await login('admin@example.edu', PASSWORD, '203.0.113.50')).status).toBe(429);
  });
});

describe('device tokens', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough';
  });

  it('match only the account they were issued for, case-insensitively', async () => {
    const { issueDeviceToken, deviceTokenMatches } = await import('../lib/loginThrottle');
    const token = issueDeviceToken('Admin@Example.edu');
    expect(deviceTokenMatches(token, 'admin@example.edu')).toBe(true);
    expect(deviceTokenMatches(token, 'other@example.edu')).toBe(false);
    expect(deviceTokenMatches('garbage', 'admin@example.edu')).toBe(false);
    expect(deviceTokenMatches(undefined, 'admin@example.edu')).toBe(false);
  });
});
