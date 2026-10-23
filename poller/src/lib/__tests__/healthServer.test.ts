import { describe, it, expect } from 'vitest';
import { isHealthy } from '../healthServer';
import { publicFetchFailureMessage } from '../fetchErrors';

const now = Date.parse('2026-10-23T12:00:00Z');
const minutes = (n: number) => new Date(now - n * 60 * 1000);

describe('poller health', () => {
  it('is starting (unhealthy) before the first cycle', () => {
    expect(isHealthy({ lastPollCompleted: null, lastPollDurationMs: 0, isPolling: false, intervalMinutes: 5 }, now)).toBe(false);
  });

  it('is healthy during a cycle of normal length', () => {
    expect(
      isHealthy({ lastPollCompleted: null, lastPollDurationMs: 0, isPolling: true, pollStartedAt: minutes(2), intervalMinutes: 5 }, now)
    ).toBe(true);
  });

  it('reports a cycle that has run far too long as unhealthy', () => {
    expect(
      isHealthy({ lastPollCompleted: minutes(60), lastPollDurationMs: 0, isPolling: true, pollStartedAt: minutes(20), intervalMinutes: 5 }, now)
    ).toBe(false);
  });
});

describe('deadline errors', () => {
  it('publish as a timeout', () => {
    const canceled = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' });
    expect(publicFetchFailureMessage(new Error('Failed to fetch status: canceled', { cause: canceled }))).toBe(
      'Service unreachable (status check timed out)'
    );
  });
});
