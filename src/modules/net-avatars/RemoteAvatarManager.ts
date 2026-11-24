import type * as THREE from 'three';
import type {
  DamageType,
  EmojiReactionId,
  HeroAnimState,
  HeroClassId,
  ICameraRig,
  IHeroRig,
  IRemoteAvatarManager,
  ItemRarity,
  PeerVoiceState,
  RemotePeerSnapshot,
  SocialEmoteId,
  TacticalPingType,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import { clamp, DAMAGE_TYPE_COLORS } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { createHeroRig } from '../hero-model';
import { RemoteCompanionOrb } from './companionOrb';
import {
  type AvatarOverlayPeerInput,
  EMOJI_REACTION_META,
  MultiplayerDomOverlayController,
} from './domOverlays';
import { PeerMotionInterpolator, sanitizeVec3 } from './interpolation';
import { type ActiveTacticalPing, RemoteEffectsController } from './remoteEffects';

interface ManagedRemoteAvatar {
  peerId: string;
  snapshot: RemotePeerSnapshot;
  rig: IHeroRig;
  interpolator: PeerMotionInterpolator;
  companionOrb: RemoteCompanionOrb;
  appliedClass: HeroClassId;
  appliedWeapon: WeaponVisualType;
  appliedRarity: ItemRarity;
  appliedAwakened: boolean;
  appliedDowned: boolean;
  appliedAnimState: HeroAnimState;
  appliedSocialEmote: SocialEmoteId | null;
  clashLockRemainingSec: number;
}

const ATTACK_ANIM_STATES = new Set<HeroAnimState>([
  'attack_1',
  'attack_2',
  'attack_3',
  'whirlwind',
  'leap_slam',
]);

function computePeerPhaseSeed(peerId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < peerId.length; i++) {
    hash ^= peerId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 6283) / 1000;
}

function clonePeerSnapshot(peer: RemotePeerSnapshot): RemotePeerSnapshot {
  return {
    ...peer,
    position: sanitizeVec3(peer.position),
    velocity: sanitizeVec3(peer.velocity),
  };
}

export class RemoteAvatarManager implements IRemoteAvatarManager {
  private scene: THREE.Scene | null = null;
  private readonly rigFactory: (cls: HeroClassId) => IHeroRig;
  private readonly avatars = new Map<string, ManagedRemoteAvatar>();
  private readonly effects = new RemoteEffectsController();
  private readonly overlays = new MultiplayerDomOverlayController();
  private readonly unsubs: Array<() => void> = [];

  private lastElapsedSec = 0;
  private disposed = false;

  constructor(rigFactory: (cls: HeroClassId) => IHeroRig = createHeroRig) {
    this.rigFactory = typeof rigFactory === 'function' ? rigFactory : createHeroRig;
  }

  public init(scene: THREE.Scene): void {
    if (this.disposed) return;
    this.scene = scene;

    this.effects.init(scene);
    this.overlays.ensureMounted();

    // Ensure any avatars synced prior to init() are attached to the scene
    for (const entry of this.avatars.values()) {
      if (entry.rig.root.parent !== scene) {
        scene.add(entry.rig.root);
      }
      if (entry.companionOrb.root.parent !== scene) {
        scene.add(entry.companionOrb.root);
      }
    }

    this.bindIsolationGuards();
  }

  /**
   * Protects remote HeroRig instances from global local-player EventBus broadcasts
   * (`hero:gearChanged`, `hero:classChanged`, `player:awakeningChanged`) so remote
   * teammates always retain their own synced class, weapon, and Archon wing state.
   */
  private bindIsolationGuards(): void {
    if (this.unsubs.length > 0) return;

    this.unsubs.push(
      eventBus.on('hero:gearChanged', () => {
        if (this.disposed) return;
        for (const entry of this.avatars.values()) {
          entry.rig.setWeaponVisual(entry.appliedWeapon, entry.appliedRarity);
        }
      }),
      eventBus.on('hero:classChanged', () => {
        if (this.disposed) return;
        for (const entry of this.avatars.values()) {
          entry.rig.setClassStyle(entry.appliedClass);
          entry.rig.setWeaponVisual(entry.appliedWeapon, entry.appliedRarity);
        }
      }),
      eventBus.on('player:awakeningChanged', () => {
        if (this.disposed) return;
        for (const entry of this.avatars.values()) {
          entry.rig.setAwakenedVisual?.(entry.appliedAwakened);
        }
      }),
    );
  }

  public syncPeers(peers: RemotePeerSnapshot[]): void {
    if (this.disposed) return;
    const safePeers = Array.isArray(peers) ? peers : [];
    const activeIds = new Set<string>();

    for (const rawPeer of safePeers) {
      if (!rawPeer || typeof rawPeer.peerId !== 'string' || !rawPeer.peerId) {
        continue;
      }

      const peer = clonePeerSnapshot(rawPeer);
      activeIds.add(peer.peerId);

      const existing = this.avatars.get(peer.peerId);
      if (!existing) {
        this.spawnAvatar(peer);
      } else {
        this.updateAvatarSnapshot(existing, peer);
      }
    }

    // Despawn & clean up any peers that left the session
    for (const [peerId, entry] of this.avatars.entries()) {
      if (!activeIds.has(peerId)) {
        this.despawnAvatar(peerId, entry);
      }
    }
  }

  private spawnAvatar(peer: RemotePeerSnapshot): void {
    const validClass: HeroClassId =
      peer.heroClass === 'vanguard' ||
      peer.heroClass === 'shadowblade' ||
      peer.heroClass === 'arcanist'
        ? peer.heroClass
        : 'vanguard';

    const rig = this.rigFactory(validClass);
    const interpolator = new PeerMotionInterpolator(
      peer.position,
      peer.velocity,
      peer.rotationY,
      peer.pingMs,
    );
    const companionOrb = new RemoteCompanionOrb(computePeerPhaseSeed(peer.peerId));

    const pos = interpolator.getPosition();
    const rotY = interpolator.getRotationY();
    rig.root.position.set(pos.x, pos.y, pos.z);
    rig.root.rotation.y = rotY;

    if (this.scene) {
      this.scene.add(rig.root);
      this.scene.add(companionOrb.root);
    }

    const weaponRarity: ItemRarity = peer.weaponRarity ?? 'common';
    const weaponVisual: WeaponVisualType = peer.weaponVisual ?? 'greatsword';
    const awakened = Boolean(peer.awakened);
    const downed = Boolean(peer.downed);
    const socialEmote: SocialEmoteId | null = peer.socialEmote ?? null;
    const animState: HeroAnimState = peer.animState ?? 'idle';

    rig.setClassStyle(validClass);
    rig.setWeaponVisual(weaponVisual, weaponRarity);
    rig.setAwakenedVisual?.(awakened);

    companionOrb.setPet(peer.activePet);
    companionOrb.setDowned(downed);
    companionOrb.update(this.lastElapsedSec, pos);

    if (downed) {
      if (rig.playSocialEmote) {
        rig.playSocialEmote('downed_kneel');
      } else {
        rig.playAnim('hit');
      }
    } else if (socialEmote) {
      if (rig.playSocialEmote) {
        rig.playSocialEmote(socialEmote);
      } else {
        rig.playAnim(animState);
      }
    } else {
      rig.playAnim(animState);
    }

    this.avatars.set(peer.peerId, {
      peerId: peer.peerId,
      snapshot: peer,
      rig,
      interpolator,
      companionOrb,
      appliedClass: validClass,
      appliedWeapon: weaponVisual,
      appliedRarity: weaponRarity,
      appliedAwakened: awakened,
      appliedDowned: downed,
      appliedAnimState: animState,
      appliedSocialEmote: socialEmote,
      clashLockRemainingSec: 0,
    });
  }

  private updateAvatarSnapshot(entry: ManagedRemoteAvatar, peer: RemotePeerSnapshot): void {
    entry.snapshot = peer;

    const { snapped } = entry.interpolator.applySnapshot(
      peer.position,
      peer.velocity,
      peer.rotationY,
      peer.pingMs,
    );

    if (snapped) {
      const snappedPos = entry.interpolator.getPosition();
      entry.rig.root.position.set(snappedPos.x, snappedPos.y, snappedPos.z);
      entry.rig.root.rotation.y = entry.interpolator.getRotationY();
      entry.companionOrb.update(this.lastElapsedSec, snappedPos);
    }

    const validClass: HeroClassId =
      peer.heroClass === 'vanguard' ||
      peer.heroClass === 'shadowblade' ||
      peer.heroClass === 'arcanist'
        ? peer.heroClass
        : entry.appliedClass;

    const weaponRarity: ItemRarity = peer.weaponRarity ?? 'common';
    const weaponVisual: WeaponVisualType = peer.weaponVisual ?? entry.appliedWeapon;
    const awakened = Boolean(peer.awakened);
    const downed = Boolean(peer.downed);

    if (validClass !== entry.appliedClass) {
      entry.appliedClass = validClass;
      entry.rig.setClassStyle(validClass);
      entry.rig.setWeaponVisual(weaponVisual, weaponRarity);
      entry.appliedWeapon = weaponVisual;
      entry.appliedRarity = weaponRarity;
    } else if (weaponVisual !== entry.appliedWeapon || weaponRarity !== entry.appliedRarity) {
      entry.appliedWeapon = weaponVisual;
      entry.appliedRarity = weaponRarity;
      entry.rig.setWeaponVisual(weaponVisual, weaponRarity);
    }

    if (awakened !== entry.appliedAwakened) {
      entry.appliedAwakened = awakened;
      entry.rig.setAwakenedVisual?.(awakened);
    }

    entry.companionOrb.setPet(peer.activePet);
    entry.companionOrb.setDowned(downed);

    // Pose & animation synchronization: downed kneel > paired clash > socialEmote > animState
    if (downed) {
      if (!entry.appliedDowned) {
        entry.appliedDowned = true;
        entry.clashLockRemainingSec = 0;
        if (entry.rig.playSocialEmote) {
          entry.rig.playSocialEmote('downed_kneel');
        } else {
          entry.rig.playAnim('hit');
        }
      }
      return;
    }

    if (entry.appliedDowned) {
      entry.appliedDowned = false;
      const recoveryAnim: HeroAnimState = peer.animState ?? 'idle';
      entry.appliedAnimState = recoveryAnim;
      entry.appliedSocialEmote = null;
      entry.rig.playAnim(recoveryAnim);
      entry.rig.playEquipFlourish?.(weaponRarity);
    }

    if (entry.clashLockRemainingSec > 0) {
      return;
    }

    const nextEmote: SocialEmoteId | null = peer.socialEmote ?? null;
    if (nextEmote !== entry.appliedSocialEmote) {
      entry.appliedSocialEmote = nextEmote;
      if (nextEmote) {
        entry.rig.playSocialEmote?.(nextEmote);
      } else {
        const fallbackAnim: HeroAnimState = peer.animState ?? 'idle';
        entry.appliedAnimState = fallbackAnim;
        entry.rig.playAnim(fallbackAnim);
      }
    }

    const nextAnim: HeroAnimState = peer.animState ?? 'idle';
    if (!nextEmote && nextAnim !== entry.appliedAnimState) {
      entry.appliedAnimState = nextAnim;
      entry.rig.playAnim(nextAnim);
      if (ATTACK_ANIM_STATES.has(nextAnim)) {
        entry.rig.triggerSlashTrail?.();
      } else if (nextAnim === 'hit') {
        entry.rig.flashHit(0xff6b6b);
      }
    }
  }

  private despawnAvatar(peerId: string, entry: ManagedRemoteAvatar): void {
    if (entry.rig.root.parent) {
      entry.rig.root.parent.remove(entry.rig.root);
    }
    entry.rig.dispose();
    entry.companionOrb.dispose();
    this.overlays.removePeerDom(peerId);
    this.avatars.delete(peerId);
  }

  public playRemoteSkillVisual(
    peerId: string,
    damageType: DamageType,
    origin: Vec3,
    facingDir: Vec3,
    targetPos?: Vec3,
  ): void {
    if (this.disposed) return;

    const colorHex = DAMAGE_TYPE_COLORS[damageType]?.hex ?? 0xf1e9d2;
    const entry = this.avatars.get(peerId);
    if (entry) {
      entry.rig.triggerSlashTrail?.(colorHex, 0.45);
    }

    this.effects.spawnSkillVisual(damageType, origin, facingDir, targetPos);
  }

  public showSpeechBubble(peerId: string, senderName: string, text: string): void {
    if (this.disposed) return;
    const entry = this.avatars.get(peerId);
    const anchorPos = entry ? entry.interpolator.getPosition() : { x: 0, y: 0, z: 0 };
    this.overlays.showSpeechBubble(peerId, senderName, text, anchorPos);
  }

  public spawnEmojiBurst(peerId: string, emojiId: EmojiReactionId, fallbackPos: Vec3): void {
    if (this.disposed) return;
    const entry = this.avatars.get(peerId);
    const worldPos = entry ? entry.interpolator.getPosition() : sanitizeVec3(fallbackPos);

    this.overlays.spawnEmojiBurst(peerId, emojiId, worldPos);
    const sparkHex = EMOJI_REACTION_META[emojiId]?.hex ?? 0xffd43b;
    this.effects.spawnEmojiSparkles3D(worldPos, sparkHex);
  }

  public spawnTacticalPing(
    peerId: string,
    senderName: string,
    pingType: TacticalPingType,
    position: Vec3,
  ): void {
    if (this.disposed) return;
    this.effects.spawnTacticalPing(peerId, senderName, pingType, position);
    this.overlays.ensureMounted();
  }

  public triggerRemotePairedClash(peerId: string, midpoint: Vec3): void {
    if (this.disposed) return;
    const safeMid = sanitizeVec3(midpoint);

    this.effects.spawnPairedClashBurst(safeMid);

    const entry = this.avatars.get(peerId);
    if (!entry) return;

    entry.interpolator.triggerClashStep(safeMid, 0.56);
    const steppedPos = entry.interpolator.getPosition();
    const clashRotY = entry.interpolator.getRotationY();

    entry.rig.root.position.set(steppedPos.x, steppedPos.y, steppedPos.z);
    entry.rig.root.rotation.y = clashRotY;

    entry.clashLockRemainingSec = 0.62;
    entry.appliedSocialEmote = 'high_five_strike';

    if (entry.rig.playSocialEmote) {
      entry.rig.playSocialEmote('high_five_strike');
    } else {
      entry.rig.playAnim('attack_1');
    }
    entry.rig.triggerSlashTrail?.(0xffd43b, 0.56);
  }

  public update(
    dt: number,
    elapsedSec: number,
    voiceStates: Record<string, PeerVoiceState>,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    if (this.disposed) return;

    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : this.lastElapsedSec + safeDt;
    this.lastElapsedSec = safeElapsed;

    const overlayInputs: AvatarOverlayPeerInput[] = [];

    for (const entry of this.avatars.values()) {
      if (entry.clashLockRemainingSec > 0) {
        entry.clashLockRemainingSec = Math.max(0, entry.clashLockRemainingSec - safeDt);
      }

      const { position, rotationY, horizontalSpeed } = entry.interpolator.step(safeDt);
      entry.rig.root.position.set(position.x, position.y, position.z);
      entry.rig.root.rotation.y = rotationY;

      const snapSpeed = Math.hypot(entry.snapshot.velocity.x, entry.snapshot.velocity.z);
      let moveSpeedNormalized = 0;
      if (!entry.appliedDowned && entry.clashLockRemainingSec <= 0) {
        if (entry.appliedSocialEmote && snapSpeed < 0.45) {
          // Preserve looping idle social emotes against micro-interpolation settle velocity
          moveSpeedNormalized = 0;
        } else {
          const blendedSpeed = Math.max(snapSpeed, horizontalSpeed * 0.85);
          moveSpeedNormalized = clamp(blendedSpeed / 7.5, 0, 1.35);
        }
      }

      entry.rig.update(safeDt, moveSpeedNormalized);
      entry.companionOrb.update(safeElapsed, position);

      overlayInputs.push({
        snapshot: entry.snapshot,
        interpolatedPos: position,
      });
    }

    this.effects.update(safeDt);

    const safeProject: ICameraRig['worldToScreen'] =
      typeof worldToScreen === 'function'
        ? worldToScreen
        : () => ({ x: 0, y: 0, visible: false });

    this.overlays.update(
      safeDt,
      safeElapsed,
      overlayInputs,
      this.effects.getActivePings(),
      voiceStates ?? {},
      safeProject,
    );
  }

  public getAvatarRig(peerId: string): IHeroRig | undefined {
    return this.avatars.get(peerId)?.rig;
  }

  public getActiveTacticalPings(): readonly ActiveTacticalPing[] {
    return this.effects.getActivePings();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;

    for (const [peerId, entry] of this.avatars.entries()) {
      this.despawnAvatar(peerId, entry);
    }
    this.avatars.clear();

    this.effects.dispose();
    this.overlays.dispose();
    this.scene = null;
  }
}
