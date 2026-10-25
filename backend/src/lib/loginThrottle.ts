import type { Options } from 'express-rate-limit';
import rateLimit from 'express-rate-limit';
import { PgRateLimitStore } from './pgRateLimitStore';
import { clientKey } from './clientKey';

// Password login controls for POST /api/admin/login.
//
// Password login is OFF unless PASSWORD_LOGIN_ENABLED=true. The admin UI signs
// in through SSO only, and scripts should use API keys, so for most
// deployments the endpoint is pure attack surface.
//
// When it is enabled:
//  - the per-IP authLimiter (index.ts) caps how fast one client can try;
//  - accountClientLimiter caps FAILED attempts per (account, client);
//  - every account has a fixed budget of password checks per window, claimed
//    BEFORE the password is checked so parallel requests count. However many
//    addresses an attacker has, an account sees at most
//    ACCOUNT_CHECK_BUDGET checks per window. Past the budget a request must
//    carry a valid Turnstile token (when Turnstile is configured), which is
//    how the real owner gets through while an account is under attack.

const WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_CHECK_BUDGET = 10;

export function passwordLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PASSWORD_LOGIN_ENABLED === 'true';
}

export function normalizeLoginEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export const accountClientLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${normalizeLoginEmail(req.body?.email)}|${clientKey(req.ip)}`,
  message: { error: 'Too many login attempts, please try again later' },
  store: new PgRateLimitStore('login_acct_ip'),
});

const accountCheckStore = new PgRateLimitStore('login_acct');
accountCheckStore.init({ windowMs: WINDOW_MS } as Options);

/**
 * Claim one password check for this account. Returns false once the account's
 * budget for the current window is spent. The claim is an atomic increment, so
 * concurrent requests can't all slip under the budget.
 */
export async function claimAccountCheck(email: string): Promise<boolean> {
  const { totalHits } = await accountCheckStore.increment(normalizeLoginEmail(email));
  return totalHits <= ACCOUNT_CHECK_BUDGET;
}
