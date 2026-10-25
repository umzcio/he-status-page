import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { createCheckRunner } from '../checkRunner';
import { throwIfCheckAborted } from '../checkContext';
import { endpointHttp } from '../endpointHttp';
import * as librenms from '../../adapters/librenms';

// A server that sends headers and then trickles forever, counting requests
// and how many of them the client gave up on.
let server: http.Server;
let port: number;
let requests: string[];
let closedEarly: number;
let groupReply: unknown;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url || '');
    if (req.url?.startsWith('/api/v0/devicegroups/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(groupReply));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const t = setInterval(() => res.write(' '), 50);
    res.on('close', () => {
      clearInterval(t);
      if (!res.writableEnded) closedEarly++;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  requests = [];
  closedEarly = 0;
  process.env = {
    ...ORIGINAL_ENV,
    POLLER_ALLOW_PRIVATE_ENDPOINTS: 'true',
    LIBRENMS_URL: `http://127.0.0.1:${port}`,
    LIBRENMS_API_TOKEN: 'token',
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

const service = { id: 'svc-1', name: 'Stalled' };

describe('createCheckRunner', () => {
  it('cancels the check at its deadline: requests aborted, nothing written afterwards', async () => {
    const writes: string[] = [];
    const runner = createCheckRunner(async () => {
      await endpointHttp.get(`http://127.0.0.1:${port}/drip`, { timeout: 10_000 }).catch(() => undefined);
      throwIfCheckAborted();
      writes.push('status update');
    }, 300);

    const started = Date.now();
    await runner.run(service);
    expect(Date.now() - started).toBeLessThan(2000);

    await expect.poll(() => closedEarly, { timeout: 2000 }).toBe(1); // the socket was torn down
    await expect.poll(() => runner.inFlight(), { timeout: 2000 }).toBe(0);
    expect(writes).toEqual([]);
  });

  it('runs at most one check per service at a time', async () => {
    let calls = 0;
    let release!: () => void;
    const runner = createCheckRunner(async () => {
      calls++;
      await new Promise<void>((resolve) => (release = resolve));
    }, 10_000);

    const first = runner.run(service);
    await runner.run(service); // skipped: the first is still running
    expect(calls).toBe(1);
    release();
    await first;
    expect(runner.inFlight()).toBe(0);
  });
});

describe('LibreNMS group checks', () => {
  it('make one request however many devices the group lists', async () => {
    groupReply = {
      devices: Array.from({ length: 5000 }, (_, i) => ({
        device_id: i,
        status: i % 2,
        disabled: 0,
        ignore: 0,
        hostname: `host-${i}`,
        community: 'secret',
      })),
    };
    const result = await librenms.fetchStatus('group:Core');
    expect(requests).toEqual(['/api/v0/devicegroups/Core?full=1']);
    expect(result.devices).toHaveLength(5000);
    // Only the fields the status needs are kept.
    expect(Object.keys(result.devices![0]).sort()).toEqual(['device_id', 'disabled', 'ignore', 'status']);
  });

  it('fail clearly when LibreNMS returns ids only', async () => {
    groupReply = { devices: [{ device_id: 1 }, { device_id: 2 }] };
    await expect(librenms.fetchStatus('group:Core')).rejects.toThrow(/full=1 unsupported/);
    expect(requests).toHaveLength(1);
  });
});
