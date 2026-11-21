import { describe, it, expect } from 'vitest';
import { evaluateAddress, assertTargetAllowed, createGuardedLookup } from '../urlGuard';

// IPv6 forms that carry an IPv4 destination must be judged by (or refused for)
// that destination, never treated as public by default.
const EMBEDDED = {
  'NAT64 loopback': '64:ff9b::7f00:1',
  'NAT64 RFC 1918': '64:ff9b::a00:5',
  'NAT64 metadata': '64:ff9b::a9fe:a9fe',
  'NAT64 local-use': '64:ff9b:1::a00:5',
  '6to4 loopback': '2002:7f00:1::1',
  '6to4 RFC 1918': '2002:a00:5::1',
  'Teredo': '2001:0:4136:e378:8000:63bf:3fff:fdd2',
  'IPv4-compatible': '::7f00:1',
  'IPv4-translated': '::ffff:0:7f00:1',
  'documentation': '2001:db8::1',
};

describe('IPv6 classification', () => {
  it.each(Object.entries(EMBEDDED))('refuses %s (%s)', (_label, address) => {
    expect(evaluateAddress(address, { allowPrivate: false })).not.toBeNull();
    expect(() => assertTargetAllowed('http:', `[${address}]`, { allowPrivate: false })).toThrow(/SSRF guard/);
  });

  it('refuses them through the guarded lookup too', async () => {
    for (const address of Object.values(EMBEDDED)) {
      const lookup = createGuardedLookup({ allowPrivate: false }, (_h, cb) => cb(null, [{ address, family: 6 }]));
      const err = await new Promise<Error | null>((resolve) => lookup('x.test', {}, (e) => resolve(e)));
      expect(err?.message).toMatch(/SSRF guard/);
    }
  });

  it('with private targets allowed, still refuses metadata reached via NAT64', () => {
    expect(evaluateAddress('64:ff9b::a9fe:a9fe', { allowPrivate: true })).toMatch(/metadata/);
    expect(evaluateAddress('64:ff9b::a00:5', { allowPrivate: true })).toBeNull();
  });

  it('allows a public IPv4 host reached via NAT64, and ordinary global IPv6', () => {
    expect(evaluateAddress('64:ff9b::808:808', { allowPrivate: false })).toBeNull();
    expect(evaluateAddress('2606:4700:4700::1111', { allowPrivate: false })).toBeNull();
  });
});
