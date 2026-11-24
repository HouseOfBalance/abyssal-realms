import * as THREE from 'three';
import type {
  DlssMode,
  EngineTelemetryStats,
  IEngineCore,
  TargetFpsLimit,
} from '../../contracts/types';
import { clamp } from '../../core/Constants';
import type { PerformanceTier } from '../../core/DeviceDetector';
import { TIER_SETTINGS } from '../../core/DeviceDetector';
import { eventBus } from '../../core/EventBus';
import { DEFAULT_DLSS_SHARPNESS, DlssController } from './DlssController';
import { PostProcessingPipeline, type DlssPipelineState } from './PostProcessingPipeline';
import {
  applySceneShadowQuality,
  disposeSceneShadowMaps,
  resolveQualityPreset,
  type GraphicsQuality,
} from './QualityPresets';
import { TimeController } from './TimeController';

const DEFAULT_SCENE_BG_HEX = 0x07060a;
const DEFAULT_TONE_MAPPING_EXPOSURE = 1.08;
const DEFAULT_BLOOM_STRENGTH = 0.48;
const SHADOW_SYNC_INTERVAL_FRAMES = 60;
const MIN_VIEWPORT_SIZE = 32;

export class EngineCore implements IEngineCore {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;

  private container: HTMLElement | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private postProcessing: PostProcessingPipeline | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly timeController = new TimeController();
  private readonly dlssController = new DlssController();
  private quality: GraphicsQuality = 'high';
  private bloomStrength: number = DEFAULT_BLOOM_STRENGTH;

  private pendingWarp: { durationSec?: number; intensity?: number } | null = null;
  private pendingChroma: { intensity?: number; durationSec?: number } | null = null;
  private awakeningActive = false;
  private pendingParry: { counterSuccess: boolean } | null = null;
  private pendingCrimsonDread = false;

  private running = false;
  private disposed = false;
  private rafId: number | null = null;
  private frameCounter = 0;

  private onFixedUpdateCb: ((dt: number) => void) | null = null;
  private onRenderUpdateCb: ((dt: number, elapsed: number) => void) | null = null;

  private lastFps = 120;
  private lastFrameTimeMs = 8.33;
  private lastDrawCalls = 0;
  private lastTriangles = 0;

  /** Raw FPS cap set by applyPerformanceTier (may be 30, not constrained to TargetFpsLimit). */
  private _tierFpsCap = 120;
  /** Minimum ms between rendered frames enforced by applyPerformanceTier throttle. */
  private _tierMsPerFrame = 1000 / 120;
  private _lastTierFrameMs = 0;

  private readonly unsubscribers: Array<() => void> = [];

  // Frustum used by isMeshVisible() – reused each call to avoid per-frame allocation.
  private readonly _frustum = new THREE.Frustum();
  private readonly _frustumMatrix = new THREE.Matrix4();

  private readonly handleWindowResize = (): void => {
    this.syncViewportAndResize();
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) {
      return;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.syncViewportAndResize(true);
  };

  private readonly tick = (timestampMs: number): void => {
    if (!this.running || this.disposed) {
      return;
    }

    // Schedule next frame first so stopLoop() invoked inside callbacks cleanly cancels it.
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(this.tick);
    }

    // 60 / 120 / 144 / Uncapped drift-compensated frame pacer
    if (!this.timeController.shouldRenderAt(timestampMs)) {
      return;
    }

    // Tier-based FPS throttle (supports 30fps for 'low' tier, beyond TargetFpsLimit union).
    if (this._tierFpsCap > 0 && this._tierFpsCap < 60) {
      const elapsed = timestampMs - this._lastTierFrameMs;
      if (elapsed < this._tierMsPerFrame) {
        return;
      }
      this._lastTierFrameMs = timestampMs;
    }

    const onFixedUpdate = this.onFixedUpdateCb;
    const onRenderUpdate = this.onRenderUpdateCb;
    if (!onFixedUpdate || !onRenderUpdate) {
      return;
    }

    const workStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Periodically ensure newly spawned biome/boss lights conform to active shadow map quality.
    this.frameCounter += 1;
    if (this.frameCounter >= SHADOW_SYNC_INTERVAL_FRAMES) {
      this.frameCounter = 0;
      const preset = resolveQualityPreset(this.quality);
      applySceneShadowQuality(this.scene, this.renderer, preset.shadowMapSize);
    }

    const { renderDt, unscaledDt, rawDeltaSec, elapsedSec, fps, frameTimeMs } =
      this.timeController.stepFrame(timestampMs, onFixedUpdate);

    if (!this.running || this.disposed) {
      return;
    }

    onRenderUpdate(renderDt, elapsedSec);

    if (!this.running || this.disposed) {
      return;
    }

    // Advance screen warp & chromatic aberration using unscaled dt so crits ripple during hitstop.
    this.postProcessing?.stepEffects(unscaledDt);
    this.renderFrame(renderDt);

    const workEndMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const workTimeMs = Math.max(0, workEndMs - workStartMs);

    this.lastFps = fps;
    this.lastFrameTimeMs = frameTimeMs;

    // 120Hz Dynamic Resolution Scaler (DRS): adjust internal renderScale (±0.15) cleanly.
    if (this.dlssController.recordFrameSample(rawDeltaSec, workTimeMs)) {
      this.syncViewportAndResize(false);
      this.emitDlssChanged();
    }
  };

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(DEFAULT_SCENE_BG_HEX);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = DEFAULT_TONE_MAPPING_EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Manual info reset ensures drawCalls & triangles accumulate across all EffectComposer passes.
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(this.computeEffectivePixelRatio());

    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.subscribeEvents();
  }

  mount(container: HTMLElement, camera: THREE.PerspectiveCamera): void {
    if (this.disposed || !container || !camera) {
      return;
    }

    this.detachResizeListeners();

    this.container = container;
    this.camera = camera;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.outline = 'none';

    if (canvas.parentElement !== container) {
      container.appendChild(canvas);
    }

    const { width, height } = this.measureViewport();
    const pixelRatio = this.computeEffectivePixelRatio();
    const preset = resolveQualityPreset(this.quality);
    const dlssState = this.getDlssPipelineState();

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // Native canvas stays at full high-DPI resolution; DLSS scales internal offscreen passes.
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, true);

    if (this.postProcessing) {
      this.postProcessing.setCamera(camera);
      this.postProcessing.setBloomStrength(this.bloomStrength);
      this.postProcessing.applyQuality(preset, width, height, pixelRatio, dlssState);
    } else {
      this.postProcessing = new PostProcessingPipeline(
        this.renderer,
        this.scene,
        camera,
        width,
        height,
        pixelRatio,
        this.bloomStrength,
        preset,
        dlssState,
      );
    }

    if (this.pendingWarp) {
      this.postProcessing.triggerScreenWarp(
        this.pendingWarp.durationSec,
        this.pendingWarp.intensity,
      );
      this.pendingWarp = null;
    }
    if (this.pendingChroma) {
      this.postProcessing.triggerChromaticPulse(
        this.pendingChroma.intensity,
        this.pendingChroma.durationSec,
      );
      this.pendingChroma = null;
    }
    if (this.awakeningActive) {
      this.postProcessing.setAwakeningActive(true);
    }
    if (this.pendingParry) {
      this.postProcessing.triggerParryFlash(this.pendingParry.counterSuccess);
      this.pendingParry = null;
    }
    if (this.pendingCrimsonDread) {
      this.postProcessing.triggerCrimsonDread();
      this.pendingCrimsonDread = false;
    }

    applySceneShadowQuality(this.scene, this.renderer, preset.shadowMapSize);
    this.attachResizeListeners(container);
    this.emitDlssChanged();
  }

  startLoop(
    onFixedUpdate: (dt: number) => void,
    onRenderUpdate: (dt: number, elapsed: number) => void,
  ): void {
    if (this.disposed) {
      return;
    }

    this.stopLoop();

    this.onFixedUpdateCb = onFixedUpdate;
    this.onRenderUpdateCb = onRenderUpdate;
    this.running = true;
    this.frameCounter = 0;

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.timeController.reset(nowMs);

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  stopLoop(): void {
    this.running = false;
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  triggerHitstop(durationSec: number, timeScale?: number): void {
    if (this.disposed) {
      return;
    }
    this.timeController.triggerHitstop(durationSec, timeScale);
  }

  setBloomStrength(strength: number): void {
    if (this.disposed) {
      return;
    }
    this.bloomStrength = clamp(Number.isFinite(strength) ? strength : 0, 0, 3.0);
    this.postProcessing?.setBloomStrength(this.bloomStrength);
  }

  setQuality(quality: 'low' | 'medium' | 'high'): void {
    if (this.disposed) {
      return;
    }

    const preset = resolveQualityPreset(quality);
    this.quality = preset.quality;

    const pixelRatio = this.computeEffectivePixelRatio();
    this.renderer.setPixelRatio(pixelRatio);

    applySceneShadowQuality(this.scene, this.renderer, preset.shadowMapSize);

    if (this.container && this.camera) {
      const { width, height } = this.measureViewport();
      this.renderer.setSize(width, height, true);
      this.postProcessing?.applyQuality(
        preset,
        width,
        height,
        pixelRatio,
        this.getDlssPipelineState(),
      );
    }
  }

  setDlssMode(mode: DlssMode, sharpness = DEFAULT_DLSS_SHARPNESS): void {
    if (this.disposed) {
      return;
    }

    this.dlssController.setMode(mode, sharpness);
    this.syncViewportAndResize(true);
    this.emitDlssChanged();
  }

  setTargetFps(fps: TargetFpsLimit, dynamicRes = true): void {
    if (this.disposed) {
      return;
    }

    this.dlssController.setTargetFps(fps, dynamicRes);
    this.timeController.setTargetFps(this.dlssController.getTargetFps());
    this.syncViewportAndResize(false);
    this.emitDlssChanged();
  }

  triggerScreenWarp(durationSec = 0.65, intensity = 0.45): void {
    if (this.disposed) {
      return;
    }
    if (this.postProcessing) {
      this.postProcessing.triggerScreenWarp(durationSec, intensity);
    } else {
      this.pendingWarp = { durationSec, intensity };
    }
  }

  triggerChromaticPulse(intensity = 0.35, durationSec = 0.22): void {
    if (this.disposed) {
      return;
    }
    if (this.postProcessing) {
      this.postProcessing.triggerChromaticPulse(intensity, durationSec);
    } else {
      this.pendingChroma = { intensity, durationSec };
    }
  }

  getStats(): EngineTelemetryStats {
    const renderScale = this.dlssController.getEffectiveRenderScale();
    let internalWidth: number;
    let internalHeight: number;

    if (this.postProcessing) {
      const internal = this.postProcessing.getInternalResolution();
      internalWidth = internal.width;
      internalHeight = internal.height;
    } else {
      const { width, height } = this.measureViewport();
      const dpr = this.computeEffectivePixelRatio();
      internalWidth = Math.max(MIN_VIEWPORT_SIZE, Math.round(width * dpr * renderScale));
      internalHeight = Math.max(MIN_VIEWPORT_SIZE, Math.round(height * dpr * renderScale));
    }

    return {
      fps: this.lastFps,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      renderScale,
      dlssMode: this.dlssController.getMode(),
      targetFps: this.dlssController.getTargetFps(),
      internalWidth,
      internalHeight,
      frameTimeMs: this.lastFrameTimeMs,
    };
  }

  /**
   * Apply device-adaptive quality settings derived from DeviceDetector's PerformanceTier.
   * This is an extra method on the class (not on IEngineCore) so the interface is unchanged.
   */
  applyPerformanceTier(tier: PerformanceTier): void {
    if (this.disposed) {
      return;
    }

    const settings = TIER_SETTINGS[tier];

    // --- Pixel ratio / render scale ---
    const deviceDpr =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1;
    const effectiveDpr = clamp(deviceDpr * settings.renderScale, 0.25, 2.0);
    this.renderer.setPixelRatio(effectiveDpr);

    // --- Shadow quality ---
    if (tier === 'low') {
      this.renderer.shadowMap.enabled = false;
    } else {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const shadowSize =
        tier === 'medium' ? 512 : settings.shadowMapSize;
      applySceneShadowQuality(this.scene, this.renderer, shadowSize);
    }

    // --- FPS cap ---
    // Map tier → TargetFpsLimit: low=30fps (throttled via _tierFpsCap), medium=60fps, high/ultra=120fps.
    // TargetFpsLimit = 60|120|144|0 — 30 is not in the union, so we implement low-tier throttle
    // by storing a custom ms-per-frame floor and using the pacing already in TimeController.
    const fpsCap: TargetFpsLimit =
      tier === 'medium' ? 60 : 120;
    this._tierFpsCap = tier === 'low' ? 30 : tier === 'medium' ? 60 : 120;
    this._tierMsPerFrame = 1000 / this._tierFpsCap;
    this.dlssController.setTargetFps(fpsCap, false);
    this.timeController.setTargetFps(fpsCap);

    // --- Drawing buffer size (dynamic resolution) ---
    if (this.container) {
      const { width, height } = this.measureViewport();
      const bufW = Math.max(MIN_VIEWPORT_SIZE, Math.round(width * settings.renderScale));
      const bufH = Math.max(MIN_VIEWPORT_SIZE, Math.round(height * settings.renderScale));
      this.renderer.setDrawingBufferSize(bufW, bufH, effectiveDpr);
    }

    this.emitDlssChanged();
  }

  /**
   * Dynamically adjust the internal drawing buffer size by a render scale factor (0.25–1.0).
   * Does nothing when not mounted.
   */
  applyRenderScale(scale: number): void {
    if (this.disposed || !this.container) {
      return;
    }

    const clamped = clamp(scale, 0.25, 1.0);
    const { width, height } = this.measureViewport();
    const dpr = this.computeEffectivePixelRatio();
    const bufW = Math.max(MIN_VIEWPORT_SIZE, Math.round(width * clamped));
    const bufH = Math.max(MIN_VIEWPORT_SIZE, Math.round(height * clamped));
    this.renderer.setDrawingBufferSize(bufW, bufH, dpr);
  }

  /**
   * Returns true when the given Object3D (or Mesh) is inside the camera's view frustum.
   * Falls back to true if no camera is mounted (conservative: render everything).
   */
  isMeshVisible(mesh: THREE.Object3D): boolean {
    if (!this.camera) {
      return true;
    }

    this._frustumMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._frustumMatrix);

    if (mesh instanceof THREE.Mesh && mesh.geometry.boundingSphere) {
      return this._frustum.intersectsSphere(
        mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld),
      );
    }

    // Generic Object3D bounding sphere from world position
    const sphere = new THREE.Sphere(mesh.getWorldPosition(new THREE.Vector3()), 0.5);
    return this._frustum.intersectsSphere(sphere);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    this.stopLoop();
    this.onFixedUpdateCb = null;
    this.onRenderUpdateCb = null;

    while (this.unsubscribers.length > 0) {
      const unsub = this.unsubscribers.pop();
      unsub?.();
    }

    this.detachResizeListeners();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored, false);

    if (this.postProcessing) {
      this.postProcessing.dispose();
      this.postProcessing = null;
    }

    disposeSceneShadowMaps(this.scene);

    if (canvas.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }

    this.renderer.renderLists.dispose();
    this.renderer.dispose();

    this.container = null;
    this.camera = null;
  }

  private subscribeEvents(): void {
    this.unsubscribers.push(
      eventBus.on('engine:hitstop', ({ durationSec, timeScale }) => {
        this.triggerHitstop(durationSec, timeScale);
      }),
      eventBus.on('combat:damageDealt', ({ result, targetIsPlayer }) => {
        if (result.isDodged || result.finalDamage <= 0) {
          return;
        }
        if (result.isCrit) {
          this.triggerChromaticPulse(result.killed ? 0.42 : 0.28, result.killed ? 0.24 : 0.16);
        } else if (targetIsPlayer) {
          this.triggerChromaticPulse(0.34, 0.2);
        }
      }),
      eventBus.on('dungeon:portalWarp', () => {
        this.triggerScreenWarp(0.75, 0.52);
        this.triggerChromaticPulse(0.45, 0.48);
      }),
      eventBus.on('boss:defeated', () => {
        this.triggerScreenWarp(0.55, 0.3);
        this.triggerChromaticPulse(0.52, 0.4);
      }),
      eventBus.on('player:awakeningChanged', ({ active }) => {
        this.awakeningActive = Boolean(active);
        if (this.postProcessing) {
          this.postProcessing.setAwakeningActive(this.awakeningActive);
          if (this.awakeningActive) {
            this.postProcessing.triggerScreenWarp(0.42, 0.24);
          }
        }
      }),
      eventBus.on('combat:parryTriggered', ({ counterSuccess }) => {
        if (this.postProcessing) {
          this.postProcessing.triggerParryFlash(counterSuccess);
        } else {
          this.pendingParry = { counterSuccess };
        }
      }),
      eventBus.on('event:butcherInvasion', () => {
        if (this.postProcessing) {
          this.postProcessing.triggerCrimsonDread(1.85, 0.92);
        } else {
          this.pendingCrimsonDread = true;
        }
      }),
      eventBus.on('combat:executionStrike', () => {
        if (this.postProcessing) {
          this.postProcessing.triggerParryFlash(true);
          this.postProcessing.triggerScreenWarp(0.38, 0.22);
        }
      }),
    );
  }

  private emitDlssChanged(): void {
    eventBus.emit('engine:dlssChanged', {
      mode: this.dlssController.getMode(),
      renderScale: this.dlssController.getEffectiveRenderScale(),
      targetFps: this.dlssController.getTargetFps(),
    });
  }

  private getDlssPipelineState(): DlssPipelineState {
    return {
      renderScale: this.dlssController.getEffectiveRenderScale(),
      sharpness: this.dlssController.getSharpness(),
      dlaaEdgeAa: this.dlssController.isDlaaEdgeAaActive(),
    };
  }

  private renderFrame(renderDt: number): void {
    this.renderer.info.reset();

    if (this.postProcessing && this.camera) {
      this.postProcessing.render(renderDt);
    } else if (this.camera) {
      this.renderer.render(this.scene, this.camera);
    }

    this.lastDrawCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;
  }

  private syncViewportAndResize(force = false): void {
    if (this.disposed || !this.container || !this.camera) {
      return;
    }

    const { width, height } = this.measureViewport();
    const pixelRatio = this.computeEffectivePixelRatio();

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, true);
    this.postProcessing?.resize(width, height, pixelRatio, this.getDlssPipelineState(), force);
  }

  private measureViewport(): { width: number; height: number } {
    const fallbackW = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
    const fallbackH = typeof window !== 'undefined' ? window.innerHeight || 720 : 720;

    const rawW = this.container?.clientWidth || fallbackW;
    const rawH = this.container?.clientHeight || fallbackH;

    return {
      width: Math.max(MIN_VIEWPORT_SIZE, Math.floor(rawW)),
      height: Math.max(MIN_VIEWPORT_SIZE, Math.floor(rawH)),
    };
  }

  private computeEffectivePixelRatio(): number {
    const preset = resolveQualityPreset(this.quality);
    const deviceDpr =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1;
    // Always cap high-DPI at <= 2 (and lower on medium/low presets).
    return clamp(deviceDpr, 0.5, Math.min(2.0, preset.maxPixelRatio));
  }

  private attachResizeListeners(container: HTMLElement): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize, { passive: true });
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.syncViewportAndResize();
      });
      this.resizeObserver.observe(container);
    }
  }

  private detachResizeListeners(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}
