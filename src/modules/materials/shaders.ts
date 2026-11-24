import * as THREE from 'three';
import type { MaterialKey, Vec3 } from '../../contracts/types';

export type MaterialShaderProfile =
  | 'magma_flow'
  | 'arcane_pulse'
  | 'fresnel_rim'
  | 'glacial_rime'
  | 'mythic_plasma';

export interface SharedShaderUniforms {
  uProcTime: THREE.IUniform<number>;
  uProcPlayerPos: THREE.IUniform<THREE.Vector3>;
}

interface MagmaShaderSpec {
  profile: 'magma_flow';
  flowStrength: number;
  crustPreserve: number;
  speed: number;
}

interface ArcaneShaderSpec {
  profile: 'arcane_pulse';
  accentHex: number;
  coreHex: number;
  pulseSpeed: number;
  floorMaskMode: number;
  rimBoost: number;
}

interface FresnelShaderSpec {
  profile: 'fresnel_rim';
  rimHex: number;
  rimPower: number;
  rimStrength: number;
  pulseAmp: number;
  pulseSpeed: number;
}

interface GlacialRimeShaderSpec {
  profile: 'glacial_rime';
  deepCryoHex: number;
  rimeFrostHex: number;
  rimePower: number;
  rimeStrength: number;
  sparkleIntensity: number;
  isFloorSheet: number;
}

interface MythicPlasmaShaderSpec {
  profile: 'mythic_plasma';
  primalHex: number;
  coronaGoldHex: number;
  surgeSpeed: number;
}

type MaterialShaderSpec =
  | MagmaShaderSpec
  | ArcaneShaderSpec
  | FresnelShaderSpec
  | GlacialRimeShaderSpec
  | MythicPlasmaShaderSpec;

const MATERIAL_SHADER_SPECS: Partial<Record<MaterialKey, MaterialShaderSpec>> = {
  // 1. Animated turbulent flowing magma & heat glow
  lava_emissive: {
    profile: 'magma_flow',
    flowStrength: 1.0,
    crustPreserve: 0.0,
    speed: 1.0,
  },
  floor_forge: {
    profile: 'magma_flow',
    flowStrength: 0.78,
    crustPreserve: 1.0,
    speed: 0.65,
  },

  // 2. Traveling arcane pulse waves, sanctum/sanctuary/observatory inlays & breathing rune shimmer
  rune_glow_blue: {
    profile: 'arcane_pulse',
    accentHex: 0x339af0,
    coreHex: 0xa5d8ff,
    pulseSpeed: 2.8,
    floorMaskMode: 0.0,
    rimBoost: 0.36,
  },
  rune_glow_crimson: {
    profile: 'arcane_pulse',
    accentHex: 0xe03131,
    coreHex: 0xffb3b3,
    pulseSpeed: 3.1,
    floorMaskMode: 0.0,
    rimBoost: 0.36,
  },
  rune_glow_emerald: {
    profile: 'arcane_pulse',
    accentHex: 0x2f9e44,
    coreHex: 0xb2f2bb,
    pulseSpeed: 2.5,
    floorMaskMode: 0.0,
    rimBoost: 0.34,
  },
  rune_glow_void: {
    profile: 'arcane_pulse',
    accentHex: 0xae3ec9,
    coreHex: 0xf3d9fa,
    pulseSpeed: 3.0,
    floorMaskMode: 0.0,
    rimBoost: 0.40,
  },
  floor_void: {
    profile: 'arcane_pulse',
    accentHex: 0xb14aed,
    coreHex: 0xe599f7,
    pulseSpeed: 2.2,
    floorMaskMode: 1.0,
    rimBoost: 0.08,
  },
  floor_sanctuary: {
    profile: 'arcane_pulse',
    accentHex: 0xdba84b,
    coreHex: 0xfff3bf,
    pulseSpeed: 1.5,
    floorMaskMode: 1.0,
    rimBoost: 0.06,
  },
  floor_observatory: {
    profile: 'arcane_pulse',
    accentHex: 0x5c7cfa,
    coreHex: 0xffe066,
    pulseSpeed: 2.0,
    floorMaskMode: 1.0,
    rimBoost: 0.10,
  },
  crystal_cyan: {
    profile: 'arcane_pulse',
    accentHex: 0x15aabf,
    coreHex: 0xc5f6fa,
    pulseSpeed: 2.6,
    floorMaskMode: 0.0,
    rimBoost: 0.58,
  },

  // 3. Glacial Mirror-Ice & Translucent Fresnel Rime (Phase 3 Expansion)
  floor_cathedral: {
    profile: 'glacial_rime',
    deepCryoHex: 0x1098ad,
    rimeFrostHex: 0xd0ebff,
    rimePower: 2.8,
    rimeStrength: 0.26,
    sparkleIntensity: 0.42,
    isFloorSheet: 1.0,
  },
  ice_glacier: {
    profile: 'glacial_rime',
    deepCryoHex: 0x22b8cf,
    rimeFrostHex: 0xe6fcff,
    rimePower: 2.0,
    rimeStrength: 0.72,
    sparkleIntensity: 0.55,
    isFloorSheet: 0.0,
  },

  // 4. Mythic Primal Crimson Plasma (Phase 3 Expansion)
  mythic_crimson: {
    profile: 'mythic_plasma',
    primalHex: 0xff1e42,
    coronaGoldHex: 0xffd43b,
    surgeSpeed: 3.6,
  },

  // 5. Dark-fantasy Fresnel Rim-Lighting for 3D characters, armor, clockwork, cloth & arena
  metal_steel: {
    profile: 'fresnel_rim',
    rimHex: 0xa5d8ff,
    rimPower: 3.1,
    rimStrength: 0.28,
    pulseAmp: 0.06,
    pulseSpeed: 1.8,
  },
  metal_gold: {
    profile: 'fresnel_rim',
    rimHex: 0xffe066,
    rimPower: 2.8,
    rimStrength: 0.32,
    pulseAmp: 0.10,
    pulseSpeed: 2.1,
  },
  metal_dark_iron: {
    profile: 'fresnel_rim',
    rimHex: 0x91a7ff,
    rimPower: 3.3,
    rimStrength: 0.24,
    pulseAmp: 0.05,
    pulseSpeed: 1.6,
  },
  brass_clockwork: {
    profile: 'fresnel_rim',
    rimHex: 0xffec99,
    rimPower: 2.7,
    rimStrength: 0.32,
    pulseAmp: 0.12,
    pulseSpeed: 2.4,
  },
  cloth_crimson: {
    profile: 'fresnel_rim',
    rimHex: 0xff6b6b,
    rimPower: 2.4,
    rimStrength: 0.26,
    pulseAmp: 0.08,
    pulseSpeed: 2.0,
  },
  cloth_shadow: {
    profile: 'fresnel_rim',
    rimHex: 0x845ef7,
    rimPower: 2.6,
    rimStrength: 0.25,
    pulseAmp: 0.10,
    pulseSpeed: 2.2,
  },
  cloth_arcane: {
    profile: 'fresnel_rim',
    rimHex: 0xb197fc,
    rimPower: 2.3,
    rimStrength: 0.32,
    pulseAmp: 0.18,
    pulseSpeed: 2.6,
  },
  bone: {
    profile: 'fresnel_rim',
    rimHex: 0xd0ebff,
    rimPower: 2.9,
    rimStrength: 0.24,
    pulseAmp: 0.04,
    pulseSpeed: 1.5,
  },
  flesh_demon: {
    profile: 'fresnel_rim',
    rimHex: 0xff4d29,
    rimPower: 2.5,
    rimStrength: 0.30,
    pulseAmp: 0.22,
    pulseSpeed: 3.4,
  },
  wall_obsidian: {
    profile: 'fresnel_rim',
    rimHex: 0x7950f2,
    rimPower: 3.8,
    rimStrength: 0.15,
    pulseAmp: 0.04,
    pulseSpeed: 1.4,
  },
  floor_colosseum: {
    profile: 'fresnel_rim',
    rimHex: 0xff6b6b,
    rimPower: 3.6,
    rimStrength: 0.12,
    pulseAmp: 0.06,
    pulseSpeed: 1.5,
  },
};

const VERTEX_COMMON_INJECT = /* glsl */ `
#include <common>
varying vec3 vProcWorldPos;
`;

const VERTEX_PROJECT_INJECT = /* glsl */ `
#include <project_vertex>
vec4 procWp = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  procWp = batchingMatrix * procWp;
#endif
#ifdef USE_INSTANCING
  procWp = instanceMatrix * procWp;
#endif
procWp = modelMatrix * procWp;
vProcWorldPos = procWp.xyz;
`;

const GLSL_NOISE_HELPERS = /* glsl */ `
float procHash21( vec2 p ) {
  p = fract( p * vec2( 127.1, 311.7 ) );
  p += dot( p, p + 34.23 );
  return fract( p.x * p.y );
}

float procNoise2D( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = procHash21( i );
  float b = procHash21( i + vec2( 1.0, 0.0 ) );
  float c = procHash21( i + vec2( 0.0, 1.0 ) );
  float d = procHash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

float procFbm2D( vec2 p ) {
  float sum = 0.0;
  float amp = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    sum += amp * procNoise2D( p );
    p = p * 2.03 + vec2( 17.1, 31.7 );
    amp *= 0.5;
  }
  return sum;
}
`;

const MAGMA_FRAG_PARS = /* glsl */ `
#include <common>
uniform float uProcTime;
uniform vec3 uProcPlayerPos;
uniform float uProcFlowStrength;
uniform float uProcCrustPreserve;
uniform float uProcMagmaSpeed;
varying vec3 vProcWorldPos;
${GLSL_NOISE_HELPERS}
`;

const MAGMA_FRAG_BODY = /* glsl */ `
#include <emissivemap_fragment>
{
  float procT = uProcTime * uProcMagmaSpeed;
  vec2 procP = vProcWorldPos.xz * 0.68 + vec2( vProcWorldPos.y * 0.35 );
  vec2 procWarp = vec2(
    procFbm2D( procP * 0.85 + vec2( procT * 0.22, -procT * 0.14 ) ),
    procFbm2D( procP * 0.85 + vec2( -procT * 0.17, procT * 0.21 ) + vec2( 5.2, 1.3 ) )
  );
  float procN1 = procFbm2D( procP * 1.45 + ( procWarp - 0.5 ) * 1.65 + vec2( procT * 0.30, procT * 0.16 ) );
  float procN2 = procNoise2D( procP * 3.10 - vec2( procT * 0.42, procT * 0.28 ) );
  float procRidge = 1.0 - abs( procN1 * 2.0 - 1.0 );
  float procSurge = clamp( pow( procRidge, 1.8 ) * 0.75 + procN2 * 0.35, 0.0, 1.0 );

  float procConvect = 0.78 + 0.26 * sin( procT * 2.6 + procP.x * 1.9 + procN1 * 4.5 );
  float procHeroDist = length( vProcWorldPos.xz - uProcPlayerPos.xz );
  float procHeroHeat = smoothstep( 7.5, 1.2, procHeroDist ) * 0.28;

  vec3 procDeepMagma = vec3( 0.95, 0.18, 0.02 );
  vec3 procBrightMagma = vec3( 1.0, 0.54, 0.07 );
  vec3 procWhiteCore = vec3( 1.0, 0.93, 0.52 );
  vec3 procThermalCol = mix( procDeepMagma, procBrightMagma, smoothstep( 0.20, 0.68, procSurge ) );
  procThermalCol = mix( procThermalCol, procWhiteCore, smoothstep( 0.68, 0.96, procSurge + procHeroHeat * 0.5 ) );

  float procExistingGlow = max( totalEmissiveRadiance.r, max( totalEmissiveRadiance.g, totalEmissiveRadiance.b ) );
  float procCrackMask = mix(
    clamp( 0.35 + procExistingGlow * 0.55 + procSurge * 0.45, 0.0, 1.4 ),
    clamp( procExistingGlow * 1.65 + smoothstep( 0.76, 0.96, procSurge ) * 0.18, 0.0, 1.35 ),
    uProcCrustPreserve
  );

  vec3 procAnimatedMagma = procThermalCol * procCrackMask * ( procConvect + procHeroHeat );
  totalEmissiveRadiance = mix( totalEmissiveRadiance, totalEmissiveRadiance * ( 0.65 + 0.55 * procConvect ) + procAnimatedMagma * 0.85, uProcFlowStrength );
  diffuseColor.rgb += procThermalCol * procCrackMask * procSurge * 0.14 * uProcFlowStrength;
}
`;

const ARCANE_FRAG_PARS = /* glsl */ `
#include <common>
uniform float uProcTime;
uniform vec3 uProcPlayerPos;
uniform vec3 uProcArcaneAccent;
uniform vec3 uProcArcaneCore;
uniform float uProcPulseSpeed;
uniform float uProcFloorMaskMode;
uniform float uProcRimBoost;
varying vec3 vProcWorldPos;
${GLSL_NOISE_HELPERS}
`;

const ARCANE_FRAG_BODY = /* glsl */ `
#include <emissivemap_fragment>
{
  float procPhase = dot( vProcWorldPos, vec3( 0.72, 1.85, 0.64 ) );
  float procBreath = 0.82 + 0.24 * sin( uProcTime * uProcPulseSpeed + procPhase )
                   + 0.10 * sin( uProcTime * ( uProcPulseSpeed * 2.17 ) - procPhase * 1.4 );

  // Traveling astral wave across world space + outward resonance ripple around hero
  float procTravelWave = pow(
    0.5 + 0.5 * sin( dot( vProcWorldPos.xz, vec2( 0.80, 0.60 ) ) * 1.45 + vProcWorldPos.y * 2.6 - uProcTime * ( uProcPulseSpeed * 1.15 ) ),
    4.0
  );
  float procHeroDist = length( vProcWorldPos.xz - uProcPlayerPos.xz );
  float procHeroRipple = smoothstep( 9.5, 1.0, procHeroDist ) * pow(
    0.5 + 0.5 * sin( procHeroDist * 2.35 - uProcTime * 4.4 ),
    3.0
  );
  float procShimmerNoise = procNoise2D( vProcWorldPos.xz * 2.4 + vec2( uProcTime * 0.35, -uProcTime * 0.28 ) );
  float procPulseTotal = procTravelWave * 0.55 + procHeroRipple * 0.65 + smoothstep( 0.62, 0.95, procShimmerNoise ) * 0.25;

  vec3 procViewDir = normalize( vViewPosition );
  float procNdotV = clamp( dot( normalize( normal ), procViewDir ), 0.0, 1.0 );
  float procFresnel = pow( 1.0 - procNdotV, 2.5 );

  float procEmitLum = max( totalEmissiveRadiance.r, max( totalEmissiveRadiance.g, totalEmissiveRadiance.b ) );
  float procMask = mix(
    1.0,
    clamp( procEmitLum * 1.8 + procHeroRipple * 0.32, 0.0, 1.25 ),
    uProcFloorMaskMode
  );

  vec3 procSurgeTint = mix( uProcArcaneAccent, uProcArcaneCore, clamp( procPulseTotal * 0.75 + procFresnel * 0.45, 0.0, 1.0 ) );
  totalEmissiveRadiance = totalEmissiveRadiance * procBreath
                        + procSurgeTint * ( procPulseTotal * 0.58 + procFresnel * uProcRimBoost ) * procMask;
}
`;

const GLACIAL_FRAG_PARS = /* glsl */ `
#include <common>
uniform float uProcTime;
uniform vec3 uProcPlayerPos;
uniform vec3 uProcDeepCryo;
uniform vec3 uProcRimeFrost;
uniform float uProcRimePower;
uniform float uProcRimeStrength;
uniform float uProcSparkleIntensity;
uniform float uProcIsFloorSheet;
varying vec3 vProcWorldPos;
${GLSL_NOISE_HELPERS}
`;

const GLACIAL_FRAG_BODY = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 procV = normalize( vViewPosition );
  vec3 procN = normalize( normal );
  float procNdotV = clamp( dot( procN, procV ), 0.0, 1.0 );
  float procFresnelRime = pow( 1.0 - procNdotV, uProcRimePower );

  // View-dependent diamond ice micro-crystal sparkle + subsurface rime refraction feel
  vec2 procSparkUv = vProcWorldPos.xz * 8.5 + vec2( vProcWorldPos.y * 5.0 ) + procV.xy * 1.85;
  float procCrystalGlint = pow( procNoise2D( procSparkUv + vec2( uProcTime * 0.08, -uProcTime * 0.06 ) ), 6.0 );
  float procSubsurfaceWave = 0.86 + 0.18 * sin( uProcTime * 2.1 + dot( vProcWorldPos, vec3( 1.1, 2.0, 0.9 ) ) );

  float procHeroDist = length( vProcWorldPos.xz - uProcPlayerPos.xz );
  float procFrostStep = smoothstep( 7.0, 0.8, procHeroDist ) * ( 0.5 + 0.5 * sin( procHeroDist * 2.8 - uProcTime * 3.6 ) );

  vec3 procCryoTint = mix( uProcDeepCryo, uProcRimeFrost, clamp( procFresnelRime * 0.8 + procCrystalGlint * 0.6, 0.0, 1.0 ) );
  totalEmissiveRadiance = totalEmissiveRadiance * procSubsurfaceWave
                        + procCryoTint * ( procFresnelRime * uProcRimeStrength + procCrystalGlint * uProcSparkleIntensity + procFrostStep * 0.18 );
  diffuseColor.rgb = mix( diffuseColor.rgb, uProcRimeFrost, clamp( procFresnelRime * 0.32 * ( 1.0 - uProcIsFloorSheet * 0.5 ), 0.0, 0.45 ) );
}
`;

const MYTHIC_FRAG_PARS = /* glsl */ `
#include <common>
uniform float uProcTime;
uniform vec3 uProcPlayerPos;
uniform vec3 uProcPrimalColor;
uniform vec3 uProcCoronaGold;
uniform float uProcSurgeSpeed;
varying vec3 vProcWorldPos;
${GLSL_NOISE_HELPERS}
`;

const MYTHIC_FRAG_BODY = /* glsl */ `
#include <emissivemap_fragment>
{
  float procT = uProcTime * uProcSurgeSpeed;
  vec2 procUv = vProcWorldPos.xz * 1.35 + vec2( vProcWorldPos.y * 1.75 );
  float procSwirlA = procFbm2D( procUv + vec2( procT * 0.28, -procT * 0.22 ) );
  float procSwirlB = procFbm2D( procUv * 1.9 - vec2( procT * 0.34, procT * 0.26 ) + vec2( procSwirlA * 1.4 ) );
  float procArc = pow( 1.0 - abs( procSwirlB * 2.0 - 1.0 ), 2.2 );

  vec3 procV = normalize( vViewPosition );
  float procNdotV = clamp( dot( normalize( normal ), procV ), 0.0, 1.0 );
  float procCorona = pow( 1.0 - procNdotV, 2.1 );
  float procHeartbeat = 0.88 + 0.26 * sin( procT * 1.35 ) + 0.12 * sin( procT * 3.1 + procSwirlA * 5.0 );

  vec3 procPlasmaTint = mix( uProcPrimalColor, uProcCoronaGold, clamp( procArc * 0.72 + procCorona * 0.48, 0.0, 1.0 ) );
  totalEmissiveRadiance = totalEmissiveRadiance * procHeartbeat
                        + procPlasmaTint * ( procArc * 0.95 + procCorona * 0.85 );
}
`;

const FRESNEL_FRAG_PARS = /* glsl */ `
#include <common>
uniform float uProcTime;
uniform vec3 uProcPlayerPos;
uniform vec3 uProcRimColor;
uniform float uProcRimPower;
uniform float uProcRimStrength;
uniform float uProcPulseAmp;
uniform float uProcPulseSpeed;
varying vec3 vProcWorldPos;
`;

const FRESNEL_FRAG_BODY = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 procV = normalize( vViewPosition );
  vec3 procN = normalize( normal );
  float procNdotV = clamp( dot( procN, procV ), 0.0, 1.0 );
  float procRim = pow( 1.0 - procNdotV, uProcRimPower );

  // Top-hemisphere bias so shoulders, blades, helmets, horns & cloaks catch dramatic rim light
  float procHemi = 0.42 + 0.58 * clamp( procN.y * 0.5 + 0.5, 0.0, 1.0 );
  float procLivePulse = 1.0 + uProcPulseAmp * sin( uProcTime * uProcPulseSpeed + vProcWorldPos.y * 2.2 + vProcWorldPos.x * 0.7 );

  // Subtle lantern proximity boost when close to the hero
  float procHeroProx = 1.0 + 0.22 * smoothstep( 6.5, 1.0, length( vProcWorldPos.xz - uProcPlayerPos.xz ) );

  totalEmissiveRadiance += uProcRimColor * ( procRim * uProcRimStrength * procHemi * procLivePulse * procHeroProx );
}
`;

export function createSharedShaderUniforms(): SharedShaderUniforms {
  return {
    uProcTime: { value: 0 },
    uProcPlayerPos: { value: new THREE.Vector3(0, 0, 0) },
  };
}

export function updateSharedShaderUniforms(
  shared: SharedShaderUniforms,
  elapsedSec: number,
  playerPos?: Vec3,
): void {
  if (Number.isFinite(elapsedSec)) {
    shared.uProcTime.value = elapsedSec;
  }
  if (
    playerPos &&
    Number.isFinite(playerPos.x) &&
    Number.isFinite(playerPos.y) &&
    Number.isFinite(playerPos.z)
  ) {
    shared.uProcPlayerPos.value.set(playerPos.x, playerPos.y, playerPos.z);
  }
}

export function getShaderProfileForKey(key: MaterialKey): MaterialShaderProfile | null {
  return MATERIAL_SHADER_SPECS[key]?.profile ?? null;
}

function injectVertexWorldPos(vertexShader: string): string {
  if (vertexShader.includes('vProcWorldPos')) {
    return vertexShader;
  }
  return vertexShader
    .replace('#include <common>', VERTEX_COMMON_INJECT)
    .replace('#include <project_vertex>', VERTEX_PROJECT_INJECT);
}

/**
 * Attaches custom GLSL `onBeforeCompile` shader hooks and ensures `.clone()` on the
 * material preserves the custom shader hook and shared live uniforms automatically.
 * 100% safe in headless/Node environments (no WebGL context required until render).
 */
export function attachMaterialShaderHook(
  material: THREE.MeshStandardMaterial,
  key: MaterialKey,
  shared: SharedShaderUniforms,
  onDirectClone?: (cloned: THREE.MeshStandardMaterial) => void,
): void {
  const spec = MATERIAL_SHADER_SPECS[key];
  if (!spec) {
    return;
  }

  // JSON-safe metadata so THREE.Material.prototype.copy (JSON.stringify(userData)) stays clean
  material.userData.procShader = {
    key,
    profile: spec.profile,
  };

  const cacheKey = `abyssal_proc_${spec.profile}_v1`;
  material.customProgramCacheKey = () => cacheKey;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uProcTime = shared.uProcTime;
    shader.uniforms.uProcPlayerPos = shared.uProcPlayerPos;
    shader.vertexShader = injectVertexWorldPos(shader.vertexShader);

    if (spec.profile === 'magma_flow') {
      shader.uniforms.uProcFlowStrength = { value: spec.flowStrength };
      shader.uniforms.uProcCrustPreserve = { value: spec.crustPreserve };
      shader.uniforms.uProcMagmaSpeed = { value: spec.speed };

      if (!shader.fragmentShader.includes('uProcFlowStrength')) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', MAGMA_FRAG_PARS)
          .replace('#include <emissivemap_fragment>', MAGMA_FRAG_BODY);
      }
    } else if (spec.profile === 'arcane_pulse') {
      shader.uniforms.uProcArcaneAccent = { value: new THREE.Color(spec.accentHex) };
      shader.uniforms.uProcArcaneCore = { value: new THREE.Color(spec.coreHex) };
      shader.uniforms.uProcPulseSpeed = { value: spec.pulseSpeed };
      shader.uniforms.uProcFloorMaskMode = { value: spec.floorMaskMode };
      shader.uniforms.uProcRimBoost = { value: spec.rimBoost };

      if (!shader.fragmentShader.includes('uProcArcaneAccent')) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', ARCANE_FRAG_PARS)
          .replace('#include <emissivemap_fragment>', ARCANE_FRAG_BODY);
      }
    } else if (spec.profile === 'glacial_rime') {
      shader.uniforms.uProcDeepCryo = { value: new THREE.Color(spec.deepCryoHex) };
      shader.uniforms.uProcRimeFrost = { value: new THREE.Color(spec.rimeFrostHex) };
      shader.uniforms.uProcRimePower = { value: spec.rimePower };
      shader.uniforms.uProcRimeStrength = { value: spec.rimeStrength };
      shader.uniforms.uProcSparkleIntensity = { value: spec.sparkleIntensity };
      shader.uniforms.uProcIsFloorSheet = { value: spec.isFloorSheet };

      if (!shader.fragmentShader.includes('uProcDeepCryo')) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', GLACIAL_FRAG_PARS)
          .replace('#include <emissivemap_fragment>', GLACIAL_FRAG_BODY);
      }
    } else if (spec.profile === 'mythic_plasma') {
      shader.uniforms.uProcPrimalColor = { value: new THREE.Color(spec.primalHex) };
      shader.uniforms.uProcCoronaGold = { value: new THREE.Color(spec.coronaGoldHex) };
      shader.uniforms.uProcSurgeSpeed = { value: spec.surgeSpeed };

      if (!shader.fragmentShader.includes('uProcPrimalColor')) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', MYTHIC_FRAG_PARS)
          .replace('#include <emissivemap_fragment>', MYTHIC_FRAG_BODY);
      }
    } else if (spec.profile === 'fresnel_rim') {
      shader.uniforms.uProcRimColor = { value: new THREE.Color(spec.rimHex) };
      shader.uniforms.uProcRimPower = { value: spec.rimPower };
      shader.uniforms.uProcRimStrength = { value: spec.rimStrength };
      shader.uniforms.uProcPulseAmp = { value: spec.pulseAmp };
      shader.uniforms.uProcPulseSpeed = { value: spec.pulseSpeed };

      if (!shader.fragmentShader.includes('uProcRimColor')) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', FRESNEL_FRAG_PARS)
          .replace('#include <emissivemap_fragment>', FRESNEL_FRAG_BODY);
      }
    }
  };

  // Preserve custom shader hook even when downstream systems call material.clone() directly
  const baseProtoClone = THREE.MeshStandardMaterial.prototype.clone;
  material.clone = function cloneWithProcShader(this: THREE.MeshStandardMaterial) {
    const cloned = baseProtoClone.call(this) as THREE.MeshStandardMaterial;
    attachMaterialShaderHook(cloned, key, shared, onDirectClone);
    onDirectClone?.(cloned);
    return cloned;
  };
}
