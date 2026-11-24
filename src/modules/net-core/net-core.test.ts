import { afterEach, describe, expect, it } from 'vitest';
import type { PeerJSOption } from 'peerjs';
import type { NetPacket, RemotePeerSnapshot } from '../../contracts/types';
import {
  buildRoomInviteUrl,
  createMultiplayerTransport,
  getRoomCodeFromUrl,
  getTransportModeFromUrl,
  MultiplayerTransport,
  normalizeRelayUrl,
  normalizeRoomCode,
  PEER_ID_HOST_PREFIX,
  PUBLIC_STUN_ICE_SERVERS,
  roomCodeToHostPeerId,
} from './index';
import type { PeerConnectionLike, PeerFactory, PeerLike } from './webrtcCloudBackend';
import type { WebSocketFactory, WebSocketLike } from './websocketRelayBackend';

// ============================================================================
// Test Helpers: Snapshots, In-Memory Relay Server, and Mock PeerJS Cloud Broker
// ============================================================================

function makeLocalSnapshot(overrides: Partial<RemotePeerSnapshot> = {}): RemotePeerSnapshot {
  return {
    peerId: 'local',
    nickname: 'Arthas',
    isHost: true,
    heroClass: 'vanguard',
    level: 5,
    hp: 420,
    maxHp: 420,
    position: { x: 4, y: 0, z: -6 },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0.5,
    animState: 'idle',
    socialEmote: null,
    weaponVisual: 'greatsword',
    weaponRarity: 'legendary',
    awakened: false,
    downed: false,
    pingMs: 0,
    ...overrides,
  };
}

function flushMicrotasks(ms = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mirrors `server/relay-server.mjs` room routing in memory with zero OS sockets.
 */
class MockRelayHub {
  private readonly rooms = new Map<string, Map<string, MockRelaySocket>>();
  public readonly connectedUrls: string[] = [];

  public readonly factory: WebSocketFactory = (url: string): WebSocketLike => {
    this.connectedUrls.push(url);
    const ws = new MockRelaySocket(this);
    queueMicrotask(() => ws.triggerOpen());
    return ws;
  };

  public handleClientMessage(ws: MockRelaySocket, raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (
      msg.type === 'join_room' &&
      typeof msg.roomCode === 'string' &&
      typeof msg.peerId === 'string'
    ) {
      const code = msg.roomCode.trim().toUpperCase();
      ws.peerId = msg.peerId;
      ws.joinedRoom = code;

      if (!this.rooms.has(code)) {
        this.rooms.set(code, new Map());
      }
      const roomMap = this.rooms.get(code)!;
      if (roomMap.size >= 4 && !roomMap.has(ws.peerId)) {
        ws.deliverServerJson({ type: 'error', message: 'Party is full (4/4).' });
        return;
      }

      const existingPeers = Array.from(roomMap.keys()).filter((id) => id !== ws.peerId);
      roomMap.set(ws.peerId, ws);

      ws.deliverServerJson({
        type: 'room_joined',
        roomCode: code,
        peerId: ws.peerId,
        peers: existingPeers,
      });

      for (const [otherId, otherWs] of roomMap.entries()) {
        if (otherId !== ws.peerId && otherWs.readyState === 1) {
          otherWs.deliverServerJson({ type: 'peer_joined', peerId: ws.peerId });
        }
      }
      return;
    }

    if (!ws.joinedRoom || !ws.peerId) return;
    const roomMap = this.rooms.get(ws.joinedRoom);
    if (!roomMap) return;

    if (typeof msg.targetPeerId === 'string' && msg.targetPeerId) {
      const targetWs = roomMap.get(msg.targetPeerId);
      if (targetWs && targetWs.readyState === 1) {
        targetWs.deliverServerJson({ ...msg, fromPeerId: ws.peerId });
      }
    } else {
      for (const [otherId, otherWs] of roomMap.entries()) {
        if (otherId !== ws.peerId && otherWs.readyState === 1) {
          otherWs.deliverServerJson({ ...msg, fromPeerId: ws.peerId });
        }
      }
    }
  }

  public handleClientClose(ws: MockRelaySocket): void {
    if (ws.joinedRoom && ws.peerId && this.rooms.has(ws.joinedRoom)) {
      const roomMap = this.rooms.get(ws.joinedRoom)!;
      roomMap.delete(ws.peerId);
      for (const [, otherWs] of roomMap.entries()) {
        if (otherWs.readyState === 1) {
          otherWs.deliverServerJson({ type: 'peer_left', peerId: ws.peerId });
        }
      }
      if (roomMap.size === 0) {
        this.rooms.delete(ws.joinedRoom);
      }
    }
  }
}

class MockRelaySocket implements WebSocketLike {
  public readyState = 0;
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { data: unknown }) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;
  public onclose: ((ev: unknown) => void) | null = null;
  public joinedRoom: string | null = null;
  public peerId: string | null = null;

  constructor(private readonly hub: MockRelayHub) {}

  public triggerOpen(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.onopen?.({});
  }

  public send(data: string): void {
    if (this.readyState !== 1) return;
    const hub = this.hub;
    queueMicrotask(() => hub.handleClientMessage(this, data));
  }

  public deliverServerJson(obj: unknown): void {
    const str = JSON.stringify(obj);
    queueMicrotask(() => {
      if (this.readyState === 1) {
        this.onmessage?.({ data: str });
      }
    });
  }

  public close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.hub.handleClientClose(this);
    this.onclose?.({});
  }
}

/**
 * In-memory PeerJS signaling + DataChannel broker for deterministic WebRTC P2P tests.
 */
class MockPeerBroker {
  public readonly peers = new Map<string, MockPeer>();
  public readonly capturedConfigs: PeerJSOption[] = [];
  public readonly preTakenIds = new Set<string>();

  public readonly peerFactory: PeerFactory = (id: string, options: PeerJSOption): PeerLike => {
    this.capturedConfigs.push(options);
    const peer = new MockPeer(id, this);
    queueMicrotask(() => {
      if (peer.destroyed) return;
      if (this.preTakenIds.has(id) || this.peers.has(id)) {
        peer.emitError('unavailable-id', `ID "${id}" is taken`);
        return;
      }
      this.peers.set(id, peer);
      peer.markOpen();
    });
    return peer;
  };
}

class MockDataConnection implements PeerConnectionLike {
  public open = false;
  public counterpart: MockDataConnection | null = null;
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  constructor(public readonly peer: string) {}

  public on(event: string, cb: (...args: any[]) => void): unknown {
    let arr = this.listeners.get(event);
    if (!arr) {
      arr = [];
      this.listeners.set(event, arr);
    }
    arr.push(cb);
    return this;
  }

  public emit(event: string, ...args: any[]): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const fn of arr) {
      fn(...args);
    }
  }

  public send(data: unknown): void {
    if (!this.open || !this.counterpart) return;
    const cloned = structuredClone(data);
    const target = this.counterpart;
    queueMicrotask(() => {
      if (target.open) {
        target.emit('data', cloned);
      }
    });
  }

  public close(): void {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
    const other = this.counterpart;
    if (other && other.open) {
      queueMicrotask(() => {
        if (other.open) {
          other.open = false;
          other.emit('close');
        }
      });
    }
  }
}

class MockPeer implements PeerLike {
  public destroyed = false;
  public open = false;
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
  private readonly activeConns = new Set<MockDataConnection>();

  constructor(
    public readonly id: string,
    private readonly broker: MockPeerBroker,
  ) {}

  public on(event: string, cb: (...args: any[]) => void): unknown {
    let arr = this.listeners.get(event);
    if (!arr) {
      arr = [];
      this.listeners.set(event, arr);
    }
    arr.push(cb);
    return this;
  }

  public markOpen(): void {
    this.open = true;
    this.emit('open', this.id);
  }

  public emitError(type: string, message: string): void {
    this.emit('error', { type, message });
  }

  public connect(targetPeerId: string): PeerConnectionLike {
    const localConn = new MockDataConnection(targetPeerId);
    this.activeConns.add(localConn);

    queueMicrotask(() => {
      if (this.destroyed) return;
      const remotePeer = this.broker.peers.get(targetPeerId);
      if (!remotePeer || remotePeer.destroyed) {
        this.emitError('peer-unavailable', `Could not connect to peer ${targetPeerId}`);
        return;
      }

      const remoteConn = new MockDataConnection(this.id);
      remotePeer.activeConns.add(remoteConn);
      localConn.counterpart = remoteConn;
      remoteConn.counterpart = localConn;

      remotePeer.emit('connection', remoteConn);
      queueMicrotask(() => {
        if (this.destroyed || remotePeer.destroyed) return;
        remoteConn.open = true;
        localConn.open = true;
        remoteConn.emit('open');
        localConn.emit('open');
      });
    });

    return localConn;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open = false;
    this.broker.peers.delete(this.id);
    for (const c of this.activeConns) {
      c.close();
    }
    this.activeConns.clear();
    this.emit('close');
  }

  private emit(event: string, ...args: any[]): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const fn of arr) {
      fn(...args);
    }
  }
}

// ============================================================================
// Suite
// ============================================================================

describe('MultiplayerTransport & Net-Core Module', () => {
  const activeTransports: MultiplayerTransport[] = [];

  const track = (t: MultiplayerTransport): MultiplayerTransport => {
    activeTransports.push(t);
    return t;
  };

  afterEach(() => {
    while (activeTransports.length > 0) {
      activeTransports.pop()?.dispose();
    }
  });

  it('parses ?room=XXXXXX URLs, normalizes room codes, and configures Google & Cloudflare STUN servers', () => {
    expect(getRoomCodeFromUrl('?room=k7x9q2')).toBe('K7X9Q2');
    expect(getRoomCodeFromUrl('https://abyssal.example.com/?room=ab92xz&mode=websocket_relay')).toBe(
      'AB92XZ',
    );
    expect(getRoomCodeFromUrl('#?room=zx88pq')).toBe('ZX88PQ');
    expect(getRoomCodeFromUrl('?room=!')).toBeNull();
    expect(getRoomCodeFromUrl('')).toBeNull();
    expect(getTransportModeFromUrl('?room=K7X9Q2&mode=local_tabs')).toBe('local_tabs');

    expect(normalizeRoomCode('  k7x-9q2 ')).toBe('K7X9Q2');
    expect(normalizeRoomCode('https://play.abyssal.gg/?room=m4p8w2')).toBe('M4P8W2');
    expect(roomCodeToHostPeerId('k7x9q2')).toBe(`${PEER_ID_HOST_PREFIX}K7X9Q2`);

    const invite = buildRoomInviteUrl(
      'k7x9q2',
      'websocket_relay',
      'https://tunnel.example.com',
      'https://game.example.com/',
    );
    expect(invite).toContain('room=K7X9Q2');
    expect(invite).toContain('mode=websocket_relay');
    expect(normalizeRelayUrl('https://tunnel.example.com')).toBe('wss://tunnel.example.com');
    expect(normalizeRelayUrl('localhost:8787')).toBe('ws://localhost:8787');

    const stunUrls = PUBLIC_STUN_ICE_SERVERS.flatMap((s) =>
      Array.isArray(s.urls) ? s.urls : [s.urls],
    );
    expect(stunUrls).toContain('stun:stun.l.google.com:19302');
    expect(stunUrls).toContain('stun:stun1.l.google.com:19302');
    expect(stunUrls).toContain('stun:stun.cloudflare.com:3478');
  });

  it('connects multi-tab peers via BroadcastChannel (local_tabs), syncs packets/RTT, and enforces 4-peer limit', async () => {
    const host = track(new MultiplayerTransport({ localJoinTimeoutMs: 250 }));
    const guest1 = track(new MultiplayerTransport({ localJoinTimeoutMs: 250 }));
    const guest2 = track(new MultiplayerTransport({ localJoinTimeoutMs: 250 }));
    const guest3 = track(new MultiplayerTransport({ localJoinTimeoutMs: 250 }));
    const guestOverflow = track(new MultiplayerTransport({ localJoinTimeoutMs: 250 }));

    host.setLocalNickname('HostVanguard');
    guest1.setLocalNickname('ShadowGuest');
    guest2.setLocalNickname('ArcaneGuest');
    guest3.setLocalNickname('FourthHero');

    const roomCode = await host.hostRoom('local_tabs', { customRoomCode: 'TAB777' });
    expect(roomCode).toBe('TAB777');
    expect(host.getConnectionInfo().connected).toBe(true);
    expect(host.getConnectionInfo().isHost).toBe(true);
    expect(host.getConnectionInfo().peerCount).toBe(1);

    // Join 3 guests -> 4/4 full party
    expect(await guest1.joinRoom('tab777', 'local_tabs')).toBe(true);
    expect(await guest2.joinRoom('TAB777', 'local_tabs')).toBe(true);
    expect(await guest3.joinRoom('TAB777', 'local_tabs')).toBe(true);
    await flushMicrotasks(30);

    expect(host.getConnectionInfo().peerCount).toBe(4);
    expect(host.getRemotePeers()).toHaveLength(3);

    // 5th tab attempting to join should be rejected cleanly
    const fifthOk = await guestOverflow.joinRoom('TAB777', 'local_tabs');
    expect(fifthOk).toBe(false);
    expect(guestOverflow.getConnectionInfo().errorMessage).toContain('4/4');

    // Broadcast world_sync from host -> received by all guests
    const receivedByGuest1: NetPacket[] = [];
    guest1.onPacket((_from, pkt) => receivedByGuest1.push(pkt));

    host.broadcast({
      type: 'world_sync',
      zoneMode: 'dungeon',
      floorNumber: 5,
      seed: 98765,
    });

    // Update snapshots & trigger ping probe
    host.update(0.05, makeLocalSnapshot({ position: { x: 12, y: 0, z: -8 } }));
    guest1.update(
      1.6,
      makeLocalSnapshot({
        heroClass: 'shadowblade',
        position: { x: 14, y: 0, z: -7 },
      }),
    );
    await flushMicrotasks(35);

    expect(receivedByGuest1.some((p) => p.type === 'world_sync' && p.floorNumber === 5)).toBe(true);
    const hostOnGuest1 = guest1
      .getRemotePeers()
      .find((p) => p.peerId === host.getConnectionInfo().localPeerId);
    expect(hostOnGuest1).toBeDefined();
    expect(hostOnGuest1?.nickname).toBe('HostVanguard');
    expect(hostOnGuest1?.position.x).toBe(12);
    expect(hostOnGuest1?.pingMs).toBeGreaterThanOrEqual(0);

    // Guest leaving updates host's roster
    guest3.leaveRoom();
    await flushMicrotasks(25);
    expect(host.getRemotePeers()).toHaveLength(2);
    expect(host.getConnectionInfo().peerCount).toBe(3);
  });

  it('connects across custom WebSocket Relay (websocket_relay) matching server/relay-server.mjs protocol', async () => {
    const relayHub = new MockRelayHub();
    const host = track(new MultiplayerTransport({ webSocketFactory: relayHub.factory }));
    const guest = track(new MultiplayerTransport({ webSocketFactory: relayHub.factory }));

    host.setLocalNickname('RelayHost');
    guest.setLocalNickname('RelayGuest');

    const code = await host.hostRoom('websocket_relay', {
      customRoomCode: 'WS9000',
      relayUrl: 'https://relay.abyssal.example.com',
    });
    expect(code).toBe('WS9000');
    expect(host.getConnectionInfo().relayUrl).toBe('wss://relay.abyssal.example.com');
    expect(relayHub.connectedUrls[0]).toBe('wss://relay.abyssal.example.com');

    const joined = await guest.joinRoom('WS9000', 'websocket_relay', {
      relayUrl: 'wss://relay.abyssal.example.com',
    });
    expect(joined).toBe(true);
    await flushMicrotasks(25);

    expect(host.getRemotePeers()).toHaveLength(1);
    expect(guest.getRemotePeers()).toHaveLength(1);

    const guestInbox: Array<{ from: string; pkt: NetPacket }> = [];
    guest.onPacket((from, pkt) => guestInbox.push({ from, pkt }));

    // Targeted packet via relay
    host.sendToPeer(guest.getConnectionInfo().localPeerId, {
      type: 'tactical_ping',
      peerId: host.getConnectionInfo().localPeerId,
      senderName: 'RelayHost',
      pingType: 'attack',
      position: { x: 20, y: 0, z: 10 },
    });
    await flushMicrotasks(20);

    expect(
      guestInbox.some(
        (entry) =>
          entry.from === host.getConnectionInfo().localPeerId &&
          entry.pkt.type === 'tactical_ping' &&
          entry.pkt.pingType === 'attack',
      ),
    ).toBe(true);
  });

  it('establishes WebRTC P2P star-relay across Host + multiple Guests, retries taken IDs, and exposes PeerJS for voice', async () => {
    const broker = new MockPeerBroker();
    const host = track(new MultiplayerTransport({ peerFactory: broker.peerFactory }));
    const guest1 = track(new MultiplayerTransport({ peerFactory: broker.peerFactory }));
    const guest2 = track(new MultiplayerTransport({ peerFactory: broker.peerFactory }));

    host.setLocalNickname('CloudHost');
    guest1.setLocalNickname('Mobile4GGuest');
    guest2.setLocalNickname('FiberGuest');

    const code = await host.hostRoom('webrtc_cloud', { customRoomCode: 'K7X9Q2' });
    expect(code).toBe('K7X9Q2');
    expect(host.getConnectionInfo().localPeerId).toBe('abyssal-realms-coop-K7X9Q2');
    expect(host.getUnderlyingPeerJsInstance()).toBeTruthy();
    expect(broker.capturedConfigs[0]?.config?.iceServers).toEqual(PUBLIC_STUN_ICE_SERVERS);

    // Join via full invite link pasted directly into joinRoom
    expect(await guest1.joinRoom('https://abyssal.gg/?room=k7x9q2', 'webrtc_cloud')).toBe(true);
    expect(await guest2.joinRoom('K7X9Q2', 'webrtc_cloud')).toBe(true);
    await flushMicrotasks(35);

    expect(host.getConnectionInfo().peerCount).toBe(3);
    expect(guest1.getUnderlyingPeerJsInstance()).toBeTruthy();

    // Star-Relay verification: Guest 1 broadcasts skill_cast -> Host star-relays to Guest 2 preserving Guest 1's peerId!
    const guest2Packets: Array<{ from: string; packet: NetPacket }> = [];
    guest2.onPacket((from, packet) => guest2Packets.push({ from, packet }));

    const g1Id = guest1.getConnectionInfo().localPeerId;
    guest1.broadcast({
      type: 'skill_cast',
      peerId: g1Id,
      slot: 1,
      skillId: 'void_shuriken',
      damageType: 'void',
      origin: { x: 2, y: 0, z: 3 },
      facingDir: { x: 0, y: 0, z: 1 },
    });
    await flushMicrotasks(30);

    const relayedSkill = guest2Packets.find((p) => p.packet.type === 'skill_cast');
    expect(relayedSkill).toBeDefined();
    expect(relayedSkill?.from).toBe(g1Id);

    // Targeted Guest 1 -> Guest 2 packet via Host star-routing (Host itself does not consume it)
    const hostPackets: NetPacket[] = [];
    host.onPacket((_from, packet) => hostPackets.push(packet));
    const g2Id = guest2.getConnectionInfo().localPeerId;
    guest1.sendToPeer(g2Id, {
      type: 'emoji_burst',
      peerId: g1Id,
      emojiId: 'crown_gg',
      position: { x: 0, y: 0, z: 0 },
    });
    await flushMicrotasks(30);

    expect(guest2Packets.some((p) => p.from === g1Id && p.packet.type === 'emoji_burst')).toBe(
      true,
    );
    expect(hostPackets.some((p) => p.type === 'emoji_burst')).toBe(false);

    // 3rd guest fills 4/4 party; 4th guest is rejected cleanly
    const guest3 = track(new MultiplayerTransport({ peerFactory: broker.peerFactory }));
    const guest4 = track(new MultiplayerTransport({ peerFactory: broker.peerFactory }));
    expect(await guest3.joinRoom('K7X9Q2', 'webrtc_cloud')).toBe(true);
    expect(host.getConnectionInfo().peerCount).toBe(4);
    expect(await guest4.joinRoom('K7X9Q2', 'webrtc_cloud')).toBe(false);
    expect(guest4.getConnectionInfo().errorMessage).toContain('4/4');

    // Joining non-existent room code returns false cleanly with clear errorMessage
    const lonelyGuest = track(new MultiplayerTransport({ peerFactory: broker.peerFactory }));
    const badJoin = await lonelyGuest.joinRoom('NOPE99', 'webrtc_cloud');
    expect(badJoin).toBe(false);
    expect(lonelyGuest.getConnectionInfo().errorMessage).toContain('NOPE99');

    // Leaving clears underlying PeerJS instance
    host.leaveRoom();
    expect(host.getUnderlyingPeerJsInstance()).toBeNull();
  });

  it('proactively initiates paired_request High-Five when simulated partner is calm and nearby', () => {
    const transport = track(createMultiplayerTransport() as MultiplayerTransport);
    const received: NetPacket[] = [];
    transport.onPacket((_from, pkt) => received.push(pkt));

    transport.spawnSimulatedPartner('vanguard');
    const calmSnap = makeLocalSnapshot({ position: { x: 0, y: 0, z: 0 }, animState: 'idle' });

    for (let i = 0; i < 45; i++) {
      transport.update(0.25, calmSnap);
    }

    expect(received.some((p) => p.type === 'paired_request')).toBe(true);
  });

  it('drives Simulated Co-op Partners (Seraphina & Kaelen): combat, chat banter, High-Five clashes, and downed revive', () => {
    const transport = track(createMultiplayerTransport() as MultiplayerTransport);
    transport.setLocalNickname('Champion');

    const received: Array<{ from: string; packet: NetPacket }> = [];
    transport.onPacket((from, packet) => received.push({ from, packet }));

    const seraphinaId = transport.spawnSimulatedPartner('arcanist');
    const kaelenId = transport.spawnSimulatedPartner('shadowblade');

    expect(seraphinaId).toBeTruthy();
    expect(kaelenId).toBeTruthy();
    expect(transport.getConnectionInfo().connected).toBe(true);
    expect(transport.getConnectionInfo().peerCount).toBe(3);

    const peers = transport.getRemotePeers();
    expect(peers.map((p) => p.nickname)).toEqual(['Seraphina', 'Kaelen']);
    expect(peers.every((p) => p.isSimulated)).toBe(true);

    // Greeting chat + wave + fire_hype emitted on join
    expect(received.some((r) => r.from === seraphinaId && r.packet.type === 'chat_message')).toBe(
      true,
    );
    expect(
      received.some(
        (r) =>
          r.from === seraphinaId &&
          r.packet.type === 'emoji_burst' &&
          r.packet.emojiId === 'fire_hype',
      ),
    ).toBe(true);

    // 1. Party Chat banter reply + celebratory emoji
    received.length = 0;
    transport.broadcast({
      type: 'chat_message',
      message: {
        id: 'm1',
        senderId: transport.getConnectionInfo().localPeerId,
        senderName: 'Champion',
        heroClass: 'vanguard',
        channel: 'party',
        text: 'GG nice boss fight!',
        timestamp: Date.now(),
      },
    });
    for (let i = 0; i < 6; i++) {
      transport.update(0.1, makeLocalSnapshot({ animState: 'attack_1' }));
    }

    expect(received.some((r) => r.packet.type === 'chat_message')).toBe(true);
    expect(
      received.some((r) => r.packet.type === 'emoji_burst' && r.packet.emojiId === 'crown_gg'),
    ).toBe(true);
    expect(received.some((r) => r.packet.type === 'skill_cast')).toBe(true);

    // 2. Paired High-Five / Blade Clash acceptance (`paired_request` -> `paired_accept`)
    received.length = 0;
    const localSnap = makeLocalSnapshot({ position: { x: 4, y: 0, z: -6 } });
    transport.broadcast({
      type: 'paired_request',
      fromPeerId: transport.getConnectionInfo().localPeerId,
      fromName: 'Champion',
      kind: 'blade_clash',
      position: { x: 4, y: 0, z: -6 },
    });
    for (let i = 0; i < 12; i++) {
      transport.update(0.1, localSnap);
    }

    const acceptPkt = received.find((r) => r.packet.type === 'paired_accept');
    expect(acceptPkt).toBeDefined();

    // 3. Emergency Downed Teammate Rescue (`revive_complete`)
    received.length = 0;
    const downedSnap = makeLocalSnapshot({
      position: { x: 6, y: 0, z: -5 },
      hp: 1,
      downed: true,
      downedBleedoutSec: 12,
      socialEmote: 'downed_kneel',
    });
    for (let i = 0; i < 20; i++) {
      transport.update(0.1, downedSnap);
    }

    const revivePkt = received.find((r) => r.packet.type === 'revive_complete');
    expect(revivePkt).toBeDefined();
    if (revivePkt && revivePkt.packet.type === 'revive_complete') {
      expect(revivePkt.packet.revivedPeerId).toBe(transport.getConnectionInfo().localPeerId);
    }

    // 4. Remove simulated partners cleans up offline session
    transport.removeSimulatedPartners();
    expect(transport.getRemotePeers()).toHaveLength(0);
    expect(transport.getConnectionInfo().connected).toBe(false);
    expect(transport.getConnectionInfo().peerCount).toBe(0);
  });
});
