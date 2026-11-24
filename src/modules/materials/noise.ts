import { clamp } from '../../core/Constants';

export interface WorleySample {
  f1: number;
  f2: number;
  edge: number;
  cellId: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Fast deterministic integer hash returning float in [0, 1).
 */
export function hash2D(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function posMod(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

function quinticFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function hexToRgb(hex: number): RgbColor {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}

export function mixRgb(a: RgbColor, b: RgbColor, t: number, out?: RgbColor): RgbColor {
  const k = clamp01(t);
  const target = out ?? { r: 0, g: 0, b: 0 };
  target.r = a.r + (b.r - a.r) * k;
  target.g = a.g + (b.g - a.g) * k;
  target.b = a.b + (b.b - a.b) * k;
  return target;
}

/**
 * Seamlessly tileable 2D value noise over [0, 1) x [0, 1) with integer period.
 */
export function periodicNoise(u: number, v: number, period: number, seed: number): number {
  const p = Math.max(1, Math.round(period));
  const gx = u * p;
  const gy = v * p;
  const ix0 = Math.floor(gx);
  const iy0 = Math.floor(gy);
  const tx = quinticFade(gx - ix0);
  const ty = quinticFade(gy - iy0);

  const x0 = posMod(ix0, p);
  const y0 = posMod(iy0, p);
  const x1 = (x0 + 1) % p;
  const y1 = (y0 + 1) % p;

  const n00 = hash2D(x0, y0, seed);
  const n10 = hash2D(x1, y0, seed);
  const n01 = hash2D(x0, y1, seed);
  const n11 = hash2D(x1, y1, seed);

  const nx0 = n00 + (n10 - n00) * tx;
  const nx1 = n01 + (n11 - n01) * tx;
  return nx0 + (nx1 - nx0) * ty;
}

/**
 * Seamlessly tileable multi-octave Fractal Brownian Motion in [0, 1].
 */
export function periodicFbm(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed: number,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = Math.max(1, Math.round(basePeriod));

  for (let i = 0; i < octaves; i++) {
    sum += amp * periodicNoise(u, v, period, seed + i * 1013);
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  return norm > 0 ? sum / norm : 0.5;
}

/**
 * Seamlessly tileable ridged multifractal turbulence in [0, 1].
 * Great for molten veins, marble/void filaments, lightning cracks, and demon sinew.
 */
export function periodicRidged(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = Math.max(1, Math.round(basePeriod));

  for (let i = 0; i < octaves; i++) {
    const n = periodicNoise(u, v, period, seed + i * 2719);
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += amp * ridge * ridge;
    norm += amp;
    amp *= 0.52;
    period *= 2;
  }
  return norm > 0 ? clamp01(sum / norm) : 0;
}

/**
 * Seamlessly tileable 2D Worley / Voronoi cellular noise over [0, 1) x [0, 1).
 */
export function periodicWorley(
  u: number,
  v: number,
  cellsPerAxis: number,
  jitter: number,
  seed: number,
): WorleySample {
  const c = Math.max(1, Math.round(cellsPerAxis));
  const gx = (u - Math.floor(u)) * c;
  const gy = (v - Math.floor(v)) * c;
  const icx = Math.floor(gx);
  const icy = Math.floor(gy);

  let d1 = 1e9;
  let d2 = 1e9;
  let bestId = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ncx = posMod(icx + dx, c);
      const ncy = posMod(icy + dy, c);
      const jx = (hash2D(ncx, ncy, seed) - 0.5) * jitter;
      const jy = (hash2D(ncx, ncy, seed + 7919) - 0.5) * jitter;
      const px = icx + dx + 0.5 + jx;
      const py = icy + dy + 0.5 + jy;

      const diffX = gx - px;
      const diffY = gy - py;
      const dist = Math.hypot(diffX, diffY);

      if (dist < d1) {
        d2 = d1;
        d1 = dist;
        bestId = hash2D(ncx, ncy, seed + 31337);
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }

  return {
    f1: clamp(d1, 0, 1.5),
    f2: clamp(d2, 0, 2.0),
    edge: clamp01(d2 - d1),
    cellId: bestId,
  };
}

/**
 * Signed distance from point (px, py) to 2D line segment (ax, ay) -> (bx, by).
 */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-9) return Math.hypot(wx, wy);
  const t = clamp01((wx * vx + wy * vy) / lenSq);
  const projX = ax + t * vx;
  const projY = ay + t * vy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Shared pre-baked tileable basis fields so all 21 PBR recipes synthesize rapidly
 * with rich multi-scale noise, cellular Voronoi fracture patterns, and domain warping.
 */
export class TileableBasis {
  readonly size: number;
  readonly mask: number;
  readonly fbmCoarse: Float32Array;
  readonly fbmMed: Float32Array;
  readonly fbmFine: Float32Array;
  readonly ridged: Float32Array;
  readonly worley6F1: Float32Array;
  readonly worley6Edge: Float32Array;
  readonly worley6Id: Float32Array;
  readonly worley12F1: Float32Array;
  readonly worley12Edge: Float32Array;
  readonly worley12Id: Float32Array;

  constructor(size: number) {
    // Enforce power-of-two size for fast bitwise wrapping
    const pow2 = 1 << Math.round(Math.log2(Math.max(16, size)));
    this.size = pow2;
    this.mask = pow2 - 1;

    const total = pow2 * pow2;
    this.fbmCoarse = new Float32Array(total);
    this.fbmMed = new Float32Array(total);
    this.fbmFine = new Float32Array(total);
    this.ridged = new Float32Array(total);
    this.worley6F1 = new Float32Array(total);
    this.worley6Edge = new Float32Array(total);
    this.worley6Id = new Float32Array(total);
    this.worley12F1 = new Float32Array(total);
    this.worley12Edge = new Float32Array(total);
    this.worley12Id = new Float32Array(total);

    const inv = 1 / pow2;
    let idx = 0;
    for (let y = 0; y < pow2; y++) {
      const v = y * inv;
      for (let x = 0; x < pow2; x++) {
        const u = x * inv;
        this.fbmCoarse[idx] = periodicFbm(u, v, 3, 4, 101);
        this.fbmMed[idx] = periodicFbm(u, v, 7, 4, 509);
        this.fbmFine[idx] = periodicFbm(u, v, 18, 3, 1409);
        this.ridged[idx] = periodicRidged(u, v, 5, 4, 2903);

        const w6 = periodicWorley(u, v, 6, 0.85, 4211);
        this.worley6F1[idx] = w6.f1;
        this.worley6Edge[idx] = w6.edge;
        this.worley6Id[idx] = w6.cellId;

        const w12 = periodicWorley(u, v, 12, 0.85, 8807);
        this.worley12F1[idx] = w12.f1;
        this.worley12Edge[idx] = w12.edge;
        this.worley12Id[idx] = w12.cellId;

        idx++;
      }
    }
  }

  /**
   * Seamlessly wrapped bilinear sample from any pre-baked field at normalized (u, v).
   */
  sample(field: Float32Array, u: number, v: number): number {
    const s = this.size;
    const m = this.mask;
    const gx = u * s;
    const gy = v * s;
    const ix0 = Math.floor(gx);
    const iy0 = Math.floor(gy);
    const tx = gx - ix0;
    const ty = gy - iy0;

    const x0 = ix0 & m;
    const y0 = iy0 & m;
    const x1 = (ix0 + 1) & m;
    const y1 = (iy0 + 1) & m;

    const row0 = y0 * s;
    const row1 = y1 * s;
    const v00 = field[row0 + x0];
    const v10 = field[row0 + x1];
    const v01 = field[row1 + x0];
    const v11 = field[row1 + x1];

    const vx0 = v00 + (v10 - v00) * tx;
    const vx1 = v01 + (v11 - v01) * tx;
    return vx0 + (vx1 - vx0) * ty;
  }

  /**
   * Nearest-texel wrapped lookup for cell IDs (avoids blurring discrete stone/crystal IDs).
   */
  sampleNearest(field: Float32Array, u: number, v: number): number {
    const s = this.size;
    const m = this.mask;
    const x = Math.floor(u * s) & m;
    const y = Math.floor(v * s) & m;
    return field[y * s + x];
  }
}
