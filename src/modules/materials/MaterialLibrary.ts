import * as THREE from 'three';
import type { IMaterialLibrary, MaterialKey, Vec3 } from '../../contracts/types';
import { TileableBasis } from './noise';
import { ALL_MATERIAL_KEYS, synthesizeMaterialByKey } from './recipes';
import {
  attachMaterialShaderHook,
  createSharedShaderUniforms,
  updateSharedShaderUniforms,
  type SharedShaderUniforms,
} from './shaders';

interface CachedMaterialBundle {
  key: MaterialKey;
  material: THREE.MeshStandardMaterial;
  colorMap: THREE.Texture;
  bumpMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  emissiveMap?: THREE.Texture;
}

const VALID_KEYS = new Set<string>(ALL_MATERIAL_KEYS);
const DEFAULT_FALLBACK_KEY: MaterialKey = 'wall_stone';

function probeCanvas2DSupport(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return false;
  }
  try {
    const probe = document.createElement('canvas');
    probe.width = 2;
    probe.height = 2;
    const ctx = probe.getContext('2d');
    return Boolean(
      ctx &&
        typeof ctx.createImageData === 'function' &&
        typeof ctx.putImageData === 'function',
    );
  } catch {
    return false;
  }
}

function createProceduralTexture(
  rgbaData: Uint8ClampedArray,
  size: number,
  isSrgb: boolean,
  repeatX = 1,
  repeatY = 1,
  useCanvas2D = true,
): THREE.Texture {
  let texture: THREE.Texture | null = null;

  if (useCanvas2D && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx && typeof ctx.createImageData === 'function' && typeof ctx.putImageData === 'function') {
        const imgData = ctx.createImageData(size, size);
        imgData.data.set(rgbaData);
        ctx.putImageData(imgData, 0, 0);
        texture = new THREE.CanvasTexture(canvas);
      }
    } catch {
      texture = null;
    }
  }

  if (!texture) {
    // Graceful headless / Node / mocked-DOM fallback with genuine RGBA pixel buffer
    const rawBytes = new Uint8Array(rgbaData.length);
    rawBytes.set(rgbaData);
    const dataTex = new THREE.DataTexture(
      rawBytes,
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    dataTex.magFilter = THREE.LinearFilter;
    dataTex.minFilter = THREE.LinearMipmapLinearFilter;
    dataTex.generateMipmaps = true;
    texture = dataTex;
  }

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeatX !== 1 || repeatY !== 1) {
    texture.repeat.set(repeatX, repeatY);
  }
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural Dark-Fantasy PBR Material Library.
 * Synthesizes seamlessly tileable color, bump, roughness, and emissive maps for all 21 MaterialKeys
 * using HTML5 Canvas (`THREE.CanvasTexture`) in browser DOM and `THREE.DataTexture` in headless/Node,
 * enhanced with custom GLSL `onBeforeCompile` shader hooks for animated magma, arcane pulse waves,
 * and dark-fantasy Fresnel rim-lighting.
 */
export class MaterialLibrary implements IMaterialLibrary {
  private readonly bundles = new Map<MaterialKey, CachedMaterialBundle>();
  private readonly clones = new Set<THREE.MeshStandardMaterial>();
  private readonly customTextureSize?: number;
  private readonly sharedUniforms: SharedShaderUniforms = createSharedShaderUniforms();
  private basis: TileableBasis | null = null;
  private canUseCanvas2D: boolean | null = null;

  constructor(textureSize?: number) {
    this.customTextureSize = textureSize;
  }

  get(key: MaterialKey): THREE.MeshStandardMaterial {
    return this.ensureBundle(this.resolveKey(key)).material;
  }

  clone(key: MaterialKey): THREE.MeshStandardMaterial {
    const base = this.get(key);
    const cloned = base.clone();
    cloned.name = `${base.name}_clone`;
    this.trackClone(cloned);
    return cloned;
  }

  getTexture(key: MaterialKey): THREE.Texture {
    return this.ensureBundle(this.resolveKey(key)).colorMap;
  }

  updateShaders(elapsedSec: number, playerPos?: Vec3): void {
    updateSharedShaderUniforms(this.sharedUniforms, elapsedSec, playerPos);
  }

  dispose(): void {
    const activeClones = Array.from(this.clones);
    this.clones.clear();
    for (const clonedMat of activeClones) {
      clonedMat.dispose();
    }

    for (const bundle of this.bundles.values()) {
      bundle.material.dispose();
      bundle.colorMap.dispose();
      bundle.bumpMap.dispose();
      bundle.roughnessMap.dispose();
      bundle.emissiveMap?.dispose();
    }
    this.bundles.clear();
    this.basis = null;
    this.canUseCanvas2D = null;
    this.sharedUniforms.uProcTime.value = 0;
    this.sharedUniforms.uProcPlayerPos.value.set(0, 0, 0);
  }

  private trackClone(cloned: THREE.MeshStandardMaterial): void {
    if (this.clones.has(cloned)) {
      return;
    }
    this.clones.add(cloned);
    const onDispose = () => {
      cloned.removeEventListener('dispose', onDispose);
      this.clones.delete(cloned);
    };
    cloned.addEventListener('dispose', onDispose);
  }

  private resolveKey(key: MaterialKey): MaterialKey {
    return VALID_KEYS.has(key) ? key : DEFAULT_FALLBACK_KEY;
  }

  private ensureBasis(): { basis: TileableBasis; useCanvas2D: boolean } {
    if (this.canUseCanvas2D === null) {
      this.canUseCanvas2D = probeCanvas2DSupport();
    }
    if (!this.basis) {
      const defaultSize = this.canUseCanvas2D ? 256 : 64;
      const targetSize = this.customTextureSize ?? defaultSize;
      this.basis = new TileableBasis(targetSize);
    }
    return { basis: this.basis, useCanvas2D: this.canUseCanvas2D };
  }

  private ensureBundle(key: MaterialKey): CachedMaterialBundle {
    const existing = this.bundles.get(key);
    if (existing) {
      return existing;
    }

    const { basis, useCanvas2D } = this.ensureBasis();
    const { buffers, pbr } = synthesizeMaterialByKey(key, basis);
    const repeatX = pbr.repeatX ?? 1;
    const repeatY = pbr.repeatY ?? 1;

    const colorMap = createProceduralTexture(
      buffers.colorData,
      buffers.size,
      true,
      repeatX,
      repeatY,
      useCanvas2D,
    );
    colorMap.name = `${key}_color`;

    const bumpMap = createProceduralTexture(
      buffers.bumpData,
      buffers.size,
      false,
      repeatX,
      repeatY,
      useCanvas2D,
    );
    bumpMap.name = `${key}_bump`;

    const roughnessMap = createProceduralTexture(
      buffers.roughnessData,
      buffers.size,
      false,
      repeatX,
      repeatY,
      useCanvas2D,
    );
    roughnessMap.name = `${key}_roughness`;

    let emissiveMap: THREE.Texture | undefined;
    if (buffers.emissiveData) {
      emissiveMap = createProceduralTexture(
        buffers.emissiveData,
        buffers.size,
        true,
        repeatX,
        repeatY,
        useCanvas2D,
      );
      emissiveMap.name = `${key}_emissive`;
    }

    const params: THREE.MeshStandardMaterialParameters = {
      name: key,
      color: 0xffffff,
      map: colorMap,
      bumpMap,
      bumpScale: pbr.bumpScale,
      roughnessMap,
      roughness: pbr.roughness,
      metalness: pbr.metalness,
      envMapIntensity: pbr.envMapIntensity ?? 1.0,
    };

    if (pbr.emissiveHex !== undefined) {
      params.emissive = new THREE.Color(pbr.emissiveHex);
      params.emissiveIntensity = pbr.emissiveIntensity ?? 1.0;
      if (emissiveMap) {
        params.emissiveMap = emissiveMap;
      }
    }

    const material = new THREE.MeshStandardMaterial(params);
    attachMaterialShaderHook(material, key, this.sharedUniforms, (cloned) =>
      this.trackClone(cloned),
    );

    const bundle: CachedMaterialBundle = {
      key,
      material,
      colorMap,
      bumpMap,
      roughnessMap,
      emissiveMap,
    };

    this.bundles.set(key, bundle);
    return bundle;
  }
}

export function createMaterialLibrary(): IMaterialLibrary {
  return new MaterialLibrary();
}
