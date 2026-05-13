export const supportedParkTypes = [
  {
    code: 109,
    id: 109,
    name: 'Valtion retkeilyalue',
    slug: 'state-hiking-area'
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
    name: 'Muu luonnonsuojelualue',
    slug: 'other-nature-reserve'
  }
] as const;

export type SupportedParkType = (typeof supportedParkTypes)[number];
export type SupportedParkTypeSlug = SupportedParkType['slug'];

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
