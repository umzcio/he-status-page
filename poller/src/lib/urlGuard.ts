import { lookup } from 'dns/promises';
import net from 'net';

/**
 * SSRF guard for admin-configurable status endpoints.
 *
 * `status_api_endpoint` values are configurable by super admins, so a malicious or
 * compromised admin could otherwise point the poller at internal hosts or cloud
 * metadata services and read the responses back out of `poller_logs`. This module
 * resolves the endpoint's hostname and classifies every resulting address, rejecting
 * anything that isn't a legitimate public monitoring target.
 *
 * Only http:/https: endpoints are inspected. Non-URL endpoints used by internal
 * adapters (e.g. LibreNMS "device:123" / "group:5") pass through untouched.
 */

type AddressCategory =
  | 'public'
  | 'loopback'
  | 'private'
  | 'linklocal'
  | 'unspecified'
  | 'broadcast'
  | 'multicast'
  | 'reserved';

interface ParsedIP {
  version: 4 | 6;
  bytes: number[];
}

// --- IP parsing -------------------------------------------------------------

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function parseIPv6(ip: string): number[] | null {
  let s = ip.split('%')[0]; // strip any zone id

  // Handle an embedded IPv4 tail (e.g. ::ffff:169.254.169.254)
  if (s.includes('.')) {
    const idx = s.lastIndexOf(':');
    if (idx < 0) return null;
    const v4 = parseIPv4(s.slice(idx + 1));
    if (!v4) return null;
    const hi = (v4[0] << 8) | v4[1];
    const lo = (v4[2] << 8) | v4[3];
    s = `${s.slice(0, idx + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (str: string): number[] | null => {
    if (str === '') return [];
    const out: number[] = [];
    for (const g of str.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  let groups: number[];
  if (halves.length === 2) {
    const head = parseGroups(halves[0]);
    const tail = parseGroups(halves[1]);
    if (head === null || tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    const all = parseGroups(s);
    if (all === null) return null;
    groups = all;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  return bytes;
}

function ipToBytes(ip: string): ParsedIP | null {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const bytes = parseIPv4(ip);
    return bytes ? { version: 4, bytes } : null;
  }
  if (kind === 6) {
    const bytes = parseIPv6(ip);
    return bytes ? { version: 6, bytes } : null;
  }
  return null;
}

/** Reduce an IPv4-mapped IPv6 address (::ffff:a.b.c.d) to its IPv4 form. */
function reduceMapped({ version, bytes }: ParsedIP): ParsedIP {
  if (version === 6 && bytes.length === 16) {
    const first10Zero = bytes.slice(0, 10).every((b) => b === 0);
    if (first10Zero && bytes[10] === 0xff && bytes[11] === 0xff) {
      return { version: 4, bytes: bytes.slice(12) };
    }
  }
  return { version, bytes };
}

// --- Classification ---------------------------------------------------------

function classifyV4(b: number[]): AddressCategory {
  if (b.every((x) => x === 0)) return 'unspecified'; // 0.0.0.0
  if (b[0] === 127) return 'loopback'; // 127.0.0.0/8
  if (b[0] === 10) return 'private'; // 10.0.0.0/8
  if (b[0] === 172 && (b[1] & 0xf0) === 16) return 'private'; // 172.16.0.0/12
  if (b[0] === 192 && b[1] === 168) return 'private'; // 192.168.0.0/16
  if (b[0] === 169 && b[1] === 254) return 'linklocal'; // 169.254.0.0/16
  if (b[0] === 255 && b[1] === 255 && b[2] === 255 && b[3] === 255) return 'broadcast';
  if (b[0] >= 224 && b[0] <= 239) return 'multicast'; // 224.0.0.0/4
  if (b[0] === 0) return 'reserved'; // 0.0.0.0/8 "this network"
  if (b[0] === 100 && (b[1] & 0xc0) === 64) return 'reserved'; // 100.64.0.0/10 CGNAT
  if (b[0] >= 240) return 'reserved'; // 240.0.0.0/4
  // Documentation / benchmarking ranges
  if (b[0] === 192 && b[1] === 0 && b[2] === 0) return 'reserved'; // 192.0.0.0/24
  if (b[0] === 192 && b[1] === 0 && b[2] === 2) return 'reserved'; // 192.0.2.0/24
  if (b[0] === 198 && (b[1] & 0xfe) === 18) return 'reserved'; // 198.18.0.0/15
  if (b[0] === 198 && b[1] === 51 && b[2] === 100) return 'reserved'; // 198.51.100.0/24
  if (b[0] === 203 && b[1] === 0 && b[2] === 113) return 'reserved'; // 203.0.113.0/24
  return 'public';
}

function classifyV6(b: number[]): AddressCategory {
  if (b.every((x) => x === 0)) return 'unspecified'; // ::
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return 'loopback'; // ::1
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return 'linklocal'; // fe80::/10
  if ((b[0] & 0xfe) === 0xfc) return 'private'; // fc00::/7 (ULA)
  if (b[0] === 0xff) return 'multicast'; // ff00::/8
  return 'public';
}

// --- Metadata addresses (always blocked) ------------------------------------

function bytesKey(p: ParsedIP): string {
  return `${p.version}:${p.bytes.join('.')}`;
}

// Cloud instance metadata service addresses. These are ALWAYS rejected, even when
// POLLER_ALLOW_PRIVATE_ENDPOINTS is enabled, because reading them leaks credentials.
const METADATA_KEYS = new Set(
  [
    '169.254.169.254', // AWS / GCP / Azure IMDS
    '100.100.100.200', // Alibaba Cloud metadata
    'fd00:ec2::254', // AWS IMDSv6
  ]
    .map((ip) => ipToBytes(ip))
    .filter((p): p is ParsedIP => p !== null)
    .map((p) => bytesKey(reduceMapped(p))),
);

// --- Evaluation -------------------------------------------------------------

function allowPrivateEndpoints(): boolean {
  return process.env.POLLER_ALLOW_PRIVATE_ENDPOINTS === 'true';
}

/** Returns a blocking reason string, or null if the address is allowed. */
function evaluateAddress(address: string): string | null {
  const parsed = ipToBytes(address);
  if (!parsed) return `unparseable address "${address}"`;

  const reduced = reduceMapped(parsed);

  if (METADATA_KEYS.has(bytesKey(reduced))) {
    return `cloud metadata address ${address}`;
  }

  const category =
    reduced.version === 4 ? classifyV4(reduced.bytes) : classifyV6(reduced.bytes);

  switch (category) {
    case 'public':
      return null;
    case 'loopback':
    case 'private':
    case 'linklocal':
      // Campuses may legitimately monitor internal services when opted in.
      return allowPrivateEndpoints() ? null : `${category} address ${address}`;
    default:
      // unspecified, broadcast, multicast, reserved — never a valid target.
      return `${category} address ${address}`;
  }
}

/**
 * Throws a descriptive error if the endpoint resolves to a disallowed address.
 * Passes silently for allowed public endpoints and for non-http(s) endpoints.
 */
export async function assertEndpointAllowed(endpoint: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    // Not a URL at all (e.g. an internal adapter token) — nothing to guard.
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // e.g. LibreNMS "device:123" / "group:5" — not fetched over the network.
    return;
  }

  // url.hostname keeps IPv6 literals wrapped in brackets; strip them.
  let host = url.hostname;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  let addresses: string[];
  if (net.isIP(host) !== 0) {
    // Literal IP — classify directly without DNS.
    addresses = [host];
  } else {
    let resolved: Array<{ address: string }>;
    try {
      resolved = await lookup(host, { all: true });
    } catch (err: any) {
      throw new Error(
        `Endpoint blocked by SSRF guard: could not resolve host "${host}" (${err?.code || err?.message || 'DNS error'})`,
      );
    }
    if (resolved.length === 0) {
      throw new Error(`Endpoint blocked by SSRF guard: host "${host}" resolved to no addresses`);
    }
    addresses = resolved.map((r) => r.address);
  }

  for (const address of addresses) {
    const reason = evaluateAddress(address);
    if (reason) {
      throw new Error(`Endpoint blocked by SSRF guard: ${reason} (host "${host}")`);
    }
  }
}
