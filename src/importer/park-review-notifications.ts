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
      const parks = notificationParksSchema.parse(JSON.parse(notification.parksJson));
      const body = [
        marker,
        '@maestor Uusia LIPAS-kohteita on tuotu tarkistettavaksi.',
        'Kohteet ovat piilotettuina. Tarkista tiedot ja ota haluamasi kohteet käyttöön hallintanäkymässä.',
        ...parks.map(
          (park) =>
            `- ${park.typeName}: \`${park.name.replace(/[`\r\n]/g, ' ')}\` (LIPAS ${park.lipasId})`
        )
      ].join('\n\n');
      const response = await fetch(issuesUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: `Uusia LIPAS-kohteita tarkistettavaksi (${parks.length})`,
          body
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
