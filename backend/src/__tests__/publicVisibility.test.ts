import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { listen } from './helpers';

// Public service/incident routes must treat hidden services as nonexistent and
// never return monitoring config. The fake pool models two services, one
// hidden, and honours the visibility predicates the routes are expected to use.
const query = vi.fn();

vi.mock('../db/connection', () => {
  const pool = { query };
  return { __esModule: true, default: pool, pool };
});

const VISIBLE = '11111111-1111-4111-8111-111111111111';
const HIDDEN = '22222222-2222-4222-8222-222222222222';
const services: Record<string, { visible: boolean }> = {
  [VISIBLE]: { visible: true },
  [HIDDEN]: { visible: false },
};

function fakeQuery(sql: string, params: unknown[] = []) {
  const id = params[0] as string;
  const svc = services[id];
  const filtersVisible = /visible IS NOT false/.test(sql);
  const allowed = svc && (svc.visible || !filtersVisible);

  if (/SELECT 1 FROM services WHERE id = \$1/.test(sql)) {
    return Promise.resolve({ rows: allowed ? [{ '?column?': 1 }] : [] });
  }
  if (/FROM services s/.test(sql) && /WHERE s\.id = \$1/.test(sql)) {
    if (!allowed) return Promise.resolve({ rows: [] });
    // Return what the selected column list asks for, plus anything `s.*` would add.
    const row: Record<string, unknown> = { id, name: 'Svc', status: 'operational' };
    if (/s\.\*/.test(sql)) Object.assign(row, { status_api_endpoint: 'https://internal', visible: svc.visible });
    return Promise.resolve({ rows: [row] });
  }
  if (/FROM incidents i/.test(sql)) {
    // An incident exists on the hidden service; only a JOIN with the
    // visibility predicate keeps it out.
    const joinsVisible = /JOIN services s ON i\.service_id = s\.id AND s\.visible IS NOT false/.test(sql);
    if (/COUNT\(\*\)/.test(sql)) return Promise.resolve({ rows: [{ total: joinsVisible ? 0 : 1 }] });
    return Promise.resolve({ rows: joinsVisible ? [] : [{ id: 'inc-1', service_id: HIDDEN, updates: [] }] });
  }
  return Promise.resolve({ rows: [] });
}

describe('public visibility of hidden services', () => {
  let url: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    query.mockReset();
    query.mockImplementation(fakeQuery);
    const { default: servicesRoutes } = await import('../routes/services');
    const { default: incidentsRoutes } = await import('../routes/incidents');
    const app = express();
    app.use('/api/services', servicesRoutes);
    app.use('/api/incidents', incidentsRoutes);
    ({ url, close } = await listen(app));
  });

  afterEach(async () => {
    await close();
  });

  it('service detail omits monitoring config', async () => {
    const res = await fetch(`${url}/api/services/${VISIBLE}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const key of ['status_api_endpoint', 'status_api_type', 'check_enabled', 'check_interval_minutes', 'visible']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it.each(['', '/uptime', '/history'])('GET /api/services/<hidden>%s is 404', async (suffix) => {
    const res = await fetch(`${url}/api/services/${HIDDEN}${suffix}`);
    expect(res.status).toBe(404);
  });

  it('a malformed service id is 404, not 500', async () => {
    expect((await fetch(`${url}/api/services/not-a-uuid`)).status).toBe(404);
  });

  it('incidents on hidden services are not listed', async () => {
    const res = await fetch(`${url}/api/incidents`);
    expect(await res.json()).toEqual({ incidents: [], total: 0 });
  });

  it('an incident on a hidden service is 404 by id', async () => {
    const res = await fetch(`${url}/api/incidents/33333333-3333-4333-8333-333333333333`);
    expect(res.status).toBe(404);
  });
});
