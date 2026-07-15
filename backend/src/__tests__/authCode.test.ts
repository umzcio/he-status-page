import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

// authCode.ts imports the pg pool (default export of ../db/connection). We mock
// the whole module so no live database is required: `query` is a vi.fn we drive
// per-test. `new Pool()` is never constructed here. We still set a valid
// JWT_SECRET in case any transitively-imported module validates it.
//
// We branch the mock on the SQL text (rather than call order) so it is robust
// to the fire-and-forget cleanup DELETE that issueAuthCode fires without await.

const query = vi.fn();

vi.mock('../db/connection', () => {
  const pool = { query };
  return { __esModule: true, default: pool, pool };
});

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('backend/src/lib/authCode', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('issueAuthCode stores only the sha256 hash (never the plaintext) and returns the plaintext', async () => {
    query.mockResolvedValue({ rows: [] });
    const { issueAuthCode } = await import('../lib/authCode');

    const code = await issueAuthCode('user-123');

    // Returned code is 32 random bytes as hex = 64 hex chars.
    expect(code).toMatch(/^[0-9a-f]{64}$/);

    // Find the INSERT call and assert it stored the HASH, not the plaintext.
    const insertCall = query.mock.calls.find((c) => /INSERT INTO auth_codes/i.test(c[0]));
    expect(insertCall).toBeTruthy();
    const [sql, params] = insertCall!;
    expect(params[0]).toBe(sha256Hex(code));
    expect(params[0]).not.toBe(code);
    expect(params[1]).toBe('user-123');
    // Expiry is set relative to NOW() server-side.
    expect(sql).toMatch(/expires_at/i);
    expect(sql).toMatch(/NOW\(\)\s*\+\s*INTERVAL/i);
  });

  it('consumeAuthCode happy path: atomic single-use UPDATE then returns the user', async () => {
    const code = 'a'.repeat(64);
    const expectedHash = sha256Hex(code);

    query.mockImplementation((sql: string, params: unknown[]) => {
      if (/UPDATE auth_codes/i.test(sql)) {
        // The atomic claim must gate on unconsumed AND unexpired, in one stmt.
        expect(sql).toMatch(/consumed_at\s*=\s*NOW\(\)/i);
        expect(sql).toMatch(/consumed_at IS NULL/i);
        expect(sql).toMatch(/expires_at\s*>\s*NOW\(\)/i);
        expect(sql).toMatch(/RETURNING user_id/i);
        expect(params[0]).toBe(expectedHash);
        return Promise.resolve({ rows: [{ user_id: 'user-123' }] });
      }
      if (/SELECT id, email, name, role FROM users/i.test(sql)) {
        expect(params[0]).toBe('user-123');
        return Promise.resolve({
          rows: [{ id: 'user-123', email: 'a@x.edu', name: 'A', role: 'admin' }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const { consumeAuthCode } = await import('../lib/authCode');
    const user = await consumeAuthCode(code);

    expect(user).toEqual({ id: 'user-123', email: 'a@x.edu', name: 'A', role: 'admin' });
  });

  it('consumeAuthCode returns null on a replayed (already-consumed) code', async () => {
    // The atomic UPDATE matches zero rows because consumed_at IS NULL fails.
    query.mockImplementation((sql: string) => {
      if (/UPDATE auth_codes/i.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { consumeAuthCode } = await import('../lib/authCode');
    const user = await consumeAuthCode('b'.repeat(64));

    expect(user).toBeNull();
    // Must NOT attempt to look up a user if no row was claimed.
    const selectCall = query.mock.calls.find((c) => /SELECT id, email, name, role FROM users/i.test(c[0]));
    expect(selectCall).toBeUndefined();
  });

  it('consumeAuthCode returns null on an expired code', async () => {
    // Expiry is enforced by the same WHERE (expires_at > NOW()) => zero rows.
    query.mockImplementation((sql: string) => {
      if (/UPDATE auth_codes/i.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { consumeAuthCode } = await import('../lib/authCode');
    expect(await consumeAuthCode('c'.repeat(64))).toBeNull();
  });

  it('consumeAuthCode returns null on an unknown/wrong code', async () => {
    query.mockImplementation((sql: string) => {
      if (/UPDATE auth_codes/i.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { consumeAuthCode } = await import('../lib/authCode');
    expect(await consumeAuthCode('does-not-exist')).toBeNull();
  });

  it('consumeAuthCode returns null for empty input without touching the DB', async () => {
    const { consumeAuthCode } = await import('../lib/authCode');
    expect(await consumeAuthCode('')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('consumeAuthCode returns null if the claimed user no longer exists', async () => {
    query.mockImplementation((sql: string) => {
      if (/UPDATE auth_codes/i.test(sql)) return Promise.resolve({ rows: [{ user_id: 'ghost' }] });
      if (/SELECT id, email, name, role FROM users/i.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const { consumeAuthCode } = await import('../lib/authCode');
    expect(await consumeAuthCode('d'.repeat(64))).toBeNull();
  });
});
