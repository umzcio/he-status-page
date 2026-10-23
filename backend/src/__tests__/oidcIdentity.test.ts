import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../db/connection', () => {
  const pool = { query: vi.fn() };
  return { __esModule: true, default: pool, pool };
});

import { resolveOidcIdentity } from '../lib/oidc';

const base = { iss: 'https://idp.example.edu', sub: 'subject-1', name: 'Pat Admin' };

describe('resolveOidcIdentity', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns the verified email with the issuer and subject', () => {
    expect(resolveOidcIdentity({ ...base, email: 'admin@example.edu', email_verified: true }, {})).toEqual({
      email: 'admin@example.edu',
      name: 'Pat Admin',
      issuer: 'https://idp.example.edu',
      subject: 'subject-1',
    });
  });

  it('rejects an email the IdP has not verified', () => {
    expect(() => resolveOidcIdentity({ ...base, email: 'admin@example.edu', email_verified: false }, {})).toThrow(
      /not verified/
    );
    expect(() => resolveOidcIdentity({ ...base, email: 'admin@example.edu' }, {})).toThrow(/not verified/);
    // A string "true" is not the boolean the spec requires.
    expect(() => resolveOidcIdentity({ ...base, email: 'admin@example.edu', email_verified: 'true' }, {})).toThrow(
      /not verified/
    );
  });

  it('does not fall back to preferred_username unless configured', () => {
    expect(() => resolveOidcIdentity({ ...base, preferred_username: 'admin@example.edu' }, {})).toThrow(
      /"email" claim/
    );
  });

  it('uses an operator-chosen claim such as preferred_username', () => {
    const id = resolveOidcIdentity(
      { ...base, preferred_username: 'admin@example.edu' },
      { OIDC_EMAIL_CLAIM: 'preferred_username' }
    );
    expect(id.email).toBe('admin@example.edu');
  });

  it('allows unverified email only when the operator opts out of the check', () => {
    const id = resolveOidcIdentity(
      { ...base, email: 'admin@example.edu' },
      { OIDC_REQUIRE_EMAIL_VERIFIED: 'false' }
    );
    expect(id.email).toBe('admin@example.edu');
  });

  it('requires iss and sub', () => {
    expect(() => resolveOidcIdentity({ email: 'a@example.edu', email_verified: true, iss: base.iss }, {})).toThrow(
      /iss or sub/
    );
  });
});
