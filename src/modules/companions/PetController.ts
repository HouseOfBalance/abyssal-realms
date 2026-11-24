import * as THREE from 'three';
import type {
  DerivedStats,
  DungeonFloorData,
  GroundLootDrop,
  ILootSystem,
  PetId,
  PlayerRuntimeState,
  Vec3,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  ALL_PET_IDS,
  COMPANION_LEASH_TELEPORT_DIST,
  PET_AUTO_PICKUP_RADIUS,
  PET_DEFINITIONS,
  PET_PICKUP_REACH_DIST,
} from './companionData';
import type { CompanionResourcePool } from './CompanionResourcePool';
import { type PetMotionMode, PetRigBuilder, type PetRigHandle } from './PetRigBuilder';

function isPetScoopableDrop(drop: GroundLootDrop): boolean {
  if (!drop || drop.pickedUp) return false;
  return (
    drop.kind === 'gold' ||
    drop.kind === 'potion' ||
    drop.kind === 'health_orb' ||
    drop.kind === 'rune'
  );
}

function lerpAngle(current: number, target: number, factor: number): number {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * clamp(factor, 0, 1);
}

export class PetController {
  public readonly container = new THREE.Group();

  private readonly rigBuilder: PetRigBuilder;
  private readonly rigs = new Map<PetId, PetRigHandle>();

  private activePet: PetId = 'celestial_owl';
  private position: Vec3 = { x: 0, y: 1.5, z: 0 };
  private rotationY = 0;
  private orbitAngle = -0.85;
  private targetDropId: string | null = null;
  private scoopPulseSec = 0;
  private initializedPosition = false;

  constructor(resources: CompanionResourcePool) {
    this.container.name = 'CompanionPetsContainer';
    this.rigBuilder = new PetRigBuilder(resources);
  }

  public rebuildRigs(): void {
    this.container.clear();
    this.rigs.clear();

    for (const id of ALL_PET_IDS) {
      const rig = this.rigBuilder.buildPetRig(id);
      rig.root.visible = id === this.activePet;
      this.container.add(rig.root);
      this.rigs.set(id, rig);
    }

    this.syncActiveRigTransform();
  }

  public getActivePet(): PetId {
    return this.activePet;
  }

  public getPosition(): Vec3 {
    return { ...this.position };
  }

  public setActivePet(petId: PetId): void {
    if (!ALL_PET_IDS.includes(petId)) return;
    this.activePet = petId;
    this.targetDropId = null;

    for (const [id, rig] of this.rigs.entries()) {
      rig.root.visible = id === petId;
    }

    const def = PET_DEFINITIONS[this.activePet];
    this.position.y = def.hoverHeight;
    this.syncActiveRigTransform();
  }

  public respawnNear(heroPos: Vec3): void {
    const def = PET_DEFINITIONS[this.activePet];
    this.orbitAngle = -0.85;
    this.position.x = heroPos.x + Math.cos(this.orbitAngle) * def.orbitRadius;
    this.position.y = heroPos.y + def.hoverHeight;
    this.position.z = heroPos.z + Math.sin(this.orbitAngle) * def.orbitRadius;
    this.targetDropId = null;
    this.scoopPulseSec = 0;
    this.initializedPosition = true;
    this.syncActiveRigTransform();
  }

  public computeAuraBonuses(): Partial<DerivedStats> {
    return { ...PET_DEFINITIONS[this.activePet].auraBonuses };
  }

  public update(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    loot: ILootSystem,
  ): void {
    if (!Number.isFinite(dt) || dt < 0) return;

    const def = PET_DEFINITIONS[this.activePet];
    const heroPos = player.position;

    if (!this.initializedPosition) {
      this.respawnNear(heroPos);
    }

    // Teleport-leash pet if hero warped or dashed >18m away
    if (distXZ(this.position, heroPos) > COMPANION_LEASH_TELEPORT_DIST) {
      this.respawnNear(heroPos);
    }

    if (this.scoopPulseSec > 0) {
      this.scoopPulseSec = Math.max(0, this.scoopPulseSec - dt);
    }

    // Sub-step dash movement if dt is large so multi-drop sweeps up to 11m never overshoot
    let remainingDt = dt;
    let mode: PetMotionMode = 'orbit';
    let speedNorm = 0;
    let guardIterations = 0;

    while (remainingDt > 1e-5 && guardIterations < 6) {
      guardIterations++;
      const targetDrop = this.selectScoopTarget(heroPos, loot);

      if (targetDrop) {
        this.targetDropId = targetDrop.id;
        mode = 'dash';
        speedNorm = 1.0;

        const dx = targetDrop.position.x - this.position.x;
        const dz = targetDrop.position.z - this.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist <= PET_PICKUP_REACH_DIST) {
          this.executeScoop(targetDrop, player, loot);
          continue;
        }

        const stepDist = def.dashSpeed * remainingDt;
        const travel = Math.min(dist, stepDist);
        const nx = dx / dist;
        const nz = dz / dist;

        this.position.x += nx * travel;
        this.position.z += nz * travel;
        this.rotationY = lerpAngle(this.rotationY, Math.atan2(nx, nz), clamp(remainingDt * 18, 0, 1));

        // Swoop down toward ground drop when flying, or stay grounded for kitsune
        const swoopFactor = clamp(1 - (dist - travel) / 3.5, 0, 1);
        const targetY =
          def.hoverHeight > 0
            ? heroPos.y + def.hoverHeight * (1 - swoopFactor * 0.68)
            : heroPos.y;
        this.position.y += (targetY - this.position.y) * clamp(remainingDt * 14, 0, 1);

        const timeUsed = travel / def.dashSpeed;
        remainingDt = Math.max(0, remainingDt - timeUsed);

        if (dist - travel <= PET_PICKUP_REACH_DIST + 1e-4) {
          this.executeScoop(targetDrop, player, loot);
        } else {
          break;
        }
      } else {
        this.targetDropId = null;
        this.updateOrbitOrTrot(remainingDt, elapsedSec, player, floor);
        const heroSpeed = Math.hypot(player.velocity.x, player.velocity.z);
        const distToHero = distXZ(this.position, heroPos);
        if (distToHero > def.orbitRadius + 1.2) {
          mode = 'return';
          speedNorm = 0.85;
        } else if (def.hoverHeight === 0) {
          mode = heroSpeed > 0.35 ? 'orbit' : 'idle';
          speedNorm = clamp(heroSpeed / Math.max(1, player.stats.moveSpeed || 6.5), 0, 1);
        } else {
          mode = 'orbit';
          speedNorm = clamp(0.3 + heroSpeed / 10, 0.25, 1);
        }
        break;
      }
    }

    const activeRig = this.rigs.get(this.activePet);
    if (activeRig) {
      this.syncActiveRigTransform();
      const scoopPulse01 = clamp(this.scoopPulseSec / 0.28, 0, 1);
      activeRig.updateAnimation(dt, elapsedSec, speedNorm, mode, scoopPulse01);
    }
  }

  private selectScoopTarget(heroPos: Vec3, loot: ILootSystem): GroundLootDrop | null {
    const drops = loot.getGroundDrops();
    if (!drops || drops.length === 0) return null;

    // Keep current target if still valid and within hero's 11m pet leash
    if (this.targetDropId) {
      const current = drops.find(
        (d) =>
          d.id === this.targetDropId &&
          isPetScoopableDrop(d) &&
          distXZ(d.position, heroPos) <= PET_AUTO_PICKUP_RADIUS + 1e-4,
      );
      if (current) return current;
    }

    let best: GroundLootDrop | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!isPetScoopableDrop(d)) continue;
      const distFromHero = distXZ(d.position, heroPos);
      if (distFromHero > PET_AUTO_PICKUP_RADIUS + 1e-4) continue;

      // Prioritize runes & health orbs slightly, then nearest to pet
      const priorityBias = d.kind === 'rune' ? -1.5 : d.kind === 'health_orb' ? -0.6 : 0;
      const score = distXZ(d.position, this.position) + priorityBias;
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }

    return best;
  }

  private executeScoop(
    drop: GroundLootDrop,
    player: PlayerRuntimeState,
    loot: ILootSystem,
  ): void {
    const dropPos: Vec3 = {
      x: drop.position.x,
      y: drop.position.y,
      z: drop.position.z,
    };
    const res = loot.pickupDrop(drop.id, player);
    this.targetDropId = null;

    if (res.picked) {
      this.scoopPulseSec = 0.28;
      const def = PET_DEFINITIONS[this.activePet];
      eventBus.emit('vfx:request', {
        type: 'loot_pickup',
        position: { x: dropPos.x, y: dropPos.y + 0.35, z: dropPos.z },
        colorHex: def.accentColorHex,
        scale: 0.65,
      });
    }
  }

  private updateOrbitOrTrot(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
  ): void {
    const def = PET_DEFINITIONS[this.activePet];
    const heroPos = player.position;
    const heroSpeed = Math.hypot(player.velocity.x, player.velocity.z);

    let desiredX: number;
    let desiredZ: number;

    if (def.hoverHeight === 0) {
      // Grounded Void Kitsune: trots faithfully along hero's right-rear flank, softly circling when idle
      if (heroSpeed > 0.35) {
        const heroHeading = Math.atan2(player.facingDir.x, player.facingDir.z);
        const flankAngle = heroHeading - 2.1;
        desiredX = heroPos.x + Math.sin(flankAngle) * def.orbitRadius;
        desiredZ = heroPos.z + Math.cos(flankAngle) * def.orbitRadius;
      } else {
        this.orbitAngle += dt * 0.45;
        desiredX = heroPos.x + Math.cos(this.orbitAngle) * def.orbitRadius;
        desiredZ = heroPos.z + Math.sin(this.orbitAngle) * def.orbitRadius;
      }

      if (floor && typeof floor.isWalkableWorld === 'function') {
        if (!floor.isWalkableWorld(desiredX, desiredZ, 0.25)) {
          desiredX = heroPos.x;
          desiredZ = heroPos.z;
        }
      }
    } else {
      // Flying Owl & Wyrmling: graceful continuous astral/draconic orbit around hero
      this.orbitAngle += dt * def.orbitSpeedRad;
      desiredX = heroPos.x + Math.cos(this.orbitAngle) * def.orbitRadius;
      desiredZ = heroPos.z + Math.sin(this.orbitAngle) * def.orbitRadius;
    }

    const dx = desiredX - this.position.x;
    const dz = desiredZ - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 1e-4) {
      const followSpeed = dist > 2.2 ? def.returnSpeed : Math.max(def.returnSpeed * 0.65, heroSpeed * 1.25 + 3.2);
      const step = Math.min(dist, followSpeed * dt);
      const nx = dx / dist;
      const nz = dz / dist;
      this.position.x += nx * step;
      this.position.z += nz * step;

      if (dist > 0.08) {
        this.rotationY = lerpAngle(this.rotationY, Math.atan2(nx, nz), clamp(dt * 12, 0, 1));
      } else if (heroSpeed > 0.35) {
        const heroHeading = Math.atan2(player.facingDir.x, player.facingDir.z);
        this.rotationY = lerpAngle(this.rotationY, heroHeading, clamp(dt * 10, 0, 1));
      }
    }

    const bob = def.hoverHeight > 0 ? Math.sin(elapsedSec * 2.7) * 0.08 : 0;
    const desiredY = heroPos.y + def.hoverHeight + bob;
    this.position.y += (desiredY - this.position.y) * clamp(dt * 10, 0, 1);
  }

  private syncActiveRigTransform(): void {
    const rig = this.rigs.get(this.activePet);
    if (!rig) return;
    rig.root.position.set(this.position.x, this.position.y, this.position.z);
    rig.root.rotation.y = this.rotationY;
  }
}
