import { createDatabaseClient } from '../db/client.js';
import { getEnv } from '../env.js';
import { runScheduledParkImport } from '../importer/scheduled-park-import.js';
import { fitnessTrailLipasTypeCode } from '../parks/park-types.js';

const env = getEnv();
if (!env.GITHUB_REPOSITORY || !env.GITHUB_TOKEN) {
  throw new Error(
    'Scheduled import requires GITHUB_REPOSITORY and GITHUB_TOKEN. Use import:parks for manual imports.'
  );
}

const client = createDatabaseClient();
try {
  const result = await runScheduledParkImport(client, {
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN
  });
  const newStandaloneCount = result.newParks.filter(
    ({ typeCode }) => typeCode !== fitnessTrailLipasTypeCode
  ).length;
  const newLinkCount = result.trailAreaResult?.newAreaOnlyLinks.length ?? 0;
  console.log(
    `Imported ${result.activeCount} catalog places; ${newStandaloneCount} new places to review and ${newLinkCount} new links for link-only trails.`
  );
  for (const park of result.adoptedParks)
    console.log(`Adopted ${park.slug} in place [LIPAS ${park.lipasId}].`);
  if (result.adoptedParks.length)
    console.log(
      `Expire these public park URLs immediately: ${result.adoptedParks.map((park) => park.slug).join(', ')}`
    );
  for (const warning of result.mergeWarnings) console.warn(warning);
  if (result.affectedMergedTrailSlugs.length)
    console.log(
      `${result.dryRun ? 'After applying, expire' : 'Expire'} these merged-trail public park URLs: ${result.affectedMergedTrailSlugs.join(', ')}`
    );
  const hiddenPublicTrails = result.trailAreaResult?.newlyHiddenPublicSlugs ?? [];
  if (hiddenPublicTrails.length) {
    console.log(
      `Expire these former standalone trail pages: ${JSON.stringify({ parkSlugs: hiddenPublicTrails })}`
    );
  }
  if (result.affectedAreaLinkOnlySlugs.length) {
    console.log(
      `Expire these pages affected by link-only trails: ${JSON.stringify({ parkSlugs: result.affectedAreaLinkOnlySlugs })}`
    );
  }
} finally {
  await client.close();
}
