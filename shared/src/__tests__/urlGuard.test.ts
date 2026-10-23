import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DNS so name-based cases are deterministic and offline.
vi.mock('dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'dns/promises';
import { assertEndpointAllowed } from '../urlGuard';

const mockLookup = lookup as unknown as ReturnType<typeof vi.fn>;

function resolvesTo(...addresses: string[]) {
  mockLookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

describe('urlGuard.assertEndpointAllowed', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    delete process.env.POLLER_ALLOW_PRIVATE_ENDPOINTS;
  });

  afterEach(() => {
    delete process.env.POLLER_ALLOW_PRIVATE_ENDPOINTS;
  });

  describe('name-based endpoints (mocked DNS)', () => {
    it('allows a public URL', async () => {
      resolvesTo('93.184.216.34');
      await expect(assertEndpointAllowed('https://status.example.com/api')).resolves.toBeUndefined();
      expect(mockLookup).toHaveBeenCalledWith('status.example.com', { all: true });
    });

    it('rejects a host resolving to a private address by default', async () => {
      resolvesTo('10.0.0.5');
      await expect(assertEndpointAllowed('https://internal.example.com')).rejects.toThrow(/private address/);
    });

    it('allows a private address when POLLER_ALLOW_PRIVATE_ENDPOINTS=true', async () => {
      process.env.POLLER_ALLOW_PRIVATE_ENDPOINTS = 'true';
      resolvesTo('192.168.1.20');
      await expect(assertEndpointAllowed('https://intranet.example.com')).resolves.toBeUndefined();
    });

    it('rejects when ANY resolved address is disallowed (rebinding-style)', async () => {
      resolvesTo('93.184.216.34', '169.254.169.254');
      await expect(assertEndpointAllowed('https://sneaky.example.com')).rejects.toThrow(/metadata/);
    });

    it('rejects a DNS resolution failure', async () => {
      mockLookup.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }));
      await expect(assertEndpointAllowed('https://nx.example.com')).rejects.toThrow(/could not resolve/);
    });
  });

  describe('cloud metadata addresses (always rejected)', () => {
    it('rejects 169.254.169.254 as a literal', async () => {
      await expect(assertEndpointAllowed('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/metadata/);
    });

    it('rejects 100.100.100.200 (Alibaba) as a literal', async () => {
      await expect(assertEndpointAllowed('http://100.100.100.200/')).rejects.toThrow(/metadata/);
    });

    it('rejects fd00:ec2::254 (AWS IMDSv6) as a literal', async () => {
      await expect(assertEndpointAllowed('http://[fd00:ec2::254]/')).rejects.toThrow(/metadata/);
    });

    it('rejects metadata even when POLLER_ALLOW_PRIVATE_ENDPOINTS=true', async () => {
      process.env.POLLER_ALLOW_PRIVATE_ENDPOINTS = 'true';
      await expect(assertEndpointAllowed('http://169.254.169.254/')).rejects.toThrow(/metadata/);
      await expect(assertEndpointAllowed('http://[fd00:ec2::254]/')).rejects.toThrow(/metadata/);
    });

    it('rejects an IPv4-mapped IPv6 form of a metadata address', async () => {
      await expect(assertEndpointAllowed('http://[::ffff:169.254.169.254]/')).rejects.toThrow(/metadata/);
    });
  });

  describe('literal IP endpoints (no DNS)', () => {
    it('allows a public literal IPv4', async () => {
      await expect(assertEndpointAllowed('https://93.184.216.34/')).resolves.toBeUndefined();
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects loopback 127.0.0.1 by default', async () => {
      await expect(assertEndpointAllowed('http://127.0.0.1:8080/')).rejects.toThrow(/loopback address/);
    });

    it('rejects IPv6 loopback ::1 by default', async () => {
      await expect(assertEndpointAllowed('http://[::1]/')).rejects.toThrow(/loopback address/);
    });

    it('rejects link-local 169.254.0.1 by default', async () => {
      await expect(assertEndpointAllowed('http://169.254.0.1/')).rejects.toThrow(/linklocal address/);
    });

    it('rejects unspecified 0.0.0.0 even with private endpoints allowed', async () => {
      process.env.POLLER_ALLOW_PRIVATE_ENDPOINTS = 'true';
      await expect(assertEndpointAllowed('http://0.0.0.0/')).rejects.toThrow(/unspecified address/);
    });

    it('rejects a private ULA fc00::/7 address by default', async () => {
      await expect(assertEndpointAllowed('http://[fd12:3456:789a::1]/')).rejects.toThrow(/private address/);
    });

    it('allows loopback when POLLER_ALLOW_PRIVATE_ENDPOINTS=true', async () => {
      process.env.POLLER_ALLOW_PRIVATE_ENDPOINTS = 'true';
      await expect(assertEndpointAllowed('http://127.0.0.1:3000/health')).resolves.toBeUndefined();
    });

    it('rejects broadcast 255.255.255.255', async () => {
      await expect(assertEndpointAllowed('http://255.255.255.255/')).rejects.toThrow(/broadcast address/);
    });
  });

  describe('non-URL / non-http endpoints pass through', () => {
    it('passes a LibreNMS device: endpoint', async () => {
      await expect(assertEndpointAllowed('device:123')).resolves.toBeUndefined();
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('passes a LibreNMS group: endpoint', async () => {
      await expect(assertEndpointAllowed('group:5')).resolves.toBeUndefined();
    });

    it('passes an ftp: URL (not http/https)', async () => {
      await expect(assertEndpointAllowed('ftp://example.com/file')).resolves.toBeUndefined();
    });

    it('passes an unparseable endpoint string', async () => {
      await expect(assertEndpointAllowed('not a url at all')).resolves.toBeUndefined();
    });
  });
});
