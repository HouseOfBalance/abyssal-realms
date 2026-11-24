import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type {
  BiomeId,
  DungeonFloorData,
  IMaterialLibrary,
  MaterialKey,
  TileType,
  Vec3,
} from '../../contracts/types';
import { distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { createHazardSystem, HazardSystem } from './index';

function createMockMaterials(): {
  lib: IMaterialLibrary;
  sharedDisposedCount: () => number;
} {
  const cache = new Map<MaterialKey, THREE.MeshStandardMaterial>();
  let sharedDisposed = 0;

  const get = (key: MaterialKey): THREE.MeshStandardMaterial => {
    let mat = cache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
      const origDispose = mat.dispose.bind(mat);
      mat.dispose = () => {
        sharedDisposed++;
        origDispose();
      };
      cache.set(key, mat);
    }
    return mat;
  };

  return {
    lib: {
      get,
      clone: (key: MaterialKey) => get(key).clone(),
      getTexture: () => new THREE.Texture(),
      dispose: () => {
        for (const m of cache.values()) m.dispose();
        cache.clear();
      },
    },
    sharedDisposedCount: () => sharedDisposed,
  };
}

function createSyntheticFloor(biome: BiomeId, floorNumber = 1): DungeonFloorData {
  const cols = 36;
  const rows = 24;
  const tileSize = 2.0;
  const tiles: TileType[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 'wall' as TileType),
  );
  const explored: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false),
  );

  const carveRect = (x: number, y: number, w: number, h: number, type: TileType) => {
    for (let r = y; r < y + h; r++) {
      for (let c = x; c < x + w; c++) {
        tiles[r][c] = type;
      }
    }
  };

  // Spawn room (2..7, 8..15)
  carveRect(2, 8, 6, 8, 'floor');
  // Corridor 1 (8..11, 11..13)
  carveRect(8, 11, 4, 2, 'corridor');
  // Trap room (12..19, 6..16)
  carveRect(12, 6, 8, 11, 'floor');
  // Corridor 2 (20..23, 11..13)
  carveRect(20, 11, 4, 2, 'corridor');
  // Combat room (24..33, 5..18)
  carveRect(24, 5, 9, 13, 'floor');

  if (biome === 'forge') {
    tiles[9][28] = 'hazard_lava';
  } else if (biome === 'caverns') {
    tiles[9][28] = 'hazard_poison';
  } else if (biome === 'cathedral') {
    tiles[8][27] = 'hazard_ice';
    tiles[9][27] = 'hazard_ice';
  } else if (biome === 'observatory') {
    tiles[10][26] = 'teleporter_pad';
    tiles[15][31] = 'teleporter_pad';
  }

  const gridToWorld = (col: number, row: number): Vec3 => ({
    x: (col + 0.5) * tileSize,
    y: 0,
    z: (row + 0.5) * tileSize,
  });

  const worldToGrid = (pos: Vec3) => ({
    col: Math.floor(pos.x / tileSize),
    row: Math.floor(pos.z / tileSize),
  });

  return {
    floorNumber,
    biome,
    seed: 424242,
    cols,
    rows,
    tileSize,
    tiles,
    explored,
    rooms: [
      {
        id: 'room_spawn',
        type: 'spawn',
        x: 2,
        y: 8,
        width: 6,
        height: 8,
        centerGrid: { col: 5, row: 12 },
        centerWorld: gridToWorld(5, 12),
        connectedRoomIds: ['room_trap'],
        cleared: true,
      },
      {
        id: 'room_trap',
        type: 'trap',
        x: 12,
        y: 6,
        width: 8,
        height: 11,
        centerGrid: { col: 16, row: 11 },
        centerWorld: gridToWorld(16, 11),
        connectedRoomIds: ['room_spawn', 'room_combat'],
        cleared: false,
      },
      {
        id: 'room_combat',
        type: 'combat',
        x: 24,
        y: 5,
        width: 9,
        height: 13,
        centerGrid: { col: 28, row: 11 },
        centerWorld: gridToWorld(28, 11),
        connectedRoomIds: ['room_trap'],
        cleared: false,
      },
    ],
    playerSpawn: gridToWorld(5, 12),
    bossSpawn: gridToWorld(34, 20),
    portalPosition: gridToWorld(34, 21),
    interactables: [
      {
        id: 'chest_1',
        type: 'chest',
        position: gridToWorld(30, 14),
        roomId: 'room_combat',
        used: false,
        label: 'Chest',
      },
    ],
    torchPositions: [],
    worldToGrid,
    gridToWorld,
    isWalkableWorld: (x: number, z: number) => {
      const g = worldToGrid({ x, y: 0, z });
      const t = tiles[g.row]?.[g.col];
      return (
        t === 'floor' ||
        t === 'corridor' ||
        t === 'door' ||
        t === 'hazard_lava' ||
        t === 'hazard_poison' ||
        t === 'hazard_ice' ||
        t === 'teleporter_pad'
      );
    },
    findPath: () => [],
    revealRadius: () => {},
  };
}

describe('HazardSystem', () => {
  it('populates trap, combat, and corridor rooms with all hazard and destructible kinds', () => {
    const scene = new THREE.Scene();
    const { lib, sharedDisposedCount } = createMockMaterials();
    const system = createHazardSystem() as HazardSystem;

    const kindsSeen = new Set<string>();
    for (const biome of ['crypt', 'caverns', 'forge', 'void'] as BiomeId[]) {
      system.populateFloor(createSyntheticFloor(biome, 2), scene, lib);
      for (const h of system.getHazards()) {
        kindsSeen.add(h.kind);
      }
    }

    expect(kindsSeen.has('spike_trap')).toBe(true);
    expect(kindsSeen.has('pendulum_blade')).toBe(true);
    expect(kindsSeen.has('poison_vent')).toBe(true);
    expect(kindsSeen.has('lava_pool')).toBe(true);
    expect(kindsSeen.has('arcane_turret')).toBe(true);
    expect(kindsSeen.has('breakable_barrel')).toBe(true);
    expect(kindsSeen.has('breakable_urn')).toBe(true);

    system.dispose();
    expect(sharedDisposedCount()).toBe(0);
    expect(scene.children.length).toBe(0);
  });

  it('enforces fair discrete hit cooldowns on traps instead of per-frame damage', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const system = new HazardSystem();
    system.populateFloor(createSyntheticFloor('crypt', 1), scene, lib);

    const spike = system.getHazards().find((h) => h.kind === 'spike_trap');
    expect(spike).toBeDefined();

    let totalSpikeHits = 0;
    let bleedApplied = false;
    for (let step = 0; step < 210; step++) {
      const res = system.update(1 / 60, spike!.position);
      for (const ev of res.playerDamageEvents) {
        if (ev.type === 'physical' && ev.status === 'bleed') {
          totalSpikeHits++;
          bleedApplied = true;
        }
      }
    }

    expect(bleedApplied).toBe(true);
    expect(totalSpikeHits).toBe(1);
    system.dispose();
  });

  it('shatters destructible barrels and urns via damageDestructibleAt and emits VFX/SFX', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const system = new HazardSystem();
    system.populateFloor(createSyntheticFloor('forge', 1), scene, lib);

    const prop = system
      .getHazards()
      .find((h) => h.kind === 'breakable_barrel' || h.kind === 'breakable_urn');
    expect(prop).toBeDefined();

    let vfxCount = 0;
    let sfxCount = 0;
    const offVfx = eventBus.on('vfx:request', () => {
      vfxCount++;
    });
    const offSfx = eventBus.on('sfx:request', () => {
      sfxCount++;
    });

    const firstHit = system.damageDestructibleAt(prop!.position, 1.0, 15);
    expect(firstHit.broken.length).toBeGreaterThanOrEqual(1);
    expect(firstHit.broken.some((b) => b.id === prop!.id)).toBe(true);
    expect(vfxCount).toBeGreaterThanOrEqual(1);
    expect(sfxCount).toBeGreaterThanOrEqual(1);

    const secondHit = system.damageDestructibleAt(prop!.position, 0.1, 15);
    expect(secondHit.broken.some((b) => b.id === prop!.id)).toBe(false);

    for (let i = 0; i < 50; i++) {
      system.update(1 / 60, { x: 0, y: 0, z: 0 });
    }

    offVfx();
    offSfx();
    system.dispose();
  });

  it('spawns Blizzard Frost Gales in Cathedral applying chill and Falling Icicle Ring hits', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const system = new HazardSystem();
    system.populateFloor(createSyntheticFloor('cathedral', 5), scene, lib);

    const gales = system
      .getHazardArchetypes()
      .filter((entry) => entry.archetype === 'frost_gale');
    expect(gales.length).toBeGreaterThan(0);

    const targetGale = gales[0].instance;
    const iciclePos: Vec3 = {
      x: targetGale.position.x + targetGale.radius * 0.72,
      y: 0,
      z: targetGale.position.z,
    };

    let iceChillHits = 0;
    for (let step = 0; step < 230; step++) {
      const res = system.update(1 / 60, iciclePos);
      for (const ev of res.playerDamageEvents) {
        if (ev.type === 'ice' && ev.status === 'chill') {
          iceChillHits++;
        }
      }
    }

    expect(iceChillHits).toBeGreaterThanOrEqual(1);
    expect(iceChillHits).toBeLessThanOrEqual(2);
    system.dispose();
  });

  it('spawns sweeping Clockwork Astral Lasers in Observatory while keeping teleporter pads clear', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const system = new HazardSystem();
    const floor = createSyntheticFloor('observatory', 6);
    system.populateFloor(floor, scene, lib);

    const lasers = system
      .getHazardArchetypes()
      .filter((entry) => entry.archetype === 'astral_laser');
    expect(lasers.length).toBeGreaterThan(0);

    // Ensure teleporter pads remain unobstructed
    const padPos = floor.gridToWorld(26, 10);
    for (const h of system.getHazards()) {
      expect(distXZ(h.position, padPos)).toBeGreaterThanOrEqual(2.5);
    }

    // Stand within sweep ring of a Clockwork Astral Laser over one full 4.4s sweep cycle
    const laser = lasers[0].instance;
    const sweepTestPos: Vec3 = {
      x: laser.position.x + 2.0,
      y: 0,
      z: laser.position.z + 0.5,
    };

    let voidBeamHits = 0;
    for (let step = 0; step < 270; step++) {
      const res = system.update(1 / 60, sweepTestPos);
      for (const ev of res.playerDamageEvents) {
        if (ev.type === 'void') {
          voidBeamHits++;
        }
      }
    }

    expect(voidBeamHits).toBeGreaterThanOrEqual(1);
    expect(voidBeamHits).toBeLessThanOrEqual(2);
    system.dispose();
  });

  it('keeps Sanctuary peaceful with zero hazards and populates Colosseum perimeter cleanly', () => {
    const scene = new THREE.Scene();
    const { lib } = createMockMaterials();
    const system = new HazardSystem();

    system.populateFloor(createSyntheticFloor('sanctuary', 1), scene, lib);
    expect(system.getHazards().length).toBe(0);

    system.populateFloor(createSyntheticFloor('colosseum', 6), scene, lib);
    expect(system.getHazards().length).toBeGreaterThan(0);
    system.dispose();
  });
});
