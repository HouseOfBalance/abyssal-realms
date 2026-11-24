import type { GridCoord, TileType, Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';

export function isTileWalkable(tile: TileType | undefined): boolean {
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

export function isDryWalkableTile(tile: TileType | undefined): boolean {
  return (
    tile === 'floor' ||
    tile === 'corridor' ||
    tile === 'door' ||
    tile === 'hazard_ice' ||
    tile === 'teleporter_pad'
  );
}

export function isPureDryFloorTile(tile: TileType | undefined): boolean {
  return tile === 'floor' || tile === 'corridor' || tile === 'door';
}

function getTilePenalty(tile: TileType): number {
  if (tile === 'hazard_lava' || tile === 'hazard_poison') {
    return 4.5;
  }
  if (tile === 'teleporter_pad') {
    return 1.6;
  }
  if (tile === 'hazard_ice') {
    return 1.1;
  }
  return 1.0;
}

class BinaryMinHeap {
  private nodes: Int32Array;
  private priorities: Float64Array;
  private count = 0;

  constructor(initialCapacity = 512) {
    this.nodes = new Int32Array(initialCapacity);
    this.priorities = new Float64Array(initialCapacity);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  push(node: number, priority: number): void {
    if (this.count >= this.nodes.length) {
      const nextCap = this.nodes.length * 2;
      const nextNodes = new Int32Array(nextCap);
      const nextPrio = new Float64Array(nextCap);
      nextNodes.set(this.nodes);
      nextPrio.set(this.priorities);
      this.nodes = nextNodes;
      this.priorities = nextPrio;
    }

    let idx = this.count++;
    this.nodes[idx] = node;
    this.priorities[idx] = priority;

    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.nodes[idx] = this.nodes[parent];
      this.priorities[idx] = this.priorities[parent];
      this.nodes[parent] = node;
      this.priorities[parent] = priority;
      idx = parent;
    }
  }

  pop(): number {
    const topNode = this.nodes[0];
    const lastIdx = --this.count;
    if (lastIdx > 0) {
      const movedNode = this.nodes[lastIdx];
      const movedPrio = this.priorities[lastIdx];
      let idx = 0;
      const half = lastIdx >> 1;
      while (idx < half) {
        let left = (idx << 1) + 1;
        const right = left + 1;
        if (right < lastIdx && this.priorities[right] < this.priorities[left]) {
          left = right;
        }
        if (movedPrio <= this.priorities[left]) break;
        this.nodes[idx] = this.nodes[left];
        this.priorities[idx] = this.priorities[left];
        idx = left;
      }
      this.nodes[idx] = movedNode;
      this.priorities[idx] = movedPrio;
    }
    return topNode;
  }
}

const DIR_COL = [0, 1, 0, -1, 1, 1, -1, -1] as const;
const DIR_ROW = [-1, 0, 1, 0, -1, 1, 1, -1] as const;
const DIR_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;

export class DungeonSpatialNavigator {
  private readonly cols: number;
  private readonly rows: number;
  private readonly tileSize: number;
  private readonly offsetX: number;
  private readonly offsetZ: number;
  private readonly tiles: TileType[][];

  private readonly heap: BinaryMinHeap;
  private readonly gScore: Float64Array;
  private readonly parent: Int32Array;
  private readonly seenStamp: Int32Array;
  private readonly closedStamp: Int32Array;
  private currentStamp = 1;

  constructor(cols: number, rows: number, tileSize: number, tiles: TileType[][]) {
    this.cols = cols;
    this.rows = rows;
    this.tileSize = tileSize;
    this.offsetX = -cols * tileSize * 0.5;
    this.offsetZ = -rows * tileSize * 0.5;
    this.tiles = tiles;

    const total = cols * rows;
    this.heap = new BinaryMinHeap(Math.min(2048, total));
    this.gScore = new Float64Array(total);
    this.parent = new Int32Array(total);
    this.seenStamp = new Int32Array(total);
    this.closedStamp = new Int32Array(total);
  }

  worldToGrid(worldPos: Vec3): GridCoord {
    const rawCol = Number.isFinite(worldPos.x)
      ? Math.floor((worldPos.x - this.offsetX) / this.tileSize)
      : 0;
    const rawRow = Number.isFinite(worldPos.z)
      ? Math.floor((worldPos.z - this.offsetZ) / this.tileSize)
      : 0;
    return {
      col: clamp(rawCol, 0, this.cols - 1),
      row: clamp(rawRow, 0, this.rows - 1),
    };
  }

  gridToWorld(col: number, row: number): Vec3 {
    return {
      x: this.offsetX + (col + 0.5) * this.tileSize,
      y: 0,
      z: this.offsetZ + (row + 0.5) * this.tileSize,
    };
  }

  isWalkableGrid(col: number, row: number): boolean {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return false;
    }
    return isTileWalkable(this.tiles[row][col]);
  }

  /**
   * Exact Circle-vs-Tile-AABB walkability check in world XZ space.
   */
  isWalkableWorld(x: number, z: number, radius = 0): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return false;
    }
    const r = Number.isFinite(radius) && radius > 0 ? radius : 0;

    if (r === 0) {
      const col = Math.floor((x - this.offsetX) / this.tileSize);
      const row = Math.floor((z - this.offsetZ) / this.tileSize);
      return this.isWalkableGrid(col, row);
    }

    const minWorldX = this.offsetX;
    const maxWorldX = this.offsetX + this.cols * this.tileSize;
    const minWorldZ = this.offsetZ;
    const maxWorldZ = this.offsetZ + this.rows * this.tileSize;

    if (x - r < minWorldX || x + r > maxWorldX || z - r < minWorldZ || z + r > maxWorldZ) {
      return false;
    }

    const minCol = Math.floor((x - r - this.offsetX) / this.tileSize);
    const maxCol = Math.floor((x + r - this.offsetX) / this.tileSize);
    const minRow = Math.floor((z - r - this.offsetZ) / this.tileSize);
    const maxRow = Math.floor((z + r - this.offsetZ) / this.tileSize);

    if (minCol < 0 || maxCol >= this.cols || minRow < 0 || maxRow >= this.rows) {
      return false;
    }

    const rSq = r * r - 1e-9;
    for (let row = minRow; row <= maxRow; row++) {
      const rowTiles = this.tiles[row];
      const tileMinZ = this.offsetZ + row * this.tileSize;
      const tileMaxZ = tileMinZ + this.tileSize;
      for (let col = minCol; col <= maxCol; col++) {
        if (!isTileWalkable(rowTiles[col])) {
          const tileMinX = this.offsetX + col * this.tileSize;
          const tileMaxX = tileMinX + this.tileSize;
          const closestX = clamp(x, tileMinX, tileMaxX);
          const closestZ = clamp(z, tileMinZ, tileMaxZ);
          const dx = x - closestX;
          const dz = z - closestZ;
          if (dx * dx + dz * dz < rSq) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private resolveNearestWalkable(worldPos: Vec3): GridCoord | null {
    const rawCol = Math.floor((worldPos.x - this.offsetX) / this.tileSize);
    const rawRow = Math.floor((worldPos.z - this.offsetZ) / this.tileSize);

    if (this.isWalkableGrid(rawCol, rawRow)) {
      return { col: rawCol, row: rawRow };
    }

    // Rescue positions slightly touching an adjacent wall face (within 1 tile)
    let best: GridCoord | null = null;
    let bestDistSq = Infinity;
    const maxSnapDistSq = this.tileSize * this.tileSize * 1.25;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = rawCol + dc;
        const nr = rawRow + dr;
        if (!this.isWalkableGrid(nc, nr)) continue;
        const center = this.gridToWorld(nc, nr);
        const dx = center.x - worldPos.x;
        const dz = center.z - worldPos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq <= maxSnapDistSq && dSq < bestDistSq) {
          bestDistSq = dSq;
          best = { col: nc, row: nr };
        }
      }
    }

    return best;
  }

  private octileHeuristic(colA: number, rowA: number, colB: number, rowB: number): number {
    const dx = Math.abs(colA - colB);
    const dy = Math.abs(rowA - rowB);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  /**
   * Binary-heap 8-directional A* pathfinder with corner-cutting prevention
   * and radius-aware string-pulling / waypoint smoothing.
   */
  findPath(fromWorld: Vec3, toWorld: Vec3, maxSteps?: number): Vec3[] {
    if (
      !fromWorld ||
      !toWorld ||
      !Number.isFinite(fromWorld.x) ||
      !Number.isFinite(fromWorld.z) ||
      !Number.isFinite(toWorld.x) ||
      !Number.isFinite(toWorld.z)
    ) {
      return [];
    }

    const start = this.resolveNearestWalkable(fromWorld);
    const goal = this.resolveNearestWalkable(toWorld);
    if (!start || !goal) {
      return [];
    }

    const goalExactWalkable = this.isWalkableWorld(toWorld.x, toWorld.z, 0.2);
    const finalGoalWorld: Vec3 = goalExactWalkable
      ? { x: toWorld.x, y: 0, z: toWorld.z }
      : this.gridToWorld(goal.col, goal.row);

    if (start.col === goal.col && start.row === goal.row) {
      return [finalGoalWorld];
    }

    const totalCells = this.cols * this.rows;
    const hasStepCap = maxSteps !== undefined && Number.isFinite(maxSteps) && maxSteps > 0;
    const stepCap = hasStepCap ? Math.max(1, Math.ceil(maxSteps!)) : totalCells;
    const expansionLimit = hasStepCap
      ? Math.min(totalCells, Math.max(512, stepCap * 16))
      : totalCells;

    if (this.currentStamp >= 0x7ffffff0) {
      this.seenStamp.fill(0);
      this.closedStamp.fill(0);
      this.currentStamp = 1;
    }
    const stamp = ++this.currentStamp;

    this.heap.clear();
    const startIdx = start.row * this.cols + start.col;
    const goalIdx = goal.row * this.cols + goal.col;

    this.seenStamp[startIdx] = stamp;
    this.gScore[startIdx] = 0;
    this.parent[startIdx] = -1;

    const initialH = this.octileHeuristic(start.col, start.row, goal.col, goal.row);
    this.heap.push(startIdx, initialH);

    let bestNodeIdx = startIdx;
    let bestH = initialH;
    let reachedGoal = false;
    let expansions = 0;

    while (this.heap.size > 0) {
      const currentIdx = this.heap.pop();
      if (this.closedStamp[currentIdx] === stamp) {
        continue;
      }
      this.closedStamp[currentIdx] = stamp;

      if (currentIdx === goalIdx) {
        reachedGoal = true;
        break;
      }

      expansions += 1;
      if (expansions > expansionLimit) {
        break;
      }

      const cRow = Math.floor(currentIdx / this.cols);
      const cCol = currentIdx - cRow * this.cols;
      const baseG = this.gScore[currentIdx];

      for (let d = 0; d < 8; d++) {
        const nCol = cCol + DIR_COL[d];
        const nRow = cRow + DIR_ROW[d];
        if (nCol < 0 || nCol >= this.cols || nRow < 0 || nRow >= this.rows) {
          continue;
        }

        const nTile = this.tiles[nRow][nCol];
        if (!isTileWalkable(nTile)) {
          continue;
        }

        // Prevent diagonal corner cutting through solid wall corners
        if (d >= 4) {
          if (
            !isTileWalkable(this.tiles[cRow][nCol]) ||
            !isTileWalkable(this.tiles[nRow][cCol])
          ) {
            continue;
          }
        }

        const nIdx = nRow * this.cols + nCol;
        if (this.closedStamp[nIdx] === stamp) {
          continue;
        }

        const stepCost = DIR_COST[d] * getTilePenalty(nTile);
        const tentativeG = baseG + stepCost;

        if (this.seenStamp[nIdx] !== stamp || tentativeG < this.gScore[nIdx]) {
          this.seenStamp[nIdx] = stamp;
          this.gScore[nIdx] = tentativeG;
          this.parent[nIdx] = currentIdx;
          const h = this.octileHeuristic(nCol, nRow, goal.col, goal.row);
          if (h < bestH) {
            bestH = h;
            bestNodeIdx = nIdx;
          }
          this.heap.push(nIdx, tentativeG + h);
        }
      }
    }

    if (!reachedGoal) {
      // Only return a partial path if we hit an explicit `maxSteps` cap while making progress.
      // If the open set exhausted naturally, `toWorld` is genuinely unreachable -> return [].
      if (!hasStepCap || this.heap.size === 0 || bestNodeIdx === startIdx) {
        return [];
      }
    }

    const targetIdx = reachedGoal ? goalIdx : bestNodeIdx;
    const gridChain: GridCoord[] = [];
    let trace = targetIdx;
    while (trace !== -1) {
      const r = Math.floor(trace / this.cols);
      const c = trace - r * this.cols;
      gridChain.push({ col: c, row: r });
      trace = this.parent[trace];
    }
    gridChain.reverse();

    let truncated = false;
    if (hasStepCap && gridChain.length - 1 > stepCap) {
      gridChain.length = stepCap + 1;
      truncated = true;
    }

    const startWorldClean: Vec3 = this.isWalkableWorld(fromWorld.x, fromWorld.z, 0.2)
      ? { x: fromWorld.x, y: 0, z: fromWorld.z }
      : this.gridToWorld(start.col, start.row);

    const rawWaypoints: Vec3[] = new Array(gridChain.length);
    rawWaypoints[0] = startWorldClean;
    for (let i = 1; i < gridChain.length; i++) {
      rawWaypoints[i] = this.gridToWorld(gridChain[i].col, gridChain[i].row);
    }
    if (reachedGoal && !truncated) {
      rawWaypoints[rawWaypoints.length - 1] = finalGoalWorld;
    }

    const smoothed = this.smoothWaypoints(rawWaypoints, gridChain);
    // Drop the start anchor (`smoothed[0]`) so callers immediately steer toward the next waypoint
    return smoothed.length > 1 ? smoothed.slice(1) : [rawWaypoints[rawWaypoints.length - 1]];
  }

  private hasClearLineOfSight(
    a: Vec3,
    b: Vec3,
    allowHazards: boolean,
    clearanceRadius: number,
  ): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-5) return true;

    const sampleStep = this.tileSize * 0.22;
    const steps = Math.max(2, Math.ceil(dist / sampleStep));

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      if (!this.isWalkableWorld(px, pz, clearanceRadius)) {
        return false;
      }
      if (!allowHazards) {
        const col = Math.floor((px - this.offsetX) / this.tileSize);
        const row = Math.floor((pz - this.offsetZ) / this.tileSize);
        if (
          col < 0 ||
          col >= this.cols ||
          row < 0 ||
          row >= this.rows ||
          !isDryWalkableTile(this.tiles[row][col])
        ) {
          return false;
        }
      }
    }
    return true;
  }

  private smoothWaypoints(rawWaypoints: Vec3[], gridChain: GridCoord[]): Vec3[] {
    const len = rawWaypoints.length;
    if (len <= 2) {
      return this.subdivideLongSegments(rawWaypoints);
    }

    // O(N) prefix count of hazard tiles for O(1) span queries during string-pulling
    const hazardPrefix = new Int32Array(len + 1);
    for (let i = 0; i < len; i++) {
      const g = gridChain[i];
      const isHaz = isDryWalkableTile(this.tiles[g.row][g.col]) ? 0 : 1;
      hazardPrefix[i + 1] = hazardPrefix[i] + isHaz;
    }

    const baseClearance = this.tileSize * 0.26;
    const maxLookahead = 26;
    const smoothed: Vec3[] = [rawWaypoints[0]];
    let anchor = 0;

    while (anchor < len - 1) {
      let furthest = anchor + 1;
      const anchorPos = rawWaypoints[anchor];
      const anchorSafeForClearance = this.isWalkableWorld(
        anchorPos.x,
        anchorPos.z,
        baseClearance,
      );

      const upperProbe = Math.min(len - 1, anchor + maxLookahead);
      for (let probe = upperProbe; probe > anchor + 1; probe--) {
        const probePos = rawWaypoints[probe];
        const probeSafeForClearance = this.isWalkableWorld(
          probePos.x,
          probePos.z,
          baseClearance,
        );
        const clearance =
          anchorSafeForClearance && probeSafeForClearance ? baseClearance : 0.08;

        const spanTouchesHazard = hazardPrefix[probe + 1] - hazardPrefix[anchor] > 0;
        if (this.hasClearLineOfSight(anchorPos, probePos, spanTouchesHazard, clearance)) {
          furthest = probe;
          break;
        }
      }

      smoothed.push(rawWaypoints[furthest]);
      anchor = furthest;
    }

    return this.subdivideLongSegments(smoothed);
  }

  private subdivideLongSegments(points: Vec3[]): Vec3[] {
    const maxSegLen = this.tileSize * 7.5;
    const out: Vec3[] = [points[0]];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dx = curr.x - prev.x;
      const dz = curr.z - prev.z;
      const dist = Math.hypot(dx, dz);
      if (dist > maxSegLen) {
        const pieces = Math.ceil(dist / maxSegLen);
        for (let p = 1; p < pieces; p++) {
          const t = p / pieces;
          out.push({
            x: prev.x + dx * t,
            y: 0,
            z: prev.z + dz * t,
          });
        }
      }
      out.push(curr);
    }

    return out;
  }
}
