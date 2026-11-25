import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/database.js';
import { parkImportNotifications } from '../db/schema.js';

export type GithubReviewTarget = { repository: string; token: string };

const notificationParksSchema = z.array(
  z.object({
    lipasId: z.number().int(),
    name: z.string(),
    typeName: z.string()
  })
);
const duplicateTrailSchema = z.object({
  lipasId: z.number().int(),
  trailName: z.string(),
  matchedName: z.string(),
  matchedSlug: z.string(),
  source: z.string(),
  areaNames: z.array(z.string())
});
export type DuplicateTrailReview = z.infer<typeof duplicateTrailSchema>;

const notificationSchema = z.union([
  z.object({
    parks: notificationParksSchema,
    areaLinks: z.array(z.object({ trailName: z.string(), areaName: z.string() })),
    duplicateTrails: z.array(duplicateTrailSchema).default([])
  }),
  notificationParksSchema.transform((parks) => ({ parks, areaLinks: [], duplicateTrails: [] }))
]);
const nameAsCode = (name: string) => `\`${name.replace(/[`\r\n]/g, ' ')}\``;
const issuesSchema = z.array(z.object({ body: z.string().nullable() }));

export const sendPendingParkReviews = async (database: Database, target: GithubReviewTarget) => {
  const pending = await database
    .select()
    .from(parkImportNotifications)
    .orderBy(parkImportNotifications.importRunId);
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${target.token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2026-03-10'
  };
  const issuesUrl = `https://api.github.com/repos/${target.repository}/issues`;

  for (const notification of pending) {
    const marker = `<!-- lipas-import-review:${notification.importRunId} -->`;
    let alreadySent = false;
    let page = 1;

    // Include closed issues: closing a review must not cause a duplicate alert on retry.
    while (!alreadySent) {
      const response = await fetch(`${issuesUrl}?state=all&per_page=100&page=${page}`, {
        headers,
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) {
        throw new Error(`GitHub review lookup failed with status ${response.status}.`);
      }
      const issues = issuesSchema.parse(await response.json());
      alreadySent = issues.some((issue) => issue.body?.includes(marker) === true);
      if (issues.length < 100) break;
      page += 1;
    }

    if (!alreadySent) {
      const { parks, areaLinks, duplicateTrails } = notificationSchema.parse(
        JSON.parse(notification.parksJson)
      );
      const body = [marker, '@maestor LIPAS-tuonnin yhteenveto'];
      if (parks.length) {
        body.push(
          '### Uudet tarkistettavat kohteet',
          'Kohteet ovat piilotettuina. Tarkista tiedot ja ota haluamasi kohteet käyttöön hallintanäkymässä.',
          parks
            .map((park) => `- ${park.typeName}: ${nameAsCode(park.name)} (LIPAS ${park.lipasId})`)
            .join('\n')
        );
      }
      if (areaLinks.length) {
        body.push(
          '### Alueisiin liitetyt reitit',
          areaLinks
            .map(
              ({ trailName, areaName }) =>
                `- ${nameAsCode(trailName)} on liitetty kohteeseen ${nameAsCode(areaName)}.`
            )
            .join('\n')
        );
      }
      if (duplicateTrails.length) {
        body.push(
          '### Luettelossa jo olevat reitit',
          'Nämä LIPAS-reitit ohitettiin, koska vähintään 95 % kummankin reitin geometriasta oli enintään 25 metrin päässä toisesta reitistä.',
          duplicateTrails
            .map(({ lipasId, trailName, matchedName, matchedSlug, source, areaNames }) => {
              const areas = areaNames.length
                ? ` Alueet: ${areaNames.map(nameAsCode).join(', ')}.`
                : '';
              return `- ${nameAsCode(trailName)} ([LIPAS ${lipasId}](https://www.lipas.fi/liikuntapaikat/${lipasId})) vastaa reittiä ${nameAsCode(matchedName)} (${nameAsCode(matchedSlug)}, ${source}).${areas}`;
            })
            .join('\n')
        );
      }
      const title = duplicateTrails.length
        ? `LIPAS-tuonnin yhteenveto (${duplicateTrails.length} jo luettelossa olevaa reittiä)`
        : areaLinks.length
          ? `LIPAS-tuonnin yhteenveto (${parks.length} tarkistettavaa kohdetta, ${areaLinks.length} alueliitosta)`
          : `Uusia LIPAS-kohteita tarkistettavaksi (${parks.length})`;
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title,
          body: body.join('\n\n')
        }),
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) {
        throw new Error(`GitHub review creation failed with status ${response.status}.`);
      }
    }

    await database
      .delete(parkImportNotifications)
      .where(eq(parkImportNotifications.importRunId, notification.importRunId));
  }
};
