import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { clamp } from '../../core/Constants';

const CinematicUberShader = {
  name: 'AbyssalCinematicUberShader',
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: 16 / 9 },
    uTime: { value: 0.0 },
    uWarpProgress: { value: 0.0 },
    uWarpIntensity: { value: 0.0 },
    uChromaticAmount: { value: 0.0 },
    uVignetteStrength: { value: 0.18 },
    uAwakeningGlow: { value: 0.0 },
    uGoldenFlash: { value: 0.0 },
    uCrimsonDread: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect;
    uniform float uTime;
    uniform float uWarpProgress;
    uniform float uWarpIntensity;
    uniform float uChromaticAmount;
    uniform float uVignetteStrength;
    uniform float uAwakeningGlow;
    uniform float uGoldenFlash;
    uniform float uCrimsonDread;

    varying vec2 vUv;

    void main() {
      vec2 centered = vUv - 0.5;
      vec2 aspectOffset = vec2(centered.x * uAspect, centered.y);
      float dist = length(aspectOffset);
      vec2 radialDir = dist > 1e-4 ? (centered / dist) : vec2(0.0);

      vec2 sampleUv = vUv;

      // 1. Radial Portal / Impact Screen Warp (shockwave ripple + subtle astral vortex pinch)
      if (uWarpIntensity > 0.0005) {
        float env = sin(uWarpProgress * 3.14159265) * (1.0 - uWarpProgress * 0.3);
        float ringRadius = uWarpProgress * 0.95;
        float ringBand = exp(-pow((dist - ringRadius) * 8.5, 2.0));
        float pinch = -0.055 * env * uWarpIntensity * exp(-dist * 2.6);
        float ripple = 0.032 * env * uWarpIntensity * ringBand;

        float swirlAngle = 0.22 * env * uWarpIntensity * exp(-dist * 3.2);
        float s = sin(swirlAngle);
        float c = cos(swirlAngle);
        vec2 rotated = vec2(
          centered.x * c - centered.y * s,
          centered.x * s + centered.y * c
        );

        sampleUv = clamp(0.5 + rotated + radialDir * (pinch + ripple), vec2(0.002), vec2(0.998));
      }

      // 2. Crit / Hit / Parry / Warp Radial RGB Chromatic Aberration
      float totalChroma =
        uChromaticAmount +
        uGoldenFlash * 0.009 +
        uCrimsonDread * 0.006 +
        uWarpIntensity * 0.012 * sin(uWarpProgress * 3.14159265);

      vec3 col;
      if (totalChroma > 0.0002) {
        vec2 chromaShift = centered * (totalChroma * (0.35 + dist * 1.65));
        float r = texture2D(tDiffuse, clamp(sampleUv + chromaShift, vec2(0.001), vec2(0.999))).r;
        float g = texture2D(tDiffuse, sampleUv).g;
        float b = texture2D(tDiffuse, clamp(sampleUv - chromaShift, vec2(0.001), vec2(0.999))).b;
        col = vec3(r, g, b);
      } else {
        col = texture2D(tDiffuse, sampleUv).rgb;
      }

      // 3. Subtle Dark-Fantasy Filmic Vignette (softly lifted while Awakened)
      float vigScale = uVignetteStrength * (1.0 - uAwakeningGlow * 0.35);
      float vigDistSq = dot(centered * vec2(1.12, 1.18), centered * vec2(1.12, 1.18));
      float vignette = 1.0 - clamp(vigDistSq * vigScale * 2.1, 0.0, 0.42);
      col *= vignette;

      // 4. Awakening Overdrive: Golden-Violet Iridescent Edge Radiance
      if (uAwakeningGlow > 0.001) {
        float angle = atan(aspectOffset.y, aspectOffset.x);
        float shimmer = 0.5 + 0.5 * sin(angle * 5.0 - uTime * 3.6) * cos(angle * 3.0 + uTime * 2.2);
        vec3 archonTint = mix(vec3(0.66, 0.28, 0.96), vec3(1.0, 0.80, 0.28), shimmer);
        float edgeMask = smoothstep(0.34, 0.92, dist);
        col += archonTint * (uAwakeningGlow * edgeMask * 0.22);
      }

      // 5. Parry Triggered: Crisp Solar-Gold Chromatic & Rim Flash
      if (uGoldenFlash > 0.001) {
        float goldEdge = smoothstep(0.18, 0.88, dist);
        vec3 goldTint = vec3(1.0, 0.84, 0.32);
        col += goldTint * (uGoldenFlash * (0.07 + 0.26 * goldEdge));
      }

      // 6. Butcher Invasion: Arterial Crimson Dread Heartbeat Vignette
      if (uCrimsonDread > 0.001) {
        float dreadMask = smoothstep(0.22, 0.88, dist);
        col *= mix(vec3(1.0), vec3(0.94, 0.56, 0.56), uCrimsonDread * dreadMask * 0.68);
        col += vec3(0.74, 0.04, 0.06) * (uCrimsonDread * dreadMask * 0.30);
      }

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export interface CinematicFrameSnapshot {
  readonly elapsedTime: number;
  readonly warpProgress: number;
  readonly warpIntensity: number;
  readonly chromaticOffset: number;
  readonly awakeningGlow: number;
  readonly goldenFlash: number;
  readonly crimsonDread: number;
}

/**
 * Pure state controller for radial portal warp, chromatic pulse, Awakening edge radiance,
 * Golden Parry flash, and Butcher Crimson Dread envelopes (testable headlessly without WebGL).
 */
export class CinematicEffectsState {
  private elapsedTime = 0;

  private warpDurationSec = 0;
  private warpElapsedSec = 0;
  private warpPeakIntensity = 0;

  private chromaDurationSec = 0;
  private chromaRemainingSec = 0;
  private chromaPeakIntensity = 0;

  private awakeningActive = false;
  private awakeningGlow = 0;

  private parryDurationSec = 0;
  private parryRemainingSec = 0;
  private parryPeakIntensity = 0;

  private dreadDurationSec = 0;
  private dreadElapsedSec = 0;
  private dreadPeakIntensity = 0;

  triggerScreenWarp(durationSec = 0.65, intensity = 0.45): void {
    const safeDur = clamp(Number.isFinite(durationSec) ? durationSec : 0.65, 0.05, 3.0);
    const safeInt = clamp(Number.isFinite(intensity) ? intensity : 0.45, 0, 1.5);
    if (safeInt <= 0) return;

    this.warpDurationSec = safeDur;
    this.warpElapsedSec = 0;
    this.warpPeakIntensity = Math.max(this.getActiveWarpIntensity(), safeInt);
  }

  triggerChromaticPulse(intensity = 0.35, durationSec = 0.22): void {
    const safeInt = clamp(Number.isFinite(intensity) ? intensity : 0.35, 0, 1.5);
    const safeDur = clamp(Number.isFinite(durationSec) ? durationSec : 0.22, 0.04, 2.0);
    if (safeInt <= 0) return;

    const current = this.getActiveChromaticOffset();
    const requestedOffset = safeInt * 0.024;
    if (requestedOffset >= current || this.chromaRemainingSec <= 0) {
      this.chromaPeakIntensity = requestedOffset;
      this.chromaDurationSec = safeDur;
      this.chromaRemainingSec = safeDur;
    }
  }

  setAwakeningActive(active: boolean): void {
    this.awakeningActive = Boolean(active);
    if (this.awakeningActive) {
      this.triggerChromaticPulse(0.38, 0.26);
    }
  }

  triggerParryFlash(counterSuccess = true): void {
    const peak = counterSuccess ? 0.92 : 0.55;
    const dur = counterSuccess ? 0.28 : 0.18;
    if (peak >= this.getActiveGoldenFlash() || this.parryRemainingSec <= 0) {
      this.parryPeakIntensity = peak;
      this.parryDurationSec = dur;
      this.parryRemainingSec = dur;
    }
    this.triggerChromaticPulse(counterSuccess ? 0.42 : 0.25, dur);
  }

  triggerCrimsonDread(durationSec = 1.85, intensity = 0.9): void {
    const safeDur = clamp(Number.isFinite(durationSec) ? durationSec : 1.85, 0.2, 4.0);
    const safeInt = clamp(Number.isFinite(intensity) ? intensity : 0.9, 0, 1.0);
    if (safeInt <= 0) return;

    this.dreadDurationSec = safeDur;
    this.dreadElapsedSec = 0;
    this.dreadPeakIntensity = Math.max(this.getActiveCrimsonDread(), safeInt);
    this.triggerScreenWarp(0.65, 0.34);
    this.triggerChromaticPulse(0.46, 0.45);
  }

  update(unscaledDtSec: number): CinematicFrameSnapshot {
    const dt = clamp(Number.isFinite(unscaledDtSec) ? unscaledDtSec : 0, 0, 0.1);
    this.elapsedTime += dt;

    if (this.warpDurationSec > 0) {
      this.warpElapsedSec += dt;
      if (this.warpElapsedSec >= this.warpDurationSec) {
        this.warpDurationSec = 0;
        this.warpElapsedSec = 0;
        this.warpPeakIntensity = 0;
      }
    }

    if (this.chromaRemainingSec > 0) {
      this.chromaRemainingSec = Math.max(0, this.chromaRemainingSec - dt);
      if (this.chromaRemainingSec <= 0) {
        this.chromaPeakIntensity = 0;
        this.chromaDurationSec = 0;
      }
    }

    const awakeningTarget = this.awakeningActive ? 1.0 : 0.0;
    const awakeningRate = this.awakeningActive ? 5.5 : 3.2;
    this.awakeningGlow += (awakeningTarget - this.awakeningGlow) * (1 - Math.exp(-awakeningRate * dt));
    if (this.awakeningGlow < 0.001 && !this.awakeningActive) {
      this.awakeningGlow = 0;
    }

    if (this.parryRemainingSec > 0) {
      this.parryRemainingSec = Math.max(0, this.parryRemainingSec - dt);
      if (this.parryRemainingSec <= 0) {
        this.parryPeakIntensity = 0;
        this.parryDurationSec = 0;
      }
    }

    if (this.dreadDurationSec > 0) {
      this.dreadElapsedSec += dt;
      if (this.dreadElapsedSec >= this.dreadDurationSec) {
        this.dreadDurationSec = 0;
        this.dreadElapsedSec = 0;
        this.dreadPeakIntensity = 0;
      }
    }

    const warpProgress =
      this.warpDurationSec > 0 ? clamp(this.warpElapsedSec / this.warpDurationSec, 0, 1) : 0;

    return {
      elapsedTime: this.elapsedTime,
      warpProgress,
      warpIntensity: this.getActiveWarpIntensity(),
      chromaticOffset: this.getActiveChromaticOffset(),
      awakeningGlow: clamp(this.awakeningGlow, 0, 1),
      goldenFlash: this.getActiveGoldenFlash(),
      crimsonDread: this.getActiveCrimsonDread(),
    };
  }

  private getActiveWarpIntensity(): number {
    if (this.warpDurationSec <= 0) return 0;
    return this.warpPeakIntensity;
  }

  private getActiveChromaticOffset(): number {
    if (this.chromaRemainingSec <= 0 || this.chromaDurationSec <= 0) return 0;
    const t = clamp(this.chromaRemainingSec / this.chromaDurationSec, 0, 1);
    return this.chromaPeakIntensity * (t * t);
  }

  private getActiveGoldenFlash(): number {
    if (this.parryRemainingSec <= 0 || this.parryDurationSec <= 0) return 0;
    const t = clamp(this.parryRemainingSec / this.parryDurationSec, 0, 1);
    return this.parryPeakIntensity * (t * t);
  }

  private getActiveCrimsonDread(): number {
    if (this.dreadDurationSec <= 0) return 0;
    const p = clamp(this.dreadElapsedSec / this.dreadDurationSec, 0, 1);
    const envelope = Math.sin(p * Math.PI);
    const heartbeat = 0.68 + 0.32 * Math.abs(Math.sin(p * Math.PI * 3.0));
    return clamp(envelope * heartbeat * this.dreadPeakIntensity, 0, 1);
  }
}

export class CinematicUberPass extends ShaderPass {
  private readonly state = new CinematicEffectsState();

  constructor() {
    super(CinematicUberShader);
  }

  setAspect(aspect: number): void {
    if (Number.isFinite(aspect) && aspect > 0.05) {
      this.uniforms.uAspect.value = aspect;
    }
  }

  triggerScreenWarp(durationSec?: number, intensity?: number): void {
    this.state.triggerScreenWarp(durationSec, intensity);
  }

  triggerChromaticPulse(intensity?: number, durationSec?: number): void {
    this.state.triggerChromaticPulse(intensity, durationSec);
  }

  setAwakeningActive(active: boolean): void {
    this.state.setAwakeningActive(active);
  }

  triggerParryFlash(counterSuccess = true): void {
    this.state.triggerParryFlash(counterSuccess);
  }

  triggerCrimsonDread(durationSec?: number, intensity?: number): void {
    this.state.triggerCrimsonDread(durationSec, intensity);
  }

  stepEffects(unscaledDtSec: number): void {
    const snap = this.state.update(unscaledDtSec);
    this.uniforms.uTime.value = snap.elapsedTime;
    this.uniforms.uWarpProgress.value = snap.warpProgress;
    this.uniforms.uWarpIntensity.value = snap.warpIntensity;
    this.uniforms.uChromaticAmount.value = snap.chromaticOffset;
    this.uniforms.uAwakeningGlow.value = snap.awakeningGlow;
    this.uniforms.uGoldenFlash.value = snap.goldenFlash;
    this.uniforms.uCrimsonDread.value = snap.crimsonDread;
  }
}
