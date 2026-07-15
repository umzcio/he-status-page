import pino from 'pino';

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
});

export default logger;
