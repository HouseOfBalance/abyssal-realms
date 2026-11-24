import type {
  BloodAltarBoon,
  EquipSlot,
  ItemSetDefinition,
  RuneDefinition,
  RuneId,
  RunewordDefinition,
} from '../../contracts/types';

export const ALL_RUNE_IDS: readonly RuneId[] = [
  'sol',
  'ist',
  'mal',
  'gul',
  'vex',
  'ohm',
  'lo',
  'sur',
  'ber',
  'jah',
  'cham',
  'zod',
] as const;

export const MAX_SOCKETS_BY_SLOT: Record<EquipSlot, number> = {
  weapon: 4,
  chest: 4,
  helmet: 3,
  offhand: 3,
  gloves: 2,
  boots: 2,
  ring: 1,
  amulet: 1,
};

/**
 * 12 Ancient Runes spanning Tiers 1–3 with unique colors, runic glyphs, and per-socket bonuses.
 */
export const RUNE_DEFINITIONS: readonly RuneDefinition[] = [
  // Tier 1 — Awakened Runes
  {
    id: 'sol',
    name: 'Sol Rune',
    tier: 1,
    colorHex: 0xffb703,
    icon: 'ᛊ',
    statBonus: {
      label: 'Sol Socket: Solar Ward',
      statKey: 'armor',
      value: 18,
    },
  },
  {
    id: 'ist',
    name: 'Ist Rune',
    tier: 1,
    colorHex: 0x4dabf7,
    icon: 'ᛁ',
    statBonus: {
      label: 'Ist Socket: Starlight Focus',
      statKey: 'cooldownReduction',
      value: 0.04,
      isPercent: true,
    },
  },
  {
    id: 'mal',
    name: 'Mal Rune',
    tier: 1,
    colorHex: 0xadb5bd,
    icon: 'ᛗ',
    statBonus: {
      label: 'Mal Socket: Iron Fortitude',
      statKey: 'maxHp',
      value: 45,
    },
  },
  {
    id: 'gul',
    name: 'Gul Rune',
    tier: 1,
    colorHex: 0x51cf66,
    icon: 'ᚷ',
    statBonus: {
      label: 'Gul Socket: Viper Tempo',
      statKey: 'attackSpeed',
      value: 0.07,
      isPercent: true,
    },
  },

  // Tier 2 — Greater Sovereign Runes
  {
    id: 'vex',
    name: 'Vex Rune',
    tier: 2,
    colorHex: 0xff6b35,
    icon: 'ᚹ',
    statBonus: {
      label: 'Vex Socket: Siphoning Flame',
      statKey: 'lifeSteal',
      value: 0.035,
      isPercent: true,
    },
  },
  {
    id: 'ohm',
    name: 'Ohm Rune',
    tier: 2,
    colorHex: 0xf76707,
    icon: 'ᛟ',
    statBonus: {
      label: 'Ohm Socket: Warlord Wrath',
      statKey: 'attackPower',
      value: 16,
    },
  },
  {
    id: 'lo',
    name: 'Lo Rune',
    tier: 2,
    colorHex: 0xffd43b,
    icon: 'ᛚ',
    statBonus: {
      label: 'Lo Socket: Lethal Precision',
      statKey: 'critChance',
      value: 0.05,
      isPercent: true,
    },
  },
  {
    id: 'sur',
    name: 'Sur Rune',
    tier: 2,
    colorHex: 0x3bc9db,
    icon: 'ᛉ',
    statBonus: {
      label: 'Sur Socket: Astral Surge',
      statKey: 'spellPower',
      value: 18,
    },
  },

  // Tier 3 — Mythic High Runes
  {
    id: 'ber',
    name: 'Ber Rune',
    tier: 3,
    colorHex: 0xe03131,
    icon: 'ᛒ',
    statBonus: {
      label: 'Ber Socket: Crushing Ruin',
      statKey: 'critMultiplier',
      value: 0.25,
      isPercent: true,
    },
  },
  {
    id: 'jah',
    name: 'Jah Rune',
    tier: 3,
    colorHex: 0xae3ec9,
    icon: 'ᛃ',
    statBonus: {
      label: 'Jah Socket: Immortal Blood',
      statKey: 'vitality',
      value: 12,
    },
  },
  {
    id: 'cham',
    name: 'Cham Rune',
    tier: 3,
    colorHex: 0x74c0fc,
    icon: 'ᚲ',
    statBonus: {
      label: 'Cham Socket: Rime Mirage',
      statKey: 'dodgeChance',
      value: 0.06,
      isPercent: true,
    },
  },
  {
    id: 'zod',
    name: 'Zod Rune',
    tier: 3,
    colorHex: 0xff1e42,
    icon: 'ᛞ',
    statBonus: {
      label: 'Zod Socket: Eternal Might',
      statKey: 'strength',
      value: 14,
    },
  },
] as const;

export const RUNE_DEFINITION_MAP: ReadonlyMap<RuneId, RuneDefinition> = new Map(
  RUNE_DEFINITIONS.map((def) => [def.id, def]),
);

export const RUNES_BY_TIER: Record<1 | 2 | 3, readonly RuneId[]> = {
  1: RUNE_DEFINITIONS.filter((r) => r.tier === 1).map((r) => r.id),
  2: RUNE_DEFINITIONS.filter((r) => r.tier === 2).map((r) => r.id),
  3: RUNE_DEFINITIONS.filter((r) => r.tier === 3).map((r) => r.id),
};

/**
 * 8 Legendary Runeword Recipes triggered when socketed runes match `pattern` in exact order.
 */
export const RUNEWORD_RECIPES: readonly RunewordDefinition[] = [
  {
    id: 'enigma',
    name: 'Enigma',
    allowedSlots: ['chest'],
    pattern: ['jah', 'ist', 'ber'],
    bonusAffixes: [
      { label: 'Enigma: Sovereign Strength', statKey: 'strength', value: 18 },
      { label: 'Enigma: Phase Stride', statKey: 'moveSpeed', value: 1.45 },
      { label: 'Enigma: Sanctum Vitality', statKey: 'maxHp', value: 160 },
      {
        label: 'Enigma: Rift Tempo',
        statKey: 'cooldownReduction',
        value: 0.12,
        isPercent: true,
      },
    ],
    mythicPower:
      'Voidstep Blink — Dodge Rolls phase effortlessly through enemies and surge movement speed.',
  },
  {
    id: 'grief',
    name: 'Grief',
    allowedSlots: ['weapon'],
    pattern: ['mal', 'lo'],
    bonusAffixes: [
      { label: 'Grief: Merciless Edge', statKey: 'attackPower', value: 42 },
      { label: 'Grief: Relentless Zeal', statKey: 'attackSpeed', value: 0.22, isPercent: true },
      {
        label: 'Grief: Executioner Ferocity',
        statKey: 'critMultiplier',
        value: 0.45,
        isPercent: true,
      },
    ],
    mythicPower:
      'Venomous Rend — Strikes cleave past 25% enemy armor and deal amplified damage to wounded foes.',
  },
  {
    id: 'infinity',
    name: 'Infinity',
    allowedSlots: ['weapon'],
    pattern: ['ber', 'mal', 'ber', 'ist'],
    bonusAffixes: [
      { label: 'Infinity: Cataclysmic Dominion', statKey: 'spellPower', value: 58 },
      { label: 'Infinity: Conviction Mind', statKey: 'intelligence', value: 22 },
      {
        label: 'Infinity: Storm Precision',
        statKey: 'critChance',
        value: 0.1,
        isPercent: true,
      },
      {
        label: 'Infinity: Astral Cadence',
        statKey: 'cooldownReduction',
        value: 0.14,
        isPercent: true,
      },
    ],
    mythicPower:
      'Conviction Aura — Projects an emerald storm field that sunders nearby monster resistances.',
  },
  {
    id: 'breath_of_the_dying',
    name: 'Breath of the Dying',
    allowedSlots: ['weapon'],
    pattern: ['vex', 'ohm', 'gul', 'zod'],
    bonusAffixes: [
      { label: 'Undying Might: Attack Power', statKey: 'attackPower', value: 55 },
      { label: 'Undying Siphon: Life Steal', statKey: 'lifeSteal', value: 0.09, isPercent: true },
      {
        label: 'Undying Frenzy: Attack Speed',
        statKey: 'attackSpeed',
        value: 0.28,
        isPercent: true,
      },
      { label: 'Undying Constitution: Vitality', statKey: 'vitality', value: 20 },
    ],
    mythicPower:
      'Poison Nova on Slay — Slaying monsters detonates a ring of undying blight and restores vitality.',
  },
  {
    id: 'call_to_arms',
    name: 'Call to Arms',
    allowedSlots: ['weapon', 'offhand'],
    pattern: ['ohm', 'ist', 'mal'],
    bonusAffixes: [
      { label: 'Battle Orders: Max Health', statKey: 'maxHp', value: 145 },
      { label: 'Battle Command: Max Mana', statKey: 'maxMana', value: 85 },
      { label: 'Battle Cry: Attack Power', statKey: 'attackPower', value: 28 },
      { label: 'Battle Cry: Spell Power', statKey: 'spellPower', value: 28 },
    ],
    mythicPower:
      'Battle Orders — Empowering warcries bolster maximum life, mana reserves, and companion ferocity.',
  },
  {
    id: 'chains_of_honor',
    name: 'Chains of Honor',
    allowedSlots: ['chest'],
    pattern: ['sol', 'ohm', 'ber', 'ist'],
    bonusAffixes: [
      { label: 'Sacred Chains: Armor', statKey: 'armor', value: 75 },
      { label: 'Sacred Chains: Vitality', statKey: 'vitality', value: 18 },
      {
        label: 'Sacred Chains: Life Steal',
        statKey: 'lifeSteal',
        value: 0.06,
        isPercent: true,
      },
      { label: 'Sacred Chains: Health Regen', statKey: 'hpRegen', value: 8.5 },
    ],
    mythicPower:
      'Oathbound Aegis — Hardens your resolve against Elites and Bosses while consecrating your ground.',
  },
  {
    id: 'heart_of_the_oak',
    name: 'Heart of the Oak',
    allowedSlots: ['weapon', 'offhand'],
    pattern: ['sur', 'vex', 'gul'],
    bonusAffixes: [
      { label: 'Worldtree Sap: Spell Power', statKey: 'spellPower', value: 44 },
      { label: 'Worldtree Flow: Mana Regen', statKey: 'manaRegen', value: 7.5 },
      {
        label: 'Worldtree Cycle: Cooldown Reduction',
        statKey: 'cooldownReduction',
        value: 0.15,
        isPercent: true,
      },
      { label: 'Worldtree Grace: Dexterity', statKey: 'dexterity', value: 15 },
    ],
    mythicPower:
      'Oak Sage Harmony — Casting spells weaves a verdant ward that replenishes mana and hastens recovery.',
  },
  {
    id: 'obsidian_eclipse',
    name: 'Obsidian Eclipse',
    allowedSlots: ['helmet', 'offhand', 'chest'],
    pattern: ['cham', 'sur', 'zod'],
    bonusAffixes: [
      {
        label: 'Eclipse Veil: Dodge Chance',
        statKey: 'dodgeChance',
        value: 0.1,
        isPercent: true,
      },
      {
        label: 'Eclipse Precision: Critical Chance',
        statKey: 'critChance',
        value: 0.09,
        isPercent: true,
      },
      {
        label: 'Eclipse Ruin: Critical Multiplier',
        statKey: 'critMultiplier',
        value: 0.4,
        isPercent: true,
      },
      { label: 'Eclipse Bulwark: Armor', statKey: 'armor', value: 48 },
    ],
    mythicPower:
      'Total Eclipse — Evading or parrying an enemy strike cloaks your next blow in twilight precision.',
  },
] as const;

export const RUNEWORD_RECIPE_MAP: ReadonlyMap<string, RunewordDefinition> = new Map(
  RUNEWORD_RECIPES.map((rw) => [rw.id, rw]),
);

/**
 * 3 Class Item Sets with 2-Piece and 4-Piece tiered bonuses.
 */
export const ITEM_SETS: readonly ItemSetDefinition[] = [
  {
    id: 'immortal_king',
    name: 'Battlegear of the Immortal King',
    heroClass: 'vanguard',
    twoPieceBonus: {
      description: '+140 Maximum Health, +55 Armor, and +5.0 Health Regen/s',
      stats: {
        maxHp: 140,
        armor: 55,
        hpRegen: 5.0,
      },
    },
    fourPieceBonus: {
      description: '+48 Attack Power, +8% Life Steal, and +35% Critical Multiplier',
      stats: {
        attackPower: 48,
        lifeSteal: 0.08,
        critMultiplier: 0.35,
      },
      specialEffect:
        'Wrath of the Ancestors — Melee cleaves and slams unleash ancestral shockwaves.',
    },
  },
  {
    id: 'nightstalker_vestments',
    name: 'Vestments of the Nightstalker',
    heroClass: 'shadowblade',
    twoPieceBonus: {
      description: '+10% Critical Chance, +10% Dodge Chance, and +0.8 Movement Speed',
      stats: {
        critChance: 0.1,
        dodgeChance: 0.1,
        moveSpeed: 0.8,
      },
    },
    fourPieceBonus: {
      description: '+60% Critical Multiplier, +22% Attack Speed, and +42 Attack Power',
      stats: {
        critMultiplier: 0.6,
        attackSpeed: 0.22,
        attackPower: 42,
      },
      specialEffect:
        'Phantom Execution — Critical strikes unleash twin shadow mirages that lacerate nearby foes.',
    },
  },
  {
    id: 'astral_archon_regalia',
    name: 'Regalia of the Astral Archon',
    heroClass: 'arcanist',
    twoPieceBonus: {
      description: '+90 Maximum Mana, +6.5 Mana Regen/s, and +12% Cooldown Reduction',
      stats: {
        maxMana: 90,
        manaRegen: 6.5,
        cooldownReduction: 0.12,
      },
    },
    fourPieceBonus: {
      description: '+65 Spell Power, +10% Critical Chance, and +45% Critical Multiplier',
      stats: {
        spellPower: 65,
        critChance: 0.1,
        critMultiplier: 0.45,
      },
      specialEffect:
        'Astral Convergence — Chained spellcasts call down cosmic starfall meteors on enemies.',
    },
  },
] as const;

export const ITEM_SET_MAP: ReadonlyMap<string, ItemSetDefinition> = new Map(
  ITEM_SETS.map((s) => [s.id, s]),
);

/**
 * Floor-wide Blood Altar Boons granted in exchange for sacrificing 25% of current HP.
 */
export const BLOOD_ALTAR_BOONS: readonly BloodAltarBoon[] = [
  {
    id: 'crimson_savagery',
    name: 'Boon of Crimson Savagery',
    hpSacrificePercent: 25,
    description:
      'Sacrifice 25% current HP for +38 Attack Power, +18% Attack Speed, and +6% Life Steal on this floor.',
    statsBonus: {
      attackPower: 38,
      attackSpeed: 0.18,
      lifeSteal: 0.06,
    },
  },
  {
    id: 'sanguine_sorcery',
    name: 'Boon of Sanguine Sorcery',
    hpSacrificePercent: 25,
    description:
      'Sacrifice 25% current HP for +44 Spell Power, +15% Cooldown Reduction, and +5.5 Mana Regen/s on this floor.',
    statsBonus: {
      spellPower: 44,
      cooldownReduction: 0.15,
      manaRegen: 5.5,
    },
  },
  {
    id: 'blood_executioner',
    name: 'Boon of the Blood Executioner',
    hpSacrificePercent: 25,
    description:
      'Sacrifice 25% current HP for +12% Critical Chance and +50% Critical Multiplier on this floor.',
    statsBonus: {
      critChance: 0.12,
      critMultiplier: 0.5,
    },
  },
  {
    id: 'ironblood_juggernaut',
    name: 'Boon of the Ironblood Juggernaut',
    hpSacrificePercent: 25,
    description:
      'Sacrifice 25% current HP for +65 Armor, +120 Maximum Health, and +7.0 Health Regen/s on this floor.',
    statsBonus: {
      armor: 65,
      maxHp: 120,
      hpRegen: 7.0,
    },
  },
  {
    id: 'bloodhunt_stalker',
    name: 'Boon of the Bloodhunt Stalker',
    hpSacrificePercent: 25,
    description:
      'Sacrifice 25% current HP for +1.1 Movement Speed, +10% Dodge Chance, and +15% Attack Speed on this floor.',
    statsBonus: {
      moveSpeed: 1.1,
      dodgeChance: 0.1,
      attackSpeed: 0.15,
    },
  },
  {
    id: 'voidblood_ascension',
    name: 'Boon of Voidblood Ascension',
    hpSacrificePercent: 25,
    description:
      'Sacrifice 25% current HP for +28 Attack Power, +28 Spell Power, and +8% Life Steal on this floor.',
    statsBonus: {
      attackPower: 28,
      spellPower: 28,
      lifeSteal: 0.08,
    },
  },
] as const;

export const PRIMAL_MYTHIC_POWERS: readonly { id: string; description: string }[] = [
  {
    id: 'primal_crimson_nova',
    description:
      'Primal Crimson — Critical hits unleash a searing crimson shockwave dealing 140% bonus AoE damage.',
  },
  {
    id: 'primal_blood_sovereign',
    description:
      'Primal Sovereign — Leech 5% of all damage dealt and gain +20% damage while above 50% Health.',
  },
  {
    id: 'primal_abyss_echo',
    description:
      'Primal Echo — Skills have a 25% chance to echo a second crimson cast at zero mana cost.',
  },
] as const;
