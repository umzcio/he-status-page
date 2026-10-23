import { describe, it, expect } from 'vitest';
import { libreNmsSegment, parseLibreNmsEndpoint } from '../librenms';

describe('libreNmsSegment', () => {
  it('encodes ordinary hostnames, ids and names', () => {
    expect(libreNmsSegment('core-sw1.example.edu')).toBe('core-sw1.example.edu');
    expect(libreNmsSegment('42')).toBe('42');
    expect(libreNmsSegment('a&b')).toBe('a%26b');
    expect(libreNmsSegment('Data Center')).toBe('Data%20Center');
  });

  it.each(['', '.', '..', 'x/discover', '../system', '..%2Fdevices%2Fx%2Fdiscover', 'a?b', 'a#b', 'a\\b', 'a\nb'])(
    'rejects %j',
    (value) => {
      expect(() => libreNmsSegment(value)).toThrow(/Invalid LibreNMS identifier/);
    }
  );

  it('rejects non-strings', () => {
    expect(() => libreNmsSegment(undefined)).toThrow();
  });
});

describe('parseLibreNmsEndpoint', () => {
  it('parses the supported forms', () => {
    expect(parseLibreNmsEndpoint('device:core1')).toEqual({ mode: 'device', target: 'core1', subtype: undefined });
    expect(parseLibreNmsEndpoint('service:web1:http')).toEqual({ mode: 'service', target: 'web1', subtype: 'http' });
    expect(parseLibreNmsEndpoint('group:Core')).toEqual({ mode: 'group', target: 'Core', subtype: undefined });
  });

  it.each(['device:x/discover', 'device:../system', 'device:a:b', 'other:x', 'device', 'service:a:b:c'])(
    'rejects %j',
    (endpoint) => {
      expect(() => parseLibreNmsEndpoint(endpoint)).toThrow();
    }
  );
});
