import * as THREE from 'three';
import type {
  ElementalReactionType,
  EmojiReactionId,
  GroundLootDrop,
  HeroClassId,
  ItemRarity,
  RuneId,
  SocialEmoteId,
  TacticalPingType,
  Vec3,
  VfxEffectType,
  WeaponVisualType,
} from '../../contracts/types';
import { HERO_CLASS_CONFIG, MYTHIC_COLOR, RARITY_COLORS, clamp } from '../../core/Constants';
import { createVfxTextureAtlas, type VfxTextureAtlas } from './VfxTextures';

export interface VfxSpawnOptions {
  direction?: Vec3;
  colorHex?: number;
  radius?: number;
  scale?: number;
}

const enum AtlasQuad {
  Glow = 0,
  Spark = 1,
  Smoke = 2,
  Rune = 3,
}

interface ParticleSpawnParams {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ax?: number;
  ay?: number;
  az?: number;
  drag?: number;
  life: number;
  startSize: number;
  endSize: number;
  colorStartHex: number;
  colorEndHex: number;
  hdrBoost?: number;
  alpha?: number;
  rot?: number;
  rotSpeed?: number;
  quadrant?: AtlasQuad;
  swirlSpeed?: number;
  swirlOriginX?: number;
  swirlOriginZ?: number;
  floorY?: number;
  bounce?: number;
}

const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aRot;
attribute float aQuad;

varying vec3 vColor;
varying float vAlpha;
varying float vRot;
varying float vQuad;

void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vRot = aRot;
  vQuad = aQuad;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float dist = max(0.75, -mvPosition.z);
  gl_PointSize = clamp(aSize * (310.0 / dist), 1.0, 196.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;

varying vec3 vColor;
varying float vAlpha;
varying float vRot;
varying float vQuad;

void main() {
  if (vAlpha <= 0.002) discard;

  vec2 centered = gl_PointCoord - vec2(0.5);
  float c = cos(vRot);
  float s = sin(vRot);
  vec2 rotated = vec2(
    centered.x * c - centered.y * s,
    centered.x * s + centered.y * c
  ) + vec2(0.5);

  if (rotated.x < 0.02 || rotated.x > 0.98 || rotated.y < 0.02 || rotated.y > 0.98) {
    discard;
  }

  float q = floor(vQuad + 0.5);
  float col = mod(q, 2.0);
  float row = floor(q * 0.5);
  vec2 uv = vec2(
    (col + rotated.x) * 0.5,
    (1.0 - row - rotated.y) * 0.5
  );

  vec4 tex = texture2D(uAtlas, uv);
  float outAlpha = tex.a * vAlpha;
  if (outAlpha <= 0.004) discard;

  gl_FragColor = vec4(vColor * tex.rgb, outAlpha);
}
`;

const FRESNEL_SHOCK_VERT = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uRippleFreq;
uniform float uRippleAmp;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;

void main() {
  vLocalPos = position;
  float wave = sin(position.y * uRippleFreq - uTime * 16.0)
             * cos(position.x * (uRippleFreq * 0.75) + position.z * (uRippleFreq * 0.65) + uTime * 12.0);
  float env = 1.0 - uProgress * 0.65;
  vec3 displaced = position + normal * (wave * uRippleAmp * env);

  vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const FRESNEL_SHOCK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uOpacity;
uniform float uFresnelPower;
uniform float uRippleFreq;
uniform vec3 uPrimaryColor;
uniform vec3 uRimColor;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;

void main() {
  if (uOpacity <= 0.003) discard;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float ndotv = abs(dot(normalize(vWorldNormal), viewDir));
  float fresnel = pow(clamp(1.0 - ndotv, 0.0, 1.0), uFresnelPower);

  float bandA = 0.5 + 0.5 * sin(vLocalPos.y * (uRippleFreq * 1.35) - uTime * 20.0 + vLocalPos.x * 5.0);
  float bandB = 0.5 + 0.5 * cos(vLocalPos.z * (uRippleFreq * 1.1) + uTime * 14.0 - vLocalPos.y * 4.0);
  float caustic = bandA * bandB;
  float equator = exp(-pow(vLocalPos.y * 2.4, 2.0)) * 0.32;

  vec3 color = mix(uPrimaryColor, uRimColor, clamp(fresnel * 1.15 + caustic * 0.3, 0.0, 1.0));
  float hdrGain = 1.15 + fresnel * 1.85 + caustic * 0.4;
  float alpha = clamp((fresnel * 1.28 + caustic * 0.16 + equator) * uOpacity, 0.0, 1.0);

  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(color * hdrGain, alpha);
}
`;

const RUNE_COLORS: Record<RuneId, number> = {
  sol: 0xffd43b,
  vex: 0xff6b35,
  jah: 0xda77f2,
  ohm: 0xf8f9fa,
  ber: 0xff1e42,
  zod: 0x66d9e8,
  ist: 0x40c057,
  mal: 0x9c36b5,
  gul: 0x69db7c,
  sur: 0x339af0,
  lo: 0xffb703,
  cham: 0xa5d8ff,
};

class ParticleBatchPool {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private cursor = 0;
  private activeCount = 0;

  getActiveCount(): number {
    return this.activeCount;
  }

  private readonly active: Uint8Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly ax: Float32Array;
  private readonly ay: Float32Array;
  private readonly az: Float32Array;
  private readonly drag: Float32Array;
  private readonly startSize: Float32Array;
  private readonly endSize: Float32Array;
  private readonly r0: Float32Array;
  private readonly g0: Float32Array;
  private readonly b0: Float32Array;
  private readonly r1: Float32Array;
  private readonly g1: Float32Array;
  private readonly b1: Float32Array;
  private readonly peakAlpha: Float32Array;
  private readonly rot: Float32Array;
  private readonly rotSpeed: Float32Array;
  private readonly quad: Float32Array;
  private readonly swirlSpeed: Float32Array;
  private readonly swirlOriginX: Float32Array;
  private readonly swirlOriginZ: Float32Array;
  private readonly floorY: Float32Array;
  private readonly bounce: Float32Array;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly rotAttr: THREE.BufferAttribute;
  private readonly quadAttr: THREE.BufferAttribute;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(capacity: number, atlas: THREE.Texture, additive: boolean) {
    this.capacity = capacity;
    this.active = new Uint8Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.ax = new Float32Array(capacity);
    this.ay = new Float32Array(capacity);
    this.az = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.startSize = new Float32Array(capacity);
    this.endSize = new Float32Array(capacity);
    this.r0 = new Float32Array(capacity);
    this.g0 = new Float32Array(capacity);
    this.b0 = new Float32Array(capacity);
    this.r1 = new Float32Array(capacity);
    this.g1 = new Float32Array(capacity);
    this.b1 = new Float32Array(capacity);
    this.peakAlpha = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.rotSpeed = new Float32Array(capacity);
    this.quad = new Float32Array(capacity);
    this.swirlSpeed = new Float32Array(capacity);
    this.swirlOriginX = new Float32Array(capacity);
    this.swirlOriginZ = new Float32Array(capacity);
    this.floorY = new Float32Array(capacity);
    this.bounce = new Float32Array(capacity);

    const positions = new Float32Array(capacity * 3);
    const sizes = new Float32Array(capacity);
    const colors = new Float32Array(capacity * 3);
    const alphas = new Float32Array(capacity);
    const rots = new Float32Array(capacity);
    const quads = new Float32Array(capacity);

    for (let i = 0; i < capacity; i++) {
      positions[i * 3 + 1] = -9999;
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.sizeAttr = new THREE.BufferAttribute(sizes, 1);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1);
    this.rotAttr = new THREE.BufferAttribute(rots, 1);
    this.quadAttr = new THREE.BufferAttribute(quads, 1);

    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.rotAttr.setUsage(THREE.DynamicDrawUsage);
    this.quadAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aColor', this.colorAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aRot', this.rotAttr);
    this.geometry.setAttribute('aQuad', this.quadAttr);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 18 : 16;
  }

  emit(p: ParticleSpawnParams): void {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.active[idx] === 0) {
      this.active[idx] = 1;
      this.activeCount++;
    }

    const boost = p.hdrBoost ?? 1.0;
    this.age[idx] = 0;
    this.life[idx] = Math.max(0.04, p.life);
    this.px[idx] = p.x;
    this.py[idx] = p.y;
    this.pz[idx] = p.z;
    this.vx[idx] = p.vx;
    this.vy[idx] = p.vy;
    this.vz[idx] = p.vz;
    this.ax[idx] = p.ax ?? 0;
    this.ay[idx] = p.ay ?? 0;
    this.az[idx] = p.az ?? 0;
    this.drag[idx] = p.drag ?? 0;
    this.startSize[idx] = p.startSize;
    this.endSize[idx] = p.endSize;

    this.r0[idx] = (((p.colorStartHex >> 16) & 255) / 255) * boost;
    this.g0[idx] = (((p.colorStartHex >> 8) & 255) / 255) * boost;
    this.b0[idx] = ((p.colorStartHex & 255) / 255) * boost;

    this.r1[idx] = (((p.colorEndHex >> 16) & 255) / 255) * Math.max(0.7, boost * 0.65);
    this.g1[idx] = (((p.colorEndHex >> 8) & 255) / 255) * Math.max(0.7, boost * 0.65);
    this.b1[idx] = ((p.colorEndHex & 255) / 255) * Math.max(0.7, boost * 0.65);

    this.peakAlpha[idx] = p.alpha ?? 1.0;
    this.rot[idx] = p.rot ?? 0;
    this.rotSpeed[idx] = p.rotSpeed ?? 0;
    this.quad[idx] = p.quadrant ?? AtlasQuad.Glow;
    this.swirlSpeed[idx] = p.swirlSpeed ?? 0;
    this.swirlOriginX[idx] = p.swirlOriginX ?? p.x;
    this.swirlOriginZ[idx] = p.swirlOriginZ ?? p.z;
    this.floorY[idx] = p.floorY ?? -9999;
    this.bounce[idx] = p.bounce ?? 0;

    const i3 = idx * 3;
    (this.posAttr.array as Float32Array)[i3] = p.x;
    (this.posAttr.array as Float32Array)[i3 + 1] = p.y;
    (this.posAttr.array as Float32Array)[i3 + 2] = p.z;
    (this.sizeAttr.array as Float32Array)[idx] = p.startSize;
    (this.colorAttr.array as Float32Array)[i3] = this.r0[idx];
    (this.colorAttr.array as Float32Array)[i3 + 1] = this.g0[idx];
    (this.colorAttr.array as Float32Array)[i3 + 2] = this.b0[idx];
    (this.alphaAttr.array as Float32Array)[idx] = this.peakAlpha[idx];
    (this.rotAttr.array as Float32Array)[idx] = this.rot[idx];
    (this.quadAttr.array as Float32Array)[idx] = this.quad[idx];
    this.markDirty();
  }

  update(dt: number): void {
    if (this.activeCount <= 0) return;

    const posArr = this.posAttr.array as Float32Array;
    const sizeArr = this.sizeAttr.array as Float32Array;
    const colArr = this.colorAttr.array as Float32Array;
    const alphaArr = this.alphaAttr.array as Float32Array;
    const rotArr = this.rotAttr.array as Float32Array;

    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 0) continue;

      const nextAge = this.age[i] + dt;
      const life = this.life[i];
      if (nextAge >= life) {
        this.active[i] = 0;
        this.activeCount--;
        alphaArr[i] = 0;
        sizeArr[i] = 0;
        posArr[i * 3 + 1] = -9999;
        continue;
      }

      this.age[i] = nextAge;
      const t = nextAge / life;

      const damp = this.drag[i] > 0 ? Math.max(0, 1 - this.drag[i] * dt) : 1;
      let vx = (this.vx[i] + this.ax[i] * dt) * damp;
      let vy = (this.vy[i] + this.ay[i] * dt) * damp;
      let vz = (this.vz[i] + this.az[i] * dt) * damp;

      let px = this.px[i] + vx * dt;
      let py = this.py[i] + vy * dt;
      let pz = this.pz[i] + vz * dt;

      const sw = this.swirlSpeed[i];
      if (sw !== 0) {
        const ox = this.swirlOriginX[i];
        const oz = this.swirlOriginZ[i];
        const dx = px - ox;
        const dz = pz - oz;
        const ang = sw * dt;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        px = ox + dx * c - dz * s;
        pz = oz + dx * s + dz * c;
      }

      const flY = this.floorY[i];
      if (py < flY && flY > -9000) {
        py = flY;
        vy = Math.abs(vy) * this.bounce[i];
        vx *= 0.72;
        vz *= 0.72;
      }

      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      this.px[i] = px;
      this.py[i] = py;
      this.pz[i] = pz;

      const rot = this.rot[i] + this.rotSpeed[i] * dt;
      this.rot[i] = rot;

      const fadeIn = Math.min(1, t / 0.12);
      const fadeOut = 1 - t * t;
      const alpha = this.peakAlpha[i] * fadeIn * fadeOut;
      const size = this.startSize[i] + (this.endSize[i] - this.startSize[i]) * t;

      const i3 = i * 3;
      posArr[i3] = px;
      posArr[i3 + 1] = py;
      posArr[i3 + 2] = pz;
      sizeArr[i] = Math.max(0.01, size);
      colArr[i3] = this.r0[i] + (this.r1[i] - this.r0[i]) * t;
      colArr[i3 + 1] = this.g0[i] + (this.g1[i] - this.g0[i]) * t;
      colArr[i3 + 2] = this.b0[i] + (this.b1[i] - this.b0[i]) * t;
      alphaArr[i] = alpha;
      rotArr[i] = rot;
    }

    this.markDirty();
  }

  private markDirty(): void {
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.rotAttr.needsUpdate = true;
    this.quadAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const enum MeshPoolKind {
  Slash = 0,
  Ring = 1,
  Sphere = 2,
  Shard = 3,
  Pillar = 4,
  Phantom = 5,
}

interface ActiveMeshSlot {
  kind: MeshPoolKind;
  obj: THREE.Object3D;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  life: number;
  startX: number;
  startY: number;
  startZ: number;
  velX: number;
  velY: number;
  velZ: number;
  sx0: number;
  sy0: number;
  sz0: number;
  sx1: number;
  sy1: number;
  sz1: number;
  rotY0: number;
  rotYSpeed: number;
  peakOpacity: number;
  easePower: number;
}

interface FresnelShockSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  r0: number;
  r1: number;
  peakOpacity: number;
  easePower: number;
  rotSpeedY: number;
}

interface ActiveBoltSlot {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  positions: Float32Array;
  posAttr: THREE.BufferAttribute;
  active: boolean;
  age: number;
  life: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  jitterAmp: number;
  reJitterTimer: number;
  peakOpacity: number;
}

interface SoulTrailSlot {
  active: boolean;
  age: number;
  duration: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  emitAccum: number;
  phaseOffset: number;
  arcHeight: number;
  primaryHex: number;
  accentHex: number;
  scale: number;
}

interface DelayedTask {
  active: boolean;
  delay: number;
  type: 'void_pop' | 'phantom_step' | 'level_wave' | 'poison_wave';
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  radius: number;
  scale: number;
  colorHex: number;
}

function buildCrescentSlashGeometry(segments = 28, arcRad = Math.PI * 0.85): THREE.BufferGeometry {
  const verts = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];

  const startAng = -arcRad * 0.5;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const theta = startAng + u * arcRad;
    const taper = Math.sin(u * Math.PI);
    const outerR = 1.0;
    const innerR = Math.max(0.18, 1.0 - 0.52 * Math.pow(taper, 0.8));

    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    const vi = i * 2;
    verts[vi * 3] = sinT * innerR;
    verts[vi * 3 + 1] = 0;
    verts[vi * 3 + 2] = cosT * innerR;
    uvs[vi * 2] = u;
    uvs[vi * 2 + 1] = 0;

    verts[(vi + 1) * 3] = sinT * outerR;
    verts[(vi + 1) * 3 + 1] = 0;
    verts[(vi + 1) * 3 + 2] = cosT * outerR;
    uvs[(vi + 1) * 2] = u;
    uvs[(vi + 1) * 2 + 1] = 1;

    if (i < segments) {
      const a = vi;
      const b = vi + 1;
      const c = vi + 2;
      const d = vi + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildPhantomGroup(
  sharedGeos: {
    torso: THREE.BufferGeometry;
    head: THREE.BufferGeometry;
    shoulder: THREE.BufferGeometry;
    blade: THREE.BufferGeometry;
  },
  mat: THREE.MeshBasicMaterial,
): THREE.Group {
  const g = new THREE.Group();

  const torso = new THREE.Mesh(sharedGeos.torso, mat);
  torso.position.set(0, 0.82, 0);
  torso.rotation.x = 0.22;
  g.add(torso);

  const head = new THREE.Mesh(sharedGeos.head, mat);
  head.position.set(0, 1.56, 0.12);
  g.add(head);

  const leftShoulder = new THREE.Mesh(sharedGeos.shoulder, mat);
  leftShoulder.position.set(-0.34, 1.28, 0.04);
  g.add(leftShoulder);

  const rightShoulder = new THREE.Mesh(sharedGeos.shoulder, mat);
  rightShoulder.position.set(0.34, 1.28, 0.04);
  g.add(rightShoulder);

  const blade = new THREE.Mesh(sharedGeos.blade, mat);
  blade.position.set(0.42, 0.95, -0.35);
  blade.rotation.set(0.35, -0.25, 0.15);
  g.add(blade);

  return g;
}

export class VfxPoolSystem {
  private root: THREE.Group | null = null;
  private scene: THREE.Scene | null = null;
  private atlas: VfxTextureAtlas | null = null;
  private additiveParticles: ParticleBatchPool | null = null;
  private alphaParticles: ParticleBatchPool | null = null;

  private sharedGeos: THREE.BufferGeometry[] = [];
  private meshPools = new Map<MeshPoolKind, ActiveMeshSlot[]>();
  private meshCursors = new Map<MeshPoolKind, number>();
  private fresnelPool: FresnelShockSlot[] = [];
  private fresnelCursor = 0;
  private boltPool: ActiveBoltSlot[] = [];
  private boltCursor = 0;
  private soulTrails: SoulTrailSlot[] = [];
  private soulTrailCursor = 0;
  private delayedTasks: DelayedTask[] = [];
  private slashFlip = 1;
  private elapsedSec = 0;
  private rngState = 0x9e3779b9;

  init(scene: THREE.Scene): void {
    if (this.scene === scene && this.root) {
      return;
    }
    if (this.root) {
      this.dispose();
    }

    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'AbyssalVfxRoot';
    scene.add(this.root);

    this.atlas = createVfxTextureAtlas();
    this.additiveParticles = new ParticleBatchPool(2000, this.atlas.particleAtlas, true);
    this.alphaParticles = new ParticleBatchPool(800, this.atlas.particleAtlas, false);
    this.root.add(this.additiveParticles.points);
    this.root.add(this.alphaParticles.points);

    const slashGeo = buildCrescentSlashGeometry(28, Math.PI * 0.88);
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    ringGeo.rotateX(-Math.PI * 0.5);

    const sphereGeo = new THREE.IcosahedronGeometry(1, 2);
    const fresnelSphereGeo = new THREE.IcosahedronGeometry(1, 3);

    const shardGeo = new THREE.OctahedronGeometry(0.24, 0);
    shardGeo.scale(1, 3.1, 1);
    shardGeo.translate(0, 0.45, 0);

    const pillarGeo = new THREE.CylinderGeometry(0.55, 1.0, 1.0, 20, 1, true);
    pillarGeo.translate(0, 0.5, 0);

    const phantomTorso = new THREE.CylinderGeometry(0.24, 0.42, 1.25, 8, 1);
    const phantomHead = new THREE.OctahedronGeometry(0.21, 1);
    const phantomShoulder = new THREE.DodecahedronGeometry(0.16, 0);
    const phantomBlade = new THREE.BoxGeometry(0.08, 0.12, 1.15);

    this.sharedGeos.push(
      slashGeo,
      ringGeo,
      sphereGeo,
      fresnelSphereGeo,
      shardGeo,
      pillarGeo,
      phantomTorso,
      phantomHead,
      phantomShoulder,
      phantomBlade,
    );

    this.allocateMeshPool(MeshPoolKind.Slash, 24, () => {
      const mat = new THREE.MeshBasicMaterial({
        map: this.atlas!.slashGradient,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      return { obj: new THREE.Mesh(slashGeo, mat), mat };
    });

    this.allocateMeshPool(MeshPoolKind.Ring, 36, () => {
      const mat = new THREE.MeshBasicMaterial({
        map: this.atlas!.runeRing,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      return { obj: new THREE.Mesh(ringGeo, mat), mat };
    });

    this.allocateMeshPool(MeshPoolKind.Sphere, 22, () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      return { obj: new THREE.Mesh(sphereGeo, mat), mat };
    });

    this.allocateMeshPool(MeshPoolKind.Shard, 40, () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      return { obj: new THREE.Mesh(shardGeo, mat), mat };
    });

    this.allocateMeshPool(MeshPoolKind.Pillar, 18, () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      return { obj: new THREE.Mesh(pillarGeo, mat), mat };
    });

    this.allocateMeshPool(MeshPoolKind.Phantom, 12, () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const grp = buildPhantomGroup(
        {
          torso: phantomTorso,
          head: phantomHead,
          shoulder: phantomShoulder,
          blade: phantomBlade,
        },
        mat,
      );
      return { obj: grp, mat };
    });

    // Allocate Custom GLSL Fresnel Refractive/Emissive Shockwave Sphere Pool (22 slots)
    this.fresnelPool = [];
    this.fresnelCursor = 0;
    for (let i = 0; i < 22; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uOpacity: { value: 0 },
          uFresnelPower: { value: 2.6 },
          uRippleFreq: { value: 8.0 },
          uRippleAmp: { value: 0.06 },
          uPrimaryColor: { value: new THREE.Color(0xff6b35) },
          uRimColor: { value: new THREE.Color(0xffffff) },
        },
        vertexShader: FRESNEL_SHOCK_VERT,
        fragmentShader: FRESNEL_SHOCK_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(fresnelSphereGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 19;
      this.root.add(mesh);

      this.fresnelPool.push({
        mesh,
        mat,
        active: false,
        age: 0,
        life: 0.4,
        x: 0,
        y: 0,
        z: 0,
        r0: 0.2,
        r1: 2.0,
        peakOpacity: 0.9,
        easePower: 0.58,
        rotSpeedY: 2.2,
      });
    }

    // Allocate 3D Jagged Lightning Bolt Pool (22 lines, 17 vertices each)
    this.boltPool = [];
    this.boltCursor = 0;
    for (let i = 0; i < 22; i++) {
      const positions = new Float32Array(17 * 3);
      const geo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(positions, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', posAttr);
      this.sharedGeos.push(geo);

      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      line.renderOrder = 20;
      this.root.add(line);

      this.boltPool.push({
        line,
        mat,
        positions,
        posAttr,
        active: false,
        age: 0,
        life: 0.2,
        x0: 0,
        y0: 0,
        z0: 0,
        x1: 0,
        y1: 0,
        z1: 0,
        jitterAmp: 0.4,
        reJitterTimer: 0,
        peakOpacity: 1,
      });
    }

    this.soulTrails = [];
    this.soulTrailCursor = 0;
    for (let i = 0; i < 24; i++) {
      this.soulTrails.push({
        active: false,
        age: 0,
        duration: 0.3,
        fromX: 0,
        fromY: 0,
        fromZ: 0,
        prevX: 0,
        prevY: 0,
        prevZ: 0,
        emitAccum: 0,
        phaseOffset: 0,
        arcHeight: 1.5,
        primaryHex: 0xffd43b,
        accentHex: 0xffffff,
        scale: 1,
      });
    }

    this.delayedTasks = [];
    for (let i = 0; i < 32; i++) {
      this.delayedTasks.push({
        active: false,
        delay: 0,
        type: 'void_pop',
        x: 0,
        y: 0,
        z: 0,
        dx: 0,
        dz: 1,
        radius: 1,
        scale: 1,
        colorHex: 0xffffff,
      });
    }
  }

  getActiveParticleCount(): number {
    return (this.additiveParticles?.getActiveCount() ?? 0) +
           (this.alphaParticles?.getActiveCount() ?? 0);
  }

  private allocateMeshPool(
    kind: MeshPoolKind,
    count: number,
    factory: () => { obj: THREE.Object3D; mat: THREE.MeshBasicMaterial },
  ): void {
    const slots: ActiveMeshSlot[] = [];
    for (let i = 0; i < count; i++) {
      const { obj, mat } = factory();
      obj.visible = false;
      obj.frustumCulled = false;
      obj.renderOrder = 17;
      this.root!.add(obj);
      slots.push({
        kind,
        obj,
        mat,
        active: false,
        age: 0,
        life: 0.3,
        startX: 0,
        startY: 0,
        startZ: 0,
        velX: 0,
        velY: 0,
        velZ: 0,
        sx0: 1,
        sy0: 1,
        sz0: 1,
        sx1: 1,
        sy1: 1,
        sz1: 1,
        rotY0: 0,
        rotYSpeed: 0,
        peakOpacity: 1,
        easePower: 1,
      });
    }
    this.meshPools.set(kind, slots);
    this.meshCursors.set(kind, 0);
  }

  private rand(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private range(min: number, max: number): number {
    return min + this.rand() * (max - min);
  }

  private acquireMesh(kind: MeshPoolKind): ActiveMeshSlot | null {
    const pool = this.meshPools.get(kind);
    if (!pool || pool.length === 0) return null;
    const cur = this.meshCursors.get(kind) ?? 0;
    const slot = pool[cur];
    this.meshCursors.set(kind, (cur + 1) % pool.length);
    slot.active = true;
    slot.age = 0;
    slot.velX = 0;
    slot.velY = 0;
    slot.velZ = 0;
    slot.rotYSpeed = 0;
    slot.easePower = 0.65;
    slot.mat.wireframe = false;
    slot.obj.rotation.set(0, 0, 0);
    slot.obj.visible = true;
    return slot;
  }

  spawnFresnelShockwave(params: {
    x: number;
    y: number;
    z: number;
    r0: number;
    r1: number;
    life: number;
    primaryHex: number;
    rimHex: number;
    fresnelPower?: number;
    rippleFreq?: number;
    rippleAmp?: number;
    opacity?: number;
    easePower?: number;
    rotSpeedY?: number;
  }): void {
    if (this.fresnelPool.length === 0) return;
    const slot = this.fresnelPool[this.fresnelCursor];
    this.fresnelCursor = (this.fresnelCursor + 1) % this.fresnelPool.length;

    slot.active = true;
    slot.age = 0;
    slot.life = Math.max(0.08, params.life);
    slot.x = params.x;
    slot.y = params.y;
    slot.z = params.z;
    slot.r0 = Math.max(0.05, params.r0);
    slot.r1 = Math.max(0.05, params.r1);
    slot.peakOpacity = params.opacity ?? 0.9;
    slot.easePower = params.easePower ?? 0.56;
    slot.rotSpeedY = params.rotSpeedY ?? 2.4;

    const u = slot.mat.uniforms;
    u.uTime.value = this.elapsedSec;
    u.uProgress.value = 0;
    u.uOpacity.value = slot.peakOpacity;
    u.uFresnelPower.value = params.fresnelPower ?? 2.5;
    u.uRippleFreq.value = params.rippleFreq ?? 8.0;
    u.uRippleAmp.value = params.rippleAmp ?? 0.055;
    (u.uPrimaryColor.value as THREE.Color).setHex(params.primaryHex);
    (u.uRimColor.value as THREE.Color).setHex(params.rimHex);

    slot.mesh.position.set(params.x, params.y, params.z);
    slot.mesh.scale.setScalar(slot.r0);
    slot.mesh.rotation.set(0, this.range(0, Math.PI * 2), 0);
    slot.mesh.visible = true;
  }

  private spawnBolt(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colorHex: number,
    hdrBoost: number,
    jitterAmp: number,
    life: number,
    opacity = 1.0,
  ): void {
    if (this.boltPool.length === 0) return;
    const slot = this.boltPool[this.boltCursor];
    this.boltCursor = (this.boltCursor + 1) % this.boltPool.length;
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.x0 = x0;
    slot.y0 = y0;
    slot.z0 = z0;
    slot.x1 = x1;
    slot.y1 = y1;
    slot.z1 = z1;
    slot.jitterAmp = jitterAmp;
    slot.reJitterTimer = 0.035;
    slot.peakOpacity = opacity;

    const r = (((colorHex >> 16) & 255) / 255) * hdrBoost;
    const g = (((colorHex >> 8) & 255) / 255) * hdrBoost;
    const b = ((colorHex & 255) / 255) * hdrBoost;
    slot.mat.color.setRGB(r, g, b);
    slot.mat.opacity = opacity;
    slot.line.visible = true;
    this.populateBoltVertices(slot);
  }

  private populateBoltVertices(slot: ActiveBoltSlot): void {
    const segs = 16;
    const arr = slot.positions;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const env = Math.sin(t * Math.PI);
      const jx = (this.rand() * 2 - 1) * slot.jitterAmp * env;
      const jy = (this.rand() * 2 - 1) * slot.jitterAmp * 0.35 * env;
      const jz = (this.rand() * 2 - 1) * slot.jitterAmp * env;
      arr[i * 3] = slot.x0 + (slot.x1 - slot.x0) * t + jx;
      arr[i * 3 + 1] = slot.y0 + (slot.y1 - slot.y0) * t + jy;
      arr[i * 3 + 2] = slot.z0 + (slot.z1 - slot.z0) * t + jz;
    }
    slot.posAttr.needsUpdate = true;
  }

  private scheduleDelayed(
    delay: number,
    type: DelayedTask['type'],
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    radius: number,
    scale: number,
    colorHex: number,
  ): void {
    for (let i = 0; i < this.delayedTasks.length; i++) {
      const task = this.delayedTasks[i];
      if (!task.active) {
        task.active = true;
        task.delay = delay;
        task.type = type;
        task.x = x;
        task.y = y;
        task.z = z;
        task.dx = dx;
        task.dz = dz;
        task.radius = radius;
        task.scale = scale;
        task.colorHex = colorHex;
        return;
      }
    }
  }

  private setMeshHdrColor(mat: THREE.MeshBasicMaterial, hex: number, boost = 1.6): void {
    const r = (((hex >> 16) & 255) / 255) * boost;
    const g = (((hex >> 8) & 255) / 255) * boost;
    const b = ((hex & 255) / 255) * boost;
    mat.color.setRGB(r, g, b);
  }

  // ==========================================================================
  // Phase 2 & Phase 3 Expansion Event VFX Emitters
  // ==========================================================================

  emitSoulPickupTrail(
    fromPos: Vec3,
    kind: GroundLootDrop['kind'],
    rarity?: ItemRarity,
    isMythic?: boolean,
    runeId?: RuneId,
  ): void {
    if (!this.root || !this.additiveParticles) return;
    const fx = Number.isFinite(fromPos.x) ? fromPos.x : 0;
    const fy = (Number.isFinite(fromPos.y) ? fromPos.y : 0) + 0.25;
    const fz = Number.isFinite(fromPos.z) ? fromPos.z : 0;

    let primaryHex = 0xffd43b;
    let accentHex = 0xfff9db;
    let scale = 0.95;

    if (kind === 'item') {
      if (isMythic) {
        primaryHex = MYTHIC_COLOR.hex;
        accentHex = 0xffd43b;
        scale = 1.45;
      } else {
        const rKey = rarity ?? 'common';
        primaryHex = RARITY_COLORS[rKey].hex;
        accentHex = rKey === 'legendary' ? 0xfff3bf : 0xffffff;
        scale = rKey === 'legendary' ? 1.35 : rKey === 'epic' ? 1.18 : 1.05;
      }
    } else if (kind === 'rune') {
      primaryHex = runeId ? RUNE_COLORS[runeId] : 0x66d9e8;
      accentHex = 0xfff3bf;
      scale = 1.2;
    } else if (kind === 'health_orb') {
      primaryHex = 0xff4d6d;
      accentHex = 0x69db7c;
      scale = 1.05;
    } else if (kind === 'potion') {
      primaryHex = 0xf03e3e;
      accentHex = 0xffc9c9;
      scale = 1.0;
    }

    this.spawnFresnelShockwave({
      x: fx,
      y: fy + 0.1,
      z: fz,
      r0: 0.16 * scale,
      r1: 1.05 * scale,
      life: 0.28,
      primaryHex,
      rimHex: accentHex,
      fresnelPower: 2.3,
      rippleFreq: 10.0,
      rippleAmp: 0.06,
      opacity: 0.85,
    });

    if (this.soulTrails.length > 0) {
      const slot = this.soulTrails[this.soulTrailCursor];
      this.soulTrailCursor = (this.soulTrailCursor + 1) % this.soulTrails.length;
      slot.active = true;
      slot.age = 0;
      slot.duration = 0.3;
      slot.fromX = fx;
      slot.fromY = fy;
      slot.fromZ = fz;
      slot.prevX = fx;
      slot.prevY = fy;
      slot.prevZ = fz;
      slot.emitAccum = 0;
      slot.phaseOffset = this.range(0, Math.PI * 2);
      slot.arcHeight = this.range(1.25, 2.05) * scale;
      slot.primaryHex = primaryHex;
      slot.accentHex = accentHex;
      slot.scale = scale;
    }
  }

  emitGearEquipBurst(
    heroPos: Vec3,
    weaponVisual: WeaponVisualType,
    rarity?: ItemRarity,
    isMythic?: boolean,
  ): void {
    if (!this.root || !this.additiveParticles) return;
    const hx = Number.isFinite(heroPos.x) ? heroPos.x : 0;
    const hy = Number.isFinite(heroPos.y) ? heroPos.y : 0;
    const hz = Number.isFinite(heroPos.z) ? heroPos.z : 0;

    const rKey = rarity ?? 'uncommon';
    const rarityHex = isMythic ? MYTHIC_COLOR.hex : RARITY_COLORS[rKey].hex;
    const isArcaneWeapon = weaponVisual === 'staff';
    const rimHex = isMythic ? 0xffd43b : isArcaneWeapon ? 0x99e9f2 : 0xfff3bf;
    const scale = isMythic ? 1.5 : rKey === 'legendary' ? 1.35 : rKey === 'epic' ? 1.18 : 1.0;

    this.spawnFresnelShockwave({
      x: hx,
      y: hy + 0.95,
      z: hz,
      r0: 0.25 * scale,
      r1: 2.15 * scale,
      life: 0.42,
      primaryHex: rarityHex,
      rimHex,
      fresnelPower: 2.6,
      rippleFreq: isArcaneWeapon ? 12.0 : 8.5,
      rippleAmp: 0.07,
      opacity: 0.92,
    });

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.46;
      ring.startX = hx;
      ring.startY = hy + 0.06;
      ring.startZ = hz;
      ring.sx0 = 0.35;
      ring.sy0 = 1;
      ring.sz0 = 0.35;
      ring.sx1 = 2.35 * scale;
      ring.sy1 = 1;
      ring.sz1 = 2.35 * scale;
      ring.rotYSpeed = 3.8;
      ring.peakOpacity = 0.9;
      this.setMeshHdrColor(ring.mat, rarityHex, 2.4);
    }

    for (let i = 0; i < 28; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.3, 1.05) * scale;
      const isRune = i % 4 === 0;
      this.additiveParticles.emit({
        x: hx + Math.sin(ang) * r,
        y: hy + this.range(0.25, 1.35),
        z: hz + Math.cos(ang) * r,
        vx: Math.sin(ang) * this.range(0.8, 3.2),
        vy: this.range(1.8, 4.8) * scale,
        vz: Math.cos(ang) * this.range(0.8, 3.2),
        ay: isArcaneWeapon ? 0.5 : -6.0,
        drag: 2.0,
        life: this.range(0.32, 0.68),
        startSize: (isRune ? 0.4 : 0.25) * scale,
        endSize: 0.04,
        colorStartHex: rimHex,
        colorEndHex: rarityHex,
        hdrBoost: 2.5,
        quadrant: isRune ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: isArcaneWeapon ? 4.8 : 2.6,
        swirlOriginX: hx,
        swirlOriginZ: hz,
      });
    }
  }

  emitClassChangeBurst(heroPos: Vec3, heroClass: HeroClassId): void {
    if (!this.root || !this.additiveParticles) return;
    const hx = Number.isFinite(heroPos.x) ? heroPos.x : 0;
    const hy = Number.isFinite(heroPos.y) ? heroPos.y : 0;
    const hz = Number.isFinite(heroPos.z) ? heroPos.z : 0;

    const primaryHex = HERO_CLASS_CONFIG[heroClass]?.primaryColorHex ?? 0xffd43b;
    const rimHex =
      heroClass === 'arcanist' ? 0xa5d8ff : heroClass === 'shadowblade' ? 0xb2f2bb : 0xffe066;

    this.spawnFresnelShockwave({
      x: hx,
      y: hy + 0.9,
      z: hz,
      r0: 0.3,
      r1: 2.9,
      life: 0.55,
      primaryHex,
      rimHex,
      fresnelPower: 2.4,
      rippleFreq: 9.5,
      rippleAmp: 0.08,
      opacity: 0.95,
    });
    this.spawnFresnelShockwave({
      x: hx,
      y: hy + 0.9,
      z: hz,
      r0: 1.8,
      r1: 0.22,
      life: 0.32,
      primaryHex: rimHex,
      rimHex: 0xffffff,
      fresnelPower: 3.0,
      rippleFreq: 12.0,
      rippleAmp: 0.05,
      opacity: 0.78,
    });

    const beam = this.acquireMesh(MeshPoolKind.Pillar);
    if (beam) {
      beam.life = 0.68;
      beam.startX = hx;
      beam.startY = hy;
      beam.startZ = hz;
      beam.sx0 = 0.2;
      beam.sy0 = 6.5;
      beam.sz0 = 0.2;
      beam.sx1 = 1.35;
      beam.sy1 = 7.8;
      beam.sz1 = 1.35;
      beam.rotYSpeed = 3.2;
      beam.peakOpacity = 0.62;
      this.setMeshHdrColor(beam.mat, primaryHex, 2.3);
    }

    for (let i = 0; i < 38; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.45, 1.55);
      this.additiveParticles.emit({
        x: hx + Math.sin(ang) * r,
        y: hy + this.range(0.1, 1.4),
        z: hz + Math.cos(ang) * r,
        vx: 0,
        vy: this.range(2.2, 5.6),
        vz: 0,
        life: this.range(0.45, 0.95),
        startSize: this.range(0.24, 0.46),
        endSize: 0.05,
        colorStartHex: rimHex,
        colorEndHex: primaryHex,
        hdrBoost: 2.6,
        quadrant: i % 4 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: 5.4,
        swirlOriginX: hx,
        swirlOriginZ: hz,
      });
    }
  }

  emitPortalWarpBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const px = Number.isFinite(position.x) ? position.x : 0;
    const py = Number.isFinite(position.y) ? position.y : 0;
    const pz = Number.isFinite(position.z) ? position.z : 0;

    this.spawnFresnelShockwave({
      x: px,
      y: py + 1.0,
      z: pz,
      r0: 3.4,
      r1: 0.2,
      life: 0.38,
      primaryHex: 0x9c36b5,
      rimHex: 0x66d9e8,
      fresnelPower: 2.2,
      rippleFreq: 14.0,
      rippleAmp: 0.09,
      opacity: 0.92,
    });
    this.spawnFresnelShockwave({
      x: px,
      y: py + 1.0,
      z: pz,
      r0: 0.25,
      r1: 4.2,
      life: 0.65,
      primaryHex: 0xbe4bdb,
      rimHex: 0xe599f7,
      fresnelPower: 2.7,
      rippleFreq: 10.5,
      rippleAmp: 0.08,
      opacity: 0.95,
    });

    const riftBeam = this.acquireMesh(MeshPoolKind.Pillar);
    if (riftBeam) {
      riftBeam.life = 0.85;
      riftBeam.startX = px;
      riftBeam.startY = py;
      riftBeam.startZ = pz;
      riftBeam.sx0 = 0.3;
      riftBeam.sy0 = 10.5;
      riftBeam.sz0 = 0.3;
      riftBeam.sx1 = 1.9;
      riftBeam.sy1 = 11.5;
      riftBeam.sz1 = 1.9;
      riftBeam.rotYSpeed = -4.5;
      riftBeam.peakOpacity = 0.72;
      this.setMeshHdrColor(riftBeam.mat, 0x66d9e8, 2.5);
    }

    for (let b = 0; b < 3; b++) {
      const ang = (b / 3) * Math.PI * 2 + this.range(-0.3, 0.3);
      this.spawnBolt(
        px + Math.sin(ang) * 2.2,
        py + 4.2,
        pz + Math.cos(ang) * 2.2,
        px,
        py + 0.3,
        pz,
        b % 2 === 0 ? 0x66d9e8 : 0xe599f7,
        2.6,
        0.48,
        0.34,
        0.9,
      );
    }

    for (let i = 0; i < 52; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.5, 2.8);
      this.additiveParticles.emit({
        x: px + Math.sin(ang) * r,
        y: py + this.range(0.1, 2.2),
        z: pz + Math.cos(ang) * r,
        vx: -Math.sin(ang) * 1.8,
        vy: this.range(2.5, 7.2),
        vz: -Math.cos(ang) * 1.8,
        life: this.range(0.5, 1.05),
        startSize: this.range(0.26, 0.54),
        endSize: 0.04,
        colorStartHex: i % 2 === 0 ? 0x99e9f2 : 0xf3d9fa,
        colorEndHex: 0xae3ec9,
        hdrBoost: 2.7,
        quadrant: i % 4 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: 6.8,
        swirlOriginX: px,
        swirlOriginZ: pz,
      });
    }
  }

  /**
   * Phase 3: Distinct 3D Elemental Reaction Bursts (`shatter`, `volatile_blast`, `superconduct`, `abyssal_singularity`)
   */
  emitElementalReactionBurst(reaction: ElementalReactionType, position: Vec3): void {
    if (!this.root || !this.additiveParticles || !this.alphaParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    switch (reaction) {
      case 'shatter': {
        this.spawnFresnelShockwave({
          x,
          y: y + 0.75,
          z,
          r0: 0.3,
          r1: 3.4,
          life: 0.42,
          primaryHex: 0x4dabf7,
          rimHex: 0xffffff,
          fresnelPower: 2.5,
          rippleFreq: 14.0,
          rippleAmp: 0.08,
          opacity: 0.96,
        });

        for (let i = 0; i < 12; i++) {
          const shard = this.acquireMesh(MeshPoolKind.Shard);
          if (!shard) break;
          const ang = (i / 12) * Math.PI * 2 + this.range(-0.14, 0.14);
          shard.life = this.range(0.38, 0.58);
          shard.startX = x + Math.sin(ang) * 0.45;
          shard.startY = y + 0.35;
          shard.startZ = z + Math.cos(ang) * 0.45;
          shard.velX = Math.sin(ang) * this.range(4.2, 7.8);
          shard.velY = this.range(1.2, 3.8);
          shard.velZ = Math.cos(ang) * this.range(4.2, 7.8);
          shard.sx0 = 1.1;
          shard.sy0 = 1.45;
          shard.sz0 = 1.1;
          shard.sx1 = 0.1;
          shard.sy1 = 0.25;
          shard.sz1 = 0.1;
          shard.rotY0 = ang;
          shard.rotYSpeed = this.range(-9, 9);
          shard.obj.rotation.set(0.65, ang, 0);
          shard.peakOpacity = 0.95;
          this.setMeshHdrColor(shard.mat, i % 2 === 0 ? 0xe7f5ff : 0x74c0fc, 2.5);
        }

        for (let i = 0; i < 40; i++) {
          const ang = this.range(0, Math.PI * 2);
          const spd = this.range(3.5, 11.0);
          this.additiveParticles.emit({
            x,
            y: y + 0.7,
            z,
            vx: Math.sin(ang) * spd,
            vy: this.range(1.5, 6.5),
            vz: Math.cos(ang) * spd,
            ay: -15.0,
            drag: 2.0,
            life: this.range(0.28, 0.62),
            startSize: this.range(0.28, 0.52),
            endSize: 0.04,
            colorStartHex: 0xffffff,
            colorEndHex: 0x4dabf7,
            hdrBoost: 2.8,
            quadrant: AtlasQuad.Spark,
            floorY: Math.max(0.04, y + 0.04),
            bounce: 0.5,
          });
        }
        break;
      }

      case 'volatile_blast': {
        // Blight-Inferno twin emerald & magma Fresnel shockwaves
        this.spawnFresnelShockwave({
          x,
          y: y + 0.7,
          z,
          r0: 0.35,
          r1: 3.8,
          life: 0.45,
          primaryHex: 0xff6b35,
          rimHex: 0x94d82d,
          fresnelPower: 2.3,
          rippleFreq: 10.5,
          rippleAmp: 0.095,
          opacity: 0.95,
        });
        this.spawnFresnelShockwave({
          x,
          y: y + 0.7,
          z,
          r0: 0.25,
          r1: 2.6,
          life: 0.34,
          primaryHex: 0x51cf66,
          rimHex: 0xffec99,
          fresnelPower: 2.7,
          rippleFreq: 13.0,
          rippleAmp: 0.07,
          opacity: 0.9,
          rotSpeedY: -4.5,
        });

        for (let i = 0; i < 46; i++) {
          const ang = this.range(0, Math.PI * 2);
          const spd = this.range(3.0, 10.5);
          const isVenom = i % 2 === 0;
          this.additiveParticles.emit({
            x,
            y: y + 0.55,
            z,
            vx: Math.sin(ang) * spd,
            vy: this.range(2.0, 7.5),
            vz: Math.cos(ang) * spd,
            ay: -11.0,
            drag: 2.1,
            life: this.range(0.35, 0.78),
            startSize: this.range(0.32, 0.65),
            endSize: 0.05,
            colorStartHex: isVenom ? 0xd8f5a2 : 0xfff3bf,
            colorEndHex: isVenom ? 0x40c057 : 0xff6b35,
            hdrBoost: 2.6,
            quadrant: i % 4 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
            floorY: Math.max(0.04, y + 0.04),
            bounce: 0.38,
          });
        }
        break;
      }

      case 'superconduct': {
        // Cryo-Lightning plasma dome + 5 radial ground lightning arcs
        this.spawnFresnelShockwave({
          x,
          y: y + 0.75,
          z,
          r0: 0.3,
          r1: 3.6,
          life: 0.38,
          primaryHex: 0x74c0fc,
          rimHex: 0xe599f7,
          fresnelPower: 2.4,
          rippleFreq: 15.0,
          rippleAmp: 0.085,
          opacity: 0.95,
        });

        for (let b = 0; b < 5; b++) {
          const ang = (b / 5) * Math.PI * 2 + this.range(-0.2, 0.2);
          this.spawnBolt(
            x,
            y + 0.95,
            z,
            x + Math.sin(ang) * 3.4,
            y + 0.25,
            z + Math.cos(ang) * 3.4,
            b % 2 === 0 ? 0x99e9f2 : 0xd0bfff,
            2.9,
            0.46,
            0.3,
            0.96,
          );
        }

        for (let i = 0; i < 38; i++) {
          const ang = this.range(0, Math.PI * 2);
          const spd = this.range(4.0, 12.0);
          this.additiveParticles.emit({
            x,
            y: y + 0.6,
            z,
            vx: Math.sin(ang) * spd,
            vy: this.range(0.8, 5.5),
            vz: Math.cos(ang) * spd,
            drag: 2.5,
            life: this.range(0.22, 0.5),
            startSize: this.range(0.26, 0.48),
            endSize: 0.04,
            colorStartHex: 0xffffff,
            colorEndHex: i % 2 === 0 ? 0x66d9e8 : 0xb197fc,
            hdrBoost: 2.8,
            quadrant: AtlasQuad.Spark,
          });
        }
        break;
      }

      case 'abyssal_singularity': {
        this.emitVoidImplosion(x, y, z, 3.8, 1.35, 0xae3ec9);
        this.spawnFresnelShockwave({
          x,
          y: y + 0.8,
          z,
          r0: 3.9,
          r1: 0.15,
          life: 0.29,
          primaryHex: MYTHIC_COLOR.hex,
          rimHex: 0xe599f7,
          fresnelPower: 2.1,
          rippleFreq: 16.0,
          rippleAmp: 0.09,
          opacity: 0.95,
          rotSpeedY: 9.0,
        });
        break;
      }
    }
  }

  /**
   * Phase 3: Golden Aegis Dome + Counter-Riposte Crescent Slashes on `'combat:parryTriggered'`
   */
  emitParryBurst(position: Vec3, counterSuccess: boolean): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    const maxR = counterSuccess ? 2.85 : 1.55;
    this.spawnFresnelShockwave({
      x,
      y: y + 0.95,
      z,
      r0: 0.45,
      r1: maxR,
      life: counterSuccess ? 0.42 : 0.26,
      primaryHex: 0xffd43b,
      rimHex: 0xffffff,
      fresnelPower: 2.4,
      rippleFreq: 11.0,
      rippleAmp: 0.065,
      opacity: 0.95,
    });

    if (counterSuccess) {
      for (let s = 0; s < 2; s++) {
        const arc = this.acquireMesh(MeshPoolKind.Slash);
        if (!arc) break;
        const dirSign = s === 0 ? 1 : -1;
        arc.life = 0.26;
        arc.startX = x;
        arc.startY = y + 0.98;
        arc.startZ = z;
        arc.sx0 = 1.6;
        arc.sy0 = 1;
        arc.sz0 = 1.6;
        arc.sx1 = 3.1;
        arc.sy1 = 1;
        arc.sz1 = 3.1;
        arc.rotY0 = s * Math.PI;
        arc.rotYSpeed = 6.5 * dirSign;
        arc.obj.rotation.set(0, arc.rotY0, 0.16 * dirSign);
        arc.peakOpacity = 0.95;
        this.setMeshHdrColor(arc.mat, 0xffe066, 2.8);
      }

      const ring = this.acquireMesh(MeshPoolKind.Ring);
      if (ring) {
        ring.life = 0.44;
        ring.startX = x;
        ring.startY = y + 0.07;
        ring.startZ = z;
        ring.sx0 = 0.5;
        ring.sy0 = 1;
        ring.sz0 = 0.5;
        ring.sx1 = 3.2;
        ring.sy1 = 1;
        ring.sz1 = 3.2;
        ring.rotYSpeed = 4.2;
        ring.peakOpacity = 0.95;
        this.setMeshHdrColor(ring.mat, 0xffd43b, 2.7);
      }
    }

    const sparks = counterSuccess ? 34 : 16;
    for (let i = 0; i < sparks; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(3.5, counterSuccess ? 11.5 : 6.5);
      this.additiveParticles.emit({
        x,
        y: y + 0.95,
        z,
        vx: Math.sin(ang) * spd,
        vy: this.range(1.2, 5.2),
        vz: Math.cos(ang) * spd,
        ay: -12.0,
        drag: 2.2,
        life: this.range(0.22, 0.48),
        startSize: this.range(0.25, 0.48),
        endSize: 0.04,
        colorStartHex: 0xffffff,
        colorEndHex: 0xffd43b,
        hdrBoost: 2.8,
        quadrant: i % 4 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
      });
    }
  }

  /**
   * Phase 3: Primal Crimson-Gold Execution Finisher Pillar & Cross-Slash on `'combat:executionStrike'`
   */
  emitExecutionStrikeBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.9,
      z,
      r0: 0.35,
      r1: 3.6,
      life: 0.46,
      primaryHex: MYTHIC_COLOR.hex,
      rimHex: 0xffec99,
      fresnelPower: 2.3,
      rippleFreq: 11.0,
      rippleAmp: 0.09,
      opacity: 0.96,
    });

    const pillar = this.acquireMesh(MeshPoolKind.Pillar);
    if (pillar) {
      pillar.life = 0.65;
      pillar.startX = x;
      pillar.startY = y;
      pillar.startZ = z;
      pillar.sx0 = 0.35;
      pillar.sy0 = 8.5;
      pillar.sz0 = 0.35;
      pillar.sx1 = 1.75;
      pillar.sy1 = 9.5;
      pillar.sz1 = 1.75;
      pillar.rotYSpeed = 4.0;
      pillar.peakOpacity = 0.78;
      this.setMeshHdrColor(pillar.mat, MYTHIC_COLOR.hex, 2.7);
    }

    // X-crossed twin execution slashes
    for (let s = 0; s < 2; s++) {
      const slash = this.acquireMesh(MeshPoolKind.Slash);
      if (!slash) break;
      const sign = s === 0 ? 1 : -1;
      slash.life = 0.28;
      slash.startX = x;
      slash.startY = y + 1.05;
      slash.startZ = z;
      slash.sx0 = 1.5;
      slash.sy0 = 1;
      slash.sz0 = 1.5;
      slash.sx1 = 3.2;
      slash.sy1 = 1;
      slash.sz1 = 3.2;
      slash.rotY0 = s * Math.PI * 0.5;
      slash.rotYSpeed = 4.5 * sign;
      slash.obj.rotation.set(0, slash.rotY0, 0.55 * sign);
      slash.peakOpacity = 0.96;
      this.setMeshHdrColor(slash.mat, s === 0 ? MYTHIC_COLOR.hex : 0xffe066, 2.9);
    }

    this.emitBloodBurst(x, y, z, 1.45, MYTHIC_COLOR.hex);
    for (let i = 0; i < 36; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(4.0, 12.5);
      this.additiveParticles.emit({
        x,
        y: y + 0.9,
        z,
        vx: Math.sin(ang) * spd,
        vy: this.range(2.0, 7.5),
        vz: Math.cos(ang) * spd,
        ay: -14.0,
        drag: 2.0,
        life: this.range(0.25, 0.55),
        startSize: this.range(0.3, 0.56),
        endSize: 0.04,
        colorStartHex: 0xfff3bf,
        colorEndHex: MYTHIC_COLOR.hex,
        hdrBoost: 2.9,
        quadrant: AtlasQuad.Spark,
      });
    }
  }

  /**
   * Phase 3: Archon Awakening Ascension Burst on `'player:awakeningChanged'`
   */
  emitAwakeningBurst(position: Vec3, active: boolean): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    if (!active) {
      this.spawnFresnelShockwave({
        x,
        y: y + 0.95,
        z,
        r0: 2.2,
        r1: 0.25,
        life: 0.35,
        primaryHex: 0xbe4bdb,
        rimHex: 0xffd43b,
        fresnelPower: 2.6,
        rippleFreq: 10.0,
        rippleAmp: 0.05,
        opacity: 0.75,
      });
      return;
    }

    this.spawnFresnelShockwave({
      x,
      y: y + 0.95,
      z,
      r0: 0.35,
      r1: 4.1,
      life: 0.58,
      primaryHex: 0xffd43b,
      rimHex: 0xe599f7,
      fresnelPower: 2.3,
      rippleFreq: 11.0,
      rippleAmp: 0.09,
      opacity: 0.96,
    });

    const beam = this.acquireMesh(MeshPoolKind.Pillar);
    if (beam) {
      beam.life = 0.95;
      beam.startX = x;
      beam.startY = y;
      beam.startZ = z;
      beam.sx0 = 0.35;
      beam.sy0 = 10.5;
      beam.sz0 = 0.35;
      beam.sx1 = 2.1;
      beam.sy1 = 11.5;
      beam.sz1 = 2.1;
      beam.rotYSpeed = 3.6;
      beam.peakOpacity = 0.78;
      this.setMeshHdrColor(beam.mat, 0xffd43b, 2.8);
    }

    for (let b = 0; b < 3; b++) {
      const ang = (b / 3) * Math.PI * 2;
      this.spawnBolt(
        x + Math.sin(ang) * 1.4,
        y + 8.5,
        z + Math.cos(ang) * 1.4,
        x,
        y + 0.2,
        z,
        b === 0 ? 0xfff3bf : 0xe599f7,
        2.8,
        0.55,
        0.34,
        0.95,
      );
    }

    for (let i = 0; i < 48; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.4, 2.0);
      this.additiveParticles.emit({
        x: x + Math.sin(ang) * r,
        y: y + this.range(0.1, 1.5),
        z: z + Math.cos(ang) * r,
        vx: 0,
        vy: this.range(3.0, 7.2),
        vz: 0,
        life: this.range(0.55, 1.15),
        startSize: this.range(0.28, 0.56),
        endSize: 0.04,
        colorStartHex: 0xffffff,
        colorEndHex: i % 2 === 0 ? 0xffd43b : 0xda77f2,
        hdrBoost: 2.8,
        quadrant: i % 3 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: 6.2,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  /**
   * Phase 3: Blood-Moon Hellfire Rift on `'event:butcherInvasion'`
   */
  emitButcherInvasionBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles || !this.alphaParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    this.spawnFresnelShockwave({
      x,
      y: y + 1.0,
      z,
      r0: 0.4,
      r1: 4.5,
      life: 0.65,
      primaryHex: 0xc92a2a,
      rimHex: MYTHIC_COLOR.hex,
      fresnelPower: 2.2,
      rippleFreq: 9.0,
      rippleAmp: 0.1,
      opacity: 0.95,
    });

    const bloodPillar = this.acquireMesh(MeshPoolKind.Pillar);
    if (bloodPillar) {
      bloodPillar.life = 1.05;
      bloodPillar.startX = x;
      bloodPillar.startY = y;
      bloodPillar.startZ = z;
      bloodPillar.sx0 = 0.4;
      bloodPillar.sy0 = 9.5;
      bloodPillar.sz0 = 0.4;
      bloodPillar.sx1 = 2.2;
      bloodPillar.sy1 = 10.5;
      bloodPillar.sz1 = 2.2;
      bloodPillar.rotYSpeed = -2.8;
      bloodPillar.peakOpacity = 0.78;
      this.setMeshHdrColor(bloodPillar.mat, MYTHIC_COLOR.hex, 2.6);
    }

    for (let i = 0; i < 44; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(2.5, 9.5);
      this.additiveParticles.emit({
        x: x + this.range(-0.4, 0.4),
        y: y + 0.5,
        z: z + this.range(-0.4, 0.4),
        vx: Math.sin(ang) * spd,
        vy: this.range(2.5, 7.5),
        vz: Math.cos(ang) * spd,
        ay: -10.5,
        drag: 1.8,
        life: this.range(0.45, 0.95),
        startSize: this.range(0.32, 0.62),
        endSize: 0.06,
        colorStartHex: 0xff8787,
        colorEndHex: 0xc92a2a,
        hdrBoost: 2.6,
        quadrant: i % 4 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
      });
    }
  }

  /**
   * Phase 3: Gilded Trickster Portal Pop on `'event:goblinSpawned'` & Mimic Ambush on `'event:mimicRevealed'`
   */
  emitGoblinSpawnBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.75,
      z,
      r0: 0.25,
      r1: 2.6,
      life: 0.45,
      primaryHex: 0xffd43b,
      rimHex: 0x51cf66,
      fresnelPower: 2.5,
      rippleFreq: 12.0,
      rippleAmp: 0.07,
      opacity: 0.92,
    });

    this.emitChestOpen(x, y, z, 0.9, 0xffd43b);
  }

  emitMimicRevealBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.65,
      z,
      r0: 0.25,
      r1: 2.4,
      life: 0.36,
      primaryHex: 0xae3ec9,
      rimHex: MYTHIC_COLOR.hex,
      fresnelPower: 2.5,
      rippleFreq: 13.0,
      rippleAmp: 0.08,
      opacity: 0.92,
    });
    this.emitBloodBurst(x, y, z, 1.15, 0xae3ec9);
  }

  /**
   * Phase 3: Mythic Runeword Awakening Halo & Elder Glyphs on `'event:runewordForged'`
   */
  emitRunewordForgedBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    this.spawnFresnelShockwave({
      x,
      y: y + 1.0,
      z,
      r0: 0.3,
      r1: 3.4,
      life: 0.58,
      primaryHex: 0x66d9e8,
      rimHex: 0xffd43b,
      fresnelPower: 2.5,
      rippleFreq: 11.5,
      rippleAmp: 0.075,
      opacity: 0.95,
    });

    for (let h = 0; h < 3; h++) {
      const ring = this.acquireMesh(MeshPoolKind.Ring);
      if (!ring) break;
      ring.life = 0.78 + h * 0.14;
      ring.startX = x;
      ring.startY = y + 0.1 + h * 0.32;
      ring.startZ = z;
      ring.velY = 2.2;
      ring.sx0 = 0.9 + h * 0.35;
      ring.sy0 = 1;
      ring.sz0 = 0.9 + h * 0.35;
      ring.sx1 = 2.4;
      ring.sy1 = 1;
      ring.sz1 = 2.4;
      ring.rotYSpeed = (h % 2 === 0 ? 1 : -1) * 3.8;
      ring.peakOpacity = 0.92;
      this.setMeshHdrColor(ring.mat, h === 1 ? 0x66d9e8 : 0xffd43b, 2.6);
    }

    for (let i = 0; i < 42; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.4, 1.8);
      this.additiveParticles.emit({
        x: x + Math.sin(ang) * r,
        y: y + this.range(0.15, 1.4),
        z: z + Math.cos(ang) * r,
        vx: 0,
        vy: this.range(2.4, 5.8),
        vz: 0,
        life: this.range(0.55, 1.15),
        startSize: this.range(0.34, 0.58),
        endSize: 0.06,
        colorStartHex: 0xffffff,
        colorEndHex: i % 2 === 0 ? 0xffd43b : 0x66d9e8,
        hdrBoost: 2.7,
        quadrant: i % 2 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: 4.8,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  /**
   * Phase 3: Elder Rune Stone Absorption Burst on `'rune:pickedUp'`
   */
  emitRunePickupBurst(position: Vec3, runeId: RuneId): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;
    const runeHex = RUNE_COLORS[runeId] ?? 0x66d9e8;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.7,
      z,
      r0: 0.2,
      r1: 1.75,
      life: 0.36,
      primaryHex: runeHex,
      rimHex: 0xffffff,
      fresnelPower: 2.6,
      rippleFreq: 12.0,
      rippleAmp: 0.06,
      opacity: 0.92,
    });

    for (let i = 0; i < 24; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.25, 1.05);
      this.additiveParticles.emit({
        x: x + Math.sin(ang) * r,
        y: y + this.range(0.1, 0.6),
        z: z + Math.cos(ang) * r,
        vx: -Math.sin(ang) * 1.2,
        vy: this.range(2.4, 5.2),
        vz: -Math.cos(ang) * r * 1.2,
        life: this.range(0.38, 0.72),
        startSize: this.range(0.3, 0.5),
        endSize: 0.05,
        colorStartHex: 0xffffff,
        colorEndHex: runeHex,
        hdrBoost: 2.6,
        quadrant: i % 2 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: 5.5,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  // ==========================================================================
  // Phase 4 Multiplayer Co-op 3D VFX Emitters
  // ==========================================================================

  emitMpChatPopBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = (Number.isFinite(position.y) ? position.y : 0) + 1.85;
    const z = Number.isFinite(position.z) ? position.z : 0;

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      this.additiveParticles.emit({
        x: x + Math.sin(ang) * 0.25,
        y,
        z: z + Math.cos(ang) * 0.25,
        vx: Math.sin(ang) * 0.85,
        vy: this.range(0.6, 1.4),
        vz: Math.cos(ang) * 0.85,
        life: this.range(0.24, 0.42),
        startSize: 0.22,
        endSize: 0.03,
        colorStartHex: 0xfff9db,
        colorEndHex: 0x99e9f2,
        hdrBoost: 2.2,
        quadrant: AtlasQuad.Spark,
      });
    }
  }

  emitMpEmojiBurst(emojiId: EmojiReactionId, position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = (Number.isFinite(position.y) ? position.y : 0) + 1.8;
    const z = Number.isFinite(position.z) ? position.z : 0;

    const palette: Record<EmojiReactionId, { primary: number; accent: number }> = {
      crown_gg: { primary: 0xffd43b, accent: 0x66d9e8 },
      fire_hype: { primary: 0xff6b35, accent: 0xfff3bf },
      skull_danger: { primary: 0xff4d6d, accent: 0xbe4bdb },
      laugh_imp: { primary: 0x51cf66, accent: 0xffe066 },
      heart_thanks: { primary: 0xf06595, accent: 0xffdeeb },
      chest_loot: { primary: 0xffb703, accent: 0x4dabf7 },
      sos_help: { primary: 0xff1e42, accent: 0xffffff },
      swords_boss: { primary: 0xc92a2a, accent: 0xffd43b },
    };
    const col = palette[emojiId] ?? palette.crown_gg;

    this.spawnFresnelShockwave({
      x,
      y,
      z,
      r0: 0.14,
      r1: 0.95,
      life: 0.26,
      primaryHex: col.primary,
      rimHex: col.accent,
      fresnelPower: 2.6,
      rippleFreq: 12.0,
      rippleAmp: 0.05,
      opacity: 0.82,
    });

    // Bouncy celebratory confetti sparks
    for (let i = 0; i < 22; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(1.4, 4.2);
      this.additiveParticles.emit({
        x,
        y,
        z,
        vx: Math.sin(ang) * spd,
        vy: this.range(2.0, 5.2),
        vz: Math.cos(ang) * spd,
        ay: -9.5,
        drag: 1.8,
        life: this.range(0.32, 0.65),
        startSize: this.range(0.2, 0.38),
        endSize: 0.04,
        colorStartHex: col.accent,
        colorEndHex: i % 3 === 0 ? 0xffffff : col.primary,
        hdrBoost: 2.5,
        quadrant: i % 5 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-10, 10),
      });
    }
  }

  emitMpTacticalPingBurst(pingType: TacticalPingType, position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    const pingColors: Record<TacticalPingType, number> = {
      attack: 0xff4d6d,
      danger: 0xff6b35,
      loot: 0xffd43b,
      group: 0x339af0,
    };
    const pingHex = pingColors[pingType] ?? 0x339af0;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.45,
      z,
      r0: 0.22,
      r1: 2.35,
      life: 0.44,
      primaryHex: pingHex,
      rimHex: 0xffffff,
      fresnelPower: 2.5,
      rippleFreq: 11.0,
      rippleAmp: 0.06,
      opacity: 0.9,
    });

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.65;
      ring.startX = x;
      ring.startY = y + 0.06;
      ring.startZ = z;
      ring.sx0 = 0.3;
      ring.sy0 = 1;
      ring.sz0 = 0.3;
      ring.sx1 = 2.6;
      ring.sy1 = 1;
      ring.sz1 = 2.6;
      ring.rotYSpeed = 3.2;
      ring.peakOpacity = 0.95;
      this.setMeshHdrColor(ring.mat, pingHex, 2.5);
    }

    for (let i = 0; i < 18; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.15, 0.85);
      this.additiveParticles.emit({
        x: x + Math.sin(ang) * r,
        y: y + 0.15,
        z: z + Math.cos(ang) * r,
        vx: 0,
        vy: this.range(2.6, 5.8),
        vz: 0,
        life: this.range(0.35, 0.72),
        startSize: this.range(0.22, 0.4),
        endSize: 0.04,
        colorStartHex: 0xffffff,
        colorEndHex: pingHex,
        hdrBoost: 2.5,
        quadrant: i % 3 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: 4.2,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  emitMpSocialEmoteBurst(emoteId: SocialEmoteId, position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    const hex =
      emoteId === 'downed_kneel'
        ? 0xff4d6d
        : emoteId === 'revive_channel' || emoteId === 'kneel_pray'
          ? 0x69db7c
          : 0xffd43b;

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.52;
      ring.startX = x;
      ring.startY = y + 0.08;
      ring.startZ = z;
      ring.velY = emoteId === 'downed_kneel' ? 0 : 1.1;
      ring.sx0 = 0.45;
      ring.sy0 = 1;
      ring.sz0 = 0.45;
      ring.sx1 = 1.45;
      ring.sy1 = 1;
      ring.sz1 = 1.45;
      ring.rotYSpeed = 2.8;
      ring.peakOpacity = 0.78;
      this.setMeshHdrColor(ring.mat, hex, 2.1);
    }

    for (let i = 0; i < 14; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.3, 0.9);
      this.additiveParticles.emit({
        x: x + Math.sin(ang) * r,
        y: y + this.range(0.3, 1.3),
        z: z + Math.cos(ang) * r,
        vx: 0,
        vy: this.range(1.2, 2.8),
        vz: 0,
        life: this.range(0.35, 0.68),
        startSize: this.range(0.2, 0.36),
        endSize: 0.04,
        colorStartHex: 0xffffff,
        colorEndHex: hex,
        hdrBoost: 2.3,
        quadrant: AtlasQuad.Spark,
        swirlSpeed: 3.6,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  emitMpHighFiveClashBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    // Resounding Sworn Brethren golden Fresnel shockwave sphere!
    this.spawnFresnelShockwave({
      x,
      y: y + 1.2,
      z,
      r0: 0.35,
      r1: 3.85,
      life: 0.52,
      primaryHex: 0xffd43b,
      rimHex: 0xffffff,
      fresnelPower: 2.3,
      rippleFreq: 11.5,
      rippleAmp: 0.085,
      opacity: 0.96,
    });

    for (let s = 0; s < 2; s++) {
      const arc = this.acquireMesh(MeshPoolKind.Slash);
      if (!arc) break;
      const sign = s === 0 ? 1 : -1;
      arc.life = 0.28;
      arc.startX = x;
      arc.startY = y + 1.25;
      arc.startZ = z;
      arc.sx0 = 1.3;
      arc.sy0 = 1;
      arc.sz0 = 1.3;
      arc.sx1 = 2.95;
      arc.sy1 = 1;
      arc.sz1 = 2.95;
      arc.rotY0 = s * Math.PI;
      arc.rotYSpeed = 6.2 * sign;
      arc.obj.rotation.set(0, arc.rotY0, 0.32 * sign);
      arc.peakOpacity = 0.95;
      this.setMeshHdrColor(arc.mat, 0xffe066, 2.9);
    }

    const floorRing = this.acquireMesh(MeshPoolKind.Ring);
    if (floorRing) {
      floorRing.life = 0.58;
      floorRing.startX = x;
      floorRing.startY = y + 0.06;
      floorRing.startZ = z;
      floorRing.sx0 = 0.45;
      floorRing.sy0 = 1;
      floorRing.sz0 = 0.45;
      floorRing.sx1 = 3.5;
      floorRing.sy1 = 1;
      floorRing.sz1 = 3.5;
      floorRing.rotYSpeed = 3.4;
      floorRing.peakOpacity = 0.95;
      this.setMeshHdrColor(floorRing.mat, 0xffd43b, 2.7);
    }

    for (let i = 0; i < 44; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(3.5, 11.5);
      this.additiveParticles.emit({
        x,
        y: y + 1.2,
        z,
        vx: Math.sin(ang) * spd,
        vy: this.range(1.5, 6.8),
        vz: Math.cos(ang) * spd,
        ay: -12.5,
        drag: 2.0,
        life: this.range(0.28, 0.65),
        startSize: this.range(0.26, 0.5),
        endSize: 0.04,
        colorStartHex: 0xffffff,
        colorEndHex: i % 3 === 0 ? 0x66d9e8 : 0xffd43b,
        hdrBoost: 2.9,
        quadrant: i % 4 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        floorY: Math.max(0.04, y + 0.04),
        bounce: 0.45,
      });
    }
  }

  emitMpTeammateRevivedBurst(position: Vec3): void {
    if (!this.root || !this.additiveParticles) return;
    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    // Celestial golden-emerald pillar + Fresnel resurrection dome!
    this.emitLevelUpPillar(x, y, z, 1.1, 0xffd43b);
    this.emitHealAura(x, y, z, 2.8, 1.15, 0x69db7c);
  }

  // ==========================================================================
  // Core 13 VfxEffectType Emitters
  // ==========================================================================

  spawnVfx(type: VfxEffectType, position: Vec3, options?: VfxSpawnOptions): void {
    if (!this.root || !this.additiveParticles || !this.alphaParticles) return;

    const x = Number.isFinite(position.x) ? position.x : 0;
    const y = Number.isFinite(position.y) ? position.y : 0;
    const z = Number.isFinite(position.z) ? position.z : 0;

    const scale = clamp(Number.isFinite(options?.scale) ? options!.scale! : 1, 0.2, 5.0);
    const radius = clamp(
      Number.isFinite(options?.radius) ? options!.radius! : 2.4 * scale,
      0.35,
      16.0,
    );

    let dx = options?.direction?.x ?? 0;
    let dz = options?.direction?.z ?? 1;
    const dLen = Math.hypot(dx, dz);
    if (dLen > 0.0001) {
      dx /= dLen;
      dz /= dLen;
    } else {
      dx = 0;
      dz = 1;
    }

    switch (type) {
      case 'slash_arc':
        this.emitSlashArc(x, y, z, dx, dz, radius, scale, options?.colorHex);
        break;
      case 'hit_sparks':
        this.emitHitSparks(x, y, z, dx, dz, scale, options?.colorHex);
        break;
      case 'blood_burst':
        this.emitBloodBurst(x, y, z, scale, options?.colorHex);
        break;
      case 'fire_explosion':
        this.emitFireExplosion(x, y, z, radius, scale, options?.colorHex);
        break;
      case 'frost_nova':
        this.emitFrostNova(x, y, z, radius, scale, options?.colorHex);
        break;
      case 'lightning_strike':
        this.emitLightningStrike(x, y, z, radius, scale, options?.colorHex);
        break;
      case 'poison_cloud':
        this.emitPoisonCloud(x, y, z, radius, scale, options?.colorHex);
        break;
      case 'void_implosion':
        this.emitVoidImplosion(x, y, z, radius, scale, options?.colorHex);
        break;
      case 'heal_aura':
        this.emitHealAura(x, y, z, radius, scale, options?.colorHex);
        break;
      case 'level_up_pillar':
        this.emitLevelUpPillar(x, y, z, scale, options?.colorHex);
        break;
      case 'dodge_afterimage':
        this.emitDodgeAfterimage(x, y, z, dx, dz, scale, options?.colorHex);
        break;
      case 'loot_pickup':
        this.emitLootPickup(x, y, z, scale, options?.colorHex);
        break;
      case 'chest_open':
        this.emitChestOpen(x, y, z, scale, options?.colorHex);
        break;
    }
  }

  private emitSlashArc(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    radius: number,
    scale: number,
    colorHex?: number,
  ): void {
    const yaw = Math.atan2(dx, dz);
    const primaryHex = colorHex ?? 0xffb347;
    const hotCoreHex = 0xfff8e7;
    this.slashFlip = -this.slashFlip;
    const tilt = 0.22 * this.slashFlip;

    const outer = this.acquireMesh(MeshPoolKind.Slash);
    if (outer) {
      outer.life = 0.21;
      outer.startX = x;
      outer.startY = y + 0.92;
      outer.startZ = z;
      outer.sx0 = radius * 0.72;
      outer.sy0 = 1;
      outer.sz0 = radius * 0.72;
      outer.sx1 = radius * 1.12;
      outer.sy1 = 1;
      outer.sz1 = radius * 1.12;
      outer.rotY0 = yaw - 0.35 * this.slashFlip;
      outer.rotYSpeed = 3.4 * this.slashFlip;
      outer.obj.rotation.set(0, outer.rotY0, tilt);
      outer.peakOpacity = 0.95;
      this.setMeshHdrColor(outer.mat, primaryHex, 2.2);
    }

    const inner = this.acquireMesh(MeshPoolKind.Slash);
    if (inner) {
      inner.life = 0.16;
      inner.startX = x + dx * 0.12;
      inner.startY = y + 0.94;
      inner.startZ = z + dz * 0.12;
      inner.sx0 = radius * 0.78;
      inner.sy0 = 1;
      inner.sz0 = radius * 0.82;
      inner.sx1 = radius * 1.06;
      inner.sy1 = 1;
      inner.sz1 = radius * 1.08;
      inner.rotY0 = yaw - 0.2 * this.slashFlip;
      inner.rotYSpeed = 3.8 * this.slashFlip;
      inner.obj.rotation.set(0, inner.rotY0, tilt);
      inner.peakOpacity = 0.85;
      this.setMeshHdrColor(inner.mat, hotCoreHex, 2.6);
    }

    for (let i = 0; i < 16; i++) {
      const ang = yaw + this.range(-1.15, 1.15);
      const r = radius * this.range(0.65, 1.05);
      const sx = x + Math.sin(ang) * r;
      const sz = z + Math.cos(ang) * r;
      const tangentAng = ang + Math.PI * 0.5 * this.slashFlip;
      const spd = this.range(2.2, 5.8) * scale;
      this.additiveParticles!.emit({
        x: sx,
        y: y + 0.85 + this.range(-0.18, 0.18),
        z: sz,
        vx: Math.sin(tangentAng) * spd + Math.sin(ang) * 1.4,
        vy: this.range(-0.6, 1.8),
        vz: Math.cos(tangentAng) * spd + Math.cos(ang) * 1.4,
        ay: -4.5,
        drag: 3.2,
        life: this.range(0.16, 0.34),
        startSize: this.range(0.24, 0.42) * scale,
        endSize: 0.04,
        colorStartHex: hotCoreHex,
        colorEndHex: primaryHex,
        hdrBoost: 2.3,
        quadrant: AtlasQuad.Spark,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-8, 8),
      });
    }
  }

  private emitHitSparks(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    scale: number,
    colorHex?: number,
  ): void {
    const mainHex = colorHex ?? 0xffd43b;
    const hitY = y + 0.9;

    const flash = this.acquireMesh(MeshPoolKind.Sphere);
    if (flash) {
      flash.life = 0.11;
      flash.startX = x;
      flash.startY = hitY;
      flash.startZ = z;
      flash.sx0 = 0.18 * scale;
      flash.sy0 = 0.18 * scale;
      flash.sz0 = 0.18 * scale;
      flash.sx1 = 0.68 * scale;
      flash.sy1 = 0.68 * scale;
      flash.sz1 = 0.68 * scale;
      flash.peakOpacity = 0.95;
      this.setMeshHdrColor(flash.mat, 0xffffff, 2.8);
    }

    for (let i = 0; i < 24; i++) {
      const spreadAng = Math.atan2(dx, dz) + this.range(-1.35, 1.35);
      const spd = this.range(3.5, 10.5) * scale;
      this.additiveParticles!.emit({
        x,
        y: hitY,
        z,
        vx: Math.sin(spreadAng) * spd,
        vy: this.range(1.2, 6.2) * scale,
        vz: Math.cos(spreadAng) * spd,
        ay: -16.0,
        drag: 2.0,
        life: this.range(0.18, 0.42),
        startSize: this.range(0.22, 0.44) * scale,
        endSize: 0.03,
        colorStartHex: 0xfff9db,
        colorEndHex: mainHex,
        hdrBoost: 2.5,
        quadrant: AtlasQuad.Spark,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-12, 12),
        floorY: Math.max(0.03, y + 0.03),
        bounce: 0.45,
      });
    }
  }

  private emitBloodBurst(x: number, y: number, z: number, scale: number, colorHex?: number): void {
    const brightBlood = colorHex ?? 0xd91e2a;
    const darkBlood = 0x5c060c;
    const cy = y + 0.85;

    for (let i = 0; i < 28; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(1.8, 6.8) * scale;
      this.alphaParticles!.emit({
        x: x + this.range(-0.15, 0.15),
        y: cy + this.range(-0.15, 0.2),
        z: z + this.range(-0.15, 0.15),
        vx: Math.sin(ang) * spd,
        vy: this.range(1.5, 5.4) * scale,
        vz: Math.cos(ang) * spd,
        ay: -18.5,
        drag: 1.4,
        life: this.range(0.28, 0.62),
        startSize: this.range(0.24, 0.5) * scale,
        endSize: 0.1 * scale,
        colorStartHex: brightBlood,
        colorEndHex: darkBlood,
        hdrBoost: 1.15,
        alpha: 0.92,
        quadrant: AtlasQuad.Smoke,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-5, 5),
        floorY: Math.max(0.03, y + 0.03),
        bounce: 0.12,
      });
    }

    for (let i = 0; i < 8; i++) {
      this.alphaParticles!.emit({
        x: x + this.range(-0.25, 0.25),
        y: cy + this.range(-0.1, 0.25),
        z: z + this.range(-0.25, 0.25),
        vx: this.range(-1.1, 1.1),
        vy: this.range(0.2, 1.2),
        vz: this.range(-1.1, 1.1),
        drag: 3.0,
        life: this.range(0.32, 0.55),
        startSize: 0.55 * scale,
        endSize: 1.35 * scale,
        colorStartHex: 0x9e0b16,
        colorEndHex: 0x3b0408,
        alpha: 0.52,
        quadrant: AtlasQuad.Smoke,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-1.5, 1.5),
      });
    }
  }

  private emitFireExplosion(
    x: number,
    y: number,
    z: number,
    radius: number,
    scale: number,
    colorHex?: number,
  ): void {
    const coreColor = colorHex ?? 0xff6b35;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.55,
      z,
      r0: 0.35,
      r1: radius * 1.12,
      life: 0.38,
      primaryHex: coreColor,
      rimHex: 0xfff3bf,
      fresnelPower: 2.3,
      rippleFreq: 9.0,
      rippleAmp: 0.085,
      opacity: 0.94,
    });

    const shock = this.acquireMesh(MeshPoolKind.Sphere);
    if (shock) {
      shock.life = 0.38;
      shock.mat.wireframe = true;
      shock.startX = x;
      shock.startY = y + 0.45;
      shock.startZ = z;
      shock.sx0 = 0.5;
      shock.sy0 = 0.5;
      shock.sz0 = 0.5;
      shock.sx1 = radius * 1.18;
      shock.sy1 = radius * 1.05;
      shock.sz1 = radius * 1.18;
      shock.rotYSpeed = 4.2;
      shock.peakOpacity = 0.72;
      this.setMeshHdrColor(shock.mat, coreColor, 2.2);
    }

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.42;
      ring.startX = x;
      ring.startY = y + 0.06;
      ring.startZ = z;
      ring.sx0 = 0.35;
      ring.sy0 = 1;
      ring.sz0 = 0.35;
      ring.sx1 = radius * 1.25;
      ring.sy1 = 1;
      ring.sz1 = radius * 1.25;
      ring.rotYSpeed = 2.0;
      ring.peakOpacity = 0.95;
      this.setMeshHdrColor(ring.mat, coreColor, 2.4);
    }

    for (let i = 0; i < 46; i++) {
      const ang = this.range(0, Math.PI * 2);
      const elev = this.range(-0.1, 1.1);
      const spd = this.range(2.5, 9.5) * (radius / 2.6);
      this.additiveParticles!.emit({
        x: x + this.range(-0.25, 0.25),
        y: y + 0.45 + this.range(0, 0.35),
        z: z + this.range(-0.25, 0.25),
        vx: Math.sin(ang) * Math.cos(elev) * spd,
        vy: Math.sin(elev) * spd + this.range(1.5, 4.5),
        vz: Math.cos(ang) * Math.cos(elev) * spd,
        ay: -8.5,
        drag: 2.1,
        life: this.range(0.32, 0.78),
        startSize: this.range(0.35, 0.75) * scale,
        endSize: 0.06,
        colorStartHex: 0xfff3bf,
        colorEndHex: coreColor,
        hdrBoost: 2.5,
        quadrant: i % 3 === 0 ? AtlasQuad.Spark : AtlasQuad.Glow,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-6, 6),
        floorY: Math.max(0.04, y + 0.04),
        bounce: 0.35,
      });
    }

    for (let i = 0; i < 16; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.1, radius * 0.45);
      this.alphaParticles!.emit({
        x: x + Math.sin(ang) * r,
        y: y + 0.4 + this.range(0, 0.5),
        z: z + Math.cos(ang) * r,
        vx: Math.sin(ang) * this.range(0.6, 2.4),
        vy: this.range(1.6, 3.8),
        vz: Math.cos(ang) * this.range(0.6, 2.4),
        drag: 1.8,
        life: this.range(0.55, 1.05),
        startSize: 0.75 * scale,
        endSize: 2.1 * scale,
        colorStartHex: 0x5c2b16,
        colorEndHex: 0x1a1412,
        alpha: 0.58,
        quadrant: AtlasQuad.Smoke,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-1.8, 1.8),
      });
    }
  }

  private emitFrostNova(
    x: number,
    y: number,
    z: number,
    radius: number,
    scale: number,
    colorHex?: number,
  ): void {
    const iceHex = colorHex ?? 0x4dabf7;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.45,
      z,
      r0: 0.3,
      r1: radius * 1.04,
      life: 0.4,
      primaryHex: iceHex,
      rimHex: 0xe7f5ff,
      fresnelPower: 2.6,
      rippleFreq: 12.0,
      rippleAmp: 0.055,
      opacity: 0.88,
    });

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.48;
      ring.startX = x;
      ring.startY = y + 0.07;
      ring.startZ = z;
      ring.sx0 = 0.3;
      ring.sy0 = 1;
      ring.sz0 = 0.3;
      ring.sx1 = radius * 1.18;
      ring.sy1 = 1;
      ring.sz1 = radius * 1.18;
      ring.rotYSpeed = -2.2;
      ring.peakOpacity = 0.95;
      this.setMeshHdrColor(ring.mat, 0xa5d8ff, 2.4);
    }

    const shardCount = 10;
    for (let i = 0; i < shardCount; i++) {
      const shard = this.acquireMesh(MeshPoolKind.Shard);
      if (!shard) break;
      const ang = (i / shardCount) * Math.PI * 2 + this.range(-0.12, 0.12);
      const dist = radius * this.range(0.45, 0.92);
      shard.life = this.range(0.42, 0.62);
      shard.startX = x + Math.sin(ang) * dist;
      shard.startY = y;
      shard.startZ = z + Math.cos(ang) * dist;
      const shScale = this.range(0.85, 1.35) * scale;
      shard.sx0 = shScale * 0.4;
      shard.sy0 = 0.05;
      shard.sz0 = shScale * 0.4;
      shard.sx1 = shScale;
      shard.sy1 = shScale * this.range(1.1, 1.65);
      shard.sz1 = shScale;
      shard.rotY0 = ang;
      shard.obj.rotation.set(0.38, ang, 0);
      shard.peakOpacity = 0.9;
      this.setMeshHdrColor(shard.mat, i % 2 === 0 ? 0xd0ebff : iceHex, 2.1);
    }

    for (let i = 0; i < 36; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(2.2, 8.2) * (radius / 2.5);
      this.additiveParticles!.emit({
        x,
        y: y + 0.35,
        z,
        vx: Math.sin(ang) * spd,
        vy: this.range(0.5, 4.0),
        vz: Math.cos(ang) * spd,
        ay: -5.5,
        drag: 2.6,
        life: this.range(0.35, 0.75),
        startSize: this.range(0.24, 0.48) * scale,
        endSize: 0.05,
        colorStartHex: 0xffffff,
        colorEndHex: iceHex,
        hdrBoost: 2.3,
        quadrant: AtlasQuad.Spark,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-7, 7),
      });
    }
  }

  private emitLightningStrike(
    x: number,
    y: number,
    z: number,
    radius: number,
    scale: number,
    colorHex?: number,
  ): void {
    const boltHex = colorHex ?? 0xffec99;
    const skyY = y + 9.5 * scale;
    const skyX = x + this.range(-0.9, 0.9);
    const skyZ = z + this.range(-0.9, 0.9);

    this.spawnBolt(skyX, skyY, skyZ, x, y + 0.08, z, 0xffffff, 3.0, 0.68 * scale, 0.26, 1.0);
    this.spawnBolt(skyX, skyY, skyZ, x, y + 0.08, z, boltHex, 2.4, 0.52 * scale, 0.3, 0.92);

    for (let b = 0; b < 3; b++) {
      const t = this.range(0.28, 0.68);
      const bx0 = skyX + (x - skyX) * t;
      const by0 = skyY + (y - skyY) * t;
      const bz0 = skyZ + (z - skyZ) * t;
      const fang = this.range(0, Math.PI * 2);
      const fDist = this.range(1.1, 2.4) * scale;
      this.spawnBolt(
        bx0,
        by0,
        bz0,
        bx0 + Math.sin(fang) * fDist,
        Math.max(y + 0.1, by0 - this.range(1.6, 3.6) * scale),
        bz0 + Math.cos(fang) * fDist,
        0x74c0fc,
        2.3,
        0.42 * scale,
        0.22,
        0.85,
      );
    }

    this.spawnFresnelShockwave({
      x,
      y: y + 0.4,
      z,
      r0: 0.25,
      r1: radius * 0.95,
      life: 0.26,
      primaryHex: boltHex,
      rimHex: 0xffffff,
      fresnelPower: 2.4,
      rippleFreq: 14.0,
      rippleAmp: 0.07,
      opacity: 0.92,
    });

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.32;
      ring.startX = x;
      ring.startY = y + 0.06;
      ring.startZ = z;
      ring.sx0 = 0.2;
      ring.sy0 = 1;
      ring.sz0 = 0.2;
      ring.sx1 = radius * 1.1;
      ring.sy1 = 1;
      ring.sz1 = radius * 1.1;
      ring.rotYSpeed = 5.0;
      ring.peakOpacity = 0.92;
      this.setMeshHdrColor(ring.mat, boltHex, 2.5);
    }

    for (let i = 0; i < 34; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(3.5, 11.5) * scale;
      this.additiveParticles!.emit({
        x,
        y: y + 0.18,
        z,
        vx: Math.sin(ang) * spd,
        vy: this.range(1.5, 7.5) * scale,
        vz: Math.cos(ang) * spd,
        ay: -14.0,
        drag: 2.2,
        life: this.range(0.16, 0.42),
        startSize: this.range(0.22, 0.45) * scale,
        endSize: 0.03,
        colorStartHex: 0xffffff,
        colorEndHex: i % 2 === 0 ? boltHex : 0x74c0fc,
        hdrBoost: 2.8,
        quadrant: AtlasQuad.Spark,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-15, 15),
        floorY: Math.max(0.03, y + 0.03),
        bounce: 0.55,
      });
    }
  }

  private emitPoisonCloud(
    x: number,
    y: number,
    z: number,
    radius: number,
    scale: number,
    colorHex?: number,
  ): void {
    const toxicHex = colorHex ?? 0x51cf66;

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 1.25;
      ring.startX = x;
      ring.startY = y + 0.05;
      ring.startZ = z;
      ring.sx0 = radius * 0.45;
      ring.sy0 = 1;
      ring.sz0 = radius * 0.45;
      ring.sx1 = radius * 1.05;
      ring.sy1 = 1;
      ring.sz1 = radius * 1.05;
      ring.rotYSpeed = 0.8;
      ring.peakOpacity = 0.65;
      this.setMeshHdrColor(ring.mat, toxicHex, 1.5);
    }

    this.emitPoisonWaveParticles(x, y, z, radius, scale, toxicHex);
    this.scheduleDelayed(0.32, 'poison_wave', x, y, z, 0, 1, radius, scale, toxicHex);
    this.scheduleDelayed(0.65, 'poison_wave', x, y, z, 0, 1, radius, scale, toxicHex);
  }

  private emitPoisonWaveParticles(
    x: number,
    y: number,
    z: number,
    radius: number,
    scale: number,
    toxicHex: number,
  ): void {
    for (let i = 0; i < 14; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rand()) * radius * 0.85;
      this.alphaParticles!.emit({
        x: x + Math.sin(ang) * r,
        y: y + this.range(0.15, 0.55),
        z: z + Math.cos(ang) * r,
        vx: this.range(-0.6, 0.6),
        vy: this.range(0.45, 1.35),
        vz: this.range(-0.6, 0.6),
        drag: 1.2,
        life: this.range(0.75, 1.35),
        startSize: this.range(0.75, 1.25) * scale,
        endSize: this.range(1.6, 2.35) * scale,
        colorStartHex: toxicHex,
        colorEndHex: 0x1b4332,
        alpha: 0.44,
        quadrant: AtlasQuad.Smoke,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-1.1, 1.1),
      });
    }

    for (let i = 0; i < 10; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rand()) * radius * 0.9;
      this.additiveParticles!.emit({
        x: x + Math.sin(ang) * r,
        y: y + 0.1,
        z: z + Math.cos(ang) * r,
        vx: this.range(-0.35, 0.35),
        vy: this.range(1.1, 2.4),
        vz: this.range(-0.35, 0.35),
        life: this.range(0.55, 1.0),
        startSize: this.range(0.18, 0.32) * scale,
        endSize: 0.04,
        colorStartHex: 0xb2f2bb,
        colorEndHex: toxicHex,
        hdrBoost: 1.9,
        quadrant: AtlasQuad.Glow,
        swirlSpeed: this.range(-2.2, 2.2),
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  private emitVoidImplosion(
    x: number,
    y: number,
    z: number,
    radius: number,
    scale: number,
    colorHex?: number,
  ): void {
    const voidHex = colorHex ?? 0xbe4bdb;
    const cy = y + 0.7;

    this.spawnFresnelShockwave({
      x,
      y: cy,
      z,
      r0: radius * 1.18,
      r1: 0.14,
      life: 0.3,
      primaryHex: voidHex,
      rimHex: 0xf06595,
      fresnelPower: 2.2,
      rippleFreq: 13.0,
      rippleAmp: 0.08,
      opacity: 0.92,
      easePower: 1.4,
      rotSpeedY: -7.0,
    });

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.3;
      ring.startX = x;
      ring.startY = y + 0.06;
      ring.startZ = z;
      ring.sx0 = radius * 1.2;
      ring.sy0 = 1;
      ring.sz0 = radius * 1.2;
      ring.sx1 = 0.15;
      ring.sy1 = 1;
      ring.sz1 = 0.15;
      ring.rotYSpeed = -6.0;
      ring.peakOpacity = 0.92;
      this.setMeshHdrColor(ring.mat, 0xf06595, 2.4);
    }

    const suckDuration = 0.28;
    for (let i = 0; i < 40; i++) {
      const ang = this.range(0, Math.PI * 2);
      const dist = radius * this.range(0.75, 1.35);
      const px = x + Math.sin(ang) * dist;
      const py = cy + this.range(-0.55, 0.85);
      const pz = z + Math.cos(ang) * dist;
      this.additiveParticles!.emit({
        x: px,
        y: py,
        z: pz,
        vx: (x - px) / suckDuration,
        vy: (cy - py) / suckDuration,
        vz: (z - pz) / suckDuration,
        life: suckDuration,
        startSize: this.range(0.18, 0.36) * scale,
        endSize: 0.42 * scale,
        colorStartHex: voidHex,
        colorEndHex: 0xffffff,
        hdrBoost: 2.5,
        quadrant: i % 4 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: 6.5,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }

    this.scheduleDelayed(suckDuration, 'void_pop', x, y, z, 0, 1, radius, scale, voidHex);
  }

  private emitVoidPop(
    x: number,
    y: number,
    z: number,
    radius: number,
    scale: number,
    voidHex: number,
  ): void {
    const cy = y + 0.7;
    this.spawnFresnelShockwave({
      x,
      y: cy,
      z,
      r0: 0.16,
      r1: radius * 1.05,
      life: 0.3,
      primaryHex: voidHex,
      rimHex: 0xffffff,
      fresnelPower: 2.6,
      rippleFreq: 11.0,
      rippleAmp: 0.075,
      opacity: 0.95,
    });

    for (let i = 0; i < 32; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(3.0, 9.5) * (radius / 2.5);
      this.additiveParticles!.emit({
        x,
        y: cy,
        z,
        vx: Math.sin(ang) * spd,
        vy: this.range(-2.5, 4.5),
        vz: Math.cos(ang) * spd,
        drag: 2.8,
        life: this.range(0.24, 0.5),
        startSize: this.range(0.28, 0.52) * scale,
        endSize: 0.04,
        colorStartHex: 0xffffff,
        colorEndHex: voidHex,
        hdrBoost: 2.6,
        quadrant: AtlasQuad.Spark,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-9, 9),
      });
    }
  }

  private emitHealAura(
    x: number,
    y: number,
    z: number,
    radius: number,
    scale: number,
    colorHex?: number,
  ): void {
    const healHex = colorHex ?? 0x40c057;
    const haloRadius = Math.max(0.95, radius * 0.55);

    for (let h = 0; h < 3; h++) {
      const ring = this.acquireMesh(MeshPoolKind.Ring);
      if (!ring) break;
      ring.life = 0.72 + h * 0.12;
      ring.startX = x;
      ring.startY = y + 0.12 + h * 0.28;
      ring.startZ = z;
      ring.velY = 1.65 - h * 0.2;
      ring.sx0 = haloRadius * (0.75 + h * 0.12);
      ring.sy0 = 1;
      ring.sz0 = haloRadius * (0.75 + h * 0.12);
      ring.sx1 = haloRadius * 1.15;
      ring.sy1 = 1;
      ring.sz1 = haloRadius * 1.15;
      ring.rotYSpeed = (h % 2 === 0 ? 1 : -1) * 2.6;
      ring.peakOpacity = 0.85;
      this.setMeshHdrColor(ring.mat, h === 1 ? 0xffe066 : healHex, 2.2);
    }

    for (let i = 0; i < 32; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = haloRadius * this.range(0.35, 1.05);
      this.additiveParticles!.emit({
        x: x + Math.sin(ang) * r,
        y: y + this.range(0.05, 0.7),
        z: z + Math.cos(ang) * r,
        vx: 0,
        vy: this.range(1.6, 3.6) * scale,
        vz: 0,
        life: this.range(0.55, 1.05),
        startSize: this.range(0.22, 0.42) * scale,
        endSize: 0.05,
        colorStartHex: 0xd3f9d8,
        colorEndHex: i % 3 === 0 ? 0xffec99 : healHex,
        hdrBoost: 2.3,
        quadrant: i % 4 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: 3.4,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  private emitLevelUpPillar(
    x: number,
    y: number,
    z: number,
    scale: number,
    colorHex?: number,
  ): void {
    const goldHex = colorHex ?? 0xffd43b;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.9,
      z,
      r0: 0.3,
      r1: 3.3 * scale,
      life: 0.55,
      primaryHex: goldHex,
      rimHex: 0xffffff,
      fresnelPower: 2.5,
      rippleFreq: 10.0,
      rippleAmp: 0.075,
      opacity: 0.92,
    });

    const outerBeam = this.acquireMesh(MeshPoolKind.Pillar);
    if (outerBeam) {
      outerBeam.life = 1.15;
      outerBeam.startX = x;
      outerBeam.startY = y;
      outerBeam.startZ = z;
      outerBeam.sx0 = 0.25 * scale;
      outerBeam.sy0 = 9.5 * scale;
      outerBeam.sz0 = 0.25 * scale;
      outerBeam.sx1 = 1.65 * scale;
      outerBeam.sy1 = 10.5 * scale;
      outerBeam.sz1 = 1.65 * scale;
      outerBeam.rotYSpeed = 2.4;
      outerBeam.peakOpacity = 0.65;
      this.setMeshHdrColor(outerBeam.mat, goldHex, 2.4);
    }

    const innerBeam = this.acquireMesh(MeshPoolKind.Pillar);
    if (innerBeam) {
      innerBeam.life = 0.85;
      innerBeam.startX = x;
      innerBeam.startY = y;
      innerBeam.startZ = z;
      innerBeam.sx0 = 0.15 * scale;
      innerBeam.sy0 = 10.5 * scale;
      innerBeam.sz0 = 0.15 * scale;
      innerBeam.sx1 = 0.78 * scale;
      innerBeam.sy1 = 11.0 * scale;
      innerBeam.sz1 = 0.78 * scale;
      innerBeam.rotYSpeed = -3.2;
      innerBeam.peakOpacity = 0.9;
      this.setMeshHdrColor(innerBeam.mat, 0xfff9db, 3.0);
    }

    const floorRing = this.acquireMesh(MeshPoolKind.Ring);
    if (floorRing) {
      floorRing.life = 0.95;
      floorRing.startX = x;
      floorRing.startY = y + 0.06;
      floorRing.startZ = z;
      floorRing.sx0 = 0.4;
      floorRing.sy0 = 1;
      floorRing.sz0 = 0.4;
      floorRing.sx1 = 3.6 * scale;
      floorRing.sy1 = 1;
      floorRing.sz1 = 3.6 * scale;
      floorRing.rotYSpeed = 1.8;
      floorRing.peakOpacity = 0.95;
      this.setMeshHdrColor(floorRing.mat, goldHex, 2.6);
    }

    this.emitLevelUpRunesAndMotes(x, y, z, scale, goldHex);
    this.scheduleDelayed(0.2, 'level_wave', x, y, z, 0, 1, 2.5, scale, goldHex);
    this.scheduleDelayed(0.42, 'level_wave', x, y, z, 0, 1, 2.5, scale, goldHex);
  }

  private emitLevelUpRunesAndMotes(
    x: number,
    y: number,
    z: number,
    scale: number,
    goldHex: number,
  ): void {
    const ascRing = this.acquireMesh(MeshPoolKind.Ring);
    if (ascRing) {
      ascRing.life = 0.75;
      ascRing.startX = x;
      ascRing.startY = y + 0.15;
      ascRing.startZ = z;
      ascRing.velY = 3.8 * scale;
      ascRing.sx0 = 1.35 * scale;
      ascRing.sy0 = 1;
      ascRing.sz0 = 1.35 * scale;
      ascRing.sx1 = 0.85 * scale;
      ascRing.sy1 = 1;
      ascRing.sz1 = 0.85 * scale;
      ascRing.rotYSpeed = -4.0;
      ascRing.peakOpacity = 0.88;
      this.setMeshHdrColor(ascRing.mat, 0xfff3bf, 2.5);
    }

    for (let i = 0; i < 24; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.45, 1.65) * scale;
      const isRune = i < 8;
      this.additiveParticles!.emit({
        x: x + Math.sin(ang) * r,
        y: y + this.range(0.1, 1.2),
        z: z + Math.cos(ang) * r,
        vx: 0,
        vy: this.range(2.8, 6.2) * scale,
        vz: 0,
        life: this.range(0.75, 1.35),
        startSize: (isRune ? 0.52 : 0.28) * scale,
        endSize: (isRune ? 0.32 : 0.05) * scale,
        colorStartHex: 0xffffff,
        colorEndHex: goldHex,
        hdrBoost: 2.6,
        quadrant: isRune ? AtlasQuad.Rune : AtlasQuad.Spark,
        swirlSpeed: isRune ? 2.2 : 4.6,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  private emitDodgeAfterimage(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    scale: number,
    colorHex?: number,
  ): void {
    const ghostHex = colorHex ?? 0x66d9e8;
    this.spawnSinglePhantomGhost(x, y, z, dx, dz, scale, ghostHex);
    this.scheduleDelayed(
      0.045,
      'phantom_step',
      x + dx * 0.85,
      y,
      z + dz * 0.85,
      dx,
      dz,
      1,
      scale,
      ghostHex,
    );
    this.scheduleDelayed(
      0.09,
      'phantom_step',
      x + dx * 1.7,
      y,
      z + dz * 1.7,
      dx,
      dz,
      1,
      scale,
      0x9775fa,
    );
  }

  private spawnSinglePhantomGhost(
    x: number,
    y: number,
    z: number,
    dx: number,
    dz: number,
    scale: number,
    ghostHex: number,
  ): void {
    const yaw = Math.atan2(dx, dz);
    const ghost = this.acquireMesh(MeshPoolKind.Phantom);
    if (ghost) {
      ghost.life = 0.34;
      ghost.startX = x;
      ghost.startY = y;
      ghost.startZ = z;
      ghost.sx0 = scale;
      ghost.sy0 = scale;
      ghost.sz0 = scale;
      ghost.sx1 = scale * 1.08;
      ghost.sy1 = scale * 1.04;
      ghost.sz1 = scale * 1.08;
      ghost.rotY0 = yaw;
      ghost.obj.rotation.set(0, yaw, 0);
      ghost.peakOpacity = 0.55;
      this.setMeshHdrColor(ghost.mat, ghostHex, 1.9);
    }

    for (let i = 0; i < 10; i++) {
      this.additiveParticles!.emit({
        x: x + this.range(-0.3, 0.3),
        y: y + this.range(0.25, 1.45),
        z: z + this.range(-0.3, 0.3),
        vx: -dx * this.range(1.2, 3.8) + this.range(-0.6, 0.6),
        vy: this.range(0.1, 0.9),
        vz: -dz * this.range(1.2, 3.8) + this.range(-0.6, 0.6),
        drag: 3.0,
        life: this.range(0.2, 0.4),
        startSize: this.range(0.22, 0.42) * scale,
        endSize: 0.04,
        colorStartHex: 0xe3fafc,
        colorEndHex: ghostHex,
        hdrBoost: 2.1,
        quadrant: AtlasQuad.Glow,
      });
    }
  }

  private emitLootPickup(x: number, y: number, z: number, scale: number, colorHex?: number): void {
    const lootHex = colorHex ?? 0xffd43b;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.55,
      z,
      r0: 0.16 * scale,
      r1: 1.25 * scale,
      life: 0.3,
      primaryHex: lootHex,
      rimHex: 0xffffff,
      fresnelPower: 2.7,
      rippleFreq: 11.0,
      rippleAmp: 0.05,
      opacity: 0.88,
    });

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.36;
      ring.startX = x;
      ring.startY = y + 0.08;
      ring.startZ = z;
      ring.sx0 = 0.85 * scale;
      ring.sy0 = 1;
      ring.sz0 = 0.85 * scale;
      ring.sx1 = 0.15 * scale;
      ring.sy1 = 1;
      ring.sz1 = 0.15 * scale;
      ring.rotYSpeed = 5.5;
      ring.peakOpacity = 0.9;
      this.setMeshHdrColor(ring.mat, lootHex, 2.5);
    }

    const crystal = this.acquireMesh(MeshPoolKind.Shard);
    if (crystal) {
      crystal.life = 0.35;
      crystal.startX = x;
      crystal.startY = y + 0.25;
      crystal.startZ = z;
      crystal.velY = 2.6 * scale;
      crystal.sx0 = 0.65 * scale;
      crystal.sy0 = 0.65 * scale;
      crystal.sz0 = 0.65 * scale;
      crystal.sx1 = 0.05;
      crystal.sy1 = 1.2 * scale;
      crystal.sz1 = 0.05;
      crystal.rotYSpeed = 8.0;
      crystal.peakOpacity = 0.9;
      this.setMeshHdrColor(crystal.mat, 0xffffff, 2.6);
    }

    for (let i = 0; i < 22; i++) {
      const ang = this.range(0, Math.PI * 2);
      const r = this.range(0.25, 0.95) * scale;
      this.additiveParticles!.emit({
        x: x + Math.sin(ang) * r,
        y: y + this.range(0.08, 0.35),
        z: z + Math.cos(ang) * r,
        vx: -Math.sin(ang) * 1.4,
        vy: this.range(2.2, 4.8) * scale,
        vz: -Math.cos(ang) * 1.4,
        life: this.range(0.3, 0.58),
        startSize: this.range(0.2, 0.38) * scale,
        endSize: 0.04,
        colorStartHex: 0xffffff,
        colorEndHex: lootHex,
        hdrBoost: 2.5,
        quadrant: AtlasQuad.Spark,
        swirlSpeed: 6.0,
        swirlOriginX: x,
        swirlOriginZ: z,
      });
    }
  }

  private emitChestOpen(x: number, y: number, z: number, scale: number, colorHex?: number): void {
    const goldHex = colorHex ?? 0xffb703;

    this.spawnFresnelShockwave({
      x,
      y: y + 0.6,
      z,
      r0: 0.25 * scale,
      r1: 2.55 * scale,
      life: 0.45,
      primaryHex: goldHex,
      rimHex: 0xfff9db,
      fresnelPower: 2.5,
      rippleFreq: 9.0,
      rippleAmp: 0.07,
      opacity: 0.9,
    });

    const beam = this.acquireMesh(MeshPoolKind.Pillar);
    if (beam) {
      beam.life = 0.85;
      beam.startX = x;
      beam.startY = y + 0.35;
      beam.startZ = z;
      beam.sx0 = 0.25 * scale;
      beam.sy0 = 3.8 * scale;
      beam.sz0 = 0.25 * scale;
      beam.sx1 = 1.45 * scale;
      beam.sy1 = 5.2 * scale;
      beam.sz1 = 1.45 * scale;
      beam.rotYSpeed = 1.8;
      beam.peakOpacity = 0.68;
      this.setMeshHdrColor(beam.mat, goldHex, 2.4);
    }

    const ring = this.acquireMesh(MeshPoolKind.Ring);
    if (ring) {
      ring.life = 0.68;
      ring.startX = x;
      ring.startY = y + 0.07;
      ring.startZ = z;
      ring.sx0 = 0.3;
      ring.sy0 = 1;
      ring.sz0 = 0.3;
      ring.sx1 = 2.8 * scale;
      ring.sy1 = 1;
      ring.sz1 = 2.8 * scale;
      ring.rotYSpeed = 2.5;
      ring.peakOpacity = 0.92;
      this.setMeshHdrColor(ring.mat, 0xffe066, 2.5);
    }

    for (let i = 0; i < 42; i++) {
      const ang = this.range(0, Math.PI * 2);
      const spd = this.range(1.6, 5.2) * scale;
      this.additiveParticles!.emit({
        x: x + this.range(-0.2, 0.2),
        y: y + 0.55,
        z: z + this.range(-0.2, 0.2),
        vx: Math.sin(ang) * spd,
        vy: this.range(4.2, 8.8) * scale,
        vz: Math.cos(ang) * spd,
        ay: -14.5,
        drag: 1.1,
        life: this.range(0.55, 1.15),
        startSize: this.range(0.24, 0.46) * scale,
        endSize: 0.08,
        colorStartHex: 0xfff9db,
        colorEndHex: i % 5 === 0 ? 0x4dabf7 : goldHex,
        hdrBoost: 2.6,
        quadrant: i % 6 === 0 ? AtlasQuad.Rune : AtlasQuad.Spark,
        rot: this.range(0, Math.PI * 2),
        rotSpeed: this.range(-10, 10),
        floorY: Math.max(0.04, y + 0.04),
        bounce: 0.48,
      });
    }
  }

  private updateSoulTrails(dt: number, heroPos: Vec3): void {
    if (!this.additiveParticles) return;
    const tx = Number.isFinite(heroPos.x) ? heroPos.x : 0;
    const ty = (Number.isFinite(heroPos.y) ? heroPos.y : 0) + 1.05;
    const tz = Number.isFinite(heroPos.z) ? heroPos.z : 0;

    for (let i = 0; i < this.soulTrails.length; i++) {
      const st = this.soulTrails[i];
      if (!st.active) continue;

      st.age += dt;
      const t = clamp(st.age / st.duration, 0, 1);

      const inv = 1 - t;
      const midX = (st.fromX + tx) * 0.5;
      const midY = Math.max(st.fromY, ty) + st.arcHeight;
      const midZ = (st.fromZ + tz) * 0.5;

      const spiralEnv = Math.sin(t * Math.PI) * 0.42 * st.scale;
      const spiralAng = st.phaseOffset + t * Math.PI * 5.0;
      const curX =
        inv * inv * st.fromX + 2 * inv * t * midX + t * t * tx + Math.cos(spiralAng) * spiralEnv;
      const curY = inv * inv * st.fromY + 2 * inv * t * midY + t * t * ty;
      const curZ =
        inv * inv * st.fromZ + 2 * inv * t * midZ + t * t * tz + Math.sin(spiralAng) * spiralEnv;

      st.emitAccum += dt;
      const stepInterval = 0.014;
      while (st.emitAccum >= stepInterval) {
        st.emitAccum -= stepInterval;
        const frac = this.rand();
        const px = st.prevX + (curX - st.prevX) * frac;
        const py = st.prevY + (curY - st.prevY) * frac;
        const pz = st.prevZ + (curZ - st.prevZ) * frac;

        this.additiveParticles.emit({
          x: px,
          y: py,
          z: pz,
          vx: this.range(-0.55, 0.55),
          vy: this.range(0.15, 0.95),
          vz: this.range(-0.55, 0.55),
          drag: 3.5,
          life: this.range(0.16, 0.3),
          startSize: this.range(0.22, 0.38) * st.scale,
          endSize: 0.03,
          colorStartHex: st.accentHex,
          colorEndHex: st.primaryHex,
          hdrBoost: 2.6,
          quadrant: this.rand() < 0.2 ? AtlasQuad.Rune : AtlasQuad.Spark,
          rot: this.range(0, Math.PI * 2),
          rotSpeed: this.range(-8, 8),
        });
      }

      st.prevX = curX;
      st.prevY = curY;
      st.prevZ = curZ;

      if (st.age >= st.duration) {
        st.active = false;
        this.spawnFresnelShockwave({
          x: tx,
          y: ty,
          z: tz,
          r0: 0.14 * st.scale,
          r1: 0.92 * st.scale,
          life: 0.22,
          primaryHex: st.primaryHex,
          rimHex: st.accentHex,
          fresnelPower: 2.8,
          rippleFreq: 12.0,
          rippleAmp: 0.05,
          opacity: 0.85,
        });
      }
    }
  }

  update(dt: number, listenerPos?: Vec3): void {
    if (!this.root) return;
    const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    if (safeDt <= 0) return;

    this.elapsedSec += safeDt;
    this.updateSoulTrails(safeDt, listenerPos ?? { x: 0, y: 0, z: 0 });

    for (let i = 0; i < this.delayedTasks.length; i++) {
      const task = this.delayedTasks[i];
      if (!task.active) continue;
      task.delay -= safeDt;
      if (task.delay <= 0) {
        task.active = false;
        switch (task.type) {
          case 'void_pop':
            this.emitVoidPop(task.x, task.y, task.z, task.radius, task.scale, task.colorHex);
            break;
          case 'phantom_step':
            this.spawnSinglePhantomGhost(
              task.x,
              task.y,
              task.z,
              task.dx,
              task.dz,
              task.scale,
              task.colorHex,
            );
            break;
          case 'level_wave':
            this.emitLevelUpRunesAndMotes(task.x, task.y, task.z, task.scale, task.colorHex);
            break;
          case 'poison_wave':
            this.emitPoisonWaveParticles(
              task.x,
              task.y,
              task.z,
              task.radius,
              task.scale,
              task.colorHex,
            );
            break;
        }
      }
    }

    this.additiveParticles?.update(safeDt);
    this.alphaParticles?.update(safeDt);

    for (let i = 0; i < this.fresnelPool.length; i++) {
      const f = this.fresnelPool[i];
      if (!f.active) continue;
      f.age += safeDt;
      if (f.age >= f.life) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }

      const t = f.age / f.life;
      const ease = Math.pow(t, f.easePower);
      const radius = Math.max(0.01, f.r0 + (f.r1 - f.r0) * ease);
      f.mesh.scale.setScalar(radius);
      f.mesh.rotation.y += f.rotSpeedY * safeDt;

      const fadeIn = Math.min(1, t / 0.1);
      const fadeOut = 1 - t * t;
      f.mat.uniforms.uTime.value = this.elapsedSec;
      f.mat.uniforms.uProgress.value = t;
      f.mat.uniforms.uOpacity.value = f.peakOpacity * fadeIn * fadeOut;
    }

    for (const pool of this.meshPools.values()) {
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (!s.active) continue;
        s.age += safeDt;
        if (s.age >= s.life) {
          s.active = false;
          s.obj.visible = false;
          continue;
        }

        const t = s.age / s.life;
        const ease = Math.pow(t, s.easePower);

        s.obj.position.set(
          s.startX + s.velX * s.age,
          s.startY + s.velY * s.age,
          s.startZ + s.velZ * s.age,
        );
        s.obj.scale.set(
          Math.max(0.001, s.sx0 + (s.sx1 - s.sx0) * ease),
          Math.max(0.001, s.sy0 + (s.sy1 - s.sy0) * ease),
          Math.max(0.001, s.sz0 + (s.sz1 - s.sz0) * ease),
        );
        if (s.rotYSpeed !== 0) {
          s.obj.rotation.y = s.rotY0 + s.rotYSpeed * s.age;
        }

        const fadeIn = Math.min(1, t / 0.1);
        const fadeOut = 1 - t * t;
        s.mat.opacity = s.peakOpacity * fadeIn * fadeOut;
      }
    }

    for (let i = 0; i < this.boltPool.length; i++) {
      const b = this.boltPool[i];
      if (!b.active) continue;
      b.age += safeDt;
      if (b.age >= b.life) {
        b.active = false;
        b.line.visible = false;
        continue;
      }
      b.reJitterTimer -= safeDt;
      if (b.reJitterTimer <= 0) {
        b.reJitterTimer = 0.04;
        this.populateBoltVertices(b);
      }
      const t = b.age / b.life;
      b.mat.opacity = b.peakOpacity * (1 - t * t);
    }
  }

  dispose(): void {
    if (this.root && this.scene) {
      this.scene.remove(this.root);
    }

    this.additiveParticles?.dispose();
    this.alphaParticles?.dispose();
    this.additiveParticles = null;
    this.alphaParticles = null;

    for (const pool of this.meshPools.values()) {
      for (const slot of pool) {
        slot.mat.dispose();
      }
    }
    this.meshPools.clear();
    this.meshCursors.clear();

    for (const f of this.fresnelPool) {
      f.mat.dispose();
    }
    this.fresnelPool = [];

    for (const bolt of this.boltPool) {
      bolt.mat.dispose();
    }
    this.boltPool = [];

    for (const geo of this.sharedGeos) {
      geo.dispose();
    }
    this.sharedGeos = [];

    this.atlas?.dispose();
    this.atlas = null;
    this.soulTrails = [];
    this.delayedTasks = [];
    this.root = null;
    this.scene = null;
  }
}
