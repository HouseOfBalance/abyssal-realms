import * as THREE from 'three';
import type {
  DamageType,
  IMaterialLibrary,
  MaterialKey,
} from '../../contracts/types';

export interface SpikeTrapVisuals {
  kind: 'spike_trap';
  root: THREE.Group;
  spikeRack: THREE.Group;
  warningMat: THREE.MeshStandardMaterial;
}

export interface PendulumBladeVisuals {
  kind: 'pendulum_blade';
  root: THREE.Group;
  pivotGroup: THREE.Group;
  warningMat: THREE.MeshStandardMaterial;
  pivotY: number;
  armLength: number;
}

export interface PoisonVentVisuals {
  kind: 'poison_vent';
  root: THREE.Group;
  poolMat: THREE.MeshStandardMaterial;
  ringMat: THREE.MeshStandardMaterial;
  domeMesh: THREE.Mesh;
  domeMat: THREE.MeshStandardMaterial;
  bubbles: THREE.Mesh[];
}

export interface LavaPoolVisuals {
  kind: 'lava_pool';
  root: THREE.Group;
  magmaMat: THREE.MeshStandardMaterial;
  coreMesh: THREE.Mesh;
  ringMat: THREE.MeshStandardMaterial;
  blisters: THREE.Mesh[];
}

export interface ArcaneTurretVisuals {
  kind: 'arcane_turret';
  root: THREE.Group;
  obeliskGroup: THREE.Group;
  apexCrystal: THREE.Mesh;
  gyroRing: THREE.Mesh;
  runeMat: THREE.MeshStandardMaterial;
  shockRingMesh: THREE.Mesh;
  shockRingMat: THREE.MeshStandardMaterial;
  telegraphRingMat: THREE.MeshStandardMaterial;
  element: Extract<DamageType, 'lightning' | 'void'>;
}

export interface FrostGaleVisuals {
  kind: 'frost_gale';
  root: THREE.Group;
  galeVortexGroup: THREE.Group;
  galeMat: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshStandardMaterial;
  icicleRingGroup: THREE.Group;
  icicleMat: THREE.MeshStandardMaterial;
  icicleTelegraphMat: THREE.MeshStandardMaterial;
  frostFlakes: THREE.Mesh[];
  icicleRingRadius: number;
}

export interface AstralLaserVisuals {
  kind: 'astral_laser';
  root: THREE.Group;
  lowerGearGroup: THREE.Group;
  turretHeadGroup: THREE.Group;
  sideGears: THREE.Mesh[];
  armillaryRing: THREE.Mesh;
  prismCore: THREE.Mesh;
  beamGroup: THREE.Group;
  beamCoreMat: THREE.MeshStandardMaterial;
  beamSheathMat: THREE.MeshStandardMaterial;
  dialRingMat: THREE.MeshStandardMaterial;
  beamLength: number;
}

export interface DestructibleVisuals {
  kind: 'breakable_barrel' | 'breakable_urn';
  root: THREE.Group;
  intactGroup: THREE.Group;
  remnantGroup: THREE.Group;
}

export type HazardVisualHandle =
  | SpikeTrapVisuals
  | PendulumBladeVisuals
  | PoisonVentVisuals
  | LavaPoolVisuals
  | ArcaneTurretVisuals
  | FrostGaleVisuals
  | AstralLaserVisuals
  | DestructibleVisuals;

export interface ShatterDebrisPiece {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  age: number;
  lifetime: number;
}

/**
 * Shared geometry pool & cloned-material registry for zero-leak disposal
 * and minimal GPU buffer allocations across all floor hazards.
 */
export class HazardMeshFactory {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();

  private getGeo(key: string, builder: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geo = this.geometries.get(key);
    if (!geo) {
      geo = builder();
      this.geometries.set(key, geo);
    }
    return geo;
  }

  private sharedMat(
    materials: IMaterialLibrary,
    key: MaterialKey,
    fallbackKey: MaterialKey = 'wall_stone',
  ): THREE.MeshStandardMaterial {
    try {
      const m = materials.get(key);
      if (m) return m;
    } catch {
      // Fallback safely if key is not yet registered in a mock/partial library
    }
    return materials.get(fallbackKey);
  }

  private clonedMat(
    materials: IMaterialLibrary,
    key: MaterialKey,
    fallbackKey: MaterialKey = 'crystal_cyan',
  ): THREE.MeshStandardMaterial {
    let mat: THREE.MeshStandardMaterial | undefined;
    try {
      mat =
        typeof materials.clone === 'function'
          ? materials.clone(key)
          : materials.get(key)?.clone();
    } catch {
      mat = undefined;
    }
    if (!mat) {
      mat =
        typeof materials.clone === 'function'
          ? materials.clone(fallbackKey)
          : materials.get(fallbackKey).clone();
    }
    this.ownedMaterials.add(mat);
    return mat;
  }

  buildSpikeTrap(materials: IMaterialLibrary): SpikeTrapVisuals {
    const root = new THREE.Group();
    root.name = 'hazard_spike_trap';

    const stoneMat = this.sharedMat(materials, 'wall_stone');
    const darkIronMat = this.sharedMat(materials, 'metal_dark_iron');
    const steelMat = this.sharedMat(materials, 'metal_steel');
    const warningMat = this.clonedMat(materials, 'rune_glow_crimson');
    warningMat.transparent = true;
    warningMat.opacity = 0.28;
    warningMat.emissiveIntensity = 0.2;

    // Beveled stone surround
    const baseMesh = new THREE.Mesh(
      this.getGeo('spike_stone_base', () => new THREE.BoxGeometry(1.82, 0.06, 1.82)),
      stoneMat,
    );
    baseMesh.position.y = 0.02;
    baseMesh.receiveShadow = true;
    root.add(baseMesh);

    // Perforated dark-iron grate plate
    const gratePlate = new THREE.Mesh(
      this.getGeo('spike_grate_plate', () => new THREE.BoxGeometry(1.54, 0.055, 1.54)),
      darkIronMat,
    );
    gratePlate.position.y = 0.04;
    gratePlate.receiveShadow = true;
    root.add(gratePlate);

    // Metallic cross-bars
    const barGeoX = this.getGeo('spike_bar_x', () => new THREE.BoxGeometry(1.56, 0.03, 0.08));
    const barGeoZ = this.getGeo('spike_bar_z', () => new THREE.BoxGeometry(0.08, 0.03, 1.56));
    for (const offset of [-0.74, -0.24, 0.24, 0.74]) {
      const bx = new THREE.Mesh(barGeoX, steelMat);
      bx.position.set(0, 0.068, offset);
      bx.receiveShadow = true;
      root.add(bx);

      const bz = new THREE.Mesh(barGeoZ, steelMat);
      bz.position.set(offset, 0.068, 0);
      bz.receiveShadow = true;
      root.add(bz);
    }

    // Corner rivets
    const rivetGeo = this.getGeo(
      'spike_rivet',
      () => new THREE.CylinderGeometry(0.055, 0.065, 0.05, 8),
    );
    for (const sx of [-0.78, 0.78]) {
      for (const sz of [-0.78, 0.78]) {
        const rivet = new THREE.Mesh(rivetGeo, steelMat);
        rivet.position.set(sx, 0.075, sz);
        root.add(rivet);
      }
    }

    // Telegraphed warning rune frame & socket glints
    const warnRing = new THREE.Mesh(
      this.getGeo('spike_warn_ring', () => {
        const g = new THREE.RingGeometry(0.76, 0.88, 4);
        g.rotateZ(Math.PI * 0.25);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      warningMat,
    );
    warnRing.position.y = 0.072;
    root.add(warnRing);

    // 3x3 spike sockets + movable spike rack
    const socketGeo = this.getGeo(
      'spike_socket',
      () => new THREE.CylinderGeometry(0.105, 0.105, 0.03, 8),
    );
    const spikeShaftGeo = this.getGeo(
      'spike_shaft',
      () => new THREE.ConeGeometry(0.088, 0.76, 6),
    );
    const spikeGlintGeo = this.getGeo(
      'spike_glint_tip',
      () => new THREE.ConeGeometry(0.052, 0.26, 6),
    );

    const spikeRack = new THREE.Group();
    spikeRack.position.y = -0.46;
    root.add(spikeRack);

    const coords = [-0.48, 0, 0.48];
    for (const sx of coords) {
      for (const sz of coords) {
        const socket = new THREE.Mesh(socketGeo, warningMat);
        socket.position.set(sx, 0.066, sz);
        root.add(socket);

        const shaft = new THREE.Mesh(spikeShaftGeo, steelMat);
        shaft.position.set(sx, 0.38, sz);
        shaft.castShadow = true;
        spikeRack.add(shaft);

        const tip = new THREE.Mesh(spikeGlintGeo, warningMat);
        tip.position.set(sx, 0.64, sz);
        spikeRack.add(tip);
      }
    }

    return {
      kind: 'spike_trap',
      root,
      spikeRack,
      warningMat,
    };
  }

  buildPendulumBlade(materials: IMaterialLibrary, rotationY: number): PendulumBladeVisuals {
    const root = new THREE.Group();
    root.name = 'hazard_pendulum_blade';
    root.rotation.y = rotationY;

    const pivotY = 3.65;
    const armLength = 2.95;

    const darkIronMat = this.sharedMat(materials, 'metal_dark_iron');
    const steelMat = this.sharedMat(materials, 'metal_steel');
    const goldMat = this.sharedMat(materials, 'metal_gold');
    const obsidianMat = this.sharedMat(materials, 'wall_obsidian');
    const warningMat = this.clonedMat(materials, 'rune_glow_crimson');
    warningMat.transparent = true;
    warningMat.opacity = 0.55;
    warningMat.emissiveIntensity = 0.5;

    // Ground warning slash channel showing exact swing trajectory
    const groundTrack = new THREE.Mesh(
      this.getGeo('pend_ground_track', () => new THREE.BoxGeometry(3.85, 0.03, 0.24)),
      darkIronMat,
    );
    groundTrack.position.y = 0.02;
    groundTrack.receiveShadow = true;
    root.add(groundTrack);

    const groundSlit = new THREE.Mesh(
      this.getGeo('pend_ground_slit', () => new THREE.BoxGeometry(3.65, 0.036, 0.075)),
      warningMat,
    );
    groundSlit.position.y = 0.028;
    root.add(groundSlit);

    // Side gothic support columns outside walkway & overhead crossbeam
    const pillarGeo = this.getGeo(
      'pend_pillar',
      () => new THREE.BoxGeometry(0.22, pivotY + 0.15, 0.22),
    );
    const plinthGeo = this.getGeo(
      'pend_plinth',
      () => new THREE.BoxGeometry(0.38, 0.24, 0.38),
    );
    for (const side of [-2.08, 2.08]) {
      const plinth = new THREE.Mesh(plinthGeo, obsidianMat);
      plinth.position.set(side, 0.12, 0);
      plinth.receiveShadow = true;
      root.add(plinth);

      const pillar = new THREE.Mesh(pillarGeo, darkIronMat);
      pillar.position.set(side, (pivotY + 0.15) * 0.5, 0);
      pillar.castShadow = true;
      root.add(pillar);
    }

    const crossBeam = new THREE.Mesh(
      this.getGeo('pend_crossbeam', () => new THREE.BoxGeometry(4.45, 0.2, 0.26)),
      darkIronMat,
    );
    crossBeam.position.set(0, pivotY + 0.08, 0);
    crossBeam.castShadow = true;
    root.add(crossBeam);

    // Golden pivot gear housing
    const axle = new THREE.Mesh(
      this.getGeo('pend_axle', () => {
        const g = new THREE.CylinderGeometry(0.22, 0.22, 0.38, 12);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      goldMat,
    );
    axle.position.set(0, pivotY, 0);
    root.add(axle);

    // Swinging arm & executioner crescent blade
    const pivotGroup = new THREE.Group();
    pivotGroup.position.set(0, pivotY, 0);
    root.add(pivotGroup);

    const rod = new THREE.Mesh(
      this.getGeo('pend_rod', () => new THREE.CylinderGeometry(0.055, 0.072, armLength - 0.1, 8)),
      darkIronMat,
    );
    rod.position.set(0, -(armLength - 0.1) * 0.5, 0);
    rod.castShadow = true;
    pivotGroup.add(rod);

    const collar = new THREE.Mesh(
      this.getGeo('pend_collar', () => new THREE.BoxGeometry(0.26, 0.22, 0.18)),
      goldMat,
    );
    collar.position.set(0, -armLength + 0.25, 0);
    pivotGroup.add(collar);

    // Central cheek of axe head
    const cheek = new THREE.Mesh(
      this.getGeo('pend_axe_cheek', () => new THREE.BoxGeometry(0.56, 0.44, 0.11)),
      darkIronMat,
    );
    cheek.position.set(0, -armLength, 0);
    cheek.castShadow = true;
    pivotGroup.add(cheek);

    // Sweeping crescent steel blade edge aligned with X-Y swing plane
    const bladeEdge = new THREE.Mesh(
      this.getGeo('pend_axe_edge', () => {
        const g = new THREE.CylinderGeometry(
          0.76,
          0.76,
          0.05,
          20,
          1,
          false,
          -Math.PI * 0.42,
          Math.PI * 0.84,
        );
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      steelMat,
    );
    bladeEdge.position.set(0, -armLength + 0.28, 0);
    bladeEdge.castShadow = true;
    pivotGroup.add(bladeEdge);

    // Upper reverse crescent edge for double-bitted silhouette
    const upperBlade = new THREE.Mesh(
      this.getGeo('pend_axe_upper', () => new THREE.BoxGeometry(1.18, 0.24, 0.05)),
      steelMat,
    );
    upperBlade.position.set(0, -armLength - 0.08, 0);
    upperBlade.castShadow = true;
    pivotGroup.add(upperBlade);

    // Glowing blood-rune fuller
    const fuller = new THREE.Mesh(
      this.getGeo('pend_axe_fuller', () => new THREE.BoxGeometry(0.86, 0.08, 0.125)),
      warningMat,
    );
    fuller.position.set(0, -armLength - 0.02, 0);
    pivotGroup.add(fuller);

    return {
      kind: 'pendulum_blade',
      root,
      pivotGroup,
      warningMat,
      pivotY,
      armLength,
    };
  }

  buildPoisonVent(materials: IMaterialLibrary, radius: number): PoisonVentVisuals {
    const root = new THREE.Group();
    root.name = 'hazard_poison_vent';

    const stoneMat = this.sharedMat(materials, 'wall_stone');
    const emeraldShared = this.sharedMat(materials, 'rune_glow_emerald');
    const poolMat = this.clonedMat(materials, 'rune_glow_emerald');
    poolMat.emissiveIntensity = 0.55;

    const ringMat = this.clonedMat(materials, 'rune_glow_emerald');
    ringMat.transparent = true;
    ringMat.opacity = 0.3;
    ringMat.side = THREE.DoubleSide;

    const domeMat = this.clonedMat(materials, 'rune_glow_emerald');
    domeMat.transparent = true;
    domeMat.opacity = 0;
    domeMat.depthWrite = false;
    domeMat.side = THREE.DoubleSide;

    // Crater rim
    const crater = new THREE.Mesh(
      this.getGeo('poison_crater', () => new THREE.CylinderGeometry(1.08, 1.38, 0.14, 12)),
      stoneMat,
    );
    crater.position.y = 0.05;
    crater.receiveShadow = true;
    root.add(crater);

    // Jagged fissure rocks & venom crystals around rim
    const toothGeo = this.getGeo('poison_tooth', () => new THREE.ConeGeometry(0.18, 0.36, 5));
    const crystalGeo = this.getGeo('poison_crystal', () => new THREE.OctahedronGeometry(0.14, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tooth = new THREE.Mesh(toothGeo, stoneMat);
      tooth.position.set(Math.cos(a) * 1.16, 0.16, Math.sin(a) * 1.16);
      tooth.rotation.z = Math.cos(a) * -0.25;
      tooth.rotation.x = Math.sin(a) * 0.25;
      tooth.castShadow = true;
      root.add(tooth);

      if (i % 2 === 0) {
        const crys = new THREE.Mesh(crystalGeo, emeraldShared);
        crys.position.set(Math.cos(a + 0.45) * 1.05, 0.18, Math.sin(a + 0.45) * 1.05);
        crys.rotation.set(0.3, a, 0.2);
        root.add(crys);
      }
    }

    // Glowing toxic pool surface
    const pool = new THREE.Mesh(
      this.getGeo('poison_pool_disc', () => new THREE.CylinderGeometry(0.98, 0.98, 0.06, 18)),
      poolMat,
    );
    pool.position.y = 0.095;
    root.add(pool);

    // Outer AoE warning ring
    const warnRing = new THREE.Mesh(
      this.getGeo('poison_warn_ring', () => {
        const g = new THREE.RingGeometry(0.88, 1.0, 28);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      ringMat,
    );
    warnRing.scale.setScalar(radius);
    warnRing.position.y = 0.032;
    root.add(warnRing);

    // Expanding toxic eruption dome
    const domeMesh = new THREE.Mesh(
      this.getGeo(
        'poison_dome',
        () => new THREE.SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      ),
      domeMat,
    );
    domeMesh.position.y = 0.08;
    domeMesh.scale.set(0.5, 0.2, 0.5);
    root.add(domeMesh);

    // Bubbling spheres
    const bubbleGeo = this.getGeo('poison_bubble', () => new THREE.SphereGeometry(0.13, 10, 8));
    const bubbles: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(bubbleGeo, poolMat);
      const angle = i * 1.256;
      const dist = 0.22 + (i % 3) * 0.24;
      b.position.set(Math.cos(angle) * dist, 0.14, Math.sin(angle) * dist);
      root.add(b);
      bubbles.push(b);
    }

    return {
      kind: 'poison_vent',
      root,
      poolMat,
      ringMat,
      domeMesh,
      domeMat,
      bubbles,
    };
  }

  buildLavaPool(materials: IMaterialLibrary, radius: number): LavaPoolVisuals {
    const root = new THREE.Group();
    root.name = 'hazard_lava_pool';

    const obsidianMat = this.sharedMat(materials, 'wall_obsidian');
    const crimsonShared = this.sharedMat(materials, 'rune_glow_crimson');
    const magmaMat = this.clonedMat(materials, 'lava_emissive');
    magmaMat.emissiveIntensity = 0.75;

    const ringMat = this.clonedMat(materials, 'lava_emissive');
    ringMat.transparent = true;
    ringMat.opacity = 0.32;
    ringMat.side = THREE.DoubleSide;

    // Volcanic obsidian rim
    const rim = new THREE.Mesh(
      this.getGeo('lava_rim', () => new THREE.CylinderGeometry(1.24, 1.54, 0.14, 14)),
      obsidianMat,
    );
    rim.position.y = 0.05;
    rim.receiveShadow = true;
    root.add(rim);

    const rockGeo = this.getGeo('lava_rock', () => new THREE.DodecahedronGeometry(0.2, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rock = new THREE.Mesh(rockGeo, obsidianMat);
      rock.position.set(Math.cos(a) * 1.32, 0.13, Math.sin(a) * 1.32);
      rock.scale.set(1.15, 0.7 + (i % 2) * 0.35, 0.95);
      rock.rotation.y = a;
      rock.castShadow = true;
      root.add(rock);
    }

    // Molten magma disc
    const magmaDisc = new THREE.Mesh(
      this.getGeo('lava_magma_disc', () => new THREE.CylinderGeometry(1.18, 1.18, 0.065, 20)),
      magmaMat,
    );
    magmaDisc.position.y = 0.085;
    root.add(magmaDisc);

    // Hot crimson inner swirl core
    const coreMesh = new THREE.Mesh(
      this.getGeo('lava_core_disc', () => new THREE.CylinderGeometry(0.68, 0.74, 0.075, 12)),
      crimsonShared,
    );
    coreMesh.position.y = 0.096;
    root.add(coreMesh);

    // Heat-wave AoE warning ring
    const warnRing = new THREE.Mesh(
      this.getGeo('lava_warn_ring', () => {
        const g = new THREE.RingGeometry(0.89, 1.0, 28);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      ringMat,
    );
    warnRing.scale.setScalar(radius);
    warnRing.position.y = 0.034;
    root.add(warnRing);

    // Bubbling magma blisters / rising embers
    const blisterGeo = this.getGeo('lava_blister', () => new THREE.SphereGeometry(0.14, 10, 8));
    const blisters: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(blisterGeo, magmaMat);
      const angle = i * 1.256 + 0.4;
      const dist = 0.25 + (i % 3) * 0.26;
      m.position.set(Math.cos(angle) * dist, 0.13, Math.sin(angle) * dist);
      root.add(m);
      blisters.push(m);
    }

    return {
      kind: 'lava_pool',
      root,
      magmaMat,
      coreMesh,
      ringMat,
      blisters,
    };
  }

  buildArcaneTurret(
    materials: IMaterialLibrary,
    element: Extract<DamageType, 'lightning' | 'void'>,
  ): ArcaneTurretVisuals {
    const root = new THREE.Group();
    root.name = `hazard_arcane_turret_${element}`;

    const obsidianMat = this.sharedMat(materials, 'wall_obsidian');
    const goldMat = this.sharedMat(materials, 'metal_gold');
    const runeKey: MaterialKey = element === 'lightning' ? 'crystal_cyan' : 'rune_glow_void';

    const runeMat = this.clonedMat(materials, runeKey);
    runeMat.emissiveIntensity = 0.9;

    const shockRingMat = this.clonedMat(materials, runeKey);
    shockRingMat.transparent = true;
    shockRingMat.opacity = 0;
    shockRingMat.depthWrite = false;
    shockRingMat.emissiveIntensity = 2.2;

    const telegraphRingMat = this.clonedMat(materials, runeKey);
    telegraphRingMat.transparent = true;
    telegraphRingMat.opacity = 0.25;
    telegraphRingMat.side = THREE.DoubleSide;

    // Tiered octagonal pedestal
    const plinth = new THREE.Mesh(
      this.getGeo('turret_plinth', () => new THREE.CylinderGeometry(0.56, 0.72, 0.26, 8)),
      obsidianMat,
    );
    plinth.position.y = 0.13;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    root.add(plinth);

    const goldCollar = new THREE.Mesh(
      this.getGeo('turret_collar', () => new THREE.CylinderGeometry(0.6, 0.62, 0.06, 8)),
      goldMat,
    );
    goldCollar.position.y = 0.28;
    root.add(goldCollar);

    // Base charge telegraph ring
    const telegraphRing = new THREE.Mesh(
      this.getGeo('turret_telegraph_ring', () => {
        const g = new THREE.RingGeometry(0.76, 0.94, 24);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      telegraphRingMat,
    );
    telegraphRing.position.y = 0.036;
    root.add(telegraphRing);

    // Rotating levitating obelisk group
    const obeliskGroup = new THREE.Group();
    obeliskGroup.position.y = 1.24;
    root.add(obeliskGroup);

    const monolith = new THREE.Mesh(
      this.getGeo('turret_monolith', () => {
        const g = new THREE.CylinderGeometry(0.2, 0.35, 1.52, 4);
        g.rotateY(Math.PI * 0.25);
        return g;
      }),
      obsidianMat,
    );
    monolith.castShadow = true;
    obeliskGroup.add(monolith);

    // Glowing vertical rune inlays on all 4 faces
    const runeStripX = new THREE.Mesh(
      this.getGeo('turret_rune_x', () => new THREE.BoxGeometry(0.5, 1.26, 0.08)),
      runeMat,
    );
    obeliskGroup.add(runeStripX);

    const runeStripZ = new THREE.Mesh(
      this.getGeo('turret_rune_z', () => new THREE.BoxGeometry(0.08, 1.26, 0.5)),
      runeMat,
    );
    obeliskGroup.add(runeStripZ);

    // Floating apex crystal
    const apexCrystal = new THREE.Mesh(
      this.getGeo('turret_apex', () => new THREE.OctahedronGeometry(0.24, 0)),
      runeMat,
    );
    apexCrystal.position.y = 1.04;
    apexCrystal.castShadow = true;
    obeliskGroup.add(apexCrystal);

    // Golden orbiting gyroscope ring
    const gyroRing = new THREE.Mesh(
      this.getGeo('turret_gyro', () => new THREE.TorusGeometry(0.5, 0.028, 8, 24)),
      goldMat,
    );
    gyroRing.rotation.x = Math.PI * 0.35;
    obeliskGroup.add(gyroRing);

    // Expanding 3D shockwave ring
    const shockRingMesh = new THREE.Mesh(
      this.getGeo('turret_shock_ring', () => {
        const g = new THREE.TorusGeometry(1.0, 0.055, 10, 36);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      shockRingMat,
    );
    shockRingMesh.position.y = 0.38;
    shockRingMesh.visible = false;
    root.add(shockRingMesh);

    return {
      kind: 'arcane_turret',
      root,
      obeliskGroup,
      apexCrystal,
      gyroRing,
      runeMat,
      shockRingMesh,
      shockRingMat,
      telegraphRingMat,
      element,
    };
  }

  /**
   * Floor 5 ('cathedral') signature hazard:
   * Blizzard Frost Gale swirling icy vortex + Falling Icicle Ring.
   */
  buildFrostGale(materials: IMaterialLibrary, radius: number): FrostGaleVisuals {
    const root = new THREE.Group();
    root.name = 'hazard_frost_gale';

    const cathedralStone = this.sharedMat(materials, 'floor_cathedral', 'wall_stone');
    const iceShared = this.sharedMat(materials, 'ice_glacier', 'crystal_cyan');

    const coreMat = this.clonedMat(materials, 'ice_glacier', 'crystal_cyan');
    coreMat.emissiveIntensity = 0.7;

    const galeMat = this.clonedMat(materials, 'rune_glow_blue', 'crystal_cyan');
    galeMat.transparent = true;
    galeMat.opacity = 0.2;
    galeMat.depthWrite = false;
    galeMat.side = THREE.DoubleSide;

    const icicleMat = this.clonedMat(materials, 'ice_glacier', 'crystal_cyan');
    icicleMat.transparent = true;
    icicleMat.opacity = 0.88;
    icicleMat.emissiveIntensity = 0.95;

    const icicleTelegraphMat = this.clonedMat(materials, 'rune_glow_blue', 'crystal_cyan');
    icicleTelegraphMat.transparent = true;
    icicleTelegraphMat.opacity = 0.25;
    icicleTelegraphMat.side = THREE.DoubleSide;

    // Frosted cathedral vent plinth
    const ventRim = new THREE.Mesh(
      this.getGeo('frost_vent_rim', () => new THREE.CylinderGeometry(1.06, 1.38, 0.12, 12)),
      cathedralStone,
    );
    ventRim.position.y = 0.05;
    ventRim.receiveShadow = true;
    root.add(ventRim);

    // 6 glacial rime spires around the fissure
    const spireGeo = this.getGeo('frost_spire', () => new THREE.ConeGeometry(0.15, 0.5, 5));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spire = new THREE.Mesh(spireGeo, iceShared);
      spire.position.set(Math.cos(a) * 1.14, 0.22, Math.sin(a) * 1.14);
      spire.rotation.z = Math.cos(a) * -0.32;
      spire.rotation.x = Math.sin(a) * 0.32;
      spire.castShadow = true;
      root.add(spire);
    }

    // Frozen core mirror disc
    const coreDisc = new THREE.Mesh(
      this.getGeo('frost_core_disc', () => new THREE.CylinderGeometry(0.95, 0.95, 0.055, 16)),
      coreMat,
    );
    coreDisc.position.y = 0.088;
    root.add(coreDisc);

    // Swirling Blizzard Frost Gale cyclone funnel
    const galeVortexGroup = new THREE.Group();
    galeVortexGroup.position.y = 0.08;
    root.add(galeVortexGroup);

    const funnelOuter = new THREE.Mesh(
      this.getGeo(
        'frost_gale_funnel_outer',
        () => new THREE.CylinderGeometry(1.0, 0.36, 1.45, 20, 1, true),
      ),
      galeMat,
    );
    funnelOuter.position.y = 0.72;
    galeVortexGroup.add(funnelOuter);

    const galeRibbon = new THREE.Mesh(
      this.getGeo('frost_gale_ribbon', () => {
        const g = new THREE.TorusGeometry(0.82, 0.04, 8, 28);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      galeMat,
    );
    galeRibbon.position.y = 0.55;
    galeRibbon.rotation.z = 0.16;
    galeVortexGroup.add(galeRibbon);

    // Orbiting frost crystal shards inside the blizzard gust
    const flakeGeo = this.getGeo('frost_flake', () => new THREE.OctahedronGeometry(0.11, 0));
    const frostFlakes: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const flake = new THREE.Mesh(flakeGeo, iceShared);
      const a = (i / 6) * Math.PI * 2;
      const dist = 0.65 + (i % 2) * 0.45;
      flake.position.set(Math.cos(a) * dist, 0.35 + (i % 3) * 0.28, Math.sin(a) * dist);
      galeVortexGroup.add(flake);
      frostFlakes.push(flake);
    }

    // Ground telegraph ring for the Falling Icicle Ring
    const icicleRingRadius = radius * 0.72;
    const telegraphRing = new THREE.Mesh(
      this.getGeo('frost_icicle_telegraph', () => {
        const g = new THREE.RingGeometry(0.62, 0.84, 32);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      icicleTelegraphMat,
    );
    telegraphRing.scale.setScalar(radius);
    telegraphRing.position.y = 0.036;
    root.add(telegraphRing);

    // Overhead ring of 8 downward-pointing glacial icicles
    const icicleRingGroup = new THREE.Group();
    icicleRingGroup.position.y = 3.15;
    root.add(icicleRingGroup);

    const icicleGeo = this.getGeo('frost_icicle_spear', () => {
      const g = new THREE.ConeGeometry(0.115, 0.82, 6);
      g.rotateX(Math.PI); // Tip points straight down (-Y)
      return g;
    });

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spear = new THREE.Mesh(icicleGeo, icicleMat);
      spear.position.set(Math.cos(a) * icicleRingRadius, 0, Math.sin(a) * icicleRingRadius);
      spear.castShadow = true;
      icicleRingGroup.add(spear);
    }

    return {
      kind: 'frost_gale',
      root,
      galeVortexGroup,
      galeMat,
      coreMat,
      icicleRingGroup,
      icicleMat,
      icicleTelegraphMat,
      frostFlakes,
      icicleRingRadius,
    };
  }

  /**
   * Floor 6+ ('observatory') signature hazard:
   * Sweeping Clockwork Astral Laser emitter with interlocking brass gears.
   */
  buildAstralLaser(materials: IMaterialLibrary, beamLength: number): AstralLaserVisuals {
    const root = new THREE.Group();
    root.name = 'hazard_astral_laser';

    const starstoneMat = this.sharedMat(materials, 'floor_observatory', 'wall_obsidian');
    const brassMat = this.sharedMat(materials, 'brass_clockwork', 'metal_gold');
    const goldMat = this.sharedMat(materials, 'metal_gold');

    const beamCoreMat = this.clonedMat(materials, 'crystal_cyan');
    beamCoreMat.transparent = true;
    beamCoreMat.opacity = 0.3;
    beamCoreMat.emissiveIntensity = 2.6;

    const beamSheathMat = this.clonedMat(materials, 'rune_glow_void');
    beamSheathMat.transparent = true;
    beamSheathMat.opacity = 0.18;
    beamSheathMat.depthWrite = false;
    beamSheathMat.emissiveIntensity = 2.2;

    const dialRingMat = this.clonedMat(materials, 'rune_glow_blue', 'crystal_cyan');
    dialRingMat.transparent = true;
    dialRingMat.opacity = 0.22;
    dialRingMat.side = THREE.DoubleSide;

    // Celestial starstone base plinth
    const plinth = new THREE.Mesh(
      this.getGeo('laser_plinth', () => new THREE.CylinderGeometry(0.62, 0.8, 0.24, 10)),
      starstoneMat,
    );
    plinth.position.y = 0.12;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    root.add(plinth);

    const brassCollar = new THREE.Mesh(
      this.getGeo('laser_brass_collar', () => new THREE.CylinderGeometry(0.66, 0.68, 0.06, 12)),
      brassMat,
    );
    brassCollar.position.y = 0.26;
    root.add(brassCollar);

    // Outer observatory sweep-radius dial ring
    const dialRing = new THREE.Mesh(
      this.getGeo('laser_dial_ring', () => {
        const g = new THREE.RingGeometry(0.95, 1.0, 36);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      dialRingMat,
    );
    dialRing.scale.setScalar(beamLength);
    dialRing.position.y = 0.032;
    root.add(dialRing);

    // Horizontal toothed clockwork gear wheel
    const lowerGearGroup = new THREE.Group();
    lowerGearGroup.position.y = 0.33;
    root.add(lowerGearGroup);

    const gearDisc = new THREE.Mesh(
      this.getGeo('laser_gear_disc', () => new THREE.CylinderGeometry(0.56, 0.56, 0.055, 16)),
      brassMat,
    );
    lowerGearGroup.add(gearDisc);

    const toothBarGeo = this.getGeo(
      'laser_gear_tooth_bar',
      () => new THREE.BoxGeometry(1.3, 0.05, 0.11),
    );
    for (let i = 0; i < 6; i++) {
      const tooth = new THREE.Mesh(toothBarGeo, brassMat);
      tooth.rotation.y = (i / 6) * Math.PI;
      lowerGearGroup.add(tooth);
    }

    // Rotating Clockwork Turret Head & Twin Astral Beams
    const turretHeadGroup = new THREE.Group();
    turretHeadGroup.position.y = 0.88;
    root.add(turretHeadGroup);

    const sideGearGeo = this.getGeo(
      'laser_side_gear',
      () => new THREE.TorusGeometry(0.32, 0.042, 8, 16),
    );
    const sideGears: THREE.Mesh[] = [];
    for (const zSide of [-0.26, 0.26]) {
      const sg = new THREE.Mesh(sideGearGeo, brassMat);
      sg.position.set(0, 0, zSide);
      turretHeadGroup.add(sg);
      sideGears.push(sg);
    }

    const armillaryRing = new THREE.Mesh(
      this.getGeo('laser_armillary', () => new THREE.TorusGeometry(0.46, 0.025, 8, 24)),
      goldMat,
    );
    armillaryRing.rotation.x = Math.PI * 0.32;
    turretHeadGroup.add(armillaryRing);

    const prismCore = new THREE.Mesh(
      this.getGeo('laser_prism', () => new THREE.OctahedronGeometry(0.25, 0)),
      beamCoreMat,
    );
    prismCore.castShadow = true;
    turretHeadGroup.add(prismCore);

    // Twin brass emitter lenses along +X and -X
    const nozzleGeo = this.getGeo('laser_nozzle', () => {
      const g = new THREE.CylinderGeometry(0.085, 0.13, 0.28, 10);
      g.rotateZ(Math.PI * 0.5);
      return g;
    });
    for (const xSide of [-0.36, 0.36]) {
      const nozzle = new THREE.Mesh(nozzleGeo, brassMat);
      nozzle.position.set(xSide, 0, 0);
      turretHeadGroup.add(nozzle);
    }

    // Twin opposing sweeping laser beams spanning [-beamLength, +beamLength] along local X
    const beamGroup = new THREE.Group();
    turretHeadGroup.add(beamGroup);

    const coreBeamMesh = new THREE.Mesh(
      this.getGeo('laser_beam_core_unit', () => {
        const g = new THREE.CylinderGeometry(0.036, 0.036, 2.0, 8);
        g.rotateZ(Math.PI * 0.5);
        return g;
      }),
      beamCoreMat,
    );
    coreBeamMesh.scale.set(beamLength, 1, 1);
    beamGroup.add(coreBeamMesh);

    const sheathBeamMesh = new THREE.Mesh(
      this.getGeo('laser_beam_sheath_unit', () => {
        const g = new THREE.CylinderGeometry(0.115, 0.115, 2.0, 10);
        g.rotateZ(Math.PI * 0.5);
        return g;
      }),
      beamSheathMat,
    );
    sheathBeamMesh.scale.set(beamLength, 1, 1);
    beamGroup.add(sheathBeamMesh);

    const tipOrbGeo = this.getGeo('laser_tip_orb', () => new THREE.SphereGeometry(0.14, 10, 8));
    for (const xTip of [-beamLength, beamLength]) {
      const orb = new THREE.Mesh(tipOrbGeo, beamCoreMat);
      orb.position.set(xTip, 0, 0);
      beamGroup.add(orb);
    }

    return {
      kind: 'astral_laser',
      root,
      lowerGearGroup,
      turretHeadGroup,
      sideGears,
      armillaryRing,
      prismCore,
      beamGroup,
      beamCoreMat,
      beamSheathMat,
      dialRingMat,
      beamLength,
    };
  }

  buildBarrel(materials: IMaterialLibrary, yaw: number, scaleVar: number): DestructibleVisuals {
    const root = new THREE.Group();
    root.name = 'prop_breakable_barrel';
    root.rotation.y = yaw;
    root.scale.setScalar(scaleVar);

    const woodMat = this.sharedMat(materials, 'wood_oak');
    const ironMat = this.sharedMat(materials, 'metal_dark_iron');
    const goldMat = this.sharedMat(materials, 'metal_gold');

    const intactGroup = new THREE.Group();
    root.add(intactGroup);

    // Curved oak stave barrel body
    const body = new THREE.Mesh(
      this.getGeo('barrel_body', () => {
        const pts = [
          new THREE.Vector2(0.0, 0.02),
          new THREE.Vector2(0.34, 0.02),
          new THREE.Vector2(0.42, 0.24),
          new THREE.Vector2(0.45, 0.48),
          new THREE.Vector2(0.42, 0.72),
          new THREE.Vector2(0.34, 0.94),
          new THREE.Vector2(0.29, 0.94),
          new THREE.Vector2(0.29, 0.89),
          new THREE.Vector2(0.0, 0.89),
        ];
        return new THREE.LatheGeometry(pts, 12);
      }),
      woodMat,
    );
    body.castShadow = true;
    body.receiveShadow = true;
    intactGroup.add(body);

    // Iron bands
    const bandMidGeo = this.getGeo('barrel_band_mid', () => {
      const g = new THREE.TorusGeometry(0.435, 0.024, 6, 14);
      g.rotateX(Math.PI * 0.5);
      return g;
    });
    const bandEdgeGeo = this.getGeo('barrel_band_edge', () => {
      const g = new THREE.TorusGeometry(0.365, 0.022, 6, 14);
      g.rotateX(Math.PI * 0.5);
      return g;
    });

    const bandBottom = new THREE.Mesh(bandEdgeGeo, ironMat);
    bandBottom.position.y = 0.14;
    intactGroup.add(bandBottom);

    const bandCenter = new THREE.Mesh(bandMidGeo, ironMat);
    bandCenter.position.y = 0.48;
    intactGroup.add(bandCenter);

    const bandTop = new THREE.Mesh(bandEdgeGeo, ironMat);
    bandTop.position.y = 0.82;
    intactGroup.add(bandTop);

    // Brass bung plug on top lid
    const stopper = new THREE.Mesh(
      this.getGeo('barrel_stopper', () => new THREE.CylinderGeometry(0.04, 0.035, 0.05, 8)),
      goldMat,
    );
    stopper.position.set(0.12, 0.91, 0.06);
    intactGroup.add(stopper);

    // Broken floor remnant (hidden until smashed)
    const remnantGroup = new THREE.Group();
    remnantGroup.visible = false;
    root.add(remnantGroup);

    const brokenBase = new THREE.Mesh(
      this.getGeo('barrel_remnant_base', () => new THREE.CylinderGeometry(0.36, 0.34, 0.08, 10)),
      woodMat,
    );
    brokenBase.position.y = 0.04;
    brokenBase.receiveShadow = true;
    remnantGroup.add(brokenBase);

    const fallenBand = new THREE.Mesh(bandEdgeGeo, ironMat);
    fallenBand.position.set(0.06, 0.05, -0.04);
    fallenBand.rotation.set(0.14, 0.4, -0.1);
    remnantGroup.add(fallenBand);

    return {
      kind: 'breakable_barrel',
      root,
      intactGroup,
      remnantGroup,
    };
  }

  buildUrn(materials: IMaterialLibrary, yaw: number, scaleVar: number): DestructibleVisuals {
    const root = new THREE.Group();
    root.name = 'prop_breakable_urn';
    root.rotation.y = yaw;
    root.scale.setScalar(scaleVar);

    const clayMat = this.sharedMat(materials, 'bone');
    const stoneMat = this.sharedMat(materials, 'wall_stone');
    const goldMat = this.sharedMat(materials, 'metal_gold');

    const intactGroup = new THREE.Group();
    root.add(intactGroup);

    // Sculpted ancient amphora profile
    const amphora = new THREE.Mesh(
      this.getGeo('urn_amphora', () => {
        const pts = [
          new THREE.Vector2(0.0, 0.0),
          new THREE.Vector2(0.2, 0.0),
          new THREE.Vector2(0.16, 0.1),
          new THREE.Vector2(0.35, 0.38),
          new THREE.Vector2(0.33, 0.56),
          new THREE.Vector2(0.14, 0.74),
          new THREE.Vector2(0.23, 0.88),
          new THREE.Vector2(0.19, 0.9),
          new THREE.Vector2(0.11, 0.75),
          new THREE.Vector2(0.0, 0.72),
        ];
        return new THREE.LatheGeometry(pts, 14);
      }),
      clayMat,
    );
    amphora.castShadow = true;
    amphora.receiveShadow = true;
    intactGroup.add(amphora);

    // Gilded shoulder ring
    const goldRing = new THREE.Mesh(
      this.getGeo('urn_gold_ring', () => {
        const g = new THREE.TorusGeometry(0.29, 0.022, 6, 16);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      goldMat,
    );
    goldRing.position.y = 0.6;
    intactGroup.add(goldRing);

    // Twin amphora loop handles
    const handleGeo = this.getGeo(
      'urn_handle',
      () => new THREE.TorusGeometry(0.13, 0.022, 6, 10, Math.PI * 1.15),
    );
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(handleGeo, goldMat);
      handle.position.set(side * 0.2, 0.64, 0);
      handle.rotation.z = side < 0 ? Math.PI * 0.45 : -Math.PI * 0.45;
      intactGroup.add(handle);
    }

    // Broken base remnant
    const remnantGroup = new THREE.Group();
    remnantGroup.visible = false;
    root.add(remnantGroup);

    const footShard = new THREE.Mesh(
      this.getGeo('urn_remnant_foot', () => new THREE.CylinderGeometry(0.22, 0.19, 0.09, 9)),
      stoneMat,
    );
    footShard.position.y = 0.045;
    footShard.receiveShadow = true;
    remnantGroup.add(footShard);

    return {
      kind: 'breakable_urn',
      root,
      intactGroup,
      remnantGroup,
    };
  }

  spawnShatterDebris(
    kind: 'breakable_barrel' | 'breakable_urn',
    origin: { x: number; y: number; z: number },
    parentGroup: THREE.Group,
    materials: IMaterialLibrary,
    seedOffset: number,
  ): ShatterDebrisPiece[] {
    const pieces: ShatterDebrisPiece[] = [];
    const isBarrel = kind === 'breakable_barrel';
    const primaryMat = this.sharedMat(materials, isBarrel ? 'wood_oak' : 'bone');
    const accentMat = this.sharedMat(materials, isBarrel ? 'metal_dark_iron' : 'metal_gold');
    const shardGeo = isBarrel
      ? this.getGeo('debris_stave', () => new THREE.BoxGeometry(0.09, 0.34, 0.035))
      : this.getGeo('debris_pot_shard', () => new THREE.ConeGeometry(0.11, 0.22, 4));

    const count = 7;
    for (let i = 0; i < count; i++) {
      const angle = ((i + (seedOffset % 5) * 0.17) / count) * Math.PI * 2;
      const speed = 2.1 + ((i * 7 + seedOffset) % 5) * 0.45;
      const mesh = new THREE.Mesh(shardGeo, i % 3 === 0 ? accentMat : primaryMat);
      mesh.position.set(
        origin.x + Math.cos(angle) * 0.18,
        origin.y + 0.35 + (i % 3) * 0.12,
        origin.z + Math.sin(angle) * 0.18,
      );
      mesh.rotation.set(i * 0.7, angle, i * 0.4);
      mesh.castShadow = true;
      parentGroup.add(mesh);

      pieces.push({
        mesh,
        vx: Math.cos(angle) * speed,
        vy: 3.1 + (i % 3) * 0.85,
        vz: Math.sin(angle) * speed,
        rx: (i % 2 === 0 ? 1 : -1) * (5 + i),
        ry: 4.5,
        rz: (i % 2 === 0 ? -1 : 1) * (6 + i),
        age: 0,
        lifetime: 0.62,
      });
    }

    return pieces;
  }

  dispose(): void {
    for (const geo of this.geometries.values()) {
      geo.dispose();
    }
    this.geometries.clear();

    for (const mat of this.ownedMaterials) {
      mat.dispose();
    }
    this.ownedMaterials.clear();
  }
}
