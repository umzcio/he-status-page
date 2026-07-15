import pool from '../db/connection';
import { sendEmail, isEmailConfigured } from './email';

const MAX_RETRIES = 3;
const PROCESS_INTERVAL_MS = 30000;
const BATCH_SIZE = 20;
// A claimed row is considered stale (its processor likely died mid-send) and
// re-claimable after this grace period.
const CLAIM_STALE_MINUTES = 5;

let processorInterval: ReturnType<typeof setInterval> | null = null;
// Re-entrancy guard: prevents overlapping processQueue ticks from running
// concurrently within a single process.
let processing = false;

async function processQueue(): Promise<void> {
  if (!isEmailConfigured()) return;
  if (processing) return;
  processing = true;

  try {
    // Atomically claim a batch of pending notifications. FOR UPDATE SKIP LOCKED
    // ensures concurrent processors (or overlapping ticks) never claim the same
    // rows; setting claimed_at marks them as taken. Rows are eligible when unsent,
    // not failed beyond retries, due, and either unclaimed or claimed long enough
    // ago to be considered stale.
    const result = await pool.query(`
      UPDATE notification_queue
      SET claimed_at = NOW()
      WHERE id IN (
        SELECT id
        FROM notification_queue
        WHERE sent_at IS NULL
          AND (failed_at IS NULL OR retry_count < $1)
          AND scheduled_for <= NOW()
          AND (claimed_at IS NULL OR claimed_at < NOW() - make_interval(mins => $2))
        ORDER BY scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $3
      )
      RETURNING id, subscription_id, service_id, subject, body, retry_count
    `, [MAX_RETRIES, CLAIM_STALE_MINUTES, BATCH_SIZE]);

    for (const notification of result.rows) {
      try {
        // Get subscriber email
        const sub = await pool.query(
          'SELECT email FROM subscriptions WHERE id = $1 AND verified = true AND unsubscribed_at IS NULL',
          [notification.subscription_id]
        );

        if (sub.rows.length === 0) {
          // Subscriber gone — mark as sent to remove from queue
          await pool.query('UPDATE notification_queue SET sent_at = NOW() WHERE id = $1', [notification.id]);
          continue;
        }

        await sendEmail({
          to: sub.rows[0].email,
          subject: notification.subject,
          html: notification.body,
        });

        await pool.query(
          'UPDATE notification_queue SET sent_at = NOW() WHERE id = $1',
          [notification.id]
        );
      } catch (error: any) {
        console.error(`Failed to send notification ${notification.id}:`, error.message);
        // Release the claim on failure so the row remains re-processable (up to
        // MAX_RETRIES) rather than being permanently claimed.
        await pool.query(
          'UPDATE notification_queue SET failed_at = NOW(), error_message = $1, retry_count = retry_count + 1, claimed_at = NULL WHERE id = $2',
          [error.message, notification.id]
        );
      }
    }
  } catch (error) {
    console.error('Notification queue processing error:', error);
  } finally {
    processing = false;
  }
}

export function startNotificationProcessor(): void {
  if (processorInterval) return;

  console.log('Notification queue processor started (30s interval)');
  processorInterval = setInterval(processQueue, PROCESS_INTERVAL_MS);

  // Run once immediately
  processQueue();
}

export function stopNotificationProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
  }
}
