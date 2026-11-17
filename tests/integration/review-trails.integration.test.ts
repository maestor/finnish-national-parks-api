import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  dateRangeReviewPreviewSchema,
  dateRangeReviewPublishResponseSchema,
  dateRangeReviewShareResponseSchema
} from '../../src/contracts/date-range-review.js';
import {
  yearReviewPreviewSchema,
  yearReviewPublishResponseSchema,
  yearReviewShareResponseSchema
} from '../../src/contracts/year-review.js';
import { parks, parkVisits, trips, visitTrails } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
import { createLipasPark, createLipasTrail } from '../fixtures/lipas.js';
import { importPublishedParkFixtures } from '../helpers/import-published-park-fixtures.js';
import { createTestDatabase } from '../helpers/test-db.js';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
afterEach(async () => db?.dispose());

it.each(['year', 'date-range'] as const)(
  'includes assigned trails in %s previews and freezes them on publication',
  async (kind) => {
    db = await createTestDatabase();
    await importPublishedParkFixtures({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark(), createLipasTrail()] })
    });
    const [area] = await db.database
      .select()
      .from(parks)
      .where(eq(parks.lipasId, createLipasPark()['lipas-id']));
    const [trail] = await db.database
      .select()
      .from(parks)
      .where(eq(parks.lipasId, createLipasTrail()['lipas-id']));
    const timestamp = '2026-06-01T10:00:00.000Z';
    const visits = await db.database
      .insert(parkVisits)
      .values(
        [1, 2, 3].map((day) => ({
          parkId: area!.id,
          status: 'published' as const,
          visitedOn: `2026-06-0${day}`,
          route: 'Leiripaikka',
          createdAt: timestamp,
          updatedAt: timestamp
        }))
      )
      .returning();
    await db.database
      .insert(visitTrails)
      .values(visits.map((visit) => ({ visitId: visit.id, trailId: trail!.id })));
    const jwtSecret = 'test-jwt-secret-at-least-32-characters-long';
    const token = await createSessionToken(
      { email: 'admin@example.com', name: 'Admin', role: 'admin', sub: 'admin', picture: '' },
      new TextEncoder().encode(jwtSecret)
    );
    const app = createApp({
      database: db.database,
      auth: {
        cookieName: '__session',
        frontendUrl: 'http://localhost:4300',
        googleClientId: 'test',
        googleClientSecret: 'test',
        jwtSecret
      }
    });
    const headers = {
      cookie: `__session=${token}`,
      host: 'localhost:3004',
      'content-type': 'application/json'
    };
    const range = { name: 'Kesäretket', startDate: '2026-06-01', endDate: '2026-06-30' };
    const previewPath =
      kind === 'year'
        ? '/api/year-review/2026/preview'
        : `/api/date-range-review/preview?${new URLSearchParams(range)}`;
    const publishPath =
      kind === 'year' ? '/api/year-review/2026/publish' : '/api/date-range-review/publish';
    const expected = [{ id: trail!.id, name: trail!.name, slug: trail!.slug }];
    const preview = await app.request(previewPath, { headers });
    expect(preview.status).toBe(200);
    const body =
      kind === 'year'
        ? yearReviewPreviewSchema.parse(await preview.json())
        : dateRangeReviewPreviewSchema.parse(await preview.json());
    expect(body.story.cards.find((card) => card.kind === 'photo-highlight')?.visit).toMatchObject({
      route: 'Leiripaikka',
      trails: expected
    });
    expect(body.story.cards.find((card) => card.kind === 'new-parks')?.parks[0]?.trails).toEqual(
      expected
    );
    if (kind === 'year') {
      expect(body.story.cards.find((card) => card.kind === 'milestone')?.visit.trails).toEqual(
        expected
      );
    } else {
      expect(
        body.story.cards.find((card) => card.kind === 'other-visits')?.visits[0]?.trails
      ).toEqual(expected);
    }
    if (kind === 'date-range') {
      const [trip] = await db.database
        .insert(trips)
        .values({
          name: 'Kesäretki',
          slug: 'kesaretki',
          status: 'published',
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .returning();
      await db.database
        .update(parkVisits)
        .set({ tripId: trip!.id })
        .where(eq(parkVisits.id, visits[1]!.id));
      await db.database.insert(parkVisits).values({
        parkId: area!.id,
        status: 'published',
        visitedOn: '2025-06-01',
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const updated = dateRangeReviewPreviewSchema.parse(
        await (await app.request(previewPath, { headers })).json()
      );
      expect(
        updated.story.cards.find((card) => card.kind === 'revisited-parks')?.parks[0]?.trails
      ).toEqual(expected);
      expect(
        updated.story.cards.find((card) => card.kind === 'trip-summary')?.trip.visits[0]?.trails
      ).toEqual(expected);
    }
    const published = await app.request(publishPath, {
      method: 'POST',
      headers,
      ...(kind === 'date-range' ? { body: JSON.stringify(range) } : {})
    });
    expect(published.status).toBe(200);
    const { shareId } =
      kind === 'year'
        ? yearReviewPublishResponseSchema.parse(await published.json())
        : dateRangeReviewPublishResponseSchema.parse(await published.json());
    await db.database.delete(visitTrails);
    await db.database.update(parks).set({ name: 'Uusi nimi' }).where(eq(parks.id, trail!.id));
    const shared = await app.request(
      `/api/${kind === 'year' ? 'year-review' : 'date-range-review'}/shares/${shareId}`
    );
    expect(shared.status).toBe(200);
    expect(shared.headers.get('cache-control')).toBe('private, no-store');
    const share =
      kind === 'year'
        ? yearReviewShareResponseSchema.parse(await shared.json())
        : dateRangeReviewShareResponseSchema.parse(await shared.json());
    expect(
      share.story.cards.find((card) => card.kind === 'photo-highlight')?.visit?.trails
    ).toEqual(expected);
  }
);
