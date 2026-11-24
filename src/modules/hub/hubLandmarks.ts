import * as THREE from 'three';
import type {
  DungeonFloorData,
  IMaterialLibrary,
  InteractableType,
  Vec3,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { SANCTUARY_LANDMARK_POSITIONS } from './sanctuaryFloor';
import type { SharedHubResourceTracker } from './trainingDummy';

export interface HubSceneHandle {
  readonly group: THREE.Group;
  update(dt: number, elapsedSec: number, playerPos: Vec3): void;
}

function findInteractablePos(
  floor: DungeonFloorData,
  type: InteractableType,
  fallback: Vec3,
): Vec3 {
  const match = floor.interactables?.find((p) => p.type === type);
  if (match && Number.isFinite(match.position.x) && Number.isFinite(match.position.z)) {
    return {
      x: match.position.x,
      y: Number.isFinite(match.position.y) ? match.position.y : 0,
      z: match.position.z,
    };
  }
  return { ...fallback };
}

export function buildSanctuaryLandmarks(
  floor: DungeonFloorData,
  materials: IMaterialLibrary,
  tracker: SharedHubResourceTracker,
): HubSceneHandle {
  const root = new THREE.Group();
  root.name = 'SanctuaryHubLandmarks';

  const updaters: Array<(dt: number, elapsedSec: number, playerPos: Vec3) => void> = [];

  const waypointPos = findInteractablePos(
    floor,
    'waypoint_map',
    SANCTUARY_LANDMARK_POSITIONS.waypointPlaza,
  );
  const forgePos = findInteractablePos(
    floor,
    'blacksmith_anvil',
    SANCTUARY_LANDMARK_POSITIONS.blacksmithAnvil,
  );
  const stashPos = findInteractablePos(
    floor,
    'stash_chest',
    SANCTUARY_LANDMARK_POSITIONS.stashVault,
  );
  const gamblerPos = findInteractablePos(
    floor,
    'gambler_npc',
    SANCTUARY_LANDMARK_POSITIONS.gamblerTent,
  );
  const companionPos = findInteractablePos(
    floor,
    'companion_shrine',
    SANCTUARY_LANDMARK_POSITIONS.companionShrine,
  );
  const dummyPos = findInteractablePos(
    floor,
    'training_dummy',
    SANCTUARY_LANDMARK_POSITIONS.trainingDummy,
  );

  // =========================================================================
  // 1. ASTRAL WAYPOINT SUN-DIAL PLAZA (Center Courtyard)
  // =========================================================================
  {
    const sundialGroup = new THREE.Group();
    sundialGroup.name = 'Landmark_AstralWaypointSundial';
    sundialGroup.position.set(waypointPos.x, waypointPos.y, waypointPos.z);
    root.add(sundialGroup);

    const obsidianMat = materials.get('wall_obsidian');
    const stoneMat = materials.get('wall_stone');
    const goldMat = materials.get('metal_gold');
    const brassMat = materials.get('brass_clockwork');
    const crimsonClothMat = materials.get('cloth_crimson');

    const astralRuneMat = tracker.cloneMaterial(materials, 'rune_glow_blue');
    astralRuneMat.emissive = new THREE.Color(0x38b6ff);
    astralRuneMat.emissiveIntensity = 1.65;

    const starCrystalMat = tracker.cloneMaterial(materials, 'crystal_cyan');
    starCrystalMat.emissive = new THREE.Color(0x66e6ff);
    starCrystalMat.emissiveIntensity = 1.9;

    // Ground-flush stepped obsidian & gold astrolabe mosaic (walkable height <= 0.05m)
    const outerMosaic = new THREE.Mesh(
      tracker.getGeometry('sundial_outer_disc', () => new THREE.CylinderGeometry(5.2, 5.35, 0.04, 32)),
      obsidianMat,
    );
    outerMosaic.position.set(0, 0.02, 0);
    outerMosaic.receiveShadow = true;
    sundialGroup.add(outerMosaic);

    const brassRim = new THREE.Mesh(
      tracker.getGeometry('sundial_outer_rim', () => {
        const g = new THREE.TorusGeometry(5.22, 0.09, 8, 40);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      goldMat,
    );
    brassRim.position.set(0, 0.045, 0);
    sundialGroup.add(brassRim);

    // 8 Cardinal & Diagonal Golden Sun-Ray Pointers
    const sunRayGeom = tracker.getGeometry(
      'sundial_sunray',
      () => new THREE.ConeGeometry(0.28, 2.35, 4),
    );
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const isCardinal = i % 2 === 0;
      const ray = new THREE.Mesh(sunRayGeom, isCardinal ? goldMat : brassMat);
      const rDist = isCardinal ? 3.55 : 3.15;
      ray.position.set(Math.sin(angle) * rDist, 0.042, Math.cos(angle) * rDist);
      ray.rotation.x = Math.PI * 0.5;
      ray.rotation.z = -angle;
      ray.scale.set(isCardinal ? 1.15 : 0.8, isCardinal ? 1.15 : 0.85, 0.14);
      sundialGroup.add(ray);
    }

    // Royal Crimson & Gold Processional Runner Carpet leading toward playerSpawn (+Z)
    const carpetRunner = new THREE.Mesh(
      tracker.getGeometry('sundial_carpet', () => new THREE.BoxGeometry(2.3, 0.024, 5.4)),
      crimsonClothMat,
    );
    carpetRunner.position.set(0, 0.014, 7.6);
    carpetRunner.receiveShadow = true;
    sundialGroup.add(carpetRunner);

    const carpetBorderGeom = tracker.getGeometry(
      'sundial_carpet_trim',
      () => new THREE.BoxGeometry(0.12, 0.028, 5.4),
    );
    for (const side of [-1, 1]) {
      const border = new THREE.Mesh(carpetBorderGeom, goldMat);
      border.position.set(side * 1.12, 0.016, 7.6);
      sundialGroup.add(border);
    }

    // Three counter-rotating inlaid & hovering Celestial Astrolabe Rings
    const zodiacRingOuter = new THREE.Group();
    zodiacRingOuter.position.set(0, 0.06, 0);
    sundialGroup.add(zodiacRingOuter);

    const ringOuterMesh = new THREE.Mesh(
      tracker.getGeometry('sundial_ring_outer', () => {
        const g = new THREE.TorusGeometry(3.85, 0.075, 8, 36);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      brassMat,
    );
    zodiacRingOuter.add(ringOuterMesh);

    const zodiacGemGeom = tracker.getGeometry(
      'sundial_zodiac_gem',
      () => new THREE.OctahedronGeometry(0.11, 0),
    );
    for (let z = 0; z < 12; z++) {
      const za = (z / 12) * Math.PI * 2;
      const gem = new THREE.Mesh(zodiacGemGeom, astralRuneMat);
      gem.position.set(Math.cos(za) * 3.85, 0.05, Math.sin(za) * 3.85);
      zodiacRingOuter.add(gem);
    }

    const zodiacRingInner = new THREE.Mesh(
      tracker.getGeometry('sundial_ring_inner', () => {
        const g = new THREE.TorusGeometry(2.25, 0.065, 8, 32);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      astralRuneMat,
    );
    zodiacRingInner.position.set(0, 0.065, 0);
    sundialGroup.add(zodiacRingInner);

    // Central Sundial Gnomon Pedestal + Floating Celestial Armillary Orrery
    const centerDais = new THREE.Mesh(
      tracker.getGeometry('sundial_center_dais', () => new THREE.CylinderGeometry(0.82, 1.05, 0.24, 16)),
      stoneMat,
    );
    centerDais.position.set(0, 0.12, 0);
    centerDais.castShadow = true;
    centerDais.receiveShadow = true;
    sundialGroup.add(centerDais);

    const gnomonBlade = new THREE.Mesh(
      tracker.getGeometry('sundial_gnomon', () => new THREE.ConeGeometry(0.32, 1.25, 4)),
      goldMat,
    );
    gnomonBlade.position.set(0, 0.82, -0.08);
    gnomonBlade.rotation.x = -0.24;
    gnomonBlade.scale.set(0.38, 1.0, 1.15);
    gnomonBlade.castShadow = true;
    sundialGroup.add(gnomonBlade);

    const orreryHub = new THREE.Group();
    orreryHub.position.set(0, 1.95, 0);
    sundialGroup.add(orreryHub);

    const starCore = new THREE.Mesh(
      tracker.getGeometry('sundial_star_core', () => new THREE.OctahedronGeometry(0.34, 1)),
      starCrystalMat,
    );
    orreryHub.add(starCore);

    const gimbalRing1 = new THREE.Mesh(
      tracker.getGeometry('sundial_gimbal1', () => new THREE.TorusGeometry(0.68, 0.032, 8, 28)),
      goldMat,
    );
    orreryHub.add(gimbalRing1);

    const gimbalRing2 = new THREE.Mesh(
      tracker.getGeometry('sundial_gimbal2', () => new THREE.TorusGeometry(0.88, 0.028, 8, 28)),
      astralRuneMat,
    );
    orreryHub.add(gimbalRing2);

    // 4 Corner Constellation Obelisk Pylons framing the Plaza
    const pylonShaftGeom = tracker.getGeometry(
      'sundial_pylon_shaft',
      () => new THREE.CylinderGeometry(0.24, 0.36, 2.5, 6),
    );
    const pylonBaseGeom = tracker.getGeometry(
      'sundial_pylon_base',
      () => new THREE.CylinderGeometry(0.52, 0.62, 0.28, 6),
    );
    const pylonCrystals: THREE.Mesh[] = [];
    const pylonOffsets: ReadonlyArray<readonly [number, number]> = [
      [-5.6, -5.2],
      [5.6, -5.2],
      [-5.6, 5.2],
      [5.6, 5.2],
    ];
    for (let i = 0; i < pylonOffsets.length; i++) {
      const [px, pz] = pylonOffsets[i];
      const pylon = new THREE.Group();
      pylon.position.set(px, 0, pz);

      const base = new THREE.Mesh(pylonBaseGeom, stoneMat);
      base.position.set(0, 0.14, 0);
      base.castShadow = true;
      pylon.add(base);

      const shaft = new THREE.Mesh(pylonShaftGeom, obsidianMat);
      shaft.position.set(0, 1.5, 0);
      shaft.castShadow = true;
      pylon.add(shaft);

      const shard = new THREE.Mesh(zodiacGemGeom, starCrystalMat);
      shard.scale.setScalar(1.85);
      shard.position.set(0, 3.05, 0);
      pylon.add(shard);
      pylonCrystals.push(shard);

      sundialGroup.add(pylon);
    }

    const sundialLight = new THREE.PointLight(0x4cc9ff, 2.2, 16, 1.6);
    sundialLight.position.set(0, 2.3, 0);
    sundialGroup.add(sundialLight);

    updaters.push((_dt, elapsedSec, playerPos) => {
      const d = distXZ(playerPos, waypointPos);
      const prox = clamp(1 - (d - 2.0) / 5.5, 0, 1);
      const speedMult = 1.0 + prox * 2.2;

      zodiacRingOuter.rotation.y = elapsedSec * 0.18 * speedMult;
      zodiacRingInner.rotation.y = -elapsedSec * 0.34 * speedMult;

      orreryHub.position.y = 1.95 + Math.sin(elapsedSec * 2.2) * 0.12 + prox * 0.14;
      starCore.rotation.y = elapsedSec * 1.4 * speedMult;
      starCore.rotation.x = elapsedSec * 0.7;
      gimbalRing1.rotation.x = elapsedSec * 1.1 * speedMult;
      gimbalRing1.rotation.y = elapsedSec * 0.65;
      gimbalRing2.rotation.y = -elapsedSec * 1.35 * speedMult;
      gimbalRing2.rotation.z = Math.sin(elapsedSec * 0.9) * 0.65;

      astralRuneMat.emissiveIntensity = 1.35 + prox * 1.15 + Math.sin(elapsedSec * 3.2) * 0.25;
      starCrystalMat.emissiveIntensity = 1.65 + prox * 1.35 + Math.cos(elapsedSec * 4.0) * 0.25;
      sundialLight.intensity = 1.9 + prox * 1.4 + Math.sin(elapsedSec * 3.5) * 0.2;

      for (let i = 0; i < pylonCrystals.length; i++) {
        const c = pylonCrystals[i];
        c.position.y = 3.05 + Math.sin(elapsedSec * 2.4 + i * 1.57) * 0.1;
        c.rotation.y = elapsedSec * 1.6 + i;
      }
    });
  }

  // =========================================================================
  // 2. ROARING BLACKSMITH FURNACE & ANVIL PAVILION (West Wing)
  // =========================================================================
  {
    const forgeGroup = new THREE.Group();
    forgeGroup.name = 'Landmark_BlacksmithPavilion';
    forgeGroup.position.set(forgePos.x, forgePos.y, forgePos.z);
    root.add(forgeGroup);

    const woodMat = materials.get('wood_oak');
    const darkIronMat = materials.get('metal_dark_iron');
    const steelMat = materials.get('metal_steel');
    const stoneMat = materials.get('wall_stone');
    const obsidianMat = materials.get('wall_obsidian');
    const goldMat = materials.get('metal_gold');
    const brassMat = materials.get('brass_clockwork');
    const leatherMat = materials.get('cloth_crimson');

    const magmaMat = tracker.cloneMaterial(materials, 'lava_emissive');
    magmaMat.emissive = new THREE.Color(0xff5500);
    magmaMat.emissiveIntensity = 2.2;

    const flameMat = tracker.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xff8c1a,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    // Runeforge Hearth Inlay Ring framing the central Anvil
    const hearthRing = new THREE.Mesh(
      tracker.getGeometry('forge_hearth_ring', () => {
        const g = new THREE.TorusGeometry(1.75, 0.08, 8, 28);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      magmaMat,
    );
    hearthRing.position.set(0, 0.03, 0);
    forgeGroup.add(hearthRing);

    // 4 Heavy Timber & Iron-Banded Pavilion Columns + Pitched Forge Canopy
    const colGeom = tracker.getGeometry(
      'forge_pavilion_col',
      () => new THREE.BoxGeometry(0.32, 3.4, 0.32),
    );
    const plinthGeom = tracker.getGeometry(
      'forge_pavilion_plinth',
      () => new THREE.BoxGeometry(0.54, 0.26, 0.54),
    );
    const pillarCoords: ReadonlyArray<readonly [number, number]> = [
      [-3.4, -3.2],
      [2.8, -3.2],
      [-3.4, 3.2],
      [2.8, 3.2],
    ];
    for (const [px, pz] of pillarCoords) {
      const plinth = new THREE.Mesh(plinthGeom, stoneMat);
      plinth.position.set(px, 0.13, pz);
      plinth.castShadow = true;
      forgeGroup.add(plinth);

      const post = new THREE.Mesh(colGeom, woodMat);
      post.position.set(px, 1.7, pz);
      post.castShadow = true;
      forgeGroup.add(post);
    }

    // Overhead Timber Crossbeams & Pitched Dark-Iron Canopy Slopes
    const beamXGeom = tracker.getGeometry(
      'forge_beam_x',
      () => new THREE.BoxGeometry(6.6, 0.24, 0.26),
    );
    for (const bz of [-3.2, 3.2]) {
      const beam = new THREE.Mesh(beamXGeom, woodMat);
      beam.position.set(-0.3, 3.42, bz);
      beam.castShadow = true;
      forgeGroup.add(beam);
    }

    const roofSlopeGeom = tracker.getGeometry(
      'forge_roof_slope',
      () => new THREE.BoxGeometry(6.8, 0.12, 3.75),
    );
    for (const side of [-1, 1]) {
      const slope = new THREE.Mesh(roofSlopeGeom, darkIronMat);
      slope.position.set(-0.3, 3.95, side * 1.65);
      slope.rotation.x = side * 0.30;
      slope.castShadow = true;
      forgeGroup.add(slope);
    }

    // Roaring Stone & Obsidian Blast Furnace (at x = -2.55, facing +X toward Plaza)
    const furnaceGroup = new THREE.Group();
    furnaceGroup.position.set(-2.55, 0, 0);
    forgeGroup.add(furnaceGroup);

    const furnaceBase = new THREE.Mesh(
      tracker.getGeometry('forge_furnace_base', () => new THREE.BoxGeometry(1.85, 2.45, 2.65)),
      obsidianMat,
    );
    furnaceBase.position.set(0, 1.22, 0);
    furnaceBase.castShadow = true;
    furnaceBase.receiveShadow = true;
    furnaceGroup.add(furnaceBase);

    const chimneyStack = new THREE.Mesh(
      tracker.getGeometry('forge_chimney', () => new THREE.CylinderGeometry(0.56, 0.86, 2.6, 8)),
      stoneMat,
    );
    chimneyStack.position.set(-0.15, 3.65, 0);
    chimneyStack.castShadow = true;
    furnaceGroup.add(chimneyStack);

    // Glowing Molten Core Maw on +X face of furnace
    const furnaceMaw = new THREE.Mesh(
      tracker.getGeometry('forge_maw', () => new THREE.CylinderGeometry(0.62, 0.68, 0.28, 12)),
      magmaMat,
    );
    furnaceMaw.rotation.z = Math.PI * 0.5;
    furnaceMaw.position.set(0.88, 0.95, 0);
    furnaceGroup.add(furnaceMaw);

    // Animated Roaring Furnace Flame Cones
    const furnaceFlames: THREE.Mesh[] = [];
    const flameConeGeom = tracker.getGeometry(
      'forge_flame_cone',
      () => new THREE.ConeGeometry(0.24, 0.78, 7),
    );
    for (let f = 0; f < 3; f++) {
      const fc = new THREE.Mesh(flameConeGeom, flameMat);
      fc.position.set(0.95, 0.92, (f - 1) * 0.32);
      fc.rotation.z = -0.35;
      furnaceGroup.add(fc);
      furnaceFlames.push(fc);
    }

    // Molten Slag Trough & Glowing Ingot Molds beside furnace (+Z side)
    const slagTrough = new THREE.Mesh(
      tracker.getGeometry('forge_trough', () => new THREE.BoxGeometry(1.45, 0.26, 0.48)),
      darkIronMat,
    );
    slagTrough.position.set(0.55, 0.13, 1.68);
    furnaceGroup.add(slagTrough);

    const moltenStream = new THREE.Mesh(
      tracker.getGeometry('forge_molten_stream', () => new THREE.BoxGeometry(1.28, 0.08, 0.28)),
      magmaMat,
    );
    moltenStream.position.set(0.55, 0.25, 1.68);
    furnaceGroup.add(moltenStream);

    // Secondary Runesmith Finishing Anvil (ensures an anvil silhouette is always visible even standalone)
    const sideStump = new THREE.Mesh(
      tracker.getGeometry('forge_side_stump', () => new THREE.CylinderGeometry(0.32, 0.36, 0.48, 10)),
      woodMat,
    );
    sideStump.position.set(1.55, 0.24, -1.85);
    sideStump.castShadow = true;
    forgeGroup.add(sideStump);

    const sideAnvil = new THREE.Mesh(
      tracker.getGeometry('forge_side_anvil', () => new THREE.BoxGeometry(0.68, 0.26, 0.32)),
      steelMat,
    );
    sideAnvil.position.set(1.55, 0.60, -1.85);
    sideAnvil.castShadow = true;
    forgeGroup.add(sideAnvil);

    // Animated Pumping Leather & Oak Bellows (-Z side of furnace)
    const bellowsPivot = new THREE.Group();
    bellowsPivot.position.set(0.35, 0.55, -1.85);
    furnaceGroup.add(bellowsPivot);

    const bellowsBag = new THREE.Mesh(
      tracker.getGeometry('forge_bellows_bag', () => new THREE.CylinderGeometry(0.38, 0.52, 0.44, 8)),
      leatherMat,
    );
    bellowsBag.position.set(0, 0.22, 0);
    bellowsPivot.add(bellowsBag);

    const bellowsTopPaddle = new THREE.Mesh(
      tracker.getGeometry('forge_bellows_paddle', () => new THREE.BoxGeometry(0.95, 0.08, 0.72)),
      woodMat,
    );
    bellowsTopPaddle.position.set(0.08, 0.46, 0);
    bellowsPivot.add(bellowsTopPaddle);

    const bellowsNozzle = new THREE.Mesh(
      tracker.getGeometry('forge_bellows_nozzle', () => {
        const g = new THREE.ConeGeometry(0.10, 0.55, 8);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      brassMat,
    );
    bellowsNozzle.position.set(-0.2, 0.22, 0.55);
    bellowsPivot.add(bellowsNozzle);

    // Master Armorer's Weapon & Shield Rack (south side of Pavilion)
    const rackGroup = new THREE.Group();
    rackGroup.position.set(1.4, 0, 2.35);
    forgeGroup.add(rackGroup);

    const rackFrame = new THREE.Mesh(
      tracker.getGeometry('forge_rack_frame', () => new THREE.BoxGeometry(1.75, 1.35, 0.22)),
      woodMat,
    );
    rackFrame.position.set(0, 0.68, 0);
    rackFrame.castShadow = true;
    rackGroup.add(rackFrame);

    const bladeGeom = tracker.getGeometry(
      'forge_rack_blade',
      () => new THREE.BoxGeometry(0.10, 1.28, 0.04),
    );
    for (let b = -1; b <= 1; b++) {
      const sword = new THREE.Mesh(bladeGeom, b === 0 ? goldMat : steelMat);
      sword.position.set(b * 0.44, 0.92, 0.14);
      sword.rotation.z = b * 0.08;
      sword.castShadow = true;
      rackGroup.add(sword);
    }

    const forgeLight = new THREE.PointLight(0xff6b1a, 2.6, 15, 1.5);
    forgeLight.position.set(-1.3, 1.6, 0);
    forgeGroup.add(forgeLight);

    updaters.push((_dt, elapsedSec) => {
      // Rhythmic bellows pump cycle fanning the blast furnace!
      const pumpCycle = 0.5 + 0.5 * Math.sin(elapsedSec * 2.8);
      bellowsBag.scale.set(1.0, 0.55 + pumpCycle * 0.55, 1.0);
      bellowsTopPaddle.position.y = 0.28 + pumpCycle * 0.24;
      bellowsTopPaddle.rotation.z = (1 - pumpCycle) * -0.18;

      const blastSurge = 1 - pumpCycle;
      magmaMat.emissiveIntensity = 1.85 + blastSurge * 1.15 + Math.sin(elapsedSec * 9.0) * 0.2;
      forgeLight.intensity = 2.2 + blastSurge * 1.1 + Math.sin(elapsedSec * 11.3) * 0.22;

      for (let i = 0; i < furnaceFlames.length; i++) {
        const fc = furnaceFlames[i];
        const flicker = 0.85 + blastSurge * 0.55 + Math.sin(elapsedSec * 12.0 + i * 2.1) * 0.22;
        fc.scale.set(0.9 + blastSurge * 0.2, flicker, 0.9 + blastSurge * 0.2);
      }
    });
  }

  // =========================================================================
  // 3. MYSTIC VELVET GAMBLER TENT + CRIMSON BLOOD ALTAR FOUNTAIN (East Wing North)
  // =========================================================================
  {
    const bazaarGroup = new THREE.Group();
    bazaarGroup.name = 'Landmark_GamblerTentAndBloodAltar';
    bazaarGroup.position.set(gamblerPos.x, gamblerPos.y, gamblerPos.z);
    root.add(bazaarGroup);

    const arcaneClothMat = materials.get('cloth_arcane');
    const crimsonClothMat = materials.get('cloth_crimson');
    const shadowClothMat = materials.get('cloth_shadow');
    const goldMat = materials.get('metal_gold');
    const brassMat = materials.get('brass_clockwork');
    const woodMat = materials.get('wood_oak');
    const obsidianMat = materials.get('wall_obsidian');
    const boneMat = materials.get('bone');

    const voidOrbMat = tracker.cloneMaterial(materials, 'rune_glow_void');
    voidOrbMat.emissive = new THREE.Color(0xc259ff);
    voidOrbMat.emissiveIntensity = 1.85;

    const bloodFluidMat = tracker.cloneMaterial(materials, 'mythic_crimson');
    bloodFluidMat.emissive = new THREE.Color(0xff1438);
    bloodFluidMat.emissiveIntensity = 1.95;

    // --- Part A: Mystic Velvet Gambler Tent (centered slightly back at (+0.8, 0, -0.5)) ---
    const tentGroup = new THREE.Group();
    tentGroup.position.set(0.9, 0, -0.4);
    bazaarGroup.add(tentGroup);

    // Octagonal Velvet Rug
    const rug = new THREE.Mesh(
      tracker.getGeometry('gambler_rug', () => new THREE.CylinderGeometry(2.75, 2.8, 0.03, 8)),
      crimsonClothMat,
    );
    rug.position.set(0, 0.016, 0);
    rug.receiveShadow = true;
    tentGroup.add(rug);

    // 6 Brass Tent Poles + Conical Draped Velvet Canopy + Golden Crescent Finial
    const poleGeom = tracker.getGeometry(
      'gambler_pole',
      () => new THREE.CylinderGeometry(0.055, 0.065, 2.85, 8),
    );
    for (let p = 0; p < 6; p++) {
      // Leave front-west arc open toward approaching hero!
      const angle = -Math.PI * 0.42 + (p / 5) * Math.PI * 1.35;
      const pole = new THREE.Mesh(poleGeom, brassMat);
      pole.position.set(Math.cos(angle) * 2.45, 1.42, Math.sin(angle) * 2.45);
      pole.castShadow = true;
      tentGroup.add(pole);
    }

    const canopyCone = new THREE.Mesh(
      tracker.getGeometry('gambler_canopy', () => new THREE.ConeGeometry(2.95, 1.55, 8)),
      arcaneClothMat,
    );
    canopyCone.position.set(0, 3.55, 0);
    canopyCone.castShadow = true;
    tentGroup.add(canopyCone);

    const valanceRing = new THREE.Mesh(
      tracker.getGeometry('gambler_valance', () => new THREE.CylinderGeometry(2.85, 2.98, 0.34, 8, 1, true)),
      crimsonClothMat,
    );
    valanceRing.position.set(0, 2.72, 0);
    tentGroup.add(valanceRing);

    const finial = new THREE.Mesh(
      tracker.getGeometry('gambler_finial', () => new THREE.OctahedronGeometry(0.24, 0)),
      goldMat,
    );
    finial.position.set(0, 4.45, 0);
    tentGroup.add(finial);

    // Fortune-Teller's Draped Table + Levitating Crystal Ball + Orbiting Tarot Cards
    const fortuneTable = new THREE.Mesh(
      tracker.getGeometry('gambler_table', () => new THREE.CylinderGeometry(0.82, 0.72, 0.84, 12)),
      arcaneClothMat,
    );
    fortuneTable.position.set(-0.35, 0.42, 0.15);
    fortuneTable.castShadow = true;
    tentGroup.add(fortuneTable);

    const crystalBall = new THREE.Mesh(
      tracker.getGeometry('gambler_orb', () => new THREE.SphereGeometry(0.22, 14, 12)),
      voidOrbMat,
    );
    crystalBall.position.set(-0.35, 1.18, 0.15);
    tentGroup.add(crystalBall);

    const tarotRing = new THREE.Group();
    tarotRing.position.set(-0.35, 1.18, 0.15);
    tentGroup.add(tarotRing);

    const cardGeom = tracker.getGeometry(
      'gambler_tarot',
      () => new THREE.BoxGeometry(0.14, 0.22, 0.015),
    );
    for (let c = 0; c < 5; c++) {
      const ca = (c / 5) * Math.PI * 2;
      const card = new THREE.Mesh(cardGeom, c % 2 === 0 ? goldMat : voidOrbMat);
      card.position.set(Math.cos(ca) * 0.48, 0, Math.sin(ca) * 0.48);
      card.rotation.y = -ca;
      card.rotation.x = 0.28;
      tarotRing.add(card);
    }

    // Vespera the Veiled Gambler (Articulated Mystic Figure behind the table)
    const vesperaGroup = new THREE.Group();
    vesperaGroup.position.set(0.55, 0, -0.15);
    vesperaGroup.rotation.y = -Math.PI * 0.6;
    tentGroup.add(vesperaGroup);

    const robeBody = new THREE.Mesh(
      tracker.getGeometry('vespera_robe', () => new THREE.ConeGeometry(0.42, 1.42, 10)),
      shadowClothMat,
    );
    robeBody.position.set(0, 0.71, 0);
    robeBody.castShadow = true;
    vesperaGroup.add(robeBody);

    const mantle = new THREE.Mesh(
      tracker.getGeometry('vespera_mantle', () => new THREE.CylinderGeometry(0.26, 0.38, 0.36, 10)),
      arcaneClothMat,
    );
    mantle.position.set(0, 1.32, 0);
    vesperaGroup.add(mantle);

    const hood = new THREE.Mesh(
      tracker.getGeometry('vespera_hood', () => new THREE.SphereGeometry(0.22, 10, 8)),
      arcaneClothMat,
    );
    hood.position.set(0, 1.62, 0.02);
    vesperaGroup.add(hood);

    const eyeGeom = tracker.getGeometry('vespera_eye', () => new THREE.SphereGeometry(0.032, 6, 6));
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeom, voidOrbMat);
      eye.position.set(side * 0.07, 1.62, 0.20);
      vesperaGroup.add(eye);
    }

    // --- Part B: Crimson Blood Altar Fountain (set at (-2.35, 0, +1.55) in Gambler's Court) ---
    const altarGroup = new THREE.Group();
    altarGroup.name = 'CrimsonBloodAltarFountain';
    altarGroup.position.set(-2.35, 0, 1.55);
    bazaarGroup.add(altarGroup);

    const lowerBasin = new THREE.Mesh(
      tracker.getGeometry('blood_basin_low', () => new THREE.CylinderGeometry(1.42, 1.56, 0.38, 12)),
      obsidianMat,
    );
    lowerBasin.position.set(0, 0.19, 0);
    lowerBasin.castShadow = true;
    lowerBasin.receiveShadow = true;
    altarGroup.add(lowerBasin);

    const lowerBloodPool = new THREE.Mesh(
      tracker.getGeometry('blood_pool_low', () => new THREE.CylinderGeometry(1.26, 1.26, 0.08, 16)),
      bloodFluidMat,
    );
    lowerBloodPool.position.set(0, 0.36, 0);
    altarGroup.add(lowerBloodPool);

    const centralPillar = new THREE.Mesh(
      tracker.getGeometry('blood_pillar', () => new THREE.CylinderGeometry(0.34, 0.48, 1.25, 8)),
      obsidianMat,
    );
    centralPillar.position.set(0, 0.95, 0);
    centralPillar.castShadow = true;
    altarGroup.add(centralPillar);

    const upperChalice = new THREE.Mesh(
      tracker.getGeometry('blood_chalice', () => new THREE.CylinderGeometry(0.78, 0.32, 0.42, 10)),
      obsidianMat,
    );
    upperChalice.position.set(0, 1.62, 0);
    upperChalice.castShadow = true;
    altarGroup.add(upperChalice);

    const upperBloodPool = new THREE.Mesh(
      tracker.getGeometry('blood_pool_high', () => new THREE.CylinderGeometry(0.68, 0.68, 0.06, 14)),
      bloodFluidMat,
    );
    upperBloodPool.position.set(0, 1.81, 0);
    altarGroup.add(upperBloodPool);

    // 4 Bone Gargoyle Spouts + Cascading Crimson Blood Streams
    const spoutSkullGeom = tracker.getGeometry(
      'blood_spout_skull',
      () => new THREE.DodecahedronGeometry(0.14, 0),
    );
    const streamGeom = tracker.getGeometry(
      'blood_stream',
      () => new THREE.CylinderGeometry(0.035, 0.065, 1.38, 6),
    );
    const bloodStreams: THREE.Mesh[] = [];
    for (let s = 0; s < 4; s++) {
      const sa = s * Math.PI * 0.5 + Math.PI * 0.25;
      const skull = new THREE.Mesh(spoutSkullGeom, boneMat);
      skull.position.set(Math.cos(sa) * 0.76, 1.66, Math.sin(sa) * 0.76);
      altarGroup.add(skull);

      const stream = new THREE.Mesh(streamGeom, bloodFluidMat);
      stream.position.set(Math.cos(sa) * 0.88, 1.0, Math.sin(sa) * 0.88);
      altarGroup.add(stream);
      bloodStreams.push(stream);
    }

    const bloodHeartGem = new THREE.Mesh(
      tracker.getGeometry('blood_heart', () => new THREE.OctahedronGeometry(0.24, 0)),
      bloodFluidMat,
    );
    bloodHeartGem.position.set(0, 2.28, 0);
    altarGroup.add(bloodHeartGem);

    const altarLight = new THREE.PointLight(0xff1e42, 1.9, 11, 1.6);
    altarLight.position.set(-2.35, 2.2, 1.55);
    bazaarGroup.add(altarLight);

    void woodMat;

    updaters.push((_dt, elapsedSec) => {
      crystalBall.position.y = 1.18 + Math.sin(elapsedSec * 2.5) * 0.07;
      tarotRing.rotation.y = elapsedSec * 1.15;
      tarotRing.position.y = 1.18 + Math.cos(elapsedSec * 2.5) * 0.05;
      vesperaGroup.position.y = Math.sin(elapsedSec * 1.8) * 0.035;

      bloodHeartGem.position.y = 2.28 + Math.sin(elapsedSec * 3.1) * 0.10;
      bloodHeartGem.rotation.y = elapsedSec * 1.8;
      const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 4.2);
      bloodFluidMat.emissiveIntensity = 1.65 + pulse * 0.85;
      altarLight.intensity = 1.6 + pulse * 0.75;

      for (let i = 0; i < bloodStreams.length; i++) {
        const st = bloodStreams[i];
        const wave = 0.88 + 0.24 * Math.sin(elapsedSec * 7.5 + i * 1.5);
        st.scale.set(wave, 1.0, wave);
      }
    });
  }

  // =========================================================================
  // 4. GILDED SHARED STASH VAULT (Northwest Plaza Terrace)
  // =========================================================================
  {
    const stashGroup = new THREE.Group();
    stashGroup.name = 'Landmark_GildedStashVault';
    stashGroup.position.set(stashPos.x, stashPos.y, stashPos.z);
    stashGroup.rotation.y = Math.atan2(-stashPos.x, -stashPos.z);
    root.add(stashGroup);

    const obsidianMat = materials.get('wall_obsidian');
    const darkIronMat = materials.get('metal_dark_iron');
    const goldMat = materials.get('metal_gold');
    const brassMat = materials.get('brass_clockwork');
    const crimsonClothMat = materials.get('cloth_crimson');
    const cyanGemMat = materials.get('crystal_cyan');

    const goldAuraMat = tracker.cloneMaterial(materials, 'metal_gold');
    goldAuraMat.emissive = new THREE.Color(0xffb703);
    goldAuraMat.emissiveIntensity = 0.9;

    // Stepped Obsidian & Star-Gold Reliquary Dais
    const daisLow = new THREE.Mesh(
      tracker.getGeometry('stash_dais_low', () => new THREE.BoxGeometry(2.7, 0.14, 2.1)),
      obsidianMat,
    );
    daisLow.position.set(0, 0.07, 0);
    daisLow.receiveShadow = true;
    daisLow.castShadow = true;
    stashGroup.add(daisLow);

    const daisRunner = new THREE.Mesh(
      tracker.getGeometry('stash_runner', () => new THREE.BoxGeometry(1.4, 0.16, 2.16)),
      crimsonClothMat,
    );
    daisRunner.position.set(0, 0.08, 0.04);
    stashGroup.add(daisRunner);

    // 4 Gilded Corner Bollard Posts
    const bollardGeom = tracker.getGeometry(
      'stash_bollard',
      () => new THREE.CylinderGeometry(0.065, 0.085, 0.78, 8),
    );
    const bollardCorners: ReadonlyArray<readonly [number, number]> = [
      [-1.18, -0.88],
      [1.18, -0.88],
      [-1.18, 0.88],
      [1.18, 0.88],
    ];
    for (const [bx, bz] of bollardCorners) {
      const post = new THREE.Mesh(bollardGeom, goldMat);
      post.position.set(bx, 0.52, bz);
      post.castShadow = true;
      stashGroup.add(post);
    }

    // Monumental Iron-and-Gold Vault Strongbox
    const vaultBody = new THREE.Mesh(
      tracker.getGeometry('stash_vault_body', () => new THREE.BoxGeometry(1.56, 0.76, 1.02)),
      darkIronMat,
    );
    vaultBody.position.set(0, 0.52, -0.05);
    vaultBody.castShadow = true;
    vaultBody.receiveShadow = true;
    stashGroup.add(vaultBody);

    // Ornate Gold Ribbing Straps
    const ribGeom = tracker.getGeometry(
      'stash_vault_rib',
      () => new THREE.BoxGeometry(0.12, 0.80, 1.08),
    );
    for (const rx of [-0.62, 0, 0.62]) {
      const rib = new THREE.Mesh(ribGeom, goldMat);
      rib.position.set(rx, 0.52, -0.05);
      stashGroup.add(rib);
    }

    // Interior Golden Hoard (gleams when proximity lid opens!)
    const interiorHoard = new THREE.Mesh(
      tracker.getGeometry('stash_hoard_core', () => new THREE.BoxGeometry(1.36, 0.18, 0.82)),
      goldAuraMat,
    );
    interiorHoard.position.set(0, 0.86, -0.05);
    stashGroup.add(interiorHoard);

    // Hinged Vault Lid + Front Clockwork Combination Rose-Lock
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.90, -0.56);
    stashGroup.add(lidPivot);

    const lidVault = new THREE.Mesh(
      tracker.getGeometry('stash_vault_lid', () => new THREE.BoxGeometry(1.62, 0.24, 1.08)),
      goldMat,
    );
    lidVault.position.set(0, 0.12, 0.51);
    lidVault.castShadow = true;
    lidPivot.add(lidVault);

    const clockworkDial = new THREE.Mesh(
      tracker.getGeometry('stash_dial', () => new THREE.CylinderGeometry(0.24, 0.24, 0.08, 12)),
      brassMat,
    );
    clockworkDial.rotation.x = Math.PI * 0.5;
    clockworkDial.position.set(0, 0.56, 0.49);
    stashGroup.add(clockworkDial);

    // Flanking Gold Bullion Stacks & Crown Jewels
    const ingotGeom = tracker.getGeometry(
      'stash_ingot',
      () => new THREE.BoxGeometry(0.28, 0.09, 0.14),
    );
    for (let i = 0; i < 3; i++) {
      const ingot = new THREE.Mesh(ingotGeom, goldAuraMat);
      ingot.position.set(-0.96, 0.19 + i * 0.09, 0.35 - i * 0.04);
      ingot.rotation.y = 0.25 * i;
      stashGroup.add(ingot);
    }

    const crownGem = new THREE.Mesh(
      tracker.getGeometry('stash_gem', () => new THREE.OctahedronGeometry(0.14, 0)),
      cyanGemMat,
    );
    crownGem.position.set(0.96, 0.28, 0.38);
    stashGroup.add(crownGem);

    let lidBlend = 0;
    updaters.push((dt, elapsedSec, playerPos) => {
      const near = distXZ(playerPos, stashPos) <= 4.2 ? 1 : 0;
      lidBlend = clamp(lidBlend + (near - lidBlend) * Math.min(1, dt * 5.0), 0, 1);

      lidPivot.rotation.x = -0.52 * lidBlend;
      clockworkDial.rotation.z = elapsedSec * (0.45 + lidBlend * 3.2);
      goldAuraMat.emissiveIntensity = 0.65 + lidBlend * 1.45 + Math.sin(elapsedSec * 3.4) * 0.18;
      crownGem.rotation.y = elapsedSec * 1.4;
    });
  }

  // =========================================================================
  // 5. COMPANION MENAGERIE SHRINE (East Wing South)
  // =========================================================================
  {
    const menagerieGroup = new THREE.Group();
    menagerieGroup.name = 'Landmark_CompanionMenagerieShrine';
    menagerieGroup.position.set(companionPos.x, companionPos.y, companionPos.z);
    root.add(menagerieGroup);

    const stoneMat = materials.get('wall_stone');
    const woodMat = materials.get('wood_oak');
    const goldMat = materials.get('metal_gold');
    const steelMat = materials.get('metal_steel');
    const cyanCrystalMat = materials.get('crystal_cyan');

    const emeraldRuneMat = tracker.cloneMaterial(materials, 'rune_glow_emerald');
    emeraldRuneMat.emissive = new THREE.Color(0x28f088);
    emeraldRuneMat.emissiveIntensity = 1.75;

    const emberMat = tracker.cloneMaterial(materials, 'lava_emissive');
    emberMat.emissive = new THREE.Color(0xff6b2b);
    emberMat.emissiveIntensity = 1.8;

    const kitsuneMat = tracker.cloneMaterial(materials, 'rune_glow_void');
    kitsuneMat.emissive = new THREE.Color(0xb14cff);
    kitsuneMat.emissiveIntensity = 1.75;

    // Stepped Sanctuary Grove Dais + Glowing Emerald Rune Ring
    const groveBase = new THREE.Mesh(
      tracker.getGeometry('menagerie_base', () => new THREE.CylinderGeometry(2.55, 2.75, 0.16, 16)),
      stoneMat,
    );
    groveBase.position.set(0, 0.08, 0);
    groveBase.receiveShadow = true;
    menagerieGroup.add(groveBase);

    const emeraldRing = new THREE.Mesh(
      tracker.getGeometry('menagerie_ring', () => {
        const g = new THREE.TorusGeometry(2.15, 0.065, 8, 32);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      emeraldRuneMat,
    );
    emeraldRing.position.set(0, 0.18, 0);
    menagerieGroup.add(emeraldRing);

    // 3 Sculpted Sanctuary Stone Columns + Central Soulbond Prism
    const archColGeom = tracker.getGeometry(
      'menagerie_col',
      () => new THREE.CylinderGeometry(0.18, 0.24, 2.35, 8),
    );
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI * 0.16;
      const col = new THREE.Mesh(archColGeom, stoneMat);
      col.position.set(Math.cos(a) * 2.15, 1.25, Math.sin(a) * 2.15);
      col.castShadow = true;
      menagerieGroup.add(col);
    }

    const soulbondPrism = new THREE.Mesh(
      tracker.getGeometry('menagerie_prism', () => new THREE.OctahedronGeometry(0.32, 0)),
      emeraldRuneMat,
    );
    soulbondPrism.position.set(0, 1.68, 0);
    menagerieGroup.add(soulbondPrism);

    // Familiar Station 1: Celestial Owl Gilded Perch
    const owlStand = new THREE.Mesh(
      tracker.getGeometry('menagerie_owl_perch', () => new THREE.CylinderGeometry(0.05, 0.09, 1.45, 8)),
      goldMat,
    );
    owlStand.position.set(-1.35, 0.88, -0.85);
    menagerieGroup.add(owlStand);

    const owlCrossbar = new THREE.Mesh(
      tracker.getGeometry('menagerie_owl_bar', () => {
        const g = new THREE.CylinderGeometry(0.04, 0.04, 0.52, 8);
        g.rotateZ(Math.PI * 0.5);
        return g;
      }),
      woodMat,
    );
    owlCrossbar.position.set(-1.35, 1.62, -0.85);
    menagerieGroup.add(owlCrossbar);

    const owlCrest = new THREE.Mesh(
      tracker.getGeometry('menagerie_owl_totem', () => new THREE.OctahedronGeometry(0.15, 0)),
      cyanCrystalMat,
    );
    owlCrest.position.set(-1.35, 1.84, -0.85);
    menagerieGroup.add(owlCrest);

    // Familiar Station 2: Ember Wyrmling Volcanic Brazier Nest
    const nestBowl = new THREE.Mesh(
      tracker.getGeometry('menagerie_nest', () => new THREE.CylinderGeometry(0.46, 0.32, 0.36, 10)),
      stoneMat,
    );
    nestBowl.position.set(1.35, 0.34, -0.85);
    menagerieGroup.add(nestBowl);

    const dragonEgg = new THREE.Mesh(
      tracker.getGeometry('menagerie_egg', () => new THREE.SphereGeometry(0.20, 10, 10)),
      emberMat,
    );
    dragonEgg.scale.set(0.85, 1.25, 0.85);
    dragonEgg.position.set(1.35, 0.64, -0.85);
    menagerieGroup.add(dragonEgg);

    // Familiar Station 3: Void Kitsune Spirit Lantern + Orbiting Fox-Fire Wisps
    const lanternPost = new THREE.Mesh(
      tracker.getGeometry('menagerie_lantern', () => new THREE.BoxGeometry(0.28, 1.15, 0.28)),
      stoneMat,
    );
    lanternPost.position.set(0, 0.72, 1.45);
    menagerieGroup.add(lanternPost);

    const kitsuneWispHub = new THREE.Group();
    kitsuneWispHub.position.set(0, 1.42, 1.45);
    menagerieGroup.add(kitsuneWispHub);

    const wispGeom = tracker.getGeometry('menagerie_wisp', () => new THREE.SphereGeometry(0.08, 8, 8));
    for (let w = 0; w < 3; w++) {
      const wa = (w / 3) * Math.PI * 2;
      const wisp = new THREE.Mesh(wispGeom, kitsuneMat);
      wisp.position.set(Math.cos(wa) * 0.32, 0, Math.sin(wa) * 0.32);
      kitsuneWispHub.add(wisp);
    }

    // Mercenary Honor Stand (Templar Kite Shield + Crossed Arms)
    const honorShield = new THREE.Mesh(
      tracker.getGeometry('menagerie_shield', () => new THREE.CylinderGeometry(0.38, 0.20, 0.08, 6)),
      steelMat,
    );
    honorShield.rotation.x = Math.PI * 0.42;
    honorShield.position.set(0, 0.85, -1.65);
    honorShield.castShadow = true;
    menagerieGroup.add(honorShield);

    updaters.push((_dt, elapsedSec) => {
      soulbondPrism.position.y = 1.68 + Math.sin(elapsedSec * 2.2) * 0.12;
      soulbondPrism.rotation.y = elapsedSec * 1.1;
      emeraldRing.rotation.z = elapsedSec * 0.25;
      kitsuneWispHub.rotation.y = -elapsedSec * 2.4;
      owlCrest.rotation.y = elapsedSec * 1.6;
      dragonEgg.scale.setScalar(1.0 + Math.sin(elapsedSec * 3.6) * 0.04);
      dragonEgg.scale.y *= 1.25;
    });
  }

  // =========================================================================
  // 6. VALOR SPARRING RING & CLIFFSIDE FLOATING LANTERNS (South Courtyard + Abyss)
  // =========================================================================
  {
    const sparringGroup = new THREE.Group();
    sparringGroup.name = 'Landmark_ValorSparringRing';
    sparringGroup.position.set(dummyPos.x, dummyPos.y, dummyPos.z);
    root.add(sparringGroup);

    const brassMat = materials.get('brass_clockwork');
    const woodMat = materials.get('wood_oak');
    const steelMat = materials.get('metal_steel');

    // Outer 3.2m & Inner 1.6m Range-Gauge Brass Sparring Circles around the Training Dummy
    const outerRing = new THREE.Mesh(
      tracker.getGeometry('sparring_ring_outer', () => {
        const g = new THREE.TorusGeometry(3.2, 0.055, 6, 36);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      brassMat,
    );
    outerRing.position.set(0, 0.025, 0);
    sparringGroup.add(outerRing);

    const innerRing = new THREE.Mesh(
      tracker.getGeometry('sparring_ring_inner', () => {
        const g = new THREE.TorusGeometry(1.6, 0.04, 6, 28);
        g.rotateX(Math.PI * 0.5);
        return g;
      }),
      brassMat,
    );
    innerRing.position.set(0, 0.025, 0);
    sparringGroup.add(innerRing);

    // Flanking Wooden Practice Weapon Racks
    const rackPostGeom = tracker.getGeometry(
      'sparring_rack',
      () => new THREE.BoxGeometry(1.5, 1.15, 0.20),
    );
    const dummySwordGeom = tracker.getGeometry(
      'sparring_sword',
      () => new THREE.BoxGeometry(0.08, 1.1, 0.04),
    );
    for (const side of [-1, 1]) {
      const rack = new THREE.Mesh(rackPostGeom, woodMat);
      rack.position.set(side * 5.2, 0.58, 0.5);
      rack.rotation.y = -side * 0.35;
      rack.castShadow = true;
      sparringGroup.add(rack);

      const blade = new THREE.Mesh(dummySwordGeom, steelMat);
      blade.position.set(side * 5.15, 0.78, 0.58);
      blade.rotation.z = side * 0.14;
      sparringGroup.add(blade);
    }

    // Floating Abyssal Cliffside Sanctuary Lanterns hovering over the outer chasm
    const lanternCount = 12;
    const lanternGeom = tracker.getGeometry(
      'cliff_lantern_core',
      () => new THREE.OctahedronGeometry(0.26, 0),
    );
    const lanternMat = tracker.cloneMaterial(materials, 'rune_glow_blue');
    lanternMat.emissive = new THREE.Color(0xffc062);
    lanternMat.emissiveIntensity = 2.0;

    const lanternInst = new THREE.InstancedMesh(lanternGeom, lanternMat, lanternCount);
    lanternInst.name = 'CliffsideSanctuaryLanterns';
    lanternInst.frustumCulled = false;
    root.add(lanternInst);

    const lanternDummy = new THREE.Object3D();
    const updateLanterns = (elapsedSec: number): void => {
      for (let i = 0; i < lanternCount; i++) {
        const a = (i / lanternCount) * Math.PI * 2 + 0.26;
        const radius = 39.5 + (i % 2) * 2.5;
        const lx = Math.cos(a) * radius;
        const lz = Math.sin(a) * radius;
        const ly = 1.8 + Math.sin(elapsedSec * 1.4 + i * 1.1) * 0.55;

        lanternDummy.position.set(lx, ly, lz);
        lanternDummy.rotation.set(0, elapsedSec * 0.8 + i, 0);
        lanternDummy.scale.setScalar(0.9 + 0.2 * Math.sin(elapsedSec * 2.3 + i));
        lanternDummy.updateMatrix();
        lanternInst.setMatrixAt(i, lanternDummy.matrix);
      }
      lanternInst.instanceMatrix.needsUpdate = true;
    };
    updateLanterns(0);

    updaters.push((_dt, elapsedSec) => {
      updateLanterns(elapsedSec);
    });
  }

  return {
    group: root,
    update(dt: number, elapsedSec: number, playerPos: Vec3): void {
      for (let i = 0; i < updaters.length; i++) {
        updaters[i](dt, elapsedSec, playerPos);
      }
    },
  };
}
