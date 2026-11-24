import * as THREE from 'three';
import type {
  DamageType,
  DungeonFloorData,
  HazardInstance,
  IHazardSystem,
  IMaterialLibrary,
  StatusEffectType,
  Vec3,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  HazardMeshFactory,
  type HazardVisualHandle,
  type ShatterDebrisPiece,
} from './HazardMeshes';
import {
  planFloorHazards,
  type HazardArchetype,
  type PlannedHazardSpec,
} from './HazardPlacer';

interface RuntimeHazardEntry {
  instance: HazardInstance;
  archetype: HazardArchetype;
  visuals: HazardVisualHandle;
  rotationY: number;
  cycleTimer: number;
  playerHitCooldown: number;
}

export class HazardSystem implements IHazardSystem {
  private readonly meshFactory = new HazardMeshFactory();
  private scene: THREE.Scene | null = null;
  private materials: IMaterialLibrary | null = null;
  private rootGroup: THREE.Group | null = null;
  private hazards: RuntimeHazardEntry[] = [];
  private debris: ShatterDebrisPiece[] = [];
  private floorDamageScale = 1.0;
  private shatterCounter = 0;

  populateFloor(
    floor: DungeonFloorData,
    scene: THREE.Scene,
    materials: IMaterialLibrary,
  ): void {
    this.clearCurrentFloor();

    this.scene = scene;
    this.materials = materials;
    const floorNum = Number.isFinite(floor.floorNumber) ? Math.max(1, floor.floorNumber) : 1;
    this.floorDamageScale = 1 + (floorNum - 1) * 0.22;

    const root = new THREE.Group();
    root.name = `floor_${floorNum}_hazards`;
    this.rootGroup = root;
    scene.add(root);

    const plannedSpecs = planFloorHazards(floor);
    for (const spec of plannedSpecs) {
      const instance: HazardInstance = {
        id: spec.id,
        kind: spec.kind,
        position: { x: spec.position.x, y: spec.position.y, z: spec.position.z },
        radius: spec.radius,
        destroyed: false,
      };

      const visuals = this.buildVisualForSpec(spec, materials);
      visuals.root.position.set(spec.position.x, spec.position.y, spec.position.z);
      visuals.root.userData.hazardInstance = instance;
      visuals.root.userData.hazardArchetype = spec.archetype;
      root.add(visuals.root);

      this.hazards.push({
        instance,
        archetype: spec.archetype,
        visuals,
        rotationY: spec.rotationY,
        cycleTimer: Math.max(0, spec.phaseOffset),
        playerHitCooldown: 0,
      });
    }
  }

  private buildVisualForSpec(
    spec: PlannedHazardSpec,
    materials: IMaterialLibrary,
  ): HazardVisualHandle {
    switch (spec.archetype) {
      case 'spike_trap':
        return this.meshFactory.buildSpikeTrap(materials);
      case 'pendulum_blade':
        return this.meshFactory.buildPendulumBlade(materials, spec.rotationY);
      case 'poison_vent':
        return this.meshFactory.buildPoisonVent(materials, spec.radius);
      case 'lava_pool':
        return this.meshFactory.buildLavaPool(materials, spec.radius);
      case 'arcane_turret':
        return this.meshFactory.buildArcaneTurret(materials, spec.element ?? 'lightning');
      case 'frost_gale':
        return this.meshFactory.buildFrostGale(materials, spec.radius);
      case 'astral_laser':
        return this.meshFactory.buildAstralLaser(materials, spec.radius);
      case 'breakable_barrel':
        return this.meshFactory.buildBarrel(materials, spec.rotationY, spec.scaleVar);
      case 'breakable_urn':
        return this.meshFactory.buildUrn(materials, spec.rotationY, spec.scaleVar);
    }
  }

  /**
   * Returns read-only view of active/destructible hazard instances on the current floor.
   */
  getHazards(): readonly HazardInstance[] {
    return this.hazards.map((h) => h.instance);
  }

  /**
   * Returns detailed hazard entries including expansion biome sub-archetypes
   * ('frost_gale' in Cathedral, 'astral_laser' in Observatory).
   */
  getHazardArchetypes(): ReadonlyArray<{
    instance: HazardInstance;
    archetype: HazardArchetype;
  }> {
    return this.hazards.map((h) => ({
      instance: h.instance,
      archetype: h.archetype,
    }));
  }

  damageDestructibleAt(
    position: Vec3,
    radius: number,
    damage: number,
  ): { broken: HazardInstance[] } {
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.z) ||
      !Number.isFinite(damage) ||
      damage <= 0
    ) {
      return { broken: [] };
    }

    const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
    const broken: HazardInstance[] = [];

    for (const entry of this.hazards) {
      const { instance, visuals } = entry;
      if (instance.kind !== 'breakable_barrel' && instance.kind !== 'breakable_urn') {
        continue;
      }
      if (instance.destroyed) {
        continue;
      }

      if (distXZ(position, instance.position) <= safeRadius + instance.radius) {
        instance.destroyed = true;
        broken.push(instance);

        if (visuals.kind === 'breakable_barrel' || visuals.kind === 'breakable_urn') {
          visuals.intactGroup.visible = false;
          visuals.remnantGroup.visible = true;

          if (this.rootGroup && this.materials) {
            const spawned = this.meshFactory.spawnShatterDebris(
              visuals.kind,
              instance.position,
              this.rootGroup,
              this.materials,
              ++this.shatterCounter,
            );
            this.debris.push(...spawned);
          }
        }

        const isBarrel = instance.kind === 'breakable_barrel';
        const vfxPos: Vec3 = {
          x: instance.position.x,
          y: instance.position.y + 0.45,
          z: instance.position.z,
        };

        eventBus.emit('vfx:request', {
          type: 'hit_sparks',
          position: vfxPos,
          colorHex: isBarrel ? 0xd99b52 : 0xe3d5b8,
          scale: isBarrel ? 0.9 : 0.78,
        });
        eventBus.emit('sfx:request', {
          id: 'frost_shatter',
          position: instance.position,
        });
      }
    }

    return { broken };
  }

  update(
    dt: number,
    playerPos: Vec3,
  ): {
    playerDamageEvents: Array<{
      amount: number;
      type: DamageType;
      status?: StatusEffectType;
    }>;
  } {
    const playerDamageEvents: Array<{
      amount: number;
      type: DamageType;
      status?: StatusEffectType;
    }> = [];

    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      !playerPos ||
      !Number.isFinite(playerPos.x) ||
      !Number.isFinite(playerPos.z)
    ) {
      return { playerDamageEvents };
    }

    const safeDt = clamp(dt, 0, 0.1);
    this.updateDebris(safeDt);

    for (const entry of this.hazards) {
      if (entry.instance.destroyed) continue;

      entry.playerHitCooldown = Math.max(0, entry.playerHitCooldown - safeDt);
      const prevTimer = entry.cycleTimer;
      entry.cycleTimer += safeDt;

      const pos = entry.instance.position;
      const distToPlayer = distXZ(playerPos, pos);
      const nearForFeedback = distToPlayer <= 16.0;

      switch (entry.visuals.kind) {
        case 'spike_trap':
          this.updateSpikeTrap(
            entry,
            entry.visuals,
            prevTimer,
            distToPlayer,
            nearForFeedback,
            playerPos,
            playerDamageEvents,
          );
          break;

        case 'pendulum_blade':
          this.updatePendulumBlade(
            entry,
            entry.visuals,
            prevTimer,
            nearForFeedback,
            playerPos,
            playerDamageEvents,
          );
          break;

        case 'poison_vent':
          this.updatePoisonVent(
            entry,
            entry.visuals,
            prevTimer,
            distToPlayer,
            nearForFeedback,
            playerDamageEvents,
          );
          break;

        case 'lava_pool':
          this.updateLavaPool(
            entry,
            entry.visuals,
            safeDt,
            prevTimer,
            distToPlayer,
            nearForFeedback,
            playerDamageEvents,
          );
          break;

        case 'arcane_turret':
          this.updateArcaneTurret(
            entry,
            entry.visuals,
            safeDt,
            prevTimer,
            distToPlayer,
            nearForFeedback,
            playerPos,
            playerDamageEvents,
          );
          break;

        case 'frost_gale':
          this.updateFrostGale(
            entry,
            entry.visuals,
            safeDt,
            prevTimer,
            distToPlayer,
            nearForFeedback,
            playerPos,
            playerDamageEvents,
          );
          break;

        case 'astral_laser':
          this.updateAstralLaser(
            entry,
            entry.visuals,
            safeDt,
            prevTimer,
            nearForFeedback,
            playerPos,
            playerDamageEvents,
          );
          break;

        case 'breakable_barrel':
        case 'breakable_urn':
          break;
      }
    }

    return { playerDamageEvents };
  }

  private updateSpikeTrap(
    entry: RuntimeHazardEntry,
    visuals: Extract<HazardVisualHandle, { kind: 'spike_trap' }>,
    prevTimer: number,
    distToPlayer: number,
    nearForFeedback: boolean,
    playerPos: Vec3,
    outDamage: Array<{ amount: number; type: DamageType; status?: StatusEffectType }>,
  ): void {
    const period = 3.4;
    const prevPhase = prevTimer % period;
    const phase = entry.cycleTimer % period;
    const pos = entry.instance.position;

    if (prevPhase < 1.75 && phase >= 1.75 && nearForFeedback) {
      eventBus.emit('vfx:request', {
        type: 'hit_sparks',
        position: { x: pos.x, y: pos.y + 0.09, z: pos.z },
        colorHex: 0xff922b,
        scale: 0.36,
      });
    }

    if (prevPhase < 2.5 && phase >= 2.5 && nearForFeedback) {
      eventBus.emit('sfx:request', { id: 'sword_swing', position: pos });
      eventBus.emit('vfx:request', {
        type: 'hit_sparks',
        position: { x: pos.x, y: pos.y + 0.35, z: pos.z },
        colorHex: 0xf1e9d2,
        scale: 0.55,
      });
    }

    if (phase < 1.75) {
      visuals.spikeRack.position.y = -0.46;
      visuals.warningMat.opacity = 0.22;
      visuals.warningMat.emissiveIntensity = 0.18;
    } else if (phase < 2.5) {
      const u = (phase - 1.75) / 0.75;
      const glintPulse = 0.5 + 0.5 * Math.sin(u * Math.PI * 7);
      visuals.spikeRack.position.y = -0.15 + glintPulse * 0.045;
      visuals.warningMat.opacity = 0.45 + u * 0.48;
      visuals.warningMat.emissiveIntensity = 0.85 + u * 2.0 + glintPulse * 0.55;
    } else if (phase < 2.95) {
      const thrustProgress = clamp((phase - 2.5) / 0.06, 0, 1);
      visuals.spikeRack.position.y = -0.12 + thrustProgress * 0.68;
      visuals.warningMat.opacity = 0.95;
      visuals.warningMat.emissiveIntensity = 2.4;

      if (distToPlayer <= entry.instance.radius && entry.playerHitCooldown <= 0) {
        entry.playerHitCooldown = 1.35;
        outDamage.push({
          amount: Math.max(1, Math.round(24 * this.floorDamageScale)),
          type: 'physical',
          status: 'bleed',
        });
        eventBus.emit('vfx:request', {
          type: 'blood_burst',
          position: { x: playerPos.x, y: playerPos.y + 0.85, z: playerPos.z },
          scale: 0.85,
        });
      }
    } else {
      const u = clamp((phase - 2.95) / 0.45, 0, 1);
      visuals.spikeRack.position.y = 0.56 * (1 - u) - 0.46 * u;
      visuals.warningMat.opacity = 0.95 - u * 0.73;
      visuals.warningMat.emissiveIntensity = 2.4 * (1 - u) + 0.18 * u;
    }
  }

  private updatePendulumBlade(
    entry: RuntimeHazardEntry,
    visuals: Extract<HazardVisualHandle, { kind: 'pendulum_blade' }>,
    prevTimer: number,
    nearForFeedback: boolean,
    playerPos: Vec3,
    outDamage: Array<{ amount: number; type: DamageType; status?: StatusEffectType }>,
  ): void {
    const omega = 2.05;
    const maxAngle = 0.92;
    const prevAngle = maxAngle * Math.sin(prevTimer * omega);
    const angle = maxAngle * Math.sin(entry.cycleTimer * omega);

    visuals.pivotGroup.rotation.z = angle;

    const centerCloseness = 1 - Math.abs(angle) / maxAngle;
    visuals.warningMat.opacity = 0.35 + centerCloseness * 0.55;
    visuals.warningMat.emissiveIntensity = 0.4 + centerCloseness * 1.75;

    const crossedBottom =
      (prevAngle < 0 && angle >= 0) || (prevAngle > 0 && angle <= 0);
    if (crossedBottom && nearForFeedback) {
      eventBus.emit('sfx:request', { id: 'dodge_whoosh', position: entry.instance.position });
    }

    const localX = visuals.armLength * Math.sin(angle);
    const bladeY = visuals.pivotY - visuals.armLength * Math.cos(angle);
    const cosY = Math.cos(entry.rotationY);
    const sinY = Math.sin(entry.rotationY);
    const bladeWorldX = entry.instance.position.x + localX * cosY;
    const bladeWorldZ = entry.instance.position.z - localX * sinY;

    if (bladeY <= 1.25 && entry.playerHitCooldown <= 0) {
      const distToBlade = Math.hypot(playerPos.x - bladeWorldX, playerPos.z - bladeWorldZ);
      if (distToBlade <= 0.94) {
        entry.playerHitCooldown = 1.15;
        outDamage.push({
          amount: Math.max(1, Math.round(28 * this.floorDamageScale)),
          type: 'physical',
        });
        eventBus.emit('vfx:request', {
          type: 'blood_burst',
          position: { x: playerPos.x, y: playerPos.y + 0.9, z: playerPos.z },
          scale: 0.95,
        });
        eventBus.emit('sfx:request', { id: 'hit_flesh', position: playerPos });
      }
    }
  }

  private updatePoisonVent(
    entry: RuntimeHazardEntry,
    visuals: Extract<HazardVisualHandle, { kind: 'poison_vent' }>,
    prevTimer: number,
    distToPlayer: number,
    nearForFeedback: boolean,
    outDamage: Array<{ amount: number; type: DamageType; status?: StatusEffectType }>,
  ): void {
    const period = 3.8;
    const prevPhase = prevTimer % period;
    const phase = entry.cycleTimer % period;
    const pos = entry.instance.position;

    const bubbleSpeed = phase >= 1.8 ? 2.15 : 1.05;
    for (let i = 0; i < visuals.bubbles.length; i++) {
      const b = visuals.bubbles[i];
      const prog = (entry.cycleTimer * bubbleSpeed + i * 0.23) % 1.0;
      b.position.y = 0.12 + prog * (phase >= 2.55 ? 0.72 : 0.32);
      const s = Math.max(0.05, Math.sin(prog * Math.PI) * (phase >= 1.8 ? 1.25 : 0.85));
      b.scale.setScalar(s);
    }

    if (phase < 1.8) {
      visuals.poolMat.emissiveIntensity = 0.55 + 0.12 * Math.sin(entry.cycleTimer * 3.0);
      visuals.ringMat.opacity = 0.22;
      visuals.domeMesh.visible = false;
      visuals.domeMat.opacity = 0;
    } else if (phase < 2.55) {
      const u = (phase - 1.8) / 0.75;
      const pulse = 0.5 + 0.5 * Math.sin(u * Math.PI * 6);
      visuals.poolMat.emissiveIntensity = 0.8 + u * 1.8;
      visuals.ringMat.opacity = 0.35 + u * 0.55 * (0.6 + 0.4 * pulse);
      visuals.domeMesh.visible = true;
      visuals.domeMesh.scale.set(0.55 + u * 0.35, 0.16 + u * 0.14, 0.55 + u * 0.35);
      visuals.domeMat.opacity = u * 0.18;
    } else {
      if (prevPhase < 2.55 && nearForFeedback) {
        eventBus.emit('vfx:request', {
          type: 'poison_cloud',
          position: pos,
          radius: entry.instance.radius,
          scale: 0.9,
        });
      }

      const u = (phase - 2.55) / 1.25;
      const env = Math.sin(u * Math.PI);
      visuals.poolMat.emissiveIntensity = 1.6 + env * 1.1;
      visuals.ringMat.opacity = 0.78 * (1 - u * 0.6);
      visuals.domeMesh.visible = true;
      const domeR = entry.instance.radius * (0.65 + 0.38 * Math.min(1, u * 2.2));
      visuals.domeMesh.scale.set(domeR, 0.34 + env * 0.55, domeR);
      visuals.domeMat.opacity = 0.38 * env;

      if (distToPlayer <= entry.instance.radius && entry.playerHitCooldown <= 0) {
        entry.playerHitCooldown = 1.05;
        outDamage.push({
          amount: Math.max(1, Math.round(15 * this.floorDamageScale)),
          type: 'poison',
          status: 'poison',
        });
      }
    }
  }

  private updateLavaPool(
    entry: RuntimeHazardEntry,
    visuals: Extract<HazardVisualHandle, { kind: 'lava_pool' }>,
    dt: number,
    prevTimer: number,
    distToPlayer: number,
    nearForFeedback: boolean,
    outDamage: Array<{ amount: number; type: DamageType; status?: StatusEffectType }>,
  ): void {
    const period = 3.4;
    const prevPhase = prevTimer % period;
    const phase = entry.cycleTimer % period;
    const pos = entry.instance.position;

    visuals.coreMesh.rotation.y += dt * (phase >= 1.3 ? 1.45 : 0.5);

    const blisterSpeed = phase >= 2.0 ? 2.25 : 1.0;
    for (let i = 0; i < visuals.blisters.length; i++) {
      const m = visuals.blisters[i];
      const prog = (entry.cycleTimer * blisterSpeed + i * 0.21) % 1.0;
      m.position.y = 0.12 + prog * (phase >= 2.0 ? 0.82 : 0.18);
      const s = Math.max(0.05, Math.sin(prog * Math.PI) * (phase >= 1.3 ? 1.2 : 0.78));
      m.scale.setScalar(s);
    }

    if (phase < 1.3) {
      visuals.magmaMat.emissiveIntensity = 0.65 + 0.1 * Math.sin(entry.cycleTimer * 2.5);
      visuals.ringMat.opacity = 0.24;
    } else if (phase < 2.0) {
      const u = (phase - 1.3) / 0.7;
      visuals.magmaMat.emissiveIntensity = 0.85 + u * 1.85;
      visuals.ringMat.opacity = 0.35 + u * 0.6;
    } else {
      if (prevPhase < 2.0 && nearForFeedback) {
        eventBus.emit('vfx:request', {
          type: 'fire_explosion',
          position: pos,
          radius: entry.instance.radius * 0.75,
          scale: 0.6,
        });
      }

      const u = (phase - 2.0) / 1.4;
      const env = Math.sin(u * Math.PI);
      visuals.magmaMat.emissiveIntensity = 1.8 + env * 1.25;
      visuals.ringMat.opacity = 0.85 * (1 - u * 0.65);

      if (distToPlayer <= entry.instance.radius && entry.playerHitCooldown <= 0) {
        entry.playerHitCooldown = 0.95;
        outDamage.push({
          amount: Math.max(1, Math.round(18 * this.floorDamageScale)),
          type: 'fire',
          status: 'burn',
        });
      }
    }
  }

  private updateArcaneTurret(
    entry: RuntimeHazardEntry,
    visuals: Extract<HazardVisualHandle, { kind: 'arcane_turret' }>,
    dt: number,
    prevTimer: number,
    distToPlayer: number,
    nearForFeedback: boolean,
    playerPos: Vec3,
    outDamage: Array<{ amount: number; type: DamageType; status?: StatusEffectType }>,
  ): void {
    const period = 4.0;
    const prevPhase = prevTimer % period;
    const phase = entry.cycleTimer % period;
    const pos = entry.instance.position;

    const charging = phase >= 2.0 && phase < 2.85;
    const spinSpeed = charging ? 4.6 : 1.25;
    visuals.obeliskGroup.rotation.y += dt * spinSpeed;
    visuals.obeliskGroup.position.y = 1.24 + Math.sin(entry.cycleTimer * 2.4) * 0.08;
    visuals.apexCrystal.rotation.y -= dt * (spinSpeed * 1.7);
    visuals.gyroRing.rotation.z += dt * (spinSpeed * 1.3);

    if (phase < 2.0) {
      visuals.runeMat.emissiveIntensity = 0.85;
      visuals.telegraphRingMat.opacity = 0.2;
      visuals.shockRingMesh.visible = false;
      visuals.apexCrystal.position.y = 1.04;
    } else if (phase < 2.85) {
      const u = (phase - 2.0) / 0.85;
      visuals.runeMat.emissiveIntensity = 1.0 + u * 2.4;
      visuals.telegraphRingMat.opacity = 0.3 + u * 0.65;
      visuals.apexCrystal.position.y = 1.04 + u * 0.16;
      visuals.shockRingMesh.visible = false;
    } else if (phase < 3.85) {
      if (prevPhase < 2.85 && nearForFeedback) {
        eventBus.emit('sfx:request', { id: 'lightning_zap', position: pos });
        eventBus.emit('vfx:request', {
          type: visuals.element === 'lightning' ? 'lightning_strike' : 'void_implosion',
          position: { x: pos.x, y: pos.y + 1.5, z: pos.z },
          scale: 0.6,
        });
      }

      const u = (phase - 2.85) / 1.0;
      const ringRadius = 0.45 + u * (entry.instance.radius - 0.45);
      visuals.shockRingMesh.visible = true;
      visuals.shockRingMesh.scale.set(ringRadius, 1.0, ringRadius);
      visuals.shockRingMat.opacity = (1 - u * 0.82) * 0.92;
      visuals.runeMat.emissiveIntensity = 2.6 * (1 - u * 0.6);
      visuals.telegraphRingMat.opacity = 0.25;
      visuals.apexCrystal.position.y = 1.2 - u * 0.16;

      const hitByObeliskCore = distToPlayer <= 0.82;
      const hitByShockWave = Math.abs(distToPlayer - ringRadius) <= 0.56;
      if ((hitByObeliskCore || hitByShockWave) && entry.playerHitCooldown <= 0) {
        entry.playerHitCooldown = 1.4;
        outDamage.push({
          amount: Math.max(1, Math.round(22 * this.floorDamageScale)),
          type: visuals.element,
        });
        eventBus.emit('vfx:request', {
          type: 'hit_sparks',
          position: { x: playerPos.x, y: playerPos.y + 0.9, z: playerPos.z },
          colorHex: visuals.element === 'lightning' ? 0xffd43b : 0xda77f2,
          scale: 0.85,
        });
      }
    } else {
      visuals.shockRingMesh.visible = false;
      visuals.runeMat.emissiveIntensity = 0.85;
      visuals.telegraphRingMat.opacity = 0.2;
      visuals.apexCrystal.position.y = 1.04;
    }
  }

  /**
   * Cathedral Floor 5 signature hazard:
   * Periodic swirling Blizzard Frost Gale applying 'chill' + crashing Falling Icicle Ring.
   */
  private updateFrostGale(
    entry: RuntimeHazardEntry,
    visuals: Extract<HazardVisualHandle, { kind: 'frost_gale' }>,
    dt: number,
    prevTimer: number,
    distToPlayer: number,
    nearForFeedback: boolean,
    playerPos: Vec3,
    outDamage: Array<{ amount: number; type: DamageType; status?: StatusEffectType }>,
  ): void {
    const period = 3.6;
    const prevPhase = prevTimer % period;
    const phase = entry.cycleTimer % period;
    const pos = entry.instance.position;

    const galeActive = phase >= 1.45 && phase < 3.15;
    visuals.galeVortexGroup.rotation.y += dt * (galeActive ? 6.4 : 2.1);

    for (let i = 0; i < visuals.frostFlakes.length; i++) {
      const f = visuals.frostFlakes[i];
      f.rotation.x += dt * (3.5 + i * 0.4);
      f.rotation.y += dt * 4.8;
    }

    if (phase < 1.45) {
      // Crystallizing sub-zero draft — overhead icicles reform cleanly
      const regrow = phase / 1.45;
      visuals.galeVortexGroup.scale.set(0.55, 0.48, 0.55);
      visuals.galeMat.opacity = 0.14;
      visuals.coreMat.emissiveIntensity = 0.7;
      visuals.icicleTelegraphMat.opacity = 0.18;

      visuals.icicleRingGroup.visible = true;
      visuals.icicleRingGroup.position.set(0, 3.15, 0);
      visuals.icicleRingGroup.scale.setScalar(0.25 + 0.75 * regrow);
      visuals.icicleMat.opacity = 0.78 * regrow;
    } else if (phase < 2.55) {
      // Blizzard Frost Gale swells outward (applying 'chill' gust) while icicles lock-on overhead
      if (prevPhase < 1.45 && nearForFeedback) {
        eventBus.emit('sfx:request', { id: 'dodge_whoosh', position: pos });
      }

      const u = (phase - 1.45) / 1.1;
      const galeXZ = 0.65 + u * (entry.instance.radius * 0.9 - 0.65);
      visuals.galeVortexGroup.scale.set(galeXZ, 0.82 + u * 0.68, galeXZ);
      visuals.galeMat.opacity = 0.34 + 0.28 * Math.sin(u * Math.PI);
      visuals.coreMat.emissiveIntensity = 1.1 + u * 1.4;
      visuals.icicleTelegraphMat.opacity = 0.35 + u * 0.58;

      const tremor = Math.sin(phase * 48) * 0.03 * u;
      visuals.icicleRingGroup.visible = true;
      visuals.icicleRingGroup.position.set(tremor, 3.15, -tremor);
      visuals.icicleRingGroup.scale.setScalar(1.0);
      visuals.icicleMat.opacity = 0.92;

      if (phase >= 1.75 && distToPlayer <= entry.instance.radius && entry.playerHitCooldown <= 0) {
        entry.playerHitCooldown = 1.15;
        outDamage.push({
          amount: Math.max(1, Math.round(16 * this.floorDamageScale)),
          type: 'ice',
          status: 'chill',
        });
        eventBus.emit('vfx:request', {
          type: 'frost_nova',
          position: playerPos,
          radius: 1.2,
          scale: 0.6,
        });
      }
    } else if (phase < 3.15) {
      // Falling Icicle Ring crashes down onto the cathedral floor!
      const dropU = clamp((phase - 2.55) / 0.16, 0, 1);
      const fallQuad = dropU * dropU;
      visuals.icicleRingGroup.visible = true;
      visuals.icicleRingGroup.position.set(0, 3.15 * (1 - fallQuad) + 0.36 * fallQuad, 0);

      if (prevPhase < 2.71 && phase >= 2.71 && nearForFeedback) {
        eventBus.emit('sfx:request', { id: 'frost_shatter', position: pos });
        eventBus.emit('vfx:request', {
          type: 'frost_nova',
          position: pos,
          radius: entry.instance.radius,
          scale: 0.95,
        });
      }

      if (phase >= 2.68 && phase <= 2.95 && entry.playerHitCooldown <= 0) {
        const inIcicleRing = Math.abs(distToPlayer - visuals.icicleRingRadius) <= 0.68;
        if (inIcicleRing) {
          entry.playerHitCooldown = 1.2;
          outDamage.push({
            amount: Math.max(1, Math.round(25 * this.floorDamageScale)),
            type: 'ice',
            status: 'chill',
          });
          eventBus.emit('vfx:request', {
            type: 'frost_nova',
            position: playerPos,
            radius: 1.4,
            scale: 0.78,
          });
        }
      }

      const fadeOut = clamp((phase - 2.82) / 0.33, 0, 1);
      visuals.icicleMat.opacity = 0.92 * (1 - fadeOut);
      visuals.galeMat.opacity = 0.38 * (1 - fadeOut);
      visuals.icicleTelegraphMat.opacity = 0.85 * (1 - fadeOut * 0.78);
    } else {
      // Settle before next draft
      visuals.icicleRingGroup.visible = false;
      visuals.galeMat.opacity = 0.12;
      visuals.icicleTelegraphMat.opacity = 0.16;
      visuals.coreMat.emissiveIntensity = 0.7;
    }
  }

  /**
   * Observatory Floor 6+ signature hazard:
   * Clockwork brass emitter sweeping twin astral laser beams with sight-line telegraph.
   */
  private updateAstralLaser(
    entry: RuntimeHazardEntry,
    visuals: Extract<HazardVisualHandle, { kind: 'astral_laser' }>,
    dt: number,
    prevTimer: number,
    nearForFeedback: boolean,
    playerPos: Vec3,
    outDamage: Array<{ amount: number; type: DamageType; status?: StatusEffectType }>,
  ): void {
    const period = 4.4;
    const prevPhase = prevTimer % period;
    const phase = entry.cycleTimer % period;
    const cycleIndex = Math.floor(entry.cycleTimer / period);
    const baseYaw = entry.rotationY + cycleIndex * Math.PI;
    const pos = entry.instance.position;

    const sweeping = phase >= 1.1 && phase < 3.8;
    visuals.lowerGearGroup.rotation.y -= dt * (sweeping ? 1.85 : 0.65);
    for (const sg of visuals.sideGears) {
      sg.rotation.z += dt * (sweeping ? 4.4 : 1.4);
    }
    visuals.armillaryRing.rotation.z -= dt * 2.1;
    visuals.prismCore.rotation.y += dt * 3.2;

    if (phase < 1.1) {
      // Clockwork lock & thin sight-line telegraph before beam ignition
      const u = phase / 1.1;
      visuals.turretHeadGroup.rotation.y = baseYaw;
      visuals.beamGroup.visible = true;
      visuals.beamGroup.scale.set(1, 0.22 + u * 0.2, 0.22 + u * 0.2);
      visuals.beamCoreMat.opacity = 0.18 + u * 0.36;
      visuals.beamCoreMat.emissiveIntensity = 1.2 + u * 1.4;
      visuals.beamSheathMat.opacity = 0.08 + u * 0.16;
      visuals.dialRingMat.opacity = 0.2 + u * 0.32;
    } else if (phase < 3.8) {
      // Active 180-degree twin astral laser sweep (2.7s)
      if (prevPhase < 1.1 && nearForFeedback) {
        eventBus.emit('sfx:request', { id: 'lightning_zap', position: pos });
        eventBus.emit('vfx:request', {
          type: 'void_implosion',
          position: { x: pos.x, y: pos.y + 0.9, z: pos.z },
          scale: 0.55,
        });
      }

      const u = (phase - 1.1) / 2.7;
      const beamYaw = baseYaw + u * Math.PI;
      visuals.turretHeadGroup.rotation.y = beamYaw;

      const flicker = 0.92 + 0.08 * Math.sin(entry.cycleTimer * 32);
      visuals.beamGroup.visible = true;
      visuals.beamGroup.scale.set(1, flicker, flicker);
      visuals.beamCoreMat.opacity = 0.96;
      visuals.beamCoreMat.emissiveIntensity = 3.2;
      visuals.beamSheathMat.opacity = 0.52 * flicker;
      visuals.dialRingMat.opacity = 0.55;

      if (entry.playerHitCooldown <= 0) {
        // Local +X rotated by +beamYaw around Y maps to world (cos(yaw), 0, -sin(yaw))
        const dirX = Math.cos(beamYaw);
        const dirZ = -Math.sin(beamYaw);
        const dx = playerPos.x - pos.x;
        const dz = playerPos.z - pos.z;
        const along = clamp(dx * dirX + dz * dirZ, -visuals.beamLength, visuals.beamLength);
        const closestX = pos.x + dirX * along;
        const closestZ = pos.z + dirZ * along;
        const perpDist = Math.hypot(playerPos.x - closestX, playerPos.z - closestZ);

        if (perpDist <= 0.52) {
          entry.playerHitCooldown = 1.05;
          outDamage.push({
            amount: Math.max(1, Math.round(24 * this.floorDamageScale)),
            type: 'void',
          });
          eventBus.emit('vfx:request', {
            type: 'hit_sparks',
            position: { x: playerPos.x, y: playerPos.y + 0.9, z: playerPos.z },
            colorHex: 0xda77f2,
            scale: 0.9,
          });
          eventBus.emit('sfx:request', { id: 'lightning_zap', position: playerPos });
        }
      }
    } else {
      // Escapement power-down
      const u = (phase - 3.8) / 0.6;
      visuals.turretHeadGroup.rotation.y = baseYaw + Math.PI;
      const thickness = Math.max(0.05, 1 - u);
      visuals.beamGroup.scale.set(1, thickness, thickness);
      visuals.beamCoreMat.opacity = 0.9 * (1 - u);
      visuals.beamSheathMat.opacity = 0.45 * (1 - u);
      visuals.dialRingMat.opacity = 0.22;
      if (u > 0.85) {
        visuals.beamGroup.visible = false;
      }
    }
  }

  private updateDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const p = this.debris[i];
      p.age += dt;
      if (p.age >= p.lifetime) {
        p.mesh.parent?.remove(p.mesh);
        this.debris.splice(i, 1);
        continue;
      }

      p.vy -= 12.5 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      if (p.mesh.position.y <= 0.04) {
        p.mesh.position.y = 0.04;
        p.vy = Math.abs(p.vy) * 0.32;
        p.vx *= 0.65;
        p.vz *= 0.65;
      }

      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.y += p.ry * dt;
      p.mesh.rotation.z += p.rz * dt;

      const fadeProgress = clamp((p.age - p.lifetime * 0.6) / (p.lifetime * 0.4), 0, 1);
      if (fadeProgress > 0) {
        p.mesh.scale.setScalar(Math.max(0.01, 1 - fadeProgress));
      }
    }
  }

  private clearCurrentFloor(): void {
    if (this.rootGroup && this.scene) {
      this.scene.remove(this.rootGroup);
    }
    this.rootGroup = null;
    this.hazards = [];
    this.debris = [];
    this.meshFactory.dispose();
  }

  dispose(): void {
    this.clearCurrentFloor();
    this.scene = null;
    this.materials = null;
  }
}
