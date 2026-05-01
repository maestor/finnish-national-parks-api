export type LipasSourceItem = {
  properties: {
    'area-km2'?: number;
  };
  email?: string;
  'phone-number'?: string;
  admin: string;
  www?: string;
  name: string;
  'construction-year'?: number;
  type: {
    'type-code': number;
  };
  'lipas-id': number;
  status: string;
  comment?: string;
  'event-date'?: string;
  location: {
    city?: {
      'city-code'?: number;
    };
    address?: string;
    geometries: {
      type: 'FeatureCollection';
      features: Array<{
        type: 'Feature';
        geometry: {
          type: 'Polygon';
          coordinates: number[][][];
        };
      }>;
    };
    'postal-office'?: string;
  };
  owner: string;
};

export const parkTypeFixtures = {
  nationalPark: {
    name: 'Kansallispuisto',
    slug: 'national-park',
    typeCode: 111
  },
  otherNatureReserve: {
    name: 'Muu luonnonsuojelualue',
    slug: 'other-nature-reserve',
    typeCode: 112
  },
  stateHikingArea: {
    name: 'Valtion retkeilyalue',
    slug: 'state-hiking-area',
    typeCode: 109
  },
  wildernessArea: {
    name: 'Erämaa-alue',
    slug: 'wilderness-area',
    typeCode: 110
  }
} as const;

export function createLipasPark(
  overrides: Omit<Partial<LipasSourceItem>, 'location'> & {
    location?: Partial<LipasSourceItem['location']>;
  } = {}
): LipasSourceItem {
  const {
    location: locationOverrides,
    ...rootOverrides
  } = overrides;

  const baseLocation: LipasSourceItem['location'] = {
    city: {
      'city-code': 734
    },
    address: 'Puistotie 1',
    geometries: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [24.0, 60.0],
                [26.0, 60.0],
                [26.0, 62.0],
                [24.0, 62.0],
                [24.0, 60.0]
              ]
            ]
          }
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [30.0, 64.0],
                [31.0, 64.0],
                [31.0, 65.0],
                [30.0, 65.0],
                [30.0, 64.0]
              ]
            ]
          }
        }
      ]
    },
    'postal-office': 'Testikylä'
  };

  return {
    properties: {
      'area-km2': 12.5
    },
    email: 'park@example.test',
    'phone-number': '1234567',
    admin: 'state',
    www: 'www.luontoon.fi/testi-puisto?foo=bar',
    name: 'Äkäsmännyn kansallispuisto',
    'construction-year': 1982,
    type: {
      'type-code': parkTypeFixtures.nationalPark.typeCode
    },
    'lipas-id': 12345,
    status: 'active',
    comment: 'Do not persist this upstream comment.',
    'event-date': '2024-04-01T12:00:00.000Z',
    owner: 'state',
    ...rootOverrides,
    location: {
      city: {
        'city-code': locationOverrides?.city?.['city-code'] ?? 734
      },
      address: locationOverrides?.address ?? 'Puistotie 1',
      geometries: locationOverrides?.geometries ?? baseLocation.geometries,
      'postal-office': locationOverrides?.['postal-office'] ?? 'Testikylä'
    }
  };
}
