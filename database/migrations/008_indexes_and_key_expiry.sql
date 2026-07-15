-- Migration 008: Add missing FK indexes and API key expiration

-- Missing indexes on foreign key columns for query performance
CREATE INDEX IF NOT EXISTS idx_service_status_service ON service_status(service_id);
CREATE INDEX IF NOT EXISTS idx_service_status_override ON service_status(override_active) WHERE override_active = true;

CREATE INDEX IF NOT EXISTS idx_subscription_services_service ON subscription_services(service_id);

CREATE INDEX IF NOT EXISTS idx_notification_queue_pending
  ON notification_queue(scheduled_for) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_queue_subscription ON notification_queue(subscription_id);
CREATE INDEX IF NOT EXISTS idx_notification_queue_service ON notification_queue(service_id);

CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON incident_updates(incident_id);

CREATE INDEX IF NOT EXISTS idx_poller_logs_time ON poller_logs(check_started_at DESC);

-- API key expiration column
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient expiration checking
CREATE INDEX IF NOT EXISTS idx_api_keys_expiry ON api_keys(expires_at) WHERE revoked_at IS NULL;
