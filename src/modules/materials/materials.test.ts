import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { MaterialKey } from '../../contracts/types';
import {
  ALL_MATERIAL_KEYS,
  MaterialLibrary,
  createMaterialLibrary,
  getShaderProfileForKey,
} from './index';
import { periodicFbm, periodicWorley } from './noise';

describe('MaterialLibrary (proc-materials)', () => {
  it('covers all 28 MaterialKey values (including Phase 3 expansion) with realistic PBR maps and parameters', () => {
    expect(ALL_MATERIAL_KEYS.length).toBe(28);
    const lib = new MaterialLibrary(32);

    for (const key of ALL_MATERIAL_KEYS) {
      const mat = lib.get(key);
      expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mat.name).toBe(key);

      // Color, bump, and roughness maps must all exist and tile seamlessly
      expect(mat.map).toBeTruthy();
      expect(mat.bumpMap).toBeTruthy();
      expect(mat.roughnessMap).toBeTruthy();
      expect(mat.map!.wrapS).toBe(THREE.RepeatWrapping);
      expect(mat.map!.wrapT).toBe(THREE.RepeatWrapping);
      expect(mat.bumpMap!.wrapS).toBe(THREE.RepeatWrapping);
      expect(mat.roughnessMap!.wrapS).toBe(THREE.RepeatWrapping);

      expect(mat.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(mat.bumpMap!.colorSpace).toBe(THREE.NoColorSpace);
      expect(mat.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);

      // Realistic PBR ranges
      expect(mat.roughness).toBeGreaterThan(0.05);
      expect(mat.roughness).toBeLessThanOrEqual(1.0);
      expect(mat.metalness).toBeGreaterThanOrEqual(0.0);
      expect(mat.metalness).toBeLessThanOrEqual(1.0);
      expect(mat.bumpScale).toBeGreaterThan(0.05);
      expect(Number.isNaN(mat.roughness)).toBe(false);
      expect(Number.isNaN(mat.metalness)).toBe(false);
      expect(Number.isNaN(mat.bumpScale)).toBe(false);

      expect(lib.getTexture(key)).toBe(mat.map);
    }

    // Metallic materials (including brass_clockwork) should have high metalness vs dielectric stone/cloth
    expect(lib.get('metal_gold').metalness).toBeGreaterThan(0.8);
    expect(lib.get('metal_steel').metalness).toBeGreaterThan(0.8);
    expect(lib.get('metal_dark_iron').metalness).toBeGreaterThan(0.75);
    expect(lib.get('brass_clockwork').metalness).toBeGreaterThan(0.85);
    expect(lib.get('wall_stone').metalness).toBeLessThan(0.15);
    expect(lib.get('cloth_crimson').metalness).toBeLessThan(0.15);

    // Specular mirror-ice & glacier materials must be ultra-slick
    expect(lib.get('floor_cathedral').roughness).toBeLessThan(0.22);
    expect(lib.get('ice_glacier').roughness).toBeLessThan(0.20);

    // Emissive runes, crystal, glacier, mythic_crimson, and lava must glow strongly
    const emissiveKeys: MaterialKey[] = [
      'rune_glow_blue',
      'rune_glow_crimson',
      'rune_glow_emerald',
      'rune_glow_void',
      'crystal_cyan',
      'ice_glacier',
      'mythic_crimson',
      'lava_emissive',
    ];
    for (const key of emissiveKeys) {
      const mat = lib.get(key);
      expect(mat.emissiveIntensity).toBeGreaterThan(1.0);
      expect(mat.emissive.getHex()).toBeGreaterThan(0);
      expect(mat.emissiveMap).toBeTruthy();
      expect(mat.emissiveMap!.colorSpace).toBe(THREE.SRGBColorSpace);
    }

    lib.dispose();
  });

  it('caches materials for fast get(key) and isolates per-entity mutations in clone(key)', () => {
    const lib = createMaterialLibrary();

    const baseStone = lib.get('wall_stone');
    expect(lib.get('wall_stone')).toBe(baseStone);

    const wallFadeClone = lib.clone('wall_stone');
    expect(wallFadeClone).not.toBe(baseStone);
    expect(wallFadeClone.map).toBe(baseStone.map);
    expect(wallFadeClone.bumpMap).toBe(baseStone.bumpMap);

    // Mutating clone opacity/tint for wall occlusion or enemy hit-flash must not affect cached base
    wallFadeClone.transparent = true;
    wallFadeClone.opacity = 0.25;
    wallFadeClone.color.setHex(0xff3333);

    expect(baseStone.transparent).toBe(false);
    expect(baseStone.opacity).toBe(1);
    expect(baseStone.color.getHex()).toBe(0xffffff);

    lib.dispose();
  });

  it('produces genuine THREE.CanvasTexture when HTML5 Canvas 2D context is available', () => {
    const originalDoc = (globalThis as Record<string, unknown>).document;

    const putImageDataSpy = vi.fn();
    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: (ctxId: string) =>
              ctxId === '2d'
                ? {
                    createImageData: (w: number, h: number) => ({
                      width: w,
                      height: h,
                      data: new Uint8ClampedArray(w * h * 4),
                    }),
                    putImageData: putImageDataSpy,
                  }
                : null,
          };
        }
        return {};
      },
    };

    try {
      const lib = new MaterialLibrary(32);
      const tex = lib.getTexture('lava_emissive');
      expect(tex).toBeInstanceOf(THREE.CanvasTexture);
      expect(putImageDataSpy).toHaveBeenCalled();
      lib.dispose();
    } finally {
      (globalThis as Record<string, unknown>).document = originalDoc;
    }
  });

  it('disposes all cached materials, clones, and textures cleanly', () => {
    const lib = new MaterialLibrary(32);
    const base = lib.get('rune_glow_void');
    const cloned = lib.clone('rune_glow_void');

    const baseDispose = vi.spyOn(base, 'dispose');
    const cloneDispose = vi.spyOn(cloned, 'dispose');
    const mapDispose = vi.spyOn(base.map!, 'dispose');
    const bumpDispose = vi.spyOn(base.bumpMap!, 'dispose');
    const roughDispose = vi.spyOn(base.roughnessMap!, 'dispose');
    const emitDispose = vi.spyOn(base.emissiveMap!, 'dispose');

    lib.dispose();

    expect(baseDispose).toHaveBeenCalledOnce();
    expect(cloneDispose).toHaveBeenCalledOnce();
    expect(mapDispose).toHaveBeenCalledOnce();
    expect(bumpDispose).toHaveBeenCalledOnce();
    expect(roughDispose).toHaveBeenCalledOnce();
    expect(emitDispose).toHaveBeenCalledOnce();

    // Re-requesting after dispose cleanly synthesizes a fresh material
    const fresh = lib.get('rune_glow_void');
    expect(fresh).not.toBe(base);
    lib.dispose();
  });

  it('guarantees seamless periodic continuity across UV wrap boundaries [0, 1)', () => {
    for (let i = 0; i < 8; i++) {
      const t = i / 8;
      expect(periodicFbm(0, t, 4, 4, 42)).toBeCloseTo(periodicFbm(1, t, 4, 4, 42), 6);
      expect(periodicFbm(t, 0, 4, 4, 42)).toBeCloseTo(periodicFbm(t, 1, 4, 4, 42), 6);

      const wLeft = periodicWorley(0, t, 6, 0.85, 99);
      const wRight = periodicWorley(1, t, 6, 0.85, 99);
      expect(wLeft.edge).toBeCloseTo(wRight.edge, 6);
    }
  });

  it('wires all 5 custom GLSL onBeforeCompile shader profiles (including glacial_rime & mythic_plasma) and updates uniforms live', () => {
    const lib = new MaterialLibrary(32);

    const magmaKeys: MaterialKey[] = ['lava_emissive', 'floor_forge'];
    const arcaneKeys: MaterialKey[] = [
      'rune_glow_blue',
      'rune_glow_crimson',
      'rune_glow_emerald',
      'rune_glow_void',
      'floor_void',
      'floor_sanctuary',
      'floor_observatory',
      'crystal_cyan',
    ];
    const glacialKeys: MaterialKey[] = ['floor_cathedral', 'ice_glacier'];
    const fresnelKeys: MaterialKey[] = [
      'metal_steel',
      'metal_gold',
      'metal_dark_iron',
      'brass_clockwork',
      'cloth_crimson',
      'cloth_shadow',
      'cloth_arcane',
      'bone',
      'flesh_demon',
      'floor_colosseum',
    ];

    for (const k of magmaKeys) expect(getShaderProfileForKey(k)).toBe('magma_flow');
    for (const k of arcaneKeys) expect(getShaderProfileForKey(k)).toBe('arcane_pulse');
    for (const k of glacialKeys) expect(getShaderProfileForKey(k)).toBe('glacial_rime');
    expect(getShaderProfileForKey('mythic_crimson')).toBe('mythic_plasma');
    for (const k of fresnelKeys) expect(getShaderProfileForKey(k)).toBe('fresnel_rim');

    const compileMockShader = (mat: THREE.MeshStandardMaterial) => {
      const shaderObj = {
        uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      };
      mat.onBeforeCompile(
        shaderObj as unknown as THREE.WebGLProgramParametersWithUniforms,
        {} as THREE.WebGLRenderer,
      );
      return shaderObj;
    };

    const lavaShader = compileMockShader(lib.get('lava_emissive'));
    expect(lavaShader.vertexShader).toContain('vProcWorldPos');
    expect(lavaShader.fragmentShader).toContain('uProcFlowStrength');
    expect(lavaShader.fragmentShader).toContain('#include <emissivemap_fragment>');

    const runeShader = compileMockShader(lib.get('rune_glow_void'));
    expect(runeShader.fragmentShader).toContain('uProcArcaneAccent');
    expect(runeShader.fragmentShader).toContain('procHeroRipple');

    const glacierShader = compileMockShader(lib.get('ice_glacier'));
    expect(glacierShader.fragmentShader).toContain('uProcDeepCryo');
    expect(glacierShader.fragmentShader).toContain('procCrystalGlint');

    const mythicShader = compileMockShader(lib.get('mythic_crimson'));
    expect(mythicShader.fragmentShader).toContain('uProcPrimalColor');
    expect(mythicShader.fragmentShader).toContain('uProcCoronaGold');

    // Verify both lib.clone(key) and direct mat.clone() preserve custom GLSL shader hooks
    const brassCloneA = lib.clone('brass_clockwork');
    const fleshCloneB = lib.get('flesh_demon').clone();
    const fresnelShaderA = compileMockShader(brassCloneA);
    const fresnelShaderB = compileMockShader(fleshCloneB);

    expect(brassCloneA.customProgramCacheKey()).toBe('abyssal_proc_fresnel_rim_v1');
    expect(fresnelShaderA.fragmentShader).toContain('uProcRimColor');
    expect(fresnelShaderB.fragmentShader).toContain('uProcRimColor');

    // Live uniform synchronization via updateShaders(elapsedSec, playerPos)
    lib.updateShaders(12.75, { x: 14.5, y: 0.2, z: -8.25 });

    expect(lavaShader.uniforms.uProcTime.value).toBeCloseTo(12.75, 5);
    expect(runeShader.uniforms.uProcTime.value).toBeCloseTo(12.75, 5);
    expect(glacierShader.uniforms.uProcTime.value).toBeCloseTo(12.75, 5);
    expect(mythicShader.uniforms.uProcTime.value).toBeCloseTo(12.75, 5);
    expect(fresnelShaderA.uniforms.uProcTime.value).toBeCloseTo(12.75, 5);
    expect(fresnelShaderB.uniforms.uProcTime.value).toBeCloseTo(12.75, 5);
    expect(lavaShader.uniforms.uProcPlayerPos.value.x).toBeCloseTo(14.5, 5);
    expect(lavaShader.uniforms.uProcPlayerPos.value.z).toBeCloseTo(-8.25, 5);

    // Guard against NaN inputs safely
    lib.updateShaders(Number.NaN, { x: Number.NaN, y: 0, z: 0 });
    expect(lavaShader.uniforms.uProcTime.value).toBeCloseTo(12.75, 5);
    expect(lavaShader.uniforms.uProcPlayerPos.value.x).toBeCloseTo(14.5, 5);

    lib.dispose();
  });
});
