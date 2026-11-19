import { createDatabaseClient } from '../db/client.js';
import { getEnv } from '../env.js';
import { runScheduledParkImport } from '../importer/scheduled-park-import.js';

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
  console.log(
    `Imported ${result.activeCount} catalog places; ${result.newParks.length} new parks sent for review.`
  );
  for (const park of result.adoptedParks)
    console.log(`Adopted ${park.slug} in place [LIPAS ${park.lipasId}].`);
  if (result.adoptedParks.length)
    console.log(
      `Expire these public park URLs immediately: ${result.adoptedParks.map((park) => park.slug).join(', ')}`
    );
  for (const trail of result.excludedLongTrails)
    console.log(
      `Excluded long trail: ${trail.name} [${trail.lipasId}]: ${trail.reportedLengthKm?.toFixed(3) ?? 'unknown'} km reported, ${trail.measuredLengthKm?.toFixed(3) ?? 'unknown'} km measured.`
    );
} finally {
  await client.close();
}
