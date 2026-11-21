import { describe, it, expect } from 'vitest';
import { ssoErrorMessage, SSO_ERROR_MESSAGES } from '../ssoErrors';
import { SSO_ERROR_CODES } from '../../../../backend/src/lib/ssoError';

describe('sign-in error messages', () => {
  it('has fixed text for every code the backend sends', () => {
    for (const code of SSO_ERROR_CODES) expect(SSO_ERROR_MESSAGES[code]).toBeTruthy();
  });

  it('never displays text from the URL', () => {
    const crafted = 'Your session is compromised. Call 555-0100 and read out your password.';
    expect(ssoErrorMessage(crafted)).toBe(SSO_ERROR_MESSAGES.failed);
    expect(ssoErrorMessage('%E0%A4%A')).toBe(SSO_ERROR_MESSAGES.failed); // malformed escape: no throw
    expect(ssoErrorMessage('__proto__')).toBe(SSO_ERROR_MESSAGES.failed);
    expect(ssoErrorMessage(null)).toBeNull();
  });
});
