CREATE TABLE IF NOT EXISTS planned_maintenances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    series_id       UUID NOT NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end   TIMESTAMPTZ NOT NULL,
    recurrence_type VARCHAR(20) NOT NULL DEFAULT 'once',
    status          VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    activated_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,

    CONSTRAINT chk_pm_recurrence CHECK (recurrence_type IN ('once', 'daily', 'weekly', 'monthly')),
    CONSTRAINT chk_pm_status     CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
    CONSTRAINT chk_pm_order      CHECK (scheduled_end > scheduled_start)
);

CREATE INDEX IF NOT EXISTS idx_pm_activate
    ON planned_maintenances (status, scheduled_start, scheduled_end)
    WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_pm_complete
    ON planned_maintenances (status, scheduled_end)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_pm_service
    ON planned_maintenances (service_id, status, scheduled_start);

CREATE INDEX IF NOT EXISTS idx_pm_series
    ON planned_maintenances (series_id, scheduled_start);
