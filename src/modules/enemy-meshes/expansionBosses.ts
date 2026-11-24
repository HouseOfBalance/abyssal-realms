import { attachBossTendrils, attachBossWings } from './bossBuilders';
import {
  type ArticulatedEnemyRig,
  type HandleAssetRegistry,
  RigBuilder,
} from './rigTypes';

/* ============================================================================
 * BOSS 5: VALKYRIA, SERAPH OF ETERNAL RIME — Floor 5 Cathedral Boss (2.95x Scale)
 * 6-Winged Ice Valkyrie with Sunburst Rime Crown, Glacial Spear & Aegis Shield
 * ========================================================================== */
export function buildValkyriaRimeSeraph(assets: HandleAssetRegistry): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'floating',
    attackStyle: 'boss_sweeping',
    isBoss: true,
    dissolveTheme: 'frost_cyan',
    baseScale: 2.95,
    hoverBaseY: 0.28,
    telegraphColorHex: 0x4dabf7,
    pelvisY: 0.88,
    torsoOffsetY: 0.14,
    headOffsetY: 0.64,
    bodyRadius: 1.75,
    bodyHeight: 5.9,
  });

  const steel = assets.mat('metal_steel');
  const gold = assets.mat('metal_gold');
  const glacier = assets.mat('ice_glacier');
  const cyanCrystal = assets.mat('crystal_cyan');
  const runeBlue = assets.mat('rune_glow_blue');
  const arcaneCloth = assets.mat('cloth_arcane');

  // Floating Seraphic Battle-Skirt, Plated Greaves & Frosted Banners
  const warSkirt = b.group('valkyria_skirt', b.rig.pelvis, 0, 0, 0);
  b.cyl(0.22, 0.42, 0.82, 10, arcaneCloth, warSkirt, [0, -0.42, 0]);
  b.torus(0.41, 0.022, 6, 16, gold, warSkirt, [0, -0.8, 0], [Math.PI * 0.5, 0, 0]);
  b.rig.tailSegments.push(warSkirt);

  b.createBipedLegs(0.15, -0.05, 0.4, 0.42, 0.058, steel, gold, steel);

  for (const side of [-1, 1] as const) {
    const tasset = b.group(`valkyria_banner_${side}`, b.rig.pelvis, side * 0.2, -0.02, 0.12);
    b.box(0.14, 0.64, 0.024, glacier, tasset, [0, -0.32, 0], [0, 0, -side * 0.12]);
    b.rig.capeSegments.push(tasset);
  }

  // Sculpted Seraph Cuirass + Frozen Choir Heart Weakpoint + Shoulder Halo Prisms
  b.cyl(0.27, 0.2, 0.56, 10, steel, b.rig.torso, [0, 0.29, 0]);
  b.box(0.38, 0.28, 0.24, gold, b.rig.torso, [0, 0.38, 0.02]);
  b.addWeakpoint(b.rig.torso, 'valkyria_heart', 0x66d9e8, 0.12, [0, 0.36, 0.16], 3.7);
  for (const side of [-1, 1] as const) {
    b.addWeakpoint(b.rig.torso, `valkyria_prism_${side}`, 0x4dabf7, 0.08, [side * 0.44, 0.68, -0.04], 3.2);
  }

  // 6 ARTICULATED SERAPHIC ICE-CRYSTAL WINGS (3 Tiers x 2 Sides = 6 Wings!)
  attachBossWings(b, gold, glacier, {
    mountY: 0.6,
    mountZ: -0.16,
    span: 1.26,
    feathers: 7,
    liftAngle: 0.72,
    sweepBack: -0.18,
    tierIndex: 0,
  });
  attachBossWings(b, steel, cyanCrystal, {
    mountY: 0.45,
    mountZ: -0.19,
    span: 1.12,
    feathers: 6,
    liftAngle: 0.24,
    sweepBack: -0.24,
    tierIndex: 1,
  });
  attachBossWings(b, gold, runeBlue, {
    mountY: 0.3,
    mountZ: -0.16,
    span: 0.92,
    feathers: 5,
    liftAngle: -0.22,
    sweepBack: -0.3,
    tierIndex: 2,
  });

  // 4 Trailing Frost-Silk Ribbon Tendrils
  attachBossTendrils(b, b.rig.torso, glacier, cyanCrystal, [
    { pos: [-0.2, 0.22, -0.18], rot: [0.38, 0.2, -0.35], segLen: 0.24, count: 3 },
    { pos: [0.2, 0.22, -0.18], rot: [0.38, -0.2, 0.35], segLen: 0.24, count: 3 },
    { pos: [-0.14, 0.12, -0.2], rot: [0.48, 0.1, -0.2], segLen: 0.22, count: 3 },
    { pos: [0.14, 0.12, -0.2], rot: [0.48, -0.1, 0.2], segLen: 0.22, count: 3 },
  ]);

  // Winged Valkyrie Helm + Radiant Sunburst Rime Crown
  const helm = b.group('valkyria_helm', b.rig.head, 0, 0.14, 0, false);
  b.sphere(0.17, 9, 8, steel, helm, [0, 0.04, 0], [0.94, 1.12, 1.08]);
  b.box(0.18, 0.035, 0.04, runeBlue, helm, [0, 0.05, 0.16]);
  // Cheek & temple valkyrie ear-wings
  for (const side of [-1, 1] as const) {
    b.cone(0.065, 0.34, 4, gold, helm, [side * 0.19, 0.14, -0.04], [-0.45, 0, -side * 0.42]);
    b.cone(0.05, 0.28, 4, glacier, helm, [side * 0.22, 0.2, -0.09], [-0.55, 0, -side * 0.55]);
  }
  const crown = b.group('valkyria_crown', helm, 0, 0.22, 0.02);
  b.torus(0.16, 0.02, 6, 14, gold, crown, [0, 0, 0], [Math.PI * 0.5, 0, 0]);
  for (let i = -3; i <= 3; i++) {
    const h = 0.28 - Math.abs(i) * 0.035;
    b.cone(0.028, h, 4, i === 0 ? cyanCrystal : gold, crown, [i * 0.055, h * 0.5, 0.12 - Math.abs(i) * 0.02], [0.15, 0, -i * 0.2]);
  }
  b.rig.crown = crown;

  // Arms: Right (-X) Spear of Eternal Rime; Left (+X) Winged Crystal Aegis
  const arms = b.createBipedArms(0.35, 0.49, 0.36, 0.35, 0.054, steel, gold, gold);
  arms.right.shoulder.rotation.set(-0.42, 0, -0.22);
  arms.right.elbow.rotation.set(-0.48, 0, 0);

  const spear = b.group('spear_eternal_rime', arms.right.hand, 0, -0.02, 0.04, false);
  spear.rotation.set(Math.PI * 0.42, 0, 0);
  b.cyl(0.026, 0.024, 1.55, 7, gold, spear, [0, 0.32, 0]);
  b.octa(0.11, gold, spear, [0, 0.98, 0], [1.4, 0.7, 0.7]);
  b.cone(0.075, 0.58, 4, glacier, spear, [0, 1.32, 0], [0, Math.PI * 0.25, 0]);
  b.cone(0.042, 0.34, 4, cyanCrystal, spear, [-0.08, 1.18, 0], [0, 0, 0.22]);
  b.cone(0.042, 0.34, 4, cyanCrystal, spear, [0.08, 1.18, 0], [0, 0, -0.22]);

  arms.left.shoulder.rotation.set(-0.52, 0.22, 0.24);
  arms.left.elbow.rotation.set(-0.62, -0.2, 0);
  const aegis = b.group('valkyria_aegis', arms.left.hand, 0.05, -0.03, 0.08, false);
  aegis.rotation.set(0.12, -0.32, 0);
  b.box(0.42, 0.66, 0.045, gold, aegis, [0, 0, 0]);
  b.box(0.34, 0.56, 0.055, glacier, aegis, [0, 0, 0.01]);
  b.octa(0.095, runeBlue, aegis, [0, 0.04, 0.06]);

  return b.finalizeRig();
}

/* ============================================================================
 * BOSS 6: CHRONOS, TIME ARCHITECT — Floor 6+ Observatory Final Boss (3.2x Scale)
 * Levitating Astrolabe Titan with Hourglass Core, Spinning Gyroscopes & Chrono-Halberd
 * ========================================================================== */
export function buildChronosTimeArchitect(assets: HandleAssetRegistry): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'floating',
    attackStyle: 'boss_sweeping',
    isBoss: true,
    dissolveTheme: 'void_violet',
    baseScale: 3.2,
    hoverBaseY: 0.3,
    telegraphColorHex: 0xffd43b,
    pelvisY: 0.88,
    torsoOffsetY: 0.14,
    headOffsetY: 0.68,
    bodyRadius: 1.9,
    bodyHeight: 6.4,
  });

  const brass = assets.mat('brass_clockwork');
  const gold = assets.mat('metal_gold');
  const obsidian = assets.mat('wall_obsidian');
  const arcane = assets.mat('cloth_arcane');
  const cyanCrystal = assets.mat('crystal_cyan');
  const voidGlow = assets.mat('rune_glow_void');

  // Celestial Architect Robes & Pendulum Stole
  const robe = b.group('chronos_robe', b.rig.pelvis, 0, 0, 0);
  b.cyl(0.24, 0.48, 0.94, 10, arcane, robe, [0, -0.47, 0]);
  b.torus(0.47, 0.025, 6, 18, brass, robe, [0, -0.92, 0], [Math.PI * 0.5, 0, 0]);
  b.rig.tailSegments.push(robe);

  const pendulumStole = b.group('chronos_pendulum', b.rig.pelvis, 0, 0, 0.25);
  b.box(0.18, 0.72, 0.024, brass, pendulumStole, [0, -0.36, 0]);
  b.cyl(0.09, 0.09, 0.035, 10, gold, pendulumStole, [0, -0.72, 0.01], [Math.PI * 0.5, 0, 0]);
  b.rig.capeSegments.push(pendulumStole);

  // Split Open Obsidian/Brass Torso Framing MONUMENTAL GLOWING HOURGLASS CORE!
  for (const side of [-1, 1] as const) {
    b.box(0.18, 0.54, 0.28, obsidian, b.rig.torso, [side * 0.24, 0.32, 0], [0, 0, -side * 0.12]);
    b.box(0.05, 0.56, 0.3, brass, b.rig.torso, [side * 0.15, 0.32, 0.02]);
    b.addWeakpoint(b.rig.torso, `chronos_shoulder_node_${side}`, 0x66d9e8, 0.08, [side * 0.48, 0.68, 0], 3.3);
  }
  // Hourglass top & bottom brass caps + inverted crystal bulbs + central Chronon Singularity Weakpoint!
  b.cyl(0.17, 0.17, 0.04, 10, gold, b.rig.torso, [0, 0.54, 0.05]);
  b.cyl(0.17, 0.17, 0.04, 10, gold, b.rig.torso, [0, 0.1, 0.05]);
  b.cone(0.15, 0.21, 8, cyanCrystal, b.rig.torso, [0, 0.42, 0.05], [Math.PI, 0, 0]); // upper bulb
  b.cone(0.15, 0.21, 8, cyanCrystal, b.rig.torso, [0, 0.22, 0.05], [0, 0, 0]); // lower bulb
  b.addWeakpoint(b.rig.torso, 'chronos_hourglass_core', 0xffd43b, 0.11, [0, 0.32, 0.06], 4.0);

  // 3 Concentric Multi-Axis Spinning Astrolabe Gyroscope Rings around the Torso!
  const gyroX = b.group('chronos_gyro_x', b.rig.torso, 0, 0.34, 0, false);
  b.torus(0.56, 0.022, 6, 20, brass, gyroX);
  b.rig.spinningGears.push({ node: gyroX, axis: 'y', speed: 1.35 });

  const gyroY = b.group('chronos_gyro_y', b.rig.torso, 0, 0.34, 0, false);
  b.torus(0.64, 0.018, 6, 20, gold, gyroY, [0, 0, 0], [Math.PI * 0.35, 0, 0]);
  b.rig.spinningGears.push({ node: gyroY, axis: 'z', speed: -1.05 });

  b.addSpinningGear(b.rig.torso, brass, {
    radius: 0.44,
    tube: 0.028,
    teeth: 12,
    pos: [0, 0.42, -0.26],
    axis: 'z',
    speed: 1.5,
  });

  // Clockwork Pendulum-Blade & Starlight Wings + 4 Temporal Ribbon-Tendrils
  attachBossWings(b, brass, cyanCrystal, {
    mountY: 0.52,
    mountZ: -0.2,
    span: 1.22,
    feathers: 7,
    liftAngle: 0.44,
    sweepBack: -0.22,
  });
  attachBossTendrils(b, b.rig.pelvis, brass, voidGlow, [
    { pos: [-0.24, -0.2, -0.12], rot: [0.34, 0.2, -0.35], segLen: 0.24, count: 4 },
    { pos: [0.24, -0.2, -0.12], rot: [0.34, -0.2, 0.35], segLen: 0.24, count: 4 },
    { pos: [-0.16, -0.24, -0.22], rot: [0.46, 0.1, -0.2], segLen: 0.22, count: 3 },
    { pos: [0.16, -0.24, -0.22], rot: [0.46, -0.1, 0.2], segLen: 0.22, count: 3 },
  ]);

  // Faceless Observatory Helm + 12-Pointed Sundial Clock-Crown
  const helm = b.group('chronos_helm', b.rig.head, 0, 0.14, 0, false);
  b.sphere(0.18, 10, 8, obsidian, helm, [0, 0.04, 0], [0.92, 1.16, 1.06]);
  b.torus(0.12, 0.018, 6, 14, gold, helm, [0, 0.05, 0.16]);
  b.octa(0.055, cyanCrystal, helm, [0, 0.05, 0.17]);

  const crown = b.group('chronos_sundial_crown', helm, 0, 0.32, -0.04);
  b.torus(0.26, 0.02, 6, 18, gold, crown);
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const h = i % 3 === 0 ? 0.18 : 0.1;
    b.cone(
      0.024,
      h,
      4,
      i % 3 === 0 ? cyanCrystal : brass,
      crown,
      [Math.cos(ang) * (0.26 + h * 0.45), Math.sin(ang) * (0.26 + h * 0.45), 0],
      [0, 0, ang - Math.PI * 0.5],
    );
  }
  b.rig.crown = crown;

  // Arms: Right (-X) Chrono-Halberd (Hand of Fate); Left (+X) Levitating Celestial Orrery
  const arms = b.createBipedArms(0.4, 0.5, 0.36, 0.36, 0.058, brass, obsidian, gold);
  arms.right.shoulder.rotation.set(-0.42, 0, -0.22);
  arms.right.elbow.rotation.set(-0.5, 0, 0);

  const halberd = b.group('chrono_halberd', arms.right.hand, 0, -0.02, 0.04, false);
  halberd.rotation.set(Math.PI * 0.4, 0, 0);
  b.cyl(0.028, 0.024, 1.55, 7, brass, halberd, [0, 0.38, 0]);
  b.addSpinningGear(halberd, gold, {
    radius: 0.18,
    tube: 0.024,
    teeth: 8,
    pos: [0, 1.02, 0],
    axis: 'z',
    speed: 3.0,
  });
  b.cone(0.075, 0.48, 4, cyanCrystal, halberd, [0, 1.38, 0], [0, Math.PI * 0.25, 0]);
  b.box(0.38, 0.26, 0.028, gold, halberd, [0.16, 1.02, 0]);

  arms.left.shoulder.rotation.set(-0.68, -0.2, 0.24);
  arms.left.elbow.rotation.set(-0.75, 0.2, 0);
  const orrery = b.group('hand_orrery', arms.left.hand, 0, -0.04, 0.14, false);
  b.sphere(0.08, 8, 7, voidGlow, orrery);
  b.torus(0.15, 0.015, 5, 14, gold, orrery, [0, 0, 0], [0.7, 0.4, 0]);
  b.rig.spinningGears.push({ node: orrery, axis: 'y', speed: 3.4 });

  // 4 Orbiting Time-Shard Prisms
  for (let i = 0; i < 4; i++) {
    const prism = b.group(`chronos_shard_${i}`, b.rig.torso, 0, 0, 0, false);
    b.octa(0.08, i % 2 === 0 ? cyanCrystal : gold, prism, [0, 0, 0], [0.6, 1.7, 0.6]);
    b.addOrbiter(b.rig.torso, prism, {
      radius: 0.84,
      height: 0.4,
      speed: 1.75,
      phase: (i / 4) * Math.PI * 2,
      bobAmp: 0.1,
      tiltAmp: 0.28,
    });
  }

  return b.finalizeRig();
}

/* ============================================================================
 * BOSS 7: THE BUTCHER — Relentless Blood-Soaked Cleaver & Hook Demon (2.9x Scale)
 * Gore-Apron Abomination with Horned Iron Crown, Meat-Rack Wings, Cleaver & Sickle Hook
 * ========================================================================== */
export function buildTheButcher(assets: HandleAssetRegistry): ArticulatedEnemyRig {
  const b = new RigBuilder(assets, {
    locomotion: 'heavy_biped',
    attackStyle: 'boss_sweeping',
    isBoss: true,
    dissolveTheme: 'molten_orange',
    baseScale: 2.9,
    telegraphColorHex: 0xff2b45,
    pelvisY: 0.84,
    torsoOffsetY: 0.12,
    headOffsetY: 0.62,
    bodyRadius: 1.8,
    bodyHeight: 5.5,
  });

  const demonFlesh = assets.mat('flesh_demon');
  const crimsonCloth = assets.mat('cloth_crimson');
  const mythicGore = assets.mat('mythic_crimson');
  const darkIron = assets.mat('metal_dark_iron');
  const steel = assets.mat('metal_steel');
  const boneMat = assets.mat('bone');

  // Heavy Iron-Chained Pelvis & Gore-Drenched Butcher's Apron
  b.box(0.5, 0.18, 0.36, darkIron, b.rig.pelvis, [0, 0, 0]);
  const apron = b.group('butcher_apron', b.rig.pelvis, 0, 0.02, 0.22);
  b.box(0.42, 0.56, 0.035, crimsonCloth, apron, [0, -0.28, 0]);
  b.box(0.32, 0.36, 0.042, mythicGore, apron, [0, -0.34, 0.004]);
  b.rig.capeSegments.push(apron);

  // Thick Muscular Demon Pillar Legs with Iron Shackles
  const legs = b.createBipedLegs(0.22, -0.04, 0.39, 0.41, 0.105, demonFlesh, demonFlesh, darkIron);
  for (const leg of [legs.left, legs.right]) {
    b.torus(0.11, 0.026, 6, 10, darkIron, leg.knee, [0, -0.18, 0], [Math.PI * 0.5, 0, 0]);
  }

  // Grotesquely Hulking Barrel-Gut Torso + Boiling Blood-Furnace Core Weakpoint
  b.sphere(0.42, 10, 9, demonFlesh, b.rig.torso, [0, 0.28, 0.04], [1.18, 1.05, 1.08]);
  b.box(0.66, 0.26, 0.4, demonFlesh, b.rig.torso, [0, 0.46, -0.02]);
  // Iron rib-staples over exposed crimson belly-furnace weakpoint
  for (let i = -1; i <= 1; i++) {
    b.box(0.28, 0.032, 0.04, darkIron, b.rig.torso, [0, 0.26 + i * 0.09, 0.42]);
  }
  b.addWeakpoint(b.rig.torso, 'butcher_blood_furnace', 0xff2b45, 0.14, [0, 0.26, 0.36], 3.8);

  // Dorsal Spiked Iron Meat-Rack Wings + 4 Swinging Iron Hook-Chain Tendrils
  attachBossWings(b, darkIron, mythicGore, {
    mountY: 0.48,
    mountZ: -0.2,
    span: 0.96,
    feathers: 5,
    liftAngle: 0.42,
    sweepBack: -0.28,
  });
  attachBossTendrils(b, b.rig.pelvis, darkIron, steel, [
    { pos: [-0.26, 0.02, 0.12], rot: [0.22, 0, -0.28], segLen: 0.2, count: 3 },
    { pos: [0.26, 0.02, 0.12], rot: [0.22, 0, 0.28], segLen: 0.2, count: 3 },
    { pos: [-0.22, 0.02, -0.16], rot: [0.35, 0, -0.25], segLen: 0.22, count: 3 },
    { pos: [0.22, 0.02, -0.16], rot: [0.35, 0, 0.25], segLen: 0.22, count: 3 },
  ]);

  // Brutal Horned Demon Head, Roaring Iron Jaw-Trap & Jagged Gore-Iron Crown
  b.rig.head.position.set(0, 0.6, 0.08);
  b.sphere(0.2, 9, 8, demonFlesh, b.rig.head, [0, 0.06, 0], [1.1, 0.98, 1.08]);
  const eyeGlow = assets.glow('butcher_eyes', 0xff2b45, 3.5);
  for (const side of [-1, 1] as const) {
    b.sphere(0.036, 6, 5, eyeGlow, b.rig.head, [side * 0.08, 0.08, 0.18]);
  }
  b.addCurvedHorns(b.rig.head, boneMat, {
    spreadX: 0.18,
    baseY: 0.12,
    baseZ: 0.02,
    length: 0.52,
    radius: 0.068,
    sweepPitch: 0.48, // goring forward bull-horns!
    flareRoll: 0.65,
  });

  const jaw = b.group('butcher_jaw', b.rig.head, 0, -0.06, 0.04);
  jaw.rotation.x = 0.24;
  b.box(0.22, 0.09, 0.2, darkIron, jaw, [0, -0.03, 0.09]); // spiked iron underbite trap
  for (let i = -2; i <= 2; i++) {
    b.cone(0.022, 0.08, 4, boneMat, jaw, [i * 0.042, 0.04, 0.18]);
  }
  b.rig.jaw = jaw;

  const crown = b.group('butcher_gore_crown', b.rig.head, 0, 0.2, 0);
  b.cyl(0.18, 0.17, 0.08, 8, darkIron, crown);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    b.cone(0.034, 0.2, 4, i % 2 === 0 ? mythicGore : darkIron, crown, [Math.sin(ang) * 0.17, 0.13, Math.cos(ang) * 0.17]);
  }
  b.rig.crown = crown;

  // Massive Arms: Right (-X) Blood-Soaked Butcher's Cleaver; Left (+X) Wicked Meat-Hook!
  const arms = b.createBipedArms(0.48, 0.48, 0.38, 0.4, 0.11, demonFlesh, demonFlesh, darkIron);
  for (const side of [-1, 1] as const) {
    const sh = side === -1 ? arms.right.shoulder : arms.left.shoulder;
    b.sphere(0.19, 8, 6, darkIron, sh, [side * 0.06, 0.06, 0], [1.15, 0.85, 1.05]);
    b.addWeakpoint(sh, `butcher_boil_${side}`, 0xff6b35, 0.075, [side * 0.12, 0.14, 0.08], 3.1);
  }

  // Right hand (-X): Colossal Blood-Soaked Butcher's Meat Cleaver
  arms.right.shoulder.rotation.set(-0.38, 0, -0.24);
  arms.right.elbow.rotation.set(-0.55, 0, 0);
  const cleaver = b.group('butcher_cleaver', arms.right.hand, 0, -0.02, 0.04, false);
  cleaver.rotation.set(Math.PI * 0.42, 0, 0);
  b.cyl(0.036, 0.032, 0.38, 7, darkIron, cleaver, [0, 0, 0]);
  // Broad rectangular cleaver slab + crimson blood-drenched edge + hanging hole ring
  b.box(0.36, 0.82, 0.04, steel, cleaver, [0.1, 0.56, 0]);
  b.box(0.08, 0.82, 0.046, mythicGore, cleaver, [0.25, 0.56, 0]); // bloodied cutting edge
  b.box(0.1, 0.84, 0.05, darkIron, cleaver, [-0.04, 0.56, 0]); // heavy iron spine
  b.torus(0.045, 0.015, 5, 10, darkIron, cleaver, [0.18, 0.86, 0]);

  // Left hand (+X): Chained Iron Sickle Meat-Hook
  arms.left.shoulder.rotation.set(-0.55, 0.2, 0.25);
  arms.left.elbow.rotation.set(-0.65, -0.15, 0);
  const hook = b.group('butcher_meathook', arms.left.hand, 0, -0.02, 0.04, false);
  hook.rotation.set(Math.PI * 0.45, 0, 0);
  b.cyl(0.03, 0.028, 0.55, 6, darkIron, hook, [0, 0.2, 0]); // iron chain-shaft
  b.torus(0.22, 0.038, 6, 12, steel, hook, [0.14, 0.62, 0], [0, 0, Math.PI * 0.35], Math.PI * 1.35);
  b.cone(0.048, 0.2, 5, mythicGore, hook, [0.32, 0.52, 0], [0, 0, Math.PI * 0.85]); // barbed blood-tip

  return b.finalizeRig();
}
