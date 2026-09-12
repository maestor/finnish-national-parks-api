import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/database.js';
import {
  createTripPlannerBudget,
  getTripPlannerClientId,
  getTripPlannerRouteBudgetUnits
} from '../../src/trip-planner/budget.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('trip planner budget', () => {
  it('reserves five provider credits per public route leg', () => {
    expect(getTripPlannerRouteBudgetUnits(2)).toBe(5);
    expect(getTripPlannerRouteBudgetUnits(28)).toBe(135);
  });

  it('requires at least two route waypoints', () => {
    expect(() => getTripPlannerRouteBudgetUnits(1)).toThrow(
      'Trip planner routes require at least two waypoints.'
    );
  });

  it('accepts only opaque client identifiers that match the internal format', () => {
    expect(getTripPlannerClientId('client_1234567890')).toBe('client_1234567890');
    expect(getTripPlannerClientId('short')).toBe('anonymous');
  });

  it('rejects invalid budget limits', () => {
    const database = {} as Database;

    expect(() => createTripPlannerBudget({ database, dailyProviderUnits: 4 })).toThrow(
      'Trip planner budget limits must be positive integers.'
    );
    expect(() => createTripPlannerBudget({ database, routeRequestsPerMinute: 0 })).toThrow(
      'Trip planner budget limits must be positive integers.'
    );
    expect(() => createTripPlannerBudget({ database, suggestionsPerMinute: 0 })).toThrow(
      'Trip planner budget limits must be positive integers.'
    );
  });

  it('rejects invalid provider unit costs', async () => {
    const database = {
      transaction: vi.fn()
    } as unknown as Database;
    const budget = createTripPlannerBudget({ database });

    await expect(budget.admit('suggestions', 'client_1234567890', undefined, 0)).rejects.toThrow(
      'Trip planner provider unit cost must be a positive integer.'
    );
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected database failure', async () => {
    const database = {
      transaction: vi.fn().mockRejectedValue(new Error('database unavailable'))
    } as unknown as Database;
    const budget = createTripPlannerBudget({ database });

    await expect(budget.admit('suggestions', 'client_1234567890')).rejects.toThrow(
      'database unavailable'
    );
  });

  it('rethrows non-Error database failures without retrying', async () => {
    const database = {
      transaction: vi.fn().mockRejectedValue('database unavailable')
    } as unknown as Database;
    const budget = createTripPlannerBudget({ database });

    await expect(budget.admit('suggestions', 'client_1234567890')).rejects.toBe(
      'database unavailable'
    );
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it('rethrows a database lock after bounded retries', async () => {
    const database = {
      transaction: vi.fn().mockRejectedValue(new Error('database is locked'))
    } as unknown as Database;
    const budget = createTripPlannerBudget({ database });

    await expect(budget.admit('suggestions', 'client_1234567890')).rejects.toThrow(
      'database is locked'
    );
    expect(database.transaction).toHaveBeenCalledTimes(3);
  });

  it('enforces the shared operation ceiling across clients', async () => {
    const testDatabase = await createTestDatabase();
    const budget = createTripPlannerBudget({
      database: testDatabase.database,
      now: () => 0,
      suggestionsPerMinute: 1
    });

    try {
      for (let index = 0; index < 10; index += 1) {
        await expect(
          budget.admit('suggestions', `client_${String(index).padStart(10, '0')}`)
        ).resolves.toEqual({ allowed: true });
      }

      await expect(budget.admit('suggestions', 'client_0000000010')).resolves.toEqual({
        allowed: false,
        retryAfterSeconds: 60
      });
    } finally {
      await testDatabase.dispose();
    }
  });
});
