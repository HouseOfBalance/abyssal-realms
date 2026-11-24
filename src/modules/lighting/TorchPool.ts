import * as THREE from 'three';
import type { Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';
import type { BiomeLightingProfile } from './biomeProfiles';

export const MAX_POOLED_TORCHES = 8;

const TORCH_FADE_START_DIST = 30;
const TORCH_MAX_ACTIVE_DIST = 46;
const PARKED_Y = -500;

interface TorchDescriptor {
  x: number;
  y: number;
  z: number;
  phaseSeed: number;
}

interface TorchSlot {
  light: THREE.PointLight;
  assignedTorchIndex: number;
  fadeWeight: number;
}

/**
 * Manages a fixed-size pool of PointLights for dungeon wall torches.
 * Keeping all pooled PointLights permanently visible in the scene (with unused
 * slots parked at intensity = 0) prevents Three.js from recompiling PBR shaders
 * as the player moves between rooms with varying torch counts.
 */
export class TorchPool {
  private readonly slots: TorchSlot[] = [];
  private torches: TorchDescriptor[] = [];
  private candidateIndices: number[] = [];
  private candidateDistSq: number[] = [];
  private selectedIndices: number[] = new Array<number>(MAX_POOLED_TORCHES).fill(-1);

  private warmColor = new THREE.Color(0xff7b29);
  private hotColor = new THREE.Color(0xffbe6b);
  private scratchColor = new THREE.Color();

  private baseIntensity = 6.4;
  private torchDistance = 14.5;
  private torchDecay = 1.45;
  private snapNextUpdate = true;

  constructor(parentGroup: THREE.Group) {
    for (let i = 0; i < MAX_POOLED_TORCHES; i++) {
      const light = new THREE.PointLight(0xff8c3b, 0, this.torchDistance, this.torchDecay);
      light.name = `TorchPointLight_${i}`;
      light.castShadow = false;
      light.visible = true;
      light.position.set(0, PARKED_Y, 0);
      parentGroup.add(light);

      this.slots.push({
        light,
        assignedTorchIndex: -1,
        fadeWeight: 0,
      });
    }
  }

  configureBiome(profile: BiomeLightingProfile, torchPositions: Vec3[]): void {
    this.warmColor.setHex(profile.torchWarmHex);
    this.hotColor.setHex(profile.torchHotHex);
    this.baseIntensity = profile.torchBaseIntensity;
    this.torchDistance = profile.torchDistance;
    this.torchDecay = profile.torchDecay;

    this.torches = [];
    for (let i = 0; i < torchPositions.length; i++) {
      const p = torchPositions[i];
      if (
        !p ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.z)
      ) {
        continue;
      }
      // Ensure torch light sits at sconce flame height so floor & walls receive crisp N.L falloff
      const effectiveY = p.y < 1.0 ? p.y + 2.25 : p.y + 0.15;
      const rawHash = Math.sin(p.x * 12.9898 + p.z * 78.233 + i * 3.17) * 43758.5453;
      const phaseSeed = (rawHash - Math.floor(rawHash)) * Math.PI * 20;

      this.torches.push({
        x: p.x,
        y: effectiveY,
        z: p.z,
        phaseSeed,
      });
    }

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.assignedTorchIndex = -1;
      slot.fadeWeight = 0;
      slot.light.intensity = 0;
      slot.light.distance = this.torchDistance;
      slot.light.decay = this.torchDecay;
      slot.light.position.set(0, PARKED_Y, 0);
    }

    this.snapNextUpdate = true;
  }

  update(dt: number, elapsedSec: number, playerPos: Vec3): void {
    const torchCount = this.torches.length;
    if (torchCount === 0) {
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i];
        slot.assignedTorchIndex = -1;
        slot.fadeWeight = 0;
        slot.light.intensity = 0;
      }
      return;
    }

    const maxDistSq = TORCH_MAX_ACTIVE_DIST * TORCH_MAX_ACTIVE_DIST;

    // Select up to MAX_POOLED_TORCHES closest torches to playerPos in O(N * K) with zero allocations
    let selectedCount = 0;
    for (let k = 0; k < MAX_POOLED_TORCHES; k++) {
      this.selectedIndices[k] = -1;
      this.candidateDistSq[k] = Infinity;
    }

    for (let i = 0; i < torchCount; i++) {
      const t = this.torches[i];
      const dx = t.x - playerPos.x;
      const dz = t.z - playerPos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > maxDistSq) continue;

      if (selectedCount < MAX_POOLED_TORCHES) {
        let insertAt = selectedCount;
        while (insertAt > 0 && dSq < this.candidateDistSq[insertAt - 1]) {
          this.candidateDistSq[insertAt] = this.candidateDistSq[insertAt - 1];
          this.selectedIndices[insertAt] = this.selectedIndices[insertAt - 1];
          insertAt--;
        }
        this.candidateDistSq[insertAt] = dSq;
        this.selectedIndices[insertAt] = i;
        selectedCount++;
      } else if (dSq < this.candidateDistSq[MAX_POOLED_TORCHES - 1]) {
        let insertAt = MAX_POOLED_TORCHES - 1;
        while (insertAt > 0 && dSq < this.candidateDistSq[insertAt - 1]) {
          this.candidateDistSq[insertAt] = this.candidateDistSq[insertAt - 1];
          this.selectedIndices[insertAt] = this.selectedIndices[insertAt - 1];
          insertAt--;
        }
        this.candidateDistSq[insertAt] = dSq;
        this.selectedIndices[insertAt] = i;
      }
    }

    // Fallback: if all torches are farther than TORCH_MAX_ACTIVE_DIST (e.g. before playerPos syncs),
    // still bind the absolute closest torches so scenes are never left without active pool slots.
    if (selectedCount === 0) {
      for (let i = 0; i < torchCount; i++) {
        const t = this.torches[i];
        const dx = t.x - playerPos.x;
        const dz = t.z - playerPos.z;
        const dSq = dx * dx + dz * dz;

        const limit = Math.min(MAX_POOLED_TORCHES, torchCount);
        if (selectedCount < limit) {
          let insertAt = selectedCount;
          while (insertAt > 0 && dSq < this.candidateDistSq[insertAt - 1]) {
            this.candidateDistSq[insertAt] = this.candidateDistSq[insertAt - 1];
            this.selectedIndices[insertAt] = this.selectedIndices[insertAt - 1];
            insertAt--;
          }
          this.candidateDistSq[insertAt] = dSq;
          this.selectedIndices[insertAt] = i;
          selectedCount++;
        } else if (dSq < this.candidateDistSq[limit - 1]) {
          let insertAt = limit - 1;
          while (insertAt > 0 && dSq < this.candidateDistSq[insertAt - 1]) {
            this.candidateDistSq[insertAt] = this.candidateDistSq[insertAt - 1];
            this.selectedIndices[insertAt] = this.selectedIndices[insertAt - 1];
            insertAt--;
          }
          this.candidateDistSq[insertAt] = dSq;
          this.selectedIndices[insertAt] = i;
        }
      }
    }

    // Keep existing slot assignments stable when still in selectedIndices
    this.candidateIndices.length = 0;
    for (let k = 0; k < selectedCount; k++) {
      const torchIdx = this.selectedIndices[k];
      let alreadyAssigned = false;
      for (let s = 0; s < this.slots.length; s++) {
        if (this.slots[s].assignedTorchIndex === torchIdx) {
          alreadyAssigned = true;
          break;
        }
      }
      if (!alreadyAssigned) {
        this.candidateIndices.push(torchIdx);
      }
    }

    let unassignedQueueCursor = 0;
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      let keepCurrent = false;
      if (slot.assignedTorchIndex !== -1) {
        for (let k = 0; k < selectedCount; k++) {
          if (this.selectedIndices[k] === slot.assignedTorchIndex) {
            keepCurrent = true;
            break;
          }
        }
      }

      if (!keepCurrent) {
        if (unassignedQueueCursor < this.candidateIndices.length) {
          slot.assignedTorchIndex = this.candidateIndices[unassignedQueueCursor++];
          slot.fadeWeight = this.snapNextUpdate ? 1 : 0.15;
        } else {
          slot.assignedTorchIndex = -1;
          slot.fadeWeight = 0;
          slot.light.intensity = 0;
          slot.light.position.set(0, PARKED_Y, 0);
          continue;
        }
      }

      const torch = this.torches[slot.assignedTorchIndex];
      if (this.snapNextUpdate) {
        slot.fadeWeight = 1;
      } else {
        slot.fadeWeight = Math.min(1, slot.fadeWeight + dt * 4.5);
      }

      const dist = Math.hypot(torch.x - playerPos.x, torch.z - playerPos.z);
      let distAttenuation = 1;
      if (dist > TORCH_FADE_START_DIST) {
        const tNorm = clamp(
          (dist - TORCH_FADE_START_DIST) / (TORCH_MAX_ACTIVE_DIST - TORCH_FADE_START_DIST),
          0,
          1,
        );
        // Smoothstep distance fade-out near cull boundary (kept >= 0.12 on initial fallback)
        const smooth = 1 - tNorm * tNorm * (3 - 2 * tNorm);
        distAttenuation = dist > TORCH_MAX_ACTIVE_DIST ? 0.25 : smooth;
      }

      // Multi-harmonic organic flame turbulence
      const phase = torch.phaseSeed;
      const slowBreath = Math.sin(elapsedSec * 2.35 + phase) * 0.11;
      const midTongue = Math.sin(elapsedSec * 6.8 + phase * 1.93) * 0.09;
      const fastCrackle =
        Math.sin(elapsedSec * 14.9 + phase * 3.71) *
        Math.cos(elapsedSec * 9.4 + phase * 1.17) *
        0.07;
      const gustPulse = Math.pow(Math.sin(elapsedSec * 1.3 + phase * 2.6), 3) * 0.06;

      const flickerDelta = slowBreath + midTongue + fastCrackle + gustPulse;
      const flickerMultiplier = clamp(1 + flickerDelta, 0.72, 1.3);

      // Warmer/brighter gold on upward surges, deeper orange-red ember on dips
      const tempBlend = clamp(0.48 + flickerDelta * 1.85, 0, 1);
      this.scratchColor.copy(this.warmColor).lerp(this.hotColor, tempBlend);
      slot.light.color.copy(this.scratchColor);

      // Subtle flame dance offset so wall normal highlights shimmer alive
      const swayX = Math.sin(elapsedSec * 7.3 + phase) * 0.035;
      const swayY = Math.sin(elapsedSec * 10.7 + phase * 1.5) * 0.04;
      const swayZ = Math.cos(elapsedSec * 6.9 + phase * 2.1) * 0.035;

      slot.light.position.set(torch.x + swayX, torch.y + swayY, torch.z + swayZ);
      slot.light.intensity =
        this.baseIntensity * flickerMultiplier * distAttenuation * slot.fadeWeight;
    }

    this.snapNextUpdate = false;
  }

  getActiveLightsCount(): number {
    let count = 0;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].light.intensity > 0.001) {
        count++;
      }
    }
    return count;
  }

  getPooledLights(): readonly THREE.PointLight[] {
    return this.slots.map((s) => s.light);
  }

  dispose(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const light = this.slots[i].light;
      light.intensity = 0;
      light.dispose();
    }
    this.torches = [];
  }
}
