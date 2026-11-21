-- v1.0.0 published raw fetch errors (endpoint URLs, hostnames, IP:port pairs,
-- LibreNMS device names) in automated status text and auto-created incidents.
-- Current code writes only fixed messages; replace what older versions left
-- in rows the public routes still serve. Text written by admins is untouched.

CREATE TEMP TABLE legacy_error_patterns (pattern TEXT) ON COMMIT DROP;
INSERT INTO legacy_error_patterns VALUES
  ('Service unreachable: '),
  ('Failed to fetch '),
  ('ECONN'), ('ENOTFOUND'), ('EAI_AGAIN'), ('ETIMEDOUT'), ('EHOSTUNREACH'), ('ENETUNREACH'),
  ('getaddrinfo'), ('socket hang up'), ('Request failed with status code'),
  ('certificate'), ('self-signed'), ('self signed'), ('Endpoint blocked by SSRF guard'),
  (' not found in LibreNMS'), ('LibreNMS credentials');

CREATE OR REPLACE FUNCTION pg_temp.is_legacy_error(t TEXT) RETURNS BOOLEAN AS $$
  SELECT t IS NOT NULL AND EXISTS (
    SELECT 1 FROM legacy_error_patterns p WHERE position(lower(p.pattern) IN lower(t)) > 0
  )
  -- "timeout of 10000ms exceeded" and similar
  OR t ~* 'timeout of [0-9]+ ?ms';
$$ LANGUAGE sql;

UPDATE service_status
   SET status_message = 'Service unreachable'
 WHERE status_source = 'automated' AND pg_temp.is_legacy_error(status_message);

UPDATE status_history
   SET status_message = 'Service unreachable'
 WHERE status_source = 'automated' AND pg_temp.is_legacy_error(status_message);

UPDATE incidents
   SET description = 'Service unreachable'
 WHERE auto_created = true AND pg_temp.is_legacy_error(description);

-- Automated timeline entries (no author). Keep an "Impact updated: now X."
-- prefix and drop the raw detail after it.
UPDATE incident_updates iu
   SET message = CASE
         WHEN iu.message ~ '^Impact updated: now [a-z]+\.'
           THEN substring(iu.message FROM '^(Impact updated: now [a-z]+\.)') || ' Service unreachable'
         ELSE 'Service unreachable'
       END
  FROM incidents i
 WHERE iu.incident_id = i.id
   AND i.auto_created = true
   AND iu.created_by_user_id IS NULL
   AND pg_temp.is_legacy_error(iu.message);

-- Overrides that already ended kept their actor; it is no longer meaningful.
UPDATE service_status
   SET override_by_user_id = NULL, override_at = NULL, override_reason = NULL
 WHERE override_active = false
   AND (override_by_user_id IS NOT NULL OR override_at IS NOT NULL OR override_reason IS NOT NULL);
