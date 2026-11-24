import * as THREE from 'three';
import type {
  BossId,
  EliteAffix,
  EnemyAnimState,
  EnemyArchetypeId,
  IEnemyMeshFactory,
  IEnemyMeshHandle,
  IMaterialLibrary,
} from '../../contracts/types';
import type { PerformanceTier } from '../../core/DeviceDetector';
import { clamp } from '../../core/Constants';
import { EnemyAnimationController } from './animationController';
import { buildArchetypeRig } from './archetypeBuilders';
import { buildBossRig } from './bossBuilders';
import { EliteVisualsController } from './eliteVisuals';
import { type ArticulatedEnemyRig, HandleAssetRegistry } from './rigTypes';

const HIT_FLASH_DURATION_SEC = 0.15;

// ---------------------------------------------------------------------------
// LOD thresholds per performance tier
// ---------------------------------------------------------------------------
interface LodThresholds {
  /** Distance (metres) beyond which the box-proxy replaces the full mesh. */
  proxyDist: number;
  /** Distance (metres) beyond which the mesh is hidden entirely. */
  hideDist: number;
  /** When true the box-proxy is ALWAYS shown; full mesh never rendered. */
  alwaysProxy: boolean;
}

const LOD_THRESHOLDS: Record<PerformanceTier, LodThresholds> = {
  low:    { proxyDist: 0,  hideDist: Infinity, alwaysProxy: true  },
  medium: { proxyDist: 15, hideDist: 30,       alwaysProxy: false },
  high:   { proxyDist: 25, hideDist: 50,       alwaysProxy: false },
  ultra:  { proxyDist: 25, hideDist: 50,       alwaysProxy: false },
};

// Cache for LOD proxy geometries — shared across all instances of same dimensions
const _proxyGeoCache = new Map<string, THREE.BoxGeometry>();

function getProxyGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
  let geo = _proxyGeoCache.get(key);
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d);
    _proxyGeoCache.set(key, geo);
  }
  return geo;
}

// Cache for LOD proxy materials (one per color hex)
const _proxyMatCache = new Map<number, THREE.MeshStandardMaterial>();

function getProxyMat(colorHex: number): THREE.MeshStandardMaterial {
  let mat = _proxyMatCache.get(colorHex);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.9, metalness: 0.0 });
    _proxyMatCache.set(colorHex, mat);
  }
  return mat;
}

/**
 * Builds a simple box-mesh LOD proxy whose dimensions approximate the rig
 * bounding box. The proxy is NOT added to the scene here — the factory does
 * that at the right moment.
 */
function buildLodProxy(rig: ArticulatedEnemyRig): THREE.Mesh {
  const { bodyRadius, bodyHeight, telegraphColorHex } = rig;
  // Approximate extents: width/depth from bodyRadius, height from bodyHeight
  const w = bodyRadius * 2;
  const h = bodyHeight;
  const d = bodyRadius * 2;
  const geo = getProxyGeo(w, h, d);
  const mat = getProxyMat(telegraphColorHex ?? 0x666666);
  const proxy = new THREE.Mesh(geo, mat);
  // Position proxy centre at half-height so its base sits at y=0
  proxy.position.y = h * 0.5;
  proxy.name = 'lod_proxy';
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  return proxy;
}

// ---------------------------------------------------------------------------
// InstancedMesh batch group
// ---------------------------------------------------------------------------
/** Maximum instances per InstancedMesh batch. */
const INSTANCED_BATCH_SIZE = 64;

/**
 * Lightweight instanced batch for enemies of the same archetype.
 * Used when the caller creates 3+ same-type enemies via
 * `EnemyMeshFactory.getOrCreateInstancedGroup()`.
 */
export class EnemyInstancedGroup {
  readonly archetype: EnemyArchetypeId;
  readonly instancedMesh: THREE.InstancedMesh;
  private readonly count: number;
  private nextSlot = 0;
  private readonly slotMap = new Map<string, number>(); // id → slot index
  private readonly _dummy = new THREE.Object3D();

  constructor(archetype: EnemyArchetypeId, colorHex: number, maxCount = INSTANCED_BATCH_SIZE) {
    this.archetype = archetype;
    this.count = maxCount;
    // Proxy geometry shared from cache
    const geo = getProxyGeo(1.0, 1.8, 1.0); // generic stand-in
    const mat = getProxyMat(colorHex);
    this.instancedMesh = new THREE.InstancedMesh(geo, mat, maxCount);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.count = 0;
    this.instancedMesh.name = `instanced_${archetype}`;
    this.instancedMesh.castShadow = false;
  }

  /**
   * Register an enemy root so it gets an instance slot.
   * Returns the slot index (or -1 if the batch is full).
   */
  registerEnemy(id: string, root: THREE.Object3D): number {
    if (this.slotMap.has(id)) return this.slotMap.get(id)!;
    if (this.nextSlot >= this.count) return -1;
    const slot = this.nextSlot++;
    this.slotMap.set(id, slot);
    this.instancedMesh.count = this.nextSlot;
    this.syncSlot(slot, root);
    return slot;
  }

  /** Sync world matrix of one slot from the given Object3D. */
  syncSlot(slot: number, root: THREE.Object3D): void {
    this._dummy.position.copy(root.position);
    this._dummy.quaternion.copy(root.quaternion);
    this._dummy.scale.copy(root.scale);
    this._dummy.updateMatrix();
    this.instancedMesh.setMatrixAt(slot, this._dummy.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /** Update all slots from the provided roots map (id → root). */
  syncAll(roots: Map<string, THREE.Object3D>): void {
    for (const [id, slot] of this.slotMap) {
      const root = roots.get(id);
      if (root) this.syncSlot(slot, root);
    }
  }

  unregisterEnemy(id: string): void {
    this.slotMap.delete(id);
    // Compact: not done here for performance; caller can rebuild
  }

  get registeredCount(): number {
    return this.slotMap.size;
  }

  dispose(): void {
    this.instancedMesh.geometry.dispose();
    if (Array.isArray(this.instancedMesh.material)) {
      for (const m of this.instancedMesh.material) m.dispose();
    } else {
      this.instancedMesh.material.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// LOD-aware handle — wraps EnemyMeshHandle internals with proxy management
// ---------------------------------------------------------------------------

/** Current LOD state of a handle. */
type LodState = 'full' | 'proxy' | 'hidden';

export class EnemyMeshHandle implements IEnemyMeshHandle {
  readonly root: THREE.Group;
  private readonly anim: EnemyAnimationController;
  private readonly eliteVisuals: EliteVisualsController;
  private readonly tempRootWorldPos = new THREE.Vector3();
  private flashTimerSec = 0;
  private flashColorHex = 0xffffff;
  private shadowsMutedByDissolve = false;
  private disposed = false;

  // LOD proxy mesh (created lazily on first applyLod call)
  private _lodProxy: THREE.Mesh | null = null;
  private _lodState: LodState = 'full';
  // The model_root child that contains the actual detailed geometry
  private _modelRoot: THREE.Object3D | null = null;

  constructor(
    private readonly rig: ArticulatedEnemyRig,
    private readonly assets: HandleAssetRegistry,
    isElite: boolean,
  ) {
    this.root = rig.root;
    this.anim = new EnemyAnimationController(rig);
    this.eliteVisuals = new EliteVisualsController(rig, isElite);
    this.syncVisualState();
  }

  playAnim(state: EnemyAnimState, speed = 1): void {
    if (this.disposed) return;
    this.anim.playAnim(state, speed);
    this.syncVisualState();
  }

  flashHit(colorHex = 0xffffff): void {
    if (this.disposed) return;
    this.flashColorHex = Number.isFinite(colorHex) ? colorHex : 0xffffff;
    this.flashTimerSec = HIT_FLASH_DURATION_SEC;
    this.anim.triggerHitSquash();
    this.syncVisualState();
  }

  setEliteVisuals(affixes: EliteAffix[]): void {
    if (this.disposed) return;
    this.eliteVisuals.setAffixes(affixes);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;

    if (this.flashTimerSec > 0) {
      this.flashTimerSec = Math.max(0, this.flashTimerSec - safeDt);
    }

    this.anim.update(safeDt);
    const deathDim = this.anim.getDeathDimFactor();
    this.eliteVisuals.update(safeDt, deathDim);
    this.syncVisualState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.root.removeFromParent();
    this.eliteVisuals.dispose();
    this.assets.dispose();
    this.root.clear();
    // Note: proxy geo/mat are shared from cache — do NOT dispose them here
    this._lodProxy = null;
  }

  // -------------------------------------------------------------------------
  // LOD API (called by EnemyMeshFactory.updateLOD)
  // -------------------------------------------------------------------------

  /**
   * Apply LOD state based on distance to camera.
   * 'full'   — detailed articulated mesh visible
   * 'proxy'  — replace with simple box proxy
   * 'hidden' — mesh.visible = false
   */
  applyLod(state: LodState): void {
    if (this.disposed || this._lodState === state) return;
    this._lodState = state;

    // Lazily resolve model_root reference
    if (!this._modelRoot) {
      this._modelRoot = this.root.getObjectByName('model_root') ?? null;
    }

    switch (state) {
      case 'full':
        this.root.visible = true;
        if (this._modelRoot) this._modelRoot.visible = true;
        if (this._lodProxy) this._lodProxy.visible = false;
        break;

      case 'proxy': {
        this.root.visible = true;
        if (this._modelRoot) this._modelRoot.visible = false;
        // Build proxy on first use
        if (!this._lodProxy) {
          this._lodProxy = buildLodProxy(this.rig);
          this.root.add(this._lodProxy);
        }
        this._lodProxy.visible = true;
        break;
      }

      case 'hidden':
        this.root.visible = false;
        if (this._lodProxy) this._lodProxy.visible = false;
        break;
    }
  }

  /** Reset LOD to full detail (e.g. when re-pooling). */
  resetLod(): void {
    this._lodState = 'full';
    this.root.visible = true;
    if (this._modelRoot) this._modelRoot.visible = true;
    if (this._lodProxy) this._lodProxy.visible = false;
  }

  private syncVisualState(): void {
    const flashStrength =
      this.flashTimerSec > 0 ? clamp(this.flashTimerSec / HIT_FLASH_DURATION_SEC, 0, 1) : 0;
    const telegraphStrength = this.anim.getTelegraphStrength();
    const deathDim = this.anim.getDeathDimFactor();
    const dissolveProgress = this.anim.getDissolveProgress();

    if (dissolveProgress > 0.0001) {
      this.root.getWorldPosition(this.tempRootWorldPos);
    } else {
      this.tempRootWorldPos.copy(this.root.position);
    }

    this.assets.updateDissolve(
      dissolveProgress,
      this.anim.getTotalTime(),
      this.tempRootWorldPos,
    );

    // Disable solid shadow casting once more than half disintegrated into embers
    const shouldMuteShadows = dissolveProgress > 0.58;
    if (shouldMuteShadows !== this.shadowsMutedByDissolve) {
      this.shadowsMutedByDissolve = shouldMuteShadows;
      for (const m of this.rig.shadowMeshes) {
        m.castShadow = !shouldMuteShadows;
      }
    }

    this.assets.applyModulation(
      flashStrength,
      this.flashColorHex,
      telegraphStrength,
      this.rig.telegraphColorHex,
      deathDim,
      dissolveProgress,
    );
  }
}

// ---------------------------------------------------------------------------
// LOD-aware EnemyMeshFactory
// ---------------------------------------------------------------------------

/** Internal tracking record per spawned handle. */
interface SpawnedRecord {
  handle: EnemyMeshHandle;
  typeKey: string; // archetype or bossId string
}

const _tempVec3 = new THREE.Vector3();

export class EnemyMeshFactory implements IEnemyMeshFactory {
  // Map from root.uuid → spawned record
  private readonly _spawned = new Map<string, SpawnedRecord>();
  // Map from root.uuid → THREE.Object3D (for getSpawnedMeshes)
  private readonly _meshes = new Map<string, THREE.Object3D>();
  // InstancedMesh groups keyed by archetype string
  private readonly _instancedGroups = new Map<string, EnemyInstancedGroup>();

  // -------------------------------------------------------------------------
  // IEnemyMeshFactory implementation
  // -------------------------------------------------------------------------

  createEnemyMesh(
    archetype: EnemyArchetypeId,
    isElite: boolean,
    materials: IMaterialLibrary,
  ): IEnemyMeshHandle {
    const assets = new HandleAssetRegistry(materials);
    const rig = buildArchetypeRig(archetype, isElite, assets);
    rig.root.name = `enemy_${archetype}${isElite ? '_elite' : ''}`;
    const handle = new EnemyMeshHandle(rig, assets, isElite);
    this._trackHandle(handle, archetype);
    return handle;
  }

  createBossMesh(bossId: BossId, materials: IMaterialLibrary): IEnemyMeshHandle {
    const assets = new HandleAssetRegistry(materials);
    const rig = buildBossRig(bossId, assets);
    rig.root.name = `boss_${bossId}`;
    const handle = new EnemyMeshHandle(rig, assets, false);
    this._trackHandle(handle, bossId);
    return handle;
  }

  // -------------------------------------------------------------------------
  // LOD API
  // -------------------------------------------------------------------------

  /**
   * Iterate all spawned enemy meshes and apply LOD based on distance from
   * `cameraPosition` and the current performance `tier`.
   *
   * Distance rules (see LOD_THRESHOLDS):
   *   - low:    always use box proxy
   *   - medium: proxy ≥15m, hide ≥30m
   *   - high/ultra: proxy ≥25m, hide ≥50m
   */
  updateLOD(cameraPosition: THREE.Vector3, tier: PerformanceTier): void {
    const thresholds = LOD_THRESHOLDS[tier] ?? LOD_THRESHOLDS.medium;

    for (const record of this._spawned.values()) {
      const { handle } = record;
      const root = handle.root;

      if (thresholds.alwaysProxy) {
        handle.applyLod('proxy');
        continue;
      }

      _tempVec3.copy(root.position);
      const dist = _tempVec3.distanceTo(cameraPosition);

      let targetState: LodState;
      if (dist >= thresholds.hideDist) {
        targetState = 'hidden';
      } else if (dist >= thresholds.proxyDist) {
        targetState = 'proxy';
      } else {
        targetState = 'full';
      }

      handle.applyLod(targetState);
    }
  }

  /**
   * Returns the map of all currently-tracked spawned enemy roots.
   * Key: root.uuid, Value: THREE.Object3D (the root Group).
   */
  getSpawnedMeshes(): Map<string, THREE.Object3D> {
    return this._meshes;
  }

  // -------------------------------------------------------------------------
  // InstancedMesh API
  // -------------------------------------------------------------------------

  /**
   * Get (or create) an InstancedMesh batch group for enemies of `archetype`.
   * When 3+ enemies of the same type are registered, callers should add
   * `group.instancedMesh` to the scene and hide individual meshes for the
   * registered slots, calling `group.syncAll(getSpawnedMeshes())` each frame.
   *
   * The InstancedMesh uses the box-proxy geometry and telegraph color — it is
   * a performance-oriented stand-in for distant / low-tier crowds.
   */
  getOrCreateInstancedGroup(
    archetype: EnemyArchetypeId,
    colorHex: number,
  ): EnemyInstancedGroup {
    let group = this._instancedGroups.get(archetype);
    if (!group) {
      group = new EnemyInstancedGroup(archetype, colorHex);
      this._instancedGroups.set(archetype, group);
    }
    return group;
  }

  /**
   * Automatically register all spawned enemies of a given archetype into an
   * InstancedMesh group if 3 or more exist. Returns the group if created/used,
   * or null if the threshold is not met.
   */
  tryRegisterInstancedGroup(archetype: EnemyArchetypeId, colorHex: number): EnemyInstancedGroup | null {
    // Count enemies of this archetype
    const matching: SpawnedRecord[] = [];
    for (const rec of this._spawned.values()) {
      if (rec.typeKey === archetype) matching.push(rec);
    }
    if (matching.length < 3) return null;

    const group = this.getOrCreateInstancedGroup(archetype, colorHex);
    for (const rec of matching) {
      group.registerEnemy(rec.handle.root.uuid, rec.handle.root);
    }
    return group;
  }

  /** Dispose all instanced groups. */
  disposeInstancedGroups(): void {
    for (const g of this._instancedGroups.values()) g.dispose();
    this._instancedGroups.clear();
  }

  // -------------------------------------------------------------------------
  // Internal tracking
  // -------------------------------------------------------------------------

  private _trackHandle(handle: EnemyMeshHandle, typeKey: string): void {
    const uuid = handle.root.uuid;
    this._spawned.set(uuid, { handle, typeKey });
    this._meshes.set(uuid, handle.root);

    // Auto-cleanup when dispose() is called — wrap dispose
    const origDispose = handle.dispose.bind(handle);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const factory = this;
    (handle as unknown as Record<string, unknown>).dispose = function () {
      origDispose();
      factory._spawned.delete(uuid);
      factory._meshes.delete(uuid);
    };
  }
}

export function createEnemyMeshFactory(): IEnemyMeshFactory {
  return new EnemyMeshFactory();
}
