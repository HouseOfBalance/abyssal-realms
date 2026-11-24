import type {
  Attributes,
  BloodAltarBoon,
  DerivedStats,
  EnemyEntity,
  EquipSlot,
  ILootSystem,
  IRunewordSystem,
  ItemAffix,
  ItemInstance,
  ItemRarity,
  ItemSetDefinition,
  PlayerRuntimeState,
  RuneDefinition,
  RuneId,
  RunewordDefinition,
} from '../../contracts/types';
import { MYTHIC_COLOR, SeededRng, clamp } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  ALL_RUNE_IDS,
  BLOOD_ALTAR_BOONS,
  ITEM_SETS,
  ITEM_SET_MAP,
  MAX_SOCKETS_BY_SLOT,
  PRIMAL_MYTHIC_POWERS,
  RUNES_BY_TIER,
  RUNEWORD_RECIPES,
  RUNEWORD_RECIPE_MAP,
  RUNE_DEFINITIONS,
  RUNE_DEFINITION_MAP,
} from './runeData';

const ATTRIBUTE_KEYS = new Set<keyof Attributes>([
  'strength',
  'dexterity',
  'intelligence',
  'vitality',
]);

const CANONICAL_SLOTS: readonly EquipSlot[] = [
  'weapon',
  'offhand',
  'helmet',
  'chest',
  'gloves',
  'boots',
  'ring',
  'amulet',
] as const;

const PRIMARY_SOCKET_SLOTS = new Set<EquipSlot>(['weapon', 'chest', 'helmet', 'offhand']);

const MAX_INVENTORY_CAPACITY = 40;

function cloneAffix(affix: ItemAffix): ItemAffix {
  return {
    label: affix.label,
    statKey: affix.statKey,
    value: affix.value,
    ...(affix.isPercent !== undefined ? { isPercent: affix.isPercent } : {}),
  };
}

function cloneRuneDef(def: RuneDefinition): RuneDefinition {
  return {
    id: def.id,
    name: def.name,
    tier: def.tier,
    colorHex: def.colorHex,
    icon: def.icon,
    statBonus: cloneAffix(def.statBonus),
  };
}

function cloneRunewordDef(def: RunewordDefinition): RunewordDefinition {
  return {
    id: def.id,
    name: def.name,
    allowedSlots: [...def.allowedSlots],
    pattern: [...def.pattern],
    bonusAffixes: def.bonusAffixes.map(cloneAffix),
    mythicPower: def.mythicPower,
  };
}

function cloneItemSetDef(def: ItemSetDefinition): ItemSetDefinition {
  return {
    id: def.id,
    name: def.name,
    heroClass: def.heroClass,
    twoPieceBonus: {
      description: def.twoPieceBonus.description,
      stats: { ...def.twoPieceBonus.stats },
    },
    fourPieceBonus: {
      description: def.fourPieceBonus.description,
      stats: { ...def.fourPieceBonus.stats },
      specialEffect: def.fourPieceBonus.specialEffect,
    },
  };
}

function cloneBloodBoon(boon: BloodAltarBoon): BloodAltarBoon {
  return {
    id: boon.id,
    name: boon.name,
    hpSacrificePercent: boon.hpSacrificePercent,
    description: boon.description,
    statsBonus: { ...boon.statsBonus },
  };
}

function createEmptyRuneLedger(): Record<RuneId, number> {
  return {
    sol: 0,
    vex: 0,
    jah: 0,
    ohm: 0,
    ber: 0,
    zod: 0,
    ist: 0,
    mal: 0,
    gul: 0,
    sur: 0,
    lo: 0,
    cham: 0,
  };
}

export class RunewordSystem implements IRunewordSystem {
  private rng: SeededRng;
  private ownedRunes: Record<RuneId, number>;
  private activeBloodBoons: BloodAltarBoon[] = [];

  constructor(seed = Date.now() ^ 0x6a09e667) {
    this.rng = new SeededRng(seed);
    this.ownedRunes = createEmptyRuneLedger();
  }

  public getRuneDefinitions(): RuneDefinition[] {
    return RUNE_DEFINITIONS.map(cloneRuneDef);
  }

  public getRunewordRecipes(): RunewordDefinition[] {
    return RUNEWORD_RECIPES.map(cloneRunewordDef);
  }

  public getItemSets(): ItemSetDefinition[] {
    return ITEM_SETS.map(cloneItemSetDef);
  }

  public getOwnedRunes(): Record<RuneId, number> {
    return { ...this.ownedRunes };
  }

  public grantRune(runeId: RuneId, count = 1): void {
    if (!RUNE_DEFINITION_MAP.has(runeId)) {
      return;
    }
    const safeCount = Number.isFinite(count) ? Math.floor(count) : 0;
    if (safeCount <= 0) {
      return;
    }
    this.ownedRunes[runeId] = (this.ownedRunes[runeId] ?? 0) + safeCount;
  }

  public rollEnemyRuneDrop(enemy: EnemyEntity, floorNumber: number): RuneId | null {
    if (!enemy) {
      return null;
    }

    const safeFloor = clamp(
      Math.floor(Number.isFinite(floorNumber) ? floorNumber : 1),
      1,
      20,
    );
    const tierBonus = Number.isFinite(enemy.lootTierBonus)
      ? Math.max(0, enemy.lootTierBonus)
      : 0;

    let dropChance: number;
    let tierShift: number;

    if (enemy.archetype === 'the_butcher') {
      dropChance = 1.0;
      tierShift = 3.2;
    } else if (enemy.archetype === 'treasure_goblin') {
      dropChance = 0.92;
      tierShift = 2.6;
    } else if (enemy.isBoss) {
      dropChance = clamp(0.85 + safeFloor * 0.02, 0.85, 0.98);
      tierShift = 2.3;
    } else if (enemy.archetype === 'chest_mimic') {
      dropChance = 0.58;
      tierShift = 1.6;
    } else if (enemy.isElite) {
      dropChance = clamp(0.3 + safeFloor * 0.025 + tierBonus * 0.02, 0.3, 0.6);
      tierShift = 1.15;
    } else {
      dropChance = clamp(0.05 + (safeFloor - 1) * 0.012 + tierBonus * 0.01, 0.04, 0.16);
      tierShift = 0;
    }

    if (!this.rng.chance(dropChance)) {
      return null;
    }

    const progression = (safeFloor - 1) * 0.9 + tierShift * 1.65;
    const weightT1 = Math.max(8, 72 - progression * 9.5);
    const weightT2 = 24 + progression * 6.5;
    const weightT3 = Math.max(3, 4 + progression * 5.4);
    const totalWeight = weightT1 + weightT2 + weightT3;

    let roll = this.rng.next() * totalWeight;
    let chosenTier: 1 | 2 | 3 = 1;
    if (roll < weightT1) {
      chosenTier = 1;
    } else {
      roll -= weightT1;
      chosenTier = roll < weightT2 ? 2 : 3;
    }

    return this.rng.pick(RUNES_BY_TIER[chosenTier]);
  }

  public assignItemSetOrSockets(item: ItemInstance, rngSeed?: number): ItemInstance {
    if (!item) {
      return item;
    }

    const rng = rngSeed !== undefined ? new SeededRng(rngSeed) : this.rng;
    const maxSlotSockets = MAX_SOCKETS_BY_SLOT[item.slot] ?? 1;
    const isPrimarySlot = PRIMARY_SOCKET_SLOTS.has(item.slot);

    // 1. Natural Socket Roll (preserves pre-existing sockets if already assigned)
    if (item.sockets === undefined && maxSlotSockets > 0) {
      const raritySocketBoost: Record<ItemRarity, number> = {
        common: 0.25,
        uncommon: 0.34,
        rare: 0.48,
        epic: 0.62,
        legendary: 0.74,
      };
      const baseChance = raritySocketBoost[item.rarity] ?? 0.3;
      const socketChance = isPrimarySlot ? baseChance : baseChance * 0.45;

      if (rng.chance(socketChance)) {
        const lvl = Math.max(1, item.itemLevel || 1);
        let rolledSockets = 1;
        if (maxSlotSockets >= 4) {
          const r = rng.next() + Math.min(0.24, (lvl - 1) * 0.02);
          if (r > 0.88) rolledSockets = 4;
          else if (r > 0.56) rolledSockets = 3;
          else if (r > 0.24) rolledSockets = 2;
          else rolledSockets = 1;
        } else if (maxSlotSockets === 3) {
          const r = rng.next() + Math.min(0.2, (lvl - 1) * 0.02);
          if (r > 0.72) rolledSockets = 3;
          else if (r > 0.34) rolledSockets = 2;
          else rolledSockets = 1;
        } else if (maxSlotSockets === 2) {
          rolledSockets = rng.chance(0.45) ? 2 : 1;
        }

        item.sockets = clamp(rolledSockets, 1, maxSlotSockets);
        if (!Array.isArray(item.socketedRunes)) {
          item.socketedRunes = [];
        }
      }
    }

    // 2. Class Item Set Roll (Rare / Epic / Legendary non-Mythic items)
    if (
      !item.setId &&
      !item.isMythic &&
      (item.rarity === 'legendary' || item.rarity === 'epic' || item.rarity === 'rare')
    ) {
      const setChance =
        item.rarity === 'legendary' ? 0.45 : item.rarity === 'epic' ? 0.42 : 0.18;

      if (rng.chance(setChance)) {
        const chosenSet = this.pickAppropriateSet(item, rng);
        item.setId = chosenSet.id;
        item.setName = chosenSet.name;
      }
    }

    return item;
  }

  private pickAppropriateSet(item: ItemInstance, rng: SeededRng): ItemSetDefinition {
    if (item.weaponVisual && rng.chance(0.75)) {
      if (
        item.weaponVisual === 'greatsword' ||
        item.weaponVisual === 'warhammer' ||
        item.weaponVisual === 'sword_shield'
      ) {
        return ITEM_SETS[0]; // Battlegear of the Immortal King (Vanguard)
      }
      if (item.weaponVisual === 'daggers') {
        return ITEM_SETS[1]; // Vestments of the Nightstalker (Shadowblade)
      }
      if (item.weaponVisual === 'staff') {
        return ITEM_SETS[2]; // Regalia of the Astral Archon (Arcanist)
      }
    }
    return rng.pick(ITEM_SETS);
  }

  public addSocketToItem(
    item: ItemInstance,
    playerGold: number,
  ): { success: boolean; cost: number; maxSockets: number } {
    if (!item) {
      return { success: false, cost: 0, maxSockets: 0 };
    }

    const maxSockets = MAX_SOCKETS_BY_SLOT[item.slot] ?? 1;
    const currentSockets = Math.max(0, Math.floor(item.sockets ?? 0));

    if (currentSockets >= maxSockets) {
      return { success: false, cost: 0, maxSockets };
    }

    const safeItemLevel = Math.max(
      1,
      Math.floor(Number.isFinite(item.itemLevel) ? item.itemLevel : 1),
    );
    const cost = Math.round((45 + safeItemLevel * 10) * (1 + currentSockets * 0.75));

    if (!Number.isFinite(playerGold) || playerGold < cost) {
      return { success: false, cost, maxSockets };
    }

    item.sockets = currentSockets + 1;
    if (!Array.isArray(item.socketedRunes)) {
      item.socketedRunes = [];
    }

    eventBus.emit('sfx:request', { id: 'ui_equip' });
    return { success: true, cost, maxSockets };
  }

  public socketRuneIntoItem(
    item: ItemInstance,
    runeId: RuneId,
  ): { success: boolean; formedRuneword?: RunewordDefinition } {
    if (!item || !RUNE_DEFINITION_MAP.has(runeId)) {
      return { success: false };
    }

    const ownedCount = this.ownedRunes[runeId] ?? 0;
    if (ownedCount < 1) {
      return { success: false };
    }

    const totalSockets = Math.max(0, Math.floor(item.sockets ?? 0));
    const currentRunes = Array.isArray(item.socketedRunes) ? item.socketedRunes : [];
    if (totalSockets <= 0 || currentRunes.length >= totalSockets) {
      return { success: false };
    }

    this.ownedRunes[runeId] = ownedCount - 1;
    const updatedRunes: RuneId[] = [...currentRunes, runeId];
    item.socketedRunes = updatedRunes;

    const matchedRuneword = this.findMatchingRuneword(item.slot, updatedRunes);
    if (matchedRuneword) {
      item.runewordId = matchedRuneword.id;
      item.runewordName = matchedRuneword.name;

      const forgedCopy = cloneRunewordDef(matchedRuneword);
      eventBus.emit('event:runewordForged', {
        runewordName: matchedRuneword.name,
        item,
      });
      eventBus.emit('sfx:request', { id: 'shrine_bless' });
      eventBus.emit('ui:banner', {
        title: `RUNEWORD FORGED: ${matchedRuneword.name}`,
        subtitle: matchedRuneword.mythicPower,
        tone: 'gold',
      });

      return { success: true, formedRuneword: forgedCopy };
    }

    // If adding an extra rune broke an earlier runeword sequence, clear stale metadata
    if (item.runewordId !== undefined || item.runewordName !== undefined) {
      delete item.runewordId;
      delete item.runewordName;
    }

    eventBus.emit('sfx:request', { id: 'ui_equip' });
    return { success: true };
  }

  public unsocketRunesFromItem(item: ItemInstance): RuneId[] {
    if (!item) {
      return [];
    }

    const removed = Array.isArray(item.socketedRunes) ? [...item.socketedRunes] : [];
    for (const runeId of removed) {
      if (RUNE_DEFINITION_MAP.has(runeId)) {
        this.ownedRunes[runeId] = (this.ownedRunes[runeId] ?? 0) + 1;
      }
    }

    item.socketedRunes = [];
    delete item.runewordId;
    delete item.runewordName;

    if (removed.length > 0) {
      eventBus.emit('sfx:request', { id: 'ui_click' });
    }

    return removed;
  }

  public gambleMysteryItem(
    playerLevel: number,
    playerGold: number,
    loot: ILootSystem,
    slot?: EquipSlot,
  ): { success: boolean; cost: number; item?: ItemInstance } {
    const safeLevel = Math.max(
      1,
      Math.floor(Number.isFinite(playerLevel) ? playerLevel : 1),
    );
    const cost = Math.round((75 + safeLevel * 25) * (slot ? 1.1 : 1.0));

    if (!loot || !Number.isFinite(playerGold) || playerGold < cost) {
      return { success: false, cost };
    }

    const currentInventory = loot.getInventory();
    if (Array.isArray(currentInventory) && currentInventory.length >= MAX_INVENTORY_CAPACITY) {
      return { success: false, cost };
    }

    const itemLevel = Math.max(1, safeLevel + this.rng.int(0, 2));
    const roll = this.rng.next();

    let gambledItem: ItemInstance;
    if (roll < 0.1) {
      // 10% Jackpot: Mythic Primal Crimson item!
      gambledItem = this.createMythicGambledItem(itemLevel, loot, slot);
    } else {
      let rarity: ItemRarity;
      if (roll < 0.25) rarity = 'legendary';
      else if (roll < 0.52) rarity = 'epic';
      else if (roll < 0.85) rarity = 'rare';
      else rarity = 'uncommon';

      gambledItem = loot.generateItem(
        rarity === 'legendary' ? itemLevel + 1 : itemLevel,
        rarity,
        slot,
      );
      this.assignItemSetOrSockets(gambledItem);
    }

    // Add directly to inventory via optional contract helper or direct inventory list fallback
    if (typeof loot.addDirectItemToInventory === 'function') {
      const added = loot.addDirectItemToInventory(gambledItem);
      if (!added) {
        return { success: false, cost };
      }
    } else if (Array.isArray(currentInventory)) {
      if (!currentInventory.some((existing) => existing.id === gambledItem.id)) {
        currentInventory.push(gambledItem);
      }
    }

    if (gambledItem.isMythic) {
      eventBus.emit('sfx:request', { id: 'loot_drop_legendary' });
      eventBus.emit('lighting:flash', {
        colorHex: MYTHIC_COLOR.hex,
        intensity: 1.55,
        durationSec: 0.45,
      });
      eventBus.emit('ui:banner', {
        title: 'MYTHIC PRIMAL GAMBLED!',
        subtitle: gambledItem.name,
        tone: 'crimson',
      });
    } else if (gambledItem.rarity === 'legendary' || gambledItem.rarity === 'epic') {
      eventBus.emit('sfx:request', {
        id: gambledItem.rarity === 'legendary' ? 'loot_drop_legendary' : 'loot_drop_rare',
      });
      eventBus.emit('ui:toast', {
        message: `Black-Market Prize: ${gambledItem.name}`,
        rarity: gambledItem.rarity,
      });
    } else {
      eventBus.emit('sfx:request', { id: 'gold_pickup' });
    }

    return {
      success: true,
      cost,
      item: gambledItem,
    };
  }

  private createMythicGambledItem(
    itemLevel: number,
    loot: ILootSystem,
    slot?: EquipSlot,
  ): ItemInstance {
    let item: ItemInstance;
    if (typeof loot.generateMythicItem === 'function') {
      item = loot.generateMythicItem(itemLevel, slot);
      item.isMythic = true;
      item.rarity = 'legendary';
    } else {
      item = loot.generateItem(itemLevel + 2, 'legendary', slot);
      item.isMythic = true;
      item.rarity = 'legendary';
      if (!item.name.startsWith('Primal ')) {
        item.name = `Primal ${item.name}`;
      }
      item.affixes = item.affixes.map((affix) => {
        const boosted = affix.value * 1.35;
        const formatted = affix.isPercent
          ? Number(boosted.toFixed(4))
          : Number.isInteger(affix.value)
            ? Math.max(1, Math.round(boosted))
            : Number(boosted.toFixed(2));
        return {
          ...affix,
          value: formatted,
        };
      });
      item.goldValue = Math.max(100, Math.round((item.goldValue || 100) * 2.5));
      if (!item.legendaryPower) {
        const power = this.rng.pick(PRIMAL_MYTHIC_POWERS);
        item.legendaryPower = { id: power.id, description: power.description };
      }
    }

    this.assignItemSetOrSockets(item);
    item.isMythic = true;
    return item;
  }

  public activateBloodAltar(
    player: PlayerRuntimeState,
  ): { success: boolean; boon?: BloodAltarBoon } {
    if (!player || !player.alive || !Number.isFinite(player.hp) || player.hp <= 1) {
      return { success: false };
    }

    // Sacrifice 25% of current HP while never reducing a living hero below 1 HP
    const rawSacrifice = Math.round(player.hp * 0.25);
    const hpCost = clamp(Math.max(1, rawSacrifice), 1, Math.max(1, Math.ceil(player.hp) - 1));
    player.hp = Math.max(1, Number((player.hp - hpCost).toFixed(2)));

    const activeIds = new Set(this.activeBloodBoons.map((b) => b.id));
    const unpicked = BLOOD_ALTAR_BOONS.filter((b) => !activeIds.has(b.id));
    const chosenTemplate =
      unpicked.length > 0 ? this.rng.pick(unpicked) : this.rng.pick(BLOOD_ALTAR_BOONS);

    const grantedBoon = cloneBloodBoon(chosenTemplate);
    this.activeBloodBoons.push(grantedBoon);

    if (player.position) {
      eventBus.emit('vfx:request', {
        type: 'blood_burst',
        position: player.position,
        colorHex: MYTHIC_COLOR.hex,
        scale: 1.3,
      });
      eventBus.emit('sfx:request', { id: 'shrine_bless', position: player.position });
    }
    eventBus.emit('ui:banner', {
      title: grantedBoon.name,
      subtitle: grantedBoon.description,
      tone: 'crimson',
    });

    return {
      success: true,
      boon: cloneBloodBoon(grantedBoon),
    };
  }

  public getActiveBloodBoons(): BloodAltarBoon[] {
    return this.activeBloodBoons.map(cloneBloodBoon);
  }

  public clearFloorBoons(): void {
    this.activeBloodBoons = [];
  }

  public computeRunewordAndSetBonuses(
    equipped: Partial<Record<EquipSlot, ItemInstance>>,
  ): {
    attributes: Partial<Attributes>;
    stats: Partial<DerivedStats>;
    activeSets: Array<{ set: ItemSetDefinition; pieces: number }>;
    activeRunewords: string[];
  } {
    const attributes: Partial<Attributes> = {};
    const stats: Partial<DerivedStats> = {};
    const activeRunewords: string[] = [];
    const setPieceCounts = new Map<string, number>();

    const addAffixBonus = (affix: ItemAffix): void => {
      if (!Number.isFinite(affix.value)) return;
      if (ATTRIBUTE_KEYS.has(affix.statKey as keyof Attributes)) {
        const key = affix.statKey as keyof Attributes;
        attributes[key] = Number(((attributes[key] ?? 0) + affix.value).toFixed(2));
      } else {
        const key = affix.statKey as keyof DerivedStats;
        stats[key] = Number(((stats[key] ?? 0) + affix.value).toFixed(4));
      }
    };

    const addDerivedStatsPartial = (partial: Partial<DerivedStats>): void => {
      for (const [rawKey, rawVal] of Object.entries(partial)) {
        if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) continue;
        const key = rawKey as keyof DerivedStats;
        stats[key] = Number(((stats[key] ?? 0) + rawVal).toFixed(4));
      }
    };

    if (equipped && typeof equipped === 'object') {
      for (const slot of CANONICAL_SLOTS) {
        const item = equipped[slot];
        if (!item) continue;

        // 1. Individual socketed Rune bonuses
        if (Array.isArray(item.socketedRunes)) {
          for (const runeId of item.socketedRunes) {
            const runeDef = RUNE_DEFINITION_MAP.get(runeId);
            if (runeDef) {
              addAffixBonus(runeDef.statBonus);
            }
          }
        }

        // 2. Forged Runeword bonus affixes
        const runewordDef = this.resolveItemRuneword(item);
        if (runewordDef) {
          for (const affix of runewordDef.bonusAffixes) {
            addAffixBonus(affix);
          }
          if (!activeRunewords.includes(runewordDef.id)) {
            activeRunewords.push(runewordDef.id);
          }
        }

        // 3. Class Item Set piece tally
        if (item.setId && ITEM_SET_MAP.has(item.setId)) {
          setPieceCounts.set(item.setId, (setPieceCounts.get(item.setId) ?? 0) + 1);
        }
      }
    }

    // 4. Activate 2-piece and 4-piece Set bonuses
    const activeSets: Array<{ set: ItemSetDefinition; pieces: number }> = [];
    for (const setDef of ITEM_SETS) {
      const pieces = setPieceCounts.get(setDef.id) ?? 0;
      if (pieces >= 2) {
        addDerivedStatsPartial(setDef.twoPieceBonus.stats);
        if (pieces >= 4) {
          addDerivedStatsPartial(setDef.fourPieceBonus.stats);
        }
        activeSets.push({
          set: cloneItemSetDef(setDef),
          pieces,
        });
      }
    }

    // 5. Active floor-wide Blood Altar Boons
    for (const boon of this.activeBloodBoons) {
      addDerivedStatsPartial(boon.statsBonus);
    }

    return {
      attributes,
      stats,
      activeSets,
      activeRunewords,
    };
  }

  public serialize(): { runes: Record<RuneId, number> } {
    return {
      runes: { ...this.ownedRunes },
    };
  }

  public deserialize(data?: { runes?: Partial<Record<RuneId, number>> }): void {
    this.ownedRunes = createEmptyRuneLedger();
    if (!data?.runes || typeof data.runes !== 'object') {
      return;
    }

    for (const runeId of ALL_RUNE_IDS) {
      const raw = data.runes[runeId];
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        this.ownedRunes[runeId] = Math.floor(raw);
      }
    }
  }

  private findMatchingRuneword(
    slot: EquipSlot,
    socketedRunes: readonly RuneId[] | undefined,
  ): RunewordDefinition | undefined {
    if (!Array.isArray(socketedRunes) || socketedRunes.length === 0) {
      return undefined;
    }

    for (const recipe of RUNEWORD_RECIPES) {
      if (!recipe.allowedSlots.includes(slot)) continue;
      if (recipe.pattern.length !== socketedRunes.length) continue;

      let exactMatch = true;
      for (let i = 0; i < recipe.pattern.length; i++) {
        if (recipe.pattern[i] !== socketedRunes[i]) {
          exactMatch = false;
          break;
        }
      }
      if (exactMatch) {
        return recipe;
      }
    }
    return undefined;
  }

  private resolveItemRuneword(item: ItemInstance): RunewordDefinition | undefined {
    if (item.runewordId) {
      const byId = RUNEWORD_RECIPE_MAP.get(item.runewordId);
      if (byId) {
        return byId;
      }
    }
    return this.findMatchingRuneword(item.slot, item.socketedRunes);
  }
}
