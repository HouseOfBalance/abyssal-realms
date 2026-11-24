import * as THREE from 'three';
import type {
  DamagePacket,
  DamageResult,
  DamageType,
  DungeonFloorData,
  EnemyEntity,
  PlayerRuntimeState,
  ProjectileSpec,
  SfxId,
  Vec3,
  VfxEffectType,
} from '../../contracts/types';
import { DAMAGE_TYPE_COLORS, clamp, distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';

type ProjectileVisualKind = 'fire' | 'ice' | 'arcane' | 'arrow';

interface SharedProjectileGeometries {
  fireCore: THREE.BufferGeometry;
  fireCorona: THREE.BufferGeometry;
  fireTail: THREE.BufferGeometry;
  iceFront: THREE.BufferGeometry;
  iceRear: THREE.BufferGeometry;
  iceRing: THREE.BufferGeometry;
  arcaneCore: THREE.BufferGeometry;
  arcaneRing: THREE.BufferGeometry;
  arcaneTail: THREE.BufferGeometry;
  arrowShaft: THREE.BufferGeometry;
  arrowTip: THREE.BufferGeometry;
  arrowVaneH: THREE.BufferGeometry;
  arrowVaneV: THREE.BufferGeometry;
  arrowWake: THREE.BufferGeometry;
}

interface PooledProjectile {
  active: boolean;
  ownerIsPlayer: boolean;
  ownerId: string;
  x: number;
  z: number;
  visualY: number;
  dirX: number;
  dirZ: number;
  speed: number;
  maxDistance: number;
  distanceTraveled: number;
  radius: number;
  piercing: boolean;
  homing: boolean;
  aoeExplosionRadius: number;
  damagePacket: Omit<DamagePacket, 'targetId'>;
  visualColorHex: number;
  visualKind: ProjectileVisualKind;
  ageSec: number;
  hitIds: Set<string>;

  // 3D visual nodes
  root: THREE.Group;
  fireGroup: THREE.Group;
  iceGroup: THREE.Group;
  arcaneGroup: THREE.Group;
  arcaneRingA: THREE.Mesh;
  arcaneRingB: THREE.Mesh;
  arrowGroup: THREE.Group;
  coreMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
}

export interface ProjectileDamageCallbacks {
  applyEnemyDamage: (enemy: EnemyEntity, packet: DamagePacket) => DamageResult;
  applyPlayerDamage: (player: PlayerRuntimeState, packet: DamagePacket) => DamageResult;
  performPlayerAoE: (
    center: Vec3,
    radius: number,
    packet: Omit<DamagePacket, 'targetId'>,
    enemies: EnemyEntity[],
  ) => DamageResult[];
}

const INITIAL_POOL_SIZE = 48;
const MAX_POOL_SIZE = 256;
const MAX_SUBSTEP_DIST = 0.4;
const HOMING_RANGE = 20.0;
const HOMING_TURN_RATE_RAD = 5.8;
const WALL_PROBE_RADIUS = 0.08;

const WHITE_COLOR = new THREE.Color(0xffffff);
const TEMP_COLOR = new THREE.Color();

export class ProjectilePool {
  private scene: THREE.Scene | null = null;
  private containerGroup: THREE.Group;
  private geometries: SharedProjectileGeometries;
  private pool: PooledProjectile[] = [];
  private disposed = false;

  constructor() {
    this.containerGroup = new THREE.Group();
    this.containerGroup.name = 'CombatProjectilesRoot';
    this.geometries = this.createSharedGeometries();

    for (let i = 0; i < INITIAL_POOL_SIZE; i++) {
      this.pool.push(this.createPooledSlot());
    }
  }

  init(scene: THREE.Scene): void {
    if (this.disposed) return;
    if (this.scene && this.scene !== scene) {
      this.scene.remove(this.containerGroup);
    }
    this.scene = scene;
    if (this.containerGroup.parent !== scene) {
      scene.add(this.containerGroup);
    }
  }

  spawn(spec: ProjectileSpec): void {
    if (this.disposed) return;

    const slot = this.acquireSlot();
    const rawDx = Number.isFinite(spec.direction.x) ? spec.direction.x : 0;
    const rawDz = Number.isFinite(spec.direction.z) ? spec.direction.z : 0;
    const len = Math.hypot(rawDx, rawDz);
    const dirX = len > 1e-6 ? rawDx / len : 0;
    const dirZ = len > 1e-6 ? rawDz / len : 1;

    const visualY =
      Number.isFinite(spec.origin.y) && spec.origin.y > 0.2 ? spec.origin.y : 0.85;
    const damageType = spec.damagePacket.damageType;
    const colorHex =
      Number.isFinite(spec.visualColorHex) && spec.visualColorHex > 0
        ? spec.visualColorHex
        : DAMAGE_TYPE_COLORS[damageType].hex;

    slot.active = true;
    slot.ownerIsPlayer = spec.ownerIsPlayer;
    slot.ownerId = spec.ownerId;
    slot.x = spec.origin.x;
    slot.z = spec.origin.z;
    slot.visualY = visualY;
    slot.dirX = dirX;
    slot.dirZ = dirZ;
    slot.speed = Math.max(0.5, Number.isFinite(spec.speed) ? spec.speed : 14);
    slot.maxDistance = Math.max(0.5, Number.isFinite(spec.maxDistance) ? spec.maxDistance : 18);
    slot.distanceTraveled = 0;
    slot.radius = Math.max(0.1, Number.isFinite(spec.radius) ? spec.radius : 0.3);
    slot.piercing = Boolean(spec.piercing);
    slot.homing = Boolean(spec.homing);
    slot.aoeExplosionRadius =
      spec.aoeExplosionRadius && Number.isFinite(spec.aoeExplosionRadius)
        ? Math.max(0, spec.aoeExplosionRadius)
        : 0;
    slot.damagePacket = spec.damagePacket;
    slot.visualColorHex = colorHex;
    slot.visualKind = this.selectVisualKind(damageType);
    slot.ageSec = 0;
    slot.hitIds.clear();

    this.configureSlotVisuals(slot);
    this.emitCastAudio(damageType, { x: slot.x, y: visualY, z: slot.z });
  }

  update(
    dt: number,
    floor: DungeonFloorData,
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
    callbacks: ProjectileDamageCallbacks,
  ): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;

    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      p.ageSec += dt;

      if (p.homing) {
        this.steerHoming(p, dt, player, enemies);
      }

      const totalMove = p.speed * dt;
      const steps = Math.max(1, Math.ceil(totalMove / MAX_SUBSTEP_DIST));
      const subStepDist = totalMove / steps;

      for (let s = 0; s < steps && p.active; s++) {
        const prevX = p.x;
        const prevZ = p.z;
        p.x += p.dirX * subStepDist;
        p.z += p.dirZ * subStepDist;
        p.distanceTraveled += subStepDist;

        // 1. Wall / Void Obstacle Check
        if (floor && !floor.isWalkableWorld(p.x, p.z, WALL_PROBE_RADIUS)) {
          const impactPos: Vec3 = { x: prevX, y: p.visualY, z: prevZ };
          if (p.aoeExplosionRadius > 0) {
            this.detonateProjectileAoE(p, impactPos, player, enemies, callbacks);
          } else {
            eventBus.emit('vfx:request', {
              type: 'hit_sparks',
              position: impactPos,
              colorHex: p.visualColorHex,
              scale: 0.75,
            });
          }
          this.deactivateSlot(p);
          break;
        }

        // 2. Entity Collision Check
        if (p.ownerIsPlayer) {
          this.checkPlayerProjectileHits(p, enemies, callbacks);
        } else {
          this.checkEnemyProjectileHit(p, player, enemies, callbacks);
        }

        if (!p.active) break;

        // 3. Max Range Expiry
        if (p.distanceTraveled >= p.maxDistance) {
          if (p.aoeExplosionRadius > 0) {
            this.detonateProjectileAoE(
              p,
              { x: p.x, y: p.visualY, z: p.z },
              player,
              enemies,
              callbacks,
            );
          }
          this.deactivateSlot(p);
          break;
        }
      }

      if (p.active) {
        this.updateSlotTransform(p, dt);
      }
    }
  }

  clearActive(): void {
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].active) {
        this.deactivateSlot(this.pool[i]);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.clearActive();

    if (this.scene) {
      this.scene.remove(this.containerGroup);
      this.scene = null;
    }

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i];
      slot.coreMat.dispose();
      slot.glowMat.dispose();
    }
    this.pool.length = 0;

    for (const geo of Object.values(this.geometries)) {
      geo.dispose();
    }
  }

  private checkPlayerProjectileHits(
    p: PooledProjectile,
    enemies: EnemyEntity[],
    callbacks: ProjectileDamageCallbacks,
  ): void {
    const projPos: Vec3 = { x: p.x, y: p.visualY, z: p.z };

    for (let eIdx = 0; eIdx < enemies.length; eIdx++) {
      const enemy = enemies[eIdx];
      if (!enemy || !enemy.alive || enemy.hp <= 0) continue;
      if (p.hitIds.has(enemy.id)) continue;

      const hitThreshold = p.radius + Math.max(0.15, enemy.radius);
      if (distXZ(projPos, enemy.position) <= hitThreshold) {
        p.hitIds.add(enemy.id);

        if (p.aoeExplosionRadius > 0) {
          this.detonateProjectileAoE(p, projPos, null, enemies, callbacks, enemy);
        } else {
          callbacks.applyEnemyDamage(enemy, {
            ...p.damagePacket,
            targetId: enemy.id,
          });
        }

        if (!p.piercing) {
          this.deactivateSlot(p);
          return;
        }
      }
    }
  }

  private checkEnemyProjectileHit(
    p: PooledProjectile,
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
    callbacks: ProjectileDamageCallbacks,
  ): void {
    if (!player || !player.alive || player.hp <= 0) return;
    if (p.hitIds.has(player.id)) return;

    const projPos: Vec3 = { x: p.x, y: p.visualY, z: p.z };
    const hitThreshold = p.radius + Math.max(0.15, player.radius);

    if (distXZ(projPos, player.position) <= hitThreshold) {
      p.hitIds.add(player.id);

      if (p.aoeExplosionRadius > 0) {
        this.detonateProjectileAoE(p, projPos, player, enemies, callbacks);
        if (!p.piercing) {
          this.deactivateSlot(p);
        }
        return;
      }

      const wasRolling = player.isDodging;
      callbacks.applyPlayerDamage(player, {
        ...p.damagePacket,
        targetId: player.id,
      });

      // Let non-AoE enemy bolts pass cleanly over a dodge-rolling hero!
      if (!p.piercing && !wasRolling) {
        this.deactivateSlot(p);
      }
    }
  }

  private detonateProjectileAoE(
    p: PooledProjectile,
    center: Vec3,
    player: PlayerRuntimeState | null,
    enemies: EnemyEntity[],
    callbacks: ProjectileDamageCallbacks,
    guaranteedEnemy?: EnemyEntity,
  ): void {
    if (p.ownerIsPlayer) {
      callbacks.performPlayerAoE(center, p.aoeExplosionRadius, p.damagePacket, enemies);
      // Guarantee primary struck target takes the AoE if projectile radius exceeded explosion radius
      if (
        guaranteedEnemy &&
        guaranteedEnemy.alive &&
        distXZ(center, guaranteedEnemy.position) >
          p.aoeExplosionRadius + Math.max(0, guaranteedEnemy.radius)
      ) {
        callbacks.applyEnemyDamage(guaranteedEnemy, {
          ...p.damagePacket,
          targetId: guaranteedEnemy.id,
        });
      }
    } else {
      const { vfx, sfx } = this.getExplosionFeedback(p.damagePacket.damageType);
      eventBus.emit('vfx:request', {
        type: vfx,
        position: center,
        colorHex: p.visualColorHex,
        radius: p.aoeExplosionRadius,
        scale: clamp(p.aoeExplosionRadius / 2.5, 0.7, 2.2),
      });
      eventBus.emit('sfx:request', { id: sfx, position: center });
      eventBus.emit('camera:shake', { trauma: 0.22 });

      if (
        player &&
        player.alive &&
        distXZ(center, player.position) <= p.aoeExplosionRadius + Math.max(0, player.radius)
      ) {
        callbacks.applyPlayerDamage(player, {
          ...p.damagePacket,
          targetId: player.id,
        });
      }
    }
  }

  private steerHoming(
    p: PooledProjectile,
    dt: number,
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
  ): void {
    let targetPos: Vec3 | null = null;

    if (p.ownerIsPlayer) {
      let bestDistSq = HOMING_RANGE * HOMING_RANGE;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e || !e.alive || e.hp <= 0 || p.hitIds.has(e.id)) continue;
        const dx = e.position.x - p.x;
        const dz = e.position.z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          targetPos = e.position;
        }
      }
    } else if (player && player.alive && player.hp > 0 && !p.hitIds.has(player.id)) {
      const dx = player.position.x - p.x;
      const dz = player.position.z - p.z;
      if (dx * dx + dz * dz <= HOMING_RANGE * HOMING_RANGE) {
        targetPos = player.position;
      }
    }

    if (!targetPos) return;

    const toX = targetPos.x - p.x;
    const toZ = targetPos.z - p.z;
    const toLen = Math.hypot(toX, toZ);
    if (toLen < 1e-4) return;

    const currentAngle = Math.atan2(p.dirX, p.dirZ);
    const desiredAngle = Math.atan2(toX / toLen, toZ / toLen);
    let deltaAngle = desiredAngle - currentAngle;
    while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
    while (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;

    const maxTurn = HOMING_TURN_RATE_RAD * dt;
    const nextAngle = currentAngle + clamp(deltaAngle, -maxTurn, maxTurn);
    p.dirX = Math.sin(nextAngle);
    p.dirZ = Math.cos(nextAngle);
  }

  private selectVisualKind(damageType: DamageType): ProjectileVisualKind {
    switch (damageType) {
      case 'fire':
        return 'fire';
      case 'ice':
        return 'ice';
      case 'physical':
      case 'poison':
        return 'arrow';
      case 'lightning':
      case 'void':
      default:
        return 'arcane';
    }
  }

  private configureSlotVisuals(slot: PooledProjectile): void {
    TEMP_COLOR.setHex(slot.visualColorHex);
    slot.glowMat.color.copy(TEMP_COLOR);
    slot.coreMat.color.copy(WHITE_COLOR).lerp(TEMP_COLOR, 0.35);

    slot.fireGroup.visible = slot.visualKind === 'fire';
    slot.iceGroup.visible = slot.visualKind === 'ice';
    slot.arcaneGroup.visible = slot.visualKind === 'arcane';
    slot.arrowGroup.visible = slot.visualKind === 'arrow';

    const scale = clamp(slot.radius / 0.28, 0.7, 2.25);
    slot.root.scale.setScalar(scale);
    slot.root.position.set(slot.x, slot.visualY, slot.z);
    slot.root.rotation.set(0, Math.atan2(slot.dirX, slot.dirZ), 0);
    slot.root.visible = true;
  }

  private updateSlotTransform(slot: PooledProjectile, dt: number): void {
    slot.root.position.set(slot.x, slot.visualY, slot.z);
    slot.root.rotation.y = Math.atan2(slot.dirX, slot.dirZ);

    if (slot.visualKind === 'arcane') {
      slot.arcaneRingA.rotation.x += dt * 7.5;
      slot.arcaneRingA.rotation.y += dt * 5.2;
      slot.arcaneRingB.rotation.z -= dt * 8.4;
      slot.arcaneRingB.rotation.x -= dt * 4.1;
    } else if (slot.visualKind === 'fire') {
      slot.fireGroup.rotation.z += dt * 10.0;
      const pulse = 1.0 + Math.sin(slot.ageSec * 22.0) * 0.12;
      slot.fireGroup.scale.set(pulse, pulse, 1.0 + Math.cos(slot.ageSec * 18.0) * 0.15);
    } else if (slot.visualKind === 'ice') {
      slot.iceGroup.rotation.z += dt * 5.0;
    } else if (slot.visualKind === 'arrow') {
      slot.arrowGroup.rotation.z += dt * 12.0;
    }
  }

  private deactivateSlot(slot: PooledProjectile): void {
    slot.active = false;
    slot.root.visible = false;
    slot.hitIds.clear();
  }

  private acquireSlot(): PooledProjectile {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) {
        return this.pool[i];
      }
    }

    if (this.pool.length < MAX_POOL_SIZE) {
      const created = this.createPooledSlot();
      this.pool.push(created);
      return created;
    }

    // Recycle oldest active projectile if hard cap reached
    let oldest = this.pool[0];
    for (let i = 1; i < this.pool.length; i++) {
      if (this.pool[i].ageSec > oldest.ageSec) {
        oldest = this.pool[i];
      }
    }
    this.deactivateSlot(oldest);
    return oldest;
  }

  private createSharedGeometries(): SharedProjectileGeometries {
    // Orient directional cones/shafts along local +Z (forward) and wakes along -Z (trail)
    const fireTail = new THREE.ConeGeometry(0.22, 0.82, 8);
    fireTail.rotateX(-Math.PI / 2);
    fireTail.translate(0, 0, -0.36);

    const iceFront = new THREE.ConeGeometry(0.14, 0.64, 4);
    iceFront.rotateX(Math.PI / 2);
    iceFront.translate(0, 0, 0.22);

    const iceRear = new THREE.ConeGeometry(0.14, 0.34, 4);
    iceRear.rotateX(-Math.PI / 2);
    iceRear.translate(0, 0, -0.27);

    const arcaneTail = new THREE.ConeGeometry(0.17, 0.72, 6);
    arcaneTail.rotateX(-Math.PI / 2);
    arcaneTail.translate(0, 0, -0.36);

    const arrowShaft = new THREE.CylinderGeometry(0.028, 0.028, 0.72, 6);
    arrowShaft.rotateX(Math.PI / 2);

    const arrowTip = new THREE.ConeGeometry(0.095, 0.26, 4);
    arrowTip.rotateX(Math.PI / 2);
    arrowTip.translate(0, 0, 0.42);

    const arrowVaneH = new THREE.BoxGeometry(0.22, 0.018, 0.2);
    arrowVaneH.translate(0, 0, -0.28);

    const arrowVaneV = new THREE.BoxGeometry(0.018, 0.22, 0.2);
    arrowVaneV.translate(0, 0, -0.28);

    const arrowWake = new THREE.ConeGeometry(0.1, 0.62, 6);
    arrowWake.rotateX(-Math.PI / 2);
    arrowWake.translate(0, 0, -0.38);

    return {
      fireCore: new THREE.IcosahedronGeometry(0.16, 1),
      fireCorona: new THREE.SphereGeometry(0.27, 10, 8),
      fireTail,
      iceFront,
      iceRear,
      iceRing: new THREE.TorusGeometry(0.21, 0.026, 6, 12),
      arcaneCore: new THREE.OctahedronGeometry(0.17, 0),
      arcaneRing: new THREE.TorusGeometry(0.27, 0.028, 6, 16),
      arcaneTail,
      arrowShaft,
      arrowTip,
      arrowVaneH,
      arrowVaneV,
      arrowWake,
    };
  }

  private createPooledSlot(): PooledProjectile {
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x339af0,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const root = new THREE.Group();
    root.visible = false;

    // 1. Fireball Sub-hierarchy
    const fireGroup = new THREE.Group();
    fireGroup.add(
      new THREE.Mesh(this.geometries.fireCore, coreMat),
      new THREE.Mesh(this.geometries.fireCorona, glowMat),
      new THREE.Mesh(this.geometries.fireTail, glowMat),
    );
    root.add(fireGroup);

    // 2. Ice Lance Sub-hierarchy
    const iceGroup = new THREE.Group();
    iceGroup.add(
      new THREE.Mesh(this.geometries.iceFront, coreMat),
      new THREE.Mesh(this.geometries.iceRear, glowMat),
      new THREE.Mesh(this.geometries.iceRing, glowMat),
    );
    root.add(iceGroup);

    // 3. Arcane / Void / Lightning Orb Sub-hierarchy
    const arcaneGroup = new THREE.Group();
    const arcaneRingA = new THREE.Mesh(this.geometries.arcaneRing, glowMat);
    arcaneRingA.rotation.x = Math.PI / 3;
    const arcaneRingB = new THREE.Mesh(this.geometries.arcaneRing, glowMat);
    arcaneRingB.rotation.y = Math.PI / 3;
    arcaneGroup.add(
      new THREE.Mesh(this.geometries.arcaneCore, coreMat),
      arcaneRingA,
      arcaneRingB,
      new THREE.Mesh(this.geometries.arcaneTail, glowMat),
    );
    root.add(arcaneGroup);

    // 4. Arrow / Venom Bolt Sub-hierarchy
    const arrowGroup = new THREE.Group();
    arrowGroup.add(
      new THREE.Mesh(this.geometries.arrowShaft, coreMat),
      new THREE.Mesh(this.geometries.arrowTip, coreMat),
      new THREE.Mesh(this.geometries.arrowVaneH, glowMat),
      new THREE.Mesh(this.geometries.arrowVaneV, glowMat),
      new THREE.Mesh(this.geometries.arrowWake, glowMat),
    );
    root.add(arrowGroup);

    this.containerGroup.add(root);

    return {
      active: false,
      ownerIsPlayer: true,
      ownerId: '',
      x: 0,
      z: 0,
      visualY: 0.85,
      dirX: 0,
      dirZ: 1,
      speed: 14,
      maxDistance: 18,
      distanceTraveled: 0,
      radius: 0.3,
      piercing: false,
      homing: false,
      aoeExplosionRadius: 0,
      damagePacket: {
        sourceId: '',
        baseAmount: 0,
        damageType: 'physical',
        critChance: 0,
        critMultiplier: 1.5,
      },
      visualColorHex: 0xffffff,
      visualKind: 'arcane',
      ageSec: 0,
      hitIds: new Set<string>(),
      root,
      fireGroup,
      iceGroup,
      arcaneGroup,
      arcaneRingA,
      arcaneRingB,
      arrowGroup,
      coreMat,
      glowMat,
    };
  }

  private emitCastAudio(damageType: DamageType, position: Vec3): void {
    let sfx: SfxId = 'fireball_cast';
    if (damageType === 'lightning') {
      sfx = 'lightning_zap';
    } else if (damageType === 'physical' || damageType === 'poison') {
      sfx = 'sword_swing';
    }
    eventBus.emit('sfx:request', { id: sfx, position });
  }

  private getExplosionFeedback(damageType: DamageType): { vfx: VfxEffectType; sfx: SfxId } {
    switch (damageType) {
      case 'fire':
        return { vfx: 'fire_explosion', sfx: 'explosion' };
      case 'ice':
        return { vfx: 'frost_nova', sfx: 'frost_shatter' };
      case 'lightning':
        return { vfx: 'lightning_strike', sfx: 'lightning_zap' };
      case 'poison':
        return { vfx: 'poison_cloud', sfx: 'explosion' };
      case 'void':
        return { vfx: 'void_implosion', sfx: 'explosion' };
      case 'physical':
      default:
        return { vfx: 'hit_sparks', sfx: 'explosion' };
    }
  }
}
