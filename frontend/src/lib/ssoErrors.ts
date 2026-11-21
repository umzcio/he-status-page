// Fixed sign-in error messages, keyed by the short codes the backend's SSO
// callbacks put in ?error= (backend/src/lib/ssoError.ts). Text from the URL is
// never displayed; an unknown code gets the generic message.
export const SSO_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Your account is not authorized for this site. Contact your administrator for access.',
  expired: 'Your sign-in took too long. Please try again.',
  failed: 'Sign-in failed. Please try again.',
  unavailable: 'The sign-in service is unavailable right now. Please try again later.',
};

export function ssoErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(SSO_ERROR_MESSAGES, code)
    ? SSO_ERROR_MESSAGES[code]
    : SSO_ERROR_MESSAGES.failed;
}
