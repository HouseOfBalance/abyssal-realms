import * as THREE from 'three';
import type {
  DungeonFloorData,
  DungeonRoom,
  IDungeonMeshBuilder,
  IMaterialLibrary,
  Vec3,
} from '../../contracts/types';
import {
  type ArchitectureBuildResult,
  buildDungeonArchitecture,
} from './architectureBuilder';
import { createGridAccessor } from './gridUtils';
import {
  buildDungeonPropsAndTorches,
  type PropsBuildResult,
} from './propsBuilder';

// Room radius used for frustum-cull sphere tests (half-diagonal of a typical room)
const ROOM_CULL_RADIUS = 12.0;

export class DungeonMeshBuilder implements IDungeonMeshBuilder {
  private currentRoot: THREE.Group | null = null;
  private architectureResult: ArchitectureBuildResult | null = null;
  private propsResult: PropsBuildResult | null = null;
  private wallOccluderMeshes: THREE.Object3D[] = [];
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private ownedMaterials: THREE.Material[] = [];
  private portalActive = false;
  private lastPlayerPos: Vec3 | null = null;
  private fallbackElapsedSec = 0;

  // --- Performance / culling state ---
  private currentTier: string = 'high';
  private floorRooms: DungeonRoom[] = [];
  /** Flat-color override materials owned by this builder for 'low' tier */
  private tierOwnedMaterials: THREE.Material[] = [];
  /** Original materials saved per mesh when low-tier flat-color override is applied */
  private savedMeshMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();

  buildFloor(floor: DungeonFloorData, materials: IMaterialLibrary): THREE.Group {
    this.disposeCurrentFloor();
    this.portalActive = false;
    this.fallbackElapsedSec = 0;
    this.lastPlayerPos = floor.playerSpawn ? { ...floor.playerSpawn } : null;
    this.floorRooms = floor.rooms ? [...floor.rooms] : [];

    const root = new THREE.Group();
    root.name = `DungeonFloor_${floor.floorNumber}_${floor.biome}`;

    const grid = createGridAccessor(floor);

    const arch = buildDungeonArchitecture(floor, grid, materials);
    const props = buildDungeonPropsAndTorches(
      floor,
      grid,
      materials,
      this.portalActive,
    );

    root.add(arch.group);
    root.add(props.group);

    this.currentRoot = root;
    this.architectureResult = arch;
    this.propsResult = props;
    this.wallOccluderMeshes = arch.wallOccluderMeshes;
    this.ownedGeometries.push(...arch.ownedGeometries, ...props.ownedGeometries);
    this.ownedMaterials.push(...arch.ownedMaterials, ...props.ownedMaterials);

    if (this.lastPlayerPos) {
      arch.setPlayerPosition(this.lastPlayerPos);
    }

    // Run an initial t=0 update so all animated matrices & emissive states are primed
    this.update(0, 0);

    return root;
  }

  setInteractableUsed(propId: string): void {
    if (!propId) return;
    this.propsResult?.setInteractableUsed(propId);
  }

  setPortalActive(active: boolean): void {
    this.portalActive = Boolean(active);
    this.propsResult?.setPortalActive(this.portalActive);
  }

  setPlayerPosition(playerPos: Vec3): void {
    if (!playerPos || !Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.z)) {
      return;
    }
    this.lastPlayerPos = {
      x: playerPos.x,
      y: Number.isFinite(playerPos.y) ? playerPos.y : 0,
      z: playerPos.z,
    };
    this.architectureResult?.setPlayerPosition(this.lastPlayerPos);
  }

  getWallMeshesForOcclusion(): THREE.Object3D[] {
    return this.wallOccluderMeshes;
  }

  update(dt: number, elapsedSec: number): void {
    const safeDt = Number.isFinite(dt) && dt >= 0 ? Math.min(dt, 0.25) : 0;
    this.fallbackElapsedSec += safeDt;
    const safeElapsed = Number.isFinite(elapsedSec)
      ? elapsedSec
      : this.fallbackElapsedSec;

    this.architectureResult?.update(safeDt, safeElapsed);
    this.propsResult?.update(safeDt, safeElapsed);
  }

  dispose(): void {
    this.disposeCurrentFloor();
  }

  // ---------------------------------------------------------------------------
  // Frustum Culling — hides any direct child of the architecture/props groups
  // whose bounding sphere centre is outside the camera frustum.
  // Wall chunk meshes and room-sized objects each expose a bounding sphere via
  // their geometry; for groups we approximate with a fixed ROOM_CULL_RADIUS.
  // ---------------------------------------------------------------------------
  updateFrustumCulling(camera: THREE.Camera): void {
    if (!this.currentRoot) return;

    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    camera.updateMatrixWorld();
    projScreenMatrix.multiplyMatrices(
      (camera as THREE.PerspectiveCamera).projectionMatrix,
      camera.matrixWorldInverse,
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);

    const sphere = new THREE.Sphere();

    // Traverse direct children of each top-level group (architecture + props)
    this.currentRoot.children.forEach((topGroup) => {
      topGroup.children.forEach((child) => {
        if ((child as THREE.Mesh).isMesh || child.type === 'InstancedMesh') {
          const mesh = child as THREE.Mesh;
          mesh.updateMatrixWorld(false);
          if (mesh.geometry?.boundingSphere) {
            sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
          } else {
            // No bounding sphere — always visible
            child.visible = true;
            return;
          }
          child.visible = frustum.intersectsSphere(sphere);
        } else if (child.isObject3D) {
          // Group (e.g. TeleporterPads, ObservatoryClockworkGears, prop groups)
          child.updateMatrixWorld(false);
          const pos = new THREE.Vector3();
          child.getWorldPosition(pos);
          sphere.set(pos, ROOM_CULL_RADIUS);
          child.visible = frustum.intersectsSphere(sphere);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Performance Tier — adjusts rendering detail level.
  //   'low'    : flat MeshBasicMaterial overlay, only nearby rooms rendered
  //   'medium' : standard materials, moderately extended draw radius
  //   'high'/'ultra': full render, all rooms visible
  // ---------------------------------------------------------------------------
  setPerformanceTier(tier: string): void {
    this.currentTier = tier;

    if (!this.currentRoot) return;

    if (tier === 'low') {
      this._applyFlatColorOverride();
    } else {
      this._restoreOriginalMaterials();
    }
  }

  /** Replace all Mesh materials with a cheap flat-color MeshBasicMaterial. */
  private _applyFlatColorOverride(): void {
    if (!this.currentRoot) return;
    const flatMat = new THREE.MeshBasicMaterial({ color: 0x444466, fog: true });
    this.tierOwnedMaterials.push(flatMat);

    this.currentRoot.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      if (this.savedMeshMaterials.has(mesh)) return; // already overridden
      this.savedMeshMaterials.set(mesh, mesh.material);
      mesh.material = flatMat;
    });
  }

  /** Restore materials saved before the flat-color override. */
  private _restoreOriginalMaterials(): void {
    for (const [mesh, mat] of this.savedMeshMaterials.entries()) {
      mesh.material = mat as THREE.Material;
    }
    this.savedMeshMaterials.clear();

    for (const mat of this.tierOwnedMaterials) mat.dispose();
    this.tierOwnedMaterials.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Visible Rooms — BFS from playerRoomIndex through connectedRoomIds graph;
  // show/hide the architecture and props groups based on room proximity.
  // Depth limits: low=2, medium=3, high/ultra=all.
  // ---------------------------------------------------------------------------
  updateVisibleRooms(playerRoomIndex: number, tier: string): void {
    if (!this.currentRoot || this.floorRooms.length === 0) return;

    const depthLimit =
      tier === 'low' ? 2 :
      tier === 'medium' ? 3 :
      Infinity;

    // BFS: collect all room IDs within depthLimit hops
    const visibleIds = new Set<string>();
    const roomById = new Map<string, DungeonRoom>();
    for (const room of this.floorRooms) roomById.set(room.id, room);

    const startRoom = this.floorRooms[playerRoomIndex];
    if (!startRoom) {
      // Invalid index — show everything
      this.currentRoot.traverse((o) => { o.visible = true; });
      return;
    }

    // BFS queue: [roomId, depth]
    const queue: Array<[string, number]> = [[startRoom.id, 0]];
    const visited = new Set<string>([startRoom.id]);

    while (queue.length > 0) {
      const [id, depth] = queue.shift()!;
      visibleIds.add(id);
      if (depth >= depthLimit) continue;
      const room = roomById.get(id);
      if (!room) continue;
      for (const neighborId of room.connectedRoomIds) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push([neighborId, depth + 1]);
        }
      }
    }

    // Build world-space bounding spheres for each visible room
    const visibleSpheres: THREE.Sphere[] = [];
    for (const id of visibleIds) {
      const room = roomById.get(id);
      if (!room) continue;
      const center = new THREE.Vector3(
        room.centerWorld.x,
        0,
        room.centerWorld.z,
      );
      // radius covers the full room tile area
      const radius = Math.max(room.width, room.height) * 1.0 + ROOM_CULL_RADIUS * 0.5;
      visibleSpheres.push(new THREE.Sphere(center, radius));
    }

    const testPos = new THREE.Vector3();

    // Show/hide each top-level child of architecture and props groups
    this.currentRoot.children.forEach((topGroup) => {
      topGroup.children.forEach((child) => {
        child.getWorldPosition(testPos);
        const inRange = visibleSpheres.some((s) => s.containsPoint(testPos));
        child.visible = inRange;
      });
    });
  }

  private disposeCurrentFloor(): void {
    // Restore any overridden materials before clearing the scene graph
    this._restoreOriginalMaterials();

    if (this.currentRoot) {
      this.currentRoot.parent?.remove(this.currentRoot);
      this.currentRoot.clear();
      this.currentRoot = null;
    }

    for (const geom of this.ownedGeometries) {
      geom.dispose();
    }
    this.ownedGeometries.length = 0;

    for (const mat of this.ownedMaterials) {
      mat.dispose();
    }
    this.ownedMaterials.length = 0;

    this.architectureResult = null;
    this.propsResult = null;
    this.wallOccluderMeshes = [];
    this.floorRooms = [];
  }
}

export function createDungeonMeshBuilder(): IDungeonMeshBuilder {
  return new DungeonMeshBuilder();
}
