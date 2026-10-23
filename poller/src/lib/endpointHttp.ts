import { createGuardedHttpClient } from '@he-status/shared';

// Response-size caps. Bodies are streamed and the request is aborted once the
// cap is passed, so a hostile or broken upstream can't make the poller buffer
// an arbitrarily large document; the check is recorded as failed instead.
// Status endpoints return small JSON documents.
export const MAX_ENDPOINT_RESPONSE_BYTES = 2 * 1024 * 1024;
// Vendor-wide feeds (e.g. Google's incident history) are much larger.
export const MAX_VENDOR_FEED_BYTES = 25 * 1024 * 1024;

// Wall-clock budget for one request, start to last body byte. axios' `timeout`
// only covers inactivity, so without this a slowly trickled body never ends.
// Pass `signal: fetchDeadline()` on any request not made through endpointHttp.
export const FETCH_DEADLINE_MS = 30_000;
export function fetchDeadline(): AbortSignal {
  return AbortSignal.timeout(FETCH_DEADLINE_MS);
}

// HTTP client for admin-configured status endpoints. Every connection it makes,
// including retries and each redirect hop, is checked against the SSRF policy
// at connect time (see shared/src/urlGuard.ts). Fixed vendor URLs (AWS, Apple,
// Google, Microsoft feeds) don't need it; anything built from
// status_api_endpoint does.
export const endpointHttp = createGuardedHttpClient({
  maxContentLength: MAX_ENDPOINT_RESPONSE_BYTES,
  deadlineMs: FETCH_DEADLINE_MS,
});
