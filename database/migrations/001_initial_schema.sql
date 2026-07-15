-- UM IT Status Page - Initial Schema
-- PostgreSQL 16+

-- Users Table (must be created first, referenced by other tables)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) NOT NULL, -- 'super_admin', 'admin', 'viewer'
    hashed_password TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Services Table
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL, -- 'communication', 'learning', 'infrastructure'
    provider VARCHAR(100),
    status_api_endpoint TEXT,
    status_api_type VARCHAR(50), -- 'statuspage', 'custom', 'rss', etc.
    check_enabled BOOLEAN DEFAULT true,
    check_interval_minutes INTEGER DEFAULT 5,
    external_link TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Current Status Table (one row per service)
CREATE TABLE IF NOT EXISTS service_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL, -- 'operational', 'degraded', 'outage', 'maintenance', 'unknown'
    status_source VARCHAR(50) NOT NULL, -- 'automated', 'manual_override'
    status_message TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ DEFAULT NOW(),
    override_active BOOLEAN DEFAULT false,
    override_by_user_id UUID REFERENCES users(id),
    override_at TIMESTAMPTZ,
    override_reason TEXT,
    override_expires_at TIMESTAMPTZ,
    UNIQUE(service_id)
);

-- Status History Table
CREATE TABLE IF NOT EXISTS status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    status_source VARCHAR(50) NOT NULL,
    status_message TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_minutes INTEGER,
    triggered_by_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_history ON status_history (service_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_timeline ON status_history (started_at DESC);

-- Incidents Table
CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(50) NOT NULL, -- 'minor', 'major', 'critical'
    status VARCHAR(50) NOT NULL, -- 'investigating', 'identified', 'monitoring', 'resolved'
    source VARCHAR(50) NOT NULL, -- 'automated', 'manual'
    created_by_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_active_incidents ON incidents (service_id, resolved_at);

-- Incident Updates Table
CREATE TABLE IF NOT EXISTS incident_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    created_by_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_timeline ON incident_updates (incident_id, created_at DESC);

-- Poller Logs
CREATE TABLE IF NOT EXISTS poller_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    check_started_at TIMESTAMPTZ NOT NULL,
    check_completed_at TIMESTAMPTZ,
    success BOOLEAN NOT NULL,
    status_detected VARCHAR(50),
    raw_response JSONB,
    error_message TEXT,
    response_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_poller_service_time ON poller_logs (service_id, check_started_at DESC);

-- Subscriptions Table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    verification_token VARCHAR(255),
    verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    notification_preferences JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    unsubscribed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_active_subscriptions ON subscriptions (email, verified, unsubscribed_at);

-- Subscription Service Mapping
CREATE TABLE IF NOT EXISTS subscription_services (
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (subscription_id, service_id)
);

-- Notification Queue
CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL, -- 'status_change', 'incident_update', 'digest'
    status_change_from VARCHAR(50),
    status_change_to VARCHAR(50),
    subject TEXT,
    body TEXT,
    scheduled_for TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_notifications ON notification_queue (sent_at, scheduled_for);

-- Admin Action Logs
CREATE TABLE IF NOT EXISTS admin_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_user ON admin_logs (user_id, created_at DESC);
