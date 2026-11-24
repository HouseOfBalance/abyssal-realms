import type { ICombatMasterySystem } from '../../contracts/types';
import { CombatMasterySystem } from './CombatMasterySystem';

export { CombatMasterySystem };

export function createCombatMasterySystem(): ICombatMasterySystem {
  return new CombatMasterySystem();
}
