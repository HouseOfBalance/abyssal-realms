import * as THREE from 'three';
import { clamp } from '../../core/Constants';

/**
 * Deterministic 256-entry permutation table for 1D gradient Perlin noise.
 * Zero external assets or runtime allocations.
 */
const PERM = new Uint8Array(512);
(() => {
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    base[i] = i;
  }
  let seed = 0x9e3779b9;
  for (let i = 255; i > 0; i--) {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    const j = seed % (i + 1);
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = base[i & 255];
  }
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad1D(hash: number, x: number): number {
  // Map hash bits to non-zero gradients in [-1, -0.25] U [0.25, 1]
  const mag = 0.25 + ((hash & 7) / 7) * 0.75;
  return (hash & 8) === 0 ? x * mag : -x * mag;
}

/**
 * Smooth 1D gradient Perlin noise in roughly [-1, 1].
 */
export function perlin1D(x: number, seedOffset = 0): number {
  const xs = x + seedOffset * 31.73;
  const xi = Math.floor(xs);
  const xf = xs - xi;
  const idx = xi & 255;
  const u = fade(xf);
  const g0 = grad1D(PERM[idx], xf);
  const g1 = grad1D(PERM[idx + 1], xf - 1);
  return (g0 + u * (g1 - g0)) * 1.45;
}

/**
 * 2-octave 1D fBm Perlin + subtle high-frequency sinusoidal punch for visceral ARPG hit feel.
 */
export function shakeWave(time: number, seedOffset: number): number {
  const low = perlin1D(time, seedOffset);
  const high = perlin1D(time * 2.17 + 13.1, seedOffset + 7);
  const crispSin = Math.sin(time * 4.4 + seedOffset * 1.9);
  return clamp(low * 0.65 + high * 0.25 + crispSin * 0.18, -1, 1);
}

export interface ShakeSample {
  /** Local camera-space translational offset (x = right, y = up, z = forward/back) */
  localOffset: THREE.Vector3;
  /** Rotational Euler perturbation (pitch, yaw, roll in radians) */
  pitchOffset: number;
  yawOffset: number;
  rollOffset: number;
}

const TRAUMA_DECAY_PER_SEC = 1.35;
const MAX_TRANSLATION_RIGHT = 0.62;
const MAX_TRANSLATION_UP = 0.52;
const MAX_TRANSLATION_DEPTH = 0.28;
const MAX_PITCH_RAD = 0.018;
const MAX_YAW_RAD = 0.018;
const MAX_ROLL_RAD = 0.034;

export class CameraShakeController {
  private trauma = 0;
  private noiseTime = 0;
  private pulseCounter = 0;
  private dirBiasX = 1;
  private dirBiasY = 1;
  private readonly sampleOut: ShakeSample = {
    localOffset: new THREE.Vector3(),
    pitchOffset: 0,
    yawOffset: 0,
    rollOffset: 0,
  };

  addTrauma(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.trauma = clamp(this.trauma + amount, 0, 1);
    this.pulseCounter += 1;
    // Deterministic directional punch alternation so sequential crits kick dynamically
    const angle = this.pulseCounter * 2.399963229728653; // golden angle
    this.dirBiasX = 0.7 + 0.3 * Math.cos(angle);
    this.dirBiasY = 0.7 + 0.3 * Math.sin(angle);
  }

  getTrauma(): number {
    return this.trauma;
  }

  reset(): void {
    this.trauma = 0;
    this.sampleOut.localOffset.set(0, 0, 0);
    this.sampleOut.pitchOffset = 0;
    this.sampleOut.yawOffset = 0;
    this.sampleOut.rollOffset = 0;
  }

  update(dt: number): ShakeSample {
    if (!Number.isFinite(dt) || dt < 0) {
      return this.sampleOut;
    }

    if (this.trauma <= 1e-5) {
      this.trauma = 0;
      this.sampleOut.localOffset.set(0, 0, 0);
      this.sampleOut.pitchOffset = 0;
      this.sampleOut.yawOffset = 0;
      this.sampleOut.rollOffset = 0;
      return this.sampleOut;
    }

    const nextTrauma = Math.max(0, this.trauma - TRAUMA_DECAY_PER_SEC * dt);
    // Midpoint integration of linear trauma decay makes noiseTime 100% frame-rate
    // invariant across 60Hz, 120Hz, and 144Hz refresh rates.
    const midTrauma = 0.5 * (this.trauma + nextTrauma);
    const freq = 15.0 + midTrauma * 9.0;
    this.noiseTime += dt * freq;

    // Quadratic trauma curve (Squirrel Eiserloh trauma^2 model)
    const intensity = nextTrauma * nextTrauma;

    const nx = shakeWave(this.noiseTime, 1) * this.dirBiasX;
    const ny = shakeWave(this.noiseTime, 2) * this.dirBiasY;
    const nz = shakeWave(this.noiseTime, 3);
    const nPitch = shakeWave(this.noiseTime, 4);
    const nYaw = shakeWave(this.noiseTime, 5);
    const nRoll = shakeWave(this.noiseTime, 6);

    this.sampleOut.localOffset.set(
      nx * MAX_TRANSLATION_RIGHT * intensity,
      ny * MAX_TRANSLATION_UP * intensity,
      nz * MAX_TRANSLATION_DEPTH * intensity,
    );
    this.sampleOut.pitchOffset = nPitch * MAX_PITCH_RAD * intensity;
    this.sampleOut.yawOffset = nYaw * MAX_YAW_RAD * intensity;
    this.sampleOut.rollOffset = nRoll * MAX_ROLL_RAD * intensity;

    this.trauma = nextTrauma;

    return this.sampleOut;
  }
}
