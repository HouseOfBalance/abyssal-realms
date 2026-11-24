import * as THREE from 'three';
import type { ElementalReactionType, Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';

const REACTION_RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const REACTION_RING_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uTime;
uniform float uSpokes;
uniform float uImplode;
uniform vec3 uPrimaryColor;
uniform vec3 uSecondaryColor;

varying vec2 vUv;

void main() {
  float r = length(vUv);
  if (r > 1.0) discard;

  float angle = atan(vUv.y, vUv.x);
  float phase = uImplode > 0.5 ? (1.0 - uProgress) : uProgress;

  // Primary shock-ring wavefront + secondary harmonic echo
  float frontRadius = clamp(0.16 + phase * 0.78, 0.08, 0.96);
  float ringWidth = mix(0.16, 0.055, uProgress);
  float mainWave = exp(-pow((r - frontRadius) / max(0.025, ringWidth), 2.0));

  float echoRadius = clamp(frontRadius * 0.62, 0.05, 0.88);
  float echoWave = exp(-pow((r - echoRadius) / max(0.03, ringWidth * 1.15), 2.0)) * 0.65;

  // Angular runic / crystalline interference spokes
  float spin = uImplode > 0.5 ? -uTime * 6.5 : uTime * 4.5;
  float spokeWave = 0.5 + 0.5 * cos(angle * uSpokes + spin + r * (uImplode > 0.5 ? 10.0 : -6.0));
  float spokeSharp = pow(spokeWave, 2.2);

  float coreSingularity = uImplode > 0.5
    ? exp(-pow(r * (2.6 + uProgress * 2.2), 2.0)) * (1.15 - uProgress * 0.45)
    : exp(-pow(r * 4.5, 2.0)) * (1.0 - uProgress) * 0.55;

  float envelope = 1.0 - smoothstep(0.58, 1.0, uProgress);
  float intensity = (mainWave * (0.78 + 0.55 * spokeSharp) + echoWave * (0.5 + 0.5 * spokeWave) + coreSingularity);
  float alpha = clamp(intensity * envelope, 0.0, 1.0);

  if (alpha <= 0.005) discard;

  vec3 col = mix(uPrimaryColor, uSecondaryColor, clamp(spokeSharp * 0.65 + (1.0 - mainWave) * 0.35, 0.0, 1.0));
  float hdrGain = 1.35 + mainWave * 1.45;
  gl_FragColor = vec4(col * hdrGain, alpha);
}
`;

const PARRY_WARD_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vNormalLocal;
varying vec3 vPosLocal;

void main() {
  vNormalLocal = normalize(normal);
  vPosLocal = position;
  float pulse = 1.0 + 0.025 * sin(uTime * 26.0 + position.y * 8.0);
  vec3 displaced = position * pulse;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const PARRY_WARD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uFlare;
uniform vec3 uGoldColor;
uniform vec3 uCoreColor;

varying vec3 vNormalLocal;
varying vec3 vPosLocal;

void main() {
  if (uOpacity <= 0.004) discard;
  if (vPosLocal.y < -0.15) discard;

  // View-independent spherical rim & runic latitude/longitude lattice
  float rim = 1.0 - abs(vNormalLocal.y) * 0.62;
  float theta = atan(vPosLocal.z, vPosLocal.x);
  float latBands = pow(0.5 + 0.5 * sin(vPosLocal.y * 18.0 - uTime * 14.0), 4.0);
  float lonRunes = pow(0.5 + 0.5 * cos(theta * 8.0 + uTime * 8.0), 5.0);
  float equator = exp(-pow((vPosLocal.y - 0.15) * 3.2, 2.0));

  float lattice = clamp(latBands * 0.45 + lonRunes * 0.45 + equator * 0.55, 0.0, 1.2);
  float alpha = clamp((rim * 0.52 + lattice * 0.58) * uOpacity * (1.0 + uFlare * 0.65), 0.0, 1.0);
  if (alpha <= 0.005) discard;

  vec3 color = mix(uGoldColor, uCoreColor, clamp(lattice * 0.6 + uFlare * 0.5, 0.0, 1.0));
  float hdr = 1.4 + uFlare * 1.6 + lattice * 0.8;
  gl_FragColor = vec4(color * hdr, alpha);
}
`;

const AWAKENING_SIGIL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AWAKENING_SIGIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uSolarColor;
uniform vec3 uAstralColor;

varying vec2 vUv;

void main() {
  if (uIntensity <= 0.004) discard;

  float r = length(vUv);
  if (r > 1.0) discard;

  float a = atan(vUv.y, vUv.x);

  // Outer & inner sovereign rune circles
  float outerRing = exp(-pow((r - 0.86) / 0.038, 2.0));
  float midRing = exp(-pow((r - 0.58) / 0.032, 2.0));
  float innerRing = exp(-pow((r - 0.28) / 0.035, 2.0));

  // Counter-rotating 8-point astral star mandala + flame tongues
  float starCW = pow(0.5 + 0.5 * cos(a * 8.0 - uTime * 2.6 + r * 3.0), 4.0) * smoothstep(0.15, 0.88, r) * (1.0 - smoothstep(0.84, 0.98, r));
  float starCCW = pow(0.5 + 0.5 * cos(a * 6.0 + uTime * 3.4 - r * 5.5), 3.0) * smoothstep(0.1, 0.68, r) * (1.0 - smoothstep(0.62, 0.82, r));
  float runeTicks = step(0.55, 0.5 + 0.5 * cos(a * 24.0 + uTime * 1.8)) * exp(-pow((r - 0.73) / 0.028, 2.0));

  // Radial astral-fire aura
  float flameFlicker = 0.5 + 0.5 * sin(a * 12.0 - uTime * 7.5 + sin(r * 14.0 - uTime * 9.0));
  float aura = (1.0 - r) * 0.28 * (0.7 + 0.6 * flameFlicker);

  float pattern = outerRing * 1.15 + midRing * 0.95 + innerRing * 0.9 + starCW * 0.85 + starCCW * 0.75 + runeTicks * 0.7 + aura;
  float edgeFade = 1.0 - smoothstep(0.9, 1.0, r);
  float alpha = clamp(pattern * edgeFade * uIntensity, 0.0, 1.0);

  if (alpha <= 0.005) discard;

  vec3 col = mix(uAstralColor, uSolarColor, clamp(outerRing + starCW * 0.85 + runeTicks, 0.0, 1.0));
  vec3 hotCore = vec3(1.0, 0.96, 0.86) * (innerRing * 0.65);
  gl_FragColor = vec4((col + hotCore) * 1.55, alpha);
}
`;

const EXECUTION_PILLAR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const EXECUTION_PILLAR_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uTime;
varying vec2 vUv;

void main() {
  float verticalFade = (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.08, vUv.y);
  float streak = 0.6 + 0.4 * sin(vUv.x * 37.699 + uTime * 22.0 - vUv.y * 12.0);
  float env = 1.0 - smoothstep(0.35, 1.0, uProgress);
  float alpha = clamp(verticalFade * streak * env * 0.92, 0.0, 1.0);
  if (alpha <= 0.005) discard;

  vec3 crimson = vec3(1.0, 0.14, 0.24);
  vec3 gold = vec3(1.0, 0.85, 0.32);
  vec3 col = mix(crimson, gold, clamp((1.0 - vUv.y) * 0.75 + streak * 0.35, 0.0, 1.0));
  gl_FragColor = vec4(col * 1.85, alpha);
}
`;

interface ReactionBurstSlot {
  active: boolean;
  reaction: ElementalReactionType;
  ageSec: number;
  durationSec: number;
  maxRadius: number;
  group: THREE.Group;
  ringMesh: THREE.Mesh;
  ringMaterial: THREE.ShaderMaterial;
  shards: THREE.Mesh[];
  shardMaterial: THREE.MeshBasicMaterial;
  shardDirs: Array<{ x: number; y: number; z: number; speed: number }>;
}

const REACTION_POOL_SIZE = 8;
const SHARDS_PER_REACTION = 8;
const AWAKENING_ORBIT_MOTE_COUNT = 6;

export class MasteryVfxRenderer {
  public readonly root = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  // Shared geometries
  private readonly planeGeo: THREE.PlaneGeometry;
  private readonly shardOctaGeo: THREE.OctahedronGeometry;
  private readonly wardDomeGeo: THREE.SphereGeometry;
  private readonly wardRingGeo: THREE.TorusGeometry;
  private readonly sigilRingOuterGeo: THREE.TorusGeometry;
  private readonly sigilRingInnerGeo: THREE.TorusGeometry;
  private readonly execPillarGeo: THREE.CylinderGeometry;

  // 1. Reaction Pool
  private readonly reactionPool: ReactionBurstSlot[] = [];
  private reactionPoolCursor = 0;

  // 2. Golden Parry Ward Shield Rig
  private readonly parryGroup = new THREE.Group();
  private readonly parryDomeMat: THREE.ShaderMaterial;
  private readonly parryHaloRingA: THREE.Mesh;
  private readonly parryHaloRingB: THREE.Mesh;
  private readonly parryRunes: THREE.Mesh[] = [];
  private readonly parryRiposteRing: THREE.Mesh;
  private readonly parryRiposteMat: THREE.ShaderMaterial;
  private parryCounterFlareSec = 0;
  private parryRiposteAgeSec = -1;

  // 3. Boss Stagger Crown & Execution Strike Rig
  private readonly staggerHaloGroup = new THREE.Group();
  private readonly staggerCrownRing: THREE.Mesh;
  private readonly staggerShards: THREE.Mesh[] = [];

  private readonly execGroup = new THREE.Group();
  private readonly execPillarMat: THREE.ShaderMaterial;
  private readonly execRingMat: THREE.ShaderMaterial;
  private readonly execRingMesh: THREE.Mesh;
  private readonly execPillarMesh: THREE.Mesh;
  private execAgeSec = -1;
  private readonly execDurationSec = 0.62;

  // 4. Abyssal Awakening Ground Sigil Rig
  private readonly awakeningGroup = new THREE.Group();
  private readonly awakeningDiscMat: THREE.ShaderMaterial;
  private readonly awakeningGimbalA: THREE.Mesh;
  private readonly awakeningGimbalB: THREE.Mesh;
  private readonly awakeningMotes: THREE.Mesh[] = [];
  private awakeningBlend = 0;

  private disposed = false;

  constructor() {
    this.root.name = 'CombatMasteryVfxRoot';

    this.planeGeo = this.trackGeo(new THREE.PlaneGeometry(2, 2));
    this.shardOctaGeo = this.trackGeo(new THREE.OctahedronGeometry(0.18, 0));
    this.wardDomeGeo = this.trackGeo(new THREE.SphereGeometry(1.38, 24, 16));
    this.wardRingGeo = this.trackGeo(new THREE.TorusGeometry(1.42, 0.035, 8, 36));
    this.sigilRingOuterGeo = this.trackGeo(new THREE.TorusGeometry(2.35, 0.032, 8, 48));
    this.sigilRingInnerGeo = this.trackGeo(new THREE.TorusGeometry(1.55, 0.026, 8, 36));
    this.execPillarGeo = this.trackGeo(new THREE.CylinderGeometry(0.55, 1.25, 9.5, 20, 1, true));

    // Build Reaction Burst Pool
    for (let i = 0; i < REACTION_POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;

      const ringMaterial = this.trackMat(
        new THREE.ShaderMaterial({
          vertexShader: REACTION_RING_VERT,
          fragmentShader: REACTION_RING_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uProgress: { value: 0 },
            uTime: { value: 0 },
            uSpokes: { value: 12 },
            uImplode: { value: 0 },
            uPrimaryColor: { value: new THREE.Color(0x74c0fc) },
            uSecondaryColor: { value: new THREE.Color(0xe7f5ff) },
          },
        }),
      );

      const ringMesh = new THREE.Mesh(this.planeGeo, ringMaterial);
      ringMesh.rotation.x = -Math.PI * 0.5;
      ringMesh.position.y = 0.08;
      ringMesh.renderOrder = 14;
      group.add(ringMesh);

      const shardMaterial = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x99e9f2,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );

      const shards: THREE.Mesh[] = [];
      const shardDirs: Array<{ x: number; y: number; z: number; speed: number }> = [];
      for (let s = 0; s < SHARDS_PER_REACTION; s++) {
        const shard = new THREE.Mesh(this.shardOctaGeo, shardMaterial);
        const angle = (s / SHARDS_PER_REACTION) * Math.PI * 2;
        shardDirs.push({
          x: Math.cos(angle),
          y: 0.42 + (s % 3) * 0.16,
          z: Math.sin(angle),
          speed: 5.5 + (s % 2) * 1.8,
        });
        shards.push(shard);
        group.add(shard);
      }

      this.root.add(group);
      this.reactionPool.push({
        active: false,
        reaction: 'shatter',
        ageSec: 0,
        durationSec: 0.55,
        maxRadius: 4.0,
        group,
        ringMesh,
        ringMaterial,
        shards,
        shardMaterial,
        shardDirs,
      });
    }

    // Build Golden 3D Runic Parry Ward Shield
    this.parryGroup.name = 'ParryRunicWardGroup';
    this.parryGroup.visible = false;

    this.parryDomeMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: PARRY_WARD_VERT,
        fragmentShader: PARRY_WARD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uFlare: { value: 0 },
          uGoldColor: { value: new THREE.Color(0xffca2c) },
          uCoreColor: { value: new THREE.Color(0xfff8db) },
        },
      }),
    );

    const domeMesh = new THREE.Mesh(this.wardDomeGeo, this.parryDomeMat);
    domeMesh.position.y = 0.95;
    domeMesh.renderOrder = 16;
    this.parryGroup.add(domeMesh);

    const goldRingMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffd43b,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.parryHaloRingA = new THREE.Mesh(this.wardRingGeo, goldRingMat);
    this.parryHaloRingA.position.y = 1.0;
    this.parryHaloRingA.rotation.x = Math.PI * 0.5;
    this.parryGroup.add(this.parryHaloRingA);

    this.parryHaloRingB = new THREE.Mesh(this.wardRingGeo, goldRingMat);
    this.parryHaloRingB.position.y = 1.05;
    this.parryHaloRingB.rotation.x = Math.PI * 0.34;
    this.parryGroup.add(this.parryHaloRingB);

    for (let i = 0; i < 4; i++) {
      const runeShard = new THREE.Mesh(this.shardOctaGeo, goldRingMat);
      runeShard.scale.set(0.85, 1.65, 0.45);
      this.parryRunes.push(runeShard);
      this.parryGroup.add(runeShard);
    }

    this.parryRiposteMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: REACTION_RING_VERT,
        fragmentShader: REACTION_RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0 },
          uTime: { value: 0 },
          uSpokes: { value: 8 },
          uImplode: { value: 0 },
          uPrimaryColor: { value: new THREE.Color(0xffd43b) },
          uSecondaryColor: { value: new THREE.Color(0xffffff) },
        },
      }),
    );
    this.parryRiposteRing = new THREE.Mesh(this.planeGeo, this.parryRiposteMat);
    this.parryRiposteRing.rotation.x = -Math.PI * 0.5;
    this.parryRiposteRing.position.y = 0.09;
    this.parryRiposteRing.visible = false;
    this.parryRiposteRing.renderOrder = 15;
    this.root.add(this.parryRiposteRing);
    this.root.add(this.parryGroup);

    // Build Boss Stagger Halo & Execution Strike Heavensfall Pillar
    this.staggerHaloGroup.name = 'BossStaggerHaloGroup';
    this.staggerHaloGroup.visible = false;
    const staggerMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xff4d4d,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.staggerCrownRing = new THREE.Mesh(this.sigilRingInnerGeo, staggerMat);
    this.staggerCrownRing.rotation.x = Math.PI * 0.5;
    this.staggerHaloGroup.add(this.staggerCrownRing);
    for (let i = 0; i < 4; i++) {
      const fang = new THREE.Mesh(this.shardOctaGeo, staggerMat);
      fang.scale.set(0.9, 2.0, 0.9);
      this.staggerShards.push(fang);
      this.staggerHaloGroup.add(fang);
    }
    this.root.add(this.staggerHaloGroup);

    this.execGroup.name = 'ExecutionStrikePillarGroup';
    this.execGroup.visible = false;
    this.execPillarMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: EXECUTION_PILLAR_VERT,
        fragmentShader: EXECUTION_PILLAR_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0 },
          uTime: { value: 0 },
        },
      }),
    );
    this.execPillarMesh = new THREE.Mesh(this.execPillarGeo, this.execPillarMat);
    this.execPillarMesh.position.y = 4.75;
    this.execPillarMesh.renderOrder = 17;
    this.execGroup.add(this.execPillarMesh);

    this.execRingMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: REACTION_RING_VERT,
        fragmentShader: REACTION_RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0 },
          uTime: { value: 0 },
          uSpokes: { value: 10 },
          uImplode: { value: 0 },
          uPrimaryColor: { value: new THREE.Color(0xff2a4b) },
          uSecondaryColor: { value: new THREE.Color(0xffd43b) },
        },
      }),
    );
    this.execRingMesh = new THREE.Mesh(this.planeGeo, this.execRingMat);
    this.execRingMesh.rotation.x = -Math.PI * 0.5;
    this.execRingMesh.position.y = 0.1;
    this.execRingMesh.renderOrder = 16;
    this.execGroup.add(this.execRingMesh);
    this.root.add(this.execGroup);

    // Build Abyssal Awakening Orbiting Astral-Fire Ground Sigil Rig
    this.awakeningGroup.name = 'AwakeningAstralSigilGroup';
    this.awakeningGroup.visible = false;

    this.awakeningDiscMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: AWAKENING_SIGIL_VERT,
        fragmentShader: AWAKENING_SIGIL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uSolarColor: { value: new THREE.Color(0xff9f1c) },
          uAstralColor: { value: new THREE.Color(0xb5179e) },
        },
      }),
    );

    const sigilDisc = new THREE.Mesh(this.planeGeo, this.awakeningDiscMat);
    sigilDisc.rotation.x = -Math.PI * 0.5;
    sigilDisc.scale.setScalar(2.65);
    sigilDisc.position.y = 0.06;
    sigilDisc.renderOrder = 12;
    this.awakeningGroup.add(sigilDisc);

    const astralGoldMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffb703,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const astralVioletMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xd0bfff,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.awakeningGimbalA = new THREE.Mesh(this.sigilRingOuterGeo, astralGoldMat);
    this.awakeningGimbalA.position.y = 0.14;
    this.awakeningGimbalA.rotation.x = Math.PI * 0.5;
    this.awakeningGroup.add(this.awakeningGimbalA);

    this.awakeningGimbalB = new THREE.Mesh(this.sigilRingInnerGeo, astralVioletMat);
    this.awakeningGimbalB.position.y = 0.32;
    this.awakeningGimbalB.rotation.x = Math.PI * 0.44;
    this.awakeningGroup.add(this.awakeningGimbalB);

    for (let i = 0; i < AWAKENING_ORBIT_MOTE_COUNT; i++) {
      const mote = new THREE.Mesh(
        this.shardOctaGeo,
        i % 2 === 0 ? astralGoldMat : astralVioletMat,
      );
      mote.scale.set(0.75, 1.55, 0.75);
      this.awakeningMotes.push(mote);
      this.awakeningGroup.add(mote);
    }

    this.root.add(this.awakeningGroup);
  }

  public attachToScene(scene: THREE.Scene): void {
    if (this.disposed) return;
    if (this.root.parent !== scene) {
      scene.add(this.root);
    }
  }

  public spawnReactionBurst(reaction: ElementalReactionType, position: Vec3): void {
    if (this.disposed) return;

    const slot = this.reactionPool[this.reactionPoolCursor % REACTION_POOL_SIZE];
    this.reactionPoolCursor = (this.reactionPoolCursor + 1) % REACTION_POOL_SIZE;

    slot.active = true;
    slot.reaction = reaction;
    slot.ageSec = 0;
    slot.group.position.set(position.x, position.y, position.z);
    slot.group.visible = true;

    const u = slot.ringMaterial.uniforms;
    u.uProgress.value = 0;

    switch (reaction) {
      case 'shatter':
        slot.durationSec = 0.52;
        slot.maxRadius = 4.1;
        u.uSpokes.value = 12;
        u.uImplode.value = 0;
        (u.uPrimaryColor.value as THREE.Color).setHex(0x4dabf7);
        (u.uSecondaryColor.value as THREE.Color).setHex(0xe7f5ff);
        slot.shardMaterial.color.setHex(0xa5d8ff);
        break;

      case 'volatile_blast':
        slot.durationSec = 0.6;
        slot.maxRadius = 4.7;
        u.uSpokes.value = 9;
        u.uImplode.value = 0;
        (u.uPrimaryColor.value as THREE.Color).setHex(0x40c057);
        (u.uSecondaryColor.value as THREE.Color).setHex(0xff4d4d);
        slot.shardMaterial.color.setHex(0x8ce99a);
        break;

      case 'superconduct':
        slot.durationSec = 0.5;
        slot.maxRadius = 5.5;
        u.uSpokes.value = 16;
        u.uImplode.value = 0;
        (u.uPrimaryColor.value as THREE.Color).setHex(0x748ffc);
        (u.uSecondaryColor.value as THREE.Color).setHex(0xffe066);
        slot.shardMaterial.color.setHex(0xffe066);
        break;

      case 'abyssal_singularity':
        slot.durationSec = 0.65;
        slot.maxRadius = 6.2;
        u.uSpokes.value = 7;
        u.uImplode.value = 1;
        (u.uPrimaryColor.value as THREE.Color).setHex(0xae3ec9);
        (u.uSecondaryColor.value as THREE.Color).setHex(0xf3d9fa);
        slot.shardMaterial.color.setHex(0xda77f2);
        break;
    }

    for (let i = 0; i < slot.shards.length; i++) {
      const shard = slot.shards[i];
      shard.visible = true;
      shard.position.set(0, 0.6, 0);
      shard.scale.setScalar(1.0);
    }
  }

  public triggerParryRiposteFlash(position: Vec3): void {
    if (this.disposed) return;
    this.parryCounterFlareSec = 0.24;
    this.parryRiposteAgeSec = 0;
    this.parryRiposteRing.position.set(position.x, position.y + 0.1, position.z);
    this.parryRiposteRing.scale.setScalar(0.5);
    this.parryRiposteRing.visible = true;
    this.parryRiposteMat.uniforms.uProgress.value = 0;
  }

  public spawnExecutionBurst(position: Vec3): void {
    if (this.disposed) return;
    this.execAgeSec = 0;
    this.execGroup.position.set(position.x, position.y, position.z);
    this.execGroup.visible = true;
    this.execPillarMat.uniforms.uProgress.value = 0;
    this.execRingMat.uniforms.uProgress.value = 0;
    this.execPillarMesh.scale.set(1, 1, 1);
    this.execRingMesh.scale.setScalar(0.6);
  }

  public update(
    dt: number,
    elapsedSec: number,
    playerPos: Vec3,
    parryActive: boolean,
    awakened: boolean,
    staggeredBossPos: Vec3 | null,
  ): void {
    if (this.disposed) return;
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const t = Number.isFinite(elapsedSec) ? elapsedSec : 0;

    // 1. Update Elemental Reaction Shock-Rings & 3D Shrapnel
    for (let i = 0; i < this.reactionPool.length; i++) {
      const slot = this.reactionPool[i];
      if (!slot.active) continue;

      slot.ageSec += safeDt;
      if (slot.ageSec >= slot.durationSec) {
        slot.active = false;
        slot.group.visible = false;
        continue;
      }

      const progress = clamp(slot.ageSec / slot.durationSec, 0, 1);
      slot.ringMaterial.uniforms.uProgress.value = progress;
      slot.ringMaterial.uniforms.uTime.value = t;

      const isSingularity = slot.reaction === 'abyssal_singularity';
      const ringScale = isSingularity
        ? slot.maxRadius * (1.0 - progress * 0.55)
        : slot.maxRadius * (0.22 + Math.pow(progress, 0.58) * 0.82);
      slot.ringMesh.scale.setScalar(Math.max(0.2, ringScale));

      slot.shardMaterial.opacity = (1.0 - progress) * 0.92;
      for (let s = 0; s < slot.shards.length; s++) {
        const shard = slot.shards[s];
        const dir = slot.shardDirs[s];
        if (isSingularity) {
          // Spiral shards inward toward the singularity core
          const orbitR = (1.0 - progress) * (slot.maxRadius * 0.68);
          const swirlAngle = (s / slot.shards.length) * Math.PI * 2 + t * 9.0 + progress * 4.5;
          shard.position.set(
            Math.cos(swirlAngle) * orbitR,
            0.35 + (1.0 - progress) * 1.1,
            Math.sin(swirlAngle) * orbitR,
          );
        } else {
          const travel = progress * dir.speed * 0.58;
          const arcY = Math.max(0.08, 0.55 + dir.y * travel * 1.4 - 4.2 * progress * progress);
          shard.position.set(dir.x * travel, arcY, dir.z * travel);
        }
        shard.rotation.x += safeDt * 11.0;
        shard.rotation.y += safeDt * 14.0;
        shard.scale.setScalar(Math.max(0.15, (1.0 - progress * 0.72) * 1.15));
      }
    }

    // 2. Update Golden 3D Runic Parry Ward Shield
    if (this.parryCounterFlareSec > 0) {
      this.parryCounterFlareSec = Math.max(0, this.parryCounterFlareSec - safeDt);
    }
    const showWard = parryActive || this.parryCounterFlareSec > 0;
    this.parryGroup.visible = showWard;
    if (showWard) {
      this.parryGroup.position.set(playerPos.x, playerPos.y, playerPos.z);
      const flare = clamp(this.parryCounterFlareSec / 0.24, 0, 1);
      this.parryDomeMat.uniforms.uTime.value = t;
      this.parryDomeMat.uniforms.uFlare.value = flare;
      this.parryDomeMat.uniforms.uOpacity.value = parryActive ? 0.88 : flare * 0.75;

      this.parryHaloRingA.rotation.z = t * 5.5;
      this.parryHaloRingB.rotation.y = -t * 6.8;
      const wardScale = 1.0 + flare * 0.22;
      this.parryGroup.scale.setScalar(wardScale);

      for (let i = 0; i < this.parryRunes.length; i++) {
        const a = (i / this.parryRunes.length) * Math.PI * 2 + t * 6.2;
        const r = 1.46;
        const rune = this.parryRunes[i];
        rune.position.set(Math.cos(a) * r, 1.0 + Math.sin(t * 9.0 + i) * 0.14, Math.sin(a) * r);
        rune.rotation.y = -a;
      }
    }

    if (this.parryRiposteAgeSec >= 0) {
      this.parryRiposteAgeSec += safeDt;
      const ripDur = 0.36;
      if (this.parryRiposteAgeSec >= ripDur) {
        this.parryRiposteAgeSec = -1;
        this.parryRiposteRing.visible = false;
      } else {
        const p = clamp(this.parryRiposteAgeSec / ripDur, 0, 1);
        this.parryRiposteMat.uniforms.uProgress.value = p;
        this.parryRiposteMat.uniforms.uTime.value = t;
        this.parryRiposteRing.scale.setScalar(0.8 + p * 4.2);
      }
    }

    // 3. Update Boss Stagger Crown & Execution Pillar
    if (staggeredBossPos) {
      this.staggerHaloGroup.visible = true;
      this.staggerHaloGroup.position.set(
        staggeredBossPos.x,
        staggeredBossPos.y + 2.65 + Math.sin(t * 7.0) * 0.12,
        staggeredBossPos.z,
      );
      this.staggerCrownRing.rotation.z = t * 3.8;
      for (let i = 0; i < this.staggerShards.length; i++) {
        const a = (i / this.staggerShards.length) * Math.PI * 2 - t * 4.5;
        const fang = this.staggerShards[i];
        const pulseR = 1.35 + Math.sin(t * 10.0) * 0.15;
        fang.position.set(Math.cos(a) * pulseR, 0.15, Math.sin(a) * pulseR);
        fang.rotation.z = Math.PI * 0.25;
        fang.rotation.y = -a;
      }
    } else {
      this.staggerHaloGroup.visible = false;
    }

    if (this.execAgeSec >= 0) {
      this.execAgeSec += safeDt;
      if (this.execAgeSec >= this.execDurationSec) {
        this.execAgeSec = -1;
        this.execGroup.visible = false;
      } else {
        const p = clamp(this.execAgeSec / this.execDurationSec, 0, 1);
        this.execPillarMat.uniforms.uProgress.value = p;
        this.execPillarMat.uniforms.uTime.value = t;
        this.execRingMat.uniforms.uProgress.value = p;
        this.execRingMat.uniforms.uTime.value = t;
        const beamRadiusScale = Math.max(0.15, 1.35 - p * 0.95);
        this.execPillarMesh.scale.set(beamRadiusScale, 1.0, beamRadiusScale);
        this.execRingMesh.scale.setScalar(0.8 + Math.pow(p, 0.55) * 4.6);
      }
    }

    // 4. Update Abyssal Awakening Orbiting Astral-Fire Ground Sigil
    const targetBlend = awakened ? 1 : 0;
    this.awakeningBlend = clamp(
      this.awakeningBlend + (targetBlend - this.awakeningBlend) * Math.min(1, safeDt * 9.0 + (awakened ? 0.18 : 0)),
      0,
      1,
    );

    if (this.awakeningBlend > 0.005) {
      this.awakeningGroup.visible = true;
      this.awakeningGroup.position.set(playerPos.x, playerPos.y, playerPos.z);
      this.awakeningDiscMat.uniforms.uTime.value = t;
      this.awakeningDiscMat.uniforms.uIntensity.value = this.awakeningBlend * 0.95;

      this.awakeningGimbalA.rotation.z = t * 2.1;
      this.awakeningGimbalB.rotation.z = -t * 3.2;
      this.awakeningGimbalB.rotation.y = Math.sin(t * 2.4) * 0.22;

      for (let i = 0; i < this.awakeningMotes.length; i++) {
        const a = (i / this.awakeningMotes.length) * Math.PI * 2 + t * 3.4;
        const orbitR = 2.05 + Math.sin(t * 4.0 + i) * 0.22;
        const mote = this.awakeningMotes[i];
        mote.position.set(
          Math.cos(a) * orbitR,
          0.45 + Math.sin(t * 5.2 + i * 1.1) * 0.28,
          Math.sin(a) * orbitR,
        );
        mote.rotation.y = -a + t * 4.0;
        mote.rotation.x = t * 3.0;
      }
    } else {
      this.awakeningGroup.visible = false;
    }
  }

  public resetTransient(): void {
    if (this.disposed) return;
    for (let i = 0; i < this.reactionPool.length; i++) {
      this.reactionPool[i].active = false;
      this.reactionPool[i].group.visible = false;
    }
    this.parryCounterFlareSec = 0;
    this.parryRiposteAgeSec = -1;
    this.parryRiposteRing.visible = false;
    this.parryGroup.visible = false;
    this.staggerHaloGroup.visible = false;
    this.execAgeSec = -1;
    this.execGroup.visible = false;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.resetTransient();
    this.awakeningGroup.visible = false;
    this.root.removeFromParent();

    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
    this.root.clear();
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }
}
