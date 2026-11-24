import type { DerivedStats, ObeliskPactCard } from '../../contracts/types';
import { SeededRng } from '../../core/Constants';

/**
 * 12 Risk/Reward Roguelike Pact Cards offered by Corrupted Obelisks.
 * Each card pairs a transformative offensive, utility, or fortune blessing
 * with a meaningful curse modifier for high-stakes dungeon run customization.
 */
export const OBELISK_PACT_CARDS: readonly ObeliskPactCard[] = [
  {
    id: 'pact_stormcaller_conduit',
    title: 'Conduit of the Shattered Sky',
    blessingText:
      'Critical strikes unleash arcing Chain Lightning across nearby foes; +18% Crit Chance & +25% Attack Speed.',
    curseText: '-65 Max HP and +20% incoming damage taken.',
    tone: 'arcane',
    statModifiers: {
      critChance: 0.18,
      attackSpeed: 0.25,
      maxHp: -65,
    },
    damageTakenMultiplier: 1.2,
    critChainLightning: true,
  },
  {
    id: 'pact_executioners_gambit',
    title: "Executioner's Glass Fang",
    blessingText: '+150% Critical Strike Multiplier (+1.50) and +28 Attack Power.',
    curseText: '-35 Armor and +30% incoming damage taken.',
    tone: 'crimson',
    statModifiers: {
      critMultiplier: 1.5,
      attackPower: 28,
      armor: -35,
    },
    damageTakenMultiplier: 1.3,
  },
  {
    id: 'pact_avarice_crown',
    title: 'Crown of Insatiable Avarice',
    blessingText: '2.25x Gold Find Multiplier, +1.35 Move Speed, and +12% Dodge Chance.',
    curseText: 'Summons an immediate Elite Ambush and increases damage taken by +22%.',
    tone: 'gold',
    statModifiers: {
      moveSpeed: 1.35,
      dodgeChance: 0.12,
    },
    damageTakenMultiplier: 1.22,
    goldFindMultiplier: 2.25,
    spawnEliteAmbush: true,
  },
  {
    id: 'pact_blood_archon',
    title: 'Covenant of the Blood Archon',
    blessingText: '+18% Life Steal, +38 Attack Power, and +38 Spell Power.',
    curseText: 'Natural HP Regen reduced by -6/s and +25% incoming damage taken.',
    tone: 'crimson',
    statModifiers: {
      lifeSteal: 0.18,
      attackPower: 38,
      spellPower: 38,
      hpRegen: -6,
    },
    damageTakenMultiplier: 1.25,
  },
  {
    id: 'pact_astral_overclock',
    title: 'Chronos Astral Overclock',
    blessingText: '+30% Cooldown Reduction, +45 Spell Power, and +8 Mana Regen/s.',
    curseText: '-80 Max HP and +18% incoming damage taken.',
    tone: 'arcane',
    statModifiers: {
      cooldownReduction: 0.3,
      spellPower: 45,
      manaRegen: 8,
      maxHp: -80,
    },
    damageTakenMultiplier: 1.18,
  },
  {
    id: 'pact_berserker_frenzy',
    title: "Frenzy of the Butcher's Mark",
    blessingText: '+45% Attack Speed, +32 Attack Power, and +1.10 Move Speed.',
    curseText: '-45 Armor and triggers a ferocious Elite Ambush.',
    tone: 'crimson',
    statModifiers: {
      attackSpeed: 0.45,
      attackPower: 32,
      moveSpeed: 1.1,
      armor: -45,
    },
    damageTakenMultiplier: 1.15,
    spawnEliteAmbush: true,
  },
  {
    id: 'pact_gilded_juggernaut',
    title: 'Oath of the Gilded Colossus',
    blessingText: '+180 Max HP, +65 Armor, 12% Less Damage Taken, and 1.6x Gold Find.',
    curseText: '-1.10 Move Speed and -12% Attack Speed.',
    tone: 'gold',
    statModifiers: {
      maxHp: 180,
      armor: 65,
      moveSpeed: -1.1,
      attackSpeed: -0.12,
    },
    damageTakenMultiplier: 0.88,
    goldFindMultiplier: 1.6,
  },
  {
    id: 'pact_phantom_assassin',
    title: 'Veil of the Void Phantom',
    blessingText: '+22% Dodge Chance, +22% Crit Chance, and +85% Crit Multiplier (+0.85).',
    curseText: '-90 Max HP, -25 Armor, and +20% incoming damage taken.',
    tone: 'arcane',
    statModifiers: {
      dodgeChance: 0.22,
      critChance: 0.22,
      critMultiplier: 0.85,
      maxHp: -90,
      armor: -25,
    },
    damageTakenMultiplier: 1.2,
  },
  {
    id: 'pact_midas_bloodprice',
    title: 'Midas Blood-Tithe',
    blessingText: '3.0x Gold Find Multiplier and +75% Crit Multiplier (+0.75).',
    curseText: '+35% incoming damage taken and -40 Max Stamina.',
    tone: 'gold',
    statModifiers: {
      critMultiplier: 0.75,
      maxStamina: -40,
    },
    damageTakenMultiplier: 1.35,
    goldFindMultiplier: 3.0,
  },
  {
    id: 'pact_tempest_archmage',
    title: 'Eye of the Astral Maelstrom',
    blessingText: 'Critical hits trigger Chain Lightning, +55 Spell Power, and +50 Max Mana.',
    curseText: 'Summons a Void Elite Ambush, -20 Armor, and +24% damage taken.',
    tone: 'arcane',
    statModifiers: {
      spellPower: 55,
      maxMana: 50,
      armor: -20,
    },
    damageTakenMultiplier: 1.24,
    critChainLightning: true,
    spawnEliteAmbush: true,
  },
  {
    id: 'pact_reapers_harvest',
    title: "Reaper's Soul Harvest",
    blessingText: '+14% Life Steal, +20% Cooldown Reduction, and +100% Crit Multiplier (+1.0).',
    curseText: '-75 Max HP and +20% incoming damage taken.',
    tone: 'crimson',
    statModifiers: {
      lifeSteal: 0.14,
      cooldownReduction: 0.2,
      critMultiplier: 1.0,
      maxHp: -75,
    },
    damageTakenMultiplier: 1.2,
  },
  {
    id: 'pact_sovereign_defiance',
    title: 'Defiance of the Shattered Crown',
    blessingText: '+42 Attack Power, +42 Spell Power, +15% Crit Chance, and 1.5x Gold Find.',
    curseText: 'Summons a ruthless Elite Ambush and increases damage taken by +28%.',
    tone: 'gold',
    statModifiers: {
      attackPower: 42,
      spellPower: 42,
      critChance: 0.15,
    },
    damageTakenMultiplier: 1.28,
    goldFindMultiplier: 1.5,
    spawnEliteAmbush: true,
  },
];

export function clonePactCard(card: ObeliskPactCard): ObeliskPactCard {
  return {
    ...card,
    statModifiers: { ...card.statModifiers },
  };
}

/**
 * Rolls 3 distinct Corrupted Obelisk pact choices, prioritizing pacts not yet active.
 */
export function rollThreeObeliskChoices(
  rng: SeededRng,
  activePacts: readonly ObeliskPactCard[],
): [ObeliskPactCard, ObeliskPactCard, ObeliskPactCard] {
  const activeIds = new Set(activePacts.map((p) => p.id));
  const unselected = OBELISK_PACT_CARDS.filter((c) => !activeIds.has(c.id));
  const pool = [...(unselected.length >= 3 ? unselected : OBELISK_PACT_CARDS)];

  // Fisher-Yates partial shuffle for 3 distinct picks
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  return [clonePactCard(pool[0]), clonePactCard(pool[1]), clonePactCard(pool[2])];
}

/**
 * Aggregates all active Obelisk Pact modifiers into flat/percent DerivedStats deltas
 * plus multiplicative combat & fortune scalars.
 */
export function aggregateObeliskPactBonuses(activePacts: readonly ObeliskPactCard[]): {
  stats: Partial<DerivedStats>;
  damageTakenMultiplier: number;
  goldMultiplier: number;
  critChainLightning: boolean;
} {
  const stats: Partial<DerivedStats> = {};
  let damageTakenMultiplier = 1;
  let goldMultiplier = 1;
  let critChainLightning = false;

  for (const pact of activePacts) {
    for (const [rawKey, rawVal] of Object.entries(pact.statModifiers)) {
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) continue;
      const key = rawKey as keyof DerivedStats;
      stats[key] = (stats[key] ?? 0) + rawVal;
    }

    if (
      typeof pact.damageTakenMultiplier === 'number' &&
      Number.isFinite(pact.damageTakenMultiplier) &&
      pact.damageTakenMultiplier > 0
    ) {
      damageTakenMultiplier *= pact.damageTakenMultiplier;
    }

    if (
      typeof pact.goldFindMultiplier === 'number' &&
      Number.isFinite(pact.goldFindMultiplier) &&
      pact.goldFindMultiplier > 0
    ) {
      goldMultiplier *= pact.goldFindMultiplier;
    }

    if (pact.critChainLightning) {
      critChainLightning = true;
    }
  }

  return {
    stats,
    damageTakenMultiplier: Math.round(damageTakenMultiplier * 10000) / 10000,
    goldMultiplier: Math.round(goldMultiplier * 10000) / 10000,
    critChainLightning,
  };
}
