import { Router, Response } from 'express';
import pool from '../db/connection';
import { authMiddleware, requireRole, AuthRequest } from './middleware/auth';
import { requireCsrf } from './middleware/csrf';
import { sendEmail, isEmailConfigured } from '../lib/email';
import { testEmail } from '../lib/emailTemplates';

const router = Router();

// GET /api/admin/notifications/subscribers - List subscribers
router.get('/subscribers', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.email, s.verified, s.created_at, s.unsubscribed_at,
        COUNT(ss.service_id)::int AS service_count
      FROM subscriptions s
      LEFT JOIN subscription_services ss ON s.id = ss.subscription_id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `);
    res.json({ subscribers: result.rows });
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
});

// GET /api/admin/notifications/queue - Recent queue items
router.get('/queue', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT nq.id, nq.subject, nq.notification_type,
        nq.status_change_from, nq.status_change_to,
        nq.scheduled_for, nq.sent_at, nq.failed_at, nq.error_message, nq.retry_count,
        sub.email AS subscriber_email,
        svc.name AS service_name
      FROM notification_queue nq
      LEFT JOIN subscriptions sub ON nq.subscription_id = sub.id
      LEFT JOIN services svc ON nq.service_id = svc.id
      ORDER BY nq.scheduled_for DESC
      LIMIT 100
    `);
    res.json({ queue: result.rows });
  } catch (error) {
    console.error('Error fetching notification queue:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// GET /api/admin/notifications/stats - Notification stats
router.get('/stats', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const [subscribers, sent24h, sent7d, failed, pending] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM subscriptions WHERE verified = true AND unsubscribed_at IS NULL"),
      pool.query("SELECT COUNT(*)::int AS count FROM notification_queue WHERE sent_at > NOW() - INTERVAL '24 hours'"),
      pool.query("SELECT COUNT(*)::int AS count FROM notification_queue WHERE sent_at > NOW() - INTERVAL '7 days'"),
      pool.query(`SELECT COUNT(*)::int AS count FROM notification_queue WHERE failed_at IS NOT NULL AND sent_at IS NULL AND retry_count >= 3`),
      pool.query("SELECT COUNT(*)::int AS count FROM notification_queue WHERE sent_at IS NULL AND (failed_at IS NULL OR retry_count < 3)"),
    ]);

    res.json({
      active_subscribers: subscribers.rows[0].count,
      sent_24h: sent24h.rows[0].count,
      sent_7d: sent7d.rows[0].count,
      failed: failed.rows[0].count,
      pending: pending.rows[0].count,
      email_configured: isEmailConfigured(),
    });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST /api/admin/notifications/test - Send test email
router.post('/test', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    if (!isEmailConfigured()) {
      return res.status(400).json({ error: 'Email service is not configured (set SMTP_HOST)' });
    }

    const template = testEmail();
    await sendEmail({ to: email, subject: template.subject, html: template.html });

    await pool.query(`
      INSERT INTO admin_logs (user_id, action, details)
      VALUES ($1, 'test_email_sent', $2)
    `, [req.user!.id, JSON.stringify({ to: email })]);

    res.json({ success: true, message: 'Test email sent' });
  } catch (error: any) {
    console.error('Test email error:', error);
    res.status(500).json({ error: error.message || 'Failed to send test email' });
  }
});

// DELETE /api/admin/notifications/subscribers/:id - Remove subscriber
router.delete('/subscribers/:id', authMiddleware, requireCsrf, requireRole('super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE subscriptions SET unsubscribed_at = NOW() WHERE id = $1 RETURNING email',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    await pool.query(`
      INSERT INTO admin_logs (user_id, action, details)
      VALUES ($1, 'subscriber_removed', $2)
    `, [req.user!.id, JSON.stringify({ subscriptionId: id, email: result.rows[0].email })]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing subscriber:', error);
    res.status(500).json({ error: 'Failed to remove subscriber' });
  }
});

export default router;
