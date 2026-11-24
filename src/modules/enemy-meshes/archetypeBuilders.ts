import * as THREE from 'three';
import type { EnemyArchetypeId } from '../../contracts/types';
import {
  buildAstralWeaver,
  buildChestMimic,
  buildClockworkAutomaton,
  buildFrostRevenant,
  buildIceWraith,
  buildTreasureGoblin,
} from './expansionArchetypes';
import {
  type ArticulatedEnemyRig,
  type HandleAssetRegistry,
  RigBuilder,
} from './rigTypes';

export function buildArchetypeRig(
  archetype: EnemyArchetypeId,
  isElite: boolean,
  assets: HandleAssetRegistry,
): ArticulatedEnemyRig {
  const eliteMul = isElite ? 1.18 : 1.0;

  switch (archetype) {
    case 'skeleton_warrior':
      return buildSkeletonWarrior(assets, eliteMul);
    case 'bone_archer':
      return buildBoneArcher(assets, eliteMul);
    case 'dark_cultist':
      return buildDarkCultist(assets, eliteMul);
    case 'plague_spider':
      return buildPlagueSpider(assets, eliteMul);
    case 'abyssal_golem':
      return buildAbyssalGolem(assets, eliteMul);
    case 'void_assassin':
      return buildVoidAssassin(assets, eliteMul);
    case 'hellhound':
      return buildHellhound(assets, eliteMul);
    case 'lich_summoner':
      return buildLichSummoner(assets, eliteMul);
    case 'frost_revenant':
      return buildFrostRevenant(assets, eliteMul);
    case 'ice_wraith':
      return buildIceWraith(assets, eliteMul);
    case 'clockwork_automaton':
      return buildClockworkAutomaton(assets, eliteMul);
    case 'astral_weaver':
      return buildAstralWeaver(assets, eliteMul);
    case 'treasure_goblin':
      return buildTreasureGoblin(assets, eliteMul);
    case 'chest_mimic':
      return buildChestMimic(assets, eliteMul);
  }
}

/* ============================================================================
 * 1. SKELETON WARRIOR — Ribcage, Skull, Iron-Rimmed Shield & Notched Sword
 * ========================================================================== */
function buildSkeletonWarrior(assets: HandleAssetRegistry, eliteMul: number): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'biped',
    attackStyle: 'melee_slash',
    baseScale: 1.0 * eliteMul,
    telegraphColorHex: 0x3bc9db,
    pelvisY: 0.86,
    torsoOffsetY: 0.1,
    headOffsetY: 0.56,
    bodyRadius: 0.52,
    bodyHeight: 1.85,
  });

  const boneMat = assets.mat('bone');
  const darkIron = assets.mat('metal_dark_iron');
  const steel = assets.mat('metal_steel');
  const oak = assets.mat('wood_oak');
  const cloth = assets.mat('cloth_crimson');
  const gold = assets.mat('metal_gold');

  // Skeletal pelvis & tattered crypt loincloth
  b.box(0.28, 0.11, 0.18, boneMat, b.rig.pelvis, [0, 0, 0]);
  b.box(0.32, 0.06, 0.21, darkIron, b.rig.pelvis, [0, 0.04, 0]);
  const loinFront = b.group('loincloth_front', b.rig.pelvis, 0, -0.02, 0.1);
  b.box(0.18, 0.34, 0.025, cloth, loinFront, [0, -0.17, 0]);
  b.rig.capeSegments.push(loinFront);

  // Skeletal legs with dark-iron shin greaves
  const legs = b.createBipedLegs(0.13, -0.04, 0.4, 0.42, 0.042, boneMat, boneMat, darkIron);
  for (const leg of [legs.left, legs.right]) {
    b.cyl(0.058, 0.05, 0.28, 6, darkIron, leg.knee, [0, -0.22, 0.015]);
  }

  // Ribcage, spine & clavicles
  b.addRibcage(b.rig.torso, boneMat, { width: 0.22, height: 0.44, depth: 0.15, pairs: 4, yOffset: 0.04 });
  b.box(0.46, 0.045, 0.06, boneMat, b.rig.torso, [0, 0.48, 0.02]);

  // Sculpted skull with cyan soul-fire eyes + cracked iron crown band
  const skull = b.addSkull(b.rig.head, boneMat, 0x3bc9db, 1.0);
  b.torus(0.155, 0.02, 5, 10, darkIron, skull, [0, 0.09, 0], [Math.PI * 0.5, 0, 0]);

  // Articulated skeletal arms + spiked pauldrons
  const arms = b.createBipedArms(0.27, 0.46, 0.33, 0.32, 0.038, boneMat, boneMat, boneMat);
  for (const side of [-1, 1] as const) {
    const sh = side === -1 ? arms.right.shoulder : arms.left.shoulder;
    b.sphere(0.11, 7, 6, darkIron, sh, [side * 0.03, 0.04, 0], [1.1, 0.75, 1.0]);
    b.cone(0.03, 0.11, 5, darkIron, sh, [side * 0.07, 0.12, 0], [0, 0, -side * 0.45]);
  }

  // Right arm (-X): Ancient Notched Broadsword held at ready
  arms.right.shoulder.rotation.set(-0.35, 0, -0.18);
  arms.right.elbow.rotation.set(-0.55, 0, 0);
  const sword = b.group('sword_pivot', arms.right.hand, 0, -0.02, 0.04, false);
  sword.rotation.set(Math.PI * 0.42, 0, 0);
  b.cyl(0.022, 0.024, 0.18, 6, oak, sword, [0, -0.04, 0]); // grip
  b.sphere(0.036, 6, 6, gold, sword, [0, -0.14, 0]); // pommel
  b.box(0.24, 0.035, 0.05, darkIron, sword, [0, 0.06, 0]); // crossguard
  b.box(0.075, 0.68, 0.022, steel, sword, [0, 0.41, 0]); // blade
  b.cone(0.042, 0.16, 4, steel, sword, [0, 0.83, 0], [0, Math.PI * 0.25, 0]); // blade tip

  // Left arm (+X): Battered Iron-Rimmed Oak Shield
  arms.left.shoulder.rotation.set(-0.55, 0.28, 0.22);
  arms.left.elbow.rotation.set(-0.65, -0.25, 0);
  const shield = b.group('shield_pivot', arms.left.hand, 0.05, -0.02, 0.08, false);
  shield.rotation.set(0.15, -0.35, 0);
  b.cyl(0.31, 0.29, 0.04, 10, oak, shield, [0, 0, 0], [Math.PI * 0.5, 0, 0]);
  b.torus(0.3, 0.028, 6, 12, darkIron, shield, [0, 0, 0.01], [0, 0, 0]);
  b.cone(0.075, 0.13, 7, steel, shield, [0, 0, 0.07], [Math.PI * 0.5, 0, 0]); // central spike boss
  b.box(0.56, 0.045, 0.05, darkIron, shield, [0, 0, 0.01]);

  return b.finalizeRig();
}

/* ============================================================================
 * 2. BONE ARCHER — Hooded Skeleton, Quiver & Recurve Bone Bow
 * ========================================================================== */
function buildBoneArcher(assets: HandleAssetRegistry, eliteMul: number): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'biped',
    attackStyle: 'bow_shot',
    baseScale: 0.98 * eliteMul,
    telegraphColorHex: 0x40c057,
    pelvisY: 0.84,
    torsoOffsetY: 0.1,
    headOffsetY: 0.54,
    bodyRadius: 0.48,
    bodyHeight: 1.8,
  });

  const boneMat = assets.mat('bone');
  const hoodCloth = assets.mat('cloth_shadow');
  const trimCloth = assets.mat('cloth_crimson');
  const oak = assets.mat('wood_oak');
  const darkIron = assets.mat('metal_dark_iron');
  const arrowGlow = assets.glow('archer_tip', 0x51cf66, 2.5);

  // Pelvis & agile bone legs
  b.box(0.25, 0.1, 0.16, boneMat, b.rig.pelvis, [0, 0, 0]);
  b.createBipedLegs(0.12, -0.04, 0.39, 0.41, 0.036, boneMat, boneMat, hoodCloth);

  // Ribcage + hooded ranger mantle + tattered back cloak
  b.addRibcage(b.rig.torso, boneMat, { width: 0.2, height: 0.42, depth: 0.14, pairs: 4, yOffset: 0.04 });
  b.cone(0.31, 0.26, 8, hoodCloth, b.rig.torso, [0, 0.42, 0], [Math.PI, 0, 0]);
  const cape = b.group('archer_cloak', b.rig.torso, 0, 0.45, -0.11);
  b.box(0.36, 0.62, 0.025, hoodCloth, cape, [0, -0.31, 0], [0.12, 0, 0]);
  b.rig.capeSegments.push(cape);

  // Diagonal Quiver of arrows on back
  const quiver = b.group('quiver', b.rig.torso, -0.1, 0.32, -0.16, false);
  quiver.rotation.set(0.18, 0, -0.38);
  b.cyl(0.068, 0.052, 0.46, 7, oak, quiver, [0, 0, 0]);
  b.cyl(0.072, 0.072, 0.05, 7, darkIron, quiver, [0, 0.18, 0]);
  for (let i = 0; i < 4; i++) {
    const ax = (i - 1.5) * 0.024;
    const az = ((i % 2) - 0.5) * 0.025;
    b.cyl(0.008, 0.008, 0.26, 4, boneMat, quiver, [ax, 0.3, az]);
    b.box(0.03, 0.06, 0.006, trimCloth, quiver, [ax, 0.4, az]);
  }

  // Skull nestled inside deep pointed cowl
  const skull = b.addSkull(b.rig.head, boneMat, 0x51cf66, 0.94);
  b.sphere(0.19, 8, 7, hoodCloth, skull, [0, 0.06, -0.02], [1.02, 1.1, 1.15]);
  b.cone(0.15, 0.26, 7, hoodCloth, skull, [0, 0.22, -0.08], [-0.55, 0, 0]);

  // Arms: Left (+X) holds recurve bone bow forward; Right (-X) draws arrow
  const arms = b.createBipedArms(0.24, 0.44, 0.32, 0.31, 0.033, boneMat, boneMat, boneMat);
  arms.left.shoulder.rotation.set(-1.15, -0.18, 0.1);
  arms.left.elbow.rotation.set(-0.2, 0, 0);

  const bow = b.group('recurve_bow', arms.left.hand, 0, -0.02, 0.05, false);
  bow.rotation.set(Math.PI * 0.5, 0, 0);
  // Curved bone bow arc (facing +Z in world when arm raised)
  b.torus(0.46, 0.026, 6, 14, boneMat, bow, [0, 0, -0.14], [0, Math.PI * 0.5, -Math.PI * 0.45], Math.PI * 0.9);
  b.cyl(0.034, 0.034, 0.18, 6, darkIron, bow, [0, 0, 0.31], [Math.PI * 0.5, 0, 0]); // grip riser
  // Horn tips + glowing bowstring
  b.cone(0.025, 0.14, 5, boneMat, bow, [0, 0, 0.31], [0, 0, 0]);
  b.cyl(0.005, 0.005, 0.84, 4, arrowGlow, bow, [0, 0, -0.05], [0, 0, 0]);

  // Right arm poised at bowstring with nocked glowing bone arrow
  arms.right.shoulder.rotation.set(-1.05, 0.35, -0.25);
  arms.right.elbow.rotation.set(-0.95, 0, 0);
  const arrow = b.group('nocked_arrow', arms.right.hand, 0, 0, 0.04, false);
  arrow.rotation.set(Math.PI * 0.5, 0, 0);
  b.cyl(0.01, 0.01, 0.56, 5, boneMat, arrow, [0, 0.22, 0]);
  b.cone(0.028, 0.1, 4, arrowGlow, arrow, [0, 0.54, 0]);

  return b.finalizeRig();
}

/* ============================================================================
 * 3. DARK CULTIST — Horned Cowl, Flowing Crimson Vestments & Ritual Staff
 * ========================================================================== */
function buildDarkCultist(assets: HandleAssetRegistry, eliteMul: number): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'biped',
    attackStyle: 'staff_cast',
    dissolveTheme: 'void_violet',
    baseScale: 1.02 * eliteMul,
    telegraphColorHex: 0xe03131,
    pelvisY: 0.86,
    torsoOffsetY: 0.12,
    headOffsetY: 0.58,
    bodyRadius: 0.52,
    bodyHeight: 1.9,
  });

  const crimson = assets.mat('cloth_crimson');
  const shadow = assets.mat('cloth_shadow');
  const obsidian = assets.mat('wall_obsidian');
  const gold = assets.mat('metal_gold');
  const boneMat = assets.mat('bone');
  const oak = assets.mat('wood_oak');
  const runeCrimson = assets.mat('rune_glow_crimson');

  // Flowing multi-layered lower ritual skirt + boots beneath
  b.cyl(0.24, 0.42, 0.78, 10, shadow, b.rig.pelvis, [0, -0.4, 0]);
  b.cyl(0.25, 0.39, 0.72, 8, crimson, b.rig.pelvis, [0, -0.36, 0.01]);
  b.createBipedLegs(0.12, -0.06, 0.38, 0.38, 0.04, shadow, shadow, obsidian);

  // Ritual stole & back cape
  const stole = b.group('ritual_stole', b.rig.pelvis, 0, -0.02, 0.22);
  b.box(0.16, 0.58, 0.02, gold, stole, [0, -0.29, 0]);
  b.box(0.12, 0.54, 0.026, crimson, stole, [0, -0.29, 0.005]);
  b.rig.capeSegments.push(stole);

  // Robed torso, high ritual mantle, golden collar & chained tome
  b.cyl(0.25, 0.21, 0.56, 8, crimson, b.rig.torso, [0, 0.28, 0]);
  b.cyl(0.33, 0.26, 0.2, 8, shadow, b.rig.torso, [0, 0.46, 0]);
  b.torus(0.23, 0.026, 6, 12, gold, b.rig.torso, [0, 0.52, 0], [Math.PI * 0.5, 0, 0]);
  b.box(0.12, 0.16, 0.05, obsidian, b.rig.pelvis, [0.24, -0.08, 0.08], [0, 0, -0.25]); // hip grimoire

  // Horned Cowl & Obsidian Mask with glowing crimson eyes
  const cowl = b.group('horned_cowl', b.rig.head, 0, 0.15, 0, false);
  b.sphere(0.18, 8, 8, shadow, cowl, [0, 0.04, -0.02], [1.0, 1.12, 1.12]);
  b.cone(0.17, 0.3, 7, crimson, cowl, [0, 0.23, -0.06], [-0.4, 0, 0]);
  b.box(0.19, 0.21, 0.08, obsidian, cowl, [0, 0.01, 0.12]); // ritual mask
  const eyeGlow = assets.glow('cultist_eyes', 0xff2b2b, 3.0);
  for (const side of [-1, 1] as const) {
    b.box(0.055, 0.022, 0.03, eyeGlow, cowl, [side * 0.05, 0.03, 0.155], [0, 0, -side * 0.2]);
  }
  b.addCurvedHorns(cowl, boneMat, {
    spreadX: 0.14,
    baseY: 0.12,
    baseZ: 0.02,
    length: 0.36,
    radius: 0.044,
    sweepPitch: 0.35,
    flareRoll: 0.62,
  });

  // Wide-sleeved arms + Gnarled Ritual Staff
  const arms = b.createBipedArms(0.28, 0.46, 0.32, 0.3, 0.052, crimson, shadow, gold);
  arms.right.shoulder.rotation.set(-0.55, 0, -0.15);
  arms.right.elbow.rotation.set(-0.55, 0, 0);

  const staff = b.group('ritual_staff', arms.right.hand, 0, 0, 0.04, false);
  staff.rotation.set(0.32, 0, 0);
  b.cyl(0.026, 0.022, 1.75, 6, oak, staff, [0, 0.28, 0]);
  b.torus(0.15, 0.022, 6, 10, gold, staff, [0, 1.24, 0]);
  // Miniature skull & floating crimson focus inside staff halo
  b.sphere(0.075, 7, 6, boneMat, staff, [0, 1.12, 0.02]);
  b.addWeakpoint(staff, 'cultist_focus', 0xff2b2b, 0.085, [0, 1.24, 0], 2.8);

  // Left arm raised with ritual invocation orb
  arms.left.shoulder.rotation.set(-0.75, -0.2, 0.25);
  arms.left.elbow.rotation.set(-0.7, 0, 0);
  b.octa(0.055, runeCrimson, arms.left.hand, [0, -0.05, 0.06]);

  return b.finalizeRig();
}

/* ============================================================================
 * 4. PLAGUE SPIDER — 8-Legged Articulated Arachnid & Glowing Venom Sac
 * ========================================================================== */
function buildPlagueSpider(assets: HandleAssetRegistry, eliteMul: number): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'arachnid',
    attackStyle: 'arachnid_strike',
    dissolveTheme: 'void_violet',
    baseScale: 1.05 * eliteMul,
    telegraphColorHex: 0x51cf66,
    pelvisY: 0.46,
    torsoOffsetY: 0.02,
    headOffsetY: 0.04,
    bodyRadius: 0.72,
    bodyHeight: 1.05,
  });

  const chitin = assets.mat('wall_obsidian', 'spider_chitin', (m) => {
    m.color.setHex(0x1b261e);
    m.roughness = 0.36;
  });
  const flesh = assets.mat('flesh_demon', 'spider_joint', (m) => {
    m.color.setHex(0x2d4a2b);
  });
  const venomMat = assets.mat('rune_glow_emerald');
  const boneMat = assets.mat('bone');

  // Cephalothorax (torso)
  b.rig.head.position.set(0, 0.04, 0.28);
  b.sphere(0.26, 9, 8, chitin, b.rig.torso, [0, 0.04, 0.08], [1.05, 0.72, 1.25]);
  // Dorsal chitin ridge spikes
  for (let i = 0; i < 3; i++) {
    b.cone(0.038, 0.14, 5, chitin, b.rig.torso, [0, 0.22, -0.04 + i * 0.11], [-0.3, 0, 0]);
  }

  // Head: 6 glowing emerald spider eyes + venomous dripping mandibles
  const eyeMat = assets.glow('spider_eyes', 0x69db7c, 3.0);
  const eyeOffsets: Array<[number, number, number, number]> = [
    [-0.065, 0.05, 0.14, 0.034],
    [0.065, 0.05, 0.14, 0.034],
    [-0.12, 0.07, 0.1, 0.024],
    [0.12, 0.07, 0.1, 0.024],
    [-0.04, 0.1, 0.12, 0.02],
    [0.04, 0.1, 0.12, 0.02],
  ];
  for (const [ex, ey, ez, er] of eyeOffsets) {
    b.sphere(er, 6, 5, eyeMat, b.rig.head, [ex, ey, ez]);
  }

  // Articulated fang jaw
  const jaw = b.group('spider_mandibles', b.rig.head, 0, -0.04, 0.12);
  for (const side of [-1, 1] as const) {
    b.cyl(0.038, 0.028, 0.14, 6, chitin, jaw, [side * 0.08, -0.02, 0.05], [0.7, 0, side * 0.25]);
    b.cone(0.026, 0.13, 5, boneMat, jaw, [side * 0.06, -0.08, 0.12], [1.2, -side * 0.35, 0]);
    b.sphere(0.02, 5, 5, venomMat, jaw, [side * 0.045, -0.11, 0.16]);
  }
  b.rig.jaw = jaw;

  // Bloated Glowing Venom Sac Abdomen (-Z)
  const abdomen = b.group('venom_abdomen', b.rig.pelvis, 0, 0.12, -0.44);
  b.sphere(0.38, 10, 9, venomMat, abdomen, [0, 0.06, -0.08], [1.02, 0.88, 1.32]);
  // Chitinous dorsal rib bands wrapping the glowing sac
  for (let i = 0; i < 3; i++) {
    const zOff = 0.12 - i * 0.2;
    const rad = 0.34 - Math.abs(i - 1) * 0.04;
    b.torus(rad, 0.035, 6, 10, chitin, abdomen, [0, 0.08, zOff], [0.2, 0, 0], Math.PI * 1.15);
  }
  // Pulsing bioluminescent venom pustules (registered as weakpoints for organic pulse!)
  b.addWeakpoint(abdomen, 'spider_sac_top', 0x69db7c, 0.12, [0, 0.34, -0.12], 2.8);
  b.addWeakpoint(abdomen, 'spider_sac_left', 0x51cf66, 0.085, [0.28, 0.16, -0.18], 2.5);
  b.addWeakpoint(abdomen, 'spider_sac_right', 0x51cf66, 0.085, [-0.28, 0.16, -0.18], 2.5);
  b.rig.tailSegments.push(abdomen);

  // 8 Articulated Arachnid Legs (4 per side)
  const legConfigs: Array<{ z: number; yaw: number; femurLen: number; tibiaLen: number }> = [
    { z: 0.22, yaw: 0.62, femurLen: 0.48, tibiaLen: 0.62 }, // front pair
    { z: 0.08, yaw: 0.2, femurLen: 0.46, tibiaLen: 0.58 }, // mid-front
    { z: -0.06, yaw: -0.24, femurLen: 0.46, tibiaLen: 0.58 }, // mid-rear
    { z: -0.2, yaw: -0.68, femurLen: 0.5, tibiaLen: 0.64 }, // rear pair
  ];

  for (let row = 0; row < 4; row++) {
    const cfg = legConfigs[row];
    for (const side of [-1, 1] as const) {
      const coxa = b.group(`leg_${side}_${row}_coxa`, b.rig.pelvis, side * 0.2, 0.02, cfg.z);
      coxa.rotation.y = side === 1 ? -cfg.yaw : cfg.yaw;
      b.sphere(0.055, 6, 5, flesh, coxa, [0, 0, 0]);

      // Femur rises outward (+X for side=1, -X for side=-1) & upward
      const femur = b.group(`leg_${side}_${row}_femur`, coxa, 0, 0, 0);
      femur.rotation.z = -side * 0.72; // lifts outward & up (~41 deg)
      b.cyl(
        0.042,
        0.032,
        cfg.femurLen,
        6,
        chitin,
        femur,
        [side * cfg.femurLen * 0.5, 0, 0],
        [0, 0, Math.PI * 0.5],
      );

      // Tibia bends sharply down to reach ground y=0
      const tibia = b.group(`leg_${side}_${row}_tibia`, femur, side * cfg.femurLen, 0, 0);
      tibia.rotation.z = side * 1.88;
      b.sphere(0.045, 6, 5, venomMat, tibia, [0, 0, 0]);
      b.cone(
        0.036,
        cfg.tibiaLen,
        6,
        chitin,
        tibia,
        [side * cfg.tibiaLen * 0.5, 0, 0],
        [0, 0, -side * Math.PI * 0.5],
      );

      b.rig.spiderLegs.push({ side, rowIndex: row, coxa, femur, tibia });
    }
  }

  return b.finalizeRig();
}

/* ============================================================================
 * 5. ABYSSAL GOLEM — Hulking Rune-Carved Stone & Obsidian Monolith
 * ========================================================================== */
function buildAbyssalGolem(assets: HandleAssetRegistry, eliteMul: number): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'heavy_biped',
    attackStyle: 'melee_slam',
    baseScale: 1.24 * eliteMul,
    telegraphColorHex: 0x22b8cf,
    pelvisY: 0.88,
    torsoOffsetY: 0.14,
    headOffsetY: 0.62,
    bodyRadius: 0.78,
    bodyHeight: 2.35,
  });

  const stone = assets.mat('wall_stone');
  const obsidian = assets.mat('wall_obsidian');
  const runeBlue = assets.mat('rune_glow_blue');
  const crystal = assets.mat('crystal_cyan');

  // Heavy monolith pelvis & pillar legs
  b.dodeca(0.28, obsidian, b.rig.pelvis, [0, 0, 0], [1.25, 0.7, 0.95]);
  b.box(0.42, 0.08, 0.3, runeBlue, b.rig.pelvis, [0, 0.05, 0]);

  const legs = b.createBipedLegs(0.22, -0.06, 0.38, 0.42, 0.11, stone, obsidian, stone);
  for (const leg of [legs.left, legs.right]) {
    b.box(0.28, 0.32, 0.28, stone, leg.knee, [0, -0.22, 0.02]);
    b.torus(0.15, 0.022, 5, 8, runeBlue, leg.knee, [0, -0.14, 0.02], [Math.PI * 0.5, 0, 0]);
  }

  // Broad craggy torso + recessed glowing Abyssal Core weakpoint
  b.dodeca(0.42, stone, b.rig.torso, [0, 0.34, 0], [1.28, 1.05, 0.88]);
  b.box(0.62, 0.24, 0.42, obsidian, b.rig.torso, [0, 0.46, -0.04]);
  // Carved rune strips on chest
  for (const side of [-1, 1] as const) {
    b.box(0.045, 0.38, 0.04, runeBlue, b.rig.torso, [side * 0.22, 0.34, 0.31], [0, 0, side * 0.22]);
  }
  b.addWeakpoint(b.rig.torso, 'golem_core', 0x3bc9db, 0.14, [0, 0.34, 0.28], 3.1);

  // Low-set monolithic rune-tablet head + crystal back spires
  b.rig.head.position.set(0, 0.62, 0.08);
  b.box(0.28, 0.3, 0.26, obsidian, b.rig.head, [0, 0.08, 0]);
  b.box(0.2, 0.045, 0.04, runeBlue, b.rig.head, [0, 0.1, 0.13]); // glowing monolith visor
  b.cone(0.09, 0.34, 5, crystal, b.rig.torso, [-0.26, 0.72, -0.14], [-0.35, 0, 0.32]);
  b.cone(0.11, 0.42, 5, crystal, b.rig.torso, [0.24, 0.76, -0.16], [-0.4, 0, -0.28]);

  // Hulking stone crusher arms & glowing fissure gauntlets
  const arms = b.createBipedArms(0.5, 0.48, 0.38, 0.44, 0.11, stone, stone, runeBlue);
  for (const side of [-1, 1] as const) {
    const arm = side === -1 ? arms.right : arms.left;
    arm.shoulder.rotation.set(-0.22, 0, -side * 0.18);
    arm.elbow.rotation.set(-0.48, 0, 0);
    // Massive boulder pauldron
    b.dodeca(0.22, obsidian, arm.shoulder, [side * 0.06, 0.06, 0], [1.15, 0.95, 1.05]);
    // Oversized seismic stone forearm & fist
    b.box(0.28, 0.38, 0.3, stone, arm.elbow, [0, -0.26, 0.02]);
    b.box(0.3, 0.05, 0.32, runeBlue, arm.elbow, [0, -0.24, 0.02]);
    b.dodeca(0.19, obsidian, arm.hand, [0, -0.04, 0.04]);
  }

  return b.finalizeRig();
}

/* ============================================================================
 * 6. VOID ASSASSIN — Floating Twin-Blade Wraith
 * ========================================================================== */
function buildVoidAssassin(assets: HandleAssetRegistry, eliteMul: number): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'floating',
    attackStyle: 'twin_dash',
    dissolveTheme: 'void_violet',
    baseScale: 1.0 * eliteMul,
    hoverBaseY: 0.28,
    telegraphColorHex: 0xda77f2,
    pelvisY: 0.78,
    torsoOffsetY: 0.12,
    headOffsetY: 0.54,
    bodyRadius: 0.5,
    bodyHeight: 1.9,
  });

  const shadow = assets.mat('cloth_shadow');
  const arcane = assets.mat('cloth_arcane');
  const obsidian = assets.mat('wall_obsidian');
  const voidGlow = assets.mat('rune_glow_void');

  // Trailing phantom lower wraith tail + tattered shadow ribbons (no heavy feet)
  const wraithTail = b.group('wraith_tail', b.rig.pelvis, 0, -0.02, 0);
  b.cone(0.22, 0.72, 7, shadow, wraithTail, [0, -0.36, -0.04], [Math.PI, 0, 0]);
  b.cone(0.16, 0.55, 6, arcane, wraithTail, [0, -0.32, 0.02], [Math.PI * 0.94, 0, 0]);
  b.rig.tailSegments.push(wraithTail);

  for (const side of [-1, 1] as const) {
    const ribbon = b.group(`void_ribbon_${side}`, b.rig.pelvis, side * 0.16, -0.04, -0.08);
    b.box(0.11, 0.62, 0.02, shadow, ribbon, [0, -0.31, 0], [0.22, 0, side * 0.12]);
    b.rig.capeSegments.push(ribbon);
  }

  // Lean armored phantom torso + void heart sigil
  b.cyl(0.23, 0.15, 0.52, 7, obsidian, b.rig.torso, [0, 0.26, 0]);
  b.box(0.32, 0.22, 0.22, arcane, b.rig.torso, [0, 0.38, 0]);
  b.octa(0.065, voidGlow, b.rig.torso, [0, 0.35, 0.13]);

  // Flowing twin shadow-scarf streamers from neck
  for (const side of [-1, 1] as const) {
    const scarf = b.group(`scarf_${side}`, b.rig.torso, side * 0.1, 0.5, -0.12);
    b.box(0.1, 0.68, 0.018, arcane, scarf, [0, -0.34, -0.08], [0.38, 0, side * 0.15]);
    b.rig.capeSegments.push(scarf);
  }

  // Faceless Obsidian Visor Helm with glowing violet V-slit & swept horns
  const helm = b.group('assassin_helm', b.rig.head, 0, 0.13, 0, false);
  b.sphere(0.155, 8, 8, obsidian, helm, [0, 0.03, 0], [0.92, 1.08, 1.1]);
  const visorGlow = assets.glow('void_visor', 0xe599f7, 3.0);
  b.box(0.09, 0.022, 0.03, visorGlow, helm, [-0.04, 0.03, 0.145], [0, 0, -0.35]);
  b.box(0.09, 0.022, 0.03, visorGlow, helm, [0.04, 0.03, 0.145], [0, 0, 0.35]);
  b.addCurvedHorns(helm, obsidian, {
    spreadX: 0.12,
    baseY: 0.08,
    baseZ: -0.02,
    length: 0.34,
    radius: 0.034,
    sweepPitch: -0.75,
    flareRoll: 0.3,
  });

  // Twin Void-Blade Wraith Arms
  const arms = b.createBipedArms(0.26, 0.44, 0.31, 0.3, 0.042, shadow, obsidian, voidGlow);
  for (const side of [-1, 1] as const) {
    const arm = side === -1 ? arms.right : arms.left;
    arm.shoulder.rotation.set(-0.35, side * 0.25, -side * 0.38);
    arm.elbow.rotation.set(-0.75, 0, 0);

    // Swept jagged shoulder fin
    b.cone(0.09, 0.28, 4, obsidian, arm.shoulder, [side * 0.08, 0.08, -0.02], [-0.25, 0, -side * 0.85]);

    // Twin curved void-crystal blades extending forward & sleekly swept
    const bladeGrp = b.group(`void_blade_${side}`, arm.hand, 0, -0.02, 0.02, false);
    bladeGrp.rotation.set(Math.PI * 0.46, 0, 0);
    b.cyl(0.022, 0.022, 0.2, 6, obsidian, bladeGrp, [0, 0, 0]);
    // Forward blade + reverse talon
    b.box(0.055, 0.56, 0.018, voidGlow, bladeGrp, [0, 0.36, 0.015]);
    b.cone(0.036, 0.18, 4, voidGlow, bladeGrp, [0, 0.72, 0.015], [0, Math.PI * 0.25, 0]);
    b.cone(0.028, 0.22, 4, voidGlow, bladeGrp, [0, -0.18, -0.01], [Math.PI, Math.PI * 0.25, 0]);
  }

  return b.finalizeRig();
}

/* ============================================================================
 * 7. HELLHOUND — Quadruped Magma Beast
 * ========================================================================== */
function buildHellhound(assets: HandleAssetRegistry, eliteMul: number): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'quadruped',
    attackStyle: 'bite_lunge',
    baseScale: 1.05 * eliteMul,
    telegraphColorHex: 0xff6b35,
    pelvisY: 0.64,
    torsoOffsetY: 0.02,
    headOffsetY: 0.14,
    bodyRadius: 0.65,
    bodyHeight: 1.2,
  });

  const demonFlesh = assets.mat('flesh_demon');
  const obsidian = assets.mat('wall_obsidian');
  const lava = assets.mat('lava_emissive');
  const boneMat = assets.mat('bone');

  // Elongated quadruped body: muscular front chest (+Z) and narrower haunches (-Z)
  b.rig.torso.position.set(0, 0.04, 0.16);
  b.rig.head.position.set(0, 0.18, 0.36);

  // Chest & magma rib cracks
  b.sphere(0.25, 8, 7, demonFlesh, b.rig.torso, [0, 0, 0], [0.95, 1.0, 1.35]);
  b.sphere(0.21, 8, 7, demonFlesh, b.rig.pelvis, [0, -0.02, -0.22], [0.88, 0.9, 1.3]);

  // Charred obsidian dorsal plates + glowing magma spine vents
  for (let i = 0; i < 5; i++) {
    const zPos = 0.24 - i * 0.16;
    b.box(0.24 - i * 0.02, 0.07, 0.13, obsidian, b.rig.pelvis, [0, 0.22 - i * 0.015, zPos], [0.15, 0, 0]);
    b.cone(0.036, 0.15, 4, lava, b.rig.pelvis, [0, 0.3 - i * 0.015, zPos], [-0.35, 0, 0]);
  }

  // Ferocious Horned Wolf-Demon Head + Molten Maw
  b.box(0.24, 0.2, 0.26, obsidian, b.rig.head, [0, 0.05, 0.04]);
  b.box(0.16, 0.11, 0.24, demonFlesh, b.rig.head, [0, 0.02, 0.22]); // upper snout
  for (const side of [-1, 1] as const) {
    b.sphere(0.032, 6, 5, lava, b.rig.head, [side * 0.085, 0.08, 0.16]); // blazing eyes
    b.cone(0.018, 0.07, 4, boneMat, b.rig.head, [side * 0.055, -0.05, 0.28], [Math.PI, 0, 0]); // upper fangs
  }
  b.addCurvedHorns(b.rig.head, obsidian, {
    spreadX: 0.11,
    baseY: 0.13,
    baseZ: 0.0,
    length: 0.28,
    radius: 0.035,
    sweepPitch: -0.65,
    flareRoll: 0.35,
  });

  // Hinged magma lower jaw
  const jaw = b.group('hellhound_jaw', b.rig.head, 0, -0.05, 0.08);
  jaw.rotation.x = 0.18;
  b.box(0.14, 0.06, 0.22, demonFlesh, jaw, [0, -0.02, 0.11]);
  b.box(0.11, 0.03, 0.18, lava, jaw, [0, 0.015, 0.11]); // glowing molten tongue/maw
  b.rig.jaw = jaw;

  // Whip-like 3-segment tail (-Z) with magma spear tip
  let tailParent: THREE.Object3D = b.rig.pelvis;
  for (let i = 0; i < 3; i++) {
    const seg = b.group(`tail_${i}`, tailParent, 0, i === 0 ? 0.08 : 0, i === 0 ? -0.44 : -0.22);
    seg.rotation.x = 0.22 - i * 0.14;
    b.cyl(0.032 - i * 0.006, 0.04 - i * 0.006, 0.24, 6, obsidian, seg, [0, 0, -0.12], [Math.PI * 0.5, 0, 0]);
    if (i === 2) {
      b.octa(0.055, lava, seg, [0, 0, -0.24], [0.8, 0.8, 1.5]);
    }
    b.rig.tailSegments.push(seg);
    tailParent = seg;
  }

  // 4 Articulated Quadruped Legs
  const makeQuadLeg = (isFront: boolean, side: -1 | 1): void => {
    const zBase = isFront ? 0.22 : -0.28;
    const xBase = side * (isFront ? 0.19 : 0.17);
    const upper = b.group(`quad_${isFront ? 'f' : 'b'}_${side}_upper`, b.rig.pelvis, xBase, -0.02, zBase);
    upper.rotation.x = isFront ? 0.18 : -0.24;
    b.cyl(0.072, 0.052, 0.34, 7, demonFlesh, upper, [0, -0.17, 0]);
    b.box(0.11, 0.16, 0.12, obsidian, upper, [side * 0.02, -0.08, 0]);

    const lower = b.group(`quad_${isFront ? 'f' : 'b'}_${side}_lower`, upper, 0, -0.32, 0);
    lower.rotation.x = isFront ? -0.2 : 0.3;
    b.cyl(0.05, 0.038, 0.32, 6, obsidian, lower, [0, -0.16, 0]);
    b.box(0.11, 0.06, 0.16, obsidian, lower, [0, -0.3, 0.04]);
    b.cone(0.02, 0.07, 4, lava, lower, [0, -0.3, 0.13], [Math.PI * 0.5, 0, 0]);

    b.rig.quadLegs.push({ isFront, side, upper, lower });
  };

  makeQuadLeg(true, -1);
  makeQuadLeg(true, 1);
  makeQuadLeg(false, -1);
  makeQuadLeg(false, 1);

  return b.finalizeRig();
}

/* ============================================================================
 * 8. LICH SUMMONER — Floating Necromancer with Crown & 3 Orbiting Skulls
 * ========================================================================== */
function buildLichSummoner(assets: HandleAssetRegistry, eliteMul: number): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'floating',
    attackStyle: 'staff_cast',
    dissolveTheme: 'void_violet',
    baseScale: 1.08 * eliteMul,
    hoverBaseY: 0.32,
    telegraphColorHex: 0xae3ec9,
    pelvisY: 0.88,
    torsoOffsetY: 0.14,
    headOffsetY: 0.6,
    bodyRadius: 0.62,
    bodyHeight: 2.15,
  });

  const boneMat = assets.mat('bone');
  const arcane = assets.mat('cloth_arcane');
  const shadow = assets.mat('cloth_shadow');
  const gold = assets.mat('metal_gold');
  const darkIron = assets.mat('metal_dark_iron');
  const soulCyan = assets.mat('rune_glow_blue');
  const voidGlow = assets.mat('rune_glow_void');

  // Floating tattered arch-lich lower robes
  const lowerRobe = b.group('lich_lower_robe', b.rig.pelvis, 0, 0, 0);
  b.cyl(0.22, 0.44, 0.92, 9, arcane, lowerRobe, [0, -0.46, 0]);
  b.cyl(0.24, 0.38, 0.84, 7, shadow, lowerRobe, [0, -0.42, -0.02]);
  b.rig.tailSegments.push(lowerRobe);

  // Ornate gilded front stole & back cloak panels
  const frontStole = b.group('lich_stole', b.rig.pelvis, 0, 0, 0.23);
  b.box(0.18, 0.72, 0.022, gold, frontStole, [0, -0.36, 0]);
  b.box(0.13, 0.66, 0.028, arcane, frontStole, [0, -0.36, 0.005]);
  b.rig.capeSegments.push(frontStole);

  const backCape = b.group('lich_cape', b.rig.torso, 0, 0.5, -0.16);
  b.box(0.52, 0.95, 0.025, shadow, backCape, [0, -0.47, -0.04], [0.16, 0, 0]);
  b.rig.capeSegments.push(backCape);

  // Exposed ribcage over arcane core + high spiked gothic arch-collar
  b.cyl(0.22, 0.18, 0.52, 8, shadow, b.rig.torso, [0, 0.26, 0]);
  b.addRibcage(b.rig.torso, boneMat, { width: 0.23, height: 0.42, depth: 0.16, pairs: 4, yOffset: 0.08 });
  b.addWeakpoint(b.rig.torso, 'lich_phylactery', 0x3bc9db, 0.09, [0, 0.3, 0.08], 2.9);

  // High gothic collar behind skull
  b.torus(0.26, 0.035, 6, 10, gold, b.rig.torso, [0, 0.56, -0.05], [0.35, 0, Math.PI * 0.15], Math.PI * 0.7);
  for (let i = -2; i <= 2; i++) {
    b.cone(0.032, 0.22, 5, arcane, b.rig.torso, [i * 0.1, 0.68, -0.18 + Math.abs(i) * 0.03], [-0.28, 0, -i * 0.18]);
  }

  // Skull + Tall Spiked Golden Lich Crown
  const skull = b.addSkull(b.rig.head, boneMat, 0xda77f2, 1.02);
  const crown = b.group('lich_crown', skull, 0, 0.13, 0);
  b.cyl(0.165, 0.15, 0.09, 8, gold, crown, [0, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const spikeH = i % 2 === 0 ? 0.22 : 0.14;
    b.cone(0.028, spikeH, 4, gold, crown, [Math.sin(ang) * 0.155, 0.04 + spikeH * 0.5, Math.cos(ang) * 0.155]);
  }
  b.octa(0.045, voidGlow, crown, [0, 0.08, 0.165]);
  b.rig.crown = crown;

  // Skeletal arms: Right (-X) wields Necrotic Soul-Scepter; Left (+X) holds open Tome
  const arms = b.createBipedArms(0.3, 0.46, 0.34, 0.32, 0.038, arcane, boneMat, gold);
  for (const side of [-1, 1] as const) {
    const sh = side === -1 ? arms.right.shoulder : arms.left.shoulder;
    b.sphere(0.13, 7, 6, arcane, sh, [side * 0.04, 0.04, 0], [1.2, 0.8, 1.0]);
    b.torus(0.13, 0.02, 5, 8, gold, sh, [side * 0.04, 0.01, 0], [Math.PI * 0.5, 0, 0]);
  }

  arms.right.shoulder.rotation.set(-0.48, 0, -0.2);
  arms.right.elbow.rotation.set(-0.55, 0, 0);
  const scepter = b.group('lich_scepter', arms.right.hand, 0, 0, 0.03, false);
  scepter.rotation.set(0.28, 0, 0);
  b.cyl(0.024, 0.02, 1.85, 6, darkIron, scepter, [0, 0.35, 0]);
  b.torus(0.18, 0.025, 6, 12, boneMat, scepter, [0, 1.38, 0], [0, 0, Math.PI * 0.25], Math.PI * 1.5);
  b.octa(0.095, soulCyan, scepter, [0, 1.38, 0]);

  arms.left.shoulder.rotation.set(-0.75, -0.25, 0.22);
  arms.left.elbow.rotation.set(-0.85, 0.25, 0);
  const tome = b.group('lich_tome', arms.left.hand, 0, -0.02, 0.1, false);
  b.box(0.16, 0.03, 0.2, darkIron, tome, [-0.07, 0, 0], [0, 0, 0.28]);
  b.box(0.16, 0.03, 0.2, darkIron, tome, [0.07, 0, 0], [0, 0, -0.28]);
  b.box(0.13, 0.025, 0.17, soulCyan, tome, [0, 0.02, 0]);

  // 3 Orbiting Glowing Necrotic Skulls
  const skullFlameMat = assets.glow('orbit_skull_flame', 0x3bc9db, 2.7, {
    opacity: 0.55,
    additive: true,
  });
  for (let i = 0; i < 3; i++) {
    const miniSkull = b.group(`orbiting_skull_${i}`, b.rig.torso, 0, 0, 0, false);
    b.sphere(0.085, 7, 6, boneMat, miniSkull, [0, 0.02, 0], [0.92, 1.05, 1.1]);
    b.box(0.08, 0.055, 0.08, boneMat, miniSkull, [0, -0.05, 0.04]);
    b.sphere(0.022, 5, 5, voidGlow, miniSkull, [-0.032, 0.02, 0.082]);
    b.sphere(0.022, 5, 5, voidGlow, miniSkull, [0.032, 0.02, 0.082]);
    const halo = b.sphere(0.125, 7, 6, skullFlameMat, miniSkull, [0, 0.02, -0.03], [0.9, 1.2, 1.3]);
    halo.castShadow = false;

    b.addOrbiter(b.rig.torso, miniSkull, {
      radius: 0.72,
      height: 0.38,
      speed: 2.1,
      phase: (i / 3) * Math.PI * 2,
      bobAmp: 0.09,
      tiltAmp: 0.25,
    });
  }

  return b.finalizeRig();
}
