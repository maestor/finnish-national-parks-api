import { describe, expect, it } from 'vitest';

import { extractHikingAreaMetadata } from '../../src/importer/import-special-parks.js';

describe('extractHikingAreaMetadata', () => {
  it('sums shape_area across features and converts to km²', () => {
    const result = extractHikingAreaMetadata([
      { properties: { shape_area: 10_000_000 } },
      { properties: { shape_area: 5_000_000 } }
    ]);

    expect(result.areaKm2).toBe(15);
    expect(result.establishmentYear).toBeNull();
  });

  it('returns null area when no features have shape_area', () => {
    const result = extractHikingAreaMetadata([{ properties: {} }, { properties: undefined }]);

    expect(result.areaKm2).toBeNull();
    expect(result.establishmentYear).toBeNull();
  });

  it('handles a mix of features with and without shape_area', () => {
    const result = extractHikingAreaMetadata([
      { properties: { shape_area: 26_156_780 } },
      { properties: {} },
      { properties: undefined }
    ]);

    expect(result.areaKm2).toBe(26.16);
    expect(result.establishmentYear).toBeNull();
  });

  it('rounds area to two decimal places', () => {
    const result = extractHikingAreaMetadata([{ properties: { shape_area: 1_234_567 } }]);

    expect(result.areaKm2).toBe(1.23);
  });
});
