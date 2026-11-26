import {
  createMuseovirastoRkyAreaConfig,
  createMuseovirastoSpecialParkConfig,
  createSykeSpecialParkConfig
} from './builders.js';
import { baseSpecialParkConfigs } from './direct-configs.js';
import { missingTrailParentAreaConfigs } from './seeds/missing-trail-parent-areas.js';
import {
  sourceReadyFactoryVillageProtectedSiteSeeds,
  sourceReadyHistoryAreaSeeds
} from './seeds/museovirasto-protected-sites.js';
import {
  sourceReadyFactoryVillageSeeds,
  sourceReadyHistoryRkyAreaSeeds
} from './seeds/museovirasto-rky-areas.js';
import { openDestinationAreaConfigs } from './seeds/open-destination-areas.js';
import {
  sourceReadyDestinationAreaSeeds,
  sourceReadyReserveParkSeeds
} from './seeds/syke-protected-sites.js';

export const specialParkConfigs = [
  ...baseSpecialParkConfigs,
  ...missingTrailParentAreaConfigs,
  ...sourceReadyReserveParkSeeds.map(createSykeSpecialParkConfig),
  ...sourceReadyDestinationAreaSeeds.map(createSykeSpecialParkConfig),
  ...openDestinationAreaConfigs,
  ...sourceReadyHistoryAreaSeeds.map(createMuseovirastoSpecialParkConfig),
  ...sourceReadyHistoryRkyAreaSeeds.map(createMuseovirastoRkyAreaConfig),
  ...sourceReadyFactoryVillageProtectedSiteSeeds.map(createMuseovirastoSpecialParkConfig),
  ...sourceReadyFactoryVillageSeeds.map(createMuseovirastoRkyAreaConfig)
];
