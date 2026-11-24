import * as THREE from 'three';
import { clamp } from '../../core/Constants';

export type DissolveTheme = 'molten_orange' | 'void_violet' | 'frost_cyan';

export interface DissolveUniformBundle {
  uEnemyDissolveProgress: { value: number };
  uEnemyDissolveTime: { value: number };
  uEnemyDissolveScale: { value: number };
  uEnemyDissolveHeight: { value: number };
  uEnemyRootWorldPos: { value: THREE.Vector3 };
  uEnemyDissolveEdgeInner: { value: THREE.Color };
  uEnemyDissolveEdgeOuter: { value: THREE.Color };
}

const DISSOLVE_PALETTES: Record<DissolveTheme, { innerHex: number; outerHex: number }> = {
  molten_orange: {
    innerHex: 0xffe066, // incandescent white-gold core lip
    outerHex: 0xff4d00, // scorching molten orange-crimson border
  },
  void_violet: {
    innerHex: 0xf3d9fa, // electric astral lilac core lip
    outerHex: 0xae3ec9, // blazing void-violet plasma border
  },
  frost_cyan: {
    innerHex: 0xe3fafc, // crystalline white-ice core lip
    outerHex: 0x22b8cf, // glacial rime-cyan shatter border
  },
};

const VERTEX_COMMON_INJECT = /* glsl */ `
#include <common>
uniform vec3 uEnemyRootWorldPos;
varying vec3 vEnemyDissolvePos;
`;

const VERTEX_PROJECT_INJECT = /* glsl */ `
#include <project_vertex>
vEnemyDissolvePos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz - uEnemyRootWorldPos;
`;

const FRAGMENT_COMMON_INJECT = /* glsl */ `
#include <common>
uniform float uEnemyDissolveProgress;
uniform float uEnemyDissolveTime;
uniform float uEnemyDissolveScale;
uniform float uEnemyDissolveHeight;
uniform vec3 uEnemyDissolveEdgeInner;
uniform vec3 uEnemyDissolveEdgeOuter;
varying vec3 vEnemyDissolvePos;

float arDissolveHash31(vec3 p) {
  p = fract(p * vec3(443.8975, 397.2973, 491.1871));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}

float arDissolveNoise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = arDissolveHash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = arDissolveHash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = arDissolveHash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = arDissolveHash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = arDissolveHash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = arDissolveHash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = arDissolveHash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = arDissolveHash31(i + vec3(1.0, 1.0, 1.0));
  vec4 nx0 = mix(vec4(n000, n010, n001, n011), vec4(n100, n110, n101, n111), f.x);
  vec2 nxy = mix(nx0.xy, nx0.zw, f.y);
  return mix(nxy.x, nxy.y, f.z);
}

float arDissolveFbm(vec3 p) {
  float v = 0.0;
  float amp = 0.55;
  v += amp * arDissolveNoise3D(p);
  p = p * 2.07 + vec3(13.1, 7.7, 5.3);
  amp *= 0.5;
  v += amp * arDissolveNoise3D(p);
  p = p * 2.03 + vec3(3.7, 17.9, 11.2);
  amp *= 0.5;
  v += amp * arDissolveNoise3D(p);
  return clamp(v / 0.9625, 0.0, 1.0);
}
`;

const FRAGMENT_EMISSIVE_INJECT = /* glsl */ `
#include <emissivemap_fragment>
if ( uEnemyDissolveProgress > 0.0001 ) {
  vec3 arSamplePos = vEnemyDissolvePos * uEnemyDissolveScale + vec3( 0.0, -uEnemyDissolveTime * 0.9, 0.0 );
  float arNoise = arDissolveFbm( arSamplePos );
  float arHeightNorm = clamp( vEnemyDissolvePos.y / max( 0.5, uEnemyDissolveHeight ), 0.0, 1.0 );
  // Blend 3D turbulent FBM with subtle top-down ash sweep so crowns/heads/tips ignite first
  float arField = clamp( arNoise * 0.82 + ( 1.0 - arHeightNorm ) * 0.18, 0.0, 1.0 );
  float arCutoff = uEnemyDissolveProgress * 1.24 - 0.08;
  float arEdgeDelta = arField - arCutoff;
  if ( arEdgeDelta < 0.0 ) {
    discard;
  }
  float arEdgeWidth = 0.15;
  if ( arEdgeDelta < arEdgeWidth ) {
    float arBurnT = 1.0 - clamp( arEdgeDelta / arEdgeWidth, 0.0, 1.0 );
    // Charred obsidian darkening just ahead of the glowing ember front
    diffuseColor.rgb *= mix( 1.0, 0.06, smoothstep( 0.0, 0.65, arBurnT ) );
    vec3 arEmberColor = mix( uEnemyDissolveEdgeOuter, uEnemyDissolveEdgeInner, pow( arBurnT, 2.1 ) );
    float arSparkle = 0.78 + 0.44 * arDissolveNoise3D( vEnemyDissolvePos * ( uEnemyDissolveScale * 4.2 ) + uEnemyDissolveTime * 4.5 );
    totalEmissiveRadiance += arEmberColor * ( pow( arBurnT, 1.3 ) * 5.2 * arSparkle );
  }
}
`;

export function createDissolveUniformBundle(
  theme: DissolveTheme = 'molten_orange',
  worldHeight = 2.0,
): DissolveUniformBundle {
  const palette = DISSOLVE_PALETTES[theme] ?? DISSOLVE_PALETTES.molten_orange;
  const safeH = Number.isFinite(worldHeight) && worldHeight > 0.2 ? worldHeight : 2.0;
  // Tune 3D noise spatial scale inversely with total model height so bosses have bold monumental embers
  const spatialScale = clamp(3.4 / Math.max(0.8, safeH * 0.55), 0.85, 3.8);

  return {
    uEnemyDissolveProgress: { value: 0.0 },
    uEnemyDissolveTime: { value: 0.0 },
    uEnemyDissolveScale: { value: spatialScale },
    uEnemyDissolveHeight: { value: safeH },
    uEnemyRootWorldPos: { value: new THREE.Vector3() },
    uEnemyDissolveEdgeInner: { value: new THREE.Color(palette.innerHex) },
    uEnemyDissolveEdgeOuter: { value: new THREE.Color(palette.outerHex) },
  };
}

export function configureDissolveBundleTheme(
  bundle: DissolveUniformBundle,
  theme: DissolveTheme,
  worldHeight: number,
): void {
  const palette = DISSOLVE_PALETTES[theme] ?? DISSOLVE_PALETTES.molten_orange;
  const safeH = Number.isFinite(worldHeight) && worldHeight > 0.2 ? worldHeight : 2.0;
  bundle.uEnemyDissolveEdgeInner.value.setHex(palette.innerHex);
  bundle.uEnemyDissolveEdgeOuter.value.setHex(palette.outerHex);
  bundle.uEnemyDissolveHeight.value = safeH;
  bundle.uEnemyDissolveScale.value = clamp(3.4 / Math.max(0.8, safeH * 0.55), 0.85, 3.8);
}

/**
 * Attaches the custom GLSL Procedural 3D FBM Noise Edge-Burn Dissolve shader hook
 * onto a `THREE.MeshStandardMaterial`, safely chaining onto any upstream `onBeforeCompile`
 * and `customProgramCacheKey` hooks from `IMaterialLibrary`.
 */
export function attachDissolveShaderHook(
  material: THREE.MeshStandardMaterial,
  uniforms: DissolveUniformBundle,
): void {
  if (!material || material.userData?.__arEnemyDissolveAttached) {
    return;
  }
  material.userData = material.userData || {};
  material.userData.__arEnemyDissolveAttached = true;

  const prevOnBeforeCompile = material.onBeforeCompile;
  const prevCacheKeyFn = material.customProgramCacheKey;

  material.onBeforeCompile = function (
    shader: THREE.WebGLProgramParametersWithUniforms,
    renderer: THREE.WebGLRenderer,
  ): void {
    if (typeof prevOnBeforeCompile === 'function') {
      prevOnBeforeCompile.call(this, shader, renderer);
    }

    shader.uniforms.uEnemyDissolveProgress = uniforms.uEnemyDissolveProgress;
    shader.uniforms.uEnemyDissolveTime = uniforms.uEnemyDissolveTime;
    shader.uniforms.uEnemyDissolveScale = uniforms.uEnemyDissolveScale;
    shader.uniforms.uEnemyDissolveHeight = uniforms.uEnemyDissolveHeight;
    shader.uniforms.uEnemyRootWorldPos = uniforms.uEnemyRootWorldPos;
    shader.uniforms.uEnemyDissolveEdgeInner = uniforms.uEnemyDissolveEdgeInner;
    shader.uniforms.uEnemyDissolveEdgeOuter = uniforms.uEnemyDissolveEdgeOuter;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_COMMON_INJECT)
      .replace('#include <project_vertex>', VERTEX_PROJECT_INJECT);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAGMENT_COMMON_INJECT)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE_INJECT);
  };

  material.customProgramCacheKey = function (): string {
    const baseKey =
      typeof prevCacheKeyFn === 'function' ? prevCacheKeyFn.call(this) : '';
    return `${baseKey}|ar_enemy_dissolve_v1`;
  };

  material.needsUpdate = true;
}
