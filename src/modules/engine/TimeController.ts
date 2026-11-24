import type { TargetFpsLimit } from '../../contracts/types';
import { clamp } from '../../core/Constants';

export const FIXED_TIMESTEP_SEC = 1 / 60;
export const MAX_FRAME_DELTA_SEC = 0.1;
export const MAX_FIXED_STEPS_PER_FRAME = 6;
export const DEFAULT_HITSTOP_TIMESCALE = 0.05;
export const MAX_HITSTOP_DURATION_SEC = 1.5;
const FPS_SAMPLE_WINDOW_SEC = 0.25;

export interface FrameStepResult {
  readonly renderDt: number;
  readonly unscaledDt: number;
  readonly rawDeltaSec: number;
  readonly elapsedSec: number;
  readonly fps: number;
  readonly frameTimeMs: number;
}

/**
 * Manages the fixed-timestep simulation accumulator (1/60s), spiral-of-death clamping,
 * 60/120/144/Uncapped frame pacing, hitstop / slow-motion time scaling, and real-time
 * FPS + frame-time telemetry.
 */
export class TimeController {
  private lastFrameMs = 0;
  private lastPacedMs = 0;
  private accumulatorSec = 0;
  private elapsedSec = 0;

  private targetFps: TargetFpsLimit = 120;

  private hitstopRemainingSec = 0;
  private hitstopTimeScale = 1.0;

  private fpsWindowSec = 0;
  private fpsFrameCount = 0;
  private currentFps = 120;
  private currentFrameTimeMs = 8.33;

  reset(nowMs: number): void {
    const safeNow = Number.isFinite(nowMs) ? nowMs : 0;
    this.lastFrameMs = safeNow;
    this.lastPacedMs = safeNow;
    this.accumulatorSec = 0;
    this.fpsWindowSec = 0;
    this.fpsFrameCount = 0;
  }

  setTargetFps(fps: TargetFpsLimit): void {
    if (fps === 60 || fps === 120 || fps === 144 || fps === 0) {
      this.targetFps = fps;
    } else {
      this.targetFps = 120;
    }
  }

  getTargetFps(): TargetFpsLimit {
    return this.targetFps;
  }

  /**
   * Drift-compensated frame pacer for 60 / 120 / 144 / 0 (Uncapped) refresh limits.
   * Uses a 12% vsync jitter tolerance so a 120Hz monitor never accidentally drops
   * valid 8.1ms-8.5ms vsync ticks down to 60Hz.
   */
  shouldRenderAt(nowMs: number): boolean {
    if (this.targetFps === 0 || !Number.isFinite(nowMs)) {
      return true;
    }

    const minIntervalMs = 1000 / this.targetFps;
    const elapsedMs = nowMs - this.lastPacedMs;

    if (elapsedMs < 0 || elapsedMs >= minIntervalMs * 0.88) {
      if (elapsedMs > minIntervalMs * 2.5 || elapsedMs < 0) {
        this.lastPacedMs = nowMs;
      } else {
        this.lastPacedMs = nowMs - (elapsedMs % minIntervalMs);
      }
      return true;
    }

    return false;
  }

  triggerHitstop(durationSec: number, timeScale?: number): void {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return;
    }

    const safeDuration = clamp(durationSec, 0, MAX_HITSTOP_DURATION_SEC);
    const safeScale = clamp(
      timeScale !== undefined && Number.isFinite(timeScale)
        ? timeScale
        : DEFAULT_HITSTOP_TIMESCALE,
      0,
      2.0,
    );

    if (this.hitstopRemainingSec <= 0 || safeDuration >= this.hitstopRemainingSec) {
      this.hitstopRemainingSec = safeDuration;
      this.hitstopTimeScale = safeScale;
    } else if (safeScale < this.hitstopTimeScale) {
      this.hitstopTimeScale = safeScale;
    }
  }

  stepFrame(nowMs: number, onFixedUpdate: (dt: number) => void): FrameStepResult {
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : this.lastFrameMs;
    const rawDeltaSec = (safeNowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = safeNowMs;

    this.recordFpsSample(rawDeltaSec);

    const clampedRawDt = clamp(
      Number.isFinite(rawDeltaSec) ? rawDeltaSec : 0,
      0,
      MAX_FRAME_DELTA_SEC,
    );

    let activeTimeScale = 1.0;
    if (this.hitstopRemainingSec > 0) {
      activeTimeScale = this.hitstopTimeScale;
      // Decrement hitstop using unscaled wall-clock time so timeScale = 0 never freezes forever.
      this.hitstopRemainingSec = Math.max(0, this.hitstopRemainingSec - clampedRawDt);
      if (this.hitstopRemainingSec <= 0) {
        this.hitstopTimeScale = 1.0;
      }
    }

    const scaledDt = clampedRawDt * activeTimeScale;
    this.accumulatorSec += scaledDt;

    let steps = 0;
    while (this.accumulatorSec >= FIXED_TIMESTEP_SEC && steps < MAX_FIXED_STEPS_PER_FRAME) {
      onFixedUpdate(FIXED_TIMESTEP_SEC);
      this.accumulatorSec -= FIXED_TIMESTEP_SEC;
      steps++;
    }

    if (steps >= MAX_FIXED_STEPS_PER_FRAME && this.accumulatorSec >= FIXED_TIMESTEP_SEC) {
      this.accumulatorSec %= FIXED_TIMESTEP_SEC;
    }

    this.elapsedSec += scaledDt;

    return {
      renderDt: scaledDt,
      unscaledDt: clampedRawDt,
      rawDeltaSec: Number.isFinite(rawDeltaSec) && rawDeltaSec > 0 ? rawDeltaSec : clampedRawDt,
      elapsedSec: this.elapsedSec,
      fps: this.currentFps,
      frameTimeMs: this.currentFrameTimeMs,
    };
  }

  getFps(): number {
    return this.currentFps;
  }

  getFrameTimeMs(): number {
    return this.currentFrameTimeMs;
  }

  private recordFpsSample(rawDeltaSec: number): void {
    if (!Number.isFinite(rawDeltaSec) || rawDeltaSec <= 0.0001 || rawDeltaSec > 1.0) {
      return;
    }

    const sampleMs = rawDeltaSec * 1000;
    this.currentFrameTimeMs =
      Math.round((this.currentFrameTimeMs * 0.82 + sampleMs * 0.18) * 100) / 100;

    this.fpsWindowSec += rawDeltaSec;
    this.fpsFrameCount += 1;

    if (this.fpsWindowSec >= FPS_SAMPLE_WINDOW_SEC) {
      const measuredFps = this.fpsFrameCount / this.fpsWindowSec;
      const smoothed = this.currentFps * 0.3 + measuredFps * 0.7;
      this.currentFps = Math.round(clamp(smoothed, 1, 360));
      this.fpsWindowSec = 0;
      this.fpsFrameCount = 0;
    } else if (this.fpsFrameCount <= 3) {
      this.currentFps = Math.round(clamp(1 / rawDeltaSec, 1, 360));
      this.currentFrameTimeMs = Math.round(sampleMs * 100) / 100;
    }
  }
}
