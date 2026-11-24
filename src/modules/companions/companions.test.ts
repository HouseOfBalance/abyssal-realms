import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type {
  DamageResult,
  DungeonFloorData,
  EnemyEntity,
  GroundLootDrop,
  ICombatEngine,
  ILootSystem,
  IMaterialLibrary,
  MaterialKey,
  PlayerRuntimeState,
  ProjectileSpec,
  TileType,
  Vec3,
} from '../../contracts/types';
import { distXZ } from '../../core/Constants';
import { CompanionSystem, createCompanionSystem } from './index';

function createMockMaterials(): {
  lib: IMaterialLibrary;
  sharedDisposedCount: () => number;
} {
  const shared = new Map<MaterialKey, THREE.MeshStandardMaterial>();
  let sharedDisposed = 0;

  const get = (key: MaterialKey): THREE.MeshStandardMaterial => {
    let mat = shared.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
      const origDispose = mat.dispose.bind(mat);
      mat.dispose = () => {
        sharedDisposed++;
        origDispose();
      };
      shared.set(key, mat);
    }
    return mat;
  };

  return {
    lib: {
      get,
      clone: (key: MaterialKey) => get(key).clone(),
      getTexture: () => new THREE.Texture(),
      dispose: () => {
        for (const m of shared.values()) m.dispose();
        shared.clear();
      },
    },
    sharedDisposedCount: () => sharedDisposed,
  };
}

function createMockFloor(biome: DungeonFloorData['biome'] = 'crypt'): DungeonFloorData {
  const cols = 40;
  const rows = 40;
  const tileSize = 2.0;
  const tiles: TileType[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 'floor' as TileType),
  );
  const explored = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => true),
  );

  return {
    floorNumber: biome === 'sanctuary' ? 0 : 1,
    biome,
    seed: 12345,
    cols,
    rows,
    tileSize,
    tiles,
    explored,
    rooms: [],
    playerSpawn: { x: 20, y: 0, z: 20 },
    bossSpawn: { x: 60, y: 0, z: 60 },
    portalPosition: { x: 64, y: 0, z: 64 },
    interactables: [],
    torchPositions: [],
    worldToGrid: (p) => ({ col: Math.floor(p.x / tileSize), row: Math.floor(p.z / tileSize) }),
    gridToWorld: (c, r) => ({ x: (c + 0.5) * tileSize, y: 0, z: (r + 0.5) * tileSize }),
    isWalkableWorld: (x, z) => x > 1 && z > 1 && x < cols * tileSize - 1 && z < rows * tileSize - 1,
    findPath: (from, to) => [from, to],
    revealRadius: () => {},
  };
}

function createMockPlayer(pos: Vec3 = { x: 20, y: 0, z: 20 }): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'Vanguard',
    level: 3,
    xp: 0,
    xpToNextLevel: 310,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { ...pos },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.42,
    hp: 240,
    mana: 90,
    stamina: 100,
    baseAttributes: { strength: 16, dexterity: 10, intelligence: 8, vitality: 15 },
    stats: {
      maxHp: 300,
      hpRegen: 2,
      maxMana: 120,
      manaRegen: 4,
      maxStamina: 100,
      staminaRegen: 18,
      moveSpeed: 6.5,
      attackPower: 48,
      spellPower: 35,
      armor: 36,
      critChance: 0.1,
      critMultiplier: 1.6,
      attackSpeed: 1.0,
      cooldownReduction: 0.05,
      lifeSteal: 0,
      dodgeChance: 0.05,
    },
    statuses: [],
    isDodging: false,
    invulnerableSec: 0,
    alive: true,
    healthPotions: 3,
    maxHealthPotions: 5,
    potionCooldownSec: 0,
    gold: 100,
    floorsCleared: 1,
    killsTotal: 12,
  };
}

function createMockEnemy(id: string, pos: Vec3, attackDamage = 45): EnemyEntity {
  return {
    id,
    name: 'Skeleton Warrior',
    archetype: 'skeleton_warrior',
    isBoss: false,
    isElite: false,
    affixes: [],
    position: { ...pos },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    radius: 0.45,
    hp: 220,
    maxHp: 220,
    armor: 10,
    moveSpeed: 3.8,
    attackDamage,
    damageType: 'physical',
    attackRange: 2.2,
    attackCooldownSec: 1.2,
    xpReward: 35,
    lootTierBonus: 0,
    statuses: [],
    alive: true,
    roomId: 'room_1',
  };
}

function createMockLoot(drops: GroundLootDrop[]): {
  loot: ILootSystem;
  pickedIds: string[];
} {
  const pickedIds: string[] = [];
  const loot = {
    getGroundDrops: () => drops.filter((d) => !d.pickedUp),
    pickupDrop: vi.fn((dropId: string, player: PlayerRuntimeState) => {
      const found = drops.find((d) => d.id === dropId && !d.pickedUp);
      if (!found) return { picked: null };
      found.pickedUp = true;
      pickedIds.push(found.id);
      if (found.kind === 'gold') player.gold += found.amount ?? 10;
      return { picked: found };
    }),
  } as unknown as ILootSystem;

  return { loot, pickedIds };
}

function createMockCombat(): {
  combat: ICombatEngine;
  meleeCalls: number;
  projectiles: ProjectileSpec[];
} {
  const state = {
    meleeCalls: 0,
    projectiles: [] as ProjectileSpec[],
  };

  const fakeResult: DamageResult = {
    finalDamage: 30,
    isCrit: false,
    isDodged: false,
    killed: false,
    healedSource: 0,
    hitPosition: { x: 0, y: 0, z: 0 },
    damageType: 'physical',
  };

  const combat = {
    performMeleeArc: vi.fn(() => {
      state.meleeCalls++;
      return [fakeResult];
    }),
    performAoE: vi.fn(() => [fakeResult]),
    spawnProjectile: vi.fn((spec: ProjectileSpec) => {
      state.projectiles.push(spec);
    }),
  } as unknown as ICombatEngine;

  return {
    combat,
    get meleeCalls() {
      return state.meleeCalls;
    },
    projectiles: state.projectiles,
  };
}

describe('CompanionSystem', () => {
  it('builds all 3 articulated pets and 3 mercenaries, switches visibility, and grants distinct pet aura bonuses', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const companions = createCompanionSystem() as CompanionSystem;

    companions.init(scene, lib);
    expect(scene.children).toContain(companions.rootGroup);

    const owlAura = companions.computeCompanionAuraBonuses();
    expect(owlAura.manaRegen).toBeGreaterThan(0);
    expect(owlAura.cooldownReduction).toBeGreaterThan(0);

    companions.setActivePet('ember_wyrmling');
    const wyrmAura = companions.computeCompanionAuraBonuses();
    expect(wyrmAura.attackPower).toBeGreaterThan(0);
    expect(wyrmAura.critMultiplier).toBeGreaterThan(0);

    companions.setActivePet('void_kitsune');
    const kitsuneAura = companions.computeCompanionAuraBonuses();
    expect(kitsuneAura.critChance).toBeGreaterThan(0);
    expect(kitsuneAura.attackSpeed).toBeGreaterThan(0);

    const state = companions.getState();
    expect(state.activePet).toBe('void_kitsune');
    expect(state.unlockedPets).toEqual(['celestial_owl', 'ember_wyrmling', 'void_kitsune']);
    expect(state.unlockedMercenaries).toEqual(['iron_templar', 'sylvan_ranger', 'storm_arcanist']);

    companions.dispose();
  });

  it('dashes out up to 11m to scoop gold, potion, health_orb, and rune drops while ignoring far drops and equipment items', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const companions = createCompanionSystem() as CompanionSystem;
    companions.init(scene, lib);

    const floor = createMockFloor('crypt');
    const player = createMockPlayer({ x: 20, y: 0, z: 20 });
    companions.respawnAt(player.position, player.level);

    const drops: GroundLootDrop[] = [
      { id: 'drop_gold', position: { x: 25, y: 0, z: 20 }, kind: 'gold', amount: 45, pickedUp: false },
      { id: 'drop_potion', position: { x: 20, y: 0, z: 28 }, kind: 'potion', amount: 1, pickedUp: false },
      { id: 'drop_orb', position: { x: 13, y: 0, z: 20 }, kind: 'health_orb', amount: 25, pickedUp: false },
      { id: 'drop_rune', position: { x: 20, y: 0, z: 9.2 }, kind: 'rune', runeId: 'jah', pickedUp: false }, // 10.8m <= 11m
      { id: 'drop_far', position: { x: 34, y: 0, z: 20 }, kind: 'gold', amount: 99, pickedUp: false }, // 14m > 11m
      { id: 'drop_item', position: { x: 22, y: 0, z: 20 }, kind: 'item', pickedUp: false },
    ];

    const { loot, pickedIds } = createMockLoot(drops);
    const { combat } = createMockCombat();

    // Advance simulation across several steps so pet dashes to all 4 eligible drops within 11m
    let elapsed = 0;
    for (let i = 0; i < 30; i++) {
      elapsed += 0.15;
      companions.update(0.15, elapsed, player, floor, [], loot, combat, false);
    }

    expect(pickedIds).toContain('drop_gold');
    expect(pickedIds).toContain('drop_potion');
    expect(pickedIds).toContain('drop_orb');
    expect(pickedIds).toContain('drop_rune');
    expect(pickedIds).not.toContain('drop_far');
    expect(pickedIds).not.toContain('drop_item');

    companions.dispose();
  });

  it('drives Iron Templar melee cleave, Sylvan Ranger kiting & rapid-fire arrows, and Storm Arcanist lightning/frost bolts & player heal/mana pulse', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const companions = createCompanionSystem() as CompanionSystem;
    companions.init(scene, lib);

    const floor = createMockFloor('crypt');
    const player = createMockPlayer({ x: 20, y: 0, z: 20 });
    player.hp = 150;
    player.mana = 40;
    companions.respawnAt(player.position, player.level);

    const { loot } = createMockLoot([]);
    const combatTracker = createMockCombat();
    const enemy = createMockEnemy('skeleton_1', { x: 22.2, y: 0, z: 22.0 }, 15);

    // 1. Iron Templar: closes into melee range and cleaves/taunts via performMeleeArc
    let elapsed = 0;
    for (let i = 0; i < 12; i++) {
      elapsed += 0.15;
      companions.update(0.15, elapsed, player, floor, [enemy], loot, combatTracker.combat, false);
    }
    expect(combatTracker.meleeCalls).toBeGreaterThan(0);

    // 2. Sylvan Ranger: kites away from close-range enemy and fires emerald projectiles
    companions.setActiveMercenary('sylvan_ranger');
    const mercPosBeforeKite = companions.getMercenaryPosition();
    const closeEnemy = createMockEnemy('hellhound_1', {
      x: mercPosBeforeKite.x + 1.4,
      y: 0,
      z: mercPosBeforeKite.z,
    });
    const distBefore = distXZ(mercPosBeforeKite, closeEnemy.position);

    for (let i = 0; i < 8; i++) {
      elapsed += 0.15;
      companions.update(
        0.15,
        elapsed,
        player,
        floor,
        [closeEnemy],
        loot,
        combatTracker.combat,
        false,
      );
    }
    const distAfter = distXZ(companions.getMercenaryPosition(), closeEnemy.position);
    expect(distAfter).toBeGreaterThan(distBefore);
    expect(
      combatTracker.projectiles.some((p) => p.ownerId === 'merc_sylvan_ranger' && p.ownerIsPlayer),
    ).toBe(true);

    // 3. Storm Arcanist: alternates lightning & ice bolts and pulses player HP + Mana recovery
    companions.setActiveMercenary('storm_arcanist');
    const hpBeforePulse = player.hp;
    const manaBeforePulse = player.mana;
    const rangedEnemy = createMockEnemy('cultist_1', { x: 25, y: 0, z: 24 }, 12);

    for (let i = 0; i < 18; i++) {
      elapsed += 0.15;
      companions.update(
        0.15,
        elapsed,
        player,
        floor,
        [rangedEnemy],
        loot,
        combatTracker.combat,
        false,
      );
    }

    const arcanistBolts = combatTracker.projectiles.filter(
      (p) => p.ownerId === 'merc_storm_arcanist',
    );
    expect(arcanistBolts.some((b) => b.damagePacket.damageType === 'lightning')).toBe(true);
    expect(arcanistBolts.some((b) => b.damagePacket.damageType === 'ice')).toBe(true);
    expect(player.hp).toBeGreaterThan(hpBeforePulse);
    expect(player.mana).toBeGreaterThan(manaBeforePulse);

    companions.dispose();
  });

  it('teleport-leashes when >18m away, idles peacefully in Sanctuary, and auto-revives out of combat after splash damage', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const companions = createCompanionSystem() as CompanionSystem;
    companions.init(scene, lib);

    const floor = createMockFloor('forge');
    const player = createMockPlayer({ x: 16, y: 0, z: 16 });
    companions.respawnAt(player.position, 2);

    const { loot } = createMockLoot([]);
    const combatTracker = createMockCombat();

    // Teleport-leash when hero warps >18m away
    player.position = { x: 58, y: 0, z: 58 };
    companions.update(0.05, 1.0, player, floor, [], loot, combatTracker.combat, false);
    expect(distXZ(companions.getMercenaryPosition(), player.position)).toBeLessThan(6.0);
    expect(distXZ(companions.getPetPosition(), player.position)).toBeLessThan(6.0);

    // Peaceful Sanctuary mode: never attacks Training Dummy
    const dummy = createMockEnemy('training_dummy', { x: 59, y: 0, z: 59 }, 0);
    companions.update(1.0, 2.0, player, floor, [dummy], loot, combatTracker.combat, true);
    expect(combatTracker.meleeCalls).toBe(0);

    // Heavy monster splash damage downs the mercenary
    const mercPos = companions.getMercenaryPosition();
    const crusher = createMockEnemy('golem_1', { x: mercPos.x + 1.2, y: 0, z: mercPos.z }, 260);
    let elapsed = 2.0;
    for (let i = 0; i < 16 && companions.getState().mercenaryAlive; i++) {
      elapsed += 0.9;
      companions.update(0.9, elapsed, player, floor, [crusher], loot, combatTracker.combat, false);
    }
    expect(companions.getState().mercenaryAlive).toBe(false);
    expect(companions.getState().mercenaryHp).toBe(0);

    // Stays downed while enemy remains in combat proximity
    companions.update(3.0, elapsed + 3.0, player, floor, [crusher], loot, combatTracker.combat, false);
    expect(companions.getState().mercenaryAlive).toBe(false);

    // Once enemies are slain (out of combat), auto-revives after 5s cooldown
    crusher.alive = false;
    crusher.hp = 0;
    companions.update(5.5, elapsed + 8.5, player, floor, [crusher], loot, combatTracker.combat, false);
    expect(companions.getState().mercenaryAlive).toBe(true);
    expect(companions.getState().mercenaryHp).toBe(companions.getState().mercenaryMaxHp);

    companions.dispose();
  });

  it('disposes all owned GPU geometries, cloned materials, and textures without disposing shared IMaterialLibrary materials', () => {
    const scene = new THREE.Scene();
    const { lib, sharedDisposedCount } = createMockMaterials();
    const companions = createCompanionSystem() as CompanionSystem;

    companions.init(scene, lib);
    expect(companions.getResourceCounts().geometries).toBeGreaterThan(20);
    expect(companions.getResourceCounts().materials).toBeGreaterThan(10);
    expect(companions.getResourceCounts().textures).toBeGreaterThan(0);

    companions.dispose();
    expect(scene.children).not.toContain(companions.rootGroup);
    expect(companions.getResourceCounts()).toEqual({
      geometries: 0,
      materials: 0,
      textures: 0,
    });
    expect(sharedDisposedCount()).toBe(0);
  });
});
