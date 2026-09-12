import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { RepositoryNotFoundError, RepositoryValidationError } from '../../src/db/repositories.js';
import { logger } from '../../src/http/logger.js';
import { TripPlannerError } from '../../src/trip-planner/search.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('request logging', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });

  afterEach(async () => {
    await testDatabase.dispose();
    vi.restoreAllMocks();
  });

  it('logs review share requests with a route template instead of the share id', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const shareId = '11111111-1111-4111-8111-111111111111';
    const app = createApp({ database: testDatabase.database });

    const response = await app.request(`/api/date-range-review/shares/${shareId}`);

    expect(response.status).toBe(404);
    const serializedLogs = JSON.stringify(infoSpy.mock.calls);
    expect(serializedLogs).not.toContain(shareId);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/date-range-review/shares/{shareId}'
      }),
      'request'
    );
  });

  it('logs unhandled errors by safe category without the raw error message', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const secret = 'synthetic-provider-secret';
    const rawMessage = `Provider URL contained ${secret} and a private address`;
    const app = createApp({
      database: testDatabase.database,
      tripPlanner: {
        search: async () => {
          throw new Error(rawMessage);
        },
        searchNearby: async () => {
          throw new Error(rawMessage);
        },
        suggest: async () => {
          throw new Error(rawMessage);
        }
      }
    });

    const response = await app.request('/api/trip-planner/suggestions', {
      body: JSON.stringify({ query: 'private address' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });

    expect(response.status).toBe(500);
    const serializedLogs = JSON.stringify(errorSpy.mock.calls);
    expect(serializedLogs).not.toContain(secret);
    expect(serializedLogs).not.toContain('private address');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCategory: 'application_error',
        path: '/api/trip-planner/suggestions'
      }),
      'Unhandled error'
    );
  });

  it('preserves safe categories for known error types and unknown thrown values', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const cases: Array<{ category: string; error: unknown }> = [
      {
        category: 'trip_planner_provider_unavailable',
        error: new TripPlannerError('provider_unavailable', 'Provider unavailable.', 422)
      },
      {
        category: 'repository_not_found',
        error: new RepositoryNotFoundError('Repository resource not found.')
      },
      {
        category: 'repository_validation',
        error: new RepositoryValidationError('Repository input is invalid.')
      }
    ];

    for (const { category, error } of cases) {
      const app = createApp({
        database: testDatabase.database,
        tripPlanner: {
          search: async () => {
            throw error;
          },
          searchNearby: async () => {
            throw error;
          },
          suggest: async () => {
            throw error;
          }
        }
      });

      const response = await app.request('/api/trip-planner/suggestions', {
        body: JSON.stringify({ query: 'He' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      });

      expect(response.status).toBe(500);
      expect(errorSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          errorCategory: category,
          path: '/api/trip-planner/suggestions'
        }),
        'Unhandled error'
      );
    }
  });
});
