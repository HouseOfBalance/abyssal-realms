import type {
  BiomeId,
  DungeonFloorData,
  DungeonRoom,
  GridCoord,
  IDungeonGenerator,
  InteractableProp,
  InteractableType,
  RoomType,
  TileType,
  Vec2,
  Vec3,
} from '../../contracts/types';
import { clamp, SeededRng } from '../../core/Constants';
import {
  buildDelaunayEdges,
  buildMstAndLoops,
  computeGraphDistances,
  type GraphEdge,
} from './GraphBuilder';
import {
  DungeonSpatialNavigator,
  isPureDryFloorTile,
  isTileWalkable,
} from './Pathfinder';

interface BspLeaf {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MutableRoomDraft {
  index: number;
  id: string;
  type: RoomType;
  x: number;
  y: number;
  width: number;
  height: number;
  connectedIndices: Set<number>;
}

const TILE_SIZE = 2.0;
const GRID_BORDER = 5;
const TORCH_HEIGHT_Y = 2.2;
const INITIAL_REVEAL_RADIUS_WORLD = 15.0;

const LORE_LABELS: Record<BiomeId, readonly [string, string, string]> = {
  sanctuary: [
    'Annals of the Fallen Bastion',
    'Chronicle of the Last Hearth',
    'Vow of the Waypoint Watchers',
  ],
  crypt: [
    'Chronicle of the Oathbreaker Kings',
    'Epitaph of the Bone Colossus',
    'Decree of the Ashen Sepulcher',
  ],
  caverns: [
    'Journal of the Blighted Expedition',
    'Hymn of the Broodmother',
    'Venom-Stained Apothecary Ledger',
  ],
  forge: [
    'Blueprints of the Titan Anvil',
    'Covenant of Ignis the Forgemaster',
    'Obsidian Crucible Inscription',
  ],
  void: [
    'Testament of the Shattered Crown',
    'Litany of Emperor Malakor',
    'Astral Horizon Star-Chart',
  ],
  cathedral: [
    'Hymnal of the Sunken Cathedral',
    'Tears of Valkyria the Rime Seraph',
    'Edict of the Glacial Nave',
  ],
  observatory: [
    'Principia of the Astral Loom',
    'Treatise of Chronos the Time Architect',
    'Horologium of Celestial Gears',
  ],
  colosseum: [
    'Ledger of the Undying Champions',
    'Rites of the Bloodhunt Arena',
    'Scroll of the Twin Gladiators',
  ],
};

function selectBiome(floorNumber: number): BiomeId {
  if (floorNumber <= 1) return 'crypt';
  if (floorNumber === 2) return 'caverns';
  if (floorNumber === 3) return 'forge';
  if (floorNumber === 4) return 'void';
  if (floorNumber === 5) return 'cathedral';
  return 'observatory';
}

function getFloorConfig(floorNumber: number): {
  cols: number;
  rows: number;
  targetRooms: number;
} {
  const f = clamp(Math.floor(floorNumber) || 1, 1, 16);
  if (f === 1) return { cols: 84, rows: 84, targetRooms: 11 };
  if (f === 2) return { cols: 94, rows: 94, targetRooms: 13 };
  if (f === 3) return { cols: 104, rows: 104, targetRooms: 15 };
  if (f === 4) return { cols: 114, rows: 114, targetRooms: 17 };
  if (f === 5) return { cols: 120, rows: 120, targetRooms: 19 };
  const extra = f - 6;
  const side = Math.min(126 + extra * 6, 144);
  const rooms = Math.min(21 + extra * 2, 25);
  return { cols: side, rows: side, targetRooms: rooms };
}

function toOdd(n: number, minOdd: number, maxOdd: number): number {
  let v = Math.floor(n);
  if (v % 2 === 0) v -= 1;
  if (v < minOdd) v = minOdd;
  if (v > maxOdd) v = maxOdd % 2 === 1 ? maxOdd : maxOdd - 1;
  return v;
}

function roomsOverlapWithMargin(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  margin: number,
): boolean {
  return (
    ax - margin < bx + bw &&
    ax + aw + margin > bx &&
    ay - margin < by + bh &&
    ay + ah + margin > by
  );
}

function shuffleInPlace<T>(arr: T[], rng: SeededRng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function makeRevealRadiusFn(
  cols: number,
  rows: number,
  explored: boolean[][],
  navigator: DungeonSpatialNavigator,
): (worldPos: Vec3, radiusWorld: number) => void {
  return (worldPos: Vec3, radiusWorld: number): void => {
    if (
      !worldPos ||
      !Number.isFinite(worldPos.x) ||
      !Number.isFinite(worldPos.z) ||
      !Number.isFinite(radiusWorld) ||
      radiusWorld <= 0
    ) {
      return;
    }

    const centerGrid = navigator.worldToGrid(worldPos);
    explored[centerGrid.row][centerGrid.col] = true;

    const cellRadius = Math.ceil(radiusWorld / TILE_SIZE) + 1;
    const minCol = clamp(centerGrid.col - cellRadius, 0, cols - 1);
    const maxCol = clamp(centerGrid.col + cellRadius, 0, cols - 1);
    const minRow = clamp(centerGrid.row - cellRadius, 0, rows - 1);
    const maxRow = clamp(centerGrid.row + cellRadius, 0, rows - 1);
    const rSq = radiusWorld * radiusWorld;

    for (let r = minRow; r <= maxRow; r++) {
      const expRow = explored[r];
      for (let c = minCol; c <= maxCol; c++) {
        if (expRow[c]) continue;
        const tileWorld = navigator.gridToWorld(c, r);
        const dx = tileWorld.x - worldPos.x;
        const dz = tileWorld.z - worldPos.z;
        if (dx * dx + dz * dz <= rSq) {
          expRow[c] = true;
        }
      }
    }
  };
}

export class DungeonGenerator implements IDungeonGenerator {
  generateFloor(floorNumber: number, seed?: number): DungeonFloorData {
    const safeFloor = Math.max(1, Math.floor(Number.isFinite(floorNumber) ? floorNumber : 1));
    const resolvedSeed =
      seed !== undefined && Number.isFinite(seed)
        ? Math.floor(seed) >>> 0
        : ((Date.now() ^ Math.imul(safeFloor, 0x9e3779b1)) >>> 0) || 1;

    const rng = new SeededRng(resolvedSeed);
    const biome = selectBiome(safeFloor);
    const { cols, rows, targetRooms } = getFloorConfig(safeFloor);

    const tiles: TileType[][] = Array.from({ length: rows }, () =>
      new Array<TileType>(cols).fill('void'),
    );
    const explored: boolean[][] = Array.from({ length: rows }, () =>
      new Array<boolean>(cols).fill(false),
    );

    // 1. BSP space partitioning + spacious odd-sized room placement
    const drafts = this.placeRoomsBsp(cols, rows, targetRooms, rng);

    // 2. Select (spawnIdx, bossIdx) via all-pairs Euclidean diameter so Boss Arena
    //    sits at the far opposite extremity of the dungeon from Spawn.
    let spawnIdx = 0;
    let bossIdx = drafts.length - 1;
    let bestDiameterSq = -1;
    for (let i = 0; i < drafts.length; i++) {
      const ciX = drafts[i].x + Math.floor(drafts[i].width / 2);
      const ciY = drafts[i].y + Math.floor(drafts[i].height / 2);
      for (let j = i + 1; j < drafts.length; j++) {
        const cjX = drafts[j].x + Math.floor(drafts[j].width / 2);
        const cjY = drafts[j].y + Math.floor(drafts[j].height / 2);
        const dSq = (cjX - ciX) * (cjX - ciX) + (cjY - ciY) * (cjY - ciY);
        if (dSq > bestDiameterSq) {
          bestDiameterSq = dSq;
          spawnIdx = i;
          bossIdx = j;
        }
      }
    }

    // Expand Spawn sanctuary and Grand Boss Arena first, then re-verify boss is strictly farthest
    this.expandRoomToTarget(drafts[spawnIdx], drafts, cols, rows, 13, 13, 3);
    this.expandBossArena(drafts[bossIdx], drafts, cols, rows);

    const spawnCx = drafts[spawnIdx].x + Math.floor(drafts[spawnIdx].width / 2);
    const spawnCy = drafts[spawnIdx].y + Math.floor(drafts[spawnIdx].height / 2);
    let maxDistFromSpawnSq = -1;
    for (let i = 0; i < drafts.length; i++) {
      if (i === spawnIdx) continue;
      const cx = drafts[i].x + Math.floor(drafts[i].width / 2);
      const cy = drafts[i].y + Math.floor(drafts[i].height / 2);
      const dSq = (cx - spawnCx) * (cx - spawnCx) + (cy - spawnCy) * (cy - spawnCy);
      if (dSq > maxDistFromSpawnSq) {
        maxDistFromSpawnSq = dSq;
        bossIdx = i;
      }
    }
    if (drafts[bossIdx].width < 15 || drafts[bossIdx].height < 15) {
      this.expandBossArena(drafts[bossIdx], drafts, cols, rows);
    }

    // 3. Build Delaunay + Kruskal MST + extra loops over all non-boss exploration rooms,
    //    then attach the Grand Boss Arena as a terminal sanctum off its nearest deep antechamber!
    const nonBossIndices: number[] = [];
    for (let i = 0; i < drafts.length; i++) {
      if (i !== bossIdx) {
        nonBossIndices.push(i);
      }
    }

    const subCenters2D: Vec2[] = nonBossIndices.map((idx) => ({
      x: drafts[idx].x + Math.floor(drafts[idx].width / 2),
      y: drafts[idx].y + Math.floor(drafts[idx].height / 2),
    }));
    const subDelaunay = buildDelaunayEdges(subCenters2D);
    const subGraph = buildMstAndLoops(nonBossIndices.length, subDelaunay, rng, 0.32);

    const mstEdgesMapped: GraphEdge[] = subGraph.mstEdges.map((e) => ({
      u: nonBossIndices[e.u],
      v: nonBossIndices[e.v],
      weight: e.weight,
    }));
    const loopEdgesMapped: GraphEdge[] = subGraph.loopEdges.map((e) => ({
      u: nonBossIndices[e.u],
      v: nonBossIndices[e.v],
      weight: e.weight,
    }));

    // Connect bossIdx to its nearest non-spawn room (the Boss Antechamber)
    const bossCx = drafts[bossIdx].x + Math.floor(drafts[bossIdx].width / 2);
    const bossCy = drafts[bossIdx].y + Math.floor(drafts[bossIdx].height / 2);
    let antechamberIdx =
      nonBossIndices[0] === spawnIdx && nonBossIndices.length > 1
        ? nonBossIndices[1]
        : nonBossIndices[0];
    let bestAnteDist = Infinity;

    for (const candIdx of nonBossIndices) {
      if (candIdx === spawnIdx && nonBossIndices.length > 1) continue;
      const cx = drafts[candIdx].x + Math.floor(drafts[candIdx].width / 2);
      const cy = drafts[candIdx].y + Math.floor(drafts[candIdx].height / 2);
      const d = Math.hypot(cx - bossCx, cy - bossCy);
      if (d < bestAnteDist) {
        bestAnteDist = d;
        antechamberIdx = candIdx;
      }
    }

    const bossBridgeEdge: GraphEdge = {
      u: Math.min(antechamberIdx, bossIdx),
      v: Math.max(antechamberIdx, bossIdx),
      weight: bestAnteDist,
    };
    mstEdgesMapped.push(bossBridgeEdge);

    const finalEdges: GraphEdge[] = [...mstEdgesMapped, ...loopEdgesMapped];
    const finalDistFromSpawn = computeGraphDistances(drafts.length, finalEdges, spawnIdx);

    // 4. Assign all 8 RoomTypes strategically by progression distance
    this.assignRoomTypes(
      drafts,
      spawnIdx,
      bossIdx,
      finalDistFromSpawn,
      finalEdges,
      safeFloor,
      rng,
    );

    // 5. Expand Elite & Cursed Event arenas for roomy multi-wave combat
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      if (d.type === 'cursed_event' || d.type === 'elite') {
        this.expandRoomToTarget(d, drafts, cols, rows, 13, 13, 3);
      }
    }

    // 6. Carve room floors into tile grid
    for (let i = 0; i < drafts.length; i++) {
      const r = drafts[i];
      for (let row = r.y; row < r.y + r.height; row++) {
        for (let col = r.x; col < r.x + r.width; col++) {
          tiles[row][col] = 'floor';
        }
      }
    }

    // 7. Carve wide (2-3 tile) MST + loop corridors and doorway thresholds
    const mstEdgeKeys = new Set<string>(
      mstEdgesMapped.map((e) => (e.u < e.v ? `${e.u}:${e.v}` : `${e.v}:${e.u}`)),
    );

    for (let i = 0; i < finalEdges.length; i++) {
      const edge = finalEdges[i];
      const roomA = drafts[edge.u];
      const roomB = drafts[edge.v];
      roomA.connectedIndices.add(edge.v);
      roomB.connectedIndices.add(edge.u);

      const key = edge.u < edge.v ? `${edge.u}:${edge.v}` : `${edge.v}:${edge.u}`;
      const isMainArtery = mstEdgeKeys.has(key);
      const corridorWidth = isMainArtery ? 3 : rng.chance(0.65) ? 3 : 2;
      this.carveCorridorBetweenRooms(tiles, cols, rows, roomA, roomB, corridorWidth, rng);
    }

    // Mark clean doorway thresholds where corridors meet room perimeters
    this.markRoomDoorways(tiles, cols, rows, drafts);

    // 8. Guarantee 100% pure dry-floor connectivity across all rooms
    this.enforceFullConnectivity(tiles, cols, rows, drafts, spawnIdx);

    // 9. Build spatial navigator + finalize DungeonRoom descriptors
    const navigator = new DungeonSpatialNavigator(cols, rows, TILE_SIZE, tiles);

    const rooms: DungeonRoom[] = drafts.map((d) => {
      const centerGrid: GridCoord = {
        col: d.x + Math.floor(d.width / 2),
        row: d.y + Math.floor(d.height / 2),
      };
      const connectedRoomIds = Array.from(d.connectedIndices)
        .sort((a, b) => a - b)
        .map((idx) => drafts[idx].id);

      return {
        id: d.id,
        type: d.type,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        centerGrid,
        centerWorld: navigator.gridToWorld(centerGrid.col, centerGrid.row),
        connectedRoomIds,
        cleared: d.type === 'spawn',
      };
    });

    const spawnRoom = rooms[spawnIdx];
    const bossRoom = rooms[bossIdx];

    const occupiedTiles = new Set<string>();
    const markOccupied = (c: number, r: number, pad = 1): void => {
      for (let dr = -pad; dr <= pad; dr++) {
        for (let dc = -pad; dc <= pad; dc++) {
          occupiedTiles.add(`${c + dc}:${r + dr}`);
        }
      }
    };

    const playerSpawn = { ...spawnRoom.centerWorld };
    markOccupied(spawnRoom.centerGrid.col, spawnRoom.centerGrid.row, 1);

    const bossSpawn = { ...bossRoom.centerWorld };
    markOccupied(bossRoom.centerGrid.col, bossRoom.centerGrid.row, 2);

    const portalGrid = this.chooseBossPortalGrid(
      bossRoom,
      spawnRoom,
      tiles,
      occupiedTiles,
    );
    markOccupied(portalGrid.col, portalGrid.row, 1);
    const portalPosition = navigator.gridToWorld(portalGrid.col, portalGrid.row);

    // 10. Place all interactables (including Phase 3 obelisk, soul_lantern, rift_breach)
    //     on pristine dry 'floor' tiles BEFORE carving special biome hazard/teleporter tiles!
    const interactables = this.placeInteractables(
      rooms,
      spawnRoom,
      bossRoom,
      portalPosition,
      biome,
      safeFloor,
      tiles,
      navigator,
      occupiedTiles,
      markOccupied,
      rng,
    );

    // 11. Carve biome-specific floor hazards, cathedral 'hazard_ice' nave sheets,
    //     and observatory paired 'teleporter_pad' warp rings (strictly respecting occupiedTiles)
    this.placeBiomeSpecialTiles(tiles, rooms, spawnRoom, bossRoom, biome, occupiedTiles, rng);

    // 12. Wrap all walkable tiles with solid stone perimeter walls
    this.buildPerimeterWalls(tiles, cols, rows);

    // 13. Place evenly spaced wall sconce torchPositions on inner room/corridor wall faces
    const torchPositions = this.generateTorchPositions(
      tiles,
      cols,
      rows,
      rooms,
      bossRoom,
      navigator,
      rng,
    );

    const revealRadius = makeRevealRadiusFn(cols, rows, explored, navigator);
    revealRadius(playerSpawn, INITIAL_REVEAL_RADIUS_WORLD);

    return {
      floorNumber: safeFloor,
      biome,
      seed: resolvedSeed,
      cols,
      rows,
      tileSize: TILE_SIZE,
      tiles,
      explored,
      rooms,
      playerSpawn,
      bossSpawn,
      portalPosition,
      interactables,
      torchPositions,
      worldToGrid: (worldPos: Vec3) => navigator.worldToGrid(worldPos),
      gridToWorld: (col: number, row: number) => navigator.gridToWorld(col, row),
      isWalkableWorld: (x: number, z: number, radius?: number) =>
        navigator.isWalkableWorld(x, z, radius),
      findPath: (fromWorld: Vec3, toWorld: Vec3, maxSteps?: number) =>
        navigator.findPath(fromWorld, toWorld, maxSteps),
      revealRadius,
    };
  }

  /**
   * Generates the Crimson Bloodhunt Colosseum: a grand circular ~46x46 gladiatorial arena
   * with 8 symmetrical ring pillars, cardinal gate alcoves, ceremonial braziers, and full A*.
   */
  generateColosseumFloor(waveTier = 1, seed?: number): DungeonFloorData {
    const safeTier = Math.max(1, Math.floor(Number.isFinite(waveTier) ? waveTier : 1));
    const resolvedSeed =
      seed !== undefined && Number.isFinite(seed)
        ? Math.floor(seed) >>> 0
        : ((Date.now() ^ Math.imul(safeTier + 77, 0x85ebca6b)) >>> 0) || 1;

    const cols = 46;
    const rows = 46;
    const biome: BiomeId = 'colosseum';

    const tiles: TileType[][] = Array.from({ length: rows }, () =>
      new Array<TileType>(cols).fill('void'),
    );
    const explored: boolean[][] = Array.from({ length: rows }, () =>
      new Array<boolean>(cols).fill(false),
    );

    const centerX = (cols - 1) * 0.5; // 22.5
    const centerY = (rows - 1) * 0.5; // 22.5
    const arenaRadius = 18.2;

    // 1. Carve grand circular sandstone arena floor
    for (let r = 3; r < rows - 3; r++) {
      for (let c = 3; c < cols - 3; c++) {
        const d = Math.hypot(c - centerX, r - centerY);
        if (d <= arenaRadius) {
          tiles[r][c] = 'floor';
        }
      }
    }

    // Carve 4 recessed Gladiator Gate alcoves at N, S, E, W
    const mid = 23;
    for (let offset = -1; offset <= 1; offset++) {
      tiles[3][mid + offset] = 'door';
      tiles[4][mid + offset] = 'floor';
      tiles[rows - 4][mid + offset] = 'door';
      tiles[rows - 5][mid + offset] = 'floor';
      tiles[mid + offset][3] = 'door';
      tiles[mid + offset][4] = 'floor';
      tiles[mid + offset][cols - 4] = 'door';
      tiles[mid + offset][cols - 5] = 'floor';
    }

    // 2. Carve 8 symmetrical 2x2 Gladiatorial Ring Pillars rotated by PI/8
    //    so N/S/E/W cardinal sightlines remain completely clear!
    const pillarRingRadius = 11.2;
    const pillarCenters: GridCoord[] = [];
    for (let k = 0; k < 8; k++) {
      const angle = (k + 0.5) * (Math.PI / 4);
      const pc = Math.round(centerX + Math.cos(angle) * pillarRingRadius - 0.5);
      const pr = Math.round(centerY + Math.sin(angle) * pillarRingRadius - 0.5);
      pillarCenters.push({ col: pc, row: pr });
      tiles[pr][pc] = 'wall';
      tiles[pr][pc + 1] = 'wall';
      tiles[pr + 1][pc] = 'wall';
      tiles[pr + 1][pc + 1] = 'wall';
    }

    // 3. Higher wave tiers add 4 diagonal molten fire-pit grates near outer track
    if (safeTier >= 2) {
      const pitRadius = 15.0;
      for (let k = 0; k < 4; k++) {
        const angle = (k + 0.5) * (Math.PI / 2);
        const hc = Math.round(centerX + Math.cos(angle) * pitRadius);
        const hr = Math.round(centerY + Math.sin(angle) * pitRadius);
        if (tiles[hr]?.[hc] === 'floor') {
          tiles[hr][hc] = 'hazard_lava';
        }
      }
    }

    // 4. Wrap circular arena exterior with solid stone walls
    this.buildPerimeterWalls(tiles, cols, rows);

    const navigator = new DungeonSpatialNavigator(cols, rows, TILE_SIZE, tiles);

    // Define Southern Gladiator Gate ('spawn') + Grand Arena Pit ('combat')
    // (No 'boss' room per BossDirector Colosseum contract — Twin-Bosses spawn via spawnColosseumBosses)
    const gateRoom: DungeonRoom = {
      id: 'colosseum_gate',
      type: 'spawn',
      x: 19,
      y: 33,
      width: 9,
      height: 7,
      centerGrid: { col: 23, row: 36 },
      centerWorld: navigator.gridToWorld(23, 36),
      connectedRoomIds: ['colosseum_pit'],
      cleared: true,
    };

    const pitRoom: DungeonRoom = {
      id: 'colosseum_pit',
      type: 'combat',
      x: 9,
      y: 9,
      width: 29,
      height: 25,
      centerGrid: { col: 23, row: 23 },
      centerWorld: navigator.gridToWorld(23, 23),
      connectedRoomIds: ['colosseum_gate'],
      cleared: false,
    };

    const rooms: DungeonRoom[] = [gateRoom, pitRoom];

    const playerSpawn = navigator.gridToWorld(23, 36);
    const bossSpawn = navigator.gridToWorld(23, 23);
    const portalPosition = navigator.gridToWorld(23, 7);

    const interactables: InteractableProp[] = [
      {
        id: `colosseum_portal_t${safeTier}`,
        type: 'portal_next_floor',
        position: { ...portalPosition },
        roomId: pitRoom.id,
        used: false,
        label: 'Portal to Bastion Sanctuary',
      },
      {
        id: `colosseum_waypoint_t${safeTier}`,
        type: 'waypoint_map',
        position: navigator.gridToWorld(20, 36),
        roomId: gateRoom.id,
        used: false,
        label: 'Waypoint Atlas',
      },
      {
        id: `colosseum_anvil_t${safeTier}`,
        type: 'blacksmith_anvil',
        position: navigator.gridToWorld(26, 36),
        roomId: gateRoom.id,
        used: false,
        label: 'Gladiator Forge Anvil',
      },
      {
        id: `colosseum_shrine_t${safeTier}`,
        type: 'shrine_heal',
        position: navigator.gridToWorld(7, 23),
        roomId: pitRoom.id,
        used: false,
        label: 'Arena Blood-Font of Vitality',
      },
      {
        id: `colosseum_obelisk_t${safeTier}`,
        type: 'corrupted_obelisk',
        position: navigator.gridToWorld(38, 23),
        roomId: pitRoom.id,
        used: false,
        label: 'Colosseum Pact Obelisk',
      },
      {
        id: `colosseum_lore_t${safeTier}`,
        type: 'lore_tome',
        position: navigator.gridToWorld(18, 37),
        roomId: gateRoom.id,
        used: false,
        label: LORE_LABELS.colosseum[0],
        loreId: 'lore_colosseum_01',
      },
    ];

    // 5. Place 16 ceremonial braziers/torches around outer wall & inner pillar faces
    const torchPositions: Vec3[] = [];
    for (let k = 0; k < 12; k++) {
      const angle = k * ((Math.PI * 2) / 12) + Math.PI / 12;
      const tc = Math.round(centerX + Math.cos(angle) * (arenaRadius - 1.2));
      const tr = Math.round(centerY + Math.sin(angle) * (arenaRadius - 1.2));
      if (tiles[tr]?.[tc] === 'floor') {
        const w = navigator.gridToWorld(tc, tr);
        torchPositions.push({ x: w.x, y: TORCH_HEIGHT_Y, z: w.z });
      }
    }
    for (let k = 0; k < pillarCenters.length; k += 2) {
      const p = pillarCenters[k];
      const inwardCol = p.col < mid ? p.col + 2 : p.col - 1;
      const inwardRow = p.row < mid ? p.row + 2 : p.row - 1;
      if (tiles[inwardRow]?.[inwardCol] === 'floor') {
        const fw = navigator.gridToWorld(inwardCol, inwardRow);
        const pw = navigator.gridToWorld(
          inwardCol < p.col ? p.col : p.col + 1,
          inwardRow < p.row ? p.row : p.row + 1,
        );
        torchPositions.push({
          x: fw.x + (pw.x - fw.x) * 0.35,
          y: TORCH_HEIGHT_Y,
          z: fw.z + (pw.z - fw.z) * 0.35,
        });
      }
    }

    const revealRadius = makeRevealRadiusFn(cols, rows, explored, navigator);
    revealRadius(bossSpawn, 52.0);

    return {
      floorNumber: safeTier,
      biome,
      seed: resolvedSeed,
      cols,
      rows,
      tileSize: TILE_SIZE,
      tiles,
      explored,
      rooms,
      playerSpawn,
      bossSpawn,
      portalPosition,
      interactables,
      torchPositions,
      worldToGrid: (worldPos: Vec3) => navigator.worldToGrid(worldPos),
      gridToWorld: (col: number, row: number) => navigator.gridToWorld(col, row),
      isWalkableWorld: (x: number, z: number, radius?: number) =>
        navigator.isWalkableWorld(x, z, radius),
      findPath: (fromWorld: Vec3, toWorld: Vec3, maxSteps?: number) =>
        navigator.findPath(fromWorld, toWorld, maxSteps),
      revealRadius,
    };
  }

  private placeRoomsBsp(
    cols: number,
    rows: number,
    targetRooms: number,
    rng: SeededRng,
  ): MutableRoomDraft[] {
    const rootLeaf: BspLeaf = {
      x: GRID_BORDER,
      y: GRID_BORDER,
      w: cols - GRID_BORDER * 2,
      h: rows - GRID_BORDER * 2,
    };

    const queue: BspLeaf[] = [rootLeaf];
    const minLeafSide = 17;
    const maxDesiredLeaves = targetRooms + 5;

    let idx = 0;
    while (idx < queue.length && queue.length - idx < maxDesiredLeaves) {
      const leaf = queue[idx];
      const canSplitH = leaf.h >= minLeafSide * 2;
      const canSplitV = leaf.w >= minLeafSide * 2;

      if (!canSplitH && !canSplitV) {
        idx += 1;
        continue;
      }

      if (queue.length - idx >= targetRooms + 2 && leaf.w < 26 && leaf.h < 26) {
        idx += 1;
        continue;
      }

      let splitVertical: boolean;
      if (canSplitV && !canSplitH) {
        splitVertical = true;
      } else if (canSplitH && !canSplitV) {
        splitVertical = false;
      } else if (leaf.w > leaf.h * 1.2) {
        splitVertical = true;
      } else if (leaf.h > leaf.w * 1.2) {
        splitVertical = false;
      } else {
        splitVertical = rng.chance(0.5);
      }

      queue.splice(idx, 1);
      if (splitVertical) {
        const minSplit = minLeafSide;
        const maxSplit = leaf.w - minLeafSide;
        const splitW = Math.floor(
          clamp(leaf.w * rng.range(0.4, 0.6), minSplit, maxSplit),
        );
        queue.push({ x: leaf.x, y: leaf.y, w: splitW, h: leaf.h });
        queue.push({ x: leaf.x + splitW, y: leaf.y, w: leaf.w - splitW, h: leaf.h });
      } else {
        const minSplit = minLeafSide;
        const maxSplit = leaf.h - minLeafSide;
        const splitH = Math.floor(
          clamp(leaf.h * rng.range(0.4, 0.6), minSplit, maxSplit),
        );
        queue.push({ x: leaf.x, y: leaf.y, w: leaf.w, h: splitH });
        queue.push({ x: leaf.x, y: leaf.y + splitH, w: leaf.w, h: leaf.h - splitH });
      }
    }

    shuffleInPlace(queue, rng);
    const drafts: MutableRoomDraft[] = [];

    for (let i = 0; i < queue.length && drafts.length < targetRooms; i++) {
      const leaf = queue[i];
      const maxW = Math.min(15, leaf.w - 4);
      const maxH = Math.min(15, leaf.h - 4);
      if (maxW < 9 || maxH < 9) continue;

      const rw = toOdd(rng.int(9, maxW), 9, maxW);
      const rh = toOdd(rng.int(9, maxH), 9, maxH);
      const minX = leaf.x + 2;
      const maxX = leaf.x + leaf.w - rw - 2;
      const minY = leaf.y + 2;
      const maxY = leaf.y + leaf.h - rh - 2;
      const rx = maxX >= minX ? rng.int(minX, maxX) : minX;
      const ry = maxY >= minY ? rng.int(minY, maxY) : minY;

      let overlaps = false;
      for (let k = 0; k < drafts.length; k++) {
        const other = drafts[k];
        if (
          roomsOverlapWithMargin(rx, ry, rw, rh, other.x, other.y, other.width, other.height, 4)
        ) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        const roomIdx = drafts.length;
        drafts.push({
          index: roomIdx,
          id: `room_${roomIdx + 1}`,
          type: 'combat',
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          connectedIndices: new Set<number>(),
        });
      }
    }

    // Fallback rejection sampling if BSP leaves yielded fewer than targetRooms
    let attempts = 0;
    while (drafts.length < targetRooms && attempts < 600) {
      attempts += 1;
      const margin = attempts < 350 ? 4 : 3;
      const rw = attempts < 350 ? toOdd(rng.int(9, 13), 9, 13) : 9;
      const rh = attempts < 350 ? toOdd(rng.int(9, 13), 9, 13) : 9;
      const rx = rng.int(GRID_BORDER, cols - GRID_BORDER - rw);
      const ry = rng.int(GRID_BORDER, rows - GRID_BORDER - rh);

      let overlaps = false;
      for (let k = 0; k < drafts.length; k++) {
        const other = drafts[k];
        if (
          roomsOverlapWithMargin(
            rx,
            ry,
            rw,
            rh,
            other.x,
            other.y,
            other.width,
            other.height,
            margin,
          )
        ) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        const roomIdx = drafts.length;
        drafts.push({
          index: roomIdx,
          id: `room_${roomIdx + 1}`,
          type: 'combat',
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          connectedIndices: new Set<number>(),
        });
      }
    }

    return drafts;
  }

  private assignRoomTypes(
    drafts: MutableRoomDraft[],
    spawnIdx: number,
    bossIdx: number,
    distFromSpawn: Float64Array,
    edges: readonly GraphEdge[],
    floorNumber: number,
    rng: SeededRng,
  ): void {
    const degrees = new Int32Array(drafts.length);
    for (let i = 0; i < edges.length; i++) {
      degrees[edges[i].u] += 1;
      degrees[edges[i].v] += 1;
    }

    drafts[spawnIdx].type = 'spawn';
    drafts[bossIdx].type = 'boss';

    const candidates: number[] = [];
    for (let i = 0; i < drafts.length; i++) {
      if (i !== spawnIdx && i !== bossIdx) {
        candidates.push(i);
      }
    }

    candidates.sort((a, b) => distFromSpawn[a] - distFromSpawn[b]);

    const firstSkirmish = candidates.shift();
    if (firstSkirmish !== undefined) {
      drafts[firstSkirmish].type = 'combat';
    }

    const requiredSpecials: RoomType[] = [
      'treasure',
      'cursed_event',
      'elite',
      'shrine',
      'trap',
    ];
    if (floorNumber >= 2 && candidates.length >= 8) {
      requiredSpecials.push('elite');
    }
    if (floorNumber >= 3 && candidates.length >= 10) {
      requiredSpecials.push('shrine');
    }
    if (floorNumber >= 4 && candidates.length >= 12) {
      requiredSpecials.push('trap', 'treasure');
    }
    if (floorNumber >= 5 && candidates.length >= 14) {
      requiredSpecials.push('elite', 'cursed_event');
    }

    const unassigned = new Set<number>(candidates);

    const pickBestCandidate = (
      preferLowDegree: boolean,
      preferDeepHalf: boolean,
    ): number | undefined => {
      const pool = Array.from(unassigned);
      if (pool.length === 0) return undefined;

      pool.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;
        if (preferLowDegree) {
          scoreA -= degrees[a] * 10;
          scoreB -= degrees[b] * 10;
        }
        if (preferDeepHalf) {
          scoreA += distFromSpawn[a];
          scoreB += distFromSpawn[b];
        } else {
          const mid = distFromSpawn[bossIdx] * 0.55;
          scoreA -= Math.abs(distFromSpawn[a] - mid);
          scoreB -= Math.abs(distFromSpawn[b] - mid);
        }
        return scoreB - scoreA;
      });

      const topCount = Math.min(3, pool.length);
      const chosen = pool[rng.int(0, topCount - 1)];
      unassigned.delete(chosen);
      return chosen;
    };

    for (let i = 0; i < requiredSpecials.length; i++) {
      const rType = requiredSpecials[i];
      let chosen: number | undefined;
      if (rType === 'treasure') {
        chosen = pickBestCandidate(true, true);
      } else if (rType === 'elite' || rType === 'cursed_event') {
        chosen = pickBestCandidate(false, true);
      } else {
        chosen = pickBestCandidate(false, false);
      }
      if (chosen !== undefined) {
        drafts[chosen].type = rType;
      }
    }

    for (const idx of unassigned) {
      drafts[idx].type = 'combat';
    }
  }

  private canPlaceRoomRect(
    roomIndex: number,
    nx: number,
    ny: number,
    nw: number,
    nh: number,
    drafts: readonly MutableRoomDraft[],
    cols: number,
    rows: number,
    margin: number,
  ): boolean {
    if (
      nx < GRID_BORDER - 1 ||
      ny < GRID_BORDER - 1 ||
      nx + nw > cols - (GRID_BORDER - 1) ||
      ny + nh > rows - (GRID_BORDER - 1)
    ) {
      return false;
    }

    for (let i = 0; i < drafts.length; i++) {
      if (i === roomIndex) continue;
      const other = drafts[i];
      if (
        roomsOverlapWithMargin(nx, ny, nw, nh, other.x, other.y, other.width, other.height, margin)
      ) {
        return false;
      }
    }
    return true;
  }

  private expandRoomToTarget(
    room: MutableRoomDraft,
    drafts: readonly MutableRoomDraft[],
    cols: number,
    rows: number,
    targetW: number,
    targetH: number,
    margin: number,
  ): void {
    let progressed = true;
    while (progressed && (room.width < targetW || room.height < targetH)) {
      progressed = false;

      if (room.width < targetW) {
        const candidatesX = [room.x - 1, room.x, room.x - 2];
        for (const cx of candidatesX) {
          if (
            this.canPlaceRoomRect(
              room.index,
              cx,
              room.y,
              room.width + 2,
              room.height,
              drafts,
              cols,
              rows,
              margin,
            )
          ) {
            room.x = cx;
            room.width += 2;
            progressed = true;
            break;
          }
        }
      }

      if (room.height < targetH) {
        const candidatesY = [room.y - 1, room.y, room.y - 2];
        for (const cy of candidatesY) {
          if (
            this.canPlaceRoomRect(
              room.index,
              room.x,
              cy,
              room.width,
              room.height + 2,
              drafts,
              cols,
              rows,
              margin,
            )
          ) {
            room.y = cy;
            room.height += 2;
            progressed = true;
            break;
          }
        }
      }
    }
  }

  private expandBossArena(
    boss: MutableRoomDraft,
    drafts: readonly MutableRoomDraft[],
    cols: number,
    rows: number,
  ): void {
    this.expandRoomToTarget(boss, drafts, cols, rows, 19, 19, 3);
    if (boss.width >= 15 && boss.height >= 15) {
      return;
    }

    const desiredSizes = [19, 17, 15];
    for (const size of desiredSizes) {
      for (let dy = -8; dy <= 8; dy += 2) {
        for (let dx = -8; dx <= 8; dx += 2) {
          const nx = boss.x + dx;
          const ny = boss.y + dy;
          if (
            this.canPlaceRoomRect(boss.index, nx, ny, size, size, drafts, cols, rows, 3)
          ) {
            boss.x = nx;
            boss.y = ny;
            boss.width = size;
            boss.height = size;
            return;
          }
        }
      }
    }
  }

  private carveBrush(
    tiles: TileType[][],
    cols: number,
    rows: number,
    col: number,
    row: number,
    width: number,
  ): void {
    const startOffset = width === 3 ? -1 : 0;
    const endOffset = width === 3 ? 1 : 1;

    for (let dr = startOffset; dr <= endOffset; dr++) {
      const rr = row + dr;
      if (rr < 2 || rr >= rows - 2) continue;
      for (let dc = startOffset; dc <= endOffset; dc++) {
        const cc = col + dc;
        if (cc < 2 || cc >= cols - 2) continue;
        if (tiles[rr][cc] === 'void') {
          tiles[rr][cc] = 'corridor';
        }
      }
    }
  }

  private carveSegment(
    tiles: TileType[][],
    cols: number,
    rows: number,
    c0: number,
    r0: number,
    c1: number,
    r1: number,
    width: number,
  ): void {
    let c = c0;
    let r = r0;
    this.carveBrush(tiles, cols, rows, c, r, width);

    while (c !== c1) {
      c += c1 > c ? 1 : -1;
      this.carveBrush(tiles, cols, rows, c, r, width);
    }
    while (r !== r1) {
      r += r1 > r ? 1 : -1;
      this.carveBrush(tiles, cols, rows, c, r, width);
    }
  }

  private carveCorridorBetweenRooms(
    tiles: TileType[][],
    cols: number,
    rows: number,
    roomA: MutableRoomDraft,
    roomB: MutableRoomDraft,
    width: number,
    rng: SeededRng,
  ): void {
    const ac = roomA.x + Math.floor(roomA.width / 2);
    const ar = roomA.y + Math.floor(roomA.height / 2);
    const bc = roomB.x + Math.floor(roomB.width / 2);
    const br = roomB.y + Math.floor(roomB.height / 2);

    const dc = Math.abs(bc - ac);
    const dr = Math.abs(br - ar);

    if (dc > 8 && dr > 8 && rng.chance(0.45)) {
      if (rng.chance(0.5)) {
        const midC = Math.floor((ac + bc) / 2);
        this.carveSegment(tiles, cols, rows, ac, ar, midC, ar, width);
        this.carveSegment(tiles, cols, rows, midC, ar, midC, br, width);
        this.carveSegment(tiles, cols, rows, midC, br, bc, br, width);
      } else {
        const midR = Math.floor((ar + br) / 2);
        this.carveSegment(tiles, cols, rows, ac, ar, ac, midR, width);
        this.carveSegment(tiles, cols, rows, ac, midR, bc, midR, width);
        this.carveSegment(tiles, cols, rows, bc, midR, bc, br, width);
      }
    } else if (rng.chance(0.5)) {
      this.carveSegment(tiles, cols, rows, ac, ar, bc, ar, width);
      this.carveSegment(tiles, cols, rows, bc, ar, bc, br, width);
    } else {
      this.carveSegment(tiles, cols, rows, ac, ar, ac, br, width);
      this.carveSegment(tiles, cols, rows, ac, br, bc, br, width);
    }
  }

  private markRoomDoorways(
    tiles: TileType[][],
    cols: number,
    rows: number,
    drafts: readonly MutableRoomDraft[],
  ): void {
    for (let i = 0; i < drafts.length; i++) {
      const r = drafts[i];
      const topRow = r.y - 1;
      const botRow = r.y + r.height;
      const leftCol = r.x - 1;
      const rightCol = r.x + r.width;

      if (topRow >= 2) {
        for (let c = r.x; c < r.x + r.width; c++) {
          if (tiles[topRow][c] === 'corridor' && tiles[topRow - 1][c] === 'corridor') {
            tiles[topRow][c] = 'door';
          }
        }
      }
      if (botRow < rows - 2) {
        for (let c = r.x; c < r.x + r.width; c++) {
          if (tiles[botRow][c] === 'corridor' && tiles[botRow + 1][c] === 'corridor') {
            tiles[botRow][c] = 'door';
          }
        }
      }
      if (leftCol >= 2) {
        for (let row = r.y; row < r.y + r.height; row++) {
          if (tiles[row][leftCol] === 'corridor' && tiles[row][leftCol - 1] === 'corridor') {
            tiles[row][leftCol] = 'door';
          }
        }
      }
      if (rightCol < cols - 2) {
        for (let row = r.y; row < r.y + r.height; row++) {
          if (tiles[row][rightCol] === 'corridor' && tiles[row][rightCol + 1] === 'corridor') {
            tiles[row][rightCol] = 'door';
          }
        }
      }
    }
  }

  /**
   * Explicit BFS flood-fill over pure dry walkable tiles ('floor' | 'corridor' | 'door').
   * If any room center is ever unvisited, carves a 3-tile wide corridor straight to it.
   */
  private enforceFullConnectivity(
    tiles: TileType[][],
    cols: number,
    rows: number,
    drafts: MutableRoomDraft[],
    spawnIdx: number,
  ): void {
    const total = cols * rows;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);

    const runFloodFill = (): number[] => {
      visited.fill(0);
      const sc = drafts[spawnIdx].x + Math.floor(drafts[spawnIdx].width / 2);
      const sr = drafts[spawnIdx].y + Math.floor(drafts[spawnIdx].height / 2);
      const startIdx = sr * cols + sc;
      visited[startIdx] = 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;

      while (head < tail) {
        const curr = queue[head++];
        const r = Math.floor(curr / cols);
        const c = curr - r * cols;

        const neighbors = [
          [c, r - 1],
          [c + 1, r],
          [c, r + 1],
          [c - 1, r],
        ];
        for (let k = 0; k < 4; k++) {
          const nc = neighbors[k][0];
          const nr = neighbors[k][1];
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const nIdx = nr * cols + nc;
          if (visited[nIdx] === 0 && isPureDryFloorTile(tiles[nr][nc])) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }

      const disconnected: number[] = [];
      for (let i = 0; i < drafts.length; i++) {
        const rc = drafts[i].x + Math.floor(drafts[i].width / 2);
        const rr = drafts[i].y + Math.floor(drafts[i].height / 2);
        if (visited[rr * cols + rc] === 0) {
          disconnected.push(i);
        }
      }
      return disconnected;
    };

    let missing = runFloodFill();
    let safety = 0;
    while (missing.length > 0 && safety < drafts.length + 2) {
      safety += 1;
      const targetRoom = drafts[missing[0]];
      const tc = targetRoom.x + Math.floor(targetRoom.width / 2);
      const tr = targetRoom.y + Math.floor(targetRoom.height / 2);

      let nearestIdx = spawnIdx;
      let bestDist = Infinity;
      for (let i = 0; i < drafts.length; i++) {
        if (missing.includes(i)) continue;
        const cc = drafts[i].x + Math.floor(drafts[i].width / 2);
        const cr = drafts[i].y + Math.floor(drafts[i].height / 2);
        const d = Math.hypot(cc - tc, cr - tr);
        if (d < bestDist) {
          bestDist = d;
          nearestIdx = i;
        }
      }

      const nearRoom = drafts[nearestIdx];
      nearRoom.connectedIndices.add(targetRoom.index);
      targetRoom.connectedIndices.add(nearRoom.index);
      const nc = nearRoom.x + Math.floor(nearRoom.width / 2);
      const nr = nearRoom.y + Math.floor(nearRoom.height / 2);
      this.carveSegment(tiles, cols, rows, nc, nr, tc, nr, 3);
      this.carveSegment(tiles, cols, rows, tc, nr, tc, tr, 3);

      missing = runFloodFill();
    }
  }

  /**
   * Places biome-flavored special floor tiles AFTER interactable placement so
   * spawns and props remain on clean flagstones:
   * - 'cathedral': slippery 'hazard_ice' glacial nave sheets across combat/trap/elite rooms.
   * - 'observatory': paired single-tile 'teleporter_pad' warp rings across separated chambers.
   * - 'crypt'/'caverns': 'hazard_poison' pools.
   * - 'forge'/'void': 'hazard_lava' pools.
   */
  private placeBiomeSpecialTiles(
    tiles: TileType[][],
    rooms: readonly DungeonRoom[],
    spawnRoom: DungeonRoom,
    bossRoom: DungeonRoom,
    biome: BiomeId,
    occupied: ReadonlySet<string>,
    rng: SeededRng,
  ): void {
    if (biome === 'cathedral') {
      let iceTilesPlaced = 0;
      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        if (r.id === spawnRoom.id || r.id === bossRoom.id) continue;
        if (r.type !== 'combat' && r.type !== 'trap' && r.type !== 'elite') continue;

        const minC = r.x + 2;
        const maxC = r.x + r.width - 3;
        const minR = r.y + 2;
        const maxR = r.y + r.height - 3;
        const horizontalNave = r.width >= r.height;

        for (let row = minR; row <= maxR; row++) {
          for (let col = minC; col <= maxC; col++) {
            if (occupied.has(`${col}:${row}`)) continue;
            if (tiles[row][col] !== 'floor') continue;

            const inNaveBand = horizontalNave
              ? Math.abs(row - r.centerGrid.row) <= 1
              : Math.abs(col - r.centerGrid.col) <= 1;

            if (inNaveBand || (r.type === 'trap' && rng.chance(0.45))) {
              tiles[row][col] = 'hazard_ice';
              iceTilesPlaced += 1;
            }
          }
        }
      }

      // Fallback guarantee so every Cathedral floor always contains glacial ice sheets
      if (iceTilesPlaced === 0) {
        for (let i = 0; i < rooms.length; i++) {
          const r = rooms[i];
          if (r.id === spawnRoom.id || r.id === bossRoom.id) continue;
          const c = r.centerGrid.col;
          const row = r.centerGrid.row;
          if (!occupied.has(`${c}:${row}`) && tiles[row]?.[c] === 'floor') {
            tiles[row][c] = 'hazard_ice';
            iceTilesPlaced += 1;
          }
        }
      }
      return;
    }

    if (biome === 'observatory') {
      // Place exact pairs (4 or 2 single 1x1 tiles) of 'teleporter_pad' across well-separated rooms
      const candidateRooms = rooms.filter(
        (r) =>
          r.id !== spawnRoom.id &&
          r.id !== bossRoom.id &&
          (r.type === 'combat' || r.type === 'shrine' || r.type === 'treasure' || r.type === 'elite'),
      );

      // Sort by X+Y so consecutive pairs span meaningful distances when interleaved
      candidateRooms.sort(
        (a, b) => a.centerGrid.col + a.centerGrid.row - (b.centerGrid.col + b.centerGrid.row),
      );

      const orderedForPairing: DungeonRoom[] = [];
      if (candidateRooms.length >= 4) {
        const half = Math.floor(candidateRooms.length / 2);
        orderedForPairing.push(
          candidateRooms[0],
          candidateRooms[half],
          candidateRooms[1],
          candidateRooms[candidateRooms.length - 1],
        );
      } else if (candidateRooms.length >= 2) {
        orderedForPairing.push(candidateRooms[0], candidateRooms[candidateRooms.length - 1]);
      }

      const chosenPads: GridCoord[] = [];
      for (const room of orderedForPairing) {
        const padSpot = this.findSafeRoomTile(room, tiles, occupied, -2, 0);
        if (
          tiles[padSpot.row]?.[padSpot.col] === 'floor' &&
          !occupied.has(`${padSpot.col}:${padSpot.row}`) &&
          !chosenPads.some(
            (p) => Math.hypot(p.col - padSpot.col, p.row - padSpot.row) < 6,
          )
        ) {
          chosenPads.push(padSpot);
        }
      }

      // Enforce strictly even count (4 or 2) so every teleporter pad has a true partner
      if (chosenPads.length % 2 === 1) {
        chosenPads.pop();
      }
      for (const pad of chosenPads) {
        tiles[pad.row][pad.col] = 'teleporter_pad';
      }
      return;
    }

    const hazardType: TileType =
      biome === 'forge' || biome === 'void' ? 'hazard_lava' : 'hazard_poison';

    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      if (r.type !== 'trap' && r.type !== 'combat') continue;
      if (r.width < 11 || r.height < 11) continue;
      if (r.type === 'combat' && !rng.chance(0.45)) continue;

      const centerCol = r.centerGrid.col;
      const centerRow = r.centerGrid.row;

      const quadrantOffsets: Array<[number, number]> = [
        [-3, -3],
        [2, -3],
        [-3, 2],
        [2, 2],
      ];
      shuffleInPlace(quadrantOffsets, rng);
      const poolCount = r.type === 'trap' ? 2 : 1;
      let placed = 0;

      for (const [oc, or] of quadrantOffsets) {
        if (placed >= poolCount) break;
        const pc = centerCol + oc;
        const pr = centerRow + or;
        if (
          pc < r.x + 3 ||
          pc + 1 > r.x + r.width - 4 ||
          pr < r.y + 3 ||
          pr + 1 > r.y + r.height - 4
        ) {
          continue;
        }
        if (
          occupied.has(`${pc}:${pr}`) ||
          occupied.has(`${pc + 1}:${pr}`) ||
          occupied.has(`${pc}:${pr + 1}`) ||
          occupied.has(`${pc + 1}:${pr + 1}`)
        ) {
          continue;
        }

        tiles[pr][pc] = hazardType;
        tiles[pr][pc + 1] = hazardType;
        tiles[pr + 1][pc] = hazardType;
        tiles[pr + 1][pc + 1] = hazardType;
        placed += 1;
      }
    }
  }

  private buildPerimeterWalls(tiles: TileType[][], cols: number, rows: number): void {
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (tiles[r][c] !== 'void') continue;
        let touchesWalkable = false;
        for (let dr = -1; dr <= 1 && !touchesWalkable; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dc === 0 && dr === 0) continue;
            if (isTileWalkable(tiles[r + dr][c + dc])) {
              touchesWalkable = true;
              break;
            }
          }
        }
        if (touchesWalkable) {
          tiles[r][c] = 'wall';
        }
      }
    }
  }

  private isCleanPropSpot(
    tiles: TileType[][],
    col: number,
    row: number,
    occupied: ReadonlySet<string>,
  ): boolean {
    if (occupied.has(`${col}:${row}`)) return false;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (tiles[row + dr]?.[col + dc] !== 'floor') {
          return false;
        }
      }
    }
    return true;
  }

  private findSafeRoomTile(
    room: DungeonRoom,
    tiles: TileType[][],
    occupied: ReadonlySet<string>,
    preferredOffsetCol = 0,
    preferredOffsetRow = 0,
  ): GridCoord {
    const minC = room.x + 2;
    const maxC = room.x + room.width - 3;
    const minR = room.y + 2;
    const maxR = room.y + room.height - 3;

    const prefC = clamp(room.centerGrid.col + preferredOffsetCol, minC, maxC);
    const prefR = clamp(room.centerGrid.row + preferredOffsetRow, minR, maxR);

    if (this.isCleanPropSpot(tiles, prefC, prefR, occupied)) {
      return { col: prefC, row: prefR };
    }

    let best: GridCoord | null = null;
    let bestDist = Infinity;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (!this.isCleanPropSpot(tiles, c, r, occupied)) continue;
        const d = Math.hypot(c - prefC, r - prefR);
        if (d < bestDist) {
          bestDist = d;
          best = { col: c, row: r };
        }
      }
    }

    return best ?? { col: prefC, row: prefR };
  }

  private chooseBossPortalGrid(
    bossRoom: DungeonRoom,
    spawnRoom: DungeonRoom,
    tiles: TileType[][],
    occupied: ReadonlySet<string>,
  ): GridCoord {
    const dirCol = bossRoom.centerGrid.col - spawnRoom.centerGrid.col;
    const dirRow = bossRoom.centerGrid.row - spawnRoom.centerGrid.row;
    const halfSpanCol = Math.max(3, Math.floor(bossRoom.width / 2) - 3);
    const halfSpanRow = Math.max(3, Math.floor(bossRoom.height / 2) - 3);

    let offsetCol = 0;
    let offsetRow = -halfSpanRow;
    if (Math.abs(dirCol) > Math.abs(dirRow)) {
      offsetCol = dirCol >= 0 ? halfSpanCol : -halfSpanCol;
      offsetRow = 0;
    } else {
      offsetCol = 0;
      offsetRow = dirRow >= 0 ? halfSpanRow : -halfSpanRow;
    }

    return this.findSafeRoomTile(bossRoom, tiles, occupied, offsetCol, offsetRow);
  }

  private placeInteractables(
    rooms: readonly DungeonRoom[],
    spawnRoom: DungeonRoom,
    bossRoom: DungeonRoom,
    portalPosition: Vec3,
    biome: BiomeId,
    floorNumber: number,
    tiles: TileType[][],
    navigator: DungeonSpatialNavigator,
    occupied: Set<string>,
    markOccupied: (c: number, r: number, pad?: number) => void,
    rng: SeededRng,
  ): InteractableProp[] {
    const props: InteractableProp[] = [];
    let propSeq = 1;

    const addPropAtGrid = (
      room: DungeonRoom,
      type: InteractableType,
      grid: GridCoord,
      label: string,
      loreId?: string,
    ): void => {
      markOccupied(grid.col, grid.row, 1);
      const item: InteractableProp = {
        id: `prop_f${floorNumber}_${propSeq++}`,
        type,
        position: navigator.gridToWorld(grid.col, grid.row),
        roomId: room.id,
        used: false,
        label,
      };
      if (loreId !== undefined) {
        item.loreId = loreId;
      }
      props.push(item);
    };

    // 1. Spawn Room: Blacksmith Anvil + introductory Lore Tome
    const anvilGrid = this.findSafeRoomTile(spawnRoom, tiles, occupied, -2, -2);
    addPropAtGrid(spawnRoom, 'blacksmith_anvil', anvilGrid, 'Ancient Blacksmith Anvil');

    const loreLabels = LORE_LABELS[biome];
    let loreCursor = 0;
    const nextLoreMeta = (): { label: string; loreId: string } => {
      const idx = loreCursor % 3;
      loreCursor += 1;
      return {
        label: loreLabels[idx],
        loreId: `lore_${biome}_0${idx + 1}`,
      };
    };

    const spawnLore = nextLoreMeta();
    const spawnLoreGrid = this.findSafeRoomTile(spawnRoom, tiles, occupied, 2, -2);
    addPropAtGrid(
      spawnRoom,
      'lore_tome',
      spawnLoreGrid,
      spawnLore.label,
      spawnLore.loreId,
    );

    // 2. Boss Room: Portal to Next Floor
    props.push({
      id: `prop_f${floorNumber}_${propSeq++}`,
      type: 'portal_next_floor',
      position: { ...portalPosition },
      roomId: bossRoom.id,
      used: false,
      label: floorNumber >= 6 ? 'Sovereign Ascendant Rift' : 'Abyssal Descent Portal',
    });

    // 3. Populate special rooms + track placed shrine types so all 3 appear on every floor
    const placedShrines = new Set<InteractableType>();
    const shrineRotation: InteractableType[] = [
      'shrine_heal',
      'shrine_power',
      'shrine_frenzy',
    ];
    const shrineLabels: Record<
      'shrine_heal' | 'shrine_power' | 'shrine_frenzy',
      string
    > = {
      shrine_heal: 'Sanctuary Font of Vitality',
      shrine_power: 'Obelisk of Arcane Might',
      shrine_frenzy: 'Altar of Blood Frenzy',
    };

    const combatRooms: DungeonRoom[] = [];
    const eliteRooms: DungeonRoom[] = [];
    const trapRooms: DungeonRoom[] = [];

    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      if (room.id === spawnRoom.id || room.id === bossRoom.id) continue;

      switch (room.type) {
        case 'treasure': {
          const chestGrid = this.findSafeRoomTile(room, tiles, occupied, 0, 0);
          addPropAtGrid(room, 'chest', chestGrid, 'Gilded Reliquary Chest');
          if (room.width >= 11 && rng.chance(0.75)) {
            const bonusGrid = this.findSafeRoomTile(room, tiles, occupied, 2, 0);
            addPropAtGrid(room, 'chest', bonusGrid, 'Ornate Treasure Coffer');
          }
          break;
        }
        case 'cursed_event': {
          const cursedGrid = this.findSafeRoomTile(room, tiles, occupied, 0, 0);
          addPropAtGrid(room, 'cursed_chest', cursedGrid, 'Bloodbound Cursed Chest');
          break;
        }
        case 'shrine': {
          const nextShrine =
            shrineRotation.find((s) => !placedShrines.has(s)) ??
            rng.pick(shrineRotation);
          placedShrines.add(nextShrine);
          const sKey = nextShrine as 'shrine_heal' | 'shrine_power' | 'shrine_frenzy';
          const shrineGrid = this.findSafeRoomTile(room, tiles, occupied, 0, 0);
          addPropAtGrid(room, nextShrine, shrineGrid, shrineLabels[sKey]);
          break;
        }
        case 'trap': {
          trapRooms.push(room);
          const trapChestGrid = this.findSafeRoomTile(room, tiles, occupied, 0, 0);
          addPropAtGrid(room, 'chest', trapChestGrid, 'Gauntlet Spoils Chest');
          break;
        }
        case 'elite': {
          eliteRooms.push(room);
          const eliteChestGrid = this.findSafeRoomTile(room, tiles, occupied, 0, -2);
          addPropAtGrid(room, 'chest', eliteChestGrid, 'Champion Reliquary Chest');
          break;
        }
        case 'combat': {
          combatRooms.push(room);
          break;
        }
        default:
          break;
      }
    }

    // Ensure all 3 shrine flavors (heal, power, frenzy) exist across the floor
    const hostPool = [...combatRooms, ...eliteRooms, ...trapRooms];
    let hostCursor = 0;
    for (const sType of shrineRotation) {
      if (placedShrines.has(sType)) continue;
      const targetRoom = hostPool[hostCursor % Math.max(1, hostPool.length)] ?? spawnRoom;
      hostCursor += 1;
      const sKey = sType as 'shrine_heal' | 'shrine_power' | 'shrine_frenzy';
      const grid = this.findSafeRoomTile(targetRoom, tiles, occupied, -2, 2);
      addPropAtGrid(targetRoom, sType, grid, shrineLabels[sKey]);
      placedShrines.add(sType);
    }

    // Place the remaining 2 biome Lore Tomes in distinct chambers
    while (loreCursor < 3 && hostPool.length > 0) {
      const targetRoom = hostPool[hostCursor % hostPool.length];
      hostCursor += 1;
      const meta = nextLoreMeta();
      const grid = this.findSafeRoomTile(targetRoom, tiles, occupied, 2, 2);
      addPropAtGrid(targetRoom, 'lore_tome', grid, meta.label, meta.loreId);
    }

    // 4. Phase 3 Dynamic World Event Props: Corrupted Obelisk, Soul Lantern, Rift Breach
    const eventPool = hostPool.length > 0 ? hostPool : [spawnRoom];

    const obeliskRoom = eventPool[hostCursor % eventPool.length];
    hostCursor += 1;
    const obeliskGrid = this.findSafeRoomTile(obeliskRoom, tiles, occupied, 0, 0);
    addPropAtGrid(
      obeliskRoom,
      'corrupted_obelisk',
      obeliskGrid,
      'Corrupted Pact Obelisk',
    );

    const lanternRoom = eventPool[hostCursor % eventPool.length];
    hostCursor += 1;
    const lanternGrid = this.findSafeRoomTile(lanternRoom, tiles, occupied, 0, 2);
    addPropAtGrid(lanternRoom, 'soul_lantern', lanternGrid, 'Flickering Soul Lantern');

    const riftRoom = eventPool[hostCursor % eventPool.length];
    hostCursor += 1;
    const riftGrid = this.findSafeRoomTile(riftRoom, tiles, occupied, 0, -2);
    addPropAtGrid(riftRoom, 'rift_breach', riftGrid, 'Unstable Abyssal Rift Breach');

    return props;
  }

  private generateTorchPositions(
    tiles: TileType[][],
    cols: number,
    rows: number,
    rooms: readonly DungeonRoom[],
    bossRoom: DungeonRoom,
    navigator: DungeonSpatialNavigator,
    rng: SeededRng,
  ): Vec3[] {
    const torches: Vec3[] = [];
    const maxTorches = Math.min(58, Math.max(28, rooms.length * 4));

    const isFarEnough = (cand: Vec3, minDist: number): boolean => {
      const minSq = minDist * minDist;
      for (let i = 0; i < torches.length; i++) {
        const dx = torches[i].x - cand.x;
        const dz = torches[i].z - cand.z;
        if (dx * dx + dz * dz < minSq) {
          return false;
        }
      }
      return true;
    };

    const tryWallMountAt = (
      floorCol: number,
      floorRow: number,
      minSpacingWorld: number,
    ): boolean => {
      const fTile = tiles[floorRow]?.[floorCol];
      if (fTile !== 'floor' && fTile !== 'corridor' && fTile !== 'hazard_ice') {
        return false;
      }

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (tiles[floorRow + dr]?.[floorCol + dc] === 'door') {
            return false;
          }
        }
      }

      const dirs: Array<[number, number]> = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ];

      for (let d = 0; d < 4; d++) {
        const wc = floorCol + dirs[d][0];
        const wr = floorRow + dirs[d][1];
        if (tiles[wr]?.[wc] !== 'wall') continue;

        const floorWorld = navigator.gridToWorld(floorCol, floorRow);
        const wallWorld = navigator.gridToWorld(wc, wr);
        const torchPos: Vec3 = {
          x: floorWorld.x + (wallWorld.x - floorWorld.x) * 0.38,
          y: TORCH_HEIGHT_Y,
          z: floorWorld.z + (wallWorld.z - floorWorld.z) * 0.38,
        };

        if (isFarEnough(torchPos, minSpacingWorld)) {
          torches.push(torchPos);
          return true;
        }
      }
      return false;
    };

    // 1. Place ceremonial sconces around the Boss Arena perimeter first
    for (let c = bossRoom.x + 2; c <= bossRoom.x + bossRoom.width - 3; c += 4) {
      tryWallMountAt(c, bossRoom.y, 7.5);
      tryWallMountAt(c, bossRoom.y + bossRoom.height - 1, 7.5);
    }
    for (let r = bossRoom.y + 2; r <= bossRoom.y + bossRoom.height - 3; r += 4) {
      tryWallMountAt(bossRoom.x, r, 7.5);
      tryWallMountAt(bossRoom.x + bossRoom.width - 1, r, 7.5);
    }

    // 2. Place evenly spaced sconces along every other room's walls
    const roomOrder = [...rooms];
    shuffleInPlace(roomOrder, rng);

    for (let i = 0; i < roomOrder.length && torches.length < maxTorches; i++) {
      const r = roomOrder[i];
      if (r.id === bossRoom.id) continue;

      for (let c = r.x + 2; c <= r.x + r.width - 3 && torches.length < maxTorches; c += 4) {
        tryWallMountAt(c, r.y, 9.0);
        tryWallMountAt(c, r.y + r.height - 1, 9.0);
      }
      for (let row = r.y + 2; row <= r.y + r.height - 3 && torches.length < maxTorches; row += 4) {
        tryWallMountAt(r.x, row, 9.0);
        tryWallMountAt(r.x + r.width - 1, row, 9.0);
      }
    }

    // 3. Add occasional corridor torches along long hallways if budget remains
    for (let r = GRID_BORDER; r < rows - GRID_BORDER && torches.length < maxTorches; r += 5) {
      for (let c = GRID_BORDER; c < cols - GRID_BORDER && torches.length < maxTorches; c += 5) {
        if (tiles[r][c] === 'corridor') {
          tryWallMountAt(c, r, 11.0);
        }
      }
    }

    return torches;
  }
}

export function createDungeonGenerator(): IDungeonGenerator {
  return new DungeonGenerator();
}
