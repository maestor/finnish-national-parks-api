import { sql } from 'drizzle-orm';

import type { Transaction } from './database.js';
import { tripPlannerBudgetWindows } from './schema.js';

export const reserveRequestWindow = async (
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
