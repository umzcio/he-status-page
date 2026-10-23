import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query, validationResult } from 'express-validator';
import pool from '../db/connection';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hidden services (visible = false) are admin-only: every public per-service
// route answers 404 for them, exactly as for an unknown id.
async function isPublicService(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const result = await pool.query(
    'SELECT 1 FROM services WHERE id = $1 AND visible IS NOT false',
    [id]
  );
  return result.rows.length > 0;
}

// GET /api/services - Get all services with current status (single consolidated query)
router.get('/', async (req, res) => {
  try {
    // Single query: services + status + categories + dependency impacts via LEFT JOINs
    const result = await pool.query(`
      SELECT
        s.id,
        s.name,
        s.description,
        COALESCE(c.slug, s.category) AS category,
        s.provider,
        s.external_link,
        s.display_order,
        ss.status,
        ss.status_source,
        ss.status_message,
        ss.last_checked_at,
        ss.override_active,
        ss.override_at,
        u.name as override_by,
        c.slug AS cat_slug,
        c.display_name AS cat_display_name,
        c.display_order AS cat_display_order,
        c.description AS cat_description,
        (
          SELECT MAX(started_at)
          FROM status_history
          WHERE service_id = s.id AND ended_at IS NULL
        ) AS status_since,
        (
          SELECT json_agg(json_build_object('name', dep_s.name, 'status', dep_ss.status))
          FROM service_dependencies sd
          JOIN services dep_s ON sd.depends_on_service_id = dep_s.id
          JOIN service_status dep_ss ON dep_s.id = dep_ss.service_id
          WHERE sd.service_id = s.id AND dep_ss.status NOT IN ('operational')
        ) AS affected_by,
        (
          SELECT json_build_object(
            'id', pm.id,
            'title', pm.title,
            'description', pm.description,
            'scheduled_start', pm.scheduled_start,
            'scheduled_end', pm.scheduled_end,
            'recurrence_type', pm.recurrence_type,
            'status', pm.status
          )
          FROM planned_maintenances pm
          WHERE pm.service_id = s.id
            AND pm.status IN ('scheduled', 'active')
            AND pm.scheduled_end > NOW()
            AND pm.announce = true
          ORDER BY pm.scheduled_start ASC
          LIMIT 1
        ) AS upcoming_maintenance
      FROM services s
      LEFT JOIN categories c ON s.category_id = c.id
      LEFT JOIN service_status ss ON s.id = ss.service_id
      LEFT JOIN users u ON ss.override_by_user_id = u.id
      WHERE s.visible IS NOT false
      ORDER BY COALESCE(c.display_order, 999), s.display_order ASC
    `);

    // Extract unique categories from results (preserving order)
    const categoriesMap = new Map<string, any>();
    for (const row of result.rows) {
      if (row.cat_slug && !categoriesMap.has(row.cat_slug)) {
        categoriesMap.set(row.cat_slug, {
          slug: row.cat_slug,
          display_name: row.cat_display_name,
          display_order: row.cat_display_order,
          description: row.cat_description,
        });
      }
    }
    const categories = Array.from(categoriesMap.values());

    // Clean up rows: replace null affected_by with empty array, remove category metadata
    const services = result.rows.map(row => {
      const { cat_slug, cat_display_name, cat_display_order, cat_description, ...service } = row;
      service.affected_by = service.affected_by || [];
      return service;
    });

    // Group by category
    const servicesByCategory = services.reduce((acc: any, service: any) => {
      if (!acc[service.category]) {
        acc[service.category] = [];
      }
      acc[service.category].push(service);
      return acc;
    }, {});

    // Calculate overall status
    const statuses = services.map((r: any) => r.status);
    let overall_status = 'operational';
    if (statuses.includes('outage')) {
      overall_status = 'outage';
    } else if (statuses.includes('degraded')) {
      overall_status = 'degraded';
    } else if (statuses.includes('maintenance')) {
      overall_status = 'maintenance';
    }

    const body = JSON.stringify({
      services,
      services_by_category: servicesByCategory,
      categories,
      overall_status,
      last_updated: new Date().toISOString()
    });

    // ETag for conditional caching
    const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.set({
      'Cache-Control': 'public, max-age=15',
      'ETag': etag,
    });
    res.type('json').send(body);

  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// GET /api/services/:id - Get single service details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Public display fields only (the same ones the list route returns) —
    // never the poller's monitoring config (endpoint, type, interval, ...).
    const result = await pool.query(`
      SELECT
        s.id,
        s.name,
        s.description,
        COALESCE(c.slug, s.category) AS category,
        s.provider,
        s.external_link,
        s.display_order,
        ss.status,
        ss.status_source,
        ss.status_message,
        ss.last_checked_at,
        ss.override_active
      FROM services s
      LEFT JOIN categories c ON s.category_id = c.id
      LEFT JOIN service_status ss ON s.id = ss.service_id
      WHERE s.id = $1 AND s.visible IS NOT false
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ error: 'Failed to fetch service' });
  }
});

// GET /api/services/:id/uptime - Get daily uptime data over a window (default 90 days)
router.get('/:id/uptime', [
  query('days').optional().isInt({ min: 1, max: 365 }).toInt(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid query parameters', details: errors.array() });
    }

    const { id } = req.params;
    const days = (req.query.days as unknown as number) || 90;

    if (!(await isPublicService(id))) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // For each day in the window, compute the worst (most severe) status.
    // Severity ranking: outage > degraded > maintenance > unknown > operational.
    // A status_history record covers the period [started_at, COALESCE(ended_at, NOW())].
    // A day is "covered" by a record if the record's window overlaps the day's window.
    const result = await pool.query(`
      WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')::date,
          CURRENT_DATE,
          '1 day'::interval
        )::date AS day
      ),
      day_status AS (
        SELECT
          d.day,
          h.status,
          h.status_message,
          h.started_at,
          COALESCE(h.ended_at, NOW()) AS effective_end,
          CASE
            WHEN h.status = 'maintenance' AND h.status_source = 'silent_maintenance' THEN 0
            WHEN h.status = 'outage' THEN 4
            WHEN h.status = 'degraded' THEN 3
            WHEN h.status = 'maintenance' THEN 2
            WHEN h.status = 'unknown' THEN 1
            WHEN h.status = 'operational' THEN 0
            ELSE 0
          END AS severity
        FROM days d
        LEFT JOIN status_history h
          ON h.service_id = $1
         AND h.started_at < (d.day + INTERVAL '1 day')
         AND COALESCE(h.ended_at, NOW()) > d.day
      ),
      daily_worst AS (
        SELECT
          day,
          MAX(severity) AS max_severity,
          MAX(CASE WHEN status IS NOT NULL THEN 1 ELSE 0 END) AS has_data
        FROM day_status
        GROUP BY day
      )
      SELECT
        dw.day,
        CASE
          WHEN dw.has_data = 0 THEN 'no_data'
          WHEN dw.max_severity = 4 THEN 'outage'
          WHEN dw.max_severity = 3 THEN 'degraded'
          WHEN dw.max_severity = 2 THEN 'maintenance'
          WHEN dw.max_severity = 1 THEN 'unknown'
          ELSE 'operational'
        END AS status,
        COALESCE((
          SELECT SUM(
            EXTRACT(EPOCH FROM (
              LEAST(COALESCE(h.ended_at, NOW()), dw.day + INTERVAL '1 day')
              - GREATEST(h.started_at, dw.day)
            ))
          )
          FROM status_history h
          WHERE h.service_id = $1
            AND h.status IN ('outage', 'degraded')
            AND h.started_at < (dw.day + INTERVAL '1 day')
            AND COALESCE(h.ended_at, NOW()) > dw.day
        ), 0) AS impacted_seconds
      FROM daily_worst dw
      ORDER BY dw.day ASC
    `, [id, days]);

    // Compute uptime % over the window
    // uptime = 1 - (sum of impacted_seconds across all days where there's data) / (covered seconds)
    let totalImpacted = 0;
    let totalCovered = 0;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const data = result.rows.map((row: any) => {
      const dayDate = new Date(row.day);
      const dayStart = dayDate.getTime();
      const dayEnd = Math.min(dayStart + dayMs, now);
      const coveredSeconds = Math.max(0, (dayEnd - dayStart) / 1000);
      const impacted = parseFloat(row.impacted_seconds) || 0;

      if (row.status !== 'no_data') {
        totalImpacted += impacted;
        totalCovered += coveredSeconds;
      }

      return {
        date: row.day,
        status: row.status,
        impacted_seconds: Math.round(impacted),
      };
    });

    const uptimePercent = totalCovered > 0
      ? ((totalCovered - totalImpacted) / totalCovered) * 100
      : null;

    res.json({
      service_id: id,
      days,
      uptime_percent: uptimePercent !== null ? Math.round(uptimePercent * 1000) / 1000 : null,
      daily: data,
    });

  } catch (error) {
    console.error('Error fetching uptime:', error);
    res.status(500).json({ error: 'Failed to fetch uptime' });
  }
});

// GET /api/services/:id/history - Get service status history
router.get('/:id/history', [
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid query parameters', details: errors.array() });
    }

    const { id } = req.params;
    const limit = (req.query.limit as unknown as number) || 50;
    const offset = (req.query.offset as unknown as number) || 0;

    if (!(await isPublicService(id))) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const result = await pool.query(`
      SELECT
        status,
        status_source,
        status_message,
        started_at,
        ended_at,
        duration_minutes
      FROM status_history
      WHERE service_id = $1
      ORDER BY started_at DESC
      LIMIT $2 OFFSET $3
    `, [id, limit, offset]);

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM status_history WHERE service_id = $1',
      [id]
    );

    res.json({
      history: result.rows,
      total: countResult.rows[0].total
    });

  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;
