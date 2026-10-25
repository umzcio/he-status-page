import { describe, it, expect, beforeEach, vi } from 'vitest';

const query = vi.fn();
vi.mock('../db/connection', () => {
  const pool = { query };
  return { __esModule: true, default: pool, pool };
});

describe('PgRateLimitStore table creation', () => {
  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
  });

  it('creates the table once for concurrent first requests across stores', async () => {
    query.mockImplementation((sql: string) =>
      /CREATE TABLE/.test(sql)
        ? new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 10))
        : Promise.resolve({ rows: [{ hits: 1, reset_at: new Date() }] })
    );
    const { PgRateLimitStore } = await import('../lib/pgRateLimitStore');
    const a = new PgRateLimitStore('a');
    const b = new PgRateLimitStore('b');
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).increment(`k${i}`)));
    expect(query.mock.calls.filter((c) => /CREATE TABLE/.test(c[0]))).toHaveLength(1);
  });

  it('treats losing the creation race to another process as success', async () => {
    query.mockImplementation((sql: string) =>
      /CREATE TABLE/.test(sql)
        ? Promise.reject(Object.assign(new Error('duplicate key value'), { code: '23505' }))
        : Promise.resolve({ rows: [{ hits: 1, reset_at: new Date() }] })
    );
    const { PgRateLimitStore } = await import('../lib/pgRateLimitStore');
    await expect(new PgRateLimitStore('a').increment('k')).resolves.toMatchObject({ totalHits: 1 });
  });
});
