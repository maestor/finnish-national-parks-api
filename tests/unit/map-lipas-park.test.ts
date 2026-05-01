import { describe, expect, it } from 'vitest';

import { mapLipasPark } from '../../src/importer/map-lipas-park.js';
import { createLipasPark } from '../fixtures/lipas.js';

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
      }
    });
    expect(mapped).not.toHaveProperty('email');
    expect(mapped).not.toHaveProperty('phoneNumber');
    expect(mapped).not.toHaveProperty('comment');
  });
});
