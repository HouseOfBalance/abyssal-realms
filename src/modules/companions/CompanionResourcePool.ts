import * as THREE from 'three';
import type { IMaterialLibrary, MaterialKey } from '../../contracts/types';

/**
 * Tracks all owned GPU geometries, cloned/custom materials, and procedural textures
 * created by CompanionSystem so `dispose()` releases 100% of module-owned GPU resources
 * without ever disposing shared materials owned by `IMaterialLibrary`.
 */
export class CompanionResourcePool {
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private materialLib: IMaterialLibrary | null = null;

  public setMaterialLibrary(lib: IMaterialLibrary | null): void {
    this.materialLib = lib;
  }

  public trackGeometry<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.add(geo);
    return geo;
  }

  public trackMaterial<T extends THREE.Material>(mat: T): T {
    this.ownedMaterials.add(mat);
    return mat;
  }

  public trackTexture<T extends THREE.Texture>(tex: T): T {
    this.textures.add(tex);
    return tex;
  }

  /**
   * Clones a base material from `IMaterialLibrary` (or synthesizes a headless-safe
   * PBR fallback if called before `init`) and applies optional PBR overrides.
   */
  public cloneLibraryMaterial(
    key: MaterialKey,
    overrides?: {
      colorHex?: number;
      emissiveHex?: number;
      emissiveIntensity?: number;
      roughness?: number;
      metalness?: number;
      side?: THREE.Side;
      transparent?: boolean;
      opacity?: number;
    },
  ): THREE.MeshStandardMaterial {
    let mat: THREE.MeshStandardMaterial;
    if (this.materialLib) {
      mat = this.materialLib.clone(key);
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: overrides?.colorHex ?? 0x888888,
        roughness: 0.55,
        metalness: 0.25,
      });
    }

    if (overrides) {
      if (overrides.colorHex !== undefined) mat.color.setHex(overrides.colorHex);
      if (overrides.emissiveHex !== undefined) mat.emissive.setHex(overrides.emissiveHex);
      if (overrides.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = overrides.emissiveIntensity;
      }
      if (overrides.roughness !== undefined) mat.roughness = overrides.roughness;
      if (overrides.metalness !== undefined) mat.metalness = overrides.metalness;
      if (overrides.side !== undefined) mat.side = overrides.side;
      if (overrides.transparent !== undefined) mat.transparent = overrides.transparent;
      if (overrides.opacity !== undefined) mat.opacity = overrides.opacity;
    }

    return this.trackMaterial(mat);
  }

  public createAdditiveGlowMaterial(
    colorHex: number,
    opacity = 0.78,
    doubleSided = true,
  ): THREE.MeshBasicMaterial {
    return this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      }),
    );
  }

  public createRadialAuraTexture(innerHex: number, outerHex: number, size = 64): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    const inner = new THREE.Color(innerHex);
    const outer = new THREE.Color(outerHex);
    const tmp = new THREE.Color();
    const half = (size - 1) * 0.5;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        const r = Math.hypot(dx, dy);
        const idx = (y * size + x) * 4;
        if (r > 1.0) {
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
          continue;
        }
        const ringBand = Math.exp(-Math.pow((r - 0.76) / 0.12, 2));
        const softCore = Math.max(0, 1 - r * 1.15) * 0.35;
        const alpha = Math.min(1, ringBand * 0.88 + softCore);
        tmp.copy(inner).lerp(outer, Math.min(1, r));
        data[idx] = Math.round(tmp.r * 255);
        data[idx + 1] = Math.round(tmp.g * 255);
        data[idx + 2] = Math.round(tmp.b * 255);
        data[idx + 3] = Math.round(alpha * 255);
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return this.trackTexture(tex);
  }

  public getCounts(): { geometries: number; materials: number; textures: number } {
    return {
      geometries: this.geometries.size,
      materials: this.ownedMaterials.size,
      textures: this.textures.size,
    };
  }

  public disposeAll(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.geometries.clear();

    for (const mat of this.ownedMaterials) {
      mat.dispose();
    }
    this.ownedMaterials.clear();

    for (const tex of this.textures) {
      tex.dispose();
    }
    this.textures.clear();
    this.materialLib = null;
  }
}
