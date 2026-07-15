import { Router, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { randomUUID } from 'crypto';
import pool from '../db/connection';
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import { logAdminAction } from '../lib/adminLog';

const router = Router();

// Only these roles may perform mutating admin actions; viewer stays read-only.
const MUTATE_ROLES = ['admin', 'super_admin'];

const RECURRENCE_TYPES = ['once', 'daily', 'weekly', 'monthly'] as const;
const STATUSES = ['scheduled', 'active', 'completed', 'cancelled'] as const;

// GET /api/admin/maintenance
router.get('/', authMiddleware, requireCsrf, [
  query('service_id').optional().isUUID(),
  query('status').optional().isString(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { service_id } = req.query;
    const statusParam = (req.query.status as string) || 'scheduled,active';
    const requestedStatuses = statusParam.split(',').filter(s => STATUSES.includes(s as any));
    if (requestedStatuses.length === 0) return res.status(400).json({ error: 'Invalid status filter' });

    const conditions: string[] = ['pm.status = ANY($1)'];
    const params: any[] = [requestedStatuses];

    if (service_id) {
      params.push(service_id);
      conditions.push(`pm.service_id = $${params.length}`);
    }

    const result = await pool.query(`
      SELECT
        pm.id, pm.service_id, pm.series_id, pm.title, pm.description,
        pm.scheduled_start, pm.scheduled_end, pm.recurrence_type,
        pm.announce, pm.status, pm.created_at, pm.activated_at, pm.completed_at,
        s.name AS service_name,
        u.name AS created_by_name
      FROM planned_maintenances pm
      JOIN services s ON pm.service_id = s.id
      LEFT JOIN users u ON pm.created_by = u.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY pm.scheduled_start ASC
    `, params);

    res.json({ maintenances: result.rows });
  } catch (err) {
    console.error('Error fetching maintenances:', err);
    res.status(500).json({ error: 'Failed to fetch maintenance windows' });
  }
});

// GET /api/admin/maintenance/:id
router.get('/:id', authMiddleware, requireCsrf, [
  param('id').isUUID(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid ID' });

    const result = await pool.query(`
      SELECT
        pm.*, s.name AS service_name, u.name AS created_by_name
      FROM planned_maintenances pm
      JOIN services s ON pm.service_id = s.id
      LEFT JOIN users u ON pm.created_by = u.id
      WHERE pm.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching maintenance:', err);
    res.status(500).json({ error: 'Failed to fetch maintenance window' });
  }
});

// POST /api/admin/maintenance
router.post('/', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  body('service_id').isUUID(),
  body('title').isString().trim().isLength({ min: 1, max: 255 }),
  body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('scheduled_start').isISO8601(),
  body('scheduled_end').isISO8601(),
  body('recurrence_type').optional().isIn(RECURRENCE_TYPES),
  body('recurrence_day_of_week').optional({ nullable: true }).isInt({ min: 0, max: 6 }),
  body('recurrence_day_of_month').optional({ nullable: true }).isInt({ min: 1, max: 31 }),
  body('announce').optional().isBoolean(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { service_id, title, description, scheduled_start, scheduled_end,
            recurrence_type = 'once', recurrence_day_of_week, recurrence_day_of_month,
            announce = true } = req.body;

    const start = new Date(scheduled_start);
    const end = new Date(scheduled_end);
    if (end <= start) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    const id = randomUUID();

    const result = await pool.query(`
      INSERT INTO planned_maintenances
        (id, service_id, series_id, title, description,
         scheduled_start, scheduled_end, recurrence_type,
         recurrence_day_of_week, recurrence_day_of_month, announce, created_by)
      VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [id, service_id, title, description || null, start, end, recurrence_type,
        recurrence_day_of_week ?? null, recurrence_day_of_month ?? null, announce, req.user!.id]);

    await logAdminAction(req.user!.id, 'maintenance_created', {
      maintenanceId: id, service_id, title, recurrence_type,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating maintenance:', err);
    res.status(500).json({ error: 'Failed to create maintenance window' });
  }
});

// PATCH /api/admin/maintenance/:id
router.patch('/:id', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  param('id').isUUID(),
  body('title').optional().isString().trim().isLength({ min: 1, max: 255 }),
  body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('scheduled_start').optional().isISO8601(),
  body('scheduled_end').optional().isISO8601(),
  body('announce').optional().isBoolean(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { id } = req.params;

    const current = await pool.query(
      'SELECT status, scheduled_start, scheduled_end FROM planned_maintenances WHERE id = $1',
      [id]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (current.rows[0].status !== 'scheduled') {
      return res.status(409).json({ error: 'Only scheduled (not yet active) windows can be edited' });
    }

    const { title, description, scheduled_start, scheduled_end, announce } = req.body;
    const start = scheduled_start ? new Date(scheduled_start) : new Date(current.rows[0].scheduled_start);
    const end = scheduled_end ? new Date(scheduled_end) : new Date(current.rows[0].scheduled_end);

    if (end <= start) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    const result = await pool.query(`
      UPDATE planned_maintenances SET
        title = COALESCE($2, title),
        description = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE description END,
        scheduled_start = $4,
        scheduled_end = $5,
        announce = COALESCE($6, announce)
      WHERE id = $1
      RETURNING *
    `, [id, title || null, description !== undefined ? description : null, start, end,
        announce !== undefined ? announce : null]);

    await logAdminAction(req.user!.id, 'maintenance_updated', { maintenanceId: id });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating maintenance:', err);
    res.status(500).json({ error: 'Failed to update maintenance window' });
  }
});

// DELETE /api/admin/maintenance/:id — cancel single occurrence
router.delete('/:id', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  param('id').isUUID(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid ID' });

    const { id } = req.params;

    const current = await pool.query(
      'SELECT status FROM planned_maintenances WHERE id = $1', [id]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (['completed', 'cancelled'].includes(current.rows[0].status)) {
      return res.status(409).json({ error: 'Window is already completed or cancelled' });
    }

    await pool.query(
      "UPDATE planned_maintenances SET status = 'cancelled' WHERE id = $1",
      [id]
    );

    await logAdminAction(req.user!.id, 'maintenance_cancelled', { maintenanceId: id });

    res.json({ success: true });
  } catch (err) {
    console.error('Error cancelling maintenance:', err);
    res.status(500).json({ error: 'Failed to cancel maintenance window' });
  }
});

// DELETE /api/admin/maintenance/:id/series — cancel all future scheduled occurrences in series
router.delete('/:id/series', authMiddleware, requireCsrf, requireRole(...MUTATE_ROLES), [
  param('id').isUUID(),
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid ID' });

    const { id } = req.params;

    const row = await pool.query(
      'SELECT series_id FROM planned_maintenances WHERE id = $1', [id]
    );
    if (row.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const { series_id } = row.rows[0];

    const result = await pool.query(`
      UPDATE planned_maintenances SET status = 'cancelled'
      WHERE series_id = $1 AND status = 'scheduled'
    `, [series_id]);

    await logAdminAction(req.user!.id, 'maintenance_series_cancelled', {
      seriesId: series_id, count: result.rowCount,
    });

    res.json({ success: true, cancelled: result.rowCount });
  } catch (err) {
    console.error('Error cancelling maintenance series:', err);
    res.status(500).json({ error: 'Failed to cancel maintenance series' });
  }
});

export default router;
