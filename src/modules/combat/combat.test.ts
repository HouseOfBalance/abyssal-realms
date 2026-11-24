import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  DungeonFloorData,
  EnemyEntity,
  PlayerRuntimeState,
} from '../../contracts/types';
import { MYTHIC_COLOR } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { CombatEngine, createCombatEngine } from './index';

function makeMockPlayer(overrides: Partial<PlayerRuntimeState> = {}): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'TestHero',
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.45,
    hp: 200,
    mana: 100,
    stamina: 100,
    baseAttributes: { strength: 15, dexterity: 10, intelligence: 10, vitality: 15 },
    stats: {
      maxHp: 200,
      hpRegen: 2,
      maxMana: 100,
      manaRegen: 5,
      maxStamina: 100,
      staminaRegen: 15,
      moveSpeed: 6,
      attackPower: 25,
      spellPower: 20,
      armor: 100,
      critChance: 0,
      critMultiplier: 2.0,
      attackSpeed: 1.2,
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
    ...overrides,
  };
}

function makeMockEnemy(id: string, overrides: Partial<EnemyEntity> = {}): EnemyEntity {
  return {
    id,
    name: `Enemy_${id}`,
    archetype: 'skeleton_warrior',
    isBoss: false,
    isElite: false,
    affixes: [],
    position: { x: 0, y: 0, z: 2 },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    radius: 0.5,
    hp: 100,
    maxHp: 100,
    armor: 0,
    moveSpeed: 4,
    attackDamage: 15,
    damageType: 'physical',
    attackRange: 1.5,
    attackCooldownSec: 1.2,
    xpReward: 25,
    lootTierBonus: 0,
    statuses: [],
    alive: true,
    roomId: 'room_1',
    ...overrides,
  };
}

function makeMockFloor(walkablePredicate: (x: number, z: number) => boolean = () => true): DungeonFloorData {
  return {
    floorNumber: 1,
    biome: 'crypt',
    seed: 42,
    cols: 20,
    rows: 20,
    tileSize: 2,
    tiles: [],
    explored: [],
    rooms: [],
    playerSpawn: { x: 0, y: 0, z: 0 },
    bossSpawn: { x: 10, y: 0, z: 10 },
    portalPosition: { x: 12, y: 0, z: 12 },
    interactables: [],
    torchPositions: [],
    worldToGrid: (pos) => ({ col: Math.floor(pos.x / 2), row: Math.floor(pos.z / 2) }),
    gridToWorld: (col, row) => ({ x: col * 2, y: 0, z: row * 2 }),
    isWalkableWorld: (x, z) => walkablePredicate(x, z),
    findPath: () => [],
    revealRadius: () => {},
  };
}

describe('CombatEngine', () => {
  const unsubscribers: Array<() => void> = [];

  afterEach(() => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  });

  it('applies hyperbolic armor mitigation, crits, vulnerable (+25%), shield, knockback, and lifeSteal', () => {
    const combat = createCombatEngine();
    const player = makeMockPlayer({ hp: 120 });
    const enemy = makeMockEnemy('e1', {
      hp: 500,
      maxHp: 500,
      armor: 100, // 100 / (100 + 100) = 50% mitigation
      statuses: [
        {
          id: 'vuln_1',
          type: 'vulnerable',
          remainingSec: 5,
          durationSec: 5,
          stacks: 1,
          potency: 0.25,
          sourceId: 'player',
        },
        {
          id: 'sh_1',
          type: 'shield',
          remainingSec: 5,
          durationSec: 5,
          stacks: 1,
          potency: 45,
          sourceId: 'e1',
        },
      ],
    });

    // Register player reference via tickStatuses(0)
    combat.tickStatuses(0.001, player, [enemy]);

    let hitstopTriggered = false;
    let shakeTriggered = false;
    let dmgNumEmitted = 0;
    unsubscribers.push(
      eventBus.on('engine:hitstop', () => {
        hitstopTriggered = true;
      }),
      eventBus.on('camera:shake', () => {
        shakeTriggered = true;
      }),
      eventBus.on('ui:damageNumber', (e) => {
        dmgNumEmitted = e.amount;
      }),
    );

    // Base 100 * 2.0 (crit) * 0.5 (armor) * 1.25 (vulnerable) = 125 pre-shield
    // Minus 45 shield = 80 finalDamage!
    const res = combat.applyDamageToEnemy(enemy, {
      sourceId: 'player',
      targetId: 'e1',
      baseAmount: 100,
      damageType: 'physical',
      critChance: 1.0,
      critMultiplier: 2.0,
      knockback: { x: 4, y: 0, z: 0 },
      lifeSteal: 0.25, // 25% of 80 = 20 HP healed
    });

    expect(res.isCrit).toBe(true);
    expect(res.finalDamage).toBe(80);
    expect(enemy.hp).toBe(420);
    expect(enemy.statuses.some((s) => s.type === 'shield')).toBe(false);
    expect(res.healedSource).toBe(20);
    expect(player.hp).toBe(140);
    expect(enemy.velocity.x).toBeGreaterThan(0);
    expect(hitstopTriggered).toBe(true);
    expect(shakeTriggered).toBe(true);
    expect(dmgNumEmitted).toBe(80);

    combat.dispose();
  });

  it('respects player dodge rolls, i-frames, and passive dodgeChance', () => {
    const combat = createCombatEngine();
    const player = makeMockPlayer({ isDodging: true });

    const rollHit = combat.applyDamageToPlayer(player, {
      sourceId: 'e1',
      targetId: 'player',
      baseAmount: 80,
      damageType: 'fire',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(rollHit.isDodged).toBe(true);
    expect(rollHit.finalDamage).toBe(0);
    expect(player.hp).toBe(200);

    player.isDodging = false;
    player.invulnerableSec = 0.25;
    const iframeHit = combat.applyDamageToPlayer(player, {
      sourceId: 'e1',
      targetId: 'player',
      baseAmount: 80,
      damageType: 'fire',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(iframeHit.isDodged).toBe(true);
    expect(player.hp).toBe(200);

    player.invulnerableSec = 0;
    player.stats.dodgeChance = 1.0;
    const passiveEvade = combat.applyDamageToPlayer(player, {
      sourceId: 'e1',
      targetId: 'player',
      baseAmount: 80,
      damageType: 'physical',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(passiveEvade.isDodged).toBe(true);
    expect(player.hp).toBe(200);

    combat.dispose();
  });

  it('filters melee arcs and AoE radii accurately and tracks kill-streak combos', () => {
    const combat = createCombatEngine();
    const frontEnemy = makeMockEnemy('front', { hp: 30, position: { x: 0, y: 0, z: 2.0 } });
    const sideOutsideArc = makeMockEnemy('side', { hp: 30, position: { x: 2.0, y: 0, z: 0 } });
    const farEnemy = makeMockEnemy('far', { hp: 30, position: { x: 0, y: 0, z: 6.0 } });

    let killedCount = 0;
    unsubscribers.push(
      eventBus.on('combat:enemyKilled', () => {
        killedCount++;
      }),
    );

    const meleeRes = combat.performMeleeArc(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      2.5,
      Math.PI / 2, // 90 deg cone (+/- 45 deg around +Z)
      {
        sourceId: 'player',
        baseAmount: 50,
        damageType: 'physical',
        critChance: 0,
        critMultiplier: 1.5,
      },
      [frontEnemy, sideOutsideArc, farEnemy],
    );

    expect(meleeRes).toHaveLength(1);
    expect(meleeRes[0].killed).toBe(true);
    expect(frontEnemy.alive).toBe(false);
    expect(sideOutsideArc.alive).toBe(true);
    expect(killedCount).toBe(1);

    const comboAfterOne = combat.getComboState();
    expect(comboAfterOne.count).toBe(1);
    expect(comboAfterOne.multiplier).toBeGreaterThan(1);

    const aoeRes = combat.performAoE(
      { x: 2.0, y: 0, z: 0 },
      1.5,
      {
        sourceId: 'player',
        baseAmount: 60,
        damageType: 'fire',
        critChance: 0,
        critMultiplier: 1.5,
      },
      [frontEnemy, sideOutsideArc, farEnemy],
    );

    expect(aoeRes).toHaveLength(1);
    expect(sideOutsideArc.alive).toBe(false);
    expect(combat.getComboState().count).toBe(2);

    // Decay combo past 5s window
    combat.tickStatuses(5.5, makeMockPlayer(), []);
    expect(combat.getComboState().count).toBe(0);
    expect(combat.getComboState().multiplier).toBe(1);

    combat.dispose();
  });

  it('ticks stacking DoTs, chill (-35% speed), freeze/stun disable, and haste with clean restoration', () => {
    const combat = createCombatEngine();
    const player = makeMockPlayer();
    const enemy = makeMockEnemy('dot_target', { hp: 100, maxHp: 100, moveSpeed: 10 });

    // Apply 2 stacks of poison (10 DPS/stack -> 20 DPS) + chill (-35% speed)
    for (let i = 0; i < 2; i++) {
      combat.applyDamageToEnemy(enemy, {
        sourceId: 'player',
        targetId: enemy.id,
        baseAmount: 5,
        damageType: 'poison',
        critChance: 0,
        critMultiplier: 1.5,
        appliesStatus: { type: 'poison', chance: 1, durationSec: 2.0, potency: 10 },
      });
    }
    combat.applyDamageToEnemy(enemy, {
      sourceId: 'player',
      targetId: enemy.id,
      baseAmount: 0,
      damageType: 'ice',
      critChance: 0,
      critMultiplier: 1.5,
      appliesStatus: { type: 'chill', chance: 1, durationSec: 1.0, potency: 0.35 },
    });

    const hpBeforeTick = enemy.hp; // 90 after two 5-dmg hits
    combat.tickStatuses(0.5, player, [enemy]);
    expect(enemy.hp).toBeCloseTo(hpBeforeTick - 10, 2); // 20 DPS * 0.5s = 10 dmg
    expect(enemy.moveSpeed).toBeCloseTo(6.5, 3); // 10 * 0.65 (-35%)

    // Freeze overrides speed to 0 and zeroes velocity
    enemy.velocity = { x: 3, y: 0, z: 3 };
    combat.applyDamageToEnemy(enemy, {
      sourceId: 'player',
      targetId: enemy.id,
      baseAmount: 0,
      damageType: 'ice',
      critChance: 0,
      critMultiplier: 1.5,
      appliesStatus: { type: 'freeze', chance: 1, durationSec: 0.4, potency: 1 },
    });
    combat.tickStatuses(0.2, player, [enemy]);
    expect(enemy.moveSpeed).toBe(0);
    expect(enemy.velocity.x).toBe(0);

    // Expire all statuses and verify base moveSpeed restores to 10
    combat.tickStatuses(2.5, player, [enemy]);
    expect(enemy.statuses).toHaveLength(0);
    expect(enemy.moveSpeed).toBeCloseTo(10, 3);

    // Haste on player boosts moveSpeed and restores when expired
    player.statuses.push({
      id: 'haste_1',
      type: 'haste',
      remainingSec: 1.0,
      durationSec: 1.0,
      stacks: 1,
      potency: 0.25,
      sourceId: 'player',
    });
    combat.tickStatuses(0.5, player, []);
    expect(player.stats.moveSpeed).toBeCloseTo(6 * 1.25, 3);
    combat.tickStatuses(0.6, player, []);
    expect(player.stats.moveSpeed).toBeCloseTo(6, 3);

    combat.dispose();
  });

  it('simulates pooled 3D projectiles: scene meshes, homing, piercing, walls, and AoE detonation', () => {
    const scene = new THREE.Scene();
    const combat = createCombatEngine();
    combat.init(scene);

    const player = makeMockPlayer();
    const e1 = makeMockEnemy('p1', { hp: 100, position: { x: 0, y: 0, z: 3 } });
    const e2 = makeMockEnemy('p2', { hp: 100, position: { x: 0, y: 0, z: 6 } });
    const floor = makeMockFloor((_x, z) => z < 10); // Wall at z >= 10

    // 1. Piercing arcane bolt hits both e1 and e2 once
    combat.spawnProjectile({
      ownerIsPlayer: true,
      ownerId: 'player',
      origin: { x: 0, y: 0.9, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      speed: 20,
      maxDistance: 15,
      radius: 0.35,
      piercing: true,
      damagePacket: {
        sourceId: 'player',
        baseAmount: 30,
        damageType: 'void',
        critChance: 0,
        critMultiplier: 1.5,
      },
      visualColorHex: 0xda77f2,
    });

    expect(scene.children.length).toBe(1);
    combat.updateProjectiles(0.4, floor, player, [e1, e2]); // Moves 8 units (past z=3 and z=6)
    expect(e1.hp).toBe(70);
    expect(e2.hp).toBe(70);

    // 2. Wall collision triggers AoE fireball detonation near wall at z=10
    const wallSideEnemy = makeMockEnemy('wall_adj', { hp: 100, position: { x: 1.5, y: 0, z: 9.5 } });
    combat.spawnProjectile({
      ownerIsPlayer: true,
      ownerId: 'player',
      origin: { x: 0, y: 0.9, z: 8 },
      direction: { x: 0, y: 0, z: 1 },
      speed: 15,
      maxDistance: 20,
      radius: 0.3,
      piercing: false,
      aoeExplosionRadius: 2.5,
      damagePacket: {
        sourceId: 'player',
        baseAmount: 45,
        damageType: 'fire',
        critChance: 0,
        critMultiplier: 1.5,
      },
      visualColorHex: 0xff6b35,
    });

    combat.updateProjectiles(0.25, floor, player, [wallSideEnemy]);
    expect(wallSideEnemy.hp).toBe(55);

    // 3. Homing projectile curves to hit off-axis target
    const homingTarget = makeMockEnemy('homing_e', { hp: 100, position: { x: 2.2, y: 0, z: 5 } });
    combat.spawnProjectile({
      ownerIsPlayer: true,
      ownerId: 'player',
      origin: { x: 0, y: 0.9, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      speed: 10,
      maxDistance: 15,
      radius: 0.4,
      piercing: false,
      homing: true,
      damagePacket: {
        sourceId: 'player',
        baseAmount: 40,
        damageType: 'ice',
        critChance: 0,
        critMultiplier: 1.5,
      },
      visualColorHex: 0x4dabf7,
    });

    for (let step = 0; step < 12; step++) {
      combat.updateProjectiles(0.06, floor, player, [homingTarget]);
    }
    expect(homingTarget.hp).toBe(60);

    combat.clearFloorEntities();
    combat.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('supports immortal training_dummy (full crit/armor math, events, clamped maxHp, DoT ticks)', () => {
    const combat = createCombatEngine();
    const player = makeMockPlayer();
    const dummy = makeMockEnemy('training_dummy', {
      hp: 1000,
      maxHp: 1000,
      armor: 100, // 50% mitigation
      position: { x: 4, y: 0, z: 4 },
    });

    const dealtEvents: number[] = [];
    const damageNumbers: number[] = [];
    let dummyKilledFired = false;

    unsubscribers.push(
      eventBus.on('combat:damageDealt', ({ result, targetId }) => {
        if (targetId === 'training_dummy') {
          dealtEvents.push(result.finalDamage);
        }
      }),
      eventBus.on('ui:damageNumber', ({ amount }) => {
        damageNumbers.push(amount);
      }),
      eventBus.on('combat:enemyKilled', ({ enemy }) => {
        if (enemy.id === 'training_dummy') {
          dummyKilledFired = true;
        }
      }),
    );

    // Massive overkill hit: 5000 base * 2.0 crit * 0.5 armor = 5000 damage (> 1000 maxHp!)
    const hit = combat.applyDamageToEnemy(dummy, {
      sourceId: 'player',
      targetId: 'training_dummy',
      baseAmount: 5000,
      damageType: 'fire',
      critChance: 1.0,
      critMultiplier: 2.0,
      knockback: { x: 10, y: 0, z: 10 },
      appliesStatus: { type: 'burn', chance: 1.0, durationSec: 2.0, potency: 40 },
    });

    expect(hit.finalDamage).toBe(5000);
    expect(hit.isCrit).toBe(true);
    expect(hit.killed).toBe(false);
    expect(dummy.hp).toBe(1000);
    expect(dummy.alive).toBe(true);
    expect(dummy.position.x).toBe(4);
    expect(dummy.position.z).toBe(4);
    expect(dummyKilledFired).toBe(false);
    expect(dealtEvents).toContain(5000);
    expect(damageNumbers).toContain(5000);

    // Tick burn DoT for 0.6s -> dummy stays at full HP and emits DoT popup + damageDealt
    combat.tickStatuses(0.6, player, [dummy]);
    expect(dummy.hp).toBe(1000);
    expect(dummy.alive).toBe(true);
    expect(dealtEvents.length).toBeGreaterThanOrEqual(2);

    combat.dispose();
  });

  it('highlights isMythic crits/procs cleanly and preserves pre-death statuses for elemental reactions', () => {
    const combat = new CombatEngine();
    let flashedColor: number | undefined;
    const enemy = makeMockEnemy('fodder_frozen', {
      hp: 40,
      maxHp: 100,
      statuses: [
        {
          id: 'frz_1',
          type: 'freeze',
          remainingSec: 2.0,
          durationSec: 2.0,
          stacks: 1,
          potency: 1,
          sourceId: 'player',
        },
      ],
      meshHandle: {
        root: new THREE.Group(),
        playAnim: () => {},
        flashHit: (hex) => {
          flashedColor = hex;
        },
        setEliteVisuals: () => {},
        update: () => {},
        dispose: () => {},
      },
    });

    // Simulate equipping a Mythic weapon via hero:gearChanged
    eventBus.emit('hero:gearChanged', {
      slot: 'weapon',
      weaponVisual: 'greatsword',
      rarity: 'legendary',
      item: {
        id: 'mythic_blade',
        name: 'Primal Apocalypse',
        slot: 'weapon',
        rarity: 'legendary',
        isMythic: true,
        levelReq: 1,
        itemLevel: 20,
        upgradeLevel: 0,
        affixes: [],
        goldValue: 1000,
        icon: '⚔',
      },
    });

    const vfxColors: number[] = [];
    let sawFreezeDuringKillDamageEvent = false;

    unsubscribers.push(
      eventBus.on('vfx:request', (e) => {
        if (e.colorHex !== undefined) {
          vfxColors.push(e.colorHex);
        }
      }),
      eventBus.on('combat:damageDealt', ({ targetId }) => {
        if (targetId === enemy.id && enemy.statuses.some((s) => s.type === 'freeze')) {
          sawFreezeDuringKillDamageEvent = true;
        }
      }),
    );

    const res = combat.applyDamageToEnemy(enemy, {
      sourceId: 'player',
      targetId: enemy.id,
      baseAmount: 60,
      damageType: 'fire',
      critChance: 1.0,
      critMultiplier: 2.2,
    });

    expect(res.killed).toBe(true);
    expect(flashedColor).toBe(MYTHIC_COLOR.hex);
    expect(vfxColors).toContain(MYTHIC_COLOR.hex);
    expect(sawFreezeDuringKillDamageEvent).toBe(true);
    expect(enemy.statuses).toHaveLength(0); // Cleaned up after listeners run

    combat.dispose();
  });
});
