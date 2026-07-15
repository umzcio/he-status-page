import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { authMiddleware } from './middleware/auth';
import { isEmailConfigured } from '../lib/email';

const router = Router();

// Lightweight liveness probe (no auth)
router.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Detailed system health (admin-protected)
router.get('/detailed', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const poolStats = {
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
    };

    // Last poller run
    const pollerResult = await pool.query(`
      SELECT check_started_at, check_completed_at
      FROM poller_logs
      ORDER BY check_started_at DESC
      LIMIT 1
    `);
    const lastPollerRun = pollerResult.rows[0] || null;

    // Notification queue depth
    const queueResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE sent_at IS NULL AND (failed_at IS NULL OR retry_count < 3)) AS pending,
        COUNT(*) FILTER (WHERE sent_at IS NOT NULL AND sent_at > NOW() - INTERVAL '24 hours') AS sent_24h,
        COUNT(*) FILTER (WHERE failed_at IS NOT NULL AND retry_count >= 3) AS failed
      FROM notification_queue
    `);
    const notificationQueue = queueResult.rows[0];

    // Service status summary
    const servicesResult = await pool.query(`
      SELECT
        COUNT(*) AS total_services,
        COUNT(*) FILTER (WHERE ss.status = 'operational') AS operational,
        COUNT(*) FILTER (WHERE ss.status = 'degraded') AS degraded,
        COUNT(*) FILTER (WHERE ss.status = 'outage') AS outage,
        COUNT(*) FILTER (WHERE ss.status = 'maintenance') AS maintenance,
        COUNT(*) FILTER (WHERE ss.status = 'unknown') AS unknown,
        COUNT(*) FILTER (WHERE ss.override_active = true) AS active_overrides,
        MIN(ss.last_checked_at) AS oldest_check,
        MAX(ss.last_checked_at) AS newest_check
      FROM services s
      LEFT JOIN service_status ss ON s.id = ss.service_id
      WHERE s.check_enabled = true
    `);
    const servicesSummary = servicesResult.rows[0];

    // Active subscribers
    const subscribersResult = await pool.query(`
      SELECT COUNT(*) AS active_subscribers
      FROM subscriptions
      WHERE verified = true AND unsubscribed_at IS NULL
    `);

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: poolStats,
      poller: {
        lastRun: lastPollerRun?.check_started_at || null,
        lastCompleted: lastPollerRun?.check_completed_at || null,
      },
      notifications: {
        pending: parseInt(notificationQueue.pending),
        sent24h: parseInt(notificationQueue.sent_24h),
        failed: parseInt(notificationQueue.failed),
        emailConfigured: isEmailConfigured(),
      },
      services: {
        total: parseInt(servicesSummary.total_services),
        operational: parseInt(servicesSummary.operational),
        degraded: parseInt(servicesSummary.degraded),
        outage: parseInt(servicesSummary.outage),
        maintenance: parseInt(servicesSummary.maintenance),
        unknown: parseInt(servicesSummary.unknown),
        activeOverrides: parseInt(servicesSummary.active_overrides),
        oldestCheck: servicesSummary.oldest_check,
        newestCheck: servicesSummary.newest_check,
      },
      subscribers: {
        active: parseInt(subscribersResult.rows[0].active_subscribers),
      },
    });
  } catch (error: any) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

export default router;
