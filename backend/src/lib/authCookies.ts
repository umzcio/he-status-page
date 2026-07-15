import crypto from 'crypto';
import type { Response, CookieOptions } from 'express';
import { JWT_EXPIRES_IN } from './config';

// Cookie/header names for the HttpOnly session + double-submit CSRF token.
export const SESSION_COOKIE = 'hsp_session';
export const CSRF_COOKIE = 'hsp_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// Resolve the session cookie Max-Age (in seconds) from JWT_EXPIRES_IN so the
// cookie and the JWT it carries expire together. Supports a bare number
// (jsonwebtoken treats it as seconds) or a `<n><unit>` string (s/m/h/d, the
// units jsonwebtoken/ms accept). Defaults to 7 days.
function sessionMaxAgeSeconds(): number {
  const raw = JWT_EXPIRES_IN;
  if (typeof raw === 'number') return raw;
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(String(raw).trim());
  if (!match) return 7 * 24 * 60 * 60;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 60 * 60;
    case 'd':
      return n * 24 * 60 * 60;
    default:
      return n; // bare number = seconds
  }
}

// Secure flag: default true in production, false otherwise. COOKIE_SECURE
// overrides explicitly ("false" => insecure, for local http dev; anything else
// truthy => secure). Read at call time so tests/env changes take effect.
function cookieSecure(): boolean {
  const v = process.env.COOKIE_SECURE;
  if (v === undefined || v === '') {
    return process.env.NODE_ENV === 'production';
  }
  return v !== 'false';
}

// Flags shared by both cookies (evaluated at call time).
function baseCookieOptions(): CookieOptions {
  const options: CookieOptions = {
    path: '/',
    sameSite: 'lax',
    secure: cookieSecure(),
    maxAge: sessionMaxAgeSeconds() * 1000, // express expects milliseconds
  };
  const domain = process.env.COOKIE_DOMAIN;
  if (domain) options.domain = domain;
  return options;
}

// The session cookie is HttpOnly (never readable by JS — closes the XSS vector).
export function sessionCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), httpOnly: true };
}

// The CSRF cookie is intentionally NOT HttpOnly so the SPA can read it and echo
// it back in the X-CSRF-Token header (double-submit pattern).
export function csrfCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), httpOnly: false };
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Set the HttpOnly session cookie (the JWT) plus a fresh readable CSRF token.
export function issueSession(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookie(CSRF_COOKIE, generateCsrfToken(), csrfCookieOptions());
}

// Clear both cookies. Path/domain must match how they were set for the browser
// to actually remove them.
export function clearSession(res: Response): void {
  const base = baseCookieOptions();
  const clearOptions: CookieOptions = { path: base.path };
  if (base.domain) clearOptions.domain = base.domain;
  res.clearCookie(SESSION_COOKIE, clearOptions);
  res.clearCookie(CSRF_COOKIE, clearOptions);
}
