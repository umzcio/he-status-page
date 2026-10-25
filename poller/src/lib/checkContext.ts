import { AsyncLocalStorage } from 'node:async_hooks';

// Cancellation for one service check.
//
// Each check runs inside runWithCheckSignal() with an AbortSignal that fires
// when the check's deadline passes. Every HTTP request made during the check
// picks the signal up (fetchDeadline() in endpointHttp.ts), so in-flight
// requests are aborted rather than left running, and the check calls
// throwIfCheckAborted() before writing anything, so an abandoned check never
// writes status, incidents or notifications from stale state.

const storage = new AsyncLocalStorage<AbortSignal>();

export class CheckAbortedError extends Error {
  constructor() {
    super('Check cancelled: deadline exceeded');
    this.name = 'CheckAbortedError';
  }
}

export function runWithCheckSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return storage.run(signal, fn);
}

export function checkSignal(): AbortSignal | undefined {
  return storage.getStore();
}

export function throwIfCheckAborted(): void {
  if (checkSignal()?.aborted) throw new CheckAbortedError();
}

/** A signal that aborts as soon as any of `signals` does. */
export function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const present = signals.filter((s): s is AbortSignal => !!s);
  const controller = new AbortController();
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
