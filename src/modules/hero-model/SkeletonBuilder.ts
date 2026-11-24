import * as THREE from 'three';
import type { HeroClassId } from '../../contracts/types';
import type { ClassPalette } from './HeroMaterials';

export const PELVIS_REST_Y = 0.94;
export const CAPE_SEGMENT_LENGTHS = [0.28, 0.3, 0.3, 0.28] as const;

export interface HeroSkeletonNodes {
  root: THREE.Group;
  groundRingMat: THREE.MeshBasicMaterial;
  pelvis: THREE.Group;
  rollPivot: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  capeMount: THREE.Group;
  capeSegments: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];

  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
  rightHand: THREE.Group;
  mainWeaponSocket: THREE.Group;

  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  leftHand: THREE.Group;
  offWeaponSocket: THREE.Group;
  shieldSocket: THREE.Group;

  rightHip: THREE.Group;
  rightKnee: THREE.Group;
  rightBoot: THREE.Group;

  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  leftBoot: THREE.Group;

  // Swappable armor attachment containers
  pelvisArmor: THREE.Group;
  torsoArmor: THREE.Group;
  helmArmor: THREE.Group;
  capeArmorSegments: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  rightPauldronArmor: THREE.Group;
  leftPauldronArmor: THREE.Group;
  rightUpperArmArmor: THREE.Group;
  leftUpperArmArmor: THREE.Group;
  rightForearmArmor: THREE.Group;
  leftForearmArmor: THREE.Group;
  rightHandArmor: THREE.Group;
  leftHandArmor: THREE.Group;
  rightThighArmor: THREE.Group;
  leftThighArmor: THREE.Group;
  rightShinArmor: THREE.Group;
  leftShinArmor: THREE.Group;
  rightBootArmor: THREE.Group;
  leftBootArmor: THREE.Group;

  // Optional animated class ornaments (e.g. Arcanist floating circlet)
  floatingHelmOrnament: THREE.Group | null;
}

export class SkeletonBuilder {
  private readonly armorGeometries: THREE.BufferGeometry[] = [];
  private readonly staticGeometries: THREE.BufferGeometry[] = [];

  createSkeletonHierarchy(): HeroSkeletonNodes {
    const root = new THREE.Group();
    root.name = 'HeroRigRoot';

    // Subtle ground poise ring so hero footing reads crisply on dark floors
    const ringGeo = new THREE.RingGeometry(0.36, 0.44, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.staticGeometries.push(ringGeo);

    const groundRingMat = new THREE.MeshBasicMaterial({
      color: 0xc92a2a,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const groundRing = new THREE.Mesh(ringGeo, groundRingMat);
    groundRing.position.y = 0.014;
    groundRing.name = 'HeroGroundPoiseRing';
    root.add(groundRing);

    // Pelvis & center-of-mass roll pivot
    const pelvis = new THREE.Group();
    pelvis.name = 'PelvisPivot';
    pelvis.position.set(0, PELVIS_REST_Y, 0);
    root.add(pelvis);

    const rollPivot = new THREE.Group();
    rollPivot.name = 'RollPivot';
    pelvis.add(rollPivot);

    const pelvisArmor = new THREE.Group();
    pelvisArmor.name = 'PelvisArmor';
    rollPivot.add(pelvisArmor);

    // Torso & Spine
    const torso = new THREE.Group();
    torso.name = 'TorsoPivot';
    torso.position.set(0, 0.12, 0);
    rollPivot.add(torso);

    const torsoArmor = new THREE.Group();
    torsoArmor.name = 'TorsoArmor';
    torso.add(torsoArmor);

    // Head / Helm
    const head = new THREE.Group();
    head.name = 'HeadPivot';
    head.position.set(0, 0.44, 0);
    torso.add(head);

    const helmArmor = new THREE.Group();
    helmArmor.name = 'HelmArmor';
    head.add(helmArmor);

    // Flowing 4-segment articulated cape mounted on upper back (-Z)
    const capeMount = new THREE.Group();
    capeMount.name = 'CapeMount';
    capeMount.position.set(0, 0.38, -0.15);
    torso.add(capeMount);

    const seg0 = new THREE.Group();
    seg0.name = 'CapeSeg0';
    capeMount.add(seg0);

    const seg1 = new THREE.Group();
    seg1.name = 'CapeSeg1';
    seg1.position.set(0, -CAPE_SEGMENT_LENGTHS[0], 0);
    seg0.add(seg1);

    const seg2 = new THREE.Group();
    seg2.name = 'CapeSeg2';
    seg2.position.set(0, -CAPE_SEGMENT_LENGTHS[1], 0);
    seg1.add(seg2);

    const seg3 = new THREE.Group();
    seg3.name = 'CapeSeg3';
    seg3.position.set(0, -CAPE_SEGMENT_LENGTHS[2], 0);
    seg2.add(seg3);

    const capeSegments: [THREE.Group, THREE.Group, THREE.Group, THREE.Group] = [
      seg0,
      seg1,
      seg2,
      seg3,
    ];
    const capeArmorSegments: [THREE.Group, THREE.Group, THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (let i = 0; i < 4; i++) {
      capeSegments[i].add(capeArmorSegments[i]);
    }

    // Right Arm (-X anatomical right / main hand when facing +Z)
    const rightShoulder = new THREE.Group();
    rightShoulder.name = 'RightShoulderPivot';
    rightShoulder.position.set(-0.28, 0.34, 0);
    torso.add(rightShoulder);

    const rightPauldronArmor = new THREE.Group();
    rightShoulder.add(rightPauldronArmor);
    const rightUpperArmArmor = new THREE.Group();
    rightShoulder.add(rightUpperArmArmor);

    const rightElbow = new THREE.Group();
    rightElbow.name = 'RightElbowPivot';
    rightElbow.position.set(0, -0.26, 0);
    rightShoulder.add(rightElbow);

    const rightForearmArmor = new THREE.Group();
    rightElbow.add(rightForearmArmor);

    const rightHand = new THREE.Group();
    rightHand.name = 'RightHandPivot';
    rightHand.position.set(0, -0.24, 0);
    rightElbow.add(rightHand);

    const rightHandArmor = new THREE.Group();
    rightHand.add(rightHandArmor);

    // Main weapon socket: weapon local +Y extends along blade/shaft, tilted forward (+Z) when gripped
    const mainWeaponSocket = new THREE.Group();
    mainWeaponSocket.name = 'MainWeaponSocket';
    mainWeaponSocket.position.set(0, -0.04, 0.03);
    mainWeaponSocket.rotation.x = Math.PI * 0.42; // Tilts +Y weapon blade toward +Z forward
    rightHand.add(mainWeaponSocket);

    // Left Arm (+X anatomical left / off hand when facing +Z)
    const leftShoulder = new THREE.Group();
    leftShoulder.name = 'LeftShoulderPivot';
    leftShoulder.position.set(0.28, 0.34, 0);
    torso.add(leftShoulder);

    const leftPauldronArmor = new THREE.Group();
    leftShoulder.add(leftPauldronArmor);
    const leftUpperArmArmor = new THREE.Group();
    leftShoulder.add(leftUpperArmArmor);

    const leftElbow = new THREE.Group();
    leftElbow.name = 'LeftElbowPivot';
    leftElbow.position.set(0, -0.26, 0);
    leftShoulder.add(leftElbow);

    const leftForearmArmor = new THREE.Group();
    leftElbow.add(leftForearmArmor);

    const leftHand = new THREE.Group();
    leftHand.name = 'LeftHandPivot';
    leftHand.position.set(0, -0.24, 0);
    leftElbow.add(leftHand);

    const leftHandArmor = new THREE.Group();
    leftHand.add(leftHandArmor);

    const offWeaponSocket = new THREE.Group();
    offWeaponSocket.name = 'OffWeaponSocket';
    offWeaponSocket.position.set(0, -0.04, 0.03);
    offWeaponSocket.rotation.x = Math.PI * 0.42;
    leftHand.add(offWeaponSocket);

    const shieldSocket = new THREE.Group();
    shieldSocket.name = 'ShieldSocket';
    shieldSocket.position.set(0.08, 0.08, 0.06);
    leftHand.add(shieldSocket);

    // Right Leg (-X)
    const rightHip = new THREE.Group();
    rightHip.name = 'RightHipPivot';
    rightHip.position.set(-0.14, -0.06, 0);
    rollPivot.add(rightHip);

    const rightThighArmor = new THREE.Group();
    rightHip.add(rightThighArmor);

    const rightKnee = new THREE.Group();
    rightKnee.name = 'RightKneePivot';
    rightKnee.position.set(0, -0.39, 0);
    rightHip.add(rightKnee);

    const rightShinArmor = new THREE.Group();
    rightKnee.add(rightShinArmor);

    const rightBoot = new THREE.Group();
    rightBoot.name = 'RightBootPivot';
    rightBoot.position.set(0, -0.39, 0);
    rightKnee.add(rightBoot);

    const rightBootArmor = new THREE.Group();
    rightBoot.add(rightBootArmor);

    // Left Leg (+X)
    const leftHip = new THREE.Group();
    leftHip.name = 'LeftHipPivot';
    leftHip.position.set(0.14, -0.06, 0);
    rollPivot.add(leftHip);

    const leftThighArmor = new THREE.Group();
    leftHip.add(leftThighArmor);

    const leftKnee = new THREE.Group();
    leftKnee.name = 'LeftKneePivot';
    leftKnee.position.set(0, -0.39, 0);
    leftHip.add(leftKnee);

    const leftShinArmor = new THREE.Group();
    leftKnee.add(leftShinArmor);

    const leftBoot = new THREE.Group();
    leftBoot.name = 'LeftBootPivot';
    leftBoot.position.set(0, -0.39, 0);
    leftKnee.add(leftBoot);

    const leftBootArmor = new THREE.Group();
    leftBoot.add(leftBootArmor);

    return {
      root,
      groundRingMat,
      pelvis,
      rollPivot,
      torso,
      head,
      capeMount,
      capeSegments,
      rightShoulder,
      rightElbow,
      rightHand,
      mainWeaponSocket,
      leftShoulder,
      leftElbow,
      leftHand,
      offWeaponSocket,
      shieldSocket,
      rightHip,
      rightKnee,
      rightBoot,
      leftHip,
      leftKnee,
      leftBoot,
      pelvisArmor,
      torsoArmor,
      helmArmor,
      capeArmorSegments,
      rightPauldronArmor,
      leftPauldronArmor,
      rightUpperArmArmor,
      leftUpperArmArmor,
      rightForearmArmor,
      leftForearmArmor,
      rightHandArmor,
      leftHandArmor,
      rightThighArmor,
      leftThighArmor,
      rightShinArmor,
      leftShinArmor,
      rightBootArmor,
      leftBootArmor,
      floatingHelmOrnament: null,
    };
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.armorGeometries.push(geo);
    return geo;
  }

  private addMesh(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos?: [number, number, number],
    rot?: [number, number, number],
    scale?: [number, number, number],
  ): THREE.Mesh {
    this.trackGeo(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    parent.add(mesh);
    return mesh;
  }

  clearArmorGeometry(nodes: HeroSkeletonNodes): void {
    const groups: THREE.Group[] = [
      nodes.pelvisArmor,
      nodes.torsoArmor,
      nodes.helmArmor,
      ...nodes.capeArmorSegments,
      nodes.rightPauldronArmor,
      nodes.leftPauldronArmor,
      nodes.rightUpperArmArmor,
      nodes.leftUpperArmArmor,
      nodes.rightForearmArmor,
      nodes.leftForearmArmor,
      nodes.rightHandArmor,
      nodes.leftHandArmor,
      nodes.rightThighArmor,
      nodes.leftThighArmor,
      nodes.rightShinArmor,
      nodes.leftShinArmor,
      nodes.rightBootArmor,
      nodes.leftBootArmor,
    ];
    for (const g of groups) {
      g.clear();
    }
    nodes.floatingHelmOrnament = null;

    for (const geo of this.armorGeometries) {
      geo.dispose();
    }
    this.armorGeometries.length = 0;
  }

  populateClassArmor(
    heroClass: HeroClassId,
    nodes: HeroSkeletonNodes,
    palette: ClassPalette,
  ): void {
    this.clearArmorGeometry(nodes);
    nodes.groundRingMat.color.setHex(palette.groundAuraColorHex);

    // Base limbs & joints shared structural core (scaled per class silhouette)
    const isHeavy = heroClass === 'vanguard';
    const isAgile = heroClass === 'shadowblade';

    // 1. Pelvis / Waist / Belt
    this.buildPelvisAndLegs(heroClass, nodes, palette, isHeavy, isAgile);

    // 2. Torso / Chest / Collar
    this.buildTorso(heroClass, nodes, palette);

    // 3. Arms / Pauldrons / Gauntlets
    this.buildArms(heroClass, nodes, palette, isHeavy, isAgile);

    // 4. Head / Helm / Visor / Crown
    this.buildHeadAndHelm(heroClass, nodes, palette);

    // 5. Flowing 4-segment Articulated Cape
    this.buildArticulatedCape(heroClass, nodes, palette);
  }

  private buildPelvisAndLegs(
    heroClass: HeroClassId,
    nodes: HeroSkeletonNodes,
    p: ClassPalette,
    isHeavy: boolean,
    isAgile: boolean,
  ): void {
    // Pelvis block + war belt + ornate central buckle
    const pelvisWidth = isHeavy ? 0.36 : isAgile ? 0.3 : 0.32;
    this.addMesh(
      nodes.pelvisArmor,
      new THREE.CylinderGeometry(pelvisWidth * 0.52, pelvisWidth * 0.46, 0.2, 8),
      p.darkUnderlayer,
      [0, 0.02, 0],
    );
    this.addMesh(
      nodes.pelvisArmor,
      new THREE.BoxGeometry(pelvisWidth + 0.04, 0.09, 0.26),
      p.secondaryArmor,
      [0, 0.07, 0],
    );
    // Belt buckle + glowing core gem
    this.addMesh(
      nodes.pelvisArmor,
      new THREE.OctahedronGeometry(0.065, 0),
      p.trimGold,
      [0, 0.07, 0.14],
      [0, 0, Math.PI / 4],
      [1.1, 1.1, 0.45],
    );
    this.addMesh(
      nodes.pelvisArmor,
      new THREE.OctahedronGeometry(0.036, 0),
      p.visorGlow,
      [0, 0.07, 0.158],
      [0, 0, Math.PI / 4],
      [1, 1, 0.45],
    );

    if (heroClass === 'vanguard') {
      // Armored fauld & center crimson tabard sash
      this.addMesh(
        nodes.pelvisArmor,
        new THREE.BoxGeometry(0.14, 0.32, 0.025),
        p.capeMain,
        [0, -0.14, 0.135],
      );
      this.addMesh(
        nodes.pelvisArmor,
        new THREE.BoxGeometry(0.16, 0.035, 0.03),
        p.trimGold,
        [0, -0.29, 0.135],
      );
    } else if (heroClass === 'shadowblade') {
      // Assassin utility pouches & angled throwing knife sheaths on belt
      for (const side of [-1, 1]) {
        this.addMesh(
          nodes.pelvisArmor,
          new THREE.BoxGeometry(0.07, 0.1, 0.08),
          p.primaryArmor,
          [side * 0.17, 0.05, 0.08],
          [0, side * 0.25, 0],
        );
        this.addMesh(
          nodes.pelvisArmor,
          new THREE.CylinderGeometry(0.016, 0.008, 0.16, 6),
          p.trimGold,
          [side * 0.18, 0.06, -0.08],
          [0.4, 0, side * 0.5],
        );
      }
    } else {
      // Arcanist ornate front & back rune-trimmed robe sash + hip scroll/tome
      this.addMesh(
        nodes.pelvisArmor,
        new THREE.BoxGeometry(0.18, 0.44, 0.025),
        p.secondaryArmor,
        [0, -0.19, 0.14],
      );
      this.addMesh(
        nodes.pelvisArmor,
        new THREE.BoxGeometry(0.04, 0.38, 0.032),
        p.visorGlow,
        [0, -0.18, 0.142],
      );
      // Spell tome hung at right hip
      this.addMesh(
        nodes.pelvisArmor,
        new THREE.BoxGeometry(0.05, 0.16, 0.13),
        p.trimGold,
        [-0.2, -0.04, 0.04],
        [0.15, 0, -0.22],
      );
    }

    // Build Left (-1/+1) Thighs, Knees/Shins, and Boots
    const thighRadius = isHeavy ? 0.105 : isAgile ? 0.085 : 0.09;
    const shinRadius = isHeavy ? 0.092 : isAgile ? 0.072 : 0.078;

    const legConfigs: Array<{
      side: number;
      thigh: THREE.Group;
      shin: THREE.Group;
      boot: THREE.Group;
    }> = [
      {
        side: -1,
        thigh: nodes.rightThighArmor,
        shin: nodes.rightShinArmor,
        boot: nodes.rightBootArmor,
      },
      {
        side: 1,
        thigh: nodes.leftThighArmor,
        shin: nodes.leftShinArmor,
        boot: nodes.leftBootArmor,
      },
    ];

    for (const { side, thigh, shin, boot } of legConfigs) {
      // Thigh core
      this.addMesh(
        thigh,
        new THREE.CylinderGeometry(thighRadius, thighRadius * 0.85, 0.38, 8),
        p.darkUnderlayer,
        [0, -0.19, 0],
      );

      if (heroClass === 'vanguard') {
        // Heavy plate tasset + sculpted cuisse thigh armor
        this.addMesh(
          thigh,
          new THREE.BoxGeometry(0.15, 0.24, 0.18),
          p.primaryArmor,
          [side * 0.04, -0.13, 0.01],
          [0, 0, side * -0.12],
        );
        this.addMesh(
          thigh,
          new THREE.BoxGeometry(0.16, 0.035, 0.19),
          p.trimGold,
          [side * 0.04, -0.24, 0.01],
          [0, 0, side * -0.12],
        );
      } else if (heroClass === 'shadowblade') {
        // Quilted leather thigh guard + straps
        this.addMesh(
          thigh,
          new THREE.CylinderGeometry(thighRadius + 0.01, thighRadius * 0.9, 0.26, 8),
          p.primaryArmor,
          [0, -0.16, 0],
        );
        this.addMesh(
          thigh,
          new THREE.TorusGeometry(thighRadius + 0.012, 0.012, 6, 12),
          p.trimGold,
          [0, -0.18, 0],
          [Math.PI / 2, 0, 0],
        );
      } else {
        // Arcanist layered robe side-skirts flowing along the thighs
        this.addMesh(
          thigh,
          new THREE.CylinderGeometry(0.105, 0.145, 0.42, 8),
          p.primaryArmor,
          [side * 0.03, -0.2, 0],
          [0, 0, side * -0.08],
        );
        this.addMesh(
          thigh,
          new THREE.TorusGeometry(0.142, 0.013, 6, 12),
          p.trimGold,
          [side * 0.045, -0.39, 0],
          [Math.PI / 2, 0, side * -0.08],
        );
      }

      // Knee poleyn + Shin greave
      this.addMesh(
        shin,
        new THREE.OctahedronGeometry(isHeavy ? 0.088 : 0.068, 0),
        isHeavy ? p.trimGold : p.secondaryArmor,
        [0, 0, 0.075],
        [0.2, 0, 0],
        [1, 1.15, 0.7],
      );
      this.addMesh(
        shin,
        new THREE.CylinderGeometry(shinRadius, shinRadius * 0.82, 0.37, 8),
        heroClass === 'arcanist' ? p.secondaryArmor : p.primaryArmor,
        [0, -0.19, 0],
      );
      if (isHeavy) {
        // Front steel shin ridge
        this.addMesh(
          shin,
          new THREE.BoxGeometry(0.06, 0.3, 0.08),
          p.trimGold,
          [0, -0.19, 0.065],
        );
      }

      // Boot (ankle at y=0, sole rests right on y = -0.10)
      const bootMat = isHeavy ? p.primaryArmor : p.secondaryArmor;
      this.addMesh(
        boot,
        new THREE.BoxGeometry(isHeavy ? 0.15 : 0.125, 0.1, 0.24),
        bootMat,
        [0, -0.05, 0.045],
      );
      // Boot cuff & armored toe cap
      this.addMesh(
        boot,
        new THREE.CylinderGeometry(shinRadius * 1.06, shinRadius * 0.96, 0.08, 8),
        p.trimGold,
        [0, 0.01, 0],
      );
      this.addMesh(
        boot,
        new THREE.BoxGeometry(isHeavy ? 0.156 : 0.13, 0.03, 0.25),
        p.darkUnderlayer,
        [0, -0.085, 0.045],
      );
    }
  }

  private buildTorso(heroClass: HeroClassId, nodes: HeroSkeletonNodes, p: ClassPalette): void {
    if (heroClass === 'vanguard') {
      // Broad heroic gothic steel cuirass + abdominal plackart + shattered crown gold chest crest
      this.addMesh(
        nodes.torsoArmor,
        new THREE.CylinderGeometry(0.24, 0.19, 0.42, 8),
        p.secondaryArmor,
        [0, 0.21, 0],
        [0, Math.PI / 8, 0],
        [1.18, 1, 0.85],
      );
      this.addMesh(
        nodes.torsoArmor,
        new THREE.BoxGeometry(0.46, 0.28, 0.28),
        p.primaryArmor,
        [0, 0.27, 0.015],
      );
      // V-shaped golden chest trim & glowing core rune
      this.addMesh(
        nodes.torsoArmor,
        new THREE.BoxGeometry(0.06, 0.24, 0.04),
        p.trimGold,
        [-0.08, 0.27, 0.15],
        [0, 0, -0.35],
      );
      this.addMesh(
        nodes.torsoArmor,
        new THREE.BoxGeometry(0.06, 0.24, 0.04),
        p.trimGold,
        [0.08, 0.27, 0.15],
        [0, 0, 0.35],
      );
      this.addMesh(
        nodes.torsoArmor,
        new THREE.OctahedronGeometry(0.052, 0),
        p.visorGlow,
        [0, 0.3, 0.165],
        [0, 0, 0],
        [0.9, 1.25, 0.5],
      );
      // Gorget neck guard
      this.addMesh(
        nodes.torsoArmor,
        new THREE.CylinderGeometry(0.15, 0.19, 0.09, 10),
        p.primaryArmor,
        [0, 0.42, 0],
      );
    } else if (heroClass === 'shadowblade') {
      // Lithe V-tapered obsidian leather brigandine + cross-chest bandolier + emerald heart sigil
      this.addMesh(
        nodes.torsoArmor,
        new THREE.CylinderGeometry(0.21, 0.155, 0.42, 8),
        p.primaryArmor,
        [0, 0.21, 0],
        [0, Math.PI / 8, 0],
        [1.12, 1, 0.8],
      );
      // Crossed stealth bandolier straps
      this.addMesh(
        nodes.torsoArmor,
        new THREE.BoxGeometry(0.065, 0.42, 0.23),
        p.secondaryArmor,
        [0, 0.23, 0.01],
        [0, 0, 0.52],
      );
      this.addMesh(
        nodes.torsoArmor,
        new THREE.BoxGeometry(0.05, 0.4, 0.225),
        p.trimGold,
        [0, 0.23, 0.012],
        [0, 0, -0.52],
      );
      // Glowing emerald shadow-core clasp
      this.addMesh(
        nodes.torsoArmor,
        new THREE.OctahedronGeometry(0.045, 0),
        p.visorGlow,
        [0, 0.27, 0.13],
        [0, 0, Math.PI / 4],
        [0.9, 1.2, 0.5],
      );
      // High stealth cowl scarf around neck
      this.addMesh(
        nodes.torsoArmor,
        new THREE.CylinderGeometry(0.155, 0.175, 0.11, 10),
        p.capeMain,
        [0, 0.41, 0],
      );
    } else {
      // Arcanist ornate astral vestments + gilded high flared collar + glowing astral nexus crystal
      this.addMesh(
        nodes.torsoArmor,
        new THREE.CylinderGeometry(0.215, 0.17, 0.42, 10),
        p.primaryArmor,
        [0, 0.21, 0],
        [0, 0, 0],
        [1.1, 1, 0.84],
      );
      // Ornate gilded stole/mantle across upper chest
      this.addMesh(
        nodes.torsoArmor,
        new THREE.CylinderGeometry(0.25, 0.22, 0.16, 10),
        p.secondaryArmor,
        [0, 0.33, 0],
        [0, 0, 0],
        [1.12, 1, 0.86],
      );
      this.addMesh(
        nodes.torsoArmor,
        new THREE.TorusGeometry(0.18, 0.022, 6, 16),
        p.trimGold,
        [0, 0.28, 0.01],
        [Math.PI / 2 + 0.18, 0, 0],
        [1.2, 0.9, 1],
      );
      // Glowing astral amulet focus on chest
      this.addMesh(
        nodes.torsoArmor,
        new THREE.OctahedronGeometry(0.06, 0),
        p.visorGlow,
        [0, 0.29, 0.155],
        [0, 0, 0],
        [0.85, 1.3, 0.6],
      );
      // High flared archmage arcane collar behind head
      this.addMesh(
        nodes.torsoArmor,
        new THREE.CylinderGeometry(0.22, 0.14, 0.18, 10, 1, true, Math.PI * 0.65, Math.PI * 1.7),
        p.trimGold,
        [0, 0.46, -0.02],
      );
    }
  }

  private buildArms(
    heroClass: HeroClassId,
    nodes: HeroSkeletonNodes,
    p: ClassPalette,
    isHeavy: boolean,
    isAgile: boolean,
  ): void {
    const upperRadius = isHeavy ? 0.082 : isAgile ? 0.066 : 0.072;
    const foreRadius = isHeavy ? 0.078 : isAgile ? 0.062 : 0.075;

    const armConfigs = [
      {
        side: -1,
        pauldron: nodes.rightPauldronArmor,
        upper: nodes.rightUpperArmArmor,
        fore: nodes.rightForearmArmor,
        hand: nodes.rightHandArmor,
      },
      {
        side: 1,
        pauldron: nodes.leftPauldronArmor,
        upper: nodes.leftUpperArmArmor,
        fore: nodes.leftForearmArmor,
        hand: nodes.leftHandArmor,
      },
    ];

    for (const { side, pauldron, upper, fore, hand } of armConfigs) {
      if (heroClass === 'vanguard') {
        // Massive layered gothic steel pauldrons with gold rim & upward horn ridge
        this.addMesh(
          pauldron,
          new THREE.SphereGeometry(0.155, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
          p.primaryArmor,
          [side * 0.04, 0.02, 0],
          [0, 0, side * -0.38],
          [1.15, 1.0, 1.1],
        );
        this.addMesh(
          pauldron,
          new THREE.TorusGeometry(0.145, 0.018, 6, 14),
          p.trimGold,
          [side * 0.04, -0.02, 0],
          [Math.PI / 2, side * 0.38, 0],
        );
        this.addMesh(
          pauldron,
          new THREE.ConeGeometry(0.038, 0.14, 6),
          p.trimGold,
          [side * 0.11, 0.11, 0],
          [0, 0, side * -0.55],
        );
      } else if (heroClass === 'shadowblade') {
        // Sleek angled assassin razor-fins on shoulders
        this.addMesh(
          pauldron,
          new THREE.BoxGeometry(0.17, 0.07, 0.19),
          p.secondaryArmor,
          [side * 0.03, 0.03, 0],
          [0, 0, side * -0.32],
        );
        this.addMesh(
          pauldron,
          new THREE.ConeGeometry(0.045, 0.16, 4),
          p.trimGold,
          [side * 0.1, 0.07, -0.02],
          [-0.25, 0, side * -0.78],
        );
      } else {
        // Arcanist gilded crescent epaulets with glowing levitating rune shard
        this.addMesh(
          pauldron,
          new THREE.BoxGeometry(0.18, 0.055, 0.2),
          p.trimGold,
          [side * 0.04, 0.04, 0],
          [0, 0, side * -0.2],
        );
        this.addMesh(
          pauldron,
          new THREE.OctahedronGeometry(0.042, 0),
          p.visorGlow,
          [side * 0.1, 0.12, 0],
          [0, 0, side * -0.2],
          [0.75, 1.35, 0.75],
        );
      }

      // Upper arm
      this.addMesh(
        upper,
        new THREE.CylinderGeometry(upperRadius, upperRadius * 0.88, 0.25, 8),
        heroClass === 'arcanist' ? p.primaryArmor : p.darkUnderlayer,
        [0, -0.13, 0],
      );

      // Forearm vambrace / bracer / flared mage sleeve
      const sleeveBottom = heroClass === 'arcanist' ? foreRadius * 1.32 : foreRadius * 0.88;
      this.addMesh(
        fore,
        new THREE.CylinderGeometry(foreRadius, sleeveBottom, 0.23, 8),
        heroClass === 'arcanist' ? p.secondaryArmor : p.primaryArmor,
        [0, -0.12, 0],
      );
      this.addMesh(
        fore,
        new THREE.TorusGeometry(sleeveBottom * 1.02, 0.013, 6, 12),
        p.trimGold,
        [0, -0.21, 0],
        [Math.PI / 2, 0, 0],
      );

      if (heroClass === 'shadowblade') {
        // Assassin forearm wrist-blade fin
        this.addMesh(
          fore,
          new THREE.BoxGeometry(0.02, 0.18, 0.055),
          p.trimGold,
          [side * 0.065, -0.11, -0.02],
        );
      }

      // Gauntlet / Hand
      this.addMesh(
        hand,
        new THREE.BoxGeometry(0.095, 0.1, 0.105),
        heroClass === 'arcanist' ? p.skinOrMask : p.secondaryArmor,
        [0, -0.04, 0.01],
      );
    }
  }

  private buildHeadAndHelm(
    heroClass: HeroClassId,
    nodes: HeroSkeletonNodes,
    p: ClassPalette,
  ): void {
    if (heroClass === 'vanguard') {
      // Iconic Horned Gothic Greathelm + glowing crimson T-visor + sweeping warlord horns
      this.addMesh(
        nodes.helmArmor,
        new THREE.CylinderGeometry(0.135, 0.145, 0.26, 10),
        p.primaryArmor,
        [0, 0.14, 0],
      );
      this.addMesh(
        nodes.helmArmor,
        new THREE.SphereGeometry(0.138, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
        p.primaryArmor,
        [0, 0.26, 0],
      );
      // Central golden helm crest ridge
      this.addMesh(
        nodes.helmArmor,
        new THREE.BoxGeometry(0.036, 0.22, 0.29),
        p.trimGold,
        [0, 0.24, 0.01],
      );
      // Faceplate guard cheeks
      this.addMesh(
        nodes.helmArmor,
        new THREE.BoxGeometry(0.22, 0.15, 0.08),
        p.secondaryArmor,
        [0, 0.1, 0.11],
      );
      // Fierce glowing T-visor slit
      this.addMesh(
        nodes.helmArmor,
        new THREE.BoxGeometry(0.18, 0.036, 0.04),
        p.visorGlow,
        [0, 0.165, 0.138],
      );
      this.addMesh(
        nodes.helmArmor,
        new THREE.BoxGeometry(0.032, 0.11, 0.04),
        p.visorGlow,
        [0, 0.12, 0.14],
      );
      // Sweeping segmented curved horns on both sides
      for (const side of [-1, 1]) {
        const hornBase = new THREE.Group();
        hornBase.position.set(side * 0.13, 0.22, -0.01);
        hornBase.rotation.set(0.22, 0, side * -0.68);
        nodes.helmArmor.add(hornBase);

        this.addMesh(
          hornBase,
          new THREE.CylinderGeometry(0.032, 0.048, 0.16, 7),
          p.secondaryArmor,
          [0, 0.08, 0],
        );
        this.addMesh(
          hornBase,
          new THREE.ConeGeometry(0.032, 0.22, 7),
          p.trimGold,
          [side * -0.035, 0.24, 0.04],
          [0.35, 0, side * 0.42],
        );
      }
    } else if (heroClass === 'shadowblade') {
      // Deep pointed Assassin Hood / Cowl + shadowed mask + twin razor emerald visor slits
      this.addMesh(
        nodes.helmArmor,
        new THREE.SphereGeometry(0.125, 10, 10),
        p.skinOrMask,
        [0, 0.15, 0.01],
      );
      // Outer cowl hood shell + hawk-beak brow peak in front (+Z) + trailing hood point (-Z)
      this.addMesh(
        nodes.helmArmor,
        new THREE.CylinderGeometry(0.145, 0.175, 0.26, 10),
        p.capeMain,
        [0, 0.15, -0.01],
      );
      this.addMesh(
        nodes.helmArmor,
        new THREE.ConeGeometry(0.155, 0.22, 8),
        p.capeMain,
        [0, 0.31, -0.04],
        [-0.35, 0, 0],
      );
      // Hood front brow peak overhanging visor
      this.addMesh(
        nodes.helmArmor,
        new THREE.ConeGeometry(0.09, 0.12, 4),
        p.capeTrim,
        [0, 0.23, 0.13],
        [Math.PI * 0.68, Math.PI / 4, 0],
      );
      // Lower face stealth respirator mask
      this.addMesh(
        nodes.helmArmor,
        new THREE.BoxGeometry(0.17, 0.11, 0.12),
        p.secondaryArmor,
        [0, 0.095, 0.085],
      );
      // Glowing emerald visor (angled V-slit eyes)
      for (const side of [-1, 1]) {
        this.addMesh(
          nodes.helmArmor,
          new THREE.BoxGeometry(0.075, 0.026, 0.03),
          p.visorGlow,
          [side * 0.052, 0.168, 0.132],
          [0, side * -0.22, side * 0.18],
        );
      }
    } else {
      // Arcanist sculpted head + glowing arcane eyes + ornate Astral Crown Circlet + levitating halo shards
      this.addMesh(
        nodes.helmArmor,
        new THREE.SphereGeometry(0.128, 12, 10),
        p.skinOrMask,
        [0, 0.155, 0],
      );
      // Flowing dark-silver hair / hood back-drape
      this.addMesh(
        nodes.helmArmor,
        new THREE.CylinderGeometry(0.132, 0.15, 0.24, 10, 1, false, Math.PI * 0.55, Math.PI * 1.9),
        p.darkUnderlayer,
        [0, 0.13, -0.015],
      );
      // Luminous arcane eyes
      for (const side of [-1, 1]) {
        this.addMesh(
          nodes.helmArmor,
          new THREE.BoxGeometry(0.048, 0.022, 0.025),
          p.visorGlow,
          [side * 0.045, 0.165, 0.122],
        );
      }
      // Gilded Astral Circlet brow band + central spire gem
      this.addMesh(
        nodes.helmArmor,
        new THREE.TorusGeometry(0.136, 0.016, 8, 20),
        p.trimGold,
        [0, 0.215, 0.005],
        [Math.PI / 2 - 0.12, 0, 0],
      );
      this.addMesh(
        nodes.helmArmor,
        new THREE.OctahedronGeometry(0.042, 0),
        p.visorGlow,
        [0, 0.265, 0.142],
        [0, 0, 0],
        [0.7, 1.35, 0.55],
      );

      // Floating astral halo crown above/behind head (animated in HeroAnimator!)
      const haloGroup = new THREE.Group();
      haloGroup.position.set(0, 0.34, -0.03);
      nodes.helmArmor.add(haloGroup);
      nodes.floatingHelmOrnament = haloGroup;

      this.addMesh(
        haloGroup,
        new THREE.TorusGeometry(0.19, 0.01, 6, 24),
        p.trimGold,
        [0, 0, 0],
        [Math.PI * 0.32, 0, 0],
      );
      for (let i = 0; i < 3; i++) {
        const angle = (i - 1) * 0.65;
        this.addMesh(
          haloGroup,
          new THREE.OctahedronGeometry(0.03, 0),
          p.visorGlow,
          [Math.sin(angle) * 0.2, Math.cos(angle) * 0.08 + 0.05, -0.02],
          [0, 0, -angle],
          [0.65, 1.5, 0.65],
        );
      }
    }
  }

  private buildArticulatedCape(
    heroClass: HeroClassId,
    nodes: HeroSkeletonNodes,
    p: ClassPalette,
  ): void {
    // Clasp medallions on capeSeg0 top shoulders
    for (const side of [-1, 1]) {
      this.addMesh(
        nodes.capeArmorSegments[0],
        new THREE.CylinderGeometry(0.048, 0.048, 0.028, 8),
        p.trimGold,
        [side * 0.18, 0.01, 0.03],
        [Math.PI / 2, 0, 0],
      );
    }

    for (let i = 0; i < 4; i++) {
      const segGroup = nodes.capeArmorSegments[i];
      const segLen = CAPE_SEGMENT_LENGTHS[i];
      const topW = 0.38 + i * 0.055;
      const botW = 0.38 + (i + 1) * 0.055;

      if (heroClass === 'shadowblade' && i >= 2) {
        // Notched twin-tail assassin shadow cloak on lower two segments!
        const tailW = i === 2 ? 0.17 : 0.13;
        for (const side of [-1, 1]) {
          const xOffset = side * (0.12 + (i - 2) * 0.025);
          if (i === 3) {
            // Pointed dagger-tail tips
            this.addMesh(
              segGroup,
              new THREE.ConeGeometry(tailW * 0.62, segLen + 0.04, 4),
              p.capeMain,
              [xOffset, -segLen * 0.5, 0],
              [Math.PI, Math.PI / 4, 0],
              [1.2, 1, 0.18],
            );
          } else {
            this.addMesh(
              segGroup,
              new THREE.BoxGeometry(tailW, segLen + 0.02, 0.022),
              p.capeMain,
              [xOffset, -segLen * 0.5, 0],
            );
          }
          // Glowing emerald outer edge trim
          this.addMesh(
            segGroup,
            new THREE.BoxGeometry(0.022, segLen + 0.01, 0.026),
            p.capeTrim,
            [xOffset + side * (tailW * 0.48), -segLen * 0.5, 0],
          );
        }
      } else {
        // Tapered trapezoidal cloth panel with side & hem heraldic trim
        const midW = (topW + botW) * 0.5;
        this.addMesh(
          segGroup,
          new THREE.BoxGeometry(midW, segLen + 0.022, 0.024),
          p.capeMain,
          [0, -segLen * 0.5, 0],
        );

        // Left & right gold/arcane border strips
        for (const side of [-1, 1]) {
          this.addMesh(
            segGroup,
            new THREE.BoxGeometry(0.028, segLen + 0.02, 0.028),
            p.capeTrim,
            [side * (midW * 0.48), -segLen * 0.5, 0],
          );
        }

        // Bottom border / astral spine runes
        if (i === 3) {
          this.addMesh(
            segGroup,
            new THREE.BoxGeometry(midW + 0.02, 0.036, 0.03),
            p.capeTrim,
            [0, -segLen + 0.015, 0],
          );
        } else if (heroClass === 'arcanist') {
          this.addMesh(
            segGroup,
            new THREE.OctahedronGeometry(0.035, 0),
            p.capeTrim,
            [0, -segLen * 0.5, -0.016],
            [0, 0, 0],
            [0.9, 1.3, 0.3],
          );
        }
      }
    }
  }

  dispose(): void {
    for (const geo of this.armorGeometries) {
      geo.dispose();
    }
    this.armorGeometries.length = 0;

    for (const geo of this.staticGeometries) {
      geo.dispose();
    }
    this.staticGeometries.length = 0;
  }
}
