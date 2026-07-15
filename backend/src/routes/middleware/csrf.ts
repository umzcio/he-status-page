import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthRequest } from './auth';
import { CSRF_COOKIE, CSRF_HEADER } from '../../lib/authCookies';

// Methods that never mutate state and so never require a CSRF token.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Double-submit CSRF guard. Runs AFTER authMiddleware so req.authVia is set.
//
// It only enforces on cookie-authenticated requests: Bearer-token and API-key
// clients send their credentials in headers the browser never attaches
// automatically, so they are not CSRF-able and are skipped. Safe (read-only)
// methods are also skipped. For mutating cookie requests the header
// X-CSRF-Token must equal the hsp_csrf cookie (constant-time compare).
export function requireCsrf(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.authVia !== 'cookie') {
    return next();
  }
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const headerToken = req.get(CSRF_HEADER);
  const cookieToken = req.cookies?.[CSRF_COOKIE];

  if (!headerToken || !cookieToken) {
    res.status(403).json({ error: 'CSRF token invalid' });
    return;
  }

  const headerBuf = Buffer.from(headerToken);
  const cookieBuf = Buffer.from(cookieToken);

  // timingSafeEqual throws on length mismatch, so guard length first.
  if (headerBuf.length !== cookieBuf.length || !crypto.timingSafeEqual(headerBuf, cookieBuf)) {
    res.status(403).json({ error: 'CSRF token invalid' });
    return;
  }

  return next();
}
