-- 006: Service Dependencies
-- Tracks which services depend on other services (e.g. Zoom depends on SSO)
-- When a dependency is non-operational, dependent services show a warning

CREATE TABLE IF NOT EXISTS service_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    depends_on_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(service_id, depends_on_service_id),
    CHECK (service_id <> depends_on_service_id)
);

CREATE INDEX IF NOT EXISTS idx_service_dependencies_service ON service_dependencies(service_id);
CREATE INDEX IF NOT EXISTS idx_service_dependencies_depends_on ON service_dependencies(depends_on_service_id);
