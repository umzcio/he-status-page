// Errors from status fetches, and the only wording of them the public sees.
//
// Raw fetch errors can name the configured endpoint, LibreNMS hosts, IPs and
// ports. They are fine in poller_logs and the structured log (admin-only), but
// the public status message, status_history and auto-incident text get one of
// a few fixed messages instead.

/** An upstream request failure that keeps only the HTTP status / error code. */
export class UpstreamError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = opts.status;
    this.code = opts.code;
  }
}

function* causeChain(err: unknown): Generator<any> {
  let current: any = err;
  for (let i = 0; current && i < 5; i++) {
    yield current;
    current = current.cause;
  }
}

export function publicFetchFailureMessage(err: unknown): string {
  for (const e of causeChain(err)) {
    const status = e.response?.status ?? e.status;
    if (typeof status === 'number') {
      return `Service unreachable (status check returned HTTP ${status})`;
    }
    if (
      e.code === 'ECONNABORTED' ||
      e.code === 'ETIMEDOUT' ||
      e.code === 'ERR_CANCELED' || // the wall-clock deadline (AbortSignal.timeout)
      /timeout|aborted/i.test(String(e.message))
    ) {
      return 'Service unreachable (status check timed out)';
    }
  }
  return 'Service unreachable';
}
