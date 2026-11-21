// Password rules shared by the user API, the seed script and login.

export const MIN_PASSWORD_LENGTH = 12;

// Placeholders that have shipped in docs or examples. They are never accepted
// as a password, and a login presenting one is refused, so an account seeded
// from an unedited example config can't be signed in to with it.
const KNOWN_PLACEHOLDERS = new Set(['changeme', 'change-me', 'change-me-in-production', 'password', 'admin']);

export function isKnownPlaceholderPassword(password: unknown): boolean {
  return typeof password === 'string' && KNOWN_PLACEHOLDERS.has(password.trim().toLowerCase());
}

/** Returns a reason the password is unacceptable, or null if it is fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (isKnownPlaceholderPassword(password)) {
    return 'Password is a well-known placeholder; choose another';
  }
  return null;
}
