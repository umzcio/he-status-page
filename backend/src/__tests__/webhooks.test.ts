import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { listen } from './helpers';

const query = vi.fn();

vi.mock('../db/connection', () => {
  const pool = { query };
  return { __esModule: true, default: pool, pool };
});

// Authentication is covered elsewhere; act as a super_admin here.
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

describe('webhook URLs are checked when saved', () => {
  let url: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    query.mockReset();
    query.mockResolvedValue({ rows: [{ id: 'wh-1' }] });
    const { default: routes } = await import('../routes/webhooks');
    const app = express();
    app.use(express.json());
    app.use('/api/admin/webhooks', routes);
    ({ url, close } = await listen(app));
  });

  afterEach(async () => {
    await close();
  });

  function create(webhook_url: string) {
    return fetch(`${url}/api/admin/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', webhook_url }),
    });
  }

  it.each([
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest',
    'https://10.0.0.5/hook',
    'https://localhost/hook', // a hostname that resolves to loopback
    'http://hooks.example.com/hook',
  ])('rejects %s without saving it', async (webhookUrl) => {
    const res = await create(webhookUrl);
    expect(res.status).toBe(400);
    expect(query.mock.calls.some((c) => /INSERT INTO teams_webhooks/.test(c[0]))).toBe(false);
  });

  it('rejects an unsafe URL on update too', async () => {
    const res = await fetch(`${url}/api/admin/webhooks/wh-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_url: 'https://127.0.0.1/hook' }),
    });
    expect(res.status).toBe(400);
    expect(query.mock.calls.some((c) => /UPDATE teams_webhooks/.test(c[0]))).toBe(false);
  });
});
