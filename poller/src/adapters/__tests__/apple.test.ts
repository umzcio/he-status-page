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
