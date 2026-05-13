import pino from 'pino';

const isPlainEnvironment = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isPlainEnvironment
    ? {
        transport: {
          options: {
            colorize: true
          },
          target: 'pino-pretty'
        }
      }
    : {})
});
