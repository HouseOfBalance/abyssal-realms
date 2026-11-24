import type { IWorldEventSystem } from '../../contracts/types';
import { computeRiftTierLabel, WorldEventSystem } from './WorldEventSystem';
import {
  aggregateObeliskPactBonuses,
  OBELISK_PACT_CARDS,
  rollThreeObeliskChoices,
} from './obeliskPacts';

export {
  WorldEventSystem,
  OBELISK_PACT_CARDS,
  rollThreeObeliskChoices,
  aggregateObeliskPactBonuses,
  computeRiftTierLabel,
};

export function createWorldEventSystem(): IWorldEventSystem {
  return new WorldEventSystem();
}
