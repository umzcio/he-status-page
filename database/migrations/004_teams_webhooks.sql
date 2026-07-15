-- Teams Webhook Notifications
CREATE TABLE IF NOT EXISTS teams_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    webhook_url TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    category_filter JSONB DEFAULT NULL,  -- null = all categories, ["core","academic"] = specific
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID REFERENCES teams_webhooks(id) ON DELETE SET NULL,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    status_from VARCHAR(50),
    status_to VARCHAR(50),
    success BOOLEAN NOT NULL,
    error_message TEXT,
    response_time_ms INTEGER,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_webhook_logs_webhook ON teams_webhook_logs(webhook_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_teams_webhook_logs_time ON teams_webhook_logs(sent_at DESC);
