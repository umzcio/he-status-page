-- One-time auth-code exchange + transient OIDC flow state.
--
-- auth_codes: short-lived, single-use opaque codes issued after a successful
-- SSO authentication (CAS or OIDC). The plaintext code travels in the post-auth
-- redirect URL; only its sha256 hash is ever stored here. The frontend exchanges
-- the code for a JWT via POST /api/admin/auth/exchange. This removes the JWT from
-- the redirect URL entirely.
CREATE TABLE IF NOT EXISTS auth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,      -- sha256 hex of the opaque code; never store the code
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);

-- oidc_flows: transient per-login OIDC state that must survive the round-trip to
-- the IdP and back (CSRF state, replay nonce, PKCE code_verifier). Stored
-- server-side (rather than in a cookie) so no cookie middleware is needed. Rows
-- are consumed atomically on callback and expire after ~10 minutes.
CREATE TABLE IF NOT EXISTS oidc_flows (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL          -- NOW() + 10 min
);
CREATE INDEX IF NOT EXISTS idx_oidc_flows_expires ON oidc_flows(expires_at);
