import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clamp } from '../../core/Constants';
import { CinematicUberPass } from './CinematicUberPass';
import { DlssCasUpscalePass } from './DlssPass';
import type { QualityPresetConfig } from './QualityPresets';

const DEFAULT_BLOOM_RADIUS = 0.42;
const DEFAULT_BLOOM_THRESHOLD = 0.72;
const MIN_RENDER_DIMENSION = 32;

export interface DlssPipelineState {
  readonly renderScale: number;
  readonly sharpness: number;
  readonly dlaaEdgeAa: boolean;
}

/**
 * Multi-pass HDR + DLSS Super-Resolution Post-Processing Pipeline:
 * 1. RenderPass          — Linear HDR scene at scaled internal resolution
 * 2. UnrealBloomPass     — Multi-mip HDR bloom at scaled internal resolution
 * 3. OutputPass          — ACES Filmic Tone Mapping + sRGB transfer
 * 4. CinematicUberPass   — Portal radial screen warp, crit/hit RGB split, filmic vignette
 * 5. DlssCasUpscalePass  — Renders to full native canvas (`renderToScreen = true`)
 *                          with DLAA directional edge AA + FidelityFX CAS sharpening
 */
export class PostProcessingPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly uberPass: CinematicUberPass;
  private readonly dlssPass: DlssCasUpscalePass;

  private bloomStrength: number;
  private bloomEnabledByQuality: boolean;

  private lastCssWidth = 0;
  private lastCssHeight = 0;
  private lastInternalDpr = 0;
  private internalWidth = 1280;
  private internalHeight = 720;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    cssWidth: number,
    cssHeight: number,
    nativePixelRatio: number,
    bloomStrength: number,
    preset: QualityPresetConfig,
    dlssState: DlssPipelineState,
  ) {
    this.renderer = renderer;
    this.bloomStrength = clamp(Number.isFinite(bloomStrength) ? bloomStrength : 0.48, 0, 3.0);
    this.bloomEnabledByQuality = preset.bloomEnabled;

    const safeW = Math.max(MIN_RENDER_DIMENSION, Math.floor(cssWidth));
    const safeH = Math.max(MIN_RENDER_DIMENSION, Math.floor(cssHeight));

    this.composer = new EffectComposer(renderer);
    this.applyMsaaSamples(preset.msaaSamples);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(safeW, safeH),
      this.bloomStrength,
      DEFAULT_BLOOM_RADIUS,
      DEFAULT_BLOOM_THRESHOLD,
    );
    this.syncBloomState();
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.uberPass = new CinematicUberPass();
    this.composer.addPass(this.uberPass);

    this.dlssPass = new DlssCasUpscalePass();
    this.composer.addPass(this.dlssPass);

    this.resize(safeW, safeH, nativePixelRatio, dlssState, true);
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.renderPass.camera = camera;
  }

  setBloomStrength(strength: number): void {
    this.bloomStrength = clamp(Number.isFinite(strength) ? strength : 0, 0, 3.0);
    this.syncBloomState();
  }

  applyQuality(
    preset: QualityPresetConfig,
    cssWidth: number,
    cssHeight: number,
    nativePixelRatio: number,
    dlssState: DlssPipelineState,
  ): void {
    this.bloomEnabledByQuality = preset.bloomEnabled;
    this.syncBloomState();
    this.applyMsaaSamples(preset.msaaSamples);
    this.resize(cssWidth, cssHeight, nativePixelRatio, dlssState, true);
  }

  resize(
    cssWidth: number,
    cssHeight: number,
    nativePixelRatio: number,
    dlssState: DlssPipelineState,
    force = false,
  ): void {
    const safeW = Math.max(MIN_RENDER_DIMENSION, Math.floor(cssWidth));
    const safeH = Math.max(MIN_RENDER_DIMENSION, Math.floor(cssHeight));
    const safeNativeDpr = clamp(Number.isFinite(nativePixelRatio) ? nativePixelRatio : 1, 0.5, 2.0);
    const safeScale = clamp(Number.isFinite(dlssState.renderScale) ? dlssState.renderScale : 1, 0.25, 1.0);
    const internalDpr = clamp(safeNativeDpr * safeScale, 0.2, 2.0);

    this.internalWidth = Math.max(MIN_RENDER_DIMENSION, Math.round(safeW * internalDpr));
    this.internalHeight = Math.max(MIN_RENDER_DIMENSION, Math.round(safeH * internalDpr));

    this.uberPass.setAspect(safeW / safeH);
    this.dlssPass.configure(
      this.internalWidth,
      this.internalHeight,
      safeScale,
      dlssState.sharpness,
      dlssState.dlaaEdgeAa,
    );

    if (
      !force &&
      safeW === this.lastCssWidth &&
      safeH === this.lastCssHeight &&
      Math.abs(internalDpr - this.lastInternalDpr) < 0.001
    ) {
      return;
    }

    this.lastCssWidth = safeW;
    this.lastCssHeight = safeH;
    this.lastInternalDpr = internalDpr;

    this.composer.setPixelRatio(internalDpr);
    this.composer.setSize(safeW, safeH);
  }

  triggerScreenWarp(durationSec?: number, intensity?: number): void {
    this.uberPass.triggerScreenWarp(durationSec, intensity);
  }

  triggerChromaticPulse(intensity?: number, durationSec?: number): void {
    this.uberPass.triggerChromaticPulse(intensity, durationSec);
  }

  setAwakeningActive(active: boolean): void {
    this.uberPass.setAwakeningActive(active);
  }

  triggerParryFlash(counterSuccess = true): void {
    this.uberPass.triggerParryFlash(counterSuccess);
  }

  triggerCrimsonDread(durationSec?: number, intensity?: number): void {
    this.uberPass.triggerCrimsonDread(durationSec, intensity);
  }

  stepEffects(unscaledDtSec: number): void {
    this.uberPass.stepEffects(unscaledDtSec);
  }

  getInternalResolution(): { width: number; height: number } {
    return {
      width: this.internalWidth,
      height: this.internalHeight,
    };
  }

  render(dtSec: number): void {
    this.composer.render(dtSec);
  }

  dispose(): void {
    this.bloomPass.dispose();
    this.outputPass.dispose();
    this.uberPass.dispose();
    this.dlssPass.dispose();
    this.composer.dispose();
  }

  private syncBloomState(): void {
    this.bloomPass.strength = this.bloomStrength;
    this.bloomPass.enabled = this.bloomEnabledByQuality && this.bloomStrength > 0.001;
  }

  private applyMsaaSamples(requestedSamples: number): void {
    const targetSamples = this.renderer.capabilities.isWebGL2 ? Math.max(0, requestedSamples) : 0;
    if (this.composer.renderTarget1.samples !== targetSamples) {
      this.composer.renderTarget1.samples = targetSamples;
      this.composer.renderTarget2.samples = targetSamples;
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
  }
}
