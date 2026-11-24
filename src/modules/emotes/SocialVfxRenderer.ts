import * as THREE from 'three';
import type { SocialEmoteId, Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';

// ============================================================================
// Custom Procedural GLSL Shaders (Zero External Assets, Headless-Safe)
// ============================================================================

const QUAD_RADIAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HOLO_EMOTE_RING_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uSpokes;
uniform vec3 uPrimaryColor;
uniform vec3 uSecondaryColor;

varying vec2 vUv;

void main() {
  if (uOpacity <= 0.004) discard;
  float r = length(vUv);
  if (r > 1.0) discard;

  float a = atan(vUv.y, vUv.x);

  float outerRing = exp(-pow((r - 0.86) / 0.042, 2.0));
  float innerRing = exp(-pow((r - 0.54) / 0.035, 2.0));
  float scanWave = 0.5 + 0.5 * sin(r * 22.0 - uTime * 6.5);
  float glyphTicks = step(0.45, 0.5 + 0.5 * cos(a * uSpokes - uTime * 3.2))
    * exp(-pow((r - 0.71) / 0.048, 2.0));
  float starPetals = pow(0.5 + 0.5 * cos(a * max(4.0, uSpokes * 0.5) + uTime * 2.4), 3.0)
    * smoothstep(0.2, 0.85, r) * (1.0 - smoothstep(0.82, 0.98, r));

  float holoFill = (1.0 - r) * 0.16 * (0.65 + 0.35 * scanWave);
  float pattern = outerRing * 1.15 + innerRing * 0.85 + glyphTicks * 0.9 + starPetals * 0.65 + holoFill;
  float edgeFade = 1.0 - smoothstep(0.9, 1.0, r);
  float alpha = clamp(pattern * edgeFade * uOpacity, 0.0, 1.0);
  if (alpha <= 0.005) discard;

  vec3 col = mix(uPrimaryColor, uSecondaryColor, clamp(glyphTicks + starPetals * 0.7, 0.0, 1.0));
  gl_FragColor = vec4(col * 1.55, alpha);
}
`;

const CAMARADERIE_INVITE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uGoldPrimary;
uniform vec3 uGoldHot;

varying vec2 vUv;

void main() {
  if (uOpacity <= 0.004) discard;
  float r = length(vUv);
  if (r > 1.0) discard;

  float a = atan(vUv.y, vUv.x);

  // Outer 3.8m boundary ring + beckoning inward/outward camaraderie ripples
  float perimeter = exp(-pow((r - 0.955) / 0.028, 2.0));
  float innerCrest = exp(-pow((r - 0.68) / 0.024, 2.0)) * 0.75;
  float pulseR = fract(uTime * 0.75);
  float ripple = exp(-pow((r - pulseR * 0.94) / 0.045, 2.0)) * (1.0 - pulseR) * 0.85;

  // 8-pointed sworn-blade sun spokes + runic dashes
  float sunSpokes = pow(0.5 + 0.5 * cos(a * 8.0 + uTime * 1.8), 5.0)
    * smoothstep(0.35, 0.95, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float runeDashes = step(0.52, 0.5 + 0.5 * cos(a * 24.0 - uTime * 2.2))
    * exp(-pow((r - 0.84) / 0.022, 2.0));

  float warmFloorGlow = (1.0 - r * 0.65) * 0.12 * (0.8 + 0.2 * sin(uTime * 5.0));
  float intensity = perimeter * 1.35 + innerCrest + ripple + sunSpokes * 0.8 + runeDashes * 0.75 + warmFloorGlow;
  float alpha = clamp(intensity * uOpacity, 0.0, 1.0);
  if (alpha <= 0.005) discard;

  vec3 col = mix(uGoldPrimary, uGoldHot, clamp(perimeter * 0.7 + ripple + sunSpokes * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(col * 1.65, alpha);
}
`;

const FRESNEL_DOME_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec3 vLocalPos;

void main() {
  vLocalPos = position;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPos.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPos;
}
`;

const FRESNEL_DOME_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uTime;
uniform vec3 uGoldColor;
uniform vec3 uCoreColor;

varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec3 vLocalPos;

void main() {
  if (vLocalPos.y < -0.05) discard;
  float env = 1.0 - smoothstep(0.28, 1.0, uProgress);
  if (env <= 0.004) discard;

  vec3 viewDir = normalize(-vViewPos);
  float ndotv = abs(dot(normalize(vNormalView), viewDir));
  float fresnel = pow(clamp(1.0 - ndotv, 0.0, 1.0), 2.35);

  float theta = atan(vLocalPos.z, vLocalPos.x);
  float crownRays = pow(0.5 + 0.5 * cos(theta * 12.0 + uTime * 9.0), 3.0);
  float shockBand = exp(-pow((vLocalPos.y - uProgress * 0.85) * 3.4, 2.0));

  float alpha = clamp((fresnel * 0.92 + crownRays * 0.25 + shockBand * 0.42) * env, 0.0, 1.0);
  if (alpha <= 0.005) discard;

  vec3 col = mix(uGoldColor, uCoreColor, clamp(fresnel * 0.65 + shockBand * 0.5, 0.0, 1.0));
  float hdr = 1.75 + (1.0 - uProgress) * 1.45;
  gl_FragColor = vec4(col * hdr, alpha);
}
`;

const CLASH_RING_FRAG = /* glsl */ `
uniform float uProgress;
uniform float uTime;
uniform vec3 uGoldColor;
uniform vec3 uWhiteGold;

varying vec2 vUv;

void main() {
  float r = length(vUv);
  if (r > 1.0) discard;

  float a = atan(vUv.y, vUv.x);
  float front = clamp(0.14 + uProgress * 0.82, 0.1, 0.97);
  float width = mix(0.16, 0.045, uProgress);
  float waveA = exp(-pow((r - front) / max(0.025, width), 2.0));
  float waveB = exp(-pow((r - front * 0.64) / max(0.03, width * 1.1), 2.0)) * 0.65;
  float rays = pow(0.5 + 0.5 * cos(a * 12.0 - uTime * 7.0), 2.5);
  float centerFlash = exp(-pow(r * 4.2, 2.0)) * (1.0 - uProgress);

  float env = 1.0 - smoothstep(0.45, 1.0, uProgress);
  float alpha = clamp((waveA * (0.8 + 0.5 * rays) + waveB + centerFlash) * env, 0.0, 1.0);
  if (alpha <= 0.005) discard;

  vec3 col = mix(uGoldColor, uWhiteGold, clamp(waveA * 0.7 + centerFlash, 0.0, 1.0));
  gl_FragColor = vec4(col * 1.9, alpha);
}
`;

const DISTRESS_RING_FRAG = /* glsl */ `
uniform float uTime;
uniform float uUrgency;
uniform float uReviveProgress;
uniform vec3 uCrimsonColor;
uniform vec3 uGoldColor;

varying vec2 vUv;

void main() {
  float r = length(vUv);
  if (r > 1.0) discard;

  // atan2 normalized to [0, 1] starting from +Y (12 o'clock) for radial revive progress arc
  float angle = atan(vUv.x, vUv.y);
  float angle01 = fract((angle + 3.14159265) / 6.2831853);

  float pulseSpeed = mix(4.2, 11.5, uUrgency);
  float pulse = 0.5 + 0.5 * sin(uTime * pulseSpeed);

  // Outer 3.5m revive range ring + pulsing distress radar wave
  float outerRing = exp(-pow((r - 0.95) / 0.03, 2.0));
  float innerRing = exp(-pow((r - 0.46) / 0.032, 2.0));
  float radarR = fract(uTime * mix(0.65, 1.45, uUrgency));
  float radarWave = exp(-pow((r - radarR * 0.94) / 0.048, 2.0)) * (1.0 - radarR) * 0.85;

  float warningTicks = step(0.48, 0.5 + 0.5 * cos(angle * 16.0 + uTime * 2.5))
    * exp(-pow((r - 0.82) / 0.028, 2.0));

  // Golden radial progress arc when a teammate is actively channeling revive
  float arcMask = step(angle01, uReviveProgress) * step(0.001, uReviveProgress);
  float reviveArc = exp(-pow((r - 0.68) / 0.052, 2.0)) * arcMask * 1.5;

  float baseGlow = (1.0 - r) * 0.15 * (0.6 + 0.4 * pulse);
  float intensity = outerRing * (0.95 + 0.35 * pulse) + innerRing * 0.8 + radarWave + warningTicks * 0.75 + reviveArc + baseGlow;
  float alpha = clamp(intensity * 0.92, 0.0, 1.0);
  if (alpha <= 0.005) discard;

  vec3 distressMix = mix(uCrimsonColor, uGoldColor, clamp(innerRing * 0.6 + warningTicks * 0.5, 0.0, 1.0));
  vec3 finalCol = mix(distressMix, vec3(1.0, 0.93, 0.55), clamp(reviveArc, 0.0, 1.0));
  gl_FragColor = vec4(finalCol * 1.65, alpha);
}
`;

const PILLAR_BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PILLAR_BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColorBottom;
uniform vec3 uColorTop;

varying vec2 vUv;

void main() {
  if (uOpacity <= 0.004) discard;
  float vFade = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.42, 1.0, vUv.y));
  float plasma = 0.62 + 0.38 * sin(vUv.x * 25.1327 + uTime * 12.0 - vUv.y * 10.0);
  float alpha = clamp(vFade * plasma * uOpacity, 0.0, 1.0);
  if (alpha <= 0.005) discard;

  vec3 col = mix(uColorBottom, uColorTop, clamp(vUv.y * 1.15, 0.0, 1.0));
  gl_FragColor = vec4(col * 1.75, alpha);
}
`;

export interface InviteRingVisualInput {
  id: string;
  position: Vec3;
  remainingSec: number;
}

export interface DistressBeaconVisualInput {
  id: string;
  position: Vec3;
  urgency01: number;
  reviveProgress01: number;
}

interface EmotePalette {
  primaryHex: number;
  secondaryHex: number;
  spokes: number;
}

const EMOTE_PALETTES: Record<SocialEmoteId, EmotePalette> = {
  wave: { primaryHex: 0x4dabf7, secondaryHex: 0xffec99, spokes: 8 },
  cheer: { primaryHex: 0xffd43b, secondaryHex: 0xfff9db, spokes: 12 },
  dance: { primaryHex: 0xda77f2, secondaryHex: 0x4dabf7, spokes: 16 },
  taunt: { primaryHex: 0xff4d4d, secondaryHex: 0xff922b, spokes: 6 },
  kneel_pray: { primaryHex: 0xe7f5ff, secondaryHex: 0xffd43b, spokes: 8 },
  sit_rest: { primaryHex: 0xff922b, secondaryHex: 0xffe8cc, spokes: 6 },
  laugh: { primaryHex: 0x69db7c, secondaryHex: 0xffe066, spokes: 10 },
  point: { primaryHex: 0x339af0, secondaryHex: 0xa5d8ff, spokes: 4 },
  high_five_ready: { primaryHex: 0xffd43b, secondaryHex: 0xfff3bf, spokes: 8 },
  high_five_strike: { primaryHex: 0xffd43b, secondaryHex: 0xffffff, spokes: 12 },
  downed_kneel: { primaryHex: 0xff2a4b, secondaryHex: 0xffb703, spokes: 8 },
  revive_channel: { primaryHex: 0xffd43b, secondaryHex: 0xe7f5ff, spokes: 10 },
};

interface InviteRingSlot {
  group: THREE.Group;
  discMat: THREE.ShaderMaterial;
  rimMesh: THREE.Mesh;
  motes: THREE.Mesh[];
}

interface DistressBeaconSlot {
  group: THREE.Group;
  ringMat: THREE.ShaderMaterial;
  pillarMat: THREE.ShaderMaterial;
  chevrons: THREE.Mesh[];
}

interface RisingSparkData {
  mesh: THREE.Mesh;
  angle: number;
  radialSpeed: number;
  upwardSpeed: number;
  spinSpeed: number;
}

const MAX_INVITE_RING_SLOTS = 5; // 1 local + up to 4 remote peers
const MAX_DISTRESS_BEACON_SLOTS = 4; // local + up to 3 downed teammates
const SOLO_SPARKLE_COUNT = 12;
const CELEBRATION_SPARK_COUNT = 18;
const REVIVE_BEAM_MOTE_COUNT = 6;

const UP_AXIS = new THREE.Vector3(0, 1, 0);

export class SocialVfxRenderer {
  public readonly root = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  // Shared procedural geometries
  private readonly unitQuadGeo: THREE.PlaneGeometry;
  private readonly sparkleOctaGeo: THREE.OctahedronGeometry;
  private readonly inviteRimGeo: THREE.TorusGeometry;
  private readonly haloRingGeo: THREE.TorusGeometry;
  private readonly fresnelDomeGeo: THREE.SphereGeometry;
  private readonly openPillarGeo: THREE.CylinderGeometry;
  private readonly beamCylinderGeo: THREE.CylinderGeometry;

  // 1. Solo Character Emote Floating Holographic Rings & Sparkles
  public readonly soloEmoteGroup = new THREE.Group();
  private readonly soloGroundMat: THREE.ShaderMaterial;
  private readonly soloOverheadMat: THREE.ShaderMaterial;
  private readonly soloOverheadHalo: THREE.Mesh;
  private readonly soloOverheadCrest: THREE.Mesh;
  private readonly soloSparkleMat: THREE.MeshBasicMaterial;
  private readonly soloSparkles: THREE.Mesh[] = [];

  // 2. Pooled 3.8m Golden Pulsing Camaraderie Invitation Rings
  public readonly inviteRingsRoot = new THREE.Group();
  private readonly inviteSlots: InviteRingSlot[] = [];

  // 3. Monumental Paired High-Five / Blade Clash Celebration
  public readonly pairedClashGroup = new THREE.Group();
  private readonly clashDomeMesh: THREE.Mesh;
  private readonly clashDomeMat: THREE.ShaderMaterial;
  private readonly clashGroundMesh: THREE.Mesh;
  private readonly clashGroundMat: THREE.ShaderMaterial;
  private readonly twinBladesPivot = new THREE.Group();
  private readonly lightBladeLeft: THREE.Group;
  private readonly lightBladeRight: THREE.Group;
  private readonly lightBladeCoreMat: THREE.MeshBasicMaterial;
  private readonly lightBladeAuraMat: THREE.MeshBasicMaterial;
  private readonly clashSparkMat: THREE.MeshBasicMaterial;
  private readonly clashSparks: RisingSparkData[] = [];
  private clashAgeSec = -1;
  private readonly clashDurationSec = 1.45;

  // 4. 60s Sworn Brethren Co-op Buff Golden Oath Aura
  public readonly swornBrethrenGroup = new THREE.Group();
  private readonly swornRingMesh: THREE.Mesh;
  private readonly swornRingMat: THREE.MeshBasicMaterial;
  private readonly swornMotes: THREE.Mesh[] = [];

  // 5. Pooled 3D Crimson-Gold Distress Beacon Rings (Downed Bleedout)
  public readonly distressBeaconsRoot = new THREE.Group();
  private readonly distressSlots: DistressBeaconSlot[] = [];

  // 6. 3D Golden Celestial Revive Beam & Revive Ascension Burst
  public readonly reviveBeamGroup = new THREE.Group();
  private readonly reviveBeamCore: THREE.Mesh;
  private readonly reviveBeamOuter: THREE.Mesh;
  private readonly reviveBeamCoreMat: THREE.MeshBasicMaterial;
  private readonly reviveBeamOuterMat: THREE.ShaderMaterial;
  private readonly reviveTargetRing: THREE.Mesh;
  private readonly reviveTargetRingMat: THREE.ShaderMaterial;
  private readonly reviveBeamMotes: THREE.Mesh[] = [];

  public readonly reviveAscensionGroup = new THREE.Group();
  private readonly ascensionPillarMat: THREE.ShaderMaterial;
  private readonly ascensionPillarMesh: THREE.Mesh;
  private readonly ascensionRingMat: THREE.ShaderMaterial;
  private readonly ascensionRingMesh: THREE.Mesh;
  private ascensionAgeSec = -1;
  private readonly ascensionDurationSec = 1.1;

  private readonly tmpFrom = new THREE.Vector3();
  private readonly tmpTo = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpMid = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  private disposed = false;

  constructor() {
    this.root.name = 'SocialInteractionVfxRoot';

    this.unitQuadGeo = this.trackGeo(new THREE.PlaneGeometry(2, 2));
    this.sparkleOctaGeo = this.trackGeo(new THREE.OctahedronGeometry(0.11, 0));
    this.inviteRimGeo = this.trackGeo(new THREE.TorusGeometry(3.8, 0.042, 8, 64));
    this.haloRingGeo = this.trackGeo(new THREE.TorusGeometry(0.85, 0.026, 8, 40));
    this.fresnelDomeGeo = this.trackGeo(new THREE.SphereGeometry(1.0, 28, 18));
    this.openPillarGeo = this.trackGeo(new THREE.CylinderGeometry(0.75, 1.35, 6.2, 20, 1, true));
    this.beamCylinderGeo = this.trackGeo(new THREE.CylinderGeometry(1.0, 1.0, 1.0, 14, 1, true));

    // ------------------------------------------------------------------------
    // 1. Solo Character Emote Floating Holographic Rings & Sparkles
    // ------------------------------------------------------------------------
    this.soloEmoteGroup.name = 'SoloEmoteHologramGroup';
    this.soloEmoteGroup.visible = false;

    this.soloGroundMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: QUAD_RADIAL_VERT,
        fragmentShader: HOLO_EMOTE_RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uSpokes: { value: 8 },
          uPrimaryColor: { value: new THREE.Color(0x4dabf7) },
          uSecondaryColor: { value: new THREE.Color(0xffec99) },
        },
      }),
    );

    const soloGroundDisc = new THREE.Mesh(this.unitQuadGeo, this.soloGroundMat);
    soloGroundDisc.rotation.x = -Math.PI * 0.5;
    soloGroundDisc.scale.setScalar(1.45);
    soloGroundDisc.position.y = 0.07;
    soloGroundDisc.renderOrder = 13;
    this.soloEmoteGroup.add(soloGroundDisc);

    this.soloOverheadMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: QUAD_RADIAL_VERT,
        fragmentShader: HOLO_EMOTE_RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uSpokes: { value: 8 },
          uPrimaryColor: { value: new THREE.Color(0x4dabf7) },
          uSecondaryColor: { value: new THREE.Color(0xffec99) },
        },
      }),
    );

    this.soloOverheadCrest = new THREE.Mesh(this.unitQuadGeo, this.soloOverheadMat);
    this.soloOverheadCrest.rotation.x = -Math.PI * 0.5;
    this.soloOverheadCrest.scale.setScalar(0.72);
    this.soloOverheadCrest.position.y = 2.25;
    this.soloOverheadCrest.renderOrder = 15;
    this.soloEmoteGroup.add(this.soloOverheadCrest);

    this.soloSparkleMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffec99,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.soloOverheadHalo = new THREE.Mesh(this.haloRingGeo, this.soloSparkleMat);
    this.soloOverheadHalo.rotation.x = Math.PI * 0.5;
    this.soloOverheadHalo.scale.setScalar(0.82);
    this.soloOverheadHalo.position.y = 2.25;
    this.soloEmoteGroup.add(this.soloOverheadHalo);

    for (let i = 0; i < SOLO_SPARKLE_COUNT; i++) {
      const sparkle = new THREE.Mesh(this.sparkleOctaGeo, this.soloSparkleMat);
      sparkle.name = `SoloEmoteSparkle_${i}`;
      this.soloSparkles.push(sparkle);
      this.soloEmoteGroup.add(sparkle);
    }

    this.root.add(this.soloEmoteGroup);

    // ------------------------------------------------------------------------
    // 2. Pooled 3.8m Golden Pulsing Camaraderie Invitation Rings
    // ------------------------------------------------------------------------
    this.inviteRingsRoot.name = 'CamaraderieInviteRingsRoot';
    const inviteRimMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffd43b,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    for (let i = 0; i < MAX_INVITE_RING_SLOTS; i++) {
      const group = new THREE.Group();
      group.name = `CamaraderieInviteRing_${i}`;
      group.visible = false;

      const discMat = this.trackMat(
        new THREE.ShaderMaterial({
          vertexShader: QUAD_RADIAL_VERT,
          fragmentShader: CAMARADERIE_INVITE_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0.92 },
            uGoldPrimary: { value: new THREE.Color(0xffb703) },
            uGoldHot: { value: new THREE.Color(0xfff9db) },
          },
        }),
      );

      // unitQuadGeo spans [-1, +1], so scale = 3.8 gives exact 3.8m world radius!
      const discMesh = new THREE.Mesh(this.unitQuadGeo, discMat);
      discMesh.name = 'CamaraderieDisc38m';
      discMesh.rotation.x = -Math.PI * 0.5;
      discMesh.scale.setScalar(3.8);
      discMesh.position.y = 0.06;
      discMesh.renderOrder = 12;
      group.add(discMesh);

      const rimMesh = new THREE.Mesh(this.inviteRimGeo, inviteRimMat);
      rimMesh.name = 'CamaraderieRimTorus38m';
      rimMesh.rotation.x = Math.PI * 0.5;
      rimMesh.position.y = 0.09;
      group.add(rimMesh);

      const motes: THREE.Mesh[] = [];
      for (let m = 0; m < 6; m++) {
        const mote = new THREE.Mesh(this.sparkleOctaGeo, inviteRimMat);
        mote.scale.set(1.1, 2.0, 1.1);
        motes.push(mote);
        group.add(mote);
      }

      this.inviteRingsRoot.add(group);
      this.inviteSlots.push({ group, discMat, rimMesh, motes });
    }
    this.root.add(this.inviteRingsRoot);

    // ------------------------------------------------------------------------
    // 3. Paired Celebration: Golden Fresnel Shockwave + Twin Crossing Light Blades + Rising Sparks
    // ------------------------------------------------------------------------
    this.pairedClashGroup.name = 'PairedClashCelebrationGroup';
    this.pairedClashGroup.visible = false;

    this.clashDomeMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: FRESNEL_DOME_VERT,
        fragmentShader: FRESNEL_DOME_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0 },
          uTime: { value: 0 },
          uGoldColor: { value: new THREE.Color(0xffb703) },
          uCoreColor: { value: new THREE.Color(0xffffff) },
        },
      }),
    );

    this.clashDomeMesh = new THREE.Mesh(this.fresnelDomeGeo, this.clashDomeMat);
    this.clashDomeMesh.name = 'GoldenFresnelCamaraderieShockwave';
    this.clashDomeMesh.position.y = 0.1;
    this.clashDomeMesh.renderOrder = 18;
    this.pairedClashGroup.add(this.clashDomeMesh);

    this.clashGroundMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: QUAD_RADIAL_VERT,
        fragmentShader: CLASH_RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0 },
          uTime: { value: 0 },
          uGoldColor: { value: new THREE.Color(0xffca2c) },
          uWhiteGold: { value: new THREE.Color(0xfff9db) },
        },
      }),
    );

    this.clashGroundMesh = new THREE.Mesh(this.unitQuadGeo, this.clashGroundMat);
    this.clashGroundMesh.rotation.x = -Math.PI * 0.5;
    this.clashGroundMesh.position.y = 0.08;
    this.clashGroundMesh.renderOrder = 17;
    this.pairedClashGroup.add(this.clashGroundMesh);

    // Twin Crossing Light Blades (sculpted 3D radiant greatswords crossed in X formation)
    this.twinBladesPivot.name = 'TwinCrossingLightBlades';
    this.twinBladesPivot.position.y = 1.65;

    this.lightBladeCoreMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xfff9db,
        transparent: true,
        opacity: 0.96,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.lightBladeAuraMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffb703,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.lightBladeLeft = this.buildRadiantLightBlade('LightBlade_Left');
    this.lightBladeRight = this.buildRadiantLightBlade('LightBlade_Right');
    this.twinBladesPivot.add(this.lightBladeLeft);
    this.twinBladesPivot.add(this.lightBladeRight);
    this.pairedClashGroup.add(this.twinBladesPivot);

    // Rising Golden Sparks
    this.clashSparkMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    for (let i = 0; i < CELEBRATION_SPARK_COUNT; i++) {
      const sparkMesh = new THREE.Mesh(this.sparkleOctaGeo, this.clashSparkMat);
      sparkMesh.name = `ClashRisingSpark_${i}`;
      this.pairedClashGroup.add(sparkMesh);
      this.clashSparks.push({
        mesh: sparkMesh,
        angle: (i / CELEBRATION_SPARK_COUNT) * Math.PI * 2,
        radialSpeed: 1.35 + (i % 4) * 0.65,
        upwardSpeed: 2.9 + (i % 5) * 0.62,
        spinSpeed: 8.0 + (i % 3) * 3.5,
      });
    }

    this.root.add(this.pairedClashGroup);

    // ------------------------------------------------------------------------
    // 4. Sworn Brethren 60s Co-op Buff Golden Oath Aura
    // ------------------------------------------------------------------------
    this.swornBrethrenGroup.name = 'SwornBrethrenAuraGroup';
    this.swornBrethrenGroup.visible = false;

    this.swornRingMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffd43b,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.swornRingMesh = new THREE.Mesh(this.haloRingGeo, this.swornRingMat);
    this.swornRingMesh.rotation.x = Math.PI * 0.5;
    this.swornRingMesh.scale.setScalar(1.35);
    this.swornRingMesh.position.y = 0.09;
    this.swornBrethrenGroup.add(this.swornRingMesh);

    for (let i = 0; i < 3; i++) {
      const mote = new THREE.Mesh(this.sparkleOctaGeo, this.swornRingMat);
      mote.scale.set(0.75, 1.4, 0.75);
      this.swornMotes.push(mote);
      this.swornBrethrenGroup.add(mote);
    }

    this.root.add(this.swornBrethrenGroup);

    // ------------------------------------------------------------------------
    // 5. Pooled 3D Crimson-Gold Distress Beacons (Downed State)
    // ------------------------------------------------------------------------
    this.distressBeaconsRoot.name = 'DownedDistressBeaconsRoot';
    const distressChevronMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xff4d4d,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    for (let i = 0; i < MAX_DISTRESS_BEACON_SLOTS; i++) {
      const group = new THREE.Group();
      group.name = `DownedDistressBeacon_${i}`;
      group.visible = false;

      const ringMat = this.trackMat(
        new THREE.ShaderMaterial({
          vertexShader: QUAD_RADIAL_VERT,
          fragmentShader: DISTRESS_RING_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uTime: { value: 0 },
            uUrgency: { value: 0 },
            uReviveProgress: { value: 0 },
            uCrimsonColor: { value: new THREE.Color(0xff1e42) },
            uGoldColor: { value: new THREE.Color(0xffb703) },
          },
        }),
      );

      // Scaled to 3.5m to clearly show the 3.5m teammate revive channel zone!
      const ringMesh = new THREE.Mesh(this.unitQuadGeo, ringMat);
      ringMesh.rotation.x = -Math.PI * 0.5;
      ringMesh.scale.setScalar(3.5);
      ringMesh.position.y = 0.07;
      ringMesh.renderOrder = 14;
      group.add(ringMesh);

      const pillarMat = this.trackMat(
        new THREE.ShaderMaterial({
          vertexShader: PILLAR_BEAM_VERT,
          fragmentShader: PILLAR_BEAM_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0.55 },
            uColorBottom: { value: new THREE.Color(0xff2a4b) },
            uColorTop: { value: new THREE.Color(0xffb703) },
          },
        }),
      );

      const pillarMesh = new THREE.Mesh(this.openPillarGeo, pillarMat);
      pillarMesh.position.y = 3.1;
      pillarMesh.renderOrder = 14;
      group.add(pillarMesh);

      const chevrons: THREE.Mesh[] = [];
      for (let c = 0; c < 4; c++) {
        const chev = new THREE.Mesh(this.sparkleOctaGeo, distressChevronMat);
        chev.scale.set(1.0, 2.2, 1.0);
        chevrons.push(chev);
        group.add(chev);
      }

      this.distressBeaconsRoot.add(group);
      this.distressSlots.push({ group, ringMat, pillarMat, chevrons });
    }
    this.root.add(this.distressBeaconsRoot);

    // ------------------------------------------------------------------------
    // 6. 3D Golden Celestial Revive Beam & Revive Ascension Pillar
    // ------------------------------------------------------------------------
    this.reviveBeamGroup.name = 'CelestialReviveBeamGroup';
    this.reviveBeamGroup.visible = false;

    this.reviveBeamCoreMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xfff9db,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.reviveBeamOuterMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: PILLAR_BEAM_VERT,
        fragmentShader: PILLAR_BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0.85 },
          uColorBottom: { value: new THREE.Color(0xffd43b) },
          uColorTop: { value: new THREE.Color(0xfff9db) },
        },
      }),
    );

    this.reviveBeamCore = new THREE.Mesh(this.beamCylinderGeo, this.reviveBeamCoreMat);
    this.reviveBeamCore.name = 'CelestialReviveBeamCore';
    this.reviveBeamCore.renderOrder = 18;
    this.reviveBeamGroup.add(this.reviveBeamCore);

    this.reviveBeamOuter = new THREE.Mesh(this.beamCylinderGeo, this.reviveBeamOuterMat);
    this.reviveBeamOuter.name = 'CelestialReviveBeamSheath';
    this.reviveBeamOuter.renderOrder = 17;
    this.reviveBeamGroup.add(this.reviveBeamOuter);

    this.reviveTargetRingMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: QUAD_RADIAL_VERT,
        fragmentShader: HOLO_EMOTE_RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0.95 },
          uSpokes: { value: 12 },
          uPrimaryColor: { value: new THREE.Color(0xffd43b) },
          uSecondaryColor: { value: new THREE.Color(0xffffff) },
        },
      }),
    );

    this.reviveTargetRing = new THREE.Mesh(this.unitQuadGeo, this.reviveTargetRingMat);
    this.reviveTargetRing.rotation.x = -Math.PI * 0.5;
    this.reviveTargetRing.position.y = 0.1;
    this.reviveTargetRing.renderOrder = 18;
    this.reviveBeamGroup.add(this.reviveTargetRing);

    for (let i = 0; i < REVIVE_BEAM_MOTE_COUNT; i++) {
      const mote = new THREE.Mesh(this.sparkleOctaGeo, this.reviveBeamCoreMat);
      mote.scale.set(0.95, 1.55, 0.95);
      this.reviveBeamMotes.push(mote);
      this.reviveBeamGroup.add(mote);
    }

    this.root.add(this.reviveBeamGroup);

    // Revive Completion Ascension Pillar
    this.reviveAscensionGroup.name = 'ReviveAscensionBurstGroup';
    this.reviveAscensionGroup.visible = false;

    this.ascensionPillarMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: PILLAR_BEAM_VERT,
        fragmentShader: PILLAR_BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0.95 },
          uColorBottom: { value: new THREE.Color(0xffd43b) },
          uColorTop: { value: new THREE.Color(0xe7f5ff) },
        },
      }),
    );

    this.ascensionPillarMesh = new THREE.Mesh(this.openPillarGeo, this.ascensionPillarMat);
    this.ascensionPillarMesh.position.y = 3.1;
    this.ascensionPillarMesh.renderOrder = 19;
    this.reviveAscensionGroup.add(this.ascensionPillarMesh);

    this.ascensionRingMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: QUAD_RADIAL_VERT,
        fragmentShader: CLASH_RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0 },
          uTime: { value: 0 },
          uGoldColor: { value: new THREE.Color(0xffd43b) },
          uWhiteGold: { value: new THREE.Color(0xffffff) },
        },
      }),
    );

    this.ascensionRingMesh = new THREE.Mesh(this.unitQuadGeo, this.ascensionRingMat);
    this.ascensionRingMesh.rotation.x = -Math.PI * 0.5;
    this.ascensionRingMesh.position.y = 0.09;
    this.ascensionRingMesh.renderOrder = 18;
    this.reviveAscensionGroup.add(this.ascensionRingMesh);

    this.root.add(this.reviveAscensionGroup);
  }

  private buildRadiantLightBlade(name: string): THREE.Group {
    const sword = new THREE.Group();
    sword.name = name;

    const bladeGeo = this.trackGeo(new THREE.BoxGeometry(0.11, 2.05, 0.035));
    const bladeAuraGeo = this.trackGeo(new THREE.BoxGeometry(0.24, 2.22, 0.07));
    const tipGeo = this.trackGeo(new THREE.ConeGeometry(0.09, 0.36, 4));
    const guardGeo = this.trackGeo(new THREE.BoxGeometry(0.62, 0.09, 0.09));
    const hiltGeo = this.trackGeo(new THREE.CylinderGeometry(0.038, 0.045, 0.42, 8));

    const bladeCore = new THREE.Mesh(bladeGeo, this.lightBladeCoreMat);
    bladeCore.position.y = 0.38;
    sword.add(bladeCore);

    const bladeAura = new THREE.Mesh(bladeAuraGeo, this.lightBladeAuraMat);
    bladeAura.position.y = 0.4;
    sword.add(bladeAura);

    const tip = new THREE.Mesh(tipGeo, this.lightBladeCoreMat);
    tip.position.y = 1.58;
    tip.rotation.y = Math.PI * 0.25;
    sword.add(tip);

    const guard = new THREE.Mesh(guardGeo, this.lightBladeAuraMat);
    guard.position.y = -0.62;
    sword.add(guard);

    const hilt = new THREE.Mesh(hiltGeo, this.lightBladeCoreMat);
    hilt.position.y = -0.88;
    sword.add(hilt);

    return sword;
  }

  public attachToScene(scene: THREE.Scene): void {
    if (this.disposed) return;
    if (this.root.parent !== scene) {
      scene.add(this.root);
    }
  }

  public configureSoloEmote(emoteId: SocialEmoteId, position: Vec3): void {
    if (this.disposed) return;
    const palette = EMOTE_PALETTES[emoteId] ?? EMOTE_PALETTES.wave;

    (this.soloGroundMat.uniforms.uPrimaryColor.value as THREE.Color).setHex(palette.primaryHex);
    (this.soloGroundMat.uniforms.uSecondaryColor.value as THREE.Color).setHex(palette.secondaryHex);
    this.soloGroundMat.uniforms.uSpokes.value = palette.spokes;

    (this.soloOverheadMat.uniforms.uPrimaryColor.value as THREE.Color).setHex(palette.primaryHex);
    (this.soloOverheadMat.uniforms.uSecondaryColor.value as THREE.Color).setHex(
      palette.secondaryHex,
    );
    this.soloOverheadMat.uniforms.uSpokes.value = palette.spokes;

    this.soloSparkleMat.color.setHex(palette.secondaryHex);
    this.soloEmoteGroup.position.set(position.x, position.y, position.z);
    this.soloEmoteGroup.visible = true;
  }

  public spawnPairedCelebration(midpoint: Vec3, localPos: Vec3): void {
    if (this.disposed) return;
    this.clashAgeSec = 0;
    this.pairedClashGroup.position.set(midpoint.x, midpoint.y, midpoint.z);
    this.pairedClashGroup.visible = true;

    const dx = localPos.x - midpoint.x;
    const dz = localPos.z - midpoint.z;
    const yaw = Math.hypot(dx, dz) > 1e-4 ? Math.atan2(dx, dz) : 0;
    this.twinBladesPivot.rotation.y = yaw + Math.PI * 0.5;
    this.twinBladesPivot.position.y = 1.55;
    this.twinBladesPivot.scale.setScalar(1.0);

    this.lightBladeLeft.position.set(-0.22, 0, 0);
    this.lightBladeLeft.rotation.set(0, 0, -0.66);
    this.lightBladeRight.position.set(0.22, 0, 0);
    this.lightBladeRight.rotation.set(0, 0, 0.66);

    this.clashDomeMat.uniforms.uProgress.value = 0;
    this.clashGroundMat.uniforms.uProgress.value = 0;
    this.clashDomeMesh.scale.setScalar(0.65);
    this.clashGroundMesh.scale.setScalar(0.75);
  }

  public spawnReviveAscension(position: Vec3): void {
    if (this.disposed) return;
    this.ascensionAgeSec = 0;
    this.reviveAscensionGroup.position.set(position.x, position.y, position.z);
    this.reviveAscensionGroup.visible = true;
    this.ascensionPillarMat.uniforms.uOpacity.value = 0.95;
    this.ascensionRingMat.uniforms.uProgress.value = 0;
    this.ascensionPillarMesh.scale.set(1, 1, 1);
    this.ascensionRingMesh.scale.setScalar(0.6);
  }

  public updateReviveBeam(
    active: boolean,
    fromPos: Vec3,
    toPos: Vec3,
    progress01: number,
    elapsedSec: number,
  ): void {
    if (this.disposed) return;
    if (!active) {
      this.reviveBeamGroup.visible = false;
      return;
    }

    const t = Number.isFinite(elapsedSec) ? elapsedSec : 0;
    const p = clamp(progress01, 0, 1);

    this.reviveBeamGroup.visible = true;
    this.tmpFrom.set(fromPos.x, fromPos.y + 1.18, fromPos.z);
    this.tmpTo.set(toPos.x, toPos.y + 0.85, toPos.z);

    this.tmpDir.subVectors(this.tmpTo, this.tmpFrom);
    const beamLen = Math.max(0.25, this.tmpDir.length());
    this.tmpDir.normalize();
    this.tmpMid.addVectors(this.tmpFrom, this.tmpTo).multiplyScalar(0.5);
    this.tmpQuat.setFromUnitVectors(UP_AXIS, this.tmpDir);

    const coreRadius = 0.055 + p * 0.065 + Math.sin(t * 18.0) * 0.012;
    const outerRadius = coreRadius * 2.45;

    this.reviveBeamCore.position.copy(this.tmpMid);
    this.reviveBeamCore.quaternion.copy(this.tmpQuat);
    this.reviveBeamCore.scale.set(coreRadius, beamLen, coreRadius);
    this.reviveBeamCoreMat.opacity = 0.65 + p * 0.33;

    this.reviveBeamOuter.position.copy(this.tmpMid);
    this.reviveBeamOuter.quaternion.copy(this.tmpQuat);
    this.reviveBeamOuter.scale.set(outerRadius, beamLen, outerRadius);
    this.reviveBeamOuterMat.uniforms.uTime.value = t;
    this.reviveBeamOuterMat.uniforms.uOpacity.value = 0.55 + p * 0.42;

    this.reviveTargetRing.position.set(toPos.x, toPos.y + 0.1, toPos.z);
    this.reviveTargetRing.scale.setScalar(0.95 + p * 1.15);
    this.reviveTargetRingMat.uniforms.uTime.value = t;
    this.reviveTargetRingMat.uniforms.uOpacity.value = 0.55 + p * 0.45;

    // Stream celestial light motes along the beam from savior to downed ally
    for (let i = 0; i < this.reviveBeamMotes.length; i++) {
      const mote = this.reviveBeamMotes[i];
      const flow = fractPositive(t * (1.4 + p * 0.9) + i / this.reviveBeamMotes.length);
      const helixAngle = flow * Math.PI * 4.0 + t * 6.0 + i;
      const helixR = 0.14 * (1.0 - Math.abs(flow - 0.5) * 1.2);
      const bx = this.tmpFrom.x + (this.tmpTo.x - this.tmpFrom.x) * flow + Math.cos(helixAngle) * helixR;
      const by = this.tmpFrom.y + (this.tmpTo.y - this.tmpFrom.y) * flow + Math.sin(helixAngle) * helixR;
      const bz = this.tmpFrom.z + (this.tmpTo.z - this.tmpFrom.z) * flow;
      mote.position.set(bx, by, bz);
      mote.rotation.y = t * 9.0 + i;
    }
  }

  public update(
    dt: number,
    elapsedSec: number,
    localPos: Vec3,
    activeSoloEmote: SocialEmoteId | null,
    soloRemainingSec: number,
    inviteRings: readonly InviteRingVisualInput[],
    swornBrethrenSec: number,
    distressBeacons: readonly DistressBeaconVisualInput[],
  ): void {
    if (this.disposed) return;
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    const t = Number.isFinite(elapsedSec) ? elapsedSec : 0;

    // 1. Update Solo Character Emote Floating Holographic Rings & Sparkles
    const showSolo = activeSoloEmote !== null && activeSoloEmote !== 'downed_kneel';
    this.soloEmoteGroup.visible = showSolo;
    if (showSolo) {
      this.soloEmoteGroup.position.set(localPos.x, localPos.y, localPos.z);
      const fadeOut = clamp(soloRemainingSec / 0.35, 0, 1);
      this.soloGroundMat.uniforms.uTime.value = t;
      this.soloGroundMat.uniforms.uOpacity.value = 0.88 * fadeOut;

      const hoverY = 2.28 + Math.sin(t * 4.2) * 0.09;
      this.soloOverheadCrest.position.y = hoverY;
      this.soloOverheadHalo.position.y = hoverY;
      this.soloOverheadHalo.rotation.z = t * 2.4;
      this.soloOverheadMat.uniforms.uTime.value = t * 1.2;
      this.soloOverheadMat.uniforms.uOpacity.value = 0.82 * fadeOut;
      this.soloSparkleMat.opacity = 0.86 * fadeOut;

      for (let i = 0; i < this.soloSparkles.length; i++) {
        const sp = this.soloSparkles[i];
        const phase = fractPositive(t * 0.62 + i / this.soloSparkles.length);
        const orbitAngle = (i / this.soloSparkles.length) * Math.PI * 2 + t * 2.6 + phase * 2.0;
        const radius = 0.68 + Math.sin(phase * Math.PI) * 0.48;
        sp.position.set(
          Math.cos(orbitAngle) * radius,
          0.25 + phase * 2.15,
          Math.sin(orbitAngle) * radius,
        );
        sp.rotation.x = t * 5.0 + i;
        sp.rotation.y = t * 7.0 + i;
        const twinkle = (0.55 + 0.45 * Math.sin(t * 12.0 + i * 1.7)) * (1.0 - phase * 0.55);
        sp.scale.setScalar(Math.max(0.25, twinkle * fadeOut));
      }
    }

    // 2. Update 3.8m Golden Pulsing Camaraderie Invitation Rings
    for (let i = 0; i < this.inviteSlots.length; i++) {
      const slot = this.inviteSlots[i];
      const data = inviteRings[i];
      if (!data || data.remainingSec <= 0) {
        slot.group.visible = false;
        continue;
      }

      slot.group.visible = true;
      slot.group.position.set(data.position.x, data.position.y, data.position.z);
      const fade = clamp(data.remainingSec / 0.5, 0, 1);
      slot.discMat.uniforms.uTime.value = t;
      slot.discMat.uniforms.uOpacity.value = 0.92 * fade;
      slot.rimMesh.rotation.z = t * 0.85;

      for (let m = 0; m < slot.motes.length; m++) {
        const mote = slot.motes[m];
        const angle = (m / slot.motes.length) * Math.PI * 2 + t * 1.45;
        mote.position.set(
          Math.cos(angle) * 3.8,
          0.26 + Math.sin(t * 4.8 + m) * 0.12,
          Math.sin(angle) * 3.8,
        );
        mote.rotation.y = -angle;
      }
    }

    // 3. Update Monumental Paired Clash Celebration
    if (this.clashAgeSec >= 0) {
      this.clashAgeSec += safeDt;
      if (this.clashAgeSec >= this.clashDurationSec) {
        this.clashAgeSec = -1;
        this.pairedClashGroup.visible = false;
      } else {
        const p = clamp(this.clashAgeSec / this.clashDurationSec, 0, 1);
        this.clashDomeMat.uniforms.uProgress.value = p;
        this.clashDomeMat.uniforms.uTime.value = t;
        this.clashGroundMat.uniforms.uProgress.value = p;
        this.clashGroundMat.uniforms.uTime.value = t;

        // Fresnel shockwave expands to 6.2m radius
        const domeScale = 0.65 + Math.pow(p, 0.52) * 5.6;
        this.clashDomeMesh.scale.setScalar(domeScale);
        this.clashGroundMesh.scale.setScalar(0.8 + Math.pow(p, 0.55) * 5.8);

        // Twin Crossing Light Blades clash & ascend majestically
        const bladeEnv = 1.0 - smoothstep01(0.55, 1.0, p);
        this.lightBladeCoreMat.opacity = 0.96 * bladeEnv;
        this.lightBladeAuraMat.opacity = 0.75 * bladeEnv;
        this.twinBladesPivot.position.y = 1.55 + p * 0.95;
        this.twinBladesPivot.rotation.y += safeDt * 1.35;
        const popScale = 1.0 + Math.sin(Math.min(1, p * 3.2) * Math.PI) * 0.28;
        this.twinBladesPivot.scale.setScalar(popScale);

        // Rising Golden Sparks fountain
        this.clashSparkMat.opacity = (1.0 - p) * 0.95;
        for (let s = 0; s < this.clashSparks.length; s++) {
          const sp = this.clashSparks[s];
          const swirl = sp.angle + p * 2.6;
          const rad = 0.25 + p * sp.radialSpeed;
          const y = 0.45 + p * sp.upwardSpeed - 0.85 * p * p;
          sp.mesh.position.set(Math.cos(swirl) * rad, Math.max(0.1, y), Math.sin(swirl) * rad);
          sp.mesh.rotation.x += safeDt * sp.spinSpeed;
          sp.mesh.rotation.y += safeDt * (sp.spinSpeed * 1.2);
          sp.mesh.scale.setScalar(Math.max(0.2, (1.0 - p * 0.65) * 1.35));
        }
      }
    }

    // 4. Update Sworn Brethren 60s Co-op Buff Golden Oath Aura
    if (swornBrethrenSec > 0) {
      this.swornBrethrenGroup.visible = true;
      this.swornBrethrenGroup.position.set(localPos.x, localPos.y, localPos.z);
      const fade = clamp(swornBrethrenSec / 1.5, 0, 1);
      this.swornRingMat.opacity = (0.42 + 0.14 * Math.sin(t * 3.5)) * fade;
      this.swornRingMesh.rotation.z = t * 1.4;
      for (let i = 0; i < this.swornMotes.length; i++) {
        const mote = this.swornMotes[i];
        const a = (i / this.swornMotes.length) * Math.PI * 2 + t * 2.1;
        mote.position.set(
          Math.cos(a) * 1.15,
          0.22 + Math.sin(t * 4.0 + i * 2.0) * 0.08,
          Math.sin(a) * 1.15,
        );
        mote.rotation.y = -a;
      }
    } else {
      this.swornBrethrenGroup.visible = false;
    }

    // 5. Update 3D Crimson-Gold Distress Beacon Rings
    for (let i = 0; i < this.distressSlots.length; i++) {
      const slot = this.distressSlots[i];
      const beacon = distressBeacons[i];
      if (!beacon) {
        slot.group.visible = false;
        continue;
      }

      slot.group.visible = true;
      slot.group.position.set(beacon.position.x, beacon.position.y, beacon.position.z);
      slot.ringMat.uniforms.uTime.value = t;
      slot.ringMat.uniforms.uUrgency.value = clamp(beacon.urgency01, 0, 1);
      slot.ringMat.uniforms.uReviveProgress.value = clamp(beacon.reviveProgress01, 0, 1);

      slot.pillarMat.uniforms.uTime.value = t;
      slot.pillarMat.uniforms.uOpacity.value =
        0.48 + 0.22 * Math.sin(t * (5.0 + beacon.urgency01 * 6.0));

      for (let c = 0; c < slot.chevrons.length; c++) {
        const chev = slot.chevrons[c];
        const angle = (c / slot.chevrons.length) * Math.PI * 2 - t * (2.2 + beacon.urgency01 * 2.5);
        const r = 1.45 + Math.sin(t * 7.0) * 0.12;
        chev.position.set(Math.cos(angle) * r, 0.45 + Math.sin(t * 5.0 + c) * 0.1, Math.sin(angle) * r);
        chev.rotation.y = -angle;
      }
    }

    // 6. Update Revive Completion Ascension Pillar
    if (this.ascensionAgeSec >= 0) {
      this.ascensionAgeSec += safeDt;
      if (this.ascensionAgeSec >= this.ascensionDurationSec) {
        this.ascensionAgeSec = -1;
        this.reviveAscensionGroup.visible = false;
      } else {
        const p = clamp(this.ascensionAgeSec / this.ascensionDurationSec, 0, 1);
        this.ascensionPillarMat.uniforms.uTime.value = t;
        this.ascensionPillarMat.uniforms.uOpacity.value = (1.0 - p) * 0.95;
        this.ascensionRingMat.uniforms.uProgress.value = p;
        this.ascensionRingMat.uniforms.uTime.value = t;

        const radiusScale = Math.max(0.18, 1.35 - p * 0.85);
        this.ascensionPillarMesh.scale.set(radiusScale, 1.0 + p * 0.35, radiusScale);
        this.ascensionRingMesh.scale.setScalar(0.75 + Math.pow(p, 0.55) * 4.4);
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.root.parent) {
      this.root.parent.remove(this.root);
    }

    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;

    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].dispose();
    }
    this.materials.length = 0;
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

function fractPositive(x: number): number {
  return x - Math.floor(x);
}

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
