import { randomBytes, createHash } from 'node:crypto';
import pool from '../db/connection';

// One-time auth-code exchange.
//
// After a successful SSO authentication (CAS or OIDC) we must hand the browser
// something it can trade for a session JWT — WITHOUT putting the JWT (or the
// user object) in the redirect URL, where it would leak into browser history,
// referrer headers, and server logs. We issue a short-lived, single-use opaque
// code instead: the plaintext travels in the URL, but only its sha256 hash is
// stored server-side. The frontend POSTs the code back to
// /api/admin/auth/exchange, which atomically claims-and-consumes it.

// Lifetime of an issued code. Deliberately short — the browser exchanges it
// immediately on landing back on the admin page.
const CODE_TTL_SECONDS = 60;

export interface AuthCodeUser {
  id: string;
  email: string;
  role: string;
  name: string;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Issue a one-time auth code for the given user. Generates 32 random bytes as a
 * hex string (the value placed in the redirect URL), stores only its sha256
 * hash with a 60s expiry, and returns the plaintext code. Opportunistically
 * prunes expired rows (best-effort; failures are swallowed).
 */
export async function issueAuthCode(userId: string): Promise<string> {
  const code = randomBytes(32).toString('hex');
  const codeHash = hashCode(code);

  await pool.query(
    `INSERT INTO auth_codes (code_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${CODE_TTL_SECONDS} seconds')`,
    [codeHash, userId]
  );

  // Best-effort opportunistic cleanup of expired/old codes. Never block or fail
  // issuance on this.
  pool
    .query('DELETE FROM auth_codes WHERE expires_at < NOW()')
    .catch(() => {});

  return code;
}

/**
 * Atomically claim and consume an auth code. Single-use and expiry are enforced
 * in ONE statement: the UPDATE only matches a row that is unconsumed and
 * unexpired, and marks it consumed in the same breath. A replayed code (already
 * consumed) or an expired code matches zero rows and returns null. On success
 * the associated user is looked up and returned.
 */
export async function consumeAuthCode(code: string): Promise<AuthCodeUser | null> {
  if (!code) return null;

  const codeHash = hashCode(code);

  // Atomic single-use claim: only an unconsumed, unexpired code is claimable.
  const claim = await pool.query(
    `UPDATE auth_codes
        SET consumed_at = NOW()
      WHERE code_hash = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING user_id`,
    [codeHash]
  );

  if (claim.rows.length === 0) {
    return null;
  }

  const userId = claim.rows[0].user_id;

  const userResult = await pool.query(
    'SELECT id, email, name, role FROM users WHERE id = $1',
    [userId]
  );

  if (userResult.rows.length === 0) {
    return null;
  }

  const row = userResult.rows[0];
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
