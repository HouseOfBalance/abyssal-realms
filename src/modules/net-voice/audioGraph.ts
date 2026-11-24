import { clamp } from '../../core/Constants';
import {
  computeRmsLevelFromByteSamples,
  computeRmsLevelFromFloatSamples,
  rmsToNormalizedVoiceLevel,
} from './spatialMath';

const ANALYSER_FFT_SIZE = 256;
const ANALYSER_SMOOTHING = 0.5;

interface RemotePeerAudioNodes {
  peerId: string;
  stream: MediaStream;
  sourceNode: MediaStreamAudioSourceNode | null;
  gainNode: GainNode | null;
  pannerNode: StereoPannerNode | null;
  analyserNode: AnalyserNode | null;
  floatScratch: Float32Array;
  byteScratch: Uint8Array;
  audioElement: HTMLAudioElement | null;
  usingWebAudio: boolean;
  lastAppliedGain: number;
  lastAppliedPan: number;
  lastPostFaderScale: number;
}

function resolveAudioContextConstructor(): (new () => AudioContext) | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function sampleAnalyserRms(
  analyser: AnalyserNode | null,
  floatScratch: Float32Array,
  byteScratch: Uint8Array,
): number {
  if (!analyser) return 0;

  try {
    if (typeof analyser.getFloatTimeDomainData === 'function') {
      const binLen = analyser.fftSize || floatScratch.length;
      const buf =
        floatScratch.length === binLen ? floatScratch : new Float32Array(Math.max(16, binLen));
      analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
      return computeRmsLevelFromFloatSamples(buf);
    }
    if (typeof analyser.getByteTimeDomainData === 'function') {
      const binLen = analyser.fftSize || byteScratch.length;
      const buf =
        byteScratch.length === binLen ? byteScratch : new Uint8Array(Math.max(16, binLen));
      analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
      return computeRmsLevelFromByteSamples(buf);
    }
  } catch {
    // Ignore transient analyser read errors in headless or closing contexts
  }
  return 0;
}

/**
 * Manages the Web Audio API routing graph and hidden `<audio>` element bridges
 * for both local microphone VAD and remote peer 3D spatial voice streams.
 *
 * Route per remote peer:
 *   `MediaStreamAudioSourceNode -> GainNode -> StereoPannerNode -> AnalyserNode -> masterGain -> destination`
 * Plus a hidden `<audio>` element (`srcObject = stream`) so Chromium pulls WebRTC RTP media packets reliably
 * (muted while Web Audio output is active to avoid duplicate dry audio, or unmuted as a direct audio fallback).
 */
export class VoiceAudioGraph {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private localStream: MediaStream | null = null;
  private localSourceNode: MediaStreamAudioSourceNode | null = null;
  private localAnalyserNode: AnalyserNode | null = null;
  private localFloatScratch = new Float32Array(ANALYSER_FFT_SIZE);
  private localByteScratch = new Uint8Array(ANALYSER_FFT_SIZE);

  private remotePipelines = new Map<string, RemotePeerAudioNodes>();
  private hiddenAudioContainer: HTMLElement | null = null;
  private unlockCleanup: (() => void) | null = null;
  private disposed = false;

  constructor() {
    this.installUnlockListeners();
  }

  private installUnlockListeners(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }

    const onUserGesture = (): void => {
      this.resumeAudio();
    };

    window.addEventListener('pointerdown', onUserGesture, { passive: true });
    window.addEventListener('keydown', onUserGesture, { passive: true });
    this.unlockCleanup = () => {
      window.removeEventListener('pointerdown', onUserGesture);
      window.removeEventListener('keydown', onUserGesture);
      this.unlockCleanup = null;
    };
  }

  ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;

    const AudioCtx = resolveAudioContextConstructor();
    if (!AudioCtx) return null;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      if (typeof ctx.createGain === 'function' && ctx.destination) {
        const master = ctx.createGain();
        master.gain.value = 1.0;
        master.connect(ctx.destination);
        this.masterGain = master;
      }

      return ctx;
    } catch {
      this.ctx = null;
      this.masterGain = null;
      return null;
    }
  }

  resumeAudio(): void {
    if (this.disposed) return;
    const ctx = this.ctx;
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx
        .resume()
        .then(() => {
          if (this.disposed) return;
          for (const p of this.remotePipelines.values()) {
            this.syncFallbackAudioElementMode(p);
          }
        })
        .catch(() => {});
    }

    for (const pipeline of this.remotePipelines.values()) {
      if (pipeline.audioElement && typeof pipeline.audioElement.play === 'function') {
        const playPromise = pipeline.audioElement.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      }
      this.syncFallbackAudioElementMode(pipeline);
    }
  }

  /**
   * Attaches local microphone `MediaStream` to an isolated `AnalyserNode` for real-time RMS VAD.
   * Never connects to `ctx.destination` so the player never hears self-echo feedback.
   */
  attachLocalStream(stream: MediaStream): void {
    if (this.disposed) return;
    if (this.localStream === stream && this.localAnalyserNode) return;

    this.detachLocalStream();
    this.localStream = stream;

    const ctx = this.ensureContext();
    if (!ctx || typeof ctx.createMediaStreamSource !== 'function' || typeof ctx.createAnalyser !== 'function') {
      return;
    }

    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      source.connect(analyser);

      this.localSourceNode = source;
      this.localAnalyserNode = analyser;
      this.localFloatScratch = new Float32Array(analyser.fftSize || ANALYSER_FFT_SIZE);
      this.localByteScratch = new Uint8Array(analyser.fftSize || ANALYSER_FFT_SIZE);
      this.resumeAudio();
    } catch {
      this.detachLocalStream();
      this.localStream = stream;
    }
  }

  detachLocalStream(): void {
    try {
      this.localSourceNode?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    try {
      this.localAnalyserNode?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.localSourceNode = null;
    this.localAnalyserNode = null;
    this.localStream = null;
  }

  sampleLocalVoiceLevel(): number {
    if (!this.localAnalyserNode) return 0;
    const rms = sampleAnalyserRms(
      this.localAnalyserNode,
      this.localFloatScratch,
      this.localByteScratch,
    );
    return rmsToNormalizedVoiceLevel(rms, 1);
  }

  /**
   * Attaches or replaces a remote peer's incoming WebRTC `MediaStream`, routing it through
   * `GainNode -> StereoPannerNode -> AnalyserNode -> destination` plus hidden `<audio>` element bridge.
   */
  attachRemoteStream(
    peerId: string,
    stream: MediaStream,
    initialGain = 1,
    initialPan = 0,
  ): void {
    if (this.disposed) return;

    const existing = this.remotePipelines.get(peerId);
    if (existing && existing.stream === stream) {
      this.applyPeerGainAndPan(peerId, initialGain, initialPan, initialGain);
      return;
    }

    if (existing) {
      this.detachRemoteStream(peerId);
    }

    const clampedGain = clamp(Number.isFinite(initialGain) ? initialGain : 1, 0, 2);
    const clampedPan = clamp(Number.isFinite(initialPan) ? initialPan : 0, -1, 1);

    const audioElement = this.createHiddenAudioElement(peerId, stream);
    const ctx = this.ensureContext();

    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let gainNode: GainNode | null = null;
    let pannerNode: StereoPannerNode | null = null;
    let analyserNode: AnalyserNode | null = null;
    let usingWebAudio = false;

    if (
      ctx &&
      typeof ctx.createMediaStreamSource === 'function' &&
      typeof ctx.createGain === 'function'
    ) {
      try {
        sourceNode = ctx.createMediaStreamSource(stream);
        gainNode = ctx.createGain();
        gainNode.gain.value = clampedGain;

        let tailNode: AudioNode = gainNode;
        sourceNode.connect(gainNode);

        if (typeof ctx.createStereoPanner === 'function') {
          pannerNode = ctx.createStereoPanner();
          pannerNode.pan.value = clampedPan;
          tailNode.connect(pannerNode);
          tailNode = pannerNode;
        }

        if (typeof ctx.createAnalyser === 'function') {
          analyserNode = ctx.createAnalyser();
          analyserNode.fftSize = ANALYSER_FFT_SIZE;
          analyserNode.smoothingTimeConstant = ANALYSER_SMOOTHING;
          tailNode.connect(analyserNode);
          tailNode = analyserNode;
        }

        const sink = this.masterGain ?? ctx.destination;
        if (sink) {
          tailNode.connect(sink);
          usingWebAudio = true;
        }
      } catch {
        try {
          sourceNode?.disconnect();
          gainNode?.disconnect();
          pannerNode?.disconnect();
          analyserNode?.disconnect();
        } catch {
          // Ignore partial cleanup failure
        }
        sourceNode = null;
        gainNode = null;
        pannerNode = null;
        analyserNode = null;
        usingWebAudio = false;
      }
    }

    const fftLen = analyserNode?.fftSize || ANALYSER_FFT_SIZE;
    const pipeline: RemotePeerAudioNodes = {
      peerId,
      stream,
      sourceNode,
      gainNode,
      pannerNode,
      analyserNode,
      floatScratch: new Float32Array(fftLen),
      byteScratch: new Uint8Array(fftLen),
      audioElement,
      usingWebAudio,
      lastAppliedGain: clampedGain,
      lastAppliedPan: clampedPan,
      lastPostFaderScale: clampedGain,
    };

    this.remotePipelines.set(peerId, pipeline);
    this.syncFallbackAudioElementMode(pipeline);
    this.resumeAudio();
  }

  private createHiddenAudioElement(peerId: string, stream: MediaStream): HTMLAudioElement | null {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }

    try {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audio.dataset.netVoicePeer = peerId;
      audio.style.display = 'none';
      audio.style.width = '0';
      audio.style.height = '0';
      audio.style.pointerEvents = 'none';

      try {
        audio.srcObject = stream;
      } catch {
        // Headless DOM mocks may not implement MediaStream assignment on srcObject
      }

      const container = this.ensureHiddenAudioContainer();
      container?.appendChild(audio);

      if (typeof audio.play === 'function') {
        const playRes = audio.play();
        if (playRes && typeof playRes.catch === 'function') {
          playRes.catch(() => {});
        }
      }

      return audio;
    } catch {
      return null;
    }
  }

  private ensureHiddenAudioContainer(): HTMLElement | null {
    if (this.hiddenAudioContainer) return this.hiddenAudioContainer;
    if (
      typeof document === 'undefined' ||
      !document.body ||
      typeof document.createElement !== 'function'
    ) {
      return null;
    }

    const el = document.createElement('div');
    el.dataset.netVoiceAudioBridge = 'true';
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'fixed';
    el.style.width = '0';
    el.style.height = '0';
    el.style.overflow = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    document.body.appendChild(el);
    this.hiddenAudioContainer = el;
    return el;
  }

  private syncFallbackAudioElementMode(pipeline: RemotePeerAudioNodes): void {
    const audio = pipeline.audioElement;
    if (!audio) return;

    const webAudioRunning =
      pipeline.usingWebAudio && (!this.ctx || this.ctx.state !== 'suspended');

    if (webAudioRunning) {
      // Keep element muted so Chromium pulls WebRTC RTP audio into MediaStreamAudioSourceNode
      // without outputting duplicate un-spatialized audio.
      audio.muted = true;
      audio.volume = 0;
    } else {
      // Fallback when AudioContext is unavailable or still suspended by autoplay policy:
      // play directly through <audio> element scaled to 0..1 HTMLMediaElement range.
      const fallbackVol = clamp(pipeline.lastAppliedGain, 0, 1);
      audio.muted = fallbackVol <= 0.0001;
      audio.volume = fallbackVol;
    }
  }

  applyPeerGainAndPan(
    peerId: string,
    effectiveGain: number,
    pan: number,
    postFaderScaleForVad = effectiveGain,
  ): void {
    const pipeline = this.remotePipelines.get(peerId);
    if (!pipeline) return;

    const clampedGain = clamp(Number.isFinite(effectiveGain) ? effectiveGain : 0, 0, 2);
    const clampedPan = clamp(Number.isFinite(pan) ? pan : 0, -1, 1);

    pipeline.lastAppliedGain = clampedGain;
    pipeline.lastAppliedPan = clampedPan;
    pipeline.lastPostFaderScale = Math.max(0, postFaderScaleForVad);

    if (pipeline.gainNode) {
      pipeline.gainNode.gain.value = clampedGain;
    }
    if (pipeline.pannerNode) {
      pipeline.pannerNode.pan.value = clampedPan;
    }

    this.syncFallbackAudioElementMode(pipeline);
  }

  sampleRemoteVoiceLevel(peerId: string): number {
    const pipeline = this.remotePipelines.get(peerId);
    if (!pipeline || !pipeline.analyserNode) return 0;
    if (pipeline.lastAppliedGain <= 0.0001) return 0;

    const rms = sampleAnalyserRms(
      pipeline.analyserNode,
      pipeline.floatScratch,
      pipeline.byteScratch,
    );
    // Because AnalyserNode sits after GainNode -> StereoPannerNode, compensate gently for
    // spatial proximity attenuation so distant speaking teammates still show accurate VAD levels.
    const gainRef = clamp(pipeline.lastPostFaderScale, 0.22, 2.0);
    return rmsToNormalizedVoiceLevel(rms, 1 / gainRef);
  }

  hasRemotePipeline(peerId: string): boolean {
    return this.remotePipelines.has(peerId);
  }

  /**
   * Exposed read-only snapshot of applied Web Audio parameters for diagnostics & unit testing.
   */
  getPeerAudioDiagnostics(peerId: string): {
    hasPipeline: boolean;
    usingWebAudio: boolean;
    gain: number;
    pan: number;
  } {
    const p = this.remotePipelines.get(peerId);
    if (!p) {
      return { hasPipeline: false, usingWebAudio: false, gain: 0, pan: 0 };
    }
    return {
      hasPipeline: true,
      usingWebAudio: p.usingWebAudio,
      gain: p.gainNode ? p.gainNode.gain.value : p.lastAppliedGain,
      pan: p.pannerNode ? p.pannerNode.pan.value : p.lastAppliedPan,
    };
  }

  detachRemoteStream(peerId: string): void {
    const pipeline = this.remotePipelines.get(peerId);
    if (!pipeline) return;
    this.remotePipelines.delete(peerId);

    try {
      pipeline.sourceNode?.disconnect();
    } catch {
      // Ignore
    }
    try {
      pipeline.gainNode?.disconnect();
    } catch {
      // Ignore
    }
    try {
      pipeline.pannerNode?.disconnect();
    } catch {
      // Ignore
    }
    try {
      pipeline.analyserNode?.disconnect();
    } catch {
      // Ignore
    }

    if (pipeline.audioElement) {
      try {
        pipeline.audioElement.pause?.();
        pipeline.audioElement.srcObject = null;
        pipeline.audioElement.remove();
      } catch {
        // Ignore DOM cleanup errors
      }
    }
  }

  detachAllRemoteStreams(): void {
    for (const peerId of Array.from(this.remotePipelines.keys())) {
      this.detachRemoteStream(peerId);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unlockCleanup?.();
    this.detachLocalStream();
    this.detachAllRemoteStreams();

    if (this.hiddenAudioContainer) {
      try {
        this.hiddenAudioContainer.remove();
      } catch {
        // Ignore
      }
      this.hiddenAudioContainer = null;
    }

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // Ignore
      }
      this.masterGain = null;
    }

    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      if (typeof ctx.close === 'function' && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    }
  }
}
