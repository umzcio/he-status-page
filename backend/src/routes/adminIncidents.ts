import { Router, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import pool from '../db/connection';
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import { logAdminAction } from '../lib/adminLog';

const router = Router();

// Only these roles may perform mutating admin actions; viewer stays read-only.
const MUTATE_ROLES = ['admin', 'super_admin'];

const VALID_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'];
const VALID_IMPACTS = ['minor', 'major', 'critical'];

// GET /api/admin/incidents - Admin list (includes hidden incidents)
router.get('/', authMiddleware, requireCsrf, [
  query('status').optional().isIn(['active', 'resolved', 'all']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid query parameters', details: errors.array() });
    }

    const status = (req.query.status as string) || 'all';
    const limit = (req.query.limit as unknown as number) || 50;
    const offset = (req.query.offset as unknown as number) || 0;

    let whereClause = 'WHERE 1=1';
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
        i.visible,
        i.started_at,
        i.resolved_at,
        i.updated_at,
        EXTRACT(EPOCH FROM (COALESCE(i.resolved_at, NOW()) - i.started_at))/60 AS duration_minutes,
        u.name as created_by_name,
        (
          SELECT COUNT(*)::int FROM incident_updates iu WHERE iu.incident_id = i.id
        ) AS update_count
      FROM incidents i
      LEFT JOIN services s ON i.service_id = s.id
      LEFT JOIN users u ON i.created_by_user_id = u.id
      ${whereClause}
      ORDER BY i.started_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // True total across all pages (same WHERE, no LIMIT/OFFSET).
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM incidents i ${whereClause}`
    );

    res.json({ incidents: result.rows, total: countResult.rows[0].total });
  } catch (error) {
    console.error('Error fetching admin incidents:', error);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

// GET /api/admin/incidents/:id
router.get('/:id', authMiddleware, requireCsrf, [
  param('id').isUUID(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid incident ID' });

    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        i.*,
        s.name as service_name,
        u.name as created_by_name,
        EXTRACT(EPOCH FROM (COALESCE(i.resolved_at, NOW()) - i.started_at))/60 AS duration_minutes,
        (
          SELECT json_agg(json_build_object(
            'id', iu.id,
            'status', iu.status,
            'message', iu.message,
            'created_at', iu.created_at,
            'created_by_user_id', iu.created_by_user_id,
            'created_by_name', uu.name
          ) ORDER BY iu.created_at ASC)
          FROM incident_updates iu
          LEFT JOIN users uu ON iu.created_by_user_id = uu.id
          WHERE iu.incident_id = i.id
        ) AS updates
      FROM incidents i
      LEFT JOIN services s ON i.service_id = s.id
      LEFT JOIN users u ON i.created_by_user_id = u.id
      WHERE i.id = $1
    `, [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });

    const incident = result.rows[0];
    incident.updates = incident.updates || [];
    res.json(incident);
  } catch (error) {
    console.error('Error fetching incident:', error);
    res.status(500).json({ error: 'Failed to fetch incident' });
  }
});

// POST /api/admin/incidents - Create new incident manually
router.post('/', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  body('service_id').isUUID(),
  body('title').isString().isLength({ min: 1, max: 255 }),
  body('description').optional().isString().isLength({ max: 2000 }),
  body('impact').isIn(VALID_IMPACTS),
  body('status').optional().isIn(VALID_STATUSES),
  body('initial_message').optional().isString().isLength({ max: 2000 }),
  body('visible').optional().isBoolean(),
  body('started_at').optional().isISO8601(),
], async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { service_id, title, description, impact, status = 'investigating',
            initial_message, visible = true, started_at } = req.body;

    await client.query('BEGIN');

    const incidentResult = await client.query(`
      INSERT INTO incidents (
        service_id, title, description, severity, impact, status,
        source, auto_created, created_by_user_id, started_at, visible
      )
      VALUES ($1, $2, $3, $4, $4, $5, 'manual', false, $6, $7, $8)
      RETURNING id
    `, [service_id, title, description || null, impact, status, req.user!.id,
        started_at || new Date(), visible]);

    const incidentId = incidentResult.rows[0].id;

    // Add the initial update (so timeline always has at least one entry)
    const firstMessage = initial_message || description || `Incident created: ${title}`;
    await client.query(`
      INSERT INTO incident_updates (incident_id, status, message, created_by_user_id)
      VALUES ($1, $2, $3, $4)
    `, [incidentId, status, firstMessage, req.user!.id]);

    await logAdminAction(req.user!.id, 'incident_created', { incidentId, service_id, impact }, client);
    await client.query('COMMIT');

    res.status(201).json({ id: incidentId, success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating incident:', error);
    res.status(500).json({ error: 'Failed to create incident' });
  } finally {
    client.release();
  }
});

// POST /api/admin/incidents/:id/updates - Post a new update to incident timeline
router.post('/:id/updates', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  param('id').isUUID(),
  body('status').isIn(VALID_STATUSES),
  body('message').isString().isLength({ min: 1, max: 2000 }),
], async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { id } = req.params;
    const { status, message } = req.body;

    await client.query('BEGIN');

    // Verify incident exists
    const incidentCheck = await client.query('SELECT id FROM incidents WHERE id = $1', [id]);
    if (incidentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Incident not found' });
    }

    const updateResult = await client.query(`
      INSERT INTO incident_updates (incident_id, status, message, created_by_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, created_at
    `, [id, status, message, req.user!.id]);

    // Trigger updates incidents.status, updated_at, and resolved_at if status='resolved'
    await logAdminAction(req.user!.id, 'incident_update_posted', { incidentId: id, status }, client);
    await client.query('COMMIT');

    res.status(201).json({ id: updateResult.rows[0].id, created_at: updateResult.rows[0].created_at });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error posting incident update:', error);
    res.status(500).json({ error: 'Failed to post update' });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/incidents/:id - Edit incident metadata (title, description, impact, visible)
router.patch('/:id', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  param('id').isUUID(),
  body('title').optional().isString().isLength({ min: 1, max: 255 }),
  body('description').optional().isString().isLength({ max: 2000 }),
  body('impact').optional().isIn(VALID_IMPACTS),
  body('visible').optional().isBoolean(),
], async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { id } = req.params;
    const { title, description, impact, visible } = req.body;

    const sets: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (title !== undefined) { sets.push(`title = $${i++}`); values.push(title); }
    if (description !== undefined) { sets.push(`description = $${i++}`); values.push(description); }
    if (impact !== undefined) {
      sets.push(`impact = $${i++}`); values.push(impact);
      sets.push(`severity = $${i++}`); values.push(impact);
    }
    if (visible !== undefined) { sets.push(`visible = $${i++}`); values.push(visible); }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE incidents SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`,
      values
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Incident not found' });
    }

    await logAdminAction(req.user!.id, 'incident_edited', { incidentId: id, fields: Object.keys(req.body) }, client);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error editing incident:', error);
    res.status(500).json({ error: 'Failed to edit incident' });
  } finally {
    client.release();
  }
});

// DELETE /api/admin/incidents/:id - Delete incident (cascades to updates)
router.delete('/:id', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  param('id').isUUID(),
], async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid incident ID' });

    const { id } = req.params;
    await client.query('BEGIN');
    const result = await client.query('DELETE FROM incidents WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Incident not found' });
    }
    await logAdminAction(req.user!.id, 'incident_deleted', { incidentId: id }, client);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting incident:', error);
    res.status(500).json({ error: 'Failed to delete incident' });
  } finally {
    client.release();
  }
});

export default router;
