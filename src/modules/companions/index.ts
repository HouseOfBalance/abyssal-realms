import type { ICompanionSystem } from '../../contracts/types';
import { CompanionSystem } from './CompanionSystem';

export { CompanionSystem };
export {
  ALL_MERCENARY_IDS,
  ALL_PET_IDS,
  COMPANION_LEASH_TELEPORT_DIST,
  MERCENARY_AUTO_REVIVE_SEC,
  MERCENARY_DEFINITIONS,
  PET_AUTO_PICKUP_RADIUS,
  PET_DEFINITIONS,
} from './companionData';

export function createCompanionSystem(): ICompanionSystem {
  return new CompanionSystem();
}
