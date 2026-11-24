import * as THREE from 'three';
import type { GameSettings } from '../../contracts/types';

export type GraphicsQuality = GameSettings['graphicsQuality'];

export interface QualityPresetConfig {
  readonly quality: GraphicsQuality;
  readonly maxPixelRatio: number;
  readonly shadowMapSize: number;
  readonly bloomEnabled: boolean;
  readonly msaaSamples: number;
}

export const QUALITY_PRESETS: Record<GraphicsQuality, QualityPresetConfig> = {
  low: {
    quality: 'low',
    maxPixelRatio: 1.0,
    shadowMapSize: 512,
    bloomEnabled: false,
    msaaSamples: 0,
  },
  medium: {
    quality: 'medium',
    maxPixelRatio: 1.5,
    shadowMapSize: 1024,
    bloomEnabled: true,
    msaaSamples: 2,
  },
  high: {
    quality: 'high',
    maxPixelRatio: 2.0,
    shadowMapSize: 2048,
    bloomEnabled: true,
    msaaSamples: 4,
  },
};

export function resolveQualityPreset(quality: GraphicsQuality): QualityPresetConfig {
  if (quality === 'low' || quality === 'medium' || quality === 'high') {
    return QUALITY_PRESETS[quality];
  }
  return QUALITY_PRESETS.high;
}

/**
 * Traverses the scene and resizes shadow maps on any shadow-capable lights.
 * Disposes and clears existing GPU shadow render targets when dimensions change
 * so Three.js WebGLShadowMap reallocates them at the new resolution on next render.
 */
export function applySceneShadowQuality(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  shadowMapSize: number,
): void {
  let changed = false;

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Light) || !obj.castShadow || !obj.shadow) {
      return;
    }

    // PointLightShadow renders a 6-face atlas (4x2 tiles), so cap omnidirectional lights at 512.
    const targetSize =
      obj instanceof THREE.PointLight ? Math.min(shadowMapSize, 512) : shadowMapSize;

    const shadow = obj.shadow;
    if (shadow.mapSize.x !== targetSize || shadow.mapSize.y !== targetSize) {
      shadow.mapSize.set(targetSize, targetSize);
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
      if (shadow.mapPass) {
        shadow.mapPass.dispose();
        shadow.mapPass = null;
      }
      shadow.needsUpdate = true;
      changed = true;
    }
  });

  if (changed) {
    renderer.shadowMap.needsUpdate = true;
  }
}

/**
 * Frees any allocated shadow map render targets across lights in the scene.
 */
export function disposeSceneShadowMaps(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Light) || !obj.shadow) {
      return;
    }
    if (obj.shadow.map) {
      obj.shadow.map.dispose();
      obj.shadow.map = null;
    }
    if (obj.shadow.mapPass) {
      obj.shadow.mapPass.dispose();
      obj.shadow.mapPass = null;
    }
  });
}
