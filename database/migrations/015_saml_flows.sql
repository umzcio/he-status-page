-- Transient SAML request-ID cache backing the node-saml CacheProvider.
--
-- When we build a SAML AuthnRequest (GET /api/admin/saml/login) node-saml
-- generates a unique request ID and hands it to our CacheProvider.saveAsync;
-- when the IdP POSTs the SAMLResponse back, node-saml validates the response's
-- InResponseTo against this cache (getAsync) and then removes it (removeAsync).
-- Persisting the request ID here (rather than in node-saml's default in-memory
-- cache) makes InResponseTo/replay validation survive process restarts and work
-- across multiple backend instances / load-balanced deployments.
--
-- Rows are consumed (deleted) on a successful callback and expire after ~10
-- minutes. The value node-saml stores is the request's IssueInstant; we can
-- reconstruct an equivalent, date-parseable value from created_at, so no
-- separate value column is required.
CREATE TABLE IF NOT EXISTS saml_flows (
  request_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL          -- NOW() + 10 min
);
CREATE INDEX IF NOT EXISTS idx_saml_flows_expires ON saml_flows(expires_at);
