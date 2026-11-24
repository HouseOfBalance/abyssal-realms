import type { NetPacket, RemotePeerSnapshot } from '../../contracts/types';

export type StarWireFrame =
  | {
      __arWire: 1;
      kind: 'hello';
      peerId: string;
      nickname: string;
    }
  | {
      __arWire: 1;
      kind: 'welcome';
      hostPeerId: string;
      roomCode: string;
      peerIds: string[];
    }
  | {
      __arWire: 1;
      kind: 'room_rejected';
      reason: string;
    }
  | {
      __arWire: 1;
      kind: 'peer_joined';
      peerId: string;
    }
  | {
      __arWire: 1;
      kind: 'peer_left';
      peerId: string;
    }
  | {
      __arWire: 1;
      kind: 'host_closing';
    }
  | {
      __arWire: 1;
      kind: 'packet';
      fromPeerId: string;
      targetPeerId?: string;
      relayed?: boolean;
      packet: NetPacket;
    };

export interface BackendCallbacks {
  onRemotePeerJoined: (peerId: string) => void;
  onRemotePeerLeft: (peerId: string) => void;
  onRemotePacket: (fromPeerId: string, packet: NetPacket) => void;
  onSessionDisconnected: (reason: string) => void;
}

export interface ITransportBackend {
  readonly localPeerId: string;
  readonly roomCode: string;
  readonly isHost: boolean;
  broadcast(packet: NetPacket, reliable?: boolean): void;
  sendToPeer(targetPeerId: string, packet: NetPacket): void;
  getConnectedPeerIds(): string[];
  getUnderlyingPeerJsInstance(): unknown;
  tick?(dt: number): void;
  close(): void;
}

export function isStarWireFrame(value: unknown): value is StarWireFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __arWire?: unknown }).__arWire === 1 &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

export function clonePacket<T>(data: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(data);
  }
  return JSON.parse(JSON.stringify(data)) as T;
}

export function clonePeerSnapshot(snap: RemotePeerSnapshot): RemotePeerSnapshot {
  return {
    ...snap,
    position: { x: snap.position.x, y: snap.position.y, z: snap.position.z },
    velocity: { x: snap.velocity.x, y: snap.velocity.y, z: snap.velocity.z },
  };
}

export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
