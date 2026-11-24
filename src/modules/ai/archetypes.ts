import type {
  BiomeId,
  DamageType,
  EliteAffix,
  EnemyArchetypeId,
  RoomType,
  StatusEffectType,
} from '../../contracts/types';
import { SeededRng } from '../../core/Constants';

export type TacticalRole =
  | 'melee'
  | 'ranged_kite'
  | 'heavy_slam'
  | 'blink_assassin'
  | 'summoner'
  | 'flee_goblin';

export interface ArchetypeConfig {
  id: EnemyArchetypeId;
  displayName: string;
  role: TacticalRole;
  baseHp: number;
  baseArmor: number;
  moveSpeed: number;
  attackDamage: number;
  damageType: DamageType;
  attackRange: number;
  attackCooldownSec: number;
  windupSec: number;
  recoverySec: number;
  radius: number;
  xpReward: number;
  aggroRange: number;
  kiteMinDist?: number;
  kiteOptimalDist?: number;
  projectileSpeed?: number;
  projectileRadius?: number;
  projectileColorHex?: number;
  projectileHoming?: boolean;
  slamRadius?: number;
  statusProc?: {
    type: StatusEffectType;
    chance: number;
    durationSec: number;
    potencyRatio: number;
  };
}

export const ARCHETYPE_CONFIGS: Record<EnemyArchetypeId, ArchetypeConfig> = {
  skeleton_warrior: {
    id: 'skeleton_warrior',
    displayName: 'Skeleton Warrior',
    role: 'melee',
    baseHp: 105,
    baseArmor: 16,
    moveSpeed: 3.6,
    attackDamage: 15,
    damageType: 'physical',
    attackRange: 1.85,
    attackCooldownSec: 1.35,
    windupSec: 0.38,
    recoverySec: 0.32,
    radius: 0.55,
    xpReward: 32,
    aggroRange: 13.5,
  },
  bone_archer: {
    id: 'bone_archer',
    displayName: 'Bone Archer',
    role: 'ranged_kite',
    baseHp: 82,
    baseArmor: 10,
    moveSpeed: 3.75,
    attackDamage: 15,
    damageType: 'physical',
    attackRange: 10.5,
    attackCooldownSec: 1.75,
    windupSec: 0.42,
    recoverySec: 0.28,
    radius: 0.5,
    xpReward: 34,
    aggroRange: 14.5,
    kiteMinDist: 4.5,
    kiteOptimalDist: 8.5,
    projectileSpeed: 15.5,
    projectileRadius: 0.26,
    projectileColorHex: 0xe9dfc4,
  },
  dark_cultist: {
    id: 'dark_cultist',
    displayName: 'Dark Cultist',
    role: 'ranged_kite',
    baseHp: 92,
    baseArmor: 12,
    moveSpeed: 3.5,
    attackDamage: 17,
    damageType: 'void',
    attackRange: 9.8,
    attackCooldownSec: 2.0,
    windupSec: 0.48,
    recoverySec: 0.32,
    radius: 0.52,
    xpReward: 36,
    aggroRange: 14.0,
    kiteMinDist: 4.2,
    kiteOptimalDist: 8.0,
    projectileSpeed: 11.5,
    projectileRadius: 0.34,
    projectileColorHex: 0xc92a2a,
    statusProc: {
      type: 'vulnerable',
      chance: 0.35,
      durationSec: 4.0,
      potencyRatio: 0.25,
    },
  },
  plague_spider: {
    id: 'plague_spider',
    displayName: 'Plague Spider',
    role: 'melee',
    baseHp: 88,
    baseArmor: 12,
    moveSpeed: 4.85,
    attackDamage: 13,
    damageType: 'poison',
    attackRange: 1.7,
    attackCooldownSec: 1.1,
    windupSec: 0.26,
    recoverySec: 0.24,
    radius: 0.52,
    xpReward: 32,
    aggroRange: 14.0,
    statusProc: {
      type: 'poison',
      chance: 0.65,
      durationSec: 4.0,
      potencyRatio: 0.22,
    },
  },
  abyssal_golem: {
    id: 'abyssal_golem',
    displayName: 'Abyssal Golem',
    role: 'heavy_slam',
    baseHp: 185,
    baseArmor: 36,
    moveSpeed: 2.55,
    attackDamage: 24,
    damageType: 'physical',
    attackRange: 2.5,
    attackCooldownSec: 2.4,
    windupSec: 0.72,
    recoverySec: 0.48,
    radius: 0.92,
    xpReward: 56,
    aggroRange: 13.0,
    slamRadius: 2.6,
    statusProc: {
      type: 'stun',
      chance: 0.28,
      durationSec: 0.65,
      potencyRatio: 1.0,
    },
  },
  void_assassin: {
    id: 'void_assassin',
    displayName: 'Void Assassin',
    role: 'blink_assassin',
    baseHp: 98,
    baseArmor: 14,
    moveSpeed: 4.7,
    attackDamage: 18,
    damageType: 'void',
    attackRange: 1.85,
    attackCooldownSec: 1.25,
    windupSec: 0.28,
    recoverySec: 0.26,
    radius: 0.52,
    xpReward: 44,
    aggroRange: 14.5,
    statusProc: {
      type: 'bleed',
      chance: 0.55,
      durationSec: 3.5,
      potencyRatio: 0.24,
    },
  },
  hellhound: {
    id: 'hellhound',
    displayName: 'Hellhound',
    role: 'melee',
    baseHp: 112,
    baseArmor: 16,
    moveSpeed: 5.05,
    attackDamage: 17,
    damageType: 'fire',
    attackRange: 1.8,
    attackCooldownSec: 1.15,
    windupSec: 0.3,
    recoverySec: 0.25,
    radius: 0.58,
    xpReward: 40,
    aggroRange: 14.5,
    statusProc: {
      type: 'burn',
      chance: 0.55,
      durationSec: 3.5,
      potencyRatio: 0.24,
    },
  },
  lich_summoner: {
    id: 'lich_summoner',
    displayName: 'Lich Summoner',
    role: 'summoner',
    baseHp: 125,
    baseArmor: 18,
    moveSpeed: 3.15,
    attackDamage: 18,
    damageType: 'ice',
    attackRange: 10.5,
    attackCooldownSec: 2.15,
    windupSec: 0.62,
    recoverySec: 0.35,
    radius: 0.6,
    xpReward: 54,
    aggroRange: 15.0,
    kiteMinDist: 4.0,
    kiteOptimalDist: 8.5,
    projectileSpeed: 10.2,
    projectileRadius: 0.36,
    projectileColorHex: 0x9775fa,
    projectileHoming: true,
    statusProc: {
      type: 'chill',
      chance: 0.55,
      durationSec: 2.5,
      potencyRatio: 0.35,
    },
  },
  frost_revenant: {
    id: 'frost_revenant',
    displayName: 'Frost Revenant',
    role: 'melee',
    baseHp: 132,
    baseArmor: 24,
    moveSpeed: 3.7,
    attackDamage: 18,
    damageType: 'ice',
    attackRange: 2.0,
    attackCooldownSec: 1.32,
    windupSec: 0.36,
    recoverySec: 0.3,
    radius: 0.6,
    xpReward: 48,
    aggroRange: 14.5,
    statusProc: {
      type: 'chill',
      chance: 0.65,
      durationSec: 3.0,
      potencyRatio: 0.35,
    },
  },
  ice_wraith: {
    id: 'ice_wraith',
    displayName: 'Ice Wraith',
    role: 'ranged_kite',
    baseHp: 96,
    baseArmor: 14,
    moveSpeed: 4.15,
    attackDamage: 19,
    damageType: 'ice',
    attackRange: 10.8,
    attackCooldownSec: 1.75,
    windupSec: 0.42,
    recoverySec: 0.28,
    radius: 0.54,
    xpReward: 46,
    aggroRange: 15.0,
    kiteMinDist: 4.6,
    kiteOptimalDist: 8.6,
    projectileSpeed: 13.8,
    projectileRadius: 0.32,
    projectileColorHex: 0x74c0fc,
    statusProc: {
      type: 'freeze',
      chance: 0.25,
      durationSec: 1.0,
      potencyRatio: 1.0,
    },
  },
  clockwork_automaton: {
    id: 'clockwork_automaton',
    displayName: 'Clockwork Automaton',
    role: 'heavy_slam',
    baseHp: 195,
    baseArmor: 40,
    moveSpeed: 2.85,
    attackDamage: 25,
    damageType: 'lightning',
    attackRange: 2.55,
    attackCooldownSec: 2.2,
    windupSec: 0.66,
    recoverySec: 0.44,
    radius: 0.88,
    xpReward: 62,
    aggroRange: 14.0,
    slamRadius: 2.75,
    statusProc: {
      type: 'stun',
      chance: 0.32,
      durationSec: 0.7,
      potencyRatio: 1.0,
    },
  },
  astral_weaver: {
    id: 'astral_weaver',
    displayName: 'Astral Weaver',
    role: 'ranged_kite',
    baseHp: 108,
    baseArmor: 16,
    moveSpeed: 3.7,
    attackDamage: 21,
    damageType: 'lightning',
    attackRange: 11.2,
    attackCooldownSec: 1.85,
    windupSec: 0.45,
    recoverySec: 0.3,
    radius: 0.55,
    xpReward: 56,
    aggroRange: 15.5,
    kiteMinDist: 4.5,
    kiteOptimalDist: 8.8,
    projectileSpeed: 12.8,
    projectileRadius: 0.35,
    projectileColorHex: 0xffd43b,
    projectileHoming: true,
    statusProc: {
      type: 'vulnerable',
      chance: 0.45,
      durationSec: 4.0,
      potencyRatio: 0.25,
    },
  },
  treasure_goblin: {
    id: 'treasure_goblin',
    displayName: 'Treasure Goblin',
    role: 'flee_goblin',
    baseHp: 165,
    baseArmor: 20,
    moveSpeed: 5.55,
    attackDamage: 8,
    damageType: 'physical',
    attackRange: 1.4,
    attackCooldownSec: 2.5,
    windupSec: 0.35,
    recoverySec: 0.3,
    radius: 0.5,
    xpReward: 95,
    aggroRange: 16.0,
    kiteMinDist: 12.0,
    kiteOptimalDist: 14.0,
  },
  chest_mimic: {
    id: 'chest_mimic',
    displayName: 'Ravenous Mimic',
    role: 'melee',
    baseHp: 175,
    baseArmor: 24,
    moveSpeed: 4.95,
    attackDamage: 22,
    damageType: 'physical',
    attackRange: 1.95,
    attackCooldownSec: 1.05,
    windupSec: 0.26,
    recoverySec: 0.24,
    radius: 0.65,
    xpReward: 78,
    aggroRange: 14.0,
    statusProc: {
      type: 'bleed',
      chance: 0.65,
      durationSec: 4.0,
      potencyRatio: 0.26,
    },
  },
};

export interface WeightedArchetype {
  id: EnemyArchetypeId;
  weight: number;
}

export const BIOME_MONSTER_POOLS: Record<BiomeId, readonly WeightedArchetype[]> = {
  sanctuary: [],
  crypt: [
    { id: 'skeleton_warrior', weight: 40 },
    { id: 'bone_archer', weight: 28 },
    { id: 'dark_cultist', weight: 20 },
    { id: 'lich_summoner', weight: 12 },
  ],
  caverns: [
    { id: 'plague_spider', weight: 40 },
    { id: 'bone_archer', weight: 18 },
    { id: 'dark_cultist', weight: 18 },
    { id: 'abyssal_golem', weight: 14 },
    { id: 'void_assassin', weight: 10 },
  ],
  forge: [
    { id: 'hellhound', weight: 36 },
    { id: 'abyssal_golem', weight: 24 },
    { id: 'dark_cultist', weight: 18 },
    { id: 'skeleton_warrior', weight: 12 },
    { id: 'lich_summoner', weight: 10 },
  ],
  void: [
    { id: 'void_assassin', weight: 30 },
    { id: 'lich_summoner', weight: 20 },
    { id: 'abyssal_golem', weight: 20 },
    { id: 'hellhound', weight: 15 },
    { id: 'dark_cultist', weight: 15 },
  ],
  cathedral: [
    { id: 'frost_revenant', weight: 42 },
    { id: 'ice_wraith', weight: 32 },
    { id: 'bone_archer', weight: 14 },
    { id: 'lich_summoner', weight: 12 },
  ],
  observatory: [
    { id: 'clockwork_automaton', weight: 38 },
    { id: 'astral_weaver', weight: 34 },
    { id: 'void_assassin', weight: 16 },
    { id: 'abyssal_golem', weight: 12 },
  ],
  colosseum: [
    { id: 'frost_revenant', weight: 18 },
    { id: 'clockwork_automaton', weight: 18 },
    { id: 'void_assassin', weight: 16 },
    { id: 'hellhound', weight: 16 },
    { id: 'astral_weaver', weight: 12 },
    { id: 'ice_wraith', weight: 10 },
    { id: 'abyssal_golem', weight: 10 },
  ],
};

export const ALL_ELITE_AFFIXES: readonly EliteAffix[] = [
  'vampiric',
  'molten',
  'frozen_pulse',
  'teleporter',
  'berserker',
  'arcane_enchanted',
];

export const AFFIX_LABELS: Record<EliteAffix, string> = {
  vampiric: 'Vampiric',
  molten: 'Molten',
  frozen_pulse: 'Frozen Pulse',
  teleporter: 'Teleporter',
  berserker: 'Berserker',
  arcane_enchanted: 'Arcane',
};

const ELITE_PREFIXES = [
  'Malgrim',
  'Vaelgor',
  'Dreadbone',
  'Kaelen',
  'Ashmaw',
  'Morvath',
  'Nyxara',
  'Thalgor',
  'Zareth',
  'Skorn',
  'Vorlag',
  'Grimhollow',
] as const;

const ELITE_EPITHETS = [
  'the Undying',
  'the Ravenous',
  'Soulrender',
  'Blightweaver',
  'Oathbreaker',
  'Doomcaller',
  'the Relentless',
  'Crownshatter',
] as const;

export function pickBiomeArchetype(biome: BiomeId, rng: SeededRng): EnemyArchetypeId {
  const pool = BIOME_MONSTER_POOLS[biome];
  if (!pool || pool.length === 0) {
    return 'skeleton_warrior';
  }
  let total = 0;
  for (const entry of pool) total += entry.weight;
  let roll = rng.next() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry.id;
  }
  return pool[0].id;
}

export function biomeForFloorNumber(floorNumber: number): BiomeId {
  if (floorNumber <= 0) return 'sanctuary';
  if (floorNumber === 1) return 'crypt';
  if (floorNumber === 2) return 'caverns';
  if (floorNumber === 3) return 'forge';
  if (floorNumber === 4) return 'void';
  if (floorNumber === 5) return 'cathedral';
  return 'observatory';
}

export function rollEliteAffixes(floorNumber: number, rng: SeededRng): EliteAffix[] {
  const minAffixes = floorNumber >= 3 ? 2 : 1;
  const maxAffixes = floorNumber <= 1 ? 2 : 3;
  const count = rng.int(minAffixes, maxAffixes);

  const available = [...ALL_ELITE_AFFIXES];
  const chosen: EliteAffix[] = [];
  while (chosen.length < count && available.length > 0) {
    const idx = rng.int(0, available.length - 1);
    chosen.push(available[idx]);
    available.splice(idx, 1);
  }
  return chosen;
}

export function generateEliteName(
  archetype: EnemyArchetypeId,
  affixes: EliteAffix[],
  rng: SeededRng,
): string {
  const prefix = rng.pick(ELITE_PREFIXES);
  const epithet = rng.pick(ELITE_EPITHETS);
  const baseTitle = ARCHETYPE_CONFIGS[archetype].displayName;
  const affixTag = affixes.map((a) => AFFIX_LABELS[a]).join(' • ');
  return `${prefix} ${epithet} (${baseTitle}${affixTag ? ` — ${affixTag}` : ''})`;
}

export interface RoomPackEntry {
  archetype: EnemyArchetypeId;
  isElite: boolean;
  affixes: EliteAffix[];
}

export function buildRoomMonsterPack(
  roomType: RoomType,
  biome: BiomeId,
  floorNumber: number,
  rng: SeededRng,
): RoomPackEntry[] {
  const pool = BIOME_MONSTER_POOLS[biome];
  if (!pool || pool.length === 0) {
    return [];
  }

  const entries: RoomPackEntry[] = [];
  const depthBonus = Math.min(2, Math.floor((Math.max(1, floorNumber) - 1) / 2));

  if (roomType === 'combat') {
    const normalCount = rng.int(3, 5) + depthBonus;
    for (let i = 0; i < normalCount; i++) {
      entries.push({
        archetype: pickBiomeArchetype(biome, rng),
        isElite: false,
        affixes: [],
      });
    }
    // Occasional Champion pack leader in regular combat rooms
    if (rng.chance(0.28 + Math.min(0.2, (Math.max(1, floorNumber) - 1) * 0.05))) {
      entries.push({
        archetype: pickBiomeArchetype(biome, rng),
        isElite: true,
        affixes: rollEliteAffixes(floorNumber, rng),
      });
    }
  } else if (roomType === 'elite') {
    const eliteCount = floorNumber >= 2 && rng.chance(0.55) ? 2 : 1;
    for (let i = 0; i < eliteCount; i++) {
      entries.push({
        archetype: pickBiomeArchetype(biome, rng),
        isElite: true,
        affixes: rollEliteAffixes(Math.max(2, floorNumber), rng),
      });
    }
    const minionCount = rng.int(3, 4) + depthBonus;
    for (let i = 0; i < minionCount; i++) {
      entries.push({
        archetype: pickBiomeArchetype(biome, rng),
        isElite: false,
        affixes: [],
      });
    }
  } else if (roomType === 'treasure') {
    // Treasure vault guarded by a Champion sentinel + pack
    entries.push({
      archetype: pickBiomeArchetype(biome, rng),
      isElite: true,
      affixes: rollEliteAffixes(floorNumber, rng),
    });
    const guardCount = rng.int(2, 4) + depthBonus;
    for (let i = 0; i < guardCount; i++) {
      entries.push({
        archetype: pickBiomeArchetype(biome, rng),
        isElite: false,
        affixes: [],
      });
    }
  } else if (roomType === 'cursed_event') {
    // Initial ritualists guarding the Cursed Chest before ambush waves start
    const cultistCount = rng.int(2, 4);
    for (let i = 0; i < cultistCount; i++) {
      const arch =
        i === 0 && (biome === 'crypt' || biome === 'forge' || biome === 'void')
          ? 'dark_cultist'
          : pickBiomeArchetype(biome, rng);
      const isLeaderElite = i === 0 && rng.chance(0.35);
      entries.push({
        archetype: arch,
        isElite: isLeaderElite,
        affixes: isLeaderElite ? rollEliteAffixes(floorNumber, rng) : [],
      });
    }
  }

  // Cap summoner count per single room pack to at most 2 so packs stay varied and brisk
  let summonerCount = 0;
  for (const entry of entries) {
    if (entry.archetype === 'lich_summoner') {
      summonerCount++;
      if (summonerCount > 2) {
        entry.archetype =
          biome === 'cathedral'
            ? 'frost_revenant'
            : biome === 'crypt'
              ? 'skeleton_warrior'
              : 'dark_cultist';
      }
    }
  }

  return entries;
}

export function computeScaledEnemyStats(
  cfg: ArchetypeConfig,
  floorNumber: number,
  isElite: boolean,
  affixes: EliteAffix[],
  hpMultiplier = 1.0,
): {
  maxHp: number;
  armor: number;
  moveSpeed: number;
  attackDamage: number;
  radius: number;
  xpReward: number;
  lootTierBonus: number;
} {
  const f = Math.max(1, floorNumber);
  const hpFloorScale =
    f <= 4 ? Math.pow(1.8, f - 1) : Math.pow(1.8, 3) * Math.pow(1.52, f - 4);
  const dmgFloorScale =
    f <= 4 ? Math.pow(1.58, f - 1) : Math.pow(1.58, 3) * Math.pow(1.38, f - 4);
  const armorFloorScale = 1 + (f - 1) * 1.45;
  const xpFloorScale =
    f <= 4 ? Math.pow(1.65, f - 1) : Math.pow(1.65, 3) * Math.pow(1.45, f - 4);

  const eliteHpMult = isElite ? 2.95 + affixes.length * 0.3 : 1.0;
  const eliteDmgMult = isElite ? 1.5 + affixes.length * 0.05 : 1.0;
  const eliteArmorMult = isElite ? 1.65 : 1.0;
  const eliteSpeedMult = isElite ? 1.08 : 1.0;
  const eliteRadiusMult = isElite ? 1.2 : 1.0;
  const eliteXpMult = isElite ? 3.0 + affixes.length * 0.35 : 1.0;

  const baseLootBonus = cfg.id === 'treasure_goblin' ? 3 : cfg.id === 'chest_mimic' ? 2 : 0;

  return {
    maxHp: Math.max(12, Math.round(cfg.baseHp * hpFloorScale * eliteHpMult * hpMultiplier)),
    armor: Math.round(cfg.baseArmor * armorFloorScale * eliteArmorMult),
    moveSpeed: Number((cfg.moveSpeed * eliteSpeedMult).toFixed(2)),
    attackDamage: Math.max(4, Math.round(cfg.attackDamage * dmgFloorScale * eliteDmgMult)),
    radius: Number((cfg.radius * eliteRadiusMult).toFixed(2)),
    xpReward: Math.max(5, Math.round(cfg.xpReward * xpFloorScale * eliteXpMult * hpMultiplier)),
    lootTierBonus: isElite ? Math.max(baseLootBonus, 2 + affixes.length) : baseLootBonus,
  };
}
