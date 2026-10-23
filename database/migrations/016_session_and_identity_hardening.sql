-- Session revocation, OIDC subject binding, and deletable users.
--
-- token_version: embedded in every session JWT as `tv`. authMiddleware rejects
-- a token whose tv no longer matches, so bumping it (password reset, "revoke
-- sessions") ends every outstanding session for that user at once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- oidc_issuer/oidc_subject: the IdP identity (iss + sub) an account is bound to
-- on its first verified OIDC login. Later OIDC logins must present the same
-- identity, so changing an e-mail address at the IdP cannot re-point an admin
-- row at a different person.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_issuer TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oidc_subject TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc_identity
  ON users (oidc_issuer, oidc_subject)
  WHERE oidc_subject IS NOT NULL;

-- revoked_sessions: individual session JWTs (by jti) revoked at logout. Rows
-- only need to live until the token would have expired anyway.
CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires ON revoked_sessions (expires_at);

-- Audit/history references to users had no ON DELETE rule, so any account that
-- had ever acted could not be deleted. Keep the history rows and null out the
-- actor instead.
ALTER TABLE service_status DROP CONSTRAINT IF EXISTS service_status_override_by_user_id_fkey;
ALTER TABLE service_status ADD CONSTRAINT service_status_override_by_user_id_fkey
  FOREIGN KEY (override_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE status_history DROP CONSTRAINT IF EXISTS status_history_triggered_by_user_id_fkey;
ALTER TABLE status_history ADD CONSTRAINT status_history_triggered_by_user_id_fkey
  FOREIGN KEY (triggered_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_created_by_user_id_fkey;
ALTER TABLE incidents ADD CONSTRAINT incidents_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE incident_updates DROP CONSTRAINT IF EXISTS incident_updates_created_by_user_id_fkey;
ALTER TABLE incident_updates ADD CONSTRAINT incident_updates_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE admin_logs DROP CONSTRAINT IF EXISTS admin_logs_user_id_fkey;
ALTER TABLE admin_logs ADD CONSTRAINT admin_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
