import { parseIp } from '@he-status/shared';
import logger from './logger';

// Rate-limit key for a client address. An IPv6 client typically controls a
// whole /64, so keying on the full address would give it 2^64 fresh buckets;
// IPv6 addresses are reduced to their /64 prefix. IPv4 (including IPv4-mapped
// IPv6) is used as-is.
//
// Some proxies forward the client as "ip:port" or "[ipv6]:port". The port
// changes per connection, so it is stripped. A value that still isn't an
// address never becomes its own key (that would hand the client a fresh
// bucket per request): it falls into one shared bucket and is logged.

export const UNPARSEABLE_CLIENT_KEY = 'unparseable';

function stripPortAndBrackets(raw: string): string {
  const v = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracketed) return bracketed[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(v);
  if (v4WithPort) return v4WithPort[1];
  return v;
}

let warnedUnparseable = false;

export function clientKey(ip: string | undefined): string {
  const parsed = ip ? parseIp(stripPortAndBrackets(ip)) : null;
  if (!parsed) {
    if (!warnedUnparseable) {
      warnedUnparseable = true;
      logger.warn({ ip }, 'Client address is not an IP; rate limiting it in a shared bucket (check TRUST_PROXY / proxy headers)');
    }
    return UNPARSEABLE_CLIENT_KEY;
  }
  if (parsed.version === 4) return parsed.bytes.join('.');
  const groups: string[] = [];
  for (let i = 0; i < 8; i += 2) {
    groups.push(((parsed.bytes[i] << 8) | parsed.bytes[i + 1]).toString(16));
  }
  return `${groups.join(':')}::/64`;
}
