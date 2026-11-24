import type {
  HeroClassId,
  IMultiplayerTransport,
  MultiplayerConnectionInfo,
  MultiplayerTransportMode,
  NetPacket,
  RemotePeerSnapshot,
} from '../../contracts/types';
import {
  type BroadcastChannelFactory,
  LocalTabsBackend,
} from './localTabsBackend';
import {
  DEFAULT_RELAY_URL,
  generateRandomToken,
  generateRoomCode,
  getRoomCodeFromUrl,
  MAX_PARTY_PEERS,
  MAX_REMOTE_PEERS,
  normalizeRelayUrl,
  normalizeRoomCode,
} from './roomCode';
import { SimulatedPartnerAgent } from './simulatedPartner';
import {
  type PeerFactory,
  WebRtcCloudBackend,
} from './webrtcCloudBackend';
import {
  type WebSocketFactory,
  WebSocketRelayBackend,
} from './websocketRelayBackend';
import {
  type BackendCallbacks,
  clonePacket,
  clonePeerSnapshot,
  type ITransportBackend,
  nowMs,
} from './wireProtocol';

export interface MultiplayerTransportDeps {
  peerFactory?: PeerFactory;
  webSocketFactory?: WebSocketFactory;
  broadcastChannelFactory?: BroadcastChannelFactory;
  connectTimeoutMs?: number;
  localJoinTimeoutMs?: number;
}

const STATE_SYNC_INTERVAL_SEC = 0.04; // 25Hz network state broadcast
const BOT_SYNC_INTERVAL_SEC = 0.04; // 25Hz simulated partner state notification
const PING_PROBE_INTERVAL_SEC = 1.5;

export class MultiplayerTransport implements IMultiplayerTransport {
  private readonly deps: MultiplayerTransportDeps;

  private backend: ITransportBackend | null = null;
  private mode: MultiplayerTransportMode = 'webrtc_cloud';
  private connected = false;
  private connecting = false;
  private simulatedOnlySession = false;
  private isHost = false;
  private roomCode = '';
  private localPeerId: string;
  private localNickname = 'Wanderer';
  private relayUrl: string | undefined = undefined;
  private errorMessage: string | undefined = undefined;
  private sessionEpoch = 0;

  private readonly remotePeers = new Map<string, RemotePeerSnapshot>();
  private readonly peerRttMs = new Map<string, number>();
  private readonly simulatedPartners = new Map<string, SimulatedPartnerAgent>();
  private simulatedSpawnSeq = 0;

  private readonly packetHandlers = new Set<(fromPeerId: string, packet: NetPacket) => void>();
  private readonly peersChangedHandlers = new Set<(peers: RemotePeerSnapshot[]) => void>();

  private lastLocalSnapshot: RemotePeerSnapshot | null = null;
  private lastSentDowned = false;
  private lastSentAwakened = false;
  private lastSentEmote: RemotePeerSnapshot['socialEmote'] = null;
  private lastSentAnim: RemotePeerSnapshot['animState'] = 'idle';

  private stateSyncAccumSec = 0;
  private botSyncAccumSec = 0;
  private pingAccumSec = 0;

  constructor(deps: MultiplayerTransportDeps = {}) {
    this.deps = deps;
    this.localPeerId = `peer-local-${generateRandomToken(6)}`;
  }

  public getConnectionInfo(): MultiplayerConnectionInfo {
    const activeRemoteCount = this.getTotalRemoteCount();
    const isConnected = this.connected || this.simulatedPartners.size > 0;
    const peerCount = isConnected ? Math.min(MAX_PARTY_PEERS, 1 + activeRemoteCount) : 0;

    return {
      connected: isConnected,
      connecting: this.connecting,
      mode: this.mode,
      roomCode: this.roomCode,
      localPeerId: this.localPeerId,
      localNickname: this.localNickname,
      isHost: this.isHost,
      relayUrl: this.relayUrl,
      peerCount,
      errorMessage: this.errorMessage,
    };
  }

  public setLocalNickname(name: string): void {
    const cleaned = (name ?? '').trim().slice(0, 24);
    this.localNickname = cleaned.length > 0 ? cleaned : 'Wanderer';

    if (this.lastLocalSnapshot) {
      this.lastLocalSnapshot.nickname = this.localNickname;
    }
    if (this.connected && this.backend) {
      this.backend.broadcast({
        type: 'player_state',
        state: this.buildLocalOutboundSnapshot(),
      });
    }
  }

  public getPendingUrlRoomCode(urlOrSearch?: string): string | null {
    return getRoomCodeFromUrl(urlOrSearch);
  }

  public async hostRoom(
    mode: MultiplayerTransportMode,
    options?: { customRoomCode?: string; relayUrl?: string },
  ): Promise<string> {
    this.teardownSession(true);
    const epoch = ++this.sessionEpoch;

    const customCode = options?.customRoomCode
      ? normalizeRoomCode(options.customRoomCode)
      : undefined;
    const initialCode = customCode || generateRoomCode(6);

    this.mode = mode;
    this.connecting = true;
    this.connected = false;
    this.simulatedOnlySession = false;
    this.isHost = true;
    this.roomCode = initialCode;
    this.errorMessage = undefined;
    this.relayUrl =
      mode === 'websocket_relay' ? normalizeRelayUrl(options?.relayUrl ?? DEFAULT_RELAY_URL) : undefined;

    const callbacks = this.createBackendCallbacks(epoch);
    const getOccupiedSlots = () => this.getTotalRemoteCount();

    try {
      let createdBackend: ITransportBackend;

      if (mode === 'webrtc_cloud') {
        createdBackend = await WebRtcCloudBackend.createHost(
          customCode,
          callbacks,
          getOccupiedSlots,
          {
            peerFactory: this.deps.peerFactory,
            connectTimeoutMs: this.deps.connectTimeoutMs,
            maxGuests: MAX_REMOTE_PEERS,
          },
        );
      } else if (mode === 'websocket_relay') {
        const hostId = `relay-host-${initialCode}-${generateRandomToken(5)}`;
        createdBackend = await WebSocketRelayBackend.connect(
          initialCode,
          hostId,
          true,
          callbacks,
          {
            relayUrl: this.relayUrl,
            webSocketFactory: this.deps.webSocketFactory,
            connectTimeoutMs: this.deps.connectTimeoutMs,
          },
        );
      } else {
        const hostId = `tab-host-${initialCode}-${generateRandomToken(5)}`;
        createdBackend = LocalTabsBackend.createHost(
          initialCode,
          hostId,
          callbacks,
          getOccupiedSlots,
          {
            channelFactory: this.deps.broadcastChannelFactory,
            maxGuests: MAX_REMOTE_PEERS,
          },
        );
      }

      if (epoch !== this.sessionEpoch) {
        createdBackend.close();
        return '';
      }

      this.backend = createdBackend;
      this.localPeerId = createdBackend.localPeerId;
      this.roomCode = createdBackend.roomCode;
      this.connecting = false;
      this.connected = true;

      // Broadcast initial host snapshot immediately so lobby roster syncs before gameplay starts
      this.backend.broadcast({
        type: 'player_state',
        state: this.buildLocalOutboundSnapshot(),
      });
      this.notifyPeersChanged();
      return this.roomCode;
    } catch (err) {
      if (epoch === this.sessionEpoch) {
        this.connecting = false;
        this.connected = false;
        this.isHost = false;
        this.roomCode = '';
        this.errorMessage = err instanceof Error ? err.message : 'Failed to create online room.';
        this.notifyPeersChanged();
      }
      return '';
    }
  }

  public async joinRoom(
    roomCode: string,
    mode: MultiplayerTransportMode,
    options?: { relayUrl?: string },
  ): Promise<boolean> {
    this.teardownSession(true);
    const epoch = ++this.sessionEpoch;

    const normalizedCode = normalizeRoomCode(roomCode);
    if (!normalizedCode) {
      this.mode = mode;
      this.connected = false;
      this.connecting = false;
      this.errorMessage = 'Please enter a valid 4–12 character Room Code.';
      return false;
    }

    this.mode = mode;
    this.connecting = true;
    this.connected = false;
    this.simulatedOnlySession = false;
    this.isHost = false;
    this.roomCode = normalizedCode;
    this.errorMessage = undefined;
    this.relayUrl =
      mode === 'websocket_relay' ? normalizeRelayUrl(options?.relayUrl ?? DEFAULT_RELAY_URL) : undefined;

    const callbacks = this.createBackendCallbacks(epoch);

    try {
      let joinedBackend: ITransportBackend;

      if (mode === 'webrtc_cloud') {
        joinedBackend = await WebRtcCloudBackend.connectGuest(
          normalizedCode,
          this.localNickname,
          callbacks,
          {
            peerFactory: this.deps.peerFactory,
            connectTimeoutMs: this.deps.connectTimeoutMs,
            maxGuests: MAX_REMOTE_PEERS,
          },
        );
      } else if (mode === 'websocket_relay') {
        const guestId = `relay-guest-${normalizedCode}-${generateRandomToken(5)}`;
        joinedBackend = await WebSocketRelayBackend.connect(
          normalizedCode,
          guestId,
          false,
          callbacks,
          {
            relayUrl: this.relayUrl,
            webSocketFactory: this.deps.webSocketFactory,
            connectTimeoutMs: this.deps.connectTimeoutMs,
          },
        );
      } else {
        const guestId = `tab-guest-${normalizedCode}-${generateRandomToken(5)}`;
        joinedBackend = await LocalTabsBackend.connectGuest(
          normalizedCode,
          guestId,
          this.localNickname,
          callbacks,
          {
            channelFactory: this.deps.broadcastChannelFactory,
            joinTimeoutMs: this.deps.localJoinTimeoutMs,
            maxGuests: MAX_REMOTE_PEERS,
          },
        );
      }

      if (epoch !== this.sessionEpoch) {
        joinedBackend.close();
        return false;
      }

      this.backend = joinedBackend;
      this.localPeerId = joinedBackend.localPeerId;
      this.roomCode = joinedBackend.roomCode;
      this.connecting = false;
      this.connected = true;

      // Immediately announce guest snapshot + RTT probe
      const initialState = this.buildLocalOutboundSnapshot();
      this.backend.broadcast({ type: 'player_state', state: initialState });
      this.backend.broadcast({ type: 'ping_probe', sentAt: nowMs() });

      this.notifyPeersChanged();
      return true;
    } catch (err) {
      if (epoch === this.sessionEpoch) {
        this.connecting = false;
        this.connected = false;
        this.roomCode = '';
        this.errorMessage = err instanceof Error ? err.message : 'Unable to join room.';
        this.notifyPeersChanged();
      }
      return false;
    }
  }

  public leaveRoom(): void {
    this.sessionEpoch++;
    this.teardownSession(true);
    this.notifyPeersChanged();
  }

  public spawnSimulatedPartner(heroClass?: HeroClassId): string {
    // Enforce max 3 remote peers (4 total party members)
    if (this.getTotalRemoteCount() >= MAX_REMOTE_PEERS) {
      // If all slots are full and at least one is simulated, replace the oldest simulated partner
      const firstSimKey = this.simulatedPartners.keys().next().value as string | undefined;
      if (firstSimKey) {
        this.simulatedPartners.delete(firstSimKey);
      } else {
        // 3 real human guests already occupy the party
        const existingFirst = this.remotePeers.keys().next().value as string | undefined;
        return existingFirst ?? '';
      }
    }

    // If not currently in an online room, activate a local Co-op host session automatically
    if (!this.backend && !this.connected) {
      this.connected = true;
      this.connecting = false;
      this.simulatedOnlySession = true;
      this.isHost = true;
      this.roomCode = this.roomCode || generateRoomCode(6);
      this.errorMessage = undefined;
    }

    const personaIdx = this.simulatedSpawnSeq++;
    const simPeerId = `sim-partner-${personaIdx + 1}-${generateRandomToken(4)}`;
    const spawnOrigin = this.lastLocalSnapshot?.position ?? { x: 0, y: 0, z: 0 };

    const agent = new SimulatedPartnerAgent(simPeerId, personaIdx, spawnOrigin, heroClass);
    if (this.lastLocalSnapshot) {
      agent.snapshot.level = Math.max(1, this.lastLocalSnapshot.level);
      agent.snapshot.maxHp = 220 + agent.snapshot.level * 42;
      agent.snapshot.hp = agent.snapshot.maxHp;
    }

    this.simulatedPartners.set(simPeerId, agent);
    this.notifyPeersChanged();

    // Emit initial greeting chat + wave emote + hype emoji
    const joinPackets = agent.buildJoinGreetingPackets();
    this.emitSimulatedPackets(simPeerId, joinPackets);
    this.emitPacketToListeners(simPeerId, {
      type: 'player_state',
      state: agent.getSnapshot(),
    });

    return simPeerId;
  }

  public removeSimulatedPartners(): void {
    if (this.simulatedPartners.size === 0) return;
    this.simulatedPartners.clear();
    this.simulatedSpawnSeq = 0;

    if (this.simulatedOnlySession && !this.backend) {
      this.connected = false;
      this.simulatedOnlySession = false;
      this.isHost = false;
      this.roomCode = '';
    }

    this.notifyPeersChanged();
  }

  public broadcast(packet: NetPacket, reliable = true): void {
    if (this.backend && this.connected) {
      this.backend.broadcast(packet, reliable);
    }

    if (this.simulatedPartners.size > 0) {
      for (const [botId, bot] of this.simulatedPartners.entries()) {
        const replies = bot.onLocalOutboundPacket(this.localPeerId, packet);
        if (replies.length > 0) {
          this.emitSimulatedPackets(botId, replies);
        }
      }
    }
  }

  public sendToPeer(peerId: string, packet: NetPacket): void {
    if (!peerId || peerId === this.localPeerId) return;

    const simBot = this.simulatedPartners.get(peerId);
    if (simBot) {
      if (packet.type === 'ping_probe') {
        this.emitPacketToListeners(peerId, {
          type: 'ping_ack',
          sentAt: packet.sentAt,
        });
        return;
      }
      const replies = simBot.onLocalOutboundPacket(this.localPeerId, packet);
      if (replies.length > 0) {
        this.emitSimulatedPackets(peerId, replies);
      }
      return;
    }

    if (this.backend && this.connected) {
      this.backend.sendToPeer(peerId, packet);
    }
  }

  public onPacket(handler: (fromPeerId: string, packet: NetPacket) => void): () => void {
    this.packetHandlers.add(handler);
    return () => {
      this.packetHandlers.delete(handler);
    };
  }

  public onPeersChanged(handler: (peers: RemotePeerSnapshot[]) => void): () => void {
    this.peersChangedHandlers.add(handler);
    return () => {
      this.peersChangedHandlers.delete(handler);
    };
  }

  public getRemotePeers(): RemotePeerSnapshot[] {
    const out: RemotePeerSnapshot[] = [];
    for (const snap of this.remotePeers.values()) {
      out.push(clonePeerSnapshot(snap));
    }
    for (const bot of this.simulatedPartners.values()) {
      out.push(bot.getSnapshot());
    }
    return out;
  }

  public getUnderlyingPeerJsInstance(): unknown {
    return this.backend ? this.backend.getUnderlyingPeerJsInstance() : null;
  }

  public update(dt: number, localSnapshot: RemotePeerSnapshot): void {
    if (dt < 0) return;

    const normalizedLocal: RemotePeerSnapshot = {
      ...clonePeerSnapshot(localSnapshot),
      peerId: this.localPeerId,
      nickname: this.localNickname || localSnapshot.nickname || 'Wanderer',
      isHost: this.isHost,
    };
    this.lastLocalSnapshot = normalizedLocal;

    this.backend?.tick?.(dt);

    // 1. Broadcast local player_state at 25Hz (or immediately on critical state transitions)
    if (this.backend && this.connected) {
      this.stateSyncAccumSec += dt;
      const criticalChanged =
        normalizedLocal.downed !== this.lastSentDowned ||
        normalizedLocal.awakened !== this.lastSentAwakened ||
        normalizedLocal.socialEmote !== this.lastSentEmote ||
        (normalizedLocal.animState !== this.lastSentAnim &&
          normalizedLocal.animState !== 'idle' &&
          normalizedLocal.animState !== 'run');

      if (criticalChanged || this.stateSyncAccumSec >= STATE_SYNC_INTERVAL_SEC) {
        this.stateSyncAccumSec = 0;
        this.lastSentDowned = normalizedLocal.downed;
        this.lastSentAwakened = normalizedLocal.awakened;
        this.lastSentEmote = normalizedLocal.socialEmote;
        this.lastSentAnim = normalizedLocal.animState;

        this.backend.broadcast(
          {
            type: 'player_state',
            state: normalizedLocal,
          },
          criticalChanged,
        );
      }

      // 2. Periodic RTT ping probe
      this.pingAccumSec += dt;
      if (this.pingAccumSec >= PING_PROBE_INTERVAL_SEC && this.remotePeers.size > 0) {
        this.pingAccumSec = 0;
        const sentAt = nowMs();
        for (const remotePeerId of this.remotePeers.keys()) {
          this.backend.sendToPeer(remotePeerId, { type: 'ping_probe', sentAt });
        }
      }
    }

    // 3. Update Simulated Co-op Partners
    if (this.simulatedPartners.size > 0) {
      this.botSyncAccumSec += dt;
      const shouldEmitBotSnapshot = this.botSyncAccumSec >= BOT_SYNC_INTERVAL_SEC;
      if (shouldEmitBotSnapshot) {
        this.botSyncAccumSec = 0;
      }

      for (const [botId, bot] of this.simulatedPartners.entries()) {
        const botPackets = bot.update(dt, normalizedLocal);
        if (botPackets.length > 0) {
          this.emitSimulatedPackets(botId, botPackets);
        }
        if (shouldEmitBotSnapshot) {
          this.emitPacketToListeners(botId, {
            type: 'player_state',
            state: bot.getSnapshot(),
          });
        }
      }

      if (shouldEmitBotSnapshot) {
        this.notifyPeersChanged();
      }
    }
  }

  public dispose(): void {
    this.sessionEpoch++;
    this.teardownSession(true);
    this.packetHandlers.clear();
    this.peersChangedHandlers.clear();
  }

  // ===========================================================================
  // Internal Coordination Helpers
  // ===========================================================================

  private createBackendCallbacks(epoch: number): BackendCallbacks {
    return {
      onRemotePeerJoined: (peerId: string) => {
        if (epoch !== this.sessionEpoch || !peerId || peerId === this.localPeerId) return;

        if (!this.remotePeers.has(peerId)) {
          this.remotePeers.set(peerId, this.createPlaceholderSnapshot(peerId));
          this.notifyPeersChanged();
        }

        if (this.backend) {
          // Immediately share our latest snapshot and measure initial RTT
          this.backend.sendToPeer(peerId, {
            type: 'player_state',
            state: this.buildLocalOutboundSnapshot(),
          });
          this.backend.sendToPeer(peerId, {
            type: 'ping_probe',
            sentAt: nowMs(),
          });

          // In WebRTC star topology, Host also introduces existing guests' snapshots to the newcomer
          if (this.isHost && this.mode === 'webrtc_cloud') {
            for (const [otherId, otherSnap] of this.remotePeers.entries()) {
              if (otherId !== peerId) {
                // Trigger a fresh state exchange by letting both sides sync via host
                this.backend.sendToPeer(otherId, {
                  type: 'ping_probe',
                  sentAt: nowMs(),
                });
                void otherSnap;
              }
            }
          }
        }
      },

      onRemotePeerLeft: (peerId: string) => {
        if (epoch !== this.sessionEpoch) return;
        this.peerRttMs.delete(peerId);
        if (this.remotePeers.delete(peerId)) {
          this.notifyPeersChanged();
        }
      },

      onRemotePacket: (fromPeerId: string, packet: NetPacket) => {
        if (epoch !== this.sessionEpoch || !fromPeerId || fromPeerId === this.localPeerId) return;

        if (packet.type === 'ping_probe') {
          this.backend?.sendToPeer(fromPeerId, {
            type: 'ping_ack',
            sentAt: packet.sentAt,
          });
          this.emitPacketToListeners(fromPeerId, packet);
          return;
        }

        if (packet.type === 'ping_ack') {
          const rtt = Math.max(0, Math.round(nowMs() - packet.sentAt));
          const prev = this.peerRttMs.get(fromPeerId);
          const smoothed = prev !== undefined ? Math.round(prev * 0.6 + rtt * 0.4) : rtt;
          this.peerRttMs.set(fromPeerId, smoothed);

          const existing = this.remotePeers.get(fromPeerId);
          if (existing && existing.pingMs !== smoothed) {
            existing.pingMs = smoothed;
            this.notifyPeersChanged();
          }
          this.emitPacketToListeners(fromPeerId, packet);
          return;
        }

        if (packet.type === 'player_state') {
          const incoming = clonePeerSnapshot(packet.state);
          incoming.peerId = fromPeerId;
          const measuredPing = this.peerRttMs.get(fromPeerId);
          if (measuredPing !== undefined) {
            incoming.pingMs = measuredPing;
          }
          this.remotePeers.set(fromPeerId, incoming);
          this.notifyPeersChanged();
          this.emitPacketToListeners(fromPeerId, {
            type: 'player_state',
            state: clonePeerSnapshot(incoming),
          });
          return;
        }

        this.emitPacketToListeners(fromPeerId, clonePacket(packet));
      },

      onSessionDisconnected: (reason: string) => {
        if (epoch !== this.sessionEpoch) return;
        this.backend = null;
        this.connecting = false;
        this.remotePeers.clear();
        this.peerRttMs.clear();

        if (this.simulatedPartners.size > 0) {
          this.connected = true;
          this.simulatedOnlySession = true;
          this.isHost = true;
        } else {
          this.connected = false;
          this.isHost = false;
          this.roomCode = '';
        }
        this.errorMessage = reason;
        this.notifyPeersChanged();
      },
    };
  }

  private teardownSession(removeBots: boolean): void {
    if (this.backend) {
      const old = this.backend;
      this.backend = null;
      old.close();
    }
    this.remotePeers.clear();
    this.peerRttMs.clear();

    if (removeBots) {
      this.simulatedPartners.clear();
      this.simulatedSpawnSeq = 0;
    }

    this.connected = this.simulatedPartners.size > 0;
    this.connecting = false;
    this.simulatedOnlySession = this.simulatedPartners.size > 0;
    this.isHost = this.simulatedPartners.size > 0;
    if (!this.connected) {
      this.roomCode = '';
    }
    this.errorMessage = undefined;
    this.stateSyncAccumSec = 0;
    this.botSyncAccumSec = 0;
    this.pingAccumSec = 0;
  }

  private getTotalRemoteCount(): number {
    return this.remotePeers.size + this.simulatedPartners.size;
  }

  private buildLocalOutboundSnapshot(): RemotePeerSnapshot {
    if (this.lastLocalSnapshot) {
      return {
        ...clonePeerSnapshot(this.lastLocalSnapshot),
        peerId: this.localPeerId,
        nickname: this.localNickname,
        isHost: this.isHost,
      };
    }

    return {
      peerId: this.localPeerId,
      nickname: this.localNickname,
      isHost: this.isHost,
      heroClass: 'vanguard',
      level: 1,
      hp: 250,
      maxHp: 250,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      animState: 'idle',
      socialEmote: null,
      weaponVisual: 'greatsword',
      weaponRarity: 'common',
      awakened: false,
      downed: false,
      pingMs: 0,
    };
  }

  private createPlaceholderSnapshot(peerId: string): RemotePeerSnapshot {
    const looksLikeHost =
      peerId.startsWith('abyssal-realms-coop-') ||
      peerId.startsWith('relay-host-') ||
      peerId.startsWith('tab-host-');

    return {
      peerId,
      nickname: looksLikeHost ? 'Host' : `Ally-${peerId.slice(-4).toUpperCase()}`,
      isHost: looksLikeHost,
      heroClass: 'vanguard',
      level: 1,
      hp: 250,
      maxHp: 250,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      animState: 'idle',
      socialEmote: null,
      weaponVisual: 'greatsword',
      weaponRarity: 'common',
      awakened: false,
      downed: false,
      pingMs: this.peerRttMs.get(peerId) ?? 0,
    };
  }

  private emitSimulatedPackets(botPeerId: string, packets: NetPacket[]): void {
    for (const pkt of packets) {
      this.emitPacketToListeners(botPeerId, clonePacket(pkt));
    }
  }

  private emitPacketToListeners(fromPeerId: string, packet: NetPacket): void {
    for (const handler of this.packetHandlers) {
      try {
        handler(fromPeerId, packet);
      } catch (err) {
        console.error('[MultiplayerTransport] Error in packet listener:', err);
      }
    }
  }

  private notifyPeersChanged(): void {
    const peers = this.getRemotePeers();
    for (const handler of this.peersChangedHandlers) {
      try {
        handler(peers);
      } catch (err) {
        console.error('[MultiplayerTransport] Error in peersChanged listener:', err);
      }
    }
  }
}

export function createMultiplayerTransport(
  deps?: MultiplayerTransportDeps,
): IMultiplayerTransport {
  return new MultiplayerTransport(deps);
}
