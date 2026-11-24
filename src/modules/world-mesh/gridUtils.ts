import type {
  BiomeId,
  DungeonFloorData,
  DungeonRoom,
  MaterialKey,
  TileType,
  Vec3,
} from '../../contracts/types';

export interface BiomeMeshPalette {
  floorKey: MaterialKey;
  wallKey: MaterialKey;
  trimKey: MaterialKey;
  metalKey: MaterialKey;
  runeKey: MaterialKey;
  accentKey: MaterialKey;
}

export const BIOME_PALETTES: Record<BiomeId, BiomeMeshPalette> = {
  sanctuary: {
    floorKey: 'floor_sanctuary',
    wallKey: 'wall_stone',
    trimKey: 'metal_gold',
    metalKey: 'metal_steel',
    runeKey: 'rune_glow_blue',
    accentKey: 'crystal_cyan',
  },
  crypt: {
    floorKey: 'floor_crypt',
    wallKey: 'wall_stone',
    trimKey: 'bone',
    metalKey: 'metal_dark_iron',
    runeKey: 'rune_glow_blue',
    accentKey: 'metal_gold',
  },
  caverns: {
    floorKey: 'floor_caverns',
    wallKey: 'wall_stone',
    trimKey: 'crystal_cyan',
    metalKey: 'metal_dark_iron',
    runeKey: 'rune_glow_emerald',
    accentKey: 'wood_oak',
  },
  forge: {
    floorKey: 'floor_forge',
    wallKey: 'wall_obsidian',
    trimKey: 'metal_dark_iron',
    metalKey: 'metal_gold',
    runeKey: 'rune_glow_crimson',
    accentKey: 'lava_emissive',
  },
  void: {
    floorKey: 'floor_void',
    wallKey: 'wall_obsidian',
    trimKey: 'metal_gold',
    metalKey: 'metal_dark_iron',
    runeKey: 'rune_glow_void',
    accentKey: 'crystal_cyan',
  },
  cathedral: {
    floorKey: 'floor_cathedral',
    wallKey: 'wall_stone',
    trimKey: 'ice_glacier',
    metalKey: 'metal_steel',
    runeKey: 'rune_glow_blue',
    accentKey: 'crystal_cyan',
  },
  observatory: {
    floorKey: 'floor_observatory',
    wallKey: 'wall_obsidian',
    trimKey: 'brass_clockwork',
    metalKey: 'brass_clockwork',
    runeKey: 'rune_glow_void',
    accentKey: 'metal_gold',
  },
  colosseum: {
    floorKey: 'floor_colosseum',
    wallKey: 'wall_stone',
    trimKey: 'bone',
    metalKey: 'metal_dark_iron',
    runeKey: 'mythic_crimson',
    accentKey: 'metal_gold',
  },
};

export function isOpenTile(tile: TileType): boolean {
  return (
    tile === 'floor' ||
    tile === 'corridor' ||
    tile === 'door' ||
    tile === 'hazard_lava' ||
    tile === 'hazard_poison' ||
    tile === 'hazard_ice' ||
    tile === 'teleporter_pad'
  );
}

export function isHazardTile(tile: TileType): boolean {
  return (
    tile === 'hazard_lava' ||
    tile === 'hazard_poison' ||
    tile === 'hazard_ice'
  );
}

export interface ArchwayPlacement {
  worldPos: Vec3;
  rotationY: number;
  spanWorld: number;
}

export interface GridAccessor {
  readonly cols: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly baseY: number;
  getTile(col: number, row: number): TileType;
  isOpen(col: number, row: number): boolean;
  cellToWorld(col: number, row: number): Vec3;
  findNearestWallDirection(worldPos: Vec3): { dirX: number; dirZ: number; dist: number } | null;
  findRoomForPosition(worldPos: Vec3): DungeonRoom | null;
}

/**
 * Safely wraps `DungeonFloorData` so tile lookups work regardless of whether
 * `floor.tiles` was laid out as `tiles[row][col]` or `tiles[col][row]`, and
 * safely extrapolates world positions for `-1 / cols / rows` border wall cells.
 */
export function createGridAccessor(floor: DungeonFloorData): GridAccessor {
  const cols = Math.max(0, floor.cols | 0);
  const rows = Math.max(0, floor.rows | 0);
  const tileSize = floor.tileSize > 0 ? floor.tileSize : 2.0;
  const tiles = floor.tiles ?? [];

  // Detect indexing order: default row-major `tiles[row][col]`
  let colMajor = false;
  const outerLen = tiles.length;
  const innerLen = outerLen > 0 && Array.isArray(tiles[0]) ? tiles[0].length : 0;

  if (rows !== cols) {
    if (outerLen === cols && innerLen === rows) {
      colMajor = true;
    } else {
      colMajor = false;
    }
  } else if (outerLen > 0 && innerLen > 0) {
    // Square grid: probe an asymmetric cell where tiles[r][c] differs in walkability from tiles[c][r]
    outerProbe: for (let r = 0; r < rows; r++) {
      for (let c = r + 1; c < cols; c++) {
        const rc = tiles[r]?.[c];
        const cr = tiles[c]?.[r];
        if (!rc || !cr) continue;
        const rcWalk =
          rc === 'floor' || rc === 'corridor' || rc === 'door' || rc === 'teleporter_pad' || rc === 'hazard_ice';
        const crWalk =
          cr === 'floor' || cr === 'corridor' || cr === 'door' || cr === 'teleporter_pad' || cr === 'hazard_ice';
        const rcSolid = rc === 'wall' || rc === 'void';
        const crSolid = cr === 'wall' || cr === 'void';
        if ((rcWalk && crSolid) || (crWalk && rcSolid)) {
          try {
            const w = floor.gridToWorld(c, r);
            const walkable = floor.isWalkableWorld(w.x, w.z, 0.05);
            colMajor = walkable ? crWalk : rcWalk;
          } catch {
            colMajor = false;
          }
          break outerProbe;
        }
      }
    }
  }

  const origin00 =
    cols > 0 && rows > 0 ? floor.gridToWorld(0, 0) : { x: 0, y: 0, z: 0 };
  const baseY = Number.isFinite(origin00.y) ? origin00.y : 0;

  const origin10 =
    cols > 1 && rows > 0
      ? floor.gridToWorld(1, 0)
      : { x: origin00.x + tileSize, y: baseY, z: origin00.z };
  const origin01 =
    rows > 1 && cols > 0
      ? floor.gridToWorld(0, 1)
      : { x: origin00.x, y: baseY, z: origin00.z + tileSize };

  let stepColX = origin10.x - origin00.x;
  let stepColZ = origin10.z - origin00.z;
  if (Math.hypot(stepColX, stepColZ) < 1e-4) {
    stepColX = tileSize;
    stepColZ = 0;
  }

  let stepRowX = origin01.x - origin00.x;
  let stepRowZ = origin01.z - origin00.z;
  if (Math.hypot(stepRowX, stepRowZ) < 1e-4) {
    stepRowX = 0;
    stepRowZ = tileSize;
  }

  const getTile = (col: number, row: number): TileType => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) {
      return 'void';
    }
    const val = colMajor ? tiles[col]?.[row] : tiles[row]?.[col];
    return val ?? 'void';
  };

  const isOpen = (col: number, row: number): boolean => isOpenTile(getTile(col, row));

  const cellToWorld = (col: number, row: number): Vec3 => {
    if (col >= 0 && col < cols && row >= 0 && row < rows) {
      const w = floor.gridToWorld(col, row);
      return {
        x: Number.isFinite(w.x) ? w.x : origin00.x + col * stepColX + row * stepRowX,
        y: Number.isFinite(w.y) ? w.y : baseY,
        z: Number.isFinite(w.z) ? w.z : origin00.z + col * stepColZ + row * stepRowZ,
      };
    }
    return {
      x: origin00.x + col * stepColX + row * stepRowX,
      y: baseY,
      z: origin00.z + col * stepColZ + row * stepRowZ,
    };
  };

  const findNearestWallDirection = (
    worldPos: Vec3,
  ): { dirX: number; dirZ: number; dist: number } | null => {
    if (cols === 0 || rows === 0) return null;
    const g = floor.worldToGrid(worldPos);

    // 1. Prefer cardinal 4-neighbors first so wall sconces always mount 100% square to the wall face
    const cardinals: ReadonlyArray<readonly [number, number]> = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    let bestCardDist = Infinity;
    let bestCardDx = 0;
    let bestCardDz = 0;

    for (const [dc, dr] of cardinals) {
      const nc = g.col + dc;
      const nr = g.row + dr;
      if (isOpen(nc, nr)) continue;
      const wc = cellToWorld(nc, nr);
      const cellCenter = cellToWorld(g.col, g.row);
      const axisX = wc.x - cellCenter.x;
      const axisZ = wc.z - cellCenter.z;
      const axisLen = Math.hypot(axisX, axisZ);
      if (axisLen < 1e-4) continue;
      const ux = axisX / axisLen;
      const uz = axisZ / axisLen;
      // Project vector from worldPos -> wall cell center onto cardinal normal
      const projDist = (wc.x - worldPos.x) * ux + (wc.z - worldPos.z) * uz;
      if (projDist > 0 && projDist < bestCardDist) {
        bestCardDist = projDist;
        bestCardDx = ux;
        bestCardDz = uz;
      }
    }

    if (Number.isFinite(bestCardDist) && bestCardDist <= tileSize * 1.65) {
      return { dirX: bestCardDx, dirZ: bestCardDz, dist: bestCardDist };
    }

    // 2. Fallback: search 5x5 neighborhood
    let bestDist = Infinity;
    let bestDx = 0;
    let bestDz = 0;

    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nc = g.col + dc;
        const nr = g.row + dr;
        if (isOpen(nc, nr)) continue;
        let touchesOpen = false;
        for (let rr = -1; rr <= 1 && !touchesOpen; rr++) {
          for (let cc = -1; cc <= 1 && !touchesOpen; cc++) {
            if (cc === 0 && rr === 0) continue;
            if (isOpen(nc + cc, nr + rr)) touchesOpen = true;
          }
        }
        if (!touchesOpen) continue;

        const wc = cellToWorld(nc, nr);
        const dx = wc.x - worldPos.x;
        const dz = wc.z - worldPos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4 && d < bestDist) {
          bestDist = d;
          bestDx = dx / d;
          bestDz = dz / d;
        }
      }
    }

    if (!Number.isFinite(bestDist) || bestDist > tileSize * 2.1) {
      return null;
    }
    return { dirX: bestDx, dirZ: bestDz, dist: bestDist };
  };

  const findRoomForPosition = (worldPos: Vec3): DungeonRoom | null => {
    if (!floor.rooms || floor.rooms.length === 0) return null;
    const g = floor.worldToGrid(worldPos);
    for (const room of floor.rooms) {
      if (
        g.col >= room.x - 1 &&
        g.col <= room.x + room.width &&
        g.row >= room.y - 1 &&
        g.row <= room.y + room.height
      ) {
        return room;
      }
    }
    let closest: DungeonRoom | null = null;
    let bestD2 = Infinity;
    for (const room of floor.rooms) {
      const dx = room.centerWorld.x - worldPos.x;
      const dz = room.centerWorld.z - worldPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        closest = room;
      }
    }
    return closest;
  };

  return {
    cols,
    rows,
    tileSize,
    baseY,
    getTile,
    isOpen,
    cellToWorld,
    findNearestWallDirection,
    findRoomForPosition,
  };
}

/**
 * Discovers doorway & corridor-threshold spans bounded by solid flanking walls
 * so Gothic stone archways frame room entrances without obstructing movement.
 */
export function findArchwayPlacements(
  floor: DungeonFloorData,
  grid: GridAccessor,
): ArchwayPlacement[] {
  const results: ArchwayPlacement[] = [];
  const { cols, rows, tileSize } = grid;
  const minSpacingSq = (tileSize * 2.4) ** 2;

  const tryAddArchway = (worldPos: Vec3, rotationY: number, spanTiles: number): void => {
    for (const existing of results) {
      const dx = existing.worldPos.x - worldPos.x;
      const dz = existing.worldPos.z - worldPos.z;
      if (dx * dx + dz * dz < minSpacingSq) return;
    }
    results.push({
      worldPos,
      rotationY,
      spanWorld: spanTiles * tileSize,
    });
  };

  const visitedH = new Set<number>();
  const visitedV = new Set<number>();

  const isThresholdCandidate = (c: number, r: number): boolean => {
    const t = grid.getTile(c, r);
    if (t === 'door') return true;
    if (t !== 'corridor' && t !== 'floor') return false;
    // Check if adjacent to a transition between 'corridor' and 'floor'
    const neighbors: TileType[] = [
      grid.getTile(c + 1, r),
      grid.getTile(c - 1, r),
      grid.getTile(c, r + 1),
      grid.getTile(c, r - 1),
    ];
    if (t === 'corridor') {
      return neighbors.includes('floor');
    }
    return neighbors.includes('corridor') && (
      !grid.isOpen(c - 1, r) ||
      !grid.isOpen(c + 1, r) ||
      !grid.isOpen(c, r - 1) ||
      !grid.isOpen(c, r + 1)
    );
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isThresholdCandidate(c, r)) continue;

      const key = r * cols + c;

      // 1) Horizontal span (opening runs East-West along col, passage travels North-South along row)
      if (!visitedH.has(key) && !grid.isOpen(c - 1, r)) {
        let endC = c;
        while (endC + 1 < cols && grid.isOpen(endC + 1, r) && endC - c < 4) {
          endC++;
        }
        const span = endC - c + 1;
        // Must have solid wall on right end too, and open passage North & South
        if (
          span >= 1 &&
          span <= 4 &&
          !grid.isOpen(endC + 1, r) &&
          grid.isOpen(c, r - 1) &&
          grid.isOpen(c, r + 1)
        ) {
          for (let k = c; k <= endC; k++) visitedH.add(r * cols + k);
          const leftW = grid.cellToWorld(c, r);
          const rightW = grid.cellToWorld(endC, r);
          tryAddArchway(
            {
              x: (leftW.x + rightW.x) * 0.5,
              y: leftW.y,
              z: (leftW.z + rightW.z) * 0.5,
            },
            0, // Jambs along X, passage along Z
            span,
          );
          continue;
        }
      }

      // 2) Vertical span (opening runs North-South along row, passage travels East-West along col)
      if (!visitedV.has(key) && !grid.isOpen(c, r - 1)) {
        let endR = r;
        while (endR + 1 < rows && grid.isOpen(c, endR + 1) && endR - r < 4) {
          endR++;
        }
        const span = endR - r + 1;
        if (
          span >= 1 &&
          span <= 4 &&
          !grid.isOpen(c, endR + 1) &&
          grid.isOpen(c - 1, r) &&
          grid.isOpen(c + 1, r)
        ) {
          for (let k = r; k <= endR; k++) visitedV.add(k * cols + c);
          const topW = grid.cellToWorld(c, r);
          const botW = grid.cellToWorld(c, endR);
          tryAddArchway(
            {
              x: (topW.x + botW.x) * 0.5,
              y: topW.y,
              z: (topW.z + botW.z) * 0.5,
            },
            Math.PI * 0.5, // Jambs along Z, passage along X
            span,
          );
        }
      }
    }
  }

  return results;
}
