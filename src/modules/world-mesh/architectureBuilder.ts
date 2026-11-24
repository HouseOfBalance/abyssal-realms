import * as THREE from 'three';
import { SeededRng } from '../../core/Constants';
import type {
  DungeonFloorData,
  IMaterialLibrary,
  Vec3,
} from '../../contracts/types';
import {
  BIOME_PALETTES,
  findArchwayPlacements,
  type GridAccessor,
  isHazardTile,
} from './gridUtils';
import { createGroundMistMaterial } from './shaders';

const WALL_HEIGHT = 3.6;
const WALL_BASE_Y = -0.26;
const WALL_CHUNK_TILES = 2;

interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

class GeometryAccumulator {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  addQuad(
    p0: Vec3Tuple,
    p1: Vec3Tuple,
    p2: Vec3Tuple,
    p3: Vec3Tuple,
    normal: Vec3Tuple,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const base = this.positions.length / 3;
    this.positions.push(
      p0.x, p0.y, p0.z,
      p1.x, p1.y, p1.z,
      p2.x, p2.y, p2.z,
      p3.x, p3.y, p3.z,
    );
    this.normals.push(
      normal.x, normal.y, normal.z,
      normal.x, normal.y, normal.z,
      normal.x, normal.y, normal.z,
      normal.x, normal.y, normal.z,
    );
    this.uvs.push(
      u0, v0,
      u1, v0,
      u1, v1,
      u0, v1,
    );

    // Ensure outward CCW winding matches `normal`
    const e1x = p1.x - p0.x;
    const e1y = p1.y - p0.y;
    const e1z = p1.z - p0.z;
    const e2x = p2.x - p0.x;
    const e2y = p2.y - p0.y;
    const e2z = p2.z - p0.z;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const dot = cx * normal.x + cy * normal.y + cz * normal.z;

    if (dot >= 0) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  addBox(
    cx: number,
    y0: number,
    y1: number,
    cz: number,
    halfX: number,
    halfZ: number,
    uvTileUnit = 2.0,
    faces: {
      px?: boolean;
      nx?: boolean;
      py?: boolean;
      ny?: boolean;
      pz?: boolean;
      nz?: boolean;
    } = { px: true, nx: true, py: true, ny: false, pz: true, nz: true },
  ): void {
    const x0 = cx - halfX;
    const x1 = cx + halfX;
    const z0 = cz - halfZ;
    const z1 = cz + halfZ;
    const uX = (halfX * 2) / uvTileUnit;
    const uZ = (halfZ * 2) / uvTileUnit;
    const vY = (y1 - y0) / uvTileUnit;

    if (faces.pz) {
      this.addQuad(
        { x: x0, y: y0, z: z1 },
        { x: x1, y: y0, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x0, y: y1, z: z1 },
        { x: 0, y: 0, z: 1 },
        0, 0, uX, vY,
      );
    }
    if (faces.nz) {
      this.addQuad(
        { x: x1, y: y0, z: z0 },
        { x: x0, y: y0, z: z0 },
        { x: x0, y: y1, z: z0 },
        { x: x1, y: y1, z: z0 },
        { x: 0, y: 0, z: -1 },
        0, 0, uX, vY,
      );
    }
    if (faces.px) {
      this.addQuad(
        { x: x1, y: y0, z: z1 },
        { x: x1, y: y0, z: z0 },
        { x: x1, y: y1, z: z0 },
        { x: x1, y: y1, z: z1 },
        { x: 1, y: 0, z: 0 },
        0, 0, uZ, vY,
      );
    }
    if (faces.nx) {
      this.addQuad(
        { x: x0, y: y0, z: z0 },
        { x: x0, y: y0, z: z1 },
        { x: x0, y: y1, z: z1 },
        { x: x0, y: y1, z: z0 },
        { x: -1, y: 0, z: 0 },
        0, 0, uZ, vY,
      );
    }
    if (faces.py) {
      this.addQuad(
        { x: x0, y: y1, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x1, y: y1, z: z0 },
        { x: x0, y: y1, z: z0 },
        { x: 0, y: 1, z: 0 },
        0, 0, uX, uZ,
      );
    }
    if (faces.ny) {
      this.addQuad(
        { x: x0, y: y0, z: z0 },
        { x: x1, y: y0, z: z0 },
        { x: x1, y: y0, z: z1 },
        { x: x0, y: y0, z: z1 },
        { x: 0, y: -1, z: 0 },
        0, 0, uX, uZ,
      );
    }
  }

  addOctagonalColumn(
    cx: number,
    y0: number,
    y1: number,
    cz: number,
    radiusBottom: number,
    radiusTop: number,
    capTop = true,
  ): void {
    const sides = 8;
    const vSpan = Math.max(0.2, (y1 - y0) * 0.5);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2 + Math.PI / 8;
      const a1 = ((i + 1) / sides) * Math.PI * 2 + Math.PI / 8;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const nx = Math.cos((a0 + a1) * 0.5);
      const nz = Math.sin((a0 + a1) * 0.5);

      this.addQuad(
        { x: cx + c0 * radiusBottom, y: y0, z: cz + s0 * radiusBottom },
        { x: cx + c1 * radiusBottom, y: y0, z: cz + s1 * radiusBottom },
        { x: cx + c1 * radiusTop, y: y1, z: cz + s1 * radiusTop },
        { x: cx + c0 * radiusTop, y: y1, z: cz + s0 * radiusTop },
        { x: nx, y: 0, z: nz },
        i / sides,
        0,
        (i + 1) / sides,
        vSpan,
      );
    }

    if (capTop) {
      const base = this.positions.length / 3;
      this.positions.push(cx, y1, cz);
      this.normals.push(0, 1, 0);
      this.uvs.push(0.5, 0.5);
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + Math.PI / 8;
        const c = Math.cos(a);
        const s = Math.sin(a);
        this.positions.push(cx + c * radiusTop, y1, cz + s * radiusTop);
        this.normals.push(0, 1, 0);
        this.uvs.push(0.5 + c * 0.5, 0.5 + s * 0.5);
      }
      for (let i = 0; i < sides; i++) {
        const i0 = base + 1 + i;
        const i1 = base + 1 + ((i + 1) % sides);
        // Check CCW around +Y: from +Y, X right, Z down; decreasing angle or (i1, i0)
        this.indices.push(base, i1, i0);
      }
    }
  }

  addOrientedBox(
    localCenter: Vec3Tuple,
    halfSize: Vec3Tuple,
    origin: Vec3Tuple,
    rotY: number,
    rotZ = 0,
  ): void {
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosZ = Math.cos(rotZ);
    const sinZ = Math.sin(rotZ);

    const xformPoint = (lx: number, ly: number, lz: number): Vec3Tuple => {
      // Rotate around Z in local arch plane first, then translate localCenter, then rotate Y
      const rzX = lx * cosZ - ly * sinZ + localCenter.x;
      const rzY = lx * sinZ + ly * cosZ + localCenter.y;
      const rzZ = lz + localCenter.z;
      return {
        x: origin.x + rzX * cosY + rzZ * sinY,
        y: origin.y + rzY,
        z: origin.z - rzX * sinY + rzZ * cosY,
      };
    };

    const xformNormal = (nx: number, ny: number, nz: number): Vec3Tuple => {
      const rzX = nx * cosZ - ny * sinZ;
      const rzY = nx * sinZ + ny * cosZ;
      return {
        x: rzX * cosY + nz * sinY,
        y: rzY,
        z: -rzX * sinY + nz * cosY,
      };
    };

    const hx = halfSize.x;
    const hy = halfSize.y;
    const hz = halfSize.z;

    // +Z
    this.addQuad(
      xformPoint(-hx, -hy, hz),
      xformPoint(hx, -hy, hz),
      xformPoint(hx, hy, hz),
      xformPoint(-hx, hy, hz),
      xformNormal(0, 0, 1),
      0, 0, hx, hy,
    );
    // -Z
    this.addQuad(
      xformPoint(hx, -hy, -hz),
      xformPoint(-hx, -hy, -hz),
      xformPoint(-hx, hy, -hz),
      xformPoint(hx, hy, -hz),
      xformNormal(0, 0, -1),
      0, 0, hx, hy,
    );
    // +X
    this.addQuad(
      xformPoint(hx, -hy, hz),
      xformPoint(hx, -hy, -hz),
      xformPoint(hx, hy, -hz),
      xformPoint(hx, hy, hz),
      xformNormal(1, 0, 0),
      0, 0, hz, hy,
    );
    // -X
    this.addQuad(
      xformPoint(-hx, -hy, -hz),
      xformPoint(-hx, -hy, hz),
      xformPoint(-hx, hy, hz),
      xformPoint(-hx, hy, -hz),
      xformNormal(-1, 0, 0),
      0, 0, hz, hy,
    );
    // +Y
    this.addQuad(
      xformPoint(-hx, hy, hz),
      xformPoint(hx, hy, hz),
      xformPoint(hx, hy, -hz),
      xformPoint(-hx, hy, -hz),
      xformNormal(0, 1, 0),
      0, 0, hx, hz,
    );
    // -Y
    this.addQuad(
      xformPoint(-hx, -hy, -hz),
      xformPoint(hx, -hy, -hz),
      xformPoint(hx, -hy, hz),
      xformPoint(-hx, -hy, hz),
      xformNormal(0, -1, 0),
      0, 0, hx, hz,
    );
  }

  toBufferGeometry(): THREE.BufferGeometry {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geom.setIndex(this.indices);
    geom.computeBoundingSphere();
    geom.computeBoundingBox();
    return geom;
  }
}

interface BubbleParticleSeed {
  x: number;
  yBase: number;
  z: number;
  speed: number;
  phase: number;
  maxScale: number;
}

export interface ArchitectureBuildResult {
  group: THREE.Group;
  wallOccluderMeshes: THREE.Object3D[];
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
  setPlayerPosition(playerPos: Vec3): void;
  update(dt: number, elapsedSec: number): void;
}

export function buildDungeonArchitecture(
  floor: DungeonFloorData,
  grid: GridAccessor,
  materials: IMaterialLibrary,
): ArchitectureBuildResult {
  const group = new THREE.Group();
  group.name = 'DungeonArchitecture';

  const wallOccluderMeshes: THREE.Object3D[] = [];
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];

  const palette = BIOME_PALETTES[floor.biome] ?? BIOME_PALETTES.crypt;
  const rng = new SeededRng((floor.seed ^ 0x9e3779b9) >>> 0);
  const { cols, rows, tileSize, baseY } = grid;
  const halfTile = tileSize * 0.5;

  // ---------------------------------------------------------------------------
  // 1. Collect Open Floor Tiles, Door Thresholds & Lava/Poison Hazard Tiles
  // ---------------------------------------------------------------------------
  interface FloorTileRecord {
    col: number;
    row: number;
    world: Vec3;
    isDoor: boolean;
    nearWall: boolean;
  }
  const walkableTiles: FloorTileRecord[] = [];
  const lavaTiles: Vec3[] = [];
  const poisonTiles: Vec3[] = [];
  const iceTiles: Vec3[] = [];
  const teleporterTiles: Vec3[] = [];
  const allOpenWorlds: Vec3[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = grid.getTile(c, r);
      if (!grid.isOpen(c, r)) continue;
      const world = grid.cellToWorld(c, r);
      allOpenWorlds.push(world);

      if (t === 'hazard_lava') {
        lavaTiles.push(world);
      } else if (t === 'hazard_poison') {
        poisonTiles.push(world);
      } else if (t === 'hazard_ice') {
        iceTiles.push(world);
      } else {
        if (t === 'teleporter_pad') {
          teleporterTiles.push(world);
        }
        const nearWall =
          !grid.isOpen(c + 1, r) ||
          !grid.isOpen(c - 1, r) ||
          !grid.isOpen(c, r + 1) ||
          !grid.isOpen(c, r - 1);
        walkableTiles.push({
          col: c,
          row: r,
          world,
          isDoor: t === 'door' || t === 'teleporter_pad',
          nearWall,
        });
      }
    }
  }

  const dummy = new THREE.Object3D();
  const tempColor = new THREE.Color();

  // Dark mortar sub-bed under all open + hazard tiles (prevents void cracks)
  if (allOpenWorlds.length > 0) {
    const subBedGeom = new THREE.BoxGeometry(tileSize * 1.02, 0.24, tileSize * 1.02);
    ownedGeometries.push(subBedGeom);
    const subBedMat = materials.clone(palette.wallKey);
    subBedMat.color.multiplyScalar(0.38);
    ownedMaterials.push(subBedMat);

    const subBedInst = new THREE.InstancedMesh(subBedGeom, subBedMat, allOpenWorlds.length);
    subBedInst.name = 'FloorSubBed';
    subBedInst.receiveShadow = true;
    for (let i = 0; i < allOpenWorlds.length; i++) {
      const w = allOpenWorlds[i];
      dummy.position.set(w.x, baseY - 0.26, w.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      subBedInst.setMatrixAt(i, dummy.matrix);
    }
    subBedInst.instanceMatrix.needsUpdate = true;
    group.add(subBedInst);
  }

  // Main Flagstone Floor InstancedMesh (height + 90-deg rotation + tint variation)
  if (walkableTiles.length > 0) {
    const slabThickness = 0.22;
    const tileGeom = new THREE.BoxGeometry(
      tileSize * 0.985,
      slabThickness,
      tileSize * 0.985,
    );
    ownedGeometries.push(tileGeom);

    const floorMat = materials.get(palette.floorKey);
    const floorInst = new THREE.InstancedMesh(tileGeom, floorMat, walkableTiles.length);
    floorInst.name = 'FloorTilesInstanced';
    floorInst.receiveShadow = true;
    floorInst.castShadow = false;

    for (let i = 0; i < walkableTiles.length; i++) {
      const rec = walkableTiles[i];
      const yJitter = rec.isDoor ? 0.008 : rng.range(-0.022, 0.022);
      const rotQuarter = rng.int(0, 3) * (Math.PI * 0.5);
      const tiltX = rng.range(-0.0055, 0.0055);
      const tiltZ = rng.range(-0.0055, 0.0055);
      const scaleXZ = rng.range(0.988, 1.004);

      dummy.position.set(rec.world.x, baseY - slabThickness * 0.5 + yJitter, rec.world.z);
      dummy.rotation.set(tiltX, rotQuarter, tiltZ);
      dummy.scale.set(scaleXZ, 1, scaleXZ);
      dummy.updateMatrix();
      floorInst.setMatrixAt(i, dummy.matrix);

      const shade = rec.nearWall
        ? rng.range(0.82, 0.96)
        : rec.isDoor
          ? rng.range(1.02, 1.1)
          : rng.range(0.9, 1.07);
      tempColor.setRGB(shade, shade * rng.range(0.98, 1.02), shade * rng.range(0.97, 1.03));
      floorInst.setColorAt(i, tempColor);
    }
    floorInst.instanceMatrix.needsUpdate = true;
    if (floorInst.instanceColor) floorInst.instanceColor.needsUpdate = true;
    group.add(floorInst);
  }

  // Ornate Floor Medallions in Spawn / Shrine / Treasure / Boss Room Centers
  if (floor.rooms && floor.rooms.length > 0) {
    const specialRooms = floor.rooms.filter(
      (rm) =>
        rm.type === 'spawn' ||
        rm.type === 'boss' ||
        rm.type === 'shrine' ||
        rm.type === 'treasure' ||
        rm.type === 'cursed_event',
    );
    if (specialRooms.length > 0) {
      const ringGeom = new THREE.RingGeometry(tileSize * 0.85, tileSize * 1.05, 24);
      ringGeom.rotateX(-Math.PI * 0.5);
      ownedGeometries.push(ringGeom);

      const ringMat = materials.clone(palette.runeKey);
      ringMat.transparent = true;
      ringMat.opacity = 0.65;
      ringMat.depthWrite = false;
      ownedMaterials.push(ringMat);

      const ringInst = new THREE.InstancedMesh(ringGeom, ringMat, specialRooms.length);
      ringInst.name = 'RoomFloorInlays';
      for (let i = 0; i < specialRooms.length; i++) {
        const rm = specialRooms[i];
        const scale = rm.type === 'boss' ? 1.85 : rm.type === 'spawn' ? 1.25 : 1.0;
        dummy.position.set(rm.centerWorld.x, baseY + 0.026, rm.centerWorld.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(scale, 1, scale);
        dummy.updateMatrix();
        ringInst.setMatrixAt(i, dummy.matrix);
      }
      ringInst.instanceMatrix.needsUpdate = true;
      group.add(ringInst);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Glowing Lava & Poison Hazard Tiles + Bubbling Surface Particles
  // ---------------------------------------------------------------------------
  let lavaMat: THREE.MeshStandardMaterial | null = null;
  let poisonMat: THREE.MeshStandardMaterial | null = null;
  let lavaBubblesInst: THREE.InstancedMesh | null = null;
  let poisonBubblesInst: THREE.InstancedMesh | null = null;
  const lavaBubbleSeeds: BubbleParticleSeed[] = [];
  const poisonBubbleSeeds: BubbleParticleSeed[] = [];

  const totalHazards = lavaTiles.length + poisonTiles.length;
  if (totalHazards > 0) {
    // Carved stone rim frame around sunken lava/poison tiles bordering walkable floor
    const rimAccum = new GeometryAccumulator();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid.getTile(c, r);
        if (t !== 'hazard_lava' && t !== 'hazard_poison') continue;
        const w = grid.cellToWorld(c, r);
        const rimThick = 0.14;
        const rimTop = baseY + 0.04;
        const rimBot = baseY - 0.16;

        // Add stone lip along edges touching non-sunken open tiles
        const nTile = grid.getTile(c, r - 1);
        const sTile = grid.getTile(c, r + 1);
        const wTile = grid.getTile(c - 1, r);
        const eTile = grid.getTile(c + 1, r);
        const isSunken = (tt: string) => tt === 'hazard_lava' || tt === 'hazard_poison';

        if (grid.isOpen(c, r - 1) && !isSunken(nTile)) {
          rimAccum.addBox(w.x, rimBot, rimTop, w.z - halfTile + rimThick * 0.5, halfTile, rimThick * 0.5, tileSize);
        }
        if (grid.isOpen(c, r + 1) && !isSunken(sTile)) {
          rimAccum.addBox(w.x, rimBot, rimTop, w.z + halfTile - rimThick * 0.5, halfTile, rimThick * 0.5, tileSize);
        }
        if (grid.isOpen(c - 1, r) && !isSunken(wTile)) {
          rimAccum.addBox(w.x - halfTile + rimThick * 0.5, rimBot, rimTop, w.z, rimThick * 0.5, halfTile, tileSize);
        }
        if (grid.isOpen(c + 1, r) && !isSunken(eTile)) {
          rimAccum.addBox(w.x + halfTile - rimThick * 0.5, rimBot, rimTop, w.z, rimThick * 0.5, halfTile, tileSize);
        }
      }
    }
    if (!rimAccum.isEmpty) {
      const rimGeom = rimAccum.toBufferGeometry();
      ownedGeometries.push(rimGeom);
      const rimMesh = new THREE.Mesh(rimGeom, materials.get(palette.wallKey));
      rimMesh.name = 'HazardPitRims';
      rimMesh.receiveShadow = true;
      rimMesh.castShadow = true;
      group.add(rimMesh);
    }
  }

  if (lavaTiles.length > 0) {
    const lavaGeom = new THREE.BoxGeometry(tileSize * 0.99, 0.12, tileSize * 0.99);
    ownedGeometries.push(lavaGeom);

    lavaMat = materials.clone('lava_emissive');
    lavaMat.emissive = new THREE.Color(0xff4500);
    lavaMat.emissiveIntensity = 1.65;
    lavaMat.roughness = 0.32;
    ownedMaterials.push(lavaMat);

    const lavaInst = new THREE.InstancedMesh(lavaGeom, lavaMat, lavaTiles.length);
    lavaInst.name = 'HazardLavaTiles';
    for (let i = 0; i < lavaTiles.length; i++) {
      const w = lavaTiles[i];
      dummy.position.set(w.x, baseY - 0.11, w.z);
      dummy.rotation.set(0, rng.int(0, 3) * (Math.PI * 0.5), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lavaInst.setMatrixAt(i, dummy.matrix);
    }
    lavaInst.instanceMatrix.needsUpdate = true;
    group.add(lavaInst);

    // Floating obsidian slag crusts + bubbling magma spheres
    const bubbleCount = Math.min(96, lavaTiles.length * 2);
    const bubbleGeom = new THREE.IcosahedronGeometry(0.14, 1);
    ownedGeometries.push(bubbleGeom);
    lavaBubblesInst = new THREE.InstancedMesh(bubbleGeom, lavaMat, bubbleCount);
    lavaBubblesInst.name = 'LavaBubbles';
    for (let i = 0; i < bubbleCount; i++) {
      const host = lavaTiles[i % lavaTiles.length];
      lavaBubbleSeeds.push({
        x: host.x + rng.range(-halfTile * 0.7, halfTile * 0.7),
        yBase: baseY - 0.06,
        z: host.z + rng.range(-halfTile * 0.7, halfTile * 0.7),
        speed: rng.range(1.2, 2.6),
        phase: rng.range(0, Math.PI * 2),
        maxScale: rng.range(0.55, 1.35),
      });
    }
    group.add(lavaBubblesInst);
  }

  if (poisonTiles.length > 0) {
    const poisonGeom = new THREE.BoxGeometry(tileSize * 0.99, 0.12, tileSize * 0.99);
    ownedGeometries.push(poisonGeom);

    poisonMat = materials.clone('rune_glow_emerald');
    poisonMat.color = new THREE.Color(0x1f9d4c);
    poisonMat.emissive = new THREE.Color(0x2be866);
    poisonMat.emissiveIntensity = 1.25;
    poisonMat.roughness = 0.16;
    poisonMat.metalness = 0.08;
    ownedMaterials.push(poisonMat);

    const poisonInst = new THREE.InstancedMesh(poisonGeom, poisonMat, poisonTiles.length);
    poisonInst.name = 'HazardPoisonTiles';
    for (let i = 0; i < poisonTiles.length; i++) {
      const w = poisonTiles[i];
      dummy.position.set(w.x, baseY - 0.11, w.z);
      dummy.rotation.set(0, rng.int(0, 3) * (Math.PI * 0.5), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poisonInst.setMatrixAt(i, dummy.matrix);
    }
    poisonInst.instanceMatrix.needsUpdate = true;
    group.add(poisonInst);

    const bubbleCount = Math.min(96, poisonTiles.length * 2);
    const bubbleGeom = new THREE.SphereGeometry(0.11, 8, 6);
    ownedGeometries.push(bubbleGeom);
    poisonBubblesInst = new THREE.InstancedMesh(bubbleGeom, poisonMat, bubbleCount);
    poisonBubblesInst.name = 'PoisonBubbles';
    for (let i = 0; i < bubbleCount; i++) {
      const host = poisonTiles[i % poisonTiles.length];
      poisonBubbleSeeds.push({
        x: host.x + rng.range(-halfTile * 0.72, halfTile * 0.72),
        yBase: baseY - 0.05,
        z: host.z + rng.range(-halfTile * 0.72, halfTile * 0.72),
        speed: rng.range(1.4, 2.9),
        phase: rng.range(0, Math.PI * 2),
        maxScale: rng.range(0.5, 1.3),
      });
    }
    group.add(poisonBubblesInst);
  }

  // Specular Crystalline Ice Hazard Sheets (`hazard_ice`)
  let iceSheetMat: THREE.MeshStandardMaterial | null = null;
  if (iceTiles.length > 0) {
    const iceUnderGeom = new THREE.BoxGeometry(tileSize * 0.99, 0.14, tileSize * 0.99);
    ownedGeometries.push(iceUnderGeom);
    const iceUnderInst = new THREE.InstancedMesh(
      iceUnderGeom,
      materials.get('floor_cathedral'),
      iceTiles.length,
    );
    iceUnderInst.name = 'HazardIceUnderbed';
    for (let i = 0; i < iceTiles.length; i++) {
      const w = iceTiles[i];
      dummy.position.set(w.x, baseY - 0.11, w.z);
      dummy.rotation.set(0, rng.int(0, 3) * (Math.PI * 0.5), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      iceUnderInst.setMatrixAt(i, dummy.matrix);
    }
    iceUnderInst.instanceMatrix.needsUpdate = true;
    group.add(iceUnderInst);

    const iceSheetGeom = new THREE.BoxGeometry(tileSize * 0.995, 0.065, tileSize * 0.995);
    ownedGeometries.push(iceSheetGeom);

    iceSheetMat = materials.clone('ice_glacier');
    iceSheetMat.roughness = 0.06;
    iceSheetMat.metalness = 0.18;
    iceSheetMat.transparent = true;
    iceSheetMat.opacity = 0.88;
    iceSheetMat.emissive = new THREE.Color(0x38bdf8);
    iceSheetMat.emissiveIntensity = 0.42;
    ownedMaterials.push(iceSheetMat);

    const iceInst = new THREE.InstancedMesh(iceSheetGeom, iceSheetMat, iceTiles.length);
    iceInst.name = 'HazardIceTiles';
    iceInst.receiveShadow = true;
    for (let i = 0; i < iceTiles.length; i++) {
      const w = iceTiles[i];
      dummy.position.set(w.x, baseY - 0.012, w.z);
      dummy.rotation.set(0, rng.int(0, 3) * (Math.PI * 0.5), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      iceInst.setMatrixAt(i, dummy.matrix);
    }
    iceInst.instanceMatrix.needsUpdate = true;
    group.add(iceInst);

    // Specular rime frost crystal clusters scattered near ice sheet edges
    const crystalCount = Math.min(80, iceTiles.length * 2);
    const crystalGeom = new THREE.ConeGeometry(0.08, 0.28, 6);
    ownedGeometries.push(crystalGeom);
    const frostCrystalsInst = new THREE.InstancedMesh(
      crystalGeom,
      materials.get('crystal_cyan'),
      crystalCount,
    );
    frostCrystalsInst.name = 'HazardIceCrystals';
    for (let i = 0; i < crystalCount; i++) {
      const host = iceTiles[i % iceTiles.length];
      const angle = rng.range(0, Math.PI * 2);
      const rad = rng.range(halfTile * 0.52, halfTile * 0.86);
      dummy.position.set(
        host.x + Math.cos(angle) * rad,
        baseY + 0.08,
        host.z + Math.sin(angle) * rad,
      );
      dummy.rotation.set(rng.range(-0.28, 0.28), angle, rng.range(-0.28, 0.28));
      const sc = rng.range(0.65, 1.25);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      frostCrystalsInst.setMatrixAt(i, dummy.matrix);
    }
    frostCrystalsInst.instanceMatrix.needsUpdate = true;
    group.add(frostCrystalsInst);
  }

  // Glowing Twin Astral Warp Rings (`teleporter_pad`)
  interface TeleporterRingAnim {
    outerRing: THREE.Mesh;
    innerRing: THREE.Mesh;
    auraDisc: THREE.Mesh;
    phase: number;
  }
  const teleporterAnims: TeleporterRingAnim[] = [];

  if (teleporterTiles.length > 0) {
    const padsGroup = new THREE.Group();
    padsGroup.name = 'TeleporterPads';

    const bezelGeom = new THREE.CylinderGeometry(0.86, 0.96, 0.06, 8);
    const outerRingGeom = new THREE.TorusGeometry(0.74, 0.045, 8, 28);
    outerRingGeom.rotateX(Math.PI * 0.5);
    const innerRingGeom = new THREE.TorusGeometry(0.48, 0.038, 8, 24);
    innerRingGeom.rotateX(Math.PI * 0.5);
    const auraGeom = new THREE.RingGeometry(0.18, 0.68, 24);
    auraGeom.rotateX(-Math.PI * 0.5);
    ownedGeometries.push(bezelGeom, outerRingGeom, innerRingGeom, auraGeom);

    const brassMat = materials.get('brass_clockwork');
    const outerWarpMat = materials.clone('rune_glow_blue');
    outerWarpMat.emissive = new THREE.Color(0x38bdf8);
    outerWarpMat.emissiveIntensity = 1.9;
    const innerWarpMat = materials.clone('rune_glow_void');
    innerWarpMat.emissive = new THREE.Color(0xc084fc);
    innerWarpMat.emissiveIntensity = 2.1;
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0x56cfe1,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    ownedMaterials.push(outerWarpMat, innerWarpMat, auraMat);

    for (let i = 0; i < teleporterTiles.length; i++) {
      const w = teleporterTiles[i];
      const padRoot = new THREE.Group();
      padRoot.name = `TeleporterPad_${i}`;
      padRoot.position.set(w.x, baseY, w.z);

      const bezel = new THREE.Mesh(bezelGeom, brassMat);
      bezel.position.set(0, 0.03, 0);
      bezel.receiveShadow = true;
      padRoot.add(bezel);

      const outerRing = new THREE.Mesh(outerRingGeom, outerWarpMat);
      outerRing.position.set(0, 0.08, 0);
      padRoot.add(outerRing);

      const innerRing = new THREE.Mesh(innerRingGeom, innerWarpMat);
      innerRing.position.set(0, 0.22, 0);
      padRoot.add(innerRing);

      const auraDisc = new THREE.Mesh(auraGeom, auraMat);
      auraDisc.position.set(0, 0.068, 0);
      auraDisc.renderOrder = 3;
      padRoot.add(auraDisc);

      padsGroup.add(padRoot);
      teleporterAnims.push({
        outerRing,
        innerRing,
        auraDisc,
        phase: i * 1.57,
      });
    }

    group.add(padsGroup);
  }

  // Rotating 3D `brass_clockwork` Gear Assemblies in `'observatory'` Biome
  interface ClockworkGearSpinner {
    pivot: THREE.Group;
    axis: 'y' | 'z';
    speedRadSec: number;
  }
  const clockworkSpinners: ClockworkGearSpinner[] = [];

  if (floor.biome === 'observatory') {
    const clockworkGroup = new THREE.Group();
    clockworkGroup.name = 'ObservatoryClockworkGears';

    const brassMat = materials.get('brass_clockwork');
    const goldMat = materials.get('metal_gold');
    const runeMat = materials.get('rune_glow_void');

    const buildCogwheelGeometry = (radius: number, thickness: number, teeth: number): THREE.BufferGeometry => {
      const cogAccum = new GeometryAccumulator();
      // Outer rim cylinder approximated via octagonal/polygonal column + protruding gear teeth + cross spokes
      cogAccum.addOctagonalColumn(0, -thickness * 0.5, thickness * 0.5, 0, radius, radius, true);
      const spokeHalfW = radius * 0.11;
      cogAccum.addBox(0, -thickness * 0.6, thickness * 0.6, 0, radius * 0.88, spokeHalfW, radius);
      cogAccum.addBox(0, -thickness * 0.6, thickness * 0.6, 0, spokeHalfW, radius * 0.88, radius);

      const toothHalfW = (Math.PI * radius) / (teeth * 2.1);
      const toothLen = radius * 0.22;
      for (let t = 0; t < teeth; t++) {
        const a = (t / teeth) * Math.PI * 2;
        const tx = Math.sin(a) * (radius + toothLen * 0.38);
        const tz = Math.cos(a) * (radius + toothLen * 0.38);
        cogAccum.addOrientedBox(
          { x: 0, y: 0, z: 0 },
          { x: toothHalfW, y: thickness * 0.48, z: toothLen * 0.5 },
          { x: tx, y: 0, z: tz },
          a,
        );
      }
      return cogAccum.toBufferGeometry();
    };

    const largeCogGeom = buildCogwheelGeometry(1.15, 0.08, 14);
    const medCogGeom = buildCogwheelGeometry(0.68, 0.09, 10);
    const hubCapGeom = new THREE.CylinderGeometry(0.22, 0.26, 0.14, 8);
    ownedGeometries.push(largeCogGeom, medCogGeom, hubCapGeom);

    const roomsList = floor.rooms && floor.rooms.length > 0
      ? floor.rooms
      : [{ centerWorld: floor.playerSpawn, x: 2, y: 2, width: 8, height: 8 }];

    for (let i = 0; i < roomsList.length; i++) {
      const rm = roomsList[i];
      // 1) Flush inlaid celestial floor orrery gear pair near room center
      const mainPivot = new THREE.Group();
      mainPivot.position.set(rm.centerWorld.x, baseY + 0.015, rm.centerWorld.z);
      const mainCog = new THREE.Mesh(largeCogGeom, brassMat);
      mainCog.receiveShadow = true;
      mainPivot.add(mainCog);
      const mainHub = new THREE.Mesh(hubCapGeom, runeMat);
      mainPivot.add(mainHub);
      clockworkGroup.add(mainPivot);
      clockworkSpinners.push({ pivot: mainPivot, axis: 'y', speedRadSec: 0.48 });

      // Interlocking counter-rotating satellite pinion cog
      const satDist = 1.15 + 0.68 + 0.09;
      const satAngle = i * 1.3 + 0.6;
      const satPivot = new THREE.Group();
      satPivot.position.set(
        rm.centerWorld.x + Math.cos(satAngle) * satDist,
        baseY + 0.02,
        rm.centerWorld.z + Math.sin(satAngle) * satDist,
      );
      const satCog = new THREE.Mesh(medCogGeom, goldMat);
      satCog.receiveShadow = true;
      satPivot.add(satCog);
      clockworkGroup.add(satPivot);
      clockworkSpinners.push({
        pivot: satPivot,
        axis: 'y',
        speedRadSec: -0.48 * (14 / 10),
      });

      // 2) Vertical wall-mounted clockwork gear train along north wall of room (every 2nd room + spawn/boss)
      if (i % 2 === 0 && 'y' in rm && typeof rm.y === 'number') {
        const northCell = grid.cellToWorld(
          Math.floor(rm.x + rm.width * 0.5),
          Math.max(0, rm.y - 1),
        );
        const wallMount = new THREE.Group();
        wallMount.position.set(northCell.x, baseY + 2.15, northCell.z + halfTile + 0.12);

        const wallGearA = new THREE.Group();
        const wgMeshA = new THREE.Mesh(medCogGeom, brassMat);
        wgMeshA.rotation.x = Math.PI * 0.5;
        wallGearA.add(wgMeshA);
        wallMount.add(wallGearA);
        clockworkSpinners.push({ pivot: wallGearA, axis: 'z', speedRadSec: 0.85 });

        const wallGearB = new THREE.Group();
        wallGearB.position.set(1.18, 0.46, 0.03);
        const wgMeshB = new THREE.Mesh(medCogGeom, goldMat);
        wgMeshB.rotation.x = Math.PI * 0.5;
        wallGearB.add(wgMeshB);
        wallMount.add(wallGearB);
        clockworkSpinners.push({ pivot: wallGearB, axis: 'z', speedRadSec: -0.85 });

        clockworkGroup.add(wallMount);
      }
    }

    group.add(clockworkGroup);
  }

  // ---------------------------------------------------------------------------
  // 3. Perimeter Walls + Corner Stone Pillars (Chunked for Camera Occlusion!)
  // ---------------------------------------------------------------------------
  // Identify all solid cells (including 1-cell border [-1..cols] x [-1..rows])
  // that touch at least one open tile in their 8-neighborhood.
  const perimSet = new Set<string>();
  const keyOf = (c: number, r: number): string => `${c},${r}`;

  interface PerimCell {
    col: number;
    row: number;
    world: Vec3;
  }
  const perimCells: PerimCell[] = [];

  for (let r = -1; r <= rows; r++) {
    for (let c = -1; c <= cols; c++) {
      if (grid.isOpen(c, r)) continue;
      let touchesOpen = false;
      for (let dr = -1; dr <= 1 && !touchesOpen; dr++) {
        for (let dc = -1; dc <= 1 && !touchesOpen; dc++) {
          if (dc === 0 && dr === 0) continue;
          if (grid.isOpen(c + dc, r + dr)) {
            touchesOpen = true;
          }
        }
      }
      if (touchesOpen) {
        perimSet.add(keyOf(c, r));
        perimCells.push({
          col: c,
          row: r,
          world: grid.cellToWorld(c, r),
        });
      }
    }
  }

  // Group perimeter wall cells into 2x2 spatial chunks so `getWallMeshesForOcclusion()`
  // gives CameraRig compact foreground wall segments with independent cloned materials.
  const chunkBuckets = new Map<string, PerimCell[]>();
  for (const cell of perimCells) {
    const cc = Math.floor((cell.col + 1) / WALL_CHUNK_TILES);
    const cr = Math.floor((cell.row + 1) / WALL_CHUNK_TILES);
    const ck = `${cc}_${cr}`;
    let bucket = chunkBuckets.get(ck);
    if (!bucket) {
      bucket = [];
      chunkBuckets.set(ck, bucket);
    }
    bucket.push(cell);
  }

  const wallTopBase = baseY + WALL_HEIGHT;

  for (const [chunkId, cells] of chunkBuckets.entries()) {
    const accum = new GeometryAccumulator();

    for (const cell of cells) {
      const { col: c, row: r, world: w } = cell;
      const wallHeightVar = (((c * 73856093) ^ (r * 19349663)) & 7) * 0.018;
      const topY = wallTopBase + wallHeightVar;
      const botY = baseY + WALL_BASE_Y;

      const hasPerimN = perimSet.has(keyOf(c, r - 1));
      const hasPerimS = perimSet.has(keyOf(c, r + 1));
      const hasPerimW = perimSet.has(keyOf(c - 1, r));
      const hasPerimE = perimSet.has(keyOf(c + 1, r));

      // Main masonry block — omit shared faces between adjacent perimeter wall cells
      // so semi-transparent wall occlusion fade has zero internal seam artifacts!
      accum.addBox(w.x, botY, topY, w.z, halfTile, halfTile, tileSize, {
        nz: !hasPerimN,
        pz: !hasPerimS,
        nx: !hasPerimW,
        px: !hasPerimE,
        py: true,
        ny: false,
      });

      const openN = grid.isOpen(c, r - 1);
      const openS = grid.isOpen(c, r + 1);
      const openW = grid.isOpen(c - 1, r);
      const openE = grid.isOpen(c + 1, r);

      // Stepped stone base plinth & upper cornice molding on room-facing wall faces
      const plinthOut = 0.075;
      const plinthH = baseY + 0.36;
      const corniceBot = topY - 0.24;
      const corniceOut = 0.065;

      if (openS) {
        accum.addBox(w.x, baseY - 0.05, plinthH, w.z + halfTile + plinthOut * 0.5, halfTile, plinthOut * 0.5, tileSize);
        accum.addBox(w.x, corniceBot, topY, w.z + halfTile + corniceOut * 0.5, halfTile, corniceOut * 0.5, tileSize);
      }
      if (openN) {
        accum.addBox(w.x, baseY - 0.05, plinthH, w.z - halfTile - plinthOut * 0.5, halfTile, plinthOut * 0.5, tileSize);
        accum.addBox(w.x, corniceBot, topY, w.z - halfTile - corniceOut * 0.5, halfTile, corniceOut * 0.5, tileSize);
      }
      if (openE) {
        accum.addBox(w.x + halfTile + plinthOut * 0.5, baseY - 0.05, plinthH, w.z, plinthOut * 0.5, halfTile, tileSize);
        accum.addBox(w.x + halfTile + corniceOut * 0.5, corniceBot, topY, w.z, corniceOut * 0.5, halfTile, tileSize);
      }
      if (openW) {
        accum.addBox(w.x - halfTile - plinthOut * 0.5, baseY - 0.05, plinthH, w.z, plinthOut * 0.5, halfTile, tileSize);
        accum.addBox(w.x - halfTile - corniceOut * 0.5, corniceBot, topY, w.z, corniceOut * 0.5, halfTile, tileSize);
      }

      // Corner Stone Pillars at concave & convex corners where walls turn 90 degrees
      const corners: Array<{ dx: number; dz: number; active: boolean }> = [
        {
          dx: -1,
          dz: -1,
          active:
            (openN && openW) ||
            (!openN && !openW && grid.isOpen(c - 1, r - 1)),
        },
        {
          dx: 1,
          dz: -1,
          active:
            (openN && openE) ||
            (!openN && !openE && grid.isOpen(c + 1, r - 1)),
        },
        {
          dx: -1,
          dz: 1,
          active:
            (openS && openW) ||
            (!openS && !openW && grid.isOpen(c - 1, r + 1)),
        },
        {
          dx: 1,
          dz: 1,
          active:
            (openS && openE) ||
            (!openS && !openE && grid.isOpen(c + 1, r + 1)),
        },
      ];

      for (const corner of corners) {
        if (!corner.active) continue;
        // Center pillar slightly inset from exact tile corner so it wraps the masonry edge cleanly
        // without encroaching into player collision radius
        const px = w.x + corner.dx * (halfTile - 0.14);
        const pz = w.z + corner.dz * (halfTile - 0.14);
        const pillarTop = topY + 0.36;

        // Pillar stepped base
        accum.addBox(px, baseY - 0.06, baseY + 0.48, pz, 0.28, 0.28, tileSize);
        // Octagonal stone shaft
        accum.addOctagonalColumn(px, baseY + 0.48, pillarTop - 0.26, pz, 0.23, 0.20, false);
        // Flared stone capital crown
        accum.addBox(px, pillarTop - 0.26, pillarTop, pz, 0.29, 0.29, tileSize);
      }
    }

    if (!accum.isEmpty) {
      const chunkGeom = accum.toBufferGeometry();
      ownedGeometries.push(chunkGeom);

      const sharedWallMat = materials.get(palette.wallKey);

      const wallMesh = new THREE.Mesh(chunkGeom, sharedWallMat);
      wallMesh.name = `WallChunk_${chunkId}`;
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      wallMesh.userData.isWallOccluder = true;
      wallMesh.userData.baseOpacity = 1.0;

      group.add(wallMesh);
      wallOccluderMeshes.push(wallMesh);
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Gothic Stone Archway Trim over Doorways & Room Entrances
  // ---------------------------------------------------------------------------
  const archways = findArchwayPlacements(floor, grid);
  if (archways.length > 0) {
    const runeKeystonesAccum = new GeometryAccumulator();

    for (let i = 0; i < archways.length; i++) {
      const arch = archways[i];
      const archAccum = new GeometryAccumulator();
      const halfSpan = arch.spanWorld * 0.5;
      const jambOffset = halfSpan - 0.06; // Sits flush against flanking perimeter walls
      const origin = { x: arch.worldPos.x, y: baseY, z: arch.worldPos.z };

      // Left & right carved pilaster jambs
      archAccum.addOrientedBox(
        { x: -jambOffset, y: 1.65, z: 0 },
        { x: 0.18, y: 1.7, z: 0.34 },
        origin,
        arch.rotationY,
      );
      archAccum.addOrientedBox(
        { x: jambOffset, y: 1.65, z: 0 },
        { x: 0.18, y: 1.7, z: 0.34 },
        origin,
        arch.rotationY,
      );
      // Jamb capitals
      archAccum.addOrientedBox(
        { x: -jambOffset, y: 3.15, z: 0 },
        { x: 0.25, y: 0.16, z: 0.40 },
        origin,
        arch.rotationY,
      );
      archAccum.addOrientedBox(
        { x: jambOffset, y: 3.15, z: 0 },
        { x: 0.25, y: 0.16, z: 0.40 },
        origin,
        arch.rotationY,
      );

      // Overhead vaulted arch segments (clearance > 3.1m at center!)
      const segments = 5;
      for (let s = 0; s < segments; s++) {
        const t0 = s / segments;
        const t1 = (s + 1) / segments;
        const tm = (t0 + t1) * 0.5;
        const angle = (tm - 0.5) * Math.PI * 0.72;
        const lx = Math.sin(angle) * halfSpan;
        const ly = 3.12 + Math.cos(angle) * 0.58;
        const segHalfLen = (arch.spanWorld / segments) * 0.56;

        archAccum.addOrientedBox(
          { x: lx, y: ly, z: 0 },
          { x: segHalfLen, y: 0.22, z: 0.32 },
          origin,
          arch.rotationY,
          -angle * 0.65,
        );
      }

      // Central stone keystone block
      archAccum.addOrientedBox(
        { x: 0, y: 3.74, z: 0 },
        { x: 0.24, y: 0.30, z: 0.38 },
        origin,
        arch.rotationY,
      );

      // Glowing biome rune inlay on both sides of the keystone
      runeKeystonesAccum.addOrientedBox(
        { x: 0, y: 3.72, z: 0 },
        { x: 0.11, y: 0.17, z: 0.41 },
        origin,
        arch.rotationY,
      );

      const archGeom = archAccum.toBufferGeometry();
      ownedGeometries.push(archGeom);

      const archMesh = new THREE.Mesh(archGeom, materials.get(palette.wallKey));
      archMesh.name = `Archway_${i}`;
      archMesh.castShadow = true;
      archMesh.receiveShadow = true;
      archMesh.userData.isWallOccluder = true;
      archMesh.userData.baseOpacity = 1.0;

      group.add(archMesh);
      wallOccluderMeshes.push(archMesh);
    }

    if (!runeKeystonesAccum.isEmpty) {
      const runeGeom = runeKeystonesAccum.toBufferGeometry();
      ownedGeometries.push(runeGeom);
      const runeMesh = new THREE.Mesh(runeGeom, materials.get(palette.runeKey));
      runeMesh.name = 'ArchwayRuneKeystones';
      group.add(runeMesh);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Custom GLSL Volumetric Scrolling Dungeon Ground Mist (Dual Parallax Sheets)
  // ---------------------------------------------------------------------------
  let mistMaterial: THREE.ShaderMaterial | null = null;

  if (allOpenWorlds.length > 0) {
    const mistPos: number[] = [];
    const mistLayerAttr: number[] = [];
    const mistMaskAttr: number[] = [];
    const mistIdx: number[] = [];

    const cornerMaskAt = (vc: number, vr: number): number => {
      let openCount = 0;
      if (grid.isOpen(vc - 1, vr - 1)) openCount++;
      if (grid.isOpen(vc, vr - 1)) openCount++;
      if (grid.isOpen(vc - 1, vr)) openCount++;
      if (grid.isOpen(vc, vr)) openCount++;
      if (openCount === 4) return 1.0;
      if (openCount === 3) return 0.68;
      return 0.14;
    };

    const layerHeights: ReadonlyArray<readonly [number, number]> = [
      [0.0, baseY + 0.068],
      [1.0, baseY + 0.225],
    ];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid.isOpen(c, r)) continue;
        const w = grid.cellToWorld(c, r);
        const x0 = w.x - halfTile;
        const x1 = w.x + halfTile;
        const z0 = w.z - halfTile;
        const z1 = w.z + halfTile;

        const m00 = cornerMaskAt(c, r);
        const m10 = cornerMaskAt(c + 1, r);
        const m11 = cornerMaskAt(c + 1, r + 1);
        const m01 = cornerMaskAt(c, r + 1);

        for (let l = 0; l < layerHeights.length; l++) {
          const [layerVal, ly] = layerHeights[l];
          const vBase = mistPos.length / 3;
          mistPos.push(
            x0, ly, z0,
            x0, ly, z1,
            x1, ly, z1,
            x1, ly, z0,
          );
          mistLayerAttr.push(layerVal, layerVal, layerVal, layerVal);
          mistMaskAttr.push(m00, m01, m11, m10);
          mistIdx.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
        }
      }
    }

    if (mistIdx.length > 0) {
      const mistGeom = new THREE.BufferGeometry();
      mistGeom.setAttribute('position', new THREE.Float32BufferAttribute(mistPos, 3));
      mistGeom.setAttribute('aLayer', new THREE.Float32BufferAttribute(mistLayerAttr, 1));
      mistGeom.setAttribute('aMask', new THREE.Float32BufferAttribute(mistMaskAttr, 1));
      mistGeom.setIndex(mistIdx);
      mistGeom.computeBoundingSphere();
      ownedGeometries.push(mistGeom);

      const spawnVec = floor.playerSpawn
        ? new THREE.Vector3(floor.playerSpawn.x, floor.playerSpawn.y, floor.playerSpawn.z)
        : new THREE.Vector3();
      mistMaterial = createGroundMistMaterial(floor.biome, spawnVec);
      ownedMaterials.push(mistMaterial);

      const mistMesh = new THREE.Mesh(mistGeom, mistMaterial);
      mistMesh.name = 'VolumetricGroundMist';
      mistMesh.renderOrder = 2;
      mistMesh.receiveShadow = false;
      mistMesh.castShadow = false;
      group.add(mistMesh);
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Frame Update & Player Wake Hooks
  // ---------------------------------------------------------------------------
  const setPlayerPosition = (playerPos: Vec3): void => {
    if (!mistMaterial || !playerPos) return;
    if (Number.isFinite(playerPos.x) && Number.isFinite(playerPos.z)) {
      const py = Number.isFinite(playerPos.y) ? playerPos.y : baseY;
      mistMaterial.uniforms.uPlayerPos.value.set(playerPos.x, py, playerPos.z);
    }
  };

  const update = (_dt: number, elapsedSec: number): void => {
    if (mistMaterial) {
      mistMaterial.uniforms.uTime.value = elapsedSec;
    }
    if (lavaMat) {
      lavaMat.emissiveIntensity = 1.55 + Math.sin(elapsedSec * 3.1) * 0.32 + Math.sin(elapsedSec * 7.3) * 0.1;
    }
    if (poisonMat) {
      poisonMat.emissiveIntensity = 1.15 + Math.sin(elapsedSec * 2.4) * 0.26;
    }
    if (iceSheetMat) {
      iceSheetMat.emissiveIntensity = 0.36 + Math.sin(elapsedSec * 2.1) * 0.14;
    }

    for (let i = 0; i < teleporterAnims.length; i++) {
      const tp = teleporterAnims[i];
      tp.outerRing.rotation.y = elapsedSec * 1.45 + tp.phase;
      tp.innerRing.rotation.y = -elapsedSec * 2.4 - tp.phase;
      tp.innerRing.rotation.x = Math.sin(elapsedSec * 2.2 + tp.phase) * 0.22;
      tp.innerRing.position.y = 0.22 + Math.sin(elapsedSec * 3.0 + tp.phase) * 0.055;
      const pulse = 0.88 + Math.sin(elapsedSec * 3.8 + tp.phase) * 0.14;
      tp.auraDisc.scale.setScalar(pulse);
    }

    for (let i = 0; i < clockworkSpinners.length; i++) {
      const sp = clockworkSpinners[i];
      if (sp.axis === 'y') {
        sp.pivot.rotation.y = elapsedSec * sp.speedRadSec;
      } else {
        sp.pivot.rotation.z = elapsedSec * sp.speedRadSec;
      }
    }

    if (lavaBubblesInst && lavaBubbleSeeds.length > 0) {
      for (let i = 0; i < lavaBubbleSeeds.length; i++) {
        const b = lavaBubbleSeeds[i];
        const cycle = (elapsedSec * b.speed * 0.45 + b.phase) % 1;
        const popCurve = Math.sin(cycle * Math.PI);
        const s = Math.max(0.02, popCurve * b.maxScale);
        dummy.position.set(b.x, b.yBase + cycle * 0.24, b.z);
        dummy.rotation.set(elapsedSec + b.phase, b.phase, 0);
        dummy.scale.set(s, s * 0.72, s);
        dummy.updateMatrix();
        lavaBubblesInst.setMatrixAt(i, dummy.matrix);
      }
      lavaBubblesInst.instanceMatrix.needsUpdate = true;
    }

    if (poisonBubblesInst && poisonBubbleSeeds.length > 0) {
      for (let i = 0; i < poisonBubbleSeeds.length; i++) {
        const b = poisonBubbleSeeds[i];
        const cycle = (elapsedSec * b.speed * 0.5 + b.phase) % 1;
        const popCurve = Math.sin(cycle * Math.PI);
        const s = Math.max(0.02, popCurve * b.maxScale);
        dummy.position.set(
          b.x + Math.sin(elapsedSec * 2 + b.phase) * 0.05,
          b.yBase + cycle * 0.34,
          b.z + Math.cos(elapsedSec * 2 + b.phase) * 0.05,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        poisonBubblesInst.setMatrixAt(i, dummy.matrix);
      }
      poisonBubblesInst.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    group,
    wallOccluderMeshes,
    ownedGeometries,
    ownedMaterials,
    setPlayerPosition,
    update,
  };
}
