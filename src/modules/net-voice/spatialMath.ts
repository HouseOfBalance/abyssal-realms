import type { Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';

/** Full volume inside melee / close party range (meters). */
export const SPATIAL_REF_DISTANCE = 3.5;
/** Maximum proximity falloff distance (meters) before faint radio floor. */
export const SPATIAL_MAX_DISTANCE = 45.0;
/** Subtle distant radio floor so teammates across rooms remain faintly audible. */
export const SPATIAL_MIN_DISTANCE_GAIN = 0.02;
/** Distance over which stereo separation widens from center (prevents hard-panning when overlapping). */
export const SPATIAL_NEAR_FIELD_RADIUS = 3.0;
/** Maximum stereo pan magnitude to preserve comfortable headphone crossfeed. */
export const SPATIAL_MAX_STEREO_PAN = 0.88;

/** Noise gate floor for time-domain RMS voice activity detection. */
export const VAD_RMS_NOISE_FLOOR = 0.008;
/** Gain multiplier mapping normal speech RMS (~0.02..0.24) to 0..1 UI meter range. */
export const VAD_RMS_GAIN_SCALE = 4.25;
/** Hysteresis threshold to enter speaking state. */
export const VAD_SPEAK_ON_THRESHOLD = 0.045;
/** Hysteresis threshold to exit speaking state once hold expires. */
export const VAD_SPEAK_OFF_THRESHOLD = 0.025;
/** Hold duration in seconds so speaking indicator does not flicker between syllables. */
export const VAD_SPEAK_HOLD_SEC = 0.18;

export interface SpatialAudioParams {
  pan: number;
  distanceGain: number;
}

export interface VadStepResult {
  voiceLevel: number;
  isSpeaking: boolean;
  holdSec: number;
}

function finiteOr(val: number, fallback: number): number {
  return Number.isFinite(val) ? val : fallback;
}

/**
 * Computes stereo pan (-1..+1) and soft proximity distance gain (0..1)
 * in Three.js right-handed Y-up world coordinates (`CameraRig` / `PerspectiveCamera` yaw convention).
 *
 * When `spatialEnabled` is false (or `peerPos` is omitted), returns full centered radio audio
 * (`pan: 0`, `distanceGain: 1`).
 */
export function computeSpatialAudioParams(
  listenerPos: Vec3,
  listenerYaw: number,
  peerPos: Vec3 | undefined,
  spatialEnabled: boolean,
): SpatialAudioParams {
  if (!spatialEnabled || !peerPos) {
    return { pan: 0, distanceGain: 1 };
  }

  const lx = finiteOr(listenerPos.x, 0);
  const ly = finiteOr(listenerPos.y, 0);
  const lz = finiteOr(listenerPos.z, 0);

  const px = finiteOr(peerPos.x, lx);
  const py = finiteOr(peerPos.y, ly);
  const pz = finiteOr(peerPos.z, lz);

  const dx = px - lx;
  const dy = (py - ly) * 0.5;
  const dz = pz - lz;

  const dist3d = Math.hypot(dx, dy, dz);
  let distanceGain: number;
  if (dist3d <= SPATIAL_REF_DISTANCE) {
    distanceGain = 1;
  } else if (dist3d >= SPATIAL_MAX_DISTANCE) {
    distanceGain = SPATIAL_MIN_DISTANCE_GAIN;
  } else {
    const t = (dist3d - SPATIAL_REF_DISTANCE) / (SPATIAL_MAX_DISTANCE - SPATIAL_REF_DISTANCE);
    const curve = Math.pow(1 - t, 1.65);
    distanceGain = SPATIAL_MIN_DISTANCE_GAIN + (1 - SPATIAL_MIN_DISTANCE_GAIN) * curve;
  }

  const horizDist = Math.hypot(dx, dz);
  if (horizDist <= 1e-4) {
    return { pan: 0, distanceGain };
  }

  const yaw = finiteOr(listenerYaw, 0);
  // Listener local +X (right ear) rotated by +yaw around world +Y: (cos(yaw), 0, -sin(yaw))
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  const rightDot = dx * rightX + dz * rightZ;
  const dirSin = rightDot / horizDist;
  const nearFieldBlend = clamp(horizDist / SPATIAL_NEAR_FIELD_RADIUS, 0, 1);
  const pan = clamp(dirSin * nearFieldBlend * SPATIAL_MAX_STEREO_PAN, -1, 1);

  return { pan, distanceGain };
}

/**
 * Computes root-mean-square amplitude (0..1) from normalized float time-domain samples (-1..+1).
 */
export function computeRmsLevelFromFloatSamples(samples: ArrayLike<number>): number {
  const len = samples.length;
  if (len === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const s = samples[i];
    if (Number.isFinite(s)) {
      sumSq += s * s;
    }
  }
  return Math.sqrt(sumSq / len);
}

/**
 * Computes root-mean-square amplitude (0..1) from unsigned 8-bit time-domain samples (0..255, center 128).
 */
export function computeRmsLevelFromByteSamples(samples: ArrayLike<number>): number {
  const len = samples.length;
  if (len === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const centered = ((samples[i] ?? 128) - 128) / 128;
    sumSq += centered * centered;
  }
  return Math.sqrt(sumSq / len);
}

/**
 * Maps raw RMS amplitude to a clean 0..1 UI voice level with noise floor gating.
 * `gainCompensation` optionally compensates for post-fader spatial distance rolloff
 * so distant teammates still register accurate VAD speaking levels.
 */
export function rmsToNormalizedVoiceLevel(rms: number, gainCompensation = 1): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const compensatedRms = rms * clamp(finiteOr(gainCompensation, 1), 0.25, 6.0);
  if (compensatedRms <= VAD_RMS_NOISE_FLOOR) return 0;
  return clamp((compensatedRms - VAD_RMS_NOISE_FLOOR) * VAD_RMS_GAIN_SCALE, 0, 1);
}

/**
 * Smooths voice level with fast attack / gentle release and hysteresis hold time
 * so speaking indicators feel responsive without chattering.
 */
export function stepVadEnvelope(
  prevLevel: number,
  rawTargetLevel: number,
  prevSpeaking: boolean,
  prevHoldSec: number,
  dt: number,
): VadStepResult {
  const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.5) : 0;
  const target = clamp(finiteOr(rawTargetLevel, 0), 0, 1);
  const current = clamp(finiteOr(prevLevel, 0), 0, 1);

  let voiceLevel: number;
  if (safeDt <= 0) {
    voiceLevel = target;
  } else {
    // Fast attack (40/s) when voice rises, smooth release (14/s) when voice drops
    const rate = target >= current ? 40 : 14;
    const alpha = 1 - Math.exp(-rate * safeDt);
    voiceLevel = current + (target - current) * alpha;
    if (voiceLevel < 0.002 && target === 0) {
      voiceLevel = 0;
    }
  }

  let holdSec = Math.max(0, finiteOr(prevHoldSec, 0));
  let isSpeaking = prevSpeaking;

  if (voiceLevel >= VAD_SPEAK_ON_THRESHOLD || target >= VAD_SPEAK_ON_THRESHOLD) {
    isSpeaking = true;
    holdSec = VAD_SPEAK_HOLD_SEC;
  } else if (isSpeaking) {
    if (voiceLevel >= VAD_SPEAK_OFF_THRESHOLD) {
      holdSec = Math.max(holdSec, VAD_SPEAK_HOLD_SEC * 0.5);
    } else if (safeDt > 0) {
      holdSec = Math.max(0, holdSec - safeDt);
      if (holdSec <= 0) {
        isSpeaking = false;
      }
    } else if (target < VAD_SPEAK_OFF_THRESHOLD && holdSec <= 0) {
      isSpeaking = false;
    }
  }

  return {
    voiceLevel: clamp(voiceLevel, 0, 1),
    isSpeaking,
    holdSec,
  };
}
