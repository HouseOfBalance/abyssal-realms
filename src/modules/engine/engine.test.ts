import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CinematicEffectsState, CinematicUberPass } from './CinematicUberPass';
import { DLSS_PRESETS, DlssController } from './DlssController';
import { DlssCasUpscalePass } from './DlssPass';
import { applySceneShadowQuality, QUALITY_PRESETS } from './QualityPresets';
import { FIXED_TIMESTEP_SEC, TimeController } from './TimeController';

describe('EngineCore Phase 2 — DLSS Super-Resolution, Shaders & 120Hz Pipeline', () => {
  it('supports all 6 DLSS renderScale presets and sharpness clamping', () => {
    const dlss = new DlssController();
    expect(dlss.getMode()).toBe('quality');
    expect(dlss.getBaseRenderScale()).toBeCloseTo(0.77, 2);

    const expected: Array<[keyof typeof DLSS_PRESETS, number, boolean]> = [
      ['native', 1.0, false],
      ['dlaa', 1.0, true],
      ['quality', 0.77, true],
      ['balanced', 0.67, true],
      ['performance', 0.5, true],
      ['ultra_performance', 0.38, true],
    ];

    for (const [mode, scale, dlaaEdge] of expected) {
      dlss.setMode(mode, 0.85);
      expect(dlss.getMode()).toBe(mode);
      expect(dlss.getEffectiveRenderScale()).toBeCloseTo(scale, 2);
      expect(dlss.isDlaaEdgeAaActive()).toBe(dlaaEdge);
      expect(dlss.getSharpness()).toBeCloseTo(0.85, 2);
    }

    dlss.setMode('quality', 9.0);
    expect(dlss.getSharpness()).toBe(1.0);
    dlss.setMode('quality', -2.0);
    expect(dlss.getSharpness()).toBe(0.0);
  });

  it('adjusts renderScale within ±0.15 via 120Hz Dynamic Resolution Scaler (DRS)', () => {
    const dlss = new DlssController();
    dlss.setMode('quality', 0.72);
    dlss.setTargetFps(120, true);

    // Feed heavy 12.5ms frames (> 8.33ms 120Hz budget) over > 0.5s window -> scales down
    let changedDown = false;
    for (let i = 0; i < 50; i++) {
      if (dlss.recordFrameSample(0.0125, 11.8)) {
        changedDown = true;
      }
    }
    expect(changedDown).toBe(true);
    expect(dlss.getEffectiveRenderScale()).toBeLessThan(0.77);
    expect(dlss.getEffectiveRenderScale()).toBeGreaterThanOrEqual(0.62); // >= 0.77 - 0.15

    // Feed fast 2.5ms work at 120Hz (8.33ms interval) over multiple windows -> scales back up
    for (let i = 0; i < 240; i++) {
      dlss.recordFrameSample(1 / 120, 2.2);
    }
    expect(dlss.getEffectiveRenderScale()).toBeGreaterThan(0.77);
    expect(dlss.getEffectiveRenderScale()).toBeLessThanOrEqual(0.92); // <= 0.77 + 0.15
  });

  it('paces frames accurately across 60 / 120 / 144 / 0 Hz and prevents hitstop deadlock', () => {
    const tc = new TimeController();
    tc.reset(0);
    tc.setTargetFps(60);

    // On a 120Hz monitor (8.33ms tick), first half-step should skip, 16.67ms tick should run
    expect(tc.shouldRenderAt(8.33)).toBe(false);
    expect(tc.shouldRenderAt(16.67)).toBe(true);

    // Uncapped (0) never skips
    tc.setTargetFps(0);
    expect(tc.shouldRenderAt(18.0)).toBe(true);

    // Fixed 1/60s accumulator & spiral-of-death clamping
    let fixedCount = 0;
    tc.stepFrame(500, (dt) => {
      expect(dt).toBeCloseTo(FIXED_TIMESTEP_SEC, 5);
      fixedCount++;
    });
    expect(fixedCount).toBeLessThanOrEqual(6);

    // Hitstop with timeScale = 0 freezes fixed steps temporarily then recovers via wall-clock dt
    tc.triggerHitstop(0.05, 0);
    let duringFreezeSteps = 0;
    tc.stepFrame(530, () => {
      duringFreezeSteps++;
    });
    expect(duringFreezeSteps).toBe(0);

    // Advance past remaining 20ms hitstop -> timeScale restores to 1.0
    tc.stepFrame(560, () => {});
    let afterRecoverySteps = 0;
    tc.stepFrame(600, () => {
      afterRecoverySteps++;
    });
    expect(afterRecoverySteps).toBeGreaterThan(0);
  });

  it('updates DlssCasUpscalePass and CinematicUberPass uniforms cleanly without WebGL', () => {
    const dlssPass = new DlssCasUpscalePass();
    dlssPass.configure(986, 554, 0.77, 0.72, true);
    expect(dlssPass.uniforms.uRenderScale.value).toBeCloseTo(0.77, 2);
    expect(dlssPass.uniforms.uSharpness.value).toBeCloseTo(0.72, 2);
    expect(dlssPass.uniforms.uDlaaActive.value).toBe(1.0);
    expect(dlssPass.uniforms.uUpscaleActive.value).toBe(1.0);
    dlssPass.dispose();

    const uber = new CinematicUberPass();
    uber.setAspect(1920 / 1080);
    uber.triggerScreenWarp(0.6, 0.5);
    uber.triggerChromaticPulse(0.4, 0.2);
    uber.stepEffects(0.05);
    expect(uber.uniforms.uWarpIntensity.value).toBeGreaterThan(0);
    expect(uber.uniforms.uChromaticAmount.value).toBeGreaterThan(0);

    // Decay past durations
    for (let i = 0; i < 15; i++) {
      uber.stepEffects(0.05);
    }
    expect(uber.uniforms.uWarpIntensity.value).toBe(0);
    expect(uber.uniforms.uChromaticAmount.value).toBe(0);
    uber.dispose();

    const state = new CinematicEffectsState();
    state.triggerChromaticPulse(0.5, 0.2);
    expect(state.update(0.02).chromaticOffset).toBeGreaterThan(0);
  });

  it('drives Awakening golden-violet radiance, Golden Parry flash, and Butcher Crimson Dread', () => {
    const uber = new CinematicUberPass();

    // 1. Awakening Overdrive smooth ramp & fade
    uber.setAwakeningActive(true);
    uber.stepEffects(0.08);
    const activeGlow = uber.uniforms.uAwakeningGlow.value as number;
    expect(activeGlow).toBeGreaterThan(0.2);

    uber.setAwakeningActive(false);
    for (let i = 0; i < 30; i++) {
      uber.stepEffects(0.08);
    }
    expect(uber.uniforms.uAwakeningGlow.value).toBe(0);

    // 2. Parry Golden Chromatic Flash (counter riposte stronger than guard)
    uber.triggerParryFlash(false);
    uber.stepEffects(0.02);
    const guardFlash = uber.uniforms.uGoldenFlash.value as number;
    expect(guardFlash).toBeGreaterThan(0);

    uber.triggerParryFlash(true);
    uber.stepEffects(0.02);
    const riposteFlash = uber.uniforms.uGoldenFlash.value as number;
    expect(riposteFlash).toBeGreaterThan(guardFlash);

    // 3. Butcher Invasion Crimson Dread Heartbeat Pulse
    uber.triggerCrimsonDread(1.6, 0.9);
    uber.stepEffects(0.1);
    expect(uber.uniforms.uCrimsonDread.value).toBeGreaterThan(0.1);
    expect(uber.uniforms.uWarpIntensity.value).toBeGreaterThan(0);

    for (let i = 0; i < 25; i++) {
      uber.stepEffects(0.08);
    }
    expect(uber.uniforms.uCrimsonDread.value).toBe(0);
    expect(uber.uniforms.uGoldenFlash.value).toBe(0);
    uber.dispose();
  });

  it('resizes DirectionalLight shadows to preset size while capping PointLight shadows at 512', () => {
    const scene = new THREE.Scene();
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.castShadow = true;
    const pointLight = new THREE.PointLight(0xffaa44, 1);
    pointLight.castShadow = true;
    scene.add(dirLight, pointLight);

    const mockRenderer = { shadowMap: { needsUpdate: false } } as unknown as THREE.WebGLRenderer;
    applySceneShadowQuality(scene, mockRenderer, QUALITY_PRESETS.high.shadowMapSize);

    expect(dirLight.shadow.mapSize.x).toBe(2048);
    expect(pointLight.shadow.mapSize.x).toBe(512);
    expect(mockRenderer.shadowMap.needsUpdate).toBe(true);
  });
});
