import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { clamp } from '../../core/Constants';

const DlssCasShader = {
  name: 'AbyssalDlssCasUpscaleShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uSharpness: { value: 0.72 },
    uRenderScale: { value: 0.77 },
    uDlaaActive: { value: 1.0 },
    uUpscaleActive: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexelSize;
    uniform float uSharpness;
    uniform float uRenderScale;
    uniform float uDlaaActive;
    uniform float uUpscaleActive;

    varying vec2 vUv;

    float calcLuma(vec3 rgb) {
      return dot(rgb, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 tx = uTexelSize;

      // 3x3 neighborhood fetch around current UV
      vec3 c  = texture2D(tDiffuse, vUv).rgb;
      vec3 n  = texture2D(tDiffuse, vUv + vec2( 0.0,  tx.y)).rgb;
      vec3 s  = texture2D(tDiffuse, vUv + vec2( 0.0, -tx.y)).rgb;
      vec3 e  = texture2D(tDiffuse, vUv + vec2( tx.x,  0.0)).rgb;
      vec3 w  = texture2D(tDiffuse, vUv + vec2(-tx.x,  0.0)).rgb;
      vec3 nw = texture2D(tDiffuse, vUv + vec2(-tx.x,  tx.y)).rgb;
      vec3 ne = texture2D(tDiffuse, vUv + vec2( tx.x,  tx.y)).rgb;
      vec3 sw = texture2D(tDiffuse, vUv + vec2(-tx.x, -tx.y)).rgb;
      vec3 se = texture2D(tDiffuse, vUv + vec2( tx.x, -tx.y)).rgb;

      float lC  = calcLuma(c);
      float lN  = calcLuma(n);
      float lS  = calcLuma(s);
      float lE  = calcLuma(e);
      float lW  = calcLuma(w);
      float lNW = calcLuma(nw);
      float lNE = calcLuma(ne);
      float lSW = calcLuma(sw);
      float lSE = calcLuma(se);

      float lMin = min(lC, min(min(lN, lS), min(lE, lW)));
      float lMax = max(lC, max(max(lN, lS), max(lE, lW)));
      float lRange = lMax - lMin;

      vec3 baseCol = c;

      // Stage 1: Directional Edge-Preserving Reconstruction & DLAA Subpixel Edge AA
      if ((uDlaaActive > 0.5 || uUpscaleActive > 0.5) && lRange > 0.04) {
        // Sobel gradient -> tangent vector pointing ALONG the local edge contour
        float gradX = (lNE + 2.0 * lE + lSE) - (lNW + 2.0 * lW + lSW);
        float gradY = (lNW + 2.0 * lN + lNE) - (lSW + 2.0 * lS + lSE);
        vec2 tangent = normalize(vec2(-gradY, gradX) + vec2(1e-5, 1e-5));

        float span = mix(0.44, 0.68, uDlaaActive * (1.0 - uUpscaleActive * 0.35));
        vec3 alongA = texture2D(tDiffuse, vUv + tangent * tx * span).rgb;
        vec3 alongB = texture2D(tDiffuse, vUv - tangent * tx * span).rgb;
        vec3 edgeFiltered = 0.5 * (alongA + alongB);

        // Clamp against 3x3 neighborhood AABB to prevent ghosting or halo overshoot
        vec3 boxMin = min(min(min(n, s), min(e, w)), min(c, min(min(nw, ne), min(sw, se))));
        vec3 boxMax = max(max(max(n, s), max(e, w)), max(c, max(max(nw, ne), max(sw, se))));
        edgeFiltered = clamp(edgeFiltered, boxMin, boxMax);

        float edgeWeight = smoothstep(0.04, 0.22, lRange) * mix(0.38, 0.56, uDlaaActive);
        baseCol = mix(baseCol, edgeFiltered, edgeWeight);
      }

      // Stage 2: FidelityFX Contrast-Adaptive Sharpening (CAS)
      if (uSharpness > 0.001) {
        vec3 mnRGB  = min(min(min(n, s), min(e, w)), baseCol);
        vec3 mnRGB2 = min(mnRGB, min(min(nw, ne), min(sw, se)));
        mnRGB += mnRGB2;

        vec3 mxRGB  = max(max(max(n, s), max(e, w)), baseCol);
        vec3 mxRGB2 = max(mxRGB, max(max(nw, ne), max(sw, se)));
        mxRGB += mxRGB2;

        vec3 rcpMxRGB = 1.0 / max(mxRGB, vec3(1e-4));
        vec3 ampRGB = clamp(min(mnRGB, 2.0 - mxRGB) * rcpMxRGB, 0.0, 1.0);
        ampRGB = sqrt(ampRGB);

        // Compensate sharpness slightly when upscaling from lower internal render scales
        float scaleCompensation = mix(1.18, 1.0, clamp(uRenderScale, 0.38, 1.0));
        float effectiveSharpness = clamp(uSharpness * scaleCompensation, 0.0, 1.0);
        float peak = -1.0 / mix(8.0, 5.0, effectiveSharpness);

        vec3 wRGB = ampRGB * peak;
        vec3 rcpWeightRGB = 1.0 / (1.0 + 4.0 * wRGB);
        vec3 window = n + s + e + w;

        baseCol = clamp((baseCol + window * wRGB) * rcpWeightRGB, 0.0, 1.0);
      }

      gl_FragColor = vec4(baseCol, 1.0);
    }
  `,
};

/**
 * Final pass in EffectComposer (`renderToScreen = true`): samples the scaled internal
 * offscreen buffer and renders at full native canvas resolution with DLAA edge-preserving
 * reconstruction and FidelityFX Contrast-Adaptive Sharpening (CAS).
 */
export class DlssCasUpscalePass extends ShaderPass {
  constructor() {
    super(DlssCasShader);
  }

  configure(
    internalWidth: number,
    internalHeight: number,
    renderScale: number,
    sharpness: number,
    dlaaActive: boolean,
  ): void {
    const safeW = Math.max(1, internalWidth);
    const safeH = Math.max(1, internalHeight);
    (this.uniforms.uTexelSize.value as THREE.Vector2).set(1 / safeW, 1 / safeH);
    this.uniforms.uRenderScale.value = clamp(renderScale, 0.25, 1.0);
    this.uniforms.uSharpness.value = clamp(sharpness, 0, 1.0);
    this.uniforms.uDlaaActive.value = dlaaActive ? 1.0 : 0.0;
    this.uniforms.uUpscaleActive.value = renderScale < 0.995 ? 1.0 : 0.0;
  }
}
