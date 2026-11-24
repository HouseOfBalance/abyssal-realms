import * as THREE from 'three';
import type {
  DungeonFloorData,
  EnemyEntity,
  ICombatEngine,
  PlayerRuntimeState,
  Vec3,
} from '../../contracts/types';
import { distXZ, SeededRng } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import type { TacticalRole } from './archetypes';
import { findRadialWalkableSpot } from './steering';

interface ElitePerEntityState {
  teleportCooldown: number;
  frozenPulseCooldown: number;
  arcaneCooldown: number;
  moltenTrailCooldown: number;
  vampiricVfxCooldown: number;
  berserkActive: boolean;
  berserkTriggeredOnce: boolean;
}

interface MoltenBombHazard {
  sourceId: string;
  position: Vec3;
  radius: number;
  damage: number;
  elapsed: number;
  fuseSec: number;
  group: THREE.Group;
  coreMat: THREE.MeshBasicMaterial;
  fillMesh: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

interface FrozenPulseHazard {
  sourceId: string;
  position: Vec3;
  radius: number;
  damage: number;
  elapsed: number;
  chargeSec: number;
  group: THREE.Group;
  crystalMesh: THREE.Mesh;
  crystalMat: THREE.MeshBasicMaterial;
  fillMesh: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

interface ArcaneSentryHazard {
  sourceId: string;
  position: Vec3;
  beamLength: number;
  angleY: number;
  angularVel: number;
  damage: number;
  elapsed: number;
  armSec: number;
  durationSec: number;
  hitTickCooldown: number;
  group: THREE.Group;
  orbMesh: THREE.Mesh;
  beamPivot: THREE.Group;
  beamMat: THREE.MeshBasicMaterial;
  coreMat: THREE.MeshBasicMaterial;
}

function pointToSegmentDistXZ(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  if (lenSq <= 1e-6) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / lenSq));
  const cx = ax + t * vx;
  const cz = az + t * vz;
  return Math.hypot(px - cx, pz - cz);
}

export class EliteAffixController {
  private scene: THREE.Scene | null = null;
  private states = new Map<string, ElitePerEntityState>();
  private moltenBombs: MoltenBombHazard[] = [];
  private frozenPulses: FrozenPulseHazard[] = [];
  private arcaneSentries: ArcaneSentryHazard[] = [];
  private rng = new SeededRng(0x51a7e9);

  // Shared procedural geometries (disposed only in dispose())
  private sphereGeo: THREE.SphereGeometry | null = null;
  private crystalGeo: THREE.IcosahedronGeometry | null = null;
  private octaGeo: THREE.OctahedronGeometry | null = null;
  private unitRingGeo: THREE.RingGeometry | null = null;
  private unitDiscGeo: THREE.CircleGeometry | null = null;
  private unitBeamGeo: THREE.CylinderGeometry | null = null;

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
    this.ensureGeometries();
  }

  private ensureGeometries(): void {
    if (this.sphereGeo) return;
    this.sphereGeo = new THREE.SphereGeometry(0.42, 12, 10);
    this.crystalGeo = new THREE.IcosahedronGeometry(0.36, 0);
    this.octaGeo = new THREE.OctahedronGeometry(0.34, 0);
    this.unitRingGeo = new THREE.RingGeometry(0.93, 1.0, 32);
    this.unitRingGeo.rotateX(-Math.PI / 2);
    this.unitDiscGeo = new THREE.CircleGeometry(1.0, 32);
    this.unitDiscGeo.rotateX(-Math.PI / 2);
    // Cylinder extending from z = 0 to z = 1 along +Z
    this.unitBeamGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.0, 8, 1, false);
    this.unitBeamGeo.rotateX(Math.PI / 2);
    this.unitBeamGeo.translate(0, 0, 0.5);
  }

  registerElite(enemy: EnemyEntity, rng: SeededRng): void {
    if (!enemy.isElite || enemy.affixes.length === 0) return;
    this.states.set(enemy.id, {
      teleportCooldown: rng.range(2.2, 4.4),
      frozenPulseCooldown: rng.range(2.4, 4.6),
      arcaneCooldown: rng.range(2.6, 5.0),
      moltenTrailCooldown: rng.range(1.2, 2.2),
      vampiricVfxCooldown: 0,
      berserkActive: false,
      berserkTriggeredOnce: false,
    });
  }

  getBerserkModifiers(enemy: EnemyEntity): {
    moveSpeedMult: number;
    damageMult: number;
    actionSpeedMult: number;
  } {
    if (!enemy.isElite || !enemy.affixes.includes('berserker')) {
      return { moveSpeedMult: 1, damageMult: 1, actionSpeedMult: 1 };
    }
    const st = this.states.get(enemy.id);
    if (!st || !st.berserkActive) {
      return { moveSpeedMult: 1, damageMult: 1, actionSpeedMult: 1 };
    }
    return {
      moveSpeedMult: 1.45,
      damageMult: 1.4,
      actionSpeedMult: 1.35,
    };
  }

  applyVampiricOnHit(enemy: EnemyEntity, finalDamageDealt: number): void {
    if (!enemy.alive || !enemy.isElite || !enemy.affixes.includes('vampiric')) return;
    if (finalDamageDealt <= 0) return;

    const healAmount = Math.max(2, Math.round(finalDamageDealt * 0.45));
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmount);

    const st = this.states.get(enemy.id);
    if (!st || st.vampiricVfxCooldown <= 0) {
      if (st) st.vampiricVfxCooldown = 0.6;
      eventBus.emit('vfx:request', {
        type: 'heal_aura',
        position: { x: enemy.position.x, y: enemy.position.y + 0.5, z: enemy.position.z },
        colorHex: 0xe03131,
        scale: 0.75,
      });
    }
  }

  updateEliteEntity(
    dt: number,
    enemy: EnemyEntity,
    role: TacticalRole,
    aggroed: boolean,
    isDisabled: boolean,
    isMidWindup: boolean,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    livingPositions: readonly Vec3[],
  ): void {
    if (!enemy.alive || !enemy.isElite || enemy.affixes.length === 0) return;

    let st = this.states.get(enemy.id);
    if (!st) {
      this.registerElite(enemy, this.rng);
      st = this.states.get(enemy.id)!;
    }

    st.teleportCooldown = Math.max(0, st.teleportCooldown - dt);
    st.frozenPulseCooldown = Math.max(0, st.frozenPulseCooldown - dt);
    st.arcaneCooldown = Math.max(0, st.arcaneCooldown - dt);
    st.moltenTrailCooldown = Math.max(0, st.moltenTrailCooldown - dt);
    st.vampiricVfxCooldown = Math.max(0, st.vampiricVfxCooldown - dt);

    // 1. Berserker (<50% HP speed/damage frenzy)
    if (enemy.affixes.includes('berserker')) {
      const belowHalf = enemy.hp <= enemy.maxHp * 0.5;
      if (belowHalf && !st.berserkActive) {
        st.berserkActive = true;
        enemy.meshHandle?.flashHit(0xff2222);
        if (!st.berserkTriggeredOnce) {
          st.berserkTriggeredOnce = true;
          eventBus.emit('vfx:request', {
            type: 'fire_explosion',
            position: { x: enemy.position.x, y: enemy.position.y + 0.6, z: enemy.position.z },
            colorHex: 0xdc143c,
            radius: 1.8,
            scale: 0.6,
          });
          eventBus.emit('sfx:request', {
            id: 'boss_roar',
            position: { ...enemy.position },
          });
        }
      } else if (!belowHalf && st.berserkActive) {
        st.berserkActive = false;
      }
    }

    if (!aggroed || !player.alive || isDisabled) return;

    const distToPlayer = distXZ(enemy.position, player.position);

    // 2. Molten ambient magma sparks while chasing
    if (enemy.affixes.includes('molten') && st.moltenTrailCooldown <= 0 && distToPlayer <= 14) {
      st.moltenTrailCooldown = 1.6;
      eventBus.emit('vfx:request', {
        type: 'hit_sparks',
        position: { x: enemy.position.x, y: 0.15, z: enemy.position.z },
        colorHex: 0xff5900,
        scale: 0.6,
      });
    }

    // 3. Teleporter tactical blink
    if (
      enemy.affixes.includes('teleporter') &&
      st.teleportCooldown <= 0 &&
      !isMidWindup
    ) {
      const isRanged = role === 'ranged_kite' || role === 'summoner';
      const wantsEngageBlink = !isRanged && distToPlayer > 6.5 && distToPlayer < 16.5;
      const wantsEscapeBlink = isRanged && distToPlayer < 3.6;

      if (wantsEngageBlink || wantsEscapeBlink) {
        const minR = isRanged ? 6.2 : 2.1;
        const maxR = isRanged ? 8.8 : 3.6;
        const oldPos = { ...enemy.position };
        const dest = findRadialWalkableSpot(
          floor,
          player.position,
          minR,
          maxR,
          enemy.radius,
          livingPositions,
          this.rng,
        );

        if (distXZ(oldPos, dest) > 1.8) {
          st.teleportCooldown = 5.8;
          eventBus.emit('vfx:request', {
            type: 'void_implosion',
            position: { x: oldPos.x, y: 0.8, z: oldPos.z },
            colorHex: 0x9775fa,
            scale: 0.65,
          });
          enemy.position.x = dest.x;
          enemy.position.z = dest.z;
          enemy.rotationY = Math.atan2(
            player.position.x - enemy.position.x,
            player.position.z - enemy.position.z,
          );
          eventBus.emit('vfx:request', {
            type: 'dodge_afterimage',
            position: { x: dest.x, y: 0.8, z: dest.z },
            colorHex: 0xb197fc,
            scale: 0.9,
          });
          eventBus.emit('sfx:request', {
            id: 'dodge_whoosh',
            position: { ...dest },
          });
        }
      }
    }

    // 4. Frozen Pulse orb deployment
    if (
      enemy.affixes.includes('frozen_pulse') &&
      st.frozenPulseCooldown <= 0 &&
      distToPlayer <= 12.5
    ) {
      st.frozenPulseCooldown = 6.5;
      const pulsePos = findRadialWalkableSpot(
        floor,
        player.position,
        0.3,
        1.9,
        0.35,
        [],
        this.rng,
      );
      this.spawnFrozenPulse(enemy, pulsePos);
    }

    // 5. Arcane Enchanted rotating sentry beam + arcane bolt fan
    if (
      enemy.affixes.includes('arcane_enchanted') &&
      st.arcaneCooldown <= 0 &&
      distToPlayer <= 13.0
    ) {
      st.arcaneCooldown = 7.6;
      const midPoint: Vec3 = {
        x: (enemy.position.x + player.position.x) * 0.5,
        y: 0,
        z: (enemy.position.z + player.position.z) * 0.5,
      };
      const sentryPos = findRadialWalkableSpot(
        floor,
        midPoint,
        0.2,
        2.2,
        0.35,
        [],
        this.rng,
      );
      this.spawnArcaneSentry(enemy, sentryPos);
      this.fireArcaneBoltFan(enemy, player, combat);
    }
  }

  onEliteKilled(enemy: EnemyEntity): void {
    this.states.delete(enemy.id);
    if (!enemy.isElite || !enemy.affixes.includes('molten')) return;
    this.spawnMoltenDeathBomb(enemy);
  }

  private spawnMoltenDeathBomb(enemy: EnemyEntity): void {
    this.ensureGeometries();
    const radius = 3.6;
    const fuseSec = 1.25;
    const pos: Vec3 = { x: enemy.position.x, y: 0, z: enemy.position.z };

    const group = new THREE.Group();
    group.position.set(pos.x, 0.04, pos.z);

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff5500,
      transparent: true,
      opacity: 0.92,
    });
    const coreMesh = new THREE.Mesh(this.sphereGeo!, coreMat);
    coreMesh.position.y = 0.55;
    group.add(coreMesh);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3b00,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(this.unitRingGeo!, ringMat);
    ringMesh.scale.set(radius, 1, radius);
    group.add(ringMesh);

    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xff6b35,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(this.unitDiscGeo!, fillMat);
    fillMesh.scale.set(0.1, 1, 0.1);
    group.add(fillMesh);

    this.scene?.add(group);

    this.moltenBombs.push({
      sourceId: enemy.id,
      position: pos,
      radius,
      damage: Math.round(enemy.attackDamage * 1.8),
      elapsed: 0,
      fuseSec,
      group,
      coreMat,
      fillMesh,
      fillMat,
      ringMat,
    });
  }

  private spawnFrozenPulse(enemy: EnemyEntity, pos: Vec3): void {
    this.ensureGeometries();
    const radius = 3.2;
    const chargeSec = 1.35;

    const group = new THREE.Group();
    group.position.set(pos.x, 0.04, pos.z);

    const crystalMat = new THREE.MeshBasicMaterial({
      color: 0x74c0fc,
      transparent: true,
      opacity: 0.9,
    });
    const crystalMesh = new THREE.Mesh(this.crystalGeo!, crystalMat);
    crystalMesh.position.y = 0.7;
    group.add(crystalMesh);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4dabf7,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(this.unitRingGeo!, ringMat);
    ringMesh.scale.set(radius, 1, radius);
    group.add(ringMesh);

    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x3bc9db,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(this.unitDiscGeo!, fillMat);
    fillMesh.scale.set(0.1, 1, 0.1);
    group.add(fillMesh);

    this.scene?.add(group);

    this.frozenPulses.push({
      sourceId: enemy.id,
      position: { x: pos.x, y: 0, z: pos.z },
      radius,
      damage: Math.round(enemy.attackDamage * 0.95),
      elapsed: 0,
      chargeSec,
      group,
      crystalMesh,
      crystalMat,
      fillMesh,
      fillMat,
      ringMat,
    });
  }

  private spawnArcaneSentry(enemy: EnemyEntity, pos: Vec3): void {
    this.ensureGeometries();
    const beamLength = 4.6;
    const initialAngle = this.rng.range(0, Math.PI * 2);
    const dirSign = this.rng.chance(0.5) ? 1 : -1;

    const group = new THREE.Group();
    group.position.set(pos.x, 0.55, pos.z);

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xe599f7,
      transparent: true,
      opacity: 0.95,
    });
    const orbMesh = new THREE.Mesh(this.octaGeo!, coreMat);
    group.add(orbMesh);

    const beamPivot = new THREE.Group();
    beamPivot.rotation.y = initialAngle;

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xda77f2,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    const beamMesh = new THREE.Mesh(this.unitBeamGeo!, beamMat);
    beamMesh.scale.set(0.45, 0.45, beamLength);
    beamPivot.add(beamMesh);
    group.add(beamPivot);

    this.scene?.add(group);
    eventBus.emit('sfx:request', { id: 'portal_hum', position: { ...pos } });

    this.arcaneSentries.push({
      sourceId: enemy.id,
      position: { x: pos.x, y: 0, z: pos.z },
      beamLength,
      angleY: initialAngle,
      angularVel: 1.22 * dirSign,
      damage: Math.max(4, Math.round(enemy.attackDamage * 0.65)),
      elapsed: 0,
      armSec: 0.65,
      durationSec: 5.0,
      hitTickCooldown: 0,
      group,
      orbMesh,
      beamPivot,
      beamMat,
      coreMat,
    });
  }

  private fireArcaneBoltFan(
    enemy: EnemyEntity,
    player: PlayerRuntimeState,
    combat: ICombatEngine,
  ): void {
    const baseAngle = Math.atan2(
      player.position.z - enemy.position.z,
      player.position.x - enemy.position.x,
    );
    const dmg = Math.max(4, Math.round(enemy.attackDamage * 0.6));
    const hasVamp = enemy.affixes.includes('vampiric');

    for (const spread of [-0.32, 0, 0.32]) {
      const a = baseAngle + spread;
      combat.spawnProjectile({
        ownerIsPlayer: false,
        ownerId: enemy.id,
        origin: {
          x: enemy.position.x + Math.cos(a) * (enemy.radius + 0.3),
          y: 0.85,
          z: enemy.position.z + Math.sin(a) * (enemy.radius + 0.3),
        },
        direction: { x: Math.cos(a), y: 0, z: Math.sin(a) },
        speed: 8.2,
        maxDistance: 13.5,
        radius: 0.28,
        piercing: false,
        damagePacket: {
          sourceId: enemy.id,
          baseAmount: dmg,
          damageType: 'void',
          critChance: 0.05,
          critMultiplier: 1.5,
          lifeSteal: hasVamp ? 0.45 : undefined,
        },
        visualColorHex: 0xda77f2,
      });
    }
  }

  updateHazards(dt: number, player: PlayerRuntimeState, combat: ICombatEngine): void {
    // 1. Update Molten Death Bombs
    for (let i = this.moltenBombs.length - 1; i >= 0; i--) {
      const bomb = this.moltenBombs[i];
      bomb.elapsed += dt;
      const t = Math.min(1, bomb.elapsed / bomb.fuseSec);

      const pulse = 1 + Math.sin(bomb.elapsed * 26) * 0.22;
      bomb.fillMesh.scale.set(
        Math.max(0.05, bomb.radius * t),
        1,
        Math.max(0.05, bomb.radius * t),
      );
      bomb.fillMat.opacity = 0.2 + t * 0.38;
      bomb.coreMat.color.setHex(pulse > 1 ? 0xffaa00 : 0xff3b00);

      if (bomb.elapsed >= bomb.fuseSec) {
        eventBus.emit('vfx:request', {
          type: 'fire_explosion',
          position: { x: bomb.position.x, y: 0.3, z: bomb.position.z },
          colorHex: 0xff4500,
          radius: bomb.radius,
          scale: 1.35,
        });
        eventBus.emit('sfx:request', { id: 'explosion', position: { ...bomb.position } });
        eventBus.emit('camera:shake', { trauma: 0.36 });
        eventBus.emit('lighting:flash', {
          colorHex: 0xff5500,
          intensity: 1.8,
          durationSec: 0.2,
        });

        if (player.alive && distXZ(player.position, bomb.position) <= bomb.radius + player.radius) {
          combat.applyDamageToPlayer(player, {
            sourceId: bomb.sourceId,
            targetId: 'player',
            baseAmount: bomb.damage,
            damageType: 'fire',
            critChance: 0,
            critMultiplier: 1.5,
            appliesStatus: {
              type: 'burn',
              chance: 0.9,
              durationSec: 3.5,
              potency: Math.max(2, Math.round(bomb.damage * 0.22)),
            },
          });
        }

        this.disposeMoltenBomb(bomb);
        this.moltenBombs.splice(i, 1);
      }
    }

    // 2. Update Frozen Pulse Orbs
    for (let i = this.frozenPulses.length - 1; i >= 0; i--) {
      const pulse = this.frozenPulses[i];
      pulse.elapsed += dt;
      const t = Math.min(1, pulse.elapsed / pulse.chargeSec);

      pulse.crystalMesh.rotation.y += dt * 4.5;
      pulse.crystalMesh.rotation.x += dt * 2.2;
      pulse.fillMesh.scale.set(
        Math.max(0.05, pulse.radius * t),
        1,
        Math.max(0.05, pulse.radius * t),
      );
      pulse.fillMat.opacity = 0.18 + t * 0.34;

      if (pulse.elapsed >= pulse.chargeSec) {
        eventBus.emit('vfx:request', {
          type: 'frost_nova',
          position: { x: pulse.position.x, y: 0.25, z: pulse.position.z },
          colorHex: 0x4dabf7,
          radius: pulse.radius,
          scale: 1.15,
        });
        eventBus.emit('sfx:request', { id: 'frost_shatter', position: { ...pulse.position } });

        const d = distXZ(player.position, pulse.position);
        if (player.alive && d <= pulse.radius + player.radius) {
          const innerHit = d <= pulse.radius * 0.48;
          combat.applyDamageToPlayer(player, {
            sourceId: pulse.sourceId,
            targetId: 'player',
            baseAmount: pulse.damage,
            damageType: 'ice',
            critChance: 0,
            critMultiplier: 1.5,
            appliesStatus: innerHit
              ? { type: 'freeze', chance: 0.65, durationSec: 1.05, potency: 1 }
              : { type: 'chill', chance: 1.0, durationSec: 2.8, potency: 0.35 },
          });
        }

        this.disposeFrozenPulse(pulse);
        this.frozenPulses.splice(i, 1);
      }
    }

    // 3. Update Arcane Enchanted Rotating Laser Sentries
    for (let i = this.arcaneSentries.length - 1; i >= 0; i--) {
      const sentry = this.arcaneSentries[i];
      sentry.elapsed += dt;
      sentry.hitTickCooldown = Math.max(0, sentry.hitTickCooldown - dt);

      sentry.orbMesh.rotation.y += dt * 3.8;
      sentry.orbMesh.rotation.z += dt * 2.1;

      const armed = sentry.elapsed >= sentry.armSec;
      if (armed) {
        sentry.angleY += sentry.angularVel * dt;
        sentry.beamPivot.rotation.y = sentry.angleY;
        sentry.beamMat.opacity = 0.85;
        sentry.beamPivot.children[0]?.scale.set(1.0, 1.0, sentry.beamLength);

        if (player.alive && sentry.hitTickCooldown <= 0) {
          const endX = sentry.position.x + Math.sin(sentry.angleY) * sentry.beamLength;
          const endZ = sentry.position.z + Math.cos(sentry.angleY) * sentry.beamLength;
          const segDist = pointToSegmentDistXZ(
            player.position.x,
            player.position.z,
            sentry.position.x,
            sentry.position.z,
            endX,
            endZ,
          );

          if (segDist <= player.radius + 0.3) {
            sentry.hitTickCooldown = 0.45;
            combat.applyDamageToPlayer(player, {
              sourceId: sentry.sourceId,
              targetId: 'player',
              baseAmount: sentry.damage,
              damageType: 'void',
              critChance: 0.05,
              critMultiplier: 1.5,
            });
            eventBus.emit('vfx:request', {
              type: 'hit_sparks',
              position: { x: player.position.x, y: 0.8, z: player.position.z },
              colorHex: 0xda77f2,
              scale: 0.7,
            });
            eventBus.emit('sfx:request', {
              id: 'lightning_zap',
              position: { ...player.position },
            });
          }
        }
      } else {
        // Warmup telegraph before beam activates
        const warmupRatio = sentry.elapsed / sentry.armSec;
        sentry.beamMat.opacity = 0.18 + warmupRatio * 0.3;
      }

      if (sentry.elapsed >= sentry.durationSec) {
        this.disposeArcaneSentry(sentry);
        this.arcaneSentries.splice(i, 1);
      }
    }
  }

  private disposeMoltenBomb(bomb: MoltenBombHazard): void {
    bomb.group.parent?.remove(bomb.group);
    bomb.coreMat.dispose();
    bomb.fillMat.dispose();
    bomb.ringMat.dispose();
  }

  private disposeFrozenPulse(pulse: FrozenPulseHazard): void {
    pulse.group.parent?.remove(pulse.group);
    pulse.crystalMat.dispose();
    pulse.fillMat.dispose();
    pulse.ringMat.dispose();
  }

  private disposeArcaneSentry(sentry: ArcaneSentryHazard): void {
    sentry.group.parent?.remove(sentry.group);
    sentry.beamMat.dispose();
    sentry.coreMat.dispose();
  }

  clear(): void {
    this.states.clear();
    for (const bomb of this.moltenBombs) this.disposeMoltenBomb(bomb);
    this.moltenBombs = [];
    for (const pulse of this.frozenPulses) this.disposeFrozenPulse(pulse);
    this.frozenPulses = [];
    for (const sentry of this.arcaneSentries) this.disposeArcaneSentry(sentry);
    this.arcaneSentries = [];
  }

  dispose(): void {
    this.clear();
    this.sphereGeo?.dispose();
    this.crystalGeo?.dispose();
    this.octaGeo?.dispose();
    this.unitRingGeo?.dispose();
    this.unitDiscGeo?.dispose();
    this.unitBeamGeo?.dispose();
    this.sphereGeo = null;
    this.crystalGeo = null;
    this.octaGeo = null;
    this.unitRingGeo = null;
    this.unitDiscGeo = null;
    this.unitBeamGeo = null;
    this.scene = null;
  }
}
