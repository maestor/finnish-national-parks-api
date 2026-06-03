type LuontoonParkRef = {
  lipasId: number;
  slug: string;
};

const canonicalSlugAliases = new Map<string, string>([
  ['puurijarven-ja-isosuon-kansallispuisto', 'puurijarven-ja-isonsuon-kansallispuisto']
]);

const locPattern = /<loc>([^<]+)<\/loc>/g;

const toPathSegments = (rawUrl: string) => {
  const url = new URL(rawUrl);
  return url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
};

const getDestinationUrl = (rawUrl: string) => {
  const segments = toPathSegments(rawUrl);

  if (
    segments[0] !== 'fi' ||
    !['kohteet', 'reitit'].includes(segments[1] ?? '') ||
    segments.length !== 3
  ) {
    return null;
  }

  return rawUrl.replace(/\/+$/, '');
};

const getLipasIdFromDestinationUrl = (rawUrl: string) => {
  const slug = rawUrl.split('/').at(-1)!;
  const match = slug.match(/-(\d+)$/);

  return match ? Number(match[1]) : null;
};

const getSlugFromDestinationUrl = (rawUrl: string) => {
  return rawUrl.split('/').at(-1)!;
};

const getSlugCandidates = (slug: string) => {
  const candidates = new Set([slug]);

  if (slug.endsWith('-eramaa-alue')) {
    candidates.add(slug.slice(0, -'-alue'.length));
  }

  const canonicalAlias = canonicalSlugAliases.get(slug);

  if (canonicalAlias) {
    candidates.add(canonicalAlias);
  }

  return [...candidates];
};

export const createLuontoonUrlResolver = (sitemapXml: string) => {
  const byLipasId = new Map<number, string>();
  const bySlug = new Map<string, string>();

  for (const match of sitemapXml.matchAll(locPattern)) {
    const rawUrl = match[1]!;
    const destinationUrl = getDestinationUrl(rawUrl);

    if (!destinationUrl) {
      continue;
    }

    const lipasId = getLipasIdFromDestinationUrl(destinationUrl);
    const slug = getSlugFromDestinationUrl(destinationUrl);

    if (lipasId !== null) {
      byLipasId.set(lipasId, destinationUrl);
    }

    bySlug.set(slug, destinationUrl);
  }

  return ({ lipasId, slug }: LuontoonParkRef) => {
    if (byLipasId.has(lipasId)) {
      return byLipasId.get(lipasId)!;
    }

    for (const candidateSlug of getSlugCandidates(slug)) {
      const candidateUrl = bySlug.get(candidateSlug);

      if (candidateUrl) {
        return candidateUrl;
      }
    }

    return null;
  };
};
