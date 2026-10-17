import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listParks } from '../../src/db/repositories.js';
import { parkImportNotifications, parks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { sendPendingParkReviews } from '../../src/importer/park-review-notifications.js';
import { runScheduledParkImport } from '../../src/importer/scheduled-park-import.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('weekly LIPAS import', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  const fetchMock = vi.fn<typeof fetch>();
  const github = { repository: 'maestor/finnish-national-parks-api', token: 'test-token' };
  const newPark = createLipasPark({ 'lipas-id': 99999, name: 'Uusi kansallispuisto' });
  let issues: { body: string }[];
  let failCreation: boolean;

  beforeEach(async () => {
    db = await createTestDatabase();
    issues = [];
    failCreation = false;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://api.lipas.fi/')) {
        return Response.json({ items: [createLipasPark(), newPark] });
      }
      if (url.startsWith('https://www.luontoon.fi/')) {
        return new Response('<urlset></urlset>');
      }
      expect(url).toMatch(
        /^https:\/\/api.github.com\/repos\/maestor\/finnish-national-parks-api\/issues/
      );
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
      if (init?.method === 'POST') {
        if (failCreation) return new Response(null, { status: 503 });
        const issue = JSON.parse(String(init.body)) as { body: string };
        issues.push(issue);
        return Response.json(issue, { status: 201 });
      }
      return Response.json(issues);
    });
    vi.stubGlobal('fetch', fetchMock);
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.dispose();
  });

  it('imports new parks hidden, alerts only maestor, and stays quiet on the next run', async () => {
    const result = await runScheduledParkImport(db.client, github);
    expect(result.newParks).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.body).toContain('@maestor');
    expect(issues[0]?.body).toContain('Uusi kansallispuisto');
    expect(issues[0]?.body).not.toContain('Äkäsmännyn');
    expect(await listParks(db.database)).toHaveLength(1);
    expect(await db.database.select().from(parks).where(eq(parks.lipasId, 99999))).toMatchObject([
      { removed: true }
    ]);
    expect(await db.database.select().from(parkImportNotifications)).toEqual([]);

    await runScheduledParkImport(db.client, github);
    expect(issues).toHaveLength(1);
  });

  it('keeps a failed notification for the next run even though the park is already imported', async () => {
    failCreation = true;
    await expect(runScheduledParkImport(db.client, github)).rejects.toThrow('503');
    expect(await db.database.select().from(parkImportNotifications)).toHaveLength(1);
    expect(await db.database.select().from(parks).where(eq(parks.lipasId, 99999))).toMatchObject([
      { removed: true }
    ]);

    failCreation = false;
    await runScheduledParkImport(db.client, github);
    expect(issues).toHaveLength(1);
    expect(await db.database.select().from(parkImportNotifications)).toEqual([]);
  });

  it('does not duplicate an issue if acknowledgement failed after GitHub created it', async () => {
    await db.client.executeMultiple(`
      CREATE TRIGGER fail_notification_ack BEFORE DELETE ON park_import_notifications
      BEGIN SELECT RAISE(ABORT, 'ack failed'); END;
    `);
    await expect(runScheduledParkImport(db.client, github)).rejects.toThrow('delete from');
    expect(issues).toHaveLength(1);
    await db.client.execute('DROP TRIGGER fail_notification_ack');

    await runScheduledParkImport(db.client, github);
    expect(issues).toHaveLength(1);
    expect(await db.database.select().from(parkImportNotifications)).toEqual([]);
  });

  it('refuses to import or notify when production has pending migrations', async () => {
    await db.client.execute(
      "DELETE FROM schema_migrations WHERE name = '0045_home_featured_park.sql'"
    );
    await expect(runScheduledParkImport(db.client, github)).rejects.toThrow('pending migrations');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.database.select().from(parks)).toHaveLength(1);
  });

  it('rolls back new parks if the notification cannot be saved in the import transaction', async () => {
    await db.client.executeMultiple(`
      CREATE TRIGGER fail_notification_queue BEFORE INSERT ON park_import_notifications
      BEGIN SELECT RAISE(ABORT, 'queue failed'); END;
    `);
    await expect(runScheduledParkImport(db.client, github)).rejects.toThrow('insert into');
    expect(await db.database.select().from(parks)).toHaveLength(1);
    expect(await db.database.select().from(parkImportNotifications)).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('does not persist queued notifications during a dry run or an ordinary manual import', async () => {
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({ items: [createLipasPark(), newPark] }),
      dryRun: true,
      queueNewParkNotification: true
    });
    expect(await db.database.select().from(parks)).toHaveLength(1);
    expect(await db.database.select().from(parkImportNotifications)).toEqual([]);
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({ items: [createLipasPark(), newPark] })
    });
    expect(await db.database.select().from(parks)).toHaveLength(2);
    expect(await db.database.select().from(parkImportNotifications)).toEqual([]);
  });

  it('delivers an older queued report even if LIPAS is unavailable this week', async () => {
    failCreation = true;
    await expect(runScheduledParkImport(db.client, github)).rejects.toThrow('503');
    failCreation = false;
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) =>
      String(input).startsWith('https://api.lipas.fi/')
        ? Promise.reject(new Error('LIPAS unavailable'))
        : normalFetch(input, init)
    );
    await expect(runScheduledParkImport(db.client, github)).rejects.toThrow('LIPAS unavailable');
    expect(issues).toHaveLength(1);
    expect(await db.database.select().from(parkImportNotifications)).toEqual([]);
  });

  it.each(['lookup forbidden', 'invalid response', 'network unavailable'])(
    'keeps reports pending when GitHub fails: %s',
    async (failure) => {
      failCreation = true;
      await expect(runScheduledParkImport(db.client, github)).rejects.toThrow('503');
      fetchMock.mockImplementation(async () => {
        if (failure === 'lookup forbidden') return new Response(null, { status: 403 });
        if (failure === 'invalid response') return Response.json({ message: 'unexpected' });
        throw new Error('network unavailable');
      });
      await expect(sendPendingParkReviews(db.database, github)).rejects.toThrow();
      expect(await db.database.select().from(parkImportNotifications)).toHaveLength(1);
      expect(issues).toEqual([]);
    }
  );

  it.each(['second page', 'full matching page', 'no existing issue'])(
    'searches closed issues and pagination before retrying: %s',
    async (scenario) => {
      await db.client.executeMultiple(`
        CREATE TRIGGER fail_notification_ack BEFORE DELETE ON park_import_notifications
        BEGIN SELECT RAISE(ABORT, 'ack failed'); END;
      `);
      await expect(runScheduledParkImport(db.client, github)).rejects.toThrow('delete from');
      await db.client.execute('DROP TRIGGER fail_notification_ack');
      const existing = { ...issues[0]!, state: 'closed' };
      const fullPage = Array.from({ length: 100 }, () => ({ body: null, state: 'closed' }));
      const normalFetch = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input, init) => {
        if (init?.method === 'POST') return normalFetch(input, init);
        const page = new URL(String(input)).searchParams.get('page');
        if (page === '1') {
          return Response.json(
            scenario === 'full matching page' ? [...fullPage.slice(1), existing] : fullPage
          );
        }
        return Response.json(scenario === 'second page' ? [existing] : []);
      });
      await sendPendingParkReviews(db.database, github);
      expect(issues).toHaveLength(scenario === 'no existing issue' ? 2 : 1);
      expect(await db.database.select().from(parkImportNotifications)).toEqual([]);
    }
  );

  it('keeps upstream names inside code spans so names cannot add mentions or Markdown', async () => {
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          {
            ...newPark,
            name: 'Puisto`\n@someone\r**nimi**'
          }
        ]
      }),
      markNewParksRemoved: true,
      queueNewParkNotification: true
    });
    await sendPendingParkReviews(db.database, github);
    expect(issues[0]?.body).toContain('`Puisto  @someone **nimi**`');
  });
});
