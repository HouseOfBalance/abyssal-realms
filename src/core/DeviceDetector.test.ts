// DeviceDetector.test.ts — Tests for DeviceDetector (runs in Node.js / Vitest headless)

import { describe, it, expect } from 'vitest';
import {
  detectDevice,
  saveQualityTier,
  watchDeviceChanges,
  TIER_SETTINGS,
  type DeviceProfile,
  type PerformanceTier,
} from './DeviceDetector';

// In Vitest/Node there is no real window/navigator — SSR fallback is exercised.

describe('DeviceDetector — SSR / Node.js fallback', () => {
  it('detectDevice() returns a valid DeviceProfile object', () => {
    const profile: DeviceProfile = detectDevice();
    expect(profile).toBeDefined();
    expect(typeof profile).toBe('object');
  });

  it('profile has all required fields with correct types', () => {
    const profile = detectDevice();

    expect(['mobile', 'tablet', 'desktop']).toContain(profile.deviceClass);
    expect(['low', 'medium', 'high', 'ultra']).toContain(profile.tier);
    expect(typeof profile.isTouchPrimary).toBe('boolean');
    expect(typeof profile.pixelRatio).toBe('number');
    expect(typeof profile.maxTextureSize).toBe('number');
    expect(typeof profile.screenWidth).toBe('number');
    expect(typeof profile.screenHeight).toBe('number');
    expect(typeof profile.recommendedSettings).toBe('object');
  });

  it('SSR fallback returns desktop/medium defaults', () => {
    // window is undefined in Node, so the SSR path is taken
    const profile = detectDevice();
    expect(profile.deviceClass).toBe('desktop');
    expect(profile.tier).toBe('medium');
    expect(profile.isTouchPrimary).toBe(false);
    expect(profile.pixelRatio).toBe(1);
    expect(profile.screenWidth).toBe(1920);
    expect(profile.screenHeight).toBe(1080);
  });

  it('profile.recommendedSettings has all required PerformanceSettings fields', () => {
    const { recommendedSettings: s } = detectDevice();
    expect(typeof s.shadowMapSize).toBe('number');
    expect(typeof s.maxParticles).toBe('number');
    expect(typeof s.drawDistance).toBe('number');
    expect(typeof s.targetFps).toBe('number');
    expect(typeof s.renderScale).toBe('number');
    expect(typeof s.maxEnemies).toBe('number');
    expect(typeof s.enablePostFX).toBe('boolean');
    expect(typeof s.antiAlias).toBe('boolean');
    expect(typeof s.aiUpdateInterval).toBe('number');
    expect(typeof s.hudRefreshRate).toBe('number');
    expect(typeof s.geometryLOD).toBe('boolean');
    expect(typeof s.frustumCull).toBe('boolean');
    expect(typeof s.instancedMesh).toBe('boolean');
  });
});

describe('TIER_SETTINGS', () => {
  const tiers: PerformanceTier[] = ['low', 'medium', 'high', 'ultra'];

  it('has all 4 performance tiers', () => {
    expect(Object.keys(TIER_SETTINGS)).toHaveLength(4);
    for (const tier of tiers) {
      expect(TIER_SETTINGS[tier]).toBeDefined();
    }
  });

  it.each(tiers)('"%s" tier has valid renderScale (0.5–1.0)', (tier) => {
    const { renderScale } = TIER_SETTINGS[tier];
    expect(renderScale).toBeGreaterThanOrEqual(0.5);
    expect(renderScale).toBeLessThanOrEqual(1.0);
  });

  it.each(tiers)('"%s" tier has positive maxParticles', (tier) => {
    expect(TIER_SETTINGS[tier].maxParticles).toBeGreaterThan(0);
  });

  it('tiers escalate in maxParticles (low < medium < high < ultra)', () => {
    expect(TIER_SETTINGS.low.maxParticles).toBeLessThan(TIER_SETTINGS.medium.maxParticles);
    expect(TIER_SETTINGS.medium.maxParticles).toBeLessThan(TIER_SETTINGS.high.maxParticles);
    expect(TIER_SETTINGS.high.maxParticles).toBeLessThan(TIER_SETTINGS.ultra.maxParticles);
  });

  it('low tier has postFX disabled', () => {
    expect(TIER_SETTINGS.low.enablePostFX).toBe(false);
  });

  it('ultra tier has postFX enabled', () => {
    expect(TIER_SETTINGS.ultra.enablePostFX).toBe(true);
  });
});

describe('saveQualityTier', () => {
  it('does not throw in Node.js (no localStorage)', () => {
    // localStorage is undefined in Node — the function must silently ignore it
    expect(() => saveQualityTier('high')).not.toThrow();
    expect(() => saveQualityTier('low')).not.toThrow();
    expect(() => saveQualityTier('ultra')).not.toThrow();
    expect(() => saveQualityTier('medium')).not.toThrow();
  });
});

describe('watchDeviceChanges', () => {
  it('returns a function (cleanup) in Node.js', () => {
    const cleanup = watchDeviceChanges(() => { /* noop */ });
    expect(typeof cleanup).toBe('function');
  });

  it('cleanup function does not throw when called in Node.js', () => {
    const cleanup = watchDeviceChanges(() => { /* noop */ });
    expect(() => cleanup()).not.toThrow();
  });
});
