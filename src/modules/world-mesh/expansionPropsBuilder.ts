import * as THREE from 'three';
import { clamp } from '../../core/Constants';
import type {
  IMaterialLibrary,
  InteractableProp,
  MaterialKey,
} from '../../contracts/types';
import type { BiomeMeshPalette } from './gridUtils';
import {
  createChestLightShaftMaterial,
  createPortalVortexMaterial,
} from './shaders';

export interface ExpansionPropContext {
  baseY: number;
  facingYaw: number;
  palette: BiomeMeshPalette;
  materials: IMaterialLibrary;
  ownedMaterials: THREE.Material[];
  getGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry;
  cloneMaterial(key: MaterialKey): THREE.MeshStandardMaterial;
  registerController(
    id: string,
    ctrl: { markUsed(): void; update(dt: number, elapsedSec: number): void },
  ): void;
}

export function buildExpansionInteractableProp(
  prop: InteractableProp,
  ctx: ExpansionPropContext,
): THREE.Group | null {
  const py = Number.isFinite(prop.position.y) ? prop.position.y : ctx.baseY;

  switch (prop.type) {
    case 'corrupted_obelisk':
      return buildCorruptedObelisk(prop, py, ctx);
    case 'soul_lantern':
      return buildSoulLantern(prop, py, ctx);
    case 'rift_breach':
      return buildRiftBreach(prop, py, ctx);
    case 'stash_chest':
      return buildStashChest(prop, py, ctx);
    case 'gambler_npc':
      return buildGamblerNpc(prop, py, ctx);
    case 'companion_shrine':
      return buildCompanionShrine(prop, py, ctx);
    case 'waypoint_map':
      return buildWaypointMap(prop, py, ctx);
    case 'training_dummy':
      return buildTrainingDummy(prop, py, ctx);
    default:
      return null;
  }
}

// 1. Corrupted Obelisk (3-Rune Monolith)
function buildCorruptedObelisk(
  prop: InteractableProp,
  py: number,
  ctx: ExpansionPropContext,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Prop_corrupted_obelisk_${prop.id}`;
  root.position.set(prop.position.x, py, prop.position.z);
  root.rotation.y = ctx.facingYaw;

  const obsidianMat = ctx.materials.get('wall_obsidian');
  const mythicMat = ctx.cloneMaterial('mythic_crimson');
  mythicMat.emissive = new THREE.Color(0xff1e42);
  mythicMat.emissiveIntensity = 1.85;

  const runeTopMat = ctx.cloneMaterial('rune_glow_crimson');
  const runeMidMat = ctx.cloneMaterial('rune_glow_void');
  const runeBotMat = ctx.cloneMaterial('rune_glow_emerald');

  // Stepped obsidian plinth
  const base1 = new THREE.Mesh(
    ctx.getGeometry('obelisk_base1', () => new THREE.CylinderGeometry(0.95, 1.15, 0.18, 6)),
    obsidianMat,
  );
  base1.position.set(0, 0.09, 0);
  base1.castShadow = true;
  base1.receiveShadow = true;
  root.add(base1);

  const base2 = new THREE.Mesh(
    ctx.getGeometry('obelisk_base2', () => new THREE.CylinderGeometry(0.65, 0.82, 0.24, 4)),
    obsidianMat,
  );
  base2.rotation.y = Math.PI * 0.25;
  base2.position.set(0, 0.30, 0);
  base2.castShadow = true;
  root.add(base2);

  // Tapered 4-sided monolith shaft
  const shaft = new THREE.Mesh(
    ctx.getGeometry('obelisk_shaft', () => new THREE.CylinderGeometry(0.28, 0.50, 2.05, 4)),
    obsidianMat,
  );
  shaft.rotation.y = Math.PI * 0.25;
  shaft.position.set(0, 1.44, 0);
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  root.add(shaft);

  // 3 Distinct Glowing Pact Runes inlaid along the front & back faces of the monolith
  const runePlateGeom = ctx.getGeometry('obelisk_rune_plate', () => new THREE.BoxGeometry(0.22, 0.34, 0.66));
  const runeConfigs: Array<{ y: number; scaleXZ: number; mat: THREE.MeshStandardMaterial }> = [
    { y: 1.98, scaleXZ: 0.78, mat: runeTopMat },
    { y: 1.44, scaleXZ: 0.92, mat: runeMidMat },
    { y: 0.90, scaleXZ: 1.06, mat: runeBotMat },
  ];
  for (const rc of runeConfigs) {
    const plate = new THREE.Mesh(runePlateGeom, rc.mat);
    plate.position.set(0, rc.y, 0);
    plate.scale.set(rc.scaleXZ, 1, rc.scaleXZ);
    root.add(plate);
  }

  // Levitating fractured pyramidion apex + orbiting pact shards
  const capGroup = new THREE.Group();
  capGroup.name = 'ObeliskApexGroup';
  capGroup.position.set(0, 2.74, 0);
  root.add(capGroup);

  const pyramidion = new THREE.Mesh(
    ctx.getGeometry('obelisk_cap', () => new THREE.ConeGeometry(0.32, 0.55, 4)),
    mythicMat,
  );
  pyramidion.rotation.y = Math.PI * 0.25;
  capGroup.add(pyramidion);

  const orbitGroup = new THREE.Group();
  orbitGroup.position.set(0, 1.55, 0);
  root.add(orbitGroup);

  const shardGeom = ctx.getGeometry('obelisk_shard', () => {
    const g = new THREE.OctahedronGeometry(0.11, 0);
    g.scale(0.6, 1.9, 0.6);
    return g;
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const sMesh = new THREE.Mesh(
      shardGeom,
      i === 0 ? runeTopMat : i === 1 ? runeMidMat : runeBotMat,
    );
    sMesh.position.set(Math.cos(a) * 0.68, (i - 1) * 0.25, Math.sin(a) * 0.68);
    orbitGroup.add(sMesh);
  }

  // Ground hexagram pact ring
  const floorRingMat = new THREE.MeshBasicMaterial({
    color: 0xff1e42,
    transparent: true,
    opacity: 0.68,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  ctx.ownedMaterials.push(floorRingMat);
  const floorRing = new THREE.Mesh(
    ctx.getGeometry('obelisk_ring', () => {
      const g = new THREE.RingGeometry(1.05, 1.28, 6);
      g.rotateX(-Math.PI * 0.5);
      return g;
    }),
    floorRingMat,
  );
  floorRing.position.set(0, 0.03, 0);
  root.add(floorRing);

  let isUsed = Boolean(prop.used);
  let pactSurge = 0;

  ctx.registerController(prop.id, {
    markUsed() {
      if (!isUsed) {
        isUsed = true;
        pactSurge = 1.0;
      }
    },
    update(dt: number, elapsedSec: number) {
      if (pactSurge > 0) {
        pactSurge = Math.max(0, pactSurge - dt * 1.4);
      }
      const speed = (isUsed ? 2.4 : 1.1) + pactSurge * 3.0;
      orbitGroup.rotation.y += dt * speed;
      capGroup.position.y = 2.74 + (isUsed ? 0.18 : 0) + Math.sin(elapsedSec * 2.8) * 0.09;
      capGroup.rotation.y = -elapsedSec * 1.2;
      floorRing.rotation.z = elapsedSec * 0.5;
      mythicMat.emissiveIntensity = 1.7 + pactSurge * 2.2 + Math.sin(elapsedSec * 4.0) * 0.35;
    },
  });

  return root;
}

// 2. Soul Lantern (Brazier Pedestal)
function buildSoulLantern(
  prop: InteractableProp,
  py: number,
  ctx: ExpansionPropContext,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Prop_soul_lantern_${prop.id}`;
  root.position.set(prop.position.x, py, prop.position.z);
  root.rotation.y = ctx.facingYaw;

  const stoneMat = ctx.materials.get(ctx.palette.wallKey);
  const ironMat = ctx.materials.get('metal_dark_iron');
  const brassMat = ctx.materials.get('brass_clockwork');
  const soulCoreMat = ctx.cloneMaterial('crystal_cyan');
  soulCoreMat.emissive = new THREE.Color(0x38f2e6);
  soulCoreMat.emissiveIntensity = 2.1;

  // Carved pedestal base + column
  const pedBase = new THREE.Mesh(
    ctx.getGeometry('lantern_ped_base', () => new THREE.CylinderGeometry(0.62, 0.78, 0.20, 8)),
    stoneMat,
  );
  pedBase.position.set(0, 0.10, 0);
  pedBase.castShadow = true;
  pedBase.receiveShadow = true;
  root.add(pedBase);

  const pedCol = new THREE.Mesh(
    ctx.getGeometry('lantern_ped_col', () => new THREE.CylinderGeometry(0.32, 0.42, 0.92, 8)),
    stoneMat,
  );
  pedCol.position.set(0, 0.66, 0);
  pedCol.castShadow = true;
  root.add(pedCol);

  // Wrought-iron shepherd hook mast rising over the brazier bowl
  const mast = new THREE.Mesh(
    ctx.getGeometry('lantern_mast', () => new THREE.CylinderGeometry(0.05, 0.07, 1.35, 7)),
    ironMat,
  );
  mast.position.set(-0.26, 1.72, 0);
  mast.castShadow = true;
  root.add(mast);

  const hookArm = new THREE.Mesh(
    ctx.getGeometry('lantern_arm', () => new THREE.BoxGeometry(0.46, 0.06, 0.06)),
    ironMat,
  );
  hookArm.position.set(-0.04, 2.38, 0);
  root.add(hookArm);

  // Swinging Soul Lantern Cage Pivot
  const lanternPivot = new THREE.Group();
  lanternPivot.name = 'SoulLanternSwingPivot';
  lanternPivot.position.set(0.14, 2.35, 0);
  root.add(lanternPivot);

  const chain = new THREE.Mesh(
    ctx.getGeometry('lantern_chain', () => new THREE.CylinderGeometry(0.018, 0.018, 0.28, 6)),
    brassMat,
  );
  chain.position.set(0, -0.14, 0);
  lanternPivot.add(chain);

  const cageCap = new THREE.Mesh(
    ctx.getGeometry('lantern_cap', () => new THREE.ConeGeometry(0.24, 0.18, 6)),
    brassMat,
  );
  cageCap.position.set(0, -0.34, 0);
  lanternPivot.add(cageCap);

  const soulOrb = new THREE.Mesh(
    ctx.getGeometry('lantern_orb', () => new THREE.OctahedronGeometry(0.17, 1)),
    soulCoreMat,
  );
  soulOrb.position.set(0, -0.52, 0);
  lanternPivot.add(soulOrb);

  const cageBot = new THREE.Mesh(
    ctx.getGeometry('lantern_bot', () => new THREE.CylinderGeometry(0.18, 0.08, 0.12, 6)),
    brassMat,
  );
  cageBot.position.set(0, -0.72, 0);
  lanternPivot.add(cageBot);

  // Orbiting spectral soul wisps
  const wispGroup = new THREE.Group();
  wispGroup.position.set(0, 1.62, 0);
  root.add(wispGroup);

  const wispGeom = ctx.getGeometry('lantern_wisp', () => new THREE.SphereGeometry(0.065, 8, 6));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const wisp = new THREE.Mesh(wispGeom, soulCoreMat);
    wisp.position.set(Math.cos(a) * 0.58, (i - 1) * 0.14, Math.sin(a) * 0.58);
    wispGroup.add(wisp);
  }

  // Sanctuary soul-radius ring on ground
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x38f2e6,
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  ctx.ownedMaterials.push(haloMat);
  const haloRing = new THREE.Mesh(
    ctx.getGeometry('lantern_halo_ring', () => {
      const g = new THREE.RingGeometry(0.88, 1.06, 28);
      g.rotateX(-Math.PI * 0.5);
      return g;
    }),
    haloMat,
  );
  haloRing.position.set(0, 0.028, 0);
  root.add(haloRing);

  let isUsed = Boolean(prop.used);

  ctx.registerController(prop.id, {
    markUsed() {
      isUsed = true;
    },
    update(dt: number, elapsedSec: number) {
      const mul = isUsed ? 2.2 : 1.0;
      lanternPivot.rotation.z = Math.sin(elapsedSec * 2.1 * mul) * 0.12;
      lanternPivot.rotation.x = Math.cos(elapsedSec * 1.7 * mul) * 0.08;
      wispGroup.rotation.y += dt * 1.65 * mul;
      wispGroup.position.y = 1.62 + Math.sin(elapsedSec * 2.4) * 0.08;
      soulCoreMat.emissiveIntensity = (isUsed ? 2.8 : 2.0) + Math.sin(elapsedSec * 4.5) * 0.38;
      haloMat.opacity = (isUsed ? 0.68 : 0.42) + Math.sin(elapsedSec * 3.0) * 0.08;
    },
  });

  return root;
}

// 3. Rift Breach (Floating Purple Dimensional Tear)
function buildRiftBreach(
  prop: InteractableProp,
  py: number,
  ctx: ExpansionPropContext,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Prop_rift_breach_${prop.id}`;
  root.position.set(prop.position.x, py, prop.position.z);
  root.rotation.y = ctx.facingYaw;

  const obsidianMat = ctx.materials.get('wall_obsidian');
  const voidMat = ctx.cloneMaterial('rune_glow_void');
  voidMat.emissive = new THREE.Color(0xa855f7);
  voidMat.emissiveIntensity = 2.25;
  const crimsonMat = ctx.materials.get('mythic_crimson');

  // Scorched ground crater ring
  const crater = new THREE.Mesh(
    ctx.getGeometry('rift_crater', () => new THREE.TorusGeometry(0.95, 0.14, 7, 16)),
    obsidianMat,
  );
  crater.rotation.x = Math.PI * 0.5;
  crater.position.set(0, 0.06, 0);
  root.add(crater);

  // Floating Purple Tear Assembly
  const tearGroup = new THREE.Group();
  tearGroup.name = 'RiftTearCore';
  tearGroup.position.set(0, 1.68, 0);
  root.add(tearGroup);

  // Stretched galaxy vortex shader plane shaped like a vertical dimensional slash!
  const riftShaderMat = createPortalVortexMaterial();
  riftShaderMat.uniforms.uActive.value = 1.0;
  riftShaderMat.uniforms.uArmColor.value.setHex(0xc026d3);
  riftShaderMat.uniforms.uCoreColor.value.setHex(0xe879f9);
  ctx.ownedMaterials.push(riftShaderMat);

  const slashDisc = new THREE.Mesh(
    ctx.getGeometry('rift_slash_disc', () => new THREE.CircleGeometry(1.15, 32)),
    riftShaderMat,
  );
  slashDisc.scale.set(0.46, 1.18, 1.0);
  slashDisc.renderOrder = 4;
  tearGroup.add(slashDisc);

  // Jagged glowing crystal lips framing the vertical tear
  const lipGeom = ctx.getGeometry('rift_lip_shard', () => {
    const g = new THREE.OctahedronGeometry(0.16, 0);
    g.scale(0.45, 2.2, 0.45);
    return g;
  });
  for (let i = 0; i < 6; i++) {
    const t = (i / 5) * Math.PI * 2;
    const lip = new THREE.Mesh(lipGeom, i % 2 === 0 ? voidMat : crimsonMat);
    lip.position.set(Math.sin(t) * 0.48, Math.cos(t) * 1.05, (i % 2 === 0 ? 1 : -1) * 0.04);
    lip.rotation.z = Math.sin(t) * 0.35;
    tearGroup.add(lip);
  }

  // Unstable counter-rotating reality rings
  const ringA = new THREE.Mesh(
    ctx.getGeometry('rift_ring_a', () => new THREE.TorusGeometry(0.88, 0.028, 6, 24)),
    voidMat,
  );
  tearGroup.add(ringA);

  const ringB = new THREE.Mesh(
    ctx.getGeometry('rift_ring_b', () => new THREE.TorusGeometry(0.72, 0.024, 6, 20)),
    crimsonMat,
  );
  tearGroup.add(ringB);

  let isUsed = Boolean(prop.used);
  let surge = 0;

  ctx.registerController(prop.id, {
    markUsed() {
      isUsed = true;
      surge = 1.0;
    },
    update(dt: number, elapsedSec: number) {
      if (surge > 0) {
        surge = Math.max(0, surge - dt * 1.5);
      }
      riftShaderMat.uniforms.uTime.value = elapsedSec * (isUsed ? 1.8 : 1.1);
      tearGroup.position.y = 1.68 + Math.sin(elapsedSec * 2.5) * 0.11;
      const pulse = 1.0 + surge * 0.38 + Math.sin(elapsedSec * 5.2) * 0.06;
      tearGroup.scale.set(pulse, pulse, pulse);
      ringA.rotation.x = elapsedSec * 1.9;
      ringA.rotation.y = elapsedSec * 1.3;
      ringB.rotation.y = -elapsedSec * 2.2;
      ringB.rotation.z = elapsedSec * 1.5;
    },
  });

  return root;
}

// 4. Stash Chest (Sanctuary Shared Guild Vault)
function buildStashChest(
  prop: InteractableProp,
  py: number,
  ctx: ExpansionPropContext,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Prop_stash_chest_${prop.id}`;
  root.position.set(prop.position.x, py, prop.position.z);
  root.rotation.y = ctx.facingYaw;

  const rugMat = ctx.materials.get('cloth_crimson');
  const oakMat = ctx.materials.get('wood_oak');
  const goldMat = ctx.materials.get('metal_gold');
  const steelMat = ctx.materials.get('metal_steel');
  const wardMat = ctx.cloneMaterial('rune_glow_blue');
  wardMat.emissiveIntensity = 1.6;

  // Royal crimson carpet & gilded trim dais
  const rug = new THREE.Mesh(
    ctx.getGeometry('stash_rug', () => new THREE.BoxGeometry(1.90, 0.05, 1.32)),
    rugMat,
  );
  rug.position.set(0, 0.025, 0);
  rug.receiveShadow = true;
  root.add(rug);

  // Heavy double-wide guild vault body
  const vaultW = 1.48;
  const vaultH = 0.62;
  const vaultD = 0.86;
  const body = new THREE.Mesh(
    ctx.getGeometry('stash_body', () => new THREE.BoxGeometry(vaultW, vaultH, vaultD)),
    oakMat,
  );
  body.position.set(0, 0.05 + vaultH * 0.5, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  const strapGeom = ctx.getGeometry('stash_strap', () => new THREE.BoxGeometry(0.11, vaultH + 0.02, vaultD + 0.04));
  for (const sx of [-0.58, -0.20, 0.20, 0.58]) {
    const strap = new THREE.Mesh(strapGeom, goldMat);
    strap.position.set(sx, 0.05 + vaultH * 0.5, 0);
    root.add(strap);
  }

  // Twin arcane ward lockplates on front
  const lockGeom = ctx.getGeometry('stash_lock', () => new THREE.BoxGeometry(0.18, 0.22, 0.07));
  for (const lx of [-0.28, 0.28]) {
    const lock = new THREE.Mesh(lockGeom, steelMat);
    lock.position.set(lx, 0.56, vaultD * 0.5 + 0.03);
    root.add(lock);

    const gem = new THREE.Mesh(
      ctx.getGeometry('stash_gem', () => new THREE.OctahedronGeometry(0.06, 0)),
      wardMat,
    );
    gem.position.set(lx, 0.56, vaultD * 0.5 + 0.07);
    root.add(gem);
  }

  // Hinged Vault Lid + Golden Light-Shaft
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.05 + vaultH, -vaultD * 0.5);
  root.add(lidPivot);

  const lidMesh = new THREE.Mesh(
    ctx.getGeometry('stash_lid', () => new THREE.BoxGeometry(vaultW + 0.04, 0.20, vaultD + 0.04)),
    oakMat,
  );
  lidMesh.position.set(0, 0.10, vaultD * 0.5);
  lidMesh.castShadow = true;
  lidPivot.add(lidMesh);

  const crownCrest = new THREE.Mesh(
    ctx.getGeometry('stash_crest', () => new THREE.BoxGeometry(vaultW * 0.85, 0.06, 0.24)),
    goldMat,
  );
  crownCrest.position.set(0, 0.22, vaultD * 0.5);
  lidPivot.add(crownCrest);

  const shaftMat = createChestLightShaftMaterial(false);
  ctx.ownedMaterials.push(shaftMat);
  const shaftMesh = new THREE.Mesh(
    ctx.getGeometry('stash_shaft', () => {
      const g = new THREE.CylinderGeometry(0.75, 0.30, 2.2, 18, 1, true);
      g.translate(0, 1.1, 0);
      return g;
    }),
    shaftMat,
  );
  shaftMesh.position.set(0, 0.62, 0);
  shaftMesh.visible = false;
  root.add(shaftMesh);

  let openTimer = 0;

  ctx.registerController(prop.id, {
    markUsed() {
      // Reusable hub stash: animate open smoothly for several seconds on interaction
      openTimer = 3.2;
    },
    update(dt: number, elapsedSec: number) {
      shaftMat.uniforms.uTime.value = elapsedSec;
      if (openTimer > 0) {
        openTimer = Math.max(0, openTimer - dt);
      }
      const openBlend = clamp(openTimer > 0.5 ? (3.2 - openTimer) * 4.0 : openTimer * 2.0, 0, 1);
      lidPivot.rotation.x = -0.95 * openBlend;
      shaftMesh.visible = openBlend > 0.02;
      shaftMat.uniforms.uIntensity.value = openBlend * 0.45;
      wardMat.emissiveIntensity = 1.4 + Math.sin(elapsedSec * 3.0) * 0.3 + openBlend * 0.8;
    },
  });

  return root;
}

// 5. Gambler NPC (Hooded Mystery Broker & Curio Table)
function buildGamblerNpc(
  prop: InteractableProp,
  py: number,
  ctx: ExpansionPropContext,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Prop_gambler_npc_${prop.id}`;
  root.position.set(prop.position.x, py, prop.position.z);
  root.rotation.y = ctx.facingYaw;

  const cloakMat = ctx.materials.get('cloth_arcane');
  const shadowMat = ctx.materials.get('cloth_shadow');
  const crimsonMat = ctx.materials.get('cloth_crimson');
  const oakMat = ctx.materials.get('wood_oak');
  const goldMat = ctx.materials.get('metal_gold');
  const eyeMat = ctx.cloneMaterial('mythic_crimson');
  eyeMat.emissiveIntensity = 2.2;

  // Curio & Fate Table in front (+Z)
  const tableTop = new THREE.Mesh(
    ctx.getGeometry('gambler_table', () => new THREE.BoxGeometry(1.36, 0.10, 0.68)),
    oakMat,
  );
  tableTop.position.set(0, 0.82, 0.42);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  root.add(tableTop);

  const tableCloth = new THREE.Mesh(
    ctx.getGeometry('gambler_cloth', () => new THREE.BoxGeometry(1.12, 0.52, 0.72)),
    crimsonMat,
  );
  tableCloth.position.set(0, 0.62, 0.42);
  root.add(tableCloth);

  const legGeom = ctx.getGeometry('gambler_leg', () => new THREE.CylinderGeometry(0.05, 0.05, 0.80, 6));
  for (const [lx, lz] of [[-0.56, 0.16], [0.56, 0.16], [-0.56, 0.66], [0.56, 0.66]]) {
    const leg = new THREE.Mesh(legGeom, oakMat);
    leg.position.set(lx, 0.40, lz);
    root.add(leg);
  }

  // Mystery Coffer & Gold Stack on Table
  const mysteryBox = new THREE.Mesh(
    ctx.getGeometry('gambler_coffer', () => new THREE.BoxGeometry(0.36, 0.24, 0.26)),
    cloakMat,
  );
  mysteryBox.position.set(-0.32, 0.99, 0.42);
  mysteryBox.rotation.y = 0.25;
  root.add(mysteryBox);

  const coinStack = new THREE.Mesh(
    ctx.getGeometry('gambler_coins', () => new THREE.CylinderGeometry(0.11, 0.13, 0.14, 10)),
    goldMat,
  );
  coinStack.position.set(0.34, 0.94, 0.44);
  root.add(coinStack);

  // Floating Fate Die hovering over table center
  const fateDie = new THREE.Mesh(
    ctx.getGeometry('gambler_die', () => new THREE.IcosahedronGeometry(0.15, 0)),
    eyeMat,
  );
  fateDie.position.set(0.02, 1.24, 0.42);
  root.add(fateDie);

  // Hooded Mystery Merchant Figure standing behind table (`z = -0.28`)
  const npcGroup = new THREE.Group();
  npcGroup.position.set(0, 0, -0.28);
  root.add(npcGroup);

  const robeLower = new THREE.Mesh(
    ctx.getGeometry('gambler_robe', () => new THREE.ConeGeometry(0.46, 1.32, 10)),
    shadowMat,
  );
  robeLower.position.set(0, 0.66, 0);
  robeLower.castShadow = true;
  npcGroup.add(robeLower);

  const mantle = new THREE.Mesh(
    ctx.getGeometry('gambler_mantle', () => new THREE.CylinderGeometry(0.24, 0.38, 0.48, 9)),
    cloakMat,
  );
  mantle.position.set(0, 1.36, 0);
  mantle.castShadow = true;
  npcGroup.add(mantle);

  const cowl = new THREE.Mesh(
    ctx.getGeometry('gambler_cowl', () => new THREE.ConeGeometry(0.24, 0.42, 8)),
    cloakMat,
  );
  cowl.position.set(0, 1.78, 0.02);
  cowl.rotation.x = 0.18;
  cowl.castShadow = true;
  npcGroup.add(cowl);

  const eyeGeom = ctx.getGeometry('gambler_eye', () => new THREE.SphereGeometry(0.028, 6, 6));
  for (const ex of [-0.065, 0.065]) {
    const eye = new THREE.Mesh(eyeGeom, eyeMat);
    eye.position.set(ex, 1.68, 0.18);
    npcGroup.add(eye);
  }

  let rollBurst = 0;
  ctx.registerController(prop.id, {
    markUsed() {
      rollBurst = 1.0;
    },
    update(dt: number, elapsedSec: number) {
      if (rollBurst > 0) {
        rollBurst = Math.max(0, rollBurst - dt * 1.4);
      }
      const spin = 1.4 + rollBurst * 8.0;
      fateDie.rotation.x += dt * spin;
      fateDie.rotation.y += dt * spin * 1.3;
      fateDie.position.y = 1.24 + Math.sin(elapsedSec * 2.8) * 0.07 + rollBurst * 0.18;
      npcGroup.position.y = Math.sin(elapsedSec * 1.9) * 0.025;
      npcGroup.rotation.y = Math.sin(elapsedSec * 0.9) * 0.08;
    },
  });

  return root;
}

// 6. Companion Shrine (Mercenary War-Banner & Spirit Pet Totem)
function buildCompanionShrine(
  prop: InteractableProp,
  py: number,
  ctx: ExpansionPropContext,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Prop_companion_shrine_${prop.id}`;
  root.position.set(prop.position.x, py, prop.position.z);
  root.rotation.y = ctx.facingYaw;

  const stoneMat = ctx.materials.get(ctx.palette.wallKey);
  const oakMat = ctx.materials.get('wood_oak');
  const goldMat = ctx.materials.get('metal_gold');
  const bannerMat = ctx.materials.get('cloth_crimson');
  const spiritMat = ctx.cloneMaterial('rune_glow_emerald');
  spiritMat.emissiveIntensity = 1.9;

  // Hearth dais
  const dais = new THREE.Mesh(
    ctx.getGeometry('comp_dais', () => new THREE.CylinderGeometry(1.12, 1.26, 0.14, 10)),
    stoneMat,
  );
  dais.position.set(0, 0.07, 0);
  dais.receiveShadow = true;
  root.add(dais);

  // Tall Mercenary War-Banner Standard (left)
  const pike = new THREE.Mesh(
    ctx.getGeometry('comp_pike', () => new THREE.CylinderGeometry(0.045, 0.055, 2.75, 8)),
    oakMat,
  );
  pike.position.set(-0.46, 1.45, -0.10);
  pike.castShadow = true;
  root.add(pike);

  const crossbar = new THREE.Mesh(
    ctx.getGeometry('comp_crossbar', () => new THREE.BoxGeometry(0.76, 0.055, 0.055)),
    goldMat,
  );
  crossbar.position.set(-0.46, 2.62, -0.10);
  root.add(crossbar);

  const finial = new THREE.Mesh(
    ctx.getGeometry('comp_finial', () => new THREE.OctahedronGeometry(0.13, 0)),
    goldMat,
  );
  finial.position.set(-0.46, 2.86, -0.10);
  root.add(finial);

  const bannerCloth = new THREE.Mesh(
    ctx.getGeometry('comp_banner', () => new THREE.BoxGeometry(0.66, 1.38, 0.03)),
    bannerMat,
  );
  bannerCloth.position.set(-0.46, 1.90, -0.08);
  bannerCloth.castShadow = true;
  root.add(bannerCloth);

  // Spirit Beast Totem Pedestal + Floating Companion Soul Orb (right)
  const totemPed = new THREE.Mesh(
    ctx.getGeometry('comp_totem', () => new THREE.CylinderGeometry(0.28, 0.36, 0.92, 8)),
    stoneMat,
  );
  totemPed.position.set(0.44, 0.58, 0.08);
  totemPed.castShadow = true;
  root.add(totemPed);

  const spiritOrb = new THREE.Mesh(
    ctx.getGeometry('comp_spirit_orb', () => new THREE.IcosahedronGeometry(0.22, 1)),
    spiritMat,
  );
  spiritOrb.position.set(0.44, 1.42, 0.08);
  root.add(spiritOrb);

  const spiritRing = new THREE.Mesh(
    ctx.getGeometry('comp_spirit_ring', () => new THREE.TorusGeometry(0.36, 0.025, 6, 20)),
    goldMat,
  );
  spiritRing.position.set(0.44, 1.42, 0.08);
  root.add(spiritRing);

  let pulseTimer = 0;
  ctx.registerController(prop.id, {
    markUsed() {
      pulseTimer = 1.0;
    },
    update(dt: number, elapsedSec: number) {
      if (pulseTimer > 0) {
        pulseTimer = Math.max(0, pulseTimer - dt * 1.4);
      }
      bannerCloth.rotation.x = Math.sin(elapsedSec * 2.2) * 0.06;
      spiritOrb.position.y = 1.42 + Math.sin(elapsedSec * 2.8) * 0.08 + pulseTimer * 0.16;
      spiritOrb.rotation.y = elapsedSec * 1.4;
      spiritRing.position.y = spiritOrb.position.y;
      spiritRing.rotation.x = elapsedSec * 1.7;
      spiritRing.rotation.y = -elapsedSec * 1.2;
    },
  });

  return root;
}

// 7. Waypoint Map (Astral Waypoint Pad & Clockwork World-Atlas Orrery)
function buildWaypointMap(
  prop: InteractableProp,
  py: number,
  ctx: ExpansionPropContext,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Prop_waypoint_map_${prop.id}`;
  root.position.set(prop.position.x, py, prop.position.z);
  root.rotation.y = ctx.facingYaw;

  const marbleMat = ctx.materials.get('floor_sanctuary');
  const brassMat = ctx.materials.get('brass_clockwork');
  const goldMat = ctx.materials.get('metal_gold');
  const astralMat = ctx.cloneMaterial('rune_glow_blue');
  astralMat.emissive = new THREE.Color(0x38bdf8);
  astralMat.emissiveIntensity = 2.0;

  // Broad engraved Waypoint Pad
  const padOuter = new THREE.Mesh(
    ctx.getGeometry('wp_pad_outer', () => new THREE.CylinderGeometry(1.42, 1.56, 0.12, 16)),
    marbleMat,
  );
  padOuter.position.set(0, 0.06, 0);
  padOuter.receiveShadow = true;
  root.add(padOuter);

  const padRing = new THREE.Mesh(
    ctx.getGeometry('wp_pad_ring', () => {
      const g = new THREE.TorusGeometry(1.18, 0.05, 8, 32);
      g.rotateX(Math.PI * 0.5);
      return g;
    }),
    astralMat,
  );
  padRing.position.set(0, 0.13, 0);
  root.add(padRing);

  // Floating 3-Axis Brass Celestial Astrolabe / Atlas Orrery above Center
  const orreryGroup = new THREE.Group();
  orreryGroup.name = 'WaypointOrrery';
  orreryGroup.position.set(0, 1.48, 0);
  root.add(orreryGroup);

  const gimbal1 = new THREE.Mesh(
    ctx.getGeometry('wp_gimbal1', () => new THREE.TorusGeometry(0.62, 0.032, 8, 28)),
    brassMat,
  );
  orreryGroup.add(gimbal1);

  const gimbal2 = new THREE.Mesh(
    ctx.getGeometry('wp_gimbal2', () => new THREE.TorusGeometry(0.46, 0.028, 8, 24)),
    goldMat,
  );
  orreryGroup.add(gimbal2);

  const coreStar = new THREE.Mesh(
    ctx.getGeometry('wp_star', () => new THREE.OctahedronGeometry(0.20, 1)),
    astralMat,
  );
  orreryGroup.add(coreStar);

  let warpSurge = 0;
  ctx.registerController(prop.id, {
    markUsed() {
      warpSurge = 1.0;
    },
    update(dt: number, elapsedSec: number) {
      if (warpSurge > 0) {
        warpSurge = Math.max(0, warpSurge - dt * 1.5);
      }
      const mul = 1.0 + warpSurge * 3.2;
      padRing.rotation.y = elapsedSec * 0.8 * mul;
      orreryGroup.position.y = 1.48 + Math.sin(elapsedSec * 2.3) * 0.09 + warpSurge * 0.24;
      gimbal1.rotation.y += dt * 1.1 * mul;
      gimbal1.rotation.x += dt * 0.65 * mul;
      gimbal2.rotation.x -= dt * 1.55 * mul;
      gimbal2.rotation.z += dt * 0.95 * mul;
      coreStar.rotation.y -= dt * 2.1 * mul;
      astralMat.emissiveIntensity = 1.85 + warpSurge * 1.8 + Math.sin(elapsedSec * 3.8) * 0.3;
    },
  });

  return root;
}

// 8. Training Dummy (Armored Combat Target Dummy)
function buildTrainingDummy(
  prop: InteractableProp,
  py: number,
  ctx: ExpansionPropContext,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Prop_training_dummy_${prop.id}`;
  root.position.set(prop.position.x, py, prop.position.z);
  root.rotation.y = ctx.facingYaw;

  const oakMat = ctx.materials.get('wood_oak');
  const ironMat = ctx.materials.get('metal_dark_iron');
  const steelMat = ctx.materials.get('metal_steel');
  const boneMat = ctx.materials.get('bone');
  const crimsonMat = ctx.materials.get('cloth_crimson');
  const goldMat = ctx.materials.get('metal_gold');

  // Heavy cross-timber stand
  const plankGeom = ctx.getGeometry('dummy_plank', () => new THREE.BoxGeometry(1.18, 0.10, 0.22));
  const plankA = new THREE.Mesh(plankGeom, oakMat);
  plankA.position.set(0, 0.05, 0);
  plankA.receiveShadow = true;
  root.add(plankA);

  const plankB = new THREE.Mesh(plankGeom, oakMat);
  plankB.position.set(0, 0.05, 0);
  plankB.rotation.y = Math.PI * 0.5;
  plankB.receiveShadow = true;
  root.add(plankB);

  const springCoil = new THREE.Mesh(
    ctx.getGeometry('dummy_spring', () => new THREE.CylinderGeometry(0.14, 0.16, 0.22, 8)),
    ironMat,
  );
  springCoil.position.set(0, 0.20, 0);
  root.add(springCoil);

  // Spring-pivoted upper dummy assembly
  const wobblePivot = new THREE.Group();
  wobblePivot.name = 'DummyWobblePivot';
  wobblePivot.position.set(0, 0.28, 0);
  root.add(wobblePivot);

  const post = new THREE.Mesh(
    ctx.getGeometry('dummy_post', () => new THREE.CylinderGeometry(0.09, 0.11, 1.55, 8)),
    oakMat,
  );
  post.position.set(0, 0.76, 0);
  post.castShadow = true;
  wobblePivot.add(post);

  // Padded straw/burlap torso + dark-iron practice cuirass
  const torso = new THREE.Mesh(
    ctx.getGeometry('dummy_torso', () => new THREE.CylinderGeometry(0.32, 0.26, 0.72, 10)),
    boneMat,
  );
  torso.position.set(0, 0.96, 0);
  torso.castShadow = true;
  wobblePivot.add(torso);

  const cuirass = new THREE.Mesh(
    ctx.getGeometry('dummy_cuirass', () => new THREE.CylinderGeometry(0.34, 0.29, 0.44, 10)),
    ironMat,
  );
  cuirass.position.set(0, 1.02, 0);
  cuirass.castShadow = true;
  wobblePivot.add(cuirass);

  // Wooden crossbar arms + practice shield & wooden sword
  const armsBar = new THREE.Mesh(
    ctx.getGeometry('dummy_arms', () => {
      const g = new THREE.CylinderGeometry(0.06, 0.06, 1.24, 7);
      g.rotateZ(Math.PI * 0.5);
      return g;
    }),
    oakMat,
  );
  armsBar.position.set(0, 1.18, 0);
  armsBar.castShadow = true;
  wobblePivot.add(armsBar);

  const shield = new THREE.Mesh(
    ctx.getGeometry('dummy_shield', () => new THREE.CylinderGeometry(0.30, 0.30, 0.06, 12)),
    crimsonMat,
  );
  shield.rotation.x = Math.PI * 0.5;
  shield.rotation.z = 0.35;
  shield.position.set(-0.48, 1.12, 0.18);
  shield.castShadow = true;
  wobblePivot.add(shield);

  const shieldBoss = new THREE.Mesh(
    ctx.getGeometry('dummy_boss', () => new THREE.SphereGeometry(0.09, 8, 6)),
    goldMat,
  );
  shieldBoss.position.set(-0.48, 1.12, 0.22);
  wobblePivot.add(shieldBoss);

  const practiceSword = new THREE.Mesh(
    ctx.getGeometry('dummy_sword', () => new THREE.BoxGeometry(0.08, 0.68, 0.04)),
    steelMat,
  );
  practiceSword.position.set(0.56, 1.36, 0.08);
  practiceSword.rotation.x = 0.25;
  wobblePivot.add(practiceSword);

  // Practice helm head
  const head = new THREE.Mesh(
    ctx.getGeometry('dummy_head', () => new THREE.CylinderGeometry(0.18, 0.20, 0.28, 9)),
    steelMat,
  );
  head.position.set(0, 1.56, 0);
  head.castShadow = true;
  wobblePivot.add(head);

  let hitWobble = 0;
  ctx.registerController(prop.id, {
    markUsed() {
      hitWobble = 1.0;
    },
    update(dt: number, elapsedSec: number) {
      if (hitWobble > 0) {
        hitWobble = Math.max(0, hitWobble - dt * 1.8);
      }
      wobblePivot.rotation.x = Math.sin(elapsedSec * 16.0) * 0.28 * hitWobble;
      wobblePivot.rotation.z = Math.cos(elapsedSec * 13.0) * 0.16 * hitWobble;
    },
  });

  return root;
}
