import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { createGuardedHttpClient, createGuardedLookup } from '../urlGuard';

// Local servers count the connections they accept, so each test can prove the
// guard refused BEFORE a socket was opened, not merely after.
interface TestServer {
  port: number;
  connections: () => number;
  close: () => Promise<void>;
}

function startServer(handler: http.RequestListener): Promise<TestServer> {
  return new Promise((resolve) => {
    let count = 0;
    const server = http.createServer(handler);
    server.on('connection', () => count++);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        connections: () => count,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function server(handler: http.RequestListener): Promise<TestServer> {
  const s = await startServer(handler);
  servers.push(s);
  return s;
}

describe('createGuardedLookup', () => {
  it('rejects when any resolved address is blocked', async () => {
    const lookup = createGuardedLookup({ allowPrivate: false }, (_h, cb) =>
      cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }])
    );
    const err = await new Promise<Error | null>((resolve) => lookup('mixed.test', {}, (e) => resolve(e)));
    expect(err?.message).toMatch(/private address 10\.0\.0\.5/);
  });

  it('passes vetted addresses through', async () => {
    const lookup = createGuardedLookup({ allowPrivate: false }, (_h, cb) =>
      cb(null, [{ address: '93.184.216.34', family: 4 }])
    );
    const addrs = await new Promise((resolve) => lookup('ok.test', {}, (_e, a) => resolve(a)));
    expect(addrs).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });
});

describe('createGuardedHttpClient', () => {
  it('refuses a literal private IP without connecting', async () => {
    const target = await server((_req, res) => res.end('secret'));
    const client = createGuardedHttpClient({ allowPrivate: false });
    await expect(client.get(`http://127.0.0.1:${target.port}/`)).rejects.toThrow(/SSRF guard: loopback/);
    expect(target.connections()).toBe(0);
  });

  it('validates the very answer the socket connects with (DNS rebinding)', async () => {
    // A rebinding attacker answers "public" to an earlier check and loopback to
    // the fetch. The guard runs inside the fetch's own lookup, so it sees the
    // loopback answer the socket would use: refused, nothing connects.
    const target = await server((_req, res) => res.end('secret'));
    const lookups: string[] = [];
    const client = createGuardedHttpClient({
      allowPrivate: false,
      resolve: (host, cb) => {
        lookups.push(host);
        cb(null, [{ address: '127.0.0.1', family: 4 }]);
      },
    });
    await expect(client.get(`http://rebind.test:${target.port}/`)).rejects.toThrow(/SSRF guard: loopback/);
    expect(lookups).toEqual(['rebind.test']);
    expect(target.connections()).toBe(0);
  });

  it('re-checks a redirect to a literal metadata address', async () => {
    const origin = await server((_req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    const client = createGuardedHttpClient({ allowPrivate: true });
    await expect(client.get(`http://127.0.0.1:${origin.port}/`)).rejects.toThrow(/cloud metadata address/);
  });

  it('re-checks a redirect to a hostname at connect time', async () => {
    const internal = await server((_req, res) => res.end('secret'));
    const origin = await server((_req, res) => {
      res.writeHead(302, { Location: `http://internal.test:${internal.port}/` });
      res.end();
    });
    const client = createGuardedHttpClient({
      allowPrivate: true,
      resolve: (host, cb) =>
        cb(null, [{ address: host === 'internal.test' ? '169.254.169.254' : '127.0.0.1', family: 4 }]),
    });
    await expect(client.get(`http://origin.test:${origin.port}/`)).rejects.toThrow(/cloud metadata address/);
    expect(internal.connections()).toBe(0);
  });

  it('refuses non-http protocols on redirect', async () => {
    const origin = await server((_req, res) => {
      res.writeHead(302, { Location: 'file:///etc/passwd' });
      res.end();
    });
    const client = createGuardedHttpClient({ allowPrivate: true });
    await expect(client.get(`http://127.0.0.1:${origin.port}/`)).rejects.toThrow();
  });

  it('fetches an allowed target normally', async () => {
    const target = await server((_req, res) => res.end('{"ok":true}'));
    const client = createGuardedHttpClient({ allowPrivate: true });
    const res = await client.get(`http://127.0.0.1:${target.port}/`);
    expect(res.data).toEqual({ ok: true });
  });

  it('enforces a wall-clock deadline on a slowly trickled body', async () => {
    // Headers at once, then one byte every 100 ms: the inactivity timeout never
    // fires, so only the overall deadline can end the request.
    const timers: NodeJS.Timeout[] = [];
    const drip = await server((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const t = setInterval(() => res.write(' '), 100);
      timers.push(t);
      res.on('close', () => clearInterval(t));
    });
    const client = createGuardedHttpClient({ allowPrivate: true, deadlineMs: 500 });
    const started = Date.now();
    await expect(client.get(`http://127.0.0.1:${drip.port}/`, { timeout: 10_000 })).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
    expect(Date.now() - started).toBeLessThan(3000);
    timers.forEach(clearInterval);
  });
});
