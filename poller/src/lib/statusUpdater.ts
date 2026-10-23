import pool from '../db/connection';

interface CurrentStatus {
  status: string;
  override_active: boolean;
  status_source: string;
}

export async function getCurrentStatus(serviceId: string): Promise<CurrentStatus | null> {
  const result = await pool.query(
    'SELECT status, override_active, status_source FROM service_status WHERE service_id = $1',
    [serviceId]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function updateServiceStatus(
  serviceId: string,
  status: string,
  message: string
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Re-check the override state under a row lock. An override can be activated
    // between the caller's pre-check (getCurrentStatus) and this transaction; if
    // that happened, the override now owns the current status and the open history
    // row. Writing here would overwrite the override and/or open a stray automated
    // history row, so skip all writes and commit nothing for this service.
    const lockRes = await client.query(
      'SELECT override_active FROM service_status WHERE service_id = $1 FOR UPDATE',
      [serviceId]
    );
    if (lockRes.rows.length > 0 && lockRes.rows[0].override_active) {
      await client.query('COMMIT'); // release the lock; no changes made
      return;
    }

    // End current history record
    await client.query(`
      UPDATE status_history
      SET ended_at = NOW(),
          duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at))/60
      WHERE service_id = $1 AND ended_at IS NULL
    `, [serviceId]);

    // Update service_status
    await client.query(`
      INSERT INTO service_status (
        service_id, status, status_source, status_message,
        detected_at, last_checked_at, override_active
      )
      VALUES ($1, $2, 'automated', $3, NOW(), NOW(), false)
      ON CONFLICT (service_id) DO UPDATE SET
        status = $2,
        status_source = 'automated',
        status_message = $3,
        detected_at = NOW(),
        last_checked_at = NOW()
      WHERE service_status.override_active = false
    `, [serviceId, status, message]);

    // Create new history record
    await client.query(`
      INSERT INTO status_history (
        service_id, status, status_source, status_message, started_at
      )
      VALUES ($1, $2, 'automated', $3, NOW())
    `, [serviceId, status, message]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateLastChecked(serviceId: string): Promise<void> {
  await pool.query(
    'UPDATE service_status SET last_checked_at = NOW() WHERE service_id = $1',
    [serviceId]
  );
}

// Cap on the provider data stored per check. Larger results are replaced by a
// marker with the original size and a short preview.
export const MAX_RAW_RESPONSE_CHARS = 64 * 1024;
const RAW_RESPONSE_PREVIEW_CHARS = 2048;

export function boundedRawResponse(data: unknown): string | null {
  if (data === undefined || data === null) return null;
  const json = JSON.stringify(data);
  if (json === undefined) return null;
  if (json.length <= MAX_RAW_RESPONSE_CHARS) return json;
  return JSON.stringify({
    truncated: true,
    original_length: json.length,
    preview: json.slice(0, RAW_RESPONSE_PREVIEW_CHARS),
  });
}

export async function logPollerCheck(data: {
  service_id: string;
  check_started_at: Date;
  check_completed_at: Date;
  success: boolean;
  status_detected?: string;
  raw_response?: any;
  error_message?: string;
  response_time_ms: number;
}): Promise<void> {
  await pool.query(`
    INSERT INTO poller_logs (
      service_id, check_started_at, check_completed_at,
      success, status_detected, raw_response, error_message, response_time_ms
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    data.service_id,
    data.check_started_at,
    data.check_completed_at,
    data.success,
    data.status_detected,
    boundedRawResponse(data.raw_response),
    data.error_message,
    data.response_time_ms
  ]);
}
