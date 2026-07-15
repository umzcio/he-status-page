/**
 * Lightweight retry + circuit-breaker for poller adapters.
 *
 * Circuit states: CLOSED (normal) -> OPEN (failures exceeded) -> HALF_OPEN (trial)
 * - CLOSED: requests pass through. On failure, increment counter.
 * - OPEN: requests immediately fail. After cooldown, move to HALF_OPEN.
 * - HALF_OPEN: one trial request. Success -> CLOSED, failure -> OPEN.
 */

interface CircuitBreakerOptions {
  failureThreshold: number;   // failures before opening (default: 3)
  cooldownMs: number;         // time in OPEN before trying again (default: 5 min)
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitStats {
  state: CircuitState;
  failures: number;
  lastFailure: number | null;
  openedAt: number | null;
}

const circuits = new Map<string, CircuitStats>();

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 3,
  cooldownMs: 5 * 60 * 1000, // 5 minutes
};

function getCircuit(key: string): CircuitStats {
  if (!circuits.has(key)) {
    circuits.set(key, { state: 'CLOSED', failures: 0, lastFailure: null, openedAt: null });
  }
  return circuits.get(key)!;
}

export function getCircuitState(key: string): CircuitState {
  return getCircuit(key).state;
}

export function isCircuitOpen(key: string, opts: CircuitBreakerOptions = DEFAULT_OPTIONS): boolean {
  const circuit = getCircuit(key);

  if (circuit.state === 'CLOSED') return false;

  if (circuit.state === 'OPEN' && circuit.openedAt) {
    const elapsed = Date.now() - circuit.openedAt;
    if (elapsed >= opts.cooldownMs) {
      circuit.state = 'HALF_OPEN';
      return false; // allow trial request
    }
    return true; // still open
  }

  return false; // HALF_OPEN allows one request
}

export function recordSuccess(key: string): void {
  const circuit = getCircuit(key);
  circuit.state = 'CLOSED';
  circuit.failures = 0;
  circuit.lastFailure = null;
  circuit.openedAt = null;
}

export function recordFailure(key: string, opts: CircuitBreakerOptions = DEFAULT_OPTIONS): void {
  const circuit = getCircuit(key);
  circuit.failures++;
  circuit.lastFailure = Date.now();

  if (circuit.failures >= opts.failureThreshold) {
    circuit.state = 'OPEN';
    circuit.openedAt = Date.now();
    console.warn(`Circuit OPEN for "${key}" after ${circuit.failures} failures`);
  }
}

/**
 * Retry a function with exponential backoff.
 * Defaults: 2 retries, base delay 1s, max delay 5s.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const { retries = 2, baseDelayMs = 1000, maxDelayMs = 5000 } = opts;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      if (attempt < retries) {
        // Exponential backoff with jitter
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        const jitter = delay * 0.2 * Math.random();
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
      }
    }
  }

  throw lastError;
}

/**
 * Wrap an adapter's fetchStatus with retry + circuit breaker.
 */
export async function resilientFetch<T>(
  adapterKey: string,
  fetchFn: () => Promise<T>,
  opts: CircuitBreakerOptions = DEFAULT_OPTIONS
): Promise<T> {
  if (isCircuitOpen(adapterKey, opts)) {
    throw new Error(`Circuit breaker OPEN for ${adapterKey} — skipping`);
  }

  try {
    const result = await withRetry(fetchFn);
    recordSuccess(adapterKey);
    return result;
  } catch (err) {
    recordFailure(adapterKey, opts);
    throw err;
  }
}
