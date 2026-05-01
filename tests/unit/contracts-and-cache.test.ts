import { describe, expect, it } from 'vitest';

import { updateVisitRequestSchema } from '../../src/contracts/parks.js';
import { createCatalogDetailEtag, createCatalogListEtag, hasMatchingEtag } from '../../src/http/cache.js';

describe('contracts and cache helpers', () => {
  it('requires at least one field when patching a visit', () => {
    expect(() => updateVisitRequestSchema.parse({})).toThrow('Provide at least one field to update.');
    expect(updateVisitRequestSchema.parse({ note: 'Updated note' })).toEqual({
      note: 'Updated note'
    });
  });

  it('builds deterministic cache helpers for empty and populated states', () => {
    const emptyListEtag = createCatalogListEtag({
      activeCount: 0,
      latestImportRunId: null,
      latestUpdatedAt: null
    });
    const detailEtag = createCatalogDetailEtag({
      includeBoundary: false,
      lipasId: 12345,
      updatedAt: '2026-05-01T00:00:00.000Z'
    });

    expect(emptyListEtag).toContain('none');
    expect(detailEtag).toContain('summary');
    expect(hasMatchingEtag(undefined, emptyListEtag)).toBe(false);
    expect(hasMatchingEtag(`W/ignored, ${detailEtag}`, detailEtag)).toBe(true);
  });
});
