import type { ILootSystem } from '../../contracts/types';
import { LootSystem } from './LootSystem';

export { LootSystem };
export {
  NAMED_LEGENDARIES,
  MYTHIC_PRIMAL_TEMPLATES,
  ALL_EQUIP_SLOTS,
  ALL_WEAPON_VISUALS,
  ALL_RARITIES,
  ALL_RUNE_IDS,
  RUNE_VISUAL_META,
} from './itemTables';
export { MAX_INVENTORY_SLOTS, MAX_STASH_SLOTS } from './LootSystem';
export { MAX_UPGRADE_LEVEL, UPGRADE_AFFIX_BONUS_PER_LEVEL } from './ItemGenerator';

export function createLootSystem(): ILootSystem {
  return new LootSystem();
}
