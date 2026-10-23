import { createGuardedHttpClient } from '@he-status/shared';

// Response-size caps. Bodies are streamed and the request is aborted once the
// cap is passed, so a hostile or broken upstream can't make the poller buffer
// an arbitrarily large document; the check is recorded as failed instead.
// Status endpoints return small JSON documents.
export const MAX_ENDPOINT_RESPONSE_BYTES = 2 * 1024 * 1024;
// Vendor-wide feeds (e.g. Google's incident history) are much larger.
export const MAX_VENDOR_FEED_BYTES = 25 * 1024 * 1024;

// HTTP client for admin-configured status endpoints. Every connection it makes,
// including retries and each redirect hop, is checked against the SSRF policy
// at connect time (see shared/src/urlGuard.ts). Fixed vendor URLs (AWS, Apple,
// Google, Microsoft feeds) don't need it; anything built from
// status_api_endpoint does.
export const endpointHttp = createGuardedHttpClient({ maxContentLength: MAX_ENDPOINT_RESPONSE_BYTES });
