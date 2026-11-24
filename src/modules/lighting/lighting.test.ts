import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BiomeId, Vec3 } from '../../contracts/types';
import { BIOME_CONFIG } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { createLightingDirector, LightingDirector } from './index';

describe('LightingDirector', () => {
  it('initializes dark-fantasy atmosphere rig with HemisphereLight, shadow DirectionalLight, and hero lantern', () => {
    const scene = new THREE.Scene();
    const director = createLightingDirector();
    expect(director).toBeInstanceOf(LightingDirector);

    director.init(scene);

    let hemiCount = 0;
    let shadowDirLight: THREE.DirectionalLight | null = null;
    let heroLantern: THREE.PointLight | null = null;

    scene.traverse((obj) => {
      if (obj instanceof THREE.HemisphereLight) {
        hemiCount++;
      } else if (obj instanceof THREE.DirectionalLight && obj.castShadow) {
        shadowDirLight = obj;
      } else if (obj instanceof THREE.PointLight && obj.name === 'HeroLanternPointLight') {
        heroLantern = obj;
      }
    });

    expect(hemiCount).toBe(1);
    expect(shadowDirLight).not.toBeNull();
    expect(heroLantern).not.toBeNull();
    expect((heroLantern as unknown as THREE.PointLight).intensity).toBeGreaterThan(0);

    director.dispose();
  });

  it('snaps DirectionalLight shadow rig to light-space texels to prevent shadow shimmer', () => {
    const scene = new THREE.Scene();
    const director = createLightingDirector();
    director.init(scene);

    let dirLight!: THREE.DirectionalLight;
    scene.traverse((obj) => {
      if (obj instanceof THREE.DirectionalLight) {
        dirLight = obj;
      }
    });

    director.update(1 / 60, { x: 10.0, y: 0, z: 10.0 });
    const initialTarget = dirLight.target.position.clone();
    const initialLightPos = dirLight.position.clone();

    // Sub-millimeter movement well within 1 shadow texel (~0.025m) must not shift the frustum
    director.update(1 / 60, { x: 10.001, y: 0.4, z: 10.001 });
    expect(dirLight.target.position.distanceTo(initialTarget)).toBeLessThan(1e-6);
    expect(dirLight.position.distanceTo(initialLightPos)).toBeLessThan(1e-6);

    // Larger player movement tracks playerPos cleanly
    director.update(1 / 60, { x: 24.0, y: 0, z: -12.0 });
    expect(dirLight.target.position.x).toBeCloseTo(24.0, 0);
    expect(dirLight.target.position.z).toBeCloseTo(-12.0, 0);

    director.dispose();
  });

  it('applies BIOME_CONFIG FogExp2 across all 8 biomes and pools active wall torches to the closest 8 lights', () => {
    const scene = new THREE.Scene();
    const director = createLightingDirector();
    director.init(scene);

    const torches: Vec3[] = [];
    for (let i = 0; i < 24; i++) {
      torches.push({ x: i * 4, y: 2.2, z: 0 });
    }

    const biomes: BiomeId[] = [
      'sanctuary',
      'crypt',
      'caverns',
      'forge',
      'void',
      'cathedral',
      'observatory',
      'colosseum',
    ];
    for (const biome of biomes) {
      director.applyBiome(biome, torches);
      expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
      const fog = scene.fog as THREE.FogExp2;
      expect(fog.color.getHex()).toBe(BIOME_CONFIG[biome].fogColorHex);
      expect(fog.density).toBeCloseTo(BIOME_CONFIG[biome].fogDensity, 5);
    }

    director.update(0.016, { x: 20, y: 0, z: 0 });

    const torchLights: THREE.PointLight[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.PointLight && obj.name.startsWith('TorchPointLight_')) {
        torchLights.push(obj);
      }
    });

    expect(torchLights.length).toBe(8);
    const activeLights = torchLights.filter((l) => l.intensity > 0);
    expect(activeLights.length).toBe(8);

    // Verify closest torches around x=20 are selected and organically flicker over time
    for (const light of activeLights) {
      expect(Math.abs(light.position.x - 20)).toBeLessThanOrEqual(18);
    }

    const sampleIntensitiesBefore = activeLights.map((l) => l.intensity);
    director.update(0.09, { x: 20, y: 0, z: 0 });
    const sampleIntensitiesAfter = activeLights.map((l) => l.intensity);
    const anyFlickered = sampleIntensitiesAfter.some(
      (val, idx) => Math.abs(val - sampleIntensitiesBefore[idx]) > 1e-4,
    );
    expect(anyFlickered).toBe(true);

    director.dispose();
  });

  it('smoothly transitions setEventAtmosphere across blood_moon, darkness_escort, awakening, and none', () => {
    const scene = new THREE.Scene();
    const director = createLightingDirector();
    director.init(scene);
    director.applyBiome('cathedral', []);

    let dirLight!: THREE.DirectionalLight;
    let hemiLight!: THREE.HemisphereLight;
    let heroLantern!: THREE.PointLight;
    scene.traverse((obj) => {
      if (obj instanceof THREE.DirectionalLight) dirLight = obj;
      if (obj instanceof THREE.HemisphereLight) hemiLight = obj;
      if (obj instanceof THREE.PointLight && obj.name === 'HeroLanternPointLight') {
        heroLantern = obj;
      }
    });

    const baseDirIntensity = dirLight.intensity;
    const baseFogDensity = (scene.fog as THREE.FogExp2).density;
    const pos = { x: 0, y: 0, z: 0 };

    // 1. Blood Moon (Butcher crimson blackout) — also verify idempotence under 120Hz polling
    director.setEventAtmosphere?.('blood_moon');
    for (let i = 0; i < 60; i++) {
      director.setEventAtmosphere?.('blood_moon');
      director.update(1 / 60, pos);
    }
    const bloodFog = scene.fog as THREE.FogExp2;
    expect(bloodFog.density).toBeGreaterThan(baseFogDensity * 1.3);
    expect(dirLight.color.r).toBeGreaterThan(dirLight.color.b * 3);
    expect(dirLight.intensity).toBeLessThan(baseDirIntensity);

    // 2. Darkness Escort (claustrophobic pitch-dark)
    director.setEventAtmosphere?.('darkness_escort');
    for (let i = 0; i < 60; i++) {
      director.update(1 / 60, pos);
    }
    expect(bloodFog.density).toBeGreaterThan(0.04);
    expect(dirLight.intensity).toBeLessThan(baseDirIntensity * 0.3);
    expect(heroLantern.distance).toBeCloseTo(9.5, 1);

    // 3. Awakening (golden-violet sovereign radiance)
    director.setEventAtmosphere?.('awakening');
    for (let i = 0; i < 60; i++) {
      director.update(1 / 60, pos);
    }
    expect(bloodFog.density).toBeLessThan(baseFogDensity);
    expect(hemiLight.intensity).toBeGreaterThan(1.8);
    expect(dirLight.intensity).toBeGreaterThan(baseDirIntensity * 1.15);

    // 4. Return to 'none' converges cleanly back to BIOME_CONFIG.cathedral
    director.setEventAtmosphere?.('none');
    for (let i = 0; i < 90; i++) {
      director.update(1 / 60, pos);
    }
    expect(bloodFog.density).toBeCloseTo(BIOME_CONFIG.cathedral.fogDensity, 4);
    expect(bloodFog.color.getHex()).toBe(BIOME_CONFIG.cathedral.fogColorHex);

    director.dispose();
  });

  it('responds to triggerFlash and eventBus lighting/combat/expansion flashes and decays cleanly', () => {
    const scene = new THREE.Scene();
    const director = createLightingDirector();
    director.init(scene);
    director.applyBiome('observatory', []);

    let flashLight!: THREE.PointLight;
    scene.traverse((obj) => {
      if (obj instanceof THREE.PointLight && obj.name === 'EventFlashPointLight') {
        flashLight = obj;
      }
    });

    expect(flashLight.intensity).toBe(0);

    eventBus.emit('combat:parryTriggered', {
      position: { x: 0, y: 0, z: 0 },
      counterSuccess: true,
    });
    expect(flashLight.intensity).toBeGreaterThan(8);

    // Explicit lighting:flash overrides weaker active flash
    eventBus.emit('lighting:flash', {
      colorHex: 0xffd43b,
      intensity: 4.0,
      durationSec: 0.4,
    });

    expect(flashLight.intensity).toBeGreaterThan(15);
    expect(flashLight.color.getHex()).toBe(0xffd43b);

    // Finish flash duration
    for (let i = 0; i < 7; i++) {
      director.update(0.1, { x: 0, y: 0, z: 0 });
    }
    expect(flashLight.intensity).toBe(0);

    director.dispose();

    // After dispose(), emitting lighting:flash must not affect disposed instance
    eventBus.emit('lighting:flash', {
      colorHex: 0xffffff,
      intensity: 5.0,
      durationSec: 0.5,
    });
    expect(flashLight.intensity).toBe(0);
  });
});
