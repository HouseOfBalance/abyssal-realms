import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type {
  DamagePacket,
  DamageResult,
  DungeonFloorData,
  DungeonRoom,
  EliteAffix,
  EnemyAnimState,
  EnemyArchetypeId,
  EnemyEntity,
  ICombatEngine,
  IEnemyMeshFactory,
  IEnemyMeshHandle,
  IMaterialLibrary,
  PlayerRuntimeState,
  ProjectileSpec,
  Vec3,
} from '../../contracts/types';
import {
  ARCHETYPE_CONFIGS,
  BIOME_MONSTER_POOLS,
  biomeForFloorNumber,
  createEnemyAISystem,
  EnemyAISystem,
} from './index';

function createMockMaterials(): IMaterialLibrary {
  const mat = new THREE.MeshStandardMaterial();
  const tex = new THREE.Texture();
  return {
    get: () => mat,
    clone: () => mat.clone(),
    getTexture: () => tex,
    dispose: () => {
      mat.dispose();
      tex.dispose();
    },
  };
}

function createMockMeshFactory(): {
  factory: IEnemyMeshFactory;
  disposedCount: () => number;
  lastAnims: Map<THREE.Group, EnemyAnimState>;
} {
  let disposed = 0;
  const lastAnims = new Map<THREE.Group, EnemyAnimState>();

  const makeHandle = (): IEnemyMeshHandle => {
    const root = new THREE.Group();
    lastAnims.set(root, 'idle');
    return {
      root,
      playAnim(state: EnemyAnimState) {
        lastAnims.set(root, state);
      },
      flashHit() {},
      setEliteVisuals(_affixes: EliteAffix[]) {},
      update(_dt: number) {},
      dispose() {
        disposed++;
      },
    };
  };

  return {
    factory: {
      createEnemyMesh(_archetype: EnemyArchetypeId, _isElite: boolean) {
        return makeHandle();
      },
      createBossMesh() {
        return makeHandle();
      },
    },
    disposedCount: () => disposed,
    lastAnims,
  };
}

function createMockFloor(biome: DungeonFloorData['biome'] = 'crypt', floorNumber = 1): DungeonFloorData {
  const cols = 60;
  const rows = 60;
  const tileSize = 2.0;
  const tiles = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 'floor' as const),
  );
  const explored = Array.from({ length: rows }, () => Array.from({ length: cols }, () => true));

  const makeRoom = (
    id: string,
    type: DungeonRoom['type'],
    x: number,
    y: number,
    w = 10,
    h = 10,
  ): DungeonRoom => ({
    id,
    type,
    x,
    y,
    width: w,
    height: h,
    centerGrid: { col: x + Math.floor(w / 2), row: y + Math.floor(h / 2) },
    centerWorld: { x: (x + w / 2) * tileSize, y: 0, z: (y + h / 2) * tileSize },
    connectedRoomIds: [],
    cleared: false,
  });

  const rooms: DungeonRoom[] = [
    makeRoom('r_spawn', 'spawn', 2, 2),
    makeRoom('r_combat', 'combat', 16, 4),
    makeRoom('r_elite', 'elite', 30, 4),
    makeRoom('r_treasure', 'treasure', 16, 20),
    makeRoom('r_cursed', 'cursed_event', 30, 20),
    makeRoom('r_boss', 'boss', 44, 44),
  ];

  return {
    floorNumber,
    biome,
    seed: 424242,
    cols,
    rows,
    tileSize,
    tiles,
    explored,
    rooms,
    playerSpawn: { x: 14, y: 0, z: 14 },
    bossSpawn: { x: 98, y: 0, z: 98 },
    portalPosition: { x: 100, y: 0, z: 100 },
    interactables: [],
    torchPositions: [],
    worldToGrid(pos: Vec3) {
      return {
        col: Math.max(0, Math.min(cols - 1, Math.floor(pos.x / tileSize))),
        row: Math.max(0, Math.min(rows - 1, Math.floor(pos.z / tileSize))),
      };
    },
    gridToWorld(col: number, row: number) {
      return { x: (col + 0.5) * tileSize, y: 0, z: (row + 0.5) * tileSize };
    },
    isWalkableWorld(x: number, z: number) {
      return x >= 2 && z >= 2 && x <= (cols - 1) * tileSize && z <= (rows - 1) * tileSize;
    },
    findPath(fromWorld: Vec3, toWorld: Vec3) {
      const mid: Vec3 = {
        x: (fromWorld.x + toWorld.x) * 0.5,
        y: 0,
        z: (fromWorld.z + toWorld.z) * 0.5,
      };
      return [mid, { x: toWorld.x, y: 0, z: toWorld.z }];
    },
    revealRadius() {},
  };
}

function createMockPlayer(pos: Vec3): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'Hero',
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { ...pos },
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
      hpRegen: 1,
      maxMana: 100,
      manaRegen: 2,
      maxStamina: 100,
      staminaRegen: 10,
      moveSpeed: 6,
      attackPower: 25,
      spellPower: 15,
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
}

function createMockCombat(): {
  combat: ICombatEngine;
  playerHits: DamagePacket[];
  projectiles: ProjectileSpec[];
} {
  const playerHits: DamagePacket[] = [];
  const projectiles: ProjectileSpec[] = [];

  const dummyResult = (amount: number, pos: Vec3, type: DamagePacket['damageType']): DamageResult => ({
    finalDamage: amount,
    isCrit: false,
    isDodged: false,
    killed: false,
    healedSource: 0,
    hitPosition: { ...pos },
    damageType: type,
  });

  const combat: ICombatEngine = {
    init() {},
    performMeleeArc() {
      return [];
    },
    performAoE() {
      return [];
    },
    spawnProjectile(spec: ProjectileSpec) {
      projectiles.push(spec);
    },
    applyDamageToEnemy(enemy: EnemyEntity, packet: DamagePacket) {
      enemy.hp = Math.max(0, enemy.hp - packet.baseAmount);
      if (enemy.hp <= 0) enemy.alive = false;
      return dummyResult(packet.baseAmount, enemy.position, packet.damageType);
    },
    applyDamageToPlayer(player: PlayerRuntimeState, packet: DamagePacket) {
      playerHits.push(packet);
      player.hp = Math.max(0, player.hp - packet.baseAmount);
      return dummyResult(packet.baseAmount, player.position, packet.damageType);
    },
    tickStatuses() {},
    updateProjectiles() {},
    getComboState() {
      return { count: 0, timerSec: 0, multiplier: 1 };
    },
    clearFloorEntities() {},
    dispose() {},
  };

  return { combat, playerHits, projectiles };
}

describe('EnemyAISystem', () => {
  it('populates combat, elite, treasure, and cursed_event rooms with biome packs & 1-3 affix elites', () => {
    const ai = createEnemyAISystem();
    expect(ai).toBeInstanceOf(EnemyAISystem);

    const scene = new THREE.Scene();
    const { factory } = createMockMeshFactory();
    const materials = createMockMaterials();
    const floor = createMockFloor('crypt', 2);

    const spawned = ai.spawnFloorEnemies(floor, scene, factory, materials);
    expect(spawned.length).toBeGreaterThanOrEqual(12);
    expect(ai.getLivingEnemies().length).toBe(spawned.length);

    const byRoom = new Set(spawned.map((e) => e.roomId));
    expect(byRoom.has('r_combat')).toBe(true);
    expect(byRoom.has('r_elite')).toBe(true);
    expect(byRoom.has('r_treasure')).toBe(true);
    expect(byRoom.has('r_cursed')).toBe(true);
    expect(byRoom.has('r_spawn')).toBe(false);
    expect(byRoom.has('r_boss')).toBe(false);

    const elites = spawned.filter((e) => e.isElite);
    expect(elites.length).toBeGreaterThanOrEqual(2);
    for (const elite of elites) {
      expect(elite.affixes.length).toBeGreaterThanOrEqual(1);
      expect(elite.affixes.length).toBeLessThanOrEqual(3);
    }

    ai.clear();
    materials.dispose();
  });

  it('cleans up dead enemy meshes after death anim and marks room cleared when slain', () => {
    const ai = new EnemyAISystem();
    const scene = new THREE.Scene();
    const { factory, disposedCount } = createMockMeshFactory();
    const materials = createMockMaterials();
    const floor = createMockFloor('forge', 3);
    const player = createMockPlayer({ x: 14, y: 0, z: 14 });
    const { combat } = createMockCombat();

    ai.spawnFloorEnemies(floor, scene, factory, materials);
    const combatRoom = floor.rooms.find((r) => r.id === 'r_combat')!;
    expect(combatRoom.cleared).toBe(false);

    // Slay all enemies in r_combat
    for (const e of ai.getEnemies()) {
      if (e.roomId === 'r_combat') {
        e.hp = 0;
        e.alive = false;
      }
    }

    ai.update(0.05, player, floor, combat);
    expect(combatRoom.cleared).toBe(true);

    // Advance past 1.35s death animation so corpse meshes dispose cleanly
    for (let i = 0; i < 30; i++) {
      ai.update(0.05, player, floor, combat);
    }
    expect(disposedCount()).toBeGreaterThan(0);
    for (const e of ai.getEnemies()) {
      if (e.roomId === 'r_combat') {
        expect(e.meshHandle).toBeUndefined();
      }
    }

    ai.dispose();
    materials.dispose();
  });

  it('drives melee, ranged kite, void_assassin blink, lich summon, statuses, and molten/berserker affixes', () => {
    const ai = new EnemyAISystem();
    const scene = new THREE.Scene();
    const { factory } = createMockMeshFactory();
    const materials = createMockMaterials();
    const floor = createMockFloor('void', 4);
    const player = createMockPlayer({ x: 50, y: 0, z: 50 });
    const { combat, playerHits, projectiles } = createMockCombat();

    const wave = ai.spawnWaveAt(
      { x: 54, y: 0, z: 50 },
      5,
      4,
      'r_cursed',
      scene,
      factory,
      materials,
    );
    expect(wave.length).toBe(5);

    // Force deterministic coverage across special archetypes & affixes
    wave[0].isElite = true;
    wave[0].affixes = ['berserker', 'molten', 'vampiric'];
    wave[0].hp = Math.floor(wave[0].maxHp * 0.4); // Trigger <50% HP berserker frenzy

    // Simulate 3.5 seconds of combat
    for (let step = 0; step < 70; step++) {
      ai.update(0.05, player, floor, combat);
    }
    expect(playerHits.length + projectiles.length).toBeGreaterThan(0);

    // Test freeze status completely halts velocity
    const target = ai.getLivingEnemies()[0];
    target.statuses.push({
      id: 'st_freeze',
      type: 'freeze',
      remainingSec: 2.0,
      durationSec: 2.0,
      stacks: 1,
      potency: 1,
      sourceId: 'player',
    });
    ai.update(0.05, player, floor, combat);
    expect(target.velocity.x).toBe(0);
    expect(target.velocity.z).toBe(0);

    // Trigger molten elite death explosion on player standing on top
    const hitsBeforeMolten = playerHits.length;
    player.position = { ...wave[0].position };
    wave[0].hp = 0;
    wave[0].alive = false;
    for (let step = 0; step < 32; step++) {
      ai.update(0.05, player, floor, combat);
    }
    expect(playerHits.length).toBeGreaterThan(hitsBeforeMolten);
    expect(playerHits.some((h) => h.damageType === 'fire')).toBe(true);

    ai.dispose();
    materials.dispose();
  });

  it('supports Phase 3 expansion biomes (sanctuary, cathedral, observatory, colosseum) and all 14 archetypes', () => {
    const allArchetypes: EnemyArchetypeId[] = [
      'skeleton_warrior',
      'bone_archer',
      'dark_cultist',
      'plague_spider',
      'abyssal_golem',
      'void_assassin',
      'hellhound',
      'lich_summoner',
      'frost_revenant',
      'ice_wraith',
      'clockwork_automaton',
      'astral_weaver',
      'treasure_goblin',
      'chest_mimic',
    ];
    for (const id of allArchetypes) {
      expect(ARCHETYPE_CONFIGS[id]).toBeDefined();
      expect(ARCHETYPE_CONFIGS[id].baseHp).toBeGreaterThan(0);
    }

    expect(BIOME_MONSTER_POOLS.sanctuary).toHaveLength(0);
    expect(BIOME_MONSTER_POOLS.cathedral.map((e) => e.id)).toEqual(
      expect.arrayContaining(['frost_revenant', 'ice_wraith']),
    );
    expect(BIOME_MONSTER_POOLS.observatory.map((e) => e.id)).toEqual(
      expect.arrayContaining(['clockwork_automaton', 'astral_weaver']),
    );
    expect(BIOME_MONSTER_POOLS.colosseum.length).toBeGreaterThanOrEqual(5);
    expect(biomeForFloorNumber(5)).toBe('cathedral');
    expect(biomeForFloorNumber(6)).toBe('observatory');

    const ai = createEnemyAISystem();
    const scene = new THREE.Scene();
    const { factory } = createMockMeshFactory();
    const materials = createMockMaterials();

    // Sanctuary spawns zero hostile room enemies
    const sanctuaryFloor = createMockFloor('sanctuary', 0);
    expect(ai.spawnFloorEnemies(sanctuaryFloor, scene, factory, materials)).toHaveLength(0);

    // Cathedral spawns rime packs including frost_revenant / ice_wraith
    const cathedralFloor = createMockFloor('cathedral', 5);
    const cathedralSpawned = ai.spawnFloorEnemies(cathedralFloor, scene, factory, materials);
    expect(cathedralSpawned.length).toBeGreaterThanOrEqual(12);
    expect(
      cathedralSpawned.some(
        (e) => e.archetype === 'frost_revenant' || e.archetype === 'ice_wraith',
      ),
    ).toBe(true);

    // Observatory spawns clockwork_automaton / astral_weaver and runs combat updates cleanly
    const observatoryFloor = createMockFloor('observatory', 6);
    const obsSpawned = ai.spawnFloorEnemies(observatoryFloor, scene, factory, materials);
    expect(
      obsSpawned.some(
        (e) => e.archetype === 'clockwork_automaton' || e.archetype === 'astral_weaver',
      ),
    ).toBe(true);

    const player = createMockPlayer({ x: 42, y: 0, z: 18 });
    const { combat } = createMockCombat();
    for (let i = 0; i < 20; i++) {
      ai.update(0.05, player, observatoryFloor, combat);
    }

    ai.clear();
    materials.dispose();
  });
});
