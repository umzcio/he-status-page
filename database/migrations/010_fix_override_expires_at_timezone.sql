-- Historically this migration converted service_status.override_expires_at from
-- TIMESTAMP (no timezone) to TIMESTAMPTZ. As of the pre-release timestamp cleanup,
-- 001_initial_schema.sql now creates override_expires_at as TIMESTAMPTZ directly,
-- so on a fresh database the column is already the correct type by the time this
-- migration runs.
--
-- This is kept as a no-op (rather than deleted) so the migration numbering/bookkeeping
-- stays intact. The ALTER below is idempotent: converting a TIMESTAMPTZ column to
-- TIMESTAMPTZ is a harmless no-op, and it still corrects the type on any older
-- database that predates the 001 change.
ALTER TABLE service_status
  ALTER COLUMN override_expires_at TYPE TIMESTAMPTZ;
