import type * as THREE from 'three';
import type {
  ISocialInteractionSystem,
  LocalDownedState,
  PairedInteractionKind,
  PlayerRuntimeState,
  RemotePeerSnapshot,
  SocialBuffState,
  SocialEmoteId,
  Vec3,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  type DistressBeaconVisualInput,
  type InviteRingVisualInput,
  SocialVfxRenderer,
} from './SocialVfxRenderer';

export const CAMARADERIE_INVITE_RADIUS_M = 3.8;
export const CAMARADERIE_INVITE_DURATION_SEC = 6.0;
export const PAIRED_ACCEPT_RANGE_M = 4.2;

export const SWORN_BRETHREN_DURATION_SEC = 60.0;
export const SWORN_BRETHREN_XP_GOLD_MULT = 1.25;
export const SWORN_BRETHREN_MOVE_SPEED_BONUS = 1.15;
export const SWORN_BRETHREN_POWER_MULT = 1.2;

export const DOWNED_BLEEDOUT_TOTAL_SEC = 15.0;
export const REVIVE_RANGE_M = 3.5;
export const REVIVE_CHANNEL_DURATION_SEC = 1.6;
export const REVIVE_HP_RESTORE_RATIO = 0.65;
export const REVIVE_IFRAME_SEC = 3.0;

export const EMOTE_DURATIONS_SEC: Record<SocialEmoteId, number> = {
  wave: 2.5,
  cheer: 2.8,
  dance: 8.0,
  taunt: 2.6,
  kneel_pray: 7.5,
  sit_rest: 10.0,
  laugh: 2.6,
  point: 2.2,
  high_five_ready: CAMARADERIE_INVITE_DURATION_SEC,
  high_five_strike: 1.45,
  downed_kneel: DOWNED_BLEEDOUT_TOTAL_SEC,
  revive_channel: REVIVE_CHANNEL_DURATION_SEC,
};

interface PendingRemoteInvite {
  fromPeerId: string;
  fromName: string;
  kind: PairedInteractionKind;
  position: Vec3;
  remainingSec: number;
}

function safeVec3(pos: Vec3 | null | undefined): Vec3 {
  if (!pos) return { x: 0, y: 0, z: 0 };
  return {
    x: Number.isFinite(pos.x) ? pos.x : 0,
    y: Number.isFinite(pos.y) ? pos.y : 0,
    z: Number.isFinite(pos.z) ? pos.z : 0,
  };
}

export class SocialInteractionSystem implements ISocialInteractionSystem {
  public readonly vfx = new SocialVfxRenderer();

  private scene: THREE.Scene | null = null;
  private disposed = false;

  // Active Solo / Paired / Co-op Emote State
  private activeEmote: SocialEmoteId | null = null;
  private activeEmoteRemainingSec = 0;

  // Local & Remote Camaraderie High-Five / Blade Clash Invites
  private localInviteRemainingSec = 0;
  private localInviteOrigin: Vec3 = { x: 0, y: 0, z: 0 };
  private localInvitePeerId = '';
  private localInviteName = '';
  private readonly pendingRemoteInvites = new Map<string, PendingRemoteInvite>();

  // 60s Sworn Brethren Co-op Buff
  private swornBrethrenSec = 0;

  // Local Co-op Downed Bleedout State
  private downedState: LocalDownedState = {
    isDowned: false,
    bleedoutRemainingSec: 0,
    bleedoutTotalSec: DOWNED_BLEEDOUT_TOTAL_SEC,
    reviveProgress01: 0,
    reviverName: undefined,
  };
  private lastDownedPlayer: PlayerRuntimeState | null = null;
  private incomingReviveSignalTtlSec = 0;

  // Outgoing Teammate Revive Channel State
  private channelingPeerId: string | null = null;
  private reviveChannelElapsedSec = 0;
  private readonly completedPeerCooldowns = new Map<string, number>();
  private cachedDownedPeers: RemotePeerSnapshot[] = [];

  // Cached timing / position for immediate 3D visual sync
  private lastLocalPos: Vec3 = { x: 0, y: 0, z: 0 };
  private lastElapsedSec = 0;

  public init(scene: THREE.Scene): void {
    if (this.disposed) return;
    this.scene = scene;
    this.vfx.attachToScene(scene);
  }

  public triggerSoloEmote(emoteId: SocialEmoteId, playerPos: Vec3): void {
    if (this.disposed) return;
    if (this.downedState.isDowned && emoteId !== 'downed_kneel') {
      return;
    }

    const pos = safeVec3(playerPos);
    this.lastLocalPos = pos;

    const duration = EMOTE_DURATIONS_SEC[emoteId] ?? 2.5;
    this.activeEmote = emoteId;
    this.activeEmoteRemainingSec = duration;

    if (emoteId !== 'high_five_ready') {
      this.localInviteRemainingSec = 0;
    }

    this.vfx.configureSoloEmote(emoteId, pos);
    this.syncVfx(0, this.lastElapsedSec, pos);

    eventBus.emit('mp:socialEmote', {
      emoteId,
      position: { ...pos },
    });
  }

  public requestPairedHighFive(
    playerPos: Vec3,
    localPeerId: string,
    localName: string,
  ): {
    acceptedImmediatePeerId?: string;
    midpoint?: Vec3;
  } {
    if (this.disposed || this.downedState.isDowned) {
      return {};
    }

    const pos = safeVec3(playerPos);
    this.lastLocalPos = pos;

    // 1. Check if a remote teammate already has an active Camaraderie Invite within 4.2m!
    const matchedInvite = this.findClosestRemoteInvite(pos, PAIRED_ACCEPT_RANGE_M, localPeerId);
    if (matchedInvite) {
      const midpoint: Vec3 = {
        x: (pos.x + matchedInvite.position.x) * 0.5,
        y: (pos.y + matchedInvite.position.y) * 0.5,
        z: (pos.z + matchedInvite.position.z) * 0.5,
      };

      this.pendingRemoteInvites.delete(matchedInvite.fromPeerId);
      this.localInviteRemainingSec = 0;

      this.activeEmote = 'high_five_strike';
      this.activeEmoteRemainingSec = EMOTE_DURATIONS_SEC.high_five_strike;
      this.vfx.configureSoloEmote('high_five_strike', pos);
      this.syncVfx(0, this.lastElapsedSec, pos);

      return {
        acceptedImmediatePeerId: matchedInvite.fromPeerId,
        midpoint,
      };
    }

    // 2. Otherwise spawn a 3.8m Golden Pulsing Camaraderie Invitation Ring for 6.0s!
    this.localInviteRemainingSec = CAMARADERIE_INVITE_DURATION_SEC;
    this.localInviteOrigin = { ...pos };
    this.localInvitePeerId = localPeerId || 'local';
    this.localInviteName = localName || 'Hero';

    this.activeEmote = 'high_five_ready';
    this.activeEmoteRemainingSec = CAMARADERIE_INVITE_DURATION_SEC;

    this.vfx.configureSoloEmote('high_five_ready', pos);
    this.syncVfx(0, this.lastElapsedSec, pos);

    eventBus.emit('mp:socialEmote', {
      emoteId: 'high_five_ready',
      position: { ...pos },
    });

    return {};
  }

  public receiveRemotePairedRequest(
    fromPeerId: string,
    fromName: string,
    kind: PairedInteractionKind,
    position: Vec3,
  ): void {
    if (this.disposed || !fromPeerId) return;

    const pos = safeVec3(position);

    if (kind === 'revive') {
      if (this.downedState.isDowned) {
        this.downedState.reviverName = fromName || 'Teammate';
        this.incomingReviveSignalTtlSec = 0.65;
        this.syncVfx(0, this.lastElapsedSec, this.lastLocalPos);
      }
      return;
    }

    this.pendingRemoteInvites.set(fromPeerId, {
      fromPeerId,
      fromName: fromName || 'Teammate',
      kind,
      position: pos,
      remainingSec: CAMARADERIE_INVITE_DURATION_SEC,
    });

    this.syncVfx(0, this.lastElapsedSec, this.lastLocalPos);
  }

  public executePairedCelebration(midpoint: Vec3, localPos: Vec3): void {
    if (this.disposed) return;

    const mid = safeVec3(midpoint);
    const loc = safeVec3(localPos);
    this.lastLocalPos = loc;

    // Consume active local & nearby remote invitation rings cleanly
    this.localInviteRemainingSec = 0;
    for (const [peerId, invite] of this.pendingRemoteInvites.entries()) {
      if (distXZ(invite.position, mid) <= 5.0 || distXZ(invite.position, loc) <= 5.0) {
        this.pendingRemoteInvites.delete(peerId);
      }
    }

    if (!this.downedState.isDowned) {
      this.activeEmote = 'high_five_strike';
      this.activeEmoteRemainingSec = EMOTE_DURATIONS_SEC.high_five_strike;
      this.vfx.configureSoloEmote('high_five_strike', loc);
    }

    // Activate 60s Sworn Brethren Co-op Buff!
    this.swornBrethrenSec = SWORN_BRETHREN_DURATION_SEC;

    // Erupt monumental 3D Golden Fresnel Camaraderie Shockwave + Twin Crossing Light Blades + Rising Sparks
    this.vfx.spawnPairedCelebration(mid, loc);
    this.syncVfx(0, this.lastElapsedSec, loc);

    eventBus.emit('mp:highFiveClash', {
      position: { ...mid },
    });
  }

  public enterDownedState(player: PlayerRuntimeState): void {
    if (this.disposed || !player) return;

    const pos = safeVec3(player.position);
    this.lastLocalPos = pos;
    this.lastDownedPlayer = player;

    // Stabilize player on bleedout life-support so solo permadeath waits until bleedout expires
    player.hp = 1;
    player.alive = true;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    player.isDodging = false;
    player.statuses = [];

    if (this.downedState.isDowned) {
      this.syncVfx(0, this.lastElapsedSec, pos);
      return;
    }

    this.localInviteRemainingSec = 0;
    this.resetReviveChannel();

    this.downedState = {
      isDowned: true,
      bleedoutRemainingSec: DOWNED_BLEEDOUT_TOTAL_SEC,
      bleedoutTotalSec: DOWNED_BLEEDOUT_TOTAL_SEC,
      reviveProgress01: 0,
      reviverName: undefined,
    };

    this.activeEmote = 'downed_kneel';
    this.activeEmoteRemainingSec = DOWNED_BLEEDOUT_TOTAL_SEC;

    this.syncVfx(0, this.lastElapsedSec, pos);

    eventBus.emit('mp:socialEmote', {
      emoteId: 'downed_kneel',
      position: { ...pos },
    });
  }

  public reviveLocalPlayer(player: PlayerRuntimeState, saviorName?: string): void {
    if (this.disposed || !player) return;

    const pos = safeVec3(player.position);
    this.lastLocalPos = pos;

    this.downedState = {
      isDowned: false,
      bleedoutRemainingSec: 0,
      bleedoutTotalSec: DOWNED_BLEEDOUT_TOTAL_SEC,
      reviveProgress01: 0,
      reviverName: saviorName,
    };
    this.lastDownedPlayer = null;
    this.incomingReviveSignalTtlSec = 0;

    if (this.activeEmote === 'downed_kneel') {
      this.activeEmote = null;
      this.activeEmoteRemainingSec = 0;
    }

    // Restore 65% MaxHP + 3.0s invulnerability frames
    const maxHp = Math.max(1, player.stats?.maxHp ?? 100);
    player.alive = true;
    player.hp = clamp(Math.round(maxHp * REVIVE_HP_RESTORE_RATIO), 1, maxHp);
    if (player.stats?.maxMana) {
      player.mana = Math.min(
        player.stats.maxMana,
        Math.max(player.mana, Math.round(player.stats.maxMana * 0.5)),
      );
    }
    if (player.stats?.maxStamina) {
      player.stamina = player.stats.maxStamina;
    }
    player.isDodging = false;
    player.statuses = [];
    player.invulnerableSec = Math.max(player.invulnerableSec || 0, REVIVE_IFRAME_SEC);

    this.vfx.spawnReviveAscension(pos);
    this.syncVfx(0, this.lastElapsedSec, pos);

    eventBus.emit('mp:teammateRevived', {
      position: { ...pos },
    });
  }

  public tryChannelTeammateRevive(
    dt: number,
    localPos: Vec3,
    downedPeers: RemotePeerSnapshot[],
    holdingInteract: boolean,
  ): { channelingPeerId: string | null; progress01: number; completedPeerId: string | null } {
    if (this.disposed) {
      return { channelingPeerId: null, progress01: 0, completedPeerId: null };
    }

    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const pos = safeVec3(localPos);
    this.lastLocalPos = pos;

    // Tick recently-completed peer cooldown guards
    for (const [peerId, cd] of this.completedPeerCooldowns.entries()) {
      const next = cd - safeDt;
      if (next <= 0) {
        this.completedPeerCooldowns.delete(peerId);
      } else {
        this.completedPeerCooldowns.set(peerId, next);
      }
    }

    // Track downed remote peers so 3D distress beacon rings render around fallen allies
    this.cachedDownedPeers = Array.isArray(downedPeers)
      ? downedPeers.filter((p) => Boolean(p && p.downed))
      : [];

    if (this.downedState.isDowned || !holdingInteract || this.cachedDownedPeers.length === 0) {
      this.resetReviveChannel();
      this.syncVfx(0, this.lastElapsedSec, pos);
      return { channelingPeerId: null, progress01: 0, completedPeerId: null };
    }

    // Select downed peer within 3.5m (stick to current target if still downed & in range)
    let targetPeer: RemotePeerSnapshot | null = null;
    if (this.channelingPeerId) {
      const existing = this.cachedDownedPeers.find(
        (p) =>
          p.peerId === this.channelingPeerId &&
          !this.completedPeerCooldowns.has(p.peerId) &&
          distXZ(pos, p.position) <= REVIVE_RANGE_M,
      );
      if (existing) {
        targetPeer = existing;
      }
    }

    if (!targetPeer) {
      let bestDist = REVIVE_RANGE_M;
      for (let i = 0; i < this.cachedDownedPeers.length; i++) {
        const candidate = this.cachedDownedPeers[i];
        if (this.completedPeerCooldowns.has(candidate.peerId)) continue;
        const d = distXZ(pos, candidate.position);
        if (d <= bestDist) {
          bestDist = d;
          targetPeer = candidate;
        }
      }
      if (targetPeer && targetPeer.peerId !== this.channelingPeerId) {
        this.reviveChannelElapsedSec = 0;
      }
    }

    if (!targetPeer) {
      this.resetReviveChannel();
      this.syncVfx(0, this.lastElapsedSec, pos);
      return { channelingPeerId: null, progress01: 0, completedPeerId: null };
    }

    // Channel 3D Golden Celestial Revive Beam (1.6s fill -> completedPeerId)
    const startedNewChannel = this.channelingPeerId !== targetPeer.peerId;
    this.channelingPeerId = targetPeer.peerId;
    this.reviveChannelElapsedSec += safeDt;
    this.activeEmote = 'revive_channel';
    this.activeEmoteRemainingSec = Math.max(this.activeEmoteRemainingSec, 0.25);

    if (startedNewChannel) {
      this.vfx.configureSoloEmote('revive_channel', pos);
      eventBus.emit('mp:socialEmote', {
        emoteId: 'revive_channel',
        position: { ...pos },
      });
    }

    const progress01 = clamp(this.reviveChannelElapsedSec / REVIVE_CHANNEL_DURATION_SEC, 0, 1);
    const targetPos = safeVec3(targetPeer.position);

    if (this.reviveChannelElapsedSec >= REVIVE_CHANNEL_DURATION_SEC - 1e-6) {
      const completedId = targetPeer.peerId;
      this.completedPeerCooldowns.set(completedId, 0.6);
      this.resetReviveChannel();
      this.cachedDownedPeers = this.cachedDownedPeers.filter((p) => p.peerId !== completedId);

      this.vfx.spawnReviveAscension(targetPos);
      this.syncVfx(0, this.lastElapsedSec, pos);

      eventBus.emit('mp:teammateRevived', {
        position: { ...targetPos },
      });

      return {
        channelingPeerId: null,
        progress01: 1,
        completedPeerId: completedId,
      };
    }

    this.vfx.updateReviveBeam(true, pos, targetPos, progress01, this.lastElapsedSec);
    this.syncVfx(0, this.lastElapsedSec, pos);

    return {
      channelingPeerId: targetPeer.peerId,
      progress01: Math.round(progress01 * 1000) / 1000,
      completedPeerId: null,
    };
  }

  public getLocalActiveEmote(): SocialEmoteId | null {
    if (this.disposed) return null;
    if (this.downedState.isDowned) return 'downed_kneel';
    return this.activeEmote;
  }

  public getLocalDownedState(): LocalDownedState {
    return {
      isDowned: this.downedState.isDowned,
      bleedoutRemainingSec: Math.max(
        0,
        Math.round(this.downedState.bleedoutRemainingSec * 100) / 100,
      ),
      bleedoutTotalSec: this.downedState.bleedoutTotalSec,
      reviveProgress01: clamp(
        Math.round(this.downedState.reviveProgress01 * 1000) / 1000,
        0,
        1,
      ),
      reviverName: this.downedState.reviverName,
    };
  }

  public getSocialBuffState(): SocialBuffState {
    if (this.swornBrethrenSec <= 0) {
      return {
        swornBrethrenSec: 0,
        xpGoldMultiplier: 1.0,
        moveSpeedBonus: 1.0,
        powerMultiplier: 1.0,
      };
    }

    return {
      swornBrethrenSec: Math.max(0, Math.round(this.swornBrethrenSec * 100) / 100),
      xpGoldMultiplier: SWORN_BRETHREN_XP_GOLD_MULT,
      moveSpeedBonus: SWORN_BRETHREN_MOVE_SPEED_BONUS,
      powerMultiplier: SWORN_BRETHREN_POWER_MULT,
    };
  }

  public getNearbyPendingInvite(localPos: Vec3): {
    fromPeerId: string;
    fromName: string;
    kind: PairedInteractionKind;
    position: Vec3;
  } | null {
    if (this.disposed) return null;
    const pos = safeVec3(localPos);
    const best = this.findClosestRemoteInvite(pos, PAIRED_ACCEPT_RANGE_M);
    if (!best) return null;

    return {
      fromPeerId: best.fromPeerId,
      fromName: best.fromName,
      kind: best.kind,
      position: { ...best.position },
    };
  }

  public update(dt: number, elapsedSec: number, localPos: Vec3): void {
    if (this.disposed) return;

    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : this.lastElapsedSec + safeDt;
    const pos = safeVec3(localPos);

    this.lastElapsedSec = safeElapsed;
    this.lastLocalPos = pos;

    // 1. Tick Local Co-op Downed Bleedout State (15.0s)
    if (this.downedState.isDowned) {
      this.activeEmote = 'downed_kneel';
      this.downedState.bleedoutRemainingSec = Math.max(
        0,
        this.downedState.bleedoutRemainingSec - safeDt,
      );

      if (this.incomingReviveSignalTtlSec > 0) {
        this.incomingReviveSignalTtlSec = Math.max(0, this.incomingReviveSignalTtlSec - safeDt);
        this.downedState.reviveProgress01 = clamp(
          this.downedState.reviveProgress01 + safeDt / REVIVE_CHANNEL_DURATION_SEC,
          0,
          0.99,
        );
        if (this.incomingReviveSignalTtlSec <= 0) {
          this.downedState.reviveProgress01 = 0;
          this.downedState.reviverName = undefined;
        }
      }

      if (this.downedState.bleedoutRemainingSec <= 0) {
        this.downedState.isDowned = false;
        this.downedState.reviveProgress01 = 0;
        this.downedState.reviverName = undefined;
        this.activeEmote = null;
        this.activeEmoteRemainingSec = 0;

        if (this.lastDownedPlayer) {
          this.lastDownedPlayer.hp = 0;
          this.lastDownedPlayer.alive = false;
          this.lastDownedPlayer.invulnerableSec = 0;
          this.lastDownedPlayer = null;
        }
      }
    } else if (this.activeEmote !== null && this.channelingPeerId === null) {
      // 2. Tick Solo / Paired Emote Auto-Duration
      this.activeEmoteRemainingSec -= safeDt;
      if (this.activeEmoteRemainingSec <= 0) {
        this.activeEmote = null;
        this.activeEmoteRemainingSec = 0;
      }
    }

    // 3. Tick Local 3.8m Camaraderie Invitation Ring (6.0s)
    if (this.localInviteRemainingSec > 0) {
      this.localInviteRemainingSec = Math.max(0, this.localInviteRemainingSec - safeDt);
      this.localInviteOrigin = { ...pos };
      if (this.localInviteRemainingSec <= 0 && this.activeEmote === 'high_five_ready') {
        this.activeEmote = null;
        this.activeEmoteRemainingSec = 0;
      }
    }

    // 4. Tick Remote Pending Paired Invites (6.0s TTL)
    for (const [peerId, invite] of this.pendingRemoteInvites.entries()) {
      invite.remainingSec -= safeDt;
      if (invite.remainingSec <= 0) {
        this.pendingRemoteInvites.delete(peerId);
      }
    }

    // 5. Tick 60s Sworn Brethren Co-op Buff
    if (this.swornBrethrenSec > 0) {
      this.swornBrethrenSec = Math.max(0, this.swornBrethrenSec - safeDt);
    }

    // 6. Update all 3D GLSL Rings, Sparkles, Twin Blades, Distress Beacons & Beams
    this.syncVfx(safeDt, safeElapsed, pos);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.activeEmote = null;
    this.activeEmoteRemainingSec = 0;
    this.localInviteRemainingSec = 0;
    this.pendingRemoteInvites.clear();
    this.swornBrethrenSec = 0;

    this.downedState = {
      isDowned: false,
      bleedoutRemainingSec: 0,
      bleedoutTotalSec: DOWNED_BLEEDOUT_TOTAL_SEC,
      reviveProgress01: 0,
      reviverName: undefined,
    };
    this.lastDownedPlayer = null;
    this.cachedDownedPeers = [];
    this.completedPeerCooldowns.clear();
    this.resetReviveChannel();

    this.vfx.dispose();
    this.scene = null;
  }

  private resetReviveChannel(): void {
    this.channelingPeerId = null;
    this.reviveChannelElapsedSec = 0;
    if (this.activeEmote === 'revive_channel') {
      this.activeEmote = null;
      this.activeEmoteRemainingSec = 0;
    }
    this.vfx.updateReviveBeam(false, this.lastLocalPos, this.lastLocalPos, 0, this.lastElapsedSec);
  }

  private findClosestRemoteInvite(
    origin: Vec3,
    maxDistanceM: number,
    excludePeerId?: string,
  ): PendingRemoteInvite | null {
    let best: PendingRemoteInvite | null = null;
    let bestDist = maxDistanceM;

    for (const invite of this.pendingRemoteInvites.values()) {
      if (invite.remainingSec <= 0) continue;
      if (excludePeerId && invite.fromPeerId === excludePeerId) continue;

      const d = distXZ(origin, invite.position);
      if (d <= bestDist) {
        bestDist = d;
        best = invite;
      }
    }

    return best;
  }

  private syncVfx(dt: number, elapsedSec: number, localPos: Vec3): void {
    const inviteRings: InviteRingVisualInput[] = [];
    if (this.localInviteRemainingSec > 0) {
      inviteRings.push({
        id: this.localInvitePeerId || 'local',
        position: this.localInviteOrigin,
        remainingSec: this.localInviteRemainingSec,
      });
    }
    for (const invite of this.pendingRemoteInvites.values()) {
      if (invite.remainingSec > 0) {
        inviteRings.push({
          id: invite.fromPeerId,
          position: invite.position,
          remainingSec: invite.remainingSec,
        });
      }
    }

    const distressBeacons: DistressBeaconVisualInput[] = [];
    if (this.downedState.isDowned) {
      const urgency01 =
        1.0 -
        clamp(
          this.downedState.bleedoutRemainingSec / Math.max(1, this.downedState.bleedoutTotalSec),
          0,
          1,
        );
      distressBeacons.push({
        id: 'local',
        position: localPos,
        urgency01,
        reviveProgress01: this.downedState.reviveProgress01,
      });
    }

    for (let i = 0; i < this.cachedDownedPeers.length; i++) {
      const peer = this.cachedDownedPeers[i];
      if (!peer || !peer.downed) continue;
      const peerBleed = peer.downedBleedoutSec ?? DOWNED_BLEEDOUT_TOTAL_SEC * 0.5;
      const urgency01 = 1.0 - clamp(peerBleed / DOWNED_BLEEDOUT_TOTAL_SEC, 0, 1);
      const isChannelTarget = this.channelingPeerId === peer.peerId;
      const progress01 = isChannelTarget
        ? clamp(this.reviveChannelElapsedSec / REVIVE_CHANNEL_DURATION_SEC, 0, 1)
        : 0;

      distressBeacons.push({
        id: peer.peerId,
        position: safeVec3(peer.position),
        urgency01,
        reviveProgress01: progress01,
      });
    }

    if (this.channelingPeerId) {
      const activeTarget = this.cachedDownedPeers.find((p) => p.peerId === this.channelingPeerId);
      if (activeTarget) {
        const p01 = clamp(this.reviveChannelElapsedSec / REVIVE_CHANNEL_DURATION_SEC, 0, 1);
        this.vfx.updateReviveBeam(true, localPos, safeVec3(activeTarget.position), p01, elapsedSec);
      }
    }

    this.vfx.update(
      dt,
      elapsedSec,
      localPos,
      this.activeEmote,
      this.activeEmoteRemainingSec,
      inviteRings,
      this.swornBrethrenSec,
      distressBeacons,
    );
  }
}
