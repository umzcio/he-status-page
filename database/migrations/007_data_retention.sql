-- Migration 007: Data retention policies for unbounded tables
-- Adds functions and a retention log to prune old poller_logs and status_history

-- Table to track retention runs
CREATE TABLE IF NOT EXISTS retention_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ DEFAULT NOW(),
  poller_logs_deleted INTEGER DEFAULT 0,
  status_history_deleted INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0
);

-- Function to prune old data
-- poller_logs: retain 90 days
-- status_history: retain 365 days (completed records only)
CREATE OR REPLACE FUNCTION run_data_retention(
  poller_retention_days INTEGER DEFAULT 90,
  history_retention_days INTEGER DEFAULT 365
) RETURNS TABLE(poller_deleted BIGINT, history_deleted BIGINT) AS $$
DECLARE
  p_deleted BIGINT;
  h_deleted BIGINT;
  start_ts TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- Delete old poller_logs
  DELETE FROM poller_logs
  WHERE check_started_at < NOW() - (poller_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS p_deleted = ROW_COUNT;

  -- Delete old completed status_history records (keep open-ended records)
  DELETE FROM status_history
  WHERE ended_at IS NOT NULL
    AND ended_at < NOW() - (history_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS h_deleted = ROW_COUNT;

  -- Log the retention run
  INSERT INTO retention_log (poller_logs_deleted, status_history_deleted, duration_ms)
  VALUES (p_deleted, h_deleted, EXTRACT(MILLISECOND FROM clock_timestamp() - start_ts)::INTEGER);

  RETURN QUERY SELECT p_deleted, h_deleted;
END;
$$ LANGUAGE plpgsql;
