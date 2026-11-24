import type { NetPacket } from '../../contracts/types';
import { normalizeRelayUrl } from './roomCode';
import { type BackendCallbacks, clonePacket, type ITransportBackend } from './wireProtocol';

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const defaultWebSocketFactory: WebSocketFactory = (url: string): WebSocketLike => {
  if (typeof globalThis.WebSocket === 'function') {
    return new globalThis.WebSocket(url) as unknown as WebSocketLike;
  }
  throw new Error('WebSocket API is unavailable in this environment.');
};

export interface WebSocketRelayOptions {
  relayUrl?: string;
  webSocketFactory?: WebSocketFactory;
  connectTimeoutMs?: number;
}

export class WebSocketRelayBackend implements ITransportBackend {
  public readonly localPeerId: string;
  public readonly roomCode: string;
  public readonly isHost: boolean;
  public readonly relayUrl: string;

  private readonly socket: WebSocketLike;
  private readonly callbacks: BackendCallbacks;
  private readonly knownRemotePeers = new Set<string>();
  private closed = false;

  private constructor(
    socket: WebSocketLike,
    localPeerId: string,
    roomCode: string,
    isHost: boolean,
    relayUrl: string,
    callbacks: BackendCallbacks,
  ) {
    this.socket = socket;
    this.localPeerId = localPeerId;
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.relayUrl = relayUrl;
    this.callbacks = callbacks;
  }

  public static async connect(
    roomCode: string,
    localPeerId: string,
    isHost: boolean,
    callbacks: BackendCallbacks,
    options?: WebSocketRelayOptions,
  ): Promise<WebSocketRelayBackend> {
    const relayUrl = normalizeRelayUrl(options?.relayUrl);
    const wsFactory = options?.webSocketFactory ?? defaultWebSocketFactory;
    const timeoutMs = options?.connectTimeoutMs ?? 8000;

    let socket: WebSocketLike;
    try {
      socket = wsFactory(relayUrl);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : `Invalid relay URL: ${relayUrl}`);
    }

    return new Promise<WebSocketRelayBackend>((resolve, reject) => {
      let settled = false;
      const backend = new WebSocketRelayBackend(
        socket,
        localPeerId,
        roomCode,
        isHost,
        relayUrl,
        callbacks,
      );

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        backend.closed = true;
        try {
          socket.close();
        } catch {
          // Ignore close error
        }
        reject(new Error(message));
      };

      const timer = setTimeout(() => {
        fail(`Timed out connecting to WebSocket relay at ${relayUrl}.`);
      }, timeoutMs);

      socket.onopen = () => {
        if (settled) return;
        try {
          socket.send(
            JSON.stringify({
              type: 'join_room',
              roomCode,
              peerId: localPeerId,
            }),
          );
        } catch (err) {
          fail(err instanceof Error ? err.message : 'Failed sending join_room to relay.');
        }
      };

      socket.onmessage = (ev: { data: unknown }) => {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }

        const msgType = msg.type;

        if (msgType === 'error') {
          const errMsg = typeof msg.message === 'string' ? msg.message : 'Relay server error.';
          if (!settled) {
            fail(errMsg);
          } else {
            backend.handleUnexpectedClose(errMsg);
          }
          return;
        }

        if (msgType === 'room_joined') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          const peers = Array.isArray(msg.peers) ? msg.peers : [];
          for (const pid of peers) {
            if (typeof pid === 'string' && pid && pid !== localPeerId) {
              backend.knownRemotePeers.add(pid);
              callbacks.onRemotePeerJoined(pid);
            }
          }
          resolve(backend);
          return;
        }

        if (!settled) {
          return;
        }

        backend.handleRelayMessage(msg);
      };

      socket.onerror = () => {
        if (!settled) {
          fail(`Cannot reach WebSocket relay server (${relayUrl}).`);
        }
      };

      socket.onclose = () => {
        if (!settled) {
          fail(`Relay server closed connection (${relayUrl}).`);
          return;
        }
        if (!backend.closed) {
          backend.handleUnexpectedClose('Disconnected from WebSocket relay server.');
        }
      };
    });
  }

  private handleRelayMessage(msg: Record<string, unknown>): void {
    if (this.closed) return;

    if (msg.type === 'peer_joined' && typeof msg.peerId === 'string') {
      if (msg.peerId !== this.localPeerId && !this.knownRemotePeers.has(msg.peerId)) {
        this.knownRemotePeers.add(msg.peerId);
        this.callbacks.onRemotePeerJoined(msg.peerId);
      }
      return;
    }

    if (msg.type === 'peer_left' && typeof msg.peerId === 'string') {
      if (this.knownRemotePeers.delete(msg.peerId)) {
        this.callbacks.onRemotePeerLeft(msg.peerId);
      }
      return;
    }

    const fromPeerId = typeof msg.fromPeerId === 'string' ? msg.fromPeerId : '';
    if (!fromPeerId || fromPeerId === this.localPeerId) return;

    if (typeof msg.targetPeerId === 'string' && msg.targetPeerId !== this.localPeerId) {
      return;
    }

    if (!this.knownRemotePeers.has(fromPeerId)) {
      this.knownRemotePeers.add(fromPeerId);
      this.callbacks.onRemotePeerJoined(fromPeerId);
    }

    if (msg.type === 'net_packet' && typeof msg.packet === 'object' && msg.packet !== null) {
      this.callbacks.onRemotePacket(fromPeerId, msg.packet as NetPacket);
      return;
    }

    // Also support direct NetPacket objects forwarded with `fromPeerId` attached
    if (typeof msg.type === 'string' && msg.type !== 'join_room') {
      const { fromPeerId: _ignoredFrom, targetPeerId: _ignoredTarget, ...rest } = msg;
      if (typeof rest.type === 'string') {
        this.callbacks.onRemotePacket(fromPeerId, rest as unknown as NetPacket);
      }
    }
  }

  public broadcast(packet: NetPacket, _reliable = true): void {
    if (this.closed || this.socket.readyState !== 1) return;
    try {
      this.socket.send(
        JSON.stringify({
          type: 'net_packet',
          packet: clonePacket(packet),
        }),
      );
    } catch {
      // Ignore send failure on closing socket
    }
  }

  public sendToPeer(targetPeerId: string, packet: NetPacket): void {
    if (this.closed || !targetPeerId || targetPeerId === this.localPeerId) return;
    if (this.socket.readyState !== 1) return;
    try {
      this.socket.send(
        JSON.stringify({
          type: 'net_packet',
          targetPeerId,
          packet: clonePacket(packet),
        }),
      );
    } catch {
      // Ignore send failure on closing socket
    }
  }

  public getConnectedPeerIds(): string[] {
    return Array.from(this.knownRemotePeers);
  }

  public getUnderlyingPeerJsInstance(): null {
    return null;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.knownRemotePeers.clear();
    this.socket.onopen = null;
    this.socket.onmessage = null;
    this.socket.onerror = null;
    this.socket.onclose = null;
    try {
      this.socket.close();
    } catch {
      // Ignore
    }
  }

  private handleUnexpectedClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.knownRemotePeers.clear();
    this.callbacks.onSessionDisconnected(reason);
  }
}
