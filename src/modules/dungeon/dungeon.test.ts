import { describe, expect, it } from 'vitest';
import type { InteractableType, RoomType } from '../../contracts/types';
import { distXZ } from '../../core/Constants';
import { createDungeonGenerator, DungeonGenerator } from './index';

const ALL_ROOM_TYPES: readonly RoomType[] = [
  'spawn',
  'combat',
  'elite',
  'treasure',
  'shrine',
  'trap',
  'cursed_event',
  'boss',
];

const DUNGEON_INTERACTABLE_TYPES: readonly InteractableType[] = [
  'chest',
  'cursed_chest',
  'shrine_heal',
  'shrine_power',
  'shrine_frenzy',
  'portal_next_floor',
  'lore_tome',
  'blacksmith_anvil',
  'corrupted_obelisk',
  'soul_lantern',
  'rift_breach',
];

describe('DungeonGenerator', () => {
  it('assigns biome and scales size/complexity deterministically across Floors 1-7', () => {
    const gen = createDungeonGenerator();
    expect(gen).toBeInstanceOf(DungeonGenerator);

    const f1 = gen.generateFloor(1, 1337);
    const f2 = gen.generateFloor(2, 1337);
    const f3 = gen.generateFloor(3, 1337);
    const f4 = gen.generateFloor(4, 1337);
    const f5 = gen.generateFloor(5, 1337);
    const f6 = gen.generateFloor(6, 1337);
    const f7 = gen.generateFloor(7, 1337);

    expect(f1.biome).toBe('crypt');
    expect(f2.biome).toBe('caverns');
    expect(f3.biome).toBe('forge');
    expect(f4.biome).toBe('void');
    expect(f5.biome).toBe('cathedral');
    expect(f6.biome).toBe('observatory');
    expect(f7.biome).toBe('observatory');

    expect(f1.tileSize).toBe(2.0);
    expect(f2.cols).toBeGreaterThan(f1.cols);
    expect(f3.cols).toBeGreaterThan(f2.cols);
    expect(f4.cols).toBeGreaterThan(f3.cols);
    expect(f5.cols).toBeGreaterThan(f4.cols);
    expect(f6.cols).toBeGreaterThan(f5.cols);
    expect(f7.cols).toBeGreaterThan(f6.cols);

    expect(f2.rooms.length).toBeGreaterThan(f1.rooms.length);
    expect(f3.rooms.length).toBeGreaterThan(f2.rooms.length);
    expect(f4.rooms.length).toBeGreaterThan(f3.rooms.length);
    expect(f5.rooms.length).toBeGreaterThan(f4.rooms.length);
    expect(f6.rooms.length).toBeGreaterThan(f5.rooms.length);
  });

  it('is 100% deterministic for identical (floorNumber, seed) pairs including seed=0', () => {
    const gen = createDungeonGenerator();
    const a = gen.generateFloor(2, 0);
    const b = gen.generateFloor(2, 0);

    expect(a.seed).toBe(b.seed);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.rooms).toEqual(b.rooms);
    expect(a.playerSpawn).toEqual(b.playerSpawn);
    expect(a.bossSpawn).toEqual(b.bossSpawn);
    expect(a.portalPosition).toEqual(b.portalPosition);
    expect(a.interactables).toEqual(b.interactables);
    expect(a.torchPositions).toEqual(b.torchPositions);
  });

  it('places cathedral hazard_ice sheets on Floor 5 and paired teleporter_pad tiles on Floor 6+', () => {
    const gen = createDungeonGenerator();

    for (let s = 1; s <= 5; s++) {
      const cathedral = gen.generateFloor(5, s * 4099);
      expect(cathedral.biome).toBe('cathedral');

      let iceCount = 0;
      for (let r = 0; r < cathedral.rows; r++) {
        for (let c = 0; c < cathedral.cols; c++) {
          if (cathedral.tiles[r][c] === 'hazard_ice') {
            iceCount += 1;
            const wp = cathedral.gridToWorld(c, r);
            expect(cathedral.isWalkableWorld(wp.x, wp.z)).toBe(true);
          }
        }
      }
      expect(iceCount).toBeGreaterThanOrEqual(10);

      const observatory = gen.generateFloor(6, s * 4099);
      expect(observatory.biome).toBe('observatory');

      const padPositions: Array<{ x: number; y: number; z: number }> = [];
      for (let r = 0; r < observatory.rows; r++) {
        for (let c = 0; c < observatory.cols; c++) {
          if (observatory.tiles[r][c] === 'teleporter_pad') {
            const wp = observatory.gridToWorld(c, r);
            expect(observatory.isWalkableWorld(wp.x, wp.z)).toBe(true);
            padPositions.push(wp);
          }
        }
      }
      expect(padPositions.length).toBeGreaterThanOrEqual(2);
      expect(padPositions.length % 2).toBe(0);
      expect(distXZ(padPositions[0], padPositions[1])).toBeGreaterThan(12);
    }
  });

  it('guarantees all room types, Phase 3 interactables, grand boss arena, and 100% path connectivity across Floors 1-6', () => {
    const gen = createDungeonGenerator();

    for (let seed = 100; seed < 124; seed++) {
      const floorNum = ((seed - 100) % 6) + 1;
      const floor = gen.generateFloor(floorNum, seed * 7919);

      expect(floor.tiles.length).toBe(floor.rows);
      expect(floor.tiles[0].length).toBe(floor.cols);
      const spawnGrid = floor.worldToGrid(floor.playerSpawn);
      const roundTripWorld = floor.gridToWorld(spawnGrid.col, spawnGrid.row);
      expect(roundTripWorld.x).toBeCloseTo(floor.playerSpawn.x, 5);
      expect(roundTripWorld.z).toBeCloseTo(floor.playerSpawn.z, 5);

      for (const rt of ALL_ROOM_TYPES) {
        expect(floor.rooms.some((r) => r.type === rt)).toBe(true);
      }

      const spawnRoom = floor.rooms.find((r) => r.type === 'spawn')!;
      const bossRoom = floor.rooms.find((r) => r.type === 'boss')!;
      expect(spawnRoom.cleared).toBe(true);
      expect(bossRoom.cleared).toBe(false);
      expect(bossRoom.width).toBeGreaterThanOrEqual(15);
      expect(bossRoom.height).toBeGreaterThanOrEqual(15);

      for (const it of DUNGEON_INTERACTABLE_TYPES) {
        expect(floor.interactables.some((p) => p.type === it)).toBe(true);
      }
      const anvil = floor.interactables.find((p) => p.type === 'blacksmith_anvil')!;
      expect(anvil.roomId).toBe(spawnRoom.id);

      const portal = floor.interactables.find((p) => p.type === 'portal_next_floor')!;
      expect(portal.roomId).toBe(bossRoom.id);
      expect(portal.position).toEqual(floor.portalPosition);

      expect(floor.isWalkableWorld(floor.playerSpawn.x, floor.playerSpawn.z, 0.6)).toBe(true);
      expect(floor.isWalkableWorld(floor.bossSpawn.x, floor.bossSpawn.z, 0.8)).toBe(true);
      expect(floor.isWalkableWorld(floor.portalPosition.x, floor.portalPosition.z, 0.6)).toBe(true);

      for (const prop of floor.interactables) {
        expect(floor.isWalkableWorld(prop.position.x, prop.position.z, 0.5)).toBe(true);
        const propPath = floor.findPath(floor.playerSpawn, prop.position);
        expect(propPath.length).toBeGreaterThan(0);
        expect(distXZ(propPath[propPath.length - 1], prop.position)).toBeLessThan(0.05);
      }

      let maxEuclideanDist = 0;
      for (const room of floor.rooms) {
        expect(floor.isWalkableWorld(room.centerWorld.x, room.centerWorld.z, 0.5)).toBe(true);
        const path = floor.findPath(floor.playerSpawn, room.centerWorld);
        expect(path.length).toBeGreaterThan(0);
        expect(distXZ(path[path.length - 1], room.centerWorld)).toBeLessThan(0.05);

        for (const wp of path) {
          expect(floor.isWalkableWorld(wp.x, wp.z)).toBe(true);
        }

        const dWorld = distXZ(floor.playerSpawn, room.centerWorld);
        if (dWorld > maxEuclideanDist) {
          maxEuclideanDist = dWorld;
        }
      }

      const bossEuclidean = distXZ(floor.playerSpawn, bossRoom.centerWorld);
      expect(bossEuclidean).toBeGreaterThanOrEqual(maxEuclideanDist - floor.tileSize * 2);
      expect(bossRoom.connectedRoomIds.length).toBeGreaterThanOrEqual(1);

      expect(floor.torchPositions.length).toBeGreaterThanOrEqual(12);
      for (let i = 0; i < floor.torchPositions.length; i++) {
        const t = floor.torchPositions[i];
        expect(t.y).toBeCloseTo(2.2, 3);
        expect(floor.isWalkableWorld(t.x, t.z)).toBe(true);
      }
    }
  });

  it('generates circular Crimson Colosseum arena (~46x46) with ring pillars, torches, and full A* pathing', () => {
    const gen = createDungeonGenerator();
    expect(typeof gen.generateColosseumFloor).toBe('function');

    const col1 = gen.generateColosseumFloor!(1, 7777);
    const col1Repeat = gen.generateColosseumFloor!(1, 7777);
    const col3 = gen.generateColosseumFloor!(3, 7777);

    expect(col1.biome).toBe('colosseum');
    expect(col1.cols).toBe(46);
    expect(col1.rows).toBe(46);
    expect(col1.tileSize).toBe(2.0);
    expect(col1.tiles).toEqual(col1Repeat.tiles);

    // No standard 'boss' room per BossDirector Colosseum contract
    expect(col1.rooms.some((r) => r.type === 'boss')).toBe(false);
    expect(col1.rooms.some((r) => r.type === 'spawn')).toBe(true);
    expect(col1.rooms.some((r) => r.type === 'combat')).toBe(true);

    // Spawns, portal, and all Colosseum interactables are walkable and reachable
    expect(col1.isWalkableWorld(col1.playerSpawn.x, col1.playerSpawn.z, 0.6)).toBe(true);
    expect(col1.isWalkableWorld(col1.bossSpawn.x, col1.bossSpawn.z, 0.8)).toBe(true);
    expect(col1.isWalkableWorld(col1.portalPosition.x, col1.portalPosition.z, 0.6)).toBe(true);

    const toCenter = col1.findPath(col1.playerSpawn, col1.bossSpawn);
    expect(toCenter.length).toBeGreaterThan(0);
    expect(distXZ(toCenter[toCenter.length - 1], col1.bossSpawn)).toBeLessThan(0.05);

    const toNorthGate = col1.findPath(col1.playerSpawn, col1.portalPosition);
    expect(toNorthGate.length).toBeGreaterThan(0);
    expect(distXZ(toNorthGate[toNorthGate.length - 1], col1.portalPosition)).toBeLessThan(0.05);

    for (const prop of col1.interactables) {
      expect(col1.isWalkableWorld(prop.position.x, prop.position.z, 0.45)).toBe(true);
      const p = col1.findPath(col1.playerSpawn, prop.position);
      expect(p.length).toBeGreaterThan(0);
    }

    // Ring pillars block direct walkability at pillar coordinates while A* routes around them
    let interiorWallTiles = 0;
    for (let r = 10; r <= 35; r++) {
      for (let c = 10; c <= 35; c++) {
        if (col1.tiles[r][c] === 'wall') {
          interiorWallTiles += 1;
        }
      }
    }
    expect(interiorWallTiles).toBeGreaterThanOrEqual(32); // 8 x (2x2) ring pillars

    // Wave tier >= 2 adds molten fire-pit grates
    const hasLavaTier3 = col3.tiles.some((row) => row.includes('hazard_lava'));
    expect(hasLavaTier3).toBe(true);
    expect(col1.torchPositions.length).toBeGreaterThanOrEqual(12);
  });

  it('supports fog-of-war revealRadius, maxSteps path truncation, and solid wall rejection', () => {
    const gen = createDungeonGenerator();
    const floor = gen.generateFloor(1, 2026);

    const cornerWorld = floor.gridToWorld(0, 0);
    expect(floor.isWalkableWorld(cornerWorld.x, cornerWorld.z)).toBe(false);
    expect(floor.isWalkableWorld(NaN, 0)).toBe(false);
    expect(floor.findPath(floor.playerSpawn, cornerWorld)).toEqual([]);

    const partial = floor.findPath(floor.playerSpawn, floor.bossSpawn, 6);
    expect(partial.length).toBeGreaterThan(0);
    for (const wp of partial) {
      expect(floor.isWalkableWorld(wp.x, wp.z)).toBe(true);
    }

    const bossGrid = floor.worldToGrid(floor.bossSpawn);
    expect(floor.explored[bossGrid.row][bossGrid.col]).toBe(false);
    floor.revealRadius(floor.bossSpawn, 10.0);
    expect(floor.explored[bossGrid.row][bossGrid.col]).toBe(true);
  });
});
