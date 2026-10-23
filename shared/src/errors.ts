// Log-safe error serialization.
//
// HTTP client errors (AxiosError) carry the full request config, including
// auth headers such as X-Auth-Token or Authorization, plus request/response
// objects. Logging one as-is writes those secrets into the logs. This keeps
// only what is useful for debugging: type, message, code, HTTP status, stack,
// and the same for any `cause`.

export interface SerializedError {
  type?: string;
  message?: string;
  code?: string;
  status?: number;
  stack?: string;
  cause?: SerializedError | string;
}

export function serializeError(err: unknown, depth = 0): SerializedError | unknown {
  if (!err || typeof err !== 'object') return err;
  const e = err as Record<string, any>;
  const out: SerializedError = {
    type: e.name || e.constructor?.name,
    message: typeof e.message === 'string' ? e.message : undefined,
    stack: typeof e.stack === 'string' ? e.stack : undefined,
  };
  if (typeof e.code === 'string') out.code = e.code;
  const status = e.response?.status ?? e.status;
  if (typeof status === 'number') out.status = status;
  if (e.cause !== undefined && depth < 3) {
    out.cause = serializeError(e.cause, depth + 1) as SerializedError | string;
  }
  return out;
}
