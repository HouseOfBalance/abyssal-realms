import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '../../core/EventBus';
import {
  VoiceChatSystem,
  computeRmsLevelFromByteSamples,
  computeRmsLevelFromFloatSamples,
  computeSpatialAudioParams,
  createVoiceChatSystem,
} from './index';

interface MockAudioTrack {
  kind: 'audio';
  enabled: boolean;
  stopped: boolean;
  stop: ReturnType<typeof vi.fn>;
}

function createMockMediaStream(id = 'stream-1'): {
  stream: MediaStream;
  track: MockAudioTrack;
} {
  const track: MockAudioTrack = {
    kind: 'audio',
    enabled: true,
    stopped: false,
    stop: vi.fn(() => {
      track.stopped = true;
    }),
  };

  const stream = {
    id,
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;

  return { stream, track };
}

class MockMediaConnection {
  public readonly peer: string;
  public open = true;
  public remoteStream: MediaStream | null = null;
  public answeredWith: MediaStream | undefined | '__not_answered__' = '__not_answered__';
  public closed = false;
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(peerId: string) {
    this.peer = peerId;
  }

  on(event: string, handler: (...args: any[]) => void): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }

  off(event: string, handler: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, ...args: any[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(...args);
    }
  }

  answer(stream?: MediaStream): void {
    this.answeredWith = stream;
  }

  emitRemoteStream(stream: MediaStream): void {
    this.remoteStream = stream;
    this.emit('stream', stream);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
  }
}

class MockPeerJs {
  public readonly id: string;
  public open = true;
  public destroyed = false;
  public outgoingCalls: Array<{
    peerId: string;
    stream: MediaStream;
    conn: MockMediaConnection;
  }> = [];
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(id = 'abyssal-realms-coop-HOST01') {
    this.id = id;
  }

  on(event: string, handler: (...args: any[]) => void): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }

  off(event: string, handler: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  call = vi.fn((peerId: string, stream: MediaStream) => {
    const conn = new MockMediaConnection(peerId);
    this.outgoingCalls.push({ peerId, stream, conn });
    return conn;
  });

  simulateIncomingCall(fromPeerId: string): MockMediaConnection {
    const conn = new MockMediaConnection(fromPeerId);
    const set = this.listeners.get('call');
    if (set) {
      for (const fn of set) {
        fn(conn);
      }
    }
    return conn;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

interface MockWebAudioRig {
  setNextSourceAmplitude: (streamId: string, amplitude: number) => void;
  createdGains: Array<{ gain: { value: number }; connectedTo: any[] }>;
  createdPanners: Array<{ pan: { value: number }; connectedTo: any[] }>;
  createdAnalysers: Array<{
    fftSize: number;
    smoothingTimeConstant: number;
    connectedTo: any[];
  }>;
  closedCount: () => number;
}

function installMockWebAudio(): MockWebAudioRig {
  const streamAmplitudes = new Map<string, number>();
  const createdGains: MockWebAudioRig['createdGains'] = [];
  const createdPanners: MockWebAudioRig['createdPanners'] = [];
  const createdAnalysers: MockWebAudioRig['createdAnalysers'] = [];
  let closed = 0;

  class MockNode {
    public connectedTo: any[] = [];
    public upstreamStreamId: string | null = null;
    public gainRef: { value: number } | null = null;

    connect(dest: any): any {
      this.connectedTo.push(dest);
      if (dest && typeof dest === 'object') {
        if (this.upstreamStreamId) {
          dest.upstreamStreamId = this.upstreamStreamId;
        }
        if (this.gainRef) {
          dest.gainRef = this.gainRef;
        }
      }
      return dest;
    }

    disconnect(): void {
      this.connectedTo = [];
    }
  }

  class FakeAudioContext {
    public state: AudioContextState = 'running';
    public currentTime = 0;
    public destination = new MockNode();

    resume = vi.fn(async () => {
      this.state = 'running';
    });

    close = vi.fn(async () => {
      this.state = 'closed';
      closed++;
    });

    createMediaStreamSource(stream: MediaStream) {
      const node = new MockNode();
      node.upstreamStreamId = stream.id;
      return node;
    }

    createGain() {
      const node = new MockNode() as MockNode & { gain: { value: number } };
      node.gain = { value: 1 };
      node.gainRef = node.gain;
      createdGains.push(node);
      return node;
    }

    createStereoPanner() {
      const node = new MockNode() as MockNode & { pan: { value: number } };
      node.pan = { value: 0 };
      createdPanners.push(node);
      return node;
    }

    createAnalyser() {
      const node = new MockNode() as MockNode & {
        fftSize: number;
        smoothingTimeConstant: number;
        getFloatTimeDomainData: (arr: Float32Array) => void;
      };
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.5;
      node.getFloatTimeDomainData = (arr: Float32Array) => {
        const baseAmp = node.upstreamStreamId
          ? (streamAmplitudes.get(node.upstreamStreamId) ?? 0)
          : 0;
        const postGain = node.gainRef ? node.gainRef.value : 1;
        const amp = baseAmp * postGain;
        for (let i = 0; i < arr.length; i++) {
          arr[i] = i % 2 === 0 ? amp : -amp;
        }
      };
      createdAnalysers.push(node);
      return node;
    }
  }

  (globalThis as any).AudioContext = FakeAudioContext;

  return {
    setNextSourceAmplitude: (streamId: string, amplitude: number) => {
      streamAmplitudes.set(streamId, amplitude);
    },
    createdGains,
    createdPanners,
    createdAnalysers,
    closedCount: () => closed,
  };
}

describe('VoiceChatSystem (net-voice)', () => {
  const origNavigator = globalThis.navigator;
  const origAudioContext = (globalThis as any).AudioContext;
  const origWindow = (globalThis as any).window;
  const origDocument = (globalThis as any).document;

  beforeEach(() => {
    eventBus.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'navigator', {
      value: origNavigator,
      configurable: true,
      writable: true,
    });
    if (origAudioContext === undefined) {
      delete (globalThis as any).AudioContext;
    } else {
      (globalThis as any).AudioContext = origAudioContext;
    }
    if (origWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
    if (origDocument === undefined) {
      delete (globalThis as any).document;
    } else {
      (globalThis as any).document = origDocument;
    }
  });

  it('runs headlessly in Node without browser globals and handles unavailable mediaDevices cleanly', async () => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).AudioContext;
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });

    const voice = createVoiceChatSystem();
    expect(voice.getLocalState()).toEqual({
      micEnabled: false,
      micPermission: 'prompt',
      mode: 'open_mic',
      pttActive: false,
      muted: false,
      deafened: false,
      spatialAudio: true,
      isSpeaking: false,
      voiceLevel: 0,
    });

    const enabled = await voice.enableMicrophone();
    expect(enabled).toBe(false);
    expect(voice.getLocalState().micPermission).toBe('unavailable');
    expect(voice.getLocalState().micEnabled).toBe(false);

    voice.updateSpatialPositions(0.016, { x: 0, y: 0, z: 0 }, 0, {
      'peer-1': { x: 5, y: 0, z: -3 },
    });
    expect(voice.getPeerVoiceState('peer-1').connectedAudio).toBe(false);

    voice.dispose();
  });

  it('captures microphone with echoCancellation/noiseSuppression/autoGainControl and manages PTT, mute, and deafen', async () => {
    const { stream, track } = createMockMediaStream('local-mic');
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia } },
      configurable: true,
      writable: true,
    });

    const pttEvents: boolean[] = [];
    eventBus.on('mp:voicePtt', ({ active }) => pttEvents.push(active));

    const voice = createVoiceChatSystem();
    const ok = await voice.enableMicrophone();

    expect(ok).toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(voice.getLocalState().micPermission).toBe('granted');
    expect(voice.getLocalState().micEnabled).toBe(true);
    expect(track.enabled).toBe(true);

    // Switch to Push-to-Talk ('ptt'): track gated off until PTT active
    voice.setVoiceMode('ptt');
    expect(track.enabled).toBe(false);

    voice.setPushToTalkActive(true);
    expect(voice.getLocalState().pttActive).toBe(true);
    expect(track.enabled).toBe(true);
    expect(pttEvents).toEqual([true]);

    // Muting or deafening suppresses transmission even while holding PTT
    voice.setMuted(true);
    expect(track.enabled).toBe(false);
    voice.setMuted(false);
    expect(track.enabled).toBe(true);

    voice.setDeafened(true);
    expect(track.enabled).toBe(false);
    voice.setDeafened(false);
    expect(track.enabled).toBe(true);

    voice.setPushToTalkActive(false);
    expect(track.enabled).toBe(false);
    expect(pttEvents).toEqual([true, false]);

    // Disabling microphone stops underlying MediaStreamTracks cleanly
    voice.disableMicrophone();
    expect(track.stopped).toBe(true);
    expect(voice.getLocalState().micEnabled).toBe(false);

    voice.dispose();
  });

  it('tracks denied microphone permission when user blocks mic access', async () => {
    const deniedErr = Object.assign(new Error('Permission denied'), {
      name: 'NotAllowedError',
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => {
            throw deniedErr;
          }),
        },
      },
      configurable: true,
      writable: true,
    });

    const voice = createVoiceChatSystem();
    const ok = await voice.enableMicrophone();
    expect(ok).toBe(false);
    expect(voice.getLocalState().micPermission).toBe('denied');
    expect(voice.getLocalState().micEnabled).toBe(false);
    voice.dispose();
  });

  it('binds Key T hold listener safely (ignoring typing in inputs & key repeat) and emits mp:voicePtt', () => {
    const windowListeners = new Map<string, Set<(e: any) => void>>();
    (globalThis as any).window = {
      addEventListener: (type: string, fn: (e: any) => void) => {
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (e: any) => void) => {
        windowListeners.get(type)?.delete(fn);
      },
    };
    const docState: { activeElement: any; hidden: boolean } = {
      activeElement: null,
      hidden: false,
    };
    (globalThis as any).document = {
      get activeElement() {
        return docState.activeElement;
      },
      get hidden() {
        return docState.hidden;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const dispatchWin = (type: string, payload: any = {}) => {
      for (const fn of windowListeners.get(type) ?? []) {
        fn(payload);
      }
    };

    const pttLog: boolean[] = [];
    eventBus.on('mp:voicePtt', ({ active }) => pttLog.push(active));

    const voice = createVoiceChatSystem();
    voice.setVoiceMode('ptt');

    // Typing inside chat <input> or <textarea> must NOT activate PTT
    dispatchWin('keydown', {
      code: 'KeyT',
      key: 't',
      repeat: false,
      target: { tagName: 'INPUT' },
    });
    expect(voice.getLocalState().pttActive).toBe(false);
    expect(pttLog).toEqual([]);

    // Holding Key T during gameplay activates PTT once (ignoring OS repeat events)
    dispatchWin('keydown', {
      code: 'KeyT',
      key: 't',
      repeat: false,
      target: { tagName: 'CANVAS' },
    });
    dispatchWin('keydown', {
      code: 'KeyT',
      key: 't',
      repeat: true,
      target: { tagName: 'CANVAS' },
    });
    expect(voice.getLocalState().pttActive).toBe(true);
    expect(pttLog).toEqual([true]);

    // Releasing Key T deactivates PTT even if focus moved to an input mid-hold
    docState.activeElement = { tagName: 'INPUT' };
    dispatchWin('keyup', {
      code: 'KeyT',
      key: 't',
      target: docState.activeElement,
    });
    expect(voice.getLocalState().pttActive).toBe(false);
    expect(pttLog).toEqual([true, false]);

    voice.dispose();
    expect(windowListeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it('answers incoming PeerJS WebRTC calls and places outgoing calls to active remote PeerJS IDs', async () => {
    installMockWebAudio();
    const { stream: localStream } = createMockMediaStream('local-host-mic');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => localStream),
        },
      },
      configurable: true,
      writable: true,
    });

    const mockPeer = new MockPeerJs('abyssal-realms-coop-ROOM77');
    const voice = new VoiceChatSystem();

    // Attach PeerJS network with one connected guest BEFORE local mic is enabled
    voice.attachPeerNetwork(mockPeer, ['guest-peer-alpha']);
    expect(mockPeer.listenerCount('call')).toBe(1);
    expect(mockPeer.call).not.toHaveBeenCalled();

    // Incoming call from guest-peer-beta while our mic is still off -> answered in receive-only mode!
    const incomingFromBeta = mockPeer.simulateIncomingCall('guest-peer-beta');
    expect(incomingFromBeta.answeredWith).toBeUndefined();
    const { stream: betaRemoteStream } = createMockMediaStream('beta-remote-audio');
    incomingFromBeta.emitRemoteStream(betaRemoteStream);
    expect(voice.getPeerVoiceState('guest-peer-beta').connectedAudio).toBe(true);

    // Enabling local microphone calls active remote peers (alpha & beta since beta was answered without local stream)
    await voice.enableMicrophone();
    expect(mockPeer.outgoingCalls.map((c) => c.peerId)).toEqual([
      'guest-peer-alpha',
      'guest-peer-beta',
    ]);

    // Remote stream arriving on outgoing call to alpha connects alpha's audio
    const { stream: alphaRemoteStream } = createMockMediaStream('alpha-remote-audio');
    mockPeer.outgoingCalls[0].conn.emitRemoteStream(alphaRemoteStream);
    expect(voice.getPeerVoiceState('guest-peer-alpha').connectedAudio).toBe(true);

    // A new 3rd player (gamma) joins later -> attachPeerNetwork dials only gamma without re-dialing alpha/beta
    voice.attachPeerNetwork(mockPeer, [
      'guest-peer-alpha',
      'guest-peer-beta',
      'abyssal-realms-coop-GAMMA3',
    ]);
    expect(mockPeer.outgoingCalls.map((c) => c.peerId)).toEqual([
      'guest-peer-alpha',
      'guest-peer-beta',
      'abyssal-realms-coop-GAMMA3',
    ]);

    // Incoming call when mic IS enabled answers directly with localStream
    const incomingFromDelta = mockPeer.simulateIncomingCall('guest-peer-delta');
    expect(incomingFromDelta.answeredWith).toBe(localStream);

    // Closing alpha's call cleans up alpha's connectedAudio
    mockPeer.outgoingCalls[0].conn.close();
    expect(voice.getPeerVoiceState('guest-peer-alpha').connectedAudio).toBe(false);

    voice.dispose();
    expect(mockPeer.listenerCount('call')).toBe(0);
  });

  it('computes 3D spatial stereo panning, proximity rolloff, radio mode, per-peer volume (0..2), and RMS + simulated VAD', async () => {
    const audioRig = installMockWebAudio();
    const { stream: localStream } = createMockMediaStream('local-vad-mic');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => localStream),
        },
      },
      configurable: true,
      writable: true,
    });

    const mockPeer = new MockPeerJs('host-peer');
    const voice = new VoiceChatSystem();
    voice.attachPeerNetwork(mockPeer, ['peer-right', 'peer-left']);
    await voice.enableMicrophone();

    const { stream: rightStream } = createMockMediaStream('remote-right');
    const { stream: leftStream } = createMockMediaStream('remote-left');
    mockPeer.outgoingCalls[0].conn.emitRemoteStream(rightStream);
    mockPeer.outgoingCalls[1].conn.emitRemoteStream(leftStream);

    // Feed speech amplitude into local mic and peer-right's remote stream
    audioRig.setNextSourceAmplitude('local-vad-mic', 0.16);
    audioRig.setNextSourceAmplitude('remote-right', 0.18);
    audioRig.setNextSourceAmplitude('remote-left', 0.0);

    // Listener at origin facing -Z (yaw = 0): +X is right ear, -X is left ear
    voice.updateSpatialPositions(0.05, { x: 0, y: 0, z: 0 }, 0, {
      'peer-right': { x: 8, y: 0, z: 0 },
      'peer-left': { x: -24, y: 0, z: 0 },
    });

    const rightDiag = voice.getPeerSpatialDiagnostics('peer-right');
    const leftDiag = voice.getPeerSpatialDiagnostics('peer-left');
    expect(rightDiag.usingWebAudio).toBe(true);
    expect(rightDiag.pan).toBeGreaterThan(0.5);
    expect(leftDiag.pan).toBeLessThan(-0.5);
    // peer-left at 24m has stronger distance attenuation than peer-right at 8m
    expect(leftDiag.gain).toBeLessThan(rightDiag.gain);

    // Real-time RMS VAD detects both local speaker and peer-right speaking, while peer-left is silent
    expect(voice.getLocalState().isSpeaking).toBe(true);
    expect(voice.getLocalState().voiceLevel).toBeGreaterThan(0.2);
    expect(voice.getPeerVoiceState('peer-right').isSpeaking).toBe(true);
    expect(voice.getPeerVoiceState('peer-right').voiceLevel).toBeGreaterThan(0.2);
    expect(voice.getPeerVoiceState('peer-left').isSpeaking).toBe(false);

    // Per-peer volume boost (up to 200%) & mute
    voice.setPeerVolume('peer-right', 1.8);
    expect(voice.getPeerVoiceState('peer-right').volume).toBeCloseTo(1.8);
    expect(voice.getPeerSpatialDiagnostics('peer-right').gain).toBeCloseTo(
      rightDiag.distanceGain * 1.8,
      4,
    );

    voice.setPeerMuted('peer-right', true);
    expect(voice.getPeerSpatialDiagnostics('peer-right').gain).toBe(0);
    expect(voice.getPeerVoiceState('peer-right').isSpeaking).toBe(false);
    voice.setPeerMuted('peer-right', false);

    // Disabling spatialAudio switches to full centered stereo radio (pan = 0, full volume regardless of 24m distance)
    voice.setSpatialAudio(false);
    voice.setPeerVolume('peer-left', 1.25);
    const radioDiag = voice.getPeerSpatialDiagnostics('peer-left');
    expect(radioDiag.pan).toBe(0);
    expect(radioDiag.gain).toBeCloseTo(1.25, 4);

    // Simulated AI partner voice injection + natural decay
    voice.injectSimulatedVoiceLevel('bot-seraphina', 0.85);
    const botSpeaking = voice.getPeerVoiceState('bot-seraphina');
    expect(botSpeaking.connectedAudio).toBe(true);
    expect(botSpeaking.isSpeaking).toBe(true);
    expect(botSpeaking.voiceLevel).toBeGreaterThan(0.7);

    // Step forward past hold + decay window -> returns cleanly to silent
    for (let i = 0; i < 12; i++) {
      voice.updateSpatialPositions(0.1, { x: 0, y: 0, z: 0 }, 0, {});
    }
    expect(voice.getPeerVoiceState('bot-seraphina').voiceLevel).toBe(0);
    expect(voice.getPeerVoiceState('bot-seraphina').isSpeaking).toBe(false);

    voice.dispose();
    expect(audioRig.closedCount()).toBe(1);
  });

  it('validates pure spatial math & byte/float RMS helpers across listener yaw rotations', () => {
    // At yaw = pi/2 (+90 deg around Y), listener right vector is (0, 0, -1)
    const rotated = computeSpatialAudioParams(
      { x: 0, y: 0, z: 0 },
      Math.PI / 2,
      { x: 0, y: 0, z: -10 },
      true,
    );
    expect(rotated.pan).toBeGreaterThan(0.8);

    const floatRms = computeRmsLevelFromFloatSamples(new Float32Array([0.5, -0.5, 0.5, -0.5]));
    expect(floatRms).toBeCloseTo(0.5, 5);

    const byteRms = computeRmsLevelFromByteSamples(new Uint8Array([192, 64, 192, 64]));
    expect(byteRms).toBeCloseTo(0.5, 2);
  });

  it('creates hidden <audio> element bridge for Chrome WebRTC autoplay rules and falls back cleanly without AudioContext', () => {
    delete (globalThis as any).AudioContext;

    const createdAudioElements: any[] = [];
    const bodyChildren: any[] = [];
    (globalThis as any).document = {
      body: {
        appendChild: (el: any) => {
          bodyChildren.push(el);
          return el;
        },
      },
      createElement: (tag: string) => {
        if (tag === 'audio') {
          const el: any = {
            autoplay: false,
            muted: false,
            volume: 1,
            srcObject: null,
            dataset: {},
            style: {},
            attrs: {} as Record<string, string>,
            setAttribute(k: string, v: string) {
              this.attrs[k] = v;
            },
            play: vi.fn(() => Promise.resolve()),
            pause: vi.fn(),
            remove: vi.fn(),
          };
          createdAudioElements.push(el);
          return el;
        }
        return {
          dataset: {},
          style: {},
          children: [] as any[],
          setAttribute: vi.fn(),
          appendChild(child: any) {
            this.children.push(child);
            return child;
          },
          remove: vi.fn(),
        };
      },
    };

    const mockPeer = new MockPeerJs('host-fallback');
    const voice = createVoiceChatSystem();
    voice.attachPeerNetwork(mockPeer, ['remote-chrome-peer']);

    const call = mockPeer.simulateIncomingCall('remote-chrome-peer');
    const { stream: remoteStream } = createMockMediaStream('chrome-webrtc-stream');
    call.emitRemoteStream(remoteStream);

    expect(createdAudioElements.length).toBe(1);
    const audioEl = createdAudioElements[0];
    expect(audioEl.autoplay).toBe(true);
    expect(audioEl.attrs.playsinline).toBe('true');
    expect(audioEl.srcObject).toBe(remoteStream);
    expect(audioEl.muted).toBe(false);
    expect(audioEl.volume).toBeCloseTo(1, 3);

    // Distance attenuation & mute propagate to fallback <audio> element when Web Audio is absent
    voice.updateSpatialPositions(0.016, { x: 0, y: 0, z: 0 }, 0, {
      'remote-chrome-peer': { x: 25, y: 0, z: 0 },
    });
    expect(audioEl.volume).toBeLessThan(0.5);
    expect(audioEl.volume).toBeGreaterThan(0.05);

    voice.setDeafened(true);
    expect(audioEl.muted).toBe(true);
    expect(audioEl.volume).toBe(0);

    voice.dispose();
    expect(audioEl.pause).toHaveBeenCalled();
    expect(audioEl.remove).toHaveBeenCalled();
  });
});
