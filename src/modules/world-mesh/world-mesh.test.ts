import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type {
  BiomeId,
  DungeonFloorData,
  DungeonRoom,
  IMaterialLibrary,
  InteractableProp,
  MaterialKey,
  TileType,
  Vec3,
} from '../../contracts/types';
import { createDungeonMeshBuilder, DungeonMeshBuilder } from './index';

function createMockMaterials(): IMaterialLibrary {
  const cache = new Map<MaterialKey, THREE.MeshStandardMaterial>();
  const texCache = new Map<MaterialKey, THREE.Texture>();
  const clones: THREE.MeshStandardMaterial[] = [];

  return {
    get(key: MaterialKey): THREE.MeshStandardMaterial {
      let mat = cache.get(key);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ name: key, color: 0x888888 });
        cache.set(key, mat);
      }
      return mat;
    },
    clone(key: MaterialKey): THREE.MeshStandardMaterial {
      const c = this.get(key).clone();
      clones.push(c);
      return c;
    },
    getTexture(key: MaterialKey): THREE.Texture {
      let tex = texCache.get(key);
      if (!tex) {
        tex = new THREE.Texture();
        texCache.set(key, tex);
      }
      return tex;
    },
    dispose(): void {
      for (const c of clones) c.dispose();
      for (const m of cache.values()) m.dispose();
      for (const t of texCache.values()) t.dispose();
    },
  };
}

function createSyntheticFloor(biome: BiomeId = 'crypt'): DungeonFloorData {
  const cols = 20;
  const rows = 20;
  const tileSize = 2.0;
  const tiles: TileType[][] = Array.from({ length: rows }, () =>
    new Array<TileType>(cols).fill('void'),
  );
  const explored: boolean[][] = Array.from({ length: rows }, () =>
    new Array<boolean>(cols).fill(true),
  );

  // Carve Room A: [3..8, 3..8], Room B: [12..17, 3..8], Corridor: [9..11, 5..6]
  for (let r = 3; r <= 8; r++) {
    for (let c = 3; c <= 8; c++) tiles[r][c] = 'floor';
    for (let c = 12; c <= 17; c++) tiles[r][c] = 'floor';
  }
  for (let r = 5; r <= 6; r++) {
    for (let c = 9; c <= 11; c++) {
      tiles[r][c] = c === 9 || c === 11 ? 'door' : 'corridor';
    }
  }
  // Add hazard tiles inside Room B
  tiles[4][14] = 'hazard_lava';
  tiles[4][15] = 'hazard_poison';

  // Build perimeter walls around open tiles
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (tiles[r][c] !== 'void') continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nt = tiles[r + dr]?.[c + dc];
          if (nt && nt !== 'void' && nt !== 'wall') {
            tiles[r][c] = 'wall';
          }
        }
      }
    }
  }

  const gridToWorld = (col: number, row: number): Vec3 => ({
    x: (col - cols * 0.5 + 0.5) * tileSize,
    y: 0,
    z: (row - rows * 0.5 + 0.5) * tileSize,
  });

  const worldToGrid = (w: Vec3) => ({
    col: Math.floor(w.x / tileSize + cols * 0.5),
    row: Math.floor(w.z / tileSize + rows * 0.5),
  });

  const rooms: DungeonRoom[] = [
    {
      id: 'room_spawn',
      type: 'spawn',
      x: 3,
      y: 3,
      width: 6,
      height: 6,
      centerGrid: { col: 5, row: 5 },
      centerWorld: gridToWorld(5, 5),
      connectedRoomIds: ['room_boss'],
      cleared: true,
    },
    {
      id: 'room_boss',
      type: 'boss',
      x: 12,
      y: 3,
      width: 6,
      height: 6,
      centerGrid: { col: 14, row: 5 },
      centerWorld: gridToWorld(14, 5),
      connectedRoomIds: ['room_spawn'],
      cleared: false,
    },
  ];

  const interactables: InteractableProp[] = [
    { id: 'p_chest', type: 'chest', position: gridToWorld(4, 4), roomId: 'room_spawn', used: false, label: 'Chest' },
    { id: 'p_cursed', type: 'cursed_chest', position: gridToWorld(7, 4), roomId: 'room_spawn', used: false, label: 'Cursed' },
    { id: 'p_heal', type: 'shrine_heal', position: gridToWorld(4, 7), roomId: 'room_spawn', used: false, label: 'Heal' },
    { id: 'p_power', type: 'shrine_power', position: gridToWorld(6, 7), roomId: 'room_spawn', used: false, label: 'Power' },
    { id: 'p_frenzy', type: 'shrine_frenzy', position: gridToWorld(7, 7), roomId: 'room_spawn', used: false, label: 'Frenzy' },
    { id: 'p_tome', type: 'lore_tome', position: gridToWorld(5, 4), roomId: 'room_spawn', used: false, label: 'Tome', loreId: 'l1' },
    { id: 'p_anvil', type: 'blacksmith_anvil', position: gridToWorld(5, 6), roomId: 'room_spawn', used: false, label: 'Anvil' },
    { id: 'p_portal', type: 'portal_next_floor', position: gridToWorld(16, 6), roomId: 'room_boss', used: false, label: 'Portal' },
  ];

  const torchPositions: Vec3[] = [
    { ...gridToWorld(4, 3), y: 2.2 },
    { ...gridToWorld(14, 3), y: 2.2 },
  ];

  return {
    floorNumber: 1,
    biome,
    seed: 42,
    cols,
    rows,
    tileSize,
    tiles,
    explored,
    rooms,
    playerSpawn: gridToWorld(5, 5),
    bossSpawn: gridToWorld(14, 5),
    portalPosition: gridToWorld(16, 6),
    interactables,
    torchPositions,
    worldToGrid,
    gridToWorld,
    isWalkableWorld(x: number, z: number): boolean {
      const g = worldToGrid({ x, y: 0, z });
      const t = tiles[g.row]?.[g.col];
      return t === 'floor' || t === 'corridor' || t === 'door';
    },
    findPath(): Vec3[] {
      return [];
    },
    revealRadius(): void {},
  };
}

describe('DungeonMeshBuilder', () => {
  it('builds instanced floors, perimeter walls, archways, hazards, torches, and all 8 interactables across all biomes', () => {
    const builder = createDungeonMeshBuilder();
    expect(builder).toBeInstanceOf(DungeonMeshBuilder);

    const materials = createMockMaterials();
    const biomes: BiomeId[] = ['crypt', 'caverns', 'forge', 'void'];

    for (const biome of biomes) {
      const floor = createSyntheticFloor(biome);
      const group = builder.buildFloor(floor, materials);
      expect(group).toBeInstanceOf(THREE.Group);

      // Verify FloorTilesInstanced exists and is an InstancedMesh
      const floorInst = group.getObjectByName('FloorTilesInstanced') as THREE.InstancedMesh;
      expect(floorInst).toBeDefined();
      expect(floorInst.isInstancedMesh).toBe(true);
      expect(floorInst.count).toBeGreaterThan(60);

      // Verify hazard meshes exist
      expect(group.getObjectByName('HazardLavaTiles')).toBeDefined();
      expect(group.getObjectByName('HazardPoisonTiles')).toBeDefined();

      // Verify wall occluders are chunked Meshes raycastable for foreground camera fade
      const occluders = builder.getWallMeshesForOcclusion();
      expect(occluders.length).toBeGreaterThan(8);
      for (const occ of occluders) {
        expect((occ as THREE.Mesh).isMesh).toBe(true);
      }

      // Raycast from south foreground wall position toward room interior to confirm wall hit
      group.updateMatrixWorld(true);
      const roomCenter = floor.gridToWorld(5, 5);
      const camOrigin = new THREE.Vector3(roomCenter.x, 4.5, roomCenter.z + 10);
      const target = new THREE.Vector3(roomCenter.x, 1.0, roomCenter.z);
      const dir = target.clone().sub(camOrigin).normalize();
      const raycaster = new THREE.Raycaster(camOrigin, dir, 0.1, 20);
      const hits = raycaster.intersectObjects(occluders, true);
      expect(hits.length).toBeGreaterThan(0);
    }

    builder.dispose();
    materials.dispose();
  });

  it('animates chest lids on setInteractableUsed and toggles arcane portal vortex on setPortalActive', () => {
    const builder = createDungeonMeshBuilder();
    const materials = createMockMaterials();
    const floor = createSyntheticFloor('forge');
    const root = builder.buildFloor(floor, materials);

    const chestGroup = root.getObjectByName('Prop_chest_p_chest')!;
    expect(chestGroup).toBeDefined();
    const lidPivot = chestGroup.getObjectByName('ChestLidPivot')!;
    expect(lidPivot).toBeDefined();
    expect(lidPivot.rotation.x).toBeCloseTo(0, 3);

    // Portal starts sealed
    const portalGroup = root.getObjectByName('Prop_portal_p_portal')!;
    const vortex = portalGroup.getObjectByName('PortalVortexCore')!;
    expect(vortex.visible).toBe(false);

    // Open chest & activate portal
    builder.setInteractableUsed('p_chest');
    builder.setInteractableUsed('p_cursed');
    builder.setInteractableUsed('p_heal');
    builder.setInteractableUsed('p_tome');
    builder.setInteractableUsed('p_anvil');
    builder.setPortalActive(true);

    for (let step = 0; step < 30; step++) {
      builder.update(1 / 30, (step + 1) / 30);
    }

    expect(lidPivot.rotation.x).toBeLessThan(-1.5);
    expect(vortex.visible).toBe(true);
    expect(vortex.scale.x).toBeGreaterThan(0.9);

    // Clean disposal empties occluders and detaches root
    const scene = new THREE.Scene();
    scene.add(root);
    builder.dispose();
    expect(root.parent).toBeNull();
    expect(builder.getWallMeshesForOcclusion()).toHaveLength(0);

    materials.dispose();
  });

  it('supports Phase 2 volumetric GLSL ground mist wake, chest light-shafts, shrine shock-rings, and galaxy portal shader', () => {
    const builder = createDungeonMeshBuilder();
    const materials = createMockMaterials();
    const floor = createSyntheticFloor('void');
    const root = builder.buildFloor(floor, materials);

    // 1. Volumetric scrolling ground mist + setPlayerPosition wake
    const mistMesh = root.getObjectByName('VolumetricGroundMist') as THREE.Mesh;
    expect(mistMesh).toBeDefined();
    const mistMat = mistMesh.material as THREE.ShaderMaterial;
    expect(mistMat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mistMat.fragmentShader).toContain('uPlayerPos');

    builder.setPlayerPosition?.({ x: 6.5, y: 0, z: -4.2 });
    const wakePos = mistMat.uniforms.uPlayerPos.value as THREE.Vector3;
    expect(wakePos.x).toBeCloseTo(6.5, 4);
    expect(wakePos.z).toBeCloseTo(-4.2, 4);

    // 2. Chest bounce & GLSL vertical light-shaft cone eruption
    const chestGroup = root.getObjectByName('Prop_chest_p_chest')!;
    const lightShaft = chestGroup.getObjectByName('ChestLightShaft') as THREE.Mesh;
    const bounceRig = chestGroup.getObjectByName('ChestBounceRig')!;
    expect(lightShaft).toBeDefined();
    expect(lightShaft.visible).toBe(false);
    expect(lightShaft.material).toBeInstanceOf(THREE.ShaderMaterial);

    builder.setInteractableUsed('p_chest');
    builder.update(0.12, 0.12);
    expect(lightShaft.visible).toBe(true);
    expect((lightShaft.material as THREE.ShaderMaterial).uniforms.uIntensity.value).toBeGreaterThan(0.2);
    expect(bounceRig.position.y).toBeGreaterThan(0.10);

    // 3. Shrine faster levitation/spin + expanding shock-ring on bless
    const shrineGroup = root.getObjectByName('Prop_shrine_heal_p_heal')!;
    const floatGroup = shrineGroup.getObjectByName('ShrineFloatGroup')!;
    const shockRing = shrineGroup.getObjectByName('ShrineShockRing') as THREE.Mesh;
    expect(shockRing).toBeDefined();
    expect(shockRing.visible).toBe(false);

    builder.setInteractableUsed('p_heal');
    builder.update(0.25, 0.5);
    expect(shockRing.visible).toBe(true);
    expect(shockRing.scale.x).toBeGreaterThan(1.2);
    expect(floatGroup.position.y).toBeGreaterThan(2.2);

    // 4. Boss Portal custom GLSL swirling event-horizon galaxy vortex shader
    const portalGroup = root.getObjectByName('Prop_portal_p_portal')!;
    const horizon = portalGroup.getObjectByName('PortalGalaxyHorizon') as THREE.Mesh;
    expect(horizon).toBeDefined();
    const portalMat = horizon.material as THREE.ShaderMaterial;
    expect(portalMat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(portalMat.uniforms.uActive.value).toBeCloseTo(0, 3);

    builder.setPortalActive(true);
    for (let i = 0; i < 25; i++) {
      builder.update(1 / 30, 1.0 + i / 30);
    }
    expect(portalMat.uniforms.uActive.value).toBeGreaterThan(0.95);
    expect(portalMat.uniforms.uTime.value).toBeGreaterThan(1.5);

    builder.dispose();
    materials.dispose();
  });

  it('supports Phase 3 biomes, hazard_ice, teleporter_pad, observatory clockwork gears, and all 8 new interactables', () => {
    const builder = createDungeonMeshBuilder();
    const materials = createMockMaterials();

    const allBiomes: BiomeId[] = [
      'sanctuary',
      'crypt',
      'caverns',
      'forge',
      'void',
      'cathedral',
      'observatory',
      'colosseum',
    ];

    for (const biome of allBiomes) {
      const floor = createSyntheticFloor(biome);
      floor.tiles[6][13] = 'hazard_ice';
      floor.tiles[6][14] = 'teleporter_pad';
      floor.tiles[7][14] = 'teleporter_pad';

      const root = builder.buildFloor(floor, materials);
      expect(root.getObjectByName('HazardIceTiles')).toBeDefined();
      expect(root.getObjectByName('TeleporterPads')).toBeDefined();
      expect(root.getObjectByName('VolumetricGroundMist')).toBeDefined();

      if (biome === 'observatory') {
        const gears = root.getObjectByName('ObservatoryClockworkGears')!;
        expect(gears).toBeDefined();
        const firstGearPivot = gears.children[0];
        const initialRot = firstGearPivot.rotation.y;
        builder.update(0.1, 1.5);
        expect(firstGearPivot.rotation.y).not.toBeCloseTo(initialRot, 4);
      }
    }

    // Verify all 8 Phase 3 interactable types build & animate cleanly
    const expFloor = createSyntheticFloor('sanctuary');
    expFloor.interactables = [
      { id: 'e_obelisk', type: 'corrupted_obelisk', position: expFloor.gridToWorld(4, 4), roomId: 'room_spawn', used: false, label: 'Obelisk' },
      { id: 'e_lantern', type: 'soul_lantern', position: expFloor.gridToWorld(6, 4), roomId: 'room_spawn', used: false, label: 'Lantern' },
      { id: 'e_rift', type: 'rift_breach', position: expFloor.gridToWorld(7, 4), roomId: 'room_spawn', used: false, label: 'Rift' },
      { id: 'e_stash', type: 'stash_chest', position: expFloor.gridToWorld(4, 6), roomId: 'room_spawn', used: false, label: 'Stash' },
      { id: 'e_gambler', type: 'gambler_npc', position: expFloor.gridToWorld(6, 6), roomId: 'room_spawn', used: false, label: 'Gambler' },
      { id: 'e_comp', type: 'companion_shrine', position: expFloor.gridToWorld(7, 6), roomId: 'room_spawn', used: false, label: 'Companions' },
      { id: 'e_wp', type: 'waypoint_map', position: expFloor.gridToWorld(5, 5), roomId: 'room_spawn', used: false, label: 'Waypoint' },
      { id: 'e_dummy', type: 'training_dummy', position: expFloor.gridToWorld(14, 5), roomId: 'room_boss', used: false, label: 'Dummy' },
    ];

    const expRoot = builder.buildFloor(expFloor, materials);
    expect(expRoot.getObjectByName('Prop_corrupted_obelisk_e_obelisk')).toBeDefined();
    expect(expRoot.getObjectByName('Prop_soul_lantern_e_lantern')).toBeDefined();
    expect(expRoot.getObjectByName('Prop_rift_breach_e_rift')).toBeDefined();
    expect(expRoot.getObjectByName('Prop_stash_chest_e_stash')).toBeDefined();
    expect(expRoot.getObjectByName('Prop_gambler_npc_e_gambler')).toBeDefined();
    expect(expRoot.getObjectByName('Prop_companion_shrine_e_comp')).toBeDefined();
    expect(expRoot.getObjectByName('Prop_waypoint_map_e_wp')).toBeDefined();
    expect(expRoot.getObjectByName('Prop_training_dummy_e_dummy')).toBeDefined();

    for (const p of expFloor.interactables) {
      builder.setInteractableUsed(p.id);
    }
    builder.update(0.16, 2.0);

    const dummyWobble = expRoot.getObjectByName('DummyWobblePivot')!;
    expect(Math.abs(dummyWobble.rotation.x) + Math.abs(dummyWobble.rotation.z)).toBeGreaterThan(0.01);

    builder.dispose();
    materials.dispose();
  });
});
