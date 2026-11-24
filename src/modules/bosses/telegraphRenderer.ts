import * as THREE from 'three';
import type { DamageType, TelegraphZone, Vec3 } from '../../contracts/types';
import { clamp, DAMAGE_TYPE_COLORS, distXZ } from '../../core/Constants';

const DECAL_BASE_Y = 0.042;
const DECAL_FILL_Y = 0.048;
const DECAL_BORDER_Y = 0.054;

/**
 * Builds an annulus / disk / sector on the XZ plane (y = 0) centered at origin,
 * oriented so angle 0 points along +Z: (sin(a) * r, 0, cos(a) * r).
 */
function buildAnnularSectorXZ(
  innerR: number,
  outerR: number,
  halfAngleRad: number,
  segments: number,
): THREE.BufferGeometry {
  const segs = Math.max(4, segments);
  const vertCount = (segs + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const angle = -halfAngleRad + t * (halfAngleRad * 2);
    const sa = Math.sin(angle);
    const ca = Math.cos(angle);

    const idxInner = i * 2;
    const idxOuter = idxInner + 1;

    positions[idxInner * 3] = sa * innerR;
    positions[idxInner * 3 + 1] = 0;
    positions[idxInner * 3 + 2] = ca * innerR;
    uvs[idxInner * 2] = t;
    uvs[idxInner * 2 + 1] = 0;

    positions[idxOuter * 3] = sa * outerR;
    positions[idxOuter * 3 + 1] = 0;
    positions[idxOuter * 3 + 2] = ca * outerR;
    uvs[idxOuter * 2] = t;
    uvs[idxOuter * 2 + 1] = 1;

    if (i < segs) {
      const a = idxInner;
      const b = idxOuter;
      const c = idxInner + 2;
      const d = idxOuter + 2;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Updates an existing annular sector geometry's inner and outer radii in-place
 * (used for smooth ring shockwave fill expansion from innerRadius -> outerRadius).
 */
function updateAnnularRadiiInPlace(
  geo: THREE.BufferGeometry,
  innerR: number,
  outerR: number,
  halfAngleRad: number,
  segments: number,
): void {
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const segs = Math.max(4, segments);

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const angle = -halfAngleRad + t * (halfAngleRad * 2);
    const sa = Math.sin(angle);
    const ca = Math.cos(angle);

    const idxInner = i * 2;
    const idxOuter = idxInner + 1;

    arr[idxInner * 3] = sa * innerR;
    arr[idxInner * 3 + 2] = ca * innerR;

    arr[idxOuter * 3] = sa * outerR;
    arr[idxOuter * 3 + 2] = ca * outerR;
  }
  posAttr.needsUpdate = true;
}

/**
 * Builds a thin ribbon quad along an arbitrary segment (x0,z0) -> (x1,z1) on XZ plane.
 */
function appendRibbonSegment(
  positions: number[],
  indices: number[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  thickness: number,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return;
  const nx = (-dz / len) * (thickness * 0.5);
  const nz = (dx / len) * (thickness * 0.5);

  const base = positions.length / 3;
  positions.push(
    x0 - nx,
    0,
    z0 - nz,
    x0 + nx,
    0,
    z0 + nz,
    x1 + nx,
    0,
    z1 + nz,
    x1 - nx,
    0,
    z1 - nz,
  );
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Builds the crisp perimeter outline for a cone sector (left ray, right ray, outer arc).
 */
function buildConeBorderXZ(
  radius: number,
  halfAngleRad: number,
  thickness: number,
  segments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  const lx = Math.sin(-halfAngleRad) * radius;
  const lz = Math.cos(-halfAngleRad) * radius;
  const rx = Math.sin(halfAngleRad) * radius;
  const rz = Math.cos(halfAngleRad) * radius;

  appendRibbonSegment(positions, indices, 0, 0, lx, lz, thickness);
  appendRibbonSegment(positions, indices, 0, 0, rx, rz, thickness);

  const segs = Math.max(8, segments);
  for (let i = 0; i < segs; i++) {
    const a0 = -halfAngleRad + (i / segs) * (halfAngleRad * 2);
    const a1 = -halfAngleRad + ((i + 1) / segs) * (halfAngleRad * 2);
    appendRibbonSegment(
      positions,
      indices,
      Math.sin(a0) * radius,
      Math.cos(a0) * radius,
      Math.sin(a1) * radius,
      Math.cos(a1) * radius,
      thickness,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a rectangle on the XZ plane extending from z = 0 to z = length, x = -width/2 .. +width/2.
 */
function buildLineRectXZ(width: number, length: number): THREE.BufferGeometry {
  const hw = width * 0.5;
  const positions = new Float32Array([
    -hw, 0, 0,
    hw, 0, 0,
    hw, 0, length,
    -hw, 0, length,
  ]);
  const indices = [0, 1, 2, 0, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a rectangular outline frame for a line telegraph on XZ plane.
 */
function buildLineBorderXZ(
  width: number,
  length: number,
  thickness: number,
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const positions: number[] = [];
  const indices: number[] = [];

  appendRibbonSegment(positions, indices, -hw, 0, hw, 0, thickness);
  appendRibbonSegment(positions, indices, hw, 0, hw, length, thickness);
  appendRibbonSegment(positions, indices, hw, length, -hw, length, thickness);
  appendRibbonSegment(positions, indices, -hw, length, -hw, 0, thickness);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a decorative inner rune crosshair / diamond accent for circle telegraphs.
 */
function buildRuneCrosshairXZ(radius: number, thickness: number): THREE.BufferGeometry {
  const r = radius * 0.58;
  const positions: number[] = [];
  const indices: number[] = [];

  // Diamond ring
  appendRibbonSegment(positions, indices, 0, r, r, 0, thickness);
  appendRibbonSegment(positions, indices, r, 0, 0, -r, thickness);
  appendRibbonSegment(positions, indices, 0, -r, -r, 0, thickness);
  appendRibbonSegment(positions, indices, -r, 0, 0, r, thickness);

  // Cardinal ticks
  const t0 = radius * 0.72;
  const t1 = radius * 0.94;
  appendRibbonSegment(positions, indices, 0, t0, 0, t1, thickness);
  appendRibbonSegment(positions, indices, 0, -t0, 0, -t1, thickness);
  appendRibbonSegment(positions, indices, t0, 0, t1, 0, thickness);
  appendRibbonSegment(positions, indices, -t0, 0, -t1, 0, thickness);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface TelegraphVisualEntry {
  zone: TelegraphZone;
  group: THREE.Group;
  backdropMat: THREE.MeshBasicMaterial;
  fillMesh: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  fillGeo: THREE.BufferGeometry;
  borderMat: THREE.MeshBasicMaterial;
  accentMesh?: THREE.Mesh;
  ringSegments?: number;
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
}

interface DetonationFlashEntry {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  elapsed: number;
  duration: number;
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
}

function getTelegraphPalette(damageType: DamageType): {
  baseHex: number;
  fillHex: number;
  borderHex: number;
} {
  // Always keep crisp crimson/red + molten gold identity for immediate danger readability,
  // subtly modulated with elemental warmth where appropriate.
  const elem = DAMAGE_TYPE_COLORS[damageType]?.hex ?? 0xff6b35;
  const baseColor = new THREE.Color(0xc9182b).lerp(new THREE.Color(elem), 0.18);
  const fillColor = new THREE.Color(0xff4d2a).lerp(new THREE.Color(0xffb830), 0.38);
  const borderColor = new THREE.Color(0xffc947);
  return {
    baseHex: baseColor.getHex(),
    fillHex: fillColor.getHex(),
    borderHex: borderColor.getHex(),
  };
}

export function isPointInsideTelegraph(
  point: Vec3,
  zone: TelegraphZone,
  graceMargin = 0.08,
): boolean {
  const dx = point.x - zone.position.x;
  const dz = point.z - zone.position.z;
  const dist = Math.hypot(dx, dz);

  switch (zone.shape) {
    case 'circle': {
      return dist <= Math.max(0.2, zone.radius - graceMargin);
    }
    case 'ring': {
      const inner = (zone.innerRadius ?? zone.radius * 0.42) + graceMargin;
      const outer = Math.max(inner + 0.2, zone.radius - graceMargin);
      return dist >= inner && dist <= outer;
    }
    case 'cone': {
      const maxR = Math.max(0.2, zone.radius - graceMargin);
      if (dist > maxR) return false;
      if (dist < 0.15) return true;
      const halfAngle = (zone.angleRad ?? Math.PI * 0.5) * 0.5;
      const fx = Math.sin(zone.directionY);
      const fz = Math.cos(zone.directionY);
      const dot = (dx / dist) * fx + (dz / dist) * fz;
      return dot >= Math.cos(halfAngle);
    }
    case 'line': {
      const len = zone.length ?? zone.radius;
      const halfW = Math.max(0.15, (zone.width ?? 2.2) * 0.5 - graceMargin);
      const fx = Math.sin(zone.directionY);
      const fz = Math.cos(zone.directionY);
      const rx = fz;
      const rz = -fx;
      const along = dx * fx + dz * fz;
      const perp = Math.abs(dx * rx + dz * rz);
      return along >= -0.15 && along <= len && perp <= halfW;
    }
    default:
      return distXZ(point, zone.position) <= zone.radius;
  }
}

export class TelegraphRenderer {
  private readonly root = new THREE.Group();
  private entries: TelegraphVisualEntry[] = [];
  private flashes: DetonationFlashEntry[] = [];
  private nextId = 1;

  constructor() {
    this.root.name = 'BossTelegraphDecals';
  }

  attachToScene(scene: THREE.Scene): void {
    if (this.root.parent !== scene) {
      scene.add(this.root);
    }
  }

  spawn(spec: Omit<TelegraphZone, 'id' | 'elapsedSec'> & { id?: string }): TelegraphZone {
    const id = spec.id ?? `telegraph_${this.nextId++}`;
    const zone: TelegraphZone = {
      ...spec,
      id,
      position: { x: spec.position.x, y: spec.position.y, z: spec.position.z },
      durationSec: Math.max(0.15, spec.durationSec),
      elapsedSec: 0,
    };

    const entry = this.buildVisualEntry(zone);
    this.entries.push(entry);
    this.root.add(entry.group);
    return zone;
  }

  getActiveZones(): TelegraphZone[] {
    return this.entries.map((e) => e.zone);
  }

  update(dt: number): { detonated: TelegraphZone[] } {
    const detonated: TelegraphZone[] = [];

    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      entry.zone.elapsedSec += dt;
      const progress = clamp(entry.zone.elapsedSec / entry.zone.durationSec, 0, 1);

      this.animateEntry(entry, progress, dt);

      if (entry.zone.elapsedSec >= entry.zone.durationSec) {
        detonated.push(entry.zone);
        this.spawnDetonationFlash(entry.zone);
        this.disposeEntry(entry);
        this.entries.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.elapsed += dt;
      const t = clamp(flash.elapsed / flash.duration, 0, 1);
      const scale = 1 + t * 0.08;
      flash.group.scale.set(scale, 1, scale);
      flash.mat.opacity = (1 - t) * (1 - t) * 0.85;
      if (flash.elapsed >= flash.duration) {
        this.root.remove(flash.group);
        for (const g of flash.ownedGeometries) g.dispose();
        for (const m of flash.ownedMaterials) m.dispose();
        this.flashes.splice(i, 1);
      }
    }

    return { detonated };
  }

  clearBySource(sourceId: string): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].zone.sourceId === sourceId) {
        this.disposeEntry(this.entries[i]);
        this.entries.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const entry of this.entries) {
      this.disposeEntry(entry);
    }
    this.entries = [];

    for (const flash of this.flashes) {
      this.root.remove(flash.group);
      for (const g of flash.ownedGeometries) g.dispose();
      for (const m of flash.ownedMaterials) m.dispose();
    }
    this.flashes = [];
  }

  dispose(): void {
    this.clear();
    if (this.root.parent) {
      this.root.parent.remove(this.root);
    }
  }

  private buildVisualEntry(zone: TelegraphZone): TelegraphVisualEntry {
    const ownedGeometries: THREE.BufferGeometry[] = [];
    const ownedMaterials: THREE.Material[] = [];

    const palette = getTelegraphPalette(zone.damageType);
    const group = new THREE.Group();
    group.position.set(zone.position.x, 0, zone.position.z);
    group.rotation.y = zone.directionY;

    const backdropMat = new THREE.MeshBasicMaterial({
      color: palette.baseHex,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    const fillMat = new THREE.MeshBasicMaterial({
      color: palette.fillHex,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    const borderMat = new THREE.MeshBasicMaterial({
      color: palette.borderHex,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });

    ownedMaterials.push(backdropMat, fillMat, borderMat);

    let fillMesh!: THREE.Mesh;
    let fillGeo!: THREE.BufferGeometry;
    let accentMesh: THREE.Mesh | undefined;
    let ringSegments: number | undefined;

    if (zone.shape === 'circle') {
      const r = Math.max(0.5, zone.radius);
      const borderWidth = clamp(r * 0.045, 0.09, 0.22);

      const baseGeo = buildAnnularSectorXZ(0, r, Math.PI, 48);
      const baseMesh = new THREE.Mesh(baseGeo, backdropMat);
      baseMesh.position.y = DECAL_BASE_Y;
      baseMesh.renderOrder = 10;

      fillGeo = buildAnnularSectorXZ(0, r, Math.PI, 48);
      fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.position.y = DECAL_FILL_Y;
      fillMesh.scale.set(0.04, 1, 0.04);
      fillMesh.renderOrder = 11;

      const borderGeo = buildAnnularSectorXZ(Math.max(0.05, r - borderWidth), r, Math.PI, 56);
      const borderMesh = new THREE.Mesh(borderGeo, borderMat);
      borderMesh.position.y = DECAL_BORDER_Y;
      borderMesh.renderOrder = 12;

      const runeGeo = buildRuneCrosshairXZ(r, borderWidth * 0.55);
      accentMesh = new THREE.Mesh(runeGeo, borderMat);
      accentMesh.position.y = DECAL_BORDER_Y;
      accentMesh.renderOrder = 12;

      ownedGeometries.push(baseGeo, fillGeo, borderGeo, runeGeo);
      group.add(baseMesh, fillMesh, borderMesh, accentMesh);
    } else if (zone.shape === 'cone') {
      const r = Math.max(0.8, zone.radius);
      const halfAngle = clamp((zone.angleRad ?? Math.PI * 0.55) * 0.5, 0.15, Math.PI * 0.95);
      const borderWidth = clamp(r * 0.032, 0.09, 0.2);

      const baseGeo = buildAnnularSectorXZ(0, r, halfAngle, 40);
      const baseMesh = new THREE.Mesh(baseGeo, backdropMat);
      baseMesh.position.y = DECAL_BASE_Y;
      baseMesh.renderOrder = 10;

      fillGeo = buildAnnularSectorXZ(0, r, halfAngle, 40);
      fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.position.y = DECAL_FILL_Y;
      fillMesh.scale.set(0.04, 1, 0.04);
      fillMesh.renderOrder = 11;

      const borderGeo = buildConeBorderXZ(r, halfAngle, borderWidth, 40);
      const borderMesh = new THREE.Mesh(borderGeo, borderMat);
      borderMesh.position.y = DECAL_BORDER_Y;
      borderMesh.renderOrder = 12;

      ownedGeometries.push(baseGeo, fillGeo, borderGeo);
      group.add(baseMesh, fillMesh, borderMesh);
    } else if (zone.shape === 'ring') {
      const outerR = Math.max(1.5, zone.radius);
      const innerR = clamp(zone.innerRadius ?? outerR * 0.38, 0.6, outerR - 0.6);
      const borderWidth = clamp(outerR * 0.028, 0.1, 0.22);
      ringSegments = 56;

      const baseGeo = buildAnnularSectorXZ(innerR, outerR, Math.PI, ringSegments);
      const baseMesh = new THREE.Mesh(baseGeo, backdropMat);
      baseMesh.position.y = DECAL_BASE_Y;
      baseMesh.renderOrder = 10;

      fillGeo = buildAnnularSectorXZ(innerR, innerR + 0.05, Math.PI, ringSegments);
      fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.position.y = DECAL_FILL_Y;
      fillMesh.renderOrder = 11;

      const outerBorderGeo = buildAnnularSectorXZ(
        Math.max(innerR, outerR - borderWidth),
        outerR,
        Math.PI,
        ringSegments,
      );
      const outerBorderMesh = new THREE.Mesh(outerBorderGeo, borderMat);
      outerBorderMesh.position.y = DECAL_BORDER_Y;
      outerBorderMesh.renderOrder = 12;

      // Crisp gold-emerald safe inner eye boundary ring
      const safeBorderMat = new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const innerBorderGeo = buildAnnularSectorXZ(
        innerR,
        innerR + borderWidth,
        Math.PI,
        ringSegments,
      );
      const innerBorderMesh = new THREE.Mesh(innerBorderGeo, safeBorderMat);
      innerBorderMesh.position.y = DECAL_BORDER_Y;
      innerBorderMesh.renderOrder = 12;

      ownedMaterials.push(safeBorderMat);
      ownedGeometries.push(baseGeo, fillGeo, outerBorderGeo, innerBorderGeo);
      group.add(baseMesh, fillMesh, outerBorderMesh, innerBorderMesh);
    } else {
      // 'line'
      const len = Math.max(1.5, zone.length ?? zone.radius);
      const width = Math.max(0.6, zone.width ?? 2.2);
      const borderWidth = clamp(width * 0.075, 0.09, 0.18);

      const baseGeo = buildLineRectXZ(width, len);
      const baseMesh = new THREE.Mesh(baseGeo, backdropMat);
      baseMesh.position.y = DECAL_BASE_Y;
      baseMesh.renderOrder = 10;

      fillGeo = buildLineRectXZ(width, len);
      fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.position.y = DECAL_FILL_Y;
      fillMesh.scale.set(0.08, 1, 0.04);
      fillMesh.renderOrder = 11;

      const borderGeo = buildLineBorderXZ(width, len, borderWidth);
      const borderMesh = new THREE.Mesh(borderGeo, borderMat);
      borderMesh.position.y = DECAL_BORDER_Y;
      borderMesh.renderOrder = 12;

      // Center laser guide filament
      const coreGeo = buildLineRectXZ(borderWidth * 0.75, len);
      accentMesh = new THREE.Mesh(coreGeo, borderMat);
      accentMesh.position.y = DECAL_BORDER_Y;
      accentMesh.renderOrder = 12;

      ownedGeometries.push(baseGeo, fillGeo, borderGeo, coreGeo);
      group.add(baseMesh, fillMesh, borderMesh, accentMesh);
    }

    return {
      zone,
      group,
      backdropMat,
      fillMesh,
      fillMat,
      fillGeo,
      borderMat,
      accentMesh,
      ringSegments,
      ownedGeometries,
      ownedMaterials,
    };
  }

  private animateEntry(entry: TelegraphVisualEntry, progress: number, dt: number): void {
    const { zone } = entry;
    // Ease-out quad / linear hybrid so fill reads smoothly and accurately near 1.0
    const visualFill = clamp(0.04 + progress * 0.96, 0.04, 1);

    if (zone.shape === 'circle' || zone.shape === 'cone') {
      entry.fillMesh.scale.set(visualFill, 1, visualFill);
      if (entry.accentMesh && zone.shape === 'circle') {
        entry.accentMesh.rotation.y += dt * (1.2 + progress * 2.5);
      }
    } else if (zone.shape === 'ring') {
      const outerR = Math.max(1.5, zone.radius);
      const innerR = clamp(zone.innerRadius ?? outerR * 0.38, 0.6, outerR - 0.6);
      const curOuter = innerR + (outerR - innerR) * progress;
      updateAnnularRadiiInPlace(
        entry.fillGeo,
        innerR,
        Math.max(innerR + 0.03, curOuter),
        Math.PI,
        entry.ringSegments ?? 56,
      );
    } else {
      // 'line': charges along length quickly and widens from core spine to full width
      const lenFill = clamp(0.25 + progress * 0.75, 0.25, 1);
      entry.fillMesh.scale.set(visualFill, 1, lenFill);
    }

    // Intensify glow & flash white-gold in final 18% warning window
    const urgent = progress >= 0.82;
    const pulse = urgent ? 0.5 + 0.5 * Math.sin(zone.elapsedSec * 42) : 0;

    entry.backdropMat.opacity = 0.2 + progress * 0.16;
    entry.fillMat.opacity = 0.36 + progress * 0.44 + pulse * 0.18;
    entry.borderMat.opacity = 0.82 + pulse * 0.18;

    if (urgent) {
      entry.borderMat.color.setHex(pulse > 0.5 ? 0xffffff : 0xffd43b);
      entry.fillMat.color.setHex(pulse > 0.5 ? 0xffe066 : 0xff4422);
    }
  }

  private spawnDetonationFlash(zone: TelegraphZone): void {
    const ownedGeometries: THREE.BufferGeometry[] = [];
    const ownedMaterials: THREE.Material[] = [];

    const group = new THREE.Group();
    group.position.set(zone.position.x, DECAL_BORDER_Y + 0.01, zone.position.z);
    group.rotation.y = zone.directionY;

    const flashColor = DAMAGE_TYPE_COLORS[zone.damageType]?.hex ?? 0xffd43b;
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xfff3bf).lerp(new THREE.Color(flashColor), 0.45).getHex(),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    ownedMaterials.push(mat);

    let geo: THREE.BufferGeometry;
    if (zone.shape === 'circle') {
      geo = buildAnnularSectorXZ(0, Math.max(0.5, zone.radius), Math.PI, 40);
    } else if (zone.shape === 'cone') {
      const halfAngle = clamp((zone.angleRad ?? Math.PI * 0.55) * 0.5, 0.15, Math.PI * 0.95);
      geo = buildAnnularSectorXZ(0, Math.max(0.8, zone.radius), halfAngle, 36);
    } else if (zone.shape === 'ring') {
      const outerR = Math.max(1.5, zone.radius);
      const innerR = clamp(zone.innerRadius ?? outerR * 0.38, 0.6, outerR - 0.6);
      geo = buildAnnularSectorXZ(innerR, outerR, Math.PI, 48);
    } else {
      geo = buildLineRectXZ(
        Math.max(0.6, zone.width ?? 2.2),
        Math.max(1.5, zone.length ?? zone.radius),
      );
    }
    ownedGeometries.push(geo);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 14;
    group.add(mesh);
    this.root.add(group);

    this.flashes.push({
      group,
      mat,
      elapsed: 0,
      duration: 0.24,
      ownedGeometries,
      ownedMaterials,
    });
  }

  private disposeEntry(entry: TelegraphVisualEntry): void {
    this.root.remove(entry.group);
    for (const geo of entry.ownedGeometries) {
      geo.dispose();
    }
    for (const mat of entry.ownedMaterials) {
      mat.dispose();
    }
  }
}
