import type {
  EquipSlot,
  HeroClassId,
  ItemAffix,
  ItemInstance,
  ItemRarity,
} from '../../contracts/types';
import { SeededRng, clamp } from '../../core/Constants';
import {
  AFFIX_POOL,
  ALL_EQUIP_SLOTS,
  BASE_ITEM_ARCHETYPES,
  EPIC_TITLES,
  MYTHIC_GOLD_MULTIPLIER,
  MYTHIC_PRIMAL_TEMPLATES,
  MYTHIC_STAT_MULTIPLIER,
  MYTHIC_UPGRADE_COST_FACTOR,
  NAMED_LEGENDARIES,
  RARITY_AFFIX_COUNT,
  RARITY_GOLD_MULTIPLIER,
  RARITY_STAT_MULTIPLIER,
  RARITY_UPGRADE_COST_FACTOR,
  SLOT_ICONS,
  STARTER_LOADOUTS,
  WEAPON_VISUAL_ICONS,
  type AffixTemplate,
  type BaseItemArchetype,
  type StatKey,
} from './itemTables';

export const MAX_UPGRADE_LEVEL = 10;
export const UPGRADE_AFFIX_BONUS_PER_LEVEL = 0.12;

const PERCENT_STAT_CAPS: Partial<Record<StatKey, number>> = {
  critChance: 0.22,
  critMultiplier: 0.85,
  attackSpeed: 0.45,
  cooldownReduction: 0.25,
  lifeSteal: 0.14,
  dodgeChance: 0.2,
};

const DECIMAL_FLAT_STATS = new Set<StatKey>([
  'hpRegen',
  'manaRegen',
  'staminaRegen',
  'moveSpeed',
]);

function getMaterialTierPrefix(itemLevel: number, slot: EquipSlot): string {
  const isClothOrFocus = slot === 'amulet' || slot === 'ring';
  if (isClothOrFocus) {
    if (itemLevel <= 3) return 'Silver';
    if (itemLevel <= 6) return 'Gilded';
    if (itemLevel <= 9) return 'Runic';
    return 'Astral';
  }
  if (itemLevel <= 3) return 'Iron';
  if (itemLevel <= 6) return 'Steel';
  if (itemLevel <= 9) return 'Obsidian';
  return 'Voidforged';
}

function formatBaseAffixValue(raw: number, statKey: StatKey, isPercent?: boolean): number {
  if (isPercent) {
    const cap = PERCENT_STAT_CAPS[statKey] ?? 0.5;
    return Number(clamp(raw, 0.005, cap).toFixed(4));
  }
  if (DECIMAL_FLAT_STATS.has(statKey)) {
    const maxFlat = statKey === 'moveSpeed' ? 1.8 : 50;
    return Number(clamp(raw, 0.1, maxFlat).toFixed(2));
  }
  return Math.max(1, Math.round(raw));
}

function formatUpgradedAffixValue(
  baseVal: number,
  upgradeLevel: number,
  statKey: StatKey,
  isPercent?: boolean,
): number {
  const mult = 1 + UPGRADE_AFFIX_BONUS_PER_LEVEL * upgradeLevel;
  const scaled = baseVal * mult;
  if (isPercent) {
    const cap = (PERCENT_STAT_CAPS[statKey] ?? 0.5) * 2.2;
    return Number(clamp(scaled, 0.005, cap).toFixed(4));
  }
  return Number(Math.max(0.1, scaled).toFixed(2));
}

export class ItemGenerator {
  private rng: SeededRng;
  private idCounter = 0;
  private baseAffixSnapshot = new Map<string, number[]>();
  private baseGoldSnapshot = new Map<string, number>();

  constructor(seed = Date.now() ^ 0x9e3779b9) {
    this.rng = new SeededRng(seed);
  }

  private nextId(prefix = 'itm'): string {
    this.idCounter += 1;
    const salt = Math.floor(this.rng.next() * 0xffffff)
      .toString(16)
      .padStart(6, '0');
    return `${prefix}_${this.idCounter}_${salt}`;
  }

  public rollRarity(itemLevel: number, tierBonus = 0, minRarity?: ItemRarity): ItemRarity {
    const clampedLvl = clamp(itemLevel, 1, 30);
    const luck = (clampedLvl - 1) * 1.15 + tierBonus * 6.5;

    const weights: Record<ItemRarity, number> = {
      common: Math.max(8, 48 - luck * 1.4),
      uncommon: Math.max(15, 30 - luck * 0.35),
      rare: 14 + luck * 0.85,
      epic: 6 + luck * 0.55,
      legendary: 2 + luck * 0.28,
    };

    const order: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const minIdx = minRarity ? order.indexOf(minRarity) : 0;

    let total = 0;
    for (let i = minIdx; i < order.length; i++) {
      total += weights[order[i]];
    }

    let roll = this.rng.next() * total;
    for (let i = minIdx; i < order.length; i++) {
      const r = order[i];
      roll -= weights[r];
      if (roll <= 0) return r;
    }
    return order[order.length - 1];
  }

  public generateItem(
    itemLevel: number,
    forcedRarity?: ItemRarity,
    forcedSlot?: EquipSlot,
  ): ItemInstance {
    const safeItemLevel = Math.max(1, Math.round(Number.isFinite(itemLevel) ? itemLevel : 1));
    const rarity: ItemRarity = forcedRarity ?? this.rollRarity(safeItemLevel, 0);
    const slot: EquipSlot = forcedSlot ?? this.rng.pick(ALL_EQUIP_SLOTS);
    const levelReq = Math.max(1, Math.min(20, safeItemLevel <= 2 ? 1 : safeItemLevel - 1));

    if (rarity === 'legendary') {
      return this.generateNamedLegendary(safeItemLevel, levelReq, forcedSlot);
    }

    const candidates = BASE_ITEM_ARCHETYPES.filter((b) => b.slot === slot);
    const base: BaseItemArchetype =
      candidates.length > 0 ? this.rng.pick(candidates) : BASE_ITEM_ARCHETYPES[0];

    const targetAffixCount = RARITY_AFFIX_COUNT[rarity];
    const rarityMult = RARITY_STAT_MULTIPLIER[rarity];

    const usedStats = new Set<StatKey>();
    const chosenTemplates: AffixTemplate[] = [];

    // 1. Primary implicit-aligned affix so weapons always roll offense and armor rolls defense/utility
    const primaryKey = base.implicitPool[0];
    const primaryMatches = AFFIX_POOL.filter(
      (a) => a.statKey === primaryKey && a.allowedSlots.includes(slot),
    );
    const fallbackMatches = AFFIX_POOL.filter((a) => a.allowedSlots.includes(slot));
    const firstTemplate =
      primaryMatches.length > 0 ? this.rng.pick(primaryMatches) : this.rng.pick(fallbackMatches);

    chosenTemplates.push(firstTemplate);
    usedStats.add(firstTemplate.statKey);

    // 2. Roll additional distinct prefixes & suffixes up to targetAffixCount
    let chosenPrefix: AffixTemplate | null =
      firstTemplate.kind === 'prefix' ? firstTemplate : null;
    let chosenSuffix: AffixTemplate | null =
      firstTemplate.kind === 'suffix' ? firstTemplate : null;

    while (chosenTemplates.length < targetAffixCount) {
      const preferKind: 'prefix' | 'suffix' | null =
        !chosenPrefix ? 'prefix' : !chosenSuffix ? 'suffix' : null;

      let pool = AFFIX_POOL.filter(
        (a) =>
          a.allowedSlots.includes(slot) &&
          !usedStats.has(a.statKey) &&
          (preferKind === null || a.kind === preferKind),
      );
      if (pool.length === 0) {
        pool = AFFIX_POOL.filter(
          (a) => a.allowedSlots.includes(slot) && !usedStats.has(a.statKey),
        );
      }
      if (pool.length === 0) break;

      const picked = this.rng.pick(pool);
      chosenTemplates.push(picked);
      usedStats.add(picked.statKey);
      if (picked.kind === 'prefix' && !chosenPrefix) chosenPrefix = picked;
      if (picked.kind === 'suffix' && !chosenSuffix) chosenSuffix = picked;
    }

    const affixes: ItemAffix[] = chosenTemplates.map((tpl, index) => {
      const rollBase = this.rng.range(tpl.baseMin, tpl.baseMax);
      const levelMult = 1 + (safeItemLevel - 1) * tpl.levelGrowth;
      // Primary slot stat gets a slight 1.15x emphasis on weapons/chest
      const slotPrimaryBoost =
        index === 0 && (slot === 'weapon' || slot === 'chest') ? 1.15 : 1.0;
      const raw = rollBase * levelMult * rarityMult * slotPrimaryBoost;
      const value = formatBaseAffixValue(raw, tpl.statKey, tpl.isPercent);

      const affix: ItemAffix = {
        label: tpl.label,
        statKey: tpl.statKey,
        value,
      };
      if (tpl.isPercent) {
        affix.isPercent = true;
      }
      return affix;
    });

    const name = this.composeProceduralName(
      rarity,
      safeItemLevel,
      base,
      chosenPrefix,
      chosenSuffix,
    );
    const goldValue = this.computeGoldValue(safeItemLevel, rarity);
    const id = this.nextId('itm');

    const instance: ItemInstance = {
      id,
      name,
      slot: base.slot,
      rarity,
      levelReq,
      itemLevel: safeItemLevel,
      upgradeLevel: 0,
      ...(base.weaponVisual ? { weaponVisual: base.weaponVisual } : {}),
      affixes,
      goldValue,
      icon: base.weaponVisual ? WEAPON_VISUAL_ICONS[base.weaponVisual] : base.icon || SLOT_ICONS[slot],
    };

    this.registerSnapshot(instance);
    return instance;
  }

  private generateNamedLegendary(
    itemLevel: number,
    levelReq: number,
    forcedSlot?: EquipSlot,
  ): ItemInstance {
    const matching = forcedSlot
      ? NAMED_LEGENDARIES.filter((l) => l.slot === forcedSlot)
      : NAMED_LEGENDARIES;
    const template = this.rng.pick(matching.length > 0 ? matching : NAMED_LEGENDARIES);
    const rarityMult = RARITY_STAT_MULTIPLIER.legendary;

    const affixes: ItemAffix[] = template.fixedStats.map((stat) => {
      const variance = this.rng.range(0.96, 1.06);
      const levelMult = 1 + (itemLevel - 1) * stat.levelGrowth;
      // Legendary base values already reflect iconic base budgets; apply smooth level & variance scaling
      const raw = stat.baseValue * levelMult * (rarityMult / 2.0) * variance;
      const value = formatBaseAffixValue(raw, stat.statKey, stat.isPercent);
      const affix: ItemAffix = {
        label: stat.label,
        statKey: stat.statKey,
        value,
      };
      if (stat.isPercent) {
        affix.isPercent = true;
      }
      return affix;
    });

    const goldValue = this.computeGoldValue(itemLevel, 'legendary');
    const id = this.nextId('leg');

    const instance: ItemInstance = {
      id,
      name: template.name,
      slot: template.slot,
      rarity: 'legendary',
      levelReq,
      itemLevel,
      upgradeLevel: 0,
      ...(template.weaponVisual ? { weaponVisual: template.weaponVisual } : {}),
      affixes,
      legendaryPower: {
        id: template.legendaryPower.id,
        description: template.legendaryPower.description,
      },
      goldValue,
      icon: template.weaponVisual
        ? WEAPON_VISUAL_ICONS[template.weaponVisual]
        : template.icon,
    };

    this.registerSnapshot(instance);
    return instance;
  }

  /**
   * Generates a Mythic Primal Crimson item (`isMythic: true`, `rarity: 'legendary'`)
   * with 6 primal-boosted affixes, pre-forged rune sockets, and an exalted legendaryPower.
   */
  public generateMythicItem(itemLevel: number, forcedSlot?: EquipSlot): ItemInstance {
    const safeItemLevel = Math.max(1, Math.round(Number.isFinite(itemLevel) ? itemLevel : 1));
    const levelReq = Math.max(1, Math.min(25, safeItemLevel <= 2 ? 1 : safeItemLevel - 1));

    const matching = forcedSlot
      ? MYTHIC_PRIMAL_TEMPLATES.filter((m) => m.slot === forcedSlot)
      : MYTHIC_PRIMAL_TEMPLATES;
    const template = this.rng.pick(matching.length > 0 ? matching : MYTHIC_PRIMAL_TEMPLATES);

    const affixes: ItemAffix[] = template.fixedStats.map((stat) => {
      // Primal items roll near-perfect / boosted high-end values (1.02..1.08)
      const primalRoll = this.rng.range(1.02, 1.08);
      const levelMult = 1 + (safeItemLevel - 1) * stat.levelGrowth;
      const raw = stat.baseValue * levelMult * (MYTHIC_STAT_MULTIPLIER / 2.0) * primalRoll;
      const value = formatBaseAffixValue(raw, stat.statKey, stat.isPercent);
      const affix: ItemAffix = {
        label: stat.label,
        statKey: stat.statKey,
        value,
      };
      if (stat.isPercent) {
        affix.isPercent = true;
      }
      return affix;
    });

    const baseGold = 24 + safeItemLevel * 12;
    const goldValue = Math.max(50, Math.round(baseGold * MYTHIC_GOLD_MULTIPLIER));
    const id = this.nextId('mythic');

    const instance: ItemInstance = {
      id,
      name: template.name,
      slot: template.slot,
      rarity: 'legendary',
      isMythic: true,
      levelReq,
      itemLevel: safeItemLevel,
      upgradeLevel: 0,
      ...(template.weaponVisual ? { weaponVisual: template.weaponVisual } : {}),
      affixes,
      legendaryPower: {
        id: template.legendaryPower.id,
        description: template.legendaryPower.description,
      },
      sockets: template.sockets,
      socketedRunes: [],
      goldValue,
      icon: template.weaponVisual
        ? WEAPON_VISUAL_ICONS[template.weaponVisual]
        : template.icon,
    };

    this.registerSnapshot(instance);
    return instance;
  }

  private composeProceduralName(
    rarity: ItemRarity,
    itemLevel: number,
    base: BaseItemArchetype,
    prefix: AffixTemplate | null,
    suffix: AffixTemplate | null,
  ): string {
    const mat = getMaterialTierPrefix(itemLevel, base.slot);
    switch (rarity) {
      case 'common':
        return `${mat} ${base.name}`;
      case 'uncommon':
        if (prefix) return `${prefix.nameToken} ${mat} ${base.name}`;
        if (suffix) return `${mat} ${base.name} ${suffix.nameToken}`;
        return `Refined ${mat} ${base.name}`;
      case 'rare': {
        const p = prefix ? `${prefix.nameToken} ` : 'Runed ';
        const s = suffix ? ` ${suffix.nameToken}` : ' of Might';
        return `${p}${base.name}${s}`;
      }
      case 'epic': {
        const title = this.rng.pick(EPIC_TITLES);
        const s = suffix ? ` ${suffix.nameToken}` : ' of the Abyss';
        return `${title} ${base.name}${s}`;
      }
      default:
        return base.name;
    }
  }

  public computeGoldValue(itemLevel: number, rarity: ItemRarity): number {
    const base = 24 + itemLevel * 12;
    return Math.max(10, Math.round(base * RARITY_GOLD_MULTIPLIER[rarity]));
  }

  public computeUpgradeCost(item: ItemInstance): number {
    const factor = item.isMythic
      ? MYTHIC_UPGRADE_COST_FACTOR
      : RARITY_UPGRADE_COST_FACTOR[item.rarity] ?? 1.0;
    const stepMult = Math.pow(1.35, clamp(item.upgradeLevel, 0, MAX_UPGRADE_LEVEL));
    return Math.max(15, Math.round((25 + item.itemLevel * 10) * factor * stepMult));
  }

  public upgradeItemInPlace(item: ItemInstance): number {
    if (item.upgradeLevel >= MAX_UPGRADE_LEVEL) {
      return item.upgradeLevel;
    }

    const oldLevel = Math.max(0, item.upgradeLevel);
    const oldMult = 1 + UPGRADE_AFFIX_BONUS_PER_LEVEL * oldLevel;

    let baseAffixes = this.baseAffixSnapshot.get(item.id);
    if (!baseAffixes || baseAffixes.length !== item.affixes.length) {
      baseAffixes = item.affixes.map((a) => a.value / oldMult);
      this.baseAffixSnapshot.set(item.id, baseAffixes);
    }

    let baseGold = this.baseGoldSnapshot.get(item.id);
    if (baseGold === undefined) {
      baseGold = item.goldValue / (1 + 0.15 * oldLevel);
      this.baseGoldSnapshot.set(item.id, baseGold);
    }

    const newLevel = oldLevel + 1;
    item.upgradeLevel = newLevel;

    for (let i = 0; i < item.affixes.length; i++) {
      const affix = item.affixes[i];
      affix.value = formatUpgradedAffixValue(
        baseAffixes[i],
        newLevel,
        affix.statKey,
        affix.isPercent,
      );
    }

    item.goldValue = Math.max(5, Math.round(baseGold * (1 + 0.15 * newLevel)));
    return newLevel;
  }

  public createStarterGear(heroClass: HeroClassId): Partial<Record<EquipSlot, ItemInstance>> {
    const spec = STARTER_LOADOUTS[heroClass] ?? STARTER_LOADOUTS.vanguard;

    const weapon: ItemInstance = {
      id: this.nextId('starter_wpn'),
      name: spec.weaponName,
      slot: 'weapon',
      rarity: 'common',
      levelReq: 1,
      itemLevel: 1,
      upgradeLevel: 0,
      weaponVisual: spec.weaponVisual,
      affixes: [
        {
          label: spec.weaponStat.label,
          statKey: spec.weaponStat.statKey,
          value: spec.weaponStat.value,
        },
      ],
      goldValue: 12,
      icon: WEAPON_VISUAL_ICONS[spec.weaponVisual],
    };

    const chest: ItemInstance = {
      id: this.nextId('starter_chst'),
      name: spec.chestName,
      slot: 'chest',
      rarity: 'common',
      levelReq: 1,
      itemLevel: 1,
      upgradeLevel: 0,
      affixes: [
        { label: 'Armor', statKey: 'armor', value: 8 },
        {
          label: spec.chestSecondary.label,
          statKey: spec.chestSecondary.statKey,
          value: spec.chestSecondary.value,
        },
      ],
      goldValue: 10,
      icon: SLOT_ICONS.chest,
    };

    const boots: ItemInstance = {
      id: this.nextId('starter_bts'),
      name: spec.bootsName,
      slot: 'boots',
      rarity: 'common',
      levelReq: 1,
      itemLevel: 1,
      upgradeLevel: 0,
      affixes: [
        { label: 'Armor', statKey: 'armor', value: 4 },
        { label: 'Movement Speed', statKey: 'moveSpeed', value: 0.25 },
      ],
      goldValue: 8,
      icon: SLOT_ICONS.boots,
    };

    this.registerSnapshot(weapon);
    this.registerSnapshot(chest);
    this.registerSnapshot(boots);

    return {
      weapon,
      chest,
      boots,
    };
  }

  public registerSnapshot(item: ItemInstance): void {
    const mult = 1 + UPGRADE_AFFIX_BONUS_PER_LEVEL * Math.max(0, item.upgradeLevel);
    this.baseAffixSnapshot.set(
      item.id,
      item.affixes.map((a) => a.value / mult),
    );
    this.baseGoldSnapshot.set(
      item.id,
      item.goldValue / (1 + 0.15 * Math.max(0, item.upgradeLevel)),
    );
  }

  public clearSnapshots(): void {
    this.baseAffixSnapshot.clear();
    this.baseGoldSnapshot.clear();
  }
}
