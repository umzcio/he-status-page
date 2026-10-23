import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { JWT_SECRET } from './config';
import { sessionCookieOptions } from './authCookies';
import { PgRateLimitStore } from './pgRateLimitStore';

// Per-account throttling for POST /api/admin/login.
//
// The per-IP authLimiter in index.ts caps how fast one client can try, but on
// its own it puts no ceiling on guesses against a single account from many
// addresses. Two further limiters count FAILED attempts only (successful
// logins are refunded):
//
//  - accountClientLimiter: failures per (account, client IP).
//  - accountLimiter: failures per account, from any address. To stop an
//    attacker from using this to lock the real admin out, a browser that has
//    signed in to the account before carries a "device" cookie for it and is
//    exempt from this limiter (it still counts against the other two).

const WINDOW_MS = 15 * 60 * 1000;
const DEVICE_TOKEN_TTL = '365d';
export const DEVICE_COOKIE = 'hsp_device';

export function normalizeLoginEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function issueDeviceToken(email: string): string {
  return jwt.sign({ typ: 'login_device', email: normalizeLoginEmail(email) }, JWT_SECRET, {
    expiresIn: DEVICE_TOKEN_TTL,
  });
}

export function deviceTokenMatches(token: unknown, email: unknown): boolean {
  const normalized = normalizeLoginEmail(email);
  if (typeof token !== 'string' || !normalized) return false;
  try {
    const claims = jwt.verify(token, JWT_SECRET) as { typ?: string; email?: string };
    return claims.typ === 'login_device' && claims.email === normalized;
  } catch {
    return false;
  }
}

// Called after a successful password login.
export function setDeviceCookie(res: Response, email: string): void {
  res.cookie(DEVICE_COOKIE, issueDeviceToken(email), {
    ...sessionCookieOptions(),
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

function loginEmail(req: Request): string {
  return normalizeLoginEmail(req.body?.email);
}

export const accountClientLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${loginEmail(req)}|${req.ip}`,
  message: { error: 'Too many login attempts, please try again later' },
  store: new PgRateLimitStore('login_acct_ip'),
});

export const accountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => loginEmail(req),
  skip: (req) => deviceTokenMatches(req.cookies?.[DEVICE_COOKIE], req.body?.email),
  message: { error: 'Too many login attempts, please try again later' },
  store: new PgRateLimitStore('login_acct'),
});
