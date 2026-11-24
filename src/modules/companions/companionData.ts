import type {
  DamageType,
  DerivedStats,
  MercenaryId,
  PetId,
} from '../../contracts/types';

export const ALL_PET_IDS: readonly PetId[] = [
  'celestial_owl',
  'ember_wyrmling',
  'void_kitsune',
];

export const ALL_MERCENARY_IDS: readonly MercenaryId[] = [
  'iron_templar',
  'sylvan_ranger',
  'storm_arcanist',
];

export const PET_AUTO_PICKUP_RADIUS = 11.0;
export const PET_PICKUP_REACH_DIST = 0.9;
export const COMPANION_LEASH_TELEPORT_DIST = 18.0;
export const MERCENARY_OUT_OF_COMBAT_RADIUS = 12.5;
export const MERCENARY_AUTO_REVIVE_SEC = 5.0;
export const MERCENARY_SPLASH_TICK_SEC = 0.85;

export interface PetDefinition {
  id: PetId;
  name: string;
  title: string;
  orbitRadius: number;
  orbitSpeedRad: number;
  hoverHeight: number;
  dashSpeed: number;
  returnSpeed: number;
  primaryColorHex: number;
  accentColorHex: number;
  auraBonuses: Partial<DerivedStats>;
}

export interface MercenaryDefinition {
  id: MercenaryId;
  name: string;
  role: 'tank' | 'archer' | 'mage';
  baseMaxHp: number;
  hpPerLevel: number;
  armorMitigation: number;
  moveSpeed: number;
  followDist: number;
  followAngleOffsetRad: number;
  aggroRadius: number;
  attackRange: number;
  kiteMinRange: number;
  preferredRange: number;
  baseAttackDamage: number;
  damagePerLevel: number;
  primaryDamageType: DamageType;
  attackCooldownSec: number;
  specialCooldownSec: number;
  primaryColorHex: number;
  accentColorHex: number;
}

export const PET_DEFINITIONS: Record<PetId, PetDefinition> = {
  celestial_owl: {
    id: 'celestial_owl',
    name: 'Aurelia',
    title: 'Astral Parliament Owl',
    orbitRadius: 1.45,
    orbitSpeedRad: 1.55,
    hoverHeight: 1.52,
    dashSpeed: 17.5,
    returnSpeed: 13.5,
    primaryColorHex: 0x4dabf7,
    accentColorHex: 0xffd43b,
    auraBonuses: {
      manaRegen: 3.2,
      cooldownReduction: 0.08,
      spellPower: 10,
      moveSpeed: 0.35,
    },
  },
  ember_wyrmling: {
    id: 'ember_wyrmling',
    name: 'Pyraxis',
    title: 'Cinderforge Wyrmling',
    orbitRadius: 1.5,
    orbitSpeedRad: 1.75,
    hoverHeight: 1.4,
    dashSpeed: 18.2,
    returnSpeed: 14.0,
    primaryColorHex: 0xff6b35,
    accentColorHex: 0xffd43b,
    auraBonuses: {
      attackPower: 12,
      critMultiplier: 0.2,
      hpRegen: 2.5,
      maxStamina: 18,
    },
  },
  void_kitsune: {
    id: 'void_kitsune',
    name: 'Nyxara',
    title: 'Nine-Veil Shadow Kitsune',
    orbitRadius: 1.38,
    orbitSpeedRad: 1.35,
    hoverHeight: 0,
    dashSpeed: 18.8,
    returnSpeed: 14.5,
    primaryColorHex: 0xae3ec9,
    accentColorHex: 0x66d9e8,
    auraBonuses: {
      critChance: 0.07,
      attackSpeed: 0.1,
      dodgeChance: 0.06,
      moveSpeed: 0.55,
      lifeSteal: 0.03,
    },
  },
};

export const MERCENARY_DEFINITIONS: Record<MercenaryId, MercenaryDefinition> = {
  iron_templar: {
    id: 'iron_templar',
    name: 'Sir Garrick, Iron Templar',
    role: 'tank',
    baseMaxHp: 340,
    hpPerLevel: 46,
    armorMitigation: 0.42,
    moveSpeed: 7.0,
    followDist: 2.25,
    followAngleOffsetRad: 2.45,
    aggroRadius: 13.0,
    attackRange: 2.75,
    kiteMinRange: 0,
    preferredRange: 1.75,
    baseAttackDamage: 28,
    damagePerLevel: 5.5,
    primaryDamageType: 'physical',
    attackCooldownSec: 1.05,
    specialCooldownSec: 5.0,
    primaryColorHex: 0xe9ecef,
    accentColorHex: 0xffd43b,
  },
  sylvan_ranger: {
    id: 'sylvan_ranger',
    name: 'Lyra, Sylvan Windrunner',
    role: 'archer',
    baseMaxHp: 235,
    hpPerLevel: 30,
    armorMitigation: 0.22,
    moveSpeed: 7.5,
    followDist: 2.6,
    followAngleOffsetRad: -2.35,
    aggroRadius: 14.5,
    attackRange: 13.5,
    kiteMinRange: 4.4,
    preferredRange: 8.2,
    baseAttackDamage: 24,
    damagePerLevel: 5.0,
    primaryDamageType: 'poison',
    attackCooldownSec: 0.58,
    specialCooldownSec: 4.2,
    primaryColorHex: 0x40c057,
    accentColorHex: 0x96f2d7,
  },
  storm_arcanist: {
    id: 'storm_arcanist',
    name: 'Vaelen, Storm Arcanist',
    role: 'mage',
    baseMaxHp: 215,
    hpPerLevel: 28,
    armorMitigation: 0.2,
    moveSpeed: 7.1,
    followDist: 2.55,
    followAngleOffsetRad: 2.75,
    aggroRadius: 14.0,
    attackRange: 13.0,
    kiteMinRange: 3.8,
    preferredRange: 7.6,
    baseAttackDamage: 27,
    damagePerLevel: 5.8,
    primaryDamageType: 'lightning',
    attackCooldownSec: 0.84,
    specialCooldownSec: 6.2,
    primaryColorHex: 0x339af0,
    accentColorHex: 0xffd43b,
  },
};

export function computeMercenaryMaxHp(mercId: MercenaryId, level: number): number {
  const def = MERCENARY_DEFINITIONS[mercId];
  const safeLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return Math.round(def.baseMaxHp + (safeLevel - 1) * def.hpPerLevel);
}

export function computeMercenaryAttackDamage(mercId: MercenaryId, level: number): number {
  const def = MERCENARY_DEFINITIONS[mercId];
  const safeLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return Math.round(def.baseAttackDamage + (safeLevel - 1) * def.damagePerLevel);
}
