import type {
  ActiveStatusEffect,
  DamageType,
  DerivedStats,
  EnemyEntity,
  PlayerRuntimeState,
  StatusEffectType,
  Vec3,
} from '../../contracts/types';
import { DAMAGE_TYPE_COLORS, clamp } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import type { ComboTracker } from './ComboTracker';
import { isTrainingDummyEntity } from './DamageResolver';

export interface StatusApplicationSpec {
  type: StatusEffectType;
  chance: number;
  durationSec: number;
  potency: number;
}

interface BaseSpeedRecord {
  baseMoveSpeed: number;
  lastAppliedMoveSpeed: number;
  baseAttackSpeed?: number;
  lastAppliedAttackSpeed?: number;
}

interface DotPulseBucket {
  accumulated: number;
  timerSec: number;
  damageType: DamageType;
}

const MAX_STACKS_BY_TYPE: Record<StatusEffectType, number> = {
  poison: 8,
  burn: 5,
  bleed: 5,
  chill: 1,
  freeze: 1,
  stun: 1,
  vulnerable: 1,
  shield: 1,
  haste: 1,
};

const CHILL_SPEED_MULTIPLIER = 0.65; // -35% movement speed
const DEFAULT_HASTE_BONUS = 0.3; // +30% speed when potency unspecified
const DOT_NUMBER_INTERVAL_SEC = 0.5;

let nextStatusUid = 1;

export class StatusEffectManager {
  private speedRecords = new WeakMap<object, BaseSpeedRecord>();
  private dotBuckets = new Map<string, DotPulseBucket>();
  private vfxPulseCooldowns = new Map<string, number>();

  tryApplyStatus(
    statuses: ActiveStatusEffect[],
    targetMaxHp: number,
    baseHitAmount: number,
    spec: StatusApplicationSpec | undefined,
    sourceId: string,
    isBoss = false,
  ): StatusEffectType | undefined {
    if (!spec || spec.durationSec <= 0) return undefined;

    const chance = Number.isFinite(spec.chance) ? clamp(spec.chance, 0, 1) : 0;
    if (chance <= 0) return undefined;
    if (chance < 1 && Math.random() >= chance) return undefined;

    // Bosses resist hard crowd-control duration by 50% so fights stay fair
    const ccScale =
      isBoss && (spec.type === 'freeze' || spec.type === 'stun') ? 0.5 : 1.0;
    const effectiveDuration = Math.max(0.1, spec.durationSec * ccScale);
    const effectivePotency = this.computeEffectivePotency(
      spec.type,
      spec.potency,
      targetMaxHp,
      baseHitAmount,
    );

    const maxStacks = MAX_STACKS_BY_TYPE[spec.type] ?? 1;
    const existing = statuses.find((s) => s.type === spec.type && s.remainingSec > 0);

    if (existing) {
      if (spec.type === 'shield') {
        existing.potency = clamp(
          Math.max(existing.potency, effectivePotency),
          1,
          Math.max(targetMaxHp, effectivePotency),
        );
      } else {
        existing.stacks = Math.min(maxStacks, Math.max(1, existing.stacks) + 1);
        existing.potency = Math.max(existing.potency, effectivePotency);
      }
      existing.remainingSec = Math.max(existing.remainingSec, effectiveDuration);
      existing.durationSec = Math.max(existing.durationSec, effectiveDuration);
      existing.sourceId = sourceId;
    } else {
      statuses.push({
        id: `status_${spec.type}_${nextStatusUid++}`,
        type: spec.type,
        remainingSec: effectiveDuration,
        durationSec: effectiveDuration,
        stacks: 1,
        potency: effectivePotency,
        sourceId,
      });
    }

    return spec.type;
  }

  hasStatus(statuses: readonly ActiveStatusEffect[], type: StatusEffectType): boolean {
    for (let i = 0; i < statuses.length; i++) {
      if (statuses[i].type === type && statuses[i].remainingSec > 0) {
        return true;
      }
    }
    return false;
  }

  getVulnerabilityMultiplier(statuses: readonly ActiveStatusEffect[]): number {
    return this.hasStatus(statuses, 'vulnerable') ? 1.25 : 1.0;
  }

  absorbDamageWithShield(
    statuses: ActiveStatusEffect[],
    targetMaxHp: number,
    incomingDamage: number,
  ): { remainingDamage: number; absorbed: number } {
    if (incomingDamage <= 0 || statuses.length === 0) {
      return { remainingDamage: Math.max(0, incomingDamage), absorbed: 0 };
    }

    let remaining = incomingDamage;
    let totalAbsorbed = 0;

    for (let i = statuses.length - 1; i >= 0 && remaining > 0; i--) {
      const s = statuses[i];
      if (s.type !== 'shield' || s.remainingSec <= 0) continue;

      // Normalize fractional shield potency if externally injected (e.g. 0.3 -> 30% maxHp)
      if (s.potency > 0 && s.potency < 1.0 && targetMaxHp > 1) {
        s.potency = Math.max(1, Math.round(targetMaxHp * s.potency));
      }

      if (s.potency <= 0) {
        statuses.splice(i, 1);
        continue;
      }

      const absorbed = Math.min(s.potency, remaining);
      s.potency -= absorbed;
      remaining -= absorbed;
      totalAbsorbed += absorbed;

      if (s.potency <= 0.001) {
        statuses.splice(i, 1);
      }
    }

    return { remainingDamage: Math.max(0, remaining), absorbed: totalAbsorbed };
  }

  tickStatuses(
    dt: number,
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
    combo: ComboTracker,
  ): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    // Decay VFX pulse cooldowns
    for (const [key, rem] of this.vfxPulseCooldowns) {
      if (rem - dt <= 0) {
        this.vfxPulseCooldowns.delete(key);
      } else {
        this.vfxPulseCooldowns.set(key, rem - dt);
      }
    }

    // Tick Player statuses
    if (player && player.alive) {
      this.tickEntityDotsAndTimers(
        dt,
        player.id,
        player.position,
        player.velocity,
        player.statuses,
        player.stats.maxHp,
        true,
        (dotDmg, dmgType) => {
          if (player.invulnerableSec > 0 || player.isDodging) return;
          const { remainingDamage } = this.absorbDamageWithShield(
            player.statuses,
            player.stats.maxHp,
            dotDmg,
          );
          if (remainingDamage <= 0) return;

          player.hp = Math.max(0, player.hp - remainingDamage);
          this.accumulateDotPopup(player.id, player.position, remainingDamage, dmgType, true, dt);

          if (player.hp <= 0 && player.alive) {
            player.hp = 0;
            player.alive = false;
            this.flushDotPopup(player.id, player.position, true);
          }
        },
      );
      this.syncPlayerSpeedModifiers(player);
    } else if (player) {
      player.statuses.length = 0;
      this.restorePlayerSpeedModifiers(player);
    }

    // Tick Enemy statuses
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (!enemy) continue;

      const isDummy = isTrainingDummyEntity(enemy);
      if (isDummy) {
        enemy.alive = true;
        if (enemy.maxHp <= 0) enemy.maxHp = 100000;
        enemy.hp = enemy.maxHp;
      }

      if (!isDummy && (!enemy.alive || enemy.hp <= 0)) {
        if (enemy.statuses.length > 0) {
          enemy.statuses.length = 0;
        }
        this.restoreEnemySpeedModifier(enemy);
        continue;
      }

      this.tickEntityDotsAndTimers(
        dt,
        enemy.id,
        enemy.position,
        enemy.velocity,
        enemy.statuses,
        enemy.maxHp,
        false,
        (dotDmg, dmgType) => {
          if (!isDummy && !enemy.alive) return;
          const { remainingDamage } = this.absorbDamageWithShield(
            enemy.statuses,
            enemy.maxHp,
            dotDmg,
          );
          if (remainingDamage <= 0) return;

          if (isDummy) {
            enemy.hp = enemy.maxHp;
            enemy.alive = true;
            this.accumulateDotPopup(enemy.id, enemy.position, remainingDamage, dmgType, false, dt);
            return;
          }

          enemy.hp = Math.max(0, enemy.hp - remainingDamage);
          this.accumulateDotPopup(enemy.id, enemy.position, remainingDamage, dmgType, false, dt);

          if (enemy.hp <= 0 && enemy.alive) {
            enemy.hp = 0;
            enemy.alive = false;
            enemy.statuses.length = 0;
            this.restoreEnemySpeedModifier(enemy);
            this.flushDotPopup(enemy.id, enemy.position, false);

            enemy.meshHandle?.playAnim('death');
            combo.registerKill(enemy.isBoss ? 5 : enemy.isElite ? 2 : 1);

            eventBus.emit('combat:enemyKilled', { enemy });
            eventBus.emit('vfx:request', {
              type: dmgType === 'poison' ? 'poison_cloud' : dmgType === 'fire' ? 'fire_explosion' : 'blood_burst',
              position: { x: enemy.position.x, y: enemy.position.y + 0.8, z: enemy.position.z },
              colorHex: DAMAGE_TYPE_COLORS[dmgType].hex,
              scale: enemy.isBoss ? 2.0 : enemy.isElite ? 1.35 : 1.0,
            });
            eventBus.emit('camera:shake', {
              trauma: enemy.isBoss ? 0.75 : enemy.isElite ? 0.4 : 0.16,
            });
            eventBus.emit('engine:hitstop', {
              durationSec: enemy.isBoss ? 0.14 : enemy.isElite ? 0.065 : 0.03,
              timeScale: enemy.isBoss ? 0.05 : 0.1,
            });
          }
        },
      );

      if (enemy.alive) {
        this.syncEnemySpeedModifier(enemy);
      }
    }
  }

  clearTransientState(): void {
    this.dotBuckets.clear();
    this.vfxPulseCooldowns.clear();
  }

  private tickEntityDotsAndTimers(
    dt: number,
    entityId: string,
    position: Vec3,
    velocity: Vec3,
    statuses: ActiveStatusEffect[],
    maxHp: number,
    isPlayer: boolean,
    onDotDamage: (amount: number, damageType: DamageType) => void,
  ): void {
    if (statuses.length === 0) return;

    const speedSq = velocity.x * velocity.x + velocity.z * velocity.z;
    const isMoving = speedSq > 1.0;

    for (let i = statuses.length - 1; i >= 0; i--) {
      const s = statuses[i];
      if (!s) continue;

      const stepSec = Math.min(dt, Math.max(0, s.remainingSec));
      const stacks = Math.max(1, s.stacks || 1);

      if (stepSec > 0) {
        if (s.type === 'poison' || s.type === 'burn' || s.type === 'bleed') {
          const dpsPerStack =
            s.potency > 0 && s.potency < 1.0 && maxHp > 10
              ? Math.max(2, maxHp * s.potency * 0.1)
              : Math.max(0.5, s.potency);

          // Moving targets suffer +25% aggravated bleed damage
          const moveMult = s.type === 'bleed' && isMoving ? 1.25 : 1.0;
          const rawTickDmg = dpsPerStack * stacks * moveMult * stepSec;
          const dmgType: DamageType =
            s.type === 'poison' ? 'poison' : s.type === 'burn' ? 'fire' : 'physical';

          if (rawTickDmg > 0) {
            onDotDamage(rawTickDmg, dmgType);
            this.maybeEmitStatusAuraVfx(entityId, s.type, position, isPlayer);
          }
        }
      }

      // Status could have cleared statuses array on fatal DoT tick
      if (i >= statuses.length || statuses[i] !== s) continue;

      s.remainingSec -= dt;
      if (s.remainingSec <= 0 || (s.type === 'shield' && s.potency <= 0)) {
        statuses.splice(i, 1);
      }
    }

    // Advance any pending popup timer even on sub-steps
    this.tickExistingPopupTimer(entityId, position, isPlayer, dt);
  }

  private syncPlayerSpeedModifiers(player: PlayerRuntimeState): void {
    const stats: DerivedStats = player.stats;
    let rec = this.speedRecords.get(stats);
    if (!rec) {
      rec = {
        baseMoveSpeed: stats.moveSpeed,
        lastAppliedMoveSpeed: stats.moveSpeed,
        baseAttackSpeed: stats.attackSpeed,
        lastAppliedAttackSpeed: stats.attackSpeed,
      };
      this.speedRecords.set(stats, rec);
    } else {
      if (Math.abs(stats.moveSpeed - rec.lastAppliedMoveSpeed) > 1e-4) {
        rec.baseMoveSpeed = stats.moveSpeed;
      }
      if (
        rec.lastAppliedAttackSpeed !== undefined &&
        Math.abs(stats.attackSpeed - rec.lastAppliedAttackSpeed) > 1e-4
      ) {
        rec.baseAttackSpeed = stats.attackSpeed;
      }
    }

    const { moveMultiplier, attackSpeedMultiplier, disabled } = this.computeSpeedMultipliers(
      player.statuses,
    );

    const nextMove = disabled ? 0 : rec.baseMoveSpeed * moveMultiplier;
    stats.moveSpeed = nextMove;
    rec.lastAppliedMoveSpeed = nextMove;

    if (rec.baseAttackSpeed !== undefined) {
      const nextAtk = disabled ? 0 : rec.baseAttackSpeed * attackSpeedMultiplier;
      stats.attackSpeed = nextAtk;
      rec.lastAppliedAttackSpeed = nextAtk;
    }

    if (disabled) {
      player.velocity.x = 0;
      player.velocity.z = 0;
    }
  }

  private restorePlayerSpeedModifiers(player: PlayerRuntimeState): void {
    const rec = this.speedRecords.get(player.stats);
    if (!rec) return;
    player.stats.moveSpeed = rec.baseMoveSpeed;
    rec.lastAppliedMoveSpeed = rec.baseMoveSpeed;
    if (rec.baseAttackSpeed !== undefined) {
      player.stats.attackSpeed = rec.baseAttackSpeed;
      rec.lastAppliedAttackSpeed = rec.baseAttackSpeed;
    }
  }

  private syncEnemySpeedModifier(enemy: EnemyEntity): void {
    let rec = this.speedRecords.get(enemy);
    if (!rec) {
      rec = {
        baseMoveSpeed: enemy.moveSpeed,
        lastAppliedMoveSpeed: enemy.moveSpeed,
      };
      this.speedRecords.set(enemy, rec);
    } else if (Math.abs(enemy.moveSpeed - rec.lastAppliedMoveSpeed) > 1e-4) {
      rec.baseMoveSpeed = enemy.moveSpeed;
    }

    const { moveMultiplier, disabled } = this.computeSpeedMultipliers(enemy.statuses);
    const nextMove = disabled ? 0 : rec.baseMoveSpeed * moveMultiplier;
    enemy.moveSpeed = nextMove;
    rec.lastAppliedMoveSpeed = nextMove;

    if (disabled) {
      enemy.velocity.x = 0;
      enemy.velocity.z = 0;
    }
  }

  private restoreEnemySpeedModifier(enemy: EnemyEntity): void {
    const rec = this.speedRecords.get(enemy);
    if (!rec) return;
    enemy.moveSpeed = rec.baseMoveSpeed;
    rec.lastAppliedMoveSpeed = rec.baseMoveSpeed;
  }

  private computeSpeedMultipliers(statuses: readonly ActiveStatusEffect[]): {
    moveMultiplier: number;
    attackSpeedMultiplier: number;
    disabled: boolean;
  } {
    let hasChill = false;
    let disabled = false;
    let hasteBonus = 0;

    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i];
      if (s.remainingSec <= 0) continue;
      if (s.type === 'freeze' || s.type === 'stun') {
        disabled = true;
      } else if (s.type === 'chill') {
        hasChill = true;
      } else if (s.type === 'haste') {
        hasteBonus = Math.max(hasteBonus, this.extractHasteBonus(s.potency));
      }
    }

    if (disabled) {
      return { moveMultiplier: 0, attackSpeedMultiplier: 0, disabled: true };
    }

    const chillFactor = hasChill ? CHILL_SPEED_MULTIPLIER : 1.0;
    const hasteFactor = 1.0 + hasteBonus;
    return {
      moveMultiplier: chillFactor * hasteFactor,
      attackSpeedMultiplier: (hasChill ? 0.85 : 1.0) * (1.0 + hasteBonus * 0.75),
      disabled: false,
    };
  }

  private extractHasteBonus(potency: number): number {
    if (!Number.isFinite(potency) || potency <= 0) return DEFAULT_HASTE_BONUS;
    if (potency <= 1.0) return potency;
    if (potency <= 2.5) return potency - 1.0;
    return clamp(potency / 100, 0.05, 1.0);
  }

  private computeEffectivePotency(
    type: StatusEffectType,
    rawPotency: number,
    targetMaxHp: number,
    baseHitAmount: number,
  ): number {
    const safePotency = Number.isFinite(rawPotency) ? rawPotency : 0;

    switch (type) {
      case 'shield': {
        if (safePotency > 0 && safePotency <= 1.5) {
          return Math.max(10, Math.round(Math.max(40, targetMaxHp) * safePotency));
        }
        if (safePotency > 1.5) {
          return Math.round(safePotency);
        }
        return Math.max(15, Math.round(Math.max(50, targetMaxHp) * 0.25));
      }
      case 'poison':
      case 'burn':
      case 'bleed': {
        if (safePotency > 0 && safePotency <= 1.5 && baseHitAmount > 2) {
          return Math.max(2, Math.round(baseHitAmount * safePotency * 10) / 10);
        }
        if (safePotency > 0) {
          return safePotency;
        }
        return Math.max(3, Math.round(Math.max(10, baseHitAmount) * 0.2));
      }
      case 'haste':
        return this.extractHasteBonus(safePotency);
      case 'chill':
        return 0.35;
      case 'vulnerable':
        return 0.25;
      default:
        return safePotency > 0 ? safePotency : 1;
    }
  }

  private accumulateDotPopup(
    entityId: string,
    position: Vec3,
    amount: number,
    damageType: DamageType,
    isPlayerHit: boolean,
    dt: number,
  ): void {
    const key = `${entityId}:${damageType}`;
    let bucket = this.dotBuckets.get(key);
    if (!bucket) {
      bucket = { accumulated: 0, timerSec: 0, damageType };
      this.dotBuckets.set(key, bucket);
    }
    bucket.accumulated += amount;
    // Note: timerSec is advanced in tickExistingPopupTimer so multiple statuses of same damageType don't double-advance dt
    void dt;
    if (bucket.timerSec >= DOT_NUMBER_INTERVAL_SEC && bucket.accumulated >= 1) {
      const displayAmt = Math.max(1, Math.round(bucket.accumulated));
      bucket.accumulated = 0;
      bucket.timerSec = 0;
      eventBus.emit('ui:damageNumber', {
        worldPos: { x: position.x, y: position.y + 1.25, z: position.z },
        amount: displayAmt,
        isCrit: false,
        damageType,
        isPlayerHit,
      });
    }
  }

  private tickExistingPopupTimer(
    entityId: string,
    position: Vec3,
    isPlayerHit: boolean,
    dt: number,
  ): void {
    const prefix = `${entityId}:`;
    for (const [key, bucket] of this.dotBuckets) {
      if (!key.startsWith(prefix)) continue;
      bucket.timerSec += dt;
      if (bucket.timerSec >= DOT_NUMBER_INTERVAL_SEC) {
        if (bucket.accumulated >= 0.5) {
          const displayAmt = Math.max(1, Math.round(bucket.accumulated));
          const hitPos: Vec3 = { x: position.x, y: position.y + 1.25, z: position.z };
          eventBus.emit('ui:damageNumber', {
            worldPos: hitPos,
            amount: displayAmt,
            isCrit: false,
            damageType: bucket.damageType,
            isPlayerHit,
          });
          if (!isPlayerHit && (entityId === 'training_dummy' || entityId.startsWith('training_dummy'))) {
            eventBus.emit('combat:damageDealt', {
              result: {
                finalDamage: displayAmt,
                isCrit: false,
                isDodged: false,
                killed: false,
                healedSource: 0,
                hitPosition: hitPos,
                damageType: bucket.damageType,
              },
              targetIsPlayer: false,
              targetId: entityId,
            });
          }
        }
        this.dotBuckets.delete(key);
      }
    }
  }

  private flushDotPopup(entityId: string, position: Vec3, isPlayerHit: boolean): void {
    const prefix = `${entityId}:`;
    for (const [key, bucket] of this.dotBuckets) {
      if (!key.startsWith(prefix)) continue;
      if (bucket.accumulated >= 0.5) {
        eventBus.emit('ui:damageNumber', {
          worldPos: { x: position.x, y: position.y + 1.25, z: position.z },
          amount: Math.max(1, Math.round(bucket.accumulated)),
          isCrit: false,
          damageType: bucket.damageType,
          isPlayerHit,
        });
      }
      this.dotBuckets.delete(key);
    }
  }

  private maybeEmitStatusAuraVfx(
    entityId: string,
    type: 'poison' | 'burn' | 'bleed',
    position: Vec3,
    isPlayer: boolean,
  ): void {
    if (isPlayer) return;
    const key = `${entityId}:${type}`;
    if (this.vfxPulseCooldowns.has(key)) return;
    this.vfxPulseCooldowns.set(key, 1.1);

    eventBus.emit('vfx:request', {
      type: type === 'poison' ? 'poison_cloud' : type === 'burn' ? 'hit_sparks' : 'blood_burst',
      position: { x: position.x, y: position.y + 0.7, z: position.z },
      colorHex:
        type === 'poison'
          ? DAMAGE_TYPE_COLORS.poison.hex
          : type === 'burn'
            ? DAMAGE_TYPE_COLORS.fire.hex
            : DAMAGE_TYPE_COLORS.physical.hex,
      scale: 0.55,
    });
  }
}
