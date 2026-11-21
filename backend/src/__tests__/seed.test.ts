import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The seed script runs on import. Drive it with a fake pool and capture the
// users INSERT and the console output.
const clientQuery = vi.fn();
vi.mock('../db/connection', () => {
  const pool = {
    connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    end: vi.fn(async () => undefined),
  };
  return { __esModule: true, default: pool, pool };
});

async function runSeed(env: Record<string, string | undefined>) {
  vi.resetModules();
  clientQuery.mockReset();
  clientQuery.mockImplementation(async (sql: string) =>
    /COUNT\(\*\)::int AS count FROM services/.test(sql) ? { rows: [{ count: 1 }] } : { rows: [] }
  );
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const logs: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
  const err = vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.join(' ')));
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  await import('../db/seed');
  // Done when the script reports completion or failure.
  await vi.waitFor(() => expect(logs.join('\n')).toMatch(/Database setup complete|Seeding failed/), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 20));
  const insert = clientQuery.mock.calls.find((c) => /INSERT INTO users/.test(c[0]));
  return { insert, logs: logs.join('\n'), exited: exit.mock.calls.length > 0 };
}

describe('seed script', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.restoreAllMocks();
  });

  it('refuses to run without ADMIN_EMAIL (no default address)', async () => {
    const { insert, exited, logs } = await runSeed({ ADMIN_EMAIL: undefined, ADMIN_PASSWORD: undefined });
    expect(insert).toBeUndefined();
    expect(exited).toBe(true);
    expect(logs).toMatch(/ADMIN_EMAIL must be set/);
  });

  it.each([undefined, '', 'changeme', 'short'])('creates an SSO-only account when ADMIN_PASSWORD is %j', async (pw) => {
    const { insert, logs } = await runSeed({ ADMIN_EMAIL: 'Me@Example.edu', ADMIN_PASSWORD: pw });
    expect(insert![1]).toEqual(['me@example.edu', 'Site Admin', 'super_admin', null]);
    expect(logs).toMatch(/SSO only/);
  });

  it('hashes a strong password and never prints it', async () => {
    const { insert, logs } = await runSeed({ ADMIN_EMAIL: 'me@example.edu', ADMIN_PASSWORD: 'a-long-unique-passphrase' });
    expect(insert![1][3]).toMatch(/^\$2[aby]\$/);
    expect(logs).not.toContain('a-long-unique-passphrase');
  });
});
