import pool from '../db/connection';
import { notifyTeams } from './teams';
import logger from './logger';

interface MaintenanceRow {
  id: string;
  service_id: string;
  series_id: string;
  title: string;
  description: string | null;
  scheduled_start: Date;
  scheduled_end: Date;
  recurrence_type: 'once' | 'daily' | 'weekly' | 'monthly';
  recurrence_day_of_week: number | null;
  recurrence_day_of_month: number | null;
  announce: boolean;
  service_name: string;
  category_slug: string;
  current_status: string;
}

export function nextOccurrenceTime(row: MaintenanceRow): { start: Date; end: Date } {
  const durationMs = row.scheduled_end.getTime() - row.scheduled_start.getTime();
  const d = row.scheduled_start;

  // All recurrence math is done with LOCAL date components (getFullYear/getMonth/
  // getDate/getHours/...) and local Date construction. This keeps the wall-clock
  // time of a recurring window constant across daylight-saving transitions —
  // adding fixed 24h/7d blocks of milliseconds (the previous approach) shifts the
  // wall-clock hour by the DST offset. The poller's local timezone is the single
  // reference used for every recurrence type, matching how scheduled_start
  // (TIMESTAMPTZ) is compared against NOW() everywhere else.
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const h = d.getHours();
  const min = d.getMinutes();
  const s = d.getSeconds();

  let start: Date;
  switch (row.recurrence_type) {
    case 'daily':
      start = new Date(y, m, day + 1, h, min, s);
      break;
    case 'weekly':
      start = new Date(y, m, day + 7, h, min, s);
      break;
    case 'monthly': {
      // Use the stored target day, falling back to the current occurrence's day
      const targetDay = row.recurrence_day_of_month ?? day;
      let ny = y;
      let nm = m + 1;
      if (nm > 11) { nm = 0; ny += 1; }
      // Clamp the target day to the destination month's length FIRST, so a 31st
      // recurrence lands on Feb 28/29 rather than rolling over into March.
      const daysInMonth = new Date(ny, nm + 1, 0).getDate();
      start = new Date(ny, nm, Math.min(targetDay, daysInMonth), h, min, s);
      break;
    }
    default:
      throw new Error(`Non-recurring maintenance passed to nextOccurrenceTime`);
  }

  return { start, end: new Date(start.getTime() + durationMs) };
}

const SELECT_FIELDS = `
  pm.id, pm.service_id, pm.series_id, pm.title, pm.description,
  pm.scheduled_start, pm.scheduled_end, pm.recurrence_type,
  pm.recurrence_day_of_week, pm.recurrence_day_of_month, pm.announce,
  s.name AS service_name,
  COALESCE(c.slug, s.category) AS category_slug,
  ss.status AS current_status
FROM planned_maintenances pm
JOIN services s ON pm.service_id = s.id
LEFT JOIN categories c ON s.category_id = c.id
LEFT JOIN service_status ss ON pm.service_id = ss.service_id
`;

export async function activateDueMaintenances(): Promise<void> {
  const result = await pool.query<MaintenanceRow>(`
    SELECT ${SELECT_FIELDS}
    WHERE pm.status = 'scheduled'
      AND pm.scheduled_start <= NOW()
      AND pm.scheduled_end > NOW()
  `);

  for (const row of result.rows) {
    const log = logger.child({ maintenanceId: row.id, service: row.service_name });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        UPDATE status_history
        SET ended_at = NOW(),
            duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at))/60
        WHERE service_id = $1 AND ended_at IS NULL
      `, [row.service_id]);

      const maintenanceMessage = row.description
        ? `${row.title}: ${row.description}`
        : row.title;
      const source = row.announce ? 'manual_override' : 'silent_maintenance';

      await client.query(`
        INSERT INTO service_status (
          service_id, status, status_source, status_message,
          override_active, override_at, override_reason, override_expires_at, detected_at
        )
        VALUES ($1, 'maintenance', $5, $2, true, NOW(), $3, $4, NOW())
        ON CONFLICT (service_id) DO UPDATE SET
          status = 'maintenance',
          status_source = $5,
          status_message = $2,
          override_active = true,
          override_at = NOW(),
          override_reason = $3,
          override_expires_at = $4,
          detected_at = NOW()
      `, [row.service_id, maintenanceMessage, `Planned maintenance: ${row.title}`, row.scheduled_end, source]);

      await client.query(`
        INSERT INTO status_history (service_id, status, status_source, status_message, started_at)
        VALUES ($1, 'maintenance', $3, $2, NOW())
      `, [row.service_id, maintenanceMessage, source]);

      await client.query(`
        UPDATE planned_maintenances SET status = 'active', activated_at = NOW()
        WHERE id = $1
      `, [row.id]);

      await client.query('COMMIT');
      log.info('Planned maintenance activated');

      notifyTeams({
        serviceId: row.service_id,
        serviceName: row.service_name,
        categorySlug: row.category_slug,
        oldStatus: row.current_status || 'unknown',
        newStatus: 'maintenance',
        statusMessage: maintenanceMessage,
        overrideInfo: { userName: 'Planned Maintenance', reason: row.title },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      log.error({ err }, 'Failed to activate planned maintenance');
    } finally {
      client.release();
    }
  }
}

export async function completeExpiredMaintenances(): Promise<void> {
  const result = await pool.query<MaintenanceRow>(`
    SELECT ${SELECT_FIELDS}
    WHERE pm.status = 'active'
      AND pm.scheduled_end <= NOW()
  `);

  for (const row of result.rows) {
    const log = logger.child({ maintenanceId: row.id, service: row.service_name });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        UPDATE status_history
        SET ended_at = NOW(),
            duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at))/60
        WHERE service_id = $1 AND ended_at IS NULL
      `, [row.service_id]);

      await client.query(`
        UPDATE service_status SET
          status = 'unknown',
          status_message = 'Maintenance complete — awaiting next status check',
          override_active = false,
          override_at = NULL,
          override_reason = NULL,
          override_expires_at = NULL,
          status_source = $2,
          detected_at = NOW(),
          last_checked_at = NOW()
        WHERE service_id = $1
      `, [row.service_id, row.announce ? 'automated' : 'silent_maintenance_complete']);

      await client.query(`
        INSERT INTO status_history (service_id, status, status_source, status_message, started_at)
        VALUES ($1, 'unknown', 'automated', 'Maintenance complete — awaiting next status check', NOW())
      `, [row.service_id]);

      await client.query(`
        UPDATE planned_maintenances SET status = 'completed', completed_at = NOW()
        WHERE id = $1
      `, [row.id]);

      if (row.recurrence_type !== 'once') {
        await scheduleNextOccurrence(client, row);
      }

      await client.query('COMMIT');
      log.info('Planned maintenance completed');

      notifyTeams({
        serviceId: row.service_id,
        serviceName: row.service_name,
        categorySlug: row.category_slug,
        oldStatus: 'maintenance',
        newStatus: 'unknown',
        statusMessage: 'Scheduled maintenance complete — resuming automated monitoring.',
        overrideInfo: { userName: 'System', isRemoval: true },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      log.error({ err }, 'Failed to complete planned maintenance');
    } finally {
      client.release();
    }
  }
}

// Handle maintenance windows that were missed while the poller was down.
// These stay in 'scheduled' state past their end time and would never advance
// to 'active', so the next recurring occurrence would never be created.
export async function completeMissedMaintenances(): Promise<void> {
  const result = await pool.query<MaintenanceRow>(`
    SELECT ${SELECT_FIELDS}
    WHERE pm.status = 'scheduled'
      AND pm.scheduled_end <= NOW()
  `);

  for (const row of result.rows) {
    const log = logger.child({ maintenanceId: row.id, service: row.service_name });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mark completed at the scheduled end (window was missed, no override was set)
      await client.query(`
        UPDATE planned_maintenances SET status = 'completed', completed_at = $2
        WHERE id = $1
      `, [row.id, row.scheduled_end]);

      if (row.recurrence_type !== 'once') {
        await scheduleNextOccurrence(client, row);
      }

      await client.query('COMMIT');
      log.info('Missed maintenance window marked complete');
    } catch (err) {
      await client.query('ROLLBACK');
      log.error({ err }, 'Failed to handle missed maintenance');
    } finally {
      client.release();
    }
  }
}

async function scheduleNextOccurrence(client: any, row: MaintenanceRow): Promise<void> {
  const { start, end } = nextOccurrenceTime(row);
  await client.query(`
    INSERT INTO planned_maintenances
      (service_id, series_id, title, description,
       scheduled_start, scheduled_end, recurrence_type,
       recurrence_day_of_week, recurrence_day_of_month, announce, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled')
  `, [
    row.service_id, row.series_id, row.title, row.description,
    start, end, row.recurrence_type,
    row.recurrence_day_of_week ?? null, row.recurrence_day_of_month ?? null,
    row.announce,
  ]);
  logger.info({ maintenanceId: row.id, nextStart: start }, 'Next recurring maintenance scheduled');
}
