import pool from '../db/connection';

export async function runDataRetentionIfDue(): Promise<void> {
  try {
    const retentionCheck = await pool.query(
      'SELECT run_at FROM retention_log ORDER BY run_at DESC LIMIT 1'
    );
    const lastRun = retentionCheck.rows[0]?.run_at;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (!lastRun || new Date(lastRun) < oneDayAgo) {
      console.log('Running data retention...');
      const result = await pool.query('SELECT * FROM run_data_retention()');
      if (result.rows[0]) {
        console.log(`  Retention: deleted ${result.rows[0].poller_deleted} poller_logs, ${result.rows[0].history_deleted} status_history`);
      }
    }
  } catch (retentionErr: any) {
    // Non-fatal: retention function may not exist yet if migration hasn't run
    if (!retentionErr.message?.includes('does not exist')) {
      console.error('Data retention error:', retentionErr.message);
    }
  }
}
