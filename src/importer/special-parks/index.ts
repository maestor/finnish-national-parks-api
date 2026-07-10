import {
  createLuontoonDestinationAreaConfig,
  createMuseovirastoRkyAreaConfig,
  createMuseovirastoSpecialParkConfig,
  createSykeSpecialParkConfig
} from './builders.js';
import { baseSpecialParkConfigs } from './direct-configs.js';
import { sourceReadyLuontoonDestinationAreaSeeds } from './seeds/luontoon-destination-areas.js';
import {
  sourceReadyFactoryVillageProtectedSiteSeeds,
  sourceReadyHistoryAreaSeeds
} from './seeds/museovirasto-protected-sites.js';
import {
  sourceReadyFactoryVillageSeeds,
  sourceReadyHistoryRkyAreaSeeds
} from './seeds/museovirasto-rky-areas.js';
import {
  sourceReadyDestinationAreaSeeds,
  sourceReadyReserveParkSeeds
} from './seeds/syke-protected-sites.js';

export const specialParkConfigs = [
  ...baseSpecialParkConfigs,
  ...sourceReadyReserveParkSeeds.map(createSykeSpecialParkConfig),
  ...sourceReadyDestinationAreaSeeds.map(createSykeSpecialParkConfig),
  ...sourceReadyLuontoonDestinationAreaSeeds.map(createLuontoonDestinationAreaConfig),
  ...sourceReadyHistoryAreaSeeds.map(createMuseovirastoSpecialParkConfig),
  ...sourceReadyHistoryRkyAreaSeeds.map(createMuseovirastoRkyAreaConfig),
  ...sourceReadyFactoryVillageProtectedSiteSeeds.map(createMuseovirastoSpecialParkConfig),
  ...sourceReadyFactoryVillageSeeds.map(createMuseovirastoRkyAreaConfig)
];
