import {
  buildArcGisGeoJsonQuerySourceUrl,
  buildLuontoonGeoJsonCollectionSourceUrl,
  buildMuseovirastoRkyAreaSourceUrl,
  buildSykeGeologicalRockAreaSourceUrl,
  buildSykePrivateProtectedSitesCompositeSourceUrl,
  extractGeoJsonAreaM2Metadata,
  extractHikingAreaMetadata,
  extractLuontoonDestinationMetadata
} from './builders.js';
import type { SpecialParkConfig } from './types.js';

export const baseSpecialParkConfigs: SpecialParkConfig[] = [
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Raippaluodontie 2',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/merenkurkun-maailmanperintoalue',
    name: 'Merenkurkun maailmanperintöalue',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: '65800',
    postalOffice: 'Raippaluoto',
    responseShapeVersion: 'museovirasto-world-heritage-areas-v1',
    slug: 'merenkurkun-maailmanperintoalue',
    sourceFeatureId: 898,
    sourceParser: 'world-heritage-area',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_898
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Sammallahdentie',
    parkUrl: null,
    name: 'Sammallahdenmäki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '27230',
    postalOffice: 'Rauma',
    responseShapeVersion: 'museovirasto-world-heritage-areas-v1',
    slug: 'sammallahdenmaki',
    sourceFeatureId: 579,
    sourceParser: 'world-heritage-area',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_899
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Suomenlinna',
    parkUrl: null,
    name: 'Suomenlinna',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '00190',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'museovirasto-world-heritage-areas-v1',
    slug: 'suomenlinna',
    sourceFeatureId: 583,
    sourceParser: 'world-heritage-area',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_900
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Vanha Rauma',
    parkUrl: null,
    name: 'Vanha Rauma',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '26100',
    postalOffice: 'Rauma',
    responseShapeVersion: 'museovirasto-world-heritage-areas-v1',
    slug: 'vanha-rauma',
    sourceFeatureId: 582,
    sourceParser: 'world-heritage-area',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_901
  },
  {
    displayTypeName: 'Luonnonpuisto',
    locationLabel: 'Kevon luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/kevon-luonnonpuisto',
    name: 'Kevon luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'kevon-luonnonpuisto',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Kevon luonnonpuisto'",
    syntheticLipasId: 9_000_915
  },
  {
    displayTypeName: null,
    filterFeatures: (feature) => feature.properties.ely === 'Uudenmaan ELY-keskus',
    locationLabel: 'Laajalahden luonnonsuojelualue',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/laajalahden-luonnonsuojelualue',
    name: 'Laajalahden luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'laajalahden-luonnonsuojelualue',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Laajalahden luonnonsuojelualue'",
    syntheticLipasId: 9_000_824
  },
  {
    displayTypeName: 'Lintuvesi',
    locationLabel: 'Liminganlahti',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/liminganlahti',
    name: 'Liminganlahti',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'liminganlahti',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Liminganlahden luonnonsuojelualue'",
    syntheticLipasId: 9_000_70433
  },
  {
    displayTypeName: 'Luonnonpuisto',
    locationLabel: 'Mallan luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/mallan-luonnonpuisto',
    name: 'Mallan luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'mallan-luonnonpuisto',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Mallan luonnonpuisto'",
    syntheticLipasId: 9_000_42160
  },
  {
    displayTypeName: null,
    locationLabel: 'Siikalahden luonnonsuojelualue',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/siikalahden-luonnonsuojelualue',
    name: 'Siikalahden luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'siikalahden-luonnonsuojelualue',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Siikalahden luonnonsuojelualue'",
    syntheticLipasId: 9_000_102829
  },
  {
    displayTypeName: 'Valtion retkeilyalue',
    extractMetadata: extractHikingAreaMetadata,
    locationLabel: 'Vaattunkikönkääntie',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/napapiirin-retkeilyalue',
    name: 'Napapiirin retkeilyalue',
    parkTypeSlug: 'hiking-area',
    postalCode: '96930',
    postalOffice: 'Rovaniemi',
    responseShapeVersion: 'syke-hiking-areas-v1',
    slug: 'napapiirin-retkeilyalue',
    sourceUrl: 'special://napapiirin-retkeilyalue',
    syntheticLipasId: 9_000_126_313
  },
  {
    displayTypeName: 'Valtion retkeilyalue',
    locationLabel: 'Inarintie 46',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/inarin-retkeilyalue',
    name: 'Inarin retkeilyalue',
    parkTypeSlug: 'hiking-area',
    postalCode: '99870',
    postalOffice: 'Inari',
    responseShapeVersion: 'lipas-hiking-area-v1',
    slug: 'inarin-retkeilyalue',
    sourceUrl: 'special://inarin-retkeilyalue',
    syntheticLipasId: 606_689
  },
  {
    displayTypeName: null,
    locationLabel: 'Pietiläntie 23',
    parkUrl: null,
    name: 'Paavolan luontopolku',
    parkTypeSlug: 'nature-trail',
    postalCode: '08800',
    postalOffice: 'Lohja',
    responseShapeVersion: 'lohja-paavolan-arcgis-route-v1',
    slug: 'paavolan-luontopolku',
    sourceParser: 'geojson',
    sourceUrl: buildArcGisGeoJsonQuerySourceUrl({
      geometry: [23.882, 60.225, 23.891, 60.228],
      outFields: ['FID', 'REITTI', 'LISATIETO'],
      serviceUrl:
        'https://services2.arcgis.com/RrgTAfcgVcTLi0XF/arcgis/rest/services/Paavolan_reitti/FeatureServer/0'
    }),
    syntheticLipasId: 9_004_404
  },
  {
    displayTypeName: null,
    locationLabel: 'Kipparitie 4',
    parkUrl: null,
    name: 'Santalahden luontopolku',
    parkTypeSlug: 'nature-trail',
    postalCode: '48310',
    postalOffice: 'Kotka',
    responseShapeVersion: 'kotka-santalahden-arcgis-route-v1',
    slug: 'santalahden-luontopolku',
    sourceParser: 'geojson',
    sourceUrl: buildArcGisGeoJsonQuerySourceUrl({
      outFields: ['FID', 'Layer', 'Nimi', 'Linkki'],
      serviceUrl:
        'https://services-eu1.arcgis.com/zIF5LKWARhpLFEt3/arcgis/rest/services/Santalahden_reitti/FeatureServer/0'
    }),
    syntheticLipasId: 9_004_405
  },
  {
    displayTypeName: null,
    locationLabel: 'Torholan luola',
    parkUrl: 'https://www.luontoon.fi/fi/reitit/torholan-luolan-polku-lohja-194240',
    name: 'Torholan luola',
    parkTypeSlug: 'nature-trail',
    postalCode: null,
    postalOffice: 'Lohja',
    responseShapeVersion: 'luontoon-torholan-route-v1',
    slug: 'torholan-luola',
    sourceParser: 'geojson',
    sourceUrl: buildLuontoonGeoJsonCollectionSourceUrl({
      collectionId: 'public.all_lines_details_view',
      filter: "slug='torholan-luolan-polku-lohja-194240'"
    }),
    syntheticLipasId: 9_004_406
  },
  {
    displayTypeName: null,
    extractMetadata: extractLuontoonDestinationMetadata,
    locationLabel: 'Sonnasentie 948',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/paistjarvi',
    name: 'Paistjärvi',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '18300',
    postalOffice: 'Heinola',
    responseShapeVersion: 'luontoon-destination-area-v1',
    slug: 'paistjarvi',
    sourceParser: 'geojson',
    sourceUrl: buildLuontoonGeoJsonCollectionSourceUrl({
      collectionId: 'public.destinations_details_view',
      filter: "slug='paistjarvi'"
    }),
    syntheticLipasId: 9_001_044
  },
  {
    displayTypeName: null,
    locationLabel: 'Kalajoen hiekkasärkät',
    parkUrl: null,
    name: 'Kalajoen hiekkasärkät',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: 'Kalajoki',
    responseShapeVersion: 'manual-kalajoen-hiekkasarkat-osm-beach-v2',
    slug: 'kalajoen-hiekkasarkat',
    sourceUrl: 'special://kalajoen-hiekkasarkat',
    syntheticLipasId: 9_002_032
  },
  {
    displayTypeName: null,
    locationLabel: 'Uutelantie 1',
    parkUrl:
      'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/uutelan-ulkoilualue',
    name: 'Uutelan ulkoilualue',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00990',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-helsinki-admin-division-v1',
    slug: 'uutelan-ulkoilualue',
    sourceUrl: 'special://uutelan-ulkoilualue',
    syntheticLipasId: 9_001_070
  },
  {
    displayTypeName: null,
    locationLabel: 'Rantapaadentie 7',
    parkUrl:
      'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/kallahden-ulkoilualue',
    name: 'Kallahden ulkoilualue',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00980',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-helsinki-admin-division-v1',
    slug: 'kallahden-ulkoilualue',
    sourceUrl: 'special://kallahden-ulkoilualue',
    syntheticLipasId: 9_001_071
  },
  {
    displayTypeName: null,
    locationLabel: 'Seurasaarentie 15',
    parkUrl:
      'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/seurasaari',
    name: 'Seurasaari',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00250',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-osm-island-boundary-v1',
    slug: 'seurasaari',
    sourceUrl: 'special://seurasaari',
    syntheticLipasId: 9_001_072
  },
  {
    displayTypeName: null,
    locationLabel: 'Mustikkamaantie 10',
    parkUrl:
      'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/mustikkamaa',
    name: 'Mustikkamaa',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00570',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-osm-island-boundary-v1',
    slug: 'mustikkamaa',
    sourceUrl: 'special://mustikkamaa',
    syntheticLipasId: 9_001_073
  },
  {
    displayTypeName: null,
    extractMetadata: extractGeoJsonAreaM2Metadata,
    locationLabel: 'Henrik Borgströmin polku',
    parkUrl: 'https://vihreatsylit.fi/tullisaaren-kartanopuisto/',
    name: 'Tullisaaren kartanopuisto',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-helsinki-ylre-viheralue-v1',
    slug: 'tullisaaren-kartanopuisto',
    sourceUrl: 'special://tullisaaren-kartanopuisto',
    syntheticLipasId: 9_001_084
  },
  {
    displayTypeName: null,
    locationLabel: 'Pihlajamäki',
    parkUrl: 'https://vihreatsylit.fi/aarnipata-ja-rauninmalja/',
    name: 'Pihlajamäen hiidenkirnut',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-helsinki-vihreat-sylit-point-proxy-v1',
    slug: 'pihlajamaen-hiidenkirnut',
    sourceUrl: 'special://pihlajamaen-hiidenkirnut',
    syntheticLipasId: 9_002_033
  },
  {
    displayTypeName: null,
    locationLabel: 'Niinisaarentie',
    parkUrl: 'https://vihreatsylit.fi/vuosaarenhuippu/',
    name: 'Vuosaarenhuippu',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-osm-park-boundary-v1',
    slug: 'vuosaarenhuippu',
    sourceUrl: 'special://vuosaarenhuippu',
    syntheticLipasId: 9_002_034
  },
  {
    displayTypeName: null,
    locationLabel: 'Sahaajankatu',
    parkUrl: 'https://vihreatsylit.fi/kirsikkapuisto/',
    name: 'Kirsikkapuisto',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-osm-park-boundary-v1',
    slug: 'kirsikkapuisto',
    sourceUrl: 'special://kirsikkapuisto',
    syntheticLipasId: 9_002_035
  },
  {
    displayTypeName: null,
    locationLabel: 'Tervasaarenkannas',
    parkUrl: 'https://vihreatsylit.fi/tervasaari/',
    name: 'Tervasaari',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-helsinki-tervasaari-wfs-v2',
    slug: 'tervasaari',
    sourceUrl: 'special://tervasaari',
    syntheticLipasId: 9_002_036
  },
  {
    displayTypeName: null,
    locationLabel: 'Talvipuutarha',
    parkUrl: 'https://vihreatsylit.fi/kaupunginpuutarha/',
    name: 'Talvipuutarha',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00250',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-osm-garden-boundary-v1',
    slug: 'talvipuutarha',
    sourceUrl: 'special://talvipuutarha',
    syntheticLipasId: 9_002_037
  },
  {
    displayTypeName: null,
    locationLabel: 'Uutelankanava',
    parkUrl: 'https://vihreatsylit.fi/uutelan-kanava-ja-kauniinilmanpuisto/',
    name: 'Uutelan kanava',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-osm-water-boundary-v1',
    slug: 'uutelan-kanava',
    sourceUrl: 'special://uutelan-kanava',
    syntheticLipasId: 9_002_038
  },
  {
    displayTypeName: null,
    locationLabel: 'Seili',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/seili',
    name: 'Seili',
    parkTypeSlug: 'cultural-history-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'manual-mml-landwaterboundary-v1',
    slug: 'seili',
    sourceUrl: 'special://seili',
    syntheticLipasId: 9_001_034
  },
  {
    displayTypeName: null,
    locationLabel: 'Valkjärventie 604',
    parkUrl:
      'https://www.suomenvesiputoukset.fi/vesiputoukset/suomen-vesiputoukset-luettelossa/kuhakoski/',
    name: 'Kuhakoski',
    parkTypeSlug: 'cultural-history-area',
    postalCode: null,
    postalOffice: 'Nurmijärvi',
    responseShapeVersion: 'manual-nurmijarvi-map-point-proxy-v1',
    slug: 'kuhakoski',
    sourceUrl: 'special://kuhakoski',
    syntheticLipasId: 9_001_076
  },
  {
    displayTypeName: null,
    locationLabel: 'Hiidenkirnujentie',
    parkUrl: null,
    name: 'Askolan hiidenkirnut',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '07530',
    postalOffice: 'Askola',
    responseShapeVersion: 'manual-askola-user-guided-proxy-v1',
    slug: 'askolan-hiidenkirnut',
    sourceUrl: 'special://askolan-hiidenkirnut',
    syntheticLipasId: 9_002_039
  },
  {
    displayTypeName: null,
    locationLabel: 'Vallisaari',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/vallisaari',
    name: 'Vallisaari',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'manual-mml-landwaterboundary-v1',
    slug: 'vallisaari',
    sourceUrl: 'special://vallisaari',
    syntheticLipasId: 9_001_035
  },
  {
    displayTypeName: null,
    locationLabel: 'Hailuoto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/hailuoto',
    name: 'Hailuoto',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'museovirasto-rky-areas-v1',
    slug: 'hailuoto',
    sourceParser: 'geojson',
    sourceUrl: buildMuseovirastoRkyAreaSourceUrl({
      sourceName: 'Hailuoto'
    }),
    syntheticLipasId: 9_001_036
  },
  {
    displayTypeName: null,
    extractMetadata: extractGeoJsonAreaM2Metadata,
    locationLabel: 'Rokokallio',
    parkUrl: null,
    name: 'Rokokallio',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '03790',
    postalOffice: 'Vihti',
    responseShapeVersion: 'syke-geological-rock-areas-v1',
    slug: 'rokokallio',
    sourceParser: 'geojson',
    sourceUrl: buildSykeGeologicalRockAreaSourceUrl('Rokokallio'),
    syntheticLipasId: 9_001_080
  },
  {
    displayTypeName: null,
    locationLabel: 'Loppula',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/sanginjoki',
    name: 'Sanginjoki',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-composite-v1',
    slug: 'sanginjoki',
    sourceUrl: buildSykePrivateProtectedSitesCompositeSourceUrl([
      'Asmonkorven luonnonsuojelualue',
      'Isokankaan luonnonsuojelualue'
    ]),
    syntheticLipasId: 9_001_041
  }
];
