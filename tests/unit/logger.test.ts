import { afterEach, describe, expect, it, vi } from 'vitest';

const loadLogger = async () => {
  const module = await import('../../src/http/logger.js');
  return module.logger;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('logger', () => {
  it('silences routine output during tests by default', async () => {
    vi.stubEnv('LOG_LEVEL', undefined);
    vi.stubEnv('NODE_ENV', 'test');
    vi.resetModules();

    expect((await loadLogger()).level).toBe('silent');
  });

  it('keeps an explicit log level available for test diagnosis', async () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('NODE_ENV', 'test');
    vi.resetModules();

    expect((await loadLogger()).level).toBe('debug');
  });
});
