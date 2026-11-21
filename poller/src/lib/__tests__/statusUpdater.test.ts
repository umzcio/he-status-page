import { describe, it, expect, beforeEach, vi } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => {
  const pool = { query, connect: vi.fn() };
  return { __esModule: true, default: pool, pool };
});

describe('refreshAutomatedStatus', () => {
  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
  });

  it('replaces a stale automated message in the status and the open history row', async () => {
    query.mockImplementation(async (sql: string) =>
      /UPDATE service_status SET status_message/.test(sql) ? { rows: [{ service_id: 's1' }] } : { rows: [] }
    );
    const { refreshAutomatedStatus } = await import('../statusUpdater');
    await refreshAutomatedStatus('s1', 'Service unreachable');

    const sqls = query.mock.calls.map((c) => c[0] as string);
    const statusUpdate = sqls.find((s) => /UPDATE service_status SET status_message/.test(s))!;
    // Only automated, non-overridden rows whose text actually differs.
    expect(statusUpdate).toMatch(/override_active = false/);
    expect(statusUpdate).toMatch(/status_source = 'automated'/);
    expect(statusUpdate).toMatch(/IS DISTINCT FROM/);
    expect(sqls.some((s) => /UPDATE status_history SET status_message/.test(s) && /ended_at IS NULL/.test(s))).toBe(true);
  });

  it('leaves history alone when nothing changed', async () => {
    query.mockResolvedValue({ rows: [] });
    const { refreshAutomatedStatus } = await import('../statusUpdater');
    await refreshAutomatedStatus('s1', 'System is operational');
    expect(query.mock.calls.some((c) => /UPDATE status_history/.test(c[0]))).toBe(false);
  });
});
