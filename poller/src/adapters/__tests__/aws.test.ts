import { describe, it, expect } from 'vitest';
import { normalizeStatus } from '../aws';

describe('aws adapter', () => {
  describe('normalizeStatus', () => {
    it('returns operational for successful health page with no events', () => {
      const result = normalizeStatus({
        source: 'aws_health',
        data: { archive: [] },
        status_code: 200,
      });
      expect(result.status).toBe('operational');
    });

    it('returns operational when status code is OK but no parseable data', () => {
      const result = normalizeStatus({
        source: 'aws_health',
        data: null,
        status_code: 200,
      });
      expect(result.status).toBe('operational');
    });

    it('returns unknown when response is not parseable and status not OK', () => {
      const result = normalizeStatus({
        source: 'aws_health',
        data: null,
        status_code: 500,
      });
      expect(result.status).toBe('unknown');
    });

    it('handles http_probe fallback - ok', () => {
      const result = normalizeStatus({ source: 'http_probe', ok: true, status_code: 200 });
      expect(result.status).toBe('operational');
    });

    it('handles http_probe fallback - server error', () => {
      const result = normalizeStatus({ source: 'http_probe', ok: false, status_code: 503 });
      expect(result.status).toBe('outage');
    });
  });
});
