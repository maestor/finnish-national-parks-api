const CATALOG_RESPONSE_VERSION = 'v1';
const PUBLIC_SUMMARY_RESPONSE_VERSION = 'v1';

export const CATALOG_CACHE_CONTROL =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
export const PRIVATE_CACHE_CONTROL = 'private, no-store';
export const PUBLIC_SUMMARY_CACHE_CONTROL = 'public, max-age=0, s-maxage=600';

export const createCatalogListEtag = (seed: {
  activeCount: number;
  filterKey?: string | null;
  latestImportRunId: number | null;
  latestUpdatedAt: string | null;
}) => {
  return `"parks-list:${CATALOG_RESPONSE_VERSION}:${seed.filterKey ?? 'all'}:${seed.latestImportRunId ?? 'none'}:${seed.latestUpdatedAt ?? 'none'}:${seed.activeCount}"`;
};

export const createCatalogDetailEtag = (input: {
  includeBoundary: boolean;
  lipasId: number;
  updatedAt: string;
}) => {
  return `"parks-detail:${CATALOG_RESPONSE_VERSION}:${input.lipasId}:${input.updatedAt}:${input.includeBoundary ? 'boundary' : 'summary'}"`;
};

export const createPublicSummaryEtag = (input: {
  activeCount?: number;
  kind: 'home' | 'map' | 'timeline';
  latestCatalogImportRunId?: number | null;
  latestCatalogUpdatedAt?: string | null;
  publicUpdatedAt: string | null;
  publicVersion: number;
}) => {
  return `"public-summary:${PUBLIC_SUMMARY_RESPONSE_VERSION}:${input.kind}:${input.publicVersion}:${input.publicUpdatedAt ?? 'none'}:${input.activeCount ?? 'none'}:${input.latestCatalogImportRunId ?? 'none'}:${input.latestCatalogUpdatedAt ?? 'none'}"`;
};

export const hasMatchingEtag = (ifNoneMatch: string | undefined, etag: string) => {
  if (!ifNoneMatch) {
    return false;
  }

  return ifNoneMatch
    .split(',')
    .map((value) => value.trim())
    .includes(etag);
};
