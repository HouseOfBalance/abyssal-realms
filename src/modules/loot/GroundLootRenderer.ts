import * as THREE from 'three';
import type {
  GroundLootDrop,
  ItemInstance,
  ItemRarity,
  RuneId,
  Vec3,
} from '../../contracts/types';
import { MYTHIC_COLOR, RARITY_COLORS, clamp } from '../../core/Constants';
import { RUNE_VISUAL_META } from './itemTables';

export interface ActiveDropEntry {
  drop: GroundLootDrop;
  originPos: Vec3;
  ageSec: number;
  phaseOffset: number;
  jumpPeak: number;
  magnetized: boolean;
  magnetSpeed: number;
  homingActive: boolean;
  homingElapsedSec: number;
  homingDurationSec: number;
  homingStartWorld: Vec3;
  homingLateralSign: number;
  trailHistory: Vec3[];
  trailMeshes: THREE.Mesh[];
  rootGroup: THREE.Group;
  spinGroup: THREE.Group;
  haloMesh: THREE.Mesh;
  pillarGroup?: THREE.Group;
  pillarBeamOuter?: THREE.Mesh;
  pillarBeamInner?: THREE.Mesh;
  runeVortexDisc?: THREE.Mesh;
  runeRingOuter?: THREE.Mesh;
  risingMotes: THREE.Mesh[];
  pillarHeight: number;
}

type PillarTierKey = 'rare' | 'epic' | 'legendary' | 'mythic' | 'rune';

const PILLAR_CONFIG: Record<
  PillarTierKey,
  {
    height: number;
    outerRadiusBottom: number;
    outerRadiusTop: number;
    outerColor: number;
    coreColor: number;
    intensity: number;
    scrollSpeed: number;
    moteCount: number;
  }
> = {
  rare: {
    height: 4.5,
    outerRadiusBottom: 0.24,
    outerRadiusTop: 0.08,
    outerColor: RARITY_COLORS.rare.hex,
    coreColor: 0x99e9f2,
    intensity: 1.05,
    scrollSpeed: 1.65,
    moteCount: 3,
  },
  epic: {
    height: 6.2,
    outerRadiusBottom: 0.31,
    outerRadiusTop: 0.1,
    outerColor: RARITY_COLORS.epic.hex,
    coreColor: 0xf3d9fa,
    intensity: 1.32,
    scrollSpeed: 2.15,
    moteCount: 4,
  },
  legendary: {
    height: 8.5,
    outerRadiusBottom: 0.4,
    outerRadiusTop: 0.14,
    outerColor: RARITY_COLORS.legendary.hex,
    coreColor: 0xfff9db,
    intensity: 1.72,
    scrollSpeed: 2.75,
    moteCount: 6,
  },
  mythic: {
    height: 10.4,
    outerRadiusBottom: 0.48,
    outerRadiusTop: 0.17,
    outerColor: MYTHIC_COLOR.hex,
    coreColor: 0xffd43b,
    intensity: 2.15,
    scrollSpeed: 3.35,
    moteCount: 8,
  },
  rune: {
    height: 3.9,
    outerRadiusBottom: 0.22,
    outerRadiusTop: 0.07,
    outerColor: 0x38d9a9,
    coreColor: 0xffec99,
    intensity: 1.25,
    scrollSpeed: 2.05,
    moteCount: 3,
  },
};

const AURORA_PILLAR_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScrollSpeed;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;

    // Subtle upper-column aurora harmonic sway
    vec3 displaced = position;
    float upperMask = smoothstep(0.12, 1.0, uv.y);
    float swayPhase = uTime * uScrollSpeed * 0.9 + uv.y * 4.5;
    displaced.x += sin(swayPhase) * 0.032 * upperMask;
    displaced.z += cos(swayPhase * 1.17) * 0.032 * upperMask;

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const AURORA_PILLAR_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScrollSpeed;
  uniform float uIntensity;
  uniform vec3 uColorOuter;
  uniform vec3 uColorCore;

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    // Grazing-angle volumetric cylindrical softness (eliminates hard polygon silhouette edges)
    float viewAlign = abs(dot(normalize(vViewNormal), normalize(vViewDir)));
    float cylEdgeSoft = pow(clamp(viewAlign, 0.0, 1.0), 1.35);

    // Vertical energy envelope: bright plasma anchor at floor, smooth fade into sky
    float baseIn = smoothstep(0.0, 0.045, vUv.y);
    float topFade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.85);
    float baseFlare = exp(-vUv.y * 6.5) * 0.85;

    // Multi-layered scrolling aurora curtains & ascending energy pulses
    float angle = vUv.x * 6.2831853;
    float t = uTime * uScrollSpeed;

    float ribbonA = 0.5 + 0.5 * sin(angle * 3.0 + vUv.y * 11.0 - t * 2.2);
    float ribbonB = 0.5 + 0.5 * sin(angle * 5.0 - vUv.y * 16.5 - t * 3.1 + 1.3);
    float auroraCurtain = pow(ribbonA * 0.62 + ribbonB * 0.38, 1.8);

    // Rising horizontal plasma surge rings
    float surgeWave = pow(0.5 + 0.5 * sin(vUv.y * 19.0 - t * 4.2), 4.0);

    // Shimmering fine vertical filaments
    float filament = 0.78 + 0.22 * sin(angle * 9.0 + t * 5.0);

    float energy = (0.42 + auroraCurtain * 0.75 + surgeWave * 0.45 + baseFlare) * filament;
    float alpha = clamp(energy * baseIn * topFade * cylEdgeSoft * uIntensity * 0.68, 0.0, 1.0);

    // Blend rarity aura into incandescent white-tinted core along aurora crests & base
    float coreMix = clamp(auroraCurtain * 0.55 + surgeWave * 0.5 + baseFlare * 0.65, 0.0, 1.0);
    vec3 col = mix(uColorOuter, uColorCore, coreMix) * (1.0 + baseFlare * 0.55);

    gl_FragColor = vec4(col, alpha);
  }
`;

const RUNE_VORTEX_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RUNE_VORTEX_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScrollSpeed;
  uniform vec3 uColorOuter;
  uniform vec3 uColorCore;

  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    float theta = atan(p.y, p.x);
    float t = uTime * uScrollSpeed;

    // Swirling spiral spokes + concentric rune rings
    float spiral = 0.5 + 0.5 * sin(theta * 6.0 - r * 10.0 + t * 2.6);
    float outerRing = exp(-pow((r - 0.78) / 0.085, 2.0));
    float innerRing = exp(-pow((r - 0.42) / 0.075, 2.0));
    float centerGlow = pow(clamp(1.0 - r, 0.0, 1.0), 2.4) * 0.72;
    float edgeMask = smoothstep(1.0, 0.84, r);

    float pattern = (outerRing * (0.55 + 0.45 * spiral) + innerRing * 0.75 + centerGlow) * edgeMask;
    vec3 col = mix(uColorOuter, uColorCore, clamp(outerRing * 0.6 + centerGlow, 0.0, 1.0));

    gl_FragColor = vec4(col, clamp(pattern * 0.85, 0.0, 1.0));
  }
`;

function createRadialHaloTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r = Math.hypot(dx, dy);
      const ring = Math.exp(-Math.pow((r - 0.62) / 0.18, 2)) * 0.7;
      const center = clamp(1 - r, 0, 1) * 0.55;
      const alpha = r > 1 ? 0 : Math.round(clamp(ring + center, 0, 1) * 255);
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = alpha;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const TRAIL_COUNT = 5;

export class GroundLootRenderer {
  private containerGroup = new THREE.Group();
  private scene: THREE.Scene | null = null;

  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private shaderMaterials: THREE.ShaderMaterial[] = [];
  private haloTexture: THREE.DataTexture | null = null;

  constructor() {
    this.containerGroup.name = 'GroundLootContainer';
  }

  public attach(scene: THREE.Scene): void {
    if (this.scene && this.scene !== scene) {
      this.scene.remove(this.containerGroup);
    }
    this.scene = scene;
    this.ensureSharedResources();
    if (!this.containerGroup.parent) {
      scene.add(this.containerGroup);
    }
  }

  private ensureSharedResources(): void {
    if (!this.haloTexture) {
      this.haloTexture = createRadialHaloTexture();
    }

    if (this.geometries.size === 0) {
      this.geometries.set('halo_quad', new THREE.PlaneGeometry(0.95, 0.95));
      this.geometries.set('vortex_quad', new THREE.PlaneGeometry(1.55, 1.55));
      this.geometries.set('coin', new THREE.CylinderGeometry(0.15, 0.15, 0.045, 12));
      this.geometries.set('nugget', new THREE.OctahedronGeometry(0.1, 0));
      this.geometries.set('orb_core', new THREE.IcosahedronGeometry(0.17, 1));
      this.geometries.set('orb_shell', new THREE.IcosahedronGeometry(0.25, 1));
      this.geometries.set('orb_ring', new THREE.TorusGeometry(0.29, 0.018, 6, 24));
      this.geometries.set('potion_bulb', new THREE.OctahedronGeometry(0.18, 1));
      this.geometries.set('potion_neck', new THREE.CylinderGeometry(0.055, 0.075, 0.12, 8));
      this.geometries.set('potion_cork', new THREE.CylinderGeometry(0.065, 0.05, 0.055, 8));

      // Item silhouettes
      this.geometries.set('item_crystal', new THREE.OctahedronGeometry(0.22, 0));
      this.geometries.set('item_frame', new THREE.TorusGeometry(0.32, 0.018, 6, 4));
      this.geometries.set('blade_long', new THREE.BoxGeometry(0.07, 0.56, 0.025));
      this.geometries.set('blade_guard', new THREE.BoxGeometry(0.24, 0.045, 0.045));
      this.geometries.set('blade_hilt', new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6));
      this.geometries.set('dagger_blade', new THREE.ConeGeometry(0.045, 0.34, 4));
      this.geometries.set('staff_shaft', new THREE.CylinderGeometry(0.024, 0.02, 0.62, 6));
      this.geometries.set('staff_orb', new THREE.OctahedronGeometry(0.11, 1));
      this.geometries.set('hammer_head', new THREE.BoxGeometry(0.26, 0.14, 0.14));
      this.geometries.set('shield_disc', new THREE.CylinderGeometry(0.18, 0.15, 0.04, 6));
      this.geometries.set('jewelry_ring', new THREE.TorusGeometry(0.16, 0.038, 8, 20));
      this.geometries.set('mote', new THREE.OctahedronGeometry(0.058, 0));
      this.geometries.set('trail_spark', new THREE.OctahedronGeometry(0.075, 0));
      this.geometries.set('rune_tablet', new THREE.CylinderGeometry(0.14, 0.19, 0.34, 6));
      this.geometries.set('rune_gem', new THREE.OctahedronGeometry(0.13, 0));
      this.geometries.set('rune_orbit_ring', new THREE.TorusGeometry(0.28, 0.016, 6, 6));

      // Pillar & rune rings per tier (height-segmented for smooth vertex aurora sway)
      for (const tier of ['rare', 'epic', 'legendary', 'mythic', 'rune'] as const) {
        const cfg = PILLAR_CONFIG[tier];
        const outerGeo = new THREE.CylinderGeometry(
          cfg.outerRadiusTop,
          cfg.outerRadiusBottom,
          cfg.height,
          20,
          12,
          true,
        );
        outerGeo.translate(0, cfg.height * 0.5, 0);
        this.geometries.set(`pillar_outer_${tier}`, outerGeo);

        const innerGeo = new THREE.CylinderGeometry(
          cfg.outerRadiusTop * 0.38,
          cfg.outerRadiusBottom * 0.42,
          cfg.height * 0.94,
          14,
          8,
          true,
        );
        innerGeo.translate(0, cfg.height * 0.47, 0);
        this.geometries.set(`pillar_inner_${tier}`, innerGeo);

        this.geometries.set(
          `rune_ring_outer_${tier}`,
          new THREE.RingGeometry(cfg.outerRadiusBottom * 1.3, cfg.outerRadiusBottom * 1.7, 6),
        );
      }
    }
  }

  private getGeo(key: string): THREE.BufferGeometry {
    this.ensureSharedResources();
    return this.geometries.get(key)!;
  }

  private getStandardMaterial(
    key: string,
    options: THREE.MeshStandardMaterialParameters,
  ): THREE.MeshStandardMaterial {
    let mat = this.materials.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!mat) {
      mat = new THREE.MeshStandardMaterial(options);
      this.materials.set(key, mat);
    }
    return mat;
  }

  private getBasicMaterial(
    key: string,
    options: THREE.MeshBasicMaterialParameters,
  ): THREE.MeshBasicMaterial {
    let mat = this.materials.get(key) as THREE.MeshBasicMaterial | undefined;
    if (!mat) {
      mat = new THREE.MeshBasicMaterial(options);
      this.materials.set(key, mat);
    }
    return mat;
  }

  private getAuroraPillarMaterial(
    tier: PillarTierKey,
    isInnerCore: boolean,
    customOuterHex?: number,
    customCoreHex?: number,
  ): THREE.ShaderMaterial {
    const colorTag =
      customOuterHex !== undefined ? `_${customOuterHex.toString(16)}` : '';
    const key = `shader_pillar_${tier}${colorTag}_${isInnerCore ? 'inner' : 'outer'}`;
    let mat = this.materials.get(key) as THREE.ShaderMaterial | undefined;
    if (!mat) {
      const cfg = PILLAR_CONFIG[tier];
      const outerHex = customOuterHex ?? cfg.outerColor;
      const coreHex = customCoreHex ?? cfg.coreColor;
      mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uScrollSpeed: { value: isInnerCore ? cfg.scrollSpeed * 1.35 : cfg.scrollSpeed },
          uIntensity: { value: isInnerCore ? cfg.intensity * 1.35 : cfg.intensity },
          uColorOuter: {
            value: new THREE.Color(isInnerCore ? coreHex : outerHex),
          },
          uColorCore: {
            value: new THREE.Color(tier === 'mythic' ? 0xfff3bf : 0xffffff),
          },
        },
        vertexShader: AURORA_PILLAR_VERTEX_SHADER,
        fragmentShader: AURORA_PILLAR_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.set(key, mat);
      this.shaderMaterials.push(mat);
    }
    return mat;
  }

  private getRuneVortexMaterial(
    tier: PillarTierKey,
    customOuterHex?: number,
    customCoreHex?: number,
  ): THREE.ShaderMaterial {
    const colorTag =
      customOuterHex !== undefined ? `_${customOuterHex.toString(16)}` : '';
    const key = `shader_vortex_${tier}${colorTag}`;
    let mat = this.materials.get(key) as THREE.ShaderMaterial | undefined;
    if (!mat) {
      const cfg = PILLAR_CONFIG[tier];
      mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uScrollSpeed: { value: cfg.scrollSpeed },
          uColorOuter: { value: new THREE.Color(customOuterHex ?? cfg.outerColor) },
          uColorCore: { value: new THREE.Color(customCoreHex ?? cfg.coreColor) },
        },
        vertexShader: RUNE_VORTEX_VERTEX_SHADER,
        fragmentShader: RUNE_VORTEX_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.set(key, mat);
      this.shaderMaterials.push(mat);
    }
    return mat;
  }

  public syncShaderTime(elapsedSec: number): void {
    for (let i = 0; i < this.shaderMaterials.length; i++) {
      this.shaderMaterials[i].uniforms.uTime.value = elapsedSec;
    }
  }

  public createDropEntry(
    drop: GroundLootDrop,
    originPos: Vec3,
    phaseSeed: number,
  ): ActiveDropEntry {
    this.ensureSharedResources();

    const rootGroup = new THREE.Group();
    rootGroup.position.set(originPos.x, originPos.y, originPos.z);

    const spinGroup = new THREE.Group();
    spinGroup.position.set(0, 0.42, 0);
    rootGroup.add(spinGroup);

    const colorHex = this.resolveDropColor(drop);
    const haloMat = this.getBasicMaterial(`halo_${colorHex.toString(16)}`, {
      color: colorHex,
      map: this.haloTexture,
      transparent: true,
      opacity: drop.kind === 'item' ? 0.72 : 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const haloMesh = new THREE.Mesh(this.getGeo('halo_quad'), haloMat);
    haloMesh.rotation.x = -Math.PI * 0.5;
    haloMesh.position.y = 0.03;
    rootGroup.add(haloMesh);

    const entry: ActiveDropEntry = {
      drop,
      originPos: { x: originPos.x, y: originPos.y, z: originPos.z },
      ageSec: 0,
      phaseOffset: phaseSeed * Math.PI * 2,
      jumpPeak: drop.kind === 'item' ? 1.15 : 0.85,
      magnetized: false,
      magnetSpeed: 7.5,
      homingActive: false,
      homingElapsedSec: 0,
      homingDurationSec: drop.kind === 'item' ? 0.31 : 0.28,
      homingStartWorld: { x: originPos.x, y: originPos.y + 0.44, z: originPos.z },
      homingLateralSign: phaseSeed >= 0.5 ? 1 : -1,
      trailHistory: [],
      trailMeshes: [],
      rootGroup,
      spinGroup,
      haloMesh,
      risingMotes: [],
      pillarHeight: 0,
    };

    if (drop.kind === 'gold') {
      this.buildGoldVisual(spinGroup);
    } else if (drop.kind === 'health_orb') {
      this.buildHealthOrbVisual(spinGroup);
    } else if (drop.kind === 'potion') {
      this.buildPotionVisual(spinGroup);
    } else if (drop.kind === 'rune') {
      this.buildRuneVisual(entry, drop.runeId ?? 'sol');
    } else if (drop.kind === 'item' && drop.item) {
      this.buildItemVisual(entry, drop.item);
    }

    this.containerGroup.add(rootGroup);
    return entry;
  }

  private resolveDropColor(drop: GroundLootDrop): number {
    if (drop.kind === 'gold') return 0xffd43b;
    if (drop.kind === 'health_orb') return 0xff3b5c;
    if (drop.kind === 'potion') return 0xe03131;
    if (drop.kind === 'rune') {
      const meta = drop.runeId ? RUNE_VISUAL_META[drop.runeId] : undefined;
      return meta?.colorHex ?? 0x38d9a9;
    }
    if (drop.kind === 'item' && drop.item) {
      if (drop.item.isMythic) {
        return MYTHIC_COLOR.hex;
      }
      return RARITY_COLORS[drop.item.rarity].hex;
    }
    return 0xd0d0d0;
  }

  private buildGoldVisual(spinGroup: THREE.Group): void {
    const goldMat = this.getStandardMaterial('mat_gold_coin', {
      color: 0xffd43b,
      emissive: 0xd97706,
      emissiveIntensity: 0.55,
      metalness: 0.88,
      roughness: 0.2,
    });

    const coinGeo = this.getGeo('coin');
    const c1 = new THREE.Mesh(coinGeo, goldMat);
    c1.position.set(-0.07, -0.04, 0.03);
    c1.rotation.set(0.55, 0.2, 0.35);

    const c2 = new THREE.Mesh(coinGeo, goldMat);
    c2.position.set(0.08, 0.02, -0.04);
    c2.rotation.set(-0.45, 0.4, -0.5);

    const c3 = new THREE.Mesh(coinGeo, goldMat);
    c3.position.set(0, 0.08, 0.05);
    c3.rotation.set(Math.PI * 0.5, 0, 0.2);

    const nugget = new THREE.Mesh(this.getGeo('nugget'), goldMat);
    nugget.position.set(0, 0.18, 0);

    spinGroup.add(c1, c2, c3, nugget);
  }

  private buildHealthOrbVisual(spinGroup: THREE.Group): void {
    const coreMat = this.getStandardMaterial('mat_orb_core', {
      color: 0xff4d6d,
      emissive: 0xff1e42,
      emissiveIntensity: 1.15,
      roughness: 0.15,
      metalness: 0.1,
    });
    const shellMat = this.getBasicMaterial('mat_orb_shell', {
      color: 0xff758f,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringMat = this.getBasicMaterial('mat_orb_ring', {
      color: 0xffccd5,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const core = new THREE.Mesh(this.getGeo('orb_core'), coreMat);
    const shell = new THREE.Mesh(this.getGeo('orb_shell'), shellMat);
    const ring = new THREE.Mesh(this.getGeo('orb_ring'), ringMat);
    ring.rotation.x = Math.PI * 0.32;

    spinGroup.add(core, shell, ring);
  }

  private buildPotionVisual(spinGroup: THREE.Group): void {
    const rubyMat = this.getStandardMaterial('mat_potion_ruby', {
      color: 0xe03131,
      emissive: 0x9b111e,
      emissiveIntensity: 0.75,
      roughness: 0.18,
      metalness: 0.25,
    });
    const goldTrimMat = this.getStandardMaterial('mat_potion_gold', {
      color: 0xffd43b,
      emissive: 0x8a5a00,
      emissiveIntensity: 0.35,
      metalness: 0.85,
      roughness: 0.25,
    });

    const bulb = new THREE.Mesh(this.getGeo('potion_bulb'), rubyMat);
    const neck = new THREE.Mesh(this.getGeo('potion_neck'), rubyMat);
    neck.position.y = 0.18;
    const cork = new THREE.Mesh(this.getGeo('potion_cork'), goldTrimMat);
    cork.position.y = 0.26;

    spinGroup.add(bulb, neck, cork);
  }

  private buildRuneVisual(entry: ActiveDropEntry, runeId: RuneId): void {
    const meta = RUNE_VISUAL_META[runeId] ?? RUNE_VISUAL_META.sol;

    const stoneMat = this.getStandardMaterial('mat_rune_obsidian_tablet', {
      color: 0x1e222b,
      emissive: 0x0f1218,
      emissiveIntensity: 0.35,
      metalness: 0.55,
      roughness: 0.38,
    });
    const glyphGemMat = this.getStandardMaterial(`mat_rune_gem_${runeId}`, {
      color: meta.colorHex,
      emissive: meta.colorHex,
      emissiveIntensity: 1.25,
      metalness: 0.4,
      roughness: 0.15,
    });
    const orbitMat = this.getBasicMaterial(`mat_rune_orbit_${runeId}`, {
      color: meta.coreHex,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const tabletGroup = new THREE.Group();
    const tablet = new THREE.Mesh(this.getGeo('rune_tablet'), stoneMat);
    tablet.scale.set(1.0, 1.0, 0.42);
    tablet.rotation.z = 0.18;

    const gemFront = new THREE.Mesh(this.getGeo('rune_gem'), glyphGemMat);
    gemFront.position.set(0, 0.02, 0.075);
    gemFront.scale.set(0.85, 1.15, 0.55);

    const gemBack = new THREE.Mesh(this.getGeo('rune_gem'), glyphGemMat);
    gemBack.position.set(0, 0.02, -0.075);
    gemBack.scale.set(0.85, 1.15, 0.55);

    const orbitRing = new THREE.Mesh(this.getGeo('rune_orbit_ring'), orbitMat);
    orbitRing.rotation.x = Math.PI * 0.28;

    tabletGroup.add(tablet, gemFront, gemBack, orbitRing);
    entry.spinGroup.add(tabletGroup);

    // Attach glowing Runic GLSL Light Pillar tinted to the Rune's elemental hue
    this.attachPillarAssembly(entry, 'rune', 0.86, meta.colorHex, meta.coreHex);
  }

  private attachPillarAssembly(
    entry: ActiveDropEntry,
    tier: PillarTierKey,
    vortexScale: number,
    customOuterHex?: number,
    customCoreHex?: number,
  ): void {
    const pillarCfg = PILLAR_CONFIG[tier];
    entry.pillarHeight = pillarCfg.height;

    const pillarGroup = new THREE.Group();
    entry.pillarGroup = pillarGroup;
    entry.rootGroup.add(pillarGroup);

    const outerShaderMat = this.getAuroraPillarMaterial(
      tier,
      false,
      customOuterHex,
      customCoreHex,
    );
    const innerShaderMat = this.getAuroraPillarMaterial(
      tier,
      true,
      customOuterHex,
      customCoreHex,
    );
    const vortexShaderMat = this.getRuneVortexMaterial(
      tier,
      customOuterHex,
      customCoreHex,
    );

    const runeHex = customCoreHex ?? pillarCfg.coreColor;
    const runeMat = this.getBasicMaterial(`mat_pillar_rune_${tier}_${runeHex.toString(16)}`, {
      color: runeHex,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const beamOuter = new THREE.Mesh(this.getGeo(`pillar_outer_${tier}`), outerShaderMat);
    const beamInner = new THREE.Mesh(this.getGeo(`pillar_inner_${tier}`), innerShaderMat);

    const vortexDisc = new THREE.Mesh(this.getGeo('vortex_quad'), vortexShaderMat);
    vortexDisc.rotation.x = -Math.PI * 0.5;
    vortexDisc.position.y = 0.038;
    vortexDisc.scale.setScalar(vortexScale);

    const runeOuter = new THREE.Mesh(this.getGeo(`rune_ring_outer_${tier}`), runeMat);
    runeOuter.rotation.x = -Math.PI * 0.5;
    runeOuter.position.y = 0.045;

    pillarGroup.add(beamOuter, beamInner, vortexDisc, runeOuter);
    entry.pillarBeamOuter = beamOuter;
    entry.pillarBeamInner = beamInner;
    entry.runeVortexDisc = vortexDisc;
    entry.runeRingOuter = runeOuter;

    const moteGeo = this.getGeo('mote');
    for (let i = 0; i < pillarCfg.moteCount; i++) {
      const mote = new THREE.Mesh(moteGeo, runeMat);
      const angle = (i / pillarCfg.moteCount) * Math.PI * 2;
      const r = pillarCfg.outerRadiusBottom * 0.65;
      mote.position.set(
        Math.cos(angle) * r,
        0.3 + (i / pillarCfg.moteCount) * (pillarCfg.height * 0.65),
        Math.sin(angle) * r,
      );
      pillarGroup.add(mote);
      entry.risingMotes.push(mote);
    }
  }

  private buildItemVisual(entry: ActiveDropEntry, item: ItemInstance): void {
    const rarity = item.rarity;
    const isMythic = Boolean(item.isMythic);
    const primaryHex = isMythic ? MYTHIC_COLOR.hex : RARITY_COLORS[rarity].hex;

    const matKey = isMythic ? 'mat_item_mythic_primal' : `mat_item_${rarity}`;
    const itemMat = this.getStandardMaterial(matKey, {
      color: primaryHex,
      emissive: primaryHex,
      emissiveIntensity: isMythic ? 1.38 : rarity === 'legendary' ? 1.05 : rarity === 'epic' ? 0.85 : 0.58,
      metalness: 0.76,
      roughness: 0.18,
    });

    const accentMat = isMythic
      ? this.getStandardMaterial('mat_item_mythic_gold_accent', {
          color: 0xffd43b,
          emissive: 0xd97706,
          emissiveIntensity: 0.65,
          metalness: 0.9,
          roughness: 0.18,
        })
      : this.getStandardMaterial('mat_item_steel_accent', {
          color: 0xe9ecef,
          emissive: 0x495057,
          emissiveIntensity: 0.25,
          metalness: 0.85,
          roughness: 0.25,
        });

    const relicGroup = new THREE.Group();
    if (item.slot === 'weapon') {
      const vis = item.weaponVisual ?? 'greatsword';
      if (vis === 'staff') {
        const shaft = new THREE.Mesh(this.getGeo('staff_shaft'), accentMat);
        const orb = new THREE.Mesh(this.getGeo('staff_orb'), itemMat);
        orb.position.y = 0.34;
        relicGroup.add(shaft, orb);
      } else if (vis === 'warhammer') {
        const shaft = new THREE.Mesh(this.getGeo('staff_shaft'), accentMat);
        const head = new THREE.Mesh(this.getGeo('hammer_head'), itemMat);
        head.position.y = 0.26;
        relicGroup.add(shaft, head);
      } else if (vis === 'daggers') {
        const d1 = new THREE.Mesh(this.getGeo('dagger_blade'), itemMat);
        d1.position.set(-0.08, 0.04, 0);
        d1.rotation.z = -0.35;
        const d2 = new THREE.Mesh(this.getGeo('dagger_blade'), itemMat);
        d2.position.set(0.08, 0.04, 0);
        d2.rotation.z = 0.35;
        relicGroup.add(d1, d2);
      } else {
        const blade = new THREE.Mesh(this.getGeo('blade_long'), itemMat);
        blade.position.y = 0.08;
        const guard = new THREE.Mesh(this.getGeo('blade_guard'), accentMat);
        guard.position.y = -0.18;
        const hilt = new THREE.Mesh(this.getGeo('blade_hilt'), accentMat);
        hilt.position.y = -0.27;
        relicGroup.add(blade, guard, hilt);
        if (vis === 'sword_shield') {
          const shield = new THREE.Mesh(this.getGeo('shield_disc'), itemMat);
          shield.rotation.x = Math.PI * 0.5;
          shield.position.set(0.14, -0.02, 0.08);
          relicGroup.add(shield);
        }
      }
      relicGroup.rotation.z = 0.42;
    } else if (item.slot === 'ring' || item.slot === 'amulet') {
      const ring = new THREE.Mesh(this.getGeo('jewelry_ring'), itemMat);
      const gem = new THREE.Mesh(this.getGeo('mote'), accentMat);
      gem.position.y = 0.18;
      gem.scale.setScalar(1.5);
      relicGroup.add(ring, gem);
    } else if (item.slot === 'offhand') {
      const shield = new THREE.Mesh(this.getGeo('shield_disc'), itemMat);
      shield.scale.setScalar(1.35);
      shield.rotation.x = Math.PI * 0.42;
      relicGroup.add(shield);
    } else {
      const crystal = new THREE.Mesh(this.getGeo('item_crystal'), itemMat);
      relicGroup.add(crystal);
    }
    entry.spinGroup.add(relicGroup);

    if (rarity !== 'common' || isMythic) {
      const frameKey = isMythic ? 'mat_frame_mythic' : `mat_frame_${rarity}`;
      const frameMat = this.getBasicMaterial(frameKey, {
        color: primaryHex,
        transparent: true,
        opacity: isMythic ? 0.92 : 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const frame = new THREE.Mesh(this.getGeo('item_frame'), frameMat);
      frame.rotation.x = Math.PI * 0.25;
      entry.spinGroup.add(frame);

      if (isMythic) {
        const goldFrameMat = this.getBasicMaterial('mat_frame_mythic_gold', {
          color: 0xffd43b,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const frame2 = new THREE.Mesh(this.getGeo('item_frame'), goldFrameMat);
        frame2.rotation.y = Math.PI * 0.5;
        frame2.rotation.x = -Math.PI * 0.25;
        frame2.scale.setScalar(1.18);
        entry.spinGroup.add(frame2);
      }
    }

    // Custom GLSL Scrolling Aurora Light Pillar (Crimson-Gold for Mythic Primal!)
    if (isMythic) {
      this.attachPillarAssembly(entry, 'mythic', 1.56);
    } else if (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
      const vortexScale = rarity === 'legendary' ? 1.32 : rarity === 'epic' ? 1.12 : 0.92;
      this.attachPillarAssembly(entry, rarity, vortexScale);
    }
  }

  /**
   * Transitions a collected ground drop into a 3D Bezier Homing Spiral Arc (~0.30s)
   * with trailing additive comet sparks that fly into the live player torso.
   */
  public startHomingFlight(entry: ActiveDropEntry, fromPos: Vec3): void {
    entry.homingActive = true;
    entry.homingElapsedSec = 0;
    const startY = (Number.isFinite(fromPos.y) ? fromPos.y : 0) + entry.spinGroup.position.y;
    entry.homingStartWorld = {
      x: Number.isFinite(fromPos.x) ? fromPos.x : entry.rootGroup.position.x,
      y: startY,
      z: Number.isFinite(fromPos.z) ? fromPos.z : entry.rootGroup.position.z,
    };

    entry.trailHistory.length = 0;
    for (let i = 0; i < TRAIL_COUNT; i++) {
      entry.trailHistory.push({ ...entry.homingStartWorld });
    }

    const colorHex = this.resolveDropColor(entry.drop);
    const trailMat = this.getBasicMaterial(`mat_homing_trail_${colorHex.toString(16)}`, {
      color: colorHex,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparkGeo = this.getGeo('trail_spark');

    for (let i = 0; i < TRAIL_COUNT; i++) {
      const spark = new THREE.Mesh(sparkGeo, trailMat);
      spark.position.set(
        entry.homingStartWorld.x,
        entry.homingStartWorld.y,
        entry.homingStartWorld.z,
      );
      spark.scale.setScalar(1 - i * 0.16);
      this.containerGroup.add(spark);
      entry.trailMeshes.push(spark);
    }
  }

  /**
   * Advances the 3D Bezier Homing Spiral Arc toward `(playerPos.x, playerPos.y + 1.05, playerPos.z)`.
   * Returns `true` when the item arrives (`t >= 1.0`).
   */
  public updateHomingFlight(
    entry: ActiveDropEntry,
    dt: number,
    playerPos: Vec3,
  ): { completed: boolean; worldPos: Vec3 } {
    entry.homingElapsedSec += dt;
    const dur = Math.max(0.12, entry.homingDurationSec);
    const t = clamp(entry.homingElapsedSec / dur, 0, 1);

    // Smooth launch acceleration into magnetic snap
    const u = 1 - Math.pow(1 - t, 2.25);

    const p0 = entry.homingStartWorld;
    const p2: Vec3 = {
      x: Number.isFinite(playerPos.x) ? playerPos.x : p0.x,
      y: (Number.isFinite(playerPos.y) ? playerPos.y : 0) + 1.05,
      z: Number.isFinite(playerPos.z) ? playerPos.z : p0.z,
    };

    const dx = p2.x - p0.x;
    const dz = p2.z - p0.z;
    const horizDist = Math.hypot(dx, dz);
    const perpX = horizDist > 1e-4 ? -dz / horizDist : 1;
    const perpZ = horizDist > 1e-4 ? dx / horizDist : 0;
    const lateralArc = clamp(horizDist * 0.42, 0.48, 1.55) * entry.homingLateralSign;

    // Elevated Quadratic Bezier apex control point P1
    const p1: Vec3 = {
      x: (p0.x + p2.x) * 0.5 + perpX * lateralArc,
      y: Math.max(p0.y, p2.y) + 1.55,
      z: (p0.z + p2.z) * 0.5 + perpZ * lateralArc,
    };

    const invU = 1 - u;
    const bezierX = invU * invU * p0.x + 2 * invU * u * p1.x + u * u * p2.x;
    const bezierY = invU * invU * p0.y + 2 * invU * u * p1.y + u * u * p2.y;
    const bezierZ = invU * invU * p0.z + 2 * invU * u * p1.z + u * u * p2.z;

    // Tight 3D corkscrew helix around the Bezier spine that converges to 0 at impact
    const spiralEnv = Math.sin(t * Math.PI) * (1 - u * 0.4) * 0.34;
    const spiralTheta = entry.phaseOffset + t * Math.PI * 3.75;

    const curX = bezierX + Math.cos(spiralTheta) * spiralEnv;
    const curY = bezierY + Math.sin(spiralTheta * 1.5) * spiralEnv * 0.42;
    const curZ = bezierZ + Math.sin(spiralTheta) * spiralEnv;

    entry.rootGroup.position.set(curX, curY, curZ);
    entry.spinGroup.position.set(0, 0, 0);

    // Energetic high-RPM spin during flight
    entry.spinGroup.rotation.y += dt * 19.5;
    entry.spinGroup.rotation.x += dt * 8.5;

    // Punchy launch pop (0..0.22) followed by smooth cubic shrink into the hero's chest
    const scale =
      t < 0.22
        ? 1.0 + (t / 0.22) * 0.28
        : Math.max(0.06, 1.28 * Math.pow(1 - (t - 0.22) / 0.78, 1.55));
    entry.spinGroup.scale.setScalar(scale);

    // Collapse ground halo & rarity pillar cleanly during the first 0.09s of flight
    const groundFade = clamp(1 - t / 0.28, 0, 1);
    entry.haloMesh.visible = groundFade > 0.02;
    entry.haloMesh.scale.setScalar(Math.max(0.01, groundFade));
    if (entry.pillarGroup) {
      entry.pillarGroup.visible = groundFade > 0.02;
      entry.pillarGroup.scale.set(groundFade, Math.max(0.01, groundFade * 0.65), groundFade);
    }

    // Update trailing comet sparks along historical spiral positions
    entry.trailHistory.unshift({ x: curX, y: curY, z: curZ });
    if (entry.trailHistory.length > TRAIL_COUNT + 2) {
      entry.trailHistory.pop();
    }
    for (let i = 0; i < entry.trailMeshes.length; i++) {
      const spark = entry.trailMeshes[i];
      const hist = entry.trailHistory[Math.min(i + 1, entry.trailHistory.length - 1)];
      spark.position.set(hist.x, hist.y, hist.z);
      spark.rotation.y += dt * 12;
      spark.rotation.z += dt * 9;
      const trailScale = Math.max(0.02, (1 - i / TRAIL_COUNT) * scale * 0.92);
      spark.scale.setScalar(trailScale);
    }

    return {
      completed: t >= 1,
      worldPos: { x: curX, y: curY, z: curZ },
    };
  }

  public updateEntryVisual(entry: ActiveDropEntry, dt: number, elapsedSec: number): void {
    entry.ageSec += dt;

    // 1. Spawn fountain arc (first 0.38s) smoothly easing from originPos to drop.position
    const spawnDuration = 0.38;
    if (entry.ageSec < spawnDuration && !entry.magnetized) {
      const t = clamp(entry.ageSec / spawnDuration, 0, 1);
      const easeOut = 1 - (1 - t) * (1 - t);
      const x = entry.originPos.x + (entry.drop.position.x - entry.originPos.x) * easeOut;
      const z = entry.originPos.z + (entry.drop.position.z - entry.originPos.z) * easeOut;
      const yArc = Math.sin(t * Math.PI) * entry.jumpPeak;
      entry.rootGroup.position.set(x, entry.drop.position.y, z);
      entry.spinGroup.position.y = 0.42 + yArc;
    } else {
      entry.rootGroup.position.set(
        entry.drop.position.x,
        entry.drop.position.y,
        entry.drop.position.z,
      );
      const bob = Math.sin(elapsedSec * 3.1 + entry.phaseOffset) * 0.1;
      entry.spinGroup.position.y = 0.44 + bob;
    }

    // 2. Crisp Y-axis spin
    const spinRate =
      entry.drop.kind === 'gold'
        ? 2.8
        : entry.drop.item?.rarity === 'legendary'
          ? 2.2
          : 1.65;
    entry.spinGroup.rotation.y += dt * spinRate;

    // 3. Halo pulse
    const pulse = 1 + Math.sin(elapsedSec * 4.0 + entry.phaseOffset) * 0.08;
    entry.haloMesh.scale.set(pulse, pulse, 1);

    // 4. Diablo Aurora Rarity Light Pillar subtle breathing & rising motes
    if (entry.pillarBeamOuter && entry.pillarBeamInner) {
      const beamBreath = 1 + Math.sin(elapsedSec * 4.8 + entry.phaseOffset) * 0.08;
      entry.pillarBeamOuter.scale.set(beamBreath, 1, beamBreath);
      entry.pillarBeamInner.scale.set(2 - beamBreath, 1, 2 - beamBreath);
    }
    if (entry.runeRingOuter) {
      entry.runeRingOuter.rotation.z = elapsedSec * 1.15 + entry.phaseOffset;
    }
    if (entry.risingMotes.length > 0 && entry.pillarHeight > 0) {
      const maxRise = entry.pillarHeight * 0.74;
      for (let i = 0; i < entry.risingMotes.length; i++) {
        const mote = entry.risingMotes[i];
        const cycle =
          (((elapsedSec * 0.58 + i / entry.risingMotes.length + entry.phaseOffset * 0.1) % 1) +
            1) %
          1;
        const angle = elapsedSec * 2.2 + i * ((Math.PI * 2) / entry.risingMotes.length);
        const spiralRadius = (1 - cycle * 0.55) * 0.25;
        mote.position.set(
          Math.cos(angle) * spiralRadius,
          0.2 + cycle * maxRise,
          Math.sin(angle) * spiralRadius,
        );
        const moteScale = Math.sin(cycle * Math.PI);
        mote.scale.setScalar(Math.max(0.01, moteScale));
      }
    }
  }

  public removeDropEntry(entry: ActiveDropEntry): void {
    this.containerGroup.remove(entry.rootGroup);
    for (let i = 0; i < entry.trailMeshes.length; i++) {
      this.containerGroup.remove(entry.trailMeshes[i]);
    }
    entry.trailMeshes.length = 0;
  }

  public clearAll(): void {
    while (this.containerGroup.children.length > 0) {
      const child = this.containerGroup.children[this.containerGroup.children.length - 1];
      this.containerGroup.remove(child);
    }
  }

  public dispose(): void {
    this.clearAll();
    if (this.scene) {
      this.scene.remove(this.containerGroup);
      this.scene = null;
    }
    for (const geo of this.geometries.values()) {
      geo.dispose();
    }
    this.geometries.clear();

    for (const mat of this.materials.values()) {
      mat.dispose();
    }
    this.materials.clear();
    this.shaderMaterials.length = 0;

    if (this.haloTexture) {
      this.haloTexture.dispose();
      this.haloTexture = null;
    }
  }
}
