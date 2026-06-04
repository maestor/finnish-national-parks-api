import { describe, expect, it } from 'vitest';

import {
  getSupportedParkTypeByCode,
  getSupportedParkTypeBySlug,
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
      slug: 'factory-village'
    });
    expect(getSupportedParkTypeByCode(111)).toMatchObject({
      code: 111,
      slug: 'national-park'
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
    expect(getSupportedParkTypeBySlug('factory-village')).toMatchObject({
      code: 9001,
      name: 'Tehdaskylä'
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
      'factory-village',
      'hiking-area',
      'wilderness-area',
      'national-park',
      'nature-reserve-area',
      'nature-trail',
      'hiking-trail'
    ]);
  });

  it('fails loudly for unsupported park type identifiers', () => {
    expect(() => getSupportedParkTypeByCode(999)).toThrow(
      'Unsupported LIPAS protected-area type code "999".'
    );
    expect(() => getSupportedParkTypeBySlug('unknown-type')).toThrow(
      'Unsupported protected-area type slug "unknown-type".'
    );
  });
});
