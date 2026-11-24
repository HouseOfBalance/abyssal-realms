import type { IHazardSystem } from '../../contracts/types';
import { HazardSystem } from './HazardSystem';

export { HazardSystem };

export function createHazardSystem(): IHazardSystem {
  return new HazardSystem();
}
