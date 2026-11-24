import type * as THREE from 'three';
import {
  type ArticulatedEnemyRig,
  type HandleAssetRegistry,
  RigBuilder,
} from './rigTypes';

/* ============================================================================
 * 9. FROST REVENANT — Ice-Armored Gothic Knight (Sunken Cathedral of Rime)
 * ========================================================================== */
export function buildFrostRevenant(
  assets: HandleAssetRegistry,
  eliteMul: number,
): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'biped',
    attackStyle: 'melee_slash',
    dissolveTheme: 'frost_cyan',
    baseScale: 1.08 * eliteMul,
    telegraphColorHex: 0x4dabf7,
    pelvisY: 0.88,
    torsoOffsetY: 0.12,
    headOffsetY: 0.58,
    bodyRadius: 0.58,
    bodyHeight: 2.0,
  });

  const steel = assets.mat('metal_steel');
  const darkIron = assets.mat('metal_dark_iron');
  const glacier = assets.mat('ice_glacier');
  const cyanCrystal = assets.mat('crystal_cyan');
  const runeBlue = assets.mat('rune_glow_blue');
  const shadowCloth = assets.mat('cloth_shadow');

  // Plated pelvis, tassets & frost-rimmed war cape
  b.box(0.32, 0.14, 0.22, darkIron, b.rig.pelvis, [0, 0, 0]);
  b.box(0.35, 0.06, 0.24, steel, b.rig.pelvis, [0, 0.05, 0]);
  for (const side of [-1, 1] as const) {
    b.box(0.12, 0.24, 0.04, steel, b.rig.pelvis, [side * 0.16, -0.14, 0.08], [0, 0, -side * 0.15]);
  }
  const cape = b.group('frost_cape', b.rig.torso, 0, 0.48, -0.14);
  b.box(0.46, 0.88, 0.025, shadowCloth, cape, [0, -0.44, -0.02], [0.12, 0, 0]);
  b.box(0.42, 0.12, 0.03, glacier, cape, [0, -0.82, -0.06], [0.12, 0, 0]);
  b.rig.capeSegments.push(cape);

  // Plated greave legs with frost knee-spikes
  const legs = b.createBipedLegs(0.14, -0.04, 0.41, 0.43, 0.06, darkIron, steel, steel);
  for (const leg of [legs.left, legs.right]) {
    b.cone(0.036, 0.14, 4, glacier, leg.knee, [0, 0.02, 0.08], [Math.PI * 0.45, 0, 0]);
  }

  // Gothic cuirass encrusted with jagged rime ice clusters
  b.cyl(0.25, 0.2, 0.54, 8, steel, b.rig.torso, [0, 0.28, 0]);
  b.box(0.38, 0.26, 0.25, darkIron, b.rig.torso, [0, 0.38, 0]);
  b.addWeakpoint(b.rig.torso, 'revenant_frost_heart', 0x66d9e8, 0.075, [0, 0.36, 0.14], 2.9);
  // Dorsal glacier spires
  b.cone(0.055, 0.32, 5, glacier, b.rig.torso, [-0.14, 0.58, -0.14], [-0.45, 0, 0.28]);
  b.cone(0.065, 0.38, 5, cyanCrystal, b.rig.torso, [0.15, 0.62, -0.15], [-0.48, 0, -0.25]);

  // Horned Frozen Greathelm with glowing glacial visor
  const helm = b.group('revenant_helm', b.rig.head, 0, 0.14, 0, false);
  b.cyl(0.15, 0.16, 0.28, 8, steel, helm, [0, 0.02, 0]);
  b.box(0.2, 0.036, 0.04, runeBlue, helm, [0, 0.05, 0.15]);
  b.addCurvedHorns(helm, glacier, {
    spreadX: 0.14,
    baseY: 0.1,
    baseZ: 0,
    length: 0.36,
    radius: 0.042,
    sweepPitch: 0.3,
    flareRoll: 0.58,
  });

  // Plated arms + Asymmetric Glacier Shoulder Spires
  const arms = b.createBipedArms(0.3, 0.46, 0.34, 0.33, 0.052, darkIron, steel, steel);
  for (const side of [-1, 1] as const) {
    const sh = side === -1 ? arms.right.shoulder : arms.left.shoulder;
    b.sphere(0.13, 7, 6, steel, sh, [side * 0.04, 0.04, 0], [1.15, 0.85, 1.05]);
    b.cone(0.048, 0.24, 5, glacier, sh, [side * 0.09, 0.16, 0], [0, 0, -side * 0.55]);
  }

  // Right hand (-X): Jagged Glacial Runeblade
  arms.right.shoulder.rotation.set(-0.38, 0, -0.2);
  arms.right.elbow.rotation.set(-0.52, 0, 0);
  const sword = b.group('glacial_runeblade', arms.right.hand, 0, -0.02, 0.04, false);
  sword.rotation.set(Math.PI * 0.42, 0, 0);
  b.cyl(0.024, 0.024, 0.22, 6, darkIron, sword, [0, -0.05, 0]);
  b.box(0.28, 0.04, 0.06, steel, sword, [0, 0.08, 0]);
  b.box(0.09, 0.78, 0.026, glacier, sword, [0, 0.48, 0]);
  b.box(0.035, 0.72, 0.032, runeBlue, sword, [0, 0.46, 0]);
  b.cone(0.052, 0.22, 4, cyanCrystal, sword, [0, 0.98, 0], [0, Math.PI * 0.25, 0]);

  // Left hand (+X): Rime-Crusted Heraldic Kite Shield
  arms.left.shoulder.rotation.set(-0.52, 0.26, 0.22);
  arms.left.elbow.rotation.set(-0.62, -0.22, 0);
  const shield = b.group('rime_kite_shield', arms.left.hand, 0.05, -0.03, 0.08, false);
  shield.rotation.set(0.14, -0.34, 0);
  b.box(0.38, 0.52, 0.04, steel, shield, [0, 0.08, 0]);
  b.cone(0.2, 0.34, 4, steel, shield, [0, -0.28, 0], [Math.PI, Math.PI * 0.25, 0]);
  b.octa(0.09, glacier, shield, [0, 0.06, 0.05], [1.0, 1.4, 0.7]);

  return b.finalizeRig();
}

/* ============================================================================
 * 10. ICE WRAITH — Crystalline Banshee (Sunken Cathedral of Rime)
 * ========================================================================== */
export function buildIceWraith(
  assets: HandleAssetRegistry,
  eliteMul: number,
): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'floating',
    attackStyle: 'staff_cast',
    dissolveTheme: 'frost_cyan',
    baseScale: 1.04 * eliteMul,
    hoverBaseY: 0.34,
    telegraphColorHex: 0x66d9e8,
    pelvisY: 0.84,
    torsoOffsetY: 0.12,
    headOffsetY: 0.56,
    bodyRadius: 0.54,
    bodyHeight: 2.0,
  });

  const glacier = assets.mat('ice_glacier');
  const cyanCrystal = assets.mat('crystal_cyan');
  const runeBlue = assets.mat('rune_glow_blue');
  const arcaneCloth = assets.mat('cloth_arcane');
  const boneMat = assets.mat('bone');

  // Trailing icicle spire & spectral frost shroud ribbons
  const iceTail = b.group('wraith_icicle_tail', b.rig.pelvis, 0, 0, 0);
  b.cone(0.22, 0.82, 6, glacier, iceTail, [0, -0.41, -0.02], [Math.PI, 0, 0]);
  b.cone(0.14, 0.62, 5, cyanCrystal, iceTail, [0, -0.35, 0.03], [Math.PI * 0.95, 0, 0]);
  b.rig.tailSegments.push(iceTail);

  for (const side of [-1, 0, 1] as const) {
    const shroud = b.group(`banshee_shroud_${side}`, b.rig.torso, side * 0.16, 0.38, -0.12);
    b.box(0.14, 0.78, 0.02, arcaneCloth, shroud, [0, -0.39, -0.04], [0.24, 0, side * 0.16]);
    b.rig.capeSegments.push(shroud);
  }

  // Translucent rime ribcage & glowing frozen banshee core
  b.cyl(0.2, 0.14, 0.5, 7, glacier, b.rig.torso, [0, 0.26, 0]);
  b.addRibcage(b.rig.torso, cyanCrystal, { width: 0.21, height: 0.4, depth: 0.14, pairs: 4, yOffset: 0.06 });
  b.addWeakpoint(b.rig.torso, 'wraith_core', 0x99e9f2, 0.085, [0, 0.3, 0.08], 3.0);

  // Screaming Banshee Skull + Razor Icicle Halo Crown
  const skull = b.addSkull(b.rig.head, boneMat, 0x66d9e8, 0.96);
  if (b.rig.jaw) {
    b.rig.jaw.rotation.x = 0.38; // permanent banshee wail!
  }
  const crown = b.group('wraith_icicle_crown', skull, 0, 0.12, -0.02);
  for (let i = -3; i <= 3; i++) {
    const h = 0.28 - Math.abs(i) * 0.035;
    b.cone(
      0.026,
      h,
      4,
      i % 2 === 0 ? glacier : cyanCrystal,
      crown,
      [i * 0.065, h * 0.45, -Math.abs(i) * 0.015],
      [-0.2, 0, -i * 0.22],
    );
  }
  b.rig.crown = crown;

  // Elongated frost-clawed spectral arms
  const arms = b.createBipedArms(0.26, 0.45, 0.34, 0.34, 0.034, glacier, cyanCrystal, runeBlue);
  for (const side of [-1, 1] as const) {
    const arm = side === -1 ? arms.right : arms.left;
    arm.shoulder.rotation.set(-0.62, side * 0.18, -side * 0.28);
    arm.elbow.rotation.set(-0.55, 0, 0);
    // 3 elongated razor ice claws per hand
    for (let c = -1; c <= 1; c++) {
      b.cone(0.016, 0.24, 4, glacier, arm.hand, [c * 0.03, -0.11, 0.05], [0.45, 0, c * 0.15]);
    }
  }

  // 3 Orbiting Razor Ice Shards
  for (let i = 0; i < 3; i++) {
    const shard = b.group(`wraith_ice_shard_${i}`, b.rig.torso, 0, 0, 0, false);
    b.octa(0.075, i % 2 === 0 ? glacier : runeBlue, shard, [0, 0, 0], [0.55, 1.8, 0.55]);
    b.addOrbiter(b.rig.torso, shard, {
      radius: 0.68,
      height: 0.36,
      speed: 2.35,
      phase: (i / 3) * Math.PI * 2,
      bobAmp: 0.08,
      tiltAmp: 0.28,
    });
  }

  return b.finalizeRig();
}

/* ============================================================================
 * 11. CLOCKWORK AUTOMATON — Brass Gear Golem (Clockwork Astral Observatory)
 * ========================================================================== */
export function buildClockworkAutomaton(
  assets: HandleAssetRegistry,
  eliteMul: number,
): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'heavy_biped',
    attackStyle: 'melee_slam',
    dissolveTheme: 'molten_orange',
    baseScale: 1.2 * eliteMul,
    telegraphColorHex: 0xffd43b,
    pelvisY: 0.86,
    torsoOffsetY: 0.14,
    headOffsetY: 0.6,
    bodyRadius: 0.72,
    bodyHeight: 2.25,
  });

  const brass = assets.mat('brass_clockwork');
  const gold = assets.mat('metal_gold');
  const darkIron = assets.mat('metal_dark_iron');
  const steel = assets.mat('metal_steel');
  const runeBlue = assets.mat('rune_glow_blue');

  // Geared waist differential & piston legs
  b.cyl(0.24, 0.26, 0.16, 10, darkIron, b.rig.pelvis, [0, 0, 0]);
  b.torus(0.25, 0.025, 6, 12, brass, b.rig.pelvis, [0, 0.04, 0], [Math.PI * 0.5, 0, 0]);

  const legs = b.createBipedLegs(0.2, -0.05, 0.39, 0.42, 0.085, darkIron, brass, darkIron);
  for (const leg of [legs.left, legs.right]) {
    b.cyl(0.11, 0.1, 0.26, 8, brass, leg.knee, [0, -0.2, 0.01]);
    b.cyl(0.025, 0.025, 0.32, 6, steel, leg.hip, [0, -0.2, -0.09]); // hydraulic piston rod
  }

  // Barrel Brass Chassis + Spinning Front Escapement Gear + Dorsal Mainspring Cogwheel
  b.cyl(0.32, 0.26, 0.54, 10, brass, b.rig.torso, [0, 0.3, 0]);
  b.box(0.56, 0.2, 0.34, darkIron, b.rig.torso, [0, 0.46, 0]);
  b.addWeakpoint(b.rig.torso, 'automaton_dynamo', 0x3bc9db, 0.11, [0, 0.3, 0.28], 3.2);

  b.addSpinningGear(b.rig.torso, gold, {
    radius: 0.17,
    teeth: 8,
    pos: [0, 0.3, 0.31],
    axis: 'z',
    speed: 2.2,
  });
  b.addSpinningGear(b.rig.torso, brass, {
    radius: 0.32,
    teeth: 10,
    pos: [0, 0.38, -0.28],
    rot: [0, Math.PI * 0.5, 0],
    axis: 'x',
    speed: -1.6,
  });

  // Cylindrical Observatory Turret Head + Glowing Monocle Lens
  b.cyl(0.16, 0.18, 0.26, 10, brass, b.rig.head, [0, 0.1, 0]);
  b.torus(0.09, 0.02, 6, 12, gold, b.rig.head, [0, 0.11, 0.17]);
  b.sphere(0.075, 8, 6, runeBlue, b.rig.head, [0, 0.11, 0.16]);
  b.cyl(0.018, 0.024, 0.18, 6, gold, b.rig.head, [0, 0.29, 0]);
  b.sphere(0.038, 6, 6, runeBlue, b.rig.head, [0, 0.39, 0]);

  // Piston Arms: Right (-X) Rotating Buzzsaw Gauntlet; Left (+X) Heavy Clockwork Clamp
  const arms = b.createBipedArms(0.44, 0.46, 0.36, 0.38, 0.085, darkIron, brass, gold);
  for (const side of [-1, 1] as const) {
    const sh = side === -1 ? arms.right.shoulder : arms.left.shoulder;
    b.cyl(0.16, 0.18, 0.18, 8, brass, sh, [side * 0.05, 0.04, 0], [0, 0, Math.PI * 0.5]);
  }

  arms.right.shoulder.rotation.set(-0.28, 0, -0.18);
  arms.right.elbow.rotation.set(-0.55, 0, 0);
  b.box(0.18, 0.26, 0.22, darkIron, arms.right.hand, [0, -0.04, 0.02]);
  b.addSpinningGear(arms.right.hand, steel, {
    radius: 0.22,
    tube: 0.024,
    teeth: 10,
    pos: [0, -0.16, 0.08],
    rot: [0, Math.PI * 0.5, 0],
    axis: 'x',
    speed: 6.5, // high-speed spinning buzzsaw!
  });

  arms.left.shoulder.rotation.set(-0.28, 0, 0.18);
  arms.left.elbow.rotation.set(-0.5, 0, 0);
  b.box(0.24, 0.22, 0.24, brass, arms.left.hand, [0, -0.04, 0.02]);
  b.box(0.06, 0.22, 0.14, steel, arms.left.hand, [-0.09, -0.2, 0.06], [0, 0, 0.2]);
  b.box(0.06, 0.22, 0.14, steel, arms.left.hand, [0.09, -0.2, 0.06], [0, 0, -0.2]);

  return b.finalizeRig();
}

/* ============================================================================
 * 12. ASTRAL WEAVER — Cosmic Mage (Clockwork Astral Observatory)
 * ========================================================================== */
export function buildAstralWeaver(
  assets: HandleAssetRegistry,
  eliteMul: number,
): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'floating',
    attackStyle: 'staff_cast',
    dissolveTheme: 'void_violet',
    baseScale: 1.06 * eliteMul,
    hoverBaseY: 0.32,
    telegraphColorHex: 0xda77f2,
    pelvisY: 0.86,
    torsoOffsetY: 0.14,
    headOffsetY: 0.58,
    bodyRadius: 0.58,
    bodyHeight: 2.1,
  });

  const arcane = assets.mat('cloth_arcane');
  const brass = assets.mat('brass_clockwork');
  const gold = assets.mat('metal_gold');
  const obsidian = assets.mat('wall_obsidian');
  const voidGlow = assets.mat('rune_glow_void');
  const cyanCrystal = assets.mat('crystal_cyan');

  // Flowing star-woven lower robe & celestial brass-trimmed stole
  const robe = b.group('weaver_robe', b.rig.pelvis, 0, 0, 0);
  b.cyl(0.22, 0.42, 0.88, 10, arcane, robe, [0, -0.44, 0]);
  b.torus(0.41, 0.02, 5, 16, brass, robe, [0, -0.86, 0], [Math.PI * 0.5, 0, 0]);
  b.rig.tailSegments.push(robe);

  const stole = b.group('weaver_stole', b.rig.pelvis, 0, 0, 0.22);
  b.box(0.16, 0.68, 0.022, brass, stole, [0, -0.34, 0]);
  b.box(0.11, 0.62, 0.028, cyanCrystal, stole, [0, -0.34, 0.004]);
  b.rig.capeSegments.push(stole);

  // Robed torso + celestial astrolabe collar
  b.cyl(0.24, 0.19, 0.54, 8, arcane, b.rig.torso, [0, 0.27, 0]);
  b.torus(0.28, 0.022, 6, 14, brass, b.rig.torso, [0, 0.5, 0], [Math.PI * 0.42, 0, 0]);
  b.addWeakpoint(b.rig.torso, 'weaver_star_heart', 0x66d9e8, 0.08, [0, 0.34, 0.22], 3.0);

  // Faceless Obsidian Star-Mirror Mask + Spinning Brass Astrolabe Halo
  const mask = b.group('weaver_mask', b.rig.head, 0, 0.14, 0, false);
  b.sphere(0.16, 9, 8, obsidian, mask, [0, 0.03, 0], [0.9, 1.15, 1.05]);
  b.octa(0.045, cyanCrystal, mask, [0, 0.05, 0.155], [0.7, 1.4, 0.5]);
  b.addSpinningGear(mask, gold, {
    radius: 0.25,
    tube: 0.016,
    teeth: 6,
    pos: [0, 0.1, -0.08],
    axis: 'z',
    speed: 1.4,
  });

  // Arms + Orrery Astral Staff + Constellation Focus
  const arms = b.createBipedArms(0.28, 0.46, 0.33, 0.31, 0.045, arcane, brass, gold);
  arms.right.shoulder.rotation.set(-0.5, 0, -0.18);
  arms.right.elbow.rotation.set(-0.55, 0, 0);

  const staff = b.group('orrery_staff', arms.right.hand, 0, 0, 0.04, false);
  staff.rotation.set(0.3, 0, 0);
  b.cyl(0.024, 0.02, 1.8, 7, brass, staff, [0, 0.34, 0]);
  const orreryHead = b.group('orrery_rings', staff, 0, 1.36, 0, false);
  b.torus(0.17, 0.018, 6, 14, gold, orreryHead);
  b.torus(0.13, 0.015, 6, 12, brass, orreryHead, [0, 0, 0], [0.8, 0.6, 0]);
  b.octa(0.075, voidGlow, orreryHead);
  b.rig.spinningGears.push({ node: orreryHead, axis: 'y', speed: 2.6 });

  arms.left.shoulder.rotation.set(-0.72, -0.22, 0.24);
  arms.left.elbow.rotation.set(-0.78, 0.2, 0);
  b.octa(0.07, cyanCrystal, arms.left.hand, [0, -0.04, 0.09]);

  // 3 Orbiting Constellation Star Octahedrons
  for (let i = 0; i < 3; i++) {
    const star = b.group(`astral_star_${i}`, b.rig.torso, 0, 0, 0, false);
    b.octa(0.07, i % 2 === 0 ? cyanCrystal : voidGlow, star, [0, 0, 0]);
    b.torus(0.1, 0.01, 4, 10, gold, star, [0, 0, 0], [Math.PI * 0.5, 0, 0]);
    b.addOrbiter(b.rig.torso, star, {
      radius: 0.7,
      height: 0.4,
      speed: 2.0,
      phase: (i / 3) * Math.PI * 2,
      bobAmp: 0.09,
      tiltAmp: 0.32,
    });
  }

  return b.finalizeRig();
}

/* ============================================================================
 * 13. TREASURE GOBLIN — Hunched Imp Carrying a Bulging Golden Loot Sack!
 * ========================================================================== */
export function buildTreasureGoblin(
  assets: HandleAssetRegistry,
  eliteMul: number,
): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'biped',
    attackStyle: 'melee_slash',
    dissolveTheme: 'molten_orange',
    baseScale: 0.88 * eliteMul,
    telegraphColorHex: 0xffd43b,
    pelvisY: 0.66,
    torsoOffsetY: 0.08,
    headOffsetY: 0.42,
    bodyRadius: 0.55,
    bodyHeight: 1.55,
  });

  const impSkin = assets.mat('flesh_demon', 'goblin_skin', (m) => {
    m.color.setHex(0x5c7a38); // gnarled olive-chartreuse goblin hide
  });
  const crimson = assets.mat('cloth_crimson');
  const sackCloth = assets.mat('wood_oak');
  const gold = assets.mat('metal_gold');
  const cyanGem = assets.mat('crystal_cyan');
  const mythicGem = assets.mat('mythic_crimson');

  // Hunched forward goblin posture!
  b.rig.torso.rotation.x = 0.38;
  b.rig.head.position.set(0, 0.42, 0.14);
  b.rig.head.rotation.x = -0.28;

  // Ragged goblin breeches & quick scurrying legs
  b.box(0.28, 0.12, 0.2, crimson, b.rig.pelvis, [0, 0, 0]);
  b.createBipedLegs(0.12, -0.03, 0.3, 0.33, 0.045, crimson, impSkin, sackCloth);

  // Wiry torso + Gold coin belt
  b.cyl(0.2, 0.17, 0.42, 8, impSkin, b.rig.torso, [0, 0.21, 0]);
  b.torus(0.19, 0.028, 6, 10, gold, b.rig.torso, [0, 0.06, 0], [Math.PI * 0.5, 0, 0]);

  // COLOSSAL BULGING GOLDEN LOOT SACK on back (-Z), overflowing with treasure!
  const sack = b.group('goblin_loot_sack', b.rig.torso, 0.06, 0.34, -0.34);
  b.sphere(0.42, 10, 9, sackCloth, sack, [0, 0, -0.06], [1.05, 1.15, 1.08]);
  b.torus(0.16, 0.032, 6, 10, gold, sack, [-0.04, 0.42, 0.14], [0.5, 0, 0]); // golden rope cinch
  b.cone(0.2, 0.22, 7, crimson, sack, [-0.04, 0.52, 0.18], [-2.6, 0, 0]); // open sack mouth
  // Protruding gold coins, gems, goblet & legendary hilt sticking out of the sack!
  b.cyl(0.08, 0.05, 0.18, 7, gold, sack, [0.06, 0.56, 0.16], [0.4, 0, -0.35]); // golden chalice
  b.octa(0.085, cyanGem, sack, [-0.12, 0.54, 0.18], [1, 1.3, 1]);
  b.octa(0.08, mythicGem, sack, [0.0, 0.58, 0.24], [1, 1.2, 1]);
  b.cyl(0.022, 0.022, 0.32, 6, gold, sack, [-0.08, 0.66, 0.08], [-0.35, 0, 0.4]); // sword hilt
  b.box(0.22, 0.035, 0.045, gold, sack, [-0.02, 0.55, 0.1], [-0.35, 0, 0.4]);
  b.addWeakpoint(sack, 'goblin_hoard_gleam', 0xffd43b, 0.11, [0, 0.48, 0.2], 3.2);

  // Grinning Goblin Head, Long Pointed Ears & Gleaming Gold Eyes
  b.sphere(0.16, 8, 8, impSkin, b.rig.head, [0, 0.06, 0], [1.05, 0.95, 1.12]);
  b.cone(0.05, 0.16, 5, impSkin, b.rig.head, [0, 0.03, 0.2], [Math.PI * 0.55, 0, 0]); // hooked nose
  for (const side of [-1, 1] as const) {
    // Long swept goblin ears + gold earring
    b.cone(0.048, 0.28, 4, impSkin, b.rig.head, [side * 0.24, 0.09, -0.02], [-0.15, 0, -side * 1.18]);
    const eyeGlow = assets.glow('goblin_eye', 0xffd43b, 3.0);
    b.sphere(0.032, 6, 5, eyeGlow, b.rig.head, [side * 0.068, 0.07, 0.145]);
  }
  b.cone(0.16, 0.24, 7, crimson, b.rig.head, [0, 0.2, -0.06], [-0.55, 0, 0]); // pointed red cap
  const jaw = b.group('goblin_jaw', b.rig.head, 0, -0.05, 0.04);
  b.box(0.15, 0.055, 0.15, impSkin, jaw, [0, -0.02, 0.06]);
  b.rig.jaw = jaw;

  // Arms: Left (+X) holds loot sack strap over shoulder; Right (-X) clutches gold dagger
  const arms = b.createBipedArms(0.23, 0.36, 0.28, 0.28, 0.038, impSkin, impSkin, gold);
  arms.left.shoulder.rotation.set(-1.35, 0.2, 0.22);
  arms.left.elbow.rotation.set(-1.1, 0, 0);

  arms.right.shoulder.rotation.set(-0.4, 0, -0.25);
  arms.right.elbow.rotation.set(-0.65, 0, 0);
  const dagger = b.group('goblin_dagger', arms.right.hand, 0, -0.02, 0.04, false);
  dagger.rotation.set(Math.PI * 0.45, 0, 0);
  b.cyl(0.02, 0.02, 0.14, 6, sackCloth, dagger, [0, 0, 0]);
  b.cone(0.04, 0.32, 4, gold, dagger, [0, 0.22, 0], [0, Math.PI * 0.25, 0]);

  return b.finalizeRig();
}

/* ============================================================================
 * 14. CHEST MIMIC — Fanged Monster Chest with Lashing Crimson Tongue!
 * ========================================================================== */
export function buildChestMimic(
  assets: HandleAssetRegistry,
  eliteMul: number,
): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'quadruped',
    attackStyle: 'bite_lunge',
    dissolveTheme: 'molten_orange',
    baseScale: 1.06 * eliteMul,
    telegraphColorHex: 0xff2b45,
    pelvisY: 0.48,
    torsoOffsetY: 0.0,
    headOffsetY: 0.16,
    bodyRadius: 0.68,
    bodyHeight: 1.35,
  });

  const oak = assets.mat('wood_oak');
  const darkIron = assets.mat('metal_dark_iron');
  const gold = assets.mat('metal_gold');
  const boneMat = assets.mat('bone');
  const flesh = assets.mat('flesh_demon');
  const mythicCrimson = assets.mat('mythic_crimson');

  // Lower Chest Box (pelvis/torso) + Dark Maw Cavity + Spilled Gold Coins
  b.box(0.76, 0.34, 0.54, oak, b.rig.pelvis, [0, 0.02, 0]);
  b.box(0.68, 0.08, 0.46, flesh, b.rig.pelvis, [0, 0.16, 0.02]); // fleshy gum interior
  // Iron corner straps & gold lockplate
  for (const xOff of [-0.3, 0, 0.3]) {
    b.box(0.065, 0.36, 0.56, darkIron, b.rig.pelvis, [xOff, 0.02, 0]);
  }
  b.box(0.14, 0.16, 0.05, gold, b.rig.pelvis, [0, 0.1, 0.28]);

  // Hinged Lower Jaw Rim with 6 upward-pointing jagged Bone Fangs
  const jaw = b.group('mimic_lower_jaw', b.rig.pelvis, 0, 0.17, -0.18);
  jaw.rotation.x = 0.16;
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    b.cone(0.032, 0.15, 4, boneMat, jaw, [i * 0.095, 0.07, 0.42], [0.15, 0, 0]);
  }
  b.rig.jaw = jaw;

  // Hinged Arched Upper Chest Lid (`head`, hinged at rear `-Z` so pitching `-X` flings lid wide open!)
  b.rig.head.position.set(0, 0.19, -0.24);
  b.rig.head.rotation.x = -0.48; // ominous half-open predatory gape in rest pose!
  b.box(0.76, 0.16, 0.54, oak, b.rig.head, [0, 0.08, 0.26]);
  b.cyl(0.27, 0.27, 0.76, 8, oak, b.rig.head, [0, 0.16, 0.26], [0, 0, Math.PI * 0.5]);
  for (const xOff of [-0.3, 0, 0.3]) {
    b.cyl(0.285, 0.285, 0.065, 8, darkIron, b.rig.head, [xOff, 0.16, 0.26], [0, 0, Math.PI * 0.5]);
  }
  // Upper row of 7 downward-pointing jagged Bone Fangs + 4 Glowing Mimic Eyes inside lid!
  for (let i = -3; i <= 3; i++) {
    b.cone(0.034, 0.16, 4, boneMat, b.rig.head, [i * 0.095, -0.06, 0.5], [Math.PI - 0.15, 0, 0]);
  }
  const eyeGlow = assets.glow('mimic_eye', 0xffd43b, 3.2);
  for (const [ex, ey] of [
    [-0.18, 0.08],
    [-0.08, 0.11],
    [0.08, 0.11],
    [0.18, 0.08],
  ]) {
    b.sphere(0.03, 6, 5, eyeGlow, b.rig.head, [ex, ey, 0.42]);
  }

  // Articulated 4-Segment Lashing Crimson Tongue curling forward (+Z) out of the maw!
  const tongueSegments: THREE.Group[] = [];
  let tongueParent: THREE.Object3D = b.rig.pelvis;
  for (let s = 0; s < 4; s++) {
    const seg = b.group(
      `mimic_tongue_${s}`,
      tongueParent,
      0,
      s === 0 ? 0.22 : -0.22,
      s === 0 ? 0.12 : 0,
    );
    if (s === 0) {
      // Point tongue forward (+Z) & slightly upward
      seg.rotation.set(-Math.PI * 0.62, 0, 0);
    } else {
      seg.rotation.set(0.28, 0, 0);
    }
    const rTop = 0.068 - s * 0.012;
    const rBot = 0.056 - s * 0.012;
    b.cyl(rTop, rBot, 0.23, 6, s >= 2 ? mythicCrimson : flesh, seg, [0, -0.115, 0]);
    if (s === 3) {
      // Forked crimson tongue tip
      b.cone(0.028, 0.14, 4, mythicCrimson, seg, [-0.025, -0.27, 0], [Math.PI, 0, -0.25]);
      b.cone(0.028, 0.14, 4, mythicCrimson, seg, [0.025, -0.27, 0], [Math.PI, 0, 0.25]);
    }
    tongueSegments.push(seg);
    tongueParent = seg;
  }
  b.rig.tendrils.push({ segments: tongueSegments, phase: 0 });

  // 4 Scuttling Clawed Mimic Legs underneath the chest (`quadLegs`)
  const makeMimicLeg = (isFront: boolean, side: -1 | 1): void => {
    const zBase = isFront ? 0.18 : -0.18;
    const xBase = side * 0.32;
    const upper = b.group(`mimic_leg_${isFront ? 'f' : 'b'}_${side}`, b.rig.pelvis, xBase, -0.1, zBase);
    upper.rotation.set(isFront ? 0.2 : -0.2, 0, -side * 0.38);
    b.cyl(0.055, 0.042, 0.22, 6, flesh, upper, [0, -0.11, 0]);

    const lower = b.group(`mimic_claw_${isFront ? 'f' : 'b'}_${side}`, upper, 0, -0.2, 0);
    lower.rotation.set(isFront ? -0.22 : 0.22, 0, side * 0.42);
    b.cyl(0.042, 0.03, 0.22, 6, darkIron, lower, [0, -0.11, 0]);
    b.cone(0.032, 0.11, 4, boneMat, lower, [0, -0.22, 0.05], [Math.PI * 0.45, 0, 0]);

    b.rig.quadLegs.push({ isFront, side, upper, lower });
  };

  makeMimicLeg(true, -1);
  makeMimicLeg(true, 1);
  makeMimicLeg(false, -1);
  makeMimicLeg(false, 1);

  return b.finalizeRig();
}
