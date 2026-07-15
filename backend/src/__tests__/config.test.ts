import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// backend/src/lib/config.ts validates JWT_SECRET at module-import time (fail-fast).
// Because the validation runs on import, we must reset the module registry and
// re-import dynamically for each scenario so the top-level check re-executes
// against the process.env we've set up for that test.
//
// config.ts also calls dotenv.config() against the repo-root .env. There is no
// .env file in this repo (only .env.example), so dotenv silently no-ops and
// never overwrites the process.env values set below — confirmed by inspecting
// the repo root and by these tests passing deterministically.

describe('backend/src/lib/config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    await expect(import('../lib/config')).rejects.toThrow(
      /JWT_SECRET environment variable must be set/
    );
  });

  it('throws when JWT_SECRET is shorter than 16 characters', async () => {
    process.env.JWT_SECRET = 'short-secret';
    expect(process.env.JWT_SECRET.length).toBeLessThan(16);
    await expect(import('../lib/config')).rejects.toThrow(
      /JWT_SECRET environment variable must be set and at least 16 characters long/
    );
  });

  it('exports JWT_SECRET when a valid (>=16 char) value is set', async () => {
    process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough';
    const { JWT_SECRET } = await import('../lib/config');
    expect(JWT_SECRET).toBe('a-valid-secret-that-is-long-enough');
  });

  it('defaults JWT_EXPIRES_IN to 7d when unset', async () => {
    process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough';
    delete process.env.JWT_EXPIRES_IN;
    const { JWT_EXPIRES_IN } = await import('../lib/config');
    expect(JWT_EXPIRES_IN).toBe('7d');
  });

  it('honors a custom JWT_EXPIRES_IN when set', async () => {
    process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough';
    process.env.JWT_EXPIRES_IN = '1h';
    const { JWT_EXPIRES_IN } = await import('../lib/config');
    expect(JWT_EXPIRES_IN).toBe('1h');
  });
});
