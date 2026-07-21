import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Full-catalog importer integration tests insert 148 fixture records per
    // test; constrained CI runners need more headroom than the 5s default.
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/local-server.ts',
        'src/cli/**/*.ts',
        'src/env.ts',
        'src/db/client.ts',
        'src/db/schema.ts',
        'src/http/logger.ts',
        'src/storage/r2-client.ts',
        'src/storage/types.ts'
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100
      }
    }
  }
});
