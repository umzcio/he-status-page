import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pool from '../db/connection';
import { JWT_SECRET, JWT_EXPIRES_IN } from './config';

// Session JWTs and server-side revocation.
//
// A JWT alone stays valid until `exp`, so every session token carries two extra
// claims that let the server end it early:
//  - `tv`  the user's users.token_version at sign time. Bumping token_version
//          (password reset, "revoke sessions") invalidates every outstanding
//          token for that user.
//  - `jti` a unique token id. Logout records it in revoked_sessions so that one
//          token stops working even if the cookie was copied elsewhere.
// authMiddleware checks both on every request via isSessionCurrent().

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  token_version: number;
}

export interface SessionClaims {
  id: string;
  email: string;
  role: string;
  tv?: number;
  jti?: string;
  exp?: number;
}

export function signSession(user: SessionUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, tv: user.token_version ?? 0 },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, jwtid: randomUUID() }
  );
}

// Throws if the signature or expiry is invalid.
export function verifySession(token: string): SessionClaims {
  return jwt.verify(token, JWT_SECRET) as SessionClaims;
}

/**
 * Whether a signature-valid token is still live for the user's current row.
 * Tokens minted before revocation support existed carry no jti/tv and are
 * rejected, forcing one fresh login after upgrade.
 */
export function isSessionCurrent(
  claims: SessionClaims,
  row: { token_version: number; revoked: boolean }
): boolean {
  if (!claims.jti || typeof claims.tv !== 'number') return false;
  if (row.revoked) return false;
  return claims.tv === row.token_version;
}

/** Revoke a single session token (logout). Invalid tokens are ignored. */
export async function revokeSessionToken(token: string | undefined): Promise<void> {
  if (!token) return;
  let claims: SessionClaims;
  try {
    claims = verifySession(token);
  } catch {
    return; // already unusable
  }
  if (!claims.jti || !claims.exp) return;

  await pool.query(
    `INSERT INTO revoked_sessions (jti, expires_at)
     VALUES ($1, to_timestamp($2))
     ON CONFLICT (jti) DO NOTHING`,
    [claims.jti, claims.exp]
  );

  // Best-effort pruning of rows whose tokens have expired on their own.
  pool.query('DELETE FROM revoked_sessions WHERE expires_at < NOW()').catch(() => {});
}
