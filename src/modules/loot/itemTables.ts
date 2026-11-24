import type {
  Attributes,
  DerivedStats,
  EquipSlot,
  HeroClassId,
  ItemRarity,
  RuneId,
  WeaponVisualType,
} from '../../contracts/types';

export type StatKey = keyof (DerivedStats & Attributes);

export const ALL_EQUIP_SLOTS: readonly EquipSlot[] = [
  'weapon',
  'offhand',
  'helmet',
  'chest',
  'gloves',
  'boots',
  'ring',
  'amulet',
] as const;

export const ALL_WEAPON_VISUALS: readonly WeaponVisualType[] = [
  'greatsword',
  'daggers',
  'staff',
  'warhammer',
  'sword_shield',
] as const;

export const ALL_RARITIES: readonly ItemRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const;

export const RARITY_AFFIX_COUNT: Record<ItemRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

export const RARITY_STAT_MULTIPLIER: Record<ItemRarity, number> = {
  common: 1.0,
  uncommon: 1.24,
  rare: 1.52,
  epic: 1.88,
  legendary: 2.35,
};

export const RARITY_GOLD_MULTIPLIER: Record<ItemRarity, number> = {
  common: 1.0,
  uncommon: 1.8,
  rare: 3.2,
  epic: 6.0,
  legendary: 12.5,
};

export const RARITY_UPGRADE_COST_FACTOR: Record<ItemRarity, number> = {
  common: 1.0,
  uncommon: 1.3,
  rare: 1.7,
  epic: 2.2,
  legendary: 3.0,
};

export interface AffixTemplate {
  id: string;
  kind: 'prefix' | 'suffix';
  nameToken: string;
  label: string;
  statKey: StatKey;
  baseMin: number;
  baseMax: number;
  levelGrowth: number;
  isPercent?: boolean;
  allowedSlots: readonly EquipSlot[];
}

export interface BaseItemArchetype {
  name: string;
  slot: EquipSlot;
  weaponVisual?: WeaponVisualType;
  icon: string;
  implicitPool: readonly StatKey[];
}

export interface NamedLegendaryTemplate {
  id: string;
  name: string;
  slot: EquipSlot;
  weaponVisual?: WeaponVisualType;
  icon: string;
  fixedStats: readonly {
    label: string;
    statKey: StatKey;
    baseValue: number;
    levelGrowth: number;
    isPercent?: boolean;
  }[];
  legendaryPower: {
    id: string;
    description: string;
  };
}

export const SLOT_ICONS: Record<EquipSlot, string> = {
  weapon: '⚔️',
  offhand: '🛡️',
  helmet: '👑',
  chest: '🧥',
  gloves: '🧤',
  boots: '🥾',
  ring: '💍',
  amulet: '📿',
};

export const WEAPON_VISUAL_ICONS: Record<WeaponVisualType, string> = {
  greatsword: '⚔️',
  daggers: '🗡️',
  staff: '🔮',
  warhammer: '🔨',
  sword_shield: '⚔️',
};

export const BASE_ITEM_ARCHETYPES: readonly BaseItemArchetype[] = [
  // Weapons — all 5 WeaponVisualTypes represented with multiple tiers
  {
    name: 'Claymore',
    slot: 'weapon',
    weaponVisual: 'greatsword',
    icon: '⚔️',
    implicitPool: ['attackPower', 'strength'],
  },
  {
    name: 'Executioner Greatsword',
    slot: 'weapon',
    weaponVisual: 'greatsword',
    icon: '⚔️',
    implicitPool: ['attackPower', 'critMultiplier'],
  },
  {
    name: 'Stiletto Twinblades',
    slot: 'weapon',
    weaponVisual: 'daggers',
    icon: '🗡️',
    implicitPool: ['attackPower', 'critChance'],
  },
  {
    name: 'Nightveil Kris',
    slot: 'weapon',
    weaponVisual: 'daggers',
    icon: '🗡️',
    implicitPool: ['attackPower', 'attackSpeed'],
  },
  {
    name: 'Runewood Spire',
    slot: 'weapon',
    weaponVisual: 'staff',
    icon: '🔮',
    implicitPool: ['spellPower', 'intelligence'],
  },
  {
    name: 'Archon Catalyst Staff',
    slot: 'weapon',
    weaponVisual: 'staff',
    icon: '🔮',
    implicitPool: ['spellPower', 'maxMana'],
  },
  {
    name: 'Siege Maul',
    slot: 'weapon',
    weaponVisual: 'warhammer',
    icon: '🔨',
    implicitPool: ['attackPower', 'vitality'],
  },
  {
    name: 'Doomforge Warhammer',
    slot: 'weapon',
    weaponVisual: 'warhammer',
    icon: '🔨',
    implicitPool: ['attackPower', 'strength'],
  },
  {
    name: 'Knightly Arming Blade & Kite',
    slot: 'weapon',
    weaponVisual: 'sword_shield',
    icon: '⚔️',
    implicitPool: ['attackPower', 'armor'],
  },
  {
    name: 'Templar Broadsword & Bastion',
    slot: 'weapon',
    weaponVisual: 'sword_shield',
    icon: '⚔️',
    implicitPool: ['attackPower', 'maxHp'],
  },

  // Offhands
  {
    name: 'Tower Buckler',
    slot: 'offhand',
    icon: '🛡️',
    implicitPool: ['armor', 'maxHp'],
  },
  {
    name: 'Grimoire Focus',
    slot: 'offhand',
    icon: '🛡️',
    implicitPool: ['spellPower', 'manaRegen'],
  },
  {
    name: 'Obsidian Ward',
    slot: 'offhand',
    icon: '🛡️',
    implicitPool: ['armor', 'dodgeChance'],
  },

  // Helmets
  {
    name: 'Greathelm',
    slot: 'helmet',
    icon: '👑',
    implicitPool: ['armor', 'vitality'],
  },
  {
    name: 'Shadow Cowl',
    slot: 'helmet',
    icon: '👑',
    implicitPool: ['armor', 'critChance'],
  },
  {
    name: 'Astral Diadem',
    slot: 'helmet',
    icon: '👑',
    implicitPool: ['maxMana', 'intelligence'],
  },

  // Chests
  {
    name: 'Sovereign Cuirass',
    slot: 'chest',
    icon: '🧥',
    implicitPool: ['armor', 'maxHp'],
  },
  {
    name: 'Nightstalker Brigandine',
    slot: 'chest',
    icon: '🧥',
    implicitPool: ['armor', 'dodgeChance'],
  },
  {
    name: 'Runebound Vestments',
    slot: 'chest',
    icon: '🧥',
    implicitPool: ['armor', 'spellPower'],
  },

  // Gloves
  {
    name: 'Vambraces',
    slot: 'gloves',
    icon: '🧤',
    implicitPool: ['armor', 'attackSpeed'],
  },
  {
    name: 'Razorclaw Grips',
    slot: 'gloves',
    icon: '🧤',
    implicitPool: ['critChance', 'dexterity'],
  },
  {
    name: 'Spellweaver Handwraps',
    slot: 'gloves',
    icon: '🧤',
    implicitPool: ['spellPower', 'cooldownReduction'],
  },

  // Boots
  {
    name: 'Sabatons',
    slot: 'boots',
    icon: '🥾',
    implicitPool: ['armor', 'moveSpeed'],
  },
  {
    name: 'Windrunner Striders',
    slot: 'boots',
    icon: '🥾',
    implicitPool: ['moveSpeed', 'staminaRegen'],
  },
  {
    name: 'Duskstep Greaves',
    slot: 'boots',
    icon: '🥾',
    implicitPool: ['moveSpeed', 'dodgeChance'],
  },

  // Rings
  {
    name: 'Onyx Signet',
    slot: 'ring',
    icon: '💍',
    implicitPool: ['critChance', 'attackPower'],
  },
  {
    name: 'Sapphire Band',
    slot: 'ring',
    icon: '💍',
    implicitPool: ['spellPower', 'manaRegen'],
  },
  {
    name: 'Bloodstone Loop',
    slot: 'ring',
    icon: '💍',
    implicitPool: ['maxHp', 'lifeSteal'],
  },

  // Amulets
  {
    name: 'Reliquary Pendant',
    slot: 'amulet',
    icon: '📿',
    implicitPool: ['maxHp', 'cooldownReduction'],
  },
  {
    name: 'Sunfire Talisman',
    slot: 'amulet',
    icon: '📿',
    implicitPool: ['attackPower', 'critMultiplier'],
  },
  {
    name: 'Voidstar Medallion',
    slot: 'amulet',
    icon: '📿',
    implicitPool: ['spellPower', 'intelligence'],
  },
];

export const AFFIX_POOL: readonly AffixTemplate[] = [
  // Prefixes — Offensive, Resource, & Defense
  {
    id: 'pref_ferocious',
    kind: 'prefix',
    nameToken: 'Ferocious',
    label: 'Attack Power',
    statKey: 'attackPower',
    baseMin: 5,
    baseMax: 9,
    levelGrowth: 0.22,
    isPercent: false,
    allowedSlots: ['weapon', 'gloves', 'ring', 'amulet', 'offhand'],
  },
  {
    id: 'pref_runeforged',
    kind: 'prefix',
    nameToken: 'Runeforged',
    label: 'Spell Power',
    statKey: 'spellPower',
    baseMin: 5,
    baseMax: 9,
    levelGrowth: 0.22,
    isPercent: false,
    allowedSlots: ['weapon', 'offhand', 'helmet', 'gloves', 'ring', 'amulet'],
  },
  {
    id: 'pref_stalwart',
    kind: 'prefix',
    nameToken: 'Stalwart',
    label: 'Armor',
    statKey: 'armor',
    baseMin: 6,
    baseMax: 11,
    levelGrowth: 0.2,
    isPercent: false,
    allowedSlots: ['offhand', 'helmet', 'chest', 'gloves', 'boots', 'weapon'],
  },
  {
    id: 'pref_immortal',
    kind: 'prefix',
    nameToken: 'Immortal',
    label: 'Max Health',
    statKey: 'maxHp',
    baseMin: 18,
    baseMax: 32,
    levelGrowth: 0.22,
    isPercent: false,
    allowedSlots: ALL_EQUIP_SLOTS,
  },
  {
    id: 'pref_astral',
    kind: 'prefix',
    nameToken: 'Astral',
    label: 'Max Mana',
    statKey: 'maxMana',
    baseMin: 12,
    baseMax: 22,
    levelGrowth: 0.18,
    isPercent: false,
    allowedSlots: ['weapon', 'offhand', 'helmet', 'chest', 'ring', 'amulet'],
  },
  {
    id: 'pref_tireless',
    kind: 'prefix',
    nameToken: 'Tireless',
    label: 'Max Stamina',
    statKey: 'maxStamina',
    baseMin: 8,
    baseMax: 15,
    levelGrowth: 0.14,
    isPercent: false,
    allowedSlots: ['chest', 'gloves', 'boots', 'amulet'],
  },
  {
    id: 'pref_vampiric',
    kind: 'prefix',
    nameToken: 'Bloodthirsty',
    label: 'Life Steal',
    statKey: 'lifeSteal',
    baseMin: 0.012,
    baseMax: 0.025,
    levelGrowth: 0.08,
    isPercent: true,
    allowedSlots: ['weapon', 'gloves', 'ring', 'amulet'],
  },
  {
    id: 'pref_merciless',
    kind: 'prefix',
    nameToken: 'Merciless',
    label: 'Critical Chance',
    statKey: 'critChance',
    baseMin: 0.02,
    baseMax: 0.04,
    levelGrowth: 0.08,
    isPercent: true,
    allowedSlots: ['weapon', 'offhand', 'helmet', 'gloves', 'ring', 'amulet'],
  },
  {
    id: 'pref_devastating',
    kind: 'prefix',
    nameToken: 'Devastating',
    label: 'Critical Damage',
    statKey: 'critMultiplier',
    baseMin: 0.08,
    baseMax: 0.15,
    levelGrowth: 0.1,
    isPercent: true,
    allowedSlots: ['weapon', 'gloves', 'ring', 'amulet'],
  },

  // Suffixes — Attributes, Speed, Regeneration, & Evasion
  {
    id: 'suf_titan',
    kind: 'suffix',
    nameToken: 'of the Titan',
    label: 'Strength',
    statKey: 'strength',
    baseMin: 2,
    baseMax: 5,
    levelGrowth: 0.2,
    isPercent: false,
    allowedSlots: ALL_EQUIP_SLOTS,
  },
  {
    id: 'suf_phantom',
    kind: 'suffix',
    nameToken: 'of the Phantom',
    label: 'Dexterity',
    statKey: 'dexterity',
    baseMin: 2,
    baseMax: 5,
    levelGrowth: 0.2,
    isPercent: false,
    allowedSlots: ALL_EQUIP_SLOTS,
  },
  {
    id: 'suf_oracle',
    kind: 'suffix',
    nameToken: 'of the Oracle',
    label: 'Intelligence',
    statKey: 'intelligence',
    baseMin: 2,
    baseMax: 5,
    levelGrowth: 0.2,
    isPercent: false,
    allowedSlots: ALL_EQUIP_SLOTS,
  },
  {
    id: 'suf_colossus',
    kind: 'suffix',
    nameToken: 'of the Colossus',
    label: 'Vitality',
    statKey: 'vitality',
    baseMin: 2,
    baseMax: 5,
    levelGrowth: 0.2,
    isPercent: false,
    allowedSlots: ALL_EQUIP_SLOTS,
  },
  {
    id: 'suf_zeal',
    kind: 'suffix',
    nameToken: 'of Zeal',
    label: 'Attack Speed',
    statKey: 'attackSpeed',
    baseMin: 0.03,
    baseMax: 0.06,
    levelGrowth: 0.08,
    isPercent: true,
    allowedSlots: ['weapon', 'gloves', 'ring', 'amulet'],
  },
  {
    id: 'suf_celerity',
    kind: 'suffix',
    nameToken: 'of Celerity',
    label: 'Movement Speed',
    statKey: 'moveSpeed',
    baseMin: 0.25,
    baseMax: 0.55,
    levelGrowth: 0.07,
    isPercent: false,
    allowedSlots: ['boots', 'amulet'],
  },
  {
    id: 'suf_chronos',
    kind: 'suffix',
    nameToken: 'of Mastery',
    label: 'Cooldown Reduction',
    statKey: 'cooldownReduction',
    baseMin: 0.025,
    baseMax: 0.05,
    levelGrowth: 0.07,
    isPercent: true,
    allowedSlots: ['offhand', 'helmet', 'gloves', 'ring', 'amulet', 'weapon'],
  },
  {
    id: 'suf_mirage',
    kind: 'suffix',
    nameToken: 'of Evasion',
    label: 'Dodge Chance',
    statKey: 'dodgeChance',
    baseMin: 0.02,
    baseMax: 0.04,
    levelGrowth: 0.07,
    isPercent: true,
    allowedSlots: ['offhand', 'chest', 'boots', 'ring'],
  },
  {
    id: 'suf_renewal',
    kind: 'suffix',
    nameToken: 'of Renewal',
    label: 'Health Regen',
    statKey: 'hpRegen',
    baseMin: 0.8,
    baseMax: 1.8,
    levelGrowth: 0.16,
    isPercent: false,
    allowedSlots: ['helmet', 'chest', 'offhand', 'ring', 'amulet'],
  },
  {
    id: 'suf_clarity',
    kind: 'suffix',
    nameToken: 'of Clarity',
    label: 'Mana Regen',
    statKey: 'manaRegen',
    baseMin: 0.6,
    baseMax: 1.4,
    levelGrowth: 0.15,
    isPercent: false,
    allowedSlots: ['weapon', 'offhand', 'helmet', 'ring', 'amulet'],
  },
  {
    id: 'suf_endurance',
    kind: 'suffix',
    nameToken: 'of Endurance',
    label: 'Stamina Regen',
    statKey: 'staminaRegen',
    baseMin: 1.0,
    baseMax: 2.2,
    levelGrowth: 0.14,
    isPercent: false,
    allowedSlots: ['boots', 'gloves', 'chest'],
  },
];

export const EPIC_TITLES: readonly string[] = [
  'Dreadforged',
  'Abyssal',
  'Netherbound',
  'Sovereign',
  'Bloodmoon',
  'Cataclysmic',
  'Obsidian',
  'Eclipsed',
];

/**
 * 12 Handcrafted Named Legendaries spanning all 8 EquipSlots and all 5 WeaponVisualTypes.
 */
export const NAMED_LEGENDARIES: readonly NamedLegendaryTemplate[] = [
  {
    id: 'leg_crown_shattered_king',
    name: 'Crown of the Shattered King',
    slot: 'helmet',
    icon: '👑',
    fixedStats: [
      { label: 'Armor', statKey: 'armor', baseValue: 18, levelGrowth: 0.2 },
      { label: 'Strength', statKey: 'strength', baseValue: 6, levelGrowth: 0.2 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 7, levelGrowth: 0.2 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.055, levelGrowth: 0.06, isPercent: true },
      { label: 'Cooldown Reduction', statKey: 'cooldownReduction', baseValue: 0.07, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'shattered_sovereign',
      description:
        "Sovereign's Mandate: Critical strikes unleash a spectral shockwave dealing 35% bonus Void damage and fortifying Armor by 15% for 5s.",
    },
  },
  {
    id: 'leg_soulreaver_greatsword',
    name: 'Soulreaver Greatsword',
    slot: 'weapon',
    weaponVisual: 'greatsword',
    icon: '⚔️',
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 22, levelGrowth: 0.24 },
      { label: 'Strength', statKey: 'strength', baseValue: 8, levelGrowth: 0.2 },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.26, levelGrowth: 0.08, isPercent: true },
      { label: 'Life Steal', statKey: 'lifeSteal', baseValue: 0.045, levelGrowth: 0.05, isPercent: true },
      { label: 'Max Health', statKey: 'maxHp', baseValue: 45, levelGrowth: 0.2 },
    ],
    legendaryPower: {
      id: 'soulreaver_harvest',
      description:
        "Reaper's Harvest: Slaying an enemy rends their soul, restoring 6% Max Health and granting +5% Attack Power for 6s (stacks up to 5 times).",
    },
  },
  {
    id: 'leg_whispering_voidfangs',
    name: 'Whispering Voidfangs',
    slot: 'weapon',
    weaponVisual: 'daggers',
    icon: '🗡️',
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 19, levelGrowth: 0.23 },
      { label: 'Dexterity', statKey: 'dexterity', baseValue: 9, levelGrowth: 0.2 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.08, levelGrowth: 0.06, isPercent: true },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.3, levelGrowth: 0.08, isPercent: true },
      { label: 'Attack Speed', statKey: 'attackSpeed', baseValue: 0.12, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'voidfang_echo',
      description:
        'Phantom Evisceration: Every third strike steps through the Veil, guaranteeing a Critical Hit that inflicts Vulnerable and Bleed for 4s.',
    },
  },
  {
    id: 'leg_astral_nexus_staff',
    name: 'Astral Nexus Staff',
    slot: 'weapon',
    weaponVisual: 'staff',
    icon: '🔮',
    fixedStats: [
      { label: 'Spell Power', statKey: 'spellPower', baseValue: 24, levelGrowth: 0.24 },
      { label: 'Intelligence', statKey: 'intelligence', baseValue: 9, levelGrowth: 0.2 },
      { label: 'Max Mana', statKey: 'maxMana', baseValue: 42, levelGrowth: 0.18 },
      { label: 'Cooldown Reduction', statKey: 'cooldownReduction', baseValue: 0.09, levelGrowth: 0.05, isPercent: true },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.065, levelGrowth: 0.06, isPercent: true },
    ],
    legendaryPower: {
      id: 'astral_convergence',
      description:
        'Celestial Singularity: Casting a cooldown spell conjures an Astral Conduit that refunds 20% Mana and amplifies Spell Power by 18% for 5s.',
    },
  },
  {
    id: 'leg_titanfall_worldbreaker',
    name: 'Titanfall Worldbreaker',
    slot: 'weapon',
    weaponVisual: 'warhammer',
    icon: '🔨',
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 25, levelGrowth: 0.25 },
      { label: 'Strength', statKey: 'strength', baseValue: 9, levelGrowth: 0.2 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 7, levelGrowth: 0.2 },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.28, levelGrowth: 0.08, isPercent: true },
      { label: 'Armor', statKey: 'armor', baseValue: 16, levelGrowth: 0.18 },
    ],
    legendaryPower: {
      id: 'titanfall_tremor',
      description:
        'Cataclysmic Impact: Heavy melee blows sunder the ground in a 3.5m shockwave, stunning staggered foes for 1.2s and sundering 25% of their Armor.',
    },
  },
  {
    id: 'leg_bastion_dawnfire',
    name: 'Bastion of Dawnfire',
    slot: 'weapon',
    weaponVisual: 'sword_shield',
    icon: '⚔️',
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 18, levelGrowth: 0.22 },
      { label: 'Armor', statKey: 'armor', baseValue: 22, levelGrowth: 0.2 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 8, levelGrowth: 0.2 },
      { label: 'Max Health', statKey: 'maxHp', baseValue: 55, levelGrowth: 0.22 },
      { label: 'Health Regen', statKey: 'hpRegen', baseValue: 3.2, levelGrowth: 0.16 },
    ],
    legendaryPower: {
      id: 'dawnfire_retribution',
      description:
        'Solaris Counterguard: Mitigating or dodging an attack ignites a radiant nova, scorching nearby enemies for 140% of your Armor as Fire damage.',
    },
  },
  {
    id: 'leg_aegis_eclipse',
    name: 'Aegis of the Eclipse',
    slot: 'offhand',
    icon: '🛡️',
    fixedStats: [
      { label: 'Armor', statKey: 'armor', baseValue: 26, levelGrowth: 0.22 },
      { label: 'Max Health', statKey: 'maxHp', baseValue: 60, levelGrowth: 0.22 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 7, levelGrowth: 0.2 },
      { label: 'Dodge Chance', statKey: 'dodgeChance', baseValue: 0.06, levelGrowth: 0.05, isPercent: true },
      { label: 'Cooldown Reduction', statKey: 'cooldownReduction', baseValue: 0.065, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'eclipse_ward',
      description:
        'Umbral Bulwark: Falling below 40% Health conjures an Eclipse Barrier absorbing 30% Max Health for 6s (18s cooldown).',
    },
  },
  {
    id: 'leg_dreadplate_undying',
    name: 'Dreadplate of the Undying Legion',
    slot: 'chest',
    icon: '🧥',
    fixedStats: [
      { label: 'Armor', statKey: 'armor', baseValue: 30, levelGrowth: 0.22 },
      { label: 'Max Health', statKey: 'maxHp', baseValue: 75, levelGrowth: 0.23 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 8, levelGrowth: 0.2 },
      { label: 'Strength', statKey: 'strength', baseValue: 6, levelGrowth: 0.18 },
      { label: 'Health Regen', statKey: 'hpRegen', baseValue: 3.8, levelGrowth: 0.16 },
    ],
    legendaryPower: {
      id: 'undying_legion',
      description:
        "Juggernaut's Defiance: You cannot be slowed below base movement speed, and 15% of hit damage taken is staggered harmlessly into Void Mist.",
    },
  },
  {
    id: 'leg_gauntlets_crimson_executioner',
    name: 'Gauntlets of the Crimson Executioner',
    slot: 'gloves',
    icon: '🧤',
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 14, levelGrowth: 0.2 },
      { label: 'Dexterity', statKey: 'dexterity', baseValue: 7, levelGrowth: 0.2 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.07, levelGrowth: 0.06, isPercent: true },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.24, levelGrowth: 0.08, isPercent: true },
      { label: 'Attack Speed', statKey: 'attackSpeed', baseValue: 0.1, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'crimson_execution',
      description:
        'Cull the Weak: Attacks against enemies below 30% Health deal +40% Critical Damage and grant +15% Attack Speed for 4s.',
    },
  },
  {
    id: 'leg_voidwalker_treads',
    name: "Voidwalker's Phantom Treads",
    slot: 'boots',
    icon: '🥾',
    fixedStats: [
      { label: 'Armor', statKey: 'armor', baseValue: 15, levelGrowth: 0.18 },
      { label: 'Movement Speed', statKey: 'moveSpeed', baseValue: 0.95, levelGrowth: 0.05 },
      { label: 'Dodge Chance', statKey: 'dodgeChance', baseValue: 0.065, levelGrowth: 0.05, isPercent: true },
      { label: 'Max Stamina', statKey: 'maxStamina', baseValue: 22, levelGrowth: 0.14 },
      { label: 'Stamina Regen', statKey: 'staminaRegen', baseValue: 3.5, levelGrowth: 0.14 },
    ],
    legendaryPower: {
      id: 'voidwalker_step',
      description:
        'Abyssal Slipstream: Dodge rolling leaves behind an unstable Void Rift that implodes after 1s and grants +25% Movement Speed for 3s.',
    },
  },
  {
    id: 'leg_signet_ouroboros',
    name: 'Signet of the Ouroboros',
    slot: 'ring',
    icon: '💍',
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 12, levelGrowth: 0.2 },
      { label: 'Spell Power', statKey: 'spellPower', baseValue: 12, levelGrowth: 0.2 },
      { label: 'Life Steal', statKey: 'lifeSteal', baseValue: 0.04, levelGrowth: 0.05, isPercent: true },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.055, levelGrowth: 0.06, isPercent: true },
      { label: 'Mana Regen', statKey: 'manaRegen', baseValue: 2.4, levelGrowth: 0.15 },
    ],
    legendaryPower: {
      id: 'ouroboros_cycle',
      description:
        'Eternal Devourer: Life Steal overhealing restores Mana instead and empowers all damage dealt by 12% while above 85% Health.',
    },
  },
  {
    id: 'leg_heart_malakor',
    name: 'Heart of Malakor',
    slot: 'amulet',
    icon: '📿',
    fixedStats: [
      { label: 'Strength', statKey: 'strength', baseValue: 6, levelGrowth: 0.18 },
      { label: 'Dexterity', statKey: 'dexterity', baseValue: 6, levelGrowth: 0.18 },
      { label: 'Intelligence', statKey: 'intelligence', baseValue: 6, levelGrowth: 0.18 },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.25, levelGrowth: 0.08, isPercent: true },
      { label: 'Cooldown Reduction', statKey: 'cooldownReduction', baseValue: 0.085, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'malakor_ascendance',
      description:
        "Emperor's Dominion: Every 5th combo kill calls down an Abyssal Starfall on the strongest nearby foe and reduces active skill cooldowns by 1.0s.",
    },
  },
];

export interface StarterLoadoutSpec {
  weaponName: string;
  weaponVisual: WeaponVisualType;
  weaponStat: { label: string; statKey: StatKey; value: number };
  chestName: string;
  chestSecondary: { label: string; statKey: StatKey; value: number };
  bootsName: string;
}

export const STARTER_LOADOUTS: Record<HeroClassId, StarterLoadoutSpec> = {
  vanguard: {
    weaponName: 'Ironclad Broadsword',
    weaponVisual: 'greatsword',
    weaponStat: { label: 'Attack Power', statKey: 'attackPower', value: 7 },
    chestName: 'Vanguard Recruit Brigandine',
    chestSecondary: { label: 'Vitality', statKey: 'vitality', value: 2 },
    bootsName: 'Ironshod Marchers',
  },
  shadowblade: {
    weaponName: 'Obsidian Twin Dirks',
    weaponVisual: 'daggers',
    weaponStat: { label: 'Attack Power', statKey: 'attackPower', value: 7 },
    chestName: 'Nightwatch Leather Jerkin',
    chestSecondary: { label: 'Dexterity', statKey: 'dexterity', value: 2 },
    bootsName: 'Silentfoot Boots',
  },
  arcanist: {
    weaponName: 'Apprentice Starwood Staff',
    weaponVisual: 'staff',
    weaponStat: { label: 'Spell Power', statKey: 'spellPower', value: 8 },
    chestName: 'Initiate Woven Robes',
    chestSecondary: { label: 'Intelligence', statKey: 'intelligence', value: 2 },
    bootsName: 'Silkweave Slippers',
  },
};

export const ALL_RUNE_IDS: readonly RuneId[] = [
  'sol',
  'vex',
  'jah',
  'ohm',
  'ber',
  'zod',
  'ist',
  'mal',
  'gul',
  'sur',
  'lo',
  'cham',
] as const;

export const RUNE_VISUAL_META: Record<
  RuneId,
  { name: string; tier: 1 | 2 | 3; colorHex: number; coreHex: number }
> = {
  sol: { name: 'Sol Rune', tier: 1, colorHex: 0xffd43b, coreHex: 0xfff9db },
  ist: { name: 'Ist Rune', tier: 1, colorHex: 0x38d9a9, coreHex: 0xc3fae8 },
  mal: { name: 'Mal Rune', tier: 1, colorHex: 0x74c0fc, coreHex: 0xe7f5ff },
  gul: { name: 'Gul Rune', tier: 1, colorHex: 0x69db7c, coreHex: 0xd3f9d8 },
  vex: { name: 'Vex Rune', tier: 2, colorHex: 0xff8787, coreHex: 0xffe3e3 },
  ohm: { name: 'Ohm Rune', tier: 2, colorHex: 0xf783ac, coreHex: 0xffdeeb },
  lo: { name: 'Lo Rune', tier: 2, colorHex: 0xfcc419, coreHex: 0xfff3bf },
  sur: { name: 'Sur Rune', tier: 2, colorHex: 0xda77f2, coreHex: 0xf8f0fc },
  jah: { name: 'Jah Rune', tier: 3, colorHex: 0xff6b35, coreHex: 0xfff4e6 },
  ber: { name: 'Ber Rune', tier: 3, colorHex: 0xff1e42, coreHex: 0xffccd5 },
  cham: { name: 'Cham Rune', tier: 3, colorHex: 0x4dabf7, coreHex: 0xffffff },
  zod: { name: 'Zod Rune', tier: 3, colorHex: 0xffd43b, coreHex: 0xffffff },
};

export const MYTHIC_STAT_MULTIPLIER = 3.15;
export const MYTHIC_GOLD_MULTIPLIER = 22.0;
export const MYTHIC_UPGRADE_COST_FACTOR = 4.0;

export interface MythicPrimalTemplate extends NamedLegendaryTemplate {
  sockets: number;
}

/**
 * 12 Handcrafted Mythic Primal Crimson Relics (6 boosted affixes each) spanning all 8 EquipSlots & 5 WeaponVisuals.
 */
export const MYTHIC_PRIMAL_TEMPLATES: readonly MythicPrimalTemplate[] = [
  {
    id: 'mythic_crown_eternal_eclipse',
    name: 'Primal Crown of Eternal Cataclysm',
    slot: 'helmet',
    icon: '👑',
    sockets: 2,
    fixedStats: [
      { label: 'Armor', statKey: 'armor', baseValue: 26, levelGrowth: 0.22 },
      { label: 'Strength', statKey: 'strength', baseValue: 9, levelGrowth: 0.2 },
      { label: 'Intelligence', statKey: 'intelligence', baseValue: 9, levelGrowth: 0.2 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.085, levelGrowth: 0.06, isPercent: true },
      { label: 'Cooldown Reduction', statKey: 'cooldownReduction', baseValue: 0.11, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_cataclysm_diadem',
      description:
        'Primal Sovereignty: Critical hits detonate a Crimson-Gold Singularity dealing 65% bonus All-Elemental damage and granting +12% Damage Reduction for 6s.',
    },
  },
  {
    id: 'mythic_apocalypse_soulblade',
    name: 'Primal Apocalypse Soulblade',
    slot: 'weapon',
    weaponVisual: 'greatsword',
    icon: '⚔️',
    sockets: 3,
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 32, levelGrowth: 0.26 },
      { label: 'Strength', statKey: 'strength', baseValue: 12, levelGrowth: 0.22 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 9, levelGrowth: 0.2 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.08, levelGrowth: 0.06, isPercent: true },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.38, levelGrowth: 0.08, isPercent: true },
      { label: 'Life Steal', statKey: 'lifeSteal', baseValue: 0.065, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_apocalypse_cleave',
      description:
        'Bloodgod Obliteration: Melee arcs unleash twin crimson waves dealing 80% Attack Power and restoring 8% Max Health on Elite or Boss hits.',
    },
  },
  {
    id: 'mythic_oblivion_razors',
    name: 'Primal Fangs of Oblivion',
    slot: 'weapon',
    weaponVisual: 'daggers',
    icon: '🗡️',
    sockets: 3,
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 28, levelGrowth: 0.25 },
      { label: 'Dexterity', statKey: 'dexterity', baseValue: 13, levelGrowth: 0.22 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.11, levelGrowth: 0.06, isPercent: true },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.44, levelGrowth: 0.08, isPercent: true },
      { label: 'Attack Speed', statKey: 'attackSpeed', baseValue: 0.16, levelGrowth: 0.05, isPercent: true },
      { label: 'Dodge Chance', statKey: 'dodgeChance', baseValue: 0.065, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_oblivion_flurry',
      description:
        'Crimson Phantom Dance: Critical strikes trigger a shadow clone echo strike for 55% Void damage and grant +10% Movement Speed for 4s.',
    },
  },
  {
    id: 'mythic_chronoloom_spire',
    name: 'Primal Spire of the Astral Loom',
    slot: 'weapon',
    weaponVisual: 'staff',
    icon: '🔮',
    sockets: 3,
    fixedStats: [
      { label: 'Spell Power', statKey: 'spellPower', baseValue: 34, levelGrowth: 0.26 },
      { label: 'Intelligence', statKey: 'intelligence', baseValue: 13, levelGrowth: 0.22 },
      { label: 'Max Mana', statKey: 'maxMana', baseValue: 65, levelGrowth: 0.2 },
      { label: 'Mana Regen', statKey: 'manaRegen', baseValue: 3.8, levelGrowth: 0.16 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.095, levelGrowth: 0.06, isPercent: true },
      { label: 'Cooldown Reduction', statKey: 'cooldownReduction', baseValue: 0.13, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_astral_overdrive',
      description:
        'Chronos Convergence: Spells deal +30% Critical Damage, refund 25% Mana on Critical Hits, and shave 0.5s off all active cooldowns.',
    },
  },
  {
    id: 'mythic_godbreaker_maul',
    name: 'Primal Worldshatter Godmaul',
    slot: 'weapon',
    weaponVisual: 'warhammer',
    icon: '🔨',
    sockets: 3,
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 36, levelGrowth: 0.27 },
      { label: 'Strength', statKey: 'strength', baseValue: 13, levelGrowth: 0.22 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Armor', statKey: 'armor', baseValue: 24, levelGrowth: 0.2 },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.42, levelGrowth: 0.08, isPercent: true },
      { label: 'Max Health', statKey: 'maxHp', baseValue: 75, levelGrowth: 0.22 },
    ],
    legendaryPower: {
      id: 'primal_godbreaker_quake',
      description:
        'Tectonic Extinction: Slams create a 4.5m molten fissure dealing 110% Fire damage, inflicting Burn & Stagger on all struck enemies.',
    },
  },
  {
    id: 'mythic_seraphim_aegisblade',
    name: 'Primal Seraphim Oathblade & Aegis',
    slot: 'weapon',
    weaponVisual: 'sword_shield',
    icon: '⚔️',
    sockets: 3,
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 27, levelGrowth: 0.24 },
      { label: 'Armor', statKey: 'armor', baseValue: 32, levelGrowth: 0.22 },
      { label: 'Strength', statKey: 'strength', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 11, levelGrowth: 0.2 },
      { label: 'Max Health', statKey: 'maxHp', baseValue: 85, levelGrowth: 0.22 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.075, levelGrowth: 0.06, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_seraphim_bastion',
      description:
        'Immortal Vow: Parrying or mitigating hits unleashes a Crimson Valkyrie Lance for 200% of your Armor and fortifies Max Health by 15%.',
    },
  },
  {
    id: 'mythic_bulwark_first_flame',
    name: 'Primal Bulwark of the First Seraph',
    slot: 'offhand',
    icon: '🛡️',
    sockets: 2,
    fixedStats: [
      { label: 'Armor', statKey: 'armor', baseValue: 36, levelGrowth: 0.23 },
      { label: 'Max Health', statKey: 'maxHp', baseValue: 92, levelGrowth: 0.23 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Spell Power', statKey: 'spellPower', baseValue: 18, levelGrowth: 0.2 },
      { label: 'Dodge Chance', statKey: 'dodgeChance', baseValue: 0.08, levelGrowth: 0.05, isPercent: true },
      { label: 'Cooldown Reduction', statKey: 'cooldownReduction', baseValue: 0.09, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_seraph_ward',
      description:
        'Crimson Sanctuary: Every 10s, gain a Primal Barrier equal to 25% Max Health; while shielded, Critical Chance is increased by +10%.',
    },
  },
  {
    id: 'mythic_bloodgod_cuirass',
    name: 'Primal Heartplate of the Blood Emperor',
    slot: 'chest',
    icon: '🧥',
    sockets: 3,
    fixedStats: [
      { label: 'Armor', statKey: 'armor', baseValue: 42, levelGrowth: 0.24 },
      { label: 'Max Health', statKey: 'maxHp', baseValue: 110, levelGrowth: 0.24 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 12, levelGrowth: 0.2 },
      { label: 'Strength', statKey: 'strength', baseValue: 9, levelGrowth: 0.2 },
      { label: 'Health Regen', statKey: 'hpRegen', baseValue: 5.5, levelGrowth: 0.17 },
      { label: 'Life Steal', statKey: 'lifeSteal', baseValue: 0.05, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_blood_emperor',
      description:
        'Undying Crimson Reign: Taking fatal damage instead heals you to 50% Health and triggers a devastating Blood Supernova (60s cooldown).',
    },
  },
  {
    id: 'mythic_talons_ruin',
    name: 'Primal Talons of Crimson Ruin',
    slot: 'gloves',
    icon: '🧤',
    sockets: 2,
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 20, levelGrowth: 0.22 },
      { label: 'Spell Power', statKey: 'spellPower', baseValue: 20, levelGrowth: 0.22 },
      { label: 'Dexterity', statKey: 'dexterity', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.095, levelGrowth: 0.06, isPercent: true },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.34, levelGrowth: 0.08, isPercent: true },
      { label: 'Attack Speed', statKey: 'attackSpeed', baseValue: 0.14, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_ruin_rend',
      description:
        'Executioner Overdrive: Consecutive hits on the same foe stack +6% All Damage (up to +36%) and execute non-bosses below 12% Health.',
    },
  },
  {
    id: 'mythic_singularity_striders',
    name: 'Primal Striders of the Singularity',
    slot: 'boots',
    icon: '🥾',
    sockets: 2,
    fixedStats: [
      { label: 'Armor', statKey: 'armor', baseValue: 22, levelGrowth: 0.2 },
      { label: 'Movement Speed', statKey: 'moveSpeed', baseValue: 1.25, levelGrowth: 0.05 },
      { label: 'Dexterity', statKey: 'dexterity', baseValue: 9, levelGrowth: 0.2 },
      { label: 'Dodge Chance', statKey: 'dodgeChance', baseValue: 0.085, levelGrowth: 0.05, isPercent: true },
      { label: 'Max Stamina', statKey: 'maxStamina', baseValue: 32, levelGrowth: 0.15 },
      { label: 'Stamina Regen', statKey: 'staminaRegen', baseValue: 5.0, levelGrowth: 0.15 },
    ],
    legendaryPower: {
      id: 'primal_singularity_stride',
      description:
        'Horizon Step: You ignore ice slip & movement slows, and dodging pulls nearby foes into a Crimson Gravity Well before granting +35% Speed.',
    },
  },
  {
    id: 'mythic_band_crimson_infinity',
    name: 'Primal Band of Crimson Infinity',
    slot: 'ring',
    icon: '💍',
    sockets: 1,
    fixedStats: [
      { label: 'Attack Power', statKey: 'attackPower', baseValue: 18, levelGrowth: 0.21 },
      { label: 'Spell Power', statKey: 'spellPower', baseValue: 18, levelGrowth: 0.21 },
      { label: 'Critical Chance', statKey: 'critChance', baseValue: 0.08, levelGrowth: 0.06, isPercent: true },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.28, levelGrowth: 0.08, isPercent: true },
      { label: 'Life Steal', statKey: 'lifeSteal', baseValue: 0.055, levelGrowth: 0.05, isPercent: true },
      { label: 'Mana Regen', statKey: 'manaRegen', baseValue: 3.4, levelGrowth: 0.15 },
    ],
    legendaryPower: {
      id: 'primal_infinity_loop',
      description:
        'Ouroboros Apex: Awakening Fury generates 35% faster, and all Elemental Reactions deal +45% amplified cataclysm damage.',
    },
  },
  {
    id: 'mythic_eye_shattered_cosmos',
    name: 'Primal Eye of the Shattered Cosmos',
    slot: 'amulet',
    icon: '📿',
    sockets: 1,
    fixedStats: [
      { label: 'Strength', statKey: 'strength', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Dexterity', statKey: 'dexterity', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Intelligence', statKey: 'intelligence', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Vitality', statKey: 'vitality', baseValue: 10, levelGrowth: 0.2 },
      { label: 'Critical Damage', statKey: 'critMultiplier', baseValue: 0.36, levelGrowth: 0.08, isPercent: true },
      { label: 'Cooldown Reduction', statKey: 'cooldownReduction', baseValue: 0.12, levelGrowth: 0.05, isPercent: true },
    ],
    legendaryPower: {
      id: 'primal_cosmos_ascension',
      description:
        'Cosmic Omnipotence: Increases all Attributes by +10% and causes Ultimate cooldown skills to unleash a secondary Crimson Astral Nova.',
    },
  },
];
