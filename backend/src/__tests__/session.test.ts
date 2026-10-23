import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { listen } from './helpers';

// session.ts and auth middleware use the pg pool; mock it so no database is
// needed. `query` is driven per test.
const query = vi.fn();

vi.mock('../db/connection', () => {
  const pool = { query };
  return { __esModule: true, default: pool, pool };
});

const SECRET = 'a-valid-secret-that-is-long-enough';
const user = { id: 'user-1', email: 'admin@example.edu', role: 'super_admin', token_version: 3 };

describe('backend/src/lib/session', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: SECRET };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('signs tokens with a unique jti and the user token_version', async () => {
    const { signSession, verifySession } = await import('../lib/session');
    const a = verifySession(signSession(user));
    const b = verifySession(signSession(user));
    expect(a.tv).toBe(3);
    expect(a.jti).toBeTruthy();
    expect(a.jti).not.toBe(b.jti);
  });

  it('isSessionCurrent rejects a bumped token_version, a revoked jti, and legacy tokens', async () => {
    const { signSession, verifySession, isSessionCurrent } = await import('../lib/session');
    const claims = verifySession(signSession(user));

    expect(isSessionCurrent(claims, { token_version: 3, revoked: false })).toBe(true);
    expect(isSessionCurrent(claims, { token_version: 4, revoked: false })).toBe(false);
    expect(isSessionCurrent(claims, { token_version: 3, revoked: true })).toBe(false);

    const legacy = jwt.verify(jwt.sign({ id: user.id, email: user.email, role: user.role }, SECRET), SECRET);
    expect(isSessionCurrent(legacy as any, { token_version: 0, revoked: false })).toBe(false);
  });

  it('revokeSessionToken records the jti until the token would expire', async () => {
    query.mockResolvedValue({ rows: [] });
    const { signSession, verifySession, revokeSessionToken } = await import('../lib/session');
    const token = signSession(user);
    const claims = verifySession(token);

    await revokeSessionToken(token);

    const insert = query.mock.calls.find((c) => /INSERT INTO revoked_sessions/.test(c[0]));
    expect(insert![1]).toEqual([claims.jti, claims.exp]);
  });

  it('revokeSessionToken ignores missing or invalid tokens', async () => {
    const { revokeSessionToken } = await import('../lib/session');
    await revokeSessionToken(undefined);
    await revokeSessionToken('not-a-jwt');
    expect(query).not.toHaveBeenCalled();
  });

  describe('authMiddleware', () => {
    let close: (() => Promise<void>) | undefined;
    afterEach(async () => {
      await close?.();
      close = undefined;
    });

    async function statusWith(token: string, row: Record<string, unknown> | null): Promise<number> {
      query.mockImplementation((sql: string) =>
        /FROM users u/.test(sql) ? Promise.resolve({ rows: row ? [row] : [] }) : Promise.resolve({ rows: [] })
      );
      const { authMiddleware } = await import('../routes/middleware/auth');
      const app = express();
      app.use(cookieParser());
      app.get('/me', authMiddleware, (_req, res) => res.json({ ok: true }));
      const server = await listen(app);
      close = server.close;
      const res = await fetch(`${server.url}/me`, { headers: { Authorization: `Bearer ${token}` } });
      return res.status;
    }

    it('accepts a current session', async () => {
      const { signSession } = await import('../lib/session');
      const token = signSession(user);
      expect(await statusWith(token, { ...user, revoked: false })).toBe(200);
    });

    it('rejects a token issued before a password reset bumped token_version', async () => {
      const { signSession } = await import('../lib/session');
      const token = signSession(user);
      expect(await statusWith(token, { ...user, token_version: 4, revoked: false })).toBe(401);
    });

    it('rejects a token revoked at logout', async () => {
      const { signSession } = await import('../lib/session');
      const token = signSession(user);
      expect(await statusWith(token, { ...user, revoked: true })).toBe(401);
    });

    it('rejects a token for a deleted user', async () => {
      const { signSession } = await import('../lib/session');
      const token = signSession(user);
      expect(await statusWith(token, null)).toBe(401);
    });
  });
});
