import * as THREE from 'three';

interface SavedMaterialProps {
  original: THREE.Material;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
}

interface TrackedFadeEntry {
  mesh: THREE.Mesh;
  wasArray: boolean;
  saved: SavedMaterialProps[];
  activeMaterials: THREE.Material[];
  ownsClones: boolean;
  currentFactor: number;
  occludedThisFrame: boolean;
}

const TARGET_OCCLUDED_FACTOR = 0.22;
const FADE_OUT_SPEED = 9.0;
const FADE_IN_SPEED = 6.5;

/**
 * Raycasts from the camera toward the hero's silhouette against dungeon wall occluders
 * and smoothly fades obstructing wall meshes while preserving shared material batching
 * on unoccluded walls.
 */
export class WallOcclusionFader {
  private occluderRoots: THREE.Object3D[] = [];
  private readonly materialUsageCount = new Map<THREE.Material, number>();
  private readonly trackedMeshes = new Map<THREE.Mesh, TrackedFadeEntry>();

  private readonly raycaster = new THREE.Raycaster();
  private readonly rayDir = new THREE.Vector3();
  private readonly sampleTarget = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();
  private readonly intersections: THREE.Intersection[] = [];

  setOccluders(meshes: THREE.Object3D[]): void {
    this.restoreAllImmediate();
    this.occluderRoots = Array.isArray(meshes) ? meshes.filter(Boolean) : [];
    this.materialUsageCount.clear();

    for (const root of this.occluderRoots) {
      root.updateMatrixWorld(true);
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if (mat) {
              this.materialUsageCount.set(mat, (this.materialUsageCount.get(mat) ?? 0) + 1);
            }
          }
        }
      });
    }
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    focusWorldPos: THREE.Vector3,
  ): void {
    if (this.occluderRoots.length === 0 && this.trackedMeshes.size === 0) {
      return;
    }

    for (const entry of this.trackedMeshes.values()) {
      entry.occludedThisFrame = false;
    }

    if (this.occluderRoots.length > 0) {
      const camPos = camera.position;
      this.rightVec.setFromMatrixColumn(camera.matrixWorld, 0).normalize();

      // Cast a tight cluster of rays around the hero's torso/head/sides so walls partially
      // covering the hero fade cleanly without fading walls behind the hero.
      const offsets: ReadonlyArray<readonly [number, number]> = [
        [0, 1.0],
        [0, 0.35],
        [0, 1.65],
        [-0.38, 0.95],
        [0.38, 0.95],
      ];

      for (let i = 0; i < offsets.length; i++) {
        const [rightOffset, upOffset] = offsets[i];
        this.sampleTarget
          .copy(focusWorldPos)
          .addScaledVector(this.rightVec, rightOffset);
        this.sampleTarget.y += upOffset;

        this.rayDir.subVectors(this.sampleTarget, camPos);
        const dist = this.rayDir.length();
        if (dist <= 0.6) continue;

        this.rayDir.multiplyScalar(1 / dist);
        this.raycaster.set(camPos, this.rayDir);
        this.raycaster.near = 0.15;
        // Stop strictly in front of the hero so back walls are never hit
        this.raycaster.far = Math.max(0.2, dist - 0.35);

        this.intersections.length = 0;
        this.raycaster.intersectObjects(this.occluderRoots, true, this.intersections);

        for (let h = 0; h < this.intersections.length; h++) {
          const hitObj = this.intersections[h].object;
          if ((hitObj as THREE.Mesh).isMesh) {
            this.markMeshOccluded(hitObj as THREE.Mesh);
          }
        }
      }
    }

    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;

    for (const [mesh, entry] of this.trackedMeshes.entries()) {
      if (entry.occludedThisFrame) {
        const t = 1 - Math.exp(-FADE_OUT_SPEED * safeDt);
        entry.currentFactor += (TARGET_OCCLUDED_FACTOR - entry.currentFactor) * t;
        this.applyFactor(entry, entry.currentFactor);
      } else {
        const t = 1 - Math.exp(-FADE_IN_SPEED * safeDt);
        entry.currentFactor += (1.0 - entry.currentFactor) * t;
        if (entry.currentFactor >= 0.992) {
          this.restoreEntry(entry);
          this.trackedMeshes.delete(mesh);
        } else {
          this.applyFactor(entry, entry.currentFactor);
        }
      }
    }
  }

  restoreAllImmediate(): void {
    for (const entry of this.trackedMeshes.values()) {
      this.restoreEntry(entry);
    }
    this.trackedMeshes.clear();
  }

  dispose(): void {
    this.restoreAllImmediate();
    this.occluderRoots = [];
    this.materialUsageCount.clear();
  }

  private markMeshOccluded(mesh: THREE.Mesh): void {
    if (!mesh.material) return;

    // Avoid fading massive global instanced batches (>32 instances) that represent whole floors
    if ((mesh as THREE.InstancedMesh).isInstancedMesh && (mesh as THREE.InstancedMesh).count > 32) {
      return;
    }

    let entry = this.trackedMeshes.get(mesh);
    if (!entry) {
      const wasArray = Array.isArray(mesh.material);
      const rawMats = wasArray ? (mesh.material as THREE.Material[]) : [mesh.material as THREE.Material];
      const saved: SavedMaterialProps[] = rawMats.map((mat) => ({
        original: mat,
        transparent: mat.transparent,
        opacity: mat.opacity,
        depthWrite: mat.depthWrite,
      }));

      // Clone materials only when shared across multiple meshes so single-mesh materials
      // update in place while shared MaterialLibrary materials don't fade unoccluded walls.
      const isShared = rawMats.some((mat) => (this.materialUsageCount.get(mat) ?? 0) > 1);
      const activeMaterials = isShared ? rawMats.map((mat) => mat.clone()) : rawMats.slice();

      if (isShared) {
        mesh.material = wasArray ? activeMaterials : activeMaterials[0];
      }

      entry = {
        mesh,
        wasArray,
        saved,
        activeMaterials,
        ownsClones: isShared,
        currentFactor: 1.0,
        occludedThisFrame: true,
      };
      this.trackedMeshes.set(mesh, entry);
    } else {
      entry.occludedThisFrame = true;
    }
  }

  private applyFactor(entry: TrackedFadeEntry, factor: number): void {
    for (let i = 0; i < entry.activeMaterials.length; i++) {
      const mat = entry.activeMaterials[i];
      const orig = entry.saved[i];
      const nextOpacity = orig.opacity * factor;
      const needsTransparency = orig.transparent || factor < 0.995;
      if (mat.transparent !== needsTransparency) {
        mat.transparent = needsTransparency;
        mat.needsUpdate = true;
      }
      mat.opacity = nextOpacity;
      mat.depthWrite = factor < 0.95 ? false : orig.depthWrite;
    }
  }

  private restoreEntry(entry: TrackedFadeEntry): void {
    if (entry.ownsClones) {
      const originals = entry.saved.map((s) => s.original);
      entry.mesh.material = entry.wasArray ? originals : originals[0];
      for (const clone of entry.activeMaterials) {
        clone.dispose();
      }
    } else {
      for (let i = 0; i < entry.activeMaterials.length; i++) {
        const mat = entry.activeMaterials[i];
        const orig = entry.saved[i];
        if (mat.transparent !== orig.transparent) {
          mat.transparent = orig.transparent;
          mat.needsUpdate = true;
        }
        mat.opacity = orig.opacity;
        mat.depthWrite = orig.depthWrite;
      }
    }
  }
}
