import type * as THREE from 'three';
import type {
  IVfxAudioSystem,
  MusicMood,
  SfxId,
  Vec3,
  VfxEffectType,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { ProceduralAudioEngine } from './ProceduralAudioEngine';
import { VfxPoolSystem } from './VfxPoolSystem';

/** Particle caps per performance tier (matches DeviceDetector TIER_SETTINGS) */
const PARTICLE_CAPS: Record<string, number> = {
  low: 50,
  medium: 150,
  high: 400,
  ultra: 1000,
};

export class VfxAudioSystem implements IVfxAudioSystem {
  private vfxPool = new VfxPoolSystem();
  private audioEngine = new ProceduralAudioEngine();
  private unsubscribers: Array<() => void> = [];
  private lastListenerPos: Vec3 = { x: 0, y: 0, z: 0 };
  private disposed = false;

  /** Max concurrent particles allowed; set via setPerformanceTier() */
  private particleCap = 400; // default = 'high'

  /** Tracks last time spatial audio was fully updated (ms timestamp) */
  private lastSpatialUpdateMs = 0;

  constructor() {
    this.bindEvents();
  }

  private bindEvents(): void {
    if (this.unsubscribers.length > 0) return;

    const offVfx = eventBus.on('vfx:request', (payload) => {
      if (!payload || !payload.position) return;
      this.spawnVfx(payload.type, payload.position, {
        direction: payload.direction,
        colorHex: payload.colorHex,
        radius: payload.radius,
        scale: payload.scale,
      });
    });

    const offSfx = eventBus.on('sfx:request', (payload) => {
      if (!payload) return;
      this.playSfx(payload.id, payload.position);
    });

    const offPickupStarted = eventBus.on('loot:pickupStarted', (payload) => {
      if (this.disposed || !payload || !payload.drop) return;
      const origin = payload.fromPos ?? payload.drop.position;
      if (origin) {
        this.vfxPool.emitSoulPickupTrail(
          origin,
          payload.drop.kind,
          payload.drop.item?.rarity,
          payload.drop.item?.isMythic,
          payload.drop.runeId,
        );
      }
      this.audioEngine.playPickupLaunchChime(payload.drop, origin);
    });

    const offPickedUp = eventBus.on('loot:pickedUp', (payload) => {
      if (this.disposed || !payload || !payload.drop) return;
      this.audioEngine.playPickupArrivalComboChime(payload.drop, payload.drop.position);
    });

    const offGearChanged = eventBus.on('hero:gearChanged', (payload) => {
      if (this.disposed || !payload) return;
      const rarity = payload.rarity ?? payload.item?.rarity;
      const isMythic = payload.item?.isMythic;
      this.vfxPool.emitGearEquipBurst(this.lastListenerPos, payload.weaponVisual, rarity, isMythic);
      this.audioEngine.playGearEquipStinger(payload.weaponVisual, rarity, payload.slot, isMythic);
    });

    const offClassChanged = eventBus.on('hero:classChanged', (payload) => {
      if (this.disposed || !payload) return;
      this.vfxPool.emitClassChangeBurst(this.lastListenerPos, payload.heroClass);
      this.audioEngine.playClassSwapStinger(payload.heroClass);
    });

    const offPortalWarp = eventBus.on('dungeon:portalWarp', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitPortalWarpBurst(payload.position);
      this.audioEngine.playPortalWarpStinger(payload.position);
    });

    const offElementalReaction = eventBus.on('combat:elementalReaction', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitElementalReactionBurst(payload.reaction, payload.position);
      this.audioEngine.playElementalReactionSfx(payload.reaction, payload.position);
    });

    const offParry = eventBus.on('combat:parryTriggered', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitParryBurst(payload.position, payload.counterSuccess);
      this.audioEngine.playParrySfx(payload.counterSuccess, payload.position);
    });

    const offExecution = eventBus.on('combat:executionStrike', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitExecutionStrikeBurst(payload.position);
      this.audioEngine.playExecutionStrikeSfx(payload.position);
    });

    const offAwakening = eventBus.on('player:awakeningChanged', (payload) => {
      if (this.disposed || !payload) return;
      const pos = payload.position ?? this.lastListenerPos;
      this.vfxPool.emitAwakeningBurst(pos, payload.active);
      this.audioEngine.playAwakeningSfx(payload.active, pos);
    });

    const offButcher = eventBus.on('event:butcherInvasion', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitButcherInvasionBurst(payload.position);
      this.audioEngine.playButcherInvasionSfx(payload.position);
    });

    const offGoblin = eventBus.on('event:goblinSpawned', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitGoblinSpawnBurst(payload.position);
      this.audioEngine.playGoblinSpawnSfx(payload.position);
    });

    const offMimic = eventBus.on('event:mimicRevealed', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitMimicRevealBurst(payload.position);
      this.audioEngine.playMimicRevealSfx(payload.position);
    });

    const offRuneword = eventBus.on('event:runewordForged', (payload) => {
      if (this.disposed || !payload) return;
      this.vfxPool.emitRunewordForgedBurst(this.lastListenerPos);
      this.audioEngine.playRunewordForgedSfx();
    });

    const offRunePickup = eventBus.on('rune:pickedUp', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitRunePickupBurst(payload.position, payload.runeId);
      this.audioEngine.playRunePickupSfx(payload.runeId, payload.position);
    });

    // Phase 4 Cross-Network Multiplayer Co-op EventBus Subscriptions
    const offMpChatPop = eventBus.on('mp:chatPop', (payload) => {
      if (this.disposed || !payload) return;
      if (payload.position) {
        this.vfxPool.emitMpChatPopBurst(payload.position);
      }
      this.audioEngine.playMpChatPopSfx(payload.position);
    });

    const offMpEmoji = eventBus.on('mp:emojiBurst', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitMpEmojiBurst(payload.emojiId, payload.position);
      this.audioEngine.playMpEmojiBurstSfx(payload.emojiId, payload.position);
    });

    const offMpPing = eventBus.on('mp:tacticalPing', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitMpTacticalPingBurst(payload.pingType, payload.position);
      this.audioEngine.playMpTacticalPingSfx(payload.pingType, payload.position);
    });

    const offMpEmote = eventBus.on('mp:socialEmote', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitMpSocialEmoteBurst(payload.emoteId, payload.position);
      this.audioEngine.playMpSocialEmoteSfx(payload.emoteId, payload.position);
    });

    const offMpHighFive = eventBus.on('mp:highFiveClash', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitMpHighFiveClashBurst(payload.position);
      this.audioEngine.playMpHighFiveClashSfx(payload.position);
    });

    const offMpRevived = eventBus.on('mp:teammateRevived', (payload) => {
      if (this.disposed || !payload || !payload.position) return;
      this.vfxPool.emitMpTeammateRevivedBurst(payload.position);
      this.audioEngine.playMpTeammateRevivedSfx(payload.position);
    });

    const offMpVoicePtt = eventBus.on('mp:voicePtt', (payload) => {
      if (this.disposed || !payload) return;
      this.audioEngine.playMpVoicePttSfx(payload.active);
    });

    this.unsubscribers.push(
      offVfx,
      offSfx,
      offPickupStarted,
      offPickedUp,
      offGearChanged,
      offClassChanged,
      offPortalWarp,
      offElementalReaction,
      offParry,
      offExecution,
      offAwakening,
      offButcher,
      offGoblin,
      offMimic,
      offRuneword,
      offRunePickup,
      offMpChatPop,
      offMpEmoji,
      offMpPing,
      offMpEmote,
      offMpHighFive,
      offMpRevived,
      offMpVoicePtt,
    );
  }

  init(scene: THREE.Scene): void {
    if (this.disposed) {
      this.disposed = false;
      this.audioEngine = new ProceduralAudioEngine();
    }
    this.bindEvents();
    this.vfxPool.init(scene);
  }

  unlockAudio(): void {
    this.audioEngine.unlockAudio();
  }

  spawnVfx(
    type: VfxEffectType,
    position: Vec3,
    options?: { direction?: Vec3; colorHex?: number; radius?: number; scale?: number },
  ): void {
    if (this.disposed || !position) return;
    // Early-return if concurrent particle count is at the tier cap
    if (this.vfxPool.getActiveParticleCount() >= this.particleCap) return;
    this.vfxPool.spawnVfx(type, position, options);
  }

  playSfx(id: SfxId, worldPos?: Vec3): void {
    if (this.disposed) return;
    this.audioEngine.playSfx(id, worldPos);
  }

  setMusicMood(mood: MusicMood): void {
    if (this.disposed) return;
    this.audioEngine.setMusicMood(mood);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    if (this.disposed) return;
    this.audioEngine.setVolumes(master, music, sfx);
  }

  getPickupComboStep(): number {
    return this.audioEngine.getPickupComboStep();
  }

  /**
   * Adjusts the concurrent-particle cap to match the given performance tier.
   * Recognized tiers: 'low' (50), 'medium' (150), 'high' (400), 'ultra' (1000).
   * Unknown strings are silently ignored.
   */
  setPerformanceTier(tier: string): void {
    const cap = PARTICLE_CAPS[tier];
    if (cap !== undefined) {
      this.particleCap = cap;
    }
  }

  update(dt: number, listenerPos: Vec3): void {
    if (this.disposed) return;
    if (
      listenerPos &&
      Number.isFinite(listenerPos.x) &&
      Number.isFinite(listenerPos.y) &&
      Number.isFinite(listenerPos.z)
    ) {
      this.lastListenerPos.x = listenerPos.x;
      this.lastListenerPos.y = listenerPos.y;
      this.lastListenerPos.z = listenerPos.z;
    }
    this.vfxPool.update(dt, this.lastListenerPos);

    // Throttle spatial listener-position updates to 10 Hz (100 ms).
    // Always call audioEngine.update() every frame so music sequencer and
    // pickup combo timers tick correctly; only refresh the listener position
    // argument at 10 Hz to avoid redundant 3D-panning recalculations.
    const nowMs = performance.now();
    const spatialPos =
      nowMs - this.lastSpatialUpdateMs >= 100
        ? (this.lastSpatialUpdateMs = nowMs, this.lastListenerPos)
        : this.lastListenerPos; // same ref — engine caches it internally
    this.audioEngine.update(dt, spatialPos);
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.vfxPool.dispose();
    this.audioEngine.dispose();
    this.disposed = true;
  }
}

export function createVfxAudioSystem(): IVfxAudioSystem {
  return new VfxAudioSystem();
}
