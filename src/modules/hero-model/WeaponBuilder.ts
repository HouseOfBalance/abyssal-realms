import * as THREE from 'three';
import type { ItemRarity, WeaponVisualType } from '../../contracts/types';
import type { WeaponMaterialSet } from './HeroMaterials';
import type { HeroSkeletonNodes } from './SkeletonBuilder';

export interface ActiveWeaponRig {
  weaponType: WeaponVisualType;
  rarity: ItemRarity;
  mainBaseAnchor: THREE.Object3D;
  mainTipAnchor: THREE.Object3D;
  offBaseAnchor: THREE.Object3D | null;
  offTipAnchor: THREE.Object3D | null;
  floatingOrb: THREE.Group | null;
  spinRings: THREE.Object3D[];
}

export class WeaponBuilder {
  private readonly weaponGeometries: THREE.BufferGeometry[] = [];

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.weaponGeometries.push(geo);
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

  clearWeapons(nodes: HeroSkeletonNodes): void {
    nodes.mainWeaponSocket.clear();
    nodes.offWeaponSocket.clear();
    nodes.shieldSocket.clear();

    for (const geo of this.weaponGeometries) {
      geo.dispose();
    }
    this.weaponGeometries.length = 0;
  }

  buildWeapon(
    weaponType: WeaponVisualType,
    rarity: ItemRarity,
    nodes: HeroSkeletonNodes,
    mats: WeaponMaterialSet,
  ): ActiveWeaponRig {
    this.clearWeapons(nodes);

    const spinRings: THREE.Object3D[] = [];
    let floatingOrb: THREE.Group | null = null;
    const mainBaseAnchor = new THREE.Object3D();
    mainBaseAnchor.name = 'MainWeaponBase';
    const mainTipAnchor = new THREE.Object3D();
    mainTipAnchor.name = 'MainWeaponTip';
    let offBaseAnchor: THREE.Object3D | null = null;
    let offTipAnchor: THREE.Object3D | null = null;

    if (weaponType === 'greatsword') {
      this.buildGreatsword(nodes.mainWeaponSocket, mats, rarity, mainTipAnchor, spinRings);
      mainBaseAnchor.position.set(0, 0.28, 0);
      nodes.mainWeaponSocket.add(mainBaseAnchor);
    } else if (weaponType === 'daggers') {
      offBaseAnchor = new THREE.Object3D();
      offBaseAnchor.name = 'OffWeaponBase';
      offTipAnchor = new THREE.Object3D();
      offTipAnchor.name = 'OffWeaponTip';
      this.buildDagger(nodes.mainWeaponSocket, mats, rarity, mainTipAnchor, spinRings, 1);
      this.buildDagger(nodes.offWeaponSocket, mats, rarity, offTipAnchor, spinRings, -1);
      mainBaseAnchor.position.set(0, 0.12, 0);
      nodes.mainWeaponSocket.add(mainBaseAnchor);
      offBaseAnchor.position.set(0, 0.12, 0);
      nodes.offWeaponSocket.add(offBaseAnchor);
    } else if (weaponType === 'staff') {
      floatingOrb = this.buildStaff(nodes.mainWeaponSocket, mats, rarity, mainTipAnchor, spinRings);
      mainBaseAnchor.position.set(0, -0.22, 0);
      floatingOrb.add(mainBaseAnchor);
    } else if (weaponType === 'warhammer') {
      this.buildWarhammer(nodes.mainWeaponSocket, mats, rarity, mainTipAnchor, spinRings);
      mainBaseAnchor.position.set(0, 0.76, -0.04);
      nodes.mainWeaponSocket.add(mainBaseAnchor);
    } else {
      // 'sword_shield'
      this.buildBroadsword(nodes.mainWeaponSocket, mats, rarity, mainTipAnchor, spinRings);
      this.buildShield(nodes.shieldSocket, mats, rarity, spinRings);
      mainBaseAnchor.position.set(0, 0.16, 0);
      nodes.mainWeaponSocket.add(mainBaseAnchor);
    }

    return {
      weaponType,
      rarity,
      mainBaseAnchor,
      mainTipAnchor,
      offBaseAnchor,
      offTipAnchor,
      floatingOrb,
      spinRings,
    };
  }

  private addRarityAuraOrnaments(
    parent: THREE.Object3D,
    mats: WeaponMaterialSet,
    rarity: ItemRarity,
    centerY: number,
    radius: number,
    spinRings: THREE.Object3D[],
  ): void {
    if (rarity !== 'epic' && rarity !== 'legendary') return;

    const ringGroup = new THREE.Group();
    ringGroup.position.set(0, centerY, 0);
    parent.add(ringGroup);
    spinRings.push(ringGroup);

    this.addMesh(
      ringGroup,
      new THREE.TorusGeometry(radius, 0.008, 6, 20),
      mats.runeEmissive,
      [0, 0, 0],
      [Math.PI * 0.38, 0.25, 0],
    );

    if (rarity === 'legendary') {
      const outerGroup = new THREE.Group();
      outerGroup.position.set(0, centerY, 0);
      parent.add(outerGroup);
      spinRings.push(outerGroup);

      this.addMesh(
        outerGroup,
        new THREE.TorusGeometry(radius * 1.28, 0.007, 6, 24),
        mats.runeEmissive,
        [0, 0, 0],
        [-Math.PI * 0.34, -0.3, 0],
      );

      for (const side of [-1, 1]) {
        this.addMesh(
          outerGroup,
          new THREE.OctahedronGeometry(0.022, 0),
          mats.crystalCore,
          [side * radius * 1.28, 0, 0],
          [0, 0, 0],
          [0.7, 1.5, 0.7],
        );
      }
    }
  }

  private buildGreatsword(
    socket: THREE.Group,
    mats: WeaponMaterialSet,
    rarity: ItemRarity,
    tipAnchor: THREE.Object3D,
    spinRings: THREE.Object3D[],
  ): void {
    // Pommel & gem
    this.addMesh(
      socket,
      new THREE.OctahedronGeometry(0.048, 0),
      mats.goldHilt,
      [0, -0.24, 0],
      [0, 0, 0],
      [1, 1.25, 0.85],
    );
    this.addMesh(socket, new THREE.OctahedronGeometry(0.026, 0), mats.runeEmissive, [0, -0.27, 0]);

    // Two-handed wrapped leather hilt
    this.addMesh(
      socket,
      new THREE.CylinderGeometry(0.026, 0.022, 0.3, 8),
      mats.leatherGrip,
      [0, -0.07, 0],
    );
    this.addMesh(
      socket,
      new THREE.TorusGeometry(0.027, 0.006, 6, 12),
      mats.goldHilt,
      [0, -0.07, 0],
      [Math.PI / 2, 0, 0],
    );

    // Sweeping winged crossguard + center rune housing
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.055, 0.065, 0.36),
      mats.darkIron,
      [0, 0.09, 0],
    );
    for (const side of [-1, 1]) {
      this.addMesh(
        socket,
        new THREE.ConeGeometry(0.032, 0.14, 5),
        mats.goldHilt,
        [0, 0.13, side * 0.21],
        [side * 1.15, 0, 0],
      );
    }
    this.addMesh(
      socket,
      new THREE.OctahedronGeometry(0.042, 0),
      mats.runeEmissive,
      [0, 0.095, 0],
      [0, 0, 0],
      [1.25, 1.1, 0.75],
    );

    // Ricasso + parrying lugs
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.03, 0.16, 0.115),
      mats.darkIron,
      [0, 0.2, 0],
    );
    for (const side of [-1, 1]) {
      this.addMesh(
        socket,
        new THREE.ConeGeometry(0.02, 0.08, 4),
        mats.bladeSteel,
        [0, 0.27, side * 0.085],
        [side * 1.1, 0, 0],
      );
    }

    // Broad beveled claymore blade
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.024, 1.02, 0.105),
      mats.bladeSteel,
      [0, 0.78, 0],
    );
    // Raised central spine ridge
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.034, 0.96, 0.038),
      mats.darkIron,
      [0, 0.76, 0],
    );
    // Tapered diamond spear-point
    this.addMesh(
      socket,
      new THREE.ConeGeometry(0.055, 0.28, 4),
      mats.bladeSteel,
      [0, 1.42, 0],
      [0, Math.PI / 2, 0],
      [1, 1, 0.28],
    );

    // Glowing etched rune channel & glyphs along fuller
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.038, 0.84, 0.016),
      mats.runeEmissive,
      [0, 0.76, 0],
    );
    for (let i = 0; i < 4; i++) {
      this.addMesh(
        socket,
        new THREE.OctahedronGeometry(0.022, 0),
        mats.runeEmissive,
        [0, 0.42 + i * 0.21, 0],
        [0, 0, 0],
        [1.15, 1.25, 0.45],
      );
    }

    this.addRarityAuraOrnaments(socket, mats, rarity, 0.18, 0.14, spinRings);

    tipAnchor.position.set(0, 1.56, 0);
    socket.add(tipAnchor);
  }

  private buildDagger(
    socket: THREE.Group,
    mats: WeaponMaterialSet,
    rarity: ItemRarity,
    tipAnchor: THREE.Object3D,
    spinRings: THREE.Object3D[],
    handSign: number,
  ): void {
    // Ring/talon pommel
    this.addMesh(
      socket,
      new THREE.TorusGeometry(0.026, 0.008, 6, 12),
      mats.goldHilt,
      [0, -0.11, 0],
      [0, Math.PI / 2, 0],
    );
    this.addMesh(
      socket,
      new THREE.OctahedronGeometry(0.016, 0),
      mats.runeEmissive,
      [0, -0.11, 0],
    );

    // Sleek assassin grip
    this.addMesh(
      socket,
      new THREE.CylinderGeometry(0.018, 0.016, 0.14, 8),
      mats.leatherGrip,
      [0, -0.02, 0],
    );

    // Curved twin-fang guard
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.032, 0.032, 0.16),
      mats.darkIron,
      [0, 0.055, 0],
    );
    this.addMesh(
      socket,
      new THREE.ConeGeometry(0.018, 0.08, 4),
      mats.goldHilt,
      [0, 0.085, 0.09],
      [0.85, 0, 0],
    );

    // Wicked slightly forward-canting curved phantom blade
    const bladeGroup = new THREE.Group();
    bladeGroup.position.set(0, 0.07, 0);
    bladeGroup.rotation.x = 0.08;
    socket.add(bladeGroup);

    this.addMesh(
      bladeGroup,
      new THREE.BoxGeometry(0.016, 0.34, 0.062),
      mats.bladeSteel,
      [0, 0.18, 0.006],
    );
    this.addMesh(
      bladeGroup,
      new THREE.ConeGeometry(0.034, 0.2, 4),
      mats.bladeSteel,
      [0, 0.44, 0.012],
      [0.08, Math.PI / 2, 0],
      [1, 1, 0.28],
    );
    // Glowing venomous/rune vein along blade
    this.addMesh(
      bladeGroup,
      new THREE.BoxGeometry(0.02, 0.38, 0.015),
      mats.runeEmissive,
      [0, 0.23, 0.014],
    );

    if (handSign > 0) {
      this.addRarityAuraOrnaments(socket, mats, rarity, 0.08, 0.095, spinRings);
    }

    tipAnchor.position.set(0, 0.61, 0.02);
    socket.add(tipAnchor);
  }

  private buildStaff(
    socket: THREE.Group,
    mats: WeaponMaterialSet,
    rarity: ItemRarity,
    tipAnchor: THREE.Object3D,
    spinRings: THREE.Object3D[],
  ): THREE.Group {
    // Staff is held more upright than a sword; counter-adjust local pitch slightly
    const staffRoot = new THREE.Group();
    staffRoot.rotation.x = -0.36;
    socket.add(staffRoot);

    // Gilded butt-spike at bottom
    this.addMesh(
      staffRoot,
      new THREE.ConeGeometry(0.028, 0.14, 6),
      mats.goldHilt,
      [0, -0.62, 0],
      [Math.PI, 0, 0],
    );

    // Long sculpted arcane shaft
    this.addMesh(
      staffRoot,
      new THREE.CylinderGeometry(0.024, 0.02, 1.56, 8),
      mats.woodShaft,
      [0, 0.22, 0],
    );
    // Grip wrap & gilded ferrule rings
    this.addMesh(
      staffRoot,
      new THREE.CylinderGeometry(0.027, 0.027, 0.28, 8),
      mats.leatherGrip,
      [0, 0.02, 0],
    );
    for (const yPos of [-0.14, 0.18, 0.58, 0.92]) {
      this.addMesh(
        staffRoot,
        new THREE.TorusGeometry(0.027, 0.006, 6, 12),
        mats.goldHilt,
        [0, yPos, 0],
        [Math.PI / 2, 0, 0],
      );
    }

    // Ornate crescent/clawed astral finial cradle at top of staff
    this.addMesh(
      staffRoot,
      new THREE.CylinderGeometry(0.048, 0.026, 0.12, 8),
      mats.goldHilt,
      [0, 1.04, 0],
    );
    this.addMesh(
      staffRoot,
      new THREE.TorusGeometry(0.145, 0.018, 8, 20, Math.PI * 1.45),
      mats.goldHilt,
      [0, 1.24, 0],
      [0, Math.PI / 2, -Math.PI * 0.725],
    );
    // Glowing rune inlays on cradle prongs
    for (const side of [-1, 1]) {
      this.addMesh(
        staffRoot,
        new THREE.ConeGeometry(0.02, 0.1, 5),
        mats.runeEmissive,
        [0, 1.33, side * 0.12],
        [side * -0.4, 0, 0],
      );
    }

    // Floating Crystal Orb + dual counter-rotating astral rings!
    const floatingOrb = new THREE.Group();
    floatingOrb.name = 'StaffFloatingCrystalOrb';
    floatingOrb.position.set(0, 1.25, 0);
    staffRoot.add(floatingOrb);

    this.addMesh(
      floatingOrb,
      new THREE.OctahedronGeometry(0.078, 1),
      mats.crystalCore,
      [0, 0, 0],
    );
    this.addMesh(
      floatingOrb,
      new THREE.OctahedronGeometry(0.045, 0),
      mats.runeEmissive,
      [0, 0, 0],
    );

    const innerRing = new THREE.Group();
    floatingOrb.add(innerRing);
    spinRings.push(innerRing);
    this.addMesh(
      innerRing,
      new THREE.TorusGeometry(0.105, 0.006, 6, 20),
      mats.runeEmissive,
      [0, 0, 0],
      [0.6, 0.4, 0],
    );

    if (rarity === 'rare' || rarity === 'epic' || rarity === 'legendary') {
      const outerRing = new THREE.Group();
      floatingOrb.add(outerRing);
      spinRings.push(outerRing);
      this.addMesh(
        outerRing,
        new THREE.TorusGeometry(0.132, 0.005, 6, 24),
        mats.goldHilt,
        [0, 0, 0],
        [-0.55, -0.35, 0],
      );
    }

    tipAnchor.position.set(0, 0.08, 0);
    floatingOrb.add(tipAnchor);

    return floatingOrb;
  }

  private buildWarhammer(
    socket: THREE.Group,
    mats: WeaponMaterialSet,
    rarity: ItemRarity,
    tipAnchor: THREE.Object3D,
    spinRings: THREE.Object3D[],
  ): void {
    // Heavy spiked butt-cap
    this.addMesh(
      socket,
      new THREE.ConeGeometry(0.034, 0.1, 6),
      mats.goldHilt,
      [0, -0.3, 0],
      [Math.PI, 0, 0],
    );

    // Reinforced two-handed dark-iron & oak haft
    this.addMesh(
      socket,
      new THREE.CylinderGeometry(0.028, 0.025, 1.24, 8),
      mats.woodShaft,
      [0, 0.36, 0],
    );
    this.addMesh(
      socket,
      new THREE.CylinderGeometry(0.031, 0.031, 0.36, 8),
      mats.leatherGrip,
      [0, -0.02, 0],
    );
    this.addMesh(
      socket,
      new THREE.CylinderGeometry(0.045, 0.032, 0.16, 8),
      mats.goldHilt,
      [0, 0.88, 0],
    );

    // Massive Titan Hammerhead at y = 1.02
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.02, 0);
    socket.add(headGroup);

    // Central dark-iron block
    this.addMesh(
      headGroup,
      new THREE.BoxGeometry(0.18, 0.2, 0.28),
      mats.darkIron,
      [0, 0, 0.01],
    );
    // Forward beveled striking face (+Z)
    this.addMesh(
      headGroup,
      new THREE.CylinderGeometry(0.115, 0.13, 0.1, 8),
      mats.bladeSteel,
      [0, 0, 0.18],
      [Math.PI / 2, Math.PI / 8, 0],
    );
    this.addMesh(
      headGroup,
      new THREE.BoxGeometry(0.19, 0.21, 0.03),
      mats.goldHilt,
      [0, 0, 0.13],
    );
    // Rear armor-piercing war-spike (-Z)
    this.addMesh(
      headGroup,
      new THREE.ConeGeometry(0.058, 0.22, 5),
      mats.bladeSteel,
      [0, 0.01, -0.22],
      [-Math.PI / 2 - 0.18, 0, 0],
    );
    // Top crown spike (+Y)
    this.addMesh(
      headGroup,
      new THREE.ConeGeometry(0.04, 0.16, 6),
      mats.goldHilt,
      [0, 0.17, 0],
    );

    // Glowing molten/arcane rune furnace plates on both sides + striking face rune
    for (const side of [-1, 1]) {
      this.addMesh(
        headGroup,
        new THREE.OctahedronGeometry(0.055, 0),
        mats.runeEmissive,
        [side * 0.095, 0, 0.02],
        [0, 0, 0],
        [0.35, 1.15, 1.35],
      );
    }
    this.addMesh(
      headGroup,
      new THREE.RingGeometry(0.035, 0.075, 8),
      mats.runeEmissive,
      [0, 0, 0.232],
    );

    this.addRarityAuraOrnaments(socket, mats, rarity, 1.02, 0.22, spinRings);

    tipAnchor.position.set(0, 1.05, 0.2);
    socket.add(tipAnchor);
  }

  private buildBroadsword(
    socket: THREE.Group,
    mats: WeaponMaterialSet,
    rarity: ItemRarity,
    tipAnchor: THREE.Object3D,
    spinRings: THREE.Object3D[],
  ): void {
    // Wheel pommel
    this.addMesh(
      socket,
      new THREE.CylinderGeometry(0.036, 0.036, 0.024, 10),
      mats.goldHilt,
      [0, -0.14, 0],
      [0, 0, Math.PI / 2],
    );
    // Grip
    this.addMesh(
      socket,
      new THREE.CylinderGeometry(0.022, 0.019, 0.18, 8),
      mats.leatherGrip,
      [0, -0.04, 0],
    );
    // Cruciform knightly crossguard + rune gem
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.042, 0.045, 0.26),
      mats.goldHilt,
      [0, 0.065, 0],
    );
    this.addMesh(
      socket,
      new THREE.OctahedronGeometry(0.03, 0),
      mats.runeEmissive,
      [0, 0.068, 0],
      [0, 0, 0],
      [1.2, 1, 0.7],
    );

    // Crisp broadsword blade + point + glowing rune fuller
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.02, 0.8, 0.082),
      mats.bladeSteel,
      [0, 0.48, 0],
    );
    this.addMesh(
      socket,
      new THREE.ConeGeometry(0.044, 0.22, 4),
      mats.bladeSteel,
      [0, 0.99, 0],
      [0, Math.PI / 2, 0],
      [1, 1, 0.26],
    );
    this.addMesh(
      socket,
      new THREE.BoxGeometry(0.026, 0.68, 0.016),
      mats.runeEmissive,
      [0, 0.46, 0],
    );

    this.addRarityAuraOrnaments(socket, mats, rarity, 0.12, 0.11, spinRings);

    tipAnchor.position.set(0, 1.11, 0);
    socket.add(tipAnchor);
  }

  private buildShield(
    shieldSocket: THREE.Group,
    mats: WeaponMaterialSet,
    rarity: ItemRarity,
    spinRings: THREE.Object3D[],
  ): void {
    // Oriented on outer left forearm (+X/+Z outward guard)
    const shieldRoot = new THREE.Group();
    shieldRoot.rotation.set(0.15, 0.45, -0.15);
    shieldSocket.add(shieldRoot);

    // Gothic kite/heater shield main plate
    this.addMesh(
      shieldRoot,
      new THREE.BoxGeometry(0.045, 0.46, 0.36),
      mats.darkIron,
      [0.04, 0.04, 0],
    );
    // Tapered bottom kite point
    this.addMesh(
      shieldRoot,
      new THREE.ConeGeometry(0.19, 0.24, 4),
      mats.darkIron,
      [0.04, -0.29, 0],
      [0, Math.PI / 4, Math.PI],
      [0.24, 1, 1.0],
    );
    // Beveled steel inner panel
    this.addMesh(
      shieldRoot,
      new THREE.BoxGeometry(0.052, 0.38, 0.28),
      mats.bladeSteel,
      [0.045, 0.04, 0],
    );
    // Gilded upper & side heraldic trim bars
    this.addMesh(
      shieldRoot,
      new THREE.BoxGeometry(0.056, 0.04, 0.38),
      mats.goldHilt,
      [0.046, 0.25, 0],
    );
    for (const side of [-1, 1]) {
      this.addMesh(
        shieldRoot,
        new THREE.BoxGeometry(0.056, 0.46, 0.034),
        mats.goldHilt,
        [0.046, 0.04, side * 0.17],
      );
    }

    // Central shield boss + glowing rarity rune crest
    this.addMesh(
      shieldRoot,
      new THREE.SphereGeometry(0.068, 10, 8),
      mats.goldHilt,
      [0.065, 0.05, 0],
      [0, 0, 0],
      [0.55, 1, 1],
    );
    this.addMesh(
      shieldRoot,
      new THREE.OctahedronGeometry(0.052, 0),
      mats.runeEmissive,
      [0.092, 0.05, 0],
      [0, 0, 0],
      [0.45, 1.45, 1.1],
    );

    if (rarity === 'epic' || rarity === 'legendary') {
      const crestRing = new THREE.Group();
      crestRing.position.set(0.095, 0.05, 0);
      crestRing.rotation.z = Math.PI / 2;
      shieldRoot.add(crestRing);
      spinRings.push(crestRing);
      this.addMesh(
        crestRing,
        new THREE.TorusGeometry(0.11, 0.006, 6, 18),
        mats.runeEmissive,
        [0, 0, 0],
        [Math.PI / 2, 0, 0],
      );
    }
  }

  dispose(): void {
    for (const geo of this.weaponGeometries) {
      geo.dispose();
    }
    this.weaponGeometries.length = 0;
  }
}
