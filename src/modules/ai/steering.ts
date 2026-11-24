import type {
  DungeonFloorData,
  DungeonRoom,
  EnemyEntity,
  Vec3,
} from '../../contracts/types';
import { distXZ, SeededRng } from '../../core/Constants';

export function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngleY(current: number, target: number, turnRate: number, dt: number): number {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target)) return current;
  const diff = normalizeAngle(target - current);
  const maxStep = Math.max(0, turnRate * dt);
  if (Math.abs(diff) <= maxStep) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(diff) * maxStep);
}

export function hasLineOfSight(
  floor: DungeonFloorData,
  from: Vec3,
  to: Vec3,
  probeRadius = 0.15,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= 0.5) return true;

  const stepSize = Math.max(0.55, (floor.tileSize || 2) * 0.35);
  const steps = Math.ceil(dist / stepSize);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = from.x + dx * t;
    const pz = from.z + dz * t;
    if (!floor.isWalkableWorld(px, pz, probeRadius)) {
      return false;
    }
  }
  return true;
}

function isHazardTile(floor: DungeonFloorData, x: number, z: number): boolean {
  if (!floor.tiles || floor.tiles.length === 0) return false;
  const grid = floor.worldToGrid({ x, y: 0, z });
  const row = floor.tiles[grid.row];
  if (!row) return false;
  const tile = row[grid.col];
  return tile === 'hazard_lava' || tile === 'hazard_poison';
}

function isClearOfPositions(
  x: number,
  z: number,
  minSpacing: number,
  occupied: readonly Vec3[],
): boolean {
  for (const pos of occupied) {
    const dx = x - pos.x;
    const dz = z - pos.z;
    if (dx * dx + dz * dz < minSpacing * minSpacing) {
      return false;
    }
  }
  return true;
}

export function findRoomSpawnPosition(
  floor: DungeonFloorData,
  room: DungeonRoom,
  entityRadius: number,
  occupiedPositions: readonly Vec3[],
  rng: SeededRng,
): Vec3 {
  const minCol = room.x + 1;
  const maxCol = Math.max(minCol, room.x + room.width - 2);
  const minRow = room.y + 1;
  const maxRow = Math.max(minRow, room.y + room.height - 2);
  const jitter = Math.max(0.15, (floor.tileSize || 2) * 0.25);
  const minSpacing = entityRadius * 2.1 + 0.35;

  // Pass 1: strict checks (avoid hazards, interactables, playerSpawn, and pack overlap)
  for (let attempt = 0; attempt < 36; attempt++) {
    const col = rng.int(minCol, maxCol);
    const row = rng.int(minRow, maxRow);
    const base = floor.gridToWorld(col, row);
    const x = base.x + rng.range(-jitter, jitter);
    const z = base.z + rng.range(-jitter, jitter);

    if (!floor.isWalkableWorld(x, z, entityRadius)) continue;
    if (attempt < 24 && isHazardTile(floor, x, z)) continue;

    if (floor.playerSpawn && distXZ({ x, y: 0, z }, floor.playerSpawn) < 7.0 && attempt < 28) {
      continue;
    }

    let nearProp = false;
    if (attempt < 24 && floor.interactables) {
      for (const prop of floor.interactables) {
        if (distXZ({ x, y: 0, z }, prop.position) < 1.65 + entityRadius) {
          nearProp = true;
          break;
        }
      }
    }
    if (nearProp) continue;

    const spacing = attempt < 22 ? minSpacing : entityRadius * 1.4;
    if (!isClearOfPositions(x, z, spacing, occupiedPositions)) continue;

    return { x, y: 0, z };
  }

  // Pass 2: spiral around room.centerWorld
  return findRadialWalkableSpot(
    floor,
    room.centerWorld,
    0.8,
    Math.max(3.5, Math.min(room.width, room.height) * (floor.tileSize || 2) * 0.4),
    entityRadius,
    occupiedPositions,
    rng,
  );
}

export function findRadialWalkableSpot(
  floor: DungeonFloorData,
  center: Vec3,
  minDist: number,
  maxDist: number,
  entityRadius: number,
  occupiedPositions: readonly Vec3[],
  rng: SeededRng,
  preferredAngleRad?: number,
  angleSpreadRad = Math.PI * 2,
): Vec3 {
  const minSpacing = entityRadius * 1.9 + 0.25;

  for (let attempt = 0; attempt < 32; attempt++) {
    const angle =
      preferredAngleRad !== undefined
        ? preferredAngleRad + rng.range(-angleSpreadRad * 0.5, angleSpreadRad * 0.5)
        : rng.range(0, Math.PI * 2);
    const dist = rng.range(minDist, maxDist);
    const x = center.x + Math.cos(angle) * dist;
    const z = center.z + Math.sin(angle) * dist;

    if (!floor.isWalkableWorld(x, z, entityRadius)) continue;
    if (attempt < 18 && isHazardTile(floor, x, z)) continue;
    if (attempt < 20 && !isClearOfPositions(x, z, minSpacing, occupiedPositions)) continue;

    return { x, y: 0, z };
  }

  // Fallback deterministic ring sweep
  const radii = [minDist, (minDist + maxDist) * 0.5, maxDist, 0.5, 0];
  for (const r of radii) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      if (floor.isWalkableWorld(x, z, entityRadius * 0.8)) {
        return { x, y: 0, z };
      }
    }
  }

  return { x: center.x, y: 0, z: center.z };
}

export function computeSurroundSlot(
  floor: DungeonFloorData,
  enemyPos: Vec3,
  playerPos: Vec3,
  desiredRadius: number,
  surroundOffsetRad: number,
  entityRadius: number,
): Vec3 {
  const directAngle = Math.atan2(enemyPos.z - playerPos.z, enemyPos.x - playerPos.x);
  const blendedAngle = directAngle + normalizeAngle(surroundOffsetRad - directAngle) * 0.65;
  const sx = playerPos.x + Math.cos(blendedAngle) * desiredRadius;
  const sz = playerPos.z + Math.sin(blendedAngle) * desiredRadius;

  if (floor.isWalkableWorld(sx, sz, entityRadius * 0.85)) {
    return { x: sx, y: 0, z: sz };
  }
  return { x: playerPos.x, y: 0, z: playerPos.z };
}

export function computeSeparationForce(
  self: EnemyEntity,
  livingEnemies: readonly EnemyEntity[],
  selfIndexSeed: number,
): { x: number; z: number } {
  let forceX = 0;
  let forceZ = 0;

  for (const other of livingEnemies) {
    if (other.id === self.id || !other.alive) continue;
    const dx = self.position.x - other.position.x;
    const dz = self.position.z - other.position.z;
    const distSq = dx * dx + dz * dz;
    const minSep = self.radius + other.radius + 0.85;
    if (distSq >= minSep * minSep) continue;

    const dist = Math.sqrt(distSq);
    if (dist < 0.001) {
      // Break exact overlap deterministically using entity index angle
      const fallbackAngle = (selfIndexSeed * 2.399963) % (Math.PI * 2);
      forceX += Math.cos(fallbackAngle) * 2.2;
      forceZ += Math.sin(fallbackAngle) * 2.2;
    } else {
      const overlapRatio = (minSep - dist) / minSep;
      const nx = dx / dist;
      const nz = dz / dist;
      // Radial push + slight lateral swirl so crowded melee packs smoothly orbit into open space
      const swirlSign = selfIndexSeed % 2 === 0 ? 1 : -1;
      const tx = -nz * swirlSign * 0.35;
      const tz = nx * swirlSign * 0.35;
      const weight = overlapRatio * overlapRatio * 3.1 + overlapRatio * 0.8;
      forceX += (nx + tx) * weight;
      forceZ += (nz + tz) * weight;
    }
  }

  const mag = Math.hypot(forceX, forceZ);
  if (mag > 2.6) {
    forceX = (forceX / mag) * 2.6;
    forceZ = (forceZ / mag) * 2.6;
  }
  return { x: forceX, z: forceZ };
}

export function moveWithWallSlide(
  floor: DungeonFloorData,
  position: Vec3,
  velX: number,
  velZ: number,
  radius: number,
  dt: number,
): { movedX: number; movedZ: number } {
  if (!Number.isFinite(velX) || !Number.isFinite(velZ) || dt <= 0) {
    return { movedX: 0, movedZ: 0 };
  }

  const startX = position.x;
  const startZ = position.z;
  const stepX = velX * dt;
  const stepZ = velZ * dt;

  if (Math.abs(stepX) < 1e-6 && Math.abs(stepZ) < 1e-6) {
    return { movedX: 0, movedZ: 0 };
  }

  const colRadius = Math.max(0.2, radius * 0.82);

  // Full step
  const fullX = startX + stepX;
  const fullZ = startZ + stepZ;
  if (floor.isWalkableWorld(fullX, fullZ, colRadius)) {
    position.x = fullX;
    position.z = fullZ;
    return { movedX: stepX / dt, movedZ: stepZ / dt };
  }

  // Axis-separated wall sliding
  const canX = Math.abs(stepX) > 1e-5 && floor.isWalkableWorld(fullX, startZ, colRadius);
  const canZ = Math.abs(stepZ) > 1e-5 && floor.isWalkableWorld(startX, fullZ, colRadius);

  if (canX && (!canZ || Math.abs(stepX) >= Math.abs(stepZ))) {
    position.x = fullX;
    return { movedX: stepX / dt, movedZ: 0 };
  }
  if (canZ) {
    position.z = fullZ;
    return { movedX: 0, movedZ: stepZ / dt };
  }

  // Corner deflection (+/- 50 deg around desired velocity)
  const speed = Math.hypot(stepX, stepZ);
  const baseAngle = Math.atan2(stepZ, stepX);
  for (const offset of [0.85, -0.85, 1.35, -1.35]) {
    const a = baseAngle + offset;
    const altX = startX + Math.cos(a) * speed * 0.7;
    const altZ = startZ + Math.sin(a) * speed * 0.7;
    if (floor.isWalkableWorld(altX, altZ, colRadius)) {
      position.x = altX;
      position.z = altZ;
      return { movedX: (altX - startX) / dt, movedZ: (altZ - startZ) / dt };
    }
  }

  // Rescue nudge if an external impulse put the entity slightly inside wall margin
  if (!floor.isWalkableWorld(startX, startZ, colRadius * 0.7)) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const rx = startX + Math.cos(a) * 0.35;
      const rz = startZ + Math.sin(a) * 0.35;
      if (floor.isWalkableWorld(rx, rz, colRadius * 0.7)) {
        position.x = rx;
        position.z = rz;
        break;
      }
    }
  }

  return { movedX: 0, movedZ: 0 };
}
