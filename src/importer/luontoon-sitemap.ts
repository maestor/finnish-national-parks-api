type LuontoonParkRef = {
  lipasId: number;
  slug: string;
};

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

    if (slug) {
      bySlug.set(slug, destinationUrl);
    }
  }

  return ({ lipasId, slug }: LuontoonParkRef) => {
    return byLipasId.get(lipasId) ?? bySlug.get(slug) ?? null;
  };
};
