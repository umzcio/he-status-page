import path from 'path';
import dotenv from 'dotenv';
import type { SignOptions } from 'jsonwebtoken';

// Load environment variables from the repo-root .env as early as possible.
// This module is imported (transitively) before index.ts runs its own
// dotenv.config(), so we load here to guarantee env vars are present before
// the required-secret validation below executes. dotenv does not override
// variables already set in the process environment.
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// Centralized runtime configuration with fail-fast validation.
// Reading this module validates required secrets at startup and throws a
// clear error if they are missing/weak — regardless of NODE_ENV.

function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET environment variable must be set and at least 16 characters long. ' +
        'Refusing to start with a missing or insecure JWT secret.'
    );
  }
  return secret;
}

// Signing secret for admin/session JWTs. Evaluated (and validated) at import time.
export const JWT_SECRET: string = loadJwtSecret();

// JWT lifetime. Documented via JWT_EXPIRES_IN; defaults to 7 days.
export const JWT_EXPIRES_IN: SignOptions['expiresIn'] =
  (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'];
