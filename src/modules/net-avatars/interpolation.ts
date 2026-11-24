import type { Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';

export const TELEPORT_SNAP_DISTANCE = 16.0;

const TWO_PI = Math.PI * 2;
const POS_CHANGE_EPS_SQ = 1e-6;
const VEL_CHANGE_EPS_SQ = 1e-4;
const EXP_SETTLE_RATE = 18.0;
const BASE_ROTATION_RATE = 18.5;

export function sanitizeVec3(v: Vec3 | undefined | null, fallback: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  if (!v) return { ...fallback };
  return {
    x: Number.isFinite(v.x) ? v.x : fallback.x,
    y: Number.isFinite(v.y) ? v.y : fallback.y,
    z: Number.isFinite(v.z) ? v.z : fallback.z,
  };
}

export function wrapAnglePi(angleRad: number): number {
  if (!Number.isFinite(angleRad)) return 0;
  const wrapped = ((((angleRad + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

export function shortestAngleDelta(fromRad: number, toRad: number): number {
  const a = wrapAnglePi(fromRad);
  const b = wrapAnglePi(toRad);
  return wrapAnglePi(b - a);
}

export function lerpAngleShortest(fromRad: number, toRad: number, alpha: number): number {
  const t = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
  return wrapAnglePi(fromRad + shortestAngleDelta(fromRad, toRad) * t);
}

function clampVectorMagnitude(v: Vec3, maxLen: number): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len <= maxLen || len <= 1e-8) {
    return { ...v };
  }
  const scale = maxLen / len;
  return {
    x: v.x * scale,
    y: v.y * scale,
    z: v.z * scale,
  };
}

function smootherOutCubic(t: number): number {
  const u = clamp(t, 0, 1);
  const inv = 1 - u;
  return 1 - inv * inv * inv;
}

interface ClashStepState {
  startPos: Vec3;
  goalPos: Vec3;
  goalRotY: number;
  elapsedSec: number;
  durationSec: number;
}

/**
 * 120Hz Velocity-Assisted Cubic Hermite + Exponential Dead-Reckoning Interpolator.
 * Smoothly glides remote avatars across 80ms-160ms cross-network jitter with C1
 * velocity continuity while snapping cleanly on >16m teleports.
 */
export class PeerMotionInterpolator {
  private currentPos: Vec3;
  private currentVel: Vec3;
  private currentRotY: number;

  private lastSnapshotPos: Vec3;
  private lastSnapshotVel: Vec3;

  private targetPos: Vec3;
  private targetVel: Vec3;
  private targetRotY: number;
  private pingMs: number;

  private p0: Vec3;
  private m0: Vec3;
  private p1: Vec3;
  private m1: Vec3;
  private hermiteElapsedSec = 1;
  private hermiteDurationSec = 0.1;

  private clashState: ClashStepState | null = null;

  constructor(initialPos: Vec3, initialVel: Vec3, initialRotY: number, pingMs = 80) {
    const safePos = sanitizeVec3(initialPos);
    const safeVel = sanitizeVec3(initialVel);
    const safeRot = wrapAnglePi(initialRotY);

    this.currentPos = { ...safePos };
    this.currentVel = { ...safeVel };
    this.currentRotY = safeRot;

    this.lastSnapshotPos = { ...safePos };
    this.lastSnapshotVel = { ...safeVel };

    this.targetPos = { ...safePos };
    this.targetVel = { ...safeVel };
    this.targetRotY = safeRot;
    this.pingMs = clamp(Number.isFinite(pingMs) ? pingMs : 80, 0, 500);

    this.p0 = { ...safePos };
    this.p1 = { ...safePos };
    this.m0 = { x: 0, y: 0, z: 0 };
    this.m1 = { x: 0, y: 0, z: 0 };
    this.hermiteDurationSec = this.computeAdaptiveWindowSec(this.pingMs);
    this.hermiteElapsedSec = this.hermiteDurationSec;
  }

  private computeAdaptiveWindowSec(pingMs: number): number {
    // 80ms -> ~0.107s (~13 frames @ 120Hz), 160ms -> ~0.139s (~17 frames @ 120Hz)
    const clampedPing = clamp(Number.isFinite(pingMs) ? pingMs : 80, 0, 260);
    return clamp(0.075 + clampedPing * 0.0004, 0.075, 0.175);
  }

  public applySnapshot(
    pos: Vec3,
    vel: Vec3,
    rotY: number,
    pingMs: number,
  ): { snapped: boolean } {
    const nextPos = sanitizeVec3(pos, this.currentPos);
    const nextVel = sanitizeVec3(vel);
    const nextRot = wrapAnglePi(rotY);
    this.pingMs = clamp(Number.isFinite(pingMs) ? pingMs : 80, 0, 500);

    const dx = nextPos.x - this.currentPos.x;
    const dy = nextPos.y - this.currentPos.y;
    const dz = nextPos.z - this.currentPos.z;
    const distFromCurrent = Math.hypot(dx, dy, dz);

    // Cleanly snap if peer teleported > 16m (portal warp, floor transition, respawn)
    if (distFromCurrent > TELEPORT_SNAP_DISTANCE) {
      this.currentPos = { ...nextPos };
      this.currentVel = { ...nextVel };
      this.currentRotY = nextRot;

      this.lastSnapshotPos = { ...nextPos };
      this.lastSnapshotVel = { ...nextVel };
      this.targetPos = { ...nextPos };
      this.targetVel = { ...nextVel };
      this.targetRotY = nextRot;

      this.p0 = { ...nextPos };
      this.p1 = { ...nextPos };
      this.m0 = { x: 0, y: 0, z: 0 };
      this.m1 = { x: 0, y: 0, z: 0 };
      this.hermiteDurationSec = this.computeAdaptiveWindowSec(this.pingMs);
      this.hermiteElapsedSec = this.hermiteDurationSec;
      this.clashState = null;

      return { snapped: true };
    }

    this.targetRotY = nextRot;

    const snapDx = nextPos.x - this.lastSnapshotPos.x;
    const snapDy = nextPos.y - this.lastSnapshotPos.y;
    const snapDz = nextPos.z - this.lastSnapshotPos.z;
    const posDeltaSq = snapDx * snapDx + snapDy * snapDy + snapDz * snapDz;

    const velDx = nextVel.x - this.lastSnapshotVel.x;
    const velDy = nextVel.y - this.lastSnapshotVel.y;
    const velDz = nextVel.z - this.lastSnapshotVel.z;
    const velDeltaSq = velDx * velDx + velDy * velDy + velDz * velDz;

    // Guard against per-frame syncPeers() calls with unchanged snapshot data
    if (posDeltaSq <= POS_CHANGE_EPS_SQ && velDeltaSq <= VEL_CHANGE_EPS_SQ) {
      return { snapped: false };
    }

    this.lastSnapshotPos = { ...nextPos };
    this.lastSnapshotVel = { ...nextVel };
    this.targetPos = { ...nextPos };
    this.targetVel = { ...nextVel };

    const duration = this.computeAdaptiveWindowSec(this.pingMs);
    const maxTangentLen = Math.max(distFromCurrent * 2.15, 0.35);

    this.p0 = { ...this.currentPos };
    this.p1 = { ...nextPos };
    this.m0 = clampVectorMagnitude(
      {
        x: this.currentVel.x * duration,
        y: this.currentVel.y * duration,
        z: this.currentVel.z * duration,
      },
      maxTangentLen,
    );
    this.m1 = clampVectorMagnitude(
      {
        x: nextVel.x * duration,
        y: nextVel.y * duration,
        z: nextVel.z * duration,
      },
      maxTangentLen,
    );
    this.hermiteDurationSec = duration;
    this.hermiteElapsedSec = 0;

    return { snapped: false };
  }

  public triggerClashStep(midpoint: Vec3, durationSec = 0.56): void {
    const safeMid = sanitizeVec3(midpoint, this.currentPos);
    const dx = safeMid.x - this.currentPos.x;
    const dz = safeMid.z - this.currentPos.z;
    const distXZ = Math.hypot(dx, dz);

    const clashRotY = distXZ > 1e-4 ? Math.atan2(dx, dz) : this.currentRotY;
    const standoff = 0.42;
    let goalX = safeMid.x;
    let goalZ = safeMid.z;
    if (distXZ > standoff) {
      const stepDist = distXZ - standoff;
      goalX = this.currentPos.x + (dx / distXZ) * stepDist;
      goalZ = this.currentPos.z + (dz / distXZ) * stepDist;
    }

    const goalPos: Vec3 = {
      x: goalX,
      y: safeMid.y,
      z: goalZ,
    };

    // Apply immediate heroic lunge initiation + face partner, then glide remainder over clash window
    const initialBlend = 0.38;
    const steppedStart: Vec3 = {
      x: this.currentPos.x + (goalPos.x - this.currentPos.x) * initialBlend,
      y: this.currentPos.y + (goalPos.y - this.currentPos.y) * initialBlend,
      z: this.currentPos.z + (goalPos.z - this.currentPos.z) * initialBlend,
    };

    this.currentPos = { ...steppedStart };
    this.currentRotY = clashRotY;
    this.targetRotY = clashRotY;
    this.targetPos = { ...goalPos };

    this.clashState = {
      startPos: { ...steppedStart },
      goalPos,
      goalRotY: clashRotY,
      elapsedSec: 0,
      durationSec: Math.max(0.15, durationSec),
    };
  }

  public isClashActive(): boolean {
    return this.clashState !== null;
  }

  public step(dt: number): {
    position: Vec3;
    velocity: Vec3;
    rotationY: number;
    horizontalSpeed: number;
  } {
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    if (safeDt <= 0) {
      return {
        position: { ...this.currentPos },
        velocity: { ...this.currentVel },
        rotationY: this.currentRotY,
        horizontalSpeed: Math.hypot(this.currentVel.x, this.currentVel.z),
      };
    }

    if (this.clashState) {
      this.clashState.elapsedSec += safeDt;
      const u = clamp(this.clashState.elapsedSec / this.clashState.durationSec, 0, 1);
      const eased = smootherOutCubic(u);
      const prevX = this.currentPos.x;
      const prevY = this.currentPos.y;
      const prevZ = this.currentPos.z;

      this.currentPos = {
        x: this.clashState.startPos.x + (this.clashState.goalPos.x - this.clashState.startPos.x) * eased,
        y: this.clashState.startPos.y + (this.clashState.goalPos.y - this.clashState.startPos.y) * eased,
        z: this.clashState.startPos.z + (this.clashState.goalPos.z - this.clashState.startPos.z) * eased,
      };
      this.currentVel = {
        x: (this.currentPos.x - prevX) / safeDt,
        y: (this.currentPos.y - prevY) / safeDt,
        z: (this.currentPos.z - prevZ) / safeDt,
      };
      this.currentRotY = lerpAngleShortest(
        this.currentRotY,
        this.clashState.goalRotY,
        1 - Math.exp(-26 * safeDt),
      );

      if (u >= 1) {
        this.p0 = { ...this.currentPos };
        this.p1 = { ...this.targetPos };
        this.hermiteElapsedSec = this.hermiteDurationSec;
        this.clashState = null;
      }

      return {
        position: { ...this.currentPos },
        velocity: { ...this.currentVel },
        rotationY: this.currentRotY,
        horizontalSpeed: Math.hypot(this.currentVel.x, this.currentVel.z),
      };
    }

    // Position: 120Hz Velocity-Assisted Cubic Hermite with Exponential Settling tail
    if (this.hermiteElapsedSec < this.hermiteDurationSec) {
      this.hermiteElapsedSec += safeDt;
      const T = Math.max(0.02, this.hermiteDurationSec);

      if (this.hermiteElapsedSec < T) {
        const u = clamp(this.hermiteElapsedSec / T, 0, 1);
        const u2 = u * u;
        const u3 = u2 * u;

        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;

        this.currentPos = {
          x: h00 * this.p0.x + h10 * this.m0.x + h01 * this.p1.x + h11 * this.m1.x,
          y: h00 * this.p0.y + h10 * this.m0.y + h01 * this.p1.y + h11 * this.m1.y,
          z: h00 * this.p0.z + h10 * this.m0.z + h01 * this.p1.z + h11 * this.m1.z,
        };

        // Analytical first derivative dH/dt for exact C1 velocity handoff at 120Hz
        const dh00 = 6 * u2 - 6 * u;
        const dh10 = 3 * u2 - 4 * u + 1;
        const dh01 = -6 * u2 + 6 * u;
        const dh11 = 3 * u2 - 2 * u;
        const invT = 1 / T;

        this.currentVel = {
          x: (dh00 * this.p0.x + dh10 * this.m0.x + dh01 * this.p1.x + dh11 * this.m1.x) * invT,
          y: (dh00 * this.p0.y + dh10 * this.m0.y + dh01 * this.p1.y + dh11 * this.m1.y) * invT,
          z: (dh00 * this.p0.z + dh10 * this.m0.z + dh01 * this.p1.z + dh11 * this.m1.z) * invT,
        };
      } else {
        this.currentPos = { ...this.p1 };
        const decay = Math.exp(-12 * (this.hermiteElapsedSec - T));
        this.currentVel = {
          x: this.targetVel.x * decay,
          y: this.targetVel.y * decay,
          z: this.targetVel.z * decay,
        };
      }
    } else {
      const posAlpha = 1 - Math.exp(-EXP_SETTLE_RATE * safeDt);
      this.currentPos = {
        x: this.currentPos.x + (this.targetPos.x - this.currentPos.x) * posAlpha,
        y: this.currentPos.y + (this.targetPos.y - this.currentPos.y) * posAlpha,
        z: this.currentPos.z + (this.targetPos.z - this.currentPos.z) * posAlpha,
      };
      const velDecay = Math.exp(-14 * safeDt);
      this.currentVel = {
        x: this.currentVel.x * velDecay,
        y: this.currentVel.y * velDecay,
        z: this.currentVel.z * velDecay,
      };
    }

    // Rotation: Shortest-arc exponential smoothing across [-PI, PI]
    const rotRate = clamp(BASE_ROTATION_RATE - this.pingMs * 0.025, 13.0, 20.0);
    const rotAlpha = 1 - Math.exp(-rotRate * safeDt);
    this.currentRotY = lerpAngleShortest(this.currentRotY, this.targetRotY, rotAlpha);

    return {
      position: { ...this.currentPos },
      velocity: { ...this.currentVel },
      rotationY: this.currentRotY,
      horizontalSpeed: Math.hypot(this.currentVel.x, this.currentVel.z),
    };
  }

  public getPosition(): Vec3 {
    return { ...this.currentPos };
  }

  public getRotationY(): number {
    return this.currentRotY;
  }
}
