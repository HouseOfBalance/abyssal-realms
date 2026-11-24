import * as THREE from 'three';
import type { PetId } from '../../contracts/types';
import { clamp } from '../../core/Constants';
import { PET_DEFINITIONS } from './companionData';
import type { CompanionResourcePool } from './CompanionResourcePool';

export type PetMotionMode = 'idle' | 'orbit' | 'dash' | 'return';

export interface PetRigHandle {
  readonly id: PetId;
  readonly root: THREE.Group;
  updateAnimation(
    dt: number,
    elapsedSec: number,
    speedNormalized: number,
    mode: PetMotionMode,
    scoopPulse01: number,
  ): void;
}

interface EmberPuffSlot {
  mesh: THREE.Mesh;
  age: number;
  maxAge: number;
  vx: number;
  vy: number;
  vz: number;
}

export class PetRigBuilder {
  constructor(private readonly resources: CompanionResourcePool) {}

  public buildPetRig(petId: PetId): PetRigHandle {
    switch (petId) {
      case 'celestial_owl':
        return this.buildCelestialOwl();
      case 'ember_wyrmling':
        return this.buildEmberWyrmling();
      case 'void_kitsune':
        return this.buildVoidKitsune();
    }
  }

  private addCastShadow(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = false;
      }
    });
  }

  // ============================================================================
  // 1. CELESTIAL OWL — Flapping Astral Wings, Astrolabe Halo & Starlight Motes
  // ============================================================================
  private buildCelestialOwl(): PetRigHandle {
    const root = new THREE.Group();
    root.name = 'Pet_CelestialOwl';

    const plumageMat = this.resources.cloneLibraryMaterial('cloth_arcane', {
      colorHex: 0x1e3a6e,
      emissiveHex: 0x18427a,
      emissiveIntensity: 0.35,
      roughness: 0.52,
    });
    const silverPlumeMat = this.resources.cloneLibraryMaterial('ice_glacier', {
      colorHex: 0xd8ecff,
      emissiveHex: 0x4dabf7,
      emissiveIntensity: 0.42,
      roughness: 0.35,
    });
    const goldMat = this.resources.cloneLibraryMaterial('metal_gold', {
      colorHex: 0xffd43b,
      emissiveHex: 0xb07d12,
      emissiveIntensity: 0.28,
      metalness: 0.85,
      roughness: 0.24,
    });
    const astralFeatherGlow = this.resources.createAdditiveGlowMaterial(0x66d9e8, 0.72, true);
    const eyeGlowMat = this.resources.createAdditiveGlowMaterial(0xffe066, 0.95, false);

    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);

    // Sculpted owl torso + silver breast crest
    const torsoGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.22, 14, 12));
    torsoGeo.scale(0.92, 1.24, 0.98);
    const torsoMesh = new THREE.Mesh(torsoGeo, plumageMat);
    bodyPivot.add(torsoMesh);

    const breastGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.17, 12, 10));
    breastGeo.scale(0.85, 1.05, 0.65);
    const breastMesh = new THREE.Mesh(breastGeo, silverPlumeMat);
    breastMesh.position.set(0, -0.02, 0.11);
    bodyPivot.add(breastMesh);

    const chestCrestGeo = this.resources.trackGeometry(new THREE.OctahedronGeometry(0.065, 0));
    const chestCrest = new THREE.Mesh(chestCrestGeo, goldMat);
    chestCrest.position.set(0, 0.05, 0.21);
    bodyPivot.add(chestCrest);

    // Head + luminous eyes + golden beak + swept astral brow tufts
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.24, 0.05);
    bodyPivot.add(headPivot);

    const headGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.165, 14, 12));
    headGeo.scale(1.06, 0.95, 0.98);
    headPivot.add(new THREE.Mesh(headGeo, plumageMat));

    const facialDiscGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.135, 12, 10));
    facialDiscGeo.scale(1.02, 0.86, 0.45);
    const facialDisc = new THREE.Mesh(facialDiscGeo, silverPlumeMat);
    facialDisc.position.set(0, 0.0, 0.11);
    headPivot.add(facialDisc);

    const eyeGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.042, 10, 8));
    const eyeL = new THREE.Mesh(eyeGeo, eyeGlowMat);
    eyeL.position.set(0.068, 0.02, 0.145);
    const eyeR = new THREE.Mesh(eyeGeo, eyeGlowMat);
    eyeR.position.set(-0.068, 0.02, 0.145);
    headPivot.add(eyeL, eyeR);

    const beakGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.036, 0.1, 6));
    beakGeo.rotateX(Math.PI * 0.62);
    const beak = new THREE.Mesh(beakGeo, goldMat);
    beak.position.set(0, -0.025, 0.185);
    headPivot.add(beak);

    const tuftGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.035, 0.18, 5));
    const tuftL = new THREE.Mesh(tuftGeo, goldMat);
    tuftL.position.set(0.11, 0.14, 0.02);
    tuftL.rotation.set(-0.35, 0, -0.48);
    const tuftR = new THREE.Mesh(tuftGeo, goldMat);
    tuftR.position.set(-0.11, 0.14, 0.02);
    tuftR.rotation.set(-0.35, 0, 0.48);
    headPivot.add(tuftL, tuftR);

    // Levitating Astrolabe Halo above head
    const haloGroup = new THREE.Group();
    haloGroup.position.set(0, 0.25, -0.02);
    headPivot.add(haloGroup);

    const haloOuterGeo = this.resources.trackGeometry(new THREE.TorusGeometry(0.16, 0.014, 8, 24));
    haloOuterGeo.rotateX(Math.PI / 2);
    const haloOuter = new THREE.Mesh(haloOuterGeo, goldMat);
    const haloInnerGeo = this.resources.trackGeometry(new THREE.TorusGeometry(0.105, 0.01, 6, 18));
    haloInnerGeo.rotateX(Math.PI / 2);
    const haloInner = new THREE.Mesh(haloInnerGeo, astralFeatherGlow);
    haloGroup.add(haloOuter, haloInner);

    // Articulated Two-Stage Astral Wings (Left & Right)
    const innerWingGeo = this.resources.trackGeometry(new THREE.BoxGeometry(0.28, 0.032, 0.2));
    const outerFeatherGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.048, 0.34, 4));
    outerFeatherGeo.scale(1.0, 1.0, 0.32);

    const buildWing = (side: 1 | -1): { inner: THREE.Group; outer: THREE.Group } => {
      const inner = new THREE.Group();
      inner.position.set(side * 0.16, 0.08, 0.0);
      bodyPivot.add(inner);

      const covert = new THREE.Mesh(innerWingGeo, plumageMat);
      covert.position.set(side * 0.13, 0, -0.02);
      inner.add(covert);

      const trim = new THREE.Mesh(
        this.resources.trackGeometry(new THREE.BoxGeometry(0.26, 0.018, 0.06)),
        goldMat,
      );
      trim.position.set(side * 0.13, 0.018, 0.06);
      inner.add(trim);

      const outer = new THREE.Group();
      outer.position.set(side * 0.26, 0, 0);
      inner.add(outer);

      for (let f = 0; f < 4; f++) {
        const feather = new THREE.Mesh(
          outerFeatherGeo,
          f % 2 === 0 ? silverPlumeMat : astralFeatherGlow,
        );
        const fanAngle = (f - 1.5) * 0.22;
        feather.rotation.z = -side * (Math.PI * 0.5 + fanAngle * 0.45);
        feather.rotation.y = side * fanAngle;
        feather.position.set(side * (0.14 - f * 0.018), 0, -f * 0.052);
        outer.add(feather);
      }

      return { inner, outer };
    };

    const wingL = buildWing(1);
    const wingR = buildWing(-1);

    // Tail feather fan + golden talons
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, -0.16, -0.16);
    bodyPivot.add(tailPivot);
    const tailFeatherGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.045, 0.24, 4));
    tailFeatherGeo.rotateX(-Math.PI * 0.68);
    for (let t = -1; t <= 1; t++) {
      const tf = new THREE.Mesh(tailFeatherGeo, t === 0 ? astralFeatherGlow : plumageMat);
      tf.position.set(t * 0.065, -0.02, -0.08);
      tf.rotation.y = t * 0.22;
      tailPivot.add(tf);
    }

    const talonPivot = new THREE.Group();
    talonPivot.position.set(0, -0.24, 0.06);
    bodyPivot.add(talonPivot);
    const talonGeo = this.resources.trackGeometry(new THREE.TorusGeometry(0.038, 0.012, 6, 10, Math.PI));
    const talonL = new THREE.Mesh(talonGeo, goldMat);
    talonL.position.set(0.065, 0, 0);
    talonL.rotation.y = Math.PI / 2;
    const talonR = new THREE.Mesh(talonGeo, goldMat);
    talonR.position.set(-0.065, 0, 0);
    talonR.rotation.y = Math.PI / 2;
    talonPivot.add(talonL, talonR);

    // Orbiting starlight motes
    const moteGeo = this.resources.trackGeometry(new THREE.OctahedronGeometry(0.032, 0));
    const motes: THREE.Mesh[] = [];
    for (let m = 0; m < 4; m++) {
      const mote = new THREE.Mesh(moteGeo, astralFeatherGlow);
      root.add(mote);
      motes.push(mote);
    }

    this.addCastShadow(bodyPivot);

    let wingPhase = 0;

    return {
      id: 'celestial_owl',
      root,
      updateAnimation: (dt, elapsedSec, speedNorm, mode, scoopPulse01) => {
        const flapFreq = mode === 'dash' ? 17.5 : 8.5 + speedNorm * 5.0;
        wingPhase += dt * flapFreq;

        const flapAmp = mode === 'dash' ? 0.88 : 0.66;
        const innerAngle = Math.sin(wingPhase) * flapAmp + 0.12;
        const outerLag = Math.sin(wingPhase - 0.65) * (flapAmp * 0.68);

        wingL.inner.rotation.z = innerAngle;
        wingL.outer.rotation.z = outerLag;
        wingR.inner.rotation.z = -innerAngle;
        wingR.outer.rotation.z = -outerLag;

        // Forward pitch when dashing + celebratory barrel lift on scoop
        const targetPitch = mode === 'dash' ? 0.38 : speedNorm * 0.18;
        bodyPivot.rotation.x = targetPitch - scoopPulse01 * 0.35;
        bodyPivot.position.y = Math.sin(wingPhase + Math.PI) * 0.045 + scoopPulse01 * 0.12;

        headPivot.rotation.x = -bodyPivot.rotation.x * 0.55;
        headPivot.rotation.y = Math.sin(elapsedSec * 2.1) * 0.14;

        haloOuter.rotation.z = elapsedSec * 1.8;
        haloInner.rotation.x = Math.sin(elapsedSec * 2.6) * 0.35;
        haloInner.rotation.y = -elapsedSec * 2.9;

        tailPivot.rotation.x = Math.sin(wingPhase * 0.5) * 0.12;
        talonPivot.rotation.x = mode === 'dash' ? 0.45 : -0.25;

        for (let i = 0; i < motes.length; i++) {
          const a = elapsedSec * 2.8 + (i * Math.PI) / 2;
          const r = 0.34 + (mode === 'dash' ? 0.1 : 0) + Math.sin(elapsedSec * 3 + i) * 0.04;
          motes[i].position.set(
            Math.cos(a) * r,
            Math.sin(elapsedSec * 4.2 + i * 1.4) * 0.14,
            Math.sin(a) * r - speedNorm * 0.12,
          );
          const s = 0.75 + 0.35 * Math.sin(elapsedSec * 6 + i);
          motes[i].scale.setScalar(s);
        }
      },
    };
  }

  // ============================================================================
  // 2. EMBER WYRMLING — Hovering Baby Dragon Puffing Glowing Embers
  // ============================================================================
  private buildEmberWyrmling(): PetRigHandle {
    const root = new THREE.Group();
    root.name = 'Pet_EmberWyrmling';

    const scaleMat = this.resources.cloneLibraryMaterial('flesh_demon', {
      colorHex: 0x8f1d14,
      emissiveHex: 0x420b05,
      emissiveIntensity: 0.32,
      roughness: 0.46,
    });
    const hornMat = this.resources.cloneLibraryMaterial('wall_obsidian', {
      colorHex: 0x221c24,
      roughness: 0.34,
      metalness: 0.45,
    });
    const magmaBellyMat = this.resources.cloneLibraryMaterial('lava_emissive', {
      colorHex: 0xff7b29,
      emissiveHex: 0xff5400,
      emissiveIntensity: 1.05,
      roughness: 0.35,
    });
    const wingMembraneMat = this.resources.cloneLibraryMaterial('mythic_crimson', {
      colorHex: 0xb82818,
      emissiveHex: 0xff4500,
      emissiveIntensity: 0.48,
      side: THREE.DoubleSide,
      roughness: 0.55,
    });
    const emberGlowMat = this.resources.createAdditiveGlowMaterial(0xff922b, 0.9, false);

    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);

    // Wyrmling chest + glowing magma belly plates + dorsal spines
    const chestGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.21, 14, 12));
    chestGeo.scale(0.92, 0.95, 1.32);
    bodyPivot.add(new THREE.Mesh(chestGeo, scaleMat));

    const bellyGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.165, 12, 10));
    bellyGeo.scale(0.76, 0.72, 1.18);
    const belly = new THREE.Mesh(bellyGeo, magmaBellyMat);
    belly.position.set(0, -0.075, 0.03);
    bodyPivot.add(belly);

    const spineSpikeGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.032, 0.11, 5));
    for (let s = 0; s < 3; s++) {
      const spike = new THREE.Mesh(spineSpikeGeo, hornMat);
      spike.position.set(0, 0.19 - s * 0.02, 0.08 - s * 0.11);
      spike.rotation.x = -0.42;
      bodyPivot.add(spike);
    }

    // Neck + Horned Dragon Head + Articulated Ember-Puffing Jaw
    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 0.13, 0.21);
    bodyPivot.add(neckPivot);

    const neckGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.085, 0.115, 0.18, 10));
    neckGeo.rotateX(Math.PI * 0.28);
    const neckMesh = new THREE.Mesh(neckGeo, scaleMat);
    neckMesh.position.set(0, 0.06, 0.05);
    neckPivot.add(neckMesh);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.14, 0.11);
    neckPivot.add(headPivot);

    const skullGeo = this.resources.trackGeometry(new THREE.BoxGeometry(0.17, 0.13, 0.22));
    const skull = new THREE.Mesh(skullGeo, scaleMat);
    skull.position.set(0, 0.02, 0.05);
    headPivot.add(skull);

    const snoutGeo = this.resources.trackGeometry(new THREE.BoxGeometry(0.12, 0.085, 0.16));
    const snout = new THREE.Mesh(snoutGeo, scaleMat);
    snout.position.set(0, 0.0, 0.19);
    headPivot.add(snout);

    const throatCore = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.SphereGeometry(0.045, 8, 8)),
      emberGlowMat,
    );
    throatCore.position.set(0, -0.02, 0.18);
    headPivot.add(throatCore);

    const eyeGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.028, 8, 8));
    const eyeL = new THREE.Mesh(eyeGeo, emberGlowMat);
    eyeL.position.set(0.078, 0.042, 0.12);
    const eyeR = new THREE.Mesh(eyeGeo, emberGlowMat);
    eyeR.position.set(-0.078, 0.042, 0.12);
    headPivot.add(eyeL, eyeR);

    const hornGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.032, 0.22, 6));
    const hornL = new THREE.Mesh(hornGeo, hornMat);
    hornL.position.set(0.075, 0.11, -0.04);
    hornL.rotation.set(-0.78, 0, -0.28);
    const hornR = new THREE.Mesh(hornGeo, hornMat);
    hornR.position.set(-0.075, 0.11, -0.04);
    hornR.rotation.set(-0.78, 0, 0.28);
    headPivot.add(hornL, hornR);

    const jawPivot = new THREE.Group();
    jawPivot.position.set(0, -0.038, 0.08);
    headPivot.add(jawPivot);
    const lowerJaw = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.105, 0.045, 0.18)),
      scaleMat,
    );
    lowerJaw.position.set(0, -0.01, 0.09);
    jawPivot.add(lowerJaw);

    // Ribbed Draconic Bat-Wings
    const sparGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.018, 0.012, 0.34, 6));
    sparGeo.rotateZ(Math.PI / 2);
    const membraneGeo = this.resources.trackGeometry(new THREE.PlaneGeometry(0.32, 0.26));
    membraneGeo.rotateX(Math.PI / 2);

    const buildDragonWing = (side: 1 | -1): { inner: THREE.Group; outer: THREE.Group } => {
      const inner = new THREE.Group();
      inner.position.set(side * 0.15, 0.11, 0.04);
      bodyPivot.add(inner);

      const armBone = new THREE.Mesh(sparGeo, hornMat);
      armBone.position.set(side * 0.16, 0, 0.04);
      inner.add(armBone);

      const innerMem = new THREE.Mesh(membraneGeo, wingMembraneMat);
      innerMem.position.set(side * 0.16, -0.005, -0.07);
      inner.add(innerMem);

      const outer = new THREE.Group();
      outer.position.set(side * 0.31, 0, 0.04);
      inner.add(outer);

      const outerMem = new THREE.Mesh(membraneGeo, wingMembraneMat);
      outerMem.scale.set(0.88, 1, 0.85);
      outerMem.position.set(side * 0.14, 0, -0.08);
      outer.add(outerMem);

      const clawHook = new THREE.Mesh(
        this.resources.trackGeometry(new THREE.ConeGeometry(0.022, 0.07, 5)),
        hornMat,
      );
      clawHook.rotation.x = Math.PI * 0.5;
      clawHook.position.set(0, 0.01, 0.05);
      outer.add(clawHook);

      return { inner, outer };
    };

    const wingL = buildDragonWing(1);
    const wingR = buildDragonWing(-1);

    // 3-Segment Articulated Sinuous Tail + Flame Spade Tip
    const tailSegs: THREE.Group[] = [];
    let tailParent: THREE.Group = bodyPivot;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? -0.03 : 0, i === 0 ? -0.24 : -0.17);
      tailParent.add(seg);

      const r = 0.075 - i * 0.018;
      const segGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(r * 0.78, r, 0.18, 8));
      segGeo.rotateX(Math.PI / 2);
      const segMesh = new THREE.Mesh(segGeo, scaleMat);
      segMesh.position.set(0, 0, -0.08);
      seg.add(segMesh);

      if (i === 2) {
        const spadeGeo = this.resources.trackGeometry(new THREE.OctahedronGeometry(0.065, 0));
        spadeGeo.scale(0.85, 0.4, 1.45);
        const spade = new THREE.Mesh(spadeGeo, magmaBellyMat);
        spade.position.set(0, 0, -0.18);
        seg.add(spade);
      }

      tailSegs.push(seg);
      tailParent = seg;
    }

    // Pooled 3D Puffing Ember Particles
    const puffGeo = this.resources.trackGeometry(new THREE.IcosahedronGeometry(0.038, 0));
    const emberPuffs: EmberPuffSlot[] = [];
    for (let p = 0; p < 7; p++) {
      const mesh = new THREE.Mesh(puffGeo, emberGlowMat);
      mesh.visible = false;
      root.add(mesh);
      emberPuffs.push({ mesh, age: 99, maxAge: 0.75, vx: 0, vy: 0, vz: 0 });
    }

    this.addCastShadow(bodyPivot);

    let wingPhase = 0;
    let puffCooldown = 0.25;
    let jawOpenTimer = 0;

    const spawnEmberPuff = (dashBoost: boolean): void => {
      let slot = emberPuffs.find((s) => s.age >= s.maxAge);
      if (!slot) slot = emberPuffs[0];

      const spread = (slot === emberPuffs[0] ? 0.5 : (emberPuffs.indexOf(slot) % 3) - 1) * 0.22;
      slot.age = 0;
      slot.maxAge = dashBoost ? 0.52 : 0.78;
      slot.mesh.position.set(spread * 0.25, 0.23, 0.46);
      slot.vx = spread * 0.45;
      slot.vy = 0.42 + (emberPuffs.indexOf(slot) % 2) * 0.18;
      slot.vz = dashBoost ? -0.85 : 0.75;
      slot.mesh.scale.setScalar(0.65);
      slot.mesh.visible = true;
    };

    return {
      id: 'ember_wyrmling',
      root,
      updateAnimation: (dt, elapsedSec, speedNorm, mode, scoopPulse01) => {
        const flapFreq = mode === 'dash' ? 16.5 : 9.2 + speedNorm * 4.5;
        wingPhase += dt * flapFreq;

        const amp = mode === 'dash' ? 0.85 : 0.68;
        const flap = Math.sin(wingPhase) * amp + 0.18;
        const tip = Math.sin(wingPhase - 0.7) * (amp * 0.62);

        wingL.inner.rotation.z = flap;
        wingL.outer.rotation.z = tip;
        wingR.inner.rotation.z = -flap;
        wingR.outer.rotation.z = -tip;

        bodyPivot.position.y = Math.sin(wingPhase + Math.PI) * 0.05 + scoopPulse01 * 0.1;
        bodyPivot.rotation.x = (mode === 'dash' ? 0.34 : 0.08 + speedNorm * 0.14) - scoopPulse01 * 0.25;
        neckPivot.rotation.x = -bodyPivot.rotation.x * 0.5 + Math.sin(elapsedSec * 3.1) * 0.08;

        for (let i = 0; i < tailSegs.length; i++) {
          tailSegs[i].rotation.y = Math.sin(elapsedSec * 5.2 - i * 0.85) * (0.22 + i * 0.08);
          tailSegs[i].rotation.x = Math.cos(wingPhase - i * 0.6) * 0.12;
        }

        // Periodic ember puffing from draconic jaws
        puffCooldown -= dt;
        const interval = mode === 'dash' ? 0.12 : 0.95;
        if (puffCooldown <= 0) {
          puffCooldown = interval;
          jawOpenTimer = 0.26;
          spawnEmberPuff(mode === 'dash');
        }

        if (jawOpenTimer > 0) {
          jawOpenTimer = Math.max(0, jawOpenTimer - dt);
        }
        const jawOpen01 = clamp(jawOpenTimer / 0.26, 0, 1);
        jawPivot.rotation.x = jawOpen01 * 0.52 + 0.06;

        for (let i = 0; i < emberPuffs.length; i++) {
          const p = emberPuffs[i];
          if (p.age >= p.maxAge) {
            p.mesh.visible = false;
            continue;
          }
          p.age += dt;
          const t = clamp(p.age / p.maxAge, 0, 1);
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt;
          p.mesh.position.z += p.vz * dt;
          const scale = (1 - t * 0.72) * (0.65 + Math.sin(t * Math.PI) * 0.65);
          p.mesh.scale.setScalar(Math.max(0.05, scale));
          p.mesh.rotation.x += dt * 4.5;
          p.mesh.rotation.y += dt * 5.2;
        }
      },
    };
  }

  // ============================================================================
  // 3. VOID KITSUNE — 4 Articulated Legs + 5 Multi-Tailed Shadow Fox
  // ============================================================================
  private buildVoidKitsune(): PetRigHandle {
    const root = new THREE.Group();
    root.name = 'Pet_VoidKitsune';

    const shadowFurMat = this.resources.cloneLibraryMaterial('cloth_shadow', {
      colorHex: 0x1b122b,
      emissiveHex: 0x3b1566,
      emissiveIntensity: 0.34,
      roughness: 0.58,
    });
    const spiritRuffMat = this.resources.cloneLibraryMaterial('ice_glacier', {
      colorHex: 0xe5dbff,
      emissiveHex: 0x7950f2,
      emissiveIntensity: 0.42,
      roughness: 0.42,
    });
    const voidTipMat = this.resources.cloneLibraryMaterial('rune_glow_void', {
      colorHex: 0xda77f2,
      emissiveHex: 0xae3ec9,
      emissiveIntensity: 0.95,
      roughness: 0.3,
    });
    const cyanGlowMat = this.resources.createAdditiveGlowMaterial(0x66d9e8, 0.88, true);

    // Subtle ground spirit-paw aura disc
    const auraTex = this.resources.createRadialAuraTexture(
      PET_DEFINITIONS.void_kitsune.accentColorHex,
      PET_DEFINITIONS.void_kitsune.primaryColorHex,
      64,
    );
    const auraMat = this.resources.trackMaterial(
      new THREE.MeshBasicMaterial({
        map: auraTex,
        transparent: true,
        opacity: 0.52,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const auraGeo = this.resources.trackGeometry(new THREE.PlaneGeometry(0.95, 0.95));
    auraGeo.rotateX(-Math.PI / 2);
    const auraDisc = new THREE.Mesh(auraGeo, auraMat);
    auraDisc.position.y = 0.02;
    root.add(auraDisc);

    // Articulated vulpine body rooted at leg height (y = 0.34)
    const bodyPivot = new THREE.Group();
    bodyPivot.position.set(0, 0.34, 0);
    root.add(bodyPivot);

    const torsoGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.16, 14, 10));
    torsoGeo.scale(0.84, 0.86, 1.85);
    bodyPivot.add(new THREE.Mesh(torsoGeo, shadowFurMat));

    const ruffGeo = this.resources.trackGeometry(new THREE.DodecahedronGeometry(0.165, 0));
    ruffGeo.scale(1.05, 0.95, 0.92);
    const ruff = new THREE.Mesh(ruffGeo, spiritRuffMat);
    ruff.position.set(0, 0.04, 0.19);
    bodyPivot.add(ruff);

    // Sleek Kitsune Head + Tall Twin Ears + Floating Spirit Pearl
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.14, 0.28);
    bodyPivot.add(headPivot);

    const skullGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.13, 12, 10));
    skullGeo.scale(1.02, 0.92, 1.08);
    headPivot.add(new THREE.Mesh(skullGeo, shadowFurMat));

    const muzzleGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.068, 0.2, 6));
    muzzleGeo.rotateX(Math.PI * 0.52);
    const muzzle = new THREE.Mesh(muzzleGeo, spiritRuffMat);
    muzzle.position.set(0, -0.022, 0.155);
    headPivot.add(muzzle);

    const eyeGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.025, 8, 8));
    const eyeL = new THREE.Mesh(eyeGeo, cyanGlowMat);
    eyeL.position.set(0.058, 0.022, 0.11);
    const eyeR = new THREE.Mesh(eyeGeo, cyanGlowMat);
    eyeR.position.set(-0.058, 0.022, 0.11);
    headPivot.add(eyeL, eyeR);

    const earGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.048, 0.21, 5));
    const earTipGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.026, 0.09, 5));

    const buildEar = (side: 1 | -1): THREE.Group => {
      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.075, 0.1, -0.01);
      earPivot.rotation.set(0.15, 0, -side * 0.26);
      const earBase = new THREE.Mesh(earGeo, shadowFurMat);
      earBase.position.y = 0.08;
      const earTip = new THREE.Mesh(earTipGeo, voidTipMat);
      earTip.position.y = 0.16;
      earPivot.add(earBase, earTip);
      headPivot.add(earPivot);
      return earPivot;
    };

    const earL = buildEar(1);
    const earR = buildEar(-1);

    const spiritPearl = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.OctahedronGeometry(0.048, 0)),
      cyanGlowMat,
    );
    spiritPearl.position.set(0, 0.24, 0.04);
    headPivot.add(spiritPearl);

    // 4 Articulated Vulpine Legs (Upper + Lower Paw)
    const upperLegGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.036, 0.028, 0.18, 7));
    const lowerPawGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.026, 0.022, 0.16, 7));

    const buildLeg = (x: number, z: number): { hip: THREE.Group; knee: THREE.Group } => {
      const hip = new THREE.Group();
      hip.position.set(x, -0.05, z);
      bodyPivot.add(hip);

      const thigh = new THREE.Mesh(upperLegGeo, shadowFurMat);
      thigh.position.y = -0.08;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.16;
      hip.add(knee);

      const shin = new THREE.Mesh(lowerPawGeo, voidTipMat);
      shin.position.y = -0.07;
      knee.add(shin);

      return { hip, knee };
    };

    const frontL = buildLeg(0.085, 0.18);
    const frontR = buildLeg(-0.085, 0.18);
    const hindL = buildLeg(0.09, -0.19);
    const hindR = buildLeg(-0.09, -0.19);

    // 5 Articulated Multi-Tailed Shadow-Flame Tails
    const tailHub = new THREE.Group();
    tailHub.position.set(0, 0.05, -0.26);
    bodyPivot.add(tailHub);

    const tailBaseGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.068, 0.3, 7));
    tailBaseGeo.rotateX(-Math.PI * 0.5);
    const tailTipGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.058, 0.26, 7));
    tailTipGeo.rotateX(-Math.PI * 0.5);

    const tails: Array<{ base: THREE.Group; mid: THREE.Group; fanYaw: number; fanPitch: number }> = [];
    const tailCount = 5;
    for (let i = 0; i < tailCount; i++) {
      const norm = (i - (tailCount - 1) * 0.5) / ((tailCount - 1) * 0.5); // -1 .. +1
      const fanYaw = norm * 0.88;
      const fanPitch = 0.42 + (1 - Math.abs(norm)) * 0.28;

      const base = new THREE.Group();
      base.rotation.set(fanPitch, fanYaw, 0);
      tailHub.add(base);

      const baseMesh = new THREE.Mesh(tailBaseGeo, shadowFurMat);
      baseMesh.position.set(0, 0, -0.14);
      base.add(baseMesh);

      const mid = new THREE.Group();
      mid.position.set(0, 0, -0.26);
      base.add(mid);

      const tipMesh = new THREE.Mesh(tailTipGeo, i % 2 === 0 ? voidTipMat : spiritRuffMat);
      tipMesh.position.set(0, 0, -0.11);
      mid.add(tipMesh);

      const wisp = new THREE.Mesh(
        this.resources.trackGeometry(new THREE.OctahedronGeometry(0.03, 0)),
        cyanGlowMat,
      );
      wisp.position.set(0, 0, -0.24);
      mid.add(wisp);

      tails.push({ base, mid, fanYaw, fanPitch });
    }

    this.addCastShadow(bodyPivot);

    let gaitPhase = 0;

    return {
      id: 'void_kitsune',
      root,
      updateAnimation: (dt, elapsedSec, speedNorm, mode, scoopPulse01) => {
        const isDashing = mode === 'dash';
        const moveFactor = isDashing ? 1.0 : clamp(speedNorm, 0, 1);
        gaitPhase += dt * (isDashing ? 18.5 : 4.0 + moveFactor * 10.5);

        if (isDashing) {
          // Elastic vulpine gallop bound
          const boundSin = Math.sin(gaitPhase);
          bodyPivot.position.y = 0.35 + Math.max(0, boundSin) * 0.13 + scoopPulse01 * 0.12;
          bodyPivot.rotation.x = -boundSin * 0.22;
          frontL.hip.rotation.x = boundSin * 0.78;
          frontR.hip.rotation.x = Math.sin(gaitPhase + 0.35) * 0.78;
          hindL.hip.rotation.x = -boundSin * 0.75;
          hindR.hip.rotation.x = -Math.sin(gaitPhase + 0.35) * 0.75;
          frontL.knee.rotation.x = -0.35;
          frontR.knee.rotation.x = -0.35;
          hindL.knee.rotation.x = 0.35;
          hindR.knee.rotation.x = 0.35;
        } else if (moveFactor > 0.08) {
          // Crisp diagonal trot beside hero
          const swing = Math.sin(gaitPhase) * 0.58 * moveFactor;
          bodyPivot.position.y = 0.34 + Math.abs(Math.sin(gaitPhase)) * 0.035 + scoopPulse01 * 0.1;
          bodyPivot.rotation.x = scoopPulse01 * -0.25;
          frontL.hip.rotation.x = swing;
          hindR.hip.rotation.x = swing;
          frontR.hip.rotation.x = -swing;
          hindL.hip.rotation.x = -swing;
          frontL.knee.rotation.x = Math.min(0, -swing * 0.55);
          frontR.knee.rotation.x = Math.min(0, swing * 0.55);
          hindL.knee.rotation.x = Math.max(0, -swing * 0.45);
          hindR.knee.rotation.x = Math.max(0, swing * 0.45);
        } else {
          // Alert breathing + subtle poise sway
          bodyPivot.position.y = 0.335 + Math.sin(elapsedSec * 2.8) * 0.014 + scoopPulse01 * 0.1;
          bodyPivot.rotation.x = 0;
          frontL.hip.rotation.x = 0;
          frontR.hip.rotation.x = 0;
          hindL.hip.rotation.x = 0;
          hindR.hip.rotation.x = 0;
          frontL.knee.rotation.x = 0;
          frontR.knee.rotation.x = 0;
          hindL.knee.rotation.x = 0;
          hindR.knee.rotation.x = 0;
        }

        headPivot.rotation.y = Math.sin(elapsedSec * 1.9) * 0.12;
        earL.rotation.z = -0.26 + Math.sin(elapsedSec * 4.5) * 0.08;
        earR.rotation.z = 0.26 - Math.sin(elapsedSec * 4.1 + 1.1) * 0.08;

        spiritPearl.position.y = 0.24 + Math.sin(elapsedSec * 3.8) * 0.025;
        spiritPearl.rotation.y = elapsedSec * 2.6;

        auraDisc.rotation.z = elapsedSec * 0.9;

        // Multi-tailed phase-offset harmonic undulation
        const tailWaveSpeed = isDashing ? 9.5 : 3.8 + moveFactor * 3.2;
        for (let i = 0; i < tails.length; i++) {
          const t = tails[i];
          const phase = elapsedSec * tailWaveSpeed + i * 0.95;
          t.base.rotation.y = t.fanYaw + Math.sin(phase) * 0.18;
          t.base.rotation.x =
            (isDashing ? 0.16 : t.fanPitch) + Math.cos(phase * 0.85) * 0.12;
          t.mid.rotation.y = Math.sin(phase - 0.8) * 0.28;
          t.mid.rotation.x = Math.cos(phase - 0.6) * 0.18;
        }
      },
    };
  }
}
