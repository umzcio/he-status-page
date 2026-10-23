import pino from 'pino';
import { serializeError } from '@he-status/shared';

function getPrettyTransport(): pino.TransportSingleOptions | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } };
  } catch {
    return undefined;
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport: getPrettyTransport(),
  name: 'hestatus-backend',
  // Never serialize whole error objects: HTTP client errors carry request
  // headers (API tokens). See shared/src/errors.ts.
  serializers: { err: serializeError, error: serializeError },
});

export default logger;
