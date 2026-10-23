import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import { resolveTrustProxy } from '../lib/trustProxy';
import { listen } from './helpers';

describe('backend/src/lib/trustProxy', () => {
  it('defaults to trusting loopback only', () => {
    expect(resolveTrustProxy({})).toEqual({ value: ['loopback'], warnings: [] });
  });

  it('accepts a comma-separated list of names, IPs and CIDRs', () => {
    const { value, warnings } = resolveTrustProxy({ TRUST_PROXY: 'loopback, 10.0.0.5,172.16.0.0/12' });
    expect(value).toEqual(['loopback', '10.0.0.5', '172.16.0.0/12']);
    expect(warnings).toEqual([]);
  });

  it('allows disabling proxy trust entirely', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: 'false' }).value).toBe(false);
  });

  it('refuses hop counts and "true", which trust any peer', () => {
    const counted = resolveTrustProxy({ TRUST_PROXY: '1' });
    expect(counted.value).toEqual(['loopback']);
    expect(counted.warnings[0]).toMatch(/hop counts/);

    const all = resolveTrustProxy({ TRUST_PROXY: 'true,10.0.0.5' });
    expect(all.value).toEqual(['10.0.0.5']);
    expect(all.warnings).toHaveLength(1);
  });

  it('ignores the legacy TRUST_PROXY_HOPS with a warning', () => {
    const { value, warnings } = resolveTrustProxy({ TRUST_PROXY_HOPS: '1' });
    expect(value).toEqual(['loopback']);
    expect(warnings[0]).toMatch(/TRUST_PROXY_HOPS is no longer supported/);
  });

  describe('with Express', () => {
    let close: (() => Promise<void>) | undefined;
    afterEach(async () => {
      await close?.();
      close = undefined;
    });

    async function ipSeenWith(env: NodeJS.ProcessEnv, forwardedFor: string): Promise<string> {
      const app = express();
      app.set('trust proxy', resolveTrustProxy(env).value);
      app.get('/ip', (req, res) => res.send(req.ip));
      const server = await listen(app);
      close = server.close;
      const res = await fetch(`${server.url}/ip`, { headers: { 'X-Forwarded-For': forwardedFor } });
      return res.text();
    }

    it('ignores X-Forwarded-For from a peer that is not a listed proxy', async () => {
      // The test client connects from 127.0.0.1, which is not 10.0.0.5.
      const ip = await ipSeenWith({ TRUST_PROXY: '10.0.0.5' }, '203.0.113.9');
      expect(ip).toMatch(/127\.0\.0\.1$/);
    });

    it('honours X-Forwarded-For from a listed proxy', async () => {
      const ip = await ipSeenWith({}, '203.0.113.9');
      expect(ip).toBe('203.0.113.9');
    });
  });
});
