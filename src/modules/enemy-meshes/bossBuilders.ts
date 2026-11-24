import * as THREE from 'three';
import type { BossId } from '../../contracts/types';
import {
  buildChronosTimeArchitect,
  buildTheButcher,
  buildValkyriaRimeSeraph,
} from './expansionBosses';
import {
  type ArticulatedEnemyRig,
  type HandleAssetRegistry,
  RigBuilder,
} from './rigTypes';

export function buildBossRig(
  bossId: BossId,
  assets: HandleAssetRegistry,
): ArticulatedEnemyRig {
  switch (bossId) {
    case 'bone_colossus':
      return buildBoneColossus(assets);
    case 'arachne_broodmother':
      return buildArachneBroodmother(assets);
    case 'ignis_forgemaster':
      return buildIgnisForgemaster(assets);
    case 'malakor_void_emperor':
      return buildMalakorVoidEmperor(assets);
    case 'valkyria_rime_seraph':
      return buildValkyriaRimeSeraph(assets);
    case 'chronos_time_architect':
      return buildChronosTimeArchitect(assets);
    case 'the_butcher':
      return buildTheButcher(assets);
  }
}

/**
 * Helper to attach a pair of articulated back wings (`rig.wings`) to a boss torso.
 */
export function attachBossWings(
  b: RigBuilder,
  sparMat: THREE.Material,
  pinionMat: THREE.Material,
  options: {
    mountY: number;
    mountZ: number;
    span: number;
    feathers: number;
    liftAngle?: number;
    sweepBack?: number;
    tierIndex?: number;
  },
): void {
  const tier = options.tierIndex ?? 0;
  for (const side of [-1, 1] as const) {
    const pivot = b.group(
      `boss_wing_${tier}_${side}`,
      b.rig.torso,
      side * 0.18,
      options.mountY,
      options.mountZ,
    );
    pivot.rotation.set(
      options.sweepBack ?? -0.22,
      side * 0.38,
      -side * (options.liftAngle ?? 0.35),
    );

    const halfSpan = options.span * 0.55;
    b.cyl(
      0.042,
      0.03,
      halfSpan,
      6,
      sparMat,
      pivot,
      [side * halfSpan * 0.45, halfSpan * 0.22, 0],
      [0, 0, -side * 1.12],
    );
    b.cyl(
      0.03,
      0.016,
      halfSpan,
      6,
      sparMat,
      pivot,
      [side * halfSpan * 1.25, halfSpan * 0.28, -0.04],
      [0, 0, -side * 1.48],
    );
    b.cone(
      0.045,
      0.18,
      5,
      sparMat,
      pivot,
      [side * halfSpan * 0.85, halfSpan * 0.45, 0.02],
      [0.2, 0, -side * 0.4],
    );

    for (let i = 0; i < options.feathers; i++) {
      const t = i / Math.max(1, options.feathers - 1);
      const fx = side * (0.22 + t * options.span * 0.92);
      const fy = 0.14 + Math.sin(t * Math.PI * 0.85) * 0.2 - t * 0.14;
      const featherLen = (0.58 - t * 0.18) * (options.span / 1.1);
      const mesh = b.cone(
        0.055,
        featherLen,
        4,
        pinionMat,
        pivot,
        [fx, fy - featherLen * 0.42, -0.02],
        [Math.PI, 0, side * (0.18 + t * 0.42)],
      );
      mesh.scale.set(0.75, 1, 0.25);
    }

    b.rig.wings.push({ side, pivot, tierIndex: tier });
  }
}

/**
 * Helper to attach multi-segment undulating tendrils (`rig.tendrils`) to a boss.
 */
export function attachBossTendrils(
  b: RigBuilder,
  parent: THREE.Object3D,
  segMat: THREE.Material,
  tipMat: THREE.Material,
  configs: Array<{ pos: [number, number, number]; rot: [number, number, number]; segLen: number; count: number }>,
): void {
  configs.forEach((cfg, idx) => {
    const segments: THREE.Group[] = [];
    let curParent = parent;
    for (let s = 0; s < cfg.count; s++) {
      const seg = b.group(
        `tendril_${idx}_${s}`,
        curParent,
        s === 0 ? cfg.pos[0] : 0,
        s === 0 ? cfg.pos[1] : -cfg.segLen,
        s === 0 ? cfg.pos[2] : 0,
      );
      if (s === 0) {
        seg.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
      } else {
        seg.rotation.set(0.16, 0, 0);
      }
      const rTop = Math.max(0.015, 0.045 - s * 0.008);
      const rBot = Math.max(0.01, 0.036 - s * 0.008);
      b.cyl(rTop, rBot, cfg.segLen, 6, segMat, seg, [0, -cfg.segLen * 0.5, 0]);
      if (s === cfg.count - 1) {
        b.octa(0.05, tipMat, seg, [0, -cfg.segLen, 0], [0.7, 1.5, 0.7]);
      }
      segments.push(seg);
      curParent = seg;
    }
    b.rig.tendrils.push({ segments, phase: idx * 1.35 });
  });
}

/* ============================================================================
 * BOSS 1: BONE COLOSSUS — Floor I Crypt Pinnacle Boss (2.75x Scale)
 * Ossuary Cathedral Titan with Crown, Skeletal Wings, Tendrils & Soul-Core Weakpoints
 * ========================================================================== */
function buildBoneColossus(assets: HandleAssetRegistry): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'heavy_biped',
    attackStyle: 'boss_sweeping',
    isBoss: true,
    dissolveTheme: 'molten_orange',
    baseScale: 2.75,
    telegraphColorHex: 0xff3b3b,
    pelvisY: 0.86,
    torsoOffsetY: 0.12,
    headOffsetY: 0.64,
    bodyRadius: 1.55,
    bodyHeight: 5.2,
  });

  const boneMat = assets.mat('bone');
  const darkIron = assets.mat('metal_dark_iron');
  const gold = assets.mat('metal_gold');
  const crimson = assets.mat('cloth_crimson');
  const runeCrimson = assets.mat('rune_glow_crimson');
  const runeBlue = assets.mat('rune_glow_blue');

  // Ossuary pelvis + tattered royal war-banners
  b.box(0.38, 0.14, 0.24, boneMat, b.rig.pelvis, [0, 0, 0]);
  b.box(0.42, 0.08, 0.26, darkIron, b.rig.pelvis, [0, 0.06, 0]);
  for (const side of [-1, 0, 1] as const) {
    const banner = b.group(`colossus_banner_${side}`, b.rig.pelvis, side * 0.13, -0.03, side === 0 ? 0.14 : -0.13);
    b.box(0.14, 0.5, 0.022, crimson, banner, [0, -0.25, 0]);
    b.rig.capeSegments.push(banner);
  }

  // Heavy bone-pillar legs reinforced with spiked dark-iron greaves
  const legs = b.createBipedLegs(0.18, -0.04, 0.4, 0.42, 0.075, boneMat, boneMat, darkIron);
  for (const [idx, leg] of [legs.right, legs.left].entries()) {
    const side = idx === 0 ? -1 : 1;
    b.cyl(0.095, 0.085, 0.32, 7, darkIron, leg.knee, [0, -0.22, 0.02]);
    b.sphere(0.075, 6, 5, boneMat, leg.knee, [side * 0.05, -0.02, 0.06]); // knee skull boss
  }

  // Double-layered Cathedral Ribcage + Glowing Exposed Soul-Cage Heart Weakpoint
  b.addRibcage(b.rig.torso, boneMat, { width: 0.31, height: 0.54, depth: 0.22, pairs: 5, yOffset: 0.05 });
  b.box(0.58, 0.08, 0.12, boneMat, b.rig.torso, [0, 0.56, 0.02]);
  b.addWeakpoint(b.rig.torso, 'colossus_heart', 0xff2b2b, 0.13, [0, 0.33, 0.06], 3.4);

  // Skeletal Bone-Spire Wings + Necrotic Spine Tendrils
  attachBossWings(b, boneMat, darkIron, {
    mountY: 0.48,
    mountZ: -0.16,
    span: 1.05,
    feathers: 6,
    liftAngle: 0.42,
    sweepBack: -0.25,
  });
  attachBossTendrils(b, b.rig.torso, boneMat, runeBlue, [
    { pos: [-0.16, 0.16, -0.18], rot: [0.45, 0, -0.28], segLen: 0.2, count: 3 },
    { pos: [0.16, 0.16, -0.18], rot: [0.45, 0, 0.28], segLen: 0.2, count: 3 },
  ]);

  // Horned Titan Skull + Shattered Golden Ossuary Crown
  const skull = b.addSkull(b.rig.head, boneMat, 0xff3b3b, 1.25);
  b.addCurvedHorns(skull, boneMat, {
    spreadX: 0.18,
    baseY: 0.14,
    baseZ: 0,
    length: 0.46,
    radius: 0.058,
    sweepPitch: 0.32,
    flareRoll: 0.65,
  });
  const crown = b.group('colossus_crown', skull, 0, 0.17, 0);
  b.cyl(0.19, 0.175, 0.1, 8, gold, crown, [0, 0, 0]);
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2;
    const h = i % 2 === 0 ? 0.24 : 0.14;
    b.cone(0.032, h, 4, gold, crown, [Math.sin(ang) * 0.18, 0.05 + h * 0.5, Math.cos(ang) * 0.18]);
  }
  b.octa(0.05, runeCrimson, crown, [0, 0.08, 0.19]);
  b.rig.crown = crown;

  // Arms + Skull-Cathedral Pauldrons with Weakpoints + Executioner Greataxe & Tower Shield
  const arms = b.createBipedArms(0.38, 0.52, 0.38, 0.38, 0.068, boneMat, darkIron, boneMat);
  for (const side of [-1, 1] as const) {
    const sh = side === -1 ? arms.right.shoulder : arms.left.shoulder;
    b.sphere(0.18, 8, 6, darkIron, sh, [side * 0.06, 0.06, 0], [1.2, 0.9, 1.1]);
    b.cone(0.045, 0.24, 5, boneMat, sh, [side * 0.12, 0.2, -0.02], [0, 0, -side * 0.48]);
    b.addWeakpoint(sh, `colossus_pauldron_${side}`, 0x3bc9db, 0.065, [side * 0.14, 0.08, 0.12], 2.8);
  }

  // Right hand (-X): Titanic Executioner Bone-Cleaver Greataxe
  arms.right.shoulder.rotation.set(-0.38, 0, -0.22);
  arms.right.elbow.rotation.set(-0.52, 0, 0);
  const greataxe = b.group('colossus_greataxe', arms.right.hand, 0, -0.02, 0.04, false);
  greataxe.rotation.set(Math.PI * 0.4, 0, 0);
  b.cyl(0.032, 0.028, 1.35, 6, boneMat, greataxe, [0, 0.38, 0]);
  b.box(0.52, 0.38, 0.035, darkIron, greataxe, [0, 0.88, 0]);
  b.box(0.56, 0.05, 0.045, runeCrimson, greataxe, [0, 0.88, 0]);
  b.cone(0.06, 0.24, 5, boneMat, greataxe, [0, 1.18, 0]);

  // Left hand (+X): Spiked Mausoleum Tower Shield
  arms.left.shoulder.rotation.set(-0.5, 0.22, 0.24);
  arms.left.elbow.rotation.set(-0.6, -0.2, 0);
  const shield = b.group('colossus_shield', arms.left.hand, 0.06, -0.04, 0.08, false);
  shield.rotation.set(0.12, -0.32, 0);
  b.box(0.46, 0.78, 0.055, darkIron, shield, [0, 0, 0]);
  b.box(0.38, 0.68, 0.065, boneMat, shield, [0, 0, 0.01]);
  b.sphere(0.11, 7, 6, gold, shield, [0, 0.06, 0.05]);
  b.cone(0.05, 0.18, 5, darkIron, shield, [0, 0.06, 0.14], [Math.PI * 0.5, 0, 0]);

  return b.finalizeRig();
}

/* ============================================================================
 * BOSS 2: ARACHNE BROODMOTHER — Floor II Caverns Pinnacle Boss (2.85x Scale)
 * Crowned Spider Queen with Insectoid Wings, Lasher Tendrils & Glowing Venom-Sac Weakpoints
 * ========================================================================== */
function buildArachneBroodmother(assets: HandleAssetRegistry): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'arachnid',
    attackStyle: 'arachnid_strike',
    isBoss: true,
    dissolveTheme: 'void_violet',
    baseScale: 2.85,
    telegraphColorHex: 0x51cf66,
    pelvisY: 0.48,
    torsoOffsetY: 0.06,
    headOffsetY: 0.28,
    bodyRadius: 1.95,
    bodyHeight: 3.4,
  });

  const chitin = assets.mat('wall_obsidian', 'brood_chitin', (m) => {
    m.color.setHex(0x16241b);
    m.roughness = 0.3;
  });
  const flesh = assets.mat('flesh_demon', 'brood_flesh', (m) => {
    m.color.setHex(0x3a1c2e);
  });
  const emeraldGlow = assets.mat('rune_glow_emerald');
  const gold = assets.mat('metal_gold');
  const boneMat = assets.mat('bone');
  const wingMembrane = assets.glow('brood_wing_membrane', 0x40c057, 2.2, {
    opacity: 0.55,
    doubleSide: true,
    additive: true,
  });

  // Armored Cephalothorax + Raised Matriarch Upper Crest
  b.sphere(0.32, 10, 9, chitin, b.rig.torso, [0, 0.04, 0.1], [1.15, 0.82, 1.32]);
  b.cyl(0.18, 0.24, 0.34, 8, chitin, b.rig.torso, [0, 0.22, 0.22], [0.35, 0, 0]);
  b.addWeakpoint(b.rig.torso, 'brood_thorax_core', 0x69db7c, 0.095, [0, 0.22, 0.35], 3.2);

  // Queen Head: 8 Blazing Eyes, Chitinous Brood-Crown & Giant Scythe Mandibles
  b.rig.head.position.set(0, 0.38, 0.34);
  b.sphere(0.18, 9, 8, chitin, b.rig.head, [0, 0.04, 0.02], [1.05, 1.0, 1.15]);

  const eyeGlow = assets.glow('arachne_eyes', 0x8ce99a, 3.2);
  for (let i = 0; i < 4; i++) {
    const spread = 0.042 + i * 0.032;
    const yOff = 0.03 + (i % 2) * 0.045;
    const r = i === 0 ? 0.032 : 0.022;
    b.sphere(r, 6, 5, eyeGlow, b.rig.head, [-spread, yOff, 0.16 - i * 0.02]);
    b.sphere(r, 6, 5, eyeGlow, b.rig.head, [spread, yOff, 0.16 - i * 0.02]);
  }

  // Queen's Chitinous & Golden Brood-Crown
  const crown = b.group('arachne_crown', b.rig.head, 0, 0.16, 0);
  b.torus(0.15, 0.025, 6, 10, gold, crown, [0, 0, 0], [Math.PI * 0.5, 0, 0]);
  for (let i = -2; i <= 2; i++) {
    const h = 0.26 - Math.abs(i) * 0.045;
    b.cone(0.028, h, 5, i === 0 ? emeraldGlow : gold, crown, [i * 0.065, h * 0.5, 0.04 - Math.abs(i) * 0.02], [0.18, 0, -i * 0.18]);
  }
  b.rig.crown = crown;

  // Giant Scissoring Chelicerae / Fangs
  const jaw = b.group('arachne_jaw', b.rig.head, 0, -0.06, 0.12);
  for (const side of [-1, 1] as const) {
    b.cyl(0.045, 0.032, 0.18, 6, chitin, jaw, [side * 0.095, -0.02, 0.06], [0.65, 0, side * 0.3]);
    b.cone(0.035, 0.18, 5, boneMat, jaw, [side * 0.075, -0.1, 0.15], [1.18, -side * 0.38, 0]);
  }
  b.rig.jaw = jaw;

  // Bioluminescent Insectoid Brood-Wings + 4 Venomous Lasher Tendrils
  attachBossWings(b, chitin, wingMembrane, {
    mountY: 0.28,
    mountZ: -0.02,
    span: 0.98,
    feathers: 5,
    liftAngle: 0.48,
    sweepBack: -0.35,
  });
  attachBossTendrils(b, b.rig.torso, flesh, emeraldGlow, [
    { pos: [-0.24, 0.14, 0.08], rot: [0.2, 0.35, -0.65], segLen: 0.22, count: 3 },
    { pos: [0.24, 0.14, 0.08], rot: [0.2, -0.35, 0.65], segLen: 0.22, count: 3 },
    { pos: [-0.22, 0.12, -0.14], rot: [0.35, 0.2, -0.5], segLen: 0.2, count: 3 },
    { pos: [0.22, 0.12, -0.14], rot: [0.35, -0.2, 0.5], segLen: 0.2, count: 3 },
  ]);

  // Colossal Swollen Brood-Sac Abdomen + 3 Pulsing Bioluminescent Weakpoints
  const abdomen = b.group('brood_abdomen', b.rig.pelvis, 0, 0.16, -0.52);
  b.sphere(0.46, 12, 10, chitin, abdomen, [0, 0.08, -0.12], [1.08, 0.95, 1.42]);
  b.sphere(0.43, 10, 9, emeraldGlow, abdomen, [0, 0.04, -0.16], [1.02, 0.86, 1.34]);
  for (let i = 0; i < 4; i++) {
    const zPos = 0.18 - i * 0.22;
    b.cone(0.045, 0.2, 5, chitin, abdomen, [-0.18, 0.44, zPos], [-0.25, 0, 0.35]);
    b.cone(0.045, 0.2, 5, chitin, abdomen, [0.18, 0.44, zPos], [-0.25, 0, -0.35]);
  }
  b.addWeakpoint(abdomen, 'brood_sac_prime', 0x69db7c, 0.16, [0, 0.38, -0.22], 3.5);
  b.addWeakpoint(abdomen, 'brood_sac_left', 0x51cf66, 0.12, [0.36, 0.18, -0.18], 3.0);
  b.addWeakpoint(abdomen, 'brood_sac_right', 0x51cf66, 0.12, [-0.36, 0.18, -0.18], 3.0);
  b.rig.tailSegments.push(abdomen);

  // 8 Monumental Spiked Scythe-Legs
  const legRows: Array<{ z: number; yaw: number; femurLen: number; tibiaLen: number }> = [
    { z: 0.26, yaw: 0.65, femurLen: 0.54, tibiaLen: 0.7 },
    { z: 0.09, yaw: 0.22, femurLen: 0.52, tibiaLen: 0.66 },
    { z: -0.08, yaw: -0.24, femurLen: 0.52, tibiaLen: 0.66 },
    { z: -0.25, yaw: -0.68, femurLen: 0.56, tibiaLen: 0.72 },
  ];

  for (let row = 0; row < 4; row++) {
    const cfg = legRows[row];
    for (const side of [-1, 1] as const) {
      const coxa = b.group(`queen_leg_${side}_${row}_coxa`, b.rig.pelvis, side * 0.24, 0.02, cfg.z);
      coxa.rotation.y = side === 1 ? -cfg.yaw : cfg.yaw;
      b.sphere(0.065, 6, 5, flesh, coxa, [0, 0, 0]);

      const femur = b.group(`queen_leg_${side}_${row}_femur`, coxa, 0, 0, 0);
      femur.rotation.z = -side * 0.74;
      b.cyl(0.052, 0.038, cfg.femurLen, 6, chitin, femur, [side * cfg.femurLen * 0.5, 0, 0], [0, 0, Math.PI * 0.5]);
      b.cone(0.032, 0.15, 4, chitin, femur, [side * cfg.femurLen * 0.65, 0.08, 0], [0, 0, -side * 0.35]);

      const tibia = b.group(`queen_leg_${side}_${row}_tibia`, femur, side * cfg.femurLen, 0, 0);
      tibia.rotation.z = side * 1.9;
      b.sphere(0.055, 6, 5, emeraldGlow, tibia, [0, 0, 0]);
      b.cone(0.045, cfg.tibiaLen, 6, chitin, tibia, [side * cfg.tibiaLen * 0.5, 0, 0], [0, 0, -side * Math.PI * 0.5]);

      b.rig.spiderLegs.push({ side, rowIndex: row, coxa, femur, tibia });
    }
  }

  return b.finalizeRig();
}

/* ============================================================================
 * BOSS 3: IGNIS FORGEMASTER — Floor III Infernal Forge Pinnacle Boss (3.0x Scale)
 * Obsidian & Dark-Iron Titan with Blazing Crown, Forge-Pinion Wings & Molten Heart Weakpoints
 * ========================================================================== */
function buildIgnisForgemaster(assets: HandleAssetRegistry): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'heavy_biped',
    attackStyle: 'melee_slam',
    isBoss: true,
    dissolveTheme: 'molten_orange',
    baseScale: 3.0,
    telegraphColorHex: 0xff6b1a,
    pelvisY: 0.86,
    torsoOffsetY: 0.14,
    headOffsetY: 0.66,
    bodyRadius: 1.75,
    bodyHeight: 5.7,
  });

  const darkIron = assets.mat('metal_dark_iron');
  const obsidian = assets.mat('wall_obsidian');
  const gold = assets.mat('metal_gold');
  const lava = assets.mat('lava_emissive');
  const demonFlesh = assets.mat('flesh_demon');

  // Forged Titan Pelvis & Dark-Iron Blacksmith War-Apron
  b.box(0.46, 0.16, 0.3, darkIron, b.rig.pelvis, [0, 0, 0]);
  b.box(0.48, 0.06, 0.32, gold, b.rig.pelvis, [0, 0.06, 0]);
  const apron = b.group('forge_apron', b.rig.pelvis, 0, -0.02, 0.16);
  b.box(0.32, 0.52, 0.035, obsidian, apron, [0, -0.26, 0]);
  b.box(0.24, 0.44, 0.042, lava, apron, [0, -0.24, 0.005]);
  b.rig.capeSegments.push(apron);

  // Heavy Piston-Forged Legs
  const legs = b.createBipedLegs(0.21, -0.04, 0.4, 0.42, 0.1, demonFlesh, darkIron, obsidian);
  for (const leg of [legs.left, legs.right]) {
    b.box(0.26, 0.32, 0.28, darkIron, leg.knee, [0, -0.22, 0.02]);
    b.box(0.28, 0.045, 0.3, lava, leg.knee, [0, -0.15, 0.02]);
  }

  // Barrel Furnace Chest + Exposed Molten Furnace-Heart Weakpoint behind Iron Grates
  b.cyl(0.36, 0.28, 0.58, 8, obsidian, b.rig.torso, [0, 0.31, 0]);
  b.box(0.62, 0.26, 0.38, darkIron, b.rig.torso, [0, 0.46, -0.02]);
  // Iron furnace ribs across chest core
  for (let i = -1; i <= 1; i++) {
    b.box(0.032, 0.3, 0.04, gold, b.rig.torso, [i * 0.09, 0.31, 0.31]);
  }
  b.addWeakpoint(b.rig.torso, 'ignis_furnace_core', 0xff5500, 0.15, [0, 0.31, 0.25], 3.8);

  // Twin Dorsal Smokestack Pylons + Blazing Forge-Pinion Wings + Molten Chain Tendrils
  for (const side of [-1, 1] as const) {
    b.cyl(0.075, 0.095, 0.46, 7, darkIron, b.rig.torso, [side * 0.2, 0.66, -0.2], [-0.28, 0, -side * 0.18]);
    b.sphere(0.068, 6, 5, lava, b.rig.torso, [side * 0.24, 0.88, -0.26]);
  }
  attachBossWings(b, darkIron, lava, {
    mountY: 0.48,
    mountZ: -0.18,
    span: 1.08,
    feathers: 6,
    liftAngle: 0.38,
    sweepBack: -0.24,
  });
  attachBossTendrils(b, b.rig.pelvis, darkIron, lava, [
    { pos: [-0.22, -0.04, -0.14], rot: [0.35, 0, -0.25], segLen: 0.2, count: 3 },
    { pos: [0.22, -0.04, -0.14], rot: [0.35, 0, 0.25], segLen: 0.2, count: 3 },
  ]);

  // Horned Obsidian Titan Helm + Blazing Molten Iron Crown
  const helm = b.group('ignis_helm', b.rig.head, 0, 0.14, 0.03, false);
  b.box(0.3, 0.32, 0.28, darkIron, helm, [0, 0.04, 0]);
  b.box(0.22, 0.05, 0.04, lava, helm, [0, 0.08, 0.145]); // blazing T-visor slit
  b.box(0.05, 0.16, 0.04, lava, helm, [0, 0.01, 0.145]);
  b.addCurvedHorns(helm, obsidian, {
    spreadX: 0.17,
    baseY: 0.14,
    baseZ: 0,
    length: 0.5,
    radius: 0.065,
    sweepPitch: 0.25,
    flareRoll: 0.72,
  });

  const crown = b.group('ignis_crown', helm, 0, 0.22, 0);
  b.cyl(0.18, 0.165, 0.1, 8, gold, crown, [0, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    b.cone(0.038, 0.24, 4, i % 2 === 0 ? lava : gold, crown, [Math.sin(ang) * 0.17, 0.16, Math.cos(ang) * 0.17]);
  }
  b.rig.crown = crown;

  // Massive Crucible-Pauldron Arms (with Weakpoints) + World-Breaker Forge Warhammer
  const arms = b.createBipedArms(0.46, 0.5, 0.38, 0.4, 0.095, demonFlesh, darkIron, gold);
  for (const side of [-1, 1] as const) {
    const sh = side === -1 ? arms.right.shoulder : arms.left.shoulder;
    b.cyl(0.19, 0.22, 0.22, 8, darkIron, sh, [side * 0.07, 0.06, 0], [0, 0, -side * 0.25]);
    b.addWeakpoint(sh, `ignis_crucible_${side}`, 0xff922b, 0.08, [side * 0.12, 0.18, 0], 3.3);
  }

  // Right hand (-X): Titanic Runed World-Breaker Forge Warhammer
  arms.right.shoulder.rotation.set(-0.35, 0, -0.22);
  arms.right.elbow.rotation.set(-0.55, 0, 0);
  const hammer = b.group('worldbreaker_hammer', arms.right.hand, 0, -0.02, 0.04, false);
  hammer.rotation.set(Math.PI * 0.42, 0, 0);
  b.cyl(0.036, 0.032, 1.4, 7, darkIron, hammer, [0, 0.4, 0]);
  b.box(0.56, 0.34, 0.34, obsidian, hammer, [0, 1.05, 0]); // colossal anvil head
  b.box(0.59, 0.24, 0.24, lava, hammer, [0, 1.05, 0]); // glowing impact faces
  b.box(0.48, 0.38, 0.38, gold, hammer, [0, 1.05, 0], [0, 0, 0]);

  // Left hand (+X): Molten Anvil-Crusher Gauntlet
  arms.left.shoulder.rotation.set(-0.32, 0.15, 0.24);
  arms.left.elbow.rotation.set(-0.65, 0, 0);
  b.box(0.28, 0.32, 0.3, obsidian, arms.left.hand, [0, -0.06, 0.04]);
  b.box(0.3, 0.06, 0.32, lava, arms.left.hand, [0, -0.1, 0.04]);

  return b.finalizeRig();
}

/* ============================================================================
 * BOSS 4: MALAKOR VOID EMPEROR — Floor IV Astral Void Final Boss (3.2x Scale)
 * Sovereign of the Shattered Crown: Levitating Crown Shards, Seraphic Void Wings,
 * 6 Writhing Abyssal Tendrils, Singularity Heart Weakpoints & Eclipse Greatsword
 * ========================================================================== */
function buildMalakorVoidEmperor(assets: HandleAssetRegistry): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'floating',
    attackStyle: 'boss_sweeping',
    isBoss: true,
    dissolveTheme: 'void_violet',
    baseScale: 3.2,
    hoverBaseY: 0.26,
    telegraphColorHex: 0xda77f2,
    pelvisY: 0.88,
    torsoOffsetY: 0.14,
    headOffsetY: 0.66,
    bodyRadius: 1.85,
    bodyHeight: 6.4,
  });

  const obsidian = assets.mat('wall_obsidian');
  const arcane = assets.mat('cloth_arcane');
  const shadow = assets.mat('cloth_shadow');
  const gold = assets.mat('metal_gold');
  const voidGlow = assets.mat('rune_glow_void');
  const cyanCrystal = assets.mat('crystal_cyan');

  // Imperial Levitating Astral Robes & Gilded Mantle Panels
  const robeCore = b.group('malakor_robe', b.rig.pelvis, 0, 0, 0);
  b.cyl(0.24, 0.48, 0.96, 10, arcane, robeCore, [0, -0.48, 0]);
  b.cyl(0.26, 0.42, 0.88, 8, obsidian, robeCore, [0, -0.44, -0.02]);
  b.rig.tailSegments.push(robeCore);

  const imperialStole = b.group('malakor_stole', b.rig.pelvis, 0, 0, 0.25);
  b.box(0.2, 0.78, 0.024, gold, imperialStole, [0, -0.39, 0]);
  b.box(0.14, 0.72, 0.03, voidGlow, imperialStole, [0, -0.39, 0.005]);
  b.rig.capeSegments.push(imperialStole);

  // 6 Writhing Abyssal Shadow-Void Tendrils unfurling beneath robes & back
  attachBossTendrils(b, b.rig.pelvis, shadow, voidGlow, [
    { pos: [-0.24, -0.25, -0.1], rot: [0.32, 0.2, -0.38], segLen: 0.24, count: 4 },
    { pos: [0.24, -0.25, -0.1], rot: [0.32, -0.2, 0.38], segLen: 0.24, count: 4 },
    { pos: [-0.16, -0.28, -0.22], rot: [0.48, 0.1, -0.2], segLen: 0.24, count: 4 },
    { pos: [0.16, -0.28, -0.22], rot: [0.48, -0.1, 0.2], segLen: 0.24, count: 4 },
    { pos: [-0.28, 0.25, -0.18], rot: [0.4, 0.3, -0.55], segLen: 0.22, count: 3 },
    { pos: [0.28, 0.25, -0.18], rot: [0.4, -0.3, 0.55], segLen: 0.22, count: 3 },
  ]);

  // Split Obsidian Imperial Cuirass + Astral Singularity Heart Weakpoint + Pylon Weakpoints
  b.cyl(0.3, 0.22, 0.58, 8, obsidian, b.rig.torso, [0, 0.3, 0]);
  for (const side of [-1, 1] as const) {
    b.box(0.2, 0.44, 0.28, obsidian, b.rig.torso, [side * 0.18, 0.34, 0.04], [0, 0, -side * 0.12]);
    b.box(0.04, 0.42, 0.3, gold, b.rig.torso, [side * 0.09, 0.34, 0.05]);
    // Flanking floating Void-Crystal Pylon Weakpoints above shoulders
    b.addWeakpoint(b.rig.torso, `malakor_pylon_${side}`, 0x66d9e8, 0.085, [side * 0.48, 0.72, -0.06], 3.3);
  }
  b.addWeakpoint(b.rig.torso, 'malakor_singularity', 0xe599f7, 0.14, [0, 0.34, 0.18], 4.0);

  // Majestic Seraphic Astral-Void Wings (Upper + Lower Wing Pair Effect)
  attachBossWings(b, gold, voidGlow, {
    mountY: 0.52,
    mountZ: -0.18,
    span: 1.22,
    feathers: 7,
    liftAngle: 0.46,
    sweepBack: -0.2,
  });

  // Imperial Helm + THE SHATTERED CROWN (Levitating Halo of Golden & Crystal Shards!)
  const helm = b.group('malakor_helm', b.rig.head, 0, 0.14, 0, false);
  b.sphere(0.18, 9, 8, obsidian, helm, [0, 0.04, 0], [0.95, 1.15, 1.1]);
  const astralVisor = assets.glow('malakor_visor', 0x66d9e8, 3.4);
  b.box(0.035, 0.18, 0.035, astralVisor, helm, [0, 0.05, 0.165]);
  b.box(0.18, 0.03, 0.035, voidGlow, helm, [0, 0.06, 0.16]);
  b.addCurvedHorns(helm, gold, {
    spreadX: 0.15,
    baseY: 0.12,
    baseZ: -0.02,
    length: 0.48,
    radius: 0.045,
    sweepPitch: 0.18,
    flareRoll: 0.48,
  });

  // Levitating Shattered Crown above Malakor's brow
  const shatteredCrown = b.group('shattered_crown', helm, 0, 0.34, 0);
  b.torus(0.22, 0.016, 6, 16, voidGlow, shatteredCrown, [0, 0, 0], [Math.PI * 0.5, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const shardH = i % 2 === 0 ? 0.26 : 0.16;
    const r = 0.22 + (i % 3) * 0.018;
    const yJit = (i % 2) * 0.03;
    b.cone(
      0.034,
      shardH,
      4,
      i === 0 ? cyanCrystal : gold,
      shatteredCrown,
      [Math.sin(ang) * r, yJit + shardH * 0.4, Math.cos(ang) * r],
      [Math.cos(ang) * 0.18, 0, -Math.sin(ang) * 0.18],
    );
  }
  b.rig.crown = shatteredCrown;

  // Imperial Arms + Eclipse Sovereign Greatsword + Cataclysm Orb + Orbiting Void Monoliths
  const arms = b.createBipedArms(0.38, 0.5, 0.36, 0.36, 0.058, arcane, obsidian, gold);
  for (const side of [-1, 1] as const) {
    const sh = side === -1 ? arms.right.shoulder : arms.left.shoulder;
    b.cone(0.16, 0.34, 5, obsidian, sh, [side * 0.08, 0.08, 0], [0, 0, -side * 0.72]);
    b.torus(0.16, 0.024, 5, 10, gold, sh, [side * 0.05, 0.02, 0], [Math.PI * 0.5, 0, 0]);
  }

  // Right hand (-X): Eclipse Sovereign Split-Blade Astral Greatsword
  arms.right.shoulder.rotation.set(-0.42, 0, -0.24);
  arms.right.elbow.rotation.set(-0.5, 0, 0);
  const greatsword = b.group('eclipse_greatsword', arms.right.hand, 0, -0.02, 0.04, false);
  greatsword.rotation.set(Math.PI * 0.4, 0, 0);
  b.cyl(0.028, 0.026, 0.34, 6, gold, greatsword, [0, -0.06, 0]);
  b.torus(0.14, 0.028, 6, 12, gold, greatsword, [0, 0.16, 0]); // Eclipse ring crossguard
  b.sphere(0.065, 8, 6, obsidian, greatsword, [0, 0.16, 0]); // Black-hole core
  // Twin parallel void-crystal blades framing an astral rift
  b.box(0.045, 1.05, 0.025, obsidian, greatsword, [-0.048, 0.72, 0]);
  b.box(0.045, 1.05, 0.025, obsidian, greatsword, [0.048, 0.72, 0]);
  b.box(0.036, 1.12, 0.018, voidGlow, greatsword, [0, 0.78, 0]);
  b.cone(0.075, 0.28, 4, cyanCrystal, greatsword, [0, 1.42, 0], [0, Math.PI * 0.25, 0]);

  // Left hand (+X): Levitating Cataclysm Singularity Orb
  arms.left.shoulder.rotation.set(-0.68, -0.2, 0.25);
  arms.left.elbow.rotation.set(-0.75, 0.2, 0);
  const cataclysmOrb = b.group('cataclysm_orb', arms.left.hand, 0, -0.04, 0.14, false);
  b.sphere(0.09, 8, 7, obsidian, cataclysmOrb, [0, 0, 0]);
  b.torus(0.14, 0.016, 5, 12, cyanCrystal, cataclysmOrb, [0, 0, 0], [0.6, 0.4, 0]);
  b.torus(0.14, 0.016, 5, 12, voidGlow, cataclysmOrb, [0, 0, 0], [-0.6, 0.4, Math.PI * 0.5]);

  // 4 Orbiting Astral Rune Monoliths around the Void Emperor
  for (let i = 0; i < 4; i++) {
    const monolith = b.group(`void_monolith_${i}`, b.rig.torso, 0, 0, 0, false);
    b.octa(0.085, i % 2 === 0 ? voidGlow : cyanCrystal, monolith, [0, 0, 0], [0.65, 1.65, 0.65]);
    b.torus(0.11, 0.012, 4, 8, gold, monolith, [0, 0, 0], [Math.PI * 0.5, 0, 0]);
    b.addOrbiter(b.rig.torso, monolith, {
      radius: 0.78,
      height: 0.42,
      speed: 1.65,
      phase: (i / 4) * Math.PI * 2,
      bobAmp: 0.1,
      tiltAmp: 0.3,
    });
  }

  return b.finalizeRig();
}
