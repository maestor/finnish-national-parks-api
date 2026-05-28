const merenkurkkuSourceUrl =
  'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326';

const kevoSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Kevon luonnonpuisto'";

const laajalahtiSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Laajalahden luonnonsuojelualue'";

const liminganlahtiSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Liminganlahden luonnonsuojelualue'";

const mallaSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Mallan luonnonpuisto'";

const siikalahtiSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Siikalahden luonnonsuojelualue'";

const napapiiriSourceUrl = 'special://napapiirin-retkeilyalue';
const inariSourceUrl = 'special://inarin-retkeilyalue';

const createPolygonFeature = (
  coordinates: number[][][],
  properties: Record<string, unknown> = {}
) => ({
  geometry: { coordinates, type: 'Polygon' },
  properties,
  type: 'Feature'
});

export const createSpecialParksSource = () => {
  const responses = new Map<string, unknown>([
    [
      merenkurkkuSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature(
            [
              [
                [21.0, 63.0],
                [21.0, 63.2],
                [21.2, 63.2],
                [21.2, 63.0],
                [21.0, 63.0]
              ]
            ],
            {
              ID: 898,
              Nimi: 'Merenkurkun saaristo B',
              URL: 'https://example.test/merenkurkku',
              aluetyyppi: 'Kohde'
            }
          ),
          createPolygonFeature(
            [
              [
                [20.7, 63.3],
                [20.7, 63.5],
                [21.1, 63.5],
                [21.1, 63.3],
                [20.7, 63.3]
              ]
            ],
            {
              ID: 898,
              Nimi: 'Merenkurkun saaristo A',
              URL: 'https://example.test/merenkurkku',
              aluetyyppi: 'Kohde'
            }
          ),
          createPolygonFeature(
            [
              [
                [20.6, 62.9],
                [20.6, 63.6],
                [21.3, 63.6],
                [21.3, 62.9],
                [20.6, 62.9]
              ]
            ],
            {
              ID: 898,
              Nimi: 'Suojavyöhyke',
              URL: 'https://example.test/merenkurkku',
              aluetyyppi: 'Suoja-alue'
            }
          )
        ]
      }
    ],
    [
      kevoSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature(
            [
              [
                [27.0, 69.5],
                [27.0, 69.7],
                [27.3, 69.7],
                [27.3, 69.5],
                [27.0, 69.5]
              ]
            ],
            {
              nimi: 'Kevon luonnonpuisto',
              paatpvm: '1956-12-21T00:00:00Z',
              shape_area: 710_648_647
            }
          )
        ]
      }
    ],
    [
      laajalahtiSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature(
            [
              [
                [24.8, 60.2],
                [24.8, 60.22],
                [24.85, 60.22],
                [24.85, 60.2],
                [24.8, 60.2]
              ]
            ],
            {
              ely: 'Uudenmaan ELY-keskus',
              nimi: 'Laajalahden luonnonsuojelualue',
              paatpvm: '1989-11-10T00:00:00Z',
              shape_area: 1_894_414
            }
          ),
          createPolygonFeature(
            [
              [
                [23.8, 63.5],
                [23.8, 63.52],
                [23.85, 63.52],
                [23.85, 63.5],
                [23.8, 63.5]
              ]
            ],
            {
              ely: 'Etelä-Pohjanmaan ELY-keskus',
              nimi: 'Laajalahden luonnonsuojelualue',
              paatpvm: '2022-03-31T00:00:00Z',
              shape_area: 1_584_940
            }
          )
        ]
      }
    ],
    [
      liminganlahtiSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature(
            [
              [
                [25.2, 64.8],
                [25.2, 64.82],
                [25.25, 64.82],
                [25.25, 64.8],
                [25.2, 64.8]
              ]
            ],
            {
              nimi: 'Liminganlahden luonnonsuojelualue',
              paatpvm: '1998-11-25T00:00:00Z',
              shape_area: 23_784
            }
          ),
          createPolygonFeature(
            [
              [
                [25.3, 64.82],
                [25.3, 64.85],
                [25.35, 64.85],
                [25.35, 64.82],
                [25.3, 64.82]
              ]
            ],
            {
              nimi: 'Liminganlahden luonnonsuojelualue',
              paatpvm: '1998-05-11T00:00:00Z',
              shape_area: 3_677_085
            }
          )
        ]
      }
    ],
    [
      mallaSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature(
            [
              [
                [20.7, 69.0],
                [20.7, 69.05],
                [20.8, 69.05],
                [20.8, 69.0],
                [20.7, 69.0]
              ]
            ],
            {
              nimi: 'Mallan luonnonpuisto',
              paatpvm: '1938-02-18T00:00:00Z',
              shape_area: 30_796_806
            }
          )
        ]
      }
    ],
    [
      siikalahtiSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature(
            [
              [
                [29.3, 61.5],
                [29.3, 61.55],
                [29.4, 61.55],
                [29.4, 61.5],
                [29.3, 61.5]
              ]
            ],
            {
              nimi: 'Siikalahden luonnonsuojelualue',
              paatpvm: '2019-11-14T00:00:00Z',
              shape_area: 4_469_391
            }
          )
        ]
      }
    ],
    [
      napapiiriSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature(
            [
              [
                [25.8, 66.5],
                [25.8, 66.55],
                [25.85, 66.55],
                [25.85, 66.5],
                [25.8, 66.5]
              ]
            ],
            {
              shape_area: 26_156_780
            }
          ),
          createPolygonFeature([
            [
              [25.85, 66.5],
              [25.85, 66.52],
              [25.87, 66.52],
              [25.87, 66.5],
              [25.85, 66.5]
            ]
          ])
        ]
      }
    ],
    [
      inariSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature([
            [
              [27.0, 68.9],
              [27.0, 69.0],
              [27.1, 69.0],
              [27.1, 68.9],
              [27.0, 68.9]
            ]
          ])
        ]
      }
    ]
  ]);

  return async (sourceUrl: string) => {
    const response = responses.get(sourceUrl);

    if (!response) {
      throw new Error(`Unexpected source URL in test: ${sourceUrl}`);
    }

    return response;
  };
};
