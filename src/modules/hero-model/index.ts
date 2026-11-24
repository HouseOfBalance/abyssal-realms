import * as THREE from 'three';
import type {
  HeroAnimState,
  HeroClassId,
  IHeroRig,
  ItemRarity,
  SocialEmoteId,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import { clamp, distXZ, HERO_CLASS_CONFIG, MYTHIC_COLOR, RARITY_COLORS } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { AwakeningRig } from './AwakeningRig';
import { HeroAnimator } from './HeroAnimator';
import { HeroMaterialManager } from './HeroMaterials';
import type { HeroSkeletonNodes } from './SkeletonBuilder';
import { SkeletonBuilder } from './SkeletonBuilder';
import type { ActiveWeaponRig } from './WeaponBuilder';
import { WeaponBuilder } from './WeaponBuilder';
import { WeaponTrailController } from './WeaponTrailRibbon';

const HIT_FLASH_DURATION_SEC = 0.14;
const MATERIALIZE_FLASH_DURATION_SEC = 0.28;

/**
 * Tracks the primary local player's HeroRig so additional co-op remote avatars
 * spawned by `RemoteAvatarManager` stay cleanly isolated from local player EventBus hooks.
 */
let primaryLocalRig: HeroRig | null = null;

export class HeroRig implements IHeroRig {
  public readonly root: THREE.Group;

  private readonly materialManager: HeroMaterialManager;
  private readonly skeletonBuilder: SkeletonBuilder;
  private readonly weaponBuilder: WeaponBuilder;
  private readonly animator: HeroAnimator;
  private readonly trailController: WeaponTrailController;
  private readonly awakeningRig: AwakeningRig;
  private readonly nodes: HeroSkeletonNodes;
  private readonly unsubs: Array<() => void> = [];
  private readonly isPrimaryLocalRig: boolean;

  private currentClass: HeroClassId | null = null;
  private weaponRig: ActiveWeaponRig | null = null;
  private explicitWeaponSet = false;
  private bootstrapped = false;

  private hitFlashRemaining = 0;
  private readonly hitFlashColor = new THREE.Color(0xffffff);

  private materializeFlashRemaining = 0;
  private readonly materializeFlashColor = new THREE.Color(0xffd479);
  private readonly tmpVec = new THREE.Vector3();

  private disposed = false;

  constructor(
    heroClass: HeroClassId = 'vanguard',
    options?: { isRemoteAvatar?: boolean },
  ) {
    this.materialManager = new HeroMaterialManager();
    this.skeletonBuilder = new SkeletonBuilder();
    this.weaponBuilder = new WeaponBuilder();
    this.animator = new HeroAnimator();

    this.nodes = this.skeletonBuilder.createSkeletonHierarchy();
    this.root = this.nodes.root;
    this.trailController = new WeaponTrailController(this.root);
    this.awakeningRig = new AwakeningRig(this.nodes);

    this.setClassStyle(heroClass);
    const defaultWeapon = HERO_CLASS_CONFIG[this.currentClass ?? 'vanguard'].startingWeapon;
    this.buildWeaponInternal(defaultWeapon, 'common');
    this.update(0, 0);

    if (!options?.isRemoteAvatar && (primaryLocalRig === null || primaryLocalRig.disposed)) {
      primaryLocalRig = this;
      this.isPrimaryLocalRig = true;
      this.bindEvents();
    } else {
      this.isPrimaryLocalRig = false;
    }

    this.bootstrapped = true;
  }

  private isNearLocalRoot(pos: Vec3, maxDist: number): boolean {
    return distXZ(this.root.position, pos) <= maxDist;
  }

  private bindEvents(): void {
    this.unsubs.push(
      eventBus.on('loot:pickupStarted', ({ fromPos }) => {
        if (this.disposed) return;
        this.playPickupGesture(fromPos);
      }),
      eventBus.on('rune:pickedUp', ({ position }) => {
        if (this.disposed) return;
        this.playPickupGesture(position);
      }),
      eventBus.on('hero:gearChanged', ({ item, weaponVisual, rarity }) => {
        if (this.disposed) return;
        const weaponRarity = rarity ?? item?.rarity ?? this.weaponRig?.rarity ?? 'common';
        this.setWeaponVisual(weaponVisual, weaponRarity);
        if (item?.isMythic) {
          this.animator.triggerEquipFlourish();
          this.materializeFlashRemaining = MATERIALIZE_FLASH_DURATION_SEC * 1.2;
          this.materializeFlashColor.setHex(MYTHIC_COLOR.hex);
          this.trailController.trigger(MYTHIC_COLOR.hex, 0.52);
          this.syncMaterials();
        } else {
          this.playEquipFlourish(item?.rarity ?? weaponRarity);
        }
      }),
      eventBus.on('event:runewordForged', ({ item }) => {
        if (this.disposed) return;
        this.playEquipFlourish(item.rarity);
        this.trailController.trigger(0xffd43b, 0.5);
      }),
      eventBus.on('hero:classChanged', ({ heroClass }) => {
        if (this.disposed) return;
        this.setClassStyle(heroClass);
        this.playEquipFlourish(this.weaponRig?.rarity ?? 'common');
      }),
      eventBus.on('combat:parryTriggered', ({ counterSuccess }) => {
        if (this.disposed) return;
        this.playParryAnim(counterSuccess);
      }),
      eventBus.on('combat:executionStrike', () => {
        if (this.disposed) return;
        this.playExecuteFinisher();
      }),
      eventBus.on('player:awakeningChanged', ({ active }) => {
        if (this.disposed) return;
        this.setAwakenedVisual(active);
      }),
      eventBus.on('mp:socialEmote', ({ emoteId, position }) => {
        if (this.disposed) return;
        if (this.isNearLocalRoot(position, 2.5)) {
          this.playSocialEmote(emoteId);
        }
      }),
      eventBus.on('mp:highFiveClash', ({ position }) => {
        if (this.disposed) return;
        if (this.isNearLocalRoot(position, 5.0)) {
          this.playSocialEmote('high_five_strike');
        }
      }),
      eventBus.on('mp:teammateRevived', ({ position }) => {
        if (this.disposed) return;
        if (
          this.animator.getActiveSocialEmote() === 'downed_kneel' &&
          this.isNearLocalRoot(position, 4.0)
        ) {
          this.playAnim('idle');
          this.playEquipFlourish('legendary');
        }
      }),
    );
  }

  private resolveDefaultTrailColor(heroClass: HeroClassId, rarity: ItemRarity): number {
    if (rarity !== 'common') {
      return RARITY_COLORS[rarity]?.hex ?? 0xd0d0d0;
    }
    const classColor = new THREE.Color(HERO_CLASS_CONFIG[heroClass].primaryColorHex);
    const steelWhite = new THREE.Color(0xeaf0f8);
    return steelWhite.lerp(classColor, 0.48).getHex();
  }

  setClassStyle(heroClass: HeroClassId): void {
    if (this.disposed) return;

    const validClass: HeroClassId =
      heroClass === 'vanguard' || heroClass === 'shadowblade' || heroClass === 'arcanist'
        ? heroClass
        : 'vanguard';

    if (this.currentClass === validClass) return;
    this.currentClass = validClass;

    const palette = this.materialManager.buildClassPalette(validClass);
    this.skeletonBuilder.populateClassArmor(validClass, this.nodes, palette);

    if (!this.explicitWeaponSet && this.weaponRig) {
      const classWeapon = HERO_CLASS_CONFIG[validClass].startingWeapon;
      if (this.weaponRig.weaponType !== classWeapon) {
        this.buildWeaponInternal(classWeapon, this.weaponRig.rarity);
      }
    }

    const activeRarity = this.weaponRig?.rarity ?? 'common';
    this.trailController.setDefaultColor(this.resolveDefaultTrailColor(validClass, activeRarity));
    this.trailController.clear();

    if (this.bootstrapped) {
      this.playEquipFlourish(activeRarity);
    }

    this.syncMaterials();
    this.animator.update(0, 0, this.nodes, this.weaponRig);
  }

  setWeaponVisual(weapon: WeaponVisualType, rarity: ItemRarity = 'common'): void {
    if (this.disposed) return;
    this.explicitWeaponSet = true;

    if (
      this.weaponRig &&
      this.weaponRig.weaponType === weapon &&
      this.weaponRig.rarity === rarity
    ) {
      return;
    }

    this.buildWeaponInternal(weapon, rarity);
    this.trailController.clear();

    if (this.bootstrapped) {
      this.playEquipFlourish(rarity);
    }

    this.animator.update(0, 0, this.nodes, this.weaponRig);
  }

  private buildWeaponInternal(weapon: WeaponVisualType, rarity: ItemRarity): void {
    const weaponMats = this.materialManager.buildWeaponMaterials(rarity);
    this.weaponRig = this.weaponBuilder.buildWeapon(weapon, rarity, this.nodes, weaponMats);
    const cls = this.currentClass ?? 'vanguard';
    this.trailController.setDefaultColor(this.resolveDefaultTrailColor(cls, rarity));
    this.syncMaterials();
  }

  playAnim(state: HeroAnimState, speedMultiplier = 1): void {
    if (this.disposed) return;
    this.animator.playAnim(state, speedMultiplier);
  }

  playSocialEmote(emoteId: SocialEmoteId): void {
    if (this.disposed) return;
    const prevEmote = this.animator.getActiveSocialEmote();
    this.animator.triggerSocialEmote(emoteId);

    if (emoteId === 'high_five_strike' && prevEmote !== 'high_five_strike') {
      this.materializeFlashRemaining = 0.34;
      this.materializeFlashColor.setHex(0xffe066);
      this.trailController.trigger(0xffd43b, 0.76);
      this.syncMaterials();
    } else if (emoteId === 'revive_channel' && prevEmote !== 'revive_channel') {
      this.materializeFlashRemaining = 0.22;
      this.materializeFlashColor.setHex(0xffde7a);
      this.syncMaterials();
    }
  }

  getActiveSocialEmote(): SocialEmoteId | null {
    return this.animator.getActiveSocialEmote();
  }

  playPickupGesture(targetWorldPos?: Vec3): void {
    if (this.disposed) return;
    if (
      targetWorldPos &&
      Number.isFinite(targetWorldPos.x) &&
      Number.isFinite(targetWorldPos.y) &&
      Number.isFinite(targetWorldPos.z)
    ) {
      this.root.updateWorldMatrix(true, false);
      this.tmpVec.set(targetWorldPos.x, targetWorldPos.y, targetWorldPos.z);
      this.root.worldToLocal(this.tmpVec);
      this.animator.triggerPickupGesture(this.tmpVec.x, this.tmpVec.z);
    } else {
      this.animator.triggerPickupGesture(0.28, 0.65);
    }
  }

  playEquipFlourish(rarity?: ItemRarity): void {
    if (this.disposed) return;
    const effectiveRarity: ItemRarity = rarity ?? this.weaponRig?.rarity ?? 'common';
    const flourishHex =
      effectiveRarity === 'common'
        ? 0xffd479
        : (RARITY_COLORS[effectiveRarity]?.hex ?? 0xffd479);

    this.animator.triggerEquipFlourish();
    this.materializeFlashRemaining = MATERIALIZE_FLASH_DURATION_SEC;
    this.materializeFlashColor.setHex(flourishHex);
    this.trailController.trigger(flourishHex, 0.44);
    this.syncMaterials();
  }

  playParryAnim(counterSuccess = false): void {
    if (this.disposed) return;
    this.animator.triggerParryAnim(counterSuccess);

    if (counterSuccess) {
      this.materializeFlashRemaining = 0.24;
      this.materializeFlashColor.setHex(0xffe066);
      this.trailController.trigger(0xffd43b, 0.56);
    } else {
      this.materializeFlashRemaining = Math.max(this.materializeFlashRemaining, 0.14);
      this.materializeFlashColor.setHex(0xffde7a);
      this.trailController.trigger(0xffde7a, 0.18);
    }
    this.syncMaterials();
  }

  playExecuteFinisher(): void {
    if (this.disposed) return;
    this.animator.triggerExecuteFinisher();
    this.materializeFlashRemaining = 0.32;
    this.materializeFlashColor.setHex(0xff5938);
    this.trailController.trigger(0xff4d2b, 0.72);
    this.syncMaterials();
  }

  setAwakenedVisual(active: boolean): void {
    if (this.disposed) return;
    const wasActive = this.awakeningRig.isActive();
    this.awakeningRig.setActive(active);

    if (active && !wasActive) {
      this.animator.triggerEquipFlourish();
      this.materializeFlashRemaining = 0.36;
      this.materializeFlashColor.setHex(0xffd43b);
      this.trailController.trigger(0xffd43b, 0.6);
    }
    this.syncMaterials();
  }

  triggerSlashTrail(colorHex?: number, durationSec = 0.38): void {
    if (this.disposed) return;
    this.trailController.trigger(colorHex, durationSec);
  }

  flashHit(colorHex = 0xffffff): void {
    if (this.disposed) return;
    this.hitFlashRemaining = HIT_FLASH_DURATION_SEC;
    this.hitFlashColor.setHex(Number.isFinite(colorHex) ? colorHex : 0xffffff);
    this.syncMaterials();
  }

  update(dt: number, moveSpeedNormalized: number): void {
    if (this.disposed) return;
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const safeMove = Number.isFinite(moveSpeedNormalized) ? clamp(moveSpeedNormalized, 0, 1.5) : 0;

    if (this.hitFlashRemaining > 0) {
      this.hitFlashRemaining = Math.max(0, this.hitFlashRemaining - safeDt);
    }
    if (this.materializeFlashRemaining > 0) {
      this.materializeFlashRemaining = Math.max(0, this.materializeFlashRemaining - safeDt);
    }

    this.animator.update(safeDt, safeMove, this.nodes, this.weaponRig);

    this.awakeningRig.update(
      safeDt,
      this.animator.getGlobalTime(),
      safeMove,
      this.animator.isFlareActionActive(),
      this.animator.getDeathDimFactor(),
    );

    const weaponType = this.weaponRig?.weaponType ?? 'greatsword';
    const { emitMain, emitOff } = this.animator.getActiveTrailEmission(weaponType);
    this.trailController.update(
      safeDt,
      this.animator.getGlobalTime(),
      this.root,
      this.weaponRig,
      emitMain,
      emitOff,
    );

    this.syncMaterials();
  }

  private syncMaterials(): void {
    const t = this.animator.getGlobalTime();
    const pulseWave = Math.sin(t * 3.2);
    const deathDim = this.animator.getDeathDimFactor();

    let flashAlpha = 0;
    let activeColor = this.hitFlashColor;

    if (this.hitFlashRemaining > 0) {
      flashAlpha = clamp(this.hitFlashRemaining / HIT_FLASH_DURATION_SEC, 0, 1);
      activeColor = this.hitFlashColor;
    } else if (this.materializeFlashRemaining > 0) {
      const u = clamp(this.materializeFlashRemaining / MATERIALIZE_FLASH_DURATION_SEC, 0, 1);
      flashAlpha = u * 0.78;
      activeColor = this.materializeFlashColor;
    } else if (this.awakeningRig.isActive()) {
      flashAlpha = 0.16 + 0.06 * Math.sin(t * 5.4);
      this.materializeFlashColor.setHex(0xffd452);
      activeColor = this.materializeFlashColor;
    } else if (this.animator.getActiveSocialEmote() === 'revive_channel') {
      flashAlpha = 0.22 + 0.08 * Math.sin(t * 6.5);
      this.materializeFlashColor.setHex(0xffe066);
      activeColor = this.materializeFlashColor;
    }

    this.materialManager.applyHitFlashAndDeathDim(
      flashAlpha,
      activeColor,
      deathDim,
      pulseWave,
    );
  }

  getWeaponTipWorldPosition(out?: THREE.Vector3): THREE.Vector3 {
    const target = out ?? new THREE.Vector3();
    if (this.disposed) {
      return target.set(0, 0, 0);
    }

    this.root.updateWorldMatrix(true, true);

    let anchor: THREE.Object3D = this.nodes.rightHand;
    if (this.weaponRig) {
      if (
        this.weaponRig.weaponType === 'daggers' &&
        this.animator.isOffhandPrimaryStrike() &&
        this.weaponRig.offTipAnchor
      ) {
        anchor = this.weaponRig.offTipAnchor;
      } else {
        anchor = this.weaponRig.mainTipAnchor;
      }
    }

    anchor.getWorldPosition(target);
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
      this.root.getWorldPosition(target);
      target.y += 1.0;
    }
    return target;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (primaryLocalRig === this) {
      primaryLocalRig = null;
    }

    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;

    this.awakeningRig.dispose();
    this.trailController.dispose();

    this.weaponBuilder.clearWeapons(this.nodes);
    this.weaponBuilder.dispose();

    this.skeletonBuilder.clearArmorGeometry(this.nodes);
    this.skeletonBuilder.dispose();

    this.nodes.groundRingMat.dispose();
    this.materialManager.dispose();

    if (this.root.parent) {
      this.root.parent.remove(this.root);
    }
    this.root.clear();
    this.weaponRig = null;
  }
}

export function createHeroRig(
  heroClass: HeroClassId = 'vanguard',
  options?: { isRemoteAvatar?: boolean },
): IHeroRig {
  return new HeroRig(heroClass, options);
}
