import * as THREE from 'three';
import type { MercenaryId } from '../../contracts/types';
import { clamp } from '../../core/Constants';
import { MERCENARY_DEFINITIONS } from './companionData';
import type { CompanionResourcePool } from './CompanionResourcePool';

export type MercenaryAnimMode =
  | 'peaceful_idle'
  | 'combat_idle'
  | 'run'
  | 'attack'
  | 'special'
  | 'downed';

export interface MercenaryRigHandle {
  readonly id: MercenaryId;
  readonly root: THREE.Group;
  flashHit(colorHex?: number): void;
  triggerActionAnim(kind: 'attack' | 'special', durationSec?: number): void;
  updateAnimation(
    dt: number,
    elapsedSec: number,
    mode: MercenaryAnimMode,
    moveSpeedNorm: number,
    reviveProgress01: number,
  ): void;
}

interface HumanoidLimbs {
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  shoulderL: THREE.Group;
  elbowL: THREE.Group;
  shoulderR: THREE.Group;
  elbowR: THREE.Group;
  hipL: THREE.Group;
  kneeL: THREE.Group;
  hipR: THREE.Group;
  kneeR: THREE.Group;
  cape0: THREE.Group;
  cape1: THREE.Group;
}

interface EmissiveBackup {
  mat: THREE.MeshStandardMaterial;
  baseHex: number;
  baseIntensity: number;
}

export class MercenaryRigBuilder {
  constructor(private readonly resources: CompanionResourcePool) {}

  public buildMercenaryRig(mercId: MercenaryId): MercenaryRigHandle {
    switch (mercId) {
      case 'iron_templar':
        return this.buildIronTemplar();
      case 'sylvan_ranger':
        return this.buildSylvanRanger();
      case 'storm_arcanist':
        return this.buildStormArcanist();
    }
  }

  private createHumanoidSkeleton(root: THREE.Group): HumanoidLimbs {
    const pelvis = new THREE.Group();
    pelvis.position.set(0, 0.86, 0);
    root.add(pelvis);

    const torso = new THREE.Group();
    torso.position.set(0, 0.12, 0);
    pelvis.add(torso);

    const head = new THREE.Group();
    head.position.set(0, 0.5, 0);
    torso.add(head);

    const shoulderL = new THREE.Group();
    shoulderL.position.set(0.28, 0.38, 0);
    torso.add(shoulderL);

    const elbowL = new THREE.Group();
    elbowL.position.set(0, -0.26, 0);
    shoulderL.add(elbowL);

    const shoulderR = new THREE.Group();
    shoulderR.position.set(-0.28, 0.38, 0);
    torso.add(shoulderR);

    const elbowR = new THREE.Group();
    elbowR.position.set(0, -0.26, 0);
    shoulderR.add(elbowR);

    const hipL = new THREE.Group();
    hipL.position.set(0.13, -0.02, 0);
    pelvis.add(hipL);

    const kneeL = new THREE.Group();
    kneeL.position.set(0, -0.4, 0);
    hipL.add(kneeL);

    const hipR = new THREE.Group();
    hipR.position.set(-0.13, -0.02, 0);
    pelvis.add(hipR);

    const kneeR = new THREE.Group();
    kneeR.position.set(0, -0.4, 0);
    hipR.add(kneeR);

    const cape0 = new THREE.Group();
    cape0.position.set(0, 0.42, -0.16);
    torso.add(cape0);

    const cape1 = new THREE.Group();
    cape1.position.set(0, -0.44, 0);
    cape0.add(cape1);

    return {
      pelvis,
      torso,
      head,
      shoulderL,
      elbowL,
      shoulderR,
      elbowR,
      hipL,
      kneeL,
      hipR,
      kneeR,
      cape0,
      cape1,
    };
  }

  private collectStandardMaterials(root: THREE.Object3D): EmissiveBackup[] {
    const seen = new Set<THREE.MeshStandardMaterial>();
    const list: EmissiveBackup[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      const m = mesh.material;
      if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        const std = m as THREE.MeshStandardMaterial;
        if (!seen.has(std)) {
          seen.add(std);
          list.push({
            mat: std,
            baseHex: std.emissive.getHex(),
            baseIntensity: std.emissiveIntensity,
          });
        }
      }
    });
    return list;
  }

  private createGroundIndicators(
    root: THREE.Group,
    mercId: MercenaryId,
  ): { poiseDisc: THREE.Mesh; reviveRing: THREE.Mesh } {
    const def = MERCENARY_DEFINITIONS[mercId];
    const auraTex = this.resources.createRadialAuraTexture(
      def.accentColorHex,
      def.primaryColorHex,
      64,
    );
    const poiseMat = this.resources.trackMaterial(
      new THREE.MeshBasicMaterial({
        map: auraTex,
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const poiseGeo = this.resources.trackGeometry(new THREE.PlaneGeometry(1.35, 1.35));
    poiseGeo.rotateX(-Math.PI / 2);
    const poiseDisc = new THREE.Mesh(poiseGeo, poiseMat);
    poiseDisc.position.y = 0.025;
    poiseDisc.castShadow = false;
    root.add(poiseDisc);

    const reviveGeo = this.resources.trackGeometry(new THREE.RingGeometry(0.56, 0.72, 28));
    reviveGeo.rotateX(-Math.PI / 2);
    const reviveMat = this.resources.createAdditiveGlowMaterial(0xffd43b, 0.85, true);
    const reviveRing = new THREE.Mesh(reviveGeo, reviveMat);
    reviveRing.position.y = 0.04;
    reviveRing.visible = false;
    reviveRing.castShadow = false;
    root.add(reviveRing);

    return { poiseDisc, reviveRing };
  }

  // ============================================================================
  // 1. IRON TEMPLAR — Sword-and-Shield Paladin Tank
  // ============================================================================
  private buildIronTemplar(): MercenaryRigHandle {
    const root = new THREE.Group();
    root.name = 'Mercenary_IronTemplar';

    const steelMat = this.resources.cloneLibraryMaterial('metal_steel', {
      colorHex: 0xd0d7de,
      metalness: 0.82,
      roughness: 0.28,
    });
    const goldMat = this.resources.cloneLibraryMaterial('metal_gold', {
      colorHex: 0xffd43b,
      emissiveHex: 0x6e4e08,
      emissiveIntensity: 0.22,
      metalness: 0.88,
      roughness: 0.24,
    });
    const crimsonClothMat = this.resources.cloneLibraryMaterial('cloth_crimson', {
      colorHex: 0xa61e24,
      roughness: 0.68,
    });
    const visorGlowMat = this.resources.createAdditiveGlowMaterial(0xffe066, 0.95, false);

    const limbs = this.createHumanoidSkeleton(root);

    // Armored Cuirass + Tabard + Pauldrons
    const chestGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.24, 0.2, 0.48, 10));
    const chest = new THREE.Mesh(chestGeo, steelMat);
    chest.position.y = 0.22;
    limbs.torso.add(chest);

    const tabard = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.24, 0.56, 0.06)),
      crimsonClothMat,
    );
    tabard.position.set(0, 0.06, 0.19);
    limbs.torso.add(tabard);

    const sunEmblem = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.OctahedronGeometry(0.08, 0)),
      goldMat,
    );
    sunEmblem.position.set(0, 0.26, 0.23);
    limbs.torso.add(sunEmblem);

    // Winged Crusader Greathelm
    const helm = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.145, 0.155, 0.28, 10)),
      steelMat,
    );
    helm.position.y = 0.13;
    limbs.head.add(helm);

    const helmCrown = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.TorusGeometry(0.148, 0.022, 6, 16)),
      goldMat,
    );
    helmCrown.rotation.x = Math.PI / 2;
    helmCrown.position.y = 0.23;
    limbs.head.add(helmCrown);

    const visorH = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.18, 0.03, 0.05)),
      visorGlowMat,
    );
    visorH.position.set(0, 0.15, 0.145);
    const visorV = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.032, 0.14, 0.05)),
      visorGlowMat,
    );
    visorV.position.set(0, 0.12, 0.145);
    limbs.head.add(visorH, visorV);

    const wingCrestGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.045, 0.22, 4));
    const wingL = new THREE.Mesh(wingCrestGeo, goldMat);
    wingL.position.set(0.16, 0.24, -0.02);
    wingL.rotation.set(-0.35, 0, -0.45);
    const wingR = new THREE.Mesh(wingCrestGeo, goldMat);
    wingR.position.set(-0.16, 0.24, -0.02);
    wingR.rotation.set(-0.35, 0, 0.45);
    limbs.head.add(wingL, wingR);

    // Arms & Legs Plate
    const pauldronGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.13, 10, 8));
    const upperArmGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.075, 0.065, 0.26, 8));
    const forearmGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.068, 0.058, 0.25, 8));

    for (const [side, sh, el] of [
      [1, limbs.shoulderL, limbs.elbowL],
      [-1, limbs.shoulderR, limbs.elbowR],
    ] as const) {
      const pauldron = new THREE.Mesh(pauldronGeo, steelMat);
      pauldron.scale.set(1.15, 0.85, 1.05);
      pauldron.position.set(side * 0.04, 0.03, 0);
      sh.add(pauldron);

      const trim = new THREE.Mesh(
        this.resources.trackGeometry(new THREE.TorusGeometry(0.12, 0.018, 6, 12)),
        goldMat,
      );
      trim.rotation.y = Math.PI / 2;
      sh.add(trim);

      const ua = new THREE.Mesh(upperArmGeo, steelMat);
      ua.position.y = -0.13;
      sh.add(ua);

      const fa = new THREE.Mesh(forearmGeo, steelMat);
      fa.position.y = -0.12;
      el.add(fa);
    }

    const thighGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.095, 0.08, 0.4, 8));
    const greaveGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.082, 0.07, 0.42, 8));
    for (const [hip, knee] of [
      [limbs.hipL, limbs.kneeL],
      [limbs.hipR, limbs.kneeR],
    ] as const) {
      const th = new THREE.Mesh(thighGeo, steelMat);
      th.position.y = -0.2;
      hip.add(th);
      const gr = new THREE.Mesh(greaveGeo, steelMat);
      gr.position.y = -0.21;
      knee.add(gr);
    }

    // Flowing Crimson Paladin Cape
    const capeTop = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.42, 0.46, 0.03)),
      crimsonClothMat,
    );
    capeTop.position.y = -0.22;
    limbs.cape0.add(capeTop);

    const capeBot = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.46, 0.44, 0.028)),
      crimsonClothMat,
    );
    capeBot.position.y = -0.21;
    limbs.cape1.add(capeBot);

    // Right Hand: Sanctified Broadsword
    const swordGroup = new THREE.Group();
    swordGroup.position.set(0, -0.24, 0.04);
    limbs.elbowR.add(swordGroup);

    const hilt = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 6)),
      goldMat,
    );
    hilt.rotation.x = Math.PI / 2;
    const crossguard = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.28, 0.04, 0.05)),
      goldMat,
    );
    crossguard.position.z = 0.1;
    const blade = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.085, 0.026, 0.88)),
      steelMat,
    );
    blade.position.z = 0.54;
    const bladeRune = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.03, 0.032, 0.68)),
      visorGlowMat,
    );
    bladeRune.position.z = 0.48;
    swordGroup.add(hilt, crossguard, blade, bladeRune);

    // Left Forearm: Tower Bulwark Kite Shield
    const shieldGroup = new THREE.Group();
    shieldGroup.position.set(0.08, -0.16, 0.14);
    limbs.elbowL.add(shieldGroup);

    const shieldPlate = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.46, 0.68, 0.055)),
      steelMat,
    );
    const shieldBorder = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.5, 0.72, 0.035)),
      goldMat,
    );
    shieldBorder.position.z = -0.01;
    const shieldCrossV = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.065, 0.52, 0.065)),
      goldMat,
    );
    shieldCrossV.position.z = 0.015;
    const shieldCrossH = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.32, 0.065, 0.065)),
      goldMat,
    );
    shieldCrossH.position.set(0, 0.08, 0.015);
    shieldGroup.add(shieldPlate, shieldBorder, shieldCrossV, shieldCrossH);

    const stdMats = this.collectStandardMaterials(limbs.pelvis);
    const indicators = this.createGroundIndicators(root, 'iron_templar');

    return this.createRigController(
      'iron_templar',
      root,
      limbs,
      stdMats,
      indicators,
      (actionKind, progress01) => {
        if (actionKind === 'special') {
          // Taunting Aegis Shield Slam + Warcry!
          const slam = Math.sin(progress01 * Math.PI);
          limbs.torso.rotation.x = 0.25 * slam;
          limbs.shoulderL.rotation.set(-1.15 * slam - 0.3, 0.45 * slam, 0);
          limbs.elbowL.rotation.set(-0.35, 0, 0);
          limbs.shoulderR.rotation.set(0.55 * slam, 0, -0.45);
        } else {
          // Wide Sanctified Broadsword Cleave!
          const swing = Math.sin(progress01 * Math.PI);
          const arc = (progress01 - 0.5) * 2.3;
          limbs.torso.rotation.y = -arc * 0.48;
          limbs.shoulderR.rotation.set(-1.15, -arc * 0.85, -0.35 * swing);
          limbs.elbowR.rotation.set(-0.25, 0, 0);
          limbs.shoulderL.rotation.set(-0.55, 0.35, 0.15);
          limbs.elbowL.rotation.set(-0.55, 0, 0);
        }
      },
      (peaceful, elapsedSec) => {
        if (peaceful) {
          // Calm sentinel stance in Sanctuary
          limbs.shoulderL.rotation.set(-0.2, 0.15, 0.08);
          limbs.elbowL.rotation.set(-0.3, 0, 0);
          limbs.shoulderR.rotation.set(-0.15, 0, -0.1);
          limbs.elbowR.rotation.set(-0.2, 0, 0);
        } else {
          // Shield raised guard stance
          limbs.shoulderL.rotation.set(-0.58, 0.38, 0.12);
          limbs.elbowL.rotation.set(-0.52, 0, 0);
          limbs.shoulderR.rotation.set(-0.35 + Math.sin(elapsedSec * 2.4) * 0.05, -0.18, -0.18);
          limbs.elbowR.rotation.set(-0.35, 0, 0);
        }
      },
    );
  }

  // ============================================================================
  // 2. SYLVAN RANGER — Rapid-Fire Emerald Bow Archer
  // ============================================================================
  private buildSylvanRanger(): MercenaryRigHandle {
    const root = new THREE.Group();
    root.name = 'Mercenary_SylvanRanger';

    const rangerLeatherMat = this.resources.cloneLibraryMaterial('cloth_shadow', {
      colorHex: 0x1c3325,
      roughness: 0.62,
    });
    const cloakMat = this.resources.cloneLibraryMaterial('cloth_shadow', {
      colorHex: 0x164027,
      emissiveHex: 0x0b2916,
      emissiveIntensity: 0.2,
      roughness: 0.68,
    });
    const oakMat = this.resources.cloneLibraryMaterial('wood_oak', {
      colorHex: 0x6e4726,
      roughness: 0.55,
    });
    const goldMat = this.resources.cloneLibraryMaterial('metal_gold', {
      colorHex: 0xd9b44a,
      metalness: 0.78,
      roughness: 0.3,
    });
    const emeraldGlowMat = this.resources.createAdditiveGlowMaterial(0x51cf66, 0.92, true);

    const limbs = this.createHumanoidSkeleton(root);

    // Agile Brigandine + Belt + Quiver
    const torsoMesh = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.2, 0.17, 0.46, 10)),
      rangerLeatherMat,
    );
    torsoMesh.position.y = 0.22;
    limbs.torso.add(torsoMesh);

    const chestStrap = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.06, 0.48, 0.36)),
      oakMat,
    );
    chestStrap.position.y = 0.22;
    chestStrap.rotation.z = 0.52;
    limbs.torso.add(chestStrap);

    // Back Quiver with Emerald-Fletched Arrows
    const quiverGroup = new THREE.Group();
    quiverGroup.position.set(-0.1, 0.26, -0.18);
    quiverGroup.rotation.z = -0.36;
    limbs.torso.add(quiverGroup);

    const quiverTube = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.065, 0.052, 0.44, 8)),
      oakMat,
    );
    quiverGroup.add(quiverTube);
    const arrowFletchGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.025, 0.12, 4));
    for (let a = 0; a < 3; a++) {
      const fl = new THREE.Mesh(arrowFletchGeo, emeraldGlowMat);
      fl.position.set((a - 1) * 0.025, 0.26, 0);
      quiverGroup.add(fl);
    }

    // Pointed Woodland Hood + Glowing Emerald Eyes
    const hood = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.ConeGeometry(0.17, 0.32, 9)),
      cloakMat,
    );
    hood.position.set(0, 0.17, -0.02);
    hood.rotation.x = -0.18;
    limbs.head.add(hood);

    const mask = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.SphereGeometry(0.125, 10, 8)),
      rangerLeatherMat,
    );
    mask.position.set(0, 0.12, 0.02);
    limbs.head.add(mask);

    const eyeGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.024, 8, 8));
    const eyeL = new THREE.Mesh(eyeGeo, emeraldGlowMat);
    eyeL.position.set(0.048, 0.14, 0.13);
    const eyeR = new THREE.Mesh(eyeGeo, emeraldGlowMat);
    eyeR.position.set(-0.048, 0.14, 0.13);
    limbs.head.add(eyeL, eyeR);

    // Limbs + Woodland Cloak
    const armGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.062, 0.052, 0.25, 8));
    for (const [sh, el] of [
      [limbs.shoulderL, limbs.elbowL],
      [limbs.shoulderR, limbs.elbowR],
    ] as const) {
      const ua = new THREE.Mesh(armGeo, rangerLeatherMat);
      ua.position.y = -0.12;
      sh.add(ua);
      const fa = new THREE.Mesh(armGeo, oakMat);
      fa.position.y = -0.12;
      el.add(fa);
    }

    const legGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.08, 0.065, 0.4, 8));
    for (const [hip, knee] of [
      [limbs.hipL, limbs.kneeL],
      [limbs.hipR, limbs.kneeR],
    ] as const) {
      const th = new THREE.Mesh(legGeo, rangerLeatherMat);
      th.position.y = -0.2;
      hip.add(th);
      const boot = new THREE.Mesh(legGeo, oakMat);
      boot.position.y = -0.2;
      knee.add(boot);
    }

    const capeTop = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.36, 0.42, 0.025)),
      cloakMat,
    );
    capeTop.position.y = -0.2;
    limbs.cape0.add(capeTop);
    const capeBot = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.4, 0.4, 0.022)),
      cloakMat,
    );
    capeBot.position.y = -0.19;
    limbs.cape1.add(capeBot);

    // Left Hand: Articulated Emerald Recurve Longbow + Nocked Energy Arrow
    const bowGroup = new THREE.Group();
    bowGroup.position.set(0, -0.23, 0.08);
    limbs.elbowL.add(bowGroup);

    const bowArc = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.TorusGeometry(0.42, 0.026, 8, 20, Math.PI * 0.88)),
      oakMat,
    );
    bowArc.rotation.y = Math.PI / 2;
    bowArc.rotation.z = -Math.PI * 0.44;
    bowArc.position.z = -0.12;
    bowGroup.add(bowArc);

    const bowGem = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.OctahedronGeometry(0.055, 0)),
      emeraldGlowMat,
    );
    bowGem.position.z = 0.3;
    bowGroup.add(bowGem);

    const bowString = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.008, 0.008, 0.78, 6)),
      emeraldGlowMat,
    );
    bowGroup.add(bowString);

    const nockedArrow = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 6)),
      emeraldGlowMat,
    );
    nockedArrow.rotation.x = Math.PI / 2;
    nockedArrow.position.z = 0.22;
    bowGroup.add(nockedArrow);

    const bowTipGoldGeo = this.resources.trackGeometry(new THREE.ConeGeometry(0.032, 0.1, 5));
    const tipTop = new THREE.Mesh(bowTipGoldGeo, goldMat);
    tipTop.position.set(0, 0.4, -0.05);
    const tipBot = new THREE.Mesh(bowTipGoldGeo, goldMat);
    tipBot.rotation.x = Math.PI;
    tipBot.position.set(0, -0.4, -0.05);
    bowGroup.add(tipTop, tipBot);

    const stdMats = this.collectStandardMaterials(limbs.pelvis);
    const indicators = this.createGroundIndicators(root, 'sylvan_ranger');

    return this.createRigController(
      'sylvan_ranger',
      root,
      limbs,
      stdMats,
      indicators,
      (actionKind, progress01) => {
        // Rapid-fire draw & crisp release recoil
        const drawPhase = progress01 < 0.55 ? progress01 / 0.55 : 1 - (progress01 - 0.55) / 0.45;
        limbs.torso.rotation.y = 0.42;
        limbs.shoulderL.rotation.set(-1.38, -0.35, 0);
        limbs.elbowL.rotation.set(-0.1, 0, 0);
        limbs.shoulderR.rotation.set(-1.35, 0.25, 0);
        limbs.elbowR.rotation.set(-0.35 - drawPhase * 0.85, 0, 0);
        nockedArrow.visible = progress01 < 0.62 || actionKind === 'special';
        nockedArrow.position.z = 0.26 - drawPhase * 0.18;
      },
      (peaceful, elapsedSec) => {
        nockedArrow.visible = !peaceful;
        nockedArrow.position.z = 0.22;
        if (peaceful) {
          limbs.shoulderL.rotation.set(-0.22, 0.1, 0.1);
          limbs.elbowL.rotation.set(-0.28, 0, 0);
          limbs.shoulderR.rotation.set(-0.15, 0, -0.1);
          limbs.elbowR.rotation.set(-0.22, 0, 0);
        } else {
          limbs.shoulderL.rotation.set(-0.85 + Math.sin(elapsedSec * 2.8) * 0.05, -0.15, 0.08);
          limbs.elbowL.rotation.set(-0.25, 0, 0);
          limbs.shoulderR.rotation.set(-0.65, 0.18, -0.12);
          limbs.elbowR.rotation.set(-0.55, 0, 0);
        }
      },
    );
  }

  // ============================================================================
  // 3. STORM ARCANIST — Tempest Spire Staff, Orbiting Shards & Sanctuary Pulse
  // ============================================================================
  private buildStormArcanist(): MercenaryRigHandle {
    const root = new THREE.Group();
    root.name = 'Mercenary_StormArcanist';

    const robeMat = this.resources.cloneLibraryMaterial('cloth_arcane', {
      colorHex: 0x182b59,
      emissiveHex: 0x10285e,
      emissiveIntensity: 0.32,
      roughness: 0.56,
    });
    const goldMat = this.resources.cloneLibraryMaterial('metal_gold', {
      colorHex: 0xffd43b,
      emissiveHex: 0x8c620a,
      emissiveIntensity: 0.26,
      metalness: 0.86,
      roughness: 0.25,
    });
    const crystalMat = this.resources.cloneLibraryMaterial('crystal_cyan', {
      colorHex: 0x74c0fc,
      emissiveHex: 0x339af0,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });
    const stormGlowMat = this.resources.createAdditiveGlowMaterial(0x74c0fc, 0.9, true);
    const lightningGlowMat = this.resources.createAdditiveGlowMaterial(0xffe066, 0.92, true);

    const limbs = this.createHumanoidSkeleton(root);

    // Astral Vestments + High Archon Collar
    const upperRobe = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.21, 0.23, 0.48, 10)),
      robeMat,
    );
    upperRobe.position.y = 0.22;
    limbs.torso.add(upperRobe);

    const lowerSkirt = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.22, 0.34, 0.62, 12)),
      robeMat,
    );
    lowerSkirt.position.y = -0.28;
    limbs.pelvis.add(lowerSkirt);

    const collar = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.TorusGeometry(0.18, 0.032, 6, 14, Math.PI * 1.25)),
      goldMat,
    );
    collar.rotation.set(Math.PI * 0.38, 0, Math.PI * 0.88);
    collar.position.set(0, 0.46, -0.03);
    limbs.torso.add(collar);

    // Head + Levitating Storm Crown + Glowing Eyes
    const headMesh = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.SphereGeometry(0.135, 12, 10)),
      robeMat,
    );
    headMesh.position.y = 0.13;
    limbs.head.add(headMesh);

    const eyeGeo = this.resources.trackGeometry(new THREE.SphereGeometry(0.025, 8, 8));
    const eyeL = new THREE.Mesh(eyeGeo, stormGlowMat);
    eyeL.position.set(0.048, 0.14, 0.125);
    const eyeR = new THREE.Mesh(eyeGeo, stormGlowMat);
    eyeR.position.set(-0.048, 0.14, 0.125);
    limbs.head.add(eyeL, eyeR);

    const crownGroup = new THREE.Group();
    crownGroup.position.y = 0.31;
    limbs.head.add(crownGroup);
    const crownRing = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.TorusGeometry(0.15, 0.016, 6, 20)),
      goldMat,
    );
    crownRing.rotation.x = Math.PI / 2;
    crownGroup.add(crownRing);

    // Orbiting Storm & Rime Shoulder Shards
    const shardPivot = new THREE.Group();
    shardPivot.position.y = 0.42;
    limbs.torso.add(shardPivot);
    const shardGeo = this.resources.trackGeometry(new THREE.OctahedronGeometry(0.065, 0));
    const shardLightning = new THREE.Mesh(shardGeo, lightningGlowMat);
    shardLightning.position.set(0.42, 0.08, 0);
    const shardFrost = new THREE.Mesh(shardGeo, crystalMat);
    shardFrost.position.set(-0.42, 0.08, 0);
    shardPivot.add(shardLightning, shardFrost);

    // Levitating Grimoire at Left Hip
    const tomeGroup = new THREE.Group();
    tomeGroup.position.set(0.32, 0.08, 0.18);
    limbs.torso.add(tomeGroup);
    const tomeCover = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.18, 0.035, 0.22)),
      goldMat,
    );
    const tomePages = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.16, 0.045, 0.2)),
      stormGlowMat,
    );
    tomePages.position.y = 0.015;
    tomeGroup.add(tomeCover, tomePages);

    // Sleeves, Boots & Mantle
    const sleeveGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.068, 0.085, 0.26, 8));
    for (const [sh, el] of [
      [limbs.shoulderL, limbs.elbowL],
      [limbs.shoulderR, limbs.elbowR],
    ] as const) {
      const ua = new THREE.Mesh(sleeveGeo, robeMat);
      ua.position.y = -0.13;
      sh.add(ua);
      const fa = new THREE.Mesh(sleeveGeo, goldMat);
      fa.scale.set(0.82, 0.95, 0.82);
      fa.position.y = -0.12;
      el.add(fa);
    }

    const bootGeo = this.resources.trackGeometry(new THREE.CylinderGeometry(0.068, 0.058, 0.36, 8));
    for (const [, knee] of [
      [limbs.hipL, limbs.kneeL],
      [limbs.hipR, limbs.kneeR],
    ] as const) {
      const bt = new THREE.Mesh(bootGeo, robeMat);
      bt.position.y = -0.2;
      knee.add(bt);
    }

    const mantleTop = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.4, 0.44, 0.025)),
      robeMat,
    );
    mantleTop.position.y = -0.21;
    limbs.cape0.add(mantleTop);
    const mantleBot = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.BoxGeometry(0.44, 0.42, 0.022)),
      goldMat,
    );
    mantleBot.position.y = -0.2;
    limbs.cape1.add(mantleBot);

    // Right Hand: Tempest Spire Staff with Counter-Rotating Gyroscope Rings
    const staffGroup = new THREE.Group();
    staffGroup.position.set(0, -0.22, 0.06);
    limbs.elbowR.add(staffGroup);

    const shaft = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.CylinderGeometry(0.026, 0.022, 1.55, 8)),
      goldMat,
    );
    shaft.position.y = 0.22;
    staffGroup.add(shaft);

    const staffHead = new THREE.Group();
    staffHead.position.y = 1.05;
    staffGroup.add(staffHead);

    const gyroA = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.TorusGeometry(0.14, 0.016, 6, 18)),
      goldMat,
    );
    const gyroB = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.TorusGeometry(0.105, 0.013, 6, 16)),
      stormGlowMat,
    );
    const staffCore = new THREE.Mesh(
      this.resources.trackGeometry(new THREE.OctahedronGeometry(0.075, 0)),
      lightningGlowMat,
    );
    staffHead.add(gyroA, gyroB, staffCore);

    // Expanding Sanctuary Heal/Mana Pulse Ring on Ground
    const pulseRingGeo = this.resources.trackGeometry(new THREE.RingGeometry(0.4, 0.62, 28));
    pulseRingGeo.rotateX(-Math.PI / 2);
    const pulseRing = new THREE.Mesh(pulseRingGeo, stormGlowMat);
    pulseRing.position.y = 0.05;
    pulseRing.visible = false;
    pulseRing.castShadow = false;
    root.add(pulseRing);

    const stdMats = this.collectStandardMaterials(limbs.pelvis);
    const indicators = this.createGroundIndicators(root, 'storm_arcanist');

    return this.createRigController(
      'storm_arcanist',
      root,
      limbs,
      stdMats,
      indicators,
      (actionKind, progress01) => {
        if (actionKind === 'special') {
          // Raise Tempest Staff skyward & radiate heal/mana pulse ring!
          const lift = Math.sin(progress01 * Math.PI);
          limbs.shoulderR.rotation.set(-2.35 * lift - 0.4, 0, -0.15);
          limbs.elbowR.rotation.set(-0.2, 0, 0);
          limbs.shoulderL.rotation.set(-1.6 * lift - 0.3, 0.3, 0.25);
          pulseRing.visible = true;
          const ringScale = 1 + progress01 * 4.2;
          pulseRing.scale.setScalar(ringScale);
        } else {
          // Cast Storm / Frost Bolt forward!
          pulseRing.visible = false;
          const thrust = Math.sin(progress01 * Math.PI);
          limbs.torso.rotation.y = -0.25 * thrust;
          limbs.shoulderR.rotation.set(-1.35 * thrust - 0.35, 0, -0.1);
          limbs.elbowR.rotation.set(-0.25, 0, 0);
          limbs.shoulderL.rotation.set(-1.1 * thrust - 0.3, 0.2, 0.15);
        }
      },
      (peaceful, elapsedSec) => {
        pulseRing.visible = false;
        gyroA.rotation.y = elapsedSec * 2.8;
        gyroA.rotation.x = elapsedSec * 1.5;
        gyroB.rotation.z = -elapsedSec * 3.4;
        staffCore.rotation.y = -elapsedSec * 2.2;
        shardPivot.rotation.y = elapsedSec * 1.65;
        crownGroup.rotation.y = -elapsedSec * 1.2;
        tomeGroup.position.y = 0.08 + Math.sin(elapsedSec * 3.2) * 0.035;
        tomeGroup.rotation.z = Math.sin(elapsedSec * 2.1) * 0.12;

        if (peaceful) {
          limbs.shoulderR.rotation.set(-0.25, 0, -0.08);
          limbs.elbowR.rotation.set(-0.35, 0, 0);
          limbs.shoulderL.rotation.set(-0.2, 0.1, 0.1);
          limbs.elbowL.rotation.set(-0.35, 0, 0);
        } else {
          limbs.shoulderR.rotation.set(-0.55 + Math.sin(elapsedSec * 2.5) * 0.06, -0.1, -0.12);
          limbs.elbowR.rotation.set(-0.42, 0, 0);
          limbs.shoulderL.rotation.set(-0.62, 0.25, 0.15);
          limbs.elbowL.rotation.set(-0.48, 0, 0);
        }
      },
    );
  }

  // ============================================================================
  // Shared Humanoid Locomotion, Hit Flash & Downed/Revive State Machine
  // ============================================================================
  private createRigController(
    id: MercenaryId,
    root: THREE.Group,
    limbs: HumanoidLimbs,
    stdMats: EmissiveBackup[],
    indicators: { poiseDisc: THREE.Mesh; reviveRing: THREE.Mesh },
    applyActionPose: (kind: 'attack' | 'special', progress01: number) => void,
    applyIdleUpperPose: (peaceful: boolean, elapsedSec: number) => void,
  ): MercenaryRigHandle {
    let runPhase = 0;
    let actionKind: 'attack' | 'special' | null = null;
    let actionElapsed = 0;
    let actionDuration = 0.42;
    let hitFlashRemaining = 0;
    const hitFlashColor = new THREE.Color(0xff3b3b);

    return {
      id,
      root,
      flashHit: (colorHex = 0xff3b3b) => {
        hitFlashColor.setHex(colorHex);
        hitFlashRemaining = 0.16;
        for (let i = 0; i < stdMats.length; i++) {
          stdMats[i].mat.emissive.copy(hitFlashColor);
          stdMats[i].mat.emissiveIntensity = 1.15;
        }
      },
      triggerActionAnim: (kind, durationSec = 0.42) => {
        actionKind = kind;
        actionElapsed = 0;
        actionDuration = Math.max(0.15, durationSec);
      },
      updateAnimation: (dt, elapsedSec, mode, moveSpeedNorm, reviveProgress01) => {
        // Decay hit-flash back to authored material emissives
        if (hitFlashRemaining > 0) {
          hitFlashRemaining = Math.max(0, hitFlashRemaining - dt);
          if (hitFlashRemaining <= 0) {
            for (let i = 0; i < stdMats.length; i++) {
              stdMats[i].mat.emissive.setHex(stdMats[i].baseHex);
              stdMats[i].mat.emissiveIntensity = stdMats[i].baseIntensity;
            }
          }
        }

        indicators.poiseDisc.rotation.z = elapsedSec * 0.65;

        if (mode === 'downed') {
          actionKind = null;
          limbs.pelvis.position.y = 0.46;
          limbs.torso.rotation.set(0.58, 0, 0);
          limbs.head.rotation.set(0.35, 0, 0);
          limbs.hipL.rotation.x = -1.05;
          limbs.kneeL.rotation.x = 1.45;
          limbs.hipR.rotation.x = 0.35;
          limbs.kneeR.rotation.x = 1.25;
          limbs.shoulderL.rotation.set(0.25, 0, 0.25);
          limbs.shoulderR.rotation.set(0.25, 0, -0.25);

          indicators.reviveRing.visible = true;
          indicators.reviveRing.rotation.z = -elapsedSec * 2.2;
          const pulse = 0.72 + reviveProgress01 * 0.55 + Math.sin(elapsedSec * 6) * 0.05;
          indicators.reviveRing.scale.setScalar(pulse);
          return;
        }

        indicators.reviveRing.visible = false;
        limbs.head.rotation.set(0, Math.sin(elapsedSec * 1.4) * 0.08, 0);
        limbs.torso.rotation.set(0, 0, 0);

        // Lower-body locomotion
        const speed = clamp(moveSpeedNorm, 0, 1);
        if (speed > 0.08 && mode !== 'peaceful_idle') {
          runPhase += dt * (6.5 + speed * 7.5);
          const stride = Math.sin(runPhase) * 0.62 * speed;
          limbs.pelvis.position.y = 0.86 + Math.abs(Math.cos(runPhase)) * 0.045 * speed;
          limbs.hipL.rotation.x = stride;
          limbs.hipR.rotation.x = -stride;
          limbs.kneeL.rotation.x = Math.max(0, -stride * 0.75);
          limbs.kneeR.rotation.x = Math.max(0, stride * 0.75);
        } else {
          limbs.pelvis.position.y = 0.86 + Math.sin(elapsedSec * 2.2) * 0.018;
          limbs.hipL.rotation.x = 0;
          limbs.hipR.rotation.x = 0;
          limbs.kneeL.rotation.x = 0;
          limbs.kneeR.rotation.x = 0;
        }

        // Upper-body idle/run + active combat swing/cast override
        applyIdleUpperPose(mode === 'peaceful_idle', elapsedSec);

        if (actionKind) {
          actionElapsed += dt;
          const progress01 = clamp(actionElapsed / actionDuration, 0, 1);
          applyActionPose(actionKind, progress01);
          if (actionElapsed >= actionDuration) {
            actionKind = null;
          }
        } else if (speed > 0.12 && mode === 'run') {
          const armSwing = Math.sin(runPhase + Math.PI) * 0.35 * speed;
          limbs.shoulderL.rotation.x += armSwing;
          limbs.shoulderR.rotation.x -= armSwing;
        }

        // Flowing cape wave
        const capeWave = 0.14 + speed * 0.42;
        limbs.cape0.rotation.x = capeWave + Math.sin(elapsedSec * 4.2) * 0.07;
        limbs.cape1.rotation.x = 0.12 + Math.sin(elapsedSec * 4.2 - 0.9) * (0.09 + speed * 0.14);
      },
    };
  }
}
