export const supportedParkTypes = [
  {
    code: 103,
    id: 103,
    name: 'Ulkoilu-/virkistysalue',
    slug: 'outdoor-recreation-area'
  },
  {
    code: 9001,
    id: 9001,
    name: 'Tehdaskylä',
    slug: 'factory-village'
  },
  {
    code: 109,
    id: 109,
    name: 'Retkeilyalue',
    slug: 'hiking-area'
  },
  {
    code: 110,
    id: 110,
    name: 'Erämaa-alue',
    slug: 'wilderness-area'
  },
  {
    code: 111,
    id: 111,
    name: 'Kansallispuisto',
    slug: 'national-park'
  },
  {
    code: 112,
    id: 112,
    name: 'Luonnonsuojelualue',
    slug: 'nature-reserve-area'
  },
  {
    code: 4403,
    id: 4403,
    name: 'Ulkoilureitti',
    slug: 'walking-trail'
  },
  {
    code: 4404,
    id: 4404,
    name: 'Luontopolku',
    slug: 'nature-trail'
  },
  {
    code: 4405,
    id: 4405,
    name: 'Retkeilyreitti',
    slug: 'hiking-trail'
  }
] as const;

export type SupportedParkType = (typeof supportedParkTypes)[number];
export type SupportedParkTypeSlug = SupportedParkType['slug'];

export const supportedParkCategories = [
  {
    name: 'Ulkoilu-/virkistysalue',
    slug: 'outdoor-recreation-area'
  },
  {
    name: 'Tehdaskylä',
    slug: 'factory-village'
  },
  {
    name: 'Retkeilyalue',
    slug: 'hiking-area'
  },
  {
    name: 'Erämaa-alue',
    slug: 'wilderness-area'
  },
  {
    name: 'Kansallispuisto',
    slug: 'national-park'
  },
  {
    name: 'Luonnonsuojelualue',
    slug: 'nature-reserve-area'
  },
  {
    name: 'Polut/Reitit',
    slug: 'trails-and-routes'
  }
] as const;

export type SupportedParkCategory = (typeof supportedParkCategories)[number];
export type SupportedParkCategorySlug = SupportedParkCategory['slug'];

export const hikingAreaTypeCode = 109;
export const hikingAreaDisplayTypeName = 'Valtion retkeilyalue';
export const walkingTrailTypeCode = 4403;
export const natureTrailTypeCode = 4404;
export const hikingTrailTypeCode = 4405;
export const trailsAndRoutesCategorySlug = 'trails-and-routes';

export const supportedParkTypeSlugs = supportedParkTypes.map((parkType) => parkType.slug) as [
  SupportedParkTypeSlug,
  ...SupportedParkTypeSlug[]
];
export const supportedParkCategorySlugs = supportedParkCategories.map(
  (category) => category.slug
) as [SupportedParkCategorySlug, ...SupportedParkCategorySlug[]];
export const trailParkTypeSlugs = ['walking-trail', 'nature-trail', 'hiking-trail'] as const;
export type TrailParkTypeSlug = (typeof trailParkTypeSlugs)[number];

const parkTypeByCode = new Map<number, SupportedParkType>(
  supportedParkTypes.map((parkType) => [parkType.code, parkType])
);
const parkTypeBySlug = new Map<string, SupportedParkType>(
  supportedParkTypes.map((parkType) => [parkType.slug, parkType])
);
const parkCategoryBySlug = new Map<string, SupportedParkCategory>(
  supportedParkCategories.map((category) => [category.slug, category])
);
const trailParkTypeSlugSet = new Set<string>(trailParkTypeSlugs);

export const getSupportedParkTypeByCode = (code: number) => {
  const parkType = parkTypeByCode.get(code);

  if (!parkType) {
    throw new Error(`Unsupported LIPAS protected-area type code "${code}".`);
  }

  return parkType;
};

export const getSupportedParkTypeBySlug = (slug: string) => {
  const parkType = parkTypeBySlug.get(slug);

  if (!parkType) {
    throw new Error(`Unsupported protected-area type slug "${slug}".`);
  }

  return parkType;
};

export const getSupportedParkCategoryBySlug = (slug: string) => {
  const category = parkCategoryBySlug.get(slug);

  if (!category) {
    throw new Error(`Unsupported protected-area category slug "${slug}".`);
  }

  return category;
};

export const isWalkingTrailTypeCode = (code: number) => code === walkingTrailTypeCode;
export const isNatureTrailTypeCode = (code: number) => code === natureTrailTypeCode;
export const isHikingTrailTypeCode = (code: number) => code === hikingTrailTypeCode;
export const isTrailTypeCode = (code: number) =>
  isWalkingTrailTypeCode(code) || isNatureTrailTypeCode(code) || isHikingTrailTypeCode(code);
export const isTrailTypeSlug = (slug: string): slug is TrailParkTypeSlug =>
  trailParkTypeSlugSet.has(slug);

export const getParkCategoryByTypeSlug = (typeSlug: SupportedParkTypeSlug) => {
  if (isTrailTypeSlug(typeSlug)) {
    return getSupportedParkCategoryBySlug(trailsAndRoutesCategorySlug);
  }

  return getSupportedParkCategoryBySlug(typeSlug);
};
