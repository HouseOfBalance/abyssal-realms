import type { Vec2 } from '../../contracts/types';
import { SeededRng } from '../../core/Constants';

export interface GraphEdge {
  u: number;
  v: number;
  weight: number;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
}

function edgeKey(u: number, v: number): string {
  return u < v ? `${u}:${v}` : `${v}:${u}`;
}

function circumcircleContains(
  pts: readonly Vec2[],
  tri: Triangle,
  p: Vec2,
): boolean {
  const ax = pts[tri.a].x;
  const ay = pts[tri.a].y;
  const bx = pts[tri.b].x;
  const by = pts[tri.b].y;
  const cx = pts[tri.c].x;
  const cy = pts[tri.c].y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) {
    return false;
  }

  const aSq = ax * ax + ay * ay;
  const bSq = bx * bx + by * by;
  const cSq = cx * cx + cy * cy;

  const ux = (aSq * (by - cy) + bSq * (cy - ay) + cSq * (ay - by)) / d;
  const uy = (aSq * (cx - bx) + bSq * (ax - cx) + cSq * (bx - ax)) / d;

  const rSq = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
  const distSq = (p.x - ux) * (p.x - ux) + (p.y - uy) * (p.y - uy);

  return distSq <= rSq + 1e-7;
}

/**
 * Computes Bowyer-Watson Delaunay triangulation edges over 2D room centers.
 * Falls back cleanly to all-pairs edges for < 3 or degenerate collinear point sets.
 */
export function buildDelaunayEdges(points: readonly Vec2[]): GraphEdge[] {
  const n = points.length;
  if (n <= 1) return [];
  if (n === 2) {
    const w = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    return [{ u: 0, v: 1, weight: w }];
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const dx = maxX - minX || 100;
  const dy = maxY - minY || 100;
  const deltaMax = Math.max(dx, dy) * 20;
  const midX = (minX + maxX) * 0.5;
  const midY = (minY + maxY) * 0.5;

  const allPoints: Vec2[] = [
    ...points,
    { x: midX - deltaMax, y: midY - deltaMax },
    { x: midX, y: midY + deltaMax * 2 },
    { x: midX + deltaMax * 2, y: midY - deltaMax },
  ];

  const superA = n;
  const superB = n + 1;
  const superC = n + 2;

  let triangles: Triangle[] = [{ a: superA, b: superB, c: superC }];

  for (let i = 0; i < n; i++) {
    const p = allPoints[i];
    const badTriangles: Triangle[] = [];
    const goodTriangles: Triangle[] = [];

    for (let t = 0; t < triangles.length; t++) {
      const tri = triangles[t];
      if (circumcircleContains(allPoints, tri, p)) {
        badTriangles.push(tri);
      } else {
        goodTriangles.push(tri);
      }
    }

    const polygonEdgeCounts = new Map<string, { u: number; v: number; count: number }>();
    const recordEdge = (u: number, v: number): void => {
      const key = edgeKey(u, v);
      const existing = polygonEdgeCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        polygonEdgeCounts.set(key, { u: Math.min(u, v), v: Math.max(u, v), count: 1 });
      }
    };

    for (let b = 0; b < badTriangles.length; b++) {
      const tri = badTriangles[b];
      recordEdge(tri.a, tri.b);
      recordEdge(tri.b, tri.c);
      recordEdge(tri.c, tri.a);
    }

    triangles = goodTriangles;
    for (const entry of polygonEdgeCounts.values()) {
      if (entry.count === 1) {
        triangles.push({ a: entry.u, b: entry.v, c: i });
      }
    }
  }

  const uniqueEdges = new Map<string, GraphEdge>();
  for (let t = 0; t < triangles.length; t++) {
    const tri = triangles[t];
    if (tri.a >= n || tri.b >= n || tri.c >= n) {
      continue;
    }
    const pairs: Array<[number, number]> = [
      [tri.a, tri.b],
      [tri.b, tri.c],
      [tri.c, tri.a],
    ];
    for (const [rawU, rawV] of pairs) {
      const u = Math.min(rawU, rawV);
      const v = Math.max(rawU, rawV);
      const key = `${u}:${v}`;
      if (!uniqueEdges.has(key)) {
        const w = Math.hypot(points[v].x - points[u].x, points[v].y - points[u].y);
        uniqueEdges.set(key, { u, v, weight: w });
      }
    }
  }

  // Ensure full graph connectivity even if input points were near-collinear:
  // supplement with complete graph edges if Delaunay yielded a disconnected set.
  const edges = Array.from(uniqueEdges.values());
  if (!isGraphConnected(n, edges)) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = `${i}:${j}`;
        if (!uniqueEdges.has(key)) {
          const w = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
          uniqueEdges.set(key, { u: i, v: j, weight: w });
        }
      }
    }
    return Array.from(uniqueEdges.values());
  }

  return edges;
}

class DisjointSet {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    let curr = x;
    while (curr !== root) {
      const next = this.parent[curr];
      this.parent[curr] = root;
      curr = next;
    }
    return root;
  }

  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra] += 1;
    }
    return true;
  }
}

function isGraphConnected(nodeCount: number, edges: readonly GraphEdge[]): boolean {
  if (nodeCount <= 1) return true;
  const ds = new DisjointSet(nodeCount);
  let components = nodeCount;
  for (let i = 0; i < edges.length; i++) {
    if (ds.union(edges[i].u, edges[i].v)) {
      components -= 1;
    }
  }
  return components === 1;
}

export interface DungeonGraphResult {
  mstEdges: GraphEdge[];
  loopEdges: GraphEdge[];
  allEdges: GraphEdge[];
  adjacency: number[][];
}

/**
 * Builds Kruskal's MST from Delaunay edges and adds curated extra loop edges
 * so the dungeon has tactical flanking routes without cramped dead-end-only backtracking.
 */
export function buildMstAndLoops(
  nodeCount: number,
  candidateEdges: readonly GraphEdge[],
  rng: SeededRng,
  loopProbability = 0.28,
): DungeonGraphResult {
  const sorted = [...candidateEdges].sort((a, b) => {
    if (Math.abs(a.weight - b.weight) > 1e-6) return a.weight - b.weight;
    return a.u !== b.u ? a.u - b.u : a.v - b.v;
  });

  const ds = new DisjointSet(nodeCount);
  const mstEdges: GraphEdge[] = [];
  const unusedEdges: GraphEdge[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const edge = sorted[i];
    if (ds.union(edge.u, edge.v)) {
      mstEdges.push(edge);
    } else {
      unusedEdges.push(edge);
    }
  }

  // Prefer short-to-medium non-MST Delaunay edges so loop corridors stay natural
  const avgMstWeight =
    mstEdges.length > 0
      ? mstEdges.reduce((acc, e) => acc + e.weight, 0) / mstEdges.length
      : Infinity;
  const maxLoopWeight = avgMstWeight * 1.65;

  const loopEdges: GraphEdge[] = [];
  const maxExtraLoops = Math.max(1, Math.ceil(nodeCount * 0.25));

  for (let i = 0; i < unusedEdges.length && loopEdges.length < maxExtraLoops; i++) {
    const edge = unusedEdges[i];
    if (edge.weight <= maxLoopWeight && rng.chance(loopProbability)) {
      loopEdges.push(edge);
    }
  }

  if (loopEdges.length === 0 && unusedEdges.length > 0) {
    loopEdges.push(unusedEdges[0]);
  }

  const allEdges = [...mstEdges, ...loopEdges];
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  for (let i = 0; i < allEdges.length; i++) {
    const e = allEdges[i];
    adjacency[e.u].push(e.v);
    adjacency[e.v].push(e.u);
  }

  return { mstEdges, loopEdges, allEdges, adjacency };
}

/**
 * Dijkstra shortest-path distances from `sourceIdx` across weighted graph edges.
 */
export function computeGraphDistances(
  nodeCount: number,
  edges: readonly GraphEdge[],
  sourceIdx: number,
): Float64Array {
  const adj: Array<Array<{ to: number; weight: number }>> = Array.from(
    { length: nodeCount },
    () => [],
  );
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    adj[e.u].push({ to: e.v, weight: e.weight });
    adj[e.v].push({ to: e.u, weight: e.weight });
  }

  const dist = new Float64Array(nodeCount);
  dist.fill(Infinity);
  const visited = new Uint8Array(nodeCount);
  dist[sourceIdx] = 0;

  for (let step = 0; step < nodeCount; step++) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < nodeCount; i++) {
      if (!visited[i] && dist[i] < bestDist) {
        bestDist = dist[i];
        best = i;
      }
    }
    if (best === -1) break;
    visited[best] = 1;

    const neighbors = adj[best];
    for (let k = 0; k < neighbors.length; k++) {
      const next = neighbors[k];
      const cand = bestDist + next.weight;
      if (cand < dist[next.to]) {
        dist[next.to] = cand;
      }
    }
  }

  return dist;
}
