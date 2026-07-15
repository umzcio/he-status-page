import pool from '../db/connection';
import { PoolClient } from 'pg';

export async function logAdminAction(
  userId: string,
  action: string,
  details: Record<string, any>,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  await db.query(
    'INSERT INTO admin_logs (user_id, action, details) VALUES ($1, $2, $3)',
    [userId, action, JSON.stringify(details)]
  );
}
