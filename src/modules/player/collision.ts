import type { DungeonFloorData, Vec3 } from '../../contracts/types';

const MAX_SUBSTEP_DIST = 0.2;
const MAX_SUBSTEPS = 16;
const BINARY_SEARCH_STEPS = 4;
const SIN_60 = 0.8660254037844386;
const COS_60 = 0.5;

function findMaxWalkableAxisDelta(
  startX: number,
  startZ: number,
  deltaAxis: number,
  isXAxis: boolean,
  radius: number,
  floor: DungeonFloorData,
): number {
  if (Math.abs(deltaAxis) < 1e-6) return 0;

  const fullX = isXAxis ? startX + deltaAxis : startX;
  const fullZ = isXAxis ? startZ : startZ + deltaAxis;
  if (floor.isWalkableWorld(fullX, fullZ, radius)) {
    return deltaAxis;
  }

  let low = 0;
  let high = 1;
  for (let i = 0; i < BINARY_SEARCH_STEPS; i++) {
    const mid = (low + high) * 0.5;
    const testX = isXAxis ? startX + deltaAxis * mid : startX;
    const testZ = isXAxis ? startZ : startZ + deltaAxis * mid;
    if (floor.isWalkableWorld(testX, testZ, radius)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return deltaAxis * low;
}

function recoverIfEmbedded(
  x: number,
  z: number,
  radius: number,
  floor: DungeonFloorData,
): { x: number; z: number } {
  if (floor.isWalkableWorld(x, z, radius)) {
    return { x, z };
  }

  const probeRadii = [0.08, 0.18, 0.35, 0.6, 1.0, 1.5];
  const directions = 16;
  for (const dist of probeRadii) {
    for (let i = 0; i < directions; i++) {
      const angle = (i / directions) * Math.PI * 2;
      const nx = x + Math.cos(angle) * dist;
      const nz = z + Math.sin(angle) * dist;
      if (floor.isWalkableWorld(nx, nz, radius)) {
        return { x: nx, z: nz };
      }
    }
  }

  return { x, z };
}

/**
 * Smooth circle-vs-tile collision resolver using `floor.isWalkableWorld(x, z, radius)`.
 *
 * Features:
 * - Sub-stepped displacement to prevent tunneling during dodge rolls or haste bursts.
 * - Binary-searched per-axis gap closing so the hero rests flush against walls without jitter.
 * - Dual-axis decoupled sliding so diagonal movement glides seamlessly along corridors.
 * - ±60° forward-feeler corner deflection so grazing pillar/doorway corners slides around them
 *   without snagging, while perpendicular movement into flat walls stops cleanly.
 */
export function resolveCircleSlideMove(
  currentPos: Vec3,
  deltaX: number,
  deltaZ: number,
  radius: number,
  floor: DungeonFloorData,
): Vec3 {
  const safeDx = Number.isFinite(deltaX) ? deltaX : 0;
  const safeDz = Number.isFinite(deltaZ) ? deltaZ : 0;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0.42;

  const recovered = recoverIfEmbedded(currentPos.x, currentPos.z, safeRadius, floor);
  let px = recovered.x;
  let pz = recovered.z;
  const py = Number.isFinite(currentPos.y) ? currentPos.y : 0;

  const totalDist = Math.hypot(safeDx, safeDz);
  if (totalDist < 1e-6) {
    return { x: px, y: py, z: pz };
  }

  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(totalDist / MAX_SUBSTEP_DIST)));
  const stepX = safeDx / steps;
  const stepZ = safeDz / steps;
  const stepLen = totalDist / steps;

  for (let s = 0; s < steps; s++) {
    // 1. Fast path: full sub-step is clear
    if (floor.isWalkableWorld(px + stepX, pz + stepZ, safeRadius)) {
      px += stepX;
      pz += stepZ;
      continue;
    }

    // 2. Axis-separated slide (prioritize larger displacement axis first, then slide along secondary)
    const startSubX = px;
    const startSubZ = pz;

    if (Math.abs(stepX) >= Math.abs(stepZ)) {
      const movedX = findMaxWalkableAxisDelta(px, pz, stepX, true, safeRadius, floor);
      px += movedX;
      const movedZ = findMaxWalkableAxisDelta(px, pz, stepZ, false, safeRadius, floor);
      pz += movedZ;
    } else {
      const movedZ = findMaxWalkableAxisDelta(px, pz, stepZ, false, safeRadius, floor);
      pz += movedZ;
      const movedX = findMaxWalkableAxisDelta(px, pz, stepX, true, safeRadius, floor);
      px += movedX;
    }

    const progress = Math.hypot(px - startSubX, pz - startSubZ);
    if (progress > stepLen * 0.05) {
      continue;
    }

    // 3. Corner-snag deflection: test ±60° forward-tangent feelers.
    // On a flat perpendicular wall, both feelers push into the wall and fail (no sideways drift).
    // On a doorway/pillar corner edge, the open side succeeds and smoothly guides around the corner.
    const ux = stepX / stepLen;
    const uz = stepZ / stepLen;
    const feelerDist = stepLen * 0.78;

    // Left (+60°) and Right (-60°) forward tangents
    const lx = (ux * COS_60 - uz * SIN_60) * feelerDist;
    const lz = (uz * COS_60 + ux * SIN_60) * feelerDist;
    const rx = (ux * COS_60 + uz * SIN_60) * feelerDist;
    const rz = (uz * COS_60 - ux * SIN_60) * feelerDist;

    const leftOpen = floor.isWalkableWorld(px + lx, pz + lz, safeRadius);
    const rightOpen = floor.isWalkableWorld(px + rx, pz + rz, safeRadius);

    if (leftOpen && !rightOpen) {
      px += lx;
      pz += lz;
    } else if (rightOpen && !leftOpen) {
      px += rx;
      pz += rz;
    }
  }

  return { x: px, y: py, z: pz };
}
