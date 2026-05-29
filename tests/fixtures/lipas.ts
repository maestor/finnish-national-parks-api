export type LipasSourceItem = {
  properties: {
    'area-km2'?: number;
    'route-length-km'?: number;
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
          type: 'Polygon' | 'LineString';
          coordinates: number[][][] | number[][];
        };
      }>;
    };
    'postal-code'?: string;
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
  natureTrail: {
    name: 'Luontopolku',
    slug: 'nature-trail',
    typeCode: 4404
  },
  hikingTrail: {
    name: 'Retkeilyreitti',
    slug: 'hiking-trail',
    typeCode: 4405
  },
  outdoorRecreationArea: {
    name: 'Ulkoilu-/virkistysalue',
    slug: 'outdoor-recreation-area',
    typeCode: 103
  },
  otherNatureReserve: {
    name: 'Luonnonsuojelualue',
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

export const createLipasPark = (
  overrides: Omit<Partial<LipasSourceItem>, 'location'> & {
    location?: Partial<LipasSourceItem['location']>;
  } = {}
): LipasSourceItem => {
  const { location: locationOverrides, ...rootOverrides } = overrides;

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
    'postal-code': '00999',
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
      'postal-code': locationOverrides?.['postal-code'] ?? '00999',
      'postal-office': locationOverrides?.['postal-office'] ?? 'Testikylä'
    }
  };
};

export const createLipasTrail = (
  overrides: Omit<Partial<LipasSourceItem>, 'location' | 'properties'> & {
    location?: Partial<LipasSourceItem['location']>;
    properties?: Partial<LipasSourceItem['properties']>;
  } = {}
): LipasSourceItem => {
  const {
    location: locationOverrides,
    properties: propertyOverrides,
    ...rootOverrides
  } = overrides;

  const baseLocation: LipasSourceItem['location'] = {
    city: {
      'city-code': 734
    },
    address: 'Polkutie 1',
    geometries: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [24.2, 60.2],
              [24.4, 60.4],
              [24.6, 60.6],
              [24.8, 60.8]
            ]
          }
        }
      ]
    },
    'postal-code': '00999',
    'postal-office': 'Testikylä'
  };

  return {
    properties: {
      'route-length-km': 2.4,
      ...propertyOverrides
    },
    admin: 'city-sports',
    www: 'https://www.luontoon.fi/testi-luontopolku',
    name: 'Testin luontopolku',
    type: {
      'type-code': parkTypeFixtures.natureTrail.typeCode
    },
    'lipas-id': 440401,
    status: 'active',
    'event-date': '2024-04-02T12:00:00.000Z',
    owner: 'city',
    ...rootOverrides,
    location: {
      city: {
        'city-code': locationOverrides?.city?.['city-code'] ?? 734
      },
      address: locationOverrides?.address ?? 'Polkutie 1',
      geometries: locationOverrides?.geometries ?? baseLocation.geometries,
      'postal-code': locationOverrides?.['postal-code'] ?? '00999',
      'postal-office': locationOverrides?.['postal-office'] ?? 'Testikylä'
    }
  };
};

export const createLipasHikingTrail = (
  overrides: Omit<Partial<LipasSourceItem>, 'location' | 'properties'> & {
    location?: Partial<LipasSourceItem['location']>;
    properties?: Partial<LipasSourceItem['properties']>;
  } = {}
): LipasSourceItem => {
  const {
    location: locationOverrides,
    properties: propertyOverrides,
    ...rootOverrides
  } = overrides;

  const baseLocation: LipasSourceItem['location'] = {
    city: {
      'city-code': 734
    },
    address: 'Vaellustie 1',
    geometries: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [35.2, 66.2],
              [35.4, 66.4],
              [35.6, 66.6]
            ]
          }
        }
      ]
    },
    'postal-code': '00999',
    'postal-office': 'Testikylä'
  };

  return {
    properties: {
      'route-length-km': 5.0,
      ...propertyOverrides
    },
    admin: 'city-sports',
    www: 'https://www.luontoon.fi/testi-retkeilyreitti',
    name: 'Testin retkeilyreitti',
    type: {
      'type-code': parkTypeFixtures.hikingTrail.typeCode
    },
    'lipas-id': 440501,
    status: 'active',
    'event-date': '2024-04-03T12:00:00.000Z',
    owner: 'city',
    ...rootOverrides,
    location: {
      city: {
        'city-code': locationOverrides?.city?.['city-code'] ?? 734
      },
      address: locationOverrides?.address ?? 'Vaellustie 1',
      geometries: locationOverrides?.geometries ?? baseLocation.geometries,
      'postal-code': locationOverrides?.['postal-code'] ?? '00999',
      'postal-office': locationOverrides?.['postal-office'] ?? 'Testikylä'
    }
  };
};
