import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { listen } from './helpers';

const query = vi.fn();

vi.mock('../db/connection', () => {
  const pool = { query };
  return { __esModule: true, default: pool, pool };
});

const sendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  isEmailConfigured: () => true,
}));

const VISIBLE = '11111111-1111-4111-8111-111111111111';
const HIDDEN = '22222222-2222-4222-8222-222222222222';

let existing: Record<string, unknown> | null;
let inserted: Array<[string, string]>;

function fakeQuery(sql: string, params: unknown[] = []) {
  if (/FROM services WHERE visible IS NOT false AND id = ANY/.test(sql)) {
    const requested = params[0] as string[];
    return Promise.resolve({ rows: requested.filter((id) => id === VISIBLE).map((id) => ({ id })) });
  }
  if (/FROM services WHERE visible IS NOT false/.test(sql)) {
    return Promise.resolve({ rows: [{ id: VISIBLE }] });
  }
  if (/FROM subscriptions WHERE email/.test(sql)) {
    return Promise.resolve({ rows: existing ? [existing] : [] });
  }
  if (/INSERT INTO subscriptions/.test(sql)) {
    return Promise.resolve({ rows: [{ id: 'new-sub' }] });
  }
  if (/INSERT INTO subscription_services/.test(sql)) {
    inserted.push([params[0] as string, params[1] as string]);
  }
  if (/UPDATE subscriptions\s+SET verified = true/.test(sql)) {
    return Promise.resolve({ rows: [{ email: '"<meta http-equiv=refresh content=0;url=//evil>"@example.edu' }] });
  }
  return Promise.resolve({ rows: [] });
}

describe('public subscriptions', () => {
  const ORIGINAL_ENV = process.env;
  let url: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    query.mockReset();
    query.mockImplementation(fakeQuery);
    sendEmail.mockClear();
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'a-valid-secret-that-is-long-enough' };
    delete process.env.TURNSTILE_SECRET_KEY;
    existing = null;
    inserted = [];

    const { default: routes } = await import('../routes/subscriptions');
    const app = express();
    app.use(express.json());
    app.use('/api/subscriptions', routes);
    ({ url, close } = await listen(app));
  });

  afterEach(async () => {
    await close();
    process.env = ORIGINAL_ENV;
  });

  function subscribe(body: Record<string, unknown>) {
    return fetch(`${url}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('answers byte-identically whatever state the address is in', async () => {
    const states: Array<Record<string, unknown> | null> = [
      null,
      { id: 's1', verified: false, unsubscribed_at: null, verification_token: 't' },
      { id: 's1', verified: true, unsubscribed_at: null, verification_token: 't' },
      { id: 's1', verified: true, unsubscribed_at: new Date().toISOString(), verification_token: 't' },
    ];
    const bodies: string[] = [];
    for (const state of states) {
      existing = state;
      const res = await subscribe({ email: 'someone@example.edu' });
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('enrols a default subscription in visible services only', async () => {
    await subscribe({ email: 'someone@example.edu' });
    await vi.waitFor(() => expect(inserted).toEqual([['new-sub', VISIBLE]]));
  });

  it('drops hidden service ids from an explicit list', async () => {
    await subscribe({ email: 'someone@example.edu', service_ids: [VISIBLE, HIDDEN] });
    await vi.waitFor(() => expect(inserted).toEqual([['new-sub', VISIBLE]]));
  });

  it('answers before doing any state-dependent database work', async () => {
    // If the response waited on the subscription lookup or writes, a stalled
    // database would stall the response; timing would then vary by state.
    query.mockImplementation(() => new Promise(() => {}));
    const res = await subscribe({ email: 'someone@example.edu' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });

  it('rejects service ids that are not UUIDs', async () => {
    const res = await subscribe({ email: 'someone@example.edu', service_ids: ['nope'] });
    expect(res.status).toBe(400);
  });

  it('escapes the stored address on the verification page', async () => {
    const res = await fetch(`${url}/api/subscriptions/verify/some-token`);
    const html = await res.text();
    expect(html).not.toContain('<meta');
    expect(html).toContain('&lt;meta http-equiv=refresh');
  });
});
