import { describe, it, expect } from 'vitest';
import { normalizeStatus } from '../statuspage';

describe('statuspage adapter', () => {
  describe('normalizeStatus', () => {
    it('maps "none" indicator to operational', () => {
      const result = normalizeStatus({ status: { indicator: 'none', description: 'All good' } });
      expect(result.status).toBe('operational');
      expect(result.message).toBe('All good');
    });

    it('maps "minor" indicator to degraded', () => {
      const result = normalizeStatus({ status: { indicator: 'minor', description: 'Minor issue' } });
      expect(result.status).toBe('degraded');
    });

    it('maps "major" indicator to outage', () => {
      const result = normalizeStatus({ status: { indicator: 'major', description: 'Major issue' } });
      expect(result.status).toBe('outage');
    });

    it('maps "critical" indicator to outage', () => {
      const result = normalizeStatus({ status: { indicator: 'critical', description: 'Critical' } });
      expect(result.status).toBe('outage');
    });

    it('maps "maintenance" indicator to maintenance', () => {
      const result = normalizeStatus({ status: { indicator: 'maintenance', description: 'Maintenance' } });
      expect(result.status).toBe('maintenance');
    });

    it('returns unknown for unrecognized indicator', () => {
      const result = normalizeStatus({ status: { indicator: 'something_else', description: '' } });
      expect(result.status).toBe('unknown');
    });

    it('handles missing status object', () => {
      const result = normalizeStatus({});
      expect(result.status).toBe('unknown');
    });
  });
});
