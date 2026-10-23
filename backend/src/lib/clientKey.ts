import { parseIp } from '@he-status/shared';

// Rate-limit key for a client address. An IPv6 client typically controls a
// whole /64, so keying on the full address would give it 2^64 fresh buckets;
// IPv6 addresses are reduced to their /64 prefix. IPv4 (including IPv4-mapped
// IPv6) is used as-is.
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const parsed = parseIp(ip);
  if (!parsed) return ip;
  if (parsed.version === 4) return parsed.bytes.join('.');
  const groups: string[] = [];
  for (let i = 0; i < 8; i += 2) {
    groups.push(((parsed.bytes[i] << 8) | parsed.bytes[i + 1]).toString(16));
  }
  return `${groups.join(':')}::/64`;
}
