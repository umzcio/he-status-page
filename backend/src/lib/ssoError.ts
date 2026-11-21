// Codes for the ?error= parameter the SSO callbacks put on the admin page URL.
// The page shows fixed text for each code (frontend/src/lib/ssoErrors.ts) and
// never displays text taken from the URL, so a crafted link can't put words
// on the sign-in page. Keep the two lists in sync (a test checks they match).
export const SSO_ERROR_CODES = ['not_authorized', 'expired', 'failed', 'unavailable'] as const;
export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

export function ssoErrorUrl(adminPath: string, code: SsoErrorCode): string {
  return `${adminPath}?error=${code}`;
}
