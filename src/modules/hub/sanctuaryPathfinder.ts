import type { GridCoord, TileType, Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';

export function isSanctuaryTileWalkable(tile: TileType | undefined): boolean {
  return (
    tile === 'floor' ||
    tile === 'corridor' ||
    tile === 'door' ||
    tile === 'teleporter_pad'
  );
}

class BinaryMinHeap {
  private nodes: Int32Array;
  private priorities: Float64Array;
  private count = 0;

  constructor(capacity = 512) {
    this.nodes = new Int32Array(capacity);
    this.priorities = new Float64Array(capacity);
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
    const top = this.nodes[0];
    const lastIdx = --this.count;
    if (lastIdx > 0) {
      const movedNode = this.nodes[lastIdx];
      const movedPrio = this.priorities[lastIdx];
      let idx = 0;
      const half = lastIdx >> 1;
      while (idx < half) {
        let child = (idx << 1) + 1;
        const right = child + 1;
        if (right < lastIdx && this.priorities[right] < this.priorities[child]) {
          child = right;
        }
        if (movedPrio <= this.priorities[child]) break;
        this.nodes[idx] = this.nodes[child];
        this.priorities[idx] = this.priorities[child];
        idx = child;
      }
      this.nodes[idx] = movedNode;
      this.priorities[idx] = movedPrio;
    }
    return top;
  }
}

const DIR_COL = [0, 1, 0, -1, 1, 1, -1, -1] as const;
const DIR_ROW = [-1, 0, 1, 0, -1, 1, 1, -1] as const;
const DIR_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;

export class SanctuaryNavigator {
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
    this.heap = new BinaryMinHeap(Math.min(1024, total));
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
    return isSanctuaryTileWalkable(this.tiles[row][col]);
  }

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
        if (!isSanctuaryTileWalkable(rowTiles[col])) {
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

    let best: GridCoord | null = null;
    let bestDistSq = Infinity;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = rawCol + dc;
        const nr = rawRow + dr;
        if (!this.isWalkableGrid(nc, nr)) continue;
        const center = this.gridToWorld(nc, nr);
        const dx = center.x - worldPos.x;
        const dz = center.z - worldPos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
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

  private hasClearLineOfSight(from: Vec3, to: Vec3, clearanceRadius = 0.35): boolean {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return true;
    const steps = Math.max(2, Math.ceil(dist / (this.tileSize * 0.35)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = from.x + dx * t;
      const sz = from.z + dz * t;
      if (!this.isWalkableWorld(sx, sz, clearanceRadius)) {
        return false;
      }
    }
    return true;
  }

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
      ? Math.min(totalCells, Math.max(256, stepCap * 16))
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

    this.gScore[startIdx] = 0;
    this.parent[startIdx] = -1;
    this.seenStamp[startIdx] = stamp;
    this.heap.push(
      startIdx,
      this.octileHeuristic(start.col, start.row, goal.col, goal.row),
    );

    let bestNode = startIdx;
    let bestHeuristic = this.octileHeuristic(start.col, start.row, goal.col, goal.row);
    let expanded = 0;
    let reachedGoal = false;

    while (this.heap.size > 0 && expanded < expansionLimit) {
      const current = this.heap.pop();
      if (this.closedStamp[current] === stamp) continue;
      this.closedStamp[current] = stamp;

      if (current === goalIdx) {
        reachedGoal = true;
        bestNode = goalIdx;
        break;
      }

      expanded++;
      const curRow = Math.floor(current / this.cols);
      const curCol = current - curRow * this.cols;
      const curG = this.gScore[current];

      for (let d = 0; d < 8; d++) {
        const nc = curCol + DIR_COL[d];
        const nr = curRow + DIR_ROW[d];
        if (!this.isWalkableGrid(nc, nr)) continue;

        // Prevent diagonal corner cutting past wall corners
        if (d >= 4) {
          if (!this.isWalkableGrid(curCol + DIR_COL[d], curRow)) continue;
          if (!this.isWalkableGrid(curCol, curRow + DIR_ROW[d])) continue;
        }

        const nIdx = nr * this.cols + nc;
        if (this.closedStamp[nIdx] === stamp) continue;

        const tentativeG = curG + DIR_COST[d];
        if (this.seenStamp[nIdx] !== stamp || tentativeG < this.gScore[nIdx]) {
          this.seenStamp[nIdx] = stamp;
          this.gScore[nIdx] = tentativeG;
          this.parent[nIdx] = current;
          const h = this.octileHeuristic(nc, nr, goal.col, goal.row);
          if (h < bestHeuristic) {
            bestHeuristic = h;
            bestNode = nIdx;
          }
          this.heap.push(nIdx, tentativeG + h);
        }
      }
    }

    const targetIdx = reachedGoal ? goalIdx : bestNode;
    if (targetIdx === startIdx) {
      return [];
    }

    const chain: Vec3[] = [];
    let trace = targetIdx;
    while (trace !== -1 && trace !== startIdx) {
      if (trace === goalIdx && reachedGoal) {
        chain.push(finalGoalWorld);
      } else {
        const r = Math.floor(trace / this.cols);
        const c = trace - r * this.cols;
        chain.push(this.gridToWorld(c, r));
      }
      trace = this.parent[trace];
    }
    chain.reverse();

    const cappedChain = hasStepCap && chain.length > stepCap ? chain.slice(0, stepCap) : chain;
    if (cappedChain.length <= 2) {
      return cappedChain;
    }

    // String-pull / smooth waypoints where clear radius-checked line-of-sight exists
    const startOrigin: Vec3 = this.isWalkableWorld(fromWorld.x, fromWorld.z, 0.35)
      ? { x: fromWorld.x, y: 0, z: fromWorld.z }
      : this.gridToWorld(start.col, start.row);

    const smoothed: Vec3[] = [];
    let anchor = startOrigin;
    let idx = 0;

    while (idx < cappedChain.length) {
      let furthest = idx;
      for (let probe = cappedChain.length - 1; probe > idx; probe--) {
        if (this.hasClearLineOfSight(anchor, cappedChain[probe], 0.35)) {
          furthest = probe;
          break;
        }
      }
      const chosen = cappedChain[furthest];
      smoothed.push(chosen);
      anchor = chosen;
      idx = furthest + 1;
    }

    return smoothed;
  }
}
