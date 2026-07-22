import { describe, expect, it } from 'vitest';

import {
  updateParkRequestSchema,
  updateTripRequestSchema,
  updateVisitRequestSchema
} from '../../src/contracts/parks.js';
import {
  createCatalogDetailEtag,
  createCatalogListEtag,
  createPublicSummaryEtag,
  hasMatchingEtag
} from '../../src/http/cache.js';

describe('contracts and cache helpers', () => {
  it('requires at least one field when patching a visit', () => {
    expect(() => updateVisitRequestSchema.parse({})).toThrow(
      'Provide at least one field to update.'
    );
    expect(updateVisitRequestSchema.parse({ note: 'Updated note' })).toEqual({
      note: 'Updated note'
    });
    expect(updateVisitRequestSchema.parse({ tripStopOrder: 2 })).toEqual({
      tripStopOrder: 2
    });
    expect(updateVisitRequestSchema.parse({ tripId: null })).toEqual({
      tripId: null
    });
  });

  it('requires at least one field when patching a park', () => {
    expect(() => updateParkRequestSchema.parse({})).toThrow(
      'Provide at least one field to update.'
    );
    expect(updateParkRequestSchema.parse({ name: 'Updated park' })).toEqual({
      name: 'Updated park'
    });
  });

  it('requires at least one field when patching a trip', () => {
    expect(() => updateTripRequestSchema.parse({})).toThrow(
      'Provide at least one field to update.'
    );
    expect(updateTripRequestSchema.parse({ name: 'Updated trip' })).toEqual({
      name: 'Updated trip'
    });
  });

  it('builds deterministic cache helpers for empty and populated states', () => {
    const emptyListEtag = createCatalogListEtag({
      activeCount: 0,
      filterKey: null,
      latestImportRunId: null,
      latestUpdatedAt: null
    });
    const detailEtag = createCatalogDetailEtag({
      includeBoundary: false,
      lipasId: 12345,
      updatedAt: '2026-05-01T00:00:00.000Z'
    });
    const publicSummaryEtag = createPublicSummaryEtag({
      activeCount: 3,
      kind: 'timeline',
      latestCatalogImportRunId: 42,
      latestCatalogUpdatedAt: '2026-05-01T00:00:00.000Z',
      publicUpdatedAt: '2026-05-02T00:00:00.000Z',
      publicVersion: 7
    });

    expect(emptyListEtag).toContain('none');
    expect(emptyListEtag).toContain('all');
    expect(detailEtag).toContain('summary');
    expect(publicSummaryEtag).toContain('timeline');
    expect(publicSummaryEtag).toContain(':7:');
    expect(hasMatchingEtag(undefined, emptyListEtag)).toBe(false);
    expect(hasMatchingEtag(`W/ignored, ${detailEtag}`, detailEtag)).toBe(true);
  });
});
