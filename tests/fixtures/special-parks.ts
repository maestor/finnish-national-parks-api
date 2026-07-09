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
const paistjarviSourceUrl =
  'https://www.luontoon.fi/geo/features/collections/public.destinations_details_view/items?filter=slug%3D%27paistjarvi%27&filter-lang=cql-text&limit=1000';
const paavolanLuontopolkuSourceUrl =
  'https://services2.arcgis.com/RrgTAfcgVcTLi0XF/arcgis/rest/services/Paavolan_reitti/FeatureServer/0/query?f=geojson&outFields=FID%2CREITTI%2CLISATIETO&returnGeometry=true&where=1%3D1&geometry=23.882%2C60.225%2C23.891%2C60.228&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects';
const santalahdenLuontopolkuSourceUrl =
  'https://services-eu1.arcgis.com/zIF5LKWARhpLFEt3/arcgis/rest/services/Santalahden_reitti/FeatureServer/0/query?f=geojson&outFields=FID%2CLayer%2CNimi%2CLinkki&returnGeometry=true&where=1%3D1';
const torholanLuolaSourceUrl =
  'https://www.luontoon.fi/geo/features/collections/public.all_lines_details_view/items?filter=slug%3D%27torholan-luolan-polku-lohja-194240%27&filter-lang=cql-text&limit=1000';

type SykeSourceType = 'private' | 'state';

type GeneratedSykeSource = {
  name: string;
  sourceName: string;
  sourceType?: SykeSourceType;
};

type GeneratedLuontoonDestinationSource = {
  name: string;
  slug: string;
  surfaceArea?: number;
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

const buildLuontoonGeoJsonCollectionSourceUrl = ({
  collectionId,
  filter,
  limit = 1000
}: {
  collectionId: string;
  filter: string;
  limit?: number;
}) => {
  const params = new URLSearchParams({
    filter,
    'filter-lang': 'cql-text',
    limit: String(limit)
  });

  return `https://www.luontoon.fi/geo/features/collections/${collectionId}/items?${params.toString()}`;
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
  { name: 'Koivusuon luonnonpuisto', sourceName: 'Koivusuon luonnonpuisto' },
  { name: 'Korouoma', sourceName: 'Korouoman lehtojensuojelualue' }
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
  'Haapakosken ruukki'
];

const generatedLuontoonDestinationSources: GeneratedLuontoonDestinationSource[] = [
  { name: 'Litokairan soidensuojelualue', slug: 'litokairan-soidensuojelualue' },
  { name: 'Martimoaavan soidensuojelualue', slug: 'martimoaavan-soidensuojelualue' },
  { name: 'Paukanevan soidensuojelualue', slug: 'paukanevan-soidensuojelualue' },
  {
    name: 'Neitvuori ja Luonterin luonnonsuojelualue',
    slug: 'neitvuori-ja-luonterin-luonnonsuojelualue'
  },
  { name: 'Koskeljärvi', slug: 'koskeljarvi' },
  { name: 'Kurimonkoski', slug: 'kurimonkoski' },
  { name: 'Pukala', slug: 'pukala' },
  { name: 'Peurajärvi', slug: 'peurajarvi' },
  { name: 'Hepoköngäs', slug: 'hepokongas' },
  { name: 'Auttiköngäs', slug: 'auttikongas' },
  { name: 'Pinkjärvi', slug: 'pinkjarvi' },
  { name: 'Soiperoinen', slug: 'soiperoinen' },
  { name: 'Unarinköngäs', slug: 'unarinkongas' }
];

const createPolygonFeature = (
  coordinates: number[][][],
  properties: Record<string, unknown> = {}
) => ({
  geometry: { coordinates, type: 'Polygon' },
  properties,
  type: 'Feature'
});

const createLineStringFeature = (
  coordinates: number[][],
  properties: Record<string, unknown> = {}
) => ({
  geometry: { coordinates, type: 'LineString' },
  properties,
  type: 'Feature'
});

const createMultiLineStringFeature = (
  coordinates: number[][][],
  properties: Record<string, unknown> = {}
) => ({
  geometry: { coordinates, type: 'MultiLineString' },
  properties,
  type: 'Feature'
});

const readSpecialSourceFile = async (sourceUrl: string) => {
  const slug = sourceUrl.slice('special://'.length);
  const fileUrl = new URL(`../../src/importer/data/${slug}.json`, import.meta.url);
  const content = await readFile(fileURLToPath(fileUrl), 'utf-8');
  return JSON.parse(content);
};

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
    ],
    [
      paistjarviSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [26.3364, 61.2622],
                    [26.3364, 61.3146],
                    [26.4688, 61.3146],
                    [26.4688, 61.2622],
                    [26.3364, 61.2622]
                  ]
                ]
              ]
            },
            properties: {
              name_fi: 'Paistjärvi',
              slug: 'paistjarvi',
              surfaceArea: 12_727_533.832729377
            }
          }
        ]
      }
    ],
    [
      paavolanLuontopolkuSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createLineStringFeature(
            [
              [23.8852161875505, 60.2275115553159],
              [23.8860956065322, 60.2273302072513],
              [23.8869633792335, 60.2270960207198]
            ],
            {
              FID: 1,
              LISATIETO: ' ',
              REITTI: 'Luontopolun reitti'
            }
          ),
          createLineStringFeature(
            [
              [23.8874876852271, 60.2267570516225],
              [23.8882452933221, 60.2267991729627],
              [23.8884464972605, 60.2266798339451]
            ],
            {
              FID: 6,
              LISATIETO: 'Pitkospuut',
              REITTI: 'Pitkospuut'
            }
          ),
          createLineStringFeature(
            [
              [23.8883446898101, 60.2267793546796],
              [23.8898029538791, 60.2263894373494],
              [23.890603352384, 60.2265361970361]
            ],
            {
              FID: 8,
              LISATIETO: 'Pistopolku  Tammelle',
              REITTI: 'Vaihtoehtoinen reitti'
            }
          ),
          createLineStringFeature(
            [
              [23.8883800218139, 60.2258545825143],
              [23.888288394225, 60.2254776367656],
              [23.8836126343924, 60.2277589357966]
            ],
            {
              FID: 20,
              LISATIETO: 'Viimeinen pätkä kokonaisuudessaan',
              REITTI: 'Luontopolun reitti'
            }
          )
        ]
      }
    ],
    [
      santalahdenLuontopolkuSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createLineStringFeature(
            [
              [26.8585271902272, 60.435033100798],
              [26.8550460859602, 60.4319330201228],
              [26.8507921028238, 60.4309112117761]
            ],
            {
              FID: 1,
              Layer: 'Merireitti',
              Linkki: 'https://www.santalahti.fi/fi/Aktiviteetit/Luontopolut%20ja%20puistot/',
              Nimi: 'Santalahden luontopolku'
            }
          ),
          createLineStringFeature(
            [
              [26.8507931513519, 60.4309110325505],
              [26.8527882312624, 60.4348711068796],
              [26.8587087783301, 60.4352943052316]
            ],
            {
              FID: 2,
              Layer: 'Merireitti',
              Linkki: 'https://www.santalahti.fi/fi/Aktiviteetit/Luontopolut%20ja%20puistot/',
              Nimi: 'Santalahden luontopolku'
            }
          ),
          createLineStringFeature(
            [
              [26.8539776946415, 60.4349348747832],
              [26.8527586436998, 60.4360687221766],
              [26.853065650428, 60.4382434551032]
            ],
            {
              FID: 3,
              Layer: 'Metsäreitti',
              Linkki: 'https://www.santalahti.fi/fi/Aktiviteetit/Luontopolut%20ja%20puistot/',
              Nimi: 'Santalahden luontopolku'
            }
          ),
          createLineStringFeature(
            [
              [26.8530563199517, 60.4382512540421],
              [26.8523228980215, 60.4406051257843],
              [26.8510114932418, 60.4418992585836]
            ],
            {
              FID: 4,
              Layer: 'Metsäreitti',
              Linkki: 'https://www.santalahti.fi/fi/Aktiviteetit/Luontopolut%20ja%20puistot/',
              Nimi: 'Santalahden luontopolku'
            }
          ),
          createLineStringFeature(
            [
              [26.8510111439327, 60.4418993811518],
              [26.8538538765541, 60.4433449987787],
              [26.8592556232422, 60.4427473250297],
              [26.8586885087252, 60.4397735250218]
            ],
            {
              FID: 5,
              Layer: 'Metsäreitti',
              Linkki: 'https://www.santalahti.fi/fi/Aktiviteetit/Luontopolut%20ja%20puistot/',
              Nimi: 'Santalahden luontopolku'
            }
          ),
          createLineStringFeature(
            [
              [26.8586922409682, 60.4397689705326],
              [26.8563967106475, 60.4364264544899],
              [26.8537303477567, 60.4352682068634]
            ],
            {
              FID: 6,
              Layer: 'Metsäreitti',
              Linkki: 'https://www.santalahti.fi/fi/Aktiviteetit/Luontopolut%20ja%20puistot/',
              Nimi: 'Santalahden luontopolku'
            }
          ),
          createLineStringFeature(
            [
              [26.8585756971808, 60.4352949224869],
              [26.858445949731, 60.4350108173457]
            ],
            {
              FID: 7,
              Layer: 'Merireitti',
              Linkki: 'https://www.santalahti.fi/fi/Aktiviteetit/Luontopolut%20ja%20puistot/',
              Nimi: 'Santalahden luontopolku'
            }
          )
        ]
      }
    ],
    [
      torholanLuolaSourceUrl,
      {
        type: 'FeatureCollection',
        features: [
          createMultiLineStringFeature(
            [
              [
                [23.85665818, 60.254699132],
                [23.85677561, 60.25465329],
                [23.85683879, 60.25462112],
                [23.85691244, 60.25457352],
                [23.85696419, 60.25452477],
                [23.85703298, 60.25444461],
                [23.8570978, 60.25434195],
                [23.85713838, 60.25424698],
                [23.85716473, 60.2541769],
                [23.85719157, 60.25407706],
                [23.85722013, 60.25393289],
                [23.8572344, 60.25377733],
                [23.85723179, 60.25360682],
                [23.85721931, 60.25346439],
                [23.85720459, 60.25327244],
                [23.85719673, 60.25310538],
                [23.857183867, 60.252980562]
              ]
            ],
            {
              city: 'Lohja',
              length_km: 0.2,
              name_fi: 'Torholan luolan polku',
              slug: 'torholan-luolan-polku-lohja-194240',
              source: 'uljas'
            }
          )
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

  generatedLuontoonDestinationSources.forEach((entry, index) => {
    const lon = 27 + index * 0.1;
    const lat = 62 + index * 0.1;

    responses.set(
      buildLuontoonGeoJsonCollectionSourceUrl({
        collectionId: 'public.destinations_details_view',
        filter: `slug='${entry.slug}'`
      }),
      {
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
                    [lon, lat + 0.03],
                    [lon + 0.03, lat + 0.03],
                    [lon + 0.03, lat],
                    [lon, lat]
                  ]
                ]
              ]
            },
            properties: {
              name: entry.name,
              slug: entry.slug,
              surfaceArea: entry.surfaceArea ?? 2_000_000 + index * 25_000
            }
          }
        ]
      }
    );
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
      return {
        type: 'FeatureCollection',
        features: [
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
        ]
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

    const response = responses.get(sourceUrl);

    if (!response) {
      throw new Error(`Unexpected source URL in test: ${sourceUrl}`);
    }

    return response;
  };
};
