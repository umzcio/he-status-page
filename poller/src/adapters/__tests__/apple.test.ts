import { describe, it, expect } from 'vitest';
import { normalizeStatus } from '../apple';

describe('apple adapter', () => {
  describe('normalizeStatus', () => {
    it('returns operational when no service events', () => {
      const result = normalizeStatus({
        source: 'apple_status',
        data: { services: [{ name: 'iCloud', events: [] }] },
      });
      expect(result.status).toBe('operational');
    });

    it('returns outage when service has ongoing event', () => {
      const result = normalizeStatus({
        source: 'apple_status',
        data: {
          services: [{
            name: 'iCloud',
            events: [{ eventStatus: 'ongoing' }],
          }],
        },
      });
      expect(result.status).toBe('outage');
    });

    it('returns degraded for performance issues', () => {
      const result = normalizeStatus({
        source: 'apple_status',
        data: {
          services: [{
            name: 'App Store',
            events: [{ eventStatus: 'performance' }],
          }],
        },
      });
      expect(result.status).toBe('degraded');
    });

    it('returns operational when no services data', () => {
      const result = normalizeStatus({ source: 'apple_status', data: {} });
      expect(result.status).toBe('operational');
    });

    it('handles http_probe fallback', () => {
      const result = normalizeStatus({ source: 'http_probe', ok: true, status_code: 200 });
      expect(result.status).toBe('operational');
    });
  });
});

describe('unwrapJsonp', () => {
  it('extracts the payload of a jsonCallback wrapper', async () => {
    const { unwrapJsonp } = await import('../apple');
    expect(unwrapJsonp('jsonCallback({"a":1});')).toBe('{"a":1}');
    expect(unwrapJsonp('{"a":1}')).toBeNull();
    expect(unwrapJsonp('jsonCallback(')).toBeNull();
  });

  it('takes linear time on an adversarial body at the size cap', async () => {
    const { unwrapJsonp } = await import('../apple');
    // Many callback prefixes and no closing parenthesis: the old regex
    // backtracked quadratically on this.
    const body = 'jsonCallback('.repeat(Math.floor((2 * 1024 * 1024) / 13));
    const started = performance.now();
    expect(unwrapJsonp(body)).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });
});
