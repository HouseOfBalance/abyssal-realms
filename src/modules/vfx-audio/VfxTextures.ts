import * as THREE from 'three';

export interface VfxTextureAtlas {
  particleAtlas: THREE.Texture;
  slashGradient: THREE.Texture;
  runeRing: THREE.Texture;
  dispose(): void;
}

function tryCreate2dContext(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return { canvas, ctx };
  } catch {
    return null;
  }
}

/**
 * Builds a 2x2 procedural sprite atlas (256x256):
 * - Quadrant (0,0) top-left: Soft HDR radial glow mote
 * - Quadrant (1,0) top-right: Crisp 4-point star / diamond hit spark
 * - Quadrant (0,1) bottom-left: Soft billowy smoke / blood droplet puff
 * - Quadrant (1,1) bottom-right: Arcane elder rune glyph
 */
function buildParticleAtlasTexture(): THREE.Texture {
  const size = 256;
  const half = size / 2;
  const dom = tryCreate2dContext(size, size);

  if (dom) {
    const { canvas, ctx } = dom;
    ctx.clearRect(0, 0, size, size);

    // Quadrant 0 (top-left): Soft radial glow
    {
      const cx = half * 0.5;
      const cy = half * 0.5;
      const r = half * 0.46;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.28)');
      grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, half, half);
    }

    // Quadrant 1 (top-right): Crisp 4-point star spark
    {
      const cx = half + half * 0.5;
      const cy = half * 0.5;
      const r = half * 0.46;
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.65);
      core.addColorStop(0.0, 'rgba(255,255,255,1.0)');
      core.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      core.addColorStop(1.0, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = core;
      ctx.fillRect(half, 0, half, half);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(r * 0.1, -r * 0.1, r, 0);
        ctx.quadraticCurveTo(r * 0.1, r * 0.1, 0, r);
        ctx.quadraticCurveTo(-r * 0.1, r * 0.1, -r, 0);
        ctx.quadraticCurveTo(-r * 0.1, -r * 0.1, 0, -r);
        ctx.closePath();
        ctx.fill();
        ctx.rotate(Math.PI * 0.25);
        ctx.scale(0.55, 0.55);
      }
      ctx.restore();
    }

    // Quadrant 2 (bottom-left): Billowy cloud / droplet puff
    {
      const cx = half * 0.5;
      const cy = half + half * 0.5;
      const blobs = [
        { ox: 0, oy: 0, rr: half * 0.36, a: 0.65 },
        { ox: -12, oy: -8, rr: half * 0.26, a: 0.45 },
        { ox: 13, oy: -6, rr: half * 0.25, a: 0.45 },
        { ox: -8, oy: 12, rr: half * 0.27, a: 0.45 },
        { ox: 10, oy: 10, rr: half * 0.25, a: 0.42 },
      ];
      for (const b of blobs) {
        const g = ctx.createRadialGradient(cx + b.ox, cy + b.oy, 0, cx + b.ox, cy + b.oy, b.rr);
        g.addColorStop(0.0, `rgba(255,255,255,${b.a})`);
        g.addColorStop(0.65, `rgba(255,255,255,${b.a * 0.45})`);
        g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, half, half, half);
      }
    }

    // Quadrant 3 (bottom-right): Glowing elder rune glyph
    {
      const cx = half + half * 0.5;
      const cy = half + half * 0.5;
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, half * 0.44);
      glow.addColorStop(0.0, 'rgba(255,255,255,0.45)');
      glow.addColorStop(0.7, 'rgba(255,255,255,0.15)');
      glow.addColorStop(1.0, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = glow;
      ctx.fillRect(half, half, half, half);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(255,255,255,0.98)';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Outer arcane diamond + vertical stave + crossbars
      const s = half * 0.28;
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.25);
      ctx.lineTo(s * 0.9, 0);
      ctx.lineTo(0, s * 1.25);
      ctx.lineTo(-s * 0.9, 0);
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -s * 1.35);
      ctx.lineTo(0, s * 1.35);
      ctx.moveTo(-s * 0.65, -s * 0.55);
      ctx.lineTo(s * 0.65, s * 0.55);
      ctx.moveTo(s * 0.65, -s * 0.55);
      ctx.lineTo(-s * 0.65, s * 0.55);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, s * 1.15, 0, Math.PI * 2);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  // Headless fallback DataTexture (64x64)
  const fallbackSize = 64;
  const h = fallbackSize / 2;
  const data = new Uint8Array(fallbackSize * fallbackSize * 4);
  for (let y = 0; y < fallbackSize; y++) {
    for (let x = 0; x < fallbackSize; x++) {
      const lx = ((x % h) / h) * 2 - 1;
      const ly = ((y % h) / h) * 2 - 1;
      const dist = Math.hypot(lx, ly);
      const alpha = Math.max(0, 1 - dist);
      const idx = (y * fallbackSize + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha * alpha * 255);
    }
  }
  const tex = new THREE.DataTexture(data, fallbackSize, fallbackSize, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds a sleek blade-sweep gradient texture for crescent melee arcs:
 * U = along arc (0 tail -> 1 leading edge), V = radial (0 inner -> 1 outer razor rim)
 */
function buildSlashGradientTexture(): THREE.Texture {
  const w = 128;
  const h = 64;
  const dom = tryCreate2dContext(w, h);
  if (dom) {
    const { canvas, ctx } = dom;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1); // 0 inner -> 1 outer edge
      const radialProfile = Math.pow(Math.sin(Math.min(1, v * 1.08) * Math.PI * 0.5), 1.6) * (1 - Math.pow(Math.max(0, (v - 0.88) / 0.12), 2));
      const rimHot = Math.exp(-Math.pow((v - 0.82) / 0.14, 2));
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1); // 0 tail -> 1 head
        const headFade = Math.sin(Math.pow(u, 0.75) * Math.PI);
        const streak = 0.78 + 0.22 * Math.sin(v * 26.0 + u * 8.0);
        const lum = Math.min(1, 0.55 + rimHot * 0.55);
        const alpha = Math.max(0, Math.min(1, radialProfile * headFade * streak));
        const idx = (y * w + x) * 4;
        d[idx] = Math.round(lum * 255);
        d[idx + 1] = Math.round(lum * 255);
        d[idx + 2] = Math.round(lum * 255);
        d[idx + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  const data = new Uint8Array(32 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    const v = y / 15;
    for (let x = 0; x < 32; x++) {
      const u = x / 31;
      const a = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      const idx = (y * 32 + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(Math.max(0, a) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, 32, 16, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds an ornate arcane sigil ring texture for shockwaves, level-up circles, and heal halos.
 */
function buildRuneRingTexture(): THREE.Texture {
  const size = 256;
  const dom = tryCreate2dContext(size, size);
  if (dom) {
    const { canvas, ctx } = dom;
    const cx = size * 0.5;
    const cy = size * 0.5;
    ctx.clearRect(0, 0, size, size);

    const ringGlow = ctx.createRadialGradient(cx, cy, size * 0.24, cx, cy, size * 0.49);
    ringGlow.addColorStop(0.0, 'rgba(255,255,255,0.0)');
    ringGlow.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    ringGlow.addColorStop(0.82, 'rgba(255,255,255,0.92)');
    ringGlow.addColorStop(0.95, 'rgba(255,255,255,0.3)');
    ringGlow.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = ringGlow;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 12 radial rune ticks around circumference
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      ctx.save();
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(size * 0.34, 0);
      ctx.lineTo(size * 0.42, 0);
      ctx.moveTo(size * 0.36, -5);
      ctx.lineTo(size * 0.4, 5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  const fallback = 64;
  const data = new Uint8Array(fallback * fallback * 4);
  for (let y = 0; y < fallback; y++) {
    for (let x = 0; x < fallback; x++) {
      const dx = (x / (fallback - 1)) * 2 - 1;
      const dy = (y / (fallback - 1)) * 2 - 1;
      const r = Math.hypot(dx, dy);
      const ring = Math.exp(-Math.pow((r - 0.8) / 0.12, 2));
      const idx = (y * fallback + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(ring * 255);
    }
  }
  const tex = new THREE.DataTexture(data, fallback, fallback, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export function createVfxTextureAtlas(): VfxTextureAtlas {
  const particleAtlas = buildParticleAtlasTexture();
  const slashGradient = buildSlashGradientTexture();
  const runeRing = buildRuneRingTexture();

  return {
    particleAtlas,
    slashGradient,
    runeRing,
    dispose(): void {
      particleAtlas.dispose();
      slashGradient.dispose();
      runeRing.dispose();
    },
  };
}
