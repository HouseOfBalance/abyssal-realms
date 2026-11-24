import type {
  ActiveStatusEffect,
  DamagePacket,
  DamageType,
  ElementalReactionType,
  EnemyEntity,
  ICombatEngine,
  PlayerRuntimeState,
  StatusEffectType,
  Vec3,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';

export const REACTION_ICD_SEC = 1.25;
export const VOID_PRIME_DURATION_SEC = 5.0;
export const SINGULARITY_PULL_RADIUS = 6.5;
export const SINGULARITY_PULL_DURATION_SEC = 0.55;

export interface ActiveSingularityWell {
  center: Vec3;
  remainingSec: number;
  durationSec: number;
  radius: number;
}

export interface TriggeredReactionInfo {
  reaction: ElementalReactionType;
  position: Vec3;
  damage: number;
}

let nextVulnStatusUid = 1;

export class ReactionEngine {
  private readonly reactionIcdByTarget = new Map<string, number>();
  private readonly voidPrimedTargets = new Map<string, number>();
  private readonly cachedTargetStatuses = new Map<string, StatusEffectType[]>();
  private readonly activeSingularities: ActiveSingularityWell[] = [];
  private isResolvingReaction = false;

  public get isExecutingReaction(): boolean {
    return this.isResolvingReaction;
  }

  public snapshotTargets(targets: readonly EnemyEntity[]): void {
    this.cachedTargetStatuses.clear();
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t || !t.alive || t.hp <= 0) continue;
      if (t.statuses.length > 0) {
        const activeTypes: StatusEffectType[] = [];
        for (let j = 0; j < t.statuses.length; j++) {
          const s = t.statuses[j];
          if (s && s.remainingSec > 0) {
            activeTypes.push(s.type);
          }
        }
        if (activeTypes.length > 0) {
          this.cachedTargetStatuses.set(t.id, activeTypes);
        }
      }
    }
  }

  public update(dt: number, targets: readonly EnemyEntity[]): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    for (const [targetId, rem] of this.reactionIcdByTarget) {
      const next = rem - dt;
      if (next <= 0) {
        this.reactionIcdByTarget.delete(targetId);
      } else {
        this.reactionIcdByTarget.set(targetId, next);
      }
    }

    for (const [targetId, rem] of this.voidPrimedTargets) {
      const next = rem - dt;
      if (next <= 0) {
        this.voidPrimedTargets.delete(targetId);
      } else {
        this.voidPrimedTargets.set(targetId, next);
      }
    }

    // Tick active Abyssal Singularity gravitational pull wells
    for (let i = this.activeSingularities.length - 1; i >= 0; i--) {
      const well = this.activeSingularities[i];
      const step = Math.min(dt, well.remainingSec);
      if (step > 0) {
        this.applySingularityPullStep(well.center, well.radius, targets, step * 7.5, false);
      }
      well.remainingSec -= dt;
      if (well.remainingSec <= 0) {
        this.activeSingularities.splice(i, 1);
      }
    }
  }

  public tryTriggerFromHit(
    targetId: string,
    incomingDamageType: DamageType,
    triggerDamage: number,
    hitPosition: Vec3,
    wasKilled: boolean,
    appliedStatusOnThisHit: StatusEffectType | undefined,
    targets: EnemyEntity[],
    player: PlayerRuntimeState | null,
    combat: ICombatEngine | null,
    awakeningDamageMult: number,
  ): TriggeredReactionInfo | null {
    // Prevent re-entrant infinite loops when reaction AoEs deal damage
    if (this.isResolvingReaction) {
      return null;
    }

    if (!combat) {
      return null;
    }

    // Enforce per-target reaction ICD
    if ((this.reactionIcdByTarget.get(targetId) ?? 0) > 0) {
      return null;
    }

    const target = targets.find((e) => e && e.id === targetId) ?? null;
    const position: Vec3 = target
      ? { x: target.position.x, y: target.position.y, z: target.position.z }
      : { x: hitPosition.x, y: 0, z: hitPosition.z };

    // Collect active statuses on target (falling back to pre-kill snapshot if lethal hit wiped statuses)
    const liveStatuses: readonly ActiveStatusEffect[] = target ? target.statuses : [];
    const fallbackTypes = wasKilled ? (this.cachedTargetStatuses.get(targetId) ?? []) : [];

    const hasType = (statusType: StatusEffectType | 'void'): boolean => {
      for (let i = 0; i < liveStatuses.length; i++) {
        const s = liveStatuses[i];
        if (!s || s.remainingSec <= 0) continue;
        if ((s.type as string) === statusType) {
          if (
            appliedStatusOnThisHit === statusType &&
            s.stacks <= 1 &&
            !(this.cachedTargetStatuses.get(targetId)?.includes(statusType as StatusEffectType))
          ) {
            continue;
          }
          return true;
        }
      }
      if (statusType !== 'void') {
        return fallbackTypes.includes(statusType);
      }
      return false;
    };

    const hasCryo = hasType('freeze') || hasType('chill');
    const hasPoison = hasType('poison');
    const hasBurn = hasType('burn');
    const hasVoidPrime = hasType('void') || (this.voidPrimedTargets.get(targetId) ?? 0) > 0;

    let reaction: ElementalReactionType | null = null;

    if (hasCryo && (incomingDamageType === 'physical' || incomingDamageType === 'fire')) {
      reaction = 'shatter';
    } else if (hasPoison && incomingDamageType === 'fire') {
      reaction = 'volatile_blast';
    } else if (hasCryo && incomingDamageType === 'lightning') {
      reaction = 'superconduct';
    } else if (
      (hasVoidPrime && (incomingDamageType === 'fire' || incomingDamageType === 'lightning')) ||
      (hasBurn && incomingDamageType === 'void')
    ) {
      reaction = 'abyssal_singularity';
    }

    if (!reaction) {
      // Prime target with Void energy when struck by Void damage so subsequent Fire/Lightning detonates Singularity
      if (incomingDamageType === 'void' && (!wasKilled || target?.id === 'training_dummy')) {
        this.voidPrimedTargets.set(targetId, VOID_PRIME_DURATION_SEC);
      }
      return null;
    }

    // Lock per-target ICD and re-entrancy guard BEFORE calling combat.performAoE
    this.reactionIcdByTarget.set(targetId, REACTION_ICD_SEC);
    if (reaction === 'abyssal_singularity') {
      this.voidPrimedTargets.delete(targetId);
    }

    const offensivePower = player
      ? Math.max(player.stats.attackPower, player.stats.spellPower, 20)
      : 28;
    const baseTrigger = Math.max(10, Number.isFinite(triggerDamage) ? triggerDamage : 20);
    const scaleMult = Math.max(1, awakeningDamageMult);

    this.isResolvingReaction = true;
    let resolvedDamage = 0;

    try {
      switch (reaction) {
        case 'shatter': {
          const radius = 3.9;
          const baseAmount = Math.round((baseTrigger * 0.85 + offensivePower * 0.75) * scaleMult);
          const packet: Omit<DamagePacket, 'targetId'> = {
            sourceId: player?.id ?? 'player',
            baseAmount,
            damageType: 'ice',
            critChance: player?.stats.critChance ?? 0.2,
            critMultiplier: player?.stats.critMultiplier ?? 1.5,
            knockback: { x: 0, y: 0, z: 0 },
          };
          const results = combat.performAoE(position, radius, packet, targets);
          this.applyRadialShrapnelImpulse(position, radius, targets, 2.4);
          resolvedDamage = this.computeReactionDamageTotal(results, baseAmount);
          break;
        }

        case 'volatile_blast': {
          const radius = 4.5;
          const baseAmount = Math.round((baseTrigger * 1.05 + offensivePower * 0.85) * scaleMult);
          const packet: Omit<DamagePacket, 'targetId'> = {
            sourceId: player?.id ?? 'player',
            baseAmount,
            damageType: 'poison',
            critChance: player?.stats.critChance ?? 0.2,
            critMultiplier: player?.stats.critMultiplier ?? 1.5,
            appliesStatus: {
              type: 'burn',
              chance: 0.85,
              durationSec: 4.0,
              potency: Math.max(8, Math.round(baseAmount * 0.18)),
            },
          };
          const results = combat.performAoE(position, radius, packet, targets);
          this.applyRadialShrapnelImpulse(position, radius, targets, 3.0);
          resolvedDamage = this.computeReactionDamageTotal(results, baseAmount);
          break;
        }

        case 'superconduct': {
          const radius = 5.4;
          const baseAmount = Math.round((baseTrigger * 0.78 + offensivePower * 0.68) * scaleMult);
          const packet: Omit<DamagePacket, 'targetId'> = {
            sourceId: player?.id ?? 'player',
            baseAmount,
            damageType: 'lightning',
            critChance: player?.stats.critChance ?? 0.25,
            critMultiplier: player?.stats.critMultiplier ?? 1.5,
            appliesStatus: {
              type: 'vulnerable',
              chance: 1.0,
              durationSec: 5.0,
              potency: 0.25,
            },
          };
          const results = combat.performAoE(position, radius, packet, targets);
          // Guarantee 'vulnerable' on all living enemies inside shock arc (even if a mock combat engine is used)
          this.ensureStatusInRadius(position, radius, targets, 'vulnerable', 5.0, 0.25, player?.id ?? 'player');
          resolvedDamage = this.computeReactionDamageTotal(results, baseAmount);
          break;
        }

        case 'abyssal_singularity': {
          const aoeRadius = 5.2;
          const baseAmount = Math.round((baseTrigger * 0.95 + offensivePower * 0.8) * scaleMult);
          // Immediate gravitational implosion pull inward + sustained vortex well
          this.applySingularityPullStep(position, SINGULARITY_PULL_RADIUS, targets, 1.85, true);
          this.activeSingularities.push({
            center: { ...position },
            remainingSec: SINGULARITY_PULL_DURATION_SEC,
            durationSec: SINGULARITY_PULL_DURATION_SEC,
            radius: SINGULARITY_PULL_RADIUS,
          });

          const packet: Omit<DamagePacket, 'targetId'> = {
            sourceId: player?.id ?? 'player',
            baseAmount,
            damageType: 'void',
            critChance: player?.stats.critChance ?? 0.25,
            critMultiplier: player?.stats.critMultiplier ?? 1.6,
          };
          const results = combat.performAoE(position, aoeRadius, packet, targets);
          resolvedDamage = this.computeReactionDamageTotal(results, baseAmount);
          break;
        }
      }
    } finally {
      this.isResolvingReaction = false;
    }

    eventBus.emit('combat:elementalReaction', {
      reaction,
      position: { ...position },
      damage: resolvedDamage,
    });

    return {
      reaction,
      position: { ...position },
      damage: resolvedDamage,
    };
  }

  public hasTargetReactionIcd(targetId: string): boolean {
    return (this.reactionIcdByTarget.get(targetId) ?? 0) > 0;
  }

  public clear(): void {
    this.reactionIcdByTarget.clear();
    this.voidPrimedTargets.clear();
    this.cachedTargetStatuses.clear();
    this.activeSingularities.length = 0;
    this.isResolvingReaction = false;
  }

  private computeReactionDamageTotal(
    results: ReadonlyArray<{ finalDamage: number }> | undefined,
    fallbackBase: number,
  ): number {
    if (!results || results.length === 0) {
      return Math.max(1, fallbackBase);
    }
    let sum = 0;
    for (let i = 0; i < results.length; i++) {
      sum += Math.max(0, results[i].finalDamage || 0);
    }
    return sum > 0 ? Math.round(sum) : Math.max(1, fallbackBase);
  }

  private ensureStatusInRadius(
    center: Vec3,
    radius: number,
    targets: EnemyEntity[],
    statusType: StatusEffectType,
    durationSec: number,
    potency: number,
    sourceId: string,
  ): void {
    for (let i = 0; i < targets.length; i++) {
      const enemy = targets[i];
      if (!enemy || !enemy.alive || enemy.hp <= 0) continue;
      const enemyRadius = Math.max(0, Number.isFinite(enemy.radius) ? enemy.radius : 0);
      if (distXZ(center, enemy.position) > radius + enemyRadius) continue;

      const existing = enemy.statuses.find((s) => s.type === statusType && s.remainingSec > 0);
      if (existing) {
        existing.remainingSec = Math.max(existing.remainingSec, durationSec);
        existing.durationSec = Math.max(existing.durationSec, durationSec);
        existing.potency = Math.max(existing.potency, potency);
      } else {
        enemy.statuses.push({
          id: `mastery_${statusType}_${nextVulnStatusUid++}`,
          type: statusType,
          remainingSec: durationSec,
          durationSec,
          stacks: 1,
          potency,
          sourceId,
        });
      }
    }
  }

  private applyRadialShrapnelImpulse(
    center: Vec3,
    radius: number,
    targets: EnemyEntity[],
    impulseStrength: number,
  ): void {
    for (let i = 0; i < targets.length; i++) {
      const enemy = targets[i];
      if (!enemy || !enemy.alive || enemy.hp <= 0 || enemy.id === 'training_dummy') continue;
      const dx = enemy.position.x - center.x;
      const dz = enemy.position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 1e-3 || dist > radius + enemy.radius) continue;

      const resist = enemy.isBoss ? 0.15 : enemy.isElite ? 0.55 : 1.0;
      const falloff = clamp(1 - dist / (radius + 1.0), 0.25, 1.0);
      const push = impulseStrength * falloff * resist;
      enemy.velocity.x += (dx / dist) * push;
      enemy.velocity.z += (dz / dist) * push;
    }
  }

  private applySingularityPullStep(
    center: Vec3,
    radius: number,
    targets: readonly EnemyEntity[],
    maxDisplacement: number,
    applyVelocitySuction: boolean,
  ): void {
    for (let i = 0; i < targets.length; i++) {
      const enemy = targets[i];
      if (!enemy || !enemy.alive || enemy.hp <= 0 || enemy.id === 'training_dummy') continue;

      const dx = center.x - enemy.position.x;
      const dz = center.z - enemy.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 0.35 || dist > radius + (enemy.radius || 0)) continue;

      const bossScale = enemy.isBoss ? 0.3 : enemy.isElite ? 0.72 : 1.0;
      const pullStep = Math.min(dist - 0.32, maxDisplacement * bossScale);
      if (pullStep <= 0) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      enemy.position.x += nx * pullStep;
      enemy.position.z += nz * pullStep;

      if (applyVelocitySuction) {
        const velPull = 4.2 * bossScale;
        enemy.velocity.x += nx * velPull;
        enemy.velocity.z += nz * velPull;
      }
    }
  }
}
