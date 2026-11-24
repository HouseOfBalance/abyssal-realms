import type {
  DamagePacket,
  DamageResult,
  DungeonFloorData,
  EnemyEntity,
  PlayerRuntimeState,
  StatusEffectType,
  Vec3,
} from '../../contracts/types';
import { DAMAGE_TYPE_COLORS, MYTHIC_COLOR, clamp } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import type { ComboTracker } from './ComboTracker';
import type { StatusEffectManager } from './StatusEffectManager';

export type MythicDamagePacket = DamagePacket & {
  isMythic?: boolean;
};

export interface CombatRuntimeContext {
  player: PlayerRuntimeState | null;
  enemies: EnemyEntity[] | null;
  floor: DungeonFloorData | null;
  playerHasMythicGear: boolean;
}

const SHIELD_SPARK_COLOR_HEX = 0x66d9e8;
const CRIT_SPARK_COLOR_HEX = 0xffd43b;
const HEAL_VFX_COOLDOWN_MS = 550;
const MYTHIC_FLASH_COOLDOWN_MS = 240;

export function isTrainingDummyEntity(enemy: Pick<EnemyEntity, 'id'> | null | undefined): boolean {
  if (!enemy || typeof enemy.id !== 'string') return false;
  return enemy.id === 'training_dummy' || enemy.id.startsWith('training_dummy');
}

export function computeHyperbolicArmorMitigation(armor: number): number {
  const effectiveArmor = Math.max(0, Number.isFinite(armor) ? armor : 0);
  return effectiveArmor / (effectiveArmor + 100);
}

export class DamageResolver {
  private lastHealVfxAtMs = 0;
  private lastMythicFlashAtMs = 0;

  constructor(
    private readonly statuses: StatusEffectManager,
    private readonly combo: ComboTracker,
  ) {}

  applyDamageToEnemy(
    enemy: EnemyEntity,
    packet: MythicDamagePacket,
    ctx: CombatRuntimeContext,
  ): DamageResult {
    const hitPosition: Vec3 = {
      x: enemy?.position.x ?? 0,
      y: (enemy?.position.y ?? 0) + 0.9,
      z: enemy?.position.z ?? 0,
    };

    const isDummy = isTrainingDummyEntity(enemy);
    if (!enemy || (!isDummy && (!enemy.alive || enemy.hp <= 0))) {
      return {
        finalDamage: 0,
        isCrit: false,
        isDodged: false,
        killed: false,
        healedSource: 0,
        hitPosition,
        damageType: packet.damageType,
      };
    }

    if (isDummy) {
      enemy.alive = true;
      if (enemy.maxHp <= 0) {
        enemy.maxHp = 100000;
      }
      enemy.hp = enemy.maxHp;
    }

    const baseAmount = Math.max(0, Number.isFinite(packet.baseAmount) ? packet.baseAmount : 0);
    const critChance = Number.isFinite(packet.critChance) ? clamp(packet.critChance, 0, 1) : 0;
    const isCrit =
      baseAmount > 0 && critChance > 0 && (critChance >= 1 || Math.random() < critChance);
    const critMultiplier = isCrit
      ? Math.max(1, Number.isFinite(packet.critMultiplier) ? packet.critMultiplier : 1.5)
      : 1.0;

    const mitigation = computeHyperbolicArmorMitigation(enemy.armor);
    const vulnMultiplier = this.statuses.getVulnerabilityMultiplier(enemy.statuses);

    const rawPostMitigation = baseAmount * critMultiplier * (1 - mitigation) * vulnMultiplier;
    const preShieldDamage = baseAmount > 0 ? Math.max(1, Math.round(rawPostMitigation)) : 0;

    const { remainingDamage, absorbed } = this.statuses.absorbDamageWithShield(
      enemy.statuses,
      enemy.maxHp,
      preShieldDamage,
    );
    const finalDamage = Math.round(remainingDamage);

    // Determine whether this hit is a Mythic Primal crit or Mythic proc
    const isMythicSource =
      Boolean(packet.isMythic) ||
      (typeof packet.sourceId === 'string' && packet.sourceId.includes('mythic'));
    const isMythicHighlight =
      finalDamage > 0 &&
      (isMythicSource ||
        (isCrit &&
          (ctx.playerHasMythicGear ||
            (Number.isFinite(packet.critMultiplier) && packet.critMultiplier >= 2.6))));

    if (isDummy) {
      // Immortal Sanctuary Training Dummy: clamp HP back to maxHp so it never dies!
      enemy.hp = enemy.maxHp;
      enemy.alive = true;
    } else {
      enemy.hp = Math.max(0, enemy.hp - finalDamage);
    }

    // Apply knockback impulse (Training Dummy stays anchored on its post; bosses/elites resist)
    if (packet.knockback && !isDummy) {
      this.applyKnockback(
        enemy.position,
        enemy.velocity,
        enemy.radius,
        packet.knockback,
        enemy.isBoss ? 0.15 : enemy.isElite ? 0.5 : 1.0,
        ctx.floor,
      );
    }

    // Roll status application (Training Dummy keeps statuses for DoT & Elemental Reaction testing)
    const appliedStatus: StatusEffectType | undefined = this.statuses.tryApplyStatus(
      enemy.statuses,
      enemy.maxHp,
      baseAmount,
      packet.appliesStatus,
      packet.sourceId,
      enemy.isBoss,
    );

    // Compute & apply lifeSteal healing on attacker
    let healedSource = 0;
    if (
      finalDamage > 0 &&
      packet.lifeSteal &&
      Number.isFinite(packet.lifeSteal) &&
      packet.lifeSteal > 0
    ) {
      const lsRatio = clamp(packet.lifeSteal, 0, 2);
      healedSource = Math.round(finalDamage * lsRatio * 100) / 100;
      if (healedSource > 0 && ctx.player && packet.sourceId === ctx.player.id && ctx.player.alive) {
        ctx.player.hp = Math.min(ctx.player.stats.maxHp, ctx.player.hp + healedSource);
        this.maybeEmitHealAura(ctx.player.position);
      }
    }

    const killed = !isDummy && enemy.hp <= 0;
    const hitFlashColor =
      absorbed > 0 && finalDamage === 0
        ? SHIELD_SPARK_COLOR_HEX
        : isMythicHighlight
          ? MYTHIC_COLOR.hex
          : isCrit
            ? CRIT_SPARK_COLOR_HEX
            : DAMAGE_TYPE_COLORS[packet.damageType].hex;

    if (killed) {
      enemy.hp = 0;
      enemy.alive = false;
      enemy.meshHandle?.flashHit(isMythicHighlight ? MYTHIC_COLOR.hex : CRIT_SPARK_COLOR_HEX);
      enemy.meshHandle?.playAnim('death');
      this.combo.registerKill(enemy.isBoss ? 5 : enemy.isElite ? 2 : 1);
    } else {
      enemy.meshHandle?.flashHit(hitFlashColor);
      if (isDummy || (!enemy.isBoss && (isCrit || appliedStatus === 'stun'))) {
        enemy.meshHandle?.playAnim('hit');
      }
    }

    const result: DamageResult = {
      finalDamage,
      isCrit,
      isDodged: false,
      killed,
      healedSource,
      ...(appliedStatus ? { appliedStatus } : {}),
      hitPosition,
      damageType: packet.damageType,
    };

    // Emit 'combat:damageDealt' BEFORE clearing dead enemy statuses so Elemental Reaction
    // listeners (@combat-mastery) can still read pre-death freeze/chill/poison/void statuses!
    eventBus.emit('combat:damageDealt', {
      result,
      targetIsPlayer: false,
      targetId: enemy.id,
    });

    if (killed) {
      enemy.statuses.length = 0;
    }

    if (finalDamage > 0) {
      eventBus.emit('ui:damageNumber', {
        worldPos: { x: hitPosition.x, y: hitPosition.y + 0.35, z: hitPosition.z },
        amount: finalDamage,
        isCrit: isCrit || isMythicHighlight,
        damageType: packet.damageType,
        isPlayerHit: false,
      });
    }

    eventBus.emit('vfx:request', {
      type: killed ? 'blood_burst' : 'hit_sparks',
      position: hitPosition,
      colorHex: hitFlashColor,
      scale: killed
        ? enemy.isBoss
          ? 2.2
          : 1.25
        : isMythicHighlight
          ? 1.65
          : isCrit
            ? 1.35
            : 0.9,
    });

    if (isMythicHighlight) {
      this.emitMythicHighlight(hitPosition);
    }

    eventBus.emit('sfx:request', {
      id: isCrit || isMythicHighlight ? 'hit_crit' : 'hit_flesh',
      position: hitPosition,
    });

    if (killed) {
      eventBus.emit('combat:enemyKilled', { enemy });
      eventBus.emit('camera:shake', {
        trauma: enemy.isBoss
          ? 0.75
          : enemy.isElite
            ? 0.42
            : isMythicHighlight
              ? 0.34
              : isCrit
                ? 0.28
                : 0.18,
      });
      eventBus.emit('engine:hitstop', {
        durationSec: enemy.isBoss ? 0.14 : enemy.isElite ? 0.07 : isMythicHighlight ? 0.05 : 0.035,
        timeScale: enemy.isBoss ? 0.04 : 0.08,
      });
    } else if (isMythicHighlight) {
      eventBus.emit('camera:shake', { trauma: 0.32 });
      eventBus.emit('engine:hitstop', { durationSec: 0.05, timeScale: 0.07 });
    } else if (isCrit) {
      eventBus.emit('camera:shake', { trauma: 0.25 });
      eventBus.emit('engine:hitstop', { durationSec: 0.04, timeScale: 0.1 });
    }

    return result;
  }

  applyDamageToPlayer(
    player: PlayerRuntimeState,
    packet: DamagePacket,
    ctx: CombatRuntimeContext,
  ): DamageResult {
    const hitPosition: Vec3 = {
      x: player.position.x,
      y: player.position.y + 1.0,
      z: player.position.z,
    };

    if (!player || !player.alive || player.hp <= 0) {
      return {
        finalDamage: 0,
        isCrit: false,
        isDodged: false,
        killed: false,
        healedSource: 0,
        hitPosition,
        damageType: packet.damageType,
      };
    }

    // 1. Check active Dodge Roll / Invulnerability Frames
    if (player.isDodging || player.invulnerableSec > 0) {
      const dodgedResult: DamageResult = {
        finalDamage: 0,
        isCrit: false,
        isDodged: true,
        killed: false,
        healedSource: 0,
        hitPosition,
        damageType: packet.damageType,
      };
      eventBus.emit('combat:damageDealt', {
        result: dodgedResult,
        targetIsPlayer: true,
        targetId: player.id,
      });
      return dodgedResult;
    }

    // 2. Check passive Evasion / Dodge Chance
    const dodgeChance = Number.isFinite(player.stats.dodgeChance)
      ? clamp(player.stats.dodgeChance, 0, 1)
      : 0;
    if (dodgeChance > 0 && (dodgeChance >= 1 || Math.random() < dodgeChance)) {
      const evadedResult: DamageResult = {
        finalDamage: 0,
        isCrit: false,
        isDodged: true,
        killed: false,
        healedSource: 0,
        hitPosition,
        damageType: packet.damageType,
      };
      eventBus.emit('sfx:request', { id: 'dodge_whoosh', position: hitPosition });
      eventBus.emit('vfx:request', {
        type: 'dodge_afterimage',
        position: player.position,
        scale: 0.75,
      });
      eventBus.emit('combat:damageDealt', {
        result: evadedResult,
        targetIsPlayer: true,
        targetId: player.id,
      });
      return evadedResult;
    }

    // 3. Resolve Crit, Armor Mitigation, Vulnerable, and Shield
    const baseAmount = Math.max(0, Number.isFinite(packet.baseAmount) ? packet.baseAmount : 0);
    const critChance = Number.isFinite(packet.critChance) ? clamp(packet.critChance, 0, 1) : 0;
    const isCrit =
      baseAmount > 0 && critChance > 0 && (critChance >= 1 || Math.random() < critChance);
    const critMultiplier = isCrit
      ? Math.max(1, Number.isFinite(packet.critMultiplier) ? packet.critMultiplier : 1.5)
      : 1.0;

    const mitigation = computeHyperbolicArmorMitigation(player.stats.armor);
    const vulnMultiplier = this.statuses.getVulnerabilityMultiplier(player.statuses);

    const rawPostMitigation = baseAmount * critMultiplier * (1 - mitigation) * vulnMultiplier;
    const preShieldDamage = baseAmount > 0 ? Math.max(1, Math.round(rawPostMitigation)) : 0;

    const { remainingDamage, absorbed } = this.statuses.absorbDamageWithShield(
      player.statuses,
      player.stats.maxHp,
      preShieldDamage,
    );
    const finalDamage = Math.round(remainingDamage);

    player.hp = Math.max(0, player.hp - finalDamage);

    // 4. Knockback on Player
    if (packet.knockback) {
      this.applyKnockback(
        player.position,
        player.velocity,
        player.radius,
        packet.knockback,
        1.0,
        ctx.floor,
      );
    }

    // 5. Status Effect Application
    const appliedStatus: StatusEffectType | undefined = this.statuses.tryApplyStatus(
      player.statuses,
      player.stats.maxHp,
      baseAmount,
      packet.appliesStatus,
      packet.sourceId,
      false,
    );

    // 6. Vampiric / Enemy LifeSteal
    let healedSource = 0;
    if (
      finalDamage > 0 &&
      packet.lifeSteal &&
      Number.isFinite(packet.lifeSteal) &&
      packet.lifeSteal > 0
    ) {
      const lsRatio = clamp(packet.lifeSteal, 0, 2);
      healedSource = Math.round(finalDamage * lsRatio * 100) / 100;
      if (healedSource > 0 && ctx.enemies) {
        for (let i = 0; i < ctx.enemies.length; i++) {
          const attacker = ctx.enemies[i];
          if (attacker && attacker.id === packet.sourceId && attacker.alive) {
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + healedSource);
            break;
          }
        }
      }
    }

    const killed = player.hp <= 0;
    if (killed) {
      player.hp = 0;
      player.alive = false;
      player.statuses.length = 0;
    }

    const result: DamageResult = {
      finalDamage,
      isCrit,
      isDodged: false,
      killed,
      healedSource,
      ...(appliedStatus ? { appliedStatus } : {}),
      hitPosition,
      damageType: packet.damageType,
    };

    eventBus.emit('combat:damageDealt', {
      result,
      targetIsPlayer: true,
      targetId: player.id,
    });

    if (finalDamage > 0) {
      eventBus.emit('ui:damageNumber', {
        worldPos: { x: hitPosition.x, y: hitPosition.y + 0.4, z: hitPosition.z },
        amount: finalDamage,
        isCrit,
        damageType: packet.damageType,
        isPlayerHit: true,
      });
      eventBus.emit('sfx:request', { id: 'player_hurt', position: hitPosition });
      eventBus.emit('vfx:request', {
        type: killed ? 'blood_burst' : 'hit_sparks',
        position: hitPosition,
        colorHex: DAMAGE_TYPE_COLORS[packet.damageType].hex,
        scale: killed ? 1.5 : 1.0,
      });

      const hpRatioLost = finalDamage / Math.max(1, player.stats.maxHp);
      eventBus.emit('camera:shake', {
        trauma: clamp(0.14 + hpRatioLost * 1.1, 0.14, 0.65),
      });
      if (killed || isCrit) {
        eventBus.emit('engine:hitstop', {
          durationSec: killed ? 0.12 : 0.035,
          timeScale: 0.08,
        });
      }
    } else if (absorbed > 0) {
      eventBus.emit('vfx:request', {
        type: 'hit_sparks',
        position: hitPosition,
        colorHex: SHIELD_SPARK_COLOR_HEX,
        scale: 0.85,
      });
    }

    return result;
  }

  private emitMythicHighlight(position: Vec3): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastMythicFlashAtMs < MYTHIC_FLASH_COOLDOWN_MS) return;
    this.lastMythicFlashAtMs = now;

    eventBus.emit('vfx:request', {
      type: 'void_implosion',
      position,
      colorHex: MYTHIC_COLOR.hex,
      radius: 1.75,
      scale: 1.1,
    });
    eventBus.emit('lighting:flash', {
      colorHex: MYTHIC_COLOR.hex,
      intensity: 1.6,
      durationSec: 0.14,
    });
  }

  private applyKnockback(
    position: Vec3,
    velocity: Vec3,
    entityRadius: number,
    knockback: Vec3,
    scale: number,
    floor: DungeonFloorData | null,
  ): void {
    const kx = Number.isFinite(knockback.x) ? knockback.x * scale : 0;
    const ky = Number.isFinite(knockback.y) ? knockback.y * scale : 0;
    const kz = Number.isFinite(knockback.z) ? knockback.z * scale : 0;

    if (Math.abs(kx) < 1e-5 && Math.abs(kz) < 1e-5 && Math.abs(ky) < 1e-5) return;

    velocity.x += kx;
    velocity.y += ky;
    velocity.z += kz;

    // Immediate wall-safe micro-impulse so knockback feels crisp even when AI resets velocity
    const nudgeX = clamp(kx * 0.08, -0.5, 0.5);
    const nudgeZ = clamp(kz * 0.08, -0.5, 0.5);
    const candX = position.x + nudgeX;
    const candZ = position.z + nudgeZ;

    if (!floor) {
      position.x = candX;
      position.z = candZ;
      return;
    }

    const probeRadius = Math.max(0.1, entityRadius);
    if (floor.isWalkableWorld(candX, candZ, probeRadius)) {
      position.x = candX;
      position.z = candZ;
    } else if (floor.isWalkableWorld(candX, position.z, probeRadius)) {
      position.x = candX;
    } else if (floor.isWalkableWorld(position.x, candZ, probeRadius)) {
      position.z = candZ;
    }
  }

  private maybeEmitHealAura(position: Vec3): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastHealVfxAtMs < HEAL_VFX_COOLDOWN_MS) return;
    this.lastHealVfxAtMs = now;

    eventBus.emit('vfx:request', {
      type: 'heal_aura',
      position: { x: position.x, y: position.y + 0.5, z: position.z },
      scale: 0.7,
    });
  }
}
