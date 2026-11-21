-- Subscription hardening: one row per address, strict addresses, mail throttle,
-- and expiry of never-verified sign-ups.

-- One subscription per address. Keep the active, verified row if there is one,
-- otherwise the oldest.
DELETE FROM subscriptions WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY lower(email)
      ORDER BY (verified AND unsubscribed_at IS NULL) DESC, created_at ASC
    ) AS rn
    FROM subscriptions
  ) ranked
  WHERE rn > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_email_unique ON subscriptions (lower(email));

-- When the last verification mail went to this address (per-recipient throttle).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS verification_sent_at TIMESTAMPTZ;

-- Earlier versions accepted any address validator.js called an email, then
-- checked ".edu" on the raw string. Stop mailing stored addresses that the
-- current rule (a plain dot-atom address at a .edu domain) would refuse.
UPDATE subscriptions
   SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()), verified = false
 WHERE email !~* '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+edu$';

-- Retention also removes sign-ups that were never verified within 7 days.
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

  -- Delete sign-ups never verified within 7 days
  DELETE FROM subscriptions
  WHERE verified = false
    AND verified_at IS NULL
    AND created_at < NOW() - INTERVAL '7 days';

  -- Log the retention run
  INSERT INTO retention_log (poller_logs_deleted, status_history_deleted, duration_ms)
  VALUES (p_deleted, h_deleted, EXTRACT(MILLISECOND FROM clock_timestamp() - start_ts)::INTEGER);

  RETURN QUERY SELECT p_deleted, h_deleted;
END;
$$ LANGUAGE plpgsql;
