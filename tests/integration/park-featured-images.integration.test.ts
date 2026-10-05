import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { parkDetailSchema, parkImageCandidatesResponseSchema } from '../../src/contracts/parks.js';
import { createVisitImage } from '../../src/db/repositories.js';
import { parks } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const auth = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-client',
  googleClientSecret: 'test-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};

// Covers published-only selection, availability, ownership, pagination, withdrawal,
// deletion, authentication, storage failures, and park cache validators.
describe('park featured images API', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  const publicMediaUrl = vi.fn(
    async (key: string) => `https://api.example.test/assets/media/${key}`
  );
  beforeEach(async () => {
    publicMediaUrl.mockClear();
    db = await createTestDatabase();
    cookie = `__session=${await createSessionToken({ email: 'admin@example.com', name: 'Admin', picture: '', role: 'admin', sub: 'admin' }, new TextEncoder().encode(auth.jwtSecret))}`;
    await importParks({
      database: db.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    app = createApp({
      auth,
      database: db.database,
      storage: createMemoryStorage(),
      getPublicMediaUrl: publicMediaUrl
    });
  });
  afterEach(async () => {
    await db.dispose();
  });
  const write = async (path: string, body: object, method = 'POST') => {
    const response = await app.request(path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    expect(response.status, text).toBeLessThan(300);
    return (text ? JSON.parse(text) : {}) as { id: number; slug: string };
  };
  const visit = (body: object) =>
    write('/api/parks/akasmannyn-kansallispuisto/visits', { status: 'published', ...body });

  const slug = 'akasmannyn-kansallispuisto';
  const path = `/api/admin/parks/${slug}/featured-image`;
  const detail = async () => {
    const response = await app.request(`/api/parks/${slug}`);
    return {
      body: parkDetailSchema.parse(await response.json()),
      etag: response.headers.get('etag')!
    };
  };
  const image = (visitId: number, name: string) =>
    createVisitImage(db.database, {
      visitId,
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
      displayOrder: 0,
      fullKey: `visits/${visitId}/${name}.jpg`,
      thumbKey: `visits/${visitId}/${name}-thumb.jpg`,
      mimeType: 'image/jpeg',
      fullWidth: 1200,
      fullHeight: 800
    });
  const select = (imageId: number | null) =>
    write(
      path,
      {
        featuredImage: imageId === null ? null : { imageId, source: 'visit-image' }
      },
      'PATCH'
    );

  it('selects, replaces, clears and paginates visit photos with fresh park validators', async () => {
    expect((await detail()).body.featuredImage).toBeNull();
    const first = await visit({ visitedOn: '2026-06-01' });
    const second = await visit({ visitedOn: '2026-07-01' });
    const cover = await image(first.id, 'cover');
    const other = await image(second.id, 'other');
    const draft = await visit({ visitedOn: '2026-08-01', status: 'draft' });
    await image(draft.id, 'draft');
    const response = await app.request(`/api/admin/parks/${slug}/images?limit=1`, {
      headers: { cookie }
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const page = parkImageCandidatesResponseSchema.parse(await response.json());
    expect(page).toMatchObject({ images: [{ reference: { imageId: other.id } }], nextOffset: 1 });
    const next = await app.request(`/api/admin/parks/${slug}/images?limit=1&offset=1`, {
      headers: { cookie }
    });
    expect(await next.json()).toMatchObject({
      images: [{ reference: { imageId: cover.id } }],
      nextOffset: null
    });
    const before = await detail();
    await select(cover.id);
    const selected = await detail();
    expect(selected.body.featuredImage).toMatchObject({
      id: cover.id,
      fullUrl: `https://api.example.test/assets/media/visits/${first.id}/cover.jpg`
    });
    expect(selected.etag).not.toBe(before.etag);
    expect(
      (await app.request(`/api/parks/${slug}`, { headers: { 'if-none-match': selected.etag } }))
        .status
    ).toBe(304);
    expect(await (await app.request(path, { headers: { cookie } })).json()).toMatchObject({
      featuredImage: { reference: { imageId: cover.id } }
    });
    await select(other.id);
    expect((await detail()).body.featuredImage?.id).toBe(other.id);
    await select(null);
    expect((await detail()).body.featuredImage).toBeNull();
  });

  it('offers only published visit images and rejects a draft image even when submitted directly', async () => {
    const record = await visit({ visitedOn: '2026-06-01', status: 'draft' });
    const cover = await image(record.id, 'cover');
    expect(await (await app.request(path, { headers: { cookie } })).json()).toEqual({
      featuredImage: null,
      hasImages: false
    });
    expect(
      await (await app.request(`/api/admin/parks/${slug}/images`, { headers: { cookie } })).json()
    ).toEqual({ images: [], nextOffset: null });
    expect(
      (
        await app.request(path, {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ featuredImage: { imageId: cover.id, source: 'visit-image' } })
        })
      ).status
    ).toBe(422);
    await write(`/api/visits/${record.id}`, { status: 'published' }, 'PATCH');
    expect(await (await app.request(path, { headers: { cookie } })).json()).toEqual({
      featuredImage: null,
      hasImages: true
    });
    await select(cover.id);
    const published = await detail();
    expect(published.body.featuredImage?.id).toBe(cover.id);
    await write(`/api/visits/${record.id}`, { status: 'draft' }, 'PATCH');
    expect((await detail()).etag).not.toBe(published.etag);
    expect((await detail()).body.featuredImage).toBeNull();
    expect(await (await app.request(path, { headers: { cookie } })).json()).toEqual({
      featuredImage: null,
      hasImages: false
    });
    await write(`/api/visits/${record.id}`, { status: 'published' }, 'PATCH');
    await db.database.update(parks).set({ removed: true }).where(eq(parks.slug, slug));
    const hidden = await app.request(`/api/parks/${slug}`, { headers: { cookie } });
    expect(hidden.headers.get('cache-control')).toBe('private, no-store');
    expect(await hidden.json()).toHaveProperty('featuredImage.fullUrl');
    await write(`/api/visits/${record.id}/images/${cover.id}`, {}, 'DELETE');
    expect(await (await app.request(path, { headers: { cookie } })).json()).toEqual({
      featuredImage: null,
      hasImages: false
    });
  });
  it('rejects unauthorized, missing, invalid and foreign selections', async () => {
    for (const [endpoint, method] of [
      [path, 'GET'],
      [path, 'PATCH'],
      [`/api/admin/parks/${slug}/images`, 'GET']
    ] as const) {
      const options = {
        method,
        ...(method === 'PATCH'
          ? {
              body: JSON.stringify({ featuredImage: null }),
              headers: { 'content-type': 'application/json' }
            }
          : {})
      };
      expect((await app.request(endpoint, options)).status).toBe(401);
      expect((await createApp({ database: db.database }).request(endpoint!, options)).status).toBe(
        503
      );
      expect(
        (
          await app.request(endpoint.replace(slug, 'missing'), {
            ...options,
            headers: { ...options.headers, cookie }
          })
        ).status
      ).toBe(404);
    }
    for (const body of [
      { featuredImage: { imageId: -1, source: 'visit-image' } },
      { featuredImage: { imageId: 1, source: 'trip-stop-image' } },
      {}
    ]) {
      expect(
        (
          await app.request(path, {
            method: 'PATCH',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify(body)
          })
        ).status
      ).toBe(400);
    }
    for (const query of ['limit=0', 'limit=101', 'offset=-1']) {
      expect(
        (await app.request(`/api/admin/parks/${slug}/images?${query}`, { headers: { cookie } }))
          .status
      ).toBe(400);
    }
    await importParks({
      database: db.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark(), createLipasPark({ 'lipas-id': 999, name: 'Muu puisto' })]
      })
    });
    const foreign = await write('/api/parks/muu-puisto/visits', {
      visitedOn: '2026-07-01',
      status: 'published'
    });
    const photo = await image(foreign.id, 'foreign');
    for (const imageId of [photo.id, 99999]) {
      expect(
        (
          await app.request(path, {
            method: 'PATCH',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ featuredImage: { imageId, source: 'visit-image' } })
          })
        ).status
      ).toBe(422);
    }
  });

  it('handles absent storage and preserves selections when storage or the database fails', async () => {
    const unavailable = createApp({ database: db.database, auth });
    expect(await (await unavailable.request(path, { headers: { cookie } })).json()).toEqual({
      featuredImage: null,
      hasImages: false
    });
    expect(
      await (
        await unavailable.request(`/api/admin/parks/${slug}/images`, { headers: { cookie } })
      ).json()
    ).toEqual({ images: [], nextOffset: null });
    const record = await visit({ visitedOn: '2026-07-01' });
    const photo = await image(record.id, 'cover');
    await select(photo.id);
    expect((await unavailable.request(path, { headers: { cookie } })).status).toBe(503);
    expect(
      (await unavailable.request(`/api/admin/parks/${slug}/images`, { headers: { cookie } })).status
    ).toBe(503);
    expect(
      (
        await unavailable.request(path, {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ featuredImage: { imageId: photo.id, source: 'visit-image' } })
        })
      ).status
    ).toBe(503);
    expect(await (await unavailable.request(`/api/parks/${slug}`)).json()).toHaveProperty(
      'featuredImage',
      null
    );
    const spy = vi
      .spyOn(db.database, 'transaction')
      .mockRejectedValueOnce(new Error('database unavailable'));
    expect(
      (
        await app.request(path, {
          method: 'PATCH',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ featuredImage: null })
        })
      ).status
    ).toBe(500);
    spy.mockRestore();
    expect((await detail()).body.featuredImage?.id).toBe(photo.id);
    await write(`/api/parks/${slug}`, { name: 'Uusi nimi', slug }, 'PATCH');
    expect(await (await app.request(path, { headers: { cookie } })).json()).toMatchObject({
      featuredImage: { sourceLabel: 'Uusi nimi' }
    });
    const clear = await unavailable.request(path, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ featuredImage: null })
    });
    expect(clear.status).toBe(200);
    expect((await detail()).body.featuredImage).toBeNull();
  });
});
