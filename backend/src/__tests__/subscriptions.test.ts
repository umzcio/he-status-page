import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { listen } from './helpers';

// The pg pool is replaced by a small in-memory model of the tables the
// subscription routes use, enough to exercise the throttle, the token/selection
// pairing and the verification page.
const query = vi.fn();

vi.mock('../db/connection', () => {
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }),
  };
  return { __esModule: true, default: pool, pool };
});

const sendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/email', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  isEmailConfigured: () => true,
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const HIDDEN = '22222222-2222-4222-8222-222222222222';
const SERVICES = [
  { id: A, name: 'Alpha', visible: true },
  { id: B, name: 'Beta', visible: true },
  { id: HIDDEN, name: 'Hidden', visible: false },
];

interface Sub {
  id: string;
  email: string;
  verification_token: string;
  verified: boolean;
  unsubscribed_at: Date | null;
  verification_sent_at: Date | null;
}
let subs: Sub[];
let links: Array<[string, string]>;
let mailHits: number;
let nextId: number;

function fakeQuery(sql: string, params: unknown[] = []) {
  const rows = (r: unknown[]) => Promise.resolve({ rows: r });
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return rows([]);
  if (/FROM services WHERE visible IS NOT false AND id = ANY/.test(sql)) {
    const ids = params[0] as string[];
    return rows(SERVICES.filter((s) => s.visible && ids.includes(s.id)));
  }
  if (/FROM services WHERE visible IS NOT false/.test(sql)) return rows(SERVICES.filter((s) => s.visible));
  if (/INSERT INTO rate_limits/.test(sql)) return rows([{ hits: ++mailHits, reset_at: new Date() }]);
  if (/FROM subscriptions WHERE lower\(email\) = \$1/.test(sql)) {
    return rows(subs.filter((s) => s.email === params[0]));
  }
  if (/UPDATE subscriptions\s+SET verification_token = \$2/.test(sql)) {
    const sub = subs.find((s) => s.id === params[0])!;
    const free = !sub.verification_sent_at || Date.now() - sub.verification_sent_at.getTime() > 3600_000;
    if (!free || (sub.verified && !sub.unsubscribed_at)) return rows([]);
    Object.assign(sub, { verification_token: params[1], verification_sent_at: new Date(), verified: false, unsubscribed_at: null });
    return rows([{ id: sub.id }]);
  }
  if (/INSERT INTO subscriptions/.test(sql)) {
    if (subs.some((s) => s.email === params[0])) return rows([]);
    const sub: Sub = {
      id: `sub-${nextId++}`, email: params[0] as string, verification_token: params[1] as string,
      verified: false, unsubscribed_at: null, verification_sent_at: new Date(),
    };
    subs.push(sub);
    return rows([{ id: sub.id }]);
  }
  if (/DELETE FROM subscription_services/.test(sql)) {
    links = links.filter(([sid]) => sid !== params[0]);
    return rows([]);
  }
  if (/INSERT INTO subscription_services/.test(sql)) {
    links.push([params[0] as string, params[1] as string]);
    return rows([]);
  }
  if (/UPDATE subscriptions\s+SET verified = true/.test(sql)) {
    const sub = subs.find((s) => s.verification_token === params[0] && !s.verified);
    if (!sub) return rows([]);
    sub.verified = true;
    return rows([sub]);
  }
  if (/FROM subscription_services ss JOIN services s/.test(sql)) {
    return rows(
      links.filter(([sid]) => sid === params[0]).map(([, svc]) => SERVICES.find((s) => s.id === svc)!)
    );
  }
  return rows([]);
}

function servicesOf(email: string): string[] {
  const sub = subs.find((s) => s.email === email)!;
  return links.filter(([sid]) => sid === sub.id).map(([, svc]) => svc).sort();
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
    subs = [];
    links = [];
    mailHits = 0;
    nextId = 1;

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

  async function settle() {
    // Processing runs after the response; wait for it to go quiet.
    await new Promise((r) => setTimeout(r, 30));
  }

  it.each([
    'someone @example.edu',
    'someone x@example.edu',
    '"<meta>"@example.edu',
    'a@example.edu, b@evil.com',
    'Victim <victim@example.edu>',
    'someone@example.edu.evil.com',
    'someone@example.education',
    'a\tb@example.edu',
  ])('refuses %j with 400 and sends nothing', async (email) => {
    const res = await subscribe({ email });
    expect(res.status).toBe(400);
    await settle();
    expect(subs).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('answers identically whatever state the address is in', async () => {
    const bodies: string[] = [];
    for (const state of ['new', 'pending', 'verified']) {
      if (state === 'verified') subs[0].verified = true;
      const res = await subscribe({ email: 'someone@example.edu' });
      expect(res.status).toBe(200);
      bodies.push(await res.text());
      await settle();
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('mails each address at most once per interval, however many requests arrive', async () => {
    for (let i = 0; i < 5; i++) await subscribe({ email: 'victim@example.edu' });
    await settle();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('victim@example.edu');
  });

  it('enrols visible services only and lists them in the confirmation mail', async () => {
    await subscribe({ email: 'someone@example.edu', service_ids: [A, HIDDEN] });
    await settle();
    expect(servicesOf('someone@example.edu')).toEqual([A]);
    const html: string = sendEmail.mock.calls[0][0].html;
    expect(html).toContain('Alpha');
    expect(html).not.toContain('Hidden');
  });

  it('never creates a subscription that covers nothing', async () => {
    await subscribe({ email: 'someone@example.edu', service_ids: [HIDDEN] });
    await settle();
    expect(subs).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a later request can't change what an earlier mailed link activates", async () => {
    await subscribe({ email: 'owner@example.edu', service_ids: [A] });
    await settle();
    const firstToken = subs[0].verification_token;

    // Inside the throttle interval: no mail, so nothing may change.
    await subscribe({ email: 'owner@example.edu', service_ids: [B] });
    await settle();
    expect(subs[0].verification_token).toBe(firstToken);
    expect(servicesOf('owner@example.edu')).toEqual([A]);

    // After the interval, a new request issues a new token with its own
    // selection; the old link stops working.
    subs[0].verification_sent_at = new Date(Date.now() - 2 * 3600_000);
    await subscribe({ email: 'owner@example.edu', service_ids: [B] });
    await settle();
    expect(subs[0].verification_token).not.toBe(firstToken);
    expect(servicesOf('owner@example.edu')).toEqual([B]);
    expect((await fetch(`${url}/api/subscriptions/verify/${firstToken}`)).status).toBe(400);
  });

  it('rejects service ids that are not UUIDs', async () => {
    const res = await subscribe({ email: 'someone@example.edu', service_ids: ['nope'] });
    expect(res.status).toBe(400);
  });

  it('the verification page escapes values and shows what was confirmed', async () => {
    await subscribe({ email: 'someone@example.edu', service_ids: [A] });
    await settle();
    subs[0].email = '"<meta http-equiv=refresh content=0;url=//evil>"@example.edu'; // a legacy row
    const html = await (await fetch(`${url}/api/subscriptions/verify/${subs[0].verification_token}`)).text();
    expect(html).not.toContain('<meta');
    expect(html).toContain('&lt;meta http-equiv=refresh');
    expect(html).toContain('Alpha');
    expect(html).toMatch(/unsubscribe\//);
  });

  it('answers before doing any state-dependent database work', async () => {
    query.mockImplementation(() => new Promise(() => {}));
    const res = await subscribe({ email: 'someone@example.edu' });
    expect(res.status).toBe(200);
  });
});
