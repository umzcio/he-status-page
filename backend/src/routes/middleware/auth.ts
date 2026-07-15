import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from '../../db/connection';
import { JWT_SECRET } from '../../lib/config';
import { SESSION_COOKIE } from '../../lib/authCookies';

interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  // How the request authenticated. CSRF is enforced only for 'cookie'.
  authVia?: 'cookie' | 'bearer' | 'apikey';
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // 1. Resolve a session JWT, preferring the HttpOnly cookie (not JS-readable,
  //    so immune to XSS token theft) and falling back to the Authorization
  //    header for programmatic Bearer clients.
  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const jwtToken = cookieToken || bearerToken;

  if (jwtToken) {
    try {
      const decoded = jwt.verify(jwtToken, JWT_SECRET) as AuthUser;

      // Load the user's CURRENT role/existence from the DB so demotion or
      // deletion takes effect immediately (rather than living for the token's
      // full lifetime). Falls back to 401 if the user no longer exists.
      const result = await pool.query(
        'SELECT id, email, role FROM users WHERE id = $1',
        [decoded.id]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      const row = result.rows[0];
      req.user = { id: row.id, email: row.email, role: row.role };
      req.authVia = cookieToken ? 'cookie' : 'bearer';
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // 2. Try X-API-Key
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey?.startsWith('hsp_')) {
    const hex = apiKey.slice(4); // strip "hsp_"
    const prefix = hex.slice(0, 8);

    try {
      const result = await pool.query(
        `SELECT ak.id AS key_id, ak.key_hash, ak.expires_at, u.id, u.email, u.role
         FROM api_keys ak
         JOIN users u ON u.id = ak.user_id
         WHERE ak.key_prefix = $1 AND ak.revoked_at IS NULL`,
        [prefix]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const row = result.rows[0];

      // Check expiration
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return res.status(401).json({ error: 'API key has expired' });
      }

      const valid = await bcrypt.compare(apiKey, row.key_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      req.user = { id: row.id, email: row.email, role: row.role };
      req.authVia = 'apikey';

      // Fire-and-forget: update last_used_at
      pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.key_id]).catch(() => {});

      return next();
    } catch (error) {
      console.error('API key auth error:', error);
      return res.status(500).json({ error: 'Authentication error' });
    }
  }

  return res.status(401).json({ error: 'No authentication provided' });
};

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
