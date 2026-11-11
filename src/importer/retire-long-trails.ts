import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { parks, trailAreaLinks } from '../db/schema.js';
import type { GeoJsonFeatureCollection } from './geometry.js';
import { exceedsTrailLengthLimit, measureTrailLengthKm } from './trail-area-geometry.js';

export const retireLongTrails = async ({
  database,
  dryRun = false,
  now = () => new Date().toISOString()
}: {
  database: Database;
  dryRun?: boolean;
  now?: () => string;
}) => {
  const rows = await database
    .select({
      id: parks.id,
      name: parks.name,
      slug: parks.slug,
      geometry: parks.boundaryGeojson,
      reportedLengthKm: parks.lengthKm
    })
    .from(parks)
    .where(and(eq(parks.catalogStatus, 'active'), inArray(parks.typeId, [4403, 4404, 4405])));
  const measured = rows.map(({ geometry, ...row }) => ({
    ...row,
    measuredLengthKm: measureTrailLengthKm(JSON.parse(geometry) as GeoJsonFeatureCollection)
  }));
  const retiredTrails = measured.filter((row) =>
    exceedsTrailLengthLimit(row.measuredLengthKm, row.reportedLengthKm)
  );
  const unresolvedTrails = measured.filter(
    (row) => row.measuredLengthKm === null && !exceedsTrailLengthLimit(null, row.reportedLengthKm)
  );
  if (!retiredTrails.length)
    return { retiredTrails, unresolvedTrails, affectedSlugs: [] as string[] };
  const ids = retiredTrails.map((row) => row.id);
  const linkedAreas = await database
    .select({ slug: parks.slug })
    .from(trailAreaLinks)
    .innerJoin(parks, eq(parks.id, trailAreaLinks.areaId))
    .where(inArray(trailAreaLinks.trailId, ids));
  const affectedSlugs = [
    ...new Set([...retiredTrails.map((row) => row.slug), ...linkedAreas.map((row) => row.slug)])
  ];
  if (!dryRun) {
    await database.transaction(async (tx) => {
      await tx
        .update(parks)
        .set({ catalogStatus: 'inactive', removed: true, updatedAt: now() })
        .where(inArray(parks.id, ids));
    });
  }
  return { retiredTrails, unresolvedTrails, affectedSlugs };
};
