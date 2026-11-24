import * as THREE from 'three';
import { clamp } from '../../core/Constants';
import type { ActiveWeaponRig } from './WeaponBuilder';

const MAX_RIBBON_SLICES = 36;
const SLICE_LIFETIME_SEC = 0.22;
const TELEPORT_RESET_DIST = 3.6;

const RIBBON_VERTEX_SHADER = /* glsl */ `
attribute float aLife;
varying vec2 vUv;
varying float vLife;

void main() {
  vUv = uv;
  vLife = aLife;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RIBBON_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCoreColor;
uniform float uTime;
uniform float uOpacity;

varying vec2 vUv;
varying float vLife;

void main() {
  // vUv.x: 0 at leading blade edge -> 1 at trailing tail
  // vUv.y: 0 at inner hilt base -> 1 at outer weapon tip
  float headToTail = clamp(1.0 - vUv.x, 0.0, 1.0);
  float innerFeather = smoothstep(0.0, 0.26, vUv.y);
  float tipRim = smoothstep(0.58, 0.98, vUv.y);
  float headRim = smoothstep(0.78, 1.0, headToTail);

  // Scrolling arcane plasma streaks dissolving toward tail
  float streakA = 0.5 + 0.5 * sin(vUv.x * 20.0 - uTime * 18.0 + vUv.y * 5.0);
  float streakB = 0.5 + 0.5 * sin(vUv.x * 34.0 - uTime * 26.0 - vUv.y * 8.0);
  float wisp = mix(0.65, 1.15, streakA * 0.65 + streakB * 0.35);

  float alpha = pow(headToTail, 1.45) * vLife * innerFeather * wisp * uOpacity;
  alpha = clamp(alpha + tipRim * headToTail * vLife * 0.38 * uOpacity, 0.0, 1.0);

  if (alpha < 0.008) discard;

  float coreMix = clamp(tipRim * 0.68 + headRim * 0.52, 0.0, 1.0);
  vec3 col = mix(uColor, uCoreColor, coreMix);
  float hdrBoost = 1.35 + coreMix * 1.15;

  gl_FragColor = vec4(col * hdrBoost, alpha);
}
`;

interface WorldRibbonSample {
  baseX: number;
  baseY: number;
  baseZ: number;
  tipX: number;
  tipY: number;
  tipZ: number;
  age: number;
}

class SingleRibbonStrip {
  public readonly mesh: THREE.Mesh;
  public readonly geometry: THREE.BufferGeometry;
  public readonly material: THREE.ShaderMaterial;

  private readonly posArray = new Float32Array(MAX_RIBBON_SLICES * 2 * 3);
  private readonly uvArray = new Float32Array(MAX_RIBBON_SLICES * 2 * 2);
  private readonly lifeArray = new Float32Array(MAX_RIBBON_SLICES * 2);

  private readonly posAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;

  private readonly samples: WorldRibbonSample[] = [];
  private hasPrev = false;
  private prevBase = new THREE.Vector3();
  private prevTip = new THREE.Vector3();

  private readonly tmpBase = new THREE.Vector3();
  private readonly tmpTip = new THREE.Vector3();
  private readonly tmpLocal = new THREE.Vector3();

  constructor(name: string) {
    this.geometry = new THREE.BufferGeometry();

    this.posAttr = new THREE.BufferAttribute(this.posArray, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(this.uvArray, 2);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.lifeArray, 1);
    this.lifeAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('uv', this.uvAttr);
    this.geometry.setAttribute('aLife', this.lifeAttr);

    // Triangle-strip quad topology indexed cleanly for WebGL1/WebGL2
    const indices = new Uint16Array((MAX_RIBBON_SLICES - 1) * 6);
    let ptr = 0;
    for (let i = 0; i < MAX_RIBBON_SLICES - 1; i++) {
      const b0 = i * 2;
      const t0 = i * 2 + 1;
      const b1 = (i + 1) * 2;
      const t1 = (i + 1) * 2 + 1;
      indices[ptr++] = b0;
      indices[ptr++] = t0;
      indices[ptr++] = b1;
      indices[ptr++] = t0;
      indices[ptr++] = t1;
      indices[ptr++] = b1;
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xff922b) },
        uCoreColor: { value: new THREE.Color(0xfff4e0) },
        uTime: { value: 0 },
        uOpacity: { value: 0.92 },
      },
      vertexShader: RIBBON_VERTEX_SHADER,
      fragmentShader: RIBBON_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 14;
    this.mesh.visible = false;
  }

  setColor(colorHex: number): void {
    const col = this.material.uniforms.uColor.value as THREE.Color;
    const core = this.material.uniforms.uCoreColor.value as THREE.Color;
    col.setHex(colorHex);
    core.setHex(0xffffff).lerp(col, 0.25);
  }

  clearHistory(): void {
    this.samples.length = 0;
    this.hasPrev = false;
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  private pushSample(
    bx: number,
    by: number,
    bz: number,
    tx: number,
    ty: number,
    tz: number,
    initialAge: number,
  ): void {
    // Newest samples go at index 0 (head of ribbon)
    this.samples.unshift({
      baseX: bx,
      baseY: by,
      baseZ: bz,
      tipX: tx,
      tipY: ty,
      tipZ: tz,
      age: initialAge,
    });
    if (this.samples.length > MAX_RIBBON_SLICES) {
      this.samples.length = MAX_RIBBON_SLICES;
    }
  }

  update(
    dt: number,
    globalTime: number,
    emitting: boolean,
    baseAnchor: THREE.Object3D | null,
    tipAnchor: THREE.Object3D | null,
    invRootMatrix: THREE.Matrix4,
  ): void {
    this.material.uniforms.uTime.value = globalTime;

    // Age existing samples and prune expired tail slices
    for (let i = this.samples.length - 1; i >= 0; i--) {
      this.samples[i].age += dt;
      if (this.samples[i].age >= SLICE_LIFETIME_SEC) {
        this.samples.splice(i, 1);
      }
    }

    if (emitting && baseAnchor && tipAnchor) {
      baseAnchor.getWorldPosition(this.tmpBase);
      tipAnchor.getWorldPosition(this.tmpTip);

      if (
        Number.isFinite(this.tmpTip.x) &&
        Number.isFinite(this.tmpTip.y) &&
        Number.isFinite(this.tmpTip.z)
      ) {
        if (!this.hasPrev) {
          this.prevBase.copy(this.tmpBase);
          this.prevTip.copy(this.tmpTip);
          this.hasPrev = true;
          this.pushSample(
            this.tmpBase.x,
            this.tmpBase.y,
            this.tmpBase.z,
            this.tmpTip.x,
            this.tmpTip.y,
            this.tmpTip.z,
            0,
          );
        } else {
          const tipDist = this.tmpTip.distanceTo(this.prevTip);
          if (tipDist > TELEPORT_RESET_DIST) {
            // Hero teleported/leaped across room; start fresh arc at destination
            this.samples.length = 0;
            this.prevBase.copy(this.tmpBase);
            this.prevTip.copy(this.tmpTip);
            this.pushSample(
              this.tmpBase.x,
              this.tmpBase.y,
              this.tmpBase.z,
              this.tmpTip.x,
              this.tmpTip.y,
              this.tmpTip.z,
              0,
            );
          } else if (tipDist > 0.008) {
            // Sub-step arc interpolation with blade-length preservation for silky curves
            const bladeLen = Math.max(0.15, this.tmpTip.distanceTo(this.tmpBase));
            const subSteps = clamp(Math.ceil(tipDist / 0.14), 1, 4);
            for (let s = 1; s <= subSteps; s++) {
              const frac = s / subSteps;
              const bx = THREE.MathUtils.lerp(this.prevBase.x, this.tmpBase.x, frac);
              const by = THREE.MathUtils.lerp(this.prevBase.y, this.tmpBase.y, frac);
              const bz = THREE.MathUtils.lerp(this.prevBase.z, this.tmpBase.z, frac);

              let dirX = THREE.MathUtils.lerp(this.prevTip.x, this.tmpTip.x, frac) - bx;
              let dirY = THREE.MathUtils.lerp(this.prevTip.y, this.tmpTip.y, frac) - by;
              let dirZ = THREE.MathUtils.lerp(this.prevTip.z, this.tmpTip.z, frac) - bz;
              const len = Math.hypot(dirX, dirY, dirZ) || 1;
              dirX = (dirX / len) * bladeLen;
              dirY = (dirY / len) * bladeLen;
              dirZ = (dirZ / len) * bladeLen;

              const subAge = (1 - frac) * dt;
              this.pushSample(bx, by, bz, bx + dirX, by + dirY, bz + dirZ, subAge);
            }
            this.prevBase.copy(this.tmpBase);
            this.prevTip.copy(this.tmpTip);
          }
        }
      }
    } else {
      this.hasPrev = false;
    }

    const count = this.samples.length;
    if (count < 2) {
      this.mesh.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }

    // Write world-space ribbon samples into root-local GPU vertex buffer
    for (let i = 0; i < count; i++) {
      const smp = this.samples[i];
      const u = i / (count - 1);
      const life = clamp(1 - smp.age / SLICE_LIFETIME_SEC, 0, 1);

      // Base vertex (2*i)
      this.tmpLocal.set(smp.baseX, smp.baseY, smp.baseZ).applyMatrix4(invRootMatrix);
      const bIdx3 = i * 2 * 3;
      this.posArray[bIdx3] = this.tmpLocal.x;
      this.posArray[bIdx3 + 1] = this.tmpLocal.y;
      this.posArray[bIdx3 + 2] = this.tmpLocal.z;

      const bIdx2 = i * 2 * 2;
      this.uvArray[bIdx2] = u;
      this.uvArray[bIdx2 + 1] = 0;
      this.lifeArray[i * 2] = life;

      // Tip vertex (2*i + 1)
      this.tmpLocal.set(smp.tipX, smp.tipY, smp.tipZ).applyMatrix4(invRootMatrix);
      const tIdx3 = (i * 2 + 1) * 3;
      this.posArray[tIdx3] = this.tmpLocal.x;
      this.posArray[tIdx3 + 1] = this.tmpLocal.y;
      this.posArray[tIdx3 + 2] = this.tmpLocal.z;

      const tIdx2 = (i * 2 + 1) * 2;
      this.uvArray[tIdx2] = u;
      this.uvArray[tIdx2 + 1] = 1;
      this.lifeArray[i * 2 + 1] = life;
    }

    this.posAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (count - 1) * 6);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.samples.length = 0;
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class WeaponTrailController {
  private readonly mainRibbon: SingleRibbonStrip;
  private readonly offRibbon: SingleRibbonStrip;
  private readonly invRootMatrix = new THREE.Matrix4();

  private manualTrailRemaining = 0;
  private defaultColorHex = 0xd0d0d0;
  private activeOverrideColorHex: number | null = null;

  constructor(root: THREE.Group) {
    this.mainRibbon = new SingleRibbonStrip('HeroMainSlashRibbon');
    this.offRibbon = new SingleRibbonStrip('HeroOffSlashRibbon');
    root.add(this.mainRibbon.mesh);
    root.add(this.offRibbon.mesh);
  }

  setDefaultColor(colorHex: number): void {
    this.defaultColorHex = colorHex;
    if (this.activeOverrideColorHex === null) {
      this.mainRibbon.setColor(colorHex);
      this.offRibbon.setColor(colorHex);
    }
  }

  trigger(colorHex?: number, durationSec = 0.38): void {
    const safeDur = Number.isFinite(durationSec) ? clamp(durationSec, 0.05, 3.0) : 0.38;
    this.manualTrailRemaining = Math.max(this.manualTrailRemaining, safeDur);
    if (colorHex !== undefined && Number.isFinite(colorHex)) {
      this.activeOverrideColorHex = colorHex;
      this.mainRibbon.setColor(colorHex);
      this.offRibbon.setColor(colorHex);
    } else if (this.activeOverrideColorHex === null) {
      this.mainRibbon.setColor(this.defaultColorHex);
      this.offRibbon.setColor(this.defaultColorHex);
    }
  }

  clear(): void {
    this.manualTrailRemaining = 0;
    this.activeOverrideColorHex = null;
    this.mainRibbon.clearHistory();
    this.offRibbon.clearHistory();
  }

  getActiveSliceCount(): number {
    const mainIndices = this.mainRibbon.geometry.drawRange.count;
    const offIndices = this.offRibbon.geometry.drawRange.count;
    return (mainIndices > 0 ? mainIndices / 6 + 1 : 0) + (offIndices > 0 ? offIndices / 6 + 1 : 0);
  }

  update(
    dt: number,
    globalTime: number,
    root: THREE.Group,
    weaponRig: ActiveWeaponRig | null,
    autoEmitMain: boolean,
    autoEmitOff: boolean,
  ): void {
    if (this.manualTrailRemaining > 0) {
      this.manualTrailRemaining = Math.max(0, this.manualTrailRemaining - dt);
      if (this.manualTrailRemaining <= 0) {
        this.activeOverrideColorHex = null;
        this.mainRibbon.setColor(this.defaultColorHex);
        this.offRibbon.setColor(this.defaultColorHex);
      }
    }

    root.updateWorldMatrix(true, true);
    this.invRootMatrix.copy(root.matrixWorld).invert();

    const forceEmit = this.manualTrailRemaining > 0;
    const emitMain = (forceEmit || autoEmitMain) && weaponRig !== null;
    const emitOff =
      (forceEmit || autoEmitOff) &&
      weaponRig !== null &&
      weaponRig.weaponType === 'daggers' &&
      weaponRig.offBaseAnchor !== null &&
      weaponRig.offTipAnchor !== null;

    this.mainRibbon.update(
      dt,
      globalTime,
      emitMain,
      weaponRig?.mainBaseAnchor ?? null,
      weaponRig?.mainTipAnchor ?? null,
      this.invRootMatrix,
    );
    this.offRibbon.update(
      dt,
      globalTime,
      emitOff,
      weaponRig?.offBaseAnchor ?? null,
      weaponRig?.offTipAnchor ?? null,
      this.invRootMatrix,
    );
  }

  dispose(): void {
    this.mainRibbon.dispose();
    this.offRibbon.dispose();
  }
}
