import { extractGeoJsonAreaM2Metadata } from '../builders.js';
import type { DestinationAreaSeed, SpecialParkConfig } from '../types.js';

type OpenDestinationAreaSeed = Omit<DestinationAreaSeed, 'locationLabel'> & {
  markerPoint: NonNullable<SpecialParkConfig['markerPoint']>;
};

// Keep the pre-replacement markers instead of deriving them from the new boundaries.
const seeds: OpenDestinationAreaSeed[] = [
  {
    displayTypeName: 'Soidensuojelualue',
    markerPoint: { lat: 65.731341066, lon: 26.259882318 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/litokairan-soidensuojelualue',
    name: 'Litokairan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'litokairan-soidensuojelualue',
    syntheticLipasId: 9_001_045
  },
  {
    displayTypeName: 'Soidensuojelualue',
    markerPoint: { lat: 65.83941426999999, lon: 25.132821999 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/martimoaavan-soidensuojelualue',
    name: 'Martimoaavan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'martimoaavan-soidensuojelualue',
    syntheticLipasId: 9_001_046
  },
  {
    displayTypeName: 'Soidensuojelualue',
    markerPoint: { lat: 62.829127119999995, lon: 22.8625607415 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/paukanevan-soidensuojelualue',
    name: 'Paukanevan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'paukanevan-soidensuojelualue',
    syntheticLipasId: 9_001_047
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 61.627746978000005, lon: 27.860159928500003 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/neitvuori-ja-luonterin-luonnonsuojelualue',
    name: 'Neitvuori ja Luonterin luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'neitvuori-ja-luonterin-luonnonsuojelualue',
    syntheticLipasId: 9_001_048
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 60.922265821500005, lon: 22.10796497 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/koskeljarvi',
    name: 'Koskeljärvi',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'koskeljarvi',
    syntheticLipasId: 9_001_049
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 64.9541494165, lon: 27.228423553 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/kurimonkoski',
    name: 'Kurimonkoski',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'kurimonkoski',
    syntheticLipasId: 9_001_050
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 61.6874234715, lon: 24.156644518 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/pukala',
    name: 'Pukala',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'pukala',
    syntheticLipasId: 9_001_051
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 64.81824071049999, lon: 27.8684726345 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/hepokongas',
    name: 'Hepoköngäs',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'hepokongas',
    syntheticLipasId: 9_001_053
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 66.2838178845, lon: 27.186298523 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/auttikongas',
    name: 'Auttiköngäs',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'auttikongas',
    syntheticLipasId: 9_001_054
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 61.2880712795, lon: 21.75314562 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/pinkjarvi',
    name: 'Pinkjärvi',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'pinkjarvi',
    syntheticLipasId: 9_001_055
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 65.6785737745, lon: 28.2677016605 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/soiperoinen',
    name: 'Soiperoinen',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'soiperoinen',
    syntheticLipasId: 9_001_056
  },
  {
    displayTypeName: null,
    markerPoint: { lat: 65.7768667845, lon: 29.766836161 },
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/iivaara',
    name: 'Iivaara',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: '93700',
    postalOffice: 'Kuusamo',
    slug: 'iivaara',
    syntheticLipasId: 9_001_091
  }
];

export const openDestinationAreaConfigs: SpecialParkConfig[] = seeds.map((seed) => ({
  ...seed,
  extractMetadata: extractGeoJsonAreaM2Metadata,
  locationLabel: seed.name,
  postalCode: seed.postalCode ?? null,
  postalOffice: seed.postalOffice ?? null,
  responseShapeVersion: 'open-destination-area-v1',
  sourceUrl: `special://${seed.slug}`
}));
