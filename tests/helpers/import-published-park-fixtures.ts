import { and, eq, inArray } from 'drizzle-orm';

import { parks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';

// Tests unrelated to import visibility need explicitly published fixture records.
export const importPublishedParkFixtures = async (options: Parameters<typeof importParks>[0]) => {
  const result = await importParks(options);
  const newIds = result.newParks.map((park) => park.lipasId);
  if (!result.dryRun && newIds.length) {
    await options.database
      .update(parks)
      .set({ removed: false })
      .where(and(inArray(parks.lipasId, newIds), eq(parks.trailPublicationRole, 'independent')));
  }
  return result;
};

import { importSpecialParks } from '../../src/importer/import-special-parks.js';

export const importPublishedSpecialParkFixtures = async (
  options: Parameters<typeof importSpecialParks>[0]
) => {
  const existing = new Set(
    (await options.database.select({ id: parks.id }).from(parks)).map((row) => row.id)
  );
  const result = await importSpecialParks(options);
  const inserted = (await options.database.select({ id: parks.id }).from(parks)).filter(
    (row) => !existing.has(row.id)
  );
  if (inserted.length) {
    await options.database
      .update(parks)
      .set({ removed: false })
      .where(
        and(
          inArray(
            parks.id,
            inserted.map((row) => row.id)
          ),
          eq(parks.trailPublicationRole, 'independent')
        )
      );
  }
  return result;
};
