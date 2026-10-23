import cron, { ScheduledTask } from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import pool from './db/connection';
import { getAdapter } from './adapters';
import { notifyTeams } from './lib/teams';
import { resilientFetch } from './lib/resilience';
import { publicFetchFailureMessage } from './lib/fetchErrors';
import { getCurrentStatus, updateServiceStatus, updateLastChecked, logPollerCheck } from './lib/statusUpdater';
import { checkExpiredOverrides } from './lib/overrideManager';
import { activateDueMaintenances, completeExpiredMaintenances, completeMissedMaintenances } from './lib/maintenanceManager';
import { queueNotifications, notifyDependents } from './lib/notificationQueue';
import { createHealthServer } from './lib/healthServer';
import { runDataRetentionIfDue } from './lib/retention';
import { autoCreateIncident, autoResolveIncident } from './lib/incidents';
import { assertEndpointAllowed } from '@he-status/shared';
import logger from './lib/logger';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const POLLER_INTERVAL = process.env.POLLER_INTERVAL_MINUTES || '5';
const POLLER_ENABLED = process.env.POLLER_ENABLED !== 'false';
const HEALTH_PORT = process.env.POLLER_HEALTH_PORT || 3002;

// Health state
let lastPollCompleted: Date | null = null;
let lastPollDurationMs = 0;
let isPolling = false;

interface Service {
  id: string;
  name: string;
  provider: string;
  status_api_endpoint: string;
  status_api_type: string;
  check_enabled: boolean;
  category_slug: string;
}

async function getServicesForPolling(): Promise<Service[]> {
  const result = await pool.query(`
    SELECT s.id, s.name, s.provider, s.status_api_endpoint, s.status_api_type, s.check_enabled,
           COALESCE(c.slug, s.category) AS category_slug
    FROM services s
    LEFT JOIN categories c ON s.category_id = c.id
    WHERE s.check_enabled = true
      AND s.status_api_endpoint IS NOT NULL
      AND s.status_api_type IS NOT NULL
  `);
  return result.rows;
}

async function checkServiceStatus(service: Service): Promise<void> {
  const startTime = Date.now();
  const log = logger.child({ service: service.name, serviceId: service.id });

  log.info('Checking service');

  try {
    // Check if manual override is active
    const currentStatus = await getCurrentStatus(service.id);

    if (currentStatus?.override_active) {
      log.debug('Skipping — manual override active');
      return;
    }

    // SSRF guard: reject endpoints that resolve to internal / metadata addresses
    // before any adapter performs a fetch, so one guard covers every adapter. A
    // blocked endpoint throws here and is recorded as a failed check by the outer
    // catch (it does not flip the service's status to an outage).
    await assertEndpointAllowed(service.status_api_endpoint);

    // Get appropriate adapter
    const adapter = getAdapter(service.status_api_type);
    const adapterKey = `${service.status_api_type}:${service.name}`;

    let statusData: any = null;
    let normalizedStatus: { status: string; message: string };
    let fetchError: Error | null = null;

    try {
      // Fetch status from external API with retry + circuit breaker
      statusData = await resilientFetch(
        adapterKey,
        () => adapter.fetchStatus(service.status_api_endpoint)
      );

      normalizedStatus = adapter.normalizeStatus(statusData);
    } catch (fetchErr: any) {
      if (statusData !== null) {
        // fetchStatus succeeded but normalizeStatus threw — an adapter bug,
        // not a real service outage. Surface it as a failed check without
        // flipping the service's status.
        throw new Error(`Adapter normalization failed for ${service.name}: ${fetchErr.message}`);
      }

      // fetchStatus threw after resilientFetch exhausted its retries and/or
      // tripped the circuit breaker — a sustained failure to reach the
      // upstream service. Classify it as an outage instead of silently
      // leaving the last known status in place.
      // The raw error can name the endpoint, hosts and addresses: it goes to
      // the structured log and poller_logs only. The public status, history
      // and incident text get a fixed message (lib/fetchErrors.ts).
      log.warn({ err: fetchErr }, 'Fetch failed after retries/circuit breaker — classifying as outage');
      fetchError = fetchErr;
      normalizedStatus = { status: 'outage', message: publicFetchFailureMessage(fetchErr) };
    }

    // Check if status changed
    if (currentStatus && currentStatus.status !== normalizedStatus.status) {
      log.warn({ oldStatus: currentStatus.status, newStatus: normalizedStatus.status }, 'Status changed');

      await updateServiceStatus(service.id, normalizedStatus.status, normalizedStatus.message);

      // Auto-incident lifecycle: open or resolve based on transition
      try {
        if (normalizedStatus.status === 'operational') {
          const resolvedId = await autoResolveIncident(service.id);
          if (resolvedId) log.info({ incidentId: resolvedId }, 'Auto-resolved incident');
        } else {
          const incidentId = await autoCreateIncident(
            service.id,
            service.name,
            normalizedStatus.status,
            normalizedStatus.message
          );
          if (incidentId) log.info({ incidentId }, 'Auto-created incident');
        }
      } catch (incErr) {
        log.error({ err: incErr }, 'Incident auto-management failed');
      }

      // Queue notifications for subscribers (skip if transitioning out of a silent maintenance)
      if (currentStatus.status_source !== 'silent_maintenance_complete') {
        await queueNotifications(service.id, service.name, currentStatus.status, normalizedStatus.status);
      }

      // Teams webhook notifications (fire-and-forget)
      notifyTeams({
        serviceId: service.id,
        serviceName: service.name,
        categorySlug: service.category_slug,
        oldStatus: currentStatus.status,
        newStatus: normalizedStatus.status,
        statusMessage: normalizedStatus.message,
      });

      // If service went non-operational, notify about dependent services
      if (normalizedStatus.status !== 'operational') {
        await notifyDependents(service.id, service.name, normalizedStatus.status);
      }
    } else {
      log.debug({ status: normalizedStatus.status }, 'No change');
      await updateLastChecked(service.id);
    }

    // Log the check (a failed fetch is recorded with its full error message)
    await logPollerCheck({
      service_id: service.id,
      check_started_at: new Date(startTime),
      check_completed_at: new Date(),
      success: fetchError === null,
      status_detected: normalizedStatus.status,
      raw_response: statusData,
      error_message: fetchError?.message,
      response_time_ms: Date.now() - startTime
    });

  } catch (error: any) {
    log.error({ err: error }, 'Check failed');

    // Log failed check
    await logPollerCheck({
      service_id: service.id,
      check_started_at: new Date(startTime),
      check_completed_at: new Date(),
      success: false,
      error_message: error.message,
      response_time_ms: Date.now() - startTime
    });
  }
}

async function runPollingCycle(): Promise<void> {
  const cycleStart = Date.now();
  isPolling = true;

  logger.info('Starting status check cycle');

  try {
    // Activate/complete planned maintenance windows, then handle manual override expiry
    await completeMissedMaintenances();
    await activateDueMaintenances();
    await completeExpiredMaintenances();
    await checkExpiredOverrides();

    // Get all services that should be checked
    const services = await getServicesForPolling();

    logger.info({ count: services.length }, 'Services to check');

    // Check services in parallel batches (max 5 concurrent to avoid connection exhaustion)
    const BATCH_SIZE = 5;
    for (let i = 0; i < services.length; i += BATCH_SIZE) {
      const batch = services.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(service => checkServiceStatus(service))
      );
    }

    // Run data retention once per day
    await runDataRetentionIfDue();

    logger.info({ durationMs: Date.now() - cycleStart }, 'Status check cycle completed');

  } catch (error: any) {
    logger.error({ err: error }, 'Error in polling cycle');
  } finally {
    isPolling = false;
    lastPollCompleted = new Date();
    lastPollDurationMs = Date.now() - cycleStart;
  }
}

// Health check HTTP server
const healthServer = createHealthServer(() => ({
  lastPollCompleted,
  lastPollDurationMs,
  isPolling,
  intervalMinutes: parseInt(POLLER_INTERVAL),
}));

// Main execution
let cronTask: ScheduledTask | null = null;

async function main() {
  logger.info({ interval: POLLER_INTERVAL, enabled: POLLER_ENABLED }, 'HE Status Poller Service starting');

  // Start health server
  healthServer.listen(HEALTH_PORT, () => {
    logger.info({ port: HEALTH_PORT }, 'Health check server started');
  });

  if (!POLLER_ENABLED) {
    logger.warn('Poller is disabled. Set POLLER_ENABLED=true to enable.');
    return;
  }

  // Run immediately on startup
  logger.info('Running initial check');
  await runPollingCycle();

  // Schedule recurring checks
  const cronExpression = `*/${POLLER_INTERVAL} * * * *`;
  logger.info({ cron: cronExpression }, 'Scheduled recurring checks');

  cronTask = cron.schedule(cronExpression, () => {
    if (isPolling) {
      logger.warn('Previous polling cycle still running — skipping this tick');
      return;
    }
    runPollingCycle();
  });
}

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down poller');
  if (cronTask) {
    cronTask.stop();
    logger.info('Cron task stopped');
  }
  healthServer.close(() => {
    logger.info('Health server closed');
  });
  pool.end().then(() => {
    logger.info('Database pool closed');
    process.exit(0);
  }).catch((err) => {
    logger.error({ err }, 'Error closing pool');
    process.exit(1);
  });

  // Force exit after 10s
  setTimeout(() => {
    logger.fatal('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch(error => {
  logger.fatal({ err: error }, 'Fatal error');
  process.exit(1);
});
