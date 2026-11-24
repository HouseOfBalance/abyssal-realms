import type { ICombatEngine } from '../../contracts/types';
import { CombatEngine } from './CombatEngine';

export { CombatEngine };

export function createCombatEngine(): ICombatEngine {
  return new CombatEngine();
}
