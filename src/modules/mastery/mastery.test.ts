import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ActiveStatusEffect,
  ElementalReactionType,
  EnemyEntity,
  ICombatEngine,
  ICombatMasterySystem,
  PlayerRuntimeState,
  StatusEffectType,
  Vec3,
} from '../../contracts/types';
import { distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { createCombatEngine } from '../combat';
import { CombatMasterySystem, createCombatMasterySystem } from './index';

function makePlayer(pos: Vec3 = { x: 0, y: 0, z: 0 }): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'TestHero',
    level: 5,
    xp: 0,
    xpToNextLevel: 200,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { ...pos },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.45,
    hp: 250,
    mana: 100,
    stamina: 100,
    baseAttributes: { strength: 16, dexterity: 12, intelligence: 12, vitality: 15 },
    stats: {
      maxHp: 250,
      hpRegen: 2,
      maxMana: 100,
      manaRegen: 4,
      maxStamina: 100,
      staminaRegen: 15,
      moveSpeed: 6.5,
      attackPower: 45,
      spellPower: 45,
      armor: 25,
      critChance: 0.25,
      critMultiplier: 1.75,
      attackSpeed: 1.1,
      cooldownReduction: 0.1,
      lifeSteal: 0.05,
      dodgeChance: 0,
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
    killsTotal: 0,
  };
}

function makeEnemy(
  id: string,
  pos: Vec3,
  options?: {
    isBoss?: boolean;
    hp?: number;
    statuses?: ActiveStatusEffect[];
    velocity?: Vec3;
  },
): EnemyEntity {
  const maxHp = options?.hp ?? (options?.isBoss ? 1800 : 300);
  return {
    id,
    name: options?.isBoss ? 'Malakor' : `Enemy_${id}`,
    archetype: options?.isBoss ? 'malakor_void_emperor' : 'skeleton_warrior',
    isBoss: Boolean(options?.isBoss),
    isElite: false,
    affixes: [],
    position: { ...pos },
    velocity: options?.velocity ? { ...options.velocity } : { x: 0, y: 0, z: 0 },
    rotationY: 0,
    radius: options?.isBoss ? 1.1 : 0.55,
    hp: maxHp,
    maxHp,
    armor: 15,
    moveSpeed: 3.5,
    attackDamage: 32,
    damageType: 'physical',
    attackRange: options?.isBoss ? 3.4 : 2.2,
    attackCooldownSec: 1.5,
    xpReward: 40,
    lootTierBonus: 0,
    statuses: options?.statuses ? [...options.statuses] : [],
    alive: true,
    roomId: 'room_1',
  };
}

function makeStatus(type: StatusEffectType, durationSec = 4.0): ActiveStatusEffect {
  return {
    id: `test_${type}`,
    type,
    remainingSec: durationSec,
    durationSec,
    stacks: 1,
    potency: 10,
    sourceId: 'player',
  };
}

describe('CombatMasterySystem', () => {
  let scene: THREE.Scene;
  let combat: ICombatEngine;
  let mastery: ICombatMasterySystem;
  let player: PlayerRuntimeState;

  beforeEach(() => {
    scene = new THREE.Scene();
    combat = createCombatEngine();
    combat.init(scene);
    mastery = createCombatMasterySystem();
    mastery.init(scene);
    player = makePlayer({ x: 0, y: 0, z: 0 });
  });

  afterEach(() => {
    mastery.dispose();
    combat.dispose();
  });

  it('triggers all 4 Elemental Combo Reactions with AoE effects, inward Singularity pull, and per-target ICD', () => {
    expect(mastery).toBeInstanceOf(CombatMasterySystem);
    expect(scene.children.some((c) => c.name === 'CombatMasteryVfxRoot')).toBe(true);

    const reactions: Array<{ reaction: ElementalReactionType; position: Vec3; damage: number }> = [];
    const unsub = eventBus.on('combat:elementalReaction', (ev) => {
      reactions.push(ev);
    });

    // 1. SHATTER: freeze + physical/fire
    const frozenTarget = makeEnemy('e_shatter', { x: 0, y: 0, z: 2.5 }, {
      statuses: [makeStatus('freeze')],
    });
    const bystander = makeEnemy('e_bystander', { x: 1.6, y: 0, z: 2.5 });
    const pack1 = [frozenTarget, bystander];

    mastery.update(0.016, 0.1, player, pack1, null, combat);
    combat.applyDamageToEnemy(frozenTarget, {
      sourceId: 'player',
      targetId: frozenTarget.id,
      baseAmount: 40,
      damageType: 'fire',
      critChance: 0,
      critMultiplier: 1.5,
    });

    expect(reactions.length).toBe(1);
    expect(reactions[0].reaction).toBe('shatter');
    expect(reactions[0].damage).toBeGreaterThan(0);
    expect(bystander.hp).toBeLessThan(bystander.maxHp);

    // Per-target ICD blocks immediate repeat reaction on the same frozen target (no infinite loop!)
    combat.applyDamageToEnemy(frozenTarget, {
      sourceId: 'player',
      targetId: frozenTarget.id,
      baseAmount: 40,
      damageType: 'physical',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(reactions.length).toBe(1);

    // After ICD expires (> 1.25s), Shatter can trigger again on that target
    mastery.update(1.35, 1.45, player, pack1, null, combat);
    combat.applyDamageToEnemy(frozenTarget, {
      sourceId: 'player',
      targetId: frozenTarget.id,
      baseAmount: 40,
      damageType: 'physical',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(reactions.length).toBe(2);
    expect(reactions[1].reaction).toBe('shatter');

    // 2. VOLATILE BLAST: poison + fire
    const poisonedTarget = makeEnemy('e_poison', { x: -4, y: 0, z: 3 }, {
      statuses: [makeStatus('poison')],
    });
    mastery.update(0.016, 1.5, player, [poisonedTarget], null, combat);
    combat.applyDamageToEnemy(poisonedTarget, {
      sourceId: 'player',
      targetId: poisonedTarget.id,
      baseAmount: 45,
      damageType: 'fire',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(reactions.length).toBe(3);
    expect(reactions[2].reaction).toBe('volatile_blast');

    // 3. SUPERCONDUCT: chill + lightning -> applies 'vulnerable' to enemies in wide shock arc
    const chilledTarget = makeEnemy('e_chill', { x: 5, y: 0, z: 0 }, {
      statuses: [makeStatus('chill')],
    });
    const arcNeighbor = makeEnemy('e_neighbor', { x: 8.2, y: 0, z: 0 });
    const pack3 = [chilledTarget, arcNeighbor];
    mastery.update(0.016, 1.6, player, pack3, null, combat);
    combat.applyDamageToEnemy(chilledTarget, {
      sourceId: 'player',
      targetId: chilledTarget.id,
      baseAmount: 38,
      damageType: 'lightning',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(reactions.length).toBe(4);
    expect(reactions[3].reaction).toBe('superconduct');
    expect(arcNeighbor.statuses.some((s) => s.type === 'vulnerable' && s.remainingSec > 0)).toBe(
      true,
    );

    // 4. ABYSSAL SINGULARITY: void prime + fire/lightning -> pulls nearby monsters inward!
    const voidTarget = makeEnemy('e_void_core', { x: 0, y: 0, z: -6 });
    const pulledMob = makeEnemy('e_pulled', { x: 4.5, y: 0, z: -6 });
    const pack4 = [voidTarget, pulledMob];
    const initialDist = distXZ(voidTarget.position, pulledMob.position);

    mastery.update(0.016, 1.7, player, pack4, null, combat);
    // Prime with Void damage
    combat.applyDamageToEnemy(voidTarget, {
      sourceId: 'player',
      targetId: voidTarget.id,
      baseAmount: 30,
      damageType: 'void',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(reactions.length).toBe(4);

    // Detonate with Lightning damage
    combat.applyDamageToEnemy(voidTarget, {
      sourceId: 'player',
      targetId: voidTarget.id,
      baseAmount: 42,
      damageType: 'lightning',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(reactions.length).toBe(5);
    expect(reactions[4].reaction).toBe('abyssal_singularity');

    mastery.update(0.2, 1.9, player, pack4, null, combat);
    const afterPullDist = distXZ(voidTarget.position, pulledMob.position);
    expect(afterPullDist).toBeLessThan(initialDist);

    unsub();
  });

  it('handles Perfect Parry 0.28s window, 2.5s -> 0.6s cooldown reset, damage negation, Boss Stagger, and Execution Strike', () => {
    const parryEvents: boolean[] = [];
    const hitstopEvents: number[] = [];
    const execEvents: Array<{ targetId: string; damage: number }> = [];

    const unsubParry = eventBus.on('combat:parryTriggered', (e) => parryEvents.push(e.counterSuccess));
    const unsubHitstop = eventBus.on('engine:hitstop', (e) => hitstopEvents.push(e.durationSec));
    const unsubExec = eventBus.on('combat:executionStrike', (e) =>
      execEvents.push({ targetId: e.targetId, damage: e.damage }),
    );

    const boss = makeEnemy('boss_1', { x: 0, y: 0, z: 10 }, { isBoss: true, hp: 2400 });
    mastery.update(0.016, 0, player, [boss], boss, combat);

    // Start parry with no windup enemy in melee reach -> 0.28s active ward & 2.5s cooldown
    const firstParry = mastery.triggerParry(player, [boss], combat);
    expect(firstParry).toEqual({ started: true, instantCountered: 0 });
    expect(mastery.getHudState().parryActiveWindow).toBe(true);
    expect(mastery.getHudState().parryCooldownSec).toBeCloseTo(2.5, 2);
    expect(parryEvents).toEqual([false]);

    // Intercept incoming boss projectile during 0.28s window -> 100% negated, cooldown reset to 0.6s, +50 Boss Stagger
    const deflected = mastery.interceptIncomingPlayerHit(player, boss.position, 95);
    expect(deflected).toEqual({ parried: true, damageMultiplier: 0 });
    expect(mastery.getHudState().parryCooldownSec).toBeCloseTo(0.6, 2);
    expect(mastery.getHudState().bossStagger).toBeGreaterThanOrEqual(50);
    expect(parryEvents).toEqual([false, true]);
    expect(hitstopEvents.length).toBeGreaterThan(0);

    // Advance past 0.28s window & 0.6s cooldown
    mastery.update(0.3, 0.3, player, [boss], boss, combat);
    expect(mastery.getHudState().parryActiveWindow).toBe(false);
    expect(mastery.interceptIncomingPlayerHit(player, boss.position, 50)).toEqual({
      parried: false,
      damageMultiplier: 1,
    });
    mastery.update(0.35, 0.65, player, [boss], boss, combat);
    expect(mastery.getHudState().parryCooldownSec).toBe(0);

    // Boss moves into melee windup posture next to player -> instant counter hits 100 Stagger!
    boss.position = { x: 0, y: 0, z: 2.2 };
    boss.velocity = { x: 0, y: 0, z: 0 };
    const secondParry = mastery.triggerParry(player, [boss], combat);
    expect(secondParry.started).toBe(true);
    expect(secondParry.instantCountered).toBe(1);

    mastery.update(0.016, 0.7, player, [boss], boss, combat);
    const hudStaggered = mastery.getHudState();
    expect(hudStaggered.bossStagger).toBe(100);
    expect(hudStaggered.bossStaggered).toBe(true);
    expect(hudStaggered.canExecuteTargetId).toBe(boss.id);
    expect(boss.statuses.some((s) => s.type === 'stun')).toBe(true);

    // Execute staggered boss -> massive damage + 'combat:executionStrike' + resets stagger
    const hpBeforeExec = boss.hp;
    const execRes = mastery.tryExecuteStaggeredTarget(player, [boss], combat);
    expect(execRes.executed).toBe(true);
    expect(execRes.target?.id).toBe(boss.id);
    expect(execRes.damageDealt).toBeGreaterThan(200);
    expect(boss.hp).toBeLessThan(hpBeforeExec);
    expect(execEvents.length).toBe(1);
    expect(execEvents[0].targetId).toBe(boss.id);
    expect(mastery.getHudState().bossStaggered).toBe(false);
    expect(mastery.getHudState().bossStagger).toBe(0);

    unsubParry();
    unsubHitstop();
    unsubExec();
  });

  it('builds 0..100 Fury and activates 15s Abyssal Awakening Overdrive with exact stat multipliers and events', () => {
    const awakeningStates: boolean[] = [];
    const unsubAwk = eventBus.on('player:awakeningChanged', (e) => awakeningStates.push(e.active));

    const dummy = makeEnemy('mob_fury', { x: 0, y: 0, z: 2.0 }, { hp: 2000 });
    mastery.update(0.016, 0, player, [dummy], null, combat);

    // Cannot trigger Awakening below 100 Fury
    expect(mastery.triggerAwakening(player)).toBe(false);
    expect(mastery.getAwakeningMultipliers()).toEqual({
      damageMultiplier: 1.0,
      attackSpeedMultiplier: 1.0,
      moveSpeedMultiplier: 1.0,
      cooldownMultiplier: 1.0,
      lifeStealBonus: 0,
    });

    // Combat hits build Fury automatically
    combat.applyDamageToEnemy(dummy, {
      sourceId: 'player',
      targetId: dummy.id,
      baseAmount: 35,
      damageType: 'physical',
      critChance: 1.0,
      critMultiplier: 1.8,
    });
    expect(mastery.getHudState().fury).toBeGreaterThan(0);

    // Top off Fury to 100 and unleash Archon Overdrive
    mastery.addFury(100);
    expect(mastery.getHudState().fury).toBe(100);

    expect(mastery.triggerAwakening(player)).toBe(true);
    expect(awakeningStates).toEqual([true]);

    const activeHud = mastery.getHudState();
    expect(activeHud.awakened).toBe(true);
    expect(activeHud.fury).toBe(0);
    expect(activeHud.awakenedDurationSec).toBe(15);
    expect(activeHud.awakenedRemainingSec).toBe(15);
    expect(mastery.getAwakeningMultipliers()).toEqual({
      damageMultiplier: 1.5,
      attackSpeedMultiplier: 1.45,
      moveSpeedMultiplier: 1.32,
      cooldownMultiplier: 0.5,
      lifeStealBonus: 0.12,
    });

    // Advance 15.1s -> Awakening expires cleanly and emits active: false
    mastery.update(15.1, 15.2, player, [dummy], null, combat);
    expect(mastery.getHudState().awakened).toBe(false);
    expect(awakeningStates).toEqual([true, false]);
    expect(mastery.getAwakeningMultipliers().damageMultiplier).toBe(1.0);

    // resetFloor & dispose clean up scene objects
    mastery.resetFloor();
    mastery.dispose();
    expect(scene.children.some((c) => c.name === 'CombatMasteryVfxRoot')).toBe(false);

    unsubAwk();
  });

  it('stuns normal enemies on melee windup parry, expires unexecuted Boss Stagger after 4.5s, and detonates reactions on lethal hits', () => {
    // 1. Melee windup parry against normal skeleton applies stun & knockback
    const skeleton = makeEnemy('skel_windup', { x: 0, y: 0, z: 1.8 });
    const parryRes = mastery.triggerParry(player, [skeleton], combat);
    expect(parryRes).toEqual({ started: true, instantCountered: 1 });
    expect(skeleton.statuses.some((s) => s.type === 'stun' && s.remainingSec > 0)).toBe(true);
    expect(skeleton.velocity.z).toBeGreaterThan(0);

    // Advance past 0.6s parry cooldown; stunned skeleton should not be free-countered again while stunned
    mastery.update(0.7, 0.7, player, [skeleton], null, combat);
    const repeatOnStunned = mastery.triggerParry(player, [skeleton], combat);
    expect(repeatOnStunned).toEqual({ started: true, instantCountered: 0 });
    mastery.resetFloor();

    // 2. Boss Stagger expires cleanly after 4.5s if player does not execute
    const boss = makeEnemy('boss_timeout', { x: 0, y: 0, z: 2.0 }, { isBoss: true, hp: 3000 });
    mastery.triggerParry(player, [boss], combat);
    mastery.update(0.7, 1.4, player, [boss], boss, combat);
    mastery.triggerParry(player, [boss], combat);
    expect(mastery.getHudState().bossStaggered).toBe(true);

    mastery.update(4.6, 6.0, player, [boss], boss, combat);
    expect(mastery.getHudState().bossStaggered).toBe(false);
    expect(mastery.getHudState().bossStagger).toBe(0);
    expect(mastery.tryExecuteStaggeredTarget(player, [boss], combat).executed).toBe(false);

    // 3. Lethal hit on a low-HP frozen enemy still detonates Shatter onto nearby foes
    const lowFrozen = makeEnemy('low_frozen', { x: 4, y: 0, z: 4 }, {
      hp: 10,
      statuses: [makeStatus('freeze')],
    });
    const splashFoe = makeEnemy('splash_foe', { x: 5.5, y: 0, z: 4 });
    mastery.update(0.016, 6.1, player, [lowFrozen, splashFoe], null, combat);

    let lethalShattered = false;
    const unsub = eventBus.on('combat:elementalReaction', (e) => {
      if (e.reaction === 'shatter') lethalShattered = true;
    });

    combat.applyDamageToEnemy(lowFrozen, {
      sourceId: 'player',
      targetId: lowFrozen.id,
      baseAmount: 200,
      damageType: 'fire',
      critChance: 0,
      critMultiplier: 1.5,
    });
    expect(lowFrozen.alive).toBe(false);
    expect(lethalShattered).toBe(true);
    expect(splashFoe.hp).toBeLessThan(splashFoe.maxHp);

    unsub();
  });
});
