import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts',
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
