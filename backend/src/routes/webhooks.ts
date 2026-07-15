import { Router } from 'express';
import pool from '../db/connection';
import { authMiddleware, AuthRequest, requireRole } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import { buildStatusChangeCard, sendTeamsWebhook } from '../lib/teams';
import { logAdminAction } from '../lib/adminLog';

const router = Router();

// All routes require super_admin
router.use(authMiddleware, requireCsrf, requireRole('super_admin'));

// GET / - List all webhooks
router.get('/', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM teams_webhooks ORDER BY created_at DESC'
    );
    res.json({ webhooks: result.rows });
  } catch (error) {
    console.error('List webhooks error:', error);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// POST / - Create webhook
router.post('/', async (req: AuthRequest, res) => {
  try {
    const { name, webhook_url, enabled, category_filter } = req.body;

    if (!name || !webhook_url) {
      return res.status(400).json({ error: 'Name and webhook_url are required' });
    }

    if (!webhook_url.startsWith('https://')) {
      return res.status(400).json({ error: 'Webhook URL must start with https://' });
    }

    const result = await pool.query(
      `INSERT INTO teams_webhooks (name, webhook_url, enabled, category_filter)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, webhook_url, enabled !== false, category_filter ? JSON.stringify(category_filter) : null]
    );

    // Log admin action
    await logAdminAction(req.user!.id, 'webhook_created', { webhookId: result.rows[0].id, name });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create webhook error:', error);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// PUT /:id - Update webhook
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, webhook_url, enabled, category_filter } = req.body;

    if (webhook_url && !webhook_url.startsWith('https://')) {
      return res.status(400).json({ error: 'Webhook URL must start with https://' });
    }

    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [id];
    let idx = 2;

    if (name !== undefined) { sets.push(`name = $${idx}`); params.push(name); idx++; }
    if (webhook_url !== undefined) { sets.push(`webhook_url = $${idx}`); params.push(webhook_url); idx++; }
    if (enabled !== undefined) { sets.push(`enabled = $${idx}`); params.push(enabled); idx++; }
    if (category_filter !== undefined) {
      sets.push(`category_filter = $${idx}`);
      params.push(category_filter ? JSON.stringify(category_filter) : null);
      idx++;
    }

    const result = await pool.query(
      `UPDATE teams_webhooks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Log admin action
    await logAdminAction(req.user!.id, 'webhook_updated', { webhookId: id });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update webhook error:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /:id - Delete webhook
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM teams_webhooks WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Log admin action
    await logAdminAction(req.user!.id, 'webhook_deleted', { webhookId: id, name: result.rows[0].name });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete webhook error:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// POST /:id/test - Send test card
router.post('/:id/test', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const wh = await pool.query('SELECT * FROM teams_webhooks WHERE id = $1', [id]);
    if (wh.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const payload = buildStatusChangeCard({
      serviceId: '00000000-0000-0000-0000-000000000000',
      serviceName: 'Test Service',
      categorySlug: 'test',
      oldStatus: 'operational',
      newStatus: 'outage',
      statusMessage: 'This is a test notification from HE Status.',
    });

    const result = await sendTeamsWebhook(wh.rows[0].webhook_url, payload);

    // Log the test
    await pool.query(
      `INSERT INTO teams_webhook_logs
        (webhook_id, service_id, status_from, status_to, success, error_message, response_time_ms)
       VALUES ($1, NULL, 'operational', 'outage', $2, $3, $4)`,
      [id, result.success, result.error || null, result.responseTimeMs]
    );

    if (result.success) {
      res.json({ success: true, responseTimeMs: result.responseTimeMs });
    } else {
      res.status(502).json({ success: false, error: result.error, responseTimeMs: result.responseTimeMs });
    }
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({ error: 'Failed to test webhook' });
  }
});

// GET /logs - Recent delivery logs
router.get('/logs', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      SELECT
        l.id, l.webhook_id, l.service_id,
        l.status_from, l.status_to,
        l.success, l.error_message, l.response_time_ms, l.sent_at,
        w.name AS webhook_name,
        s.name AS service_name
      FROM teams_webhook_logs l
      LEFT JOIN teams_webhooks w ON l.webhook_id = w.id
      LEFT JOIN services s ON l.service_id = s.id
      ORDER BY l.sent_at DESC
      LIMIT 50
    `);

    res.json({ logs: result.rows });
  } catch (error) {
    console.error('Webhook logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

export default router;
