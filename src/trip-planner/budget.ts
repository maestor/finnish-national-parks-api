import { lt, sql } from 'drizzle-orm';

import type { Database, Transaction } from '../db/database.js';
import { tripPlannerBudgetWindows } from '../db/schema.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BUDGET_RETENTION_MS = 2 * DAY_MS;

export const TRIP_PLANNER_CLIENT_ID_HEADER = 'x-trip-planner-client-id';

export type TripPlannerBudgetOperation = 'nearby' | 'route' | 'suggestions';

export type TripPlannerBudgetLimits = {
  dailyProviderUnits: number;
  routeRequestsPerMinute: number;
  suggestionsPerMinute: number;
};

export type TripPlannerBudget = {
  admit: (
    operation: TripPlannerBudgetOperation,
    clientId: string,
    now?: number,
    providerUnits?: number
  ) => Promise<TripPlannerBudgetAdmission>;
};

export type TripPlannerBudgetAdmission =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

export const DEFAULT_TRIP_PLANNER_BUDGET_LIMITS: TripPlannerBudgetLimits = {
  dailyProviderUnits: 3000,
  routeRequestsPerMinute: 5,
  suggestionsPerMinute: 30
};

const MAX_ROUTE_CREDITS_PER_LEG = 5;

export const getTripPlannerRouteBudgetUnits = (waypointCount: number) => {
  if (!Number.isInteger(waypointCount) || waypointCount < 2) {
    throw new Error('Trip planner routes require at least two waypoints.');
  }

  return (waypointCount - 1) * MAX_ROUTE_CREDITS_PER_LEG;
};

const getWindowStart = (now: number, windowMs: number) => Math.floor(now / windowMs) * windowMs;

const getOperationLimit = (
  operation: TripPlannerBudgetOperation,
  limits: TripPlannerBudgetLimits
) => {
  if (operation === 'suggestions') {
    return limits.suggestionsPerMinute;
  }

  return limits.routeRequestsPerMinute;
};

const getProviderUnitCost = (operation: TripPlannerBudgetOperation) => {
  return operation === 'suggestions' || operation === 'nearby' ? 1 : 5;
};

const getRetryAfterSeconds = (now: number, windowMs: number) => {
  const windowEnd = getWindowStart(now, windowMs) + windowMs;
  return Math.max(1, Math.ceil((windowEnd - now) / 1000));
};

const reserveWindow = async (
  transaction: Transaction,
  key: string,
  windowStartedAt: number,
  cost: number,
  limit: number
) => {
  if (cost > limit) {
    return false;
  }

  const rows = await transaction
    .insert(tripPlannerBudgetWindows)
    .values({ key, requestCount: cost, windowStartedAt })
    .onConflictDoUpdate({
      set: {
        requestCount: sql`CASE WHEN ${tripPlannerBudgetWindows.windowStartedAt} = ${windowStartedAt} THEN ${tripPlannerBudgetWindows.requestCount} + ${cost} ELSE ${cost} END`,
        windowStartedAt: sql`CASE WHEN ${tripPlannerBudgetWindows.windowStartedAt} = ${windowStartedAt} THEN ${tripPlannerBudgetWindows.windowStartedAt} ELSE ${windowStartedAt} END`
      },
      target: tripPlannerBudgetWindows.key,
      where: sql`${tripPlannerBudgetWindows.windowStartedAt} <> ${windowStartedAt} OR ${tripPlannerBudgetWindows.requestCount} + ${cost} <= ${limit}`
    })
    .returning({ requestCount: tripPlannerBudgetWindows.requestCount });

  return rows.length > 0;
};

class BudgetExceededError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Trip planner budget exceeded.');
  }
}

const isRetryableDatabaseError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return /SQLITE_BUSY|database is locked|transaction conflict/i.test(error.message);
};

const wait = (milliseconds: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

export const createTripPlannerBudget = ({
  dailyProviderUnits = DEFAULT_TRIP_PLANNER_BUDGET_LIMITS.dailyProviderUnits,
  database,
  now = () => Date.now(),
  routeRequestsPerMinute = DEFAULT_TRIP_PLANNER_BUDGET_LIMITS.routeRequestsPerMinute,
  suggestionsPerMinute = DEFAULT_TRIP_PLANNER_BUDGET_LIMITS.suggestionsPerMinute
}: {
  dailyProviderUnits?: number;
  database: Database;
  now?: (() => number) | undefined;
  routeRequestsPerMinute?: number;
  suggestionsPerMinute?: number;
}): TripPlannerBudget => {
  const limits = {
    dailyProviderUnits,
    routeRequestsPerMinute,
    suggestionsPerMinute
  } satisfies TripPlannerBudgetLimits;

  if (
    !Number.isInteger(limits.dailyProviderUnits) ||
    limits.dailyProviderUnits < getProviderUnitCost('route') ||
    !Number.isInteger(limits.routeRequestsPerMinute) ||
    limits.routeRequestsPerMinute < 1 ||
    !Number.isInteger(limits.suggestionsPerMinute) ||
    limits.suggestionsPerMinute < 1
  ) {
    throw new Error('Trip planner budget limits must be positive integers.');
  }

  const admit = async (
    operation: TripPlannerBudgetOperation,
    clientId: string,
    requestedAt = now(),
    requestedProviderUnits = getProviderUnitCost(operation)
  ): Promise<TripPlannerBudgetAdmission> => {
    const minuteWindow = getWindowStart(requestedAt, MINUTE_MS);
    const dayWindow = getWindowStart(requestedAt, DAY_MS);
    const providerUnitCost = requestedProviderUnits;
    const operationLimit = getOperationLimit(operation, limits);

    if (!Number.isInteger(providerUnitCost) || providerUnitCost < 1) {
      throw new Error('Trip planner provider unit cost must be a positive integer.');
    }

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await database.transaction(async (transaction) => {
            await transaction
              .delete(tripPlannerBudgetWindows)
              .where(
                lt(tripPlannerBudgetWindows.windowStartedAt, requestedAt - BUDGET_RETENTION_MS)
              );

            const providerAllowed = await reserveWindow(
              transaction,
              `provider:${dayWindow}`,
              dayWindow,
              providerUnitCost,
              limits.dailyProviderUnits
            );

            if (!providerAllowed) {
              throw new BudgetExceededError(getRetryAfterSeconds(requestedAt, DAY_MS));
            }

            const operationAllowed = await reserveWindow(
              transaction,
              `operation:${operation}:${minuteWindow}`,
              minuteWindow,
              1,
              operation === 'suggestions'
                ? limits.suggestionsPerMinute * 10
                : limits.routeRequestsPerMinute * 10
            );

            if (!operationAllowed) {
              throw new BudgetExceededError(getRetryAfterSeconds(requestedAt, MINUTE_MS));
            }

            const clientAllowed = await reserveWindow(
              transaction,
              `client:${clientId}:${operation}`,
              minuteWindow,
              1,
              operationLimit
            );

            if (!clientAllowed) {
              throw new BudgetExceededError(getRetryAfterSeconds(requestedAt, MINUTE_MS));
            }
          });

          break;
        } catch (error) {
          if (error instanceof BudgetExceededError || !isRetryableDatabaseError(error)) {
            throw error;
          }

          if (attempt === 2) {
            throw error;
          }

          await wait(10 * (attempt + 1));
        }
      }

      return { allowed: true };
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        return {
          allowed: false,
          retryAfterSeconds: error.retryAfterSeconds
        };
      }

      throw error;
    }
  };

  return { admit };
};

export const getTripPlannerClientId = (headerValue: string | undefined) => {
  const normalized = headerValue?.trim();

  if (normalized && /^[A-Za-z0-9_-]{16,128}$/.test(normalized)) {
    return normalized;
  }

  return 'anonymous';
};
