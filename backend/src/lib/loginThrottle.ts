import type { Options } from 'express-rate-limit';
import rateLimit from 'express-rate-limit';
import { PgRateLimitStore } from './pgRateLimitStore';
import { clientKey } from './clientKey';

// Per-account throttling for POST /api/admin/login.
//
// The per-IP authLimiter in index.ts caps how fast one client can try. On top
// of it:
//
//  - accountClientLimiter: hard cap on FAILED attempts per (account, client).
//    One client hammering one account is blocked; the owner logging in from
//    anywhere else is not.
//  - a per-account delay: once an account has had ACCOUNT_DELAY_THRESHOLD
//    failures in the window (from any address), every further attempt for it
//    waits before the password is checked, doubling up to MAX_ACCOUNT_DELAY_MS.
//    This slows distributed guessing without ever refusing the owner: a correct
//    password still signs in, just more slowly. (A hard per-account cap would
//    let anyone lock an admin out by failing on purpose.)

const WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_DELAY_THRESHOLD = 10;
export const MAX_ACCOUNT_DELAY_MS = 10_000;

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

const accountFailureStore = new PgRateLimitStore('login_acct');
accountFailureStore.init({ windowMs: WINDOW_MS } as Options);

export function accountDelayMs(failures: number): number {
  if (failures < ACCOUNT_DELAY_THRESHOLD) return 0;
  return Math.min(1000 * 2 ** (failures - ACCOUNT_DELAY_THRESHOLD), MAX_ACCOUNT_DELAY_MS);
}

// Indirection so tests can observe/skip the wait.
export const timing = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** Wait out the account's current delay, if any. Call before checking the password. */
export async function applyAccountDelay(email: string): Promise<void> {
  const key = normalizeLoginEmail(email);
  if (!key) return;
  const current = await accountFailureStore.get(key);
  const delay = accountDelayMs(current?.totalHits ?? 0);
  if (delay > 0) await timing.sleep(delay);
}

export async function recordAccountFailure(email: string): Promise<void> {
  const key = normalizeLoginEmail(email);
  if (key) await accountFailureStore.increment(key);
}
