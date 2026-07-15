import pool from '../db/connection';
import { notifyTeams } from './teams';

export async function checkExpiredOverrides(): Promise<void> {
  const result = await pool.query(`
    SELECT ss.service_id, s.name, ss.status,
           COALESCE(c.slug, s.category) AS category_slug
    FROM service_status ss
    JOIN services s ON ss.service_id = s.id
    LEFT JOIN categories c ON s.category_id = c.id
    WHERE ss.override_active = true
      AND ss.override_expires_at IS NOT NULL
      AND ss.override_expires_at < NOW()
  `);

  for (const row of result.rows) {
    console.log(`[${new Date().toISOString()}] Override expired for ${row.name}`);

    await pool.query(`
      UPDATE service_status
      SET override_active = false,
          override_expires_at = NULL
      WHERE service_id = $1
    `, [row.service_id]);

    // Teams webhook notification for expired override (fire-and-forget)
    notifyTeams({
      serviceId: row.service_id,
      serviceName: row.name,
      categorySlug: row.category_slug,
      oldStatus: row.status,
      newStatus: row.status,
      statusMessage: 'Override expired, returning to automated monitoring.',
      overrideInfo: { userName: 'System', isRemoval: true },
    });
  }
}
