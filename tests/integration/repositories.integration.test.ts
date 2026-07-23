import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTrip,
  createTripStop,
  createVisit,
  createVisitImage,
  deleteTrip,
  deleteTripStop,
  deleteVisit,
  deleteVisitImage,
  getCatalogListEtagSeed,
  getParkBySlug,
  getParkBySlugIncludingRemoved,
  getParkVisitsBySlug,
  getPublicHomeSummary,
  getPublicVisitSummaryEtagSeed,
  getTripById,
  getVisitById,
  listParkRecordsIncludingRemoved,
  listPublicParks,
  listRemovedParks,
  listTrips,
  listVisits,
  reassignParkVisits,
  reorderVisitImages,
  updateParkDetails,
  updateParkLogo,
  updateParkMap,
  updateTrip,
  updateTripStop,
  updateVisit
} from '../../src/db/repositories.js';
import { parks, parkVisits } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('repositories', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  it('returns null for missing parks', async () => {
    await expect(getParkBySlug(testDatabase.database, 'missing-park')).resolves.toBeNull();
    await expect(
      getParkBySlugIncludingRemoved(testDatabase.database, 'missing-park')
    ).resolves.toBeNull();
    await expect(
      getParkVisitsBySlug(testDatabase.database, 'missing-park', async () => '')
    ).resolves.toBeNull();
    await expect(getVisitById(testDatabase.database, 99999, async () => '')).resolves.toBeNull();

    const parkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );
    expect(parkVisits?.visits).toEqual([]);
  });

  it('returns null when updating logo for a missing park', async () => {
    const result = await updateParkLogo(testDatabase.database, 'missing-park', {
      key: 'logos/test.png',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    expect(result).toBeNull();
  });

  it('returns null when updating map for a missing park', async () => {
    const result = await updateParkMap(testDatabase.database, 'missing-park', {
      key: 'pdf-maps/test.pdf',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    expect(result).toBeNull();
  });

  it('returns null when updating details for a missing park', async () => {
    await expect(
      updateParkDetails(testDatabase.database, 'missing-park', {
        name: 'Missing park'
      })
    ).resolves.toBeNull();
  });

  it('updates editable park details and resolves removed parks when requested explicitly', async () => {
    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const updated = await updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
      areaKm2: null,
      displayTypeName: null,
      establishmentYear: 1999,
      locationLabel: 'Oma osoite 4',
      parkUrl: 'www.luontoon.fi/oma-kohde',
      name: 'Oma kohde',
      postalCode: null,
      postalOffice: 'Muonio'
    });

    expect(updated).toMatchObject({
      address: 'Oma osoite 4, Muonio',
      areaKm2: null,
      establishmentYear: 1999,
      locationLabel: 'Oma osoite 4',
      parkUrl: 'https://www.luontoon.fi/oma-kohde',
      name: 'Oma kohde',
      postalCode: null,
      postalOffice: 'Muonio',
      slug: 'oma-kohde'
    });
    expect(updated).not.toHaveProperty('displayTypeName');
    await expect(getParkBySlug(testDatabase.database, 'oma-kohde')).resolves.toBeNull();
    await expect(
      getParkBySlugIncludingRemoved(testDatabase.database, 'oma-kohde')
    ).resolves.toMatchObject({
      name: 'Oma kohde',
      slug: 'oma-kohde'
    });
  });

  it('rejects invalid luontoon urls and conflicting park slugs', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-second-park',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 67890,
            name: 'Seitsemisen kansallispuisto',
            location: {
              address: 'Seitsemisentie 1',
              'postal-office': 'Ylöjärvi'
            },
            www: 'https://www.luontoon.fi/seitseminen'
          })
        ]
      })
    });

    await expect(
      updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
        parkUrl: 'not a real url'
      })
    ).rejects.toThrow('Invalid park URL.');

    await expect(
      updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
        slug: 'seitsemisen-kansallispuisto'
      })
    ).rejects.toThrow('Park slug "seitsemisen-kansallispuisto" is already in use.');

    await expect(
      updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
        name: '   '
      })
    ).rejects.toThrow('Name is required.');
  });

  it('can clear park url while leaving other editable fields unchanged', async () => {
    const updated = await updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
      parkUrl: null,
      name: 'Päivitetty puisto'
    });

    expect(updated).toMatchObject({
      address: 'Puistotie 1, 00999 Testikylä',
      areaKm2: 12.5,
      establishmentYear: 1982,
      locationLabel: 'Puistotie 1',
      parkUrl: null,
      name: 'Päivitetty puisto',
      postalCode: '00999',
      postalOffice: 'Testikylä',
      slug: 'paivitetty-puisto'
    });
    expect(updated).not.toHaveProperty('displayTypeName');
  });

  it('accepts non-Luontoon park urls for admin-managed park details', async () => {
    const updated = await updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
      parkUrl: 'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/kohteet/testipuisto/'
    });

    expect(updated).toMatchObject({
      parkUrl: 'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/kohteet/testipuisto'
    });
  });

  it('lists park records including removed rows with display type names', async () => {
    await testDatabase.database
      .update(parks)
      .set({
        displayTypeName: 'Ystävyyden puisto',
        removed: true
      })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(listParkRecordsIncludingRemoved(testDatabase.database)).resolves.toEqual([
      {
        displayTypeName: 'Ystävyyden puisto',
        slug: 'akasmannyn-kansallispuisto'
      }
    ]);
  });

  it('normalizes park location values for address, postal code, and postal office combinations', async () => {
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: 'Puistotie 1, 00999 Testikylä'
    });

    await testDatabase.database
      .update(parks)
      .set({ postalOffice: 'Puistotie 1' })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: 'Puistotie 1, 00999'
    });

    await testDatabase.database
      .update(parks)
      .set({ postalCode: null })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: 'Puistotie 1'
    });

    await testDatabase.database
      .update(parks)
      .set({ locationLabel: '', postalCode: '00999', postalOffice: 'Testikylä' })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: '00999 Testikylä'
    });

    await testDatabase.database
      .update(parks)
      .set({ locationLabel: 'Puistotie 1', postalOffice: null, postalCode: null })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: 'Puistotie 1'
    });
  });

  it('preserves existing visit fields when only the date changes and reports missing deletes', async () => {
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      author: 'Alice',
      note: 'First draft',
      route: 'Loop A',
      visitedOn: '2026-04-11'
    });

    const updatedVisit = await updateVisit(testDatabase.database, visit.id, {
      visitedOn: '2026-04-12'
    });

    expect(updatedVisit).toMatchObject({
      author: 'Alice',
      note: 'First draft',
      route: 'Loop A',
      visitedOn: '2026-04-12'
    });
    await expect(deleteVisit(testDatabase.database, 99999)).resolves.toBe(false);
    await expect(deleteVisitImage(testDatabase.database, 99999)).resolves.toBe(false);
  });

  it('supports creating visits without optional fields and patching individual fields', async () => {
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-13'
    });

    expect(visit.author).toBeNull();
    expect(visit.note).toBeNull();
    expect(visit.route).toBeNull();

    const updatedVisit = await updateVisit(testDatabase.database, visit.id, {
      author: 'Bob',
      note: 'Added later',
      route: 'Loop B'
    });

    expect(updatedVisit).toMatchObject({
      author: 'Bob',
      note: 'Added later',
      route: 'Loop B',
      visitedOn: '2026-04-13'
    });

    const clearedVisit = await updateVisit(testDatabase.database, visit.id, {
      author: '   ',
      note: '   ',
      route: '   '
    });

    expect(clearedVisit).toMatchObject({
      author: null,
      note: null,
      route: null,
      visitedOn: '2026-04-13'
    });
  });

  it('creates, updates, lists, and deletes trips while clearing assigned visits', async () => {
    const trip = await createTrip(testDatabase.database, {
      description: 'Lapin kansallispuistoja.',
      name: 'Kesäreissu 2026',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });
    const assignedVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });
    const looseVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-14'
    });

    expect(trip).toMatchObject({
      dateRange: null,
      description: 'Lapin kansallispuistoja.',
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      },
      visitCount: 0
    });

    const updatedVisit = await updateVisit(testDatabase.database, looseVisit.id, {
      tripId: trip.id
    });
    const listedTrips = await listTrips(testDatabase.database);
    const listedVisits = await listVisits(testDatabase.database, async () => '');
    const visitDetail = await getVisitById(testDatabase.database, assignedVisit.id, async () => '');

    expect(updatedVisit?.trip).toEqual({
      id: trip.id,
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026'
    });
    expect(listedTrips).toEqual([
      expect.objectContaining({
        dateRange: {
          end: '2026-04-14',
          start: '2026-04-13'
        },
        description: 'Lapin kansallispuistoja.',
        id: trip.id,
        name: 'Kesäreissu 2026',
        slug: 'kesareissu-2026',
        startingPoint: {
          coordinate: {
            lat: 60.1699,
            lon: 24.9384
          },
          label: 'Helsinki'
        },
        visitCount: 2
      })
    ]);
    expect(listedVisits.find((visit) => visit.id === assignedVisit.id)?.trip).toEqual({
      id: trip.id,
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026'
    });
    expect(visitDetail?.trip).toEqual({
      id: trip.id,
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026'
    });

    const renamedTrip = await updateTrip(testDatabase.database, trip.id, {
      description: 'Päivitetty kuvaus.',
      name: 'Kesäreissu 2026 v2',
      startingPoint: {
        coordinate: {
          lat: 61.4978,
          lon: 23.761
        },
        label: 'Tampere'
      }
    });

    expect(renamedTrip).toMatchObject({
      description: 'Päivitetty kuvaus.',
      id: trip.id,
      name: 'Kesäreissu 2026 v2',
      slug: 'kesareissu-2026-v2',
      startingPoint: {
        coordinate: {
          lat: 61.4978,
          lon: 23.761
        },
        label: 'Tampere'
      }
    });

    const descriptionOnlyTrip = await updateTrip(testDatabase.database, trip.id, {
      description: 'Vain kuvaus muuttui.'
    });

    expect(descriptionOnlyTrip).toMatchObject({
      description: 'Vain kuvaus muuttui.',
      id: trip.id,
      name: 'Kesäreissu 2026 v2',
      slug: 'kesareissu-2026-v2',
      startingPoint: {
        coordinate: {
          lat: 61.4978,
          lon: 23.761
        },
        label: 'Tampere'
      }
    });

    const nameOnlyTrip = await updateTrip(testDatabase.database, trip.id, {
      name: 'Kesäreissu 2026 v3'
    });

    expect(nameOnlyTrip).toMatchObject({
      description: 'Vain kuvaus muuttui.',
      id: trip.id,
      name: 'Kesäreissu 2026 v3',
      slug: 'kesareissu-2026-v3'
    });

    const clearedStartingPointTrip = await updateTrip(testDatabase.database, trip.id, {
      startingPoint: null
    });

    expect(clearedStartingPointTrip).toMatchObject({
      description: 'Vain kuvaus muuttui.',
      id: trip.id,
      name: 'Kesäreissu 2026 v3',
      slug: 'kesareissu-2026-v3',
      startingPoint: null
    });

    await expect(deleteTrip(testDatabase.database, trip.id)).resolves.toBe(true);
    await expect(deleteTrip(testDatabase.database, 99999)).resolves.toBe(false);
    await expect(listTrips(testDatabase.database)).resolves.toEqual([]);
    await expect(
      getVisitById(testDatabase.database, assignedVisit.id, async () => '')
    ).resolves.toMatchObject({
      trip: null
    });
    await expect(
      getVisitById(testDatabase.database, looseVisit.id, async () => '')
    ).resolves.toMatchObject({
      trip: null
    });
  });

  it('suffixes duplicate trip slugs on create and update', async () => {
    const firstTrip = await createTrip(testDatabase.database, {
      name: 'Kesäreissu 2026'
    });
    const secondTrip = await createTrip(testDatabase.database, {
      name: 'Kesäreissu 2026'
    });

    expect(firstTrip.slug).toBe('kesareissu-2026');
    expect(secondTrip.slug).toBe('kesareissu-2026-2');

    const renamedSecondTrip = await updateTrip(testDatabase.database, secondTrip.id, {
      slug: firstTrip.slug
    });

    expect(renamedSecondTrip).toMatchObject({
      id: secondTrip.id,
      slug: 'kesareissu-2026-2'
    });
  });

  it('stores trip stops in the shared itinerary order between visits', async () => {
    const trip = await createTrip(testDatabase.database, {
      name: 'Kesäreissu 2026',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });
    const firstVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-04-13'
    });
    const secondVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-04-13'
    });

    const stop = await createTripStop(testDatabase.database, trip.id, {
      location: {
        coordinate: {
          lat: 61.3167,
          lon: 22.1333
        },
        label: 'ABC Huittinen'
      },
      note: 'Lunch break',
      tripStopOrder: 2
    });
    const tripDetail = await getTripById(testDatabase.database, trip.id);

    expect(stop).toMatchObject({
      location: {
        coordinate: {
          lat: 61.3167,
          lon: 22.1333
        },
        label: 'ABC Huittinen'
      },
      note: 'Lunch break',
      tripStopOrder: 2
    });
    expect(tripDetail).toMatchObject({
      id: trip.id,
      itinerary: [
        {
          kind: 'visit',
          tripStopOrder: 1,
          visit: {
            id: firstVisit.id
          }
        },
        {
          kind: 'stop',
          tripStopOrder: 2,
          stop: {
            id: stop.id,
            note: 'Lunch break'
          }
        },
        {
          kind: 'visit',
          tripStopOrder: 3,
          visit: {
            id: secondVisit.id
          }
        }
      ]
    });

    const relocatedStop = await updateTripStop(testDatabase.database, stop.id, {
      location: {
        coordinate: {
          lat: 61.451,
          lon: 23.856
        },
        label: 'Yöpyminen Tampereella'
      }
    });

    expect(relocatedStop).toMatchObject({
      location: {
        coordinate: {
          lat: 61.451,
          lon: 23.856
        },
        label: 'Yöpyminen Tampereella'
      },
      note: 'Lunch break',
      tripStopOrder: 2
    });

    const movedStop = await updateTripStop(testDatabase.database, stop.id, {
      note: 'Coffee break',
      tripStopOrder: 1
    });
    const movedTripDetail = await getTripById(testDatabase.database, trip.id);

    expect(movedStop).toMatchObject({
      note: 'Coffee break',
      tripStopOrder: 1
    });
    expect(movedTripDetail?.itinerary.map((entry) => entry.tripStopOrder)).toEqual([1, 2, 3]);
    expect(movedTripDetail?.itinerary[0]).toMatchObject({
      kind: 'stop',
      tripStopOrder: 1
    });

    await expect(deleteTripStop(testDatabase.database, stop.id)).resolves.toBe(true);
    await expect(deleteTripStop(testDatabase.database, 99999)).resolves.toBe(false);
    await expect(getTripById(testDatabase.database, trip.id)).resolves.toMatchObject({
      itinerary: [
        {
          kind: 'visit',
          tripStopOrder: 1,
          visit: {
            id: firstVisit.id
          }
        },
        {
          kind: 'visit',
          tripStopOrder: 2,
          visit: {
            id: secondVisit.id
          }
        }
      ]
    });
  });

  it('rejects missing trip assignments when creating or updating visits', async () => {
    await expect(
      createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
        tripId: 99999,
        visitedOn: '2026-04-13'
      })
    ).rejects.toThrow('Trip not found.');

    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-13'
    });

    await expect(
      updateVisit(testDatabase.database, visit.id, {
        tripId: 99999
      })
    ).rejects.toThrow('Trip not found.');
  });

  it('assigns and reorders explicit stop order inside a trip', async () => {
    const trip = await createTrip(testDatabase.database, {
      name: 'Kesäreissu 2026'
    });
    const firstVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });
    const secondVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });

    expect(firstVisit.tripStopOrder).toBe(1);
    expect(secondVisit.tripStopOrder).toBe(2);

    const movedSecondVisit = await updateVisit(testDatabase.database, secondVisit.id, {
      tripStopOrder: 1
    });
    const firstVisitAfterMove = await getVisitById(
      testDatabase.database,
      firstVisit.id,
      async () => ''
    );

    expect(movedSecondVisit).toMatchObject({
      trip: {
        id: trip.id,
        name: 'Kesäreissu 2026'
      },
      tripStopOrder: 1
    });
    expect(firstVisitAfterMove).toMatchObject({
      tripStopOrder: 2
    });

    const clearedVisit = await updateVisit(testDatabase.database, secondVisit.id, {
      tripId: null
    });

    expect(clearedVisit).toMatchObject({
      trip: null,
      tripStopOrder: null
    });
  });

  it('keeps order stable when re-saving the same stop and closes gaps after delete', async () => {
    const trip = await createTrip(testDatabase.database, {
      name: 'Kesäreissu 2026'
    });
    const firstVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });
    const secondVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });
    const thirdVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });

    const unchangedSecondVisit = await updateVisit(testDatabase.database, secondVisit.id, {
      tripStopOrder: 2
    });
    const movedFirstVisit = await updateVisit(testDatabase.database, firstVisit.id, {
      tripStopOrder: 3
    });
    const secondVisitAfterMove = await getVisitById(
      testDatabase.database,
      secondVisit.id,
      async () => ''
    );
    const thirdVisitAfterMove = await getVisitById(
      testDatabase.database,
      thirdVisit.id,
      async () => ''
    );

    expect(unchangedSecondVisit).toMatchObject({
      tripStopOrder: 2
    });
    expect(movedFirstVisit).toMatchObject({
      tripStopOrder: 3
    });
    expect(secondVisitAfterMove).toMatchObject({
      tripStopOrder: 1
    });
    expect(thirdVisitAfterMove).toMatchObject({
      tripStopOrder: 2
    });

    await expect(deleteVisit(testDatabase.database, thirdVisit.id)).resolves.toBe(true);
    await expect(
      getVisitById(testDatabase.database, firstVisit.id, async () => '')
    ).resolves.toMatchObject({
      tripStopOrder: 2
    });
  });

  it('rejects stop order changes without an assigned trip', async () => {
    await expect(
      createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
        tripStopOrder: 1,
        visitedOn: '2026-04-13'
      })
    ).rejects.toThrow('Trip stop order requires an assigned trip.');

    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-13'
    });

    await expect(
      updateVisit(testDatabase.database, visit.id, {
        tripStopOrder: 1
      })
    ).rejects.toThrow('Trip stop order requires an assigned trip.');
  });

  it('repairs legacy trip visits that are missing stop order values', async () => {
    const trip = await createTrip(testDatabase.database, {
      name: 'Kesäreissu 2026'
    });
    const firstVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });
    const secondVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });

    await testDatabase.database
      .update(parkVisits)
      .set({
        tripStopOrder: null
      })
      .where(eq(parkVisits.id, secondVisit.id));

    const repairedVisit = await updateVisit(testDatabase.database, secondVisit.id, {
      note: 'Recovered stop order'
    });

    expect(repairedVisit).toMatchObject({
      note: 'Recovered stop order',
      tripStopOrder: 2
    });

    await testDatabase.database
      .update(parkVisits)
      .set({
        tripStopOrder: null
      })
      .where(eq(parkVisits.id, firstVisit.id));

    const insertedVisit = await updateVisit(testDatabase.database, firstVisit.id, {
      tripStopOrder: 1
    });
    const secondVisitAfterInsert = await getVisitById(
      testDatabase.database,
      secondVisit.id,
      async () => ''
    );

    expect(insertedVisit).toMatchObject({
      tripStopOrder: 1
    });
    expect(secondVisitAfterInsert).toMatchObject({
      tripStopOrder: 3
    });
  });

  it('resequences both trips when moving a visit between trips and keeps order on plain updates', async () => {
    const originTrip = await createTrip(testDatabase.database, {
      name: 'Kesäreissu 2026'
    });
    const destinationTrip = await createTrip(testDatabase.database, {
      name: 'Syysreissu 2026'
    });
    const originFirstVisit = await createVisit(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      {
        tripId: originTrip.id,
        visitedOn: '2026-04-13'
      }
    );
    const originSecondVisit = await createVisit(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      {
        tripId: originTrip.id,
        visitedOn: '2026-04-13'
      }
    );
    const destinationVisit = await createVisit(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      {
        tripId: destinationTrip.id,
        visitedOn: '2026-04-13'
      }
    );

    const movedVisit = await updateVisit(testDatabase.database, originFirstVisit.id, {
      tripId: destinationTrip.id,
      tripStopOrder: 1
    });
    const originSecondVisitAfterMove = await getVisitById(
      testDatabase.database,
      originSecondVisit.id,
      async () => ''
    );
    const destinationVisitAfterMove = await getVisitById(
      testDatabase.database,
      destinationVisit.id,
      async () => ''
    );
    const unchangedOrderVisit = await updateVisit(testDatabase.database, originFirstVisit.id, {
      note: 'Still first stop in the new trip'
    });

    expect(movedVisit).toMatchObject({
      trip: {
        id: destinationTrip.id,
        name: 'Syysreissu 2026'
      },
      tripStopOrder: 1
    });
    expect(originSecondVisitAfterMove).toMatchObject({
      tripStopOrder: 1
    });
    expect(destinationVisitAfterMove).toMatchObject({
      tripStopOrder: 2
    });
    expect(unchangedOrderVisit).toMatchObject({
      note: 'Still first stop in the new trip',
      tripStopOrder: 1
    });
  });

  it('inserts a created visit into the requested trip stop order', async () => {
    const trip = await createTrip(testDatabase.database, {
      name: 'Kesäreissu 2026'
    });
    const firstVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });

    const insertedVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-04-13'
    });
    const firstVisitAfterInsert = await getVisitById(
      testDatabase.database,
      firstVisit.id,
      async () => ''
    );

    expect(insertedVisit).toMatchObject({
      tripStopOrder: 1
    });
    expect(firstVisitAfterInsert).toMatchObject({
      tripStopOrder: 2
    });
  });

  it('returns an empty catalog etag seed when no active parks remain', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 0,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            status: 'incorrect-data'
          })
        ]
      })
    });

    await expect(getCatalogListEtagSeed(testDatabase.database)).resolves.toEqual({
      activeCount: 0,
      filterKey: null,
      latestImportRunId: null,
      latestUpdatedAt: null,
      typeSlug: null
    });
  });

  it('builds a catalog etag seed for a non-trail category filter', async () => {
    await expect(
      getCatalogListEtagSeed(testDatabase.database, {
        categorySlug: 'national-park'
      })
    ).resolves.toMatchObject({
      activeCount: 1,
      filterKey: 'category:national-park',
      typeSlug: null
    });
  });

  it('builds a catalog etag seed for the combined hiking and wilderness category filter', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-02T10:15:00.000Z',
      sourceUrl: 'https://example.test/lipas-combined-areas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 70001,
            name: 'Evon retkeilyalue',
            type: {
              'type-code': 109
            }
          }),
          createLipasPark({
            'lipas-id': 70002,
            name: 'Käsivarren erämaa-alue',
            type: {
              'type-code': 110
            }
          })
        ]
      })
    });

    await expect(
      getCatalogListEtagSeed(testDatabase.database, {
        categorySlug: 'hiking-and-wilderness-areas'
      })
    ).resolves.toMatchObject({
      activeCount: 2,
      filterKey: 'category:hiking-and-wilderness-areas',
      typeSlug: null
    });
  });

  it('lists public park summaries without detail-only fields', async () => {
    const [park] = await listPublicParks(testDatabase.database);

    expect(park).toMatchObject({
      address: 'Puistotie 1, 00999 Testikylä',
      areaKm2: 12.5,
      category: {
        slug: 'national-park'
      },
      name: 'Äkäsmännyn kansallispuisto',
      parkUrl: 'https://www.luontoon.fi/testi-puisto?foo=bar',
      slug: 'akasmannyn-kansallispuisto'
    });
    expect(park).not.toHaveProperty('boundaryGeoJson');
    expect(park).not.toHaveProperty('lipasId');
    expect(park).not.toHaveProperty('updatedAt');
  });

  it('builds a public visit summary etag seed before any visits exist', async () => {
    await expect(getPublicVisitSummaryEtagSeed(testDatabase.database)).resolves.toMatchObject({
      activeCount: 1,
      latestCatalogImportRunId: 1,
      latestCatalogUpdatedAt: '2026-05-01T10:00:00.000Z',
      publicUpdatedAt: null,
      publicVersion: 0
    });
  });

  it('builds a public visit summary etag seed from catalog and visit metadata', async () => {
    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-05-03'
    });

    const seed = await getPublicVisitSummaryEtagSeed(testDatabase.database);

    expect(seed).toMatchObject({
      activeCount: 1,
      latestCatalogImportRunId: 1,
      latestCatalogUpdatedAt: '2026-05-01T10:00:00.000Z',
      publicVersion: 1
    });
    expect(seed.publicUpdatedAt).toBeTruthy();
  });

  it('returns empty visit list when no active parks remain', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 0,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            status: 'incorrect-data'
          })
        ]
      })
    });

    await expect(listVisits(testDatabase.database, async () => '')).resolves.toEqual([]);
  });

  it('lists flat visits and park-scoped visit history across multiple parks', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Toinen puisto'
          })
        ]
      })
    });

    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      author: 'Alice',
      note: 'Visit A1',
      route: 'North',
      visitedOn: '2026-04-10'
    });
    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      note: 'Visit A2',
      visitedOn: '2026-04-11'
    });
    await createVisit(testDatabase.database, 'toinen-puisto', {
      visitedOn: '2026-03-20'
    });

    const visits = await listVisits(testDatabase.database, async () => '');
    const firstParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );
    const secondParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'toinen-puisto',
      async () => ''
    );

    expect(visits).toHaveLength(3);
    expect(visits[0]).toMatchObject({
      note: 'Visit A2',
      park: {
        name: 'Äkäsmännyn kansallispuisto',
        slug: 'akasmannyn-kansallispuisto'
      },
      visitedOn: '2026-04-11'
    });
    expect(visits[2]).toMatchObject({
      park: {
        name: 'Toinen puisto',
        slug: 'toinen-puisto'
      },
      visitedOn: '2026-03-20'
    });

    expect(firstParkVisits).toMatchObject({
      visitedSummary: {
        visited: true,
        visitCount: 2,
        lastVisitedOn: '2026-04-11'
      }
    });
    expect(firstParkVisits?.visits).toHaveLength(2);
    expect(firstParkVisits?.visits[0]).toMatchObject({
      author: null,
      note: 'Visit A2',
      route: null,
      visitedOn: '2026-04-11'
    });

    expect(secondParkVisits).toMatchObject({
      visitedSummary: {
        visited: true,
        visitCount: 1,
        lastVisitedOn: '2026-03-20'
      }
    });
    expect(secondParkVisits?.visits).toHaveLength(1);
    expect(secondParkVisits?.visits[0]).toMatchObject({
      author: null,
      note: null,
      route: null,
      visitedOn: '2026-03-20'
    });
  });

  it('falls back to descending ids when same-day visits share the same created timestamp', async () => {
    const trip = await createTrip(testDatabase.database, {
      name: 'Kesareissu 2026'
    });
    const firstVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      note: 'First visit',
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });
    const secondVisit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      note: 'Second visit',
      tripId: trip.id,
      visitedOn: '2026-04-13'
    });
    const sharedTimestamp = '2026-05-01T10:00:00.000Z';

    await testDatabase.database
      .update(parkVisits)
      .set({
        createdAt: sharedTimestamp
      })
      .where(eq(parkVisits.id, firstVisit.id));
    await testDatabase.database
      .update(parkVisits)
      .set({
        createdAt: sharedTimestamp,
        tripStopOrder: 1
      })
      .where(eq(parkVisits.id, secondVisit.id));

    const visits = await listVisits(testDatabase.database, async () => '');

    expect(visits.slice(0, 2).map((visit) => visit.id)).toEqual([secondVisit.id, firstVisit.id]);
  });

  it('includes empty images array for visits without images', async () => {
    const visitWithImage = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-10'
    });
    const visitWithoutImage = await createVisit(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      {
        visitedOn: '2026-04-11'
      }
    );

    await createVisitImage(testDatabase.database, {
      createdAt: new Date().toISOString(),
      displayOrder: 0,
      fullHeight: 100,
      fullKey: 'k1',
      fullWidth: 100,
      mimeType: 'image/jpeg',
      thumbHeight: 50,
      thumbKey: 't1',
      thumbWidth: 50,
      updatedAt: new Date().toISOString(),
      visitId: visitWithImage.id
    });

    const parkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );

    expect(parkVisits?.visits).toHaveLength(2);
    const withImage = parkVisits?.visits.find((visit) => visit.id === visitWithImage.id);
    const withoutImage = parkVisits?.visits.find((visit) => visit.id === visitWithoutImage.id);
    expect(withImage?.images).toHaveLength(1);
    expect(withoutImage?.images).toEqual([]);
  });

  it('reorders visit images and rejects invalid order', async () => {
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-10'
    });

    const timestamp = new Date().toISOString();
    const img1 = await createVisitImage(testDatabase.database, {
      createdAt: timestamp,
      displayOrder: 0,
      fullHeight: 100,
      fullKey: 'k1',
      fullWidth: 100,
      mimeType: 'image/jpeg',
      thumbHeight: 50,
      thumbKey: 't1',
      thumbWidth: 50,
      updatedAt: timestamp,
      visitId: visit.id
    });
    const img2 = await createVisitImage(testDatabase.database, {
      createdAt: timestamp,
      displayOrder: 0,
      fullHeight: 100,
      fullKey: 'k2',
      fullWidth: 100,
      mimeType: 'image/jpeg',
      thumbHeight: 50,
      thumbKey: 't2',
      thumbWidth: 50,
      updatedAt: timestamp,
      visitId: visit.id
    });

    await reorderVisitImages(testDatabase.database, visit.id, [img2.id, img1.id]);

    const parkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );

    expect(parkVisits?.visits[0]?.images[0]?.id).toBe(img2.id);
    expect(parkVisits?.visits[0]?.images[1]?.id).toBe(img1.id);

    await expect(reorderVisitImages(testDatabase.database, visit.id, [img1.id])).rejects.toThrow(
      'Invalid image order'
    );

    await expect(
      reorderVisitImages(testDatabase.database, visit.id, [99999, img1.id])
    ).rejects.toThrow('Invalid image order');
  });

  it('reassigns visits and keeps visit images attached under the target park', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 3,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Vallisaari',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/vallisaari'
          }),
          createLipasPark({
            'lipas-id': 440499,
            name: 'Aleksanterin kierros',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/aleksanterin-kierros'
          })
        ]
      })
    });

    const sourceVisit = await createVisit(testDatabase.database, 'aleksanterin-kierros', {
      note: 'Route visit note',
      route: 'Aleksanterin kierros',
      visitedOn: '2026-04-10'
    });
    await createVisit(testDatabase.database, 'vallisaari', {
      note: 'Destination visit note',
      visitedOn: '2026-04-11'
    });

    await createVisitImage(testDatabase.database, {
      createdAt: '2026-05-01T10:00:00.000Z',
      displayOrder: 0,
      fullHeight: 100,
      fullKey: 'visits/1/full.jpg',
      fullWidth: 100,
      mimeType: 'image/jpeg',
      thumbHeight: 50,
      thumbKey: 'visits/1/thumb.jpg',
      thumbWidth: 50,
      updatedAt: '2026-05-01T10:00:00.000Z',
      visitId: sourceVisit.id
    });

    const beforeSummary = await getPublicHomeSummary(testDatabase.database);

    const result = await reassignParkVisits(testDatabase.database, {
      fromSlug: 'aleksanterin-kierros',
      toSlug: 'vallisaari'
    });

    const sourceParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'aleksanterin-kierros',
      async () => ''
    );
    const targetParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'vallisaari',
      async () => ''
    );
    const flatVisits = await listVisits(testDatabase.database, async () => '');
    const movedVisit = flatVisits.find((visit) => visit.id === sourceVisit.id);
    const afterSummary = await getPublicHomeSummary(testDatabase.database);

    expect(result).toMatchObject({
      dryRun: false,
      fromPark: {
        name: 'Aleksanterin kierros',
        slug: 'aleksanterin-kierros'
      },
      movedImageCount: 1,
      movedVisitCount: 1,
      movedVisitIds: [sourceVisit.id],
      toPark: {
        name: 'Vallisaari',
        slug: 'vallisaari'
      }
    });
    expect(sourceParkVisits?.visitedSummary).toEqual({
      lastVisitedOn: null,
      visitCount: 0,
      visited: false
    });
    expect(sourceParkVisits?.visits).toEqual([]);
    expect(targetParkVisits?.visitedSummary).toEqual({
      lastVisitedOn: '2026-04-11',
      visitCount: 2,
      visited: true
    });
    expect(targetParkVisits?.visits).toHaveLength(2);
    const movedParkVisit = targetParkVisits?.visits.find((visit) => visit.id === sourceVisit.id);
    expect(movedParkVisit).toMatchObject({
      note: 'Route visit note',
      route: 'Aleksanterin kierros'
    });
    expect(movedParkVisit?.images).toHaveLength(1);
    expect(movedVisit).toMatchObject({
      park: {
        name: 'Vallisaari',
        slug: 'vallisaari'
      }
    });
    expect(afterSummary.version).toBeGreaterThan(beforeSummary.version);
  });

  it('supports dry-run previews for visit reassignment without changing stored visits', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 3,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Vallisaari',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/vallisaari'
          }),
          createLipasPark({
            'lipas-id': 440499,
            name: 'Aleksanterin kierros',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/aleksanterin-kierros'
          })
        ]
      })
    });

    const sourceVisit = await createVisit(testDatabase.database, 'aleksanterin-kierros', {
      visitedOn: '2026-04-10'
    });

    const result = await reassignParkVisits(testDatabase.database, {
      dryRun: true,
      fromSlug: 'aleksanterin-kierros',
      toSlug: 'vallisaari'
    });

    const sourceParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'aleksanterin-kierros',
      async () => ''
    );
    const targetParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'vallisaari',
      async () => ''
    );

    expect(result).toMatchObject({
      dryRun: true,
      movedImageCount: 0,
      movedVisitCount: 1,
      movedVisitIds: [sourceVisit.id]
    });
    expect(sourceParkVisits?.visits).toHaveLength(1);
    expect(targetParkVisits?.visits).toEqual([]);
  });

  it('returns a zero-move result when the source park has no visits', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Vallisaari',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/vallisaari'
          })
        ]
      })
    });

    const result = await reassignParkVisits(testDatabase.database, {
      fromSlug: 'akasmannyn-kansallispuisto',
      toSlug: 'vallisaari'
    });

    expect(result).toMatchObject({
      dryRun: false,
      movedImageCount: 0,
      movedVisitCount: 0,
      movedVisitIds: []
    });
  });

  it('rejects invalid visit reassignment requests', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Vallisaari',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/vallisaari'
          })
        ]
      })
    });

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: '   ',
        toSlug: 'vallisaari'
      })
    ).rejects.toThrow('Both fromSlug and toSlug are required.');

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: 'missing-source',
        toSlug: 'vallisaari'
      })
    ).rejects.toThrow('Source park not found');

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: 'akasmannyn-kansallispuisto',
        toSlug: 'missing-target'
      })
    ).rejects.toThrow('Target park not found');

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: 'vallisaari',
        toSlug: 'vallisaari'
      })
    ).rejects.toThrow('Source and target park slugs must be different.');

    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'vallisaari'));

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: 'akasmannyn-kansallispuisto',
        toSlug: 'vallisaari'
      })
    ).rejects.toThrow('Target park "vallisaari" is removed and cannot receive visits.');
  });

  it('builds home summary ordering from lightweight visit data', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 4,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Toinen puisto'
          }),
          createLipasPark({
            'lipas-id': 99998,
            name: 'Kolmas puisto'
          }),
          createLipasPark({
            'lipas-id': 99997,
            name: 'Neljäs puisto'
          })
        ]
      })
    });

    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-01-15'
    });
    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-22'
    });
    await createVisit(testDatabase.database, 'toinen-puisto', {
      visitedOn: '2026-07-10'
    });
    await createVisit(testDatabase.database, 'kolmas-puisto', {
      visitedOn: '2026-07-10'
    });
    await createVisit(testDatabase.database, 'neljas-puisto', {
      visitedOn: '2026-10-05'
    });

    const summary = await getPublicHomeSummary(testDatabase.database);

    expect(summary.mostVisitedParks.map((park) => park.park.slug)).toEqual([
      'akasmannyn-kansallispuisto',
      'neljas-puisto',
      'kolmas-puisto',
      'toinen-puisto'
    ]);
    expect(summary.recentVisits.map((park) => park.park.slug)).toEqual([
      'neljas-puisto',
      'kolmas-puisto',
      'toinen-puisto',
      'akasmannyn-kansallispuisto'
    ]);
    expect(summary.seasonalVisitCounts).toEqual({ autumn: 1, spring: 1, summer: 2, winter: 1 });
    expect(summary.latestVisitEntries[0]).not.toHaveProperty('note');
    expect(summary.latestVisitEntries[0]).not.toHaveProperty('route');
    expect(summary.version).toBeGreaterThan(0);
  });

  it('lists only removed parks for admin restore workflows', async () => {
    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const removedParks = await listRemovedParks(testDatabase.database);

    expect(removedParks).toEqual([
      expect.objectContaining({
        address: 'Puistotie 1, 00999 Testikylä',
        catalogStatus: 'active',
        locationLabel: 'Puistotie 1',
        name: 'Äkäsmännyn kansallispuisto',
        postalCode: '00999',
        postalOffice: 'Testikylä',
        removed: true,
        slug: 'akasmannyn-kansallispuisto'
      })
    ]);
  });
});
