import type { Options } from 'express-rate-limit';
import pool from '../db/connection';

interface IncrementResponse {
  totalHits: number;
  resetTime: Date | undefined;
}

// Every store shares one rate_limits table, created on first use. One shared
// promise means concurrent first requests issue a single CREATE; if another
// process wins the race, Postgres reports a duplicate (23505 on the type,
// 42P07 on the relation), which just means the table now exists.
let tableReady: Promise<void> | null = null;

function ensureRateLimitTable(): Promise<void> {
  if (!tableReady) {
    tableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          key VARCHAR(255) PRIMARY KEY,
          hits INTEGER NOT NULL DEFAULT 0,
          reset_at TIMESTAMPTZ NOT NULL
        )
      `)
      .then(
        () => undefined,
        (err: any) => {
          if (err?.code === '23505' || err?.code === '42P07') return;
          tableReady = null; // let the next request try again
          throw err;
        }
      );
  }
  return tableReady;
}

export class PgRateLimitStore {
  _prefix: string;
  _windowMs = 15 * 60 * 1000;

  constructor(prefix: string) {
    this._prefix = prefix;
  }

  init(options: Options): void {
    this._windowMs = options.windowMs;
  }

  private async ensureTable(): Promise<void> {
    await ensureRateLimitTable();
  }

  private prefixedKey(key: string): string {
    return `${this._prefix}:${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    await this.ensureTable();
    const pkey = this.prefixedKey(key);
    const resetTime = new Date(Date.now() + this._windowMs);

    const result = await pool.query(`
      INSERT INTO rate_limits (key, hits, reset_at)
      VALUES ($1, 1, $2)
      ON CONFLICT (key) DO UPDATE
      SET hits = CASE
        WHEN rate_limits.reset_at <= NOW() THEN 1
        ELSE rate_limits.hits + 1
      END,
      reset_at = CASE
        WHEN rate_limits.reset_at <= NOW() THEN $2
        ELSE rate_limits.reset_at
      END
      RETURNING hits, reset_at
    `, [pkey, resetTime]);

    return {
      totalHits: result.rows[0].hits,
      resetTime: result.rows[0].reset_at,
    };
  }

  async get(key: string): Promise<IncrementResponse | undefined> {
    await this.ensureTable();
    const result = await pool.query(
      'SELECT hits, reset_at FROM rate_limits WHERE key = $1 AND reset_at > NOW()',
      [this.prefixedKey(key)]
    );
    if (result.rows.length === 0) return undefined;
    return { totalHits: result.rows[0].hits, resetTime: result.rows[0].reset_at };
  }

  async decrement(key: string): Promise<void> {
    await this.ensureTable();
    const pkey = this.prefixedKey(key);
    await pool.query(
      'UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1',
      [pkey]
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.ensureTable();
    const pkey = this.prefixedKey(key);
    await pool.query('DELETE FROM rate_limits WHERE key = $1', [pkey]);
  }

  async resetAll(): Promise<void> {
    await this.ensureTable();
    await pool.query('DELETE FROM rate_limits WHERE key LIKE $1', [`${this._prefix}:%`]);
  }
}
