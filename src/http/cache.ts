const CATALOG_RESPONSE_VERSION = 'v1';

export const CATALOG_CACHE_CONTROL = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

export function createCatalogListEtag(seed: {
  activeCount: number;
  latestImportRunId: number | null;
  latestUpdatedAt: string | null;
  typeSlug?: string | null;
}) {
  return `"parks-list:${CATALOG_RESPONSE_VERSION}:${seed.typeSlug ?? 'all'}:${seed.latestImportRunId ?? 'none'}:${seed.latestUpdatedAt ?? 'none'}:${seed.activeCount}"`;
}

export function createCatalogDetailEtag(input: {
  includeBoundary: boolean;
  lipasId: number;
  updatedAt: string;
}) {
  return `"parks-detail:${CATALOG_RESPONSE_VERSION}:${input.lipasId}:${input.updatedAt}:${input.includeBoundary ? 'boundary' : 'summary'}"`;
}

export function hasMatchingEtag(ifNoneMatch: string | undefined, etag: string) {
  if (!ifNoneMatch) {
    return false;
  }

  return ifNoneMatch
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
}
