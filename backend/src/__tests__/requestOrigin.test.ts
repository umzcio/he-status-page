import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireFirstPartyJson, allowCrossSiteNavigationOnly } from '../lib/requestOrigin';
import { listen } from './helpers';

// Node's fetch() adds its own Sec-Fetch-* headers, so requests here go through
// http.request to send exactly the headers a browser would.
function send(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const req = http.request(url, { method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

describe('cross-site request rejection', () => {
  let url: string;
  let close: () => Promise<void>;
  let reached: number;

  beforeEach(async () => {
    reached = 0;
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.post('/subscribe', requireFirstPartyJson, (_req, res) => {
      reached++;
      res.json({ ok: true });
    });
    // Same order as index.ts: the cross-site check runs before the limiter.
    const sso = rateLimit({ windowMs: 60_000, max: 15 });
    app.get('/sso/login', allowCrossSiteNavigationOnly, sso, (_req, res) => {
      reached++;
      res.json({ ok: true });
    });
    ({ url, close } = await listen(app));
  });

  afterEach(async () => {
    await close();
  });

  it('refuses a cross-site form post before the handler runs', async () => {
    const res = await send(`${url}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' },
      body: 'email=victim%40example.edu',
    });
    expect(res.status).toBe(403);
    expect(reached).toBe(0);
  });

  it('refuses form-encoded bodies even without Fetch Metadata (older browsers)', async () => {
    const res = await send(`${url}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"email":"victim@example.edu"}',
    });
    expect(res.status).toBe(415);
    expect(reached).toBe(0);
  });

  it('accepts the first-party JSON request', async () => {
    const res = await send(`${url}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ email: 'me@example.edu' }),
    });
    expect(res.status).toBe(200);
  });

  it("other sites' background requests can't spend a visitor's SSO budget", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await send(`${url}/sso/login`, {
        headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'image' },
      });
      expect(res.status).toBe(403);
    }
    // The visitor's own sign-in still goes through.
    const res = await send(`${url}/sso/login`, {
      headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' },
    });
    expect(res.status).toBe(200);
  });

  it('lets an IdP redirect (a cross-site navigation) through', async () => {
    const res = await send(`${url}/sso/login`, {
      headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' },
    });
    expect(res.status).toBe(200);
  });
});
