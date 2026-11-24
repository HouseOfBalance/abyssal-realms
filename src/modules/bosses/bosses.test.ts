import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type {
  BiomeId,
  DamagePacket,
  DamageResult,
  DungeonFloorData,
  EnemyEntity,
  ICombatEngine,
  IEnemyAISystem,
  IEnemyMeshFactory,
  IEnemyMeshHandle,
  IMaterialLibrary,
  PlayerRuntimeState,
  Vec3,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import {
  BOSS_BLUEPRINTS,
  createBossDirector,
  isPointInsideTelegraph,
  TelegraphRenderer,
} from './index';

function createMockFloor(
  floorNumber: number,
  biomeOverride?: BiomeId,
  includeBossRoom = true,
): DungeonFloorData {
  const defaultBiome: BiomeId =
    floorNumber <= 0
      ? 'sanctuary'
      : floorNumber === 1
        ? 'crypt'
        : floorNumber === 2
          ? 'caverns'
          : floorNumber === 3
            ? 'forge'
            : floorNumber === 4
              ? 'void'
              : floorNumber === 5
                ? 'cathedral'
                : 'observatory';

  const bossRoom = {
    id: 'room_boss',
    type: 'boss' as const,
    x: 20,
    y: 20,
    width: 14,
    height: 14,
    centerGrid: { col: 27, row: 27 },
    centerWorld: { x: 54, y: 0, z: 54 },
    connectedRoomIds: ['room_spawn'],
    cleared: false,
  };

  return {
    floorNumber,
    biome: biomeOverride ?? defaultBiome,
    seed: 4242,
    cols: 46,
    rows: 46,
    tileSize: 2,
    tiles: [],
    explored: [],
    rooms: includeBossRoom ? [bossRoom] : [],
    playerSpawn: { x: 4, y: 0, z: 4 },
    bossSpawn: { x: 54, y: 0, z: 54 },
    portalPosition: { x: 54, y: 0, z: 60 },
    interactables: [],
    torchPositions: [],
    worldToGrid: (pos: Vec3) => ({
      col: Math.floor(pos.x / 2),
      row: Math.floor(pos.z / 2),
    }),
    gridToWorld: (col: number, row: number) => ({ x: col * 2 + 1, y: 0, z: row * 2 + 1 }),
    isWalkableWorld: () => true,
    findPath: (_from: Vec3, to: Vec3) => [to],
    revealRadius: () => {},
  };
}

function createMockDependencies() {
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

  const mat = new THREE.MeshStandardMaterial();
  const tex = new THREE.Texture();
  const materials: IMaterialLibrary = {
    get: () => mat,
    clone: () => mat.clone(),
    getTexture: () => tex,
    dispose: vi.fn(),
  };

  const damageCalls: DamagePacket[] = [];
  const combat: ICombatEngine = {
    init: vi.fn(),
    performMeleeArc: vi.fn(() => []),
    performAoE: vi.fn(() => []),
    spawnProjectile: vi.fn(),
    applyDamageToEnemy: vi.fn((_enemy: EnemyEntity, packet: DamagePacket): DamageResult => ({
      finalDamage: packet.baseAmount,
      isCrit: false,
      isDodged: false,
      killed: false,
      healedSource: 0,
      hitPosition: { x: 0, y: 0, z: 0 },
      damageType: packet.damageType,
    })),
    applyDamageToPlayer: vi.fn((player: PlayerRuntimeState, packet: DamagePacket): DamageResult => {
      damageCalls.push(packet);
      player.hp = Math.max(0, player.hp - packet.baseAmount);
      return {
        finalDamage: packet.baseAmount,
        isCrit: false,
        isDodged: false,
        killed: player.hp <= 0,
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

  const aiSystem: IEnemyAISystem = {
    spawnFloorEnemies: vi.fn(() => []),
    spawnWaveAt: vi.fn(() => []),
    getEnemies: vi.fn(() => []),
    getLivingEnemies: vi.fn(() => []),
    update: vi.fn(),
    clear: vi.fn(),
  };

  const player: PlayerRuntimeState = {
    id: 'player',
    heroClass: 'vanguard',
    name: 'Hero',
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { x: 4, y: 0, z: 4 },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.5,
    hp: 500,
    mana: 100,
    stamina: 100,
    baseAttributes: { strength: 16, dexterity: 9, intelligence: 7, vitality: 15 },
    stats: {
      maxHp: 500,
      hpRegen: 2,
      maxMana: 100,
      manaRegen: 5,
      maxStamina: 100,
      staminaRegen: 20,
      moveSpeed: 7,
      attackPower: 30,
      spellPower: 20,
      armor: 20,
      critChance: 0.1,
      critMultiplier: 1.5,
      attackSpeed: 1,
      cooldownReduction: 0,
      lifeSteal: 0,
      dodgeChance: 0,
    },
    statuses: [],
    isDodging: false,
    invulnerableSec: 0,
    alive: true,
    healthPotions: 3,
    maxHealthPotions: 5,
    potionCooldownSec: 0,
    gold: 0,
    floorsCleared: 0,
    killsTotal: 0,
  };

  return { meshFactory, materials, combat, aiSystem, player, damageCalls };
}

describe('BossDirector & TelegraphRenderer', () => {
  it('selects all 6 Pinnacle Bosses across Floors 1–7+ and includes the_butcher blueprint', () => {
    const scene = new THREE.Scene();
    const director = createBossDirector();
    director.init(scene);
    const { meshFactory, materials } = createMockDependencies();

    expect(director.spawnFloorBoss(createMockFloor(1), meshFactory, materials).archetype).toBe(
      'bone_colossus',
    );
    expect(director.spawnFloorBoss(createMockFloor(2), meshFactory, materials).archetype).toBe(
      'arachne_broodmother',
    );
    expect(director.spawnFloorBoss(createMockFloor(3), meshFactory, materials).archetype).toBe(
      'ignis_forgemaster',
    );
    const f4 = director.spawnFloorBoss(createMockFloor(4), meshFactory, materials);
    expect(f4.archetype).toBe('malakor_void_emperor');
    const f5 = director.spawnFloorBoss(createMockFloor(5), meshFactory, materials);
    expect(f5.archetype).toBe('valkyria_rime_seraph');
    expect(f5.maxHp).toBeGreaterThan(f4.maxHp);

    const f6 = director.spawnFloorBoss(createMockFloor(6), meshFactory, materials);
    expect(f6.archetype).toBe('chronos_time_architect');
    expect(f6.maxHp).toBeGreaterThan(f5.maxHp);

    const f7 = director.spawnFloorBoss(createMockFloor(7), meshFactory, materials);
    expect(f7.archetype).toBe('chronos_time_architect');
    expect(f7.maxHp).toBeGreaterThan(f6.maxHp);

    expect(BOSS_BLUEPRINTS.the_butcher.bossId).toBe('the_butcher');
    expect(BOSS_BLUEPRINTS.the_butcher.attacks.length).toBeGreaterThanOrEqual(4);

    director.dispose();
  });

  it('handles sanctuary and colosseum initial loads gracefully without a standard boss room', () => {
    const scene = new THREE.Scene();
    const director = createBossDirector();
    director.init(scene);
    const { meshFactory, materials, combat, aiSystem, player } = createMockDependencies();

    const sanctuaryFloor = createMockFloor(0, 'sanctuary', false);
    const inertSanctuary = director.spawnFloorBoss(sanctuaryFloor, meshFactory, materials);
    expect(inertSanctuary.alive).toBe(false);
    expect(director.getActiveBoss()).toBeNull();
    director.update(0.05, player, sanctuaryFloor, combat, aiSystem);
    expect(director.getActiveBoss()).toBeNull();

    const colosseumInitial = createMockFloor(1, 'colosseum', false);
    const inertColosseum = director.spawnFloorBoss(colosseumInitial, meshFactory, materials);
    expect(inertColosseum.alive).toBe(false);
    expect(director.getActiveBoss()).toBeNull();

    director.dispose();
  });

  it('supports Twin-Boss Arena Showdowns via spawnColosseumBosses across waves 5, 10, 15, and 20', () => {
    const scene = new THREE.Scene();
    const director = createBossDirector();
    director.init(scene);
    const { meshFactory, materials, combat, aiSystem, player } = createMockDependencies();
    const colosseumFloor = createMockFloor(5, 'colosseum', false);
    player.position = { x: 50, y: 0, z: 50 };

    const defeatedIds: string[] = [];
    const unsub = eventBus.on('boss:defeated', (e) => defeatedIds.push(e.bossId));

    const twins = director.spawnColosseumBosses!(colosseumFloor, 10, meshFactory, materials);
    expect(twins).toHaveLength(2);
    expect(twins[0].archetype).toBe('ignis_forgemaster');
    expect(twins[1].archetype).toBe('valkyria_rime_seraph');
    expect(director.getActiveBoss()?.title).toContain('Twin Showdown');

    // Step past intro so both twins fight actively and spawn telegraphs
    for (let i = 0; i < 40; i++) {
      director.update(0.08, player, colosseumFloor, combat, aiSystem);
    }
    expect(director.getActiveTelegraphs().length).toBeGreaterThan(0);

    // Push Twin 1 to <30% HP -> Phase 3 ultimate!
    twins[0].hp = Math.floor(twins[0].maxHp * 0.2);
    director.update(0.05, player, colosseumFloor, combat, aiSystem);
    expect(director.getActiveBoss()?.bossId).toBe('ignis_forgemaster');
    expect(director.getActiveBoss()?.phase).toBe(3);

    // Slay Twin 1 -> HUD seamlessly focuses Twin 2!
    twins[0].hp = 0;
    twins[0].alive = false;
    director.update(0.05, player, colosseumFloor, combat, aiSystem);
    expect(defeatedIds).toContain('ignis_forgemaster');
    expect(director.getActiveBoss()?.bossId).toBe('valkyria_rime_seraph');

    // Slay Twin 2 -> encounter concludes cleanly!
    twins[1].hp = 0;
    twins[1].alive = false;
    director.update(0.05, player, colosseumFloor, combat, aiSystem);
    expect(defeatedIds).toContain('valkyria_rime_seraph');
    expect(director.getActiveBoss()).toBeNull();
    expect(director.getActiveTelegraphs().length).toBe(0);

    unsub();
    director.dispose();
  });

  it('triggers boss intro, 3-phase transitions, minion waves, telegraphs, and slow-mo defeat on Floor 6 Chronos', () => {
    const scene = new THREE.Scene();
    const director = createBossDirector();
    director.init(scene);
    const { meshFactory, materials, combat, aiSystem, player } = createMockDependencies();
    const floor = createMockFloor(6);

    const spawnedEvents: string[] = [];
    const phaseEvents: number[] = [];
    const sfxEvents: string[] = [];
    let defeatedBossId: string | null = null;
    let hitstopTriggered = false;

    const u1 = eventBus.on('boss:spawned', (e) => spawnedEvents.push(e.bossId));
    const u2 = eventBus.on('boss:phaseChanged', (e) => phaseEvents.push(e.phase));
    const u3 = eventBus.on('sfx:request', (e) => sfxEvents.push(e.id));
    const u4 = eventBus.on('boss:defeated', (e) => {
      defeatedBossId = e.bossId;
    });
    const u5 = eventBus.on('engine:hitstop', () => {
      hitstopTriggered = true;
    });

    const boss = director.spawnFloorBoss(floor, meshFactory, materials);

    // Outside boss arena -> dormant
    director.update(0.05, player, floor, combat, aiSystem);
    expect(director.getActiveBoss()).toBeNull();

    // Enter boss arena -> triggers intro!
    player.position = { x: 52, y: 0, z: 50 };
    director.update(0.05, player, floor, combat, aiSystem);
    expect(spawnedEvents).toEqual(['chronos_time_architect']);
    expect(sfxEvents).toContain('boss_roar');
    expect(director.getActiveBoss()?.introActive).toBe(true);
    expect(director.getActiveBoss()?.phase).toBe(1);

    // Finish intro and let Chronos cast rotating clock-hand beams / wells
    for (let i = 0; i < 45; i++) {
      director.update(0.08, player, floor, combat, aiSystem);
    }
    expect(director.getActiveBoss()?.introActive).toBe(false);
    expect(director.getActiveTelegraphs().length).toBeGreaterThan(0);

    // Drop HP to 60% -> Phase 2 + minion wave!
    boss.hp = Math.floor(boss.maxHp * 0.6);
    director.update(0.05, player, floor, combat, aiSystem);
    expect(phaseEvents).toContain(2);
    expect(director.getActiveBoss()?.phase).toBe(2);
    expect(aiSystem.spawnWaveAt).toHaveBeenCalled();

    // Drop HP to 25% -> Phase 3 enraged Grand Horologium Cataclysm!
    boss.hp = Math.floor(boss.maxHp * 0.25);
    for (let i = 0; i < 15; i++) {
      director.update(0.06, player, floor, combat, aiSystem);
    }
    expect(phaseEvents).toContain(3);
    expect(director.getActiveBoss()?.phase).toBe(3);

    // Slay boss -> boss:defeated + slow-mo hitstop + clears telegraphs + marks room cleared
    boss.hp = 0;
    boss.alive = false;
    director.update(0.05, player, floor, combat, aiSystem);
    expect(defeatedBossId).toBe('chronos_time_architect');
    expect(hitstopTriggered).toBe(true);
    expect(director.getActiveTelegraphs().length).toBe(0);
    expect(floor.rooms[0].cleared).toBe(true);
    expect(director.getActiveBoss()).toBeNull();

    u1();
    u2();
    u3();
    u4();
    u5();
    director.dispose();
  });

  it('accurately builds and hit-tests circle, cone, ring (safe inner eye), and line telegraphs', () => {
    const scene = new THREE.Scene();
    const renderer = new TelegraphRenderer();
    renderer.attachToScene(scene);

    const circle = renderer.spawn({
      shape: 'circle',
      position: { x: 0, y: 0, z: 0 },
      directionY: 0,
      radius: 4,
      durationSec: 1.0,
      damage: 30,
      damageType: 'fire',
      sourceId: 'boss_a',
    });
    expect(isPointInsideTelegraph({ x: 2, y: 0, z: 0 }, circle)).toBe(true);
    expect(isPointInsideTelegraph({ x: 4.5, y: 0, z: 0 }, circle)).toBe(false);

    const ring = renderer.spawn({
      shape: 'ring',
      position: { x: 0, y: 0, z: 0 },
      directionY: 0,
      innerRadius: 3,
      radius: 8,
      durationSec: 1.0,
      damage: 40,
      damageType: 'void',
      sourceId: 'boss_a',
    });
    expect(isPointInsideTelegraph({ x: 0, y: 0, z: 1.5 }, ring)).toBe(false);
    expect(isPointInsideTelegraph({ x: 0, y: 0, z: 5.5 }, ring)).toBe(true);
    expect(isPointInsideTelegraph({ x: 0, y: 0, z: 9.0 }, ring)).toBe(false);

    const cone = renderer.spawn({
      shape: 'cone',
      position: { x: 0, y: 0, z: 0 },
      directionY: 0,
      radius: 6,
      angleRad: Math.PI * 0.5,
      durationSec: 1.0,
      damage: 35,
      damageType: 'poison',
      sourceId: 'boss_b',
    });
    expect(isPointInsideTelegraph({ x: 0, y: 0, z: 4 }, cone)).toBe(true);
    expect(isPointInsideTelegraph({ x: 0, y: 0, z: -3 }, cone)).toBe(false);

    const line = renderer.spawn({
      shape: 'line',
      position: { x: 0, y: 0, z: 0 },
      directionY: Math.PI * 0.5,
      radius: 12,
      length: 12,
      width: 2.4,
      durationSec: 1.0,
      damage: 45,
      damageType: 'lightning',
      sourceId: 'boss_b',
    });
    expect(isPointInsideTelegraph({ x: 6, y: 0, z: 0.5 }, line)).toBe(true);
    expect(isPointInsideTelegraph({ x: 6, y: 0, z: 2.0 }, line)).toBe(false);

    renderer.clearBySource('boss_a');
    expect(renderer.getActiveZones().length).toBe(2);

    expect(renderer.update(1.1).detonated.length).toBe(2);
    expect(renderer.getActiveZones().length).toBe(0);

    renderer.dispose();
  });
});
