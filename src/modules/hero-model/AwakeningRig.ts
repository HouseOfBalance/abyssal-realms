import * as THREE from 'three';
import { clamp } from '../../core/Constants';
import type { HeroSkeletonNodes } from './SkeletonBuilder';

const WING_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocalPos;

uniform float uTime;
uniform float uSpanIndex;

void main() {
  vUv = uv;
  vec3 pos = position;

  // Subtle ethereal plasma ripple along outer feather pinions (uv.x -> 1 at tip)
  float tipFactor = smoothstep(0.15, 1.0, uv.x);
  pos.z += sin(uv.x * 7.5 - uTime * 6.2 + uSpanIndex * 1.4) * 0.045 * tipFactor;
  pos.y += cos(uv.x * 5.0 - uTime * 4.8 + uv.y * 3.0) * 0.022 * tipFactor;

  vLocalPos = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const WING_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uGoldColor;
uniform vec3 uVioletColor;
uniform float uTime;
uniform float uOpacity;

varying vec2 vUv;
varying vec3 vLocalPos;

void main() {
  // vUv.x: 0 at shoulder joint -> 1 at outer wingtip
  // vUv.y: 0 at trailing lower feather edge -> 1 at upper leading wing spine
  float spanFade = 1.0 - smoothstep(0.62, 1.0, vUv.x);
  float rootFade = smoothstep(0.0, 0.12, vUv.x);
  float leadingSpine = smoothstep(0.68, 0.98, vUv.y);
  float trailingFeather = smoothstep(0.0, 0.35, vUv.y);

  // Flowing Tyrael/Archon celestial energy tendrils streaming outward
  float tendrilA = 0.5 + 0.5 * sin(vUv.y * 26.0 + sin(vUv.x * 6.0 - uTime * 5.5) * 2.2);
  float tendrilB = 0.5 + 0.5 * sin(vUv.x * 16.0 - uTime * 8.5 + vUv.y * 11.0);
  float energyBands = mix(0.45, 1.22, tendrilA * 0.68 + tendrilB * 0.32);

  float alpha = rootFade * spanFade * trailingFeather * energyBands * uOpacity;
  alpha = clamp(alpha + leadingSpine * spanFade * rootFade * 0.55 * uOpacity, 0.0, 1.0);

  if (alpha < 0.01) discard;

  vec3 baseMix = mix(uVioletColor, uGoldColor, clamp(vUv.y * 0.85 + (1.0 - vUv.x) * 0.35, 0.0, 1.0));
  vec3 hotCore = vec3(1.0, 0.97, 0.86);
  vec3 finalCol = mix(baseMix, hotCore, leadingSpine * 0.72 + tendrilA * 0.18);

  gl_FragColor = vec4(finalCol * (1.55 + leadingSpine * 0.95), alpha);
}
`;

const AURA_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AURA_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uGoldColor;
uniform vec3 uVioletColor;
uniform float uTime;
uniform float uOpacity;

varying vec2 vUv;

void main() {
  vec2 centered = (vUv - 0.5) * 2.0;
  float r = length(centered);
  if (r > 1.0) discard;

  float angle = atan(centered.y, centered.x);

  // Outer & inner sacred runic rings + 8-pointed Sovereign Archon star
  float outerRing = smoothstep(0.055, 0.0, abs(r - 0.88));
  float innerRing = smoothstep(0.045, 0.0, abs(r - 0.52));
  float starSpokes = pow(0.5 + 0.5 * cos(angle * 8.0 + uTime * 2.4), 6.0) * smoothstep(0.92, 0.25, r);
  float pulseWave = smoothstep(0.12, 0.0, abs(r - fract(uTime * 0.65))) * (1.0 - r);
  float softFill = (1.0 - r * r) * 0.22;

  float pattern = clamp(outerRing * 0.95 + innerRing * 0.75 + starSpokes * 0.65 + pulseWave * 0.55 + softFill, 0.0, 1.0);
  float alpha = pattern * (1.0 - smoothstep(0.9, 1.0, r)) * uOpacity;

  if (alpha < 0.008) discard;

  vec3 col = mix(uVioletColor, uGoldColor, clamp(outerRing + innerRing + starSpokes * 0.7, 0.0, 1.0));
  gl_FragColor = vec4(col * 1.65, alpha);
}
`;

export interface ArticulatedWingChain {
  side: -1 | 1;
  tier: 'upper' | 'lower';
  shoulderPivot: THREE.Group;
  midJoint: THREE.Group;
  tipPinion: THREE.Group;
}

export class AwakeningRig {
  public readonly wingMount: THREE.Group;
  public readonly crownGroup: THREE.Group;
  public readonly groundAuraGroup: THREE.Group;
  public readonly wings: ArticulatedWingChain[] = [];

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly wingMaterials: THREE.ShaderMaterial[] = [];
  private readonly auraMaterial: THREE.ShaderMaterial;
  private readonly crownGoldMat: THREE.MeshStandardMaterial;
  private readonly crownGemMat: THREE.MeshStandardMaterial;
  private readonly risingVeilMat: THREE.MeshBasicMaterial;
  private readonly crownInnerRing: THREE.Group;

  private active = false;
  private blend = 0; // 0 = hidden, 1 = fully unfurled

  constructor(nodes: HeroSkeletonNodes) {
    this.wingMount = new THREE.Group();
    this.wingMount.name = 'AwakeningWingsMount';
    this.wingMount.position.set(0, 0.36, -0.14);
    this.wingMount.visible = false;
    nodes.torso.add(this.wingMount);

    this.crownGroup = new THREE.Group();
    this.crownGroup.name = 'SovereignCrownHalo';
    this.crownGroup.position.set(0, 0.44, -0.02);
    this.crownGroup.visible = false;
    nodes.head.add(this.crownGroup);

    this.groundAuraGroup = new THREE.Group();
    this.groundAuraGroup.name = 'AwakeningAstralAura';
    this.groundAuraGroup.position.set(0, 0.022, 0);
    this.groundAuraGroup.visible = false;
    nodes.root.add(this.groundAuraGroup);

    this.crownGoldMat = new THREE.MeshStandardMaterial({
      color: 0xffe07d,
      emissive: 0xffaa22,
      emissiveIntensity: 2.2,
      metalness: 0.9,
      roughness: 0.15,
      transparent: true,
      opacity: 0,
    });

    this.crownGemMat = new THREE.MeshStandardMaterial({
      color: 0xe599f7,
      emissive: 0xbe4bdb,
      emissiveIntensity: 2.8,
      metalness: 0.2,
      roughness: 0.1,
      transparent: true,
      opacity: 0,
    });

    this.auraMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uGoldColor: { value: new THREE.Color(0xffd43b) },
        uVioletColor: { value: new THREE.Color(0x9c36b5) },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: AURA_VERTEX_SHADER,
      fragmentShader: AURA_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.risingVeilMat = new THREE.MeshBasicMaterial({
      color: 0xffc94d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.buildFourArticulatedWings();
    this.crownInnerRing = this.buildSovereignCrownHalo();
    this.buildAstralGroundAura();
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private createWingPinionGeometry(length: number, height: number): THREE.BufferGeometry {
    // Subdivided plane extending along +X from 0 to `length` so GLSL wave & UV span work seamlessly
    const geo = new THREE.PlaneGeometry(length, height, 10, 4);
    geo.translate(length * 0.5, 0, 0);
    return this.trackGeo(geo);
  }

  private buildFourArticulatedWings(): void {
    const configs: Array<{ side: -1 | 1; tier: 'upper' | 'lower'; spanIdx: number }> = [
      { side: -1, tier: 'upper', spanIdx: 0 },
      { side: 1, tier: 'upper', spanIdx: 1 },
      { side: -1, tier: 'lower', spanIdx: 2 },
      { side: 1, tier: 'lower', spanIdx: 3 },
    ];

    const innerUpperGeo = this.createWingPinionGeometry(0.68, 0.36);
    const midUpperGeo = this.createWingPinionGeometry(0.74, 0.44);
    const tipUpperGeo = this.createWingPinionGeometry(0.66, 0.32);

    const innerLowerGeo = this.createWingPinionGeometry(0.5, 0.26);
    const midLowerGeo = this.createWingPinionGeometry(0.56, 0.3);
    const tipLowerGeo = this.createWingPinionGeometry(0.48, 0.22);

    const socketOrbGeo = this.trackGeo(new THREE.OctahedronGeometry(0.042, 0));

    for (const { side, tier, spanIdx } of configs) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uGoldColor: { value: new THREE.Color(0xffd452) },
          uVioletColor: { value: new THREE.Color(0xae3ec9) },
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uSpanIndex: { value: spanIdx },
        },
        vertexShader: WING_VERTEX_SHADER,
        fragmentShader: WING_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.wingMaterials.push(mat);

      const shoulderPivot = new THREE.Group();
      shoulderPivot.name = `AwakeningWing_${tier}_${side < 0 ? 'R' : 'L'}`;
      shoulderPivot.position.set(
        side * (tier === 'upper' ? 0.11 : 0.08),
        tier === 'upper' ? 0.06 : -0.1,
        0,
      );
      // Mirror right-side (-X) wings by rotating 180° around Y or scaling X = side?
      // Wait: scaling X = -1 flips normals, whereas DoubleSide + `scale.x = side` mirrors +X wing span cleanly to -X and +X!
      shoulderPivot.scale.set(side, 1, 1);
      this.wingMount.add(shoulderPivot);

      // Shoulder anchor crystal
      const anchorOrb = new THREE.Mesh(socketOrbGeo, this.crownGoldMat);
      shoulderPivot.add(anchorOrb);

      const innerLen = tier === 'upper' ? 0.68 : 0.5;
      const midLen = tier === 'upper' ? 0.74 : 0.56;

      const innerMesh = new THREE.Mesh(
        tier === 'upper' ? innerUpperGeo : innerLowerGeo,
        mat,
      );
      innerMesh.frustumCulled = false;
      innerMesh.renderOrder = 13;
      shoulderPivot.add(innerMesh);

      // Mid-wing articulated joint
      const midJoint = new THREE.Group();
      midJoint.position.set(innerLen * 0.9, 0.04, 0);
      shoulderPivot.add(midJoint);

      const midMesh = new THREE.Mesh(
        tier === 'upper' ? midUpperGeo : midLowerGeo,
        mat,
      );
      midMesh.frustumCulled = false;
      midMesh.renderOrder = 13;
      midJoint.add(midMesh);

      // Outer pinion articulated joint + splayed feather streamers
      const tipPinion = new THREE.Group();
      tipPinion.position.set(midLen * 0.88, 0.02, 0);
      midJoint.add(tipPinion);

      for (let f = 0; f < (tier === 'upper' ? 3 : 2); f++) {
        const featherMesh = new THREE.Mesh(
          tier === 'upper' ? tipUpperGeo : tipLowerGeo,
          mat,
        );
        featherMesh.rotation.z = (f - 1) * -0.22;
        featherMesh.position.y = (1 - f) * 0.06;
        featherMesh.frustumCulled = false;
        featherMesh.renderOrder = 13;
        tipPinion.add(featherMesh);
      }

      this.wings.push({
        side,
        tier,
        shoulderPivot,
        midJoint,
        tipPinion,
      });
    }
  }

  private buildSovereignCrownHalo(): THREE.Group {
    const outerRingGeo = this.trackGeo(new THREE.TorusGeometry(0.28, 0.012, 8, 32));
    const outerRing = new THREE.Mesh(outerRingGeo, this.crownGoldMat);
    outerRing.rotation.x = Math.PI * 0.36;
    this.crownGroup.add(outerRing);

    // 5 levitating Sovereign Crown Spires
    const spireGeo = this.trackGeo(new THREE.OctahedronGeometry(0.036, 0));
    for (let i = 0; i < 5; i++) {
      const frac = (i - 2) * 0.52;
      const heightBoost = i === 2 ? 1.85 : i === 1 || i === 3 ? 1.4 : 1.05;
      const spire = new THREE.Mesh(
        spireGeo,
        i === 2 ? this.crownGemMat : this.crownGoldMat,
      );
      spire.position.set(
        Math.sin(frac) * 0.27,
        0.09 + Math.cos(frac) * 0.07,
        Math.cos(frac) * 0.08,
      );
      spire.rotation.z = -frac * 0.65;
      spire.scale.set(0.65, heightBoost, 0.55);
      this.crownGroup.add(spire);
    }

    const innerSpinGroup = new THREE.Group();
    this.crownGroup.add(innerSpinGroup);

    const innerRingGeo = this.trackGeo(new THREE.TorusGeometry(0.19, 0.008, 6, 24));
    const innerRing = new THREE.Mesh(innerRingGeo, this.crownGemMat);
    innerRing.rotation.x = Math.PI * 0.5;
    innerSpinGroup.add(innerRing);

    return innerSpinGroup;
  }

  private buildAstralGroundAura(): void {
    const discGeo = this.trackGeo(new THREE.PlaneGeometry(2.5, 2.5));
    discGeo.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, this.auraMaterial);
    disc.renderOrder = 11;
    disc.frustumCulled = false;
    this.groundAuraGroup.add(disc);

    // Subtle open-ended rising astral light cylinder around feet
    const veilGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.95, 0.78, 0.65, 20, 1, true),
    );
    const veil = new THREE.Mesh(veilGeo, this.risingVeilMat);
    veil.position.y = 0.32;
    veil.renderOrder = 12;
    veil.frustumCulled = false;
    this.groundAuraGroup.add(veil);
  }

  isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = Boolean(active);
    if (this.active) {
      this.wingMount.visible = true;
      this.crownGroup.visible = true;
      this.groundAuraGroup.visible = true;
      // Ensure immediate non-zero visibility when queried synchronously after setAwakenedVisual(true)
      if (this.blend < 0.15) {
        this.blend = 0.15;
        this.applyVisualState(0, 0, false);
      }
    }
  }

  update(
    dt: number,
    globalTime: number,
    moveNorm: number,
    flareAction: boolean,
    deathDimFactor: number,
  ): void {
    const target = this.active ? 1 : 0;
    if (this.blend !== target) {
      const rate = this.active ? 4.2 : 3.4;
      if (this.blend < target) {
        this.blend = Math.min(1, this.blend + dt * rate);
      } else {
        this.blend = Math.max(0, this.blend - dt * rate);
      }
    }

    if (this.blend <= 0.001 && !this.active) {
      this.wingMount.visible = false;
      this.crownGroup.visible = false;
      this.groundAuraGroup.visible = false;
      return;
    }

    this.wingMount.visible = true;
    this.crownGroup.visible = true;
    this.groundAuraGroup.visible = true;

    this.applyVisualState(globalTime, moveNorm, flareAction, deathDimFactor);
  }

  private applyVisualState(
    t: number,
    moveNorm: number,
    flareAction: boolean,
    deathDimFactor = 1,
  ): void {
    const env = clamp(this.blend, 0, 1) * deathDimFactor;
    // Slight spring overshoot when unfurling wings
    const unfurlScale =
      this.active && this.blend < 1
        ? 0.35 + 0.65 * (1 - Math.pow(1 - this.blend, 3)) + Math.sin(this.blend * Math.PI) * 0.12
        : env;

    this.wingMount.scale.setScalar(Math.max(0.05, unfurlScale));
    this.crownGroup.scale.setScalar(Math.max(0.05, unfurlScale));
    this.groundAuraGroup.scale.setScalar(0.65 + 0.35 * unfurlScale);

    // Update shader uniforms & material opacities
    for (const mat of this.wingMaterials) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uOpacity.value = 0.92 * env;
    }
    this.auraMaterial.uniforms.uTime.value = t;
    this.auraMaterial.uniforms.uOpacity.value = 0.88 * env;

    this.crownGoldMat.opacity = 0.96 * env;
    this.crownGemMat.opacity = 0.96 * env;
    this.risingVeilMat.opacity = (0.11 + Math.sin(t * 4.2) * 0.035) * env;

    // Articulated 4-wing rhythmic Archon beat & action flare
    const flapSpeed = flareAction ? 7.5 : 2.8 + moveNorm * 2.2;
    const flapWave = Math.sin(t * flapSpeed);
    const secondaryWave = Math.sin(t * flapSpeed - 0.85);
    const thirdWave = Math.sin(t * flapSpeed - 1.6);

    const sweepBackBase = flareAction ? 0.18 : 0.34 + moveNorm * 0.28;

    for (const w of this.wings) {
      // Note: shoulderPivot has scale.x = side (-1 or +1), so identical local Y/Z rotations mirror symmetrically!
      if (w.tier === 'upper') {
        const elev = (flareAction ? 0.62 : 0.44) + flapWave * 0.14;
        const sweep = -sweepBackBase + flapWave * 0.24;
        w.shoulderPivot.rotation.set(0.14, sweep, elev);
        w.midJoint.rotation.set(0, secondaryWave * 0.22 - 0.08, secondaryWave * 0.12 - 0.06);
        w.tipPinion.rotation.set(0, thirdWave * 0.24 - 0.1, thirdWave * 0.14 - 0.12);
      } else {
        const elev = (flareAction ? -0.14 : -0.26) + secondaryWave * 0.12;
        const sweep = -(sweepBackBase + 0.12) + secondaryWave * 0.2;
        w.shoulderPivot.rotation.set(-0.08, sweep, elev);
        w.midJoint.rotation.set(0, thirdWave * 0.18 - 0.08, thirdWave * 0.1 - 0.08);
        w.tipPinion.rotation.set(0, thirdWave * 0.2 - 0.1, -0.1);
      }
    }

    // Levitating Sovereign Crown Halo
    this.crownGroup.position.y = 0.44 + Math.sin(t * 3.1) * 0.028;
    this.crownGroup.rotation.y = Math.sin(t * 1.5) * 0.22;
    this.crownInnerRing.rotation.z = t * 2.4;

    // Ground astral aura slow counter-rotation
    this.groundAuraGroup.rotation.y = -t * 0.55;
  }

  dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.geometries.length = 0;

    for (const mat of this.wingMaterials) {
      mat.dispose();
    }
    this.wingMaterials.length = 0;

    this.auraMaterial.dispose();
    this.crownGoldMat.dispose();
    this.crownGemMat.dispose();
    this.risingVeilMat.dispose();
  }
}
