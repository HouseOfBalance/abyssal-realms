import type { DataConnection, Peer, PeerJSOption } from 'peerjs';
import type { NetPacket } from '../../contracts/types';
import {
  createGuestPeerId,
  generateRoomCode,
  MAX_REMOTE_PEERS,
  PUBLIC_RTC_CONFIG,
  roomCodeToHostPeerId,
} from './roomCode';
import {
  type BackendCallbacks,
  clonePacket,
  isStarWireFrame,
  type ITransportBackend,
  type StarWireFrame,
} from './wireProtocol';

export interface PeerConnectionLike {
  readonly peer: string;
  readonly open: boolean;
  send(data: unknown): void | Promise<void>;
  close(): void;
  on(event: 'open', cb: () => void): unknown;
  on(event: 'data', cb: (data: unknown) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  on(event: 'error', cb: (err: unknown) => void): unknown;
}

export interface PeerLike {
  readonly id: string;
  readonly destroyed: boolean;
  readonly open?: boolean;
  connect(
    peerId: string,
    options?: { label?: string; metadata?: unknown; serialization?: string; reliable?: boolean },
  ): PeerConnectionLike;
  destroy(): void;
  on(event: 'open', cb: (id: string) => void): unknown;
  on(event: 'connection', cb: (conn: PeerConnectionLike) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  on(event: 'disconnected', cb: (id: string) => void): unknown;
  on(event: 'error', cb: (err: { type?: string; message?: string }) => void): unknown;
}

export type PeerFactory = (id: string, options: PeerJSOption) => Promise<PeerLike> | PeerLike;

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

async function resolvePeerFactory(customFactory?: PeerFactory): Promise<PeerFactory> {
  if (customFactory) {
    return customFactory;
  }
  const mod = await import('peerjs');
  const PeerCtor = mod.Peer ?? mod.default;
  return (id: string, options: PeerJSOption) => new PeerCtor(id, options) as unknown as PeerLike;
}

export interface WebRtcBackendOptions {
  peerFactory?: PeerFactory;
  connectTimeoutMs?: number;
  maxGuests?: number;
}

export class WebRtcCloudBackend implements ITransportBackend {
  public readonly localPeerId: string;
  public readonly roomCode: string;
  public readonly isHost: boolean;

  private readonly peer: PeerLike;
  private readonly callbacks: BackendCallbacks;
  private readonly maxGuests: number;
  private readonly guestConnections = new Map<string, PeerConnectionLike>();
  private readonly knownRemotePeers = new Set<string>();
  private hostConnection: PeerConnectionLike | null = null;
  private closed = false;

  private constructor(
    peer: PeerLike,
    localPeerId: string,
    roomCode: string,
    isHost: boolean,
    callbacks: BackendCallbacks,
    maxGuests: number,
  ) {
    this.peer = peer;
    this.localPeerId = localPeerId;
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.callbacks = callbacks;
    this.maxGuests = maxGuests;
  }

  public static async createHost(
    requestedRoomCode: string | undefined,
    callbacks: BackendCallbacks,
    getOccupiedSlotCount: () => number,
    options?: WebRtcBackendOptions,
  ): Promise<WebRtcCloudBackend> {
    const factory = await resolvePeerFactory(options?.peerFactory);
    const timeoutMs = options?.connectTimeoutMs ?? 12000;
    const maxGuests = options?.maxGuests ?? MAX_REMOTE_PEERS;
    const maxAttempts = requestedRoomCode ? 1 : 3;

    let lastError = 'Unable to reach PeerJS signaling cloud.';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const code = requestedRoomCode ?? generateRoomCode(6);
      const hostPeerId = roomCodeToHostPeerId(code);

      let peer: PeerLike;
      try {
        const created = factory(hostPeerId, {
          debug: 0,
          config: PUBLIC_RTC_CONFIG,
        });
        peer = isPromiseLike(created) ? await created : created;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        break;
      }

      const openResult = await new Promise<
        { ok: true; id: string } | { ok: false; retryable: boolean; message: string }
      >((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve({
            ok: false,
            retryable: false,
            message: 'Timed out connecting to PeerJS cloud signaling server.',
          });
        }, timeoutMs);

        if (peer.open) {
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true, id: peer.id || hostPeerId });
          return;
        }

        peer.on('open', (id: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true, id: id || hostPeerId });
        });

        peer.on('error', (err: { type?: string; message?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const errType = err?.type ?? '';
          if (errType === 'unavailable-id') {
            resolve({
              ok: false,
              retryable: !requestedRoomCode,
              message: `Room code ${code} is already in use.`,
            });
            return;
          }
          resolve({
            ok: false,
            retryable: false,
            message: err?.message || `PeerJS signaling error (${errType || 'unknown'}).`,
          });
        });
      });

      if (openResult.ok) {
        const backend = new WebRtcCloudBackend(
          peer,
          openResult.id,
          code,
          true,
          callbacks,
          maxGuests,
        );
        backend.bindHostListeners(getOccupiedSlotCount);
        return backend;
      }

      try {
        peer.destroy();
      } catch {
        // Ignore cleanup errors on failed attempt
      }
      lastError = openResult.message;
      if (!openResult.retryable) {
        break;
      }
    }

    throw new Error(lastError);
  }

  public static async connectGuest(
    roomCode: string,
    nickname: string,
    callbacks: BackendCallbacks,
    options?: WebRtcBackendOptions,
  ): Promise<WebRtcCloudBackend> {
    const factory = await resolvePeerFactory(options?.peerFactory);
    const timeoutMs = options?.connectTimeoutMs ?? 12000;
    const maxGuests = options?.maxGuests ?? MAX_REMOTE_PEERS;
    const hostPeerId = roomCodeToHostPeerId(roomCode);
    const guestId = createGuestPeerId(roomCode);

    const created = factory(guestId, {
      debug: 0,
      config: PUBLIC_RTC_CONFIG,
    });
    const peer = isPromiseLike(created) ? await created : created;

    return new Promise<WebRtcCloudBackend>((resolve, reject) => {
      let settled = false;
      let welcomeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
      let backendInstance: WebRtcCloudBackend | null = null;

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(overallTimer);
        if (welcomeFallbackTimer) clearTimeout(welcomeFallbackTimer);
        try {
          peer.destroy();
        } catch {
          // Ignore destroy failure
        }
        reject(new Error(message));
      };

      const overallTimer = setTimeout(() => {
        fail(`Timed out joining room ${roomCode}. Check the Room Code or network firewall.`);
      }, timeoutMs);

      peer.on('error', (err: { type?: string; message?: string }) => {
        const errType = err?.type ?? '';
        if (!settled) {
          if (errType === 'peer-unavailable') {
            fail(`Room ${roomCode} not found or host is offline.`);
            return;
          }
          fail(err?.message || `WebRTC P2P connection failed (${errType || 'network'}).`);
        } else if (backendInstance && !backendInstance.closed && errType === 'network') {
          backendInstance.handleUnexpectedDisconnect('Lost connection to signaling network.');
        }
      });

      peer.on('open', (assignedId: string) => {
        if (settled) return;
        const actualGuestId = assignedId || guestId;
        const conn = peer.connect(hostPeerId, {
          reliable: true,
          serialization: 'json',
          metadata: { nickname },
        });

        const backend = new WebRtcCloudBackend(
          peer,
          actualGuestId,
          roomCode,
          false,
          callbacks,
          maxGuests,
        );
        backendInstance = backend;
        backend.hostConnection = conn;

        const completeJoin = (initialPeerIds: string[]) => {
          if (settled) return;
          settled = true;
          clearTimeout(overallTimer);
          if (welcomeFallbackTimer) clearTimeout(welcomeFallbackTimer);

          backend.knownRemotePeers.add(hostPeerId);
          callbacks.onRemotePeerJoined(hostPeerId);
          for (const pid of initialPeerIds) {
            if (pid && pid !== actualGuestId && pid !== hostPeerId) {
              backend.knownRemotePeers.add(pid);
              callbacks.onRemotePeerJoined(pid);
            }
          }
          resolve(backend);
        };

        conn.on('open', () => {
          if (settled) return;
          backend.safeSend(conn, {
            __arWire: 1,
            kind: 'hello',
            peerId: actualGuestId,
            nickname,
          });
          // Resolve immediately upon `welcome` frame, or fallback after 250ms if raw DataConnection is open
          welcomeFallbackTimer = setTimeout(() => {
            if (!settled && conn.open) {
              completeJoin([]);
            }
          }, 250);
        });

        conn.on('data', (raw: unknown) => {
          const parsed = backend.parseIncomingData(raw);
          if (!parsed) return;

          if (isStarWireFrame(parsed)) {
            if (parsed.kind === 'room_rejected') {
              fail(parsed.reason || 'Party is full (4/4).');
              return;
            }
            if (parsed.kind === 'welcome') {
              completeJoin(parsed.peerIds);
              return;
            }
            if (!settled) {
              completeJoin([]);
            }
            backend.handleGuestWireFrame(parsed);
            return;
          }

          // Direct NetPacket fallback
          if (!settled) {
            completeJoin([]);
          }
          if (typeof (parsed as { type?: unknown }).type === 'string') {
            callbacks.onRemotePacket(hostPeerId, parsed as NetPacket);
          }
        });

        conn.on('close', () => {
          if (!settled) {
            fail('Connection closed by host.');
            return;
          }
          backend.handleUnexpectedDisconnect('Host closed the Co-op session.');
        });

        conn.on('error', (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'DataChannel error.';
          if (!settled) {
            fail(msg);
          }
        });
      });
    });
  }

  private bindHostListeners(getOccupiedSlotCount: () => number): void {
    this.peer.on('connection', (conn: PeerConnectionLike) => {
      if (this.closed) {
        conn.close();
        return;
      }

      const acceptOrReject = () => {
        if (this.closed) return;
        const remoteId = conn.peer;
        const alreadyConnected = this.guestConnections.has(remoteId);
        const currentOccupied = getOccupiedSlotCount();

        if (!alreadyConnected && (this.guestConnections.size >= this.maxGuests || currentOccupied >= this.maxGuests)) {
          this.safeSend(conn, {
            __arWire: 1,
            kind: 'room_rejected',
            reason: 'Party is full (4/4).',
          });
          setTimeout(() => {
            try {
              conn.close();
            } catch {
              // Ignore close errors
            }
          }, 40);
          return;
        }

        const existingGuestIds = Array.from(this.guestConnections.keys()).filter(
          (id) => id !== remoteId,
        );
        this.guestConnections.set(remoteId, conn);
        this.knownRemotePeers.add(remoteId);

        this.safeSend(conn, {
          __arWire: 1,
          kind: 'welcome',
          hostPeerId: this.localPeerId,
          roomCode: this.roomCode,
          peerIds: [this.localPeerId, ...existingGuestIds],
        });

        // Notify other connected guests about the newcomer
        for (const [otherId, otherConn] of this.guestConnections.entries()) {
          if (otherId !== remoteId) {
            this.safeSend(otherConn, {
              __arWire: 1,
              kind: 'peer_joined',
              peerId: remoteId,
            });
          }
        }

        this.callbacks.onRemotePeerJoined(remoteId);
      };

      if (conn.open) {
        acceptOrReject();
      } else {
        conn.on('open', acceptOrReject);
      }

      conn.on('data', (raw: unknown) => {
        if (this.closed || !this.guestConnections.has(conn.peer)) return;
        const parsed = this.parseIncomingData(raw);
        if (!parsed) return;

        if (isStarWireFrame(parsed)) {
          this.handleHostWireFrame(conn.peer, parsed);
        } else if (typeof (parsed as { type?: unknown }).type === 'string') {
          this.handleHostGuestPacket(conn.peer, undefined, parsed as NetPacket);
        }
      });

      const handleDrop = () => {
        if (this.closed) return;
        const guestId = conn.peer;
        if (!this.guestConnections.has(guestId)) return;
        this.guestConnections.delete(guestId);
        this.knownRemotePeers.delete(guestId);

        for (const [, otherConn] of this.guestConnections.entries()) {
          this.safeSend(otherConn, {
            __arWire: 1,
            kind: 'peer_left',
            peerId: guestId,
          });
        }
        this.callbacks.onRemotePeerLeft(guestId);
      };

      conn.on('close', handleDrop);
      conn.on('error', handleDrop);
    });

    this.peer.on('close', () => {
      if (!this.closed) {
        this.handleUnexpectedDisconnect('PeerJS session closed.');
      }
    });
  }

  private handleHostWireFrame(authoritativeSenderId: string, frame: StarWireFrame): void {
    if (frame.kind === 'hello') {
      return;
    }
    if (frame.kind === 'peer_left') {
      const conn = this.guestConnections.get(authoritativeSenderId);
      this.guestConnections.delete(authoritativeSenderId);
      this.knownRemotePeers.delete(authoritativeSenderId);
      for (const [, otherConn] of this.guestConnections.entries()) {
        this.safeSend(otherConn, {
          __arWire: 1,
          kind: 'peer_left',
          peerId: authoritativeSenderId,
        });
      }
      try {
        conn?.close();
      } catch {
        // Ignore
      }
      this.callbacks.onRemotePeerLeft(authoritativeSenderId);
      return;
    }
    if (frame.kind === 'packet') {
      this.handleHostGuestPacket(authoritativeSenderId, frame.targetPeerId, frame.packet);
    }
  }

  private handleHostGuestPacket(
    senderGuestId: string,
    targetPeerId: string | undefined,
    packet: NetPacket,
  ): void {
    // Targeted packet
    if (targetPeerId) {
      if (targetPeerId === this.localPeerId) {
        this.callbacks.onRemotePacket(senderGuestId, packet);
        return;
      }
      // Star-route targeted packet from Guest A -> Guest B through Host
      const targetConn = this.guestConnections.get(targetPeerId);
      if (targetConn) {
        this.safeSend(targetConn, {
          __arWire: 1,
          kind: 'packet',
          fromPeerId: senderGuestId,
          targetPeerId,
          relayed: true,
          packet,
        });
      } else {
        // Target might be a simulated partner hosted on Host
        this.callbacks.onRemotePacket(senderGuestId, packet);
      }
      return;
    }

    // Broadcast packet from a guest: deliver locally on Host AND star-relay to all other guests
    this.callbacks.onRemotePacket(senderGuestId, packet);

    // Do not relay untargeted ping_probe/ping_ack across sibling guests
    if (packet.type === 'ping_probe' || packet.type === 'ping_ack') {
      return;
    }

    for (const [otherGuestId, otherConn] of this.guestConnections.entries()) {
      if (otherGuestId !== senderGuestId) {
        this.safeSend(otherConn, {
          __arWire: 1,
          kind: 'packet',
          fromPeerId: senderGuestId,
          relayed: true,
          packet,
        });
      }
    }
  }

  private handleGuestWireFrame(frame: StarWireFrame): void {
    if (frame.kind === 'peer_joined') {
      if (frame.peerId !== this.localPeerId && !this.knownRemotePeers.has(frame.peerId)) {
        this.knownRemotePeers.add(frame.peerId);
        this.callbacks.onRemotePeerJoined(frame.peerId);
      }
      return;
    }
    if (frame.kind === 'peer_left') {
      if (this.knownRemotePeers.delete(frame.peerId)) {
        this.callbacks.onRemotePeerLeft(frame.peerId);
      }
      return;
    }
    if (frame.kind === 'host_closing') {
      this.handleUnexpectedDisconnect('Host closed the party session.');
      return;
    }
    if (frame.kind === 'packet') {
      if (frame.targetPeerId && frame.targetPeerId !== this.localPeerId) {
        return;
      }
      if (frame.fromPeerId === this.localPeerId) {
        return;
      }
      if (!this.knownRemotePeers.has(frame.fromPeerId)) {
        this.knownRemotePeers.add(frame.fromPeerId);
        this.callbacks.onRemotePeerJoined(frame.fromPeerId);
      }
      this.callbacks.onRemotePacket(frame.fromPeerId, frame.packet);
    }
  }

  public broadcast(packet: NetPacket, _reliable = true): void {
    if (this.closed) return;
    const frame: StarWireFrame = {
      __arWire: 1,
      kind: 'packet',
      fromPeerId: this.localPeerId,
      packet: clonePacket(packet),
    };

    if (this.isHost) {
      for (const [, conn] of this.guestConnections.entries()) {
        this.safeSend(conn, frame);
      }
    } else if (this.hostConnection) {
      this.safeSend(this.hostConnection, frame);
    }
  }

  public sendToPeer(targetPeerId: string, packet: NetPacket): void {
    if (this.closed || !targetPeerId || targetPeerId === this.localPeerId) return;
    const frame: StarWireFrame = {
      __arWire: 1,
      kind: 'packet',
      fromPeerId: this.localPeerId,
      targetPeerId,
      packet: clonePacket(packet),
    };

    if (this.isHost) {
      const conn = this.guestConnections.get(targetPeerId);
      if (conn) {
        this.safeSend(conn, frame);
      }
    } else if (this.hostConnection) {
      this.safeSend(this.hostConnection, frame);
    }
  }

  public getConnectedPeerIds(): string[] {
    return Array.from(this.knownRemotePeers);
  }

  public getUnderlyingPeerJsInstance(): Peer | PeerLike | null {
    return this.closed ? null : this.peer;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.isHost) {
      for (const [, conn] of this.guestConnections.entries()) {
        this.safeSend(conn, { __arWire: 1, kind: 'host_closing' });
        try {
          conn.close();
        } catch {
          // Ignore
        }
      }
      this.guestConnections.clear();
    } else if (this.hostConnection) {
      this.safeSend(this.hostConnection, {
        __arWire: 1,
        kind: 'peer_left',
        peerId: this.localPeerId,
      });
      try {
        this.hostConnection.close();
      } catch {
        // Ignore
      }
      this.hostConnection = null;
    }

    this.knownRemotePeers.clear();
    try {
      this.peer.destroy();
    } catch {
      // Ignore
    }
  }

  private handleUnexpectedDisconnect(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.guestConnections.clear();
    this.hostConnection = null;
    this.knownRemotePeers.clear();
    try {
      this.peer.destroy();
    } catch {
      // Ignore
    }
    this.callbacks.onSessionDisconnected(reason);
  }

  private safeSend(conn: PeerConnectionLike | DataConnection, frame: StarWireFrame): void {
    if (!conn || !conn.open) return;
    try {
      conn.send(frame);
    } catch {
      // Ignore transient buffer/channel send failure
    }
  }

  private parseIncomingData(raw: unknown): unknown {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (typeof raw === 'object' && raw !== null) {
      return raw;
    }
    return null;
  }
}
