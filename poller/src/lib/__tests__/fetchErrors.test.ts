import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import pino from 'pino';
import { serializeError } from '@he-status/shared';
import logger from '../logger';
import { publicFetchFailureMessage } from '../fetchErrors';
import * as librenms from '../../adapters/librenms';
import * as statuspage from '../../adapters/statuspage';
import * as ellucian from '../../adapters/ellucian';
import * as google from '../../adapters/google';
import * as aws from '../../adapters/aws';
import * as apple from '../../adapters/apple';

const TOKEN = 'librenms-secret-token-value';

let server: http.Server;
let port: number;
let closedPort: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(req.url?.startsWith('/unavailable') ? 503 : 404, { 'Content-Type': 'application/json' });
    res.end('{"error":"nope"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;

  // A port with nothing listening, for ECONNREFUSED.
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  closedPort = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, LIBRENMS_API_TOKEN: TOKEN, POLLER_ALLOW_PRIVATE_ENDPOINTS: 'true' };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function failure(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure');
}

function expectNoInternals(text: string, ...tokens: string[]) {
  for (const token of ['127.0.0.1', String(port), String(closedPort), TOKEN, ...tokens]) {
    expect(text).not.toContain(token);
  }
}

describe('LibreNMS errors', () => {
  it.each([
    ['a 404', () => `http://127.0.0.1:${port}`],
    ['ECONNREFUSED', () => `http://127.0.0.1:${closedPort}`],
  ])('never carry the API token or request config (%s)', async (_label, baseUrl) => {
    process.env.LIBRENMS_URL = baseUrl();
    const err = await failure(() => librenms.fetchStatus('device:core-sw1'));

    expect(err.config).toBeUndefined();
    expect(err.request).toBeUndefined();
    const logged = JSON.stringify(serializeError(err));
    expect(logged).not.toContain(TOKEN);
    expectNoInternals(publicFetchFailureMessage(err), 'core-sw1');
  });
});

describe('the poller logger', () => {
  it('serializes errors without request config', () => {
    const serializers = (logger as any)[pino.symbols.serializersSym];
    expect(serializers.err).toBe(serializeError);
    const axiosLike = Object.assign(new Error('boom'), {
      config: { headers: { 'X-Auth-Token': TOKEN } },
      request: { _header: `X-Auth-Token: ${TOKEN}` },
      response: { status: 500, config: { headers: { 'X-Auth-Token': TOKEN } } },
    });
    const out = JSON.stringify(serializers.err(axiosLike));
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('"status":500');
  });
});

describe('public failure messages', () => {
  it('statuspage: an HTTP error publishes only the status code', async () => {
    const endpoint = `http://127.0.0.1:${port}/unavailable/secret-path`;
    const err = await failure(() => statuspage.fetchStatus(endpoint));
    const message = publicFetchFailureMessage(err);
    expect(message).toBe('Service unreachable (status check returned HTTP 503)');
    expectNoInternals(message, 'secret-path');
  });

  it('ellucian: an unreachable endpoint publishes a generic message', async () => {
    const err = await failure(() => ellucian.fetchStatus(`http://127.0.0.1:${closedPort}/actuator/health`));
    expect(publicFetchFailureMessage(err)).toBe('Service unreachable');
  });

  it('a blocked endpoint does not name the address', async () => {
    process.env.POLLER_ALLOW_PRIVATE_ENDPOINTS = 'false';
    const err = await failure(() => statuspage.fetchStatus(`http://127.0.0.1:${port}/`));
    expectNoInternals(publicFetchFailureMessage(err));
  });

  it.each([
    ['google', google],
    ['aws', aws],
    ['apple', apple],
  ])('%s probe errors are not published', (_name, adapter) => {
    const result = adapter.normalizeStatus({
      source: 'http_probe',
      status_code: 0,
      ok: false,
      error: `connect ECONNREFUSED 10.1.2.3:8443 (host "internal.example.edu")`,
    });
    expect(result.message).not.toMatch(/10\.1\.2\.3|internal\.example\.edu|8443/);
  });
});
