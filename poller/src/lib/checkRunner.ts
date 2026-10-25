import logger from './logger';
import { runWithCheckSignal } from './checkContext';

interface CheckTarget {
  id: string;
  name: string;
}

/**
 * Wrap a service check so that:
 *  - at most one check per service is in flight (a check still running from
 *    an earlier cycle makes the next one skip that service);
 *  - at the deadline the check is cancelled through its AbortSignal (see
 *    checkContext.ts) and the caller stops waiting for it.
 */
export function createCheckRunner<S extends CheckTarget>(
  check: (service: S) => Promise<void>,
  deadlineMs: number
): { run: (service: S) => Promise<void>; inFlight: () => number } {
  const running = new Set<string>();

  function run(service: S): Promise<void> {
    if (running.has(service.id)) {
      logger.warn({ service: service.name, serviceId: service.id }, 'Previous check still running — skipping');
      return Promise.resolve();
    }
    running.add(service.id);

    const controller = new AbortController();
    const work = runWithCheckSignal(controller.signal, () => check(service)).finally(() => running.delete(service.id));

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        logger.warn({ service: service.name, serviceId: service.id, deadlineMs }, 'Check exceeded deadline — cancelled');
        resolve();
      }, deadlineMs);
    });

    return Promise.race([work.catch(() => undefined), deadline]).finally(() => clearTimeout(timer));
  }

  return { run, inFlight: () => running.size };
}
