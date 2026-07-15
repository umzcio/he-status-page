import { describe, it, expect } from 'vitest';
import { normalizeStatus } from '../google';

describe('google adapter', () => {
  describe('normalizeStatus', () => {
    it('returns operational when no active incidents', () => {
      const result = normalizeStatus({ source: 'google_status_feed', active_incidents: 0, incidents: [] });
      expect(result.status).toBe('operational');
    });

    it('returns degraded for ongoing non-high-severity incident', () => {
      const result = normalizeStatus({
        source: 'google_status_feed',
        active_incidents: 1,
        incidents: [{ severity: 'MEDIUM', end: undefined }],
      });
      expect(result.status).toBe('degraded');
    });

    it('returns outage for ongoing high-severity incident', () => {
      const result = normalizeStatus({
        source: 'google_status_feed',
        active_incidents: 1,
        incidents: [{ severity: 'HIGH', end: undefined }],
      });
      expect(result.status).toBe('outage');
    });

    it('returns operational when incidents are resolved', () => {
      const result = normalizeStatus({
        source: 'google_status_feed',
        active_incidents: 1,
        incidents: [{ severity: 'HIGH', end: '2025-01-01' }],
      });
      expect(result.status).toBe('operational');
    });

    it('handles http_probe fallback - ok', () => {
      const result = normalizeStatus({ source: 'http_probe', ok: true, status_code: 200 });
      expect(result.status).toBe('operational');
    });

    it('handles http_probe fallback - server error', () => {
      const result = normalizeStatus({ source: 'http_probe', ok: false, status_code: 500 });
      expect(result.status).toBe('outage');
    });

    it('handles http_probe fallback - client error', () => {
      const result = normalizeStatus({ source: 'http_probe', ok: false, status_code: 403 });
      expect(result.status).toBe('degraded');
    });
  });
});
