import { describe, expect, it } from 'vitest';

import {
  getSupportedParkTypeByCode,
  getSupportedParkTypeBySlug,
  supportedParkTypeSlugs
} from '../../src/parks/park-types.js';

describe('park type helpers', () => {
  it('returns supported park types by code and slug', () => {
    expect(getSupportedParkTypeByCode(111)).toMatchObject({
      code: 111,
      slug: 'national-park'
    });
    expect(getSupportedParkTypeBySlug('state-hiking-area')).toMatchObject({
      code: 109,
      name: 'Valtion retkeilyalue'
    });
    expect(supportedParkTypeSlugs).toEqual([
      'state-hiking-area',
      'wilderness-area',
      'national-park',
      'other-nature-reserve'
    ]);
  });

  it('fails loudly for unsupported park type identifiers', () => {
    expect(() => getSupportedParkTypeByCode(999)).toThrow('Unsupported LIPAS protected-area type code "999".');
    expect(() => getSupportedParkTypeBySlug('unknown-type')).toThrow('Unsupported protected-area type slug "unknown-type".');
  });
});
