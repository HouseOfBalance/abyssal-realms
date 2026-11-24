import type {
  BiomeId,
  DamageType,
  DungeonFloorData,
  DungeonRoom,
  GridCoord,
  HazardInstance,
  TileType,
  Vec3,
} from '../../contracts/types';
import { distXZ, SeededRng } from '../../core/Constants';

export type HazardArchetype =
  | HazardInstance['kind']
  | 'frost_gale'
  | 'astral_laser';

export interface PlannedHazardSpec {
  id: string;
  kind: HazardInstance['kind'];
  archetype: HazardArchetype;
  position: Vec3;
  radius: number;
  rotationY: number;
  phaseOffset: number;
  element?: Extract<DamageType, 'lightning' | 'void'>;
  scaleVar: number;
}

const ARCHETYPE_RADII: Record<HazardArchetype, number> = {
  spike_trap: 1.05,
  pendulum_blade: 2.05,
  poison_vent: 1.55,
  lava_pool: 1.65,
  arcane_turret: 3.8,
  frost_gale: 2.35,
  astral_laser: 3.85,
  breakable_barrel: 0.55,
  breakable_urn: 0.45,
};

function archetypeToPublicKind(archetype: HazardArchetype): HazardInstance['kind'] {
  if (archetype === 'frost_gale') return 'poison_vent';
  if (archetype === 'astral_laser') return 'arcane_turret';
  return archetype;
}

function isWalkableTileType(t: TileType): boolean {
  return (
    t === 'floor' ||
    t === 'corridor' ||
    t === 'door' ||
    t === 'hazard_lava' ||
    t === 'hazard_poison' ||
    t === 'hazard_ice' ||
    t === 'teleporter_pad'
  );
}

function createTileReader(floor: DungeonFloorData): (col: number, row: number) => TileType {
  const { tiles, cols, rows } = floor;
  if (!tiles || tiles.length === 0) {
    return (col: number, row: number): TileType => {
      if (col < 0 || col >= cols || row < 0 || row >= rows) return 'void';
      const w = floor.gridToWorld(col, row);
      return floor.isWalkableWorld(w.x, w.z) ? 'floor' : 'wall';
    };
  }

  let rowMajor = true;
  if (tiles.length === rows && tiles[0]?.length === cols) {
    if (rows === cols) {
      let rowMajorMatches = 0;
      let colMajorMatches = 0;
      const stepC = Math.max(1, Math.floor(cols / 5));
      const stepR = Math.max(1, Math.floor(rows / 5));
      for (let r = 0; r < rows; r += stepR) {
        for (let c = 0; c < cols; c += stepC) {
          const w = floor.gridToWorld(c, r);
          const walkable = floor.isWalkableWorld(w.x, w.z);
          if (isWalkableTileType(tiles[r]?.[c] ?? 'void') === walkable) rowMajorMatches++;
          if (isWalkableTileType(tiles[c]?.[r] ?? 'void') === walkable) colMajorMatches++;
        }
      }
      rowMajor = rowMajorMatches >= colMajorMatches;
    } else {
      rowMajor = true;
    }
  } else if (tiles.length === cols && tiles[0]?.length === rows) {
    rowMajor = false;
  }

  return (col: number, row: number): TileType => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return 'void';
    if (rowMajor) {
      return tiles[row]?.[col] ?? 'void';
    }
    return tiles[col]?.[row] ?? 'void';
  };
}

interface RoomGridBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

function getRoomGridBounds(floor: DungeonFloorData, room: DungeonRoom): RoomGridBounds {
  const gridCenterDiffX = Math.abs(room.x + room.width * 0.5 - room.centerGrid.col);
  const gridCenterDiffY = Math.abs(room.y + room.height * 0.5 - room.centerGrid.row);

  if (gridCenterDiffX <= 3 && gridCenterDiffY <= 3) {
    return {
      minCol: Math.max(0, Math.floor(room.x)),
      maxCol: Math.min(floor.cols - 1, Math.ceil(room.x + room.width) - 1),
      minRow: Math.max(0, Math.floor(room.y)),
      maxRow: Math.min(floor.rows - 1, Math.ceil(room.y + room.height) - 1),
    };
  }

  const c1 = floor.worldToGrid({
    x: room.centerWorld.x - room.width * 0.5,
    y: 0,
    z: room.centerWorld.z - room.height * 0.5,
  });
  const c2 = floor.worldToGrid({
    x: room.centerWorld.x + room.width * 0.5,
    y: 0,
    z: room.centerWorld.z + room.height * 0.5,
  });

  return {
    minCol: Math.max(0, Math.min(c1.col, c2.col)),
    maxCol: Math.min(floor.cols - 1, Math.max(c1.col, c2.col)),
    minRow: Math.max(0, Math.min(c1.row, c2.row)),
    maxRow: Math.min(floor.rows - 1, Math.max(c1.row, c2.row)),
  };
}

function isDestructibleArchetype(a: HazardArchetype): boolean {
  return a === 'breakable_barrel' || a === 'breakable_urn';
}

function pickBiomeTrapPool(biome: BiomeId): HazardArchetype[] {
  switch (biome) {
    case 'sanctuary':
      return [];
    case 'crypt':
      return ['spike_trap', 'spike_trap', 'pendulum_blade', 'arcane_turret', 'poison_vent'];
    case 'caverns':
      return ['poison_vent', 'poison_vent', 'spike_trap', 'pendulum_blade', 'arcane_turret'];
    case 'forge':
      return ['lava_pool', 'lava_pool', 'pendulum_blade', 'spike_trap', 'arcane_turret'];
    case 'void':
      return ['arcane_turret', 'arcane_turret', 'lava_pool', 'pendulum_blade', 'spike_trap'];
    case 'cathedral':
      return ['frost_gale', 'frost_gale', 'frost_gale', 'spike_trap', 'pendulum_blade'];
    case 'observatory':
      return ['astral_laser', 'astral_laser', 'astral_laser', 'arcane_turret', 'pendulum_blade'];
    case 'colosseum':
      return ['spike_trap', 'lava_pool'];
  }
}

export function planFloorHazards(floor: DungeonFloorData): PlannedHazardSpec[] {
  // Peaceful Sanctuary Hub has zero damaging traps
  if (floor.biome === 'sanctuary') {
    return [];
  }

  const rng = new SeededRng((floor.seed ^ 0x48415a52 ^ (floor.floorNumber * 7919)) >>> 0);
  const getTile = createTileReader(floor);
  const planned: PlannedHazardSpec[] = [];
  let nextId = 1;
  let turretCounter = 0;

  // Collect teleporter pads so traps/props never obstruct warp landings
  const teleporterWorldPositions: Vec3[] = [];
  for (let r = 0; r < floor.rows; r++) {
    for (let c = 0; c < floor.cols; c++) {
      if (getTile(c, r) === 'teleporter_pad') {
        teleporterWorldPositions.push(floor.gridToWorld(c, r));
      }
    }
  }

  // Build room ownership lookup so we can distinguish corridor cells from room cells
  const roomBoundsMap = new Map<string, RoomGridBounds>();
  const cellRoomMap = new Map<number, DungeonRoom>();
  for (const room of floor.rooms) {
    const b = getRoomGridBounds(floor, room);
    roomBoundsMap.set(room.id, b);
    for (let r = b.minRow; r <= b.maxRow; r++) {
      for (let c = b.minCol; c <= b.maxCol; c++) {
        cellRoomMap.set(r * floor.cols + c, room);
      }
    }
  }

  const isColosseum = floor.biome === 'colosseum';

  const canPlaceAt = (
    pos: Vec3,
    archetype: HazardArchetype,
    customMinTrapSpacing?: number,
  ): boolean => {
    const destructible = isDestructibleArchetype(archetype);

    // Keep spawn, boss arena center, portal, teleporter pads, and interactables safely clear
    if (distXZ(pos, floor.playerSpawn) < (destructible ? 3.0 : 4.6)) return false;
    if (distXZ(pos, floor.bossSpawn) < (destructible ? 4.2 : isColosseum ? 11.0 : 6.2)) {
      return false;
    }
    if (distXZ(pos, floor.portalPosition) < (destructible ? 3.0 : 4.0)) return false;

    for (const tp of teleporterWorldPositions) {
      if (distXZ(pos, tp) < 2.6) return false;
    }

    for (const prop of floor.interactables) {
      if (distXZ(pos, prop.position) < (destructible ? 2.2 : 2.8)) return false;
    }

    const g = floor.worldToGrid(pos);
    const tile = getTile(g.col, g.row);
    if (tile === 'teleporter_pad') return false;

    const onHazardTile =
      tile === 'hazard_lava' || tile === 'hazard_poison' || tile === 'hazard_ice';
    if (!onHazardTile && !floor.isWalkableWorld(pos.x, pos.z, destructible ? 0.25 : 0.35)) {
      return false;
    }

    // Never place damaging traps inside spawn or standard boss rooms (Colosseum uses outer ring)
    const ownerRoom = cellRoomMap.get(g.row * floor.cols + g.col);
    if (
      !destructible &&
      ownerRoom &&
      (ownerRoom.type === 'spawn' || (!isColosseum && ownerRoom.type === 'boss'))
    ) {
      return false;
    }

    for (const other of planned) {
      const d = distXZ(pos, other.position);
      const otherDestructible = isDestructibleArchetype(other.archetype);
      if (destructible && otherDestructible) {
        if (d < 0.92) return false;
      } else if (destructible || otherDestructible) {
        if (d < 1.65) return false;
      } else {
        const minSpacing = customMinTrapSpacing ?? 2.85;
        if (d < minSpacing) return false;
      }
    }

    return true;
  };

  const addHazard = (
    archetype: HazardArchetype,
    pos: Vec3,
    rotationY = 0,
    phaseOffset?: number,
    minTrapSpacing?: number,
  ): boolean => {
    const worldPos: Vec3 = { x: pos.x, y: 0, z: pos.z };
    if (!canPlaceAt(worldPos, archetype, minTrapSpacing)) return false;

    const kind = archetypeToPublicKind(archetype);
    const destructible = isDestructibleArchetype(archetype);

    let element: Extract<DamageType, 'lightning' | 'void'> | undefined;
    if (archetype === 'arcane_turret') {
      if (floor.biome === 'void') {
        element = turretCounter % 3 === 1 ? 'lightning' : 'void';
      } else {
        element = turretCounter % 2 === 0 ? 'lightning' : 'void';
      }
      turretCounter++;
    }

    planned.push({
      id: `hazard_${floor.floorNumber}_${nextId++}`,
      kind,
      archetype,
      position: worldPos,
      radius: ARCHETYPE_RADII[archetype],
      rotationY,
      phaseOffset: phaseOffset ?? rng.range(0, Math.PI * 2),
      element,
      scaleVar: destructible ? rng.range(0.88, 1.14) : 1.0,
    });
    return true;
  };

  const collectRoomCells = (
    room: DungeonRoom,
  ): { interior: GridCoord[]; edges: GridCoord[] } => {
    const b = roomBoundsMap.get(room.id) ?? getRoomGridBounds(floor, room);
    const interior: GridCoord[] = [];
    const edges: GridCoord[] = [];

    for (let r = b.minRow; r <= b.maxRow; r++) {
      for (let c = b.minCol; c <= b.maxCol; c++) {
        const t = getTile(c, r);
        if (!isWalkableTileType(t) || t === 'teleporter_pad') continue;

        const n = getTile(c, r - 1);
        const s = getTile(c, r + 1);
        const w = getTile(c - 1, r);
        const e = getTile(c + 1, r);

        const touchesWall =
          n === 'wall' ||
          n === 'void' ||
          s === 'wall' ||
          s === 'void' ||
          w === 'wall' ||
          w === 'void' ||
          e === 'wall' ||
          e === 'void';
        const touchesExit =
          n === 'corridor' ||
          n === 'door' ||
          s === 'corridor' ||
          s === 'door' ||
          w === 'corridor' ||
          w === 'door' ||
          e === 'corridor' ||
          e === 'door';

        if (touchesWall) {
          if (!touchesExit) {
            edges.push({ col: c, row: r });
          }
        } else if (!touchesExit) {
          interior.push({ col: c, row: r });
        }
      }
    }

    return { interior, edges };
  };

  const scatterBreakablesOnEdges = (edges: GridCoord[], targetCount: number): void => {
    if (edges.length === 0) return;
    let placedCount = 0;
    for (let attempt = 0; attempt < targetCount * 5 && placedCount < targetCount; attempt++) {
      const anchor = rng.pick(edges);
      const basePos = floor.gridToWorld(anchor.col, anchor.row);
      const archetype: HazardArchetype = rng.chance(0.52)
        ? 'breakable_barrel'
        : 'breakable_urn';
      const jitterPos: Vec3 = {
        x: basePos.x + rng.range(-0.35, 0.35),
        y: 0,
        z: basePos.z + rng.range(-0.35, 0.35),
      };
      if (addHazard(archetype, jitterPos, rng.range(0, Math.PI * 2))) {
        placedCount++;
        if (placedCount < targetCount && rng.chance(0.45)) {
          const companionArchetype: HazardArchetype = rng.chance(0.5)
            ? 'breakable_urn'
            : 'breakable_barrel';
          const angle = rng.range(0, Math.PI * 2);
          const companionPos: Vec3 = {
            x: jitterPos.x + Math.cos(angle) * 1.05,
            y: 0,
            z: jitterPos.z + Math.sin(angle) * 1.05,
          };
          if (addHazard(companionArchetype, companionPos, rng.range(0, Math.PI * 2))) {
            placedCount++;
          }
        }
      }
    }
  };

  // Special handling for Colosseum arena: outer perimeter breakables + subtle perimeter grates
  if (isColosseum) {
    const allEdges: GridCoord[] = [];
    for (let r = 1; r < floor.rows - 1; r++) {
      for (let c = 1; c < floor.cols - 1; c++) {
        if (!isWalkableTileType(getTile(c, r))) continue;
        if (
          !isWalkableTileType(getTile(c - 1, r)) ||
          !isWalkableTileType(getTile(c + 1, r)) ||
          !isWalkableTileType(getTile(c, r - 1)) ||
          !isWalkableTileType(getTile(c, r + 1))
        ) {
          allEdges.push({ col: c, row: r });
        }
      }
    }
    scatterBreakablesOnEdges(allEdges, 8);
    for (let i = 0; i < 16 && allEdges.length > 0; i++) {
      const cell = rng.pick(allEdges);
      if (addHazard('spike_trap', floor.gridToWorld(cell.col, cell.row), 0, undefined, 9.0)) {
        if (planned.filter((p) => !isDestructibleArchetype(p.archetype)).length >= 3) break;
      }
    }
    return planned;
  }

  // Pass A: Honor explicit hazard_lava / hazard_poison / cathedral hazard_ice tiles
  let tileHazardsPlaced = 0;
  let iceGalesPlaced = 0;
  for (let r = 1; r < floor.rows - 1 && tileHazardsPlaced < 10; r++) {
    for (let c = 1; c < floor.cols - 1 && tileHazardsPlaced < 10; c++) {
      const t = getTile(c, r);
      if (t === 'hazard_lava' || t === 'hazard_poison') {
        const w = floor.gridToWorld(c, r);
        const archetype: HazardArchetype = t === 'hazard_lava' ? 'lava_pool' : 'poison_vent';
        if (addHazard(archetype, w, 0, rng.range(0, 3.4), 3.3)) {
          tileHazardsPlaced++;
        }
      } else if (t === 'hazard_ice' && floor.biome === 'cathedral' && iceGalesPlaced < 6) {
        const w = floor.gridToWorld(c, r);
        if (addHazard('frost_gale', w, 0, rng.range(0, 3.6), 5.8)) {
          iceGalesPlaced++;
        }
      }
    }
  }

  // Pass B & C & D: Populate rooms according to room archetype & biome
  const biomePool = pickBiomeTrapPool(floor.biome);

  for (const room of floor.rooms) {
    const { interior, edges } = collectRoomCells(room);

    if (room.type === 'trap') {
      const centerpieceArchetype: HazardArchetype =
        floor.biome === 'observatory'
          ? 'astral_laser'
          : floor.biome === 'cathedral'
            ? 'frost_gale'
            : 'arcane_turret';
      addHazard(centerpieceArchetype, room.centerWorld, rng.range(0, Math.PI), rng.range(0, 4.0), 3.0);

      // Pendulum Blade across room axis
      const pendRot = room.width <= room.height ? 0 : Math.PI * 0.5;
      for (let i = 0; i < 6 && interior.length > 0; i++) {
        const cell = rng.pick(interior);
        if (addHazard('pendulum_blade', floor.gridToWorld(cell.col, cell.row), pendRot, rng.range(0, 3.1), 3.2)) {
          break;
        }
      }

      // Rhythmic Spike Trap or Observatory Laser / Cathedral Frost Gale gauntlets
      let spikesPlaced = 0;
      for (let i = 0; i < 14 && spikesPlaced < 3 && interior.length > 0; i++) {
        const cell = rng.pick(interior);
        if (
          addHazard(
            'spike_trap',
            floor.gridToWorld(cell.col, cell.row),
            0,
            spikesPlaced * 1.12,
            2.15,
          )
        ) {
          spikesPlaced++;
        }
      }

      // Biome-signature AoE / laser emitter
      const secondarySpecial: HazardArchetype =
        floor.biome === 'cathedral'
          ? 'frost_gale'
          : floor.biome === 'observatory'
            ? 'astral_laser'
            : floor.biome === 'forge' || (floor.biome === 'void' && rng.chance(0.5))
              ? 'lava_pool'
              : 'poison_vent';

      for (let i = 0; i < 8 && interior.length > 0; i++) {
        const cell = rng.pick(interior);
        if (
          addHazard(
            secondarySpecial,
            floor.gridToWorld(cell.col, cell.row),
            rng.range(0, Math.PI),
            rng.range(0, 3.6),
            3.2,
          )
        ) {
          break;
        }
      }

      scatterBreakablesOnEdges(edges, rng.int(3, 5));
    } else if (
      room.type === 'combat' ||
      room.type === 'elite' ||
      room.type === 'cursed_event'
    ) {
      const trapBudget =
        room.type === 'combat'
          ? Math.min(3, 1 + Math.floor(floor.floorNumber * 0.5) + (interior.length > 30 ? 1 : 0))
          : 1 + (rng.chance(0.5) ? 1 : 0);

      let placedInRoom = 0;
      for (
        let attempt = 0;
        attempt < trapBudget * 6 && placedInRoom < trapBudget && interior.length > 0 && biomePool.length > 0;
        attempt++
      ) {
        const cell = rng.pick(interior);
        const archetype = rng.pick(biomePool);
        const rot =
          archetype === 'pendulum_blade'
            ? rng.chance(0.5)
              ? 0
              : Math.PI * 0.5
            : archetype === 'astral_laser'
              ? rng.range(0, Math.PI)
              : 0;
        if (addHazard(archetype, floor.gridToWorld(cell.col, cell.row), rot, undefined, 3.3)) {
          placedInRoom++;
        }
      }

      scatterBreakablesOnEdges(edges, rng.int(3, 6));
    } else if (room.type === 'treasure' || room.type === 'shrine') {
      scatterBreakablesOnEdges(edges, rng.int(2, 4));
    }
  }

  // Pass E: Corridors — orient pendulum blades across passages + biome corridor hazards & edge props
  interface CorridorCandidate {
    col: number;
    row: number;
    orientationY: number | null;
    touchesWall: boolean;
  }

  const corridorCandidates: CorridorCandidate[] = [];
  for (let r = 2; r < floor.rows - 2; r++) {
    for (let c = 2; c < floor.cols - 2; c++) {
      const t = getTile(c, r);
      const inRoom = cellRoomMap.has(r * floor.cols + c);
      if (t !== 'corridor' && (inRoom || t !== 'floor')) continue;

      const wallWest = !isWalkableTileType(getTile(c - 1, r)) || !isWalkableTileType(getTile(c - 2, r));
      const wallEast = !isWalkableTileType(getTile(c + 1, r)) || !isWalkableTileType(getTile(c + 2, r));
      const wallNorth = !isWalkableTileType(getTile(c, r - 1)) || !isWalkableTileType(getTile(c, r - 2));
      const wallSouth = !isWalkableTileType(getTile(c, r + 1)) || !isWalkableTileType(getTile(c, r + 2));

      const openNS = isWalkableTileType(getTile(c, r - 1)) && isWalkableTileType(getTile(c, r + 1));
      const openEW = isWalkableTileType(getTile(c - 1, r)) && isWalkableTileType(getTile(c + 1, r));

      let orientationY: number | null = null;
      if (wallWest && wallEast && openNS) {
        orientationY = 0;
      } else if (wallNorth && wallSouth && openEW) {
        orientationY = Math.PI * 0.5;
      }

      const touchesWall =
        !isWalkableTileType(getTile(c - 1, r)) ||
        !isWalkableTileType(getTile(c + 1, r)) ||
        !isWalkableTileType(getTile(c, r - 1)) ||
        !isWalkableTileType(getTile(c, r + 1));

      corridorCandidates.push({ col: c, row: r, orientationY, touchesWall });
    }
  }

  if (corridorCandidates.length > 0) {
    const alignedCorridors = corridorCandidates.filter((cc) => cc.orientationY !== null);
    const corridorTrapTarget = Math.min(5, 2 + Math.floor(floor.floorNumber * 0.6));
    let corridorTraps = 0;

    for (let attempt = 0; attempt < 28 && corridorTraps < corridorTrapTarget; attempt++) {
      const usePendulum = alignedCorridors.length > 0 && rng.chance(0.55);
      const cand = usePendulum ? rng.pick(alignedCorridors) : rng.pick(corridorCandidates);
      const pos = floor.gridToWorld(cand.col, cand.row);

      let archetype: HazardArchetype = usePendulum ? 'pendulum_blade' : 'spike_trap';
      if (!usePendulum && floor.biome === 'cathedral' && rng.chance(0.45)) {
        archetype = 'frost_gale';
      } else if (!usePendulum && floor.biome === 'observatory' && rng.chance(0.45)) {
        archetype = 'astral_laser';
      }

      const rot = cand.orientationY ?? 0;
      if (addHazard(archetype, pos, rot, undefined, 7.5)) {
        corridorTraps++;
      }
    }

    const wallCorridors = corridorCandidates
      .filter((cc) => cc.touchesWall)
      .map((cc) => ({ col: cc.col, row: cc.row }));
    scatterBreakablesOnEdges(wallCorridors, rng.int(3, 5));
  }

  // Pass F: Ensure core & biome-signature hazard variety is present
  const fallbackCells: GridCoord[] = [];
  for (const room of floor.rooms) {
    if (room.type === 'spawn' || room.type === 'boss') continue;
    const { interior, edges } = collectRoomCells(room);
    fallbackCells.push(...interior, ...edges);
  }
  for (const cc of corridorCandidates) {
    fallbackCells.push({ col: cc.col, row: cc.row });
  }

  const countArchetype = (a: HazardArchetype): number =>
    planned.filter((p) => p.archetype === a).length;

  const ensurePresent: HazardArchetype[] =
    floor.biome === 'cathedral'
      ? ['frost_gale', 'spike_trap', 'pendulum_blade', 'breakable_barrel', 'breakable_urn']
      : floor.biome === 'observatory'
        ? ['astral_laser', 'spike_trap', 'pendulum_blade', 'breakable_barrel', 'breakable_urn']
        : [
            'spike_trap',
            'pendulum_blade',
            floor.biome === 'forge' ? 'lava_pool' : 'poison_vent',
            'arcane_turret',
            'breakable_barrel',
            'breakable_urn',
          ];

  for (const archetype of ensurePresent) {
    if (countArchetype(archetype) > 0 || fallbackCells.length === 0) continue;
    for (let attempt = 0; attempt < 24; attempt++) {
      const cell = rng.pick(fallbackCells);
      const pos = floor.gridToWorld(cell.col, cell.row);
      if (addHazard(archetype, pos, 0, undefined, 2.5)) {
        break;
      }
    }
  }

  return planned;
}
