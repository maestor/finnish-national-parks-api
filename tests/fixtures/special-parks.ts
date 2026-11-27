import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
type SykeSourceType = 'private' | 'state';

type GeneratedSykeSource = {
  name: string;
  sourceName: string;
  sourceType?: SykeSourceType;
};

const buildSykeProtectedSitesSourceUrl = (
  sourceName: string,
  sourceType: SykeSourceType = 'state'
) => {
  const typeName =
    sourceType === 'state'
      ? 'inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue'
      : 'inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue';

  return `https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=${typeName}&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='${sourceName}'`;
};

const buildSykePrivateProtectedSitesCompositeSourceUrl = (sourceNames: string[]) => {
  const cqlFilter = encodeURIComponent(
    sourceNames.map((sourceName) => `nimi='${sourceName}'`).join(' OR ')
  );

  return `https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${cqlFilter}`;
};

const sanginjokiSourceUrl = buildSykePrivateProtectedSitesCompositeSourceUrl([
  'Asmonkorven luonnonsuojelualue',
  'Isokankaan luonnonsuojelualue'
]);

const buildMuseovirastoProtectedSitesSourceUrl = (sourceName: string) => {
  return `https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:muinaisjaannos_alue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=kohdenimi='${sourceName}'`;
};

const generatedSykeSources: GeneratedSykeSource[] = [
  {
    name: 'Elimyssalon luonnonsuojelualue',
    sourceName: 'Elimyssalon luonnonsuojelualue (Ystävyyden puisto)'
  },
  { name: 'Hiidenvaaran luonnonsuojelualue', sourceName: 'Hiidenvaaran luonnonsuojelualue' },
  {
    name: 'Ison-Palosen ja Maariansarkkien luonnonsuojelualue',
    sourceName: 'Ison-Palosen ja Maariansärkkien luonnonsuojelualue (Ystävyyden puisto)'
  },
  { name: 'Jouhtenisen luonnonsuojelualue', sourceName: 'Jouhtenisen luonnonsuojelualue' },
  { name: 'Kermajärven luonnonsuojelualue', sourceName: 'Kermajärven luonnonsuojelualue' },
  {
    name: 'Lentuan luonnonsuojelualue',
    sourceName: 'Lentuan luonnonsuojelualue (Ystävyyden puisto)'
  },
  { name: 'Levänevan luonnonsuojelualue', sourceName: 'Levanevan luonnonsuojelualue' },
  {
    name: 'Medvastön ja Stormossenin luonnonsuojelualue',
    sourceName: 'Medvastön ja Stormossenin luonnonsuojelualue'
  },
  {
    name: 'Mietoistenlahden luonnonsuojelualue',
    sourceName: 'Mietoistenlahden luonnonsuojelualue'
  },
  { name: 'Mujejärven luonnonsuojelualue', sourceName: 'Mujejärven luonnonsuojelualue' },
  { name: 'Otajärven luonnonsuojelualue', sourceName: 'Otajärven luonnonsuojelualue' },
  {
    name: 'Pihlajaveden luonnonsuojelualue',
    sourceName: 'Pihlajaveden luonnonsuojelualue'
  },
  { name: 'Punkaharjun luonnonsuojelualue', sourceName: 'Punkaharjun luonnonsuojelualue' },
  {
    name: 'Saltfjärdenin luonnonsuojelualue',
    sourceName: 'Saltfjärdenin luonnonsuojelualue'
  },
  {
    name: 'Täktominlahden ja Svanvikenin luonnonsuojelualue',
    sourceName: 'Täktominlahden ja Svanvikenin luonnonsuojelualue'
  },
  { name: 'Vaisakon luonnonsuojelualue', sourceName: 'Vaisakon luonnonsuojelualue' },
  {
    name: 'Valtavaaran ja Pyhävaaran luonnonsuojelualue',
    sourceName: 'Valtavaaran ja Pyhävaaran luonnonsuojelualue'
  },
  { name: 'Ilmakkiaavan soidensuojelualue', sourceName: 'Ilmakkiaavan soidensuojelualue' },
  {
    name: 'Juortanansalon-Lapinsuon soidensuojelualue',
    sourceName: 'Juortanansalon-Lapinsuon soidensuojelualue (Ystävyyden p.)'
  },
  { name: 'Siikanevan soidensuojelualue', sourceName: 'Siikanevan soidensuojelualue' },
  { name: 'Viiankiaavan soidensuojelualue', sourceName: 'Viiankiaavan soidensuojelualue' },
  { name: 'Karkalin luonnonpuisto', sourceName: 'Karkalin luonnonpuisto' },
  { name: 'Paljakan luonnonpuisto', sourceName: 'Paljakan  luonnonpuisto' },
  { name: 'Salamanperän luonnonpuisto', sourceName: 'Salamanperän luonnonpuisto' },
  { name: 'Sompion luonnonpuisto', sourceName: 'Sompion luonnonpuisto' },
  { name: 'Vaskijärven luonnonpuisto', sourceName: 'Vaskijärven luonnonpuisto' },
  {
    name: 'Liimanninkosken lehtojensuojelualue',
    sourceName: 'Liimanninkosken lehtojensuojelualue'
  },
  {
    name: 'Lapakisto',
    sourceName: 'Lapakiston luonnonsuojelualue',
    sourceType: 'private'
  },
  {
    name: 'Dagmarin puisto',
    sourceName: 'Dagmarin puisto',
    sourceType: 'private'
  },
  { name: 'Olvassuon luonnonpuisto', sourceName: 'Olvassuon luonnonpuisto' },
  { name: 'Koivusuon luonnonpuisto', sourceName: 'Koivusuon luonnonpuisto' }
];

const generatedMuseovirastoSources = [
  'Harola',
  'Kajaanin linna',
  'Raaseporin linna',
  'Svartholma',
  'Kuusiston piispanlinna',
  'Latokartanonkoski',
  'Kärnäkosken linnoitus',
  'Jyrkkäkosken ruukki',
  'Haapakosken ruukki',
  'Hvits'
];

const createPolygonFeature = (
  coordinates: number[][][],
  properties: Record<string, unknown> = {}
) => ({
  geometry: { coordinates, type: 'Polygon' },
  properties,
  type: 'Feature'
});

const readSpecialSourceFile = async (sourceUrl: string) => {
  const slug = sourceUrl.slice('special://'.length);
  const fileUrl = new URL(`../../src/importer/special-parks/data/${slug}.json`, import.meta.url);
  const content = await readFile(fileURLToPath(fileUrl), 'utf-8');
  return JSON.parse(content);
};

export const createSpecialParksSource = () => {
  let reserveFixtures: Promise<Record<string, unknown>> | undefined;
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
                [21.77, 61.114],
                [21.77, 61.117],
                [21.78, 61.117],
                [21.78, 61.114],
                [21.77, 61.114]
              ]
            ],
            {
              ID: 579,
              Nimi: 'Sammallahdenmäki',
              URL: 'https://example.test/sammallahdenmaki',
              aluetyyppi: 'Kohde'
            }
          ),
          createPolygonFeature(
            [
              [
                [24.963, 60.137],
                [24.963, 60.153],
                [24.998, 60.153],
                [24.998, 60.137],
                [24.963, 60.137]
              ]
            ],
            {
              ID: 583,
              Nimi: 'Suomenlinna',
              URL: 'https://example.test/suomenlinna',
              aluetyyppi: 'Kohde'
            }
          ),
          createPolygonFeature(
            [
              [
                [21.505, 61.125],
                [21.505, 61.13],
                [21.521, 61.13],
                [21.521, 61.125],
                [21.505, 61.125]
              ]
            ],
            {
              ID: 582,
              Nimi: 'Vanha Rauma',
              URL: 'https://example.test/vanha-rauma',
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
      sanginjokiSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createPolygonFeature(
            [
              [
                [25.838515, 65.008774],
                [25.838515, 65.010346],
                [25.842058, 65.010346],
                [25.842058, 65.008774],
                [25.838515, 65.008774]
              ]
            ],
            {
              nimi: 'Asmonkorven luonnonsuojelualue',
              shape_area: 22_825.728
            }
          ),
          createPolygonFeature(
            [
              [
                [25.748372, 64.993762],
                [25.748372, 65.03478],
                [25.913272, 65.03478],
                [25.913272, 64.993762],
                [25.748372, 64.993762]
              ]
            ],
            {
              nimi: 'Isokankaan luonnonsuojelualue',
              shape_area: 11_242_826.38
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
    ]
  ]);

  generatedSykeSources.forEach((entry, index) => {
    const lon = 22 + index * 0.1;
    const lat = 60 + index * 0.1;

    responses.set(buildSykeProtectedSitesSourceUrl(entry.sourceName, entry.sourceType), {
      type: 'FeatureCollection',
      features: [
        createPolygonFeature(
          [
            [
              [lon, lat],
              [lon, lat + 0.03],
              [lon + 0.03, lat + 0.03],
              [lon + 0.03, lat],
              [lon, lat]
            ]
          ],
          {
            nimi: entry.sourceName,
            paatpvm: '2001-01-01T00:00:00Z',
            shape_area: 1_500_000 + index * 10_000
          }
        )
      ]
    });
  });

  generatedMuseovirastoSources.forEach((sourceName, index) => {
    const lon = 25 + index * 0.1;
    const lat = 61 + index * 0.1;

    responses.set(buildMuseovirastoProtectedSitesSourceUrl(sourceName), {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [lon, lat],
                  [lon, lat + 0.02],
                  [lon + 0.02, lat + 0.02],
                  [lon + 0.02, lat],
                  [lon, lat]
                ]
              ]
            ]
          },
          properties: {
            kohdenimi: sourceName
          }
        }
      ]
    });
  });

  return async (sourceUrl: string) => {
    if (sourceUrl.startsWith('special://')) {
      return readSpecialSourceFile(sourceUrl);
    }

    if (
      sourceUrl.includes(
        encodeURIComponent(
          "kohdenimi='Turunmaan rannikon kalkkilouhokset ja Paraisten kalkkitehdas'"
        )
      )
    ) {
      const allFeatures = [
        createPolygonFeature(
          [
            [
              [22.78, 60.077],
              [22.784, 60.078],
              [22.783, 60.08],
              [22.777, 60.079],
              [22.78, 60.077]
            ]
          ],
          {
            kohdenimi: 'Turunmaan rannikon kalkkilouhokset ja Paraisten kalkkitehdas',
            nimi: 'Vestlax'
          }
        ),
        createPolygonFeature(
          [
            [
              [22.298, 60.297],
              [22.287, 60.3],
              [22.272, 60.293],
              [22.286, 60.289],
              [22.298, 60.297]
            ]
          ],
          {
            kohdenimi: 'Turunmaan rannikon kalkkilouhokset ja Paraisten kalkkitehdas',
            nimi: 'Paraisten kalkin teollisuuslaitokset ja Limberg - Skräbböle'
          }
        ),
        createPolygonFeature(
          [
            [
              [22.884, 60.1],
              [22.879, 60.1],
              [22.87, 60.099],
              [22.884, 60.098],
              [22.884, 60.1]
            ]
          ],
          {
            kohdenimi: 'Turunmaan rannikon kalkkilouhokset ja Paraisten kalkkitehdas',
            nimi: 'Förby'
          }
        ),
        createPolygonFeature(
          [
            [
              [22.229, 60.281],
              [22.243, 60.283],
              [22.257, 60.287],
              [22.238, 60.284],
              [22.229, 60.281]
            ]
          ],
          {
            kohdenimi: 'Turunmaan rannikon kalkkilouhokset ja Paraisten kalkkitehdas',
            nimi: 'Simonby'
          }
        )
      ];
      const filteredFeatures = sourceUrl.includes(
        encodeURIComponent("nimi='Paraisten kalkin teollisuuslaitokset ja Limberg - Skräbböle'")
      )
        ? allFeatures.filter(
            (feature) =>
              feature.properties.nimi ===
              'Paraisten kalkin teollisuuslaitokset ja Limberg - Skräbböle'
          )
        : allFeatures;

      return {
        type: 'FeatureCollection',
        features: filteredFeatures
      };
    }

    if (sourceUrl.includes("cql_filter=nimi='Rokokallio'")) {
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [24.45, 60.48],
                    [24.47, 60.48],
                    [24.47, 60.5],
                    [24.45, 60.5],
                    [24.45, 60.48]
                  ]
                ],
                [
                  [
                    [24.43, 60.485],
                    [24.438, 60.485],
                    [24.438, 60.492],
                    [24.43, 60.492],
                    [24.43, 60.485]
                  ]
                ],
                [
                  [
                    [24.478, 60.49],
                    [24.484, 60.49],
                    [24.484, 60.496],
                    [24.478, 60.496],
                    [24.478, 60.49]
                  ]
                ]
              ]
            },
            properties: {
              objectid: 450,
              lskallioaluetunnus: 'KAO010129',
              nimi: 'Rokokallio',
              area_m2: 890437.7632,
              arvoluokka: 3,
              selitearvoluokka: 'Hyvin arvokas kallioalue'
            }
          }
        ]
      };
    }

    if (sourceUrl.includes(encodeURIComponent("kohdenimi='Tammion ja Kuorsalon saaristokylät'"))) {
      const allFeatures = [
        createPolygonFeature(
          [
            [
              [27.424945, 60.41950808],
              [27.41667871, 60.41775873],
              [27.41310748, 60.41531905],
              [27.41314319, 60.41414355],
              [27.42687709, 60.41257477],
              [27.42862636, 60.41484481],
              [27.424945, 60.41950808]
            ]
          ],
          {
            kohdenimi: 'Tammion ja Kuorsalon saaristokylät',
            nimi: ' '
          }
        ),
        createPolygonFeature(
          [
            [
              [27.41135593, 60.44693503],
              [27.42240629, 60.45673873],
              [27.41475832, 60.46304775],
              [27.37551787, 60.47537125],
              [27.36705536, 60.47569112],
              [27.36191516, 60.47504695],
              [27.37078496, 60.46301574],
              [27.37079302, 60.45268029],
              [27.38311336, 60.44665725],
              [27.39835913, 60.44618475],
              [27.41135593, 60.44693503]
            ]
          ],
          {
            kohdenimi: 'Tammion ja Kuorsalon saaristokylät',
            nimi: 'Kuorsalo'
          }
        )
      ];
      const filteredFeatures = sourceUrl.includes(encodeURIComponent("nimi<>'Kuorsalo'"))
        ? allFeatures.filter((feature) => feature.properties.nimi !== 'Kuorsalo')
        : allFeatures;

      return {
        type: 'FeatureCollection',
        features: filteredFeatures
      };
    }

    if (
      sourceUrl.includes(
        encodeURIComponent("kohdenimi='Vihdin kirkonkylä ja Vanhalan viljelymaisema'")
      )
    ) {
      return JSON.parse(
        await readFile(new URL('./museovirasto-vihdin-kirkonkyla.json', import.meta.url), 'utf-8')
      );
    }

    if (
      sourceUrl.includes(
        encodeURIComponent("kohdenimi='Lappeenrannan linnoitus- ja varuskuntakaupunki'")
      ) &&
      !sourceUrl.includes(encodeURIComponent("nimi='Linnoitus ja Rakuunanmäki'"))
    ) {
      throw new Error('Lappeenrannan linnoitus must select the fortress feature.');
    }

    if (
      sourceUrl.includes(encodeURIComponent("kohdenimi='Jatkosodan tapahtuma- ja muistopaikat'"))
    ) {
      if (!sourceUrl.includes(encodeURIComponent("nimi='Norvajärven kappeli'"))) {
        throw new Error('The cemetery import must select the Norvajärven kappeli feature.');
      }
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [25.78561029, 66.62842857],
                    [25.78421791, 66.62853236],
                    [25.7835321, 66.62781863],
                    [25.78396473, 66.62744996],
                    [25.78533758, 66.6270098],
                    [25.78600566, 66.62697917],
                    [25.78700624, 66.62715151],
                    [25.78689405, 66.62760134],
                    [25.78561029, 66.62842857]
                  ]
                ]
              ]
            },
            properties: { ID: 5176, OBJECTID: 1678, nimi: 'Norvajärven kappeli' }
          }
        ]
      };
    }

    if (sourceUrl.includes('typeNames=rajapinta_suojellut:rky_alue')) {
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [24.5, 60.5],
                    [24.5, 60.52],
                    [24.52, 60.52],
                    [24.52, 60.5],
                    [24.5, 60.5]
                  ]
                ]
              ]
            },
            properties: {
              kohdenimi: 'Testin tehdaskylä'
            }
          }
        ]
      };
    }

    if (sourceUrl.includes('cql_filter=lsaluetunnus%3D')) {
      reserveFixtures ??= Promise.all(
        ['missing-trail-parent-areas', 'approved-missing-parent-areas'].flatMap((batch) =>
          Array.from({ length: 11 }, async (_, index) =>
            JSON.parse(
              await readFile(new URL(`./${batch}-${index + 1}.json`, import.meta.url), 'utf8')
            )
          )
        )
      ).then((parts) => Object.assign({}, ...parts));
      const response = (await reserveFixtures)[sourceUrl];
      if (response) return response;
    }

    const response = responses.get(sourceUrl);

    if (!response) {
      throw new Error(`Unexpected source URL in test: ${sourceUrl}`);
    }

    return response;
  };
};
