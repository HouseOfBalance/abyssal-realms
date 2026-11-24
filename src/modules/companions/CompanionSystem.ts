import * as THREE from 'three';
import type {
  CompanionRosterState,
  DerivedStats,
  DungeonFloorData,
  EnemyEntity,
  ICombatEngine,
  ICompanionSystem,
  ILootSystem,
  IMaterialLibrary,
  MercenaryId,
  PetId,
  PlayerRuntimeState,
  Vec3,
} from '../../contracts/types';
import {
  ALL_MERCENARY_IDS,
  ALL_PET_IDS,
} from './companionData';
import { CompanionResourcePool } from './CompanionResourcePool';
import { MercenaryController } from './MercenaryController';
import { PetController } from './PetController';

export class CompanionSystem implements ICompanionSystem {
  public readonly rootGroup = new THREE.Group();

  private readonly resources = new CompanionResourcePool();
  private readonly petCtrl: PetController;
  private readonly mercCtrl: MercenaryController;

  private scene: THREE.Scene | null = null;
  private disposed = false;

  constructor() {
    this.rootGroup.name = 'CompanionSystemRoot';
    this.petCtrl = new PetController(this.resources);
    this.mercCtrl = new MercenaryController(this.resources);
    this.rootGroup.add(this.petCtrl.container, this.mercCtrl.container);
  }

  public init(scene: THREE.Scene, materials: IMaterialLibrary): void {
    this.disposed = false;

    if (this.scene && this.scene !== scene) {
      this.scene.remove(this.rootGroup);
    }
    this.scene = scene;

    // Release any prior owned GPU buffers/clones before rebuilding
    this.resources.disposeAll();
    this.resources.setMaterialLibrary(materials);

    this.petCtrl.rebuildRigs();
    this.mercCtrl.rebuildRigs();

    if (this.rootGroup.parent !== scene) {
      scene.add(this.rootGroup);
    }
  }

  public setActivePet(petId: PetId): void {
    if (this.disposed) return;
    this.petCtrl.setActivePet(petId);
  }

  public setActiveMercenary(mercId: MercenaryId): void {
    if (this.disposed) return;
    this.mercCtrl.setActiveMercenary(mercId);
  }

  public getState(): CompanionRosterState {
    return {
      activePet: this.petCtrl.getActivePet(),
      unlockedPets: [...ALL_PET_IDS],
      activeMercenary: this.mercCtrl.getActiveMercenary(),
      unlockedMercenaries: [...ALL_MERCENARY_IDS],
      mercenaryName: this.mercCtrl.getMercenaryName(),
      mercenaryHp: this.mercCtrl.getHp(),
      mercenaryMaxHp: this.mercCtrl.getMaxHp(),
      mercenaryAlive: this.mercCtrl.isAlive(),
      mercenaryLevel: this.mercCtrl.getLevel(),
    };
  }

  public respawnAt(pos: Vec3, playerLevel: number): void {
    if (this.disposed) return;
    this.petCtrl.respawnNear(pos);
    this.mercCtrl.respawnAt(pos, playerLevel);
  }

  public update(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    enemies: EnemyEntity[],
    loot: ILootSystem,
    combat: ICombatEngine,
    inSanctuary = false,
  ): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;

    this.petCtrl.update(dt, elapsedSec, player, floor, loot);
    this.mercCtrl.update(dt, elapsedSec, player, floor, enemies, combat, inSanctuary);
  }

  public computeCompanionAuraBonuses(): Partial<DerivedStats> {
    return this.petCtrl.computeAuraBonuses();
  }

  public getPetPosition(): Vec3 {
    return this.petCtrl.getPosition();
  }

  public getMercenaryPosition(): Vec3 {
    return this.mercCtrl.getPosition();
  }

  public getResourceCounts(): { geometries: number; materials: number; textures: number } {
    return this.resources.getCounts();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.scene) {
      this.scene.remove(this.rootGroup);
      this.scene = null;
    }

    this.petCtrl.container.clear();
    this.mercCtrl.container.clear();
    this.resources.disposeAll();
  }
}
