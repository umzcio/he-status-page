import { createGuardedHttpClient } from '@he-status/shared';

// HTTP client for admin-configured status endpoints. Every connection it makes,
// including retries and each redirect hop, is checked against the SSRF policy
// at connect time (see shared/src/urlGuard.ts). Fixed vendor URLs (AWS, Apple,
// Google, Microsoft feeds) don't need it; anything built from
// status_api_endpoint does.
export const endpointHttp = createGuardedHttpClient();
