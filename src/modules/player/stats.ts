import type { Attributes, DerivedStats } from '../../contracts/types';
import { clamp } from '../../core/Constants';

export interface EquipmentStatBonuses {
  attributes: Partial<Attributes>;
  stats: Partial<DerivedStats>;
}

export interface PassiveStatBonuses {
  attributes: Partial<Attributes>;
  stats: Partial<DerivedStats>;
  keystones: string[];
}

function safeNum(val: number | undefined, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

/**
 * Normalizes ratio-based stat bonuses (e.g. critChance, dodgeChance, CDR, lifeSteal)
 * so both 0..1 ratios (0.08) and percentage-point values (8) behave consistently.
 */
function normalizeRatioBonus(val: number | undefined): number {
  const n = safeNum(val, 0);
  return Math.abs(n) > 1.2 ? n / 100 : n;
}

/**
 * Normalizes crit multiplier bonuses so +0.35 and +35 (%) both add +0.35x.
 */
function normalizeCritMultBonus(val: number | undefined): number {
  const n = safeNum(val, 0);
  return Math.abs(n) > 5 ? n / 100 : n;
}

/**
 * Normalizes attack speed bonuses so +0.15 and +15 (%) both add +0.15 speed multiplier.
 */
function normalizeSpeedBonus(val: number | undefined): number {
  const n = safeNum(val, 0);
  return Math.abs(n) > 3 ? n / 100 : n;
}

/**
 * Smooth quadratic ARPG experience curve per level.
 * L1->2: 100 XP, L2->3: 190 XP, L3->4: 310 XP, L4->5: 460 XP, etc.
 */
export function computeXpForNextLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(safeNum(level, 1)));
  const n = safeLevel - 1;
  return Math.round(100 + n * 75 + n * n * 15);
}

/**
 * Combines base attributes with equipment and passive tree attribute bonuses.
 */
export function computeTotalAttributes(
  baseAttributes: Attributes,
  equipAttrs: Partial<Attributes> | undefined,
  passiveAttrs: Partial<Attributes> | undefined,
): Attributes {
  return {
    strength: Math.max(
      1,
      Math.round(
        safeNum(baseAttributes.strength, 10) +
          safeNum(equipAttrs?.strength) +
          safeNum(passiveAttrs?.strength),
      ),
    ),
    dexterity: Math.max(
      1,
      Math.round(
        safeNum(baseAttributes.dexterity, 10) +
          safeNum(equipAttrs?.dexterity) +
          safeNum(passiveAttrs?.dexterity),
      ),
    ),
    intelligence: Math.max(
      1,
      Math.round(
        safeNum(baseAttributes.intelligence, 10) +
          safeNum(equipAttrs?.intelligence) +
          safeNum(passiveAttrs?.intelligence),
      ),
    ),
    vitality: Math.max(
      1,
      Math.round(
        safeNum(baseAttributes.vitality, 10) +
          safeNum(equipAttrs?.vitality) +
          safeNum(passiveAttrs?.vitality),
      ),
    ),
  };
}

/**
 * Full RPG attribute, equipment, passive constellation, and keystone stat derivation.
 *
 * Supported Keystones:
 * - `blood_pact`: +25% Max HP, +20% Attack Power, +8% Life Steal, -25% Max Mana
 * - `elemental_overload`: +35% Spell Power, +30% Mana Regen, +12% Cooldown Reduction, Crit Multiplier capped at 1.25x
 * - `phantom_crit`: +15% Crit Chance, +0.45x Crit Multiplier, +10% Dodge Chance, +10% Move Speed, -20% Armor
 */
export function computeDerivedStats(
  level: number,
  baseAttributes: Attributes,
  equipmentBonuses: EquipmentStatBonuses,
  passiveBonuses: PassiveStatBonuses,
): DerivedStats {
  const safeLevel = Math.max(1, Math.floor(safeNum(level, 1)));
  const lvlIndex = safeLevel - 1;

  const attrs = computeTotalAttributes(
    baseAttributes,
    equipmentBonuses?.attributes,
    passiveBonuses?.attributes,
  );

  const eq = equipmentBonuses?.stats ?? {};
  const ps = passiveBonuses?.stats ?? {};

  let maxHp =
    100 +
    lvlIndex * 18 +
    attrs.vitality * 10 +
    attrs.strength * 2 +
    safeNum(eq.maxHp) +
    safeNum(ps.maxHp);

  let hpRegen =
    1.2 +
    lvlIndex * 0.25 +
    attrs.vitality * 0.18 +
    safeNum(eq.hpRegen) +
    safeNum(ps.hpRegen);

  let maxMana =
    60 +
    lvlIndex * 10 +
    attrs.intelligence * 6 +
    safeNum(eq.maxMana) +
    safeNum(ps.maxMana);

  let manaRegen =
    3.5 +
    lvlIndex * 0.3 +
    attrs.intelligence * 0.32 +
    safeNum(eq.manaRegen) +
    safeNum(ps.manaRegen);

  let maxStamina =
    100 +
    attrs.dexterity * 1.0 +
    attrs.vitality * 0.5 +
    safeNum(eq.maxStamina) +
    safeNum(ps.maxStamina);

  let staminaRegen =
    18 +
    attrs.dexterity * 0.45 +
    attrs.vitality * 0.2 +
    safeNum(eq.staminaRegen) +
    safeNum(ps.staminaRegen);

  let moveSpeed =
    6.2 +
    attrs.dexterity * 0.045 +
    safeNum(eq.moveSpeed) +
    safeNum(ps.moveSpeed);

  let attackPower =
    12 +
    lvlIndex * 3.5 +
    attrs.strength * 2.2 +
    attrs.dexterity * 0.8 +
    safeNum(eq.attackPower) +
    safeNum(ps.attackPower);

  let spellPower =
    12 +
    lvlIndex * 3.5 +
    attrs.intelligence * 2.4 +
    safeNum(eq.spellPower) +
    safeNum(ps.spellPower);

  let armor =
    10 +
    lvlIndex * 3 +
    attrs.strength * 1.6 +
    attrs.vitality * 0.8 +
    safeNum(eq.armor) +
    safeNum(ps.armor);

  let critChance =
    0.05 +
    attrs.dexterity * 0.006 +
    normalizeRatioBonus(eq.critChance) +
    normalizeRatioBonus(ps.critChance);

  let critMultiplier =
    1.5 +
    attrs.strength * 0.005 +
    attrs.dexterity * 0.008 +
    normalizeCritMultBonus(eq.critMultiplier) +
    normalizeCritMultBonus(ps.critMultiplier);

  let attackSpeed =
    1.0 +
    attrs.dexterity * 0.012 +
    normalizeSpeedBonus(eq.attackSpeed) +
    normalizeSpeedBonus(ps.attackSpeed);

  let cooldownReduction =
    attrs.intelligence * 0.003 +
    normalizeRatioBonus(eq.cooldownReduction) +
    normalizeRatioBonus(ps.cooldownReduction);

  let lifeSteal =
    normalizeRatioBonus(eq.lifeSteal) + normalizeRatioBonus(ps.lifeSteal);

  let dodgeChance =
    0.02 +
    attrs.dexterity * 0.005 +
    normalizeRatioBonus(eq.dodgeChance) +
    normalizeRatioBonus(ps.dodgeChance);

  // Apply unique Keystone multiplicative synergies once per keystone id
  const keystones = new Set(passiveBonuses?.keystones ?? []);

  if (keystones.has('blood_pact')) {
    maxHp *= 1.2;
    attackPower *= 1.18;
    lifeSteal += 0.08;
    maxMana *= 0.85;
  }

  if (keystones.has('elemental_overload')) {
    spellPower *= 1.28;
    manaRegen *= 1.25;
    cooldownReduction += 0.1;
  }

  if (keystones.has('phantom_crit')) {
    critChance += 0.12;
    critMultiplier += 0.35;
    dodgeChance += 0.08;
    moveSpeed *= 1.08;
  }

  return {
    maxHp: Math.max(25, Math.round(maxHp)),
    hpRegen: Math.max(0, Math.round(hpRegen * 100) / 100),
    maxMana: Math.max(15, Math.round(maxMana)),
    manaRegen: Math.max(0, Math.round(manaRegen * 100) / 100),
    maxStamina: Math.max(35, Math.round(maxStamina)),
    staminaRegen: Math.max(1, Math.round(staminaRegen * 100) / 100),
    moveSpeed: clamp(Math.round(moveSpeed * 100) / 100, 2.5, 14.0),
    attackPower: Math.max(1, Math.round(attackPower * 10) / 10),
    spellPower: Math.max(1, Math.round(spellPower * 10) / 10),
    armor: Math.max(0, Math.round(armor * 10) / 10),
    critChance: clamp(Math.round(critChance * 10000) / 10000, 0, 0.9),
    critMultiplier: clamp(Math.round(critMultiplier * 1000) / 1000, 1.0, 5.0),
    attackSpeed: clamp(Math.round(attackSpeed * 1000) / 1000, 0.35, 3.5),
    cooldownReduction: clamp(Math.round(cooldownReduction * 10000) / 10000, 0, 0.6),
    lifeSteal: clamp(Math.round(lifeSteal * 10000) / 10000, 0, 0.65),
    dodgeChance: clamp(Math.round(dodgeChance * 10000) / 10000, 0, 0.65),
  };
}
