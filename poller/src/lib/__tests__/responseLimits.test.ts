import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { boundedRawResponse, MAX_RAW_RESPONSE_CHARS } from '../statusUpdater';
import * as statuspage from '../../adapters/statuspage';

describe('boundedRawResponse', () => {
  it('stores small results as-is', () => {
    expect(boundedRawResponse({ status: { indicator: 'none' } })).toBe('{"status":{"indicator":"none"}}');
    expect(boundedRawResponse(null)).toBeNull();
  });

  it('replaces oversized results with a bounded marker', () => {
    const huge = { components: Array.from({ length: 50_000 }, (_, i) => ({ id: i, name: `component-${i}` })) };
    const stored = boundedRawResponse(huge)!;
    expect(stored.length).toBeLessThan(MAX_RAW_RESPONSE_CHARS);
    const parsed = JSON.parse(stored);
    expect(parsed.truncated).toBe(true);
    expect(parsed.original_length).toBeGreaterThan(MAX_RAW_RESPONSE_CHARS);
  });
});

describe('statuspage adapter', () => {
  let server: http.Server;
  let port: number;
  const ORIGINAL_ENV = process.env;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      // A multi-megabyte "Statuspage" document.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: { indicator: 'none', description: 'x'.repeat(3 * 1024 * 1024) } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, POLLER_ALLOW_PRIVATE_ENDPOINTS: 'true' };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('fails the check when the body exceeds the size cap', async () => {
    await expect(statuspage.fetchStatus(`http://127.0.0.1:${port}/api/v2/status.json`)).rejects.toThrow(
      /maxContentLength/
    );
  });

  it('normalizes a non-string or oversized description to bounded plain text', () => {
    expect(statuspage.normalizeStatus({ status: { indicator: 'minor', description: { a: 1 } as any } }).message).toBe(
      'Status unknown'
    );
    const long = statuspage.normalizeStatus({ status: { indicator: 'minor', description: 'z'.repeat(10_000) } });
    expect(long.message.length).toBeLessThanOrEqual(500);
  });
});
