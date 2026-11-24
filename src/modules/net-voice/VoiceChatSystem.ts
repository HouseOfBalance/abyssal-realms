import type {
  IVoiceChatSystem,
  LocalVoiceState,
  PeerVoiceState,
  Vec3,
} from '../../contracts/types';
import { clamp } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { VoiceAudioGraph } from './audioGraph';
import {
  computeSpatialAudioParams,
  stepVadEnvelope,
  VAD_SPEAK_HOLD_SEC,
  VAD_SPEAK_OFF_THRESHOLD,
  VAD_SPEAK_ON_THRESHOLD,
} from './spatialMath';

/**
 * Structural duck-type for PeerJS `MediaConnection` so `net-voice` works cleanly
 * with both live `peerjs` browser instances and headless Vitest mocks without side-effect imports.
 */
interface MediaConnectionLike {
  readonly peer: string;
  readonly open?: boolean;
  readonly remoteStream?: MediaStream | null;
  readonly peerConnection?: RTCPeerConnection | null;
  answer(stream?: MediaStream, options?: Record<string, unknown>): void;
  close(): void;
  on(event: 'stream', handler: (stream: MediaStream) => void): unknown;
  on(event: 'close', handler: () => void): unknown;
  on(event: 'error', handler: (err: unknown) => void): unknown;
  on(event: 'iceStateChanged', handler: (state: string) => void): unknown;
  off?(event: string, handler: (...args: any[]) => void): unknown;
  removeListener?(event: string, handler: (...args: any[]) => void): unknown;
}

/**
 * Structural duck-type for PeerJS `Peer`.
 */
interface PeerLike {
  readonly id?: string;
  readonly open?: boolean;
  readonly destroyed?: boolean;
  readonly disconnected?: boolean;
  call?(
    peerId: string,
    stream: MediaStream,
    options?: { metadata?: Record<string, unknown> },
  ): MediaConnectionLike | null | undefined;
  on(event: 'call', handler: (call: MediaConnectionLike) => void): unknown;
  on(event: 'open', handler: (id: string) => void): unknown;
  off?(event: string, handler: (...args: any[]) => void): unknown;
  removeListener?(event: string, handler: (...args: any[]) => void): unknown;
}

interface PeerRuntimeEntry {
  peerId: string;
  mutedByLocal: boolean;
  volume: number;
  connectedWebRtc: boolean;
  remoteStream: MediaStream | null;
  inboundCall: MediaConnectionLike | null;
  inboundAnsweredStream: MediaStream | null;
  outboundCall: MediaConnectionLike | null;
  outboundSentStream: MediaStream | null;
  voiceLevel: number;
  isSpeaking: boolean;
  vadHoldSec: number;
  simulatedLevel: number;
  simulatedHoldSec: number;
  simulatedEverInjected: boolean;
  lastDistanceGain: number;
  lastPan: number;
}

const SIMULATED_VOICE_HOLD_SEC = 0.32;
const SIMULATED_VOICE_DECAY_PER_SEC = 2.8;

function isPeerLike(candidate: unknown): candidate is PeerLike {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as PeerLike).on === 'function'
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (attr: string) => string | null;
  };
  if (el.isContentEditable === true) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true') {
    return true;
  }
  if (typeof el.tagName === 'string') {
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return true;
    }
  }
  return false;
}

function isTypingInAnyInput(e?: KeyboardEvent): boolean {
  if (e && isEditableTarget(e.target)) return true;
  if (typeof document !== 'undefined' && isEditableTarget(document.activeElement)) {
    return true;
  }
  return false;
}

function isKeyTEvent(e: KeyboardEvent): boolean {
  if (e.code === 'KeyT') return true;
  if (!e.code && typeof e.key === 'string' && e.key.toLowerCase() === 't') {
    return true;
  }
  return false;
}

function classifyGetUserMediaError(err: unknown): 'denied' | 'unavailable' {
  if (err && typeof err === 'object') {
    const name = String((err as { name?: unknown }).name ?? '');
    if (
      name === 'NotAllowedError' ||
      name === 'PermissionDeniedError' ||
      name === 'SecurityError'
    ) {
      return 'denied';
    }
    if (
      name === 'NotFoundError' ||
      name === 'DevicesNotFoundError' ||
      name === 'NotSupportedError' ||
      name === 'NotReadableError' ||
      name === 'TrackStartError' ||
      name === 'OverconstrainedError' ||
      name === 'AbortError'
    ) {
      return 'unavailable';
    }
  }
  return 'denied';
}

export class VoiceChatSystem implements IVoiceChatSystem {
  private readonly audioGraph = new VoiceAudioGraph();

  private localState: LocalVoiceState = {
    micEnabled: false,
    micPermission: 'prompt',
    mode: 'open_mic',
    pttActive: false,
    muted: false,
    deafened: false,
    spatialAudio: true,
    isSpeaking: false,
    voiceLevel: 0,
  };

  private localVadHoldSec = 0;
  private localStream: MediaStream | null = null;
  private pendingEnablePromise: Promise<boolean> | null = null;
  private micSessionToken = 0;

  private attachedPeer: PeerLike | null = null;
  private boundIncomingCallHandler: ((call: MediaConnectionLike) => void) | null = null;
  private boundPeerOpenHandler: ((id: string) => void) | null = null;
  private activeRemotePeerIds = new Set<string>();
  private peers = new Map<string, PeerRuntimeEntry>();

  private lastListenerPos: Vec3 = { x: 0, y: 0, z: 0 };
  private lastListenerYaw = 0;
  private lastPeerPositions: Record<string, Vec3> = {};

  /** Timestamp (ms) of the last full spatial-audio update; throttled to 10 Hz */
  private lastSpatialAudioUpdateMs = 0;

  private keyTHeld = false;
  private keyboardCleanup: (() => void) | null = null;
  private disposed = false;

  constructor() {
    this.installPushToTalkKeyListeners();
  }

  private installPushToTalkKeyListeners(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (this.disposed) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!isKeyTEvent(e)) return;
      if (isTypingInAnyInput(e)) return;
      if (e.repeat) return;

      this.keyTHeld = true;
      this.setPushToTalkActive(true);
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      if (this.disposed) return;
      if (!isKeyTEvent(e)) return;
      if (!this.keyTHeld && !this.localState.pttActive) return;

      this.keyTHeld = false;
      this.setPushToTalkActive(false);
    };

    const onReleaseFocus = (): void => {
      if (this.disposed) return;
      if (this.keyTHeld || this.localState.pttActive) {
        this.keyTHeld = false;
        this.setPushToTalkActive(false);
      }
    };

    const onVisibilityChange = (): void => {
      if (typeof document !== 'undefined' && document.hidden) {
        onReleaseFocus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onReleaseFocus);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    this.keyboardCleanup = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onReleaseFocus);
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      this.keyboardCleanup = null;
    };
  }

  private getOrCreatePeerEntry(peerId: string): PeerRuntimeEntry {
    let entry = this.peers.get(peerId);
    if (!entry) {
      entry = {
        peerId,
        mutedByLocal: false,
        volume: 1.0,
        connectedWebRtc: false,
        remoteStream: null,
        inboundCall: null,
        inboundAnsweredStream: null,
        outboundCall: null,
        outboundSentStream: null,
        voiceLevel: 0,
        isSpeaking: false,
        vadHoldSec: 0,
        simulatedLevel: 0,
        simulatedHoldSec: 0,
        simulatedEverInjected: false,
        lastDistanceGain: 1.0,
        lastPan: 0,
      };
      this.peers.set(peerId, entry);
    }
    return entry;
  }

  private shouldTransmitLocalAudio(): boolean {
    if (!this.localState.micEnabled || !this.localStream) return false;
    if (this.localState.muted || this.localState.deafened) return false;
    if (this.localState.mode === 'ptt') {
      return this.localState.pttActive;
    }
    return true;
  }

  private syncLocalTrackEnabledState(): void {
    const shouldTransmit = this.shouldTransmitLocalAudio();
    if (this.localStream && typeof this.localStream.getAudioTracks === 'function') {
      const tracks = this.localStream.getAudioTracks();
      for (const track of tracks) {
        try {
          track.enabled = shouldTransmit;
        } catch {
          // Ignore read-only mock tracks
        }
      }
    } else if (this.localStream && typeof this.localStream.getTracks === 'function') {
      const tracks = this.localStream.getTracks();
      for (const track of tracks) {
        if (!track.kind || track.kind === 'audio') {
          try {
            track.enabled = shouldTransmit;
          } catch {
            // Ignore read-only mock tracks
          }
        }
      }
    }

    if (!shouldTransmit) {
      this.localState.voiceLevel = 0;
      this.localState.isSpeaking = false;
      this.localVadHoldSec = 0;
    }
  }

  private detachPeerListener(): void {
    if (!this.attachedPeer) return;
    if (this.boundIncomingCallHandler) {
      try {
        if (typeof this.attachedPeer.off === 'function') {
          this.attachedPeer.off('call', this.boundIncomingCallHandler);
        } else if (typeof this.attachedPeer.removeListener === 'function') {
          this.attachedPeer.removeListener('call', this.boundIncomingCallHandler);
        }
      } catch {
        // Ignore cleanup errors on destroyed Peer instances
      }
      this.boundIncomingCallHandler = null;
    }
    if (this.boundPeerOpenHandler) {
      try {
        if (typeof this.attachedPeer.off === 'function') {
          this.attachedPeer.off('open', this.boundPeerOpenHandler);
        } else if (typeof this.attachedPeer.removeListener === 'function') {
          this.attachedPeer.removeListener('open', this.boundPeerOpenHandler);
        }
      } catch {
        // Ignore cleanup errors on destroyed Peer instances
      }
      this.boundPeerOpenHandler = null;
    }
  }

  private closePeerMediaCalls(entry: PeerRuntimeEntry, detachAudio = true): void {
    const inbound = entry.inboundCall;
    const outbound = entry.outboundCall;
    entry.inboundCall = null;
    entry.inboundAnsweredStream = null;
    entry.outboundCall = null;
    entry.outboundSentStream = null;

    if (inbound) {
      try {
        inbound.close();
      } catch {
        // Ignore
      }
    }
    if (outbound && outbound !== inbound) {
      try {
        outbound.close();
      } catch {
        // Ignore
      }
    }

    if (detachAudio) {
      entry.remoteStream = null;
      entry.connectedWebRtc = false;
      this.audioGraph.detachRemoteStream(entry.peerId);
      if (!entry.simulatedEverInjected) {
        entry.voiceLevel = 0;
        entry.isSpeaking = false;
        entry.vadHoldSec = 0;
      }
    }
  }

  attachPeerNetwork(peerJsInstance: unknown, activeRemotePeerIds: string[]): void {
    if (this.disposed) return;

    const nextPeer = isPeerLike(peerJsInstance) ? peerJsInstance : null;

    if (nextPeer !== this.attachedPeer) {
      this.detachPeerListener();
      for (const entry of this.peers.values()) {
        this.closePeerMediaCalls(entry, true);
      }
      this.attachedPeer = nextPeer;

      if (this.attachedPeer && !this.attachedPeer.destroyed) {
        this.boundIncomingCallHandler = (call: MediaConnectionLike) => {
          this.handleIncomingCall(call);
        };
        try {
          this.attachedPeer.on('call', this.boundIncomingCallHandler);
          if (this.attachedPeer.open === false) {
            this.boundPeerOpenHandler = () => {
              if (this.localState.micEnabled && this.localStream) {
                this.syncOutboundCalls();
              }
            };
            this.attachedPeer.on('open', this.boundPeerOpenHandler);
          }
        } catch {
          this.boundIncomingCallHandler = null;
          this.boundPeerOpenHandler = null;
        }
      }
    }

    const localId = this.attachedPeer?.id;
    const nextIds = new Set<string>();
    if (Array.isArray(activeRemotePeerIds)) {
      for (const rawId of activeRemotePeerIds) {
        if (typeof rawId === 'string') {
          const trimmed = rawId.trim();
          if (trimmed.length > 0 && trimmed !== localId) {
            nextIds.add(trimmed);
          }
        }
      }
    }

    // Tear down WebRTC calls for peers that were previously tracked in activeRemotePeerIds and left
    for (const prevId of this.activeRemotePeerIds) {
      if (!nextIds.has(prevId)) {
        const entry = this.peers.get(prevId);
        if (entry) {
          this.closePeerMediaCalls(entry, true);
        }
      }
    }

    this.activeRemotePeerIds = nextIds;
    for (const id of nextIds) {
      this.getOrCreatePeerEntry(id);
    }

    if (this.localState.micEnabled && this.localStream) {
      this.syncOutboundCalls();
    }
  }

  private handleIncomingCall(call: MediaConnectionLike): void {
    if (this.disposed || !call || typeof call.peer !== 'string' || !call.peer) {
      try {
        call?.close?.();
      } catch {
        // Ignore
      }
      return;
    }

    const peerId = call.peer;
    const entry = this.getOrCreatePeerEntry(peerId);

    if (entry.inboundCall && entry.inboundCall !== call) {
      const prevInbound = entry.inboundCall;
      entry.inboundCall = null;
      entry.inboundAnsweredStream = null;
      try {
        prevInbound.close();
      } catch {
        // Ignore
      }
    }

    const answerStream =
      this.localState.micEnabled && this.localStream ? this.localStream : undefined;
    entry.inboundCall = call;
    entry.inboundAnsweredStream = answerStream ?? null;

    // Bind listeners BEFORE calling answer() so synchronous mock stream emissions are captured
    this.bindMediaConnection(peerId, call, 'inbound');

    try {
      call.answer(answerStream);
    } catch {
      // Ignore answer negotiation race
    }

    if (call.remoteStream) {
      this.onRemoteStreamReceived(peerId, call.remoteStream);
    }
  }

  private syncOutboundCalls(): void {
    if (
      this.disposed ||
      !this.attachedPeer ||
      this.attachedPeer.destroyed ||
      typeof this.attachedPeer.call !== 'function' ||
      !this.localState.micEnabled ||
      !this.localStream
    ) {
      return;
    }

    const stream = this.localStream;
    const targetPeerIds = new Set<string>(this.activeRemotePeerIds);
    for (const [peerId, entry] of this.peers) {
      if (entry.inboundCall && peerId !== this.attachedPeer.id) {
        targetPeerIds.add(peerId);
      }
    }

    for (const peerId of targetPeerIds) {
      const entry = this.getOrCreatePeerEntry(peerId);

      // Already streaming current mic via outbound call
      if (entry.outboundCall && entry.outboundSentStream === stream) {
        continue;
      }

      // Already answered an active inbound call with this exact localStream
      if (entry.inboundCall && entry.inboundAnsweredStream === stream) {
        continue;
      }

      // Try seamless RTCRtpSender track replacement on an open answered inbound call if supported,
      // otherwise initiate a dedicated PeerJS media call carrying our microphone stream.
      if (entry.inboundCall && this.tryReplaceAudioSenderTrack(entry.inboundCall, stream)) {
        entry.inboundAnsweredStream = stream;
        continue;
      }

      if (entry.outboundCall) {
        const staleOutbound = entry.outboundCall;
        entry.outboundCall = null;
        entry.outboundSentStream = null;
        try {
          staleOutbound.close();
        } catch {
          // Ignore
        }
      }

      try {
        const mediaConn = this.attachedPeer.call(peerId, stream, {
          metadata: { kind: 'abyssal-voice' },
        });
        if (mediaConn) {
          entry.outboundCall = mediaConn;
          entry.outboundSentStream = stream;
          this.bindMediaConnection(peerId, mediaConn, 'outbound');
          if (mediaConn.remoteStream) {
            this.onRemoteStreamReceived(peerId, mediaConn.remoteStream);
          }
        }
      } catch {
        // Ignore transient PeerJS signaling errors (e.g., simulated or unreachable peer ID)
      }
    }
  }

  private tryReplaceAudioSenderTrack(
    conn: MediaConnectionLike,
    stream: MediaStream,
  ): boolean {
    const pc = conn.peerConnection;
    if (!pc || typeof pc.getSenders !== 'function') return false;
    const audioTrack =
      typeof stream.getAudioTracks === 'function'
        ? stream.getAudioTracks()[0]
        : typeof stream.getTracks === 'function'
          ? stream.getTracks()[0]
          : undefined;
    if (!audioTrack) return false;

    try {
      const senders = pc.getSenders();
      const audioSender = senders.find(
        (s) => s && typeof s.replaceTrack === 'function' && s.track?.kind === 'audio',
      );
      if (audioSender) {
        audioSender.replaceTrack(audioTrack).catch(() => {});
        return true;
      }
    } catch {
      // Fallback to peer.call()
    }
    return false;
  }

  private bindMediaConnection(
    peerId: string,
    conn: MediaConnectionLike,
    direction: 'inbound' | 'outbound',
  ): void {
    try {
      conn.on('stream', (remoteStream: MediaStream) => {
        this.onRemoteStreamReceived(peerId, remoteStream);
      });
      conn.on('close', () => {
        this.onMediaConnectionTerminated(peerId, conn, direction);
      });
      conn.on('error', () => {
        this.onMediaConnectionTerminated(peerId, conn, direction);
      });
      conn.on('iceStateChanged', (state: string) => {
        if (state === 'failed' || state === 'closed') {
          this.onMediaConnectionTerminated(peerId, conn, direction);
        }
      });
    } catch {
      // Ignore listener binding issues on partial mocks
    }
  }

  private onRemoteStreamReceived(peerId: string, stream: MediaStream): void {
    if (this.disposed || !stream) return;
    const entry = this.getOrCreatePeerEntry(peerId);
    entry.remoteStream = stream;
    entry.connectedWebRtc = true;

    const { effectiveGain, pan, postFaderScale } = this.computePeerOutputParams(entry);
    this.audioGraph.attachRemoteStream(peerId, stream, effectiveGain, pan);
    this.audioGraph.applyPeerGainAndPan(peerId, effectiveGain, pan, postFaderScale);
  }

  private onMediaConnectionTerminated(
    peerId: string,
    conn: MediaConnectionLike,
    direction: 'inbound' | 'outbound',
  ): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;

    if (direction === 'inbound' && entry.inboundCall === conn) {
      entry.inboundCall = null;
      entry.inboundAnsweredStream = null;
    } else if (direction === 'outbound' && entry.outboundCall === conn) {
      entry.outboundCall = null;
      entry.outboundSentStream = null;
    }

    const fallbackStream = entry.inboundCall?.remoteStream ?? entry.outboundCall?.remoteStream ?? null;
    if (fallbackStream) {
      this.onRemoteStreamReceived(peerId, fallbackStream);
      return;
    }

    if (!entry.inboundCall && !entry.outboundCall) {
      entry.remoteStream = null;
      entry.connectedWebRtc = false;
      this.audioGraph.detachRemoteStream(peerId);
      if (!entry.simulatedEverInjected) {
        entry.voiceLevel = 0;
        entry.isSpeaking = false;
        entry.vadHoldSec = 0;
      }
    }
  }

  async enableMicrophone(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.localState.micEnabled && this.localStream) {
      this.syncLocalTrackEnabledState();
      this.syncOutboundCalls();
      return true;
    }
    if (this.pendingEnablePromise) {
      return this.pendingEnablePromise;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      this.localState.micPermission = 'unavailable';
      this.localState.micEnabled = false;
      return false;
    }

    const token = ++this.micSessionToken;
    const requestPromise = (async (): Promise<boolean> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (this.disposed || token !== this.micSessionToken || !stream) {
          this.stopMediaStreamTracks(stream);
          return false;
        }

        this.localStream = stream;
        this.localState.micPermission = 'granted';
        this.localState.micEnabled = true;

        this.audioGraph.attachLocalStream(stream);
        this.syncLocalTrackEnabledState();
        this.syncOutboundCalls();
        return true;
      } catch (err) {
        if (!this.disposed && token === this.micSessionToken) {
          this.localState.micPermission = classifyGetUserMediaError(err);
          this.localState.micEnabled = false;
          this.localState.isSpeaking = false;
          this.localState.voiceLevel = 0;
        }
        return false;
      } finally {
        if (token === this.micSessionToken) {
          this.pendingEnablePromise = null;
        }
      }
    })();

    this.pendingEnablePromise = requestPromise;
    return requestPromise;
  }

  private stopMediaStreamTracks(stream: MediaStream | null | undefined): void {
    if (!stream) return;
    try {
      if (typeof stream.getTracks === 'function') {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            // Ignore
          }
        }
      } else if (typeof stream.getAudioTracks === 'function') {
        for (const track of stream.getAudioTracks()) {
          try {
            track.stop();
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  disableMicrophone(): void {
    this.micSessionToken++;
    this.pendingEnablePromise = null;

    this.audioGraph.detachLocalStream();
    this.stopMediaStreamTracks(this.localStream);
    this.localStream = null;

    this.localState.micEnabled = false;
    this.localState.isSpeaking = false;
    this.localState.voiceLevel = 0;
    this.localVadHoldSec = 0;

    if (this.localState.pttActive) {
      this.keyTHeld = false;
      this.localState.pttActive = false;
      eventBus.emit('mp:voicePtt', { active: false });
    }

    // Close outbound-only calls that have no incoming remote audio, while preserving inbound calls
    // so the player continues hearing remote teammates after turning off their own mic.
    for (const entry of this.peers.values()) {
      entry.inboundAnsweredStream = null;
      if (entry.outboundCall) {
        const hasOnlyOutboundRemoteStream =
          !entry.inboundCall && Boolean(entry.outboundCall.remoteStream);
        if (!hasOnlyOutboundRemoteStream) {
          const out = entry.outboundCall;
          entry.outboundCall = null;
          entry.outboundSentStream = null;
          try {
            out.close();
          } catch {
            // Ignore
          }
        } else {
          entry.outboundSentStream = null;
        }
      }
    }
  }

  setVoiceMode(mode: 'ptt' | 'open_mic'): void {
    if (this.disposed) return;
    if (mode !== 'ptt' && mode !== 'open_mic') return;
    this.localState.mode = mode;
    if (mode === 'open_mic' && this.localState.pttActive && !this.keyTHeld) {
      this.localState.pttActive = false;
    }
    this.syncLocalTrackEnabledState();
  }

  setPushToTalkActive(active: boolean): void {
    if (this.disposed) return;
    const next = Boolean(active);
    if (this.localState.pttActive === next) return;

    this.localState.pttActive = next;
    if (!next) {
      this.keyTHeld = false;
    }
    this.syncLocalTrackEnabledState();
    eventBus.emit('mp:voicePtt', { active: next });
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.localState.muted = Boolean(muted);
    this.syncLocalTrackEnabledState();
  }

  setDeafened(deafened: boolean): void {
    if (this.disposed) return;
    this.localState.deafened = Boolean(deafened);
    this.syncLocalTrackEnabledState();
    this.refreshAllPeersAudioOutput();
  }

  setSpatialAudio(enabled: boolean): void {
    if (this.disposed) return;
    this.localState.spatialAudio = Boolean(enabled);
    this.refreshAllPeersAudioOutput();
  }

  setPeerMuted(peerId: string, muted: boolean): void {
    if (this.disposed || !peerId) return;
    const entry = this.getOrCreatePeerEntry(peerId);
    entry.mutedByLocal = Boolean(muted);
    if (entry.mutedByLocal) {
      entry.voiceLevel = 0;
      entry.isSpeaking = false;
      entry.vadHoldSec = 0;
    }
    this.applySinglePeerAudioOutput(entry);
  }

  setPeerVolume(peerId: string, volume: number): void {
    if (this.disposed || !peerId) return;
    const entry = this.getOrCreatePeerEntry(peerId);
    entry.volume = clamp(Number.isFinite(volume) ? volume : 1.0, 0, 2);
    if (entry.volume <= 0) {
      entry.voiceLevel = 0;
      entry.isSpeaking = false;
      entry.vadHoldSec = 0;
    }
    this.applySinglePeerAudioOutput(entry);
  }

  injectSimulatedVoiceLevel(peerId: string, level: number): void {
    if (this.disposed || !peerId) return;
    const entry = this.getOrCreatePeerEntry(peerId);
    const clamped = clamp(Number.isFinite(level) ? level : 0, 0, 1);

    entry.simulatedEverInjected = true;
    entry.simulatedLevel = clamped;
    entry.simulatedHoldSec = clamped > 0 ? SIMULATED_VOICE_HOLD_SEC : 0;

    if (entry.mutedByLocal || this.localState.deafened || entry.volume <= 0) {
      entry.voiceLevel = 0;
      entry.isSpeaking = false;
      entry.vadHoldSec = 0;
      return;
    }

    const scaled = clamp(clamped * Math.min(entry.volume, 1.25), 0, 1);
    entry.voiceLevel = scaled;
    if (scaled >= VAD_SPEAK_ON_THRESHOLD) {
      entry.isSpeaking = true;
      entry.vadHoldSec = VAD_SPEAK_HOLD_SEC;
    } else if (clamped <= 0) {
      entry.voiceLevel = 0;
      entry.isSpeaking = false;
      entry.vadHoldSec = 0;
    }
  }

  getLocalState(): LocalVoiceState {
    return { ...this.localState };
  }

  getPeerVoiceState(peerId: string): PeerVoiceState {
    const entry = this.peers.get(peerId);
    if (!entry) {
      return {
        peerId,
        isSpeaking: false,
        voiceLevel: 0,
        mutedByLocal: false,
        volume: 1.0,
        connectedAudio: false,
      };
    }

    const silenced = entry.mutedByLocal || this.localState.deafened || entry.volume <= 0;
    return {
      peerId: entry.peerId,
      isSpeaking: silenced ? false : entry.isSpeaking,
      voiceLevel: silenced ? 0 : entry.voiceLevel,
      mutedByLocal: entry.mutedByLocal,
      volume: entry.volume,
      connectedAudio: entry.connectedWebRtc || entry.simulatedEverInjected,
    };
  }

  private computePeerOutputParams(entry: PeerRuntimeEntry): {
    effectiveGain: number;
    pan: number;
    postFaderScale: number;
  } {
    const peerPos = this.lastPeerPositions[entry.peerId];
    const { pan, distanceGain } = computeSpatialAudioParams(
      this.lastListenerPos,
      this.lastListenerYaw,
      peerPos,
      this.localState.spatialAudio,
    );

    entry.lastDistanceGain = distanceGain;
    entry.lastPan = pan;

    if (this.localState.deafened || entry.mutedByLocal || entry.volume <= 0) {
      return { effectiveGain: 0, pan, postFaderScale: 0 };
    }

    const effectiveGain = clamp(entry.volume * distanceGain, 0, 2);
    return {
      effectiveGain,
      pan,
      postFaderScale: distanceGain * Math.max(0.25, entry.volume),
    };
  }

  private applySinglePeerAudioOutput(entry: PeerRuntimeEntry): void {
    const { effectiveGain, pan, postFaderScale } = this.computePeerOutputParams(entry);
    this.audioGraph.applyPeerGainAndPan(entry.peerId, effectiveGain, pan, postFaderScale);
  }

  private refreshAllPeersAudioOutput(): void {
    for (const entry of this.peers.values()) {
      this.applySinglePeerAudioOutput(entry);
      if (this.localState.deafened || entry.mutedByLocal || entry.volume <= 0) {
        entry.voiceLevel = 0;
        entry.isSpeaking = false;
        entry.vadHoldSec = 0;
      }
    }
  }

  updateSpatialPositions(
    dt: number,
    listenerPos: Vec3,
    listenerYaw: number,
    peerPositions: Record<string, Vec3>,
  ): void {
    if (this.disposed) return;

    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.5) : 0;

    if (listenerPos) {
      this.lastListenerPos = {
        x: Number.isFinite(listenerPos.x) ? listenerPos.x : 0,
        y: Number.isFinite(listenerPos.y) ? listenerPos.y : 0,
        z: Number.isFinite(listenerPos.z) ? listenerPos.z : 0,
      };
    }
    if (Number.isFinite(listenerYaw)) {
      this.lastListenerYaw = listenerYaw;
    }
    this.lastPeerPositions = peerPositions ? { ...peerPositions } : {};

    // Ensure entries exist for any positioned peers so spatial parameters stay warm
    if (peerPositions) {
      for (const peerId of Object.keys(peerPositions)) {
        if (peerId) {
          this.getOrCreatePeerEntry(peerId);
        }
      }
    }

    // 1. Update Local Microphone RMS VAD — only run AnalyserNode processing when there are peers
    if (this.peers.size > 0 && this.shouldTransmitLocalAudio()) {
      const rawLocalLevel = this.audioGraph.sampleLocalVoiceLevel();
      const steppedLocal = stepVadEnvelope(
        this.localState.voiceLevel,
        rawLocalLevel,
        this.localState.isSpeaking,
        this.localVadHoldSec,
        safeDt,
      );
      this.localState.voiceLevel = steppedLocal.voiceLevel;
      this.localState.isSpeaking = steppedLocal.isSpeaking;
      this.localVadHoldSec = steppedLocal.holdSec;
    } else {
      this.localState.voiceLevel = 0;
      this.localState.isSpeaking = false;
      this.localVadHoldSec = 0;
    }

    // 2. Update Remote Peers: 3D Spatial Pan + Proximity Rolloff + WebRTC & Simulated Bot VAD
    const nowMs = performance.now();
    const doSpatialUpdate = nowMs - this.lastSpatialAudioUpdateMs >= 100; // throttle to 10 Hz
    if (doSpatialUpdate) {
      this.lastSpatialAudioUpdateMs = nowMs;
    }

    for (const entry of this.peers.values()) {
      // Only push new gain/pan values to Web Audio nodes at 10 Hz max
      if (doSpatialUpdate) {
        this.applySinglePeerAudioOutput(entry);
      }

      // Decay simulated bot voice level naturally after hold window
      if (entry.simulatedLevel > 0 && safeDt > 0) {
        if (entry.simulatedHoldSec > 0) {
          entry.simulatedHoldSec = Math.max(0, entry.simulatedHoldSec - safeDt);
        } else {
          entry.simulatedLevel = Math.max(
            0,
            entry.simulatedLevel - SIMULATED_VOICE_DECAY_PER_SEC * safeDt,
          );
          if (entry.simulatedLevel < 0.005) {
            entry.simulatedLevel = 0;
          }
        }
      }

      if (this.localState.deafened || entry.mutedByLocal || entry.volume <= 0) {
        entry.voiceLevel = 0;
        entry.isSpeaking = false;
        entry.vadHoldSec = 0;
        continue;
      }

      const webRtcLevel = entry.connectedWebRtc
        ? this.audioGraph.sampleRemoteVoiceLevel(entry.peerId)
        : 0;
      const simDistanceFactor = this.localState.spatialAudio ? entry.lastDistanceGain : 1.0;
      const simEffectiveLevel = clamp(
        entry.simulatedLevel * Math.min(entry.volume, 1.25) * Math.max(0.25, simDistanceFactor),
        0,
        1,
      );

      if (entry.simulatedLevel > 0 && webRtcLevel <= simEffectiveLevel) {
        entry.voiceLevel = simEffectiveLevel;
        if (simEffectiveLevel >= VAD_SPEAK_ON_THRESHOLD) {
          entry.isSpeaking = true;
          entry.vadHoldSec = VAD_SPEAK_HOLD_SEC;
        } else if (simEffectiveLevel < VAD_SPEAK_OFF_THRESHOLD) {
          entry.vadHoldSec = Math.max(0, entry.vadHoldSec - safeDt);
          if (entry.vadHoldSec <= 0) {
            entry.isSpeaking = false;
          }
        }
      } else {
        const steppedPeer = stepVadEnvelope(
          entry.voiceLevel,
          webRtcLevel,
          entry.isSpeaking,
          entry.vadHoldSec,
          safeDt,
        );
        entry.voiceLevel = steppedPeer.voiceLevel;
        entry.isSpeaking = steppedPeer.isSpeaking;
        entry.vadHoldSec = steppedPeer.holdSec;
      }
    }
  }

  /**
   * Diagnostics helper exposing Web Audio gain/pan node values for a given peer.
   */
  getPeerSpatialDiagnostics(peerId: string): {
    hasPipeline: boolean;
    usingWebAudio: boolean;
    gain: number;
    pan: number;
    distanceGain: number;
  } {
    const diag = this.audioGraph.getPeerAudioDiagnostics(peerId);
    const entry = this.peers.get(peerId);
    return {
      ...diag,
      distanceGain: entry?.lastDistanceGain ?? 1,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.keyboardCleanup?.();
    this.detachPeerListener();
    this.attachedPeer = null;
    this.activeRemotePeerIds.clear();

    for (const entry of this.peers.values()) {
      this.closePeerMediaCalls(entry, false);
    }
    this.peers.clear();

    this.disableMicrophone();
    this.audioGraph.dispose();
  }
}

export function createVoiceChatSystem(): IVoiceChatSystem {
  return new VoiceChatSystem();
}
