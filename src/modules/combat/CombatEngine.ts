import type * as THREE from 'three';
import type {
  DamagePacket,
  DamageResult,
  DamageType,
  DungeonFloorData,
  EnemyEntity,
  EquipSlot,
  ICombatEngine,
  PlayerRuntimeState,
  ProjectileSpec,
  SfxId,
  Vec3,
  VfxEffectType,
} from '../../contracts/types';
import { DAMAGE_TYPE_COLORS, MYTHIC_COLOR, clamp, distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { ComboTracker } from './ComboTracker';
import {
  type CombatRuntimeContext,
  DamageResolver,
  isTrainingDummyEntity,
  type MythicDamagePacket,
} from './DamageResolver';
import { type ProjectileDamageCallbacks, ProjectilePool } from './ProjectilePool';
import { StatusEffectManager } from './StatusEffectManager';

export class CombatEngine implements ICombatEngine {
  private readonly combo = new ComboTracker();
  private readonly statuses = new StatusEffectManager();
  private readonly resolver = new DamageResolver(this.statuses, this.combo);
  private readonly projectiles = new ProjectilePool();
  private readonly equippedMythicSlots = new Set<EquipSlot>();
  private forcedMythicActive = false;
  private unsubscribeGearChanged: (() => void) | null = null;

  private readonly runtimeCtx: CombatRuntimeContext = {
    player: null,
    enemies: null,
    floor: null,
    playerHasMythicGear: false,
  };

  private readonly projectileCallbacks: ProjectileDamageCallbacks = {
    applyEnemyDamage: (enemy, packet) => this.applyDamageToEnemy(enemy, packet),
    applyPlayerDamage: (player, packet) => this.applyDamageToPlayer(player, packet),
    performPlayerAoE: (center, radius, packet, enemies) =>
      this.performAoE(center, radius, packet, enemies),
  };

  constructor() {
    this.unsubscribeGearChanged = eventBus.on('hero:gearChanged', ({ slot, item }) => {
      if (slot === 'all') {
        this.equippedMythicSlots.clear();
        if (item?.isMythic) {
          this.equippedMythicSlots.add(item.slot);
        }
      } else if (item?.isMythic) {
        this.equippedMythicSlots.add(slot);
      } else {
        this.equippedMythicSlots.delete(slot);
      }
      this.syncMythicRuntimeFlag();
    });
  }

  init(scene: THREE.Scene): void {
    this.projectiles.init(scene);
  }

  setMythicProcActive(active: boolean): void {
    this.forcedMythicActive = active;
    this.syncMythicRuntimeFlag();
  }

  performMeleeArc(
    attackerPos: Vec3,
    facingDir: Vec3,
    range: number,
    arcAngleRad: number,
    packet: Omit<MythicDamagePacket, 'targetId'>,
    targets: EnemyEntity[],
  ): DamageResult[] {
    const effectiveRange = Math.max(0, Number.isFinite(range) ? range : 0);
    const rawFx = Number.isFinite(facingDir.x) ? facingDir.x : 0;
    const rawFz = Number.isFinite(facingDir.z) ? facingDir.z : 0;
    const fLen = Math.hypot(rawFx, rawFz);
    const fx = fLen > 1e-6 ? rawFx / fLen : 0;
    const fz = fLen > 1e-6 ? rawFz / fLen : 1;

    const swingPos: Vec3 = {
      x: attackerPos.x,
      y: attackerPos.y + 0.9,
      z: attackerPos.z,
    };

    const isMythicSwing =
      Boolean(packet.isMythic) ||
      (packet.sourceId === 'player' && this.runtimeCtx.playerHasMythicGear);
    const arcColorHex = isMythicSwing
      ? MYTHIC_COLOR.hex
      : DAMAGE_TYPE_COLORS[packet.damageType].hex;

    eventBus.emit('vfx:request', {
      type: 'slash_arc',
      position: swingPos,
      direction: { x: fx, y: 0, z: fz },
      colorHex: arcColorHex,
      radius: Math.max(0.5, effectiveRange),
      scale: clamp(effectiveRange / 2.2, 0.75, 2.0),
    });
    eventBus.emit('sfx:request', {
      id: 'sword_swing',
      position: swingPos,
    });

    if (!targets || targets.length === 0 || effectiveRange <= 0) {
      return [];
    }

    const safeArc = Math.max(0, Number.isFinite(arcAngleRad) ? arcAngleRad : Math.PI * 0.5);
    const isFullCircle = safeArc >= Math.PI * 2 - 1e-4;
    const cosHalfArc = Math.cos(Math.min(Math.PI, safeArc * 0.5));

    this.runtimeCtx.enemies = targets;
    const results: DamageResult[] = [];

    for (let i = 0; i < targets.length; i++) {
      const enemy = targets[i];
      if (!enemy) continue;
      if (!isTrainingDummyEntity(enemy) && (!enemy.alive || enemy.hp <= 0)) continue;

      const dx = enemy.position.x - attackerPos.x;
      const dz = enemy.position.z - attackerPos.z;
      const dist = Math.hypot(dx, dz);
      const enemyRadius = Math.max(0, Number.isFinite(enemy.radius) ? enemy.radius : 0);

      if (dist > effectiveRange + enemyRadius) continue;

      if (!isFullCircle && dist > 1e-4) {
        const dot = (dx / dist) * fx + (dz / dist) * fz;
        if (dot < cosHalfArc - 1e-5) continue;
      }

      results.push(
        this.applyDamageToEnemy(enemy, {
          ...packet,
          targetId: enemy.id,
        }),
      );
    }

    return results;
  }

  performAoE(
    center: Vec3,
    radius: number,
    packet: Omit<MythicDamagePacket, 'targetId'>,
    targets: EnemyEntity[],
  ): DamageResult[] {
    const effectiveRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
    const { vfx, sfx, flashLight } = this.getAoEVisualConfig(packet.damageType);
    const isMythicBurst =
      Boolean(packet.isMythic) ||
      (typeof packet.sourceId === 'string' && packet.sourceId.includes('mythic'));
    const colorHex = isMythicBurst
      ? MYTHIC_COLOR.hex
      : DAMAGE_TYPE_COLORS[packet.damageType].hex;

    eventBus.emit('vfx:request', {
      type: vfx,
      position: { x: center.x, y: center.y + 0.25, z: center.z },
      colorHex,
      radius: Math.max(0.5, effectiveRadius),
      scale: clamp(effectiveRadius / 2.5, 0.7, 2.4),
    });
    eventBus.emit('sfx:request', {
      id: sfx,
      position: center,
    });
    eventBus.emit('camera:shake', {
      trauma: clamp(0.14 + effectiveRadius * 0.025, 0.14, 0.35),
    });

    if (flashLight || isMythicBurst) {
      eventBus.emit('lighting:flash', {
        colorHex,
        intensity: isMythicBurst ? 1.65 : 1.4,
        durationSec: 0.16,
      });
    }

    if (!targets || targets.length === 0 || effectiveRadius <= 0) {
      return [];
    }

    this.runtimeCtx.enemies = targets;
    const results: DamageResult[] = [];

    for (let i = 0; i < targets.length; i++) {
      const enemy = targets[i];
      if (!enemy) continue;
      if (!isTrainingDummyEntity(enemy) && (!enemy.alive || enemy.hp <= 0)) continue;

      const enemyRadius = Math.max(0, Number.isFinite(enemy.radius) ? enemy.radius : 0);
      if (distXZ(center, enemy.position) <= effectiveRadius + enemyRadius) {
        results.push(
          this.applyDamageToEnemy(enemy, {
            ...packet,
            targetId: enemy.id,
          }),
        );
      }
    }

    return results;
  }

  spawnProjectile(spec: ProjectileSpec): void {
    if (
      spec.ownerIsPlayer &&
      this.runtimeCtx.playerHasMythicGear &&
      (!spec.visualColorHex || spec.visualColorHex === DAMAGE_TYPE_COLORS.physical.hex)
    ) {
      this.projectiles.spawn({
        ...spec,
        visualColorHex: MYTHIC_COLOR.hex,
      });
      return;
    }
    this.projectiles.spawn(spec);
  }

  applyDamageToEnemy(enemy: EnemyEntity, packet: MythicDamagePacket): DamageResult {
    return this.resolver.applyDamageToEnemy(enemy, packet, this.runtimeCtx);
  }

  applyDamageToPlayer(player: PlayerRuntimeState, packet: DamagePacket): DamageResult {
    this.runtimeCtx.player = player;
    return this.resolver.applyDamageToPlayer(player, packet, this.runtimeCtx);
  }

  tickStatuses(dt: number, player: PlayerRuntimeState, enemies: EnemyEntity[]): void {
    this.runtimeCtx.player = player;
    this.runtimeCtx.enemies = enemies;
    this.combo.update(dt);
    this.statuses.tickStatuses(dt, player, enemies, this.combo);
  }

  updateProjectiles(
    dt: number,
    floor: DungeonFloorData,
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
  ): void {
    this.runtimeCtx.floor = floor;
    this.runtimeCtx.player = player;
    this.runtimeCtx.enemies = enemies;
    this.projectiles.update(dt, floor, player, enemies, this.projectileCallbacks);
  }

  getComboState(): { count: number; timerSec: number; multiplier: number } {
    return this.combo.getState();
  }

  clearFloorEntities(): void {
    this.projectiles.clearActive();
    this.statuses.clearTransientState();
    this.combo.reset();
    this.runtimeCtx.enemies = null;
    this.runtimeCtx.floor = null;
  }

  dispose(): void {
    if (this.unsubscribeGearChanged) {
      this.unsubscribeGearChanged();
      this.unsubscribeGearChanged = null;
    }
    this.equippedMythicSlots.clear();
    this.forcedMythicActive = false;
    this.runtimeCtx.playerHasMythicGear = false;
    this.clearFloorEntities();
    this.runtimeCtx.player = null;
    this.projectiles.dispose();
  }

  private syncMythicRuntimeFlag(): void {
    this.runtimeCtx.playerHasMythicGear =
      this.forcedMythicActive || this.equippedMythicSlots.size > 0;
  }

  private getAoEVisualConfig(damageType: DamageType): {
    vfx: VfxEffectType;
    sfx: SfxId;
    flashLight: boolean;
  } {
    switch (damageType) {
      case 'fire':
        return { vfx: 'fire_explosion', sfx: 'explosion', flashLight: true };
      case 'ice':
        return { vfx: 'frost_nova', sfx: 'frost_shatter', flashLight: false };
      case 'lightning':
        return { vfx: 'lightning_strike', sfx: 'lightning_zap', flashLight: true };
      case 'poison':
        return { vfx: 'poison_cloud', sfx: 'explosion', flashLight: false };
      case 'void':
        return { vfx: 'void_implosion', sfx: 'explosion', flashLight: true };
      case 'physical':
      default:
        return { vfx: 'hit_sparks', sfx: 'explosion', flashLight: false };
    }
  }
}
