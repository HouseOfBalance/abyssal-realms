import * as THREE from 'three';
import type { EliteAffix } from '../../contracts/types';
import { clamp } from '../../core/Constants';
import type { ArticulatedEnemyRig } from './rigTypes';

interface AffixVisualStyle {
  colorHex: number;
  secondaryHex: number;
  shape: 'diamond' | 'magma' | 'ice_spike' | 'prism' | 'blade' | 'obelisk';
}

const AFFIX_STYLES: Record<EliteAffix, AffixVisualStyle> = {
  vampiric: { colorHex: 0xe03131, secondaryHex: 0xff6b6b, shape: 'diamond' },
  molten: { colorHex: 0xff6b35, secondaryHex: 0xffd43b, shape: 'magma' },
  frozen_pulse: { colorHex: 0x4dabf7, secondaryHex: 0x99e9f2, shape: 'ice_spike' },
  teleporter: { colorHex: 0xda77f2, secondaryHex: 0x9775fa, shape: 'prism' },
  berserker: { colorHex: 0xff922b, secondaryHex: 0xff3b3b, shape: 'blade' },
  arcane_enchanted: { colorHex: 0xbe4bdb, secondaryHex: 0xf783ac, shape: 'obelisk' },
};

interface OrbitingShardInstance {
  affix: EliteAffix;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  basePhase: number;
  orbitRadius: number;
  baseHeight: number;
}

/**
 * Manages Elite / Champion monster visuals inside `rig.eliteRoot`:
 * - Concentric glowing ground aura rings + rotating arcane pips
 * - Orbiting 3D elemental shards styled per active `EliteAffix`
 */
export class EliteVisualsController {
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>();
  private outerRing: THREE.Mesh | null = null;
  private innerRing: THREE.Group | null = null;
  private shards: OrbitingShardInstance[] = [];
  private elapsed = 0;
  private activeAffixes: EliteAffix[] = [];

  constructor(
    private readonly rig: ArticulatedEnemyRig,
    isInitiallyElite: boolean,
  ) {
    if (isInitiallyElite) {
      // Default champion golden ground ring until specific affixes are applied
      this.buildDefaultChampionRing();
    }
  }

  setAffixes(affixes: EliteAffix[]): void {
    this.clearVisuals();
    this.activeAffixes = Array.isArray(affixes) ? [...affixes] : [];
    if (this.activeAffixes.length === 0) {
      return;
    }

    const r = Math.max(0.55, this.rig.bodyRadius * this.rig.baseScale * 1.15);
    const primaryStyle = AFFIX_STYLES[this.activeAffixes[0]] ?? AFFIX_STYLES.berserker;
    const secondaryStyle =
      AFFIX_STYLES[this.activeAffixes[1 % this.activeAffixes.length]] ?? primaryStyle;

    // 1. Glowing Outer Ground Aura Ring
    const outerGeom = this.trackGeom(new THREE.RingGeometry(r * 0.86, r * 1.04, 32));
    const outerMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: primaryStyle.colorHex,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const outerMesh = new THREE.Mesh(outerGeom, outerMat);
    outerMesh.rotation.x = -Math.PI * 0.5;
    outerMesh.position.y = 0.03;
    outerMesh.renderOrder = 1;
    this.rig.eliteRoot.add(outerMesh);
    this.outerRing = outerMesh;

    // Soft inner ground glow disc
    const discGeom = this.trackGeom(new THREE.CircleGeometry(r * 0.85, 24));
    const discMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: primaryStyle.colorHex,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const discMesh = new THREE.Mesh(discGeom, discMat);
    discMesh.rotation.x = -Math.PI * 0.5;
    discMesh.position.y = 0.022;
    this.rig.eliteRoot.add(discMesh);

    // 2. Counter-Rotating Inner Rune Ring + Cardinal Rune Pips
    const innerGroup = new THREE.Group();
    innerGroup.position.y = 0.035;
    this.rig.eliteRoot.add(innerGroup);

    const innerGeom = this.trackGeom(new THREE.RingGeometry(r * 0.58, r * 0.66, 24));
    const innerMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: secondaryStyle.colorHex,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const innerMesh = new THREE.Mesh(innerGeom, innerMat);
    innerMesh.rotation.x = -Math.PI * 0.5;
    innerGroup.add(innerMesh);

    const pipGeom = this.trackGeom(new THREE.CircleGeometry(r * 0.09, 4));
    for (let i = 0; i < 6; i++) {
      const style = AFFIX_STYLES[this.activeAffixes[i % this.activeAffixes.length]] ?? primaryStyle;
      const pipMat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: style.secondaryHex,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const pip = new THREE.Mesh(pipGeom, pipMat);
      const ang = (i / 6) * Math.PI * 2;
      pip.rotation.x = -Math.PI * 0.5;
      pip.position.set(Math.cos(ang) * r * 0.76, 0, Math.sin(ang) * r * 0.76);
      innerGroup.add(pip);
    }
    this.innerRing = innerGroup;

    // 3. Orbiting 3D Elemental Shards
    const shardCount = Math.max(3, this.activeAffixes.length * 2);
    const orbitRadius = Math.max(0.62, this.rig.bodyRadius * this.rig.baseScale * 1.05);
    const orbitHeight = Math.max(0.65, this.rig.bodyHeight * this.rig.baseScale * 0.52);

    for (let i = 0; i < shardCount; i++) {
      const affix = this.activeAffixes[i % this.activeAffixes.length];
      const style = AFFIX_STYLES[affix] ?? primaryStyle;
      const pivot = new THREE.Group();
      this.rig.eliteRoot.add(pivot);

      const shardGeom = this.createShardGeometry(style.shape);
      const shardMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: style.secondaryHex,
          emissive: style.colorHex,
          emissiveIntensity: 2.6,
          roughness: 0.18,
          metalness: 0.35,
        }),
      );
      const shardMesh = new THREE.Mesh(shardGeom, shardMat);
      shardMesh.castShadow = false;
      shardMesh.receiveShadow = false;

      // Translucent additive halo shell around each shard
      const haloGeom = this.trackGeom(new THREE.OctahedronGeometry(0.14, 0));
      const haloMat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: style.colorHex,
          transparent: true,
          opacity: 0.36,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const halo = new THREE.Mesh(haloGeom, haloMat);
      shardMesh.add(halo);

      const basePhase = (i / shardCount) * Math.PI * 2;
      shardMesh.position.set(
        Math.cos(basePhase) * orbitRadius,
        orbitHeight,
        Math.sin(basePhase) * orbitRadius,
      );
      pivot.add(shardMesh);

      this.shards.push({
        affix,
        pivot,
        mesh: shardMesh,
        basePhase,
        orbitRadius,
        baseHeight: orbitHeight,
      });
    }
  }

  update(dt: number, deathFadeFactor: number): void {
    if (!this.outerRing && this.shards.length === 0) return;

    this.elapsed += dt;
    const aliveAlpha = clamp(1 - deathFadeFactor * 1.25, 0, 1);
    this.rig.eliteRoot.visible = aliveAlpha > 0.01;
    if (!this.rig.eliteRoot.visible) return;

    const pulse = 1 + Math.sin(this.elapsed * 4.2) * 0.05;
    if (this.outerRing) {
      this.outerRing.rotation.z = this.elapsed * 0.65;
      this.outerRing.scale.setScalar(pulse * aliveAlpha);
    }
    if (this.innerRing) {
      this.innerRing.rotation.y = -this.elapsed * 1.15;
      this.innerRing.scale.setScalar((2 - pulse) * aliveAlpha);
    }

    const hasBerserker = this.activeAffixes.includes('berserker');
    const orbitSpeed = hasBerserker ? 2.8 : 1.85;

    for (const shard of this.shards) {
      const angle = shard.basePhase + this.elapsed * orbitSpeed;
      const radialPulse =
        shard.affix === 'frozen_pulse'
          ? 1 + Math.sin(this.elapsed * 5 + shard.basePhase) * 0.16
          : 1;
      const r = shard.orbitRadius * radialPulse;
      const yBob = Math.sin(this.elapsed * 3.4 + shard.basePhase * 2) * 0.11;

      shard.mesh.position.set(
        Math.cos(angle) * r,
        (shard.baseHeight + yBob) * aliveAlpha,
        Math.sin(angle) * r,
      );
      shard.mesh.rotation.y = this.elapsed * 3.2 + shard.basePhase;
      shard.mesh.rotation.x = Math.sin(this.elapsed * 2.4 + shard.basePhase) * 0.45;

      // Teleporter shards phase-flicker in scale
      if (shard.affix === 'teleporter') {
        const flicker = 0.55 + 0.45 * Math.abs(Math.sin(this.elapsed * 7.5 + shard.basePhase));
        shard.mesh.scale.setScalar(flicker * aliveAlpha);
      } else {
        shard.mesh.scale.setScalar(aliveAlpha);
      }
    }
  }

  private buildDefaultChampionRing(): void {
    const r = Math.max(0.55, this.rig.bodyRadius * this.rig.baseScale * 1.1);
    const geom = this.trackGeom(new THREE.RingGeometry(r * 0.86, r * 1.0, 28));
    const mat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffb020,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const ring = new THREE.Mesh(geom, mat);
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.y = 0.028;
    this.rig.eliteRoot.add(ring);
    this.outerRing = ring;
  }

  private createShardGeometry(shape: AffixVisualStyle['shape']): THREE.BufferGeometry {
    switch (shape) {
      case 'diamond': {
        const g = new THREE.OctahedronGeometry(0.1, 0);
        g.scale(0.8, 1.55, 0.8);
        return this.trackGeom(g);
      }
      case 'magma':
        return this.trackGeom(new THREE.DodecahedronGeometry(0.105, 0));
      case 'ice_spike': {
        const g = new THREE.ConeGeometry(0.075, 0.28, 5);
        return this.trackGeom(g);
      }
      case 'prism': {
        const g = new THREE.BoxGeometry(0.12, 0.2, 0.12);
        return this.trackGeom(g);
      }
      case 'blade': {
        const g = new THREE.ConeGeometry(0.085, 0.26, 4);
        g.scale(0.55, 1.2, 1.0);
        return this.trackGeom(g);
      }
      case 'obelisk': {
        const g = new THREE.CylinderGeometry(0.04, 0.075, 0.26, 4);
        return this.trackGeom(g);
      }
    }
  }

  private trackGeom<T extends THREE.BufferGeometry>(g: T): T {
    this.ownedGeometries.add(g);
    return g;
  }

  private trackMat<T extends THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>(m: T): T {
    this.ownedMaterials.add(m);
    return m;
  }

  clearVisuals(): void {
    while (this.rig.eliteRoot.children.length > 0) {
      this.rig.eliteRoot.remove(this.rig.eliteRoot.children[0]);
    }
    for (const g of this.ownedGeometries) {
      g.dispose();
    }
    this.ownedGeometries.clear();

    for (const m of this.ownedMaterials) {
      m.dispose();
    }
    this.ownedMaterials.clear();

    this.outerRing = null;
    this.innerRing = null;
    this.shards = [];
  }

  dispose(): void {
    this.clearVisuals();
  }
}
