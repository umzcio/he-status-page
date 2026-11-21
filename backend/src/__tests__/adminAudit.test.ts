import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { listen } from './helpers';

// Every mutating admin route must commit its change and its audit row
// together. The fake pool hands out a client that records statements and can
// be told to fail the admin_logs insert.
let statements: string[];
let failAudit: boolean;

async function fakeQuery(sql: string) {
  statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
  if (/INSERT INTO admin_logs/.test(sql) && failAudit) throw new Error('audit insert failed');
  if (/RETURNING/.test(sql)) return { rows: [{ id: 'row-1', name: 'x', slug: 'x', key_prefix: 'abcd1234' }], rowCount: 1 };
  if (/SELECT status_api_endpoint, status_api_type FROM services/.test(sql)) return { rows: [{ status_api_type: 'manual' }] };
  if (/SELECT email FROM users/.test(sql)) return { rows: [{ email: 'a@example.edu' }] };
  if (/SELECT id FROM users WHERE id/.test(sql)) return { rows: [{ id: 'user-1' }] };
  return { rows: [], rowCount: 0 };
}

vi.mock('../db/connection', () => {
  const pool = {
    query: (sql: string) => fakeQuery(sql),
    connect: async () => ({ query: (sql: string) => fakeQuery(sql), release: () => undefined }),
  };
  return { __esModule: true, default: pool, pool };
});

vi.mock('../routes/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-1', email: 'admin@example.edu', role: 'super_admin' };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../routes/middleware/csrf', () => ({
  requireCsrf: (_req: any, _res: any, next: any) => next(),
}));

const SERVICE = '11111111-1111-4111-8111-111111111111';

const CASES: Array<{ name: string; mount: string; module: string; method: string; path: string; body: object }> = [
  { name: 'webhook create', mount: '/w', module: '../routes/webhooks', method: 'POST', path: '/w', body: { name: 'n', webhook_url: 'https://8.8.8.8/hook' } },
  { name: 'service update', mount: '/s', module: '../routes/adminServices', method: 'PUT', path: `/s/${SERVICE}`, body: { name: 'New name' } },
  { name: 'category create', mount: '/c', module: '../routes/categories', method: 'POST', path: '/c', body: { slug: 's', display_name: 'S' } },
  { name: 'category update', mount: '/c', module: '../routes/categories', method: 'PUT', path: `/c/${SERVICE}`, body: { display_name: 'S2' } },
  {
    name: 'maintenance create', mount: '/m', module: '../routes/adminMaintenance', method: 'POST', path: '/m',
    body: { service_id: SERVICE, title: 't', scheduled_start: '2030-01-01T00:00:00Z', scheduled_end: '2030-01-01T01:00:00Z' },
  },
  { name: 'user create', mount: '/u', module: '../routes/users', method: 'POST', path: '/u', body: { email: 'n@example.edu', role: 'admin', password: 'a-long-unique-passphrase' } },
  { name: 'API key create', mount: '/k', module: '../routes/apiKeys', method: 'POST', path: '/k', body: { user_id: SERVICE, name: 'k' } },
];

describe('admin changes and their audit rows commit together', () => {
  const ORIGINAL_ENV = process.env;
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    vi.resetModules();
    statements = [];
    failAudit = false;
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough' };
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
    process.env = ORIGINAL_ENV;
  });

  async function call(c: (typeof CASES)[number]) {
    const { default: routes } = await import(c.module);
    const app = express();
    app.use(express.json());
    app.use(c.mount, routes);
    const server = await listen(app);
    close = server.close;
    return fetch(`${server.url}${c.path}`, {
      method: c.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(c.body),
    });
  }

  it.each(CASES)('$name: a failed audit insert rolls the change back', async (c) => {
    failAudit = true;
    const res = await call(c);
    expect(res.status).toBe(500);
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it.each(CASES)('$name: on success the change and audit row share one transaction', async (c) => {
    const res = await call(c);
    expect(res.status).toBeLessThan(300);
    const begin = statements.indexOf('BEGIN');
    const audit = statements.findIndex((s) => s.startsWith('INSERT INTO admin_logs'));
    const commit = statements.indexOf('COMMIT');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(audit).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(audit);
  });
});

describe('auditSafe', () => {
  it('removes what JSONB rejects (NUL, lone surrogates) at any depth', async () => {
    const { auditSafe } = await import('../lib/adminLog');
    const cleaned = auditSafe({ name: 'a\u0000b\ud800c', nested: [{ v: '\udfffx' }], ok: 'é😀' });
    expect(cleaned).toEqual({ name: 'ab�c', nested: [{ v: '�x' }], ok: 'é😀' });
    expect(JSON.stringify(cleaned)).not.toMatch(/\\u0000|\\ud[89a-f][0-9a-f]{2}/i);
  });
});
