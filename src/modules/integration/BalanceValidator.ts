import type {
  Attributes,
  BiomeId,
  BossId,
  DerivedStats,
  DungeonFloorData,
  EnemyEntity,
  EquipSlot,
  GridCoord,
  HeroClassId,
  ItemAffix,
  ItemInstance,
  ItemRarity,
  PlayerRuntimeState,
  TileType,
} from '../../contracts/types';
import {
  BIOME_CONFIG,
  HERO_CLASS_CONFIG,
  MYTHIC_COLOR,
  RARITY_COLORS,
  SeededRng,
  clamp,
  distXZ,
} from '../../core/Constants';

export interface FloorValidationReport {
  valid: boolean;
  floorNumber: number;
  biome: BiomeId;
  seed: number;
  spawnWalkable: boolean;
  bossWalkable: boolean;
  portalWalkable: boolean;
  spawnToBossPathable: boolean;
  aStarPathFound: boolean;
  gridBfsReachable: boolean;
  spawnToBossPathLength: number;
  totalRooms: number;
  reachableRooms: number;
  allRoomsReachable: boolean;
  unreachableRoomIds: string[];
  totalInteractables: number;
  validInteractables: number;
  allInteractablesWalkable: boolean;
  invalidInteractableIds: string[];
  walkableTileRatio: number;
  errors: string[];
  warnings: string[];
}

export interface FloorCombatBenchmarkInput {
  floorNumber: number;
  biome: BiomeId;
  bossId: BossId;
  heroLevel: number;
  gearBonusMultiplier: number;
  mobHp: number;
  mobArmor: number;
  mobDamage: number;
  mobAttackIntervalSec: number;
  eliteHp: number;
  eliteArmor: number;
  eliteDamage: number;
  bossHp: number;
  bossArmor: number;
  bossDamage: number;
  bossAttackIntervalSec: number;
}

export interface ClassFloorSimulationResult {
  heroClass: HeroClassId;
  floorNumber: number;
  biome: BiomeId;
  heroLevel: number;
  playerDps: number;
  playerEhp: number;
  mobEhp: number;
  eliteEhp: number;
  bossEhp: number;
  mobTtkSec: number;
  eliteTtkSec: number;
  bossTtkSec: number;
  mobEnemyDps: number;
  bossEnemyDps: number;
  playerSurvivalVsMobSec: number;
  playerSurvivalVsBossSec: number;
  withinTargetBands: boolean;
  notes: string[];
}

export interface CombatSimulationReport {
  balanced: boolean;
  monotonicFloorEhpScaling: boolean;
  monotonicPlayerDpsScaling: boolean;
  results: ClassFloorSimulationResult[];
  anomalies: string[];
}

export interface LiveEncounterAudit {
  balanced: boolean;
  playerDps: number;
  playerEhp: number;
  livingEnemyCount: number;
  averageMobTtkSec: number;
  maxEliteTtkSec: number;
  bossTtkSec: number | null;
  warnings: string[];
}

export interface ItemAuditReport {
  valid: boolean;
  totalItems: number;
  mythicCount: number;
  rarityCounts: Record<ItemRarity, number>;
  averagePowerByRarity: Record<ItemRarity, number>;
  averageMythicPower: number;
  monotonicRarityScaling: boolean;
  monotonicItemLevelScaling: boolean;
  errors: string[];
  warnings: string[];
}

const WALKABLE_TILES: ReadonlySet<TileType> = new Set<TileType>([
  'floor',
  'corridor',
  'door',
  'hazard_lava',
  'hazard_poison',
  'hazard_ice',
  'teleporter_pad',
]);

const RARITY_ORDER: readonly ItemRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

const RARITY_AFFIX_BOUNDS: Record<ItemRarity, { min: number; max: number }> = {
  common: { min: 1, max: 2 },
  uncommon: { min: 1, max: 3 },
  rare: { min: 2, max: 4 },
  epic: { min: 3, max: 5 },
  legendary: { min: 3, max: 6 },
};

const VALID_SLOTS: ReadonlySet<EquipSlot> = new Set<EquipSlot>([
  'weapon',
  'offhand',
  'helmet',
  'chest',
  'gloves',
  'boots',
  'ring',
  'amulet',
]);

const STAT_POWER_WEIGHTS: Record<keyof (DerivedStats & Attributes), number> = {
  strength: 2.2,
  dexterity: 2.2,
  intelligence: 2.2,
  vitality: 2.0,
  maxHp: 0.25,
  hpRegen: 3.0,
  maxMana: 0.3,
  manaRegen: 3.5,
  maxStamina: 0.4,
  staminaRegen: 2.0,
  moveSpeed: 12.0,
  attackPower: 1.8,
  spellPower: 1.8,
  armor: 0.9,
  critChance: 220.0,
  critMultiplier: 95.0,
  attackSpeed: 140.0,
  cooldownReduction: 180.0,
  lifeSteal: 240.0,
  dodgeChance: 210.0,
};

export const DEFAULT_FLOOR_BENCHMARKS: readonly FloorCombatBenchmarkInput[] = [
  {
    floorNumber: 1,
    biome: 'crypt',
    bossId: 'bone_colossus',
    heroLevel: 1,
    gearBonusMultiplier: 1.0,
    mobHp: 110,
    mobArmor: 15,
    mobDamage: 16,
    mobAttackIntervalSec: 1.4,
    eliteHp: 380,
    eliteArmor: 35,
    eliteDamage: 28,
    bossHp: 1450,
    bossArmor: 50,
    bossDamage: 42,
    bossAttackIntervalSec: 1.8,
  },
  {
    floorNumber: 2,
    biome: 'caverns',
    bossId: 'arachne_broodmother',
    heroLevel: 4,
    gearBonusMultiplier: 1.45,
    mobHp: 220,
    mobArmor: 35,
    mobDamage: 28,
    mobAttackIntervalSec: 1.35,
    eliteHp: 760,
    eliteArmor: 65,
    eliteDamage: 46,
    bossHp: 2950,
    bossArmor: 85,
    bossDamage: 68,
    bossAttackIntervalSec: 1.7,
  },
  {
    floorNumber: 3,
    biome: 'forge',
    bossId: 'ignis_forgemaster',
    heroLevel: 7,
    gearBonusMultiplier: 2.05,
    mobHp: 390,
    mobArmor: 65,
    mobDamage: 44,
    mobAttackIntervalSec: 1.3,
    eliteHp: 1380,
    eliteArmor: 105,
    eliteDamage: 72,
    bossHp: 5400,
    bossArmor: 130,
    bossDamage: 102,
    bossAttackIntervalSec: 1.65,
  },
  {
    floorNumber: 4,
    biome: 'void',
    bossId: 'malakor_void_emperor',
    heroLevel: 10,
    gearBonusMultiplier: 2.85,
    mobHp: 640,
    mobArmor: 95,
    mobDamage: 66,
    mobAttackIntervalSec: 1.25,
    eliteHp: 2250,
    eliteArmor: 150,
    eliteDamage: 108,
    bossHp: 8900,
    bossArmor: 185,
    bossDamage: 148,
    bossAttackIntervalSec: 1.55,
  },
  {
    floorNumber: 5,
    biome: 'cathedral',
    bossId: 'valkyria_rime_seraph',
    heroLevel: 13,
    gearBonusMultiplier: 3.85,
    mobHp: 980,
    mobArmor: 130,
    mobDamage: 96,
    mobAttackIntervalSec: 1.2,
    eliteHp: 3450,
    eliteArmor: 195,
    eliteDamage: 155,
    bossHp: 13800,
    bossArmor: 240,
    bossDamage: 210,
    bossAttackIntervalSec: 1.5,
  },
  {
    floorNumber: 6,
    biome: 'observatory',
    bossId: 'chronos_time_architect',
    heroLevel: 16,
    gearBonusMultiplier: 5.1,
    mobHp: 1460,
    mobArmor: 170,
    mobDamage: 136,
    mobAttackIntervalSec: 1.15,
    eliteHp: 5150,
    eliteArmor: 250,
    eliteDamage: 215,
    bossHp: 20800,
    bossArmor: 305,
    bossDamage: 290,
    bossAttackIntervalSec: 1.45,
  },
];

export const TTK_TARGET_BANDS = {
  mobMinSec: 0.6,
  mobMaxSec: 10.0,
  eliteMinSec: 2.5,
  eliteMaxSec: 28.0,
  bossMinSec: 10.0,
  bossMaxSec: 110.0,
  minPlayerSurvivalVsMobSec: 4.0,
  minPlayerSurvivalVsBossSec: 2.5,
} as const;

export class BalanceValidator {
  /**
   * Computes hyperbolic armor damage reduction fraction in [0, 1).
   * Matches CombatEngine contract: `armor / (armor + 100)` for non-negative armor.
   */
  computeArmorMitigation(armor: number): number {
    if (!Number.isFinite(armor) || armor <= 0) return 0;
    return armor / (armor + 100);
  }

  /**
   * Resolves post-armor (and optional `vulnerable` +25%) damage dealt.
   */
  computeMitigatedDamage(rawDamage: number, armor: number, isVulnerable = false): number {
    if (!Number.isFinite(rawDamage) || rawDamage <= 0) return 0;
    const mitigation = this.computeArmorMitigation(armor);
    const vulnMultiplier = isVulnerable ? 1.25 : 1.0;
    return rawDamage * (1 - mitigation) * vulnMultiplier;
  }

  /**
   * Computes Effective Hit Points (EHP) factoring hyperbolic armor mitigation.
   */
  computeEffectiveHp(maxHp: number, armor: number): number {
    if (!Number.isFinite(maxHp) || maxHp <= 0) return 0;
    const safeArmor = Number.isFinite(armor) ? Math.max(0, armor) : 0;
    return maxHp * (1 + safeArmor / 100);
  }

  /**
   * Estimates sustained player unmitigated DPS factoring primary offense stat,
   * attack speed, critical hit expectation, skill multiplier, and cooldown weaving.
   */
  computePlayerDps(
    stats: Pick<
      DerivedStats,
      | 'attackPower'
      | 'spellPower'
      | 'attackSpeed'
      | 'critChance'
      | 'critMultiplier'
      | 'cooldownReduction'
    >,
    options?: { skillMultiplier?: number; preferSpellPower?: boolean },
  ): number {
    const skillMult = options?.skillMultiplier ?? 1.25;
    const offensivePower = options?.preferSpellPower
      ? stats.spellPower
      : Math.max(stats.attackPower, stats.spellPower);

    if (!Number.isFinite(offensivePower) || offensivePower <= 0) return 0;

    const attackSpeed = clamp(Number.isFinite(stats.attackSpeed) ? stats.attackSpeed : 1, 0.2, 10);
    const critChance = clamp(Number.isFinite(stats.critChance) ? stats.critChance : 0, 0, 1);
    const critMult = Math.max(1, Number.isFinite(stats.critMultiplier) ? stats.critMultiplier : 1.5);
    const cdr = clamp(
      Number.isFinite(stats.cooldownReduction) ? stats.cooldownReduction : 0,
      0,
      0.8,
    );

    const critFactor = 1 + critChance * (critMult - 1);
    const rotationalCdrBoost = 1 + cdr * 0.35;
    return offensivePower * skillMult * attackSpeed * critFactor * rotationalCdrBoost;
  }

  /**
   * Derives baseline hero stats for a given class, level, and gear progression scalar
   * so headless simulations can evaluate Floor 1-6 balance independently.
   */
  deriveBenchmarkHeroStats(
    heroClass: HeroClassId,
    level: number,
    gearBonusMultiplier = 1.0,
  ): DerivedStats {
    const cfg = HERO_CLASS_CONFIG[heroClass];
    const lvlOffset = Math.max(0, level - 1);

    const str = (cfg.baseAttributes.strength + lvlOffset * 2.2) * gearBonusMultiplier;
    const dex = (cfg.baseAttributes.dexterity + lvlOffset * 2.2) * gearBonusMultiplier;
    const int = (cfg.baseAttributes.intelligence + lvlOffset * 2.2) * gearBonusMultiplier;
    const vit = (cfg.baseAttributes.vitality + lvlOffset * 2.5) * gearBonusMultiplier;

    const maxHp = Math.round(140 + vit * 12 + lvlOffset * 24);
    const armor = Math.round(18 + str * 1.6 + vit * 0.9 + lvlOffset * 6);
    const attackPower = 18 + str * 2.1 + dex * 1.4;
    const spellPower = 18 + int * 2.5 + dex * 0.5;
    const attackSpeed = clamp(1.05 + dex * 0.012, 0.8, 2.8);
    const critChance = clamp(0.06 + dex * 0.006, 0.05, 0.7);
    const critMultiplier = 1.65 + (heroClass === 'shadowblade' ? 0.25 : 0.1);
    const cooldownReduction = clamp(0.04 + int * 0.005, 0, 0.55);
    const dodgeChance = clamp(0.03 + dex * 0.004, 0, 0.45);

    return {
      maxHp,
      hpRegen: 1.5 + vit * 0.15,
      maxMana: Math.round(80 + int * 8),
      manaRegen: 3.0 + int * 0.22,
      maxStamina: 100,
      staminaRegen: 18,
      moveSpeed: 6.5 + dex * 0.03,
      attackPower,
      spellPower,
      armor,
      critChance,
      critMultiplier,
      attackSpeed,
      cooldownReduction,
      lifeSteal: 0.02,
      dodgeChance,
    };
  }

  /**
   * Validates `DungeonFloorData` topological connectivity, room reachability,
   * spawn/boss/portal walkability, and interactable tile placement across all 8 `BiomeId`s
   * (including `'sanctuary'`, `'cathedral'` ice tiles, `'observatory'` teleporters, and `'colosseum'`).
   */
  validateFloor(floor: DungeonFloorData): FloorValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!BIOME_CONFIG[floor.biome]) {
      errors.push(`Unknown biome "${String(floor.biome)}".`);
    }

    if (floor.cols <= 0 || floor.rows <= 0 || floor.tileSize <= 0) {
      errors.push(
        `Invalid grid dimensions: cols=${floor.cols}, rows=${floor.rows}, tileSize=${floor.tileSize}.`,
      );
      return {
        valid: false,
        floorNumber: floor.floorNumber,
        biome: floor.biome,
        seed: floor.seed,
        spawnWalkable: false,
        bossWalkable: false,
        portalWalkable: false,
        spawnToBossPathable: false,
        aStarPathFound: false,
        gridBfsReachable: false,
        spawnToBossPathLength: 0,
        totalRooms: floor.rooms.length,
        reachableRooms: 0,
        allRoomsReachable: false,
        unreachableRoomIds: floor.rooms.map((r) => r.id),
        totalInteractables: floor.interactables.length,
        validInteractables: 0,
        allInteractablesWalkable: false,
        invalidInteractableIds: floor.interactables.map((i) => i.id),
        walkableTileRatio: 0,
        errors,
        warnings,
      };
    }

    if (floor.tiles.length !== floor.rows) {
      errors.push(`Tile row count mismatch: expected ${floor.rows}, got ${floor.tiles.length}.`);
    }

    let walkableTileCount = 0;
    const totalTiles = floor.cols * floor.rows;
    const teleporterPads: GridCoord[] = [];
    for (let r = 0; r < floor.tiles.length; r++) {
      const row = floor.tiles[r];
      if (!row || row.length !== floor.cols) {
        errors.push(`Tile col count mismatch at row ${r}.`);
        continue;
      }
      for (let c = 0; c < row.length; c++) {
        const t = row[c];
        if (WALKABLE_TILES.has(t)) {
          walkableTileCount++;
          if (t === 'teleporter_pad') {
            teleporterPads.push({ col: c, row: r });
          }
        }
      }
    }
    const walkableTileRatio = totalTiles > 0 ? walkableTileCount / totalTiles : 0;
    if (walkableTileRatio < 0.05) {
      warnings.push(
        `Very low walkable tile ratio (${(walkableTileRatio * 100).toFixed(1)}%).`,
      );
    }

    const isGridCellWalkable = (coord: GridCoord): boolean => {
      if (coord.row < 0 || coord.row >= floor.rows || coord.col < 0 || coord.col >= floor.cols) {
        return false;
      }
      const tile = floor.tiles[coord.row]?.[coord.col];
      return tile !== undefined && WALKABLE_TILES.has(tile);
    };

    const spawnGrid = floor.worldToGrid(floor.playerSpawn);
    const bossGrid = floor.worldToGrid(floor.bossSpawn);
    const portalGrid = floor.worldToGrid(floor.portalPosition);

    const spawnWalkable =
      isFiniteVec3(floor.playerSpawn) &&
      isGridCellWalkable(spawnGrid) &&
      floor.isWalkableWorld(floor.playerSpawn.x, floor.playerSpawn.z);
    if (!spawnWalkable) {
      errors.push(
        `playerSpawn (${fmtVec(floor.playerSpawn)}) is not on a walkable tile.`,
      );
    }

    const bossWalkable =
      isFiniteVec3(floor.bossSpawn) &&
      isGridCellWalkable(bossGrid) &&
      floor.isWalkableWorld(floor.bossSpawn.x, floor.bossSpawn.z);
    if (!bossWalkable) {
      errors.push(`bossSpawn (${fmtVec(floor.bossSpawn)}) is not on a walkable tile.`);
    }

    const portalWalkable =
      isFiniteVec3(floor.portalPosition) &&
      isGridCellWalkable(portalGrid) &&
      floor.isWalkableWorld(floor.portalPosition.x, floor.portalPosition.z);
    if (!portalWalkable) {
      errors.push(
        `portalPosition (${fmtVec(floor.portalPosition)}) is not on a walkable tile.`,
      );
    }

    // Flood-fill reachable grid tiles from playerSpawn via 4-directional steps + paired teleporter pads
    const reachableKeys = this.floodFillWalkable(floor, spawnGrid, teleporterPads);
    const coordKey = (c: GridCoord): string => `${c.col},${c.row}`;

    const gridBfsReachable =
      spawnWalkable && bossWalkable && reachableKeys.has(coordKey(bossGrid));

    const maxSteps = Math.max(2048, floor.cols * floor.rows);
    const path = spawnWalkable && bossWalkable
      ? floor.findPath(floor.playerSpawn, floor.bossSpawn, maxSteps)
      : [];

    const spawnBossSameTile =
      spawnGrid.col === bossGrid.col && spawnGrid.row === bossGrid.row;
    const lastWaypoint = path.length > 0 ? path[path.length - 1] : null;
    const pathReachesBoss =
      spawnBossSameTile ||
      (lastWaypoint !== null &&
        distXZ(lastWaypoint, floor.bossSpawn) <= floor.tileSize * 1.75);
    const pathWaypointsWalkable = path.every((pt) =>
      floor.isWalkableWorld(pt.x, pt.z),
    );

    const aStarPathFound =
      spawnWalkable &&
      bossWalkable &&
      (spawnBossSameTile ||
        (path.length > 0 && pathReachesBoss && pathWaypointsWalkable) ||
        (teleporterPads.length >= 2 && gridBfsReachable));

    const spawnToBossPathable = gridBfsReachable && aStarPathFound;
    if (!spawnToBossPathable) {
      errors.push(
        `No valid walkable path from playerSpawn to bossSpawn (gridBFS=${gridBfsReachable}, findPath=${aStarPathFound}).`,
      );
    }

    const isSpecialArenaOrHub =
      floor.biome === 'sanctuary' || floor.biome === 'colosseum';

    // Validate rooms
    if (floor.rooms.length === 0) {
      errors.push('Floor defines zero rooms.');
    } else if (!isSpecialArenaOrHub) {
      const hasSpawnRoom = floor.rooms.some((r) => r.type === 'spawn');
      const hasBossRoom = floor.rooms.some((r) => r.type === 'boss');
      if (!hasSpawnRoom) warnings.push('Floor has no room tagged with type "spawn".');
      if (!hasBossRoom) warnings.push('Floor has no room tagged with type "boss".');
    }

    const unreachableRoomIds: string[] = [];
    for (const room of floor.rooms) {
      const roomGrid = floor.worldToGrid(room.centerWorld);
      const centerWalkable =
        isFiniteVec3(room.centerWorld) &&
        isGridCellWalkable(roomGrid) &&
        floor.isWalkableWorld(room.centerWorld.x, room.centerWorld.z);
      const reachableByBfs = centerWalkable && reachableKeys.has(coordKey(roomGrid));

      if (!reachableByBfs) {
        unreachableRoomIds.push(room.id);
        errors.push(
          `Room "${room.id}" (${room.type}) at (${fmtVec(room.centerWorld)}) is unreachable from playerSpawn.`,
        );
      }
    }

    const reachableRooms = floor.rooms.length - unreachableRoomIds.length;
    const allRoomsReachable = floor.rooms.length > 0 && unreachableRoomIds.length === 0;

    // Validate interactables on walkable & reachable tiles
    const invalidInteractableIds: string[] = [];
    for (const prop of floor.interactables) {
      const propGrid = floor.worldToGrid(prop.position);
      const walkable =
        isFiniteVec3(prop.position) &&
        isGridCellWalkable(propGrid) &&
        floor.isWalkableWorld(prop.position.x, prop.position.z);
      const reachable = walkable && reachableKeys.has(coordKey(propGrid));

      if (!walkable || !reachable) {
        invalidInteractableIds.push(prop.id);
        errors.push(
          `Interactable "${prop.id}" (${prop.type}) at (${fmtVec(prop.position)}) is ${
            !walkable ? 'on a non-walkable tile' : 'unreachable from playerSpawn'
          }.`,
        );
      }
    }

    const validInteractables = floor.interactables.length - invalidInteractableIds.length;
    const allInteractablesWalkable = invalidInteractableIds.length === 0;

    return {
      valid: errors.length === 0,
      floorNumber: floor.floorNumber,
      biome: floor.biome,
      seed: floor.seed,
      spawnWalkable,
      bossWalkable,
      portalWalkable,
      spawnToBossPathable,
      aStarPathFound,
      gridBfsReachable,
      spawnToBossPathLength: path.length,
      totalRooms: floor.rooms.length,
      reachableRooms,
      allRoomsReachable,
      unreachableRoomIds,
      totalInteractables: floor.interactables.length,
      validInteractables,
      allInteractablesWalkable,
      invalidInteractableIds,
      walkableTileRatio,
      errors,
      warnings,
    };
  }

  /**
   * Simulates all 3 hero classes (`vanguard`, `shadowblade`, `arcanist`) across
   * Floors 1-6 (`crypt`, `caverns`, `forge`, `void`, `cathedral`, `observatory`)
   * or custom floor curve definitions, verifying EHP/armor mitigation, TTK target bands,
   * player survival time, and monotonic floor scaling.
   */
  simulateCombatCurves(
    customBenchmarks?: readonly FloorCombatBenchmarkInput[],
  ): CombatSimulationReport {
    const benchmarks =
      customBenchmarks && customBenchmarks.length > 0
        ? customBenchmarks
        : DEFAULT_FLOOR_BENCHMARKS;
    const heroClasses: readonly HeroClassId[] = ['vanguard', 'shadowblade', 'arcanist'];

    const results: ClassFloorSimulationResult[] = [];
    const anomalies: string[] = [];

    for (const heroClass of heroClasses) {
      let prevDps = 0;
      for (const floorCfg of benchmarks) {
        const stats = this.deriveBenchmarkHeroStats(
          heroClass,
          floorCfg.heroLevel,
          floorCfg.gearBonusMultiplier,
        );
        const playerDps = this.computePlayerDps(stats, {
          skillMultiplier: 1.25,
          preferSpellPower: heroClass === 'arcanist',
        });
        const playerEhp =
          this.computeEffectiveHp(stats.maxHp, stats.armor) /
          Math.max(0.25, 1 - clamp(stats.dodgeChance, 0, 0.75));

        const mobEhp = this.computeEffectiveHp(floorCfg.mobHp, floorCfg.mobArmor);
        const eliteEhp = this.computeEffectiveHp(floorCfg.eliteHp, floorCfg.eliteArmor);
        const bossEhp = this.computeEffectiveHp(floorCfg.bossHp, floorCfg.bossArmor);

        const safePlayerDps = Math.max(0.001, playerDps);
        const mobTtkSec = mobEhp / safePlayerDps;
        const eliteTtkSec = eliteEhp / safePlayerDps;
        const bossTtkSec = bossEhp / safePlayerDps;

        const mobMitigatedHit = this.computeMitigatedDamage(floorCfg.mobDamage, stats.armor);
        const bossMitigatedHit = this.computeMitigatedDamage(floorCfg.bossDamage, stats.armor);

        const mobEnemyDps =
          (mobMitigatedHit / Math.max(0.2, floorCfg.mobAttackIntervalSec)) *
          (1 - clamp(stats.dodgeChance, 0, 0.75));
        const bossEnemyDps =
          (bossMitigatedHit / Math.max(0.2, floorCfg.bossAttackIntervalSec)) *
          (1 - clamp(stats.dodgeChance, 0, 0.75));

        const playerSurvivalVsMobSec = stats.maxHp / Math.max(0.001, mobEnemyDps);
        const playerSurvivalVsBossSec = stats.maxHp / Math.max(0.001, bossEnemyDps);

        const notes: string[] = [];
        if (mobTtkSec < TTK_TARGET_BANDS.mobMinSec || mobTtkSec > TTK_TARGET_BANDS.mobMaxSec) {
          const msg = `[${heroClass} F${floorCfg.floorNumber}] Mob TTK ${mobTtkSec.toFixed(2)}s outside [${TTK_TARGET_BANDS.mobMinSec}s..${TTK_TARGET_BANDS.mobMaxSec}s].`;
          notes.push(msg);
          anomalies.push(msg);
        }
        if (
          eliteTtkSec < TTK_TARGET_BANDS.eliteMinSec ||
          eliteTtkSec > TTK_TARGET_BANDS.eliteMaxSec
        ) {
          const msg = `[${heroClass} F${floorCfg.floorNumber}] Elite TTK ${eliteTtkSec.toFixed(2)}s outside [${TTK_TARGET_BANDS.eliteMinSec}s..${TTK_TARGET_BANDS.eliteMaxSec}s].`;
          notes.push(msg);
          anomalies.push(msg);
        }
        if (
          bossTtkSec < TTK_TARGET_BANDS.bossMinSec ||
          bossTtkSec > TTK_TARGET_BANDS.bossMaxSec
        ) {
          const msg = `[${heroClass} F${floorCfg.floorNumber}] Boss TTK ${bossTtkSec.toFixed(2)}s outside [${TTK_TARGET_BANDS.bossMinSec}s..${TTK_TARGET_BANDS.bossMaxSec}s].`;
          notes.push(msg);
          anomalies.push(msg);
        }
        if (playerSurvivalVsMobSec < TTK_TARGET_BANDS.minPlayerSurvivalVsMobSec) {
          const msg = `[${heroClass} F${floorCfg.floorNumber}] Mob lethality too high: player survives ${playerSurvivalVsMobSec.toFixed(2)}s (< ${TTK_TARGET_BANDS.minPlayerSurvivalVsMobSec}s).`;
          notes.push(msg);
          anomalies.push(msg);
        }
        if (playerSurvivalVsBossSec < TTK_TARGET_BANDS.minPlayerSurvivalVsBossSec) {
          const msg = `[${heroClass} F${floorCfg.floorNumber}] Boss one-shot risk: player survives ${playerSurvivalVsBossSec.toFixed(2)}s (< ${TTK_TARGET_BANDS.minPlayerSurvivalVsBossSec}s).`;
          notes.push(msg);
          anomalies.push(msg);
        }

        if (prevDps > 0 && playerDps <= prevDps) {
          anomalies.push(
            `[${heroClass} F${floorCfg.floorNumber}] Non-increasing player DPS (${playerDps.toFixed(1)} <= ${prevDps.toFixed(1)}).`,
          );
        }
        prevDps = playerDps;

        results.push({
          heroClass,
          floorNumber: floorCfg.floorNumber,
          biome: floorCfg.biome,
          heroLevel: floorCfg.heroLevel,
          playerDps,
          playerEhp,
          mobEhp,
          eliteEhp,
          bossEhp,
          mobTtkSec,
          eliteTtkSec,
          bossTtkSec,
          mobEnemyDps,
          bossEnemyDps,
          playerSurvivalVsMobSec,
          playerSurvivalVsBossSec,
          withinTargetBands: notes.length === 0,
          notes,
        });
      }
    }

    // Check monotonic floor EHP scaling across sorted benchmark floors
    const sortedFloors = [...benchmarks].sort((a, b) => a.floorNumber - b.floorNumber);
    let monotonicFloorEhpScaling = true;
    for (let i = 1; i < sortedFloors.length; i++) {
      const prevBossEhp = this.computeEffectiveHp(
        sortedFloors[i - 1].bossHp,
        sortedFloors[i - 1].bossArmor,
      );
      const currBossEhp = this.computeEffectiveHp(
        sortedFloors[i].bossHp,
        sortedFloors[i].bossArmor,
      );
      const prevMobEhp = this.computeEffectiveHp(
        sortedFloors[i - 1].mobHp,
        sortedFloors[i - 1].mobArmor,
      );
      const currMobEhp = this.computeEffectiveHp(
        sortedFloors[i].mobHp,
        sortedFloors[i].mobArmor,
      );
      if (currBossEhp <= prevBossEhp || currMobEhp <= prevMobEhp) {
        monotonicFloorEhpScaling = false;
        anomalies.push(
          `Floor ${sortedFloors[i].floorNumber} EHP does not strictly exceed Floor ${sortedFloors[i - 1].floorNumber}.`,
        );
      }
    }

    let monotonicPlayerDpsScaling = true;
    for (const heroClass of heroClasses) {
      const classRows = results
        .filter((r) => r.heroClass === heroClass)
        .sort((a, b) => a.floorNumber - b.floorNumber);
      for (let i = 1; i < classRows.length; i++) {
        if (classRows[i].playerDps <= classRows[i - 1].playerDps) {
          monotonicPlayerDpsScaling = false;
        }
      }
    }

    return {
      balanced:
        anomalies.length === 0 && monotonicFloorEhpScaling && monotonicPlayerDpsScaling,
      monotonicFloorEhpScaling,
      monotonicPlayerDpsScaling,
      results,
      anomalies,
    };
  }

  /**
   * Evaluates live runtime entities (`PlayerRuntimeState` vs spawned `EnemyEntity[]` and active boss),
   * ignoring immortal Sanctuary Training Dummy targets (`id === 'training_dummy'`).
   */
  evaluateLiveFloorBalance(
    player: PlayerRuntimeState,
    enemies: readonly EnemyEntity[],
    boss?: EnemyEntity | null,
  ): LiveEncounterAudit {
    const warnings: string[] = [];
    const playerDps = Math.max(
      0.001,
      this.computePlayerDps(player.stats, {
        preferSpellPower: player.heroClass === 'arcanist',
      }),
    );
    const playerEhp = this.computeEffectiveHp(player.stats.maxHp, player.stats.armor);

    const living = enemies.filter((e) => e.alive && e.id !== 'training_dummy');
    const normalMobs = living.filter((e) => !e.isBoss && !e.isElite);
    const elites = living.filter((e) => !e.isBoss && e.isElite);

    const avgMobTtk =
      normalMobs.length > 0
        ? normalMobs.reduce(
            (sum, m) => sum + this.computeEffectiveHp(m.maxHp, m.armor) / playerDps,
            0,
          ) / normalMobs.length
        : 0;

    const maxEliteTtk =
      elites.length > 0
        ? Math.max(
            ...elites.map((e) => this.computeEffectiveHp(e.maxHp, e.armor) / playerDps),
          )
        : 0;

    const activeBoss = boss ?? living.find((e) => e.isBoss) ?? null;
    const bossTtkSec = activeBoss
      ? this.computeEffectiveHp(activeBoss.maxHp, activeBoss.armor) / playerDps
      : null;

    if (normalMobs.length > 0 && (avgMobTtk < 0.3 || avgMobTtk > 15)) {
      warnings.push(`Live average mob TTK (${avgMobTtk.toFixed(2)}s) is out of nominal range.`);
    }
    if (elites.length > 0 && maxEliteTtk > 40) {
      warnings.push(`Live elite max TTK (${maxEliteTtk.toFixed(2)}s) exceeds 40s threshold.`);
    }
    if (bossTtkSec !== null && (bossTtkSec < 5 || bossTtkSec > 150)) {
      warnings.push(`Live boss TTK (${bossTtkSec.toFixed(2)}s) is out of nominal range.`);
    }

    return {
      balanced: warnings.length === 0,
      playerDps,
      playerEhp,
      livingEnemyCount: living.length,
      averageMobTtkSec: avgMobTtk,
      maxEliteTtkSec: maxEliteTtk,
      bossTtkSec,
      warnings,
    };
  }

  /**
   * Computes a normalized power budget score for an `ItemInstance` factoring
   * affix weights, Mythic Primal / Runeword / Set bonuses, and blacksmith upgrade scaling (`+12%` per rank).
   */
  computeItemPowerScore(item: ItemInstance, normalizeUpgrade = false): number {
    let rawScore = 0;
    for (const affix of item.affixes) {
      if (!Number.isFinite(affix.value) || affix.value <= 0) continue;
      const weight = STAT_POWER_WEIGHTS[affix.statKey] ?? 1.0;
      const effectiveValue =
        affix.isPercent && affix.value > 1 ? affix.value / 100 : affix.value;
      rawScore += effectiveValue * weight;
    }
    if (item.legendaryPower) {
      rawScore += 18 + item.itemLevel * 2.5;
    }
    if (item.isMythic) {
      rawScore += 32 + item.itemLevel * 4.0;
    }
    if (item.runewordId) {
      rawScore += 22 + item.itemLevel * 2.0;
    }
    if (normalizeUpgrade && item.upgradeLevel > 0) {
      return rawScore / (1 + 0.12 * item.upgradeLevel);
    }
    return rawScore;
  }

  /**
   * Computes expected Blacksmith upgraded affix value (`+12%` per upgrade rank, `0..10`).
   */
  computeUpgradedAffixValue(baseValue: number, upgradeLevel: number): number {
    const clampedRank = clamp(Math.floor(upgradeLevel), 0, 10);
    return baseValue * (1 + 0.12 * clampedRank);
  }

  /**
   * Audits a collection of `ItemInstance` drops for schema integrity, affix bounds,
   * Mythic Primal & socket/runeword validity, legendary power presence, monotonic rarity progression,
   * and itemLevel scaling.
   */
  auditItems(items: readonly ItemInstance[]): ItemAuditReport {
    const errors: string[] = [];
    const warnings: string[] = [];

    const rarityCounts: Record<ItemRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };
    const rarityScoreSums: Record<ItemRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };
    let mythicCount = 0;
    let mythicScoreSum = 0;

    // Group normalized non-mythic base scores by rarity -> itemLevel for level scaling checks
    const byRarityAndLevel = new Map<ItemRarity, Map<number, number[]>>();

    if (items.length === 0) {
      errors.push('Item audit received an empty item array.');
    }

    for (const item of items) {
      if (!item.id || !item.name.trim()) {
        errors.push(`Item "${item.id || '<missing-id>'}" has empty id or name.`);
      }
      if (!RARITY_COLORS[item.rarity]) {
        errors.push(`Item "${item.id}" has invalid rarity "${String(item.rarity)}".`);
        continue;
      }
      if (!VALID_SLOTS.has(item.slot)) {
        errors.push(`Item "${item.id}" has invalid equip slot "${String(item.slot)}".`);
      }
      if (!Number.isFinite(item.itemLevel) || item.itemLevel < 1) {
        errors.push(`Item "${item.id}" has invalid itemLevel (${item.itemLevel}).`);
      }
      if (!Number.isFinite(item.levelReq) || item.levelReq < 1) {
        errors.push(`Item "${item.id}" has invalid levelReq (${item.levelReq}).`);
      }
      if (item.levelReq > item.itemLevel + 2) {
        warnings.push(
          `Item "${item.id}" levelReq (${item.levelReq}) exceeds itemLevel (${item.itemLevel}) + 2.`,
        );
      }
      if (
        !Number.isInteger(item.upgradeLevel) ||
        item.upgradeLevel < 0 ||
        item.upgradeLevel > 10
      ) {
        errors.push(
          `Item "${item.id}" upgradeLevel (${item.upgradeLevel}) outside valid [0..10] range.`,
        );
      }
      if (!Number.isFinite(item.goldValue) || item.goldValue < 0) {
        errors.push(`Item "${item.id}" has invalid goldValue (${item.goldValue}).`);
      }

      if (item.sockets !== undefined) {
        if (!Number.isInteger(item.sockets) || item.sockets < 0 || item.sockets > 6) {
          errors.push(`Item "${item.id}" has invalid socket count (${item.sockets}).`);
        } else if (item.socketedRunes && item.socketedRunes.length > item.sockets) {
          errors.push(
            `Item "${item.id}" has ${item.socketedRunes.length} socketed runes exceeding ${item.sockets} sockets.`,
          );
        }
      }

      const bounds = item.isMythic
        ? { min: 5, max: 7 }
        : RARITY_AFFIX_BOUNDS[item.rarity];
      if (item.affixes.length < bounds.min || item.affixes.length > bounds.max) {
        errors.push(
          `Item "${item.id}" (${item.isMythic ? MYTHIC_COLOR.label : item.rarity}) has ${item.affixes.length} affixes; expected [${bounds.min}..${bounds.max}].`,
        );
      }

      for (const affix of item.affixes) {
        if (!Number.isFinite(affix.value) || affix.value <= 0) {
          errors.push(
            `Item "${item.id}" affix "${affix.label}" (${String(affix.statKey)}) has non-positive or NaN value (${affix.value}).`,
          );
        }
        if (!(affix.statKey in STAT_POWER_WEIGHTS)) {
          errors.push(
            `Item "${item.id}" affix uses unknown statKey "${String(affix.statKey)}".`,
          );
        }
      }

      if (
        (item.rarity === 'legendary' || item.isMythic) &&
        (!item.legendaryPower ||
          !item.legendaryPower.id.trim() ||
          !item.legendaryPower.description.trim())
      ) {
        errors.push(`Legendary/Mythic item "${item.id}" is missing a valid legendaryPower definition.`);
      }

      if (item.slot !== 'weapon' && item.slot !== 'offhand' && item.weaponVisual) {
        warnings.push(
          `Non-weapon item "${item.id}" (${item.slot}) unexpectedly defines weaponVisual "${item.weaponVisual}".`,
        );
      }

      const basePower = this.computeItemPowerScore(item, true);
      if (item.isMythic) {
        mythicCount++;
        mythicScoreSum += basePower;
      } else {
        rarityCounts[item.rarity]++;
        rarityScoreSums[item.rarity] += basePower;

        let lvlMap = byRarityAndLevel.get(item.rarity);
        if (!lvlMap) {
          lvlMap = new Map<number, number[]>();
          byRarityAndLevel.set(item.rarity, lvlMap);
        }
        const bucket = lvlMap.get(item.itemLevel) ?? [];
        bucket.push(basePower);
        lvlMap.set(item.itemLevel, bucket);
      }
    }

    const averagePowerByRarity: Record<ItemRarity, number> = {
      common: rarityCounts.common > 0 ? rarityScoreSums.common / rarityCounts.common : 0,
      uncommon:
        rarityCounts.uncommon > 0 ? rarityScoreSums.uncommon / rarityCounts.uncommon : 0,
      rare: rarityCounts.rare > 0 ? rarityScoreSums.rare / rarityCounts.rare : 0,
      epic: rarityCounts.epic > 0 ? rarityScoreSums.epic / rarityCounts.epic : 0,
      legendary:
        rarityCounts.legendary > 0 ? rarityScoreSums.legendary / rarityCounts.legendary : 0,
    };
    const averageMythicPower = mythicCount > 0 ? mythicScoreSum / mythicCount : 0;

    // Verify monotonic rarity scaling across all populated rarities (+ Mythic > Legendary when present)
    let monotonicRarityScaling = true;
    const populatedRarities = RARITY_ORDER.filter((r) => rarityCounts[r] > 0);
    for (let i = 1; i < populatedRarities.length; i++) {
      const prevR = populatedRarities[i - 1];
      const currR = populatedRarities[i];
      if (averagePowerByRarity[currR] <= averagePowerByRarity[prevR]) {
        monotonicRarityScaling = false;
        errors.push(
          `Rarity scaling inversion: ${currR} avg power (${averagePowerByRarity[currR].toFixed(2)}) <= ${prevR} avg power (${averagePowerByRarity[prevR].toFixed(2)}).`,
        );
      }
    }
    if (
      mythicCount > 0 &&
      rarityCounts.legendary > 0 &&
      averageMythicPower <= averagePowerByRarity.legendary
    ) {
      monotonicRarityScaling = false;
      errors.push(
        `Mythic scaling inversion: Mythic avg (${averageMythicPower.toFixed(2)}) <= Legendary avg (${averagePowerByRarity.legendary.toFixed(2)}).`,
      );
    }

    // Verify monotonic itemLevel scaling within each rarity
    let monotonicItemLevelScaling = true;
    for (const [rarity, lvlMap] of byRarityAndLevel.entries()) {
      const levels = [...lvlMap.keys()].sort((a, b) => a - b);
      for (let i = 1; i < levels.length; i++) {
        const prevLvl = levels[i - 1];
        const currLvl = levels[i];
        const prevAvg = average(lvlMap.get(prevLvl) ?? []);
        const currAvg = average(lvlMap.get(currLvl) ?? []);
        if (currAvg <= prevAvg) {
          monotonicItemLevelScaling = false;
          errors.push(
            `ItemLevel scaling inversion for ${rarity}: ilvl ${currLvl} avg (${currAvg.toFixed(2)}) <= ilvl ${prevLvl} avg (${prevAvg.toFixed(2)}).`,
          );
        }
      }
    }

    return {
      valid: errors.length === 0 && monotonicRarityScaling && monotonicItemLevelScaling,
      totalItems: items.length,
      mythicCount,
      rarityCounts,
      averagePowerByRarity,
      averageMythicPower,
      monotonicRarityScaling,
      monotonicItemLevelScaling,
      errors,
      warnings,
    };
  }

  /**
   * Generates a deterministic synthetic benchmark sample across all 5 rarities, Mythic Primal tier,
   * and Floor 1-6 item levels (1, 4, 7, 10, 13, 16) for standalone progression curve verification.
   */
  generateSyntheticItemSample(seed = 777, includeMythics = false): ItemInstance[] {
    const rng = new SeededRng(seed);
    const levels = [1, 4, 7, 10, 13, 16];
    const rarityAffixCount: Record<ItemRarity, number> = {
      common: 1,
      uncommon: 2,
      rare: 3,
      epic: 4,
      legendary: 5,
    };
    const rarityScale: Record<ItemRarity, number> = {
      common: 1.0,
      uncommon: 1.3,
      rare: 1.7,
      epic: 2.25,
      legendary: 2.95,
    };
    const slots: readonly EquipSlot[] = [
      'weapon',
      'offhand',
      'helmet',
      'chest',
      'gloves',
      'boots',
      'ring',
      'amulet',
    ];
    const affixPool: ReadonlyArray<{
      label: string;
      statKey: keyof (DerivedStats & Attributes);
      base: number;
      perLevel: number;
      isPercent?: boolean;
    }> = [
      { label: 'Attack Power', statKey: 'attackPower', base: 5, perLevel: 2.4 },
      { label: 'Spell Power', statKey: 'spellPower', base: 5, perLevel: 2.4 },
      { label: 'Strength', statKey: 'strength', base: 3, perLevel: 1.5 },
      { label: 'Dexterity', statKey: 'dexterity', base: 3, perLevel: 1.5 },
      { label: 'Intelligence', statKey: 'intelligence', base: 3, perLevel: 1.5 },
      { label: 'Vitality', statKey: 'vitality', base: 4, perLevel: 1.8 },
      { label: 'Max Health', statKey: 'maxHp', base: 24, perLevel: 12 },
      { label: 'Armor', statKey: 'armor', base: 8, perLevel: 4 },
    ];

    const out: ItemInstance[] = [];
    let counter = 1;

    for (const ilvl of levels) {
      for (const rarity of RARITY_ORDER) {
        for (let sample = 0; sample < 3; sample++) {
          const slot = slots[(counter - 1) % slots.length];
          const count = rarityAffixCount[rarity];
          const affixes: ItemAffix[] = [];
          for (let a = 0; a < count; a++) {
            const template = affixPool[(a + sample) % affixPool.length];
            const jitter = rng.range(0.95, 1.05);
            const val = Number(
              ((template.base + ilvl * template.perLevel) * rarityScale[rarity] * jitter).toFixed(2),
            );
            affixes.push({
              label: `+${val} ${template.label}`,
              statKey: template.statKey,
              value: val,
              isPercent: template.isPercent,
            });
          }

          out.push({
            id: `bench_item_${counter++}`,
            name: `${RARITY_COLORS[rarity].label} Relic ${ilvl}`,
            slot,
            rarity,
            levelReq: Math.max(1, ilvl - 1),
            itemLevel: ilvl,
            upgradeLevel: 0,
            weaponVisual: slot === 'weapon' ? 'greatsword' : undefined,
            affixes,
            legendaryPower:
              rarity === 'legendary'
                ? {
                    id: `leg_power_${ilvl}`,
                    description: 'Unleashes an abyssal shockwave on critical strikes.',
                  }
                : undefined,
            goldValue: Math.round(25 * ilvl * rarityScale[rarity]),
            icon: slot,
          });
        }
      }

      if (includeMythics) {
        const slot = slots[(counter - 1) % slots.length];
        const mythicScale = 4.1;
        const affixes: ItemAffix[] = [];
        for (let a = 0; a < 6; a++) {
          const template = affixPool[a % affixPool.length];
          const val = Number(((template.base + ilvl * template.perLevel) * mythicScale).toFixed(2));
          affixes.push({
            label: `+${val} ${template.label}`,
            statKey: template.statKey,
            value: val,
          });
        }
        out.push({
          id: `bench_mythic_${counter++}`,
          name: `${MYTHIC_COLOR.label} Sovereign ${ilvl}`,
          slot,
          rarity: 'legendary',
          isMythic: true,
          levelReq: Math.max(1, ilvl - 1),
          itemLevel: ilvl,
          upgradeLevel: 0,
          weaponVisual: slot === 'weapon' ? 'greatsword' : undefined,
          affixes,
          sockets: 3,
          socketedRunes: ['jah', 'ber'],
          legendaryPower: {
            id: `mythic_power_${ilvl}`,
            description: 'Tears open a primal crimson singularity on execution strikes.',
          },
          goldValue: Math.round(60 * ilvl * mythicScale),
          icon: slot,
        });
      }
    }

    return out;
  }

  private floodFillWalkable(
    floor: DungeonFloorData,
    start: GridCoord,
    teleporterPads: readonly GridCoord[],
  ): Set<string> {
    const visited = new Set<string>();
    if (
      start.row < 0 ||
      start.row >= floor.rows ||
      start.col < 0 ||
      start.col >= floor.cols
    ) {
      return visited;
    }
    const startTile = floor.tiles[start.row]?.[start.col];
    if (!startTile || !WALKABLE_TILES.has(startTile)) {
      return visited;
    }

    const queue: GridCoord[] = [start];
    let head = 0;
    visited.add(`${start.col},${start.row}`);
    let teleportersExpanded = false;

    const dirs: readonly [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    while (head < queue.length) {
      const curr = queue[head++];
      const currTile = floor.tiles[curr.row]?.[curr.col];

      // Stepping onto any teleporter_pad links to its paired teleporter_pad(s) on Observatory floors
      if (currTile === 'teleporter_pad' && !teleportersExpanded && teleporterPads.length >= 2) {
        teleportersExpanded = true;
        for (const pad of teleporterPads) {
          const pk = `${pad.col},${pad.row}`;
          if (!visited.has(pk)) {
            visited.add(pk);
            queue.push(pad);
          }
        }
      }

      for (const [dc, dr] of dirs) {
        const nc = curr.col + dc;
        const nr = curr.row + dr;
        if (nc < 0 || nc >= floor.cols || nr < 0 || nr >= floor.rows) continue;
        const key = `${nc},${nr}`;
        if (visited.has(key)) continue;
        const tile = floor.tiles[nr]?.[nc];
        if (tile && WALKABLE_TILES.has(tile)) {
          visited.add(key);
          queue.push({ col: nc, row: nr });
        }
      }
    }

    return visited;
  }
}

function isFiniteVec3(v: { x: number; y: number; z: number } | null | undefined): boolean {
  return (
    !!v &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z)
  );
}

function fmtVec(v: { x: number; y: number; z: number }): string {
  return `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
}

function average(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  let sum = 0;
  for (const n of nums) sum += n;
  return sum / nums.length;
}

export function createBalanceValidator(): BalanceValidator {
  return new BalanceValidator();
}
