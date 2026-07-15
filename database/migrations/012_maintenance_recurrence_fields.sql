ALTER TABLE planned_maintenances
  ADD COLUMN IF NOT EXISTS recurrence_day_of_week  SMALLINT,
  ADD COLUMN IF NOT EXISTS recurrence_day_of_month SMALLINT;

ALTER TABLE planned_maintenances
  DROP CONSTRAINT IF EXISTS chk_pm_dow,
  DROP CONSTRAINT IF EXISTS chk_pm_dom;

ALTER TABLE planned_maintenances
  ADD CONSTRAINT chk_pm_dow CHECK (recurrence_day_of_week  IS NULL OR recurrence_day_of_week  BETWEEN 0 AND 6),
  ADD CONSTRAINT chk_pm_dom CHECK (recurrence_day_of_month IS NULL OR recurrence_day_of_month BETWEEN 1 AND 31);
