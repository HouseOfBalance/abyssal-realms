import { describe, expect, it, vi } from 'vitest';
import type {
  BiomeId,
  DungeonFloorData,
  DungeonRoom,
  EnemyEntity,
  GridCoord,
  InteractableProp,
  ItemInstance,
  PlayerRuntimeState,
  TileType,
  Vec3,
} from '../../contracts/types';
import {
  BIOME_CONFIG,
  DAMAGE_TYPE_COLORS,
  HERO_CLASS_CONFIG,
  MYTHIC_COLOR,
  RARITY_COLORS,
  SeededRng,
  clamp,
  distXZ,
} from '../../core/Constants';
import { TypedEventBus } from '../../core/EventBus';
import {
  BalanceValidator,
  DEFAULT_FLOOR_BENCHMARKS,
  DebugOverlay,
  TTK_TARGET_BANDS,
  createBalanceValidator,
  createDebugOverlay,
  type FloorCombatBenchmarkInput,
} from './index';

/**
 * Helper that builds a self-contained synthetic `DungeonFloorData` for headless topological testing,
 * supporting all 8 `BiomeId`s, `'hazard_ice'`, and paired `'teleporter_pad'` tiles.
 */
function buildSyntheticFloor(options?: {
  floorNumber?: number;
  biome?: BiomeId;
  sealBossCorridor?: boolean;
  bridgeBossWithTeleporters?: boolean;
  useIceNave?: boolean;
  isolateShrineRoom?: boolean;
  wallInteractable?: boolean;
  wallPlayerSpawn?: boolean;
  singleHubArena?: boolean;
}): DungeonFloorData {
  const cols = 26;
  const rows = 20;
  const tileSize = 2.0;
  const biome: BiomeId = options?.biome ?? 'crypt';
  const floorNumber = options?.floorNumber ?? 1;

  const tiles: TileType[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 'wall' as TileType),
  );
  const explored: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false),
  );

  const carveRect = (x0: number, y0: number, w: number, h: number, type: TileType = 'floor') => {
    for (let r = y0; r < y0 + h; r++) {
      for (let c = x0; c < x0 + w; c++) {
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          tiles[r][c] = type;
        }
      }
    }
  };

  const gridToWorld = (col: number, row: number): Vec3 => ({
    x: (col + 0.5) * tileSize,
    y: 0,
    z: (row + 0.5) * tileSize,
  });

  const worldToGrid = (worldPos: Vec3): GridCoord => ({
    col: Math.floor(worldPos.x / tileSize),
    row: Math.floor(worldPos.z / tileSize),
  });

  const walkableSet = new Set<TileType>([
    'floor',
    'corridor',
    'door',
    'hazard_lava',
    'hazard_poison',
    'hazard_ice',
    'teleporter_pad',
  ]);

  const isWalkableWorld = (x: number, z: number): boolean => {
    const col = Math.floor(x / tileSize);
    const row = Math.floor(z / tileSize);
    if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
    return walkableSet.has(tiles[row][col]);
  };

  if (options?.singleHubArena) {
    carveRect(4, 4, 18, 12, 'floor');
  } else {
    const combatFloorTile: TileType = options?.useIceNave ? 'hazard_ice' : 'floor';
    // Carve 4 rooms: spawn (left), combat/nave (center), shrine (north), boss (right)
    carveRect(2, 8, 4, 4, 'floor'); // center grid (4, 10)
    carveRect(10, 8, 5, 4, combatFloorTile); // center grid (12, 10)
    carveRect(10, 2, 4, 3, 'floor'); // center grid (12, 3)
    carveRect(19, 7, 5, 6, 'floor'); // center grid (21, 10)

    // Horizontal corridor from spawn -> combat -> boss (rows 9..10)
    carveRect(6, 9, 4, 2, 'corridor');
    if (!options?.sealBossCorridor) {
      carveRect(15, 9, 4, 2, 'corridor');
    } else if (options?.bridgeBossWithTeleporters) {
      tiles[10][14] = 'teleporter_pad';
      tiles[10][19] = 'teleporter_pad';
    }

    // Vertical corridor from shrine -> combat (cols 11..12, rows 5..7)
    if (!options?.isolateShrineRoom) {
      carveRect(11, 5, 2, 3, 'corridor');
    }
  }

  const findPath = (fromWorld: Vec3, toWorld: Vec3, maxSteps = 1024): Vec3[] => {
    const start = worldToGrid(fromWorld);
    const goal = worldToGrid(toWorld);
    if (
      !isWalkableWorld(fromWorld.x, fromWorld.z) ||
      !isWalkableWorld(toWorld.x, toWorld.z)
    ) {
      return [];
    }
    if (start.col === goal.col && start.row === goal.row) {
      return [gridToWorld(goal.col, goal.row)];
    }

    const key = (c: number, r: number) => `${c},${r}`;
    const parent = new Map<string, GridCoord | null>();
    const queue: GridCoord[] = [start];
    parent.set(key(start.col, start.row), null);

    const dirs: readonly [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    let head = 0;
    let steps = 0;
    let found = false;

    while (head < queue.length && steps < maxSteps) {
      steps++;
      const cur = queue[head++];
      if (cur.col === goal.col && cur.row === goal.row) {
        found = true;
        break;
      }
      for (const [dc, dr] of dirs) {
        const nc = cur.col + dc;
        const nr = cur.row + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const k = key(nc, nr);
        if (parent.has(k) || !walkableSet.has(tiles[nr][nc])) continue;
        parent.set(k, cur);
        queue.push({ col: nc, row: nr });
      }
    }

    if (!found) return [];

    const out: Vec3[] = [];
    let curr: GridCoord | null = goal;
    while (curr) {
      out.push(gridToWorld(curr.col, curr.row));
      curr = parent.get(key(curr.col, curr.row)) ?? null;
    }
    out.reverse();
    return out;
  };

  const rooms: DungeonRoom[] = options?.singleHubArena
    ? [
        {
          id: 'room_hub_plaza',
          type: 'spawn',
          x: 4,
          y: 4,
          width: 18,
          height: 12,
          centerGrid: { col: 13, row: 10 },
          centerWorld: gridToWorld(13, 10),
          connectedRoomIds: [],
          cleared: true,
        },
      ]
    : [
        {
          id: 'room_spawn',
          type: 'spawn',
          x: 2,
          y: 8,
          width: 4,
          height: 4,
          centerGrid: { col: 4, row: 10 },
          centerWorld: gridToWorld(4, 10),
          connectedRoomIds: ['room_combat'],
          cleared: true,
        },
        {
          id: 'room_combat',
          type: 'combat',
          x: 10,
          y: 8,
          width: 5,
          height: 4,
          centerGrid: { col: 12, row: 10 },
          centerWorld: gridToWorld(12, 10),
          connectedRoomIds: ['room_spawn', 'room_shrine', 'room_boss'],
          cleared: false,
        },
        {
          id: 'room_shrine',
          type: 'shrine',
          x: 10,
          y: 2,
          width: 4,
          height: 3,
          centerGrid: { col: 12, row: 3 },
          centerWorld: gridToWorld(12, 3),
          connectedRoomIds: ['room_combat'],
          cleared: true,
        },
        {
          id: 'room_boss',
          type: 'boss',
          x: 19,
          y: 7,
          width: 5,
          height: 6,
          centerGrid: { col: 21, row: 10 },
          centerWorld: gridToWorld(21, 10),
          connectedRoomIds: ['room_combat'],
          cleared: false,
        },
      ];

  const playerSpawn = options?.wallPlayerSpawn
    ? gridToWorld(0, 0)
    : options?.singleHubArena
      ? gridToWorld(8, 10)
      : gridToWorld(4, 10);
  const bossSpawn = options?.singleHubArena ? gridToWorld(16, 10) : gridToWorld(21, 10);
  const portalPosition = options?.singleHubArena ? gridToWorld(18, 10) : gridToWorld(22, 10);

  const interactables: InteractableProp[] = options?.singleHubArena
    ? [
        {
          id: 'hub_stash',
          type: 'stash_chest',
          position: gridToWorld(10, 8),
          roomId: 'room_hub_plaza',
          used: false,
          label: 'Shared Sovereign Stash',
        },
        {
          id: 'hub_waypoint',
          type: 'waypoint_map',
          position: gridToWorld(13, 10),
          roomId: 'room_hub_plaza',
          used: false,
          label: 'Waypoint Atlas',
        },
        {
          id: 'hub_dummy',
          type: 'training_dummy',
          position: gridToWorld(16, 12),
          roomId: 'room_hub_plaza',
          used: false,
          label: 'Immortal Combat Dummy',
        },
      ]
    : [
        {
          id: 'anvil_spawn',
          type: 'blacksmith_anvil',
          position: gridToWorld(3, 9),
          roomId: 'room_spawn',
          used: false,
          label: 'Runed Blacksmith Anvil',
        },
        {
          id: 'obelisk_1',
          type: 'corrupted_obelisk',
          position: gridToWorld(12, 9),
          roomId: 'room_combat',
          used: false,
          label: 'Corrupted Blood Obelisk',
        },
        {
          id: 'shrine_1',
          type: 'shrine_heal',
          position: gridToWorld(12, 3),
          roomId: 'room_shrine',
          used: false,
          label: 'Shrine of Sanguine Grace',
        },
        {
          id: 'portal_exit',
          type: 'portal_next_floor',
          position: portalPosition,
          roomId: 'room_boss',
          used: false,
          label: 'Abyssal Rift',
        },
      ];

  if (options?.wallInteractable) {
    interactables.push({
      id: 'bad_chest',
      type: 'chest',
      position: gridToWorld(0, 1), // inside solid outer wall
      roomId: 'room_combat',
      used: false,
      label: 'Buried Chest',
    });
  }

  return {
    floorNumber,
    biome,
    seed: 98765,
    cols,
    rows,
    tileSize,
    tiles,
    explored,
    rooms,
    playerSpawn,
    bossSpawn,
    portalPosition,
    interactables,
    torchPositions: [gridToWorld(4, 8), gridToWorld(12, 8), gridToWorld(21, 7)],
    worldToGrid,
    gridToWorld,
    isWalkableWorld,
    findPath,
    revealRadius(worldPos: Vec3, radiusWorld: number): void {
      const center = worldToGrid(worldPos);
      const radCells = Math.ceil(radiusWorld / tileSize);
      for (let r = center.row - radCells; r <= center.row + radCells; r++) {
        for (let c = center.col - radCells; c <= center.col + radCells; c++) {
          if (r >= 0 && r < rows && c >= 0 && c < cols) {
            explored[r][c] = true;
          }
        }
      }
    },
  };
}

describe('Core Contract Layer — TypedEventBus & Phase 3 Events', () => {
  it('delivers strongly typed payloads across combat, mastery, invasion, and rune channels', () => {
    const bus = new TypedEventBus();
    const shakes: number[] = [];
    const reactions: string[] = [];
    const runes: string[] = [];

    bus.on('camera:shake', ({ trauma }) => shakes.push(trauma));
    bus.on('combat:elementalReaction', ({ reaction, damage }) =>
      reactions.push(`${reaction}:${damage}`),
    );
    bus.on('rune:pickedUp', ({ runeId }) => runes.push(runeId));

    bus.emit('camera:shake', { trauma: 0.45 });
    bus.emit('combat:elementalReaction', {
      reaction: 'shatter',
      position: { x: 2, y: 0, z: 4 },
      damage: 420,
    });
    bus.emit('rune:pickedUp', { runeId: 'jah', position: { x: 1, y: 0, z: 1 } });

    expect(shakes).toEqual([0.45]);
    expect(reactions).toEqual(['shatter:420']);
    expect(runes).toEqual(['jah']);
  });

  it('supports unsubscribing individual listeners idempotently without affecting peers', () => {
    const bus = new TypedEventBus();
    const logA: string[] = [];
    const logB: string[] = [];

    const unsubA = bus.on('ui:toast', ({ message }) => logA.push(message));
    bus.on('ui:toast', ({ message }) => logB.push(message));

    bus.emit('ui:toast', { message: 'First Drop', rarity: 'rare' });
    unsubA();
    unsubA(); // second call must be a safe no-op
    bus.emit('ui:toast', { message: 'Second Drop', rarity: 'legendary' });

    expect(logA).toEqual(['First Drop']);
    expect(logB).toEqual(['First Drop', 'Second Drop']);
  });

  it('isolates exceptions thrown inside a listener so subsequent handlers still run', () => {
    const bus = new TypedEventBus();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const receivedAfterThrow: number[] = [];

    bus.on('engine:hitstop', () => {
      throw new Error('Synthetic listener failure');
    });
    bus.on('engine:hitstop', ({ durationSec }) => {
      receivedAfterThrow.push(durationSec);
    });

    expect(() => bus.emit('engine:hitstop', { durationSec: 0.08, timeScale: 0.05 })).not.toThrow();
    expect(receivedAfterThrow).toEqual([0.08]);
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it('clears all registered channels via clear()', () => {
    const bus = new TypedEventBus();
    let count = 0;
    bus.on('boss:defeated', () => count++);
    bus.on('event:butcherInvasion', () => count++);

    bus.clear();
    bus.emit('boss:defeated', { bossId: 'valkyria_rime_seraph', position: { x: 0, y: 0, z: 0 } });
    bus.emit('event:butcherInvasion', { position: { x: 5, y: 0, z: 5 } });

    expect(count).toBe(0);
  });
});

describe('Core Constants & SeededRng Determinism / Distributions', () => {
  it('produces identical deterministic sequences for identical seeds and diverges on distinct seeds', () => {
    const rngA = new SeededRng(20261124);
    const rngB = new SeededRng(20261124);
    const rngC = new SeededRng(99999999);

    const seqA = Array.from({ length: 200 }, () => rngA.next());
    const seqB = Array.from({ length: 200 }, () => rngB.next());
    const seqC = Array.from({ length: 200 }, () => rngC.next());

    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('handles zero seed gracefully and maintains uniform distribution across [0, 1)', () => {
    const rng = new SeededRng(0);
    const samples = 10_000;
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;

    for (let i = 0; i < samples; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      buckets[Math.floor(v * 10)]++;
    }

    const mean = sum / samples;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);

    for (const count of buckets) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });

  it('respects inclusive integer bounds, float ranges, pick(), and Bernoulli chance()', () => {
    const rng = new SeededRng(42);
    const seenFaces = new Set<number>();

    for (let i = 0; i < 600; i++) {
      const roll = rng.int(1, 6);
      expect(Number.isInteger(roll)).toBe(true);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
      seenFaces.add(roll);

      const f = rng.range(-12.5, 7.5);
      expect(f).toBeGreaterThanOrEqual(-12.5);
      expect(f).toBeLessThanOrEqual(7.5);
    }
    expect(seenFaces.size).toBe(6);

    const biomes = [
      'sanctuary',
      'crypt',
      'caverns',
      'forge',
      'void',
      'cathedral',
      'observatory',
      'colosseum',
    ] as const;
    const picked = new Set<string>();
    for (let i = 0; i < 160; i++) {
      picked.add(rng.pick(biomes));
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
    expect(picked.size).toBe(8);

    let hits = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      if (rng.chance(0.35)) hits++;
    }
    const empiricalProb = hits / trials;
    expect(empiricalProb).toBeGreaterThan(0.31);
    expect(empiricalProb).toBeLessThan(0.39);
  });

  it('verifies all 8 BiomeIds, HeroClass configs, Rarity & Mythic palettes, and math helpers', () => {
    expect(distXZ({ x: 3, y: 99, z: 4 }, { x: 0, y: -42, z: 0 })).toBeCloseTo(5, 6);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(4.5, 0, 10)).toBe(4.5);

    expect(Object.keys(HERO_CLASS_CONFIG)).toEqual(['vanguard', 'shadowblade', 'arcanist']);
    expect(Object.keys(RARITY_COLORS)).toEqual([
      'common',
      'uncommon',
      'rare',
      'epic',
      'legendary',
    ]);
    expect(MYTHIC_COLOR.label).toBe('Thần Thoại');
    expect(Object.keys(DAMAGE_TYPE_COLORS)).toHaveLength(6);
    expect(Object.keys(BIOME_CONFIG)).toEqual([
      'sanctuary',
      'crypt',
      'caverns',
      'forge',
      'void',
      'cathedral',
      'observatory',
      'colosseum',
    ]);
  });
});

describe('BalanceValidator — Synthetic Dungeon Connectivity & Phase 3 Biomes', () => {
  const validator = createBalanceValidator();

  it('passes classic connected floors as well as Floor 5 Cathedral ice naves and Floor 6 Observatory teleporters', () => {
    const cryptFloor = buildSyntheticFloor({ floorNumber: 1, biome: 'crypt' });
    const cryptReport = validator.validateFloor(cryptFloor);
    expect(cryptReport.valid).toBe(true);
    expect(cryptReport.spawnToBossPathable).toBe(true);
    expect(cryptReport.allRoomsReachable).toBe(true);
    expect(cryptReport.allInteractablesWalkable).toBe(true);

    // Floor 5 Cathedral with hazard_ice nave sheets
    const cathedralFloor = buildSyntheticFloor({
      floorNumber: 5,
      biome: 'cathedral',
      useIceNave: true,
    });
    const cathedralReport = validator.validateFloor(cathedralFloor);
    expect(cathedralReport.valid).toBe(true);
    expect(cathedralReport.biome).toBe('cathedral');

    // Floor 6 Observatory bridging to Boss arena via paired teleporter_pad tiles
    const observatoryFloor = buildSyntheticFloor({
      floorNumber: 6,
      biome: 'observatory',
      sealBossCorridor: true,
      bridgeBossWithTeleporters: true,
    });
    const obsReport = validator.validateFloor(observatoryFloor);
    expect(obsReport.valid).toBe(true);
    expect(obsReport.gridBfsReachable).toBe(true);
    expect(obsReport.spawnToBossPathable).toBe(true);
    expect(obsReport.allRoomsReachable).toBe(true);
  });

  it('validates Sanctuary Hub and Crimson Colosseum single-plaza layouts without false warnings', () => {
    const sanctuaryFloor = buildSyntheticFloor({
      floorNumber: 0,
      biome: 'sanctuary',
      singleHubArena: true,
    });
    const sancReport = validator.validateFloor(sanctuaryFloor);
    expect(sancReport.valid).toBe(true);
    expect(sancReport.warnings).toEqual([]);

    const colosseumFloor = buildSyntheticFloor({
      floorNumber: 7,
      biome: 'colosseum',
      singleHubArena: true,
    });
    const colReport = validator.validateFloor(colosseumFloor);
    expect(colReport.valid).toBe(true);
    expect(colReport.warnings).toEqual([]);
  });

  it('detects a sealed boss corridor and marks playerSpawn -> bossSpawn unpathable', () => {
    const floor = buildSyntheticFloor({ sealBossCorridor: true });
    const report = validator.validateFloor(floor);

    expect(report.valid).toBe(false);
    expect(report.spawnToBossPathable).toBe(false);
    expect(report.allRoomsReachable).toBe(false);
    expect(report.unreachableRoomIds).toContain('room_boss');
    expect(report.invalidInteractableIds).toContain('portal_exit');
  });

  it('detects isolated side rooms, wall-buried interactables, and invalid spawns', () => {
    const isolated = validator.validateFloor(buildSyntheticFloor({ isolateShrineRoom: true }));
    expect(isolated.spawnToBossPathable).toBe(true);
    expect(isolated.allRoomsReachable).toBe(false);
    expect(isolated.unreachableRoomIds).toEqual(['room_shrine']);
    expect(isolated.valid).toBe(false);

    const propReport = validator.validateFloor(buildSyntheticFloor({ wallInteractable: true }));
    expect(propReport.valid).toBe(false);
    expect(propReport.invalidInteractableIds).toEqual(['bad_chest']);

    const spawnReport = validator.validateFloor(buildSyntheticFloor({ wallPlayerSpawn: true }));
    expect(spawnReport.valid).toBe(false);
    expect(spawnReport.spawnWalkable).toBe(false);
  });
});

describe('BalanceValidator — Combat Math, EHP, Armor & Floors 1-6 Progression Curves', () => {
  const validator = new BalanceValidator();

  it('matches hyperbolic armor mitigation `armor / (armor + 100)`, EHP, and vulnerable math', () => {
    expect(validator.computeArmorMitigation(0)).toBe(0);
    expect(validator.computeArmorMitigation(-25)).toBe(0);
    expect(validator.computeArmorMitigation(100)).toBeCloseTo(0.5, 6);
    expect(validator.computeArmorMitigation(300)).toBeCloseTo(0.75, 6);

    expect(validator.computeMitigatedDamage(200, 100, false)).toBeCloseTo(100, 6);
    expect(validator.computeMitigatedDamage(200, 100, true)).toBeCloseTo(125, 6);

    expect(validator.computeEffectiveHp(1000, 0)).toBeCloseTo(1000, 6);
    expect(validator.computeEffectiveHp(1000, 100)).toBeCloseTo(2000, 6);
    expect(validator.computeEffectiveHp(800, 150)).toBeCloseTo(2000, 6);
  });

  it('scales sustained player DPS monotonically with offense, speed, crit, and Awakening CDR (up to 80%)', () => {
    const baseDps = validator.computePlayerDps({
      attackPower: 50,
      spellPower: 20,
      attackSpeed: 1.0,
      critChance: 0.1,
      critMultiplier: 1.5,
      cooldownReduction: 0,
    });
    const awakenedDps = validator.computePlayerDps({
      attackPower: 120,
      spellPower: 30,
      attackSpeed: 1.6,
      critChance: 0.45,
      critMultiplier: 2.1,
      cooldownReduction: 0.8,
    });

    expect(baseDps).toBeGreaterThan(50);
    expect(awakenedDps).toBeGreaterThan(baseDps * 3.5);
  });

  it('validates Floors 1-6 (`crypt` through `cathedral` & `observatory`) across all 3 HeroClasses', () => {
    expect(DEFAULT_FLOOR_BENCHMARKS).toHaveLength(6);
    expect(DEFAULT_FLOOR_BENCHMARKS.map((f) => f.biome)).toEqual([
      'crypt',
      'caverns',
      'forge',
      'void',
      'cathedral',
      'observatory',
    ]);

    const sim = validator.simulateCombatCurves();

    expect(sim.balanced).toBe(true);
    expect(sim.monotonicFloorEhpScaling).toBe(true);
    expect(sim.monotonicPlayerDpsScaling).toBe(true);
    expect(sim.anomalies).toEqual([]);
    expect(sim.results).toHaveLength(18); // 3 classes x 6 floors

    for (const row of sim.results) {
      expect(row.withinTargetBands).toBe(true);
      expect(row.mobTtkSec).toBeGreaterThanOrEqual(TTK_TARGET_BANDS.mobMinSec);
      expect(row.mobTtkSec).toBeLessThanOrEqual(TTK_TARGET_BANDS.mobMaxSec);
      expect(row.bossTtkSec).toBeGreaterThanOrEqual(TTK_TARGET_BANDS.bossMinSec);
      expect(row.bossTtkSec).toBeLessThanOrEqual(TTK_TARGET_BANDS.bossMaxSec);
    }
  });

  it('flags overtuned sponge bosses and instant-one-shot enemies in custom benchmarks', () => {
    const brokenCurve: FloorCombatBenchmarkInput[] = [
      {
        floorNumber: 5,
        biome: 'cathedral',
        bossId: 'valkyria_rime_seraph',
        heroLevel: 1,
        gearBonusMultiplier: 1.0,
        mobHp: 90,
        mobArmor: 10,
        mobDamage: 9500, // lethal one-shot!
        mobAttackIntervalSec: 0.5,
        eliteHp: 350,
        eliteArmor: 20,
        eliteDamage: 40,
        bossHp: 750_000, // absurd bullet sponge!
        bossArmor: 400,
        bossDamage: 50,
        bossAttackIntervalSec: 1.5,
      },
    ];

    const sim = validator.simulateCombatCurves(brokenCurve);
    expect(sim.balanced).toBe(false);
    expect(sim.anomalies.length).toBeGreaterThanOrEqual(6);
  });

  it('evaluates live runtime encounters while ignoring immortal Sanctuary training_dummy targets', () => {
    const stats = validator.deriveBenchmarkHeroStats('vanguard', 13, 3.85);
    const player: PlayerRuntimeState = {
      id: 'player',
      heroClass: 'vanguard',
      name: 'Vanguard',
      level: 13,
      xp: 0,
      xpToNextLevel: 2500,
      unspentSkillPoints: 0,
      unspentAttributePoints: 0,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      facingDir: { x: 0, y: 0, z: 1 },
      rotationY: 0,
      radius: 0.5,
      hp: stats.maxHp,
      mana: stats.maxMana,
      stamina: stats.maxStamina,
      baseAttributes: HERO_CLASS_CONFIG.vanguard.baseAttributes,
      stats,
      statuses: [],
      isDodging: false,
      invulnerableSec: 0,
      alive: true,
      healthPotions: 5,
      maxHealthPotions: 5,
      potionCooldownSec: 0,
      gold: 1800,
      floorsCleared: 4,
      killsTotal: 210,
    };

    const frostMob: EnemyEntity = {
      id: 'mob_frost_1',
      name: 'Frost Revenant',
      archetype: 'frost_revenant',
      isBoss: false,
      isElite: false,
      affixes: [],
      position: { x: 4, y: 0, z: 4 },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      radius: 0.65,
      hp: 980,
      maxHp: 980,
      armor: 130,
      moveSpeed: 4,
      attackDamage: 96,
      damageType: 'ice',
      attackRange: 2.0,
      attackCooldownSec: 1.2,
      xpReward: 120,
      lootTierBonus: 0,
      statuses: [],
      alive: true,
      roomId: 'room_combat',
    };

    const dummy: EnemyEntity = {
      ...frostMob,
      id: 'training_dummy',
      name: 'Sanctuary Dummy',
      hp: 9_999_999,
      maxHp: 9_999_999,
    };

    const audit = validator.evaluateLiveFloorBalance(player, [frostMob, dummy]);
    expect(audit.balanced).toBe(true);
    expect(audit.livingEnemyCount).toBe(1);
    expect(audit.averageMobTtkSec).toBeGreaterThan(0.5);
    expect(audit.averageMobTtkSec).toBeLessThan(10);
  });
});

describe('BalanceValidator — Item Rarity, Mythic Primal & Socketed Progression Audits', () => {
  const validator = new BalanceValidator();

  it('audits Floors 1-6 item progression across all 5 rarities and Mythic Primal tier', () => {
    const items = validator.generateSyntheticItemSample(1337, true);
    const report = validator.auditItems(items);

    expect(report.valid).toBe(true);
    expect(report.mythicCount).toBe(6);
    expect(report.monotonicRarityScaling).toBe(true);
    expect(report.monotonicItemLevelScaling).toBe(true);
    expect(report.averagePowerByRarity.common).toBeLessThan(report.averagePowerByRarity.uncommon);
    expect(report.averagePowerByRarity.uncommon).toBeLessThan(report.averagePowerByRarity.rare);
    expect(report.averagePowerByRarity.rare).toBeLessThan(report.averagePowerByRarity.epic);
    expect(report.averagePowerByRarity.epic).toBeLessThan(
      report.averagePowerByRarity.legendary,
    );
    expect(report.averageMythicPower).toBeGreaterThan(report.averagePowerByRarity.legendary);

    expect(validator.computeUpgradedAffixValue(100, 0)).toBeCloseTo(100, 6);
    expect(validator.computeUpgradedAffixValue(100, 5)).toBeCloseTo(160, 6);
    expect(validator.computeUpgradedAffixValue(100, 10)).toBeCloseTo(220, 6);
  });

  it('catches malformed items (missing legendaryPower, socket overflow, invalid upgradeLevel)', () => {
    const brokenItems: ItemInstance[] = [
      {
        id: 'broken_mythic',
        name: 'Corrupted Relic',
        slot: 'weapon',
        rarity: 'legendary',
        isMythic: true,
        levelReq: 12,
        itemLevel: 12,
        upgradeLevel: 12, // exceeds +10 cap
        weaponVisual: 'greatsword',
        sockets: 2,
        socketedRunes: ['jah', 'ist', 'ber'], // 3 runes > 2 sockets!
        affixes: [
          { label: '+0 Strength', statKey: 'strength', value: 0 }, // invalid <= 0 roll & too few affixes
        ],
        // missing legendaryPower!
        goldValue: 500,
        icon: 'weapon',
      },
    ];

    const report = validator.auditItems(brokenItems);
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('DebugOverlay — F3 Telemetry & Phase 3 Expansion Quick-Action Hooks', () => {
  it('tracks live DLSS/EventBus telemetry, toggles F3/GodMode, and fires all expansion hooks', () => {
    const localBus = new TypedEventBus();
    const calls: string[] = [];

    const overlay: DebugOverlay = createDebugOverlay({
      bus: localBus,
      goldGrantAmount: 750,
      onToggleGodMode: (enabled) => calls.push(`god:${enabled}`),
      onGrantGold: (amount) => calls.push(`gold:${amount}`),
      onSkipFloor: () => calls.push('skip'),
      onHealPlayer: () => calls.push('heal'),
      onGrantLevel: () => calls.push('level'),
      onWarpSanctuary: () => calls.push('warp:sanctuary'),
      onWarpColosseum: () => calls.push('warp:colosseum'),
      onSpawnButcher: () => calls.push('spawn:butcher'),
      onSpawnGoblin: () => calls.push('spawn:goblin'),
      onFillFury: () => calls.push('fill:fury'),
      onGrantAllRunes: () => calls.push('grant:runes'),
    });

    overlay.mount();
    expect(overlay.isVisible()).toBe(false);
    expect(overlay.toggle()).toBe(true);

    overlay.update({
      stats: {
        fps: 144,
        drawCalls: 62,
        triangles: 92_400,
        dlssMode: 'quality',
        renderScale: 0.67,
        frameTimeMs: 6.9,
      },
      playerPos: { x: 22.0, y: 0, z: 34.5 },
      floorNumber: 6,
      biome: 'observatory',
      seed: 884422,
      activeEnemyCount: 14,
    });

    localBus.emit('event:butcherInvasion', { position: { x: 10, y: 0, z: 10 } });
    localBus.emit('event:runewordForged', {
      runewordName: 'Enigma of the Void',
      item: {
        id: 'rw_1',
        name: 'Archon Plate',
        slot: 'chest',
        rarity: 'legendary',
        levelReq: 10,
        itemLevel: 12,
        upgradeLevel: 0,
        affixes: [{ label: '+40 Vitality', statKey: 'vitality', value: 40 }],
        goldValue: 1200,
        icon: 'chest',
      },
    });

    const snap = overlay.getTelemetryState();
    expect(snap.fps).toBe(144);
    expect(snap.frameTimeMs).toBeCloseTo(6.9, 4);
    expect(snap.dlssMode).toBe('quality');
    expect(snap.renderScale).toBeCloseTo(0.67, 4);
    expect(snap.floorNumber).toBe(6);
    expect(snap.biome).toBe('observatory');
    expect(snap.eventsObserved).toBe(2);
    expect(snap.lastEventLabel).toBe('runeword:Enigma of the Void');

    overlay.toggleGodMode();
    overlay.triggerGrantGold();
    overlay.triggerSkipFloor();
    overlay.triggerHealPlayer();
    overlay.triggerGrantLevel();
    overlay.triggerWarpSanctuary();
    overlay.triggerWarpColosseum();
    overlay.triggerSpawnButcher();
    overlay.triggerSpawnGoblin();
    overlay.triggerFillFury();
    overlay.triggerGrantAllRunes();

    expect(calls).toEqual([
      'god:true',
      'gold:750',
      'skip',
      'heal',
      'level',
      'warp:sanctuary',
      'warp:colosseum',
      'spawn:butcher',
      'spawn:goblin',
      'fill:fury',
      'grant:runes',
    ]);

    overlay.dispose();
    localBus.emit('event:goblinSpawned', { position: { x: 0, y: 0, z: 0 } });
    expect(overlay.getTelemetryState().eventsObserved).toBe(2);
  });
});
