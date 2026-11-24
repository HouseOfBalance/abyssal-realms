import type { MaterialKey } from '../../contracts/types';
import {
  clamp01,
  distToSegment,
  hash2D,
  hexToRgb,
  mix,
  mixRgb,
  smoothstep,
  type RgbColor,
  type TileableBasis,
} from './noise';

export interface SynthesizedBuffers {
  size: number;
  colorData: Uint8ClampedArray;
  bumpData: Uint8ClampedArray;
  roughnessData: Uint8ClampedArray;
  emissiveData?: Uint8ClampedArray;
}

export interface MaterialPbrConfig {
  roughness: number;
  metalness: number;
  bumpScale: number;
  emissiveHex?: number;
  emissiveIntensity?: number;
  envMapIntensity?: number;
  repeatX?: number;
  repeatY?: number;
}

export interface MaterialSynthesisResult {
  buffers: SynthesizedBuffers;
  pbr: MaterialPbrConfig;
}

export const ALL_MATERIAL_KEYS: readonly MaterialKey[] = [
  'floor_sanctuary',
  'floor_crypt',
  'floor_caverns',
  'floor_forge',
  'floor_void',
  'floor_cathedral',
  'floor_observatory',
  'floor_colosseum',
  'wall_stone',
  'wall_obsidian',
  'metal_steel',
  'metal_gold',
  'metal_dark_iron',
  'brass_clockwork',
  'wood_oak',
  'rune_glow_blue',
  'rune_glow_crimson',
  'rune_glow_emerald',
  'rune_glow_void',
  'crystal_cyan',
  'ice_glacier',
  'mythic_crimson',
  'bone',
  'flesh_demon',
  'cloth_crimson',
  'cloth_shadow',
  'cloth_arcane',
  'lava_emissive',
] as const;

type Segment2D = readonly [number, number, number, number];

// Four distinct Elder-inspired arcane glyph stroke sets in normalized cell coords [0, 1]^2
const RUNE_GLYPHS: readonly (readonly Segment2D[])[] = [
  // Glyph 0: Shattered Crown / Algiz-Othala ward
  [
    [0.5, 0.16, 0.5, 0.84],
    [0.5, 0.44, 0.28, 0.22],
    [0.5, 0.44, 0.72, 0.22],
    [0.34, 0.62, 0.5, 0.48],
    [0.66, 0.62, 0.5, 0.48],
    [0.34, 0.62, 0.5, 0.78],
    [0.66, 0.62, 0.5, 0.78],
  ],
  // Glyph 1: Blood & Flame Sowilo-Tiwaz sigil
  [
    [0.32, 0.22, 0.68, 0.22],
    [0.5, 0.18, 0.5, 0.84],
    [0.28, 0.38, 0.5, 0.20],
    [0.72, 0.38, 0.5, 0.20],
    [0.32, 0.56, 0.68, 0.44],
    [0.32, 0.56, 0.68, 0.70],
  ],
  // Glyph 2: Venom / Emerald Berkano-Ingwaz bindrune
  [
    [0.38, 0.18, 0.38, 0.82],
    [0.38, 0.20, 0.66, 0.36],
    [0.66, 0.36, 0.38, 0.50],
    [0.38, 0.50, 0.68, 0.66],
    [0.68, 0.66, 0.38, 0.82],
    [0.26, 0.50, 0.52, 0.50],
  ],
  // Glyph 3: Astral Void Dagaz-Hagalaz nexus
  [
    [0.30, 0.22, 0.70, 0.78],
    [0.70, 0.22, 0.30, 0.78],
    [0.30, 0.22, 0.30, 0.78],
    [0.70, 0.22, 0.70, 0.78],
    [0.50, 0.14, 0.50, 0.86],
  ],
];

const runeFieldCache = new WeakMap<TileableBasis, Float32Array>();

function getRuneGlyphField(basis: TileableBasis): Float32Array {
  const cached = runeFieldCache.get(basis);
  if (cached) return cached;

  const size = basis.size;
  const field = new Float32Array(size * size);
  const inv = 1 / size;

  let idx = 0;
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      const u = x * inv;

      // 2x2 arcane sigil grid so tiled surfaces display varied runes
      const gx = u * 2;
      const gy = v * 2;
      const cellX = Math.floor(gx) & 1;
      const cellY = Math.floor(gy) & 1;
      const lx = gx - Math.floor(gx);
      const ly = gy - Math.floor(gy);

      const glyphIdx = (cellY * 2 + cellX) & 3;
      const segments = RUNE_GLYPHS[glyphIdx];

      let minDist = 1e9;
      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        const d = distToSegment(lx, ly, seg[0], seg[1], seg[2], seg[3]);
        if (d < minDist) minDist = d;
      }

      // Concentric arcane ward circle + inner diamond ring
      const radial = Math.hypot(lx - 0.5, ly - 0.5);
      const outerRing = Math.abs(radial - 0.41);
      const innerRing = Math.abs(radial - 0.35);
      const ringDist = Math.min(outerRing, innerRing * 1.25);

      const glyphCore = 1 - smoothstep(0.014, 0.046, minDist);
      const glyphHalo = (1 - smoothstep(0.02, 0.14, minDist)) * 0.45;
      const ringCore = (1 - smoothstep(0.009, 0.032, ringDist)) * 0.85;

      field[idx++] = clamp01(Math.max(glyphCore, ringCore) + glyphHalo);
    }
  }

  runeFieldCache.set(basis, field);
  return field;
}

function writePixel(
  buf: Uint8ClampedArray,
  pixelIndex: number,
  r: number,
  g: number,
  b: number,
): void {
  const o = pixelIndex * 4;
  buf[o] = Math.round(clamp01(r) * 255);
  buf[o + 1] = Math.round(clamp01(g) * 255);
  buf[o + 2] = Math.round(clamp01(b) * 255);
  buf[o + 3] = 255;
}

function writeGray(buf: Uint8ClampedArray, pixelIndex: number, v: number): void {
  const byte = Math.round(clamp01(v) * 255);
  const o = pixelIndex * 4;
  buf[o] = byte;
  buf[o + 1] = byte;
  buf[o + 2] = byte;
  buf[o + 3] = 255;
}

function createBuffers(size: number, withEmissive: boolean): SynthesizedBuffers {
  const byteLen = size * size * 4;
  return {
    size,
    colorData: new Uint8ClampedArray(byteLen),
    bumpData: new Uint8ClampedArray(byteLen),
    roughnessData: new Uint8ClampedArray(byteLen),
    emissiveData: withEmissive ? new Uint8ClampedArray(byteLen) : undefined,
  };
}

/**
 * Evaluates staggered stone block / masonry grid with domain-warped organic mortar edges.
 */
function evalStoneMasonry(
  u: number,
  v: number,
  cols: number,
  rows: number,
  warpX: number,
  warpY: number,
  mortarWidth: number,
  seed: number,
): { mortarMask: number; bevel: number; blockTint: number; blockTilt: number } {
  const wu = u + warpX;
  const wv = v + warpY;

  const ry = wv * rows;
  const rowIdx = Math.floor(ry);
  const localY = ry - rowIdx;

  const rowWrapped = ((rowIdx % rows) + rows) % rows;
  const stagger = (rowWrapped & 1) * 0.5 + (hash2D(rowWrapped, 17, seed) - 0.5) * 0.14;

  const rx = wu * cols + stagger;
  const colIdx = Math.floor(rx);
  const localX = rx - colIdx;
  const colWrapped = ((colIdx % cols) + cols) % cols;

  // Distance to nearest mortar seam in normalized cell space
  const edgeX = Math.min(localX, 1 - localX);
  const edgeY = Math.min(localY, 1 - localY) * (cols / rows);
  const edgeDist = Math.min(edgeX, edgeY);

  const mortarMask = 1 - smoothstep(mortarWidth * 0.45, mortarWidth, edgeDist);
  const bevel = smoothstep(mortarWidth * 0.4, mortarWidth * 2.4, edgeDist);
  const blockTint = hash2D(colWrapped, rowWrapped, seed + 911);
  const blockTilt = (localX - 0.5) * (hash2D(colWrapped, rowWrapped, seed + 2203) - 0.5) * 0.18;

  return { mortarMask, bevel, blockTint, blockTilt };
}

function synthesizeRuneMaterial(
  basis: TileableBasis,
  stoneDarkHex: number,
  stoneLightHex: number,
  glowOuterHex: number,
  glowCoreHex: number,
  emissiveHex: number,
  emissiveIntensity: number,
  uvShiftU: number,
  uvShiftV: number,
): MaterialSynthesisResult {
  const size = basis.size;
  const buffers = createBuffers(size, true);
  const emissiveBuf = buffers.emissiveData!;
  const runeField = getRuneGlyphField(basis);

  const stoneDark = hexToRgb(stoneDarkHex);
  const stoneLight = hexToRgb(stoneLightHex);
  const glowOuter = hexToRgb(glowOuterHex);
  const glowCore = hexToRgb(glowCoreHex);
  const tmpA: RgbColor = { r: 0, g: 0, b: 0 };
  const tmpB: RgbColor = { r: 0, g: 0, b: 0 };

  const inv = 1 / size;
  let i = 0;
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      const u = x * inv;

      const fMed = basis.fbmMed[i];
      const fFine = basis.fbmFine[i];
      const ridge = basis.ridged[i];

      const ru = u + uvShiftU + (fMed - 0.5) * 0.012;
      const rv = v + uvShiftV + (fFine - 0.5) * 0.012;
      const glyph = basis.sample(runeField, ru, rv);

      // Crackling arcane ley-filaments so every UV patch carries unmistakable glow
      const leyVein = Math.pow(basis.sample(basis.ridged, u * 1.5 + uvShiftU, v * 1.5 + uvShiftV), 2.2);
      const energy = clamp01(Math.max(glyph, leyVein * 0.72) + 0.28 * fMed);
      const hotCore = smoothstep(0.62, 0.96, Math.max(glyph, leyVein * 0.82));

      // Albedo blends carved dark runestone into luminous arcane core
      mixRgb(stoneDark, stoneLight, fMed * 0.65 + fFine * 0.35, tmpA);
      mixRgb(glowOuter, glowCore, hotCore, tmpB);
      mixRgb(tmpA, tmpB, clamp01(energy * 0.88 + 0.12), tmpA);

      writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

      // Engraved rune channels recessed into stone
      const height = clamp01(0.72 + fFine * 0.18 + ridge * 0.1 - glyph * 0.48);
      writeGray(buffers.bumpData, i, height);

      // Glowing channels are glassy smooth; carved stone rim is rougher
      const rough = clamp01(0.95 - energy * 0.38 + fFine * 0.08);
      writeGray(buffers.roughnessData, i, rough);

      // High baseline aura (0.52+) peaking at 1.0 on glyphs so both tiny eye/inlay meshes
      // and large shrine/portal surfaces bloom dramatically
      const emitStrength = clamp01(0.50 + energy * 0.50);
      mixRgb(glowOuter, glowCore, hotCore * 0.75, tmpB);
      writePixel(
        emissiveBuf,
        i,
        tmpB.r * emitStrength,
        tmpB.g * emitStrength,
        tmpB.b * emitStrength,
      );

      i++;
    }
  }

  return {
    buffers,
    pbr: {
      roughness: 0.42,
      metalness: 0.14,
      bumpScale: 0.36,
      emissiveHex,
      emissiveIntensity,
      envMapIntensity: 1.1,
    },
  };
}

export function synthesizeMaterialByKey(
  key: MaterialKey,
  basis: TileableBasis,
): MaterialSynthesisResult {
  const size = basis.size;
  const inv = 1 / size;
  const tmpA: RgbColor = { r: 0, g: 0, b: 0 };
  const tmpB: RgbColor = { r: 0, g: 0, b: 0 };

  switch (key) {
    case 'floor_crypt': {
      const buffers = createBuffers(size, false);
      const slateA = hexToRgb(0x373e4f);
      const slateB = hexToRgb(0x4b5366);
      const mortarCol = hexToRgb(0x161922);
      const mossCol = hexToRgb(0x283d32);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];
          const crack = smoothstep(0.82, 0.96, basis.ridged[i]);

          const stone = evalStoneMasonry(
            u,
            v,
            3,
            4,
            (med - 0.5) * 0.025,
            (coarse - 0.5) * 0.025,
            0.055,
            101,
          );

          const shade = clamp01(stone.blockTint * 0.55 + med * 0.30 + fine * 0.15);
          mixRgb(slateA, slateB, shade, tmpA);

          // Hairline fracture darkening
          const crackFactor = crack * (1 - stone.mortarMask) * 0.35;
          tmpA.r *= 1 - crackFactor;
          tmpA.g *= 1 - crackFactor;
          tmpA.b *= 1 - crackFactor;

          // Damp crypt moss in crevices and mortar edges
          const mossMask = smoothstep(0.56, 0.82, coarse) * (stone.mortarMask * 0.7 + (1 - stone.bevel) * 0.5);
          mixRgb(tmpA, mossCol, mossMask * 0.65, tmpA);
          mixRgb(tmpA, mortarCol, stone.mortarMask * 0.88, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(
            stone.bevel * (0.68 + med * 0.16 + fine * 0.12 + stone.blockTilt) -
              crackFactor * 0.45 +
              stone.mortarMask * 0.08,
          );
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.76 + fine * 0.18 + stone.mortarMask * 0.14 - mossMask * 0.12);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.84, metalness: 0.04, bumpScale: 0.42 },
      };
    }

    case 'floor_caverns': {
      const buffers = createBuffers(size, false);
      const shaleDark = hexToRgb(0x232e28);
      const shaleLight = hexToRgb(0x3f5246);
      const venomMoss = hexToRgb(0x2f6e3b);
      const puddleCol = hexToRgb(0x14221b);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          // Warped cellular cavern rock slabs
          const wu = u + (med - 0.5) * 0.07;
          const wv = v + (coarse - 0.5) * 0.07;
          const cellEdge = basis.sample(basis.worley6Edge, wu, wv);
          const cellId = basis.sampleNearest(basis.worley6Id, wu, wv);
          const fineEdge = basis.worley12Edge[i];

          const fissure = 1 - smoothstep(0.03, 0.14, cellEdge);
          const rockHeight = smoothstep(0.02, 0.28, cellEdge) * (0.62 + med * 0.24 + fineEdge * 0.14);

          mixRgb(shaleDark, shaleLight, clamp01(cellId * 0.45 + med * 0.4 + fine * 0.2), tmpA);

          // Blighted moss colonies along damp rock rims
          const moss = smoothstep(0.48, 0.78, coarse) * (1 - fissure) * smoothstep(0.35, 0.08, cellEdge);
          mixRgb(tmpA, venomMoss, moss * 0.72, tmpA);

          // Wet subterranean fissures/puddles
          const wetPuddle = clamp01(fissure * 0.85 + smoothstep(0.72, 0.90, 1 - coarse) * 0.4);
          mixRgb(tmpA, puddleCol, wetPuddle * 0.78, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);
          writeGray(buffers.bumpData, i, clamp01(rockHeight * (1 - fissure * 0.75)));

          // Puddles & damp crevices are glossy wet (lower roughness), rock tops are rough
          const rough = clamp01(0.92 - wetPuddle * 0.52 + fine * 0.08);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.74, metalness: 0.05, bumpScale: 0.50 },
      };
    }

    case 'floor_forge': {
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const basaltDark = hexToRgb(0x221c1b);
      const slagIron = hexToRgb(0x463631);
      const rustAsh = hexToRgb(0x693824);
      const emberCore = hexToRgb(0xff6b1a);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          const wu = u + (med - 0.5) * 0.03;
          const wv = v + (coarse - 0.5) * 0.03;
          const edge = basis.sample(basis.worley6Edge, wu, wv);
          const cellId = basis.sampleNearest(basis.worley6Id, wu, wv);

          const crack = 1 - smoothstep(0.018, 0.085, edge);
          const emberMask = crack * smoothstep(0.32, 0.72, coarse + med * 0.35);
          const plateBevel = smoothstep(0.02, 0.18, edge);

          mixRgb(basaltDark, slagIron, clamp01(cellId * 0.5 + med * 0.35 + fine * 0.15), tmpA);
          const scorchRim = (1 - smoothstep(0.04, 0.22, edge)) * (1 - crack);
          mixRgb(tmpA, rustAsh, scorchRim * 0.55, tmpA);
          mixRgb(tmpA, emberCore, emberMask * 0.85, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(plateBevel * (0.72 + fine * 0.20) - crack * 0.65);
          writeGray(buffers.bumpData, i, h);

          // Metallic iron-slag plates have medium roughness; soot cracks are matte
          const rough = clamp01(0.72 + (1 - plateBevel) * 0.22 + fine * 0.10 - cellId * 0.12);
          writeGray(buffers.roughnessData, i, rough);

          const emit = emberMask * emberMask;
          writePixel(emissiveBuf, i, emit, emit * 0.42, emit * 0.08);
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.76,
          metalness: 0.24,
          bumpScale: 0.48,
          emissiveHex: 0xff5212,
          emissiveIntensity: 0.95,
        },
      };
    }

    case 'floor_void': {
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const voidObsidian = hexToRgb(0x1b152b);
      const astralMarble = hexToRgb(0x382959);
      const goldTrim = hexToRgb(0x7c6240);
      const riftGlow = hexToRgb(0xd06bff);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];
          const ridge = basis.ridged[i];

          // Ceremonial diagonal sanctum tiles
          const du = (u + v) * 2;
          const dv = (u - v + 2) * 2;
          const fx = Math.abs(du - Math.floor(du) - 0.5) * 2;
          const fy = Math.abs(dv - Math.floor(dv) - 0.5) * 2;
          const tileEdge = Math.max(fx, fy);
          const seam = smoothstep(0.91, 0.985, tileEdge);
          const trimInlay = smoothstep(0.84, 0.89, tileEdge) * (1 - smoothstep(0.89, 0.93, tileEdge));

          // Swirling astral nebula marble + eldritch rift veins
          const swirl = basis.sample(basis.ridged, u + med * 0.14, v + coarse * 0.14);
          const riftMask = smoothstep(0.80, 0.96, swirl) * (1 - seam * 0.6);

          mixRgb(voidObsidian, astralMarble, clamp01(swirl * 0.65 + med * 0.35), tmpA);
          mixRgb(tmpA, goldTrim, trimInlay * 0.65, tmpA);
          mixRgb(tmpA, riftGlow, riftMask * 0.8, tmpA);
          tmpA.r *= 1 - seam * 0.55;
          tmpA.g *= 1 - seam * 0.55;
          tmpA.b *= 1 - seam * 0.55;

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.78 - seam * 0.58 + trimInlay * 0.10 + fine * 0.08 - riftMask * 0.22);
          writeGray(buffers.bumpData, i, h);

          // Polished sanctum stone with rough fracture seams
          const rough = clamp01(0.62 + seam * 0.32 + fine * 0.12 - trimInlay * 0.2 + (1 - ridge) * 0.08);
          writeGray(buffers.roughnessData, i, rough);

          const emit = riftMask * 0.95;
          writePixel(emissiveBuf, i, emit * 0.78, emit * 0.30, emit);
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.46,
          metalness: 0.18,
          bumpScale: 0.36,
          emissiveHex: 0xb14aed,
          emissiveIntensity: 0.90,
        },
      };
    }

    case 'wall_stone': {
      const buffers = createBuffers(size, false);
      const stoneCool = hexToRgb(0x434957);
      const stoneWarm = hexToRgb(0x5c5852);
      const mortarDark = hexToRgb(0x1a1c22);
      const grimeCol = hexToRgb(0x252a26);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          const masonry = evalStoneMasonry(
            u,
            v,
            3,
            6,
            (med - 0.5) * 0.022,
            (fine - 0.5) * 0.016,
            0.065,
            404,
          );

          mixRgb(stoneCool, stoneWarm, clamp01(masonry.blockTint * 0.7 + coarse * 0.3), tmpA);

          // Pitted granite speckles + vertical damp streaks
          const streak = basis.sample(basis.fbmMed, u * 3, v * 0.5);
          const pitting = (fine - 0.5) * 0.18;
          tmpA.r = clamp01(tmpA.r + pitting);
          tmpA.g = clamp01(tmpA.g + pitting);
          tmpA.b = clamp01(tmpA.b + pitting);

          mixRgb(tmpA, grimeCol, smoothstep(0.55, 0.85, streak) * 0.38, tmpA);
          mixRgb(tmpA, mortarDark, masonry.mortarMask * 0.90, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(
            masonry.bevel * (0.66 + med * 0.18 + fine * 0.16 + masonry.blockTilt) * (1 - masonry.mortarMask * 0.85),
          );
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.82 + fine * 0.14 + masonry.mortarMask * 0.10);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.88, metalness: 0.03, bumpScale: 0.52 },
      };
    }

    case 'wall_obsidian': {
      const buffers = createBuffers(size, false);
      const obsDeep = hexToRgb(0x12101c);
      const obsViolet = hexToRgb(0x2d2445);
      const obsEdge = hexToRgb(0x524678);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];
          const ridge = basis.ridged[i];

          // Sharp fractured obsidian facets + conchoidal shell ripples
          const cellEdge = basis.worley6Edge[i];
          const cellId = basis.worley6Id[i];
          const conchoidal = 0.5 + 0.5 * Math.sin((basis.worley6F1[i] * 26 + med * 4) * Math.PI);

          const sharpRidge = 1 - smoothstep(0.01, 0.07, cellEdge);
          const facetShade = clamp01(cellId * 0.55 + conchoidal * 0.25 + ridge * 0.20);

          mixRgb(obsDeep, obsViolet, facetShade, tmpA);
          mixRgb(tmpA, obsEdge, sharpRidge * 0.65, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          // Stepped glassy facets with crisp ridge crests
          const h = clamp01(0.35 + cellId * 0.35 + conchoidal * 0.14 + sharpRidge * 0.20);
          writeGray(buffers.bumpData, i, h);

          // Mirror-like volcanic glass on facet planes, rough chipped fracture edges
          const rough = clamp01(0.58 + sharpRidge * 0.38 + fine * 0.10 - conchoidal * 0.12);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.24, metalness: 0.18, bumpScale: 0.46, envMapIntensity: 1.3 },
      };
    }

    case 'metal_steel': {
      const buffers = createBuffers(size, false);
      const steelDark = hexToRgb(0x7c8594);
      const steelBright = hexToRgb(0xcad3e0);
      const patina = hexToRgb(0x49505c);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          // Anisotropic horizontal brushed steel grain + subtle hammered planishing
          const brush = basis.sample(basis.fbmFine, u * 0.35, v * 6.0);
          const crossScratch = smoothstep(0.86, 0.97, basis.sample(basis.ridged, u * 2.0, v * 2.0));
          const hammer = basis.worley12F1[i];
          const coarse = basis.fbmCoarse[i];

          const sheen = clamp01(brush * 0.55 + (1 - hammer) * 0.25 + 0.20);
          mixRgb(steelDark, steelBright, sheen, tmpA);
          mixRgb(tmpA, patina, smoothstep(0.62, 0.90, coarse) * 0.30, tmpA);

          // Fine bright battle scratches
          tmpA.r = clamp01(tmpA.r + crossScratch * 0.14);
          tmpA.g = clamp01(tmpA.g + crossScratch * 0.14);
          tmpA.b = clamp01(tmpA.b + crossScratch * 0.15);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.55 + brush * 0.25 - crossScratch * 0.35 + (0.5 - hammer) * 0.15);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.68 + (1 - brush) * 0.22 + crossScratch * 0.18);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.28, metalness: 0.88, bumpScale: 0.12, envMapIntensity: 1.25 },
      };
    }

    case 'metal_gold': {
      const buffers = createBuffers(size, false);
      const goldAntique = hexToRgb(0xa87620);
      const goldImperial = hexToRgb(0xf5c84c);
      const goldHighlight = hexToRgb(0xffe699);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const brush = basis.sample(basis.fbmFine, u * 0.5, v * 4.0);
          const filigree = basis.sample(basis.ridged, u * 2.0, v * 2.0);
          const med = basis.fbmMed[i];

          // Ornate royal gold luster with subtle recessed antique bronze patina
          const luster = clamp01(brush * 0.45 + med * 0.35 + 0.25);
          mixRgb(goldAntique, goldImperial, luster, tmpA);
          mixRgb(tmpA, goldHighlight, smoothstep(0.72, 0.95, filigree) * 0.45, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.50 + brush * 0.20 + filigree * 0.30);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.65 + (1 - luster) * 0.28 + (1 - filigree) * 0.10);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.24, metalness: 0.92, bumpScale: 0.14, envMapIntensity: 1.35 },
      };
    }

    case 'metal_dark_iron': {
      const buffers = createBuffers(size, false);
      const ironCharcoal = hexToRgb(0x282b33);
      const ironWorn = hexToRgb(0x59606e);
      const forgeRust = hexToRgb(0x4d2f24);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];
          const pit = basis.worley12F1[i];

          // Cast-iron forge scale + worn metallic edge highlights + trace oxidation
          const metalSheen = clamp01(med * 0.45 + fine * 0.35 + (1 - pit) * 0.25);
          mixRgb(ironCharcoal, ironWorn, metalSheen, tmpA);
          const rustMask = smoothstep(0.66, 0.88, coarse) * smoothstep(0.45, 0.15, metalSheen);
          mixRgb(tmpA, forgeRust, rustMask * 0.55, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.52 + fine * 0.28 - smoothstep(0.0, 0.25, 1 - pit) * 0.22);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.72 + rustMask * 0.25 + (1 - fine) * 0.15);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.46, metalness: 0.82, bumpScale: 0.22, envMapIntensity: 1.1 },
      };
    }

    case 'wood_oak': {
      const buffers = createBuffers(size, false);
      const oakDark = hexToRgb(0x3b2416);
      const oakMid = hexToRgb(0x6b442a);
      const oakHighlight = hexToRgb(0x875939);
      const seamDark = hexToRgb(0x1c1009);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          // 4 vertical oak planks per tile
          const px = u * 4;
          const plankIdx = Math.floor(px) & 3;
          const localX = px - Math.floor(px);
          const plankEdge = Math.min(localX, 1 - localX);
          const plankSeam = 1 - smoothstep(0.015, 0.055, plankEdge);
          const plankShift = hash2D(plankIdx, 31, 777);

          // Stretched longitudinal wood fibers + warped growth rings
          const fiber = basis.sample(basis.fbmFine, u * 4.0 + plankShift, v * 0.35);
          const ringCoord = (u * 5.0 + plankShift * 3.0 + (med - 0.5) * 0.65) * Math.PI * 4;
          const rings = 0.5 + 0.5 * Math.sin(ringCoord);

          const grain = clamp01(rings * 0.52 + fiber * 0.36 + (plankShift - 0.5) * 0.22);
          mixRgb(oakDark, oakMid, grain, tmpA);
          mixRgb(tmpA, oakHighlight, smoothstep(0.68, 0.95, grain) * 0.45, tmpA);
          mixRgb(tmpA, seamDark, plankSeam * 0.88, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01((0.55 + fiber * 0.25 + rings * 0.18) * (1 - plankSeam * 0.78));
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.78 + (1 - rings) * 0.14 + fine * 0.08 + plankSeam * 0.10);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.78, metalness: 0.04, bumpScale: 0.30 },
      };
    }

    case 'rune_glow_blue':
      return synthesizeRuneMaterial(
        basis,
        0x16243b,
        0x2b4670,
        0x1c7ed6,
        0xa5d8ff,
        0x339af0,
        2.2,
        0.0,
        0.0,
      );

    case 'rune_glow_crimson':
      return synthesizeRuneMaterial(
        basis,
        0x2e1114,
        0x591e24,
        0xc92a2a,
        0xffa8a8,
        0xe03131,
        2.2,
        0.5,
        0.0,
      );

    case 'rune_glow_emerald':
      return synthesizeRuneMaterial(
        basis,
        0x10291a,
        0x1f4d31,
        0x2b8a3e,
        0xb2f2bb,
        0x2f9e44,
        2.1,
        0.0,
        0.5,
      );

    case 'rune_glow_void':
      return synthesizeRuneMaterial(
        basis,
        0x1f1130,
        0x3d205e,
        0x9c36b5,
        0xf3d9fa,
        0xae3ec9,
        2.3,
        0.5,
        0.5,
      );

    case 'crystal_cyan': {
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const crystalDeep = hexToRgb(0x0c4a60);
      const crystalMid = hexToRgb(0x22b8cf);
      const crystalEdge = hexToRgb(0xc5f6fa);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const cellId6 = basis.worley6Id[i];
          const edge6 = basis.worley6Edge[i];
          const cellId12 = basis.worley12Id[i];
          const edge12 = basis.worley12Edge[i];
          const caustic = basis.ridged[i];

          // Sharp planar crystal facets + bright internal refractive ridges
          const facetCrest = Math.max(
            1 - smoothstep(0.008, 0.055, edge6),
            (1 - smoothstep(0.01, 0.06, edge12)) * 0.65,
          );
          const facetTone = clamp01(cellId6 * 0.52 + cellId12 * 0.28 + caustic * 0.25);

          mixRgb(crystalDeep, crystalMid, facetTone, tmpA);
          mixRgb(tmpA, crystalEdge, clamp01(facetCrest * 0.82 + smoothstep(0.75, 0.98, caustic) * 0.45), tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.35 + cellId6 * 0.40 + facetCrest * 0.25);
          writeGray(buffers.bumpData, i, h);

          // Ultra-glossy crystal planes
          const rough = clamp01(0.55 + facetCrest * 0.30 + (1 - caustic) * 0.15);
          writeGray(buffers.roughnessData, i, rough);

          const innerGlow = clamp01(0.38 + caustic * 0.42 + facetCrest * 0.35);
          writePixel(
            emissiveBuf,
            i,
            innerGlow * 0.32,
            innerGlow * 0.88,
            innerGlow,
          );
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.14,
          metalness: 0.12,
          bumpScale: 0.34,
          emissiveHex: 0x15aabf,
          emissiveIntensity: 1.35,
          envMapIntensity: 1.5,
        },
      };
    }

    case 'bone': {
      const buffers = createBuffers(size, false);
      const marrowSepia = hexToRgb(0x8c7b62);
      const boneIvory = hexToRgb(0xd8ceb8);
      const boneBleached = hexToRgb(0xf0e9d8);
      const sutureDark = hexToRgb(0x4a3f31);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];
          const pores = basis.worley12F1[i];
          const suture = smoothstep(0.86, 0.97, basis.ridged[i]);

          const striation = basis.sample(basis.fbmFine, u * 0.6, v * 3.0);
          const shade = clamp01(coarse * 0.35 + med * 0.35 + striation * 0.30);

          mixRgb(marrowSepia, boneIvory, smoothstep(0.18, 0.68, shade), tmpA);
          mixRgb(tmpA, boneBleached, smoothstep(0.65, 0.95, shade) * 0.65, tmpA);
          mixRgb(tmpA, sutureDark, suture * 0.55, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const trabeculae = smoothstep(0.05, 0.35, pores);
          const h = clamp01(0.58 + striation * 0.20 + trabeculae * 0.18 - suture * 0.42);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.74 + (1 - trabeculae) * 0.18 + fine * 0.08);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.66, metalness: 0.03, bumpScale: 0.28 },
      };
    }

    case 'flesh_demon': {
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const fleshDeep = hexToRgb(0x3b0d14);
      const fleshCarmine = hexToRgb(0x7d1d28);
      const sinewHighlight = hexToRgb(0xa8383b);
      const emberVein = hexToRgb(0xff4d29);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const scaleEdge = basis.worley12Edge[i];
          const sinew = basis.sample(basis.ridged, u + (med - 0.5) * 0.08, v + (coarse - 0.5) * 0.08);

          const scaleCrevice = 1 - smoothstep(0.02, 0.14, scaleEdge);
          const vein = smoothstep(0.80, 0.96, sinew) * smoothstep(0.35, 0.75, coarse);

          mixRgb(fleshDeep, fleshCarmine, clamp01(med * 0.55 + (1 - scaleCrevice) * 0.45), tmpA);
          mixRgb(tmpA, sinewHighlight, smoothstep(0.55, 0.85, sinew) * 0.48, tmpA);
          mixRgb(tmpA, emberVein, vein * 0.65, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01((0.55 + sinew * 0.30) * (1 - scaleCrevice * 0.55));
          writeGray(buffers.bumpData, i, h);

          // Clammy organic demon hide with glossy muscle ridges
          const rough = clamp01(0.68 + scaleCrevice * 0.26 - sinew * 0.14);
          writeGray(buffers.roughnessData, i, rough);

          writePixel(emissiveBuf, i, vein * 0.9, vein * 0.22, vein * 0.10);
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.58,
          metalness: 0.05,
          bumpScale: 0.40,
          emissiveHex: 0x7a160c,
          emissiveIntensity: 0.45,
        },
      };
    }

    case 'cloth_crimson': {
      const buffers = createBuffers(size, false);
      const crimsonShadow = hexToRgb(0x4f0e16);
      const crimsonRich = hexToRgb(0x9e1c28);
      const crimsonVelvet = hexToRgb(0xc93440);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          // Woven warp-and-weft textile threads
          const warp = 0.5 + 0.5 * Math.sin(u * Math.PI * 80);
          const weft = 0.5 + 0.5 * Math.sin(v * Math.PI * 80);
          const weave = (x + y) & 1 ? warp * 0.7 + weft * 0.3 : weft * 0.7 + warp * 0.3;

          const fold = clamp01(coarse * 0.55 + med * 0.30 + weave * 0.15);
          mixRgb(crimsonShadow, crimsonRich, fold, tmpA);
          mixRgb(tmpA, crimsonVelvet, smoothstep(0.62, 0.92, fold) * 0.55, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.42 + weave * 0.38 + med * 0.20);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.84 + (1 - weave) * 0.12 + fine * 0.04);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.88, metalness: 0.02, bumpScale: 0.20 },
      };
    }

    case 'cloth_shadow': {
      const buffers = createBuffers(size, false);
      const shadowDeep = hexToRgb(0x14161f);
      const shadowIndigo = hexToRgb(0x282d3d);
      const shadowEdge = hexToRgb(0x414961);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];

          // Tight diagonal stealth twill weave
          const twill = 0.5 + 0.5 * Math.sin((u * 64 + v * 64) * Math.PI);
          const cross = 0.5 + 0.5 * Math.sin((u * 64 - v * 64) * Math.PI);
          const weave = twill * 0.65 + cross * 0.35;

          const fold = clamp01(coarse * 0.50 + med * 0.32 + weave * 0.18);
          mixRgb(shadowDeep, shadowIndigo, fold, tmpA);
          mixRgb(tmpA, shadowEdge, smoothstep(0.66, 0.94, fold) * 0.50, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.45 + weave * 0.36 + med * 0.19);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.78 + (1 - weave) * 0.18);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.82, metalness: 0.06, bumpScale: 0.20 },
      };
    }

    case 'cloth_arcane': {
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const silkDeep = hexToRgb(0x1a1238);
      const silkRoyal = hexToRgb(0x3a2475);
      const brocadeGold = hexToRgb(0xc79f4e);
      const astralThread = hexToRgb(0x5c7cfa);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const med = basis.fbmMed[i];
          const ridge = basis.ridged[i];

          // Fine silk weave + diamond mystic brocade embroidery
          const silkWeave = 0.5 + 0.5 * Math.sin(u * Math.PI * 96) * Math.sin(v * Math.PI * 96);
          const diamond = Math.abs(Math.sin((u + v) * Math.PI * 4)) * Math.abs(Math.sin((u - v) * Math.PI * 4));
          const brocadeMask = smoothstep(0.84, 0.96, 1 - diamond) * smoothstep(0.35, 0.75, ridge);
          const shimmer = smoothstep(0.78, 0.96, ridge);

          mixRgb(silkDeep, silkRoyal, clamp01(med * 0.65 + silkWeave * 0.35), tmpA);
          mixRgb(tmpA, astralThread, shimmer * 0.45, tmpA);
          mixRgb(tmpA, brocadeGold, brocadeMask * 0.75, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.45 + silkWeave * 0.22 + brocadeMask * 0.33);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.76 - brocadeMask * 0.28 + (1 - silkWeave) * 0.14);
          writeGray(buffers.roughnessData, i, rough);

          const emit = shimmer * 0.65;
          writePixel(emissiveBuf, i, emit * 0.35, emit * 0.48, emit);
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.68,
          metalness: 0.16,
          bumpScale: 0.22,
          emissiveHex: 0x364fc7,
          emissiveIntensity: 0.35,
        },
      };
    }

    case 'lava_emissive': {
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const crustBlack = hexToRgb(0x1f0d0a);
      const crustRed = hexToRgb(0x6e190c);
      const magmaOrange = hexToRgb(0xff5900);
      const magmaWhiteHot = hexToRgb(0xffe875);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          // Domain-warped volcanic basalt islands floating over wide incandescent rivers
          const wu = u + (med - 0.5) * 0.11;
          const wv = v + (coarse - 0.5) * 0.11;
          const edge = basis.sample(basis.worley6Edge, wu, wv);
          const flow = basis.sample(basis.ridged, wu * 1.5, wv * 1.5);

          // Wide glowing magma rivers along cell borders + turbulent surges
          const river = 1 - smoothstep(0.04, 0.24, edge);
          const heat = clamp01(river * 0.85 + flow * 0.45 * (1 - smoothstep(0.08, 0.34, edge)));
          const whiteCore = smoothstep(0.68, 0.95, heat);

          // Color ramp: cooled crust -> glowing red rim -> molten orange -> white-hot core
          if (heat < 0.35) {
            mixRgb(crustBlack, crustRed, mix(0, 1, heat / 0.35) * 0.8 + fine * 0.2, tmpA);
          } else {
            mixRgb(crustRed, magmaOrange, smoothstep(0.32, 0.72, heat), tmpA);
            mixRgb(tmpA, magmaWhiteHot, whiteCore, tmpA);
          }

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          // Basalt crust islands rise above liquid magma channels
          const crustHeight = (1 - smoothstep(0.20, 0.55, heat)) * (0.65 + fine * 0.35);
          writeGray(buffers.bumpData, i, clamp01(0.15 + crustHeight * 0.85));

          const rough = clamp01(0.92 - heat * 0.38 + fine * 0.08);
          writeGray(buffers.roughnessData, i, rough);

          // Emissive map glows intensely along molten channels and softly under thin crust
          const emitStrength = clamp01(0.14 + heat * 0.86);
          mixRgb(magmaOrange, magmaWhiteHot, whiteCore * 0.8, tmpB);
          writePixel(
            emissiveBuf,
            i,
            tmpB.r * emitStrength,
            tmpB.g * emitStrength,
            tmpB.b * emitStrength,
          );
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.62,
          metalness: 0.08,
          bumpScale: 0.45,
          emissiveHex: 0xff6200,
          emissiveIntensity: 2.5,
        },
      };
    }

    case 'floor_sanctuary': {
      // Moonlit white-gold Sanctuary Hub marble with Carrara veins & gilded bronze-gold inlays
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const marbleSilver = hexToRgb(0x6d7791);
      const marbleAlabaster = hexToRgb(0xb8c2d9);
      const veinBlue = hexToRgb(0x46526e);
      const goldInlay = hexToRgb(0xdba84b);
      const seamCol = hexToRgb(0x2a3040);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          // 2x2 grand temple marble slabs with inner gilded trim border
          const gx = (u * 2) % 1;
          const gy = (v * 2) % 1;
          const borderDist = Math.min(Math.min(gx, 1 - gx), Math.min(gy, 1 - gy));
          const mortar = 1 - smoothstep(0.012, 0.032, borderDist);
          const goldBand =
            smoothstep(0.055, 0.072, borderDist) * (1 - smoothstep(0.085, 0.105, borderDist));

          // Domain-warped flowing Carrara marble veins
          const veinField = basis.sample(basis.ridged, u + (med - 0.5) * 0.18, v + (coarse - 0.5) * 0.18);
          const veinMask = smoothstep(0.68, 0.94, veinField);

          mixRgb(marbleSilver, marbleAlabaster, clamp01(coarse * 0.45 + med * 0.35 + fine * 0.2), tmpA);
          mixRgb(tmpA, veinBlue, veinMask * 0.55, tmpA);
          mixRgb(tmpA, goldInlay, goldBand * 0.88, tmpA);
          mixRgb(tmpA, seamCol, mortar * 0.85, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.76 - mortar * 0.52 + goldBand * 0.08 + fine * 0.08 - veinMask * 0.06);
          writeGray(buffers.bumpData, i, h);

          // Polished moonlit marble & gleaming gold inlay, matte mortar
          const rough = clamp01(0.62 - goldBand * 0.28 + mortar * 0.32 + fine * 0.10);
          writeGray(buffers.roughnessData, i, rough);

          const shimmer = goldBand * 0.65 + veinMask * 0.18;
          writePixel(emissiveBuf, i, shimmer * 0.95, shimmer * 0.82, shimmer * 0.48);
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.36,
          metalness: 0.14,
          bumpScale: 0.28,
          emissiveHex: 0x8a7440,
          emissiveIntensity: 0.32,
          envMapIntensity: 1.35,
        },
      };
    }

    case 'floor_cathedral': {
      // Sunken Cathedral of Rime — Specular mirror-ice with deep subsurface frost cracks
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const abyssIce = hexToRgb(0x132c45);
      const ceruleanIce = hexToRgb(0x2d668c);
      const rimeCrack = hexToRgb(0xd4f5ff);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          // Multi-scale jagged frost fracture network + sunken gothic slab outlines underneath
          const wu = u + (fine - 0.5) * 0.025;
          const wv = v + (med - 0.5) * 0.025;
          const primaryCrack = 1 - smoothstep(0.008, 0.045, basis.sample(basis.worley6Edge, wu, wv));
          const microCrack = (1 - smoothstep(0.01, 0.04, basis.worley12Edge[i])) * 0.55;
          const stressFracture = smoothstep(0.84, 0.97, basis.ridged[i]) * 0.65;
          const frostMask = clamp01(Math.max(primaryCrack, Math.max(microCrack, stressFracture)));

          const depthShade = clamp01(coarse * 0.55 + med * 0.45);
          mixRgb(abyssIce, ceruleanIce, depthShade, tmpA);
          mixRgb(tmpA, rimeCrack, frostMask * 0.88, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          // Mirror-flat ice surface scored by sharp frost fissures
          const h = clamp01(0.80 + fine * 0.08 - primaryCrack * 0.52 - microCrack * 0.25);
          writeGray(buffers.bumpData, i, h);

          // Mirror-smooth clear ice (~0.52 * 0.16 = 0.08) vs frosty white rime along cracks
          const rough = clamp01(0.52 + frostMask * 0.44 + fine * 0.06);
          writeGray(buffers.roughnessData, i, rough);

          const cryoGlow = clamp01(0.18 + frostMask * 0.72 + depthShade * 0.15);
          writePixel(emissiveBuf, i, cryoGlow * 0.38, cryoGlow * 0.82, cryoGlow);
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.16,
          metalness: 0.10,
          bumpScale: 0.30,
          emissiveHex: 0x1b6ca8,
          emissiveIntensity: 0.55,
          envMapIntensity: 1.55,
        },
      };
    }

    case 'floor_observatory': {
      // Clockwork Astral Observatory — Celestial brass-inlaid midnight starstone
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const cosmosDeep = hexToRgb(0x14162e);
      const starstoneIndigo = hexToRgb(0x2a2f59);
      const brassInlay = hexToRgb(0xe0b252);
      const starCore = hexToRgb(0xa5d8ff);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          // Concentric astrolabe brass rings + cardinal/diagonal meridian lines
          const dx = u - 0.5;
          const dy = v - 0.5;
          const r = Math.hypot(dx, dy);
          const ring1 = 1 - smoothstep(0.008, 0.022, Math.abs(r - 0.42));
          const ring2 = 1 - smoothstep(0.007, 0.019, Math.abs(r - 0.24));
          const crossLine =
            1 - smoothstep(0.006, 0.016, Math.min(Math.abs(dx), Math.abs(dy)));
          const diagLine =
            (1 - smoothstep(0.005, 0.015, Math.min(Math.abs(dx - dy), Math.abs(dx + dy)))) * 0.7;
          const tileBorder =
            1 - smoothstep(0.01, 0.028, Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)));

          const brassMask = clamp01(Math.max(Math.max(ring1, ring2), Math.max(crossLine * 0.85, diagLine)));

          // Embedded pinpoint star-flecks inside dark cosmos stone
          const starSpark = (1 - smoothstep(0.0, 0.09, basis.worley12F1[i])) * (1 - brassMask);
          const nebula = basis.sample(basis.ridged, u + coarse * 0.12, v + med * 0.12);

          mixRgb(cosmosDeep, starstoneIndigo, clamp01(nebula * 0.65 + med * 0.35), tmpA);
          mixRgb(tmpA, starCore, starSpark * 0.85, tmpA);
          mixRgb(tmpA, brassInlay, brassMask * 0.92, tmpA);
          tmpA.r *= 1 - tileBorder * 0.55;
          tmpA.g *= 1 - tileBorder * 0.55;
          tmpA.b *= 1 - tileBorder * 0.55;

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.70 + brassMask * 0.18 - tileBorder * 0.48 + fine * 0.08);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.64 - brassMask * 0.26 + tileBorder * 0.28 + fine * 0.08);
          writeGray(buffers.roughnessData, i, rough);

          const emit = clamp01(starSpark * 0.95 + nebula * 0.22 * (1 - brassMask) + brassMask * 0.18);
          writePixel(emissiveBuf, i, emit * 0.55, emit * 0.72, emit);
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.34,
          metalness: 0.34,
          bumpScale: 0.32,
          emissiveHex: 0x4c6ef5,
          emissiveIntensity: 0.68,
          envMapIntensity: 1.35,
        },
      };
    }

    case 'floor_colosseum': {
      // Crimson Bloodhunt Colosseum — Blood-drenched battle-scarred arena sandstone
      const buffers = createBuffers(size, false);
      const sandDark = hexToRgb(0x523b2b);
      const sandLight = hexToRgb(0x826249);
      const bloodDried = hexToRgb(0x47090e);
      const bloodFresh = hexToRgb(0x7d111a);
      const mortarDust = hexToRgb(0x2e2017);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];
          const fine = basis.fbmFine[i];

          const block = evalStoneMasonry(
            u,
            v,
            3,
            3,
            (med - 0.5) * 0.03,
            (coarse - 0.5) * 0.03,
            0.055,
            909,
          );

          // Blade gouges + visceral crimson blood splatters & pooled joint stains
          const gouge = smoothstep(0.85, 0.97, basis.ridged[i]);
          const splatterField =
            coarse * 0.58 + med * 0.28 + (1 - basis.worley12F1[i]) * 0.24 + block.mortarMask * 0.22;
          const driedMask = smoothstep(0.56, 0.74, splatterField);
          const freshPoolMask = smoothstep(0.72, 0.88, splatterField);

          mixRgb(sandDark, sandLight, clamp01(block.blockTint * 0.5 + fine * 0.35 + med * 0.15), tmpA);
          mixRgb(tmpA, mortarDust, block.mortarMask * 0.82, tmpA);
          mixRgb(tmpA, bloodDried, driedMask * 0.78, tmpA);
          mixRgb(tmpA, bloodFresh, freshPoolMask * 0.86, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(
            block.bevel * (0.68 + fine * 0.22 + block.blockTilt) - gouge * 0.36 - block.mortarMask * 0.45,
          );
          writeGray(buffers.bumpData, i, h);

          // Matte gritty arena sandstone vs slick glossy crimson blood pools
          const rough = clamp01(0.92 + fine * 0.08 - freshPoolMask * 0.58 - driedMask * 0.14);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.78, metalness: 0.04, bumpScale: 0.46 },
      };
    }

    case 'brass_clockwork': {
      // Machined horological brushed bronze-gold for clockwork gears & Chronos
      const buffers = createBuffers(size, false);
      const bronzeDark = hexToRgb(0x78501b);
      const brassMid = hexToRgb(0xd9a343);
      const brassBright = hexToRgb(0xfce192);
      const oilGroove = hexToRgb(0x36220a);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const dx = u - 0.5;
          const dy = v - 0.5;
          const r = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx);

          // Circular lathe-turned brushing + gear tooth vernier notches
          const latheBrush = 0.5 + 0.5 * Math.sin(r * Math.PI * 72 + basis.fbmFine[i] * 2.0);
          const linearBrush = basis.sample(basis.fbmFine, u * 0.45, v * 5.0);
          const gearNotch =
            smoothstep(0.32, 0.34, r) *
            (1 - smoothstep(0.39, 0.41, r)) *
            smoothstep(0.35, 0.65, 0.5 + 0.5 * Math.sin(angle * 24));
          const grooveRing = 1 - smoothstep(0.006, 0.020, Math.abs(r - 0.31));

          const sheen = clamp01(latheBrush * 0.42 + linearBrush * 0.38 + basis.fbmMed[i] * 0.25);
          mixRgb(bronzeDark, brassMid, sheen, tmpA);
          mixRgb(tmpA, brassBright, clamp01(smoothstep(0.68, 0.95, sheen) * 0.55 + gearNotch * 0.25), tmpA);
          mixRgb(tmpA, oilGroove, grooveRing * 0.78, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.52 + latheBrush * 0.16 + gearNotch * 0.26 - grooveRing * 0.42);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.64 + (1 - sheen) * 0.24 + grooveRing * 0.22);
          writeGray(buffers.roughnessData, i, rough);
          i++;
        }
      }

      return {
        buffers,
        pbr: { roughness: 0.25, metalness: 0.91, bumpScale: 0.18, envMapIntensity: 1.38 },
      };
    }

    case 'ice_glacier': {
      // Translucent-feeling Fresnel rime glacier crystal for Valkyria, Frost Revenants & Ice Wraiths
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const glacierDeep = hexToRgb(0x165b8c);
      const glacierCyan = hexToRgb(0x5cd6ff);
      const rimeFrost = hexToRgb(0xebfcff);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const cellId6 = basis.worley6Id[i];
          const edge6 = basis.worley6Edge[i];
          const edge12 = basis.worley12Edge[i];
          const fine = basis.fbmFine[i];
          const striation = basis.ridged[i];

          const rimeEdge = Math.max(
            1 - smoothstep(0.01, 0.075, edge6),
            (1 - smoothstep(0.01, 0.065, edge12)) * 0.7,
          );
          const bodyTone = clamp01(cellId6 * 0.45 + striation * 0.35 + fine * 0.20);

          mixRgb(glacierDeep, glacierCyan, bodyTone, tmpA);
          mixRgb(tmpA, rimeFrost, clamp01(rimeEdge * 0.85 + smoothstep(0.72, 0.96, striation) * 0.45), tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.38 + cellId6 * 0.36 + rimeEdge * 0.26);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.50 + rimeEdge * 0.36 + (1 - striation) * 0.14);
          writeGray(buffers.roughnessData, i, rough);

          const cryoEmit = clamp01(0.34 + striation * 0.38 + rimeEdge * 0.42);
          writePixel(emissiveBuf, i, cryoEmit * 0.42, cryoEmit * 0.86, cryoEmit);
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.12,
          metalness: 0.08,
          bumpScale: 0.34,
          emissiveHex: 0x22b8cf,
          emissiveIntensity: 1.18,
          envMapIntensity: 1.55,
        },
      };
    }

    case 'mythic_crimson': {
      // Mythic Primal Crimson (#ff1e42) — Pulsing primordial red-gold reality plasma
      const buffers = createBuffers(size, true);
      const emissiveBuf = buffers.emissiveData!;
      const abyssCore = hexToRgb(0x29030b);
      const primalCrimson = hexToRgb(0xff1e42);
      const plasmaGold = hexToRgb(0xffd43b);
      const whiteSingularity = hexToRgb(0xfff0f5);

      let i = 0;
      for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
          const u = x * inv;
          const coarse = basis.fbmCoarse[i];
          const med = basis.fbmMed[i];

          // Swirling vortex plasma filaments + shattered mythic facets
          const wu = u + (med - 0.5) * 0.16;
          const wv = v + (coarse - 0.5) * 0.16;
          const arcA = basis.sample(basis.ridged, wu * 1.5, wv * 1.5);
          const arcB = basis.sample(basis.ridged, wv * 2.0 + 0.3, wu * 2.0 + 0.7);
          const shardCrest = 1 - smoothstep(0.01, 0.06, basis.sample(basis.worley6Edge, wu, wv));

          const plasma = clamp01(Math.pow(arcA, 1.6) * 0.65 + Math.pow(arcB, 2.0) * 0.45 + shardCrest * 0.45);
          const goldSurge = smoothstep(0.66, 0.90, plasma);
          const hotCore = smoothstep(0.86, 0.98, plasma);

          mixRgb(abyssCore, primalCrimson, smoothstep(0.10, 0.58, plasma), tmpA);
          mixRgb(tmpA, plasmaGold, goldSurge * 0.75, tmpA);
          mixRgb(tmpA, whiteSingularity, hotCore * 0.85, tmpA);

          writePixel(buffers.colorData, i, tmpA.r, tmpA.g, tmpA.b);

          const h = clamp01(0.35 + plasma * 0.45 + shardCrest * 0.20);
          writeGray(buffers.bumpData, i, h);

          const rough = clamp01(0.72 - plasma * 0.42);
          writeGray(buffers.roughnessData, i, rough);

          // High baseline primal radiance surging to incandescent crimson-gold
          const emitStrength = clamp01(0.48 + plasma * 0.52);
          mixRgb(primalCrimson, plasmaGold, goldSurge * 0.65, tmpB);
          mixRgb(tmpB, whiteSingularity, hotCore * 0.6, tmpB);
          writePixel(
            emissiveBuf,
            i,
            tmpB.r * emitStrength,
            tmpB.g * emitStrength,
            tmpB.b * emitStrength,
          );
          i++;
        }
      }

      return {
        buffers,
        pbr: {
          roughness: 0.18,
          metalness: 0.35,
          bumpScale: 0.32,
          emissiveHex: 0xff1e42,
          emissiveIntensity: 2.6,
          envMapIntensity: 1.5,
        },
      };
    }
  }
}
