import type { DlssMode, TargetFpsLimit } from '../../contracts/types';
import { clamp } from '../../core/Constants';

export interface DlssPresetSpec {
  readonly mode: DlssMode;
  readonly baseScale: number;
  readonly dlaaEdgeAa: boolean;
}

export const DLSS_PRESETS: Record<DlssMode, DlssPresetSpec> = {
  native: { mode: 'native', baseScale: 1.0, dlaaEdgeAa: false },
  dlaa: { mode: 'dlaa', baseScale: 1.0, dlaaEdgeAa: true },
  quality: { mode: 'quality', baseScale: 0.77, dlaaEdgeAa: true },
  balanced: { mode: 'balanced', baseScale: 0.67, dlaaEdgeAa: true },
  performance: { mode: 'performance', baseScale: 0.5, dlaaEdgeAa: true },
  ultra_performance: { mode: 'ultra_performance', baseScale: 0.38, dlaaEdgeAa: true },
};

export const DEFAULT_DLSS_MODE: DlssMode = 'quality';
export const DEFAULT_DLSS_SHARPNESS = 0.72;
export const DEFAULT_TARGET_FPS: TargetFpsLimit = 120;

const DRS_MAX_OFFSET = 0.15;
const DRS_MIN_SCALE = 0.3;
const DRS_MAX_SCALE = 1.0;
const DRS_STEP_DOWN = 0.05;
const DRS_STEP_UP = 0.04;
const DRS_EVAL_INTERVAL_SEC = 0.5;
const DRS_120HZ_BUDGET_MS = 1000 / 120; // 8.333ms

export function resolveDlssPreset(mode: DlssMode): DlssPresetSpec {
  if (mode in DLSS_PRESETS) {
    return DLSS_PRESETS[mode];
  }
  return DLSS_PRESETS.quality;
}

export function normalizeTargetFps(fps: TargetFpsLimit): TargetFpsLimit {
  if (fps === 60 || fps === 120 || fps === 144 || fps === 0) {
    return fps;
  }
  return 120;
}

/**
 * Manages DLSS Super-Resolution preset state, sharpness, and 120Hz Dynamic Resolution
 * Scaling (DRS) within ±0.15 of the active DLSS base renderScale.
 */
export class DlssController {
  private mode: DlssMode = DEFAULT_DLSS_MODE;
  private sharpness: number = DEFAULT_DLSS_SHARPNESS;
  private targetFps: TargetFpsLimit = DEFAULT_TARGET_FPS;
  private dynamicResEnabled = true;

  private drsOffset = 0;
  private evalAccumSec = 0;
  private workTimeAccumMs = 0;
  private frameIntervalAccumMs = 0;
  private sampleCount = 0;

  getMode(): DlssMode {
    return this.mode;
  }

  getSharpness(): number {
    return this.sharpness;
  }

  getTargetFps(): TargetFpsLimit {
    return this.targetFps;
  }

  isDynamicResEnabled(): boolean {
    return this.dynamicResEnabled;
  }

  isDlaaEdgeAaActive(): boolean {
    return DLSS_PRESETS[this.mode].dlaaEdgeAa;
  }

  getBaseRenderScale(): number {
    return DLSS_PRESETS[this.mode].baseScale;
  }

  getEffectiveRenderScale(): number {
    const base = DLSS_PRESETS[this.mode].baseScale;
    if (!this.dynamicResEnabled) {
      return base;
    }
    const raw = clamp(base + this.drsOffset, DRS_MIN_SCALE, DRS_MAX_SCALE);
    return Math.round(raw * 100) / 100;
  }

  setMode(mode: DlssMode, sharpness = DEFAULT_DLSS_SHARPNESS): boolean {
    const preset = resolveDlssPreset(mode);
    const safeSharpness = clamp(
      Number.isFinite(sharpness) ? sharpness : DEFAULT_DLSS_SHARPNESS,
      0,
      1.0,
    );

    const prevScale = this.getEffectiveRenderScale();
    const prevMode = this.mode;
    const prevSharpness = this.sharpness;

    this.mode = preset.mode;
    this.sharpness = safeSharpness;
    this.drsOffset = 0;
    this.resetWindow();

    return (
      prevMode !== this.mode ||
      Math.abs(prevScale - this.getEffectiveRenderScale()) > 0.001 ||
      Math.abs(prevSharpness - this.sharpness) > 0.001
    );
  }

  setTargetFps(fps: TargetFpsLimit, dynamicRes = true): boolean {
    const nextFps = normalizeTargetFps(fps);
    const prevFps = this.targetFps;
    const prevScale = this.getEffectiveRenderScale();

    this.targetFps = nextFps;
    this.dynamicResEnabled = Boolean(dynamicRes);
    if (!this.dynamicResEnabled) {
      this.drsOffset = 0;
    }
    this.resetWindow();

    return (
      prevFps !== this.targetFps ||
      Math.abs(prevScale - this.getEffectiveRenderScale()) > 0.001
    );
  }

  /**
   * Feeds a frame timing sample into the 120Hz Dynamic Resolution Scaler.
   * Returns `true` when the quantized effective renderScale shifted enough to resize targets.
   */
  recordFrameSample(rawDeltaSec: number, workTimeMs: number): boolean {
    if (!this.dynamicResEnabled) {
      return false;
    }
    if (!Number.isFinite(rawDeltaSec) || rawDeltaSec <= 0.0005 || rawDeltaSec > 0.25) {
      return false;
    }

    const safeWorkMs = clamp(Number.isFinite(workTimeMs) ? workTimeMs : 0, 0, 250);
    const intervalMs = rawDeltaSec * 1000;

    this.evalAccumSec += rawDeltaSec;
    this.workTimeAccumMs += safeWorkMs;
    this.frameIntervalAccumMs += intervalMs;
    this.sampleCount += 1;

    if (this.evalAccumSec < DRS_EVAL_INTERVAL_SEC || this.sampleCount < 8) {
      return false;
    }

    const avgWorkMs = this.workTimeAccumMs / this.sampleCount;
    const avgIntervalMs = this.frameIntervalAccumMs / this.sampleCount;
    this.resetWindow();

    // Target 8.33ms (120Hz) when targetFps is 120 or 0 (uncapped), else match explicit targetFps.
    const budgetMs =
      this.targetFps === 60
        ? 1000 / 60
        : this.targetFps === 144
          ? 1000 / 144
          : DRS_120HZ_BUDGET_MS;

    // Detect if browser is hardware-vsynced on a 60Hz display (~16.7ms interval with low CPU/GPU work).
    const likelyDisplayVsyncLimited =
      budgetMs < 12 && avgIntervalMs > 15.2 && avgIntervalMs < 18.2 && avgWorkMs < budgetMs * 0.65;

    const frameOverBudget = likelyDisplayVsyncLimited
      ? avgWorkMs > budgetMs * 0.9
      : avgWorkMs > budgetMs * 0.9 || avgIntervalMs > budgetMs * 1.08;

    const frameHasHeadroom =
      (avgIntervalMs <= budgetMs * 1.05 || likelyDisplayVsyncLimited) &&
      avgWorkMs < budgetMs * 0.65;

    const prevEffectiveScale = this.getEffectiveRenderScale();

    if (frameOverBudget) {
      // Frame is exceeding budget: reduce internal resolution smoothly (down to -0.15).
      this.drsOffset = clamp(this.drsOffset - DRS_STEP_DOWN, -DRS_MAX_OFFSET, DRS_MAX_OFFSET);
    } else if (frameHasHeadroom) {
      // Plenty of GPU/CPU headroom at target refresh: climb smoothly up toward +0.15 (capped at 1.0).
      const maxHelpfulOffset = Math.min(DRS_MAX_OFFSET, DRS_MAX_SCALE - this.getBaseRenderScale());
      this.drsOffset = clamp(this.drsOffset + DRS_STEP_UP, -DRS_MAX_OFFSET, maxHelpfulOffset);
    }

    const nextEffectiveScale = this.getEffectiveRenderScale();
    return Math.abs(nextEffectiveScale - prevEffectiveScale) >= 0.02;
  }

  private resetWindow(): void {
    this.evalAccumSec = 0;
    this.workTimeAccumMs = 0;
    this.frameIntervalAccumMs = 0;
    this.sampleCount = 0;
  }
}
