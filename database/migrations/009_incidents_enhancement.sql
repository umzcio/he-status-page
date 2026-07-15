-- Enhance incidents table for full Atlassian-style incident management
-- The base table from 001_initial_schema.sql exists but is unused.
-- We add fields needed for public display, auto-creation, and admin workflow.

-- Add columns for richer incident tracking
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS impact VARCHAR(50);  -- 'minor', 'major', 'critical' (renamed from severity for clarity)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT true;  -- public visibility
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS auto_created BOOLEAN DEFAULT false;  -- distinguish auto vs manual incidents
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW();  -- explicit incident start (may differ from created_at)
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill: copy severity to impact if impact is null
UPDATE incidents SET impact = severity WHERE impact IS NULL AND severity IS NOT NULL;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_incidents_unresolved
  ON incidents (resolved_at, started_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_visible_recent
  ON incidents (visible, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_service_started
  ON incidents (service_id, started_at DESC);

-- Trigger to maintain updated_at
CREATE OR REPLACE FUNCTION incidents_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_incidents_updated_at ON incidents;
CREATE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW
  EXECUTE FUNCTION incidents_set_updated_at();

-- Trigger: when an incident_update is inserted, update the parent incident's status and updated_at
CREATE OR REPLACE FUNCTION incident_update_propagate()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE incidents
  SET status = NEW.status,
      updated_at = NOW(),
      resolved_at = CASE
        WHEN NEW.status = 'resolved' AND resolved_at IS NULL THEN NOW()
        ELSE resolved_at
      END
  WHERE id = NEW.incident_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_incident_update_propagate ON incident_updates;
CREATE TRIGGER trg_incident_update_propagate
  AFTER INSERT ON incident_updates
  FOR EACH ROW
  EXECUTE FUNCTION incident_update_propagate();
