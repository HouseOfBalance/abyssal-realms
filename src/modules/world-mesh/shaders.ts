import * as THREE from 'three';
import type { BiomeId } from '../../contracts/types';

export interface BiomeMistColors {
  deepHex: number;
  glowHex: number;
  opacity: number;
}

export const BIOME_MIST_PALETTE: Record<BiomeId, BiomeMistColors> = {
  sanctuary: {
    deepHex: 0x1a243b,
    glowHex: 0x9ec5fe,
    opacity: 0.24,
  },
  crypt: {
    deepHex: 0x162033,
    glowHex: 0x5c7fa8,
    opacity: 0.34,
  },
  caverns: {
    deepHex: 0x0d2618,
    glowHex: 0x38d979,
    opacity: 0.36,
  },
  forge: {
    deepHex: 0x2b110b,
    glowHex: 0xff6b2b,
    opacity: 0.30,
  },
  void: {
    deepHex: 0x180b30,
    glowHex: 0xa855f7,
    opacity: 0.36,
  },
  cathedral: {
    deepHex: 0x0c2238,
    glowHex: 0x74e5ff,
    opacity: 0.38,
  },
  observatory: {
    deepHex: 0x131033,
    glowHex: 0xd4a359,
    opacity: 0.30,
  },
  colosseum: {
    deepHex: 0x2b090f,
    glowHex: 0xff3b5c,
    opacity: 0.31,
  },
};

const MIST_VERTEX_SHADER = /* glsl */ `
  attribute float aLayer;
  attribute float aMask;

  uniform float uTime;

  varying vec3 vWorldPos;
  varying float vLayer;
  varying float vMask;

  void main() {
    vec3 displaced = position;
    float wave = sin(position.x * 0.42 + uTime * 0.85 + aLayer * 1.9)
               * cos(position.z * 0.42 - uTime * 0.65 + aLayer * 1.3);
    displaced.y += wave * (0.025 + aLayer * 0.02);

    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPosition.xyz;
    vLayer = aLayer;
    vMask = aMask;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const MIST_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uPlayerPos;
  uniform vec3 uColorDeep;
  uniform vec3 uColorGlow;
  uniform float uOpacity;

  varying vec3 vWorldPos;
  varying float vLayer;
  varying float vMask;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise(p);
      p = rot * p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    if (vMask <= 0.01) discard;

    vec2 toFrag = vWorldPos.xz - uPlayerPos.xz;
    float heroDist = length(toFrag);
    vec2 pushDir = heroDist > 0.001 ? (toFrag / heroDist) : vec2(0.0, 1.0);

    // Radial parting wake around the hero: mist curls outward as the hero walks through!
    float wakePush = exp(-heroDist * 0.55) * 0.85;
    vec2 baseUv = vWorldPos.xz * (0.24 - vLayer * 0.05) + pushDir * wakePush;

    vec2 driftA = vec2(uTime * 0.09, -uTime * 0.065) * (1.0 + vLayer * 0.45);
    vec2 driftB = vec2(-uTime * 0.055, uTime * 0.08);

    float warp = fbm(baseUv + driftB);
    float density = fbm(baseUv * 1.35 + driftA + vec2(warp * 0.85, -warp * 0.65));

    // Sculpt wispy volumetric tendrils
    float wisps = smoothstep(0.30, 0.82, density);
    float layerWeight = mix(1.0, 0.62, vLayer);

    // Soft clear pocket around player boots + subtle swirling wake rim
    float wakeClear = smoothstep(0.65, 3.15, heroDist);
    float wakeRim = exp(-pow((heroDist - 2.35) * 1.15, 2.0)) * 0.32;

    float alpha = wisps * layerWeight * vMask * wakeClear * uOpacity + wakeRim * wisps * vMask * 0.22;
    if (alpha <= 0.004) discard;

    float highlight = smoothstep(0.54, 0.88, density) + wakeRim * 0.55;
    vec3 col = mix(uColorDeep, uColorGlow, clamp(highlight, 0.0, 1.0));

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.78));
  }
`;

export function createGroundMistMaterial(biome: BiomeId, initialPlayerPos?: THREE.Vector3): THREE.ShaderMaterial {
  const cfg = BIOME_MIST_PALETTE[biome] ?? BIOME_MIST_PALETTE.crypt;
  return new THREE.ShaderMaterial({
    name: `GroundMistShader_${biome}`,
    uniforms: {
      uTime: { value: 0 },
      uPlayerPos: { value: initialPlayerPos ? initialPlayerPos.clone() : new THREE.Vector3() },
      uColorDeep: { value: new THREE.Color(cfg.deepHex) },
      uColorGlow: { value: new THREE.Color(cfg.glowHex) },
      uOpacity: { value: cfg.opacity },
    },
    vertexShader: MIST_VERTEX_SHADER,
    fragmentShader: MIST_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const PORTAL_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PORTAL_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uActive;
  uniform vec3 uVoidColor;
  uniform vec3 uArmColor;
  uniform vec3 uCoreColor;

  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.56, 789.12));
    p += dot(p, p + 34.56);
    return fract(p.x * p.y);
  }

  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float nebulaFbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise2D(p);
      p = p * 2.1 + vec2(3.1, 1.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    float angle = atan(p.y, p.x);

    // Relativistic galaxy spiral twist toward central event horizon
    float twist = 3.2 / (r + 0.16);
    float spiralA = sin(angle * 3.0 + twist - uTime * 2.8) * 0.5 + 0.5;
    float spiralB = sin(angle * 5.0 - twist * 0.7 + uTime * 1.9) * 0.5 + 0.5;

    vec2 swirledUv = vec2(
      cos(angle + twist * 0.35 - uTime * 0.8),
      sin(angle + twist * 0.35 - uTime * 0.8)
    ) * (r * 3.2);
    float nebula = nebulaFbm(swirledUv + vec2(uTime * 0.25, -uTime * 0.2));

    float arms = pow(spiralA, 1.6) * 0.75 + pow(spiralB, 2.2) * 0.45;
    arms *= (0.45 + 0.85 * nebula) * smoothstep(0.08, 0.36, r);

    // Blazing photon accretion ring around dark gravitational singularity
    float photonRing = exp(-pow((r - 0.20) * 12.5, 2.0)) * 1.35;
    float singularityMask = smoothstep(0.06, 0.21, r);

    // Starfield glints pulled into the vortex
    float starCell = hash21(floor(swirledUv * 6.5 + uTime * 0.4));
    float stars = smoothstep(0.965, 0.999, starCell) * singularityMask * (1.0 - smoothstep(0.82, 1.0, r));

    // Outer arcane aperture rim glow
    float outerRim = smoothstep(0.72, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r)) * 1.15;

    vec3 col = uVoidColor;
    col = mix(col, uArmColor, clamp(arms, 0.0, 1.0));
    col += uCoreColor * (photonRing + stars * 1.4 + outerRim * 0.55);
    col += uArmColor * outerRim * 0.7;

    // Darken innermost black-hole eye inside photon ring
    col *= mix(0.18, 1.0, singularityMask);
    col *= (0.2 + 0.8 * uActive);

    float edgeFeather = 1.0 - smoothstep(0.92, 1.0, r);
    float alpha = edgeFeather * clamp(0.92 * uActive, 0.0, 0.96);
    if (alpha <= 0.005) discard;

    gl_FragColor = vec4(col, alpha);
  }
`;

export function createPortalVortexMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'BossPortalGalaxyVortexShader',
    uniforms: {
      uTime: { value: 0 },
      uActive: { value: 0 },
      uVoidColor: { value: new THREE.Color(0x070214) },
      uArmColor: { value: new THREE.Color(0xb5179e) },
      uCoreColor: { value: new THREE.Color(0x56cfe1) },
    },
    vertexShader: PORTAL_VERTEX_SHADER,
    fragmentShader: PORTAL_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const SHAFT_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHAFT_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColorBase;
  uniform vec3 uColorCore;

  varying vec2 vUv;

  void main() {
    if (uIntensity <= 0.005) discard;

    // Vertical falloff: blazing inside chest mouth, feathering softly into upper air
    float vFade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.55) * smoothstep(0.0, 0.09, vUv.y);

    // Animated god-ray fluted light ribbons rising upward
    float angleTau = vUv.x * 6.2831853;
    float raysA = sin(angleTau * 5.0 + uTime * 3.2 - vUv.y * 4.0) * 0.5 + 0.5;
    float raysB = sin(angleTau * 9.0 - uTime * 4.6 - vUv.y * 7.0) * 0.5 + 0.5;
    float rayPattern = 0.48 + 0.34 * raysA + 0.28 * pow(raysB, 2.0);

    vec3 col = mix(uColorBase, uColorCore, clamp(pow(1.0 - vUv.y, 2.0) * 0.75 + raysB * 0.3, 0.0, 1.0));
    float alpha = vFade * rayPattern * uIntensity;
    if (alpha <= 0.004) discard;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
  }
`;

export function createChestLightShaftMaterial(isCursed: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: isCursed ? 'CursedChestLightShaftShader' : 'TreasureChestLightShaftShader',
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uColorBase: { value: new THREE.Color(isCursed ? 0xd90429 : 0xff9f1c) },
      uColorCore: { value: new THREE.Color(isCursed ? 0xff758f : 0xfff3b0) },
    },
    vertexShader: SHAFT_VERTEX_SHADER,
    fragmentShader: SHAFT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
