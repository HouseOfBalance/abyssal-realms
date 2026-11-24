import type { NetPacket } from '../../contracts/types';
import { LOCAL_TAB_CHANNEL_PREFIX, MAX_REMOTE_PEERS } from './roomCode';
import { type BackendCallbacks, clonePacket, type ITransportBackend } from './wireProtocol';

export interface BroadcastChannelLike {
  readonly name: string;
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type BroadcastChannelFactory = (channelName: string) => BroadcastChannelLike;

// In-process fallback bus used only if native BroadcastChannel is unavailable
const fallbackChannels = new Map<string, Set<InMemoryBroadcastChannel>>();

class InMemoryBroadcastChannel implements BroadcastChannelLike {
  public readonly name: string;
  public onmessage: ((ev: { data: unknown }) => void) | null = null;
  private closed = false;

  constructor(name: string) {
    this.name = name;
    let group = fallbackChannels.get(name);
    if (!group) {
      group = new Set();
      fallbackChannels.set(name, group);
    }
    group.add(this);
  }

  public postMessage(message: unknown): void {
    if (this.closed) return;
    const group = fallbackChannels.get(this.name);
    if (!group) return;
    const payload = clonePacket(message);
    for (const peerChannel of group) {
      if (peerChannel !== this && !peerChannel.closed) {
        queueMicrotask(() => {
          if (!peerChannel.closed) {
            peerChannel.onmessage?.({ data: clonePacket(payload) });
          }
        });
      }
    }
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onmessage = null;
    const group = fallbackChannels.get(this.name);
    if (group) {
      group.delete(this);
      if (group.size === 0) {
        fallbackChannels.delete(this.name);
      }
    }
  }
}

const defaultBroadcastChannelFactory: BroadcastChannelFactory = (
  channelName: string,
): BroadcastChannelLike => {
  if (typeof globalThis.BroadcastChannel === 'function') {
    return new globalThis.BroadcastChannel(channelName) as unknown as BroadcastChannelLike;
  }
  return new InMemoryBroadcastChannel(channelName);
};

type LocalTabWireMessage =
  | { kind: 'join_request'; peerId: string; nickname: string }
  | {
      kind: 'join_accepted';
      targetPeerId: string;
      hostPeerId: string;
      peers: string[];
    }
  | { kind: 'join_rejected'; targetPeerId: string; reason: string }
  | { kind: 'peer_joined'; peerId: string }
  | { kind: 'peer_leave'; peerId: string }
  | { kind: 'host_closing'; hostPeerId: string }
  | { kind: 'heartbeat'; peerId: string }
  | {
      kind: 'net_packet';
      fromPeerId: string;
      targetPeerId?: string;
      packet: NetPacket;
    };

export interface LocalTabsBackendOptions {
  channelFactory?: BroadcastChannelFactory;
  joinTimeoutMs?: number;
  maxGuests?: number;
}

const HEARTBEAT_INTERVAL_SEC = 1.5;
const PEER_STALE_TIMEOUT_SEC = 6.0;

export class LocalTabsBackend implements ITransportBackend {
  public readonly localPeerId: string;
  public readonly roomCode: string;
  public readonly isHost: boolean;

  private readonly channel: BroadcastChannelLike;
  private readonly callbacks: BackendCallbacks;
  private readonly maxGuests: number;
  private readonly peerLastSeenSec = new Map<string, number>();
  private hostPeerId: string | null = null;
  private elapsedSec = 0;
  private heartbeatAccumSec = 0;
  private closed = false;
  private unloadListener: (() => void) | null = null;

  private constructor(
    channel: BroadcastChannelLike,
    localPeerId: string,
    roomCode: string,
    isHost: boolean,
    callbacks: BackendCallbacks,
    maxGuests: number,
  ) {
    this.channel = channel;
    this.localPeerId = localPeerId;
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.callbacks = callbacks;
    this.maxGuests = maxGuests;

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.unloadListener = () => this.close();
      window.addEventListener('beforeunload', this.unloadListener);
    }
  }

  public static createHost(
    roomCode: string,
    localPeerId: string,
    callbacks: BackendCallbacks,
    getOccupiedSlotCount: () => number,
    options?: LocalTabsBackendOptions,
  ): LocalTabsBackend {
    const factory = options?.channelFactory ?? defaultBroadcastChannelFactory;
    const maxGuests = options?.maxGuests ?? MAX_REMOTE_PEERS;
    const channel = factory(`${LOCAL_TAB_CHANNEL_PREFIX}${roomCode}`);
    const backend = new LocalTabsBackend(
      channel,
      localPeerId,
      roomCode,
      true,
      callbacks,
      maxGuests,
    );
    backend.hostPeerId = localPeerId;
    backend.bindHostChannel(getOccupiedSlotCount);
    return backend;
  }

  public static async connectGuest(
    roomCode: string,
    localPeerId: string,
    nickname: string,
    callbacks: BackendCallbacks,
    options?: LocalTabsBackendOptions,
  ): Promise<LocalTabsBackend> {
    const factory = options?.channelFactory ?? defaultBroadcastChannelFactory;
    const timeoutMs = options?.joinTimeoutMs ?? 1200;
    const maxGuests = options?.maxGuests ?? MAX_REMOTE_PEERS;
    const channel = factory(`${LOCAL_TAB_CHANNEL_PREFIX}${roomCode}`);

    const backend = new LocalTabsBackend(
      channel,
      localPeerId,
      roomCode,
      false,
      callbacks,
      maxGuests,
    );

    return new Promise<LocalTabsBackend>((resolve, reject) => {
      let settled = false;

      const cleanupTimers = () => {
        clearTimeout(timeoutTimer);
        clearInterval(retryTimer);
      };

      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        cleanupTimers();
        backend.close();
        reject(new Error(reason));
      };

      const timeoutTimer = setTimeout(() => {
        fail(`No active local tab host found for Room Code ${roomCode}.`);
      }, timeoutMs);

      channel.onmessage = (ev: { data: unknown }) => {
        const msg = ev.data as LocalTabWireMessage | null;
        if (!msg || typeof msg !== 'object' || typeof msg.kind !== 'string') return;

        if (!settled) {
          if (msg.kind === 'join_rejected' && msg.targetPeerId === localPeerId) {
            fail(msg.reason || 'Party is full (4/4).');
            return;
          }
          if (msg.kind === 'join_accepted' && msg.targetPeerId === localPeerId) {
            settled = true;
            cleanupTimers();
            backend.hostPeerId = msg.hostPeerId;
            backend.bindGuestChannel();

            const initialPeers = [msg.hostPeerId, ...(msg.peers || [])];
            for (const pid of initialPeers) {
              if (pid && pid !== localPeerId && !backend.peerLastSeenSec.has(pid)) {
                backend.peerLastSeenSec.set(pid, backend.elapsedSec);
                callbacks.onRemotePeerJoined(pid);
              }
            }
            resolve(backend);
          }
          return;
        }
      };

      const sendJoinReq = () => {
        if (!settled && !backend.closed) {
          channel.postMessage({
            kind: 'join_request',
            peerId: localPeerId,
            nickname,
          } satisfies LocalTabWireMessage);
        }
      };

      sendJoinReq();
      const retryTimer = setInterval(sendJoinReq, Math.min(120, Math.max(25, timeoutMs / 4)));
    });
  }

  private bindHostChannel(getOccupiedSlotCount: () => number): void {
    this.channel.onmessage = (ev: { data: unknown }) => {
      if (this.closed) return;
      const msg = ev.data as LocalTabWireMessage | null;
      if (!msg || typeof msg !== 'object' || typeof msg.kind !== 'string') return;

      if (msg.kind === 'join_request') {
        if (!msg.peerId || msg.peerId === this.localPeerId) return;
        const alreadyKnown = this.peerLastSeenSec.has(msg.peerId);
        const currentOccupied = getOccupiedSlotCount();

        if (
          !alreadyKnown &&
          (this.peerLastSeenSec.size >= this.maxGuests || currentOccupied >= this.maxGuests)
        ) {
          this.channel.postMessage({
            kind: 'join_rejected',
            targetPeerId: msg.peerId,
            reason: 'Party is full (4/4).',
          } satisfies LocalTabWireMessage);
          return;
        }

        const existingPeers = Array.from(this.peerLastSeenSec.keys()).filter(
          (id) => id !== msg.peerId,
        );
        this.peerLastSeenSec.set(msg.peerId, this.elapsedSec);

        this.channel.postMessage({
          kind: 'join_accepted',
          targetPeerId: msg.peerId,
          hostPeerId: this.localPeerId,
          peers: existingPeers,
        } satisfies LocalTabWireMessage);

        this.channel.postMessage({
          kind: 'peer_joined',
          peerId: msg.peerId,
        } satisfies LocalTabWireMessage);

        if (!alreadyKnown) {
          this.callbacks.onRemotePeerJoined(msg.peerId);
        }
        return;
      }

      this.handleCommonMessage(msg);
    };
  }

  private bindGuestChannel(): void {
    this.channel.onmessage = (ev: { data: unknown }) => {
      if (this.closed) return;
      const msg = ev.data as LocalTabWireMessage | null;
      if (!msg || typeof msg !== 'object' || typeof msg.kind !== 'string') return;

      if (msg.kind === 'host_closing' && msg.hostPeerId === this.hostPeerId) {
        this.handleHostClosed();
        return;
      }

      this.handleCommonMessage(msg);
    };
  }

  private handleCommonMessage(msg: LocalTabWireMessage): void {
    if (msg.kind === 'peer_joined') {
      if (msg.peerId && msg.peerId !== this.localPeerId && !this.peerLastSeenSec.has(msg.peerId)) {
        this.peerLastSeenSec.set(msg.peerId, this.elapsedSec);
        this.callbacks.onRemotePeerJoined(msg.peerId);
      }
      return;
    }

    if (msg.kind === 'peer_leave') {
      if (!this.isHost && msg.peerId === this.hostPeerId) {
        this.handleHostClosed();
        return;
      }
      if (this.peerLastSeenSec.delete(msg.peerId)) {
        this.callbacks.onRemotePeerLeft(msg.peerId);
      }
      return;
    }

    if (msg.kind === 'heartbeat') {
      if (msg.peerId && msg.peerId !== this.localPeerId && this.peerLastSeenSec.has(msg.peerId)) {
        this.peerLastSeenSec.set(msg.peerId, this.elapsedSec);
      }
      return;
    }

    if (msg.kind === 'net_packet') {
      if (!msg.fromPeerId || msg.fromPeerId === this.localPeerId) return;
      if (msg.targetPeerId && msg.targetPeerId !== this.localPeerId) return;

      const isNew = !this.peerLastSeenSec.has(msg.fromPeerId);
      this.peerLastSeenSec.set(msg.fromPeerId, this.elapsedSec);
      if (isNew) {
        this.callbacks.onRemotePeerJoined(msg.fromPeerId);
      }
      this.callbacks.onRemotePacket(msg.fromPeerId, clonePacket(msg.packet));
    }
  }

  public broadcast(packet: NetPacket, _reliable = true): void {
    if (this.closed) return;
    this.channel.postMessage({
      kind: 'net_packet',
      fromPeerId: this.localPeerId,
      packet: clonePacket(packet),
    } satisfies LocalTabWireMessage);
  }

  public sendToPeer(targetPeerId: string, packet: NetPacket): void {
    if (this.closed || !targetPeerId || targetPeerId === this.localPeerId) return;
    this.channel.postMessage({
      kind: 'net_packet',
      fromPeerId: this.localPeerId,
      targetPeerId,
      packet: clonePacket(packet),
    } satisfies LocalTabWireMessage);
  }

  public tick(dt: number): void {
    if (this.closed || dt <= 0) return;
    this.elapsedSec += dt;
    this.heartbeatAccumSec += dt;

    if (this.heartbeatAccumSec >= HEARTBEAT_INTERVAL_SEC) {
      this.heartbeatAccumSec = 0;
      this.channel.postMessage({
        kind: 'heartbeat',
        peerId: this.localPeerId,
      } satisfies LocalTabWireMessage);

      for (const [peerId, lastSeen] of Array.from(this.peerLastSeenSec.entries())) {
        if (this.elapsedSec - lastSeen > PEER_STALE_TIMEOUT_SEC) {
          this.peerLastSeenSec.delete(peerId);
          if (!this.isHost && peerId === this.hostPeerId) {
            this.handleHostClosed();
            return;
          }
          this.callbacks.onRemotePeerLeft(peerId);
        }
      }
    }
  }

  public getConnectedPeerIds(): string[] {
    return Array.from(this.peerLastSeenSec.keys());
  }

  public getUnderlyingPeerJsInstance(): null {
    return null;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.unloadListener && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.unloadListener);
      this.unloadListener = null;
    }

    try {
      if (this.isHost) {
        this.channel.postMessage({
          kind: 'host_closing',
          hostPeerId: this.localPeerId,
        } satisfies LocalTabWireMessage);
      } else {
        this.channel.postMessage({
          kind: 'peer_leave',
          peerId: this.localPeerId,
        } satisfies LocalTabWireMessage);
      }
    } catch {
      // Ignore postMessage on closing channel
    }

    this.peerLastSeenSec.clear();
    this.channel.onmessage = null;
    try {
      this.channel.close();
    } catch {
      // Ignore
    }
  }

  private handleHostClosed(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.unloadListener && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.unloadListener);
      this.unloadListener = null;
    }
    this.peerLastSeenSec.clear();
    this.channel.onmessage = null;
    try {
      this.channel.close();
    } catch {
      // Ignore
    }
    this.callbacks.onSessionDisconnected('Host tab closed the Co-op room.');
  }
}
