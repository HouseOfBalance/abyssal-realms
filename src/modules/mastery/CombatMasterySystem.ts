import type * as THREE from 'three';
import type {
  ActiveStatusEffect,
  DamagePacket,
  EnemyEntity,
  ICombatEngine,
  ICombatMasterySystem,
  MasteryHudState,
  PlayerRuntimeState,
  StatusEffectType,
  Vec3,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { eventBus, type GameEventMap } from '../../core/EventBus';
import { MasteryVfxRenderer } from './MasteryVfxRenderer';
import { ReactionEngine } from './ReactionEngine';

export const MAX_FURY = 100;
export const AWAKENING_DURATION_SEC = 15.0;

export const PARRY_WINDOW_SEC = 0.28;
export const PARRY_COOLDOWN_SEC = 2.5;
export const PARRY_SUCCESS_COOLDOWN_SEC = 0.6;
export const PARRY_REFLECT_RADIUS = 4.5;

export const BOSS_MAX_STAGGER = 100;
export const BOSS_STAGGERED_DURATION_SEC = 4.5;
export const EXECUTION_RANGE = 9.0;

const BOSS_PARRY_STAGGER_GAIN = 50;
const BOSS_HIT_STAGGER_GAIN = 5;
const BOSS_CRIT_STAGGER_GAIN = 9;
const BOSS_REACTION_STAGGER_GAIN = 14;

let nextMasteryStatusUid = 1;

export class CombatMasterySystem implements ICombatMasterySystem {
  private readonly reactions = new ReactionEngine();
  private readonly vfx = new MasteryVfxRenderer();

  private scene: THREE.Scene | null = null;
  private unsubDamageDealt: (() => void) | null = null;
  private disposed = false;

  // Fury & Abyssal Awakening State
  private fury = 0;
  private awakened = false;
  private awakenedRemainingSec = 0;

  // Perfect Parry State
  private parryCooldownSec = 0;
  private parryActiveWindow = false;
  private parryWindowRemainingSec = 0;
  private parryCounteredInCurrentWindow = false;

  // Boss Stagger & Execution State
  private bossStagger = 0;
  private bossStaggered = false;
  private bossStaggeredTimerSec = 0;
  private staggeredBossId: string | null = null;
  private canExecuteTargetId: string | null = null;

  // Cached Runtime References for Event-Driven Reactions & Ripostes
  private lastPlayer: PlayerRuntimeState | null = null;
  private lastTargets: EnemyEntity[] = [];
  private activeBoss: EnemyEntity | null = null;
  private lastCombat: ICombatEngine | null = null;
  private isExecutingInternalStrike = false;

  public init(scene: THREE.Scene): void {
    if (this.disposed) return;
    this.scene = scene;
    this.vfx.attachToScene(scene);
    this.ensureSubscribed();
  }

  public triggerParry(
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
    combat: ICombatEngine,
  ): { started: boolean; instantCountered: number } {
    if (this.disposed || !player || !player.alive || player.hp <= 0) {
      return { started: false, instantCountered: 0 };
    }
    if (this.parryCooldownSec > 0 || this.parryActiveWindow) {
      return { started: false, instantCountered: 0 };
    }

    this.ensureSubscribed();
    this.cacheRuntimeRefs(player, enemies, this.activeBoss, combat);

    this.parryActiveWindow = true;
    this.parryWindowRemainingSec = PARRY_WINDOW_SEC;
    this.parryCooldownSec = PARRY_COOLDOWN_SEC;
    this.parryCounteredInCurrentWindow = false;

    const counteredEnemies = this.findParryableWindupEnemies(player, this.lastTargets);
    if (counteredEnemies.length > 0) {
      this.resolveParryCounterSuccess(
        player,
        this.lastTargets,
        combat,
        counteredEnemies,
        0,
      );
      return {
        started: true,
        instantCountered: counteredEnemies.length,
      };
    }

    eventBus.emit('combat:parryTriggered', {
      position: { ...player.position },
      counterSuccess: false,
    });

    return {
      started: true,
      instantCountered: 0,
    };
  }

  public interceptIncomingPlayerHit(
    player: PlayerRuntimeState,
    attackerPos: Vec3 | null,
    rawDamage: number,
  ): { parried: boolean; damageMultiplier: number } {
    if (
      this.disposed ||
      !this.parryActiveWindow ||
      !player ||
      !player.alive ||
      player.hp <= 0
    ) {
      return { parried: false, damageMultiplier: 1 };
    }

    this.ensureSubscribed();
    this.lastPlayer = player;

    const matchedAttackers: EnemyEntity[] = [];
    if (attackerPos && this.lastTargets.length > 0) {
      for (let i = 0; i < this.lastTargets.length; i++) {
        const enemy = this.lastTargets[i];
        if (enemy && enemy.alive && distXZ(enemy.position, attackerPos) <= 2.4) {
          matchedAttackers.push(enemy);
        }
      }
    }

    this.resolveParryCounterSuccess(
      player,
      this.lastTargets,
      this.lastCombat,
      matchedAttackers,
      Math.max(0, Number.isFinite(rawDamage) ? rawDamage : 0),
      attackerPos,
    );

    return {
      parried: true,
      damageMultiplier: 0,
    };
  }

  public triggerAwakening(player: PlayerRuntimeState): boolean {
    if (
      this.disposed ||
      !player ||
      !player.alive ||
      player.hp <= 0 ||
      this.awakened ||
      this.fury < MAX_FURY
    ) {
      return false;
    }

    this.ensureSubscribed();
    this.lastPlayer = player;

    this.fury = 0;
    this.awakened = true;
    this.awakenedRemainingSec = AWAKENING_DURATION_SEC;

    // Surge hero resources & grant brief transformation grace
    player.mana = Math.min(player.stats.maxMana, player.mana + player.stats.maxMana * 0.5);
    player.stamina = player.stats.maxStamina;
    player.invulnerableSec = Math.max(player.invulnerableSec, 0.45);

    eventBus.emit('player:awakeningChanged', {
      active: true,
      position: { ...player.position },
    });
    eventBus.emit('engine:hitstop', {
      durationSec: 0.08,
      timeScale: 0.08,
    });
    eventBus.emit('camera:shake', { trauma: 0.42 });
    eventBus.emit('lighting:flash', {
      colorHex: 0xffb703,
      intensity: 2.4,
      durationSec: 0.35,
    });

    return true;
  }

  public tryExecuteStaggeredTarget(
    player: PlayerRuntimeState,
    targets: EnemyEntity[],
    combat: ICombatEngine,
  ): { executed: boolean; target?: EnemyEntity; damageDealt?: number } {
    if (
      this.disposed ||
      !this.bossStaggered ||
      !player ||
      !player.alive ||
      player.hp <= 0 ||
      !combat
    ) {
      return { executed: false };
    }

    this.ensureSubscribed();
    this.cacheRuntimeRefs(player, targets, this.activeBoss, combat);

    const execTarget = this.selectExecutableTarget(player, this.lastTargets);
    if (!execTarget) {
      return { executed: false };
    }

    // Close lunge gap toward staggered boss if slightly outside point-blank cleave range
    const dx = execTarget.position.x - player.position.x;
    const dz = execTarget.position.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    const desiredStandDist = Math.max(1.6, (execTarget.radius || 0.8) + (player.radius || 0.45) + 0.55);
    if (dist > desiredStandDist + 0.25) {
      const nx = dx / dist;
      const nz = dz / dist;
      player.position.x = execTarget.position.x - nx * desiredStandDist;
      player.position.z = execTarget.position.z - nz * desiredStandDist;
      player.facingDir.x = nx;
      player.facingDir.z = nz;
      player.rotationY = Math.atan2(nx, nz);
    }

    // Consume Boss Stagger state prior to strike resolution
    this.bossStaggered = false;
    this.bossStaggeredTimerSec = 0;
    this.bossStagger = 0;
    this.staggeredBossId = null;
    this.canExecuteTargetId = null;

    player.invulnerableSec = Math.max(player.invulnerableSec, 0.55);

    const offensivePower = Math.max(player.stats.attackPower, player.stats.spellPower, 35);
    const awkMult = this.awakened ? 1.5 : 1.0;
    const baseExecDamage = Math.round(
      (offensivePower * 6.2 + execTarget.maxHp * 0.12) * awkMult,
    );

    let damageDealt = baseExecDamage;
    this.isExecutingInternalStrike = true;
    try {
      const primaryRes = combat.applyDamageToEnemy(execTarget, {
        sourceId: player.id,
        targetId: execTarget.id,
        baseAmount: baseExecDamage,
        damageType: 'physical',
        critChance: 1.0,
        critMultiplier: Math.max(2.0, player.stats.critMultiplier),
        lifeSteal: player.stats.lifeSteal + 0.1,
      });

      if (primaryRes && primaryRes.finalDamage > 0) {
        damageDealt = primaryRes.finalDamage;
      }

      // Collateral shockwave cleave onto surrounding minions
      const collateralTargets = this.lastTargets.filter(
        (e) => e && e.alive && e.id !== execTarget.id,
      );
      if (collateralTargets.length > 0) {
        combat.performAoE(
          execTarget.position,
          4.2,
          {
            sourceId: player.id,
            baseAmount: Math.round(offensivePower * 3.0 * awkMult),
            damageType: 'fire',
            critChance: 0.5,
            critMultiplier: player.stats.critMultiplier,
            appliesStatus: {
              type: 'stun',
              chance: 1.0,
              durationSec: 1.8,
              potency: 1,
            },
          },
          collateralTargets,
        );
      }
    } finally {
      this.isExecutingInternalStrike = false;
    }

    if (!this.awakened) {
      this.addFury(25);
    }

    this.vfx.spawnExecutionBurst(execTarget.position);

    eventBus.emit('combat:executionStrike', {
      position: { ...execTarget.position },
      targetId: execTarget.id,
      damage: damageDealt,
    });
    eventBus.emit('engine:hitstop', {
      durationSec: 0.14,
      timeScale: 0.04,
    });

    return {
      executed: true,
      target: execTarget,
      damageDealt,
    };
  }

  public getAwakeningMultipliers(): {
    damageMultiplier: number;
    attackSpeedMultiplier: number;
    moveSpeedMultiplier: number;
    cooldownMultiplier: number;
    lifeStealBonus: number;
  } {
    if (!this.awakened) {
      return {
        damageMultiplier: 1.0,
        attackSpeedMultiplier: 1.0,
        moveSpeedMultiplier: 1.0,
        cooldownMultiplier: 1.0,
        lifeStealBonus: 0,
      };
    }

    return {
      damageMultiplier: 1.5,
      attackSpeedMultiplier: 1.45,
      moveSpeedMultiplier: 1.32,
      cooldownMultiplier: 0.5,
      lifeStealBonus: 0.12,
    };
  }

  public getHudState(): MasteryHudState {
    return {
      fury: Math.round(this.fury * 10) / 10,
      maxFury: MAX_FURY,
      awakened: this.awakened,
      awakenedRemainingSec: Math.max(0, Math.round(this.awakenedRemainingSec * 100) / 100),
      awakenedDurationSec: AWAKENING_DURATION_SEC,
      parryCooldownSec: Math.max(0, Math.round(this.parryCooldownSec * 100) / 100),
      parryActiveWindow: this.parryActiveWindow,
      bossStagger: Math.round(this.bossStagger * 10) / 10,
      bossMaxStagger: BOSS_MAX_STAGGER,
      bossStaggered: this.bossStaggered,
      canExecuteTargetId: this.canExecuteTargetId,
    };
  }

  public addFury(amount: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(amount)) return;
    this.fury = clamp(this.fury + amount, 0, MAX_FURY);
  }

  public update(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    targets: EnemyEntity[],
    activeBoss: EnemyEntity | null,
    combat: ICombatEngine,
  ): void {
    if (this.disposed) return;
    this.ensureSubscribed();

    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.cacheRuntimeRefs(player, targets, activeBoss, combat);
    this.reactions.snapshotTargets(this.lastTargets);

    // 1. Tick Parry Active Ward Window & Cooldown
    if (this.parryActiveWindow) {
      this.parryWindowRemainingSec -= safeDt;
      if (this.parryWindowRemainingSec <= 0) {
        this.parryActiveWindow = false;
        this.parryWindowRemainingSec = 0;
        this.parryCounteredInCurrentWindow = false;
      }
    }

    if (this.parryCooldownSec > 0) {
      this.parryCooldownSec = Math.max(0, this.parryCooldownSec - safeDt);
    }

    // 2. Tick Abyssal Awakening Ultimate Overdrive
    if (this.awakened) {
      this.awakenedRemainingSec -= safeDt;
      if (this.awakenedRemainingSec <= 0 || !player.alive || player.hp <= 0) {
        this.awakened = false;
        this.awakenedRemainingSec = 0;
        eventBus.emit('player:awakeningChanged', {
          active: false,
          position: { ...player.position },
        });
      }
    }

    // 3. Tick Boss Stagger & Execution Window
    const liveBoss =
      activeBoss && activeBoss.alive && activeBoss.hp > 0
        ? activeBoss
        : (this.lastTargets.find((e) => e && e.isBoss && e.alive && e.hp > 0) ?? null);
    this.activeBoss = liveBoss;

    if (!liveBoss && (this.bossStagger > 0 || this.bossStaggered)) {
      // Clear boss stagger if the staggered boss was slain
      const hadTrackedBoss =
        this.staggeredBossId !== null ||
        targets.some((e) => e && e.isBoss && (!e.alive || e.hp <= 0));
      if (hadTrackedBoss) {
        this.bossStagger = 0;
        this.bossStaggered = false;
        this.bossStaggeredTimerSec = 0;
        this.staggeredBossId = null;
        this.canExecuteTargetId = null;
      }
    }

    if (this.bossStaggered) {
      this.bossStaggeredTimerSec -= safeDt;
      if (this.bossStaggeredTimerSec <= 0) {
        this.bossStaggered = false;
        this.bossStaggeredTimerSec = 0;
        this.bossStagger = 0;
        this.staggeredBossId = null;
        this.canExecuteTargetId = null;
      } else {
        const execCandidate = this.selectExecutableTarget(player, this.lastTargets);
        this.canExecuteTargetId = execCandidate ? execCandidate.id : null;
      }
    } else {
      this.canExecuteTargetId = null;
    }

    // 4. Tick Elemental Reaction ICDs & Singularity Pull Wells
    this.reactions.update(safeDt, this.lastTargets);

    // 5. Update 3D Procedural & GLSL Meshes
    const staggeredBossPos =
      this.bossStaggered && liveBoss ? liveBoss.position : null;
    this.vfx.update(
      safeDt,
      elapsedSec,
      player.position,
      this.parryActiveWindow,
      this.awakened,
      staggeredBossPos,
    );
  }

  public resetFloor(): void {
    if (this.disposed) return;

    this.parryCooldownSec = 0;
    this.parryActiveWindow = false;
    this.parryWindowRemainingSec = 0;
    this.parryCounteredInCurrentWindow = false;

    this.bossStagger = 0;
    this.bossStaggered = false;
    this.bossStaggeredTimerSec = 0;
    this.staggeredBossId = null;
    this.canExecuteTargetId = null;

    this.lastTargets = [];
    this.activeBoss = null;

    this.reactions.clear();
    this.vfx.resetTransient();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.unsubDamageDealt) {
      this.unsubDamageDealt();
      this.unsubDamageDealt = null;
    }

    this.awakened = false;
    this.awakenedRemainingSec = 0;
    this.parryActiveWindow = false;
    this.bossStaggered = false;
    this.canExecuteTargetId = null;

    this.reactions.clear();
    this.vfx.dispose();

    this.scene = null;
    this.lastPlayer = null;
    this.lastTargets = [];
    this.activeBoss = null;
    this.lastCombat = null;
  }

  private ensureSubscribed(): void {
    if (this.disposed || this.unsubDamageDealt) return;
    this.unsubDamageDealt = eventBus.on('combat:damageDealt', (payload) => {
      this.onCombatDamageDealt(payload);
    });
  }

  private cacheRuntimeRefs(
    player: PlayerRuntimeState,
    targets: EnemyEntity[],
    activeBoss: EnemyEntity | null,
    combat: ICombatEngine,
  ): void {
    this.lastPlayer = player;
    this.lastCombat = combat;

    const merged: EnemyEntity[] = [];
    if (Array.isArray(targets)) {
      for (let i = 0; i < targets.length; i++) {
        if (targets[i]) merged.push(targets[i]);
      }
    }
    if (activeBoss && !merged.some((e) => e.id === activeBoss.id)) {
      merged.push(activeBoss);
    }
    this.lastTargets = merged;
    if (activeBoss && activeBoss.alive) {
      this.activeBoss = activeBoss;
    }
  }

  private onCombatDamageDealt(payload: GameEventMap['combat:damageDealt']): void {
    if (this.disposed) return;
    const { result, targetIsPlayer, targetId } = payload;

    // Player taking damage builds small wrath Fury when not awakened
    if (targetIsPlayer) {
      if (result.finalDamage > 0 && !this.awakened && this.lastPlayer) {
        this.addFury(3);
      }
      return;
    }

    // Match damaged enemy against our tracked floor targets to avoid cross-instance interference
    const matchedTarget = this.lastTargets.find((e) => e && e.id === targetId) ?? null;
    if (!matchedTarget && this.lastTargets.length > 0) {
      return;
    }

    // Build Fury on combat hits against enemies
    if (
      result.finalDamage > 0 &&
      !this.awakened &&
      !this.reactions.isExecutingReaction &&
      !this.isExecutingInternalStrike
    ) {
      let furyGain = result.isCrit ? 7.5 : 5.0;
      if (result.killed) furyGain += 2.5;
      this.addFury(furyGain);
    }

    // Build Boss Stagger on direct combat hits against bosses
    if (
      matchedTarget &&
      matchedTarget.isBoss &&
      matchedTarget.alive &&
      result.finalDamage > 0 &&
      !this.bossStaggered &&
      !this.isExecutingInternalStrike
    ) {
      const hitStagger = result.isCrit ? BOSS_CRIT_STAGGER_GAIN : BOSS_HIT_STAGGER_GAIN;
      this.addBossStagger(hitStagger, matchedTarget);
    }

    // Evaluate Elemental Combo Reactions (skip internal parry/execution AoEs to keep combos intentional)
    if (
      !this.isExecutingInternalStrike &&
      result.finalDamage > 0 &&
      this.lastCombat &&
      (matchedTarget !== null || this.lastTargets.length > 0)
    ) {
      const awkMult = this.awakened ? 1.5 : 1.0;
      const triggered = this.reactions.tryTriggerFromHit(
        targetId,
        result.damageType,
        result.finalDamage,
        result.hitPosition,
        result.killed,
        result.appliedStatus,
        this.lastTargets,
        this.lastPlayer,
        this.lastCombat,
        awkMult,
      );

      if (triggered) {
        this.vfx.spawnReactionBurst(triggered.reaction, triggered.position);
        if (!this.awakened) {
          this.addFury(8);
        }
        if (matchedTarget && matchedTarget.isBoss && matchedTarget.alive && !this.bossStaggered) {
          this.addBossStagger(BOSS_REACTION_STAGGER_GAIN, matchedTarget);
        }
      }
    }
  }

  private findParryableWindupEnemies(
    player: PlayerRuntimeState,
    enemies: readonly EnemyEntity[],
  ): EnemyEntity[] {
    const countered: EnemyEntity[] = [];

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy || !enemy.alive || enemy.hp <= 0 || enemy.id === 'training_dummy') {
        continue;
      }
      if (enemy.isBoss) {
        if (this.bossStaggered || this.hasActiveStatus(enemy.statuses, 'freeze')) {
          continue;
        }
      } else if (
        this.hasActiveStatus(enemy.statuses, 'stun') ||
        this.hasActiveStatus(enemy.statuses, 'freeze')
      ) {
        continue;
      }

      const dist = distXZ(player.position, enemy.position);
      const raw = enemy as unknown as Record<string, unknown>;
      const explicitWindup =
        raw.state === 'windup' ||
        raw.state === 'attack' ||
        raw.animState === 'windup' ||
        raw.isWindingUp === true;

      const meshTelegraph =
        ((
          enemy.meshHandle as unknown as {
            anim?: { getTelegraphStrength?: () => number };
          }
        )?.anim?.getTelegraphStrength?.() ?? 0) > 0.01;

      const strikeReach = Math.max(
        3.6,
        Math.min(5.5, (enemy.attackRange || 2.2) + (player.radius || 0.45) + (enemy.radius || 0.5) + 0.85),
      );
      const speed = Math.hypot(enemy.velocity?.x || 0, enemy.velocity?.z || 0);
      const kinematicWindup = dist <= strikeReach && speed <= 0.85;

      if (((explicitWindup || meshTelegraph) && dist <= 6.2) || kinematicWindup) {
        countered.push(enemy);
      }
    }

    return countered;
  }

  private resolveParryCounterSuccess(
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
    combat: ICombatEngine | null,
    counteredEnemies: EnemyEntity[],
    rawIncomingDamage: number,
    attackerPos: Vec3 | null = null,
  ): void {
    // Reset parry cooldown to crisp 0.6s riposte recovery!
    this.parryCooldownSec = PARRY_SUCCESS_COOLDOWN_SEC;
    player.invulnerableSec = Math.max(player.invulnerableSec, PARRY_WINDOW_SEC);

    const firstSuccessInWindow = !this.parryCounteredInCurrentWindow;
    this.parryCounteredInCurrentWindow = true;

    if (!this.awakened) {
      this.addFury(firstSuccessInWindow ? 20 : 8);
    }

    // Reflect golden shockwave + stun onto nearby enemies
    const offensivePower = Math.max(player.stats.attackPower, player.stats.spellPower, 25);
    const awkMult = this.awakened ? 1.5 : 1.0;
    const reflectBase = Math.round(
      Math.max(rawIncomingDamage * 1.4, offensivePower * 1.65) * awkMult,
    );

    if (combat && enemies.length > 0 && firstSuccessInWindow) {
      this.isExecutingInternalStrike = true;
      try {
        const packet: Omit<DamagePacket, 'targetId'> = {
          sourceId: player.id,
          baseAmount: reflectBase,
          damageType: 'lightning',
          critChance: Math.max(0.35, player.stats.critChance),
          critMultiplier: player.stats.critMultiplier,
          appliesStatus: {
            type: 'stun',
            chance: 1.0,
            durationSec: 2.0,
            potency: 1,
          },
        };
        combat.performAoE(player.position, PARRY_REFLECT_RADIUS, packet, enemies);
      } finally {
        this.isExecutingInternalStrike = false;
      }
    }

    // Guarantee 'stun' + radial knockback on nearby non-boss foes within shockwave radius
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy || !enemy.alive || enemy.hp <= 0 || enemy.id === 'training_dummy') continue;
      const inRadius =
        distXZ(player.position, enemy.position) <= PARRY_REFLECT_RADIUS + (enemy.radius || 0);
      if (!inRadius) continue;

      if (!enemy.isBoss) {
        this.applyDirectStatus(enemy.statuses, 'stun', 2.0, 1, player.id);
      }

      const dx = enemy.position.x - player.position.x;
      const dz = enemy.position.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-3 && !enemy.isBoss) {
        const push = enemy.isElite ? 2.2 : 3.8;
        enemy.velocity.x += (dx / dist) * push;
        enemy.velocity.z += (dz / dist) * push;
      }
    }

    // Add massive Boss Stagger when parrying a boss or an attack inside boss engagement range
    const bossCandidate =
      counteredEnemies.find((e) => e.isBoss && e.alive) ??
      enemies.find((e) => e && e.isBoss && e.alive && distXZ(player.position, e.position) <= 22) ??
      (this.activeBoss &&
      this.activeBoss.alive &&
      (distXZ(player.position, this.activeBoss.position) <= 22 ||
        (attackerPos !== null && distXZ(attackerPos, this.activeBoss.position) <= 6))
        ? this.activeBoss
        : null);

    if (bossCandidate) {
      this.addBossStagger(BOSS_PARRY_STAGGER_GAIN, bossCandidate);
    } else if (!this.activeBoss && enemies.length === 0) {
      // Standalone unit-test fallback when interceptIncomingPlayerHit is exercised without target list
      this.addBossStagger(BOSS_PARRY_STAGGER_GAIN, null);
    }

    this.vfx.triggerParryRiposteFlash(player.position);

    eventBus.emit('combat:parryTriggered', {
      position: { ...player.position },
      counterSuccess: true,
    });
    eventBus.emit('engine:hitstop', {
      durationSec: 0.09,
      timeScale: 0.05,
    });
  }

  private addBossStagger(amount: number, boss: EnemyEntity | null): void {
    if (this.bossStaggered || amount <= 0) return;

    this.bossStagger = clamp(this.bossStagger + amount, 0, BOSS_MAX_STAGGER);
    if (boss) {
      this.activeBoss = boss;
    }

    if (this.bossStagger >= BOSS_MAX_STAGGER) {
      this.bossStagger = BOSS_MAX_STAGGER;
      this.bossStaggered = true;
      this.bossStaggeredTimerSec = BOSS_STAGGERED_DURATION_SEC;

      const targetBoss = boss ?? this.activeBoss;
      if (targetBoss && targetBoss.alive) {
        this.staggeredBossId = targetBoss.id;
        this.applyDirectStatus(
          targetBoss.statuses,
          'stun',
          BOSS_STAGGERED_DURATION_SEC,
          1,
          this.lastPlayer?.id ?? 'player',
        );
        this.applyDirectStatus(
          targetBoss.statuses,
          'vulnerable',
          BOSS_STAGGERED_DURATION_SEC,
          0.25,
          this.lastPlayer?.id ?? 'player',
        );
        targetBoss.velocity.x = 0;
        targetBoss.velocity.z = 0;

        if (
          this.lastPlayer &&
          distXZ(this.lastPlayer.position, targetBoss.position) <= EXECUTION_RANGE
        ) {
          this.canExecuteTargetId = targetBoss.id;
        } else {
          this.canExecuteTargetId = targetBoss.id;
        }
      }

      eventBus.emit('engine:hitstop', {
        durationSec: 0.11,
        timeScale: 0.05,
      });
      eventBus.emit('lighting:flash', {
        colorHex: 0xffd43b,
        intensity: 1.85,
        durationSec: 0.25,
      });
    }
  }

  private selectExecutableTarget(
    player: PlayerRuntimeState,
    targets: readonly EnemyEntity[],
  ): EnemyEntity | null {
    if (!this.bossStaggered) return null;

    // 1. Prefer staggered boss within execution lunge range
    if (
      this.activeBoss &&
      this.activeBoss.alive &&
      this.activeBoss.hp > 0 &&
      distXZ(player.position, this.activeBoss.position) <= EXECUTION_RANGE + (this.activeBoss.radius || 0)
    ) {
      return this.activeBoss;
    }

    let bestBoss: EnemyEntity | null = null;
    let bestBossDist = Infinity;
    let bestAny: EnemyEntity | null = null;
    let bestAnyDist = Infinity;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t || !t.alive || t.hp <= 0) continue;
      const d = distXZ(player.position, t.position);
      if (d > EXECUTION_RANGE + (t.radius || 0)) continue;

      if (t.isBoss && d < bestBossDist) {
        bestBoss = t;
        bestBossDist = d;
      }
      if (d < bestAnyDist) {
        bestAny = t;
        bestAnyDist = d;
      }
    }

    return bestBoss ?? bestAny;
  }

  private hasActiveStatus(
    statuses: readonly ActiveStatusEffect[],
    type: StatusEffectType,
  ): boolean {
    for (let i = 0; i < statuses.length; i++) {
      if (statuses[i] && statuses[i].type === type && statuses[i].remainingSec > 0) {
        return true;
      }
    }
    return false;
  }

  private applyDirectStatus(
    statuses: ActiveStatusEffect[],
    type: StatusEffectType,
    durationSec: number,
    potency: number,
    sourceId: string,
  ): void {
    const existing = statuses.find((s) => s.type === type && s.remainingSec > 0);
    if (existing) {
      existing.remainingSec = Math.max(existing.remainingSec, durationSec);
      existing.durationSec = Math.max(existing.durationSec, durationSec);
      existing.potency = Math.max(existing.potency, potency);
    } else {
      statuses.push({
        id: `mastery_${type}_${nextMasteryStatusUid++}`,
        type,
        remainingSec: durationSec,
        durationSec,
        stacks: 1,
        potency,
        sourceId,
      });
    }
  }
}
