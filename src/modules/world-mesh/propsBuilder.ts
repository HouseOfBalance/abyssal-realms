import * as THREE from 'three';
import { clamp } from '../../core/Constants';
import type {
  DungeonFloorData,
  IMaterialLibrary,
  InteractableProp,
  MaterialKey,
  Vec3,
} from '../../contracts/types';
import { BIOME_PALETTES, type GridAccessor } from './gridUtils';
import { buildExpansionInteractableProp } from './expansionPropsBuilder';
import {
  createChestLightShaftMaterial,
  createPortalVortexMaterial,
} from './shaders';

interface SharedGeometryCache {
  get(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry;
}

interface TorchFlameSeed {
  x: number;
  y: number;
  z: number;
  scale: number;
  phase: number;
}

interface AnimatedPropController {
  readonly id: string;
  markUsed(): void;
  update(dt: number, elapsedSec: number): void;
}

interface PortalController {
  setActive(active: boolean): void;
  update(dt: number, elapsedSec: number): void;
}

export interface PropsBuildResult {
  group: THREE.Group;
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
  setInteractableUsed(propId: string): void;
  setPortalActive(active: boolean): void;
  update(dt: number, elapsedSec: number): void;
}

function springEaseOut(t: number): number {
  const c = clamp(t, 0, 1);
  if (c >= 1) return 1;
  return 1 - Math.pow(1 - c, 3) * Math.cos(c * Math.PI * 1.65);
}

function computePropFacingYaw(
  pos: Vec3,
  floor: DungeonFloorData,
  grid: GridAccessor,
): number {
  const room = grid.findRoomForPosition(pos);
  if (room) {
    const dx = room.centerWorld.x - pos.x;
    const dz = room.centerWorld.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.9) {
      return Math.atan2(dx, dz);
    }
  }
  // Default isometric-friendly front (+Z with slight angle toward camera)
  return 0.18;
}

export function buildDungeonPropsAndTorches(
  floor: DungeonFloorData,
  grid: GridAccessor,
  materials: IMaterialLibrary,
  initialPortalActive: boolean,
): PropsBuildResult {
  const group = new THREE.Group();
  group.name = 'DungeonPropsAndTorches';

  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const geomMap = new Map<string, THREE.BufferGeometry>();

  const cache: SharedGeometryCache = {
    get(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
      let g = geomMap.get(key);
      if (!g) {
        g = factory();
        geomMap.set(key, g);
        ownedGeometries.push(g);
      }
      return g;
    },
  };

  const cloneMat = (key: MaterialKey): THREE.MeshStandardMaterial => {
    const m = materials.clone(key);
    ownedMaterials.push(m);
    return m;
  };

  const palette = BIOME_PALETTES[floor.biome] ?? BIOME_PALETTES.crypt;
  const { tileSize, baseY } = grid;
  const halfTile = tileSize * 0.5;

  const propControllers = new Map<string, AnimatedPropController>();
  const portalControllers: PortalController[] = [];
  const flameSeeds: TorchFlameSeed[] = [];

  // ---------------------------------------------------------------------------
  // 1. Wall Torch Sconces & Floor Braziers
  // ---------------------------------------------------------------------------
  const torchPositions = floor.torchPositions ?? [];
  if (torchPositions.length > 0) {
    const torchesGroup = new THREE.Group();
    torchesGroup.name = 'WallTorches';

    const ironMat = materials.get('metal_dark_iron');
    const woodMat = materials.get('wood_oak');
    const coalMat = materials.get('lava_emissive');

    const backplateGeom = cache.get('torch_backplate', () => new THREE.BoxGeometry(0.18, 0.44, 0.06));
    const armGeom = cache.get('torch_arm', () => {
      const g = new THREE.CylinderGeometry(0.032, 0.04, 0.36, 6);
      g.rotateX(Math.PI * 0.35);
      return g;
    });
    const shaftGeom = cache.get('torch_shaft', () => new THREE.CylinderGeometry(0.055, 0.035, 0.48, 7));
    const basketGeom = cache.get('torch_basket', () => new THREE.CylinderGeometry(0.13, 0.065, 0.16, 8));
    const coalGeom = cache.get('torch_coal', () => new THREE.DodecahedronGeometry(0.095, 0));
    const standPoleGeom = cache.get('torch_stand_pole', () => new THREE.CylinderGeometry(0.045, 0.08, 1.85, 7));
    const standBaseGeom = cache.get('torch_stand_base', () => new THREE.CylinderGeometry(0.22, 0.30, 0.12, 8));

    for (let i = 0; i < torchPositions.length; i++) {
      const rawPos = torchPositions[i];
      if (!rawPos || !Number.isFinite(rawPos.x) || !Number.isFinite(rawPos.z)) continue;

      const sconceRoot = new THREE.Group();
      const mountY = rawPos.y > baseY + 0.65 ? rawPos.y : baseY + 2.05;

      const gCoord = floor.worldToGrid(rawPos);
      const inOpen = grid.isOpen(gCoord.col, gCoord.row);

      let anchorX = rawPos.x;
      let anchorZ = rawPos.z;
      let wallNormalX = 0;
      let wallNormalZ = 1;
      let wallMounted = false;

      if (!inOpen) {
        // Torch coordinate is on a wall cell — mount on the face bordering the nearest open neighbor
        const wCenter = grid.cellToWorld(gCoord.col, gCoord.row);
        const dirs = [
          { dc: 0, dr: 1 },
          { dc: 0, dr: -1 },
          { dc: 1, dr: 0 },
          { dc: -1, dr: 0 },
        ];
        for (const d of dirs) {
          if (grid.isOpen(gCoord.col + d.dc, gCoord.row + d.dr)) {
            const oCenter = grid.cellToWorld(gCoord.col + d.dc, gCoord.row + d.dr);
            const dx = oCenter.x - wCenter.x;
            const dz = oCenter.z - wCenter.z;
            const len = Math.hypot(dx, dz) || 1;
            wallNormalX = dx / len;
            wallNormalZ = dz / len;
            anchorX = (wCenter.x + oCenter.x) * 0.5 + wallNormalX * 0.04;
            anchorZ = (wCenter.z + oCenter.z) * 0.5 + wallNormalZ * 0.04;
            wallMounted = true;
            break;
          }
        }
      } else {
        const wallDir = grid.findNearestWallDirection(rawPos);
        if (wallDir && wallDir.dist <= tileSize * 1.55) {
          // wallDir points from torch -> solid wall cell center; outward normal points away from wall
          wallNormalX = -wallDir.dirX;
          wallNormalZ = -wallDir.dirZ;
          const distToWallFace = Math.max(0, wallDir.dist - halfTile);
          anchorX = rawPos.x + wallDir.dirX * (distToWallFace - 0.04);
          anchorZ = rawPos.z + wallDir.dirZ * (distToWallFace - 0.04);
          wallMounted = true;
        }
      }

      if (wallMounted) {
        sconceRoot.position.set(anchorX, mountY, anchorZ);
        sconceRoot.rotation.y = Math.atan2(wallNormalX, wallNormalZ);

        const backplate = new THREE.Mesh(backplateGeom, ironMat);
        backplate.position.set(0, -0.04, 0.02);
        sconceRoot.add(backplate);

        const arm = new THREE.Mesh(armGeom, ironMat);
        arm.position.set(0, -0.02, 0.16);
        sconceRoot.add(arm);

        const shaft = new THREE.Mesh(shaftGeom, woodMat);
        shaft.position.set(0, 0.06, 0.28);
        shaft.rotation.x = 0.16;
        sconceRoot.add(shaft);

        const basket = new THREE.Mesh(basketGeom, ironMat);
        basket.position.set(0, 0.28, 0.31);
        basket.rotation.x = 0.16;
        sconceRoot.add(basket);

        const coals = new THREE.Mesh(coalGeom, coalMat);
        coals.position.set(0, 0.34, 0.32);
        sconceRoot.add(coals);

        const sinY = Math.sin(sconceRoot.rotation.y);
        const cosY = Math.cos(sconceRoot.rotation.y);
        flameSeeds.push({
          x: anchorX + sinY * 0.33,
          y: mountY + 0.44,
          z: anchorZ + cosY * 0.33,
          scale: 1.0,
          phase: i * 1.73 + 0.4,
        });
      } else {
        // Standing iron floor brazier when placed in open arena away from walls
        sconceRoot.position.set(anchorX, baseY, anchorZ);

        const baseMesh = new THREE.Mesh(standBaseGeom, ironMat);
        baseMesh.position.set(0, 0.06, 0);
        sconceRoot.add(baseMesh);

        const pole = new THREE.Mesh(standPoleGeom, ironMat);
        pole.position.set(0, 0.98, 0);
        pole.castShadow = true;
        sconceRoot.add(pole);

        const basket = new THREE.Mesh(basketGeom, ironMat);
        basket.position.set(0, 1.92, 0);
        basket.scale.set(1.35, 1.15, 1.35);
        sconceRoot.add(basket);

        const coals = new THREE.Mesh(coalGeom, coalMat);
        coals.position.set(0, 1.98, 0);
        coals.scale.setScalar(1.25);
        sconceRoot.add(coals);

        flameSeeds.push({
          x: anchorX,
          y: baseY + 2.10,
          z: anchorZ,
          scale: 1.15,
          phase: i * 1.73 + 0.9,
        });
      }

      torchesGroup.add(sconceRoot);
    }

    group.add(torchesGroup);
  }

  // ---------------------------------------------------------------------------
  // 2. Interactive Props Builder Helpers
  // ---------------------------------------------------------------------------
  const buildChestProp = (prop: InteractableProp, isCursed: boolean): THREE.Group => {
    const root = new THREE.Group();
    root.name = `Prop_${prop.type}_${prop.id}`;
    const py = Number.isFinite(prop.position.y) ? prop.position.y : baseY;
    root.position.set(prop.position.x, py, prop.position.z);
    root.rotation.y = computePropFacingYaw(prop.position, floor, grid);

    // Stone dais beneath chest
    const daisGeom = cache.get('chest_dais', () => new THREE.BoxGeometry(1.42, 0.10, 1.04));
    const daisMat = materials.get(isCursed ? 'wall_obsidian' : palette.wallKey);
    const dais = new THREE.Mesh(daisGeom, daisMat);
    dais.position.set(0, 0.05, 0);
    dais.receiveShadow = true;
    dais.castShadow = true;
    root.add(dais);

    const bodyMat = materials.get(isCursed ? 'metal_dark_iron' : 'wood_oak');
    const trimMat = materials.get(isCursed ? 'bone' : 'metal_gold');
    const glowMat = cloneMat(isCursed ? 'rune_glow_crimson' : 'metal_gold');
    glowMat.emissive = new THREE.Color(isCursed ? 0xff1e38 : 0xffaa22);
    glowMat.emissiveIntensity = isCursed ? 1.5 : 0.45;

    // Cursed ritual floor ring & corner skulls/horns
    let ritualRing: THREE.Mesh | null = null;
    if (isCursed) {
      const ringGeom = cache.get('cursed_ring', () => {
        const g = new THREE.RingGeometry(0.85, 1.06, 24);
        g.rotateX(-Math.PI * 0.5);
        return g;
      });
      const ringMat = cloneMat('rune_glow_crimson');
      ringMat.transparent = true;
      ringMat.opacity = 0.82;
      ringMat.depthWrite = false;
      ritualRing = new THREE.Mesh(ringGeom, ringMat);
      ritualRing.position.set(0, 0.025, 0);
      root.add(ritualRing);

      const hornGeom = cache.get('cursed_horn', () => new THREE.ConeGeometry(0.08, 0.34, 6));
      const corners = [
        [-0.64, -0.44],
        [0.64, -0.44],
        [-0.64, 0.44],
        [0.64, 0.44],
      ];
      for (const [cx, cz] of corners) {
        const horn = new THREE.Mesh(hornGeom, trimMat);
        horn.position.set(cx, 0.24, cz);
        horn.rotation.z = cx < 0 ? 0.28 : -0.28;
        horn.rotation.x = cz < 0 ? -0.22 : 0.22;
        horn.castShadow = true;
        root.add(horn);
      }
    }

    // Chest bounce rig rooted at top of stone dais (`y = 0.10`) so squash/stretch & hop look grounded
    const chestW = 1.12;
    const chestH = 0.50;
    const chestD = 0.74;
    const bodyBaseY = 0.10;

    const chestBounceGroup = new THREE.Group();
    chestBounceGroup.name = 'ChestBounceRig';
    chestBounceGroup.position.set(0, bodyBaseY, 0);
    root.add(chestBounceGroup);

    const bodyGeom = cache.get('chest_body', () => new THREE.BoxGeometry(chestW, chestH, chestD));
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.position.set(0, chestH * 0.5, 0);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    chestBounceGroup.add(bodyMesh);

    // Metal corner brackets & front straps
    const strapGeom = cache.get('chest_strap', () => new THREE.BoxGeometry(0.09, chestH + 0.02, chestD + 0.04));
    for (const sx of [-0.44, 0, 0.44]) {
      const strap = new THREE.Mesh(strapGeom, trimMat);
      strap.position.set(sx, chestH * 0.5, 0);
      strap.castShadow = true;
      chestBounceGroup.add(strap);
    }

    // Front lockplate clasp
    const lockGeom = cache.get('chest_lock', () => new THREE.BoxGeometry(0.22, 0.24, 0.08));
    const lockPlate = new THREE.Mesh(lockGeom, isCursed ? glowMat : trimMat);
    lockPlate.position.set(0, chestH - 0.04, chestD * 0.5 + 0.03);
    chestBounceGroup.add(lockPlate);

    // Interior treasure hoard (visible when lid swings open!)
    const hoardGeom = cache.get('chest_hoard', () => new THREE.BoxGeometry(chestW * 0.86, 0.14, chestD * 0.78));
    const hoardMat = cloneMat(isCursed ? 'rune_glow_crimson' : 'metal_gold');
    hoardMat.emissive = new THREE.Color(isCursed ? 0xff2a55 : 0xffb833);
    hoardMat.emissiveIntensity = 0.9;
    const hoard = new THREE.Mesh(hoardGeom, hoardMat);
    hoard.position.set(0, chestH - 0.04, 0);
    chestBounceGroup.add(hoard);

    const gemGeom = cache.get('chest_gem', () => new THREE.OctahedronGeometry(0.09, 0));
    const gemMat = materials.get(isCursed ? 'rune_glow_void' : 'crystal_cyan');
    for (const gx of [-0.26, 0.02, 0.28]) {
      const gem = new THREE.Mesh(gemGeom, gemMat);
      gem.position.set(gx, chestH + 0.05, gx * 0.25);
      gem.rotation.set(0.4, gx * 2, 0.2);
      chestBounceGroup.add(gem);
    }

    // Erupting Vertical Golden / Crimson Light-Shaft Cone (Custom GLSL Volumetric God-Ray Shader)
    const shaftConeGeom = cache.get('chest_light_shaft_cone', () => {
      const g = new THREE.CylinderGeometry(0.68, 0.26, 2.75, 20, 1, true);
      g.translate(0, 1.375, 0);
      return g;
    });
    const shaftMat = createChestLightShaftMaterial(isCursed);
    ownedMaterials.push(shaftMat);

    const lightShaftMesh = new THREE.Mesh(shaftConeGeom, shaftMat);
    lightShaftMesh.name = 'ChestLightShaft';
    lightShaftMesh.position.set(0, chestH - 0.06, 0);
    lightShaftMesh.renderOrder = 4;
    lightShaftMesh.visible = Boolean(prop.used);
    chestBounceGroup.add(lightShaftMesh);

    // Hinged Barrel Lid: pivot at rear top edge `(0, chestH, -chestD / 2)`
    const lidPivot = new THREE.Group();
    lidPivot.name = 'ChestLidPivot';
    lidPivot.position.set(0, chestH, -chestD * 0.5);
    chestBounceGroup.add(lidPivot);

    const lidBoxGeom = cache.get('chest_lid_base', () => new THREE.BoxGeometry(chestW + 0.03, 0.12, chestD + 0.03));
    const lidBase = new THREE.Mesh(lidBoxGeom, bodyMat);
    lidBase.position.set(0, 0.06, chestD * 0.5);
    lidBase.castShadow = true;
    lidPivot.add(lidBase);

    const barrelGeom = cache.get('chest_lid_barrel', () => {
      const g = new THREE.CylinderGeometry(chestD * 0.48, chestD * 0.48, chestW + 0.02, 12, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI * 0.5);
      return g;
    });
    const barrelMesh = new THREE.Mesh(barrelGeom, bodyMat);
    barrelMesh.position.set(0, 0.10, chestD * 0.5);
    barrelMesh.scale.set(1, 0.62, 1);
    barrelMesh.castShadow = true;
    lidPivot.add(barrelMesh);

    const lidBandGeom = cache.get('chest_lid_band', () => {
      const g = new THREE.CylinderGeometry(chestD * 0.50, chestD * 0.50, 0.09, 12, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI * 0.5);
      return g;
    });
    for (const bx of [-0.44, 0, 0.44]) {
      const band = new THREE.Mesh(lidBandGeom, isCursed ? glowMat : trimMat);
      band.position.set(bx, 0.10, chestD * 0.5);
      band.scale.set(1, 0.64, 1);
      lidPivot.add(band);
    }

    let isUsed = Boolean(prop.used);
    let openAnim = isUsed ? 1 : 0;
    const targetOpenAngle = -1.96; // ~ -112 deg upward & backward

    if (isUsed) {
      lidPivot.rotation.x = targetOpenAngle;
      shaftMat.uniforms.uIntensity.value = 0.48;
      lightShaftMesh.scale.set(1, 0.72, 1);
    }

    propControllers.set(prop.id, {
      id: prop.id,
      markUsed() {
        if (!isUsed) {
          isUsed = true;
          openAnim = 0.001;
          lightShaftMesh.visible = true;
        }
      },
      update(dt: number, elapsedSec: number) {
        shaftMat.uniforms.uTime.value = elapsedSec;

        if (isUsed) {
          lightShaftMesh.visible = true;
          if (openAnim < 1) {
            openAnim = Math.min(1, openAnim + dt * 2.15);
            const eased = springEaseOut(openAnim);
            lidPivot.rotation.x = eased * targetOpenAngle;

            // Visceral whole-chest hop + squash-and-stretch bounce!
            const hopWave = Math.sin(openAnim * Math.PI * 2.0) * Math.exp(-openAnim * 2.8);
            chestBounceGroup.position.y = bodyBaseY + Math.max(0, hopWave * 0.26);
            const stretch = 1.0 + hopWave * 0.16;
            const squashXZ = 1.0 - hopWave * 0.08;
            chestBounceGroup.scale.set(squashXZ, stretch, squashXZ);

            // Erupt vertical light-shaft cone upward then settle to warm aura
            const beamBurst = Math.sin(Math.min(1, openAnim * 1.4) * Math.PI);
            const settledScale = 0.72 + beamBurst * 0.46;
            lightShaftMesh.scale.set(0.85 + eased * 0.2, Math.max(0.05, eased * settledScale), 0.85 + eased * 0.2);
            shaftMat.uniforms.uIntensity.value = 0.48 * eased + beamBurst * 0.55;
            hoardMat.emissiveIntensity = 1.1 + beamBurst * 1.6;
          } else {
            chestBounceGroup.position.y = bodyBaseY;
            chestBounceGroup.scale.set(1, 1, 1);
            shaftMat.uniforms.uIntensity.value = 0.46 + Math.sin(elapsedSec * 3.1) * 0.08;
          }
        } else if (isCursed) {
          // Ominous sealed cursed chest pulse & subtle rattle
          const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 4.2);
          glowMat.emissiveIntensity = 1.15 + pulse * 0.95;
          lidPivot.rotation.x = -0.025 * Math.max(0, Math.sin(elapsedSec * 6.5));
          if (ritualRing) {
            ritualRing.rotation.y = elapsedSec * 0.45;
          }
        }
      },
    });

    return root;
  };

  const buildShrineProp = (prop: InteractableProp): THREE.Group => {
    const root = new THREE.Group();
    root.name = `Prop_${prop.type}_${prop.id}`;
    const py = Number.isFinite(prop.position.y) ? prop.position.y : baseY;
    root.position.set(prop.position.x, py, prop.position.z);
    root.rotation.y = computePropFacingYaw(prop.position, floor, grid);

    const variant =
      prop.type === 'shrine_power'
        ? 'power'
        : prop.type === 'shrine_frenzy'
          ? 'frenzy'
          : 'heal';

    const runeKey: MaterialKey =
      variant === 'power'
        ? 'rune_glow_crimson'
        : variant === 'frenzy'
          ? 'rune_glow_blue'
          : 'rune_glow_emerald';

    const crystalMat = cloneMat(variant === 'heal' ? 'crystal_cyan' : runeKey);
    crystalMat.emissive = new THREE.Color(
      variant === 'power' ? 0xff2244 : variant === 'frenzy' ? 0x2299ff : 0x22f28a,
    );
    crystalMat.emissiveIntensity = 1.85;

    const haloMat = cloneMat(variant === 'frenzy' ? 'metal_steel' : 'metal_gold');
    const stoneMat = materials.get(palette.wallKey);

    // Stepped octagonal pedestal
    const step1 = new THREE.Mesh(
      cache.get('shrine_step1', () => new THREE.CylinderGeometry(0.92, 1.06, 0.16, 8)),
      stoneMat,
    );
    step1.position.set(0, 0.08, 0);
    step1.receiveShadow = true;
    step1.castShadow = true;
    root.add(step1);

    const step2 = new THREE.Mesh(
      cache.get('shrine_step2', () => new THREE.CylinderGeometry(0.62, 0.78, 0.24, 8)),
      stoneMat,
    );
    step2.position.set(0, 0.28, 0);
    step2.castShadow = true;
    root.add(step2);

    const column = new THREE.Mesh(
      cache.get('shrine_col', () => new THREE.CylinderGeometry(0.38, 0.48, 0.86, 8)),
      stoneMat,
    );
    column.position.set(0, 0.82, 0);
    column.castShadow = true;
    root.add(column);

    const basin = new THREE.Mesh(
      cache.get('shrine_basin', () => new THREE.CylinderGeometry(0.58, 0.36, 0.22, 8)),
      stoneMat,
    );
    basin.position.set(0, 1.32, 0);
    basin.castShadow = true;
    root.add(basin);

    // 4 carved stone cradle prongs
    const prongGeom = cache.get('shrine_prong', () => new THREE.BoxGeometry(0.11, 0.56, 0.14));
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) * 0.5 + Math.PI * 0.25;
      const prong = new THREE.Mesh(prongGeom, stoneMat);
      prong.position.set(Math.cos(angle) * 0.46, 1.62, Math.sin(angle) * 0.46);
      prong.rotation.y = -angle + Math.PI * 0.5;
      prong.rotation.x = 0.24;
      prong.castShadow = true;
      root.add(prong);
    }

    // Glowing floor rune circle
    const floorRingMat = cloneMat(runeKey);
    floorRingMat.transparent = true;
    floorRingMat.opacity = 0.78;
    floorRingMat.depthWrite = false;
    const floorRing = new THREE.Mesh(
      cache.get('shrine_floor_ring', () => {
        const g = new THREE.RingGeometry(1.06, 1.28, 28);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      floorRingMat,
    );
    floorRing.position.set(0, 0.025, 0);
    root.add(floorRing);

    // Floating crystal & orbiting rings rig
    const floatGroup = new THREE.Group();
    floatGroup.name = 'ShrineFloatGroup';
    floatGroup.position.set(0, 2.12, 0);
    root.add(floatGroup);

    const coreCrystalGeom = cache.get('shrine_crystal_core', () => {
      const g = new THREE.OctahedronGeometry(0.36, 0);
      g.scale(0.72, 1.65, 0.72);
      return g;
    });
    const coreCrystal = new THREE.Mesh(coreCrystalGeom, crystalMat);
    floatGroup.add(coreCrystal);

    const ring1 = new THREE.Mesh(
      cache.get('shrine_orbit_ring1', () => new THREE.TorusGeometry(0.56, 0.032, 8, 28)),
      haloMat,
    );
    floatGroup.add(ring1);

    const ring2 = new THREE.Mesh(
      cache.get('shrine_orbit_ring2', () => new THREE.TorusGeometry(0.44, 0.026, 8, 24)),
      crystalMat,
    );
    floatGroup.add(ring2);

    // Satellite shards
    const shardGeom = cache.get('shrine_shard', () => {
      const g = new THREE.OctahedronGeometry(0.11, 0);
      g.scale(0.65, 1.8, 0.65);
      return g;
    });
    const shardCount = variant === 'power' ? 4 : 3;
    for (let i = 0; i < shardCount; i++) {
      const a = (i / shardCount) * Math.PI * 2;
      const shard = new THREE.Mesh(shardGeom, crystalMat);
      shard.position.set(Math.cos(a) * 0.48, (i % 2 === 0 ? 0.12 : -0.12), Math.sin(a) * 0.48);
      floatGroup.add(shard);
    }

    // Expanding Blessing Shock-Ring (triggers when shrine is blessed via setInteractableUsed!)
    const shockColorHex =
      variant === 'power' ? 0xff2a55 : variant === 'frenzy' ? 0x38b6ff : 0x2bf58b;
    const shockRingMat = new THREE.MeshBasicMaterial({
      color: shockColorHex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    ownedMaterials.push(shockRingMat);

    const shockRingGeom = cache.get('shrine_shock_ring', () => {
      const g = new THREE.RingGeometry(0.42, 0.66, 36);
      g.rotateX(-Math.PI * 0.5);
      return g;
    });
    const shockRingMesh = new THREE.Mesh(shockRingGeom, shockRingMat);
    shockRingMesh.name = 'ShrineShockRing';
    shockRingMesh.position.set(0, 1.38, 0);
    shockRingMesh.renderOrder = 4;
    shockRingMesh.visible = false;
    root.add(shockRingMesh);

    const groundWaveMesh = new THREE.Mesh(shockRingGeom, shockRingMat);
    groundWaveMesh.position.set(0, 0.06, 0);
    groundWaveMesh.renderOrder = 4;
    groundWaveMesh.visible = false;
    root.add(groundWaveMesh);

    let isUsed = Boolean(prop.used);
    let blessBlend = isUsed ? 1 : 0;
    let shockAnim = isUsed ? 1 : 0;

    propControllers.set(prop.id, {
      id: prop.id,
      markUsed() {
        if (!isUsed) {
          isUsed = true;
          shockAnim = 0.001;
          shockRingMesh.visible = true;
          groundWaveMesh.visible = true;
        }
      },
      update(dt: number, elapsedSec: number) {
        if (isUsed && blessBlend < 1) {
          blessBlend = Math.min(1, blessBlend + dt * 2.2);
        }

        // Expanding shock-ring pulse across the room when blessed!
        let shockSurge = 0;
        if (shockAnim > 0 && shockAnim < 1) {
          shockAnim = Math.min(1, shockAnim + dt * 1.25);
          const easeOut = 1 - Math.pow(1 - shockAnim, 3);
          const ringScale = 0.55 + easeOut * 5.6;
          shockRingMesh.visible = true;
          groundWaveMesh.visible = true;
          shockRingMesh.scale.setScalar(ringScale);
          groundWaveMesh.scale.setScalar(ringScale * 1.18);
          shockRingMat.opacity = (1 - shockAnim) * 0.92;
          shockSurge = Math.sin(shockAnim * Math.PI);
          if (shockAnim >= 1) {
            shockRingMesh.visible = false;
            groundWaveMesh.visible = false;
            shockRingMat.opacity = 0;
          }
        }

        // Blessed shrines levitate higher and spin dramatically faster!
        const baseSpeedMul = variant === 'frenzy' ? 1.85 : variant === 'power' ? 1.3 : 1.0;
        const spinBoost = 1.0 + blessBlend * 1.95 + shockSurge * 2.8;
        const totalSpin = baseSpeedMul * spinBoost;
        const levitateLift = blessBlend * 0.44 + shockSurge * 0.22;

        floatGroup.position.y =
          2.12 +
          levitateLift +
          Math.sin(elapsedSec * (2.2 + blessBlend * 1.6)) * (0.11 + blessBlend * 0.06);
        coreCrystal.rotation.y += dt * 1.15 * totalSpin;
        ring1.rotation.x += dt * 1.25 * totalSpin;
        ring1.rotation.y += dt * 0.85 * totalSpin;
        ring2.rotation.y -= dt * 1.65 * totalSpin;
        ring2.rotation.z += dt * 0.95 * totalSpin;

        crystalMat.emissiveIntensity =
          1.7 + blessBlend * 0.75 + shockSurge * 1.8 + Math.sin(elapsedSec * 4.0) * 0.35;
        floorRingMat.opacity = clamp(0.75 + blessBlend * 0.2, 0, 1);
      },
    });

    return root;
  };

  const buildLoreTomeProp = (prop: InteractableProp): THREE.Group => {
    const root = new THREE.Group();
    root.name = `Prop_lore_tome_${prop.id}`;
    const py = Number.isFinite(prop.position.y) ? prop.position.y : baseY;
    root.position.set(prop.position.x, py, prop.position.z);
    root.rotation.y = computePropFacingYaw(prop.position, floor, grid);

    const woodMat = materials.get('wood_oak');
    const goldMat = materials.get('metal_gold');
    const clothMat = materials.get('cloth_crimson');
    const coverMat = materials.get('cloth_arcane');
    const pageMat = materials.get('bone');
    const runeMat = cloneMat('rune_glow_blue');
    runeMat.emissive = new THREE.Color(0x3ba7ff);
    runeMat.emissiveIntensity = 1.65;

    // Lectern stepped base & carved pedestal column
    const base = new THREE.Mesh(
      cache.get('lectern_base', () => new THREE.CylinderGeometry(0.38, 0.50, 0.16, 8)),
      woodMat,
    );
    base.position.set(0, 0.08, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    root.add(base);

    const pillar = new THREE.Mesh(
      cache.get('lectern_pillar', () => new THREE.CylinderGeometry(0.12, 0.17, 1.05, 8)),
      woodMat,
    );
    pillar.position.set(0, 0.66, 0);
    pillar.castShadow = true;
    root.add(pillar);

    const collar = new THREE.Mesh(
      cache.get('lectern_collar', () => new THREE.TorusGeometry(0.15, 0.035, 6, 12)),
      goldMat,
    );
    collar.rotation.x = Math.PI * 0.5;
    collar.position.set(0, 0.95, 0);
    root.add(collar);

    // Slanted reading desk + crimson velvet runner
    const deskPivot = new THREE.Group();
    deskPivot.position.set(0, 1.22, 0.04);
    deskPivot.rotation.x = 0.48; // Tilted toward reader (+Z)
    root.add(deskPivot);

    const deskBoard = new THREE.Mesh(
      cache.get('lectern_desk', () => new THREE.BoxGeometry(0.82, 0.06, 0.56)),
      woodMat,
    );
    deskBoard.castShadow = true;
    deskPivot.add(deskBoard);

    const runner = new THREE.Mesh(
      cache.get('lectern_runner', () => new THREE.BoxGeometry(0.34, 0.42, 0.03)),
      clothMat,
    );
    runner.position.set(0, -0.18, 0.27);
    runner.rotation.x = -0.48;
    deskPivot.add(runner);

    // Open Tome (left & right covers + angled page blocks + spine)
    const spine = new THREE.Mesh(
      cache.get('tome_spine', () => new THREE.BoxGeometry(0.09, 0.07, 0.44)),
      goldMat,
    );
    spine.position.set(0, 0.06, 0);
    deskPivot.add(spine);

    const coverGeom = cache.get('tome_cover', () => new THREE.BoxGeometry(0.32, 0.03, 0.44));
    const pageGeom = cache.get('tome_page', () => new THREE.BoxGeometry(0.29, 0.055, 0.40));
    const glyphStripGeom = cache.get('tome_glyph', () => new THREE.BoxGeometry(0.20, 0.012, 0.28));

    for (const side of [-1, 1]) {
      const leafGroup = new THREE.Group();
      leafGroup.position.set(side * 0.03, 0.06, 0);
      leafGroup.rotation.z = -side * 0.20;
      deskPivot.add(leafGroup);

      const cover = new THREE.Mesh(coverGeom, coverMat);
      cover.position.set(side * 0.16, 0, 0);
      leafGroup.add(cover);

      const pages = new THREE.Mesh(pageGeom, pageMat);
      pages.position.set(side * 0.15, 0.035, 0);
      leafGroup.add(pages);

      const glyph = new THREE.Mesh(glyphStripGeom, runeMat);
      glyph.position.set(side * 0.15, 0.068, 0);
      leafGroup.add(glyph);
    }

    // Floating arcane sigil mote above open pages
    const sigilGroup = new THREE.Group();
    sigilGroup.position.set(0, 1.66, 0.08);
    root.add(sigilGroup);

    const sigilCrystal = new THREE.Mesh(
      cache.get('tome_sigil', () => new THREE.OctahedronGeometry(0.11, 0)),
      runeMat,
    );
    sigilGroup.add(sigilCrystal);

    const sigilHalo = new THREE.Mesh(
      cache.get('tome_halo', () => new THREE.TorusGeometry(0.22, 0.016, 6, 20)),
      runeMat,
    );
    sigilHalo.rotation.x = Math.PI * 0.5;
    sigilGroup.add(sigilHalo);

    let isUsed = Boolean(prop.used);
    let usedBlend = isUsed ? 1 : 0;

    propControllers.set(prop.id, {
      id: prop.id,
      markUsed() {
        isUsed = true;
      },
      update(dt: number, elapsedSec: number) {
        if (isUsed && usedBlend < 1) {
          usedBlend = Math.min(1, usedBlend + dt * 2.0);
        }
        const glowScale = 1 - usedBlend * 0.65;
        sigilGroup.position.y = 1.64 - usedBlend * 0.14 + Math.sin(elapsedSec * 2.6) * 0.07 * glowScale;
        sigilCrystal.rotation.y = elapsedSec * 1.5;
        sigilCrystal.rotation.x = elapsedSec * 0.7;
        sigilHalo.rotation.z = -elapsedSec * 1.2;
        sigilGroup.scale.setScalar(0.45 + 0.55 * glowScale);
        runeMat.emissiveIntensity = 0.55 + 1.25 * glowScale + Math.sin(elapsedSec * 3.8) * 0.22;
      },
    });

    return root;
  };

  const buildBlacksmithAnvilProp = (prop: InteractableProp): THREE.Group => {
    const root = new THREE.Group();
    root.name = `Prop_blacksmith_anvil_${prop.id}`;
    const py = Number.isFinite(prop.position.y) ? prop.position.y : baseY;
    root.position.set(prop.position.x, py, prop.position.z);
    const yaw = computePropFacingYaw(prop.position, floor, grid);
    root.rotation.y = yaw;

    const stoneMat = materials.get(palette.wallKey);
    const darkIronMat = materials.get('metal_dark_iron');
    const steelMat = materials.get('metal_steel');
    const woodMat = materials.get('wood_oak');
    const goldMat = materials.get('metal_gold');
    const coalMat = cloneMat('lava_emissive');
    coalMat.emissive = new THREE.Color(0xff4d00);
    coalMat.emissiveIntensity = 1.7;

    // Hearth stone dais
    const hearth = new THREE.Mesh(
      cache.get('anvil_hearth', () => new THREE.CylinderGeometry(1.22, 1.34, 0.10, 12)),
      stoneMat,
    );
    hearth.position.set(0, 0.05, 0);
    hearth.receiveShadow = true;
    root.add(hearth);

    // Oak stump block + iron binding hoop
    const stump = new THREE.Mesh(
      cache.get('anvil_stump', () => new THREE.CylinderGeometry(0.38, 0.43, 0.54, 10)),
      woodMat,
    );
    stump.position.set(-0.12, 0.37, 0.08);
    stump.castShadow = true;
    stump.receiveShadow = true;
    root.add(stump);

    const hoop = new THREE.Mesh(
      cache.get('anvil_hoop', () => new THREE.CylinderGeometry(0.40, 0.40, 0.08, 10)),
      darkIronMat,
    );
    hoop.position.set(-0.12, 0.52, 0.08);
    root.add(hoop);

    // Classic Forged Anvil (pedestal waist + polished steel face + conical horn + heel)
    const anvilGroup = new THREE.Group();
    anvilGroup.position.set(-0.12, 0.64, 0.08);
    root.add(anvilGroup);

    const anvilFoot = new THREE.Mesh(
      cache.get('anvil_foot', () => new THREE.BoxGeometry(0.62, 0.12, 0.38)),
      darkIronMat,
    );
    anvilFoot.position.set(0, 0.06, 0);
    anvilFoot.castShadow = true;
    anvilGroup.add(anvilFoot);

    const anvilWaist = new THREE.Mesh(
      cache.get('anvil_waist', () => new THREE.BoxGeometry(0.42, 0.18, 0.26)),
      darkIronMat,
    );
    anvilWaist.position.set(0, 0.20, 0);
    anvilWaist.castShadow = true;
    anvilGroup.add(anvilWaist);

    const anvilFace = new THREE.Mesh(
      cache.get('anvil_face', () => new THREE.BoxGeometry(0.76, 0.16, 0.34)),
      steelMat,
    );
    anvilFace.position.set(-0.04, 0.36, 0);
    anvilFace.castShadow = true;
    anvilGroup.add(anvilFace);

    const anvilHorn = new THREE.Mesh(
      cache.get('anvil_horn', () => {
        const g = new THREE.ConeGeometry(0.14, 0.42, 8);
        g.rotateZ(-Math.PI * 0.5);
        return g;
      }),
      steelMat,
    );
    anvilHorn.position.set(0.52, 0.37, 0);
    anvilHorn.castShadow = true;
    anvilGroup.add(anvilHorn);

    // Blacksmith Hammer resting atop the anvil
    const hammerGroup = new THREE.Group();
    hammerGroup.position.set(-0.08, 0.48, 0.02);
    hammerGroup.rotation.y = 0.45;
    anvilGroup.add(hammerGroup);

    const handle = new THREE.Mesh(
      cache.get('smith_handle', () => {
        const g = new THREE.CylinderGeometry(0.026, 0.03, 0.44, 6);
        g.rotateZ(Math.PI * 0.5);
        return g;
      }),
      woodMat,
    );
    hammerGroup.add(handle);

    const hammerHead = new THREE.Mesh(
      cache.get('smith_head', () => new THREE.BoxGeometry(0.14, 0.11, 0.20)),
      steelMat,
    );
    hammerHead.position.set(0.16, 0.02, 0);
    hammerHead.castShadow = true;
    hammerGroup.add(hammerHead);

    // Forge Brazier with Glowing Coals & Live Animated Flame (offset right-rear)
    const brazierLocalX = 0.68;
    const brazierLocalZ = -0.26;
    const brazierGroup = new THREE.Group();
    brazierGroup.position.set(brazierLocalX, 0.10, brazierLocalZ);
    root.add(brazierGroup);

    const brazierStand = new THREE.Mesh(
      cache.get('forge_stand', () => new THREE.CylinderGeometry(0.22, 0.36, 0.56, 8)),
      darkIronMat,
    );
    brazierStand.position.set(0, 0.28, 0);
    brazierStand.castShadow = true;
    brazierGroup.add(brazierStand);

    const brazierBowl = new THREE.Mesh(
      cache.get('forge_bowl', () => new THREE.CylinderGeometry(0.46, 0.24, 0.26, 10)),
      darkIronMat,
    );
    brazierBowl.position.set(0, 0.66, 0);
    brazierBowl.castShadow = true;
    brazierGroup.add(brazierBowl);

    const brazierRim = new THREE.Mesh(
      cache.get('forge_rim', () => new THREE.TorusGeometry(0.46, 0.035, 6, 14)),
      goldMat,
    );
    brazierRim.rotation.x = Math.PI * 0.5;
    brazierRim.position.set(0, 0.78, 0);
    brazierGroup.add(brazierRim);

    const coalMound = new THREE.Mesh(
      cache.get('forge_coals', () => {
        const g = new THREE.IcosahedronGeometry(0.37, 1);
        g.scale(1, 0.42, 1);
        return g;
      }),
      coalMat,
    );
    coalMound.position.set(0, 0.76, 0);
    brazierGroup.add(coalMound);

    // Register world-space forge fire into the animated flame system!
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const flameWorldX = prop.position.x + brazierLocalX * cosY + brazierLocalZ * sinY;
    const flameWorldZ = prop.position.z - brazierLocalX * sinY + brazierLocalZ * cosY;
    flameSeeds.push({
      x: flameWorldX,
      y: py + 0.96,
      z: flameWorldZ,
      scale: 1.45,
      phase: 3.14,
    });

    // Quench Water Barrel (offset left-rear)
    const barrel = new THREE.Mesh(
      cache.get('quench_barrel', () => new THREE.CylinderGeometry(0.26, 0.23, 0.56, 10)),
      woodMat,
    );
    barrel.position.set(-0.68, 0.38, -0.28);
    barrel.castShadow = true;
    root.add(barrel);

    const waterDisc = new THREE.Mesh(
      cache.get('quench_water', () => {
        const g = new THREE.CircleGeometry(0.22, 10);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      materials.get('crystal_cyan'),
    );
    waterDisc.position.set(-0.68, 0.665, -0.28);
    root.add(waterDisc);

    let flareTimer = 0;
    propControllers.set(prop.id, {
      id: prop.id,
      markUsed() {
        // Anvil is reusable — trigger a hot forge coal flare!
        flareTimer = 1.0;
      },
      update(dt: number, elapsedSec: number) {
        if (flareTimer > 0) {
          flareTimer = Math.max(0, flareTimer - dt * 1.4);
        }
        coalMat.emissiveIntensity =
          1.6 + Math.sin(elapsedSec * 4.5) * 0.28 + flareTimer * 1.8;
      },
    });

    return root;
  };

  const buildBossPortalProp = (worldPos: Vec3, propId?: string): THREE.Group => {
    const root = new THREE.Group();
    root.name = propId ? `Prop_portal_${propId}` : 'BossPortal';
    const py = Number.isFinite(worldPos.y) ? worldPos.y : baseY;
    root.position.set(worldPos.x, py, worldPos.z);
    root.rotation.y = computePropFacingYaw(worldPos, floor, grid);

    const obsidianMat = materials.get('wall_obsidian');
    const goldMat = materials.get('metal_gold');
    const frameRuneMat = cloneMat('rune_glow_void');
    frameRuneMat.emissive = new THREE.Color(0x9d4edd);
    frameRuneMat.emissiveIntensity = initialPortalActive ? 1.9 : 0.25;

    const vortexVoidMat = cloneMat('rune_glow_void');
    vortexVoidMat.emissive = new THREE.Color(0xb5179e);
    vortexVoidMat.emissiveIntensity = 2.2;
    vortexVoidMat.transparent = true;
    vortexVoidMat.opacity = 0.88;
    vortexVoidMat.side = THREE.DoubleSide;

    const vortexAstralMat = cloneMat('rune_glow_blue');
    vortexAstralMat.emissive = new THREE.Color(0x4cc9f0);
    vortexAstralMat.emissiveIntensity = 2.0;
    vortexAstralMat.transparent = true;
    vortexAstralMat.opacity = 0.85;
    vortexAstralMat.side = THREE.DoubleSide;

    // Stepped ritual dais
    const dais1 = new THREE.Mesh(
      cache.get('portal_dais1', () => new THREE.CylinderGeometry(1.75, 1.95, 0.14, 12)),
      obsidianMat,
    );
    dais1.position.set(0, 0.07, 0);
    dais1.receiveShadow = true;
    dais1.castShadow = true;
    root.add(dais1);

    const dais2 = new THREE.Mesh(
      cache.get('portal_dais2', () => new THREE.CylinderGeometry(1.32, 1.50, 0.16, 12)),
      obsidianMat,
    );
    dais2.position.set(0, 0.22, 0);
    dais2.receiveShadow = true;
    dais2.castShadow = true;
    root.add(dais2);

    const daisRuneRing = new THREE.Mesh(
      cache.get('portal_dais_ring', () => {
        const g = new THREE.RingGeometry(1.38, 1.66, 32);
        g.rotateX(-Math.PI * 0.5);
        return g;
      }),
      frameRuneMat,
    );
    daisRuneRing.position.set(0, 0.15, 0);
    root.add(daisRuneRing);

    //Monumental Obsidian Arch Ring & Flanking Monoliths (aperture center at y = 1.82)
    const apertureY = 1.82;
    const outerFrame = new THREE.Mesh(
      cache.get('portal_outer_torus', () => new THREE.TorusGeometry(1.32, 0.20, 10, 28, Math.PI * 1.65)),
      obsidianMat,
    );
    outerFrame.position.set(0, apertureY, 0);
    outerFrame.rotation.z = -Math.PI * 0.325;
    outerFrame.castShadow = true;
    root.add(outerFrame);

    const goldCrownRing = new THREE.Mesh(
      cache.get('portal_gold_torus', () => new THREE.TorusGeometry(1.33, 0.065, 8, 28)),
      goldMat,
    );
    goldCrownRing.position.set(0, apertureY, 0);
    root.add(goldCrownRing);

    // Base anchor pillars supporting the circular gate
    const basePillarGeom = cache.get('portal_pillar', () => new THREE.BoxGeometry(0.46, 1.35, 0.52));
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(basePillarGeom, obsidianMat);
      p.position.set(side * 1.18, 0.85, 0);
      p.rotation.z = -side * 0.14;
      p.castShadow = true;
      root.add(p);

      const runeStrip = new THREE.Mesh(
        cache.get('portal_pillar_rune', () => new THREE.BoxGeometry(0.10, 1.05, 0.56)),
        frameRuneMat,
      );
      runeStrip.position.set(side * 1.18, 0.88, 0);
      runeStrip.rotation.z = -side * 0.14;
      root.add(runeStrip);
    }

    // Floating outer monolith shards around gate
    const floatShards: Array<{ mesh: THREE.Mesh; baseAngle: number; baseR: number }> = [];
    const monoShardGeom = cache.get('portal_mono_shard', () => {
      const g = new THREE.OctahedronGeometry(0.18, 0);
      g.scale(0.55, 1.9, 0.55);
      return g;
    });
    for (let i = 0; i < 6; i++) {
      const angle = (i / 5) * Math.PI - Math.PI * 0.0; // Arc over top from 0 to PI
      const r = 1.72;
      const m = new THREE.Mesh(monoShardGeom, i % 2 === 0 ? obsidianMat : frameRuneMat);
      m.position.set(Math.cos(angle) * r, apertureY + Math.sin(angle) * r * 0.85, 0);
      m.rotation.z = angle - Math.PI * 0.5;
      root.add(m);
      floatShards.push({ mesh: m, baseAngle: angle, baseR: r });
    }

    // Swirling Arcane Vortex Core (Custom GLSL Event-Horizon Galaxy Vortex Shader!)
    const vortexGroup = new THREE.Group();
    vortexGroup.name = 'PortalVortexCore';
    vortexGroup.position.set(0, apertureY, 0);
    root.add(vortexGroup);

    const portalGalaxyMat = createPortalVortexMaterial();
    ownedMaterials.push(portalGalaxyMat);

    const horizonDisc = new THREE.Mesh(
      cache.get('portal_horizon', () => new THREE.CircleGeometry(1.20, 40)),
      portalGalaxyMat,
    );
    horizonDisc.name = 'PortalGalaxyHorizon';
    horizonDisc.renderOrder = 3;
    vortexGroup.add(horizonDisc);

    const swirlRing1 = new THREE.Mesh(
      cache.get('portal_swirl1', () => new THREE.TorusGeometry(0.95, 0.055, 8, 24)),
      vortexAstralMat,
    );
    swirlRing1.position.set(0, 0, 0.03);
    vortexGroup.add(swirlRing1);

    const swirlRing2 = new THREE.Mesh(
      cache.get('portal_swirl2', () => new THREE.TorusGeometry(0.62, 0.045, 8, 20)),
      vortexVoidMat,
    );
    swirlRing2.position.set(0, 0, -0.03);
    vortexGroup.add(swirlRing2);

    // Spiral star arms inside the vortex
    const spiralHub = new THREE.Group();
    vortexGroup.add(spiralHub);
    const bladeGeom = cache.get('portal_blade', () => new THREE.BoxGeometry(0.08, 0.96, 0.025));
    for (let b = 0; b < 6; b++) {
      const blade = new THREE.Mesh(bladeGeom, b % 2 === 0 ? vortexAstralMat : vortexVoidMat);
      const ba = (b / 6) * Math.PI * 2;
      blade.position.set(Math.cos(ba) * 0.38, Math.sin(ba) * 0.38, 0.02 * (b % 2 === 0 ? 1 : -1));
      blade.rotation.z = ba + 0.58;
      spiralHub.add(blade);
    }

    const eyeCore = new THREE.Mesh(
      cache.get('portal_eye', () => new THREE.OctahedronGeometry(0.18, 1)),
      materials.get('crystal_cyan'),
    );
    eyeCore.position.set(0, 0, 0.035);
    vortexGroup.add(eyeCore);

    let isActive = initialPortalActive;
    let activeBlend = isActive ? 1 : 0;
    vortexGroup.visible = activeBlend > 0.01;
    vortexGroup.scale.setScalar(Math.max(0.01, activeBlend));
    portalGalaxyMat.uniforms.uActive.value = activeBlend;

    const portalCtrl: PortalController = {
      setActive(active: boolean) {
        isActive = active;
      },
      update(dt: number, elapsedSec: number) {
        const target = isActive ? 1 : 0;
        if (Math.abs(activeBlend - target) > 1e-4) {
          activeBlend =
            target > activeBlend
              ? Math.min(1, activeBlend + dt * 1.8)
              : Math.max(0, activeBlend - dt * 2.2);
        }

        vortexGroup.visible = activeBlend > 0.01;
        const s = Math.max(0.01, springEaseOut(activeBlend));
        vortexGroup.scale.setScalar(s);

        portalGalaxyMat.uniforms.uTime.value = elapsedSec;
        portalGalaxyMat.uniforms.uActive.value = activeBlend;

        frameRuneMat.emissiveIntensity =
          0.24 + activeBlend * (1.65 + Math.sin(elapsedSec * 3.6) * 0.35);

        if (vortexGroup.visible) {
          spiralHub.rotation.z = -elapsedSec * 2.1;
          swirlRing1.rotation.z = elapsedSec * 1.4;
          swirlRing1.rotation.x = Math.sin(elapsedSec * 1.8) * 0.22;
          swirlRing2.rotation.z = -elapsedSec * 2.8;
          swirlRing2.rotation.y = Math.cos(elapsedSec * 1.6) * 0.25;
          eyeCore.rotation.z = elapsedSec * 3.2;
          eyeCore.rotation.x = elapsedSec * 1.9;
          const pulse = 1 + Math.sin(elapsedSec * 5.0) * 0.12;
          eyeCore.scale.setScalar(pulse);
        }

        for (let i = 0; i < floatShards.length; i++) {
          const fs = floatShards[i];
          const bob = Math.sin(elapsedSec * 2.0 + i * 1.1) * (0.04 + activeBlend * 0.09);
          const rr = fs.baseR + bob;
          fs.mesh.position.x = Math.cos(fs.baseAngle) * rr;
          fs.mesh.position.y = apertureY + Math.sin(fs.baseAngle) * rr * 0.85;
        }
      },
    };

    portalControllers.push(portalCtrl);

    if (propId) {
      propControllers.set(propId, {
        id: propId,
        markUsed() {
          portalCtrl.setActive(true);
        },
        update() {
          // Updated via portalControllers
        },
      });
    }

    return root;
  };

  // ---------------------------------------------------------------------------
  // 3. Instantiate All Floor Interactables + Ensure Boss Portal Exists
  // ---------------------------------------------------------------------------
  let hasPortalInteractable = false;
  const interactables = floor.interactables ?? [];

  for (const prop of interactables) {
    if (!prop || !prop.position) continue;
    let propMesh: THREE.Group | null = null;

    switch (prop.type) {
      case 'chest':
        propMesh = buildChestProp(prop, false);
        break;
      case 'cursed_chest':
        propMesh = buildChestProp(prop, true);
        break;
      case 'shrine_heal':
      case 'shrine_power':
      case 'shrine_frenzy':
        propMesh = buildShrineProp(prop);
        break;
      case 'lore_tome':
        propMesh = buildLoreTomeProp(prop);
        break;
      case 'blacksmith_anvil':
        propMesh = buildBlacksmithAnvilProp(prop);
        break;
      case 'portal_next_floor':
        hasPortalInteractable = true;
        propMesh = buildBossPortalProp(prop.position, prop.id);
        break;
      default:
        propMesh = buildExpansionInteractableProp(prop, {
          baseY,
          facingYaw: computePropFacingYaw(prop.position, floor, grid),
          palette,
          materials,
          ownedMaterials,
          getGeometry: (k, factory) => cache.get(k, factory),
          cloneMaterial: cloneMat,
          registerController: (id, ctrl) => {
            propControllers.set(id, { id, ...ctrl });
          },
        });
        break;
    }

    if (propMesh) {
      group.add(propMesh);
    }
  }

  // Fallback: if `floor.portalPosition` is specified separately from `floor.interactables`
  // (Skip in hub/colosseum when portalPosition equals playerSpawn placeholder)
  const portalAwayFromSpawn =
    !floor.playerSpawn ||
    Math.hypot(
      (floor.portalPosition?.x ?? 0) - floor.playerSpawn.x,
      (floor.portalPosition?.z ?? 0) - floor.playerSpawn.z,
    ) > 1.5;

  if (
    !hasPortalInteractable &&
    floor.biome !== 'sanctuary' &&
    floor.biome !== 'colosseum' &&
    portalAwayFromSpawn &&
    floor.portalPosition &&
    Number.isFinite(floor.portalPosition.x) &&
    Number.isFinite(floor.portalPosition.z)
  ) {
    group.add(buildBossPortalProp(floor.portalPosition));
  }

  // ---------------------------------------------------------------------------
  // 4. Instanced Multi-Layer Animated Torch & Forge Flames
  // ---------------------------------------------------------------------------
  let outerFlamesInst: THREE.InstancedMesh | null = null;
  let innerFlamesInst: THREE.InstancedMesh | null = null;
  let sparksInst: THREE.InstancedMesh | null = null;

  if (flameSeeds.length > 0) {
    const outerFlameGeom = cache.get('flame_outer', () => {
      const g = new THREE.ConeGeometry(0.14, 0.44, 7);
      g.translate(0, 0.18, 0);
      return g;
    });
    const innerFlameGeom = cache.get('flame_inner', () => {
      const g = new THREE.ConeGeometry(0.075, 0.28, 6);
      g.translate(0, 0.12, 0);
      return g;
    });
    const sparkGeom = cache.get('flame_spark', () => new THREE.OctahedronGeometry(0.032, 0));

    const outerFlameMat = new THREE.MeshBasicMaterial({
      color: 0xff6210,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerFlameMat = new THREE.MeshBasicMaterial({
      color: 0xffe885,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    ownedMaterials.push(outerFlameMat, innerFlameMat);

    outerFlamesInst = new THREE.InstancedMesh(outerFlameGeom, outerFlameMat, flameSeeds.length);
    outerFlamesInst.name = 'TorchFlamesOuter';
    outerFlamesInst.frustumCulled = false;

    innerFlamesInst = new THREE.InstancedMesh(innerFlameGeom, innerFlameMat, flameSeeds.length);
    innerFlamesInst.name = 'TorchFlamesInner';
    innerFlamesInst.frustumCulled = false;

    sparksInst = new THREE.InstancedMesh(sparkGeom, innerFlameMat, flameSeeds.length);
    sparksInst.name = 'TorchEmberSparks';
    sparksInst.frustumCulled = false;

    group.add(outerFlamesInst, innerFlamesInst, sparksInst);
  }

  const flameDummy = new THREE.Object3D();

  const updateFlames = (elapsedSec: number): void => {
    if (!outerFlamesInst || !innerFlamesInst || !sparksInst) return;

    for (let i = 0; i < flameSeeds.length; i++) {
      const f = flameSeeds[i];
      const t = elapsedSec * 7.5 + f.phase;
      const flickerY = 1.0 + Math.sin(t) * 0.22 + Math.sin(t * 2.3) * 0.11;
      const flickerXZ = 1.0 - Math.sin(t) * 0.10;
      const leanX = Math.sin(elapsedSec * 4.2 + f.phase) * 0.16;
      const leanZ = Math.cos(elapsedSec * 3.7 + f.phase * 1.3) * 0.16;

      flameDummy.position.set(f.x, f.y, f.z);
      flameDummy.rotation.set(leanX, f.phase, leanZ);
      flameDummy.scale.set(f.scale * flickerXZ, f.scale * flickerY, f.scale * flickerXZ);
      flameDummy.updateMatrix();
      outerFlamesInst.setMatrixAt(i, flameDummy.matrix);

      const coreFlicker = 1.0 + Math.cos(t * 1.7) * 0.18;
      flameDummy.scale.set(f.scale * 0.92, f.scale * coreFlicker, f.scale * 0.92);
      flameDummy.updateMatrix();
      innerFlamesInst.setMatrixAt(i, flameDummy.matrix);

      // Rising ember spark mote
      const sparkCycle = (elapsedSec * 1.35 + f.phase * 0.37) % 1;
      const sparkScale = Math.max(0.01, Math.sin(sparkCycle * Math.PI) * f.scale);
      flameDummy.position.set(
        f.x + Math.sin(sparkCycle * 6.0 + f.phase) * 0.11,
        f.y + 0.18 + sparkCycle * 0.65 * f.scale,
        f.z + Math.cos(sparkCycle * 5.2 + f.phase) * 0.11,
      );
      flameDummy.rotation.set(elapsedSec * 3, elapsedSec * 2, 0);
      flameDummy.scale.setScalar(sparkScale);
      flameDummy.updateMatrix();
      sparksInst.setMatrixAt(i, flameDummy.matrix);
    }

    outerFlamesInst.instanceMatrix.needsUpdate = true;
    innerFlamesInst.instanceMatrix.needsUpdate = true;
    sparksInst.instanceMatrix.needsUpdate = true;
  };

  // Initialize flame matrices immediately so frame 0 looks crisp even before first `update`
  updateFlames(0);

  return {
    group,
    ownedGeometries,
    ownedMaterials,
    setInteractableUsed(propId: string): void {
      propControllers.get(propId)?.markUsed();
    },
    setPortalActive(active: boolean): void {
      for (const pc of portalControllers) {
        pc.setActive(active);
      }
    },
    update(dt: number, elapsedSec: number): void {
      const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0.016;
      const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : 0;

      updateFlames(safeElapsed);
      for (const ctrl of propControllers.values()) {
        ctrl.update(safeDt, safeElapsed);
      }
      for (const pc of portalControllers) {
        pc.update(safeDt, safeElapsed);
      }
    },
  };
}
