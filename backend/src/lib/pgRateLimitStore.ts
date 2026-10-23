import type { Options } from 'express-rate-limit';
import pool from '../db/connection';

interface IncrementResponse {
  totalHits: number;
  resetTime: Date | undefined;
}

export class PgRateLimitStore {
  _prefix: string;
  _initialized = false;
  _windowMs = 15 * 60 * 1000;

  constructor(prefix: string) {
    this._prefix = prefix;
  }

  init(options: Options): void {
    this._windowMs = options.windowMs;
  }

  private async ensureTable(): Promise<void> {
    if (this._initialized) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key VARCHAR(255) PRIMARY KEY,
        hits INTEGER NOT NULL DEFAULT 0,
        reset_at TIMESTAMPTZ NOT NULL
      )
    `);
    this._initialized = true;
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
