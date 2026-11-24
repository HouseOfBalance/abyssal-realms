import type { IRunewordSystem } from '../../contracts/types';
import { RunewordSystem } from './RunewordSystem';

export { RunewordSystem };
export {
  ALL_RUNE_IDS,
  BLOOD_ALTAR_BOONS,
  ITEM_SETS,
  MAX_SOCKETS_BY_SLOT,
  RUNEWORD_RECIPES,
  RUNE_DEFINITIONS,
} from './runeData';

export function createRunewordSystem(): IRunewordSystem {
  return new RunewordSystem();
}
