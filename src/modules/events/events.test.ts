import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DamagePacket,
  DamageResult,
  DungeonFloorData,
  EnemyEntity,
  IBossDirector,
  ICombatEngine,
  IEnemyAISystem,
  IEnemyMeshFactory,
  IEnemyMeshHandle,
  IMaterialLibrary,
  InteractableProp,
  PlayerRuntimeState,
  Vec3,
} from '../../contracts/types';
import { distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  createWorldEventSystem,
  OBELISK_PACT_CARDS,
  WorldEventSystem,
} from './index';

function createMockFloor(
  floorNumber = 2,
  biome: DungeonFloorData['biome'] = 'crypt',
): DungeonFloorData {
  const spawnRoom = {
    id: 'room_spawn',
    type: 'spawn' as const,
    x: 2,
    y: 2,
    width: 8,
    height: 8,
    centerGrid: { col: 6, row: 6 },
    centerWorld: { x: 12, y: 0, z: 12 },
    connectedRoomIds: ['room_combat'],
    cleared: true,
  };
  const combatRoom = {
    id: 'room_combat',
    type: 'combat' as const,
    x: 16,
    y: 2,
    width: 10,
    height: 10,
    centerGrid: { col: 21, row: 7 },
    centerWorld: { x: 32, y: 0, z: 12 },
    connectedRoomIds: ['room_spawn', 'room_boss'],
    cleared: false,
  };
  const bossRoom = {
    id: 'room_boss',
    type: 'boss' as const,
    x: 32,
    y: 16,
    width: 12,
    height: 12,
    centerGrid: { col: 38, row: 22 },
    centerWorld: { x: 64, y: 0, z: 44 },
    connectedRoomIds: ['room_combat'],
    cleared: false,
  };

  return {
    floorNumber,
    biome,
    seed: 123456,
    cols: 50,
    rows: 50,
    tileSize: 2,
    tiles: [],
    explored: [],
    rooms: [spawnRoom, combatRoom, bossRoom],
    playerSpawn: { x: 12, y: 0, z: 12 },
    bossSpawn: { x: 32, y: 0, z: 32 },
    portalPosition: { x: 64, y: 0, z: 50 },
    interactables: [],
    torchPositions: [],
    worldToGrid: (pos: Vec3) => ({
      col: Math.floor(pos.x / 2),
      row: Math.floor(pos.z / 2),
    }),
    gridToWorld: (col: number, row: number) => ({ x: col * 2 + 1, y: 0, z: row * 2 + 1 }),
    isWalkableWorld: (x: number, z: number) => x >= 1 && x <= 96 && z >= 1 && z <= 96,
    findPath: vi.fn((from: Vec3, to: Vec3) => {
      const mid: Vec3 = {
        x: (from.x + to.x) * 0.5,
        y: 0,
        z: (from.z + to.z) * 0.5,
      };
      return [{ ...from }, mid, { ...to }];
    }),
    revealRadius: vi.fn(),
  };
}

function createMockPlayer(pos: Vec3 = { x: 12, y: 0, z: 12 }): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'TestHero',
    level: 5,
    xp: 0,
    xpToNextLevel: 500,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { ...pos },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.55,
    hp: 400,
    mana: 150,
    stamina: 100,
    baseAttributes: { strength: 16, dexterity: 12, intelligence: 10, vitality: 15 },
    stats: {
      maxHp: 400,
      hpRegen: 3,
      maxMana: 150,
      manaRegen: 5,
      maxStamina: 100,
      staminaRegen: 15,
      moveSpeed: 6,
      attackPower: 40,
      spellPower: 30,
      armor: 30,
      critChance: 0.15,
      critMultiplier: 1.75,
      attackSpeed: 1.1,
      cooldownReduction: 0.05,
      lifeSteal: 0.03,
      dodgeChance: 0.05,
    },
    statuses: [],
    isDodging: false,
    invulnerableSec: 0,
    alive: true,
    healthPotions: 3,
    maxHealthPotions: 5,
    potionCooldownSec: 0,
    gold: 200,
    floorsCleared: 1,
    killsTotal: 0,
  };
}

function makeDummyEnemy(id: string, pos: Vec3, isBoss = false): EnemyEntity {
  return {
    id,
    name: id,
    archetype: isBoss ? 'bone_colossus' : 'skeleton_warrior',
    isBoss,
    isElite: false,
    affixes: [],
    position: { ...pos },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    radius: 0.6,
    hp: 100,
    maxHp: 100,
    armor: 10,
    moveSpeed: 3.5,
    attackDamage: 12,
    damageType: 'physical',
    attackRange: 1.8,
    attackCooldownSec: 1.4,
    xpReward: 25,
    lootTierBonus: 0,
    statuses: [],
    alive: true,
    roomId: 'arena',
  };
}

function createHarness() {
  const scene = new THREE.Scene();

  const makeMeshHandle = (): IEnemyMeshHandle => ({
    root: new THREE.Group(),
    playAnim: vi.fn(),
    flashHit: vi.fn(),
    setEliteVisuals: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  });

  const meshFactory: IEnemyMeshFactory = {
    createEnemyMesh: vi.fn(() => makeMeshHandle()),
    createBossMesh: vi.fn(() => makeMeshHandle()),
  };

  const baseMat = new THREE.MeshStandardMaterial();
  const baseTex = new THREE.Texture();
  const materials: IMaterialLibrary = {
    get: () => baseMat,
    clone: () => baseMat.clone(),
    getTexture: () => baseTex,
    dispose: vi.fn(),
  };

  const playerDamagePackets: DamagePacket[] = [];
  const combat: ICombatEngine = {
    init: vi.fn(),
    performMeleeArc: vi.fn(() => []),
    performAoE: vi.fn(() => []),
    spawnProjectile: vi.fn(),
    applyDamageToEnemy: vi.fn((enemy: EnemyEntity, packet: DamagePacket): DamageResult => {
      enemy.hp = Math.max(0, enemy.hp - packet.baseAmount);
      if (enemy.hp <= 0) {
        enemy.alive = false;
      }
      return {
        finalDamage: packet.baseAmount,
        isCrit: false,
        isDodged: false,
        killed: !enemy.alive,
        healedSource: 0,
        hitPosition: { ...enemy.position },
        damageType: packet.damageType,
      };
    }),
    applyDamageToPlayer: vi.fn((player: PlayerRuntimeState, packet: DamagePacket): DamageResult => {
      playerDamagePackets.push(packet);
      player.hp = Math.max(0, player.hp - packet.baseAmount);
      if (player.hp <= 0) player.alive = false;
      return {
        finalDamage: packet.baseAmount,
        isCrit: false,
        isDodged: false,
        killed: !player.alive,
        healedSource: 0,
        hitPosition: { ...player.position },
        damageType: packet.damageType,
      };
    }),
    tickStatuses: vi.fn(),
    updateProjectiles: vi.fn(),
    getComboState: () => ({ count: 0, timerSec: 0, multiplier: 1 }),
    clearFloorEntities: vi.fn(),
    dispose: vi.fn(),
  };

  const livingAiEnemies: EnemyEntity[] = [];
  let waveEnemyIdx = 0;

  const aiSystem: IEnemyAISystem = {
    spawnFloorEnemies: vi.fn(() => []),
    spawnWaveAt: vi.fn((pos: Vec3, count: number) => {
      const spawned: EnemyEntity[] = [];
      for (let i = 0; i < count; i++) {
        const e = makeDummyEnemy(`wave_enemy_${++waveEnemyIdx}`, pos, false);
        livingAiEnemies.push(e);
        spawned.push(e);
      }
      return spawned;
    }),
    getEnemies: () => livingAiEnemies,
    getLivingEnemies: () => livingAiEnemies.filter((e) => e.alive && e.hp > 0),
    update: vi.fn(),
    clear: vi.fn(() => {
      livingAiEnemies.length = 0;
    }),
  };

  let twinBossIdx = 0;
  const bossDirector: IBossDirector = {
    init: vi.fn(),
    spawnFloorBoss: vi.fn((floor: DungeonFloorData) =>
      makeDummyEnemy(`floor_boss_${++twinBossIdx}`, floor.bossSpawn, true),
    ),
    spawnColosseumBosses: vi.fn((floor: DungeonFloorData, waveNumber: number) => [
      makeDummyEnemy(`colosseum_boss_${waveNumber}_A_${++twinBossIdx}`, floor.bossSpawn, true),
      makeDummyEnemy(`colosseum_boss_${waveNumber}_B_${++twinBossIdx}`, floor.bossSpawn, true),
    ]),
    getActiveBoss: () => null,
    getActiveTelegraphs: () => [],
    update: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    scene,
    meshFactory,
    materials,
    combat,
    playerDamagePackets,
    aiSystem,
    livingAiEnemies,
    bossDirector,
  };
}

describe('WorldEventSystem — Dynamic In-Dungeon Events & Crimson Colosseum', () => {
  beforeEach(() => {
    eventBus.clear();
  });

  it('1. spawns The Butcher Invasion with dread banner, relentless pursuit AI, and guaranteed Mythic + 3 Runes on kill', () => {
    const h = createHarness();
    const events = createWorldEventSystem();
    expect(events).toBeInstanceOf(WorldEventSystem);
    events.init(h.scene, h.materials, h.meshFactory);

    const floor = createMockFloor(3, 'forge');
    const player = createMockPlayer({ x: 20, y: 0, z: 20 });

    const invasionSpy = vi.fn();
    const bannerSpy = vi.fn();
    eventBus.on('event:butcherInvasion', invasionSpy);
    eventBus.on('ui:banner', bannerSpy);

    const butcher = events.spawnButcherInvasion(floor, player.position);
    expect(butcher).not.toBeNull();
    expect(butcher!.archetype).toBe('the_butcher');
    expect(h.meshFactory.createBossMesh).toHaveBeenCalledWith('the_butcher', h.materials);
    expect(invasionSpy).toHaveBeenCalledTimes(1);
    expect(bannerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'THỊT TƯƠI! — TÊN ĐỒ TỂ ĐI SĂN',
        tone: 'crimson',
      }),
    );
    expect(events.getStatus().butcherActive).toBe(true);
    expect(events.getEventCombatEntities()).toContain(butcher);

    // Tick pursuit & hook windup/charge toward the player
    const initialDist = distXZ(butcher!.position, player.position);
    for (let i = 0; i < 20; i++) {
      events.update(0.1, i * 0.1, player, floor, h.combat, h.aiSystem, h.bossDirector);
    }
    expect(distXZ(butcher!.position, player.position)).toBeLessThan(initialDist);

    // Slay The Butcher -> verify guaranteedMythic + 3 bonusRunes
    const killRewards = events.onEnemyKilled(butcher!);
    expect(killRewards.guaranteedMythic).toBe(true);
    expect(killRewards.bonusRunes).toBe(3);
    expect(events.getStatus().butcherActive).toBe(false);
    expect(events.getEventCombatEntities()).not.toContain(butcher);

    events.dispose();
  });

  it('2. spawns fleeing Treasure Goblin (18s portal escape + slain bonus rewards) and lunging Chest Mimic', () => {
    const h = createHarness();
    const events = createWorldEventSystem();
    events.init(h.scene, h.materials, h.meshFactory);

    const floor = createMockFloor(2, 'caverns');
    const player = createMockPlayer({ x: 24, y: 0, z: 24 });

    const goblinSpy = vi.fn();
    const mimicSpy = vi.fn();
    eventBus.on('event:goblinSpawned', goblinSpy);
    eventBus.on('event:mimicRevealed', mimicSpy);

    // Part A: Goblin flees away from player and rewards bonusChestTier: 2, bonusRunes: 2 when slain in time
    const goblin = events.spawnTreasureGoblin(floor, { x: 28, y: 0, z: 24 });
    expect(goblin).not.toBeNull();
    expect(goblinSpy).toHaveBeenCalledTimes(1);
    expect(events.getStatus().goblinActive).toBe(true);
    expect(events.getStatus().goblinEscapeSec).toBeCloseTo(18, 1);

    const startDist = distXZ(goblin!.position, player.position);
    for (let i = 0; i < 15; i++) {
      events.update(0.2, i * 0.2, player, floor, h.combat, h.aiSystem, h.bossDirector);
    }
    expect(distXZ(goblin!.position, player.position)).toBeGreaterThan(startDist);
    expect(events.getStatus().goblinEscapeSec!).toBeLessThan(18);

    const goblinRewards = events.onEnemyKilled(goblin!);
    expect(goblinRewards).toEqual({ bonusChestTier: 2, bonusRunes: 2 });
    expect(events.getStatus().goblinActive).toBe(false);

    // Part B: Unslain Goblin escapes cleanly when 18s countdown expires
    const escapee = events.spawnTreasureGoblin(floor, { x: 30, y: 0, z: 24 });
    expect(escapee).not.toBeNull();
    for (let i = 0; i < 95; i++) {
      events.update(0.2, i * 0.2, player, floor, h.combat, h.aiSystem, h.bossDirector);
    }
    expect(events.getStatus().goblinActive).toBe(false);
    expect(events.onEnemyKilled(escapee!)).toEqual({});

    // Part C: Chest Mimic erupts & lunges at player
    const mimic = events.spawnChestMimic(floor, { x: 25.2, y: 0, z: 24 });
    expect(mimic).not.toBeNull();
    expect(mimic!.archetype).toBe('chest_mimic');
    expect(mimicSpy).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 8; i++) {
      events.update(0.15, i * 0.15, player, floor, h.combat, h.aiSystem, h.bossDirector);
    }
    expect(h.playerDamagePackets.some((p) => p.sourceId === mimic!.id)).toBe(true);
    expect(events.onEnemyKilled(mimic!)).toEqual({ bonusChestTier: 1, bonusRunes: 1 });

    events.dispose();
  });

  it('3. rolls 3 distinct Corrupted Obelisk choices from 12 pacts and aggregates stat/combat bonuses', () => {
    expect(OBELISK_PACT_CARDS.length).toBe(12);
    const uniqueIds = new Set(OBELISK_PACT_CARDS.map((c) => c.id));
    expect(uniqueIds.size).toBe(12);

    const h = createHarness();
    const events = createWorldEventSystem();
    events.init(h.scene, h.materials, h.meshFactory);

    const floor = createMockFloor(4, 'void');
    const player = createMockPlayer();

    const choices = events.rollObeliskChoices();
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map((c) => c.id)).size).toBe(3);

    // Select Chain Lightning pact + Executioner's +150% critMultiplier pact + Avarice Gold/Ambush pact
    const storm = events.selectObeliskPact('pact_stormcaller_conduit');
    const exec = events.selectObeliskPact('pact_executioners_gambit');
    const avarice = events.selectObeliskPact('pact_avarice_crown');

    expect(storm?.critChainLightning).toBe(true);
    expect(exec?.statModifiers.critMultiplier).toBe(1.5);
    expect(avarice?.goldFindMultiplier).toBe(2.25);
    expect(events.getStatus().activePacts).toHaveLength(3);

    const bonuses = events.computePactStatBonuses();
    expect(bonuses.critChainLightning).toBe(true);
    expect(bonuses.stats.critMultiplier).toBeCloseTo(1.5, 4);
    expect(bonuses.stats.critChance).toBeCloseTo(0.18, 4);
    expect(bonuses.goldMultiplier).toBeCloseTo(2.25, 4);
    expect(bonuses.damageTakenMultiplier).toBeCloseTo(1.2 * 1.3 * 1.22, 3);

    // Update spawns queued Elite Ambush from Avarice pact
    events.update(0.1, 0.1, player, floor, h.combat, h.aiSystem, h.bossDirector);
    expect(h.aiSystem.spawnWaveAt).toHaveBeenCalled();

    events.clear();
    expect(events.getStatus().activePacts).toHaveLength(0);
    expect(events.computePactStatBonuses().goldMultiplier).toBe(1);
    events.dispose();
  });

  it('4. animates Soul Lantern Escort along A* path, drains HP outside 6.5m ring, and erupts rewards at 100%', () => {
    const h = createHarness();
    const events = createWorldEventSystem();
    events.init(h.scene, h.materials, h.meshFactory);

    const floor = createMockFloor(5, 'cathedral');
    const lanternProp: InteractableProp = {
      id: 'prop_soul_lantern',
      type: 'soul_lantern',
      position: { x: 12, y: 0, z: 12 },
      roomId: 'room_spawn',
      used: false,
      label: 'Soul Lantern',
    };

    events.startSoulEscort(lanternProp, floor);
    expect(lanternProp.used).toBe(true);
    expect(floor.findPath).toHaveBeenCalled();
    expect(events.getStatus().escortState).toEqual({
      active: true,
      progress01: 0,
      insideLight: true,
      completed: false,
    });

    // Step player far outside the 6.5m golden sanctuary ring -> encroaching darkness drains HP
    const player = createMockPlayer({ x: 80, y: 0, z: 80 });
    const startHp = player.hp;
    for (let i = 0; i < 6; i++) {
      events.update(0.2, i * 0.2, player, floor, h.combat, h.aiSystem, h.bossDirector);
    }
    expect(events.getStatus().escortState?.insideLight).toBe(false);
    expect(player.hp).toBeLessThan(startHp);
    expect(h.playerDamagePackets.some((p) => p.sourceId === 'soul_lantern_darkness')).toBe(true);

    // Escort cart all the way to 100% completion while following inside light
    const startGold = player.gold;
    for (let step = 0; step < 200; step++) {
      const st = events.getStatus().escortState;
      if (!st || st.completed) break;
      // Keep player near interpolated escort route
      const t = st.progress01;
      player.position.x = 12 + (32 - 12) * t;
      player.position.z = 12;
      events.update(0.2, 2 + step * 0.2, player, floor, h.combat, h.aiSystem, h.bossDirector);
    }

    const finalState = events.getStatus().escortState;
    expect(finalState?.completed).toBe(true);
    expect(finalState?.active).toBe(false);
    expect(finalState?.progress01).toBe(1);
    expect(player.gold).toBeGreaterThan(startGold);

    events.dispose();
  });

  it('5. scales Timed Rift Breach tiers (Bronze -> Silver -> Gold -> Mythic) over 25s and runs 20-Wave Crimson Colosseum with Twin Bosses', () => {
    const h = createHarness();
    const events = createWorldEventSystem();
    events.init(h.scene, h.materials, h.meshFactory);

    const floor = createMockFloor(6, 'observatory');
    const player = createMockPlayer({ x: 32, y: 0, z: 12 });

    // Part A: 25s Timed Rift Breach
    const riftProp: InteractableProp = {
      id: 'prop_rift',
      type: 'rift_breach',
      position: { x: 32, y: 0, z: 12 },
      roomId: 'room_combat',
      used: false,
      label: 'Void Rift Breach',
    };

    events.startRiftBreach(riftProp, floor);
    expect(riftProp.used).toBe(true);
    expect(events.getStatus().riftState?.tierLabel).toBe('Bronze');

    events.update(0.2, 0.2, player, floor, h.combat, h.aiSystem, h.bossDirector);
    expect(h.aiSystem.spawnWaveAt).toHaveBeenCalled();

    // Feed kills to verify Bronze -> Silver (4) -> Gold (8) -> Mythic (14)
    for (let k = 1; k <= 14; k++) {
      events.onEnemyKilled(makeDummyEnemy(`rift_mob_${k}`, riftProp.position));
      if (k === 4) expect(events.getStatus().riftState?.tierLabel).toBe('Silver');
      if (k === 8) expect(events.getStatus().riftState?.tierLabel).toBe('Gold');
      if (k === 14) expect(events.getStatus().riftState?.tierLabel).toBe('Mythic');
    }

    const goldBeforeSeal = player.gold;
    for (let t = 0; t < 130; t++) {
      events.update(0.2, 1 + t * 0.2, player, floor, h.combat, h.aiSystem, h.bossDirector);
    }
    expect(events.getStatus().riftState?.active).toBe(false);
    expect(events.getStatus().riftState?.remainingSec).toBe(0);
    expect(player.gold).toBeGreaterThan(goldBeforeSeal);

    // Part B: 20-Wave Crimson Colosseum Boss Rush (Twin Bosses on Waves 5, 10, 15, 20)
    const colosseumFloor = createMockFloor(1, 'colosseum');
    h.aiSystem.clear();
    events.startColosseumRun(colosseumFloor, 3);
    expect(events.getStatus().colosseumState).toEqual({
      active: true,
      wave: 1,
      maxWaves: 20,
      bestWave: 3,
      completed: false,
    });

    const bossMilestoneWavesObserved: number[] = [];

    for (let w = 1; w <= 20; w++) {
      // Spawn/tick active wave
      events.update(0.1, w, player, colosseumFloor, h.combat, h.aiSystem, h.bossDirector);
      const stateDuringWave = events.getStatus().colosseumState!;
      expect(stateDuringWave.wave).toBe(w);

      const eventBossTargets = events.getEventCombatEntities();
      if (w === 5 || w === 10 || w === 15 || w === 20) {
        expect(eventBossTargets.length).toBeGreaterThanOrEqual(2);
        bossMilestoneWavesObserved.push(w);
      }

      // Slay all active AI wave monsters & any Twin Colosseum Bosses
      for (const mob of h.aiSystem.getLivingEnemies()) {
        mob.alive = false;
        mob.hp = 0;
      }
      for (const boss of eventBossTargets) {
        boss.alive = false;
        boss.hp = 0;
      }

      // Next tick detects wave clear and advances (or completes on Wave 20)
      events.update(0.1, w + 0.05, player, colosseumFloor, h.combat, h.aiSystem, h.bossDirector);
    }

    expect(bossMilestoneWavesObserved).toEqual([5, 10, 15, 20]);
    expect(h.bossDirector.spawnColosseumBosses).toHaveBeenCalledTimes(4);
    expect(events.getStatus().colosseumState).toEqual({
      active: false,
      wave: 20,
      maxWaves: 20,
      bestWave: 20,
      completed: true,
    });

    events.dispose();
  });

  it('6. handles random exploration encounters across floors and deduplicates eventBus + onEnemyKilled calls', () => {
    const h = createHarness();
    const events = createWorldEventSystem();
    events.init(h.scene, h.materials, h.meshFactory);

    // Never triggers random Butcher/Goblin inside Sanctuary Hub
    const sanctuaryFloor = createMockFloor(0, 'sanctuary');
    const player = createMockPlayer({ x: 32, y: 0, z: 12 });
    events.initFloorEvents(sanctuaryFloor);
    for (let i = 0; i < 40; i++) {
      events.update(0.25, i * 0.25, player, sanctuaryFloor, h.combat, h.aiSystem, h.bossDirector);
    }
    expect(events.getStatus().butcherActive).toBe(false);
    expect(events.getStatus().goblinActive).toBe(false);

    // Triggers random Butcher Invasion organically across explored dungeon combat rooms
    let triggeredAcrossSeeds = false;
    for (let seedAttempt = 1; seedAttempt <= 25; seedAttempt++) {
      const f = createMockFloor(5, 'cathedral');
      f.seed = seedAttempt * 7919;
      events.initFloorEvents(f);
      player.position = { x: 12, y: 0, z: 12 }; // spawn room
      for (let t = 0; t < 26; t++) {
        events.update(0.25, t * 0.25, player, f, h.combat, h.aiSystem, h.bossDirector);
      }
      player.position = { x: 38, y: 0, z: 12 }; // enter combat room (col 19, row 6 -> inside room_combat x:16..26, y:2..12)
      events.update(0.2, 6.7, player, f, h.combat, h.aiSystem, h.bossDirector);
      if (events.getStatus().butcherActive || events.getStatus().goblinActive) {
        triggeredAcrossSeeds = true;
        break;
      }
    }
    expect(triggeredAcrossSeeds).toBe(true);

    // Verify emitting 'combat:enemyKilled' BEFORE calling onEnemyKilled(butcher) does not swallow rewards or double-count Rift kills
    events.clear();
    const riftFloor = createMockFloor(3, 'forge');
    events.startRiftBreach(
      {
        id: 'rift_dedup',
        type: 'rift_breach',
        position: { x: 32, y: 0, z: 12 },
        roomId: 'room_combat',
        used: false,
        label: 'Void Rift',
      },
      riftFloor,
    );
    const butcher = events.spawnButcherInvasion(riftFloor, player.position)!;
    eventBus.emit('combat:enemyKilled', { enemy: butcher });
    const rewards = events.onEnemyKilled(butcher);
    expect(rewards.guaranteedMythic).toBe(true);
    expect(rewards.bonusRunes).toBe(3);
    expect(events.getStatus().riftState?.kills).toBe(1);

    events.dispose();
  });
});
