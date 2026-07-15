import { Router, Request, Response } from 'express';
import { query, param, validationResult } from 'express-validator';
import pool from '../db/connection';

const router = Router();

// GET /api/incidents - Public list of incidents
// Query params:
//   status: 'active' (unresolved) | 'resolved' | 'all' (default: 'all')
//   limit: 1-100 (default 30)
//   offset: 0+ (default 0)
router.get('/', [
  query('status').optional().isIn(['active', 'resolved', 'all']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid query parameters', details: errors.array() });
    }

    const status = (req.query.status as string) || 'all';
    const limit = (req.query.limit as unknown as number) || 30;
    const offset = (req.query.offset as unknown as number) || 0;

    let whereClause = 'WHERE i.visible = true';
    if (status === 'active') whereClause += ' AND i.resolved_at IS NULL';
    if (status === 'resolved') whereClause += ' AND i.resolved_at IS NOT NULL';

    const result = await pool.query(`
      SELECT
        i.id,
        i.service_id,
        s.name as service_name,
        i.title,
        i.description,
        i.impact,
        i.status,
        i.source,
        i.auto_created,
        i.started_at,
        i.resolved_at,
        i.updated_at,
        EXTRACT(EPOCH FROM (COALESCE(i.resolved_at, NOW()) - i.started_at))/60 AS duration_minutes,
        (
          SELECT json_agg(json_build_object(
            'id', iu.id,
            'status', iu.status,
            'message', iu.message,
            'created_at', iu.created_at
          ) ORDER BY iu.created_at ASC)
          FROM incident_updates iu
          WHERE iu.incident_id = i.id
        ) AS updates
      FROM incidents i
      LEFT JOIN services s ON i.service_id = s.id
      ${whereClause}
      ORDER BY i.started_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // True total across all pages (same WHERE, no LIMIT/OFFSET).
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM incidents i ${whereClause}`
    );

    res.json({
      incidents: result.rows.map(r => ({ ...r, updates: r.updates || [] })),
      total: countResult.rows[0].total,
    });
  } catch (error) {
    console.error('Error fetching incidents:', error);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

// GET /api/incidents/:id - Public incident detail
router.get('/:id', [
  param('id').isUUID(),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid incident ID' });
    }

    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        i.id,
        i.service_id,
        s.name as service_name,
        i.title,
        i.description,
        i.impact,
        i.status,
        i.source,
        i.auto_created,
        i.started_at,
        i.resolved_at,
        i.updated_at,
        EXTRACT(EPOCH FROM (COALESCE(i.resolved_at, NOW()) - i.started_at))/60 AS duration_minutes,
        (
          SELECT json_agg(json_build_object(
            'id', iu.id,
            'status', iu.status,
            'message', iu.message,
            'created_at', iu.created_at
          ) ORDER BY iu.created_at ASC)
          FROM incident_updates iu
          WHERE iu.incident_id = i.id
        ) AS updates
      FROM incidents i
      LEFT JOIN services s ON i.service_id = s.id
      WHERE i.id = $1 AND i.visible = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const incident = result.rows[0];
    incident.updates = incident.updates || [];
    res.json(incident);
  } catch (error) {
    console.error('Error fetching incident:', error);
    res.status(500).json({ error: 'Failed to fetch incident' });
  }
});

export default router;
