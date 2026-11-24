import * as THREE from 'three';
import type {
  DungeonFloorData,
  EnemyEntity,
  IMaterialLibrary,
  ISanctuaryHub,
  MaterialKey,
  TrainingDummyMetrics,
  Vec3,
} from '../../contracts/types';
import { clamp } from '../../core/Constants';
import { buildSanctuaryLandmarks, type HubSceneHandle } from './hubLandmarks';
import {
  generateSanctuaryFloorData,
  SANCTUARY_LANDMARK_POSITIONS,
} from './sanctuaryFloor';
import {
  createImmortalTrainingDummyEntity,
  type SharedHubResourceTracker,
  TrainingDummyDpsTracker,
  TrainingDummyRig,
} from './trainingDummy';

type ManagedDummyEntity = EnemyEntity & {
  __syncDummyAnchor?: (nextAnchor?: Vec3) => void;
};

const SUPERSEDED_PROP_PREFIXES = [
  'Prop_training_dummy_',
  'Prop_waypoint_map_',
  'Prop_stash_chest_',
  'Prop_gambler_npc_',
  'Prop_companion_shrine_',
] as const;

export class SanctuaryHub implements ISanctuaryHub {
  private hostScene: THREE.Scene | null = null;
  private hubRootGroup: THREE.Group | null = null;
  private landmarksHandle: HubSceneHandle | null = null;
  private dummyRig: TrainingDummyRig | null = null;
  private dummyEntity: ManagedDummyEntity | null;
  private dummyAnchorPos: Vec3 = { ...SANCTUARY_LANDMARK_POSITIONS.trainingDummy };
  private readonly hiddenFallbackProps: THREE.Object3D[] = [];
  private dedupeChecksRemaining = 0;

  private readonly dpsTracker = new TrainingDummyDpsTracker();
  private readonly geometryCache = new Map<string, THREE.BufferGeometry>();
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];

  private lastPlayerPos: Vec3 = { ...SANCTUARY_LANDMARK_POSITIONS.playerSpawn };
  private fallbackElapsedSec = 0;

  constructor() {
    this.dummyEntity = createImmortalTrainingDummyEntity(this.dummyAnchorPos);
  }

  generateSanctuaryFloor(): DungeonFloorData {
    const floor = generateSanctuaryFloorData();
    const dummyProp = floor.interactables.find((p) => p.type === 'training_dummy');
    if (dummyProp) {
      this.dummyAnchorPos = { ...dummyProp.position };
    } else {
      this.dummyAnchorPos = { ...SANCTUARY_LANDMARK_POSITIONS.trainingDummy };
    }

    if (!this.dummyEntity) {
      this.dummyEntity = createImmortalTrainingDummyEntity(this.dummyAnchorPos);
    } else {
      this.dummyEntity.statuses.length = 0;
      this.dummyEntity.__syncDummyAnchor?.(this.dummyAnchorPos);
    }

    this.lastPlayerPos = { ...floor.playerSpawn };
    return floor;
  }

  populateHubScene(
    floor: DungeonFloorData,
    scene: THREE.Scene,
    materials: IMaterialLibrary,
  ): void {
    this.disposeSceneResources();
    this.fallbackElapsedSec = 0;

    const dummyProp = floor.interactables?.find((p) => p.type === 'training_dummy');
    this.dummyAnchorPos = dummyProp
      ? { ...dummyProp.position }
      : { ...SANCTUARY_LANDMARK_POSITIONS.trainingDummy };

    if (!this.dummyEntity) {
      this.dummyEntity = createImmortalTrainingDummyEntity(this.dummyAnchorPos);
    } else {
      this.dummyEntity.statuses.length = 0;
      this.dummyEntity.__syncDummyAnchor?.(this.dummyAnchorPos);
    }

    const tracker: SharedHubResourceTracker = {
      getGeometry: (key: string, factory: () => THREE.BufferGeometry) => {
        let geom = this.geometryCache.get(key);
        if (!geom) {
          geom = factory();
          this.geometryCache.set(key, geom);
          this.ownedGeometries.push(geom);
        }
        return geom;
      },
      cloneMaterial: (lib: IMaterialLibrary, key: MaterialKey) => {
        const cloned = lib.clone(key);
        this.ownedMaterials.push(cloned);
        return cloned;
      },
      trackMaterial: <T extends THREE.Material>(mat: T): T => {
        this.ownedMaterials.push(mat);
        return mat;
      },
    };

    const root = new THREE.Group();
    root.name = 'SanctuaryHubRoot';

    const landmarks = buildSanctuaryLandmarks(floor, materials, tracker);
    const dummyRig = new TrainingDummyRig(this.dummyAnchorPos, materials, tracker);

    root.add(landmarks.group);
    root.add(dummyRig.root);
    scene.add(root);

    this.hostScene = scene;
    this.hubRootGroup = root;
    this.landmarksHandle = landmarks;
    this.dummyRig = dummyRig;
    this.dummyEntity.meshHandle = dummyRig;
    this.dedupeChecksRemaining = 3;
    this.syncSupersededSceneProps();

    const spawnPos = floor.playerSpawn ?? SANCTUARY_LANDMARK_POSITIONS.playerSpawn;
    this.lastPlayerPos = { ...spawnPos };
    landmarks.update(0, 0, this.lastPlayerPos);
  }

  getTrainingDummyEntity(): EnemyEntity | null {
    return this.dummyEntity;
  }

  getTrainingDummyRig(): TrainingDummyRig | null {
    return this.dummyRig;
  }

  recordDummyDamage(amount: number, isCrit: boolean): void {
    const recorded = this.dpsTracker.recordHit(amount, isCrit);
    if (!recorded) return;

    if (this.dummyEntity) {
      this.dummyEntity.__syncDummyAnchor?.();
    }

    this.dummyRig?.triggerStrikeImpulse(amount, isCrit, this.lastPlayerPos);
  }

  getDummyMetrics(): TrainingDummyMetrics {
    return this.dpsTracker.getMetrics();
  }

  resetDummyMetrics(): void {
    this.dpsTracker.reset();
  }

  update(dt: number, elapsedSec: number, playerPos: Vec3): void {
    const rawPositiveDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const animDt = clamp(rawPositiveDt, 0, 0.25);

    this.fallbackElapsedSec += animDt;
    const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : this.fallbackElapsedSec;

    if (
      playerPos &&
      Number.isFinite(playerPos.x) &&
      Number.isFinite(playerPos.z)
    ) {
      this.lastPlayerPos = {
        x: playerPos.x,
        y: Number.isFinite(playerPos.y) ? playerPos.y : 0,
        z: playerPos.z,
      };
    }

    if (rawPositiveDt > 0) {
      this.dpsTracker.advanceTime(rawPositiveDt);
    }

    if (this.dedupeChecksRemaining > 0) {
      this.dedupeChecksRemaining -= 1;
      this.syncSupersededSceneProps();
    }

    if (this.dummyEntity) {
      this.dummyEntity.__syncDummyAnchor?.();
    }

    this.landmarksHandle?.update(animDt, safeElapsed, this.lastPlayerPos);
    this.dummyRig?.update(animDt);
  }

  dispose(): void {
    this.disposeSceneResources();
    if (this.dummyEntity) {
      this.dummyEntity.meshHandle = undefined;
      this.dummyEntity = null;
    }
    this.dpsTracker.reset();
  }

  private syncSupersededSceneProps(): void {
    if (!this.hostScene) return;
    this.hostScene.traverse((obj) => {
      if (obj === this.hubRootGroup || !obj.visible || !obj.name) return;
      for (let i = 0; i < SUPERSEDED_PROP_PREFIXES.length; i++) {
        if (obj.name.startsWith(SUPERSEDED_PROP_PREFIXES[i])) {
          obj.visible = false;
          this.hiddenFallbackProps.push(obj);
          break;
        }
      }
    });
  }

  private disposeSceneResources(): void {
    for (let i = 0; i < this.hiddenFallbackProps.length; i++) {
      this.hiddenFallbackProps[i].visible = true;
    }
    this.hiddenFallbackProps.length = 0;
    this.dedupeChecksRemaining = 0;
    this.hostScene = null;

    if (this.dummyEntity) {
      this.dummyEntity.meshHandle = undefined;
    }

    if (this.dummyRig) {
      this.dummyRig.dispose();
      this.dummyRig = null;
    }

    if (this.hubRootGroup) {
      this.hubRootGroup.parent?.remove(this.hubRootGroup);
      this.hubRootGroup.clear();
      this.hubRootGroup = null;
    }

    this.landmarksHandle = null;

    for (let i = 0; i < this.ownedGeometries.length; i++) {
      this.ownedGeometries[i].dispose();
    }
    this.ownedGeometries.length = 0;
    this.geometryCache.clear();

    for (let i = 0; i < this.ownedMaterials.length; i++) {
      this.ownedMaterials[i].dispose();
    }
    this.ownedMaterials.length = 0;
  }
}

export function createSanctuaryHub(): ISanctuaryHub {
  return new SanctuaryHub();
}
