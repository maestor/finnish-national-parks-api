import { describe, expect, it } from 'vitest';

import {
  getParkCategoryByTypeSlug,
  getSupportedParkCategoryBySlug,
  getSupportedParkTypeByCode,
  getSupportedParkTypeBySlug,
  getSupportedParkTypeSlugsByCategorySlug,
  supportedParkCategorySlugs,
  supportedParkTypeSlugs
} from '../../src/parks/park-types.js';

describe('park type helpers', () => {
  it('returns supported park types by code and slug', () => {
    expect(getSupportedParkTypeByCode(103)).toMatchObject({
      code: 103,
      slug: 'outdoor-recreation-area'
    });
    expect(getSupportedParkTypeByCode(9001)).toMatchObject({
      code: 9001,
      slug: 'cultural-history-area'
    });
    expect(getSupportedParkTypeByCode(111)).toMatchObject({
      code: 111,
      slug: 'national-park'
    });
    expect(getSupportedParkTypeByCode(4403)).toMatchObject({
      code: 4403,
      slug: 'walking-trail'
    });
    expect(getSupportedParkTypeByCode(4404)).toMatchObject({
      code: 4404,
      slug: 'nature-trail'
    });
    expect(getSupportedParkTypeByCode(4405)).toMatchObject({
      code: 4405,
      slug: 'hiking-trail'
    });
    expect(getSupportedParkTypeBySlug('hiking-area')).toMatchObject({
      code: 109,
      name: 'Retkeilyalue'
    });
    expect(getSupportedParkTypeBySlug('cultural-history-area')).toMatchObject({
      code: 9001,
      name: 'Historia-alue'
    });
    expect(getSupportedParkTypeBySlug('walking-trail')).toMatchObject({
      code: 4403,
      name: 'Ulkoilureitti'
    });
    expect(getSupportedParkTypeBySlug('nature-trail')).toMatchObject({
      code: 4404,
      name: 'Luontopolku'
    });
    expect(getSupportedParkTypeBySlug('hiking-trail')).toMatchObject({
      code: 4405,
      name: 'Retkeilyreitti'
    });
    expect(supportedParkTypeSlugs).toEqual([
      'outdoor-recreation-area',
      'cultural-history-area',
      'hiking-area',
      'wilderness-area',
      'national-park',
      'nature-reserve-area',
      'walking-trail',
      'nature-trail',
      'hiking-trail'
    ]);
    expect(getSupportedParkCategoryBySlug('hiking-and-wilderness-areas')).toEqual({
      name: 'Erämaa-/retkeilyalue',
      slug: 'hiking-and-wilderness-areas'
    });
    expect(getSupportedParkCategoryBySlug('trails-and-routes')).toEqual({
      name: 'Polut/Reitit',
      slug: 'trails-and-routes'
    });
    expect(getParkCategoryByTypeSlug('hiking-area')).toEqual({
      name: 'Erämaa-/retkeilyalue',
      slug: 'hiking-and-wilderness-areas'
    });
    expect(getParkCategoryByTypeSlug('wilderness-area')).toEqual({
      name: 'Erämaa-/retkeilyalue',
      slug: 'hiking-and-wilderness-areas'
    });
    expect(getParkCategoryByTypeSlug('walking-trail')).toEqual({
      name: 'Polut/Reitit',
      slug: 'trails-and-routes'
    });
    expect(getParkCategoryByTypeSlug('national-park')).toEqual({
      name: 'Kansallispuisto',
      slug: 'national-park'
    });
    expect(getSupportedParkTypeSlugsByCategorySlug('hiking-and-wilderness-areas')).toEqual([
      'hiking-area',
      'wilderness-area'
    ]);
    expect(supportedParkCategorySlugs).toEqual([
      'outdoor-recreation-area',
      'cultural-history-area',
      'hiking-and-wilderness-areas',
      'national-park',
      'nature-reserve-area',
      'trails-and-routes'
    ]);
  });

  it('fails loudly for unsupported park type identifiers', () => {
    expect(() => getSupportedParkTypeByCode(999)).toThrow(
      'Unsupported LIPAS protected-area type code "999".'
    );
    expect(() => getSupportedParkTypeBySlug('unknown-type')).toThrow(
      'Unsupported protected-area type slug "unknown-type".'
    );
    expect(() => getSupportedParkCategoryBySlug('unknown-category')).toThrow(
      'Unsupported protected-area category slug "unknown-category".'
    );
  });
});
