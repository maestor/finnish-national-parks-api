import { describe, expect, it } from 'vitest';

import { mapLipasPark } from '../../src/importer/map-lipas-park.js';
import { createLipasPark, parkTypeFixtures } from '../fixtures/lipas.js';

describe('mapLipasPark', () => {
  it('maps the supported catalog fields and excludes upstream contact fields', () => {
    const mapped = mapLipasPark(createLipasPark());

    expect(mapped).toMatchObject({
      lipasId: 12345,
      slug: 'akasmannyn-kansallispuisto',
      name: 'Äkäsmännyn kansallispuisto',
      areaKm2: 12.5,
      establishmentYear: 1982,
      locationLabel: 'Puistotie 1',
      postalOffice: 'Testikylä',
      municipalityCode: 734,
      luontoonUrl: 'https://www.luontoon.fi/testi-puisto',
      sourceEventDate: '2024-04-01T12:00:00.000Z',
      boundingBox: {
        minLon: 24,
        minLat: 60,
        maxLon: 31,
        maxLat: 65
      },
      markerPoint: {
        lon: 27.5,
        lat: 62.5
      },
      type: {
        code: parkTypeFixtures.nationalPark.typeCode,
        id: parkTypeFixtures.nationalPark.typeCode,
        name: parkTypeFixtures.nationalPark.name,
        slug: parkTypeFixtures.nationalPark.slug
      }
    });
    expect(mapped).not.toHaveProperty('email');
    expect(mapped).not.toHaveProperty('phoneNumber');
    expect(mapped).not.toHaveProperty('comment');
  });

  it('falls back cleanly when url, address, and slug inputs are sparse', () => {
    const source = createLipasPark({
      name: '!!!'
    });
    delete source.www;
    delete source.location.address;
    delete source.location['postal-office'];
    const mapped = mapLipasPark(source);

    expect(mapped.slug).toBe('park');
    expect(mapped.luontoonUrl).toBeNull();
    expect(mapped.locationLabel).toBe('!!!');
  });

  it('normalizes root-relative luontoon urls to absolute urls', () => {
    const mapped = mapLipasPark(
      createLipasPark({
        www: '/saaristo'
      })
    );

    expect(mapped.luontoonUrl).toBe('https://www.luontoon.fi/saaristo');
  });

  it('falls back to null for missing optional numeric and date fields', () => {
    const source = createLipasPark();
    delete source['construction-year'];
    delete source['event-date'];
    source.properties = {};
    source.location.city = {};

    const mapped = mapLipasPark(source);

    expect(mapped.areaKm2).toBeNull();
    expect(mapped.establishmentYear).toBeNull();
    expect(mapped.municipalityCode).toBeNull();
    expect(mapped.sourceEventDate).toBeNull();
  });
});
