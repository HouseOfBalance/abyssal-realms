import * as THREE from 'three';
import type { IMaterialLibrary, MaterialKey } from '../../contracts/types';
import { clamp } from '../../core/Constants';
import {
  attachDissolveShaderHook,
  configureDissolveBundleTheme,
  createDissolveUniformBundle,
  type DissolveTheme,
  type DissolveUniformBundle,
} from './dissolveShader';

export type LocomotionStyle = 'biped' | 'heavy_biped' | 'floating' | 'arachnid' | 'quadruped';

export type AttackStyle =
  | 'melee_slash'
  | 'melee_slam'
  | 'bow_shot'
  | 'staff_cast'
  | 'twin_dash'
  | 'arachnid_strike'
  | 'bite_lunge'
  | 'boss_sweeping';

export interface ArmChain {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
}

export interface LegChain {
  hip: THREE.Group;
  knee: THREE.Group;
}

export interface SpiderLegChain {
  side: -1 | 1; // -1 = right (-X), +1 = left (+X)
  rowIndex: number; // 0 (front) .. 3 (rear)
  coxa: THREE.Group; // yaw mount on thorax
  femur: THREE.Group; // upper leg pitch/roll
  tibia: THREE.Group; // lower leg knee bend
}

export interface QuadLegChain {
  isFront: boolean;
  side: -1 | 1;
  upper: THREE.Group;
  lower: THREE.Group;
}

export interface WingNode {
  side: -1 | 1;
  pivot: THREE.Group;
  tierIndex?: number;
}

export interface SpinningGearNode {
  node: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  speed: number;
}

export interface TendrilChain {
  segments: THREE.Group[];
  phase: number;
}

export interface OrbiterNode {
  anchor: THREE.Group;
  item: THREE.Group;
  radius: number;
  height: number;
  speed: number;
  phase: number;
  bobAmp: number;
  tiltAmp: number;
}

export interface WeakpointNode {
  mesh: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
  baseScale: number;
  baseIntensity: number;
  phase: number;
}

export interface JointSnapshot {
  node: THREE.Object3D;
  pos: THREE.Vector3;
  rot: THREE.Euler;
  scale: THREE.Vector3;
}

export interface ArticulatedEnemyRig {
  root: THREE.Group;
  modelRoot: THREE.Group;
  eliteRoot: THREE.Group;
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  jaw?: THREE.Group;
  leftArm?: ArmChain;
  rightArm?: ArmChain;
  leftLeg?: LegChain;
  rightLeg?: LegChain;
  spiderLegs: SpiderLegChain[];
  quadLegs: QuadLegChain[];
  tailSegments: THREE.Group[];
  wings: WingNode[];
  tendrils: TendrilChain[];
  orbiters: OrbiterNode[];
  weakpoints: WeakpointNode[];
  crown?: THREE.Group;
  capeSegments: THREE.Group[];
  spinningGears: SpinningGearNode[];
  shadowMeshes: THREE.Mesh[];
  locomotion: LocomotionStyle;
  attackStyle: AttackStyle;
  isBoss: boolean;
  dissolveTheme: DissolveTheme;
  baseScale: number;
  hoverBaseY: number;
  telegraphColorHex: number;
  bodyRadius: number;
  bodyHeight: number;
  restSnapshots: JointSnapshot[];
}

interface MaterialBaseline {
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
  baseEmissive: THREE.Color;
  baseEmissiveIntensity: number;
  baseOpacity: number;
  isAdditiveShell: boolean;
  isAccentGlow: boolean;
}

const FALLBACK_COLORS: Record<
  MaterialKey,
  { color: number; metalness: number; roughness: number; emissive?: number; emissiveIntensity?: number }
> = {
  floor_sanctuary: { color: 0xd8d4c8, metalness: 0.18, roughness: 0.45 },
  floor_crypt: { color: 0x2c303a, metalness: 0.1, roughness: 0.85 },
  floor_caverns: { color: 0x233329, metalness: 0.1, roughness: 0.88 },
  floor_forge: { color: 0x2a1d1a, metalness: 0.2, roughness: 0.8 },
  floor_void: { color: 0x1d1530, metalness: 0.25, roughness: 0.7 },
  floor_cathedral: { color: 0x99d9ea, metalness: 0.3, roughness: 0.18 },
  floor_observatory: { color: 0x262840, metalness: 0.35, roughness: 0.42 },
  floor_colosseum: { color: 0x6e4736, metalness: 0.08, roughness: 0.82 },
  wall_stone: { color: 0x4a4e58, metalness: 0.12, roughness: 0.85 },
  wall_obsidian: { color: 0x181622, metalness: 0.45, roughness: 0.28 },
  metal_steel: { color: 0x9aa3ad, metalness: 0.85, roughness: 0.32 },
  metal_gold: { color: 0xd9a441, metalness: 0.88, roughness: 0.26 },
  metal_dark_iron: { color: 0x353942, metalness: 0.82, roughness: 0.42 },
  brass_clockwork: { color: 0xc48b3f, metalness: 0.86, roughness: 0.28 },
  wood_oak: { color: 0x5c3d28, metalness: 0.05, roughness: 0.85 },
  rune_glow_blue: { color: 0x3bc9db, metalness: 0.2, roughness: 0.25, emissive: 0x22b8cf, emissiveIntensity: 1.8 },
  rune_glow_crimson: { color: 0xe03131, metalness: 0.2, roughness: 0.25, emissive: 0xe03131, emissiveIntensity: 1.9 },
  rune_glow_emerald: { color: 0x40c057, metalness: 0.2, roughness: 0.25, emissive: 0x37b24d, emissiveIntensity: 1.9 },
  rune_glow_void: { color: 0xae3ec9, metalness: 0.25, roughness: 0.25, emissive: 0x9c36b5, emissiveIntensity: 2.0 },
  crystal_cyan: { color: 0x66d9e8, metalness: 0.35, roughness: 0.15, emissive: 0x15aabf, emissiveIntensity: 1.4 },
  ice_glacier: { color: 0xa5f3fc, metalness: 0.25, roughness: 0.14, emissive: 0x0ca678, emissiveIntensity: 0.65 },
  mythic_crimson: { color: 0xff2b45, metalness: 0.35, roughness: 0.2, emissive: 0xe01133, emissiveIntensity: 2.4 },
  bone: { color: 0xd8ceb8, metalness: 0.06, roughness: 0.72 },
  flesh_demon: { color: 0x6b2026, metalness: 0.08, roughness: 0.68 },
  cloth_crimson: { color: 0x7a1620, metalness: 0.05, roughness: 0.82 },
  cloth_shadow: { color: 0x1d1e26, metalness: 0.08, roughness: 0.86 },
  cloth_arcane: { color: 0x361d5c, metalness: 0.14, roughness: 0.74 },
  lava_emissive: { color: 0xff6b1a, metalness: 0.1, roughness: 0.35, emissive: 0xff4500, emissiveIntensity: 2.4 },
};

/**
 * Per-handle material, shader uniform, and geometry tracker.
 * Clones materials from IMaterialLibrary once per variant per enemy handle, attaches the
 * custom GLSL Procedural Noise Edge-Burn Dissolve shader hook, and keeps hit flashes,
 * windup telegraphs, and death disintegration completely isolated per entity.
 */
export class HandleAssetRegistry {
  readonly dissolveUniforms: DissolveUniformBundle = createDissolveUniformBundle();
  private readonly cache = new Map<string, MaterialBaseline>();
  private readonly allMaterials = new Set<THREE.Material>();
  private readonly allGeometries = new Set<THREE.BufferGeometry>();
  private readonly tempFlashColor = new THREE.Color();
  private readonly tempTelegraphColor = new THREE.Color();
  private readonly tempMixed = new THREE.Color();

  constructor(private readonly library: IMaterialLibrary) {}

  configureDissolve(theme: DissolveTheme, worldHeight: number): void {
    configureDissolveBundleTheme(this.dissolveUniforms, theme, worldHeight);
  }

  updateDissolve(progress: number, elapsedSec: number, rootWorldPos: THREE.Vector3): void {
    this.dissolveUniforms.uEnemyDissolveProgress.value = clamp(progress, 0, 1);
    this.dissolveUniforms.uEnemyDissolveTime.value = elapsedSec;
    this.dissolveUniforms.uEnemyRootWorldPos.value.copy(rootWorldPos);
  }

  mat(
    key: MaterialKey,
    variant = 'default',
    customize?: (mat: THREE.MeshStandardMaterial) => void,
  ): THREE.MeshStandardMaterial {
    const cacheKey = `${key}::${variant}`;
    const existing = this.cache.get(cacheKey);
    if (existing) {
      return existing.material;
    }

    let cloned: THREE.MeshStandardMaterial | null = null;
    try {
      if (this.library && typeof this.library.clone === 'function') {
        cloned = this.library.clone(key);
      } else if (this.library && typeof this.library.get === 'function') {
        const shared = this.library.get(key);
        if (shared && typeof shared.clone === 'function') {
          cloned = shared.clone();
        }
      }
    } catch {
      cloned = null;
    }

    if (!cloned || !(cloned instanceof THREE.MeshStandardMaterial)) {
      const fb = FALLBACK_COLORS[key];
      cloned = new THREE.MeshStandardMaterial({
        color: fb.color,
        metalness: fb.metalness,
        roughness: fb.roughness,
        emissive: fb.emissive ?? 0x000000,
        emissiveIntensity: fb.emissiveIntensity ?? 0,
      });
    }

    if (customize) {
      customize(cloned);
    }

    attachDissolveShaderHook(cloned, this.dissolveUniforms);

    const isAccentGlow = cloned.emissiveIntensity > 0.6;
    const baseline: MaterialBaseline = {
      material: cloned,
      baseColor: cloned.color.clone(),
      baseEmissive: cloned.emissive.clone(),
      baseEmissiveIntensity: cloned.emissiveIntensity,
      baseOpacity: cloned.opacity,
      isAdditiveShell: false,
      isAccentGlow,
    };

    this.cache.set(cacheKey, baseline);
    this.allMaterials.add(cloned);
    return cloned;
  }

  glow(
    tag: string,
    colorHex: number,
    emissiveIntensity = 2.2,
    options?: { opacity?: number; doubleSide?: boolean; additive?: boolean },
  ): THREE.MeshStandardMaterial {
    const cacheKey = `glow::${tag}::${colorHex}`;
    const existing = this.cache.get(cacheKey);
    if (existing) {
      return existing.material;
    }

    const opacity = options?.opacity ?? 1;
    const isAdditiveShell = Boolean(options?.additive) || opacity < 0.98;
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity,
      roughness: 0.2,
      metalness: 0.15,
      transparent: isAdditiveShell,
      opacity,
      side: options?.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      blending: options?.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !options?.additive && opacity >= 0.95,
    });

    attachDissolveShaderHook(mat, this.dissolveUniforms);

    const baseline: MaterialBaseline = {
      material: mat,
      baseColor: mat.color.clone(),
      baseEmissive: mat.emissive.clone(),
      baseEmissiveIntensity: emissiveIntensity,
      baseOpacity: opacity,
      isAdditiveShell,
      isAccentGlow: true,
    };

    this.cache.set(cacheKey, baseline);
    this.allMaterials.add(mat);
    return mat;
  }

  trackGeometry<T extends THREE.BufferGeometry>(geom: T): T {
    this.allGeometries.add(geom);
    return geom;
  }

  trackMaterial<T extends THREE.Material>(mat: T): T {
    this.allMaterials.add(mat);
    return mat;
  }

  trackHierarchy(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.geometry) {
          this.allGeometries.add(mesh.geometry);
        }
        if (Array.isArray(mesh.material)) {
          for (const m of mesh.material) {
            if (m) this.allMaterials.add(m);
          }
        } else if (mesh.material) {
          this.allMaterials.add(mesh.material);
        }
      }
    });
  }

  applyModulation(
    flashStrength: number,
    flashColorHex: number,
    telegraphStrength: number,
    telegraphColorHex: number,
    deathDimFactor: number,
    dissolveProgress = 0,
  ): void {
    const f = clamp(flashStrength, 0, 1);
    const t = clamp(telegraphStrength, 0, 1);
    const aliveGlowScale = clamp(1 - deathDimFactor * 0.85, 0.08, 1);
    const shellFade = clamp(1 - dissolveProgress * 1.15, 0, 1);

    this.tempFlashColor.setHex(Number.isFinite(flashColorHex) ? flashColorHex : 0xffffff);
    this.tempTelegraphColor.setHex(
      Number.isFinite(telegraphColorHex) ? telegraphColorHex : 0xff5522,
    );

    for (const entry of this.cache.values()) {
      const {
        material,
        baseEmissive,
        baseEmissiveIntensity,
        baseOpacity,
        isAdditiveShell,
        isAccentGlow,
      } = entry;

      this.tempMixed.copy(baseEmissive);
      let intensity = baseEmissiveIntensity * aliveGlowScale;

      if (t > 0.001) {
        const teleWeight = isAccentGlow ? t * 0.65 : t * 0.85;
        this.tempMixed.lerp(this.tempTelegraphColor, teleWeight);
        intensity = Math.max(intensity, (isAccentGlow ? 2.8 : 1.35) * t + baseEmissiveIntensity);
      }

      if (f > 0.001) {
        this.tempMixed.lerp(this.tempFlashColor, f * 0.92);
        intensity = Math.max(intensity, 2.8 * f + baseEmissiveIntensity * 0.5);
      }

      material.emissive.copy(this.tempMixed);
      material.emissiveIntensity = intensity;

      if (isAdditiveShell) {
        material.opacity = baseOpacity * shellFade;
      }
    }
  }

  dispose(): void {
    for (const geom of this.allGeometries) {
      geom.dispose();
    }
    this.allGeometries.clear();

    for (const mat of this.allMaterials) {
      mat.dispose();
    }
    this.allMaterials.clear();
    this.cache.clear();
  }
}

/**
 * Helper class for constructing articulated dark-fantasy 3D silhouettes cleanly.
 */
export class RigBuilder {
  readonly rig: ArticulatedEnemyRig;
  private readonly registeredJoints = new Set<THREE.Object3D>();

  constructor(
    public readonly assets: HandleAssetRegistry,
    options: {
      locomotion: LocomotionStyle;
      attackStyle: AttackStyle;
      isBoss?: boolean;
      dissolveTheme?: DissolveTheme;
      baseScale?: number;
      hoverBaseY?: number;
      telegraphColorHex?: number;
      bodyRadius?: number;
      bodyHeight?: number;
      pelvisY?: number;
      torsoOffsetY?: number;
      headOffsetY?: number;
    },
  ) {
    const root = new THREE.Group();
    root.name = 'enemy_root';

    const eliteRoot = new THREE.Group();
    eliteRoot.name = 'elite_visuals_root';
    root.add(eliteRoot);

    const modelRoot = new THREE.Group();
    modelRoot.name = 'model_root';
    const scale = options.baseScale ?? 1;
    modelRoot.scale.setScalar(scale);
    const hoverY = options.hoverBaseY ?? 0;
    modelRoot.position.y = hoverY;
    root.add(modelRoot);

    const pelvis = this.group('pelvis', modelRoot, 0, options.pelvisY ?? 0.88, 0);
    const torso = this.group('torso', pelvis, 0, options.torsoOffsetY ?? 0.16, 0);
    const head = this.group('head', torso, 0, options.headOffsetY ?? 0.58, 0);

    this.rig = {
      root,
      modelRoot,
      eliteRoot,
      pelvis,
      torso,
      head,
      spiderLegs: [],
      quadLegs: [],
      tailSegments: [],
      wings: [],
      tendrils: [],
      orbiters: [],
      weakpoints: [],
      capeSegments: [],
      spinningGears: [],
      shadowMeshes: [],
      locomotion: options.locomotion,
      attackStyle: options.attackStyle,
      isBoss: options.isBoss ?? false,
      dissolveTheme: options.dissolveTheme ?? 'molten_orange',
      baseScale: scale,
      hoverBaseY: hoverY,
      telegraphColorHex: options.telegraphColorHex ?? 0xff5522,
      bodyRadius: options.bodyRadius ?? 0.55,
      bodyHeight: options.bodyHeight ?? 1.85,
      restSnapshots: [],
    };
  }

  group(
    name: string,
    parent: THREE.Object3D,
    x = 0,
    y = 0,
    z = 0,
    registerForReset = true,
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    if (registerForReset) {
      this.registeredJoints.add(g);
    }
    return g;
  }

  registerJoint(node: THREE.Object3D): void {
    this.registeredJoints.add(node);
  }

  mesh(
    geom: THREE.BufferGeometry,
    mat: THREE.Material,
    parent: THREE.Object3D,
    options?: {
      pos?: [number, number, number];
      rot?: [number, number, number];
      scale?: [number, number, number] | number;
      castShadow?: boolean;
      receiveShadow?: boolean;
      name?: string;
    },
  ): THREE.Mesh {
    this.assets.trackGeometry(geom);
    this.assets.trackMaterial(mat);
    const m = new THREE.Mesh(geom, mat);
    if (options?.name) m.name = options.name;
    if (options?.pos) m.position.set(options.pos[0], options.pos[1], options.pos[2]);
    if (options?.rot) m.rotation.set(options.rot[0], options.rot[1], options.rot[2]);
    if (typeof options?.scale === 'number') {
      m.scale.setScalar(options.scale);
    } else if (options?.scale) {
      m.scale.set(options.scale[0], options.scale[1], options.scale[2]);
    }
    const castShadow = options?.castShadow ?? true;
    m.castShadow = castShadow;
    m.receiveShadow = options?.receiveShadow ?? true;
    if (castShadow) {
      this.rig.shadowMeshes.push(m);
    }
    parent.add(m);
    return m;
  }

  box(
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos?: [number, number, number],
    rot?: [number, number, number],
  ): THREE.Mesh {
    return this.mesh(new THREE.BoxGeometry(w, h, d), mat, parent, { pos, rot });
  }

  cyl(
    rTop: number,
    rBot: number,
    h: number,
    segs: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos?: [number, number, number],
    rot?: [number, number, number],
  ): THREE.Mesh {
    return this.mesh(
      new THREE.CylinderGeometry(rTop, rBot, h, segs),
      mat,
      parent,
      { pos, rot },
    );
  }

  cone(
    r: number,
    h: number,
    segs: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos?: [number, number, number],
    rot?: [number, number, number],
  ): THREE.Mesh {
    return this.mesh(new THREE.ConeGeometry(r, h, segs), mat, parent, { pos, rot });
  }

  sphere(
    r: number,
    wSegs: number,
    hSegs: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos?: [number, number, number],
    scale?: [number, number, number],
  ): THREE.Mesh {
    return this.mesh(new THREE.SphereGeometry(r, wSegs, hSegs), mat, parent, { pos, scale });
  }

  octa(
    r: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos?: [number, number, number],
    scale?: [number, number, number],
    rot?: [number, number, number],
  ): THREE.Mesh {
    return this.mesh(new THREE.OctahedronGeometry(r, 0), mat, parent, { pos, scale, rot });
  }

  dodeca(
    r: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos?: [number, number, number],
    scale?: [number, number, number],
    rot?: [number, number, number],
  ): THREE.Mesh {
    return this.mesh(new THREE.DodecahedronGeometry(r, 0), mat, parent, { pos, scale, rot });
  }

  torus(
    r: number,
    tube: number,
    rSegs: number,
    tSegs: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    pos?: [number, number, number],
    rot?: [number, number, number],
    arc = Math.PI * 2,
  ): THREE.Mesh {
    return this.mesh(
      new THREE.TorusGeometry(r, tube, rSegs, tSegs, arc),
      mat,
      parent,
      { pos, rot },
    );
  }

  createBipedArms(
    shoulderX: number,
    shoulderY: number,
    upperLen: number,
    lowerLen: number,
    limbRadius: number,
    upperMat: THREE.Material,
    lowerMat: THREE.Material,
    jointMat?: THREE.Material,
  ): { left: ArmChain; right: ArmChain } {
    const makeArm = (side: -1 | 1, label: string): ArmChain => {
      const shoulder = this.group(`${label}_shoulder`, this.rig.torso, side * shoulderX, shoulderY, 0);
      if (jointMat) {
        this.sphere(limbRadius * 1.25, 7, 6, jointMat, shoulder, [0, 0, 0]);
      }
      this.cyl(
        limbRadius,
        limbRadius * 0.85,
        upperLen,
        7,
        upperMat,
        shoulder,
        [0, -upperLen * 0.5, 0],
      );

      const elbow = this.group(`${label}_elbow`, shoulder, 0, -upperLen, 0);
      if (jointMat) {
        this.sphere(limbRadius * 1.05, 6, 5, jointMat, elbow, [0, 0, 0]);
      }
      this.cyl(
        limbRadius * 0.85,
        limbRadius * 0.72,
        lowerLen,
        7,
        lowerMat,
        elbow,
        [0, -lowerLen * 0.5, 0],
      );

      const hand = this.group(`${label}_hand`, elbow, 0, -lowerLen, 0);
      this.sphere(limbRadius * 0.95, 6, 5, lowerMat, hand, [0, 0, 0]);

      return { shoulder, elbow, hand };
    };

    const right = makeArm(-1, 'right');
    const left = makeArm(1, 'left');
    this.rig.rightArm = right;
    this.rig.leftArm = left;
    return { left, right };
  }

  createBipedLegs(
    hipX: number,
    hipY: number,
    upperLen: number,
    lowerLen: number,
    limbRadius: number,
    upperMat: THREE.Material,
    lowerMat: THREE.Material,
    footMat?: THREE.Material,
  ): { left: LegChain; right: LegChain } {
    const makeLeg = (side: -1 | 1, label: string): LegChain => {
      const hip = this.group(`${label}_hip`, this.rig.pelvis, side * hipX, hipY, 0);
      this.cyl(
        limbRadius * 1.05,
        limbRadius * 0.85,
        upperLen,
        7,
        upperMat,
        hip,
        [0, -upperLen * 0.5, 0],
      );

      const knee = this.group(`${label}_knee`, hip, 0, -upperLen, 0);
      this.sphere(limbRadius * 0.95, 6, 5, upperMat, knee, [0, 0, 0]);
      this.cyl(
        limbRadius * 0.85,
        limbRadius * 0.7,
        lowerLen,
        7,
        lowerMat,
        knee,
        [0, -lowerLen * 0.5, 0],
      );

      this.box(
        limbRadius * 1.6,
        limbRadius * 0.9,
        limbRadius * 2.6,
        footMat ?? lowerMat,
        knee,
        [0, -lowerLen + limbRadius * 0.35, limbRadius * 0.55],
      );

      return { hip, knee };
    };

    const right = makeLeg(-1, 'right');
    const left = makeLeg(1, 'left');
    this.rig.rightLeg = right;
    this.rig.leftLeg = left;
    return { left, right };
  }

  addRibcage(
    parent: THREE.Object3D,
    boneMat: THREE.Material,
    options?: { width?: number; height?: number; depth?: number; pairs?: number; yOffset?: number },
  ): void {
    const width = options?.width ?? 0.23;
    const height = options?.height ?? 0.44;
    const depth = options?.depth ?? 0.16;
    const pairs = options?.pairs ?? 4;
    const y0 = options?.yOffset ?? 0.08;

    const vertebrae = pairs + 2;
    for (let i = 0; i < vertebrae; i++) {
      const vy = y0 + (i / Math.max(1, vertebrae - 1)) * height;
      this.cyl(0.045, 0.05, 0.065, 6, boneMat, parent, [0, vy, -depth * 0.65]);
    }
    this.box(0.055, height * 0.78, 0.035, boneMat, parent, [0, y0 + height * 0.55, depth * 0.78]);

    for (let i = 0; i < pairs; i++) {
      const t = i / Math.max(1, pairs - 1);
      const ry = y0 + height * (0.22 + t * 0.72);
      const scaleW = width * (0.82 + Math.sin(t * Math.PI) * 0.25);
      for (const side of [-1, 1] as const) {
        const rib = this.torus(
          scaleW,
          0.022,
          5,
          8,
          boneMat,
          parent,
          [side * 0.02, ry, 0],
          [Math.PI * 0.5, 0, side === 1 ? -Math.PI * 0.48 : Math.PI * 0.52],
          Math.PI * 0.95,
        );
        rib.scale.set(1, depth / scaleW, 1);
      }
    }
  }

  addSkull(
    parent: THREE.Object3D,
    boneMat: THREE.Material,
    eyeGlowHex: number,
    scale = 1,
  ): THREE.Group {
    const skullGrp = this.group('skull_mesh', parent, 0, 0.14 * scale, 0, false);
    this.sphere(0.16 * scale, 9, 8, boneMat, skullGrp, [0, 0.05 * scale, -0.01 * scale], [0.92, 1.05, 1.08]);
    this.box(0.24 * scale, 0.055 * scale, 0.14 * scale, boneMat, skullGrp, [0, 0.04 * scale, 0.09 * scale]);
    this.box(0.16 * scale, 0.08 * scale, 0.12 * scale, boneMat, skullGrp, [0, -0.04 * scale, 0.11 * scale]);

    const jaw = this.group('jaw', skullGrp, 0, -0.07 * scale, 0.02 * scale);
    this.box(0.14 * scale, 0.06 * scale, 0.15 * scale, boneMat, jaw, [0, -0.03 * scale, 0.06 * scale]);
    this.rig.jaw = jaw;

    const eyeMat = this.assets.glow(`skull_eye_${eyeGlowHex}`, eyeGlowHex, 2.6);
    for (const side of [-1, 1] as const) {
      this.sphere(0.034 * scale, 6, 6, eyeMat, skullGrp, [side * 0.062 * scale, 0.035 * scale, 0.145 * scale]);
    }
    return skullGrp;
  }

  addCurvedHorns(
    parent: THREE.Object3D,
    mat: THREE.Material,
    options?: {
      spreadX?: number;
      baseY?: number;
      baseZ?: number;
      length?: number;
      radius?: number;
      sweepPitch?: number;
      flareRoll?: number;
    },
  ): void {
    const spreadX = options?.spreadX ?? 0.14;
    const baseY = options?.baseY ?? 0.18;
    const baseZ = options?.baseZ ?? 0.02;
    const len = options?.length ?? 0.34;
    const rad = options?.radius ?? 0.048;
    const pitch = options?.sweepPitch ?? 0.45;
    const flare = options?.flareRoll ?? 0.55;

    for (const side of [-1, 1] as const) {
      const base = this.group(`horn_${side}`, parent, side * spreadX, baseY, baseZ, false);
      base.rotation.set(pitch, 0, -side * flare);
      this.cyl(rad * 0.58, rad, len * 0.55, 6, mat, base, [0, len * 0.275, 0]);
      const tip = this.group(`horn_tip_${side}`, base, 0, len * 0.52, 0, false);
      tip.rotation.set(0.42, 0, side * 0.24);
      this.cone(rad * 0.58, len * 0.58, 6, mat, tip, [0, len * 0.29, 0]);
    }
  }

  addWeakpoint(
    parent: THREE.Object3D,
    tag: string,
    colorHex: number,
    radius: number,
    pos: [number, number, number],
    intensity = 3.0,
  ): WeakpointNode {
    const mat = this.assets.glow(`weakpoint_${tag}`, colorHex, intensity);
    const mesh = this.mesh(new THREE.OctahedronGeometry(radius, 0), mat, parent, {
      pos,
      castShadow: false,
      receiveShadow: false,
    });

    const shellMat = this.assets.glow(`weakpoint_shell_${tag}`, colorHex, intensity * 0.7, {
      opacity: 0.35,
      additive: true,
    });
    this.mesh(new THREE.SphereGeometry(radius * 1.45, 8, 6), shellMat, mesh, {
      pos: [0, 0, 0],
      castShadow: false,
      receiveShadow: false,
    });

    const wp: WeakpointNode = {
      mesh,
      material: mat,
      baseScale: 1,
      baseIntensity: intensity,
      phase: this.rig.weakpoints.length * 1.57,
    };
    this.rig.weakpoints.push(wp);
    return wp;
  }

  addOrbiter(
    parent: THREE.Object3D,
    item: THREE.Group,
    options: {
      radius: number;
      height: number;
      speed: number;
      phase: number;
      bobAmp?: number;
      tiltAmp?: number;
    },
  ): OrbiterNode {
    const anchor = this.group(`orbiter_anchor_${this.rig.orbiters.length}`, parent, 0, options.height, 0, false);
    anchor.add(item);
    item.position.set(Math.cos(options.phase) * options.radius, 0, Math.sin(options.phase) * options.radius);

    const node: OrbiterNode = {
      anchor,
      item,
      radius: options.radius,
      height: options.height,
      speed: options.speed,
      phase: options.phase,
      bobAmp: options.bobAmp ?? 0.08,
      tiltAmp: options.tiltAmp ?? 0.2,
    };
    this.rig.orbiters.push(node);
    return node;
  }

  addSpinningGear(
    parent: THREE.Object3D,
    mat: THREE.Material,
    options: {
      radius: number;
      tube?: number;
      teeth?: number;
      pos?: [number, number, number];
      rot?: [number, number, number];
      axis?: 'x' | 'y' | 'z';
      speed?: number;
    },
  ): THREE.Group {
    const pivot = this.group(
      `gear_${this.rig.spinningGears.length}`,
      parent,
      options.pos?.[0] ?? 0,
      options.pos?.[1] ?? 0,
      options.pos?.[2] ?? 0,
      false,
    );
    if (options.rot) {
      pivot.rotation.set(options.rot[0], options.rot[1], options.rot[2]);
    }
    const r = options.radius;
    const tube = options.tube ?? r * 0.14;
    const teeth = options.teeth ?? 8;
    this.torus(r, tube, 6, Math.max(12, teeth * 2), mat, pivot);
    this.box(r * 1.85, tube * 0.9, tube * 0.9, mat, pivot);
    this.box(tube * 0.9, r * 1.85, tube * 0.9, mat, pivot);
    for (let i = 0; i < teeth; i++) {
      const ang = (i / teeth) * Math.PI * 2;
      this.box(
        tube * 1.4,
        tube * 1.8,
        tube * 1.3,
        mat,
        pivot,
        [Math.cos(ang) * (r + tube * 0.85), Math.sin(ang) * (r + tube * 0.85), 0],
        [0, 0, ang - Math.PI * 0.5],
      );
    }
    this.rig.spinningGears.push({
      node: pivot,
      axis: options.axis ?? 'z',
      speed: options.speed ?? 1.8,
    });
    return pivot;
  }

  finalizeRig(): ArticulatedEnemyRig {
    this.rig.restSnapshots = [];
    for (const node of this.registeredJoints) {
      this.rig.restSnapshots.push({
        node,
        pos: node.position.clone(),
        rot: node.rotation.clone(),
        scale: node.scale.clone(),
      });
    }
    // Keep only shadow-casting meshes in shadowMeshes (in case any mesh had castShadow cleared manually)
    this.rig.shadowMeshes = this.rig.shadowMeshes.filter((m) => m.castShadow);
    this.assets.configureDissolve(
      this.rig.dissolveTheme,
      this.rig.bodyHeight * this.rig.baseScale,
    );
    this.assets.trackHierarchy(this.rig.root);
    return this.rig;
  }
}
