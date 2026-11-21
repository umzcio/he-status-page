import pool from '../db/connection';
import { PoolClient } from 'pg';

// Admin audit log.
//
// Every privileged change and its audit row must commit together: if the
// audit insert could fail on its own, a caller could make a change that is
// never recorded. Routes therefore do their writes and logAdminAction() on
// the same client inside inTransaction().

/**
 * Make a value safe for the JSONB `details` column. Postgres JSONB rejects NUL
 * (\u0000) and lone UTF-16 surrogates, which a text column accepts, so without
 * this a request could pass the primary write and fail only the audit write.
 */
export function auditSafe(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
      .replace(/\u0000/g, '');
  }
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => auditSafe(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[auditSafe(k) as string] = auditSafe(v, depth + 1);
  return out;
}

export async function logAdminAction(
  userId: string,
  action: string,
  details: Record<string, any>,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  await db.query(
    'INSERT INTO admin_logs (user_id, action, details) VALUES ($1, $2, $3)',
    [userId, action, JSON.stringify(auditSafe(details))]
  );
}

/** Run `fn` in one transaction on a dedicated client; roll back if it throws. */
export async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
