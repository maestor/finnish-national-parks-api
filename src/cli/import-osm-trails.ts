import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { osmTrailSources, parks, trailAreaLinks } from '../db/schema.js';
import { importOsmTrails } from '../importer/import-osm-trails.js';
import { fetchOsmTrailSnapshot } from '../importer/osm-source.js';
import { isTrailTypeCode } from '../parks/park-types.js';

const coordinate = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .rest(z.number());
const snapshotSchema = z.object({
  timestamp: z.iso.datetime(),
  routes: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string().trim().min(1),
      aliases: z.array(z.string().trim().min(1)).optional(),
      reportedLengthKm: z.number().nonnegative().nullable(),
      geometry: z.object({
        type: z.literal('FeatureCollection'),
        features: z
          .array(
            z.object({
              type: z.literal('Feature'),
              geometry: z.object({
                type: z.literal('LineString'),
                coordinates: z.array(coordinate).min(2)
              })
            })
          )
          .min(1)
      })
    })
  )
});
const args = process.argv.slice(2);
const usage = 'Usage: npm run import:osm-trails [-- --dry-run]';
if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) throw new Error(usage);
const dryRun = args.length === 1;
const cachePath = 'data/osm-trails-snapshot.json';
const client = createDatabaseClient();
try {
  const pending = await getPendingMigrationNames(client);
  if (pending.length)
    throw new Error(
      `Database schema is not current. Run migrations on the intended database first. Pending migrations: ${pending.join(', ')}`
    );
  const database = createDatabase(client);
  const rows = await database
    .select({
      typeId: parks.typeId,
      catalogStatus: parks.catalogStatus,
      minLon: parks.bboxMinLon,
      minLat: parks.bboxMinLat,
      maxLon: parks.bboxMaxLon,
      maxLat: parks.bboxMaxLat
    })
    .from(parks);
  const areas = rows.filter(
    (row) => row.catalogStatus === 'active' && !isTrailTypeCode(row.typeId)
  );
  const areaHash = createHash('sha256').update(JSON.stringify(areas)).digest('hex');
  let cachedText: string | undefined;
  try {
    cachedText = await readFile(cachePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const cacheSchema = z.object({
    snapshot: snapshotSchema,
    rejected: z.array(z.object({ id: z.number(), name: z.string(), reason: z.string() })),
    areaHash: z.string(),
    fetchedAt: z.number()
  });
  const cached = cachedText ? cacheSchema.safeParse(JSON.parse(cachedText)) : undefined;
  const age = cached?.success ? Date.now() - cached.data.fetchedAt : Infinity;
  const source =
    cached?.success && cached.data.areaHash === areaHash && age >= 0 && age < 60 * 60 * 1000
      ? { snapshot: cached.data.snapshot, rejected: cached.data.rejected }
      : await fetchOsmTrailSnapshot({ areas });
  const snapshot = snapshotSchema.parse(source.snapshot);
  if (new Set(snapshot.routes.map((r) => r.id)).size !== snapshot.routes.length)
    throw new Error('Snapshot contains duplicate relation IDs.');
  const sourceRejected = source.rejected;
  if (!(cached?.success && cached.data.areaHash === areaHash && age >= 0 && age < 60 * 60 * 1000)) {
    await mkdir('data', { recursive: true });
    await writeFile(
      `${cachePath}.tmp`,
      JSON.stringify({
        snapshot,
        rejected: sourceRejected,
        areaHash,
        fetchedAt: Date.now(),
        attribution: '© OpenStreetMap contributors',
        licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/'
      })
    );
    await rename(`${cachePath}.tmp`, cachePath);
  }
  const report = await importOsmTrails({ database, snapshot, dryRun });
  const sources = await database.select().from(osmTrailSources);
  const links = await database.select().from(trailAreaLinks);
  const trailByRelation = new Map(sources.map((source) => [source.relationId, source.trailId]));
  const excludedPairs = new Set(
    links
      .filter((link) => link.override === 'exclude')
      .map((link) => `${link.trailId}:${link.areaId}`)
  );
  const changedIds = new Set(report.changedIds);
  const retiredIds = new Set(report.retiredIds);
  const changed = report.imported.filter((trail) => changedIds.has(trail.id));
  const printTrail = (trail: (typeof report.imported)[number]) => {
    const flags = [
      ...(/winter|talvireitti|lumikenk/i.test(trail.name) ? ['winter route'] : []),
      ...(/^(luontopolku|yhdysreitti|reitti(?:\s+\d[\d,.]*\s*km)?)$/i.test(trail.name)
        ? ['generic name']
        : []),
      ...(/reitist|reittiverkost|muut polkureitit/i.test(trail.name) ? ['route network'] : []),
      ...(trail.length < 0.1 ? ['very short geometry'] : [])
    ];
    const areas = trail.matches
      .map(
        ({ area }) =>
          `${area.park.name}${excludedPairs.has(`${trailByRelation.get(trail.id)}:${area.park.id}`) ? ' (manually excluded)' : ''}`
      )
      .join(', ');
    console.log(
      `- ${trail.name} (OSM ${trail.id}, ${trail.length.toFixed(1)} km${flags.length ? `; review: ${flags.join(', ')}` : ''}) → ${areas}`
    );
  };
  console.log(
    `${dryRun ? 'Dry run — would import or update' : 'Imported or updated'} ${changed.length} trails:`
  );
  for (const trail of changed) printTrail(trail);
  for (const trail of report.mergedTrails)
    console.log(
      `- ${trail.name} [${trail.slug}]: ${dryRun ? 'would refresh' : 'refreshed'} merged source geometry (${trail.lengthKm?.toFixed(3) ?? 'unknown'} km).`
    );
  for (const warning of report.mergedWarnings) console.error(warning);
  const retired = report.excluded.filter((trail) => retiredIds.has(trail.id));
  if (retired.length) {
    console.log(`\n${dryRun ? 'Would retire' : 'Retired'} ${retired.length} trails over 100 km:`);
    for (const trail of retired) console.log(`- ${trail.name} (OSM ${trail.id})`);
  }
  if (report.affectedSlugs.length)
    console.error(
      dryRun ? 'Expire affected area caches after applying.' : 'Expire affected area caches now.'
    );
} finally {
  await client.close();
}
