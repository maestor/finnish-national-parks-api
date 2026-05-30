export const supportedParkTypes = [
  {
    code: 103,
    id: 103,
    name: 'Ulkoilu-/virkistysalue',
    slug: 'outdoor-recreation-area'
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
export const hikingAreaTypeCode = 109;
export const hikingAreaDisplayTypeName = 'Valtion retkeilyalue';
export const natureTrailTypeCode = 4404;
export const hikingTrailTypeCode = 4405;

export const supportedParkTypeSlugs = supportedParkTypes.map((parkType) => parkType.slug) as [
  SupportedParkTypeSlug,
  ...SupportedParkTypeSlug[]
];

const parkTypeByCode = new Map<number, SupportedParkType>(
  supportedParkTypes.map((parkType) => [parkType.code, parkType])
);
const parkTypeBySlug = new Map<string, SupportedParkType>(
  supportedParkTypes.map((parkType) => [parkType.slug, parkType])
);

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

export const isNatureTrailTypeCode = (code: number) => code === natureTrailTypeCode;
export const isHikingTrailTypeCode = (code: number) => code === hikingTrailTypeCode;
export const isTrailTypeCode = (code: number) =>
  isNatureTrailTypeCode(code) || isHikingTrailTypeCode(code);
