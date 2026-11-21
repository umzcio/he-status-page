import type { Request, Response, NextFunction } from 'express';

// Cross-site request rejection for anonymous endpoints.
//
// Any page a visitor opens can make their browser send requests to this API:
// form posts, <img>/<script> loads and `no-cors` fetches need no permission.
// Those requests can change state (subscribe someone, spend the visitor's
// rate-limit budget) while hiding who really sent them. Browsers label every
// request with Sec-Fetch-Site / Sec-Fetch-Mode (Fetch Metadata), which a page
// cannot forge.

function isCrossSite(req: Request): boolean {
  return req.get('sec-fetch-site') === 'cross-site';
}

/**
 * For first-party JSON endpoints (login, code exchange, subscribe): refuse
 * cross-site requests, and accept only JSON bodies. A cross-site page cannot
 * send `Content-Type: application/json` without a CORS preflight, which the
 * CORS allowlist refuses, so the JSON rule also covers browsers that don't
 * send Fetch Metadata.
 */
export function requireFirstPartyJson(req: Request, res: Response, next: NextFunction): void {
  if (isCrossSite(req)) {
    res.status(403).json({ error: 'Cross-site requests are not allowed' });
    return;
  }
  if (req.method !== 'GET' && !req.is('application/json')) {
    res.status(415).json({ error: 'Content-Type must be application/json' });
    return;
  }
  next();
}

/**
 * For SSO entry points (login redirects, IdP callbacks, metadata): other sites
 * may reach them only by top-level navigation, which is how an IdP sends the
 * user back and how a sign-in link works. Background requests from other
 * sites are refused before they reach the rate limiter, so a page can't burn
 * a visitor's sign-in budget.
 */
export function allowCrossSiteNavigationOnly(req: Request, res: Response, next: NextFunction): void {
  if (isCrossSite(req) && req.get('sec-fetch-mode') !== 'navigate') {
    res.status(403).json({ error: 'Cross-site requests are not allowed' });
    return;
  }
  next();
}
