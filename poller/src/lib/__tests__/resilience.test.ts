import { describe, it, expect, beforeEach } from 'vitest';
import { withRetry, isCircuitOpen, recordSuccess, recordFailure, getCircuitState } from '../resilience';

describe('resilience', () => {
  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const result = await withRetry(() => Promise.resolve('ok'), { retries: 2, baseDelayMs: 10 });
      expect(result).toBe('ok');
    });

    it('retries on failure and succeeds', async () => {
      let attempts = 0;
      const result = await withRetry(
        () => {
          attempts++;
          if (attempts < 2) throw new Error('fail');
          return Promise.resolve('ok');
        },
        { retries: 2, baseDelayMs: 10 }
      );
      expect(result).toBe('ok');
      expect(attempts).toBe(2);
    });

    it('throws after exhausting retries', async () => {
      await expect(
        withRetry(() => Promise.reject(new Error('always fail')), { retries: 1, baseDelayMs: 10 })
      ).rejects.toThrow('always fail');
    });
  });

  describe('circuit breaker', () => {
    const key = 'test-circuit-' + Math.random();

    beforeEach(() => {
      // Reset by recording success
      recordSuccess(key);
    });

    it('starts closed', () => {
      expect(getCircuitState(key)).toBe('CLOSED');
      expect(isCircuitOpen(key)).toBe(false);
    });

    it('opens after threshold failures', () => {
      recordFailure(key, { failureThreshold: 3, cooldownMs: 60000 });
      recordFailure(key, { failureThreshold: 3, cooldownMs: 60000 });
      expect(isCircuitOpen(key, { failureThreshold: 3, cooldownMs: 60000 })).toBe(false);
      recordFailure(key, { failureThreshold: 3, cooldownMs: 60000 });
      expect(getCircuitState(key)).toBe('OPEN');
      expect(isCircuitOpen(key, { failureThreshold: 3, cooldownMs: 60000 })).toBe(true);
    });

    it('resets on success', () => {
      recordFailure(key, { failureThreshold: 1, cooldownMs: 60000 });
      expect(getCircuitState(key)).toBe('OPEN');
      recordSuccess(key);
      expect(getCircuitState(key)).toBe('CLOSED');
    });
  });
});
