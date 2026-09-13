import pino from 'pino';

const isPlainEnvironment = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
const defaultLogLevel = process.env.NODE_ENV === 'test' ? 'silent' : 'info';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? defaultLogLevel,
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
