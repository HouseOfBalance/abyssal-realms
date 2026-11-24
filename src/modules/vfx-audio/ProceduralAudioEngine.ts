import type {
  ElementalReactionType,
  EmojiReactionId,
  EquipSlot,
  GroundLootDrop,
  HeroClassId,
  ItemRarity,
  MusicMood,
  RuneId,
  SfxId,
  SocialEmoteId,
  TacticalPingType,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import { clamp } from '../../core/Constants';

interface SustainedLayerHandle {
  stopAndDisconnect(): void;
}

interface MoodChannel {
  mood: MusicMood;
  gainNode: GainNode;
  weight: number;
  sustained: SustainedLayerHandle | null;
}

const ALL_MOODS: readonly MusicMood[] = [
  'title',
  'sanctuary',
  'explore',
  'combat',
  'invasion',
  'boss',
  'victory',
  'defeat',
];

const PICKUP_COMBO_SEMITONES = [0, 2, 4, 7, 9, 11, 12, 14, 16, 19, 21, 24] as const;
const PICKUP_COMBO_WINDOW_SEC = 1.2;

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const TITLE_CHIME_NOTES = [62, 69, 74, 76, 77, 74, 69, 65];
// Peaceful D-Major / D-Lydian acoustic harp & lute fingerpicking pattern for Sanctuary Hub
const SANCTUARY_LUTE_NOTES = [62, 69, 74, 78, 76, 69, 71, 74, 67, 74, 78, 81, 76, 74, 69, 66];
const SANCTUARY_BASS_NOTES = [50, 47, 43, 45]; // D3 -> B2 -> G2 -> A2
const EXPLORE_ARP_NOTES = [50, 57, 58, 53, 52, 57, 48, 55, 50, 62, 58, 57, 53, 50, 45, 49];
const COMBAT_BASS_NOTES = [38, 38, 38, 41, 38, 38, 43, 41, 38, 38, 44, 43, 41, 39, 38, 36];
const COMBAT_PULSE_NOTES = [50, 53, 57, 50, 55, 53, 50, 49, 50, 53, 58, 57, 55, 53, 52, 49];
// Frantic tritone/chromatic Butcher & Goblin chase motif
const INVASION_BASS_NOTES = [38, 39, 38, 44, 38, 39, 43, 41, 38, 39, 44, 46, 44, 43, 39, 37];
const INVASION_STAB_NOTES = [62, 63, 68, 67, 62, 65, 68, 71, 62, 63, 68, 70, 68, 67, 63, 61];
const BOSS_OSTINATO_NOTES = [50, 53, 57, 58, 61, 57, 55, 53, 52, 55, 58, 61, 62, 65, 64, 61];
const BOSS_BASS_BAR_ROOTS = [38, 34, 31, 33];

const RUNE_MIDI_OFFSETS: Record<RuneId, number> = {
  sol: 0,
  ist: 2,
  mal: 3,
  gul: 5,
  vex: 7,
  ohm: 9,
  sur: 10,
  lo: 12,
  cham: 14,
  jah: 16,
  ber: 19,
  zod: 24,
};

export class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private reverbConvolver: ConvolverNode | null = null;
  private reverbReturnGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private masterVolume = 0.8;
  private musicVolume = 0.55;
  private sfxVolume = 0.85;

  private targetMood: MusicMood | null = null;
  private pendingStingerMood: MusicMood | null = null;
  private moodChannels = new Map<MusicMood, MoodChannel>();

  private listenerPos: Vec3 = { x: 0, y: 0, z: 0 };
  private sfxLastPlayedMs = new Map<SfxId, number>();
  private activeSfxVoices = 0;
  private readonly maxSfxVoices = 32;

  private pickupComboStep = 0;
  private pickupComboTimerSec = 0;
  private hasActivePickupCombo = false;
  private lastComboWallMs = -9999;
  private dropIdToComboStep = new Map<string, number>();

  private stepIndex = 0;
  private nextStepTime = 0;
  private rngState = 0x1234abcd;
  private disposed = false;
  private gestureCleanup: (() => void) | null = null;

  constructor() {
    this.installPassiveUnlockListeners();
  }

  private installPassiveUnlockListeners(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    const onGesture = (): void => {
      this.unlockAudio();
    };
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture, { passive: true });
    this.gestureCleanup = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      this.gestureCleanup = null;
    };
  }

  private rand(): number {
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private range(min: number, max: number): number {
    return min + this.rand() * (max - min);
  }

  private nowWallMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  getPickupComboStep(): number {
    return this.pickupComboStep;
  }

  private advancePickupCombo(): number {
    const nowMs = this.nowWallMs();
    const withinSimWindow = this.hasActivePickupCombo && this.pickupComboTimerSec > 0;
    const withinWallWindow =
      !this.hasActivePickupCombo &&
      this.lastComboWallMs > 0 &&
      nowMs - this.lastComboWallMs <= PICKUP_COMBO_WINDOW_SEC * 1000;

    if (withinSimWindow || withinWallWindow) {
      this.pickupComboStep = Math.min(
        PICKUP_COMBO_SEMITONES.length - 1,
        this.pickupComboStep + 1,
      );
    } else {
      this.pickupComboStep = 0;
    }

    this.hasActivePickupCombo = true;
    this.pickupComboTimerSec = PICKUP_COMBO_WINDOW_SEC;
    this.lastComboWallMs = nowMs;
    return this.pickupComboStep;
  }

  private resolveDropComboStep(dropId: string | undefined, isArrival: boolean): number {
    if (dropId && isArrival && this.dropIdToComboStep.has(dropId)) {
      const existing = this.dropIdToComboStep.get(dropId)!;
      this.dropIdToComboStep.delete(dropId);
      this.pickupComboTimerSec = PICKUP_COMBO_WINDOW_SEC;
      this.lastComboWallMs = this.nowWallMs();
      return existing;
    }

    const step = this.advancePickupCombo();
    if (dropId && !isArrival) {
      if (this.dropIdToComboStep.size >= 32) {
        const oldestKey = this.dropIdToComboStep.keys().next().value;
        if (oldestKey !== undefined) {
          this.dropIdToComboStep.delete(oldestKey);
        }
      }
      this.dropIdToComboStep.set(dropId, step);
    }
    return step;
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;

    const g = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioCtx = g.AudioContext ?? g.webkitAudioContext;
    if (typeof AudioCtx !== 'function') {
      return null;
    }

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 14;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      compressor.connect(ctx.destination);

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(compressor);

      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.masterGain);

      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.masterGain);

      this.noiseBuffer = this.buildNoiseBuffer(ctx, 2.0);
      this.reverbConvolver = ctx.createConvolver();
      this.reverbConvolver.buffer = this.buildCathedralImpulse(ctx, 1.75, 2.8);
      this.reverbReturnGain = ctx.createGain();
      this.reverbReturnGain.gain.value = 0.34;
      this.reverbConvolver.connect(this.reverbReturnGain);
      this.reverbReturnGain.connect(this.masterGain);

      for (const mood of ALL_MOODS) {
        const gNode = ctx.createGain();
        gNode.gain.value = 0;
        gNode.connect(this.musicGain);
        this.moodChannels.set(mood, {
          mood,
          gainNode: gNode,
          weight: 0,
          sustained: null,
        });
      }

      this.nextStepTime = ctx.currentTime + 0.05;
      return ctx;
    } catch {
      this.ctx = null;
      return null;
    }
  }

  private buildNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = this.rand() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      const pink = (b0 + b1 + b2 + white * 0.1848) * 0.16;
      data[i] = clamp(white * 0.58 + pink * 0.42, -1, 1);
    }
    return buffer;
  }

  private buildCathedralImpulse(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, decay) * Math.min(1, i / (ctx.sampleRate * 0.012));
        const white = this.rand() * 2 - 1;
        const damp = 0.28 + (1 - t) * 0.45;
        lp += damp * (white - lp);
        data[i] = lp * env * 0.65;
      }
    }
    return buffer;
  }

  unlockAudio(): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => {
          if (this.disposed) return;
          this.gestureCleanup?.();
          this.flushPendingMusicStart();
        })
        .catch(() => {});
    } else if (ctx.state === 'running') {
      this.gestureCleanup?.();
      this.flushPendingMusicStart();
    }
  }

  private flushPendingMusicStart(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.targetMood) {
      const ch = this.moodChannels.get(this.targetMood);
      if (ch && !ch.sustained) {
        ch.sustained = this.createSustainedLayerForMood(this.ctx, this.targetMood, ch.gainNode);
      }
    }
    if (this.pendingStingerMood) {
      const m = this.pendingStingerMood;
      this.pendingStingerMood = null;
      this.playMoodStinger(m);
    }
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.masterVolume = clamp(Number.isFinite(master) ? master : 0.8, 0, 1);
    this.musicVolume = clamp(Number.isFinite(music) ? music : 0.55, 0, 1);
    this.sfxVolume = clamp(Number.isFinite(sfx) ? sfx : 0.85, 0, 1);

    if (this.ctx && this.masterGain && this.musicGain && this.sfxGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(this.masterVolume, now, 0.04);
      this.musicGain.gain.setTargetAtTime(this.musicVolume, now, 0.04);
      this.sfxGain.gain.setTargetAtTime(this.sfxVolume, now, 0.04);
    }
  }

  setMusicMood(mood: MusicMood): void {
    if (this.disposed) return;
    if (this.targetMood === mood) return;
    this.targetMood = mood;

    const ctx = this.ensureContext();
    if (!ctx) return;

    if (mood === 'victory' || mood === 'defeat') {
      if (ctx.state === 'running') {
        this.pendingStingerMood = null;
        this.playMoodStinger(mood);
      } else {
        this.pendingStingerMood = mood;
      }
    } else {
      this.pendingStingerMood = null;
    }

    if (ctx.state === 'running') {
      const ch = this.moodChannels.get(mood);
      if (ch && !ch.sustained) {
        ch.sustained = this.createSustainedLayerForMood(ctx, mood, ch.gainNode);
      }
    }
  }

  private createSustainedLayerForMood(
    ctx: AudioContext,
    mood: MusicMood,
    dest: GainNode,
  ): SustainedLayerHandle {
    const oscs: OscillatorNode[] = [];
    const nodes: AudioNode[] = [];
    const now = ctx.currentTime;

    const subMix = ctx.createGain();
    subMix.gain.value = 1.0;
    subMix.connect(dest);
    nodes.push(subMix);

    if (this.reverbConvolver) {
      const wet = ctx.createGain();
      wet.gain.value =
        mood === 'sanctuary' ? 0.72 : mood === 'title' || mood === 'victory' ? 0.65 : 0.38;
      subMix.connect(wet);
      wet.connect(this.reverbConvolver);
      nodes.push(wet);
    }

    const addDroneVoice = (
      freq: number,
      type: OscillatorType,
      gainVal: number,
      cutoffHz: number,
      qVal = 1.2,
      lfoRateHz = 0.14,
      lfoDepthHz = 45,
    ): void => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoffHz, now);
      filter.Q.setValueAtTime(qVal, now);

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(lfoRateHz, now);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(lfoDepthHz, now);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      const vGain = ctx.createGain();
      vGain.gain.setValueAtTime(gainVal, now);

      osc.connect(filter);
      filter.connect(vGain);
      vGain.connect(subMix);

      osc.start(now);
      lfo.start(now);
      oscs.push(osc, lfo);
      nodes.push(filter, lfoGain, vGain);
    };

    switch (mood) {
      case 'title': {
        addDroneVoice(midiToFreq(38), 'sawtooth', 0.11, 310, 1.5, 0.11, 60);
        addDroneVoice(midiToFreq(45) * 1.003, 'sawtooth', 0.085, 620, 3.2, 0.17, 120);
        addDroneVoice(midiToFreq(50) * 0.997, 'triangle', 0.1, 880, 2.5, 0.13, 95);
        addDroneVoice(midiToFreq(53), 'sawtooth', 0.065, 980, 4.0, 0.21, 140);
        addDroneVoice(midiToFreq(64), 'sine', 0.045, 1400, 1.0, 0.09, 50);
        break;
      }
      case 'sanctuary': {
        // Warm peaceful D-Add9 Sanctuary Hearth Pad (D2 + A2 + F#3 + A3 + E4)
        addDroneVoice(midiToFreq(38), 'sine', 0.12, 340, 1.0, 0.09, 35);
        addDroneVoice(midiToFreq(45), 'triangle', 0.09, 540, 1.2, 0.11, 50);
        addDroneVoice(midiToFreq(54) * 1.002, 'triangle', 0.075, 760, 1.4, 0.14, 65);
        addDroneVoice(midiToFreq(57) * 0.998, 'sine', 0.07, 980, 1.1, 0.12, 45);
        addDroneVoice(midiToFreq(64), 'sine', 0.045, 1300, 1.0, 0.08, 40);
        break;
      }
      case 'explore': {
        addDroneVoice(midiToFreq(38), 'sawtooth', 0.13, 210, 2.0, 0.08, 55);
        addDroneVoice(midiToFreq(38) * 1.005, 'triangle', 0.11, 260, 1.4, 0.12, 40);
        addDroneVoice(midiToFreq(45), 'sawtooth', 0.065, 340, 2.4, 0.07, 70);
        break;
      }
      case 'combat': {
        addDroneVoice(midiToFreq(38), 'sawtooth', 0.085, 280, 1.8, 0.28, 80);
        addDroneVoice(midiToFreq(44), 'triangle', 0.035, 420, 2.2, 0.33, 90);
        break;
      }
      case 'invasion': {
        // Dread tritone D2 + G#2 pulsing chase tension bed
        addDroneVoice(midiToFreq(38), 'sawtooth', 0.11, 360, 2.4, 0.48, 120);
        addDroneVoice(midiToFreq(44) * 1.004, 'sawtooth', 0.075, 620, 3.2, 0.55, 160);
        addDroneVoice(midiToFreq(26), 'sine', 0.13, 130, 1.0, 0.35, 25);
        break;
      }
      case 'boss': {
        addDroneVoice(midiToFreq(26), 'sine', 0.14, 140, 1.0, 0.19, 20);
        addDroneVoice(midiToFreq(38) * 0.996, 'sawtooth', 0.095, 520, 3.0, 0.24, 150);
        addDroneVoice(midiToFreq(53) * 1.004, 'sawtooth', 0.06, 860, 3.6, 0.31, 180);
        break;
      }
      case 'victory': {
        addDroneVoice(midiToFreq(50), 'triangle', 0.11, 650, 1.2, 0.12, 60);
        addDroneVoice(midiToFreq(57), 'sawtooth', 0.065, 820, 1.8, 0.15, 80);
        addDroneVoice(midiToFreq(66), 'sine', 0.07, 1400, 1.0, 0.18, 50);
        break;
      }
      case 'defeat': {
        addDroneVoice(midiToFreq(38), 'triangle', 0.12, 190, 1.2, 0.06, 25);
        addDroneVoice(midiToFreq(46), 'sine', 0.05, 280, 1.0, 0.08, 20);
        break;
      }
    }

    let stopped = false;
    return {
      stopAndDisconnect(): void {
        if (stopped) return;
        stopped = true;
        for (const osc of oscs) {
          try {
            osc.stop();
          } catch {}
          try {
            osc.disconnect();
          } catch {}
        }
        for (const node of nodes) {
          try {
            node.disconnect();
          } catch {}
        }
      },
    };
  }

  private playMoodStinger(mood: MusicMood): void {
    if (!this.ctx || !this.musicGain || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.02;

    if (mood === 'victory') {
      const notes = [62, 66, 69, 74, 78, 81];
      for (let i = 0; i < notes.length; i++) {
        const t = now + i * 0.13;
        const dur = i === notes.length - 1 ? 1.8 : 0.48;
        this.scheduleMusicalVoice(
          ctx,
          this.musicGain,
          midiToFreq(notes[i]),
          'sawtooth',
          t,
          dur,
          0.16,
          1900,
          0.55,
        );
        this.scheduleMusicalVoice(
          ctx,
          this.musicGain,
          midiToFreq(notes[i] - 12),
          'triangle',
          t,
          dur * 1.1,
          0.12,
          950,
          0.4,
        );
      }
    } else if (mood === 'defeat') {
      const notes = [57, 53, 51, 50];
      for (let i = 0; i < notes.length; i++) {
        const t = now + i * 0.36;
        const dur = i === notes.length - 1 ? 2.4 : 0.75;
        this.scheduleMusicalVoice(
          ctx,
          this.musicGain,
          midiToFreq(notes[i]),
          'triangle',
          t,
          dur,
          0.18,
          680,
          0.65,
        );
      }
      this.scheduleMusicalVoice(
        ctx,
        this.musicGain,
        midiToFreq(38),
        'sine',
        now,
        2.8,
        0.24,
        500,
        0.7,
      );
      this.scheduleMusicalVoice(
        ctx,
        this.musicGain,
        midiToFreq(38) * 2.41,
        'sine',
        now,
        1.6,
        0.07,
        1200,
        0.65,
      );
    }
  }

  private scheduleMusicalVoice(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    type: OscillatorType,
    startTime: number,
    duration: number,
    peakGain: number,
    cutoffHz: number,
    reverbSend = 0.25,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, startTime);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(120, cutoffHz * 0.32),
      startTime + duration,
    );

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.025, duration * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(filter);
    filter.connect(env);
    env.connect(dest);

    let wet: GainNode | null = null;
    if (this.reverbConvolver && reverbSend > 0.01) {
      wet = ctx.createGain();
      wet.gain.value = reverbSend;
      env.connect(wet);
      wet.connect(this.reverbConvolver);
    }

    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      env.disconnect();
      wet?.disconnect();
    };
  }

  private scheduleWarDrum(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    heavy: boolean,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(heavy ? 128 : 96, startTime);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 36 : 44, startTime + 0.14);

    const env = ctx.createGain();
    const amp = heavy ? 0.34 : 0.2;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(amp, startTime + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + (heavy ? 0.24 : 0.15));

    osc.connect(env);
    env.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.26);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }

  private schedulePercussionTick(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    metallic: boolean,
  ): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = metallic ? 'bandpass' : 'highpass';
    filter.frequency.setValueAtTime(metallic ? 2400 : 4800, startTime);
    filter.Q.setValueAtTime(metallic ? 4.5 : 0.9, startTime);

    const dur = metallic ? 0.09 : 0.045;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(metallic ? 0.13 : 0.055, startTime + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    src.connect(filter);
    filter.connect(env);
    env.connect(dest);

    const offset = this.range(0, 1.2);
    src.start(startTime, offset, dur + 0.02);
    src.stop(startTime + dur + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }

  private scheduleSequencerStep(ctx: AudioContext, step: number, time: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);

    const titleCh = this.moodChannels.get('title');
    if (
      titleCh &&
      titleCh.weight > 0.02 &&
      s16 % 4 === 0 &&
      (step % 8 === 0 || this.rand() < 0.45)
    ) {
      const note = TITLE_CHIME_NOTES[(bar * 2 + (s16 >> 2)) % TITLE_CHIME_NOTES.length];
      this.scheduleMusicalVoice(
        ctx,
        titleCh.gainNode,
        midiToFreq(note),
        'sine',
        time,
        1.1,
        0.085,
        2200,
        0.65,
      );
    }

    // Sanctuary peaceful acoustic harp/lute fingerpicking + warm bass root
    const sanctuaryCh = this.moodChannels.get('sanctuary');
    if (sanctuaryCh && sanctuaryCh.weight > 0.02) {
      if (s16 % 2 === 0) {
        const luteIdx = (s16 >> 1) + (bar % 2) * 8;
        const luteMidi = SANCTUARY_LUTE_NOTES[luteIdx % SANCTUARY_LUTE_NOTES.length];
        // Plucked acoustic lute body (triangle + crisp overtone shimmer)
        this.scheduleMusicalVoice(
          ctx,
          sanctuaryCh.gainNode,
          midiToFreq(luteMidi),
          'triangle',
          time,
          0.68,
          0.11,
          1650,
          0.62,
        );
        if (s16 % 4 === 0) {
          this.scheduleMusicalVoice(
            ctx,
            sanctuaryCh.gainNode,
            midiToFreq(luteMidi + 12),
            'sine',
            time + 0.015,
            0.85,
            0.045,
            2600,
            0.7,
          );
        }
      }
      if (s16 === 0) {
        const bassMidi = SANCTUARY_BASS_NOTES[bar % SANCTUARY_BASS_NOTES.length];
        this.scheduleMusicalVoice(
          ctx,
          sanctuaryCh.gainNode,
          midiToFreq(bassMidi),
          'sine',
          time,
          1.4,
          0.12,
          520,
          0.5,
        );
      }
    }

    const exploreCh = this.moodChannels.get('explore');
    if (exploreCh && exploreCh.weight > 0.02 && s16 % 2 === 0) {
      const idx = (s16 >> 1) + (bar % 2) * 8;
      const note = EXPLORE_ARP_NOTES[idx % EXPLORE_ARP_NOTES.length];
      this.scheduleMusicalVoice(
        ctx,
        exploreCh.gainNode,
        midiToFreq(note),
        'triangle',
        time,
        0.44,
        0.095,
        920,
        0.48,
      );
    }

    const combatCh = this.moodChannels.get('combat');
    if (combatCh && combatCh.weight > 0.02) {
      if (s16 === 0 || s16 === 6 || s16 === 8 || s16 === 14) {
        this.scheduleWarDrum(ctx, combatCh.gainNode, time, s16 === 0 || s16 === 8);
      }
      if (s16 === 4 || s16 === 12) {
        this.schedulePercussionTick(ctx, combatCh.gainNode, time, true);
      } else if (s16 % 2 === 1) {
        this.schedulePercussionTick(ctx, combatCh.gainNode, time, false);
      }

      const bassMidi = COMBAT_BASS_NOTES[s16];
      this.scheduleMusicalVoice(
        ctx,
        combatCh.gainNode,
        midiToFreq(bassMidi),
        'sawtooth',
        time,
        0.16,
        0.14,
        460,
        0.08,
      );

      if (s16 % 2 === 0) {
        const pulseMidi = COMBAT_PULSE_NOTES[s16];
        this.scheduleMusicalVoice(
          ctx,
          combatCh.gainNode,
          midiToFreq(pulseMidi),
          'sawtooth',
          time,
          0.14,
          0.075,
          1150,
          0.18,
        );
      }
    }

    // Invasion frantic Butcher / Goblin chase percussion, rattling chains & tritone stabs
    const invasionCh = this.moodChannels.get('invasion');
    if (invasionCh && invasionCh.weight > 0.02) {
      if (s16 % 4 === 0 || s16 === 2 || s16 === 7 || s16 === 10 || s16 === 14) {
        this.scheduleWarDrum(ctx, invasionCh.gainNode, time, s16 % 4 === 0);
      }
      if (s16 % 2 === 1) {
        this.schedulePercussionTick(ctx, invasionCh.gainNode, time, s16 % 4 === 3);
      }

      const invBass = INVASION_BASS_NOTES[s16];
      this.scheduleMusicalVoice(
        ctx,
        invasionCh.gainNode,
        midiToFreq(invBass),
        'sawtooth',
        time,
        0.12,
        0.16,
        620,
        0.1,
      );

      const stabMidi = INVASION_STAB_NOTES[s16];
      this.scheduleMusicalVoice(
        ctx,
        invasionCh.gainNode,
        midiToFreq(stabMidi),
        'sawtooth',
        time,
        0.11,
        0.095,
        1800,
        0.22,
      );
    }

    const bossCh = this.moodChannels.get('boss');
    if (bossCh && bossCh.weight > 0.02) {
      if (s16 % 4 === 0 || s16 === 3 || s16 === 11 || s16 === 14) {
        this.scheduleWarDrum(ctx, bossCh.gainNode, time, s16 % 4 === 0);
      }
      if (s16 === 4 || s16 === 12 || s16 === 15) {
        this.schedulePercussionTick(ctx, bossCh.gainNode, time, true);
      }

      const ostMidi = BOSS_OSTINATO_NOTES[s16];
      this.scheduleMusicalVoice(
        ctx,
        bossCh.gainNode,
        midiToFreq(ostMidi + (bar % 4 === 3 ? 2 : 0)),
        'sawtooth',
        time,
        0.13,
        0.105,
        1650,
        0.24,
      );

      if (s16 % 2 === 0) {
        const rootMidi = BOSS_BASS_BAR_ROOTS[bar % BOSS_BASS_BAR_ROOTS.length];
        this.scheduleMusicalVoice(
          ctx,
          bossCh.gainNode,
          midiToFreq(rootMidi),
          'sawtooth',
          time,
          0.22,
          0.165,
          560,
          0.15,
        );
      }
    }
  }

  update(dt: number, listenerPos: Vec3): void {
    if (this.disposed) return;

    if (
      Number.isFinite(listenerPos.x) &&
      Number.isFinite(listenerPos.y) &&
      Number.isFinite(listenerPos.z)
    ) {
      this.listenerPos.x = listenerPos.x;
      this.listenerPos.y = listenerPos.y;
      this.listenerPos.z = listenerPos.z;
    }

    const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 2.5);
    if (this.hasActivePickupCombo && safeDt > 0) {
      this.pickupComboTimerSec = Math.max(0, this.pickupComboTimerSec - safeDt);
      if (this.pickupComboTimerSec <= 0) {
        this.hasActivePickupCombo = false;
        this.pickupComboStep = 0;
        this.dropIdToComboStep.clear();
      }
    }

    if (!this.ctx || this.ctx.state !== 'running') return;

    const audioDt = Math.min(safeDt, 0.25);
    const now = this.ctx.currentTime;
    const fadeSpeed = 0.85;

    for (const ch of this.moodChannels.values()) {
      const target = ch.mood === this.targetMood ? 1.0 : 0.0;
      if (ch.weight !== target) {
        if (ch.weight < target) {
          ch.weight = Math.min(target, ch.weight + audioDt * fadeSpeed);
          if (!ch.sustained) {
            ch.sustained = this.createSustainedLayerForMood(this.ctx, ch.mood, ch.gainNode);
          }
        } else {
          ch.weight = Math.max(target, ch.weight - audioDt * fadeSpeed);
          if (ch.weight <= 0.002) {
            ch.weight = 0;
            ch.sustained?.stopAndDisconnect();
            ch.sustained = null;
          }
        }
        ch.gainNode.gain.setTargetAtTime(ch.weight, now, 0.05);
      }
    }

    const bpm =
      this.targetMood === 'invasion'
        ? 152
        : this.targetMood === 'boss'
          ? 140
          : this.targetMood === 'combat'
            ? 126
            : this.targetMood === 'sanctuary'
              ? 84
              : 96;
    const stepDur = 60 / bpm / 4;
    if (this.nextStepTime < now - 0.1) {
      this.nextStepTime = now + 0.01;
    }
    let guard = 0;
    while (this.nextStepTime < now + 0.14 && guard < 8) {
      this.scheduleSequencerStep(this.ctx, this.stepIndex, this.nextStepTime);
      this.nextStepTime += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 1024;
      guard++;
    }
  }

  private createSpatialVoiceChain(
    ctx: AudioContext,
    worldPos?: Vec3,
  ): { outGain: GainNode; tailNode: AudioNode } | null {
    if (!this.sfxGain) return null;
    if (this.activeSfxVoices >= this.maxSfxVoices) return null;

    let attenuation = 1.0;
    let panValue = 0.0;
    if (
      worldPos &&
      Number.isFinite(worldPos.x) &&
      Number.isFinite(worldPos.y) &&
      Number.isFinite(worldPos.z)
    ) {
      const dx = worldPos.x - this.listenerPos.x;
      const dy = (worldPos.y - this.listenerPos.y) * 0.45;
      const dz = worldPos.z - this.listenerPos.z;
      const dist = Math.hypot(dx, dy, dz);
      const refDist = 5.0;
      const maxDist = 36.0;
      if (dist >= maxDist) return null;

      const inv = 1 / (1 + Math.max(0, dist - refDist) * 0.13);
      const edgeFade = 1 - Math.pow(dist / maxDist, 2.4);
      attenuation = clamp(inv * edgeFade, 0, 1);
      if (attenuation <= 0.015) return null;
      panValue = clamp(dx / 15.0, -0.78, 0.78);
    }

    const outGain = ctx.createGain();
    outGain.gain.value = attenuation;

    let tailNode: AudioNode = outGain;
    if (typeof ctx.createStereoPanner === 'function' && Math.abs(panValue) > 0.02) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = panValue;
      outGain.connect(panner);
      tailNode = panner;
    }
    tailNode.connect(this.sfxGain);
    this.activeSfxVoices++;
    return { outGain, tailNode };
  }

  private scheduleChainCleanup(
    ctx: AudioContext,
    outGain: GainNode,
    tailNode: AudioNode,
    now: number,
    totalDuration: number,
  ): void {
    const cleanupTimer = ctx.createConstantSource();
    cleanupTimer.offset.value = 0;
    cleanupTimer.connect(outGain);
    cleanupTimer.start(now);
    cleanupTimer.stop(now + totalDuration + 0.08);
    cleanupTimer.onended = () => {
      this.activeSfxVoices = Math.max(0, this.activeSfxVoices - 1);
      cleanupTimer.disconnect();
      outGain.disconnect();
      if (tailNode !== outGain) {
        tailNode.disconnect();
      }
    };
  }

  // ==========================================================================
  // Phase 2 & Phase 3 Procedural Stingers & Event Synthesizers
  // ==========================================================================

  playPickupLaunchChime(drop: GroundLootDrop, fromPos?: Vec3): number {
    if (this.disposed) return 0;
    const step = this.resolveDropComboStep(drop.id, false);

    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return step;

    const chain = this.createSpatialVoiceChain(ctx, fromPos ?? drop.position);
    if (!chain) return step;

    const now = ctx.currentTime;
    const semitone = PICKUP_COMBO_SEMITONES[step];
    const baseMidi = 74 + semitone;
    const freq = midiToFreq(baseMidi);

    this.synthTone(ctx, chain.outGain, now, 0.2, freq * 0.75, freq * 1.12, 'sine', 0.14, 0.35);
    this.synthFilteredNoise(
      ctx,
      chain.outGain,
      now,
      0.18,
      480,
      1450 + step * 110,
      'bandpass',
      2.6,
      0.14,
      0.25,
    );
    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.24);
    return step;
  }

  playPickupArrivalComboChime(drop: GroundLootDrop, worldPos?: Vec3): number {
    if (this.disposed) return 0;
    const step = this.resolveDropComboStep(drop.id, true);

    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return step;

    const chain = this.createSpatialVoiceChain(ctx, worldPos ?? drop.position);
    if (!chain) return step;

    const now = ctx.currentTime;
    const semitone = PICKUP_COMBO_SEMITONES[step];
    const baseMidi = 74 + semitone;
    const rootFreq = midiToFreq(baseMidi);
    const fifthFreq = midiToFreq(baseMidi + 7);
    const octaveFreq = midiToFreq(baseMidi + 12);

    this.synthTone(ctx, chain.outGain, now, 0.24, rootFreq, rootFreq, 'triangle', 0.18, 0.4);
    this.synthTone(
      ctx,
      chain.outGain,
      now + 0.045,
      0.34,
      fifthFreq,
      fifthFreq,
      'sine',
      0.2,
      0.48,
    );
    if (
      step >= 3 ||
      drop.kind === 'rune' ||
      (drop.kind === 'item' && (drop.item?.isMythic || drop.item?.rarity !== 'common'))
    ) {
      this.synthTone(
        ctx,
        chain.outGain,
        now + 0.085,
        0.42,
        octaveFreq,
        octaveFreq,
        'sine',
        0.15,
        0.58,
      );
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.52);
    return step;
  }

  playGearEquipStinger(
    weaponVisual: WeaponVisualType,
    rarity: ItemRarity | undefined,
    _slot: EquipSlot | 'all',
    isMythic?: boolean,
    worldPos?: Vec3,
  ): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    this.synthTone(ctx, chain.outGain, now, 0.12, 175, 62, 'triangle', 0.3, 0.2);

    switch (weaponVisual) {
      case 'daggers': {
        this.synthTone(ctx, chain.outGain, now + 0.02, 0.2, 2217, 2960, 'sine', 0.16, 0.35);
        this.synthTone(ctx, chain.outGain, now + 0.065, 0.24, 2637, 3520, 'sine', 0.16, 0.4);
        this.synthFilteredNoise(
          ctx,
          chain.outGain,
          now + 0.02,
          0.1,
          4200,
          2100,
          'bandpass',
          3.5,
          0.16,
        );
        break;
      }
      case 'warhammer': {
        this.synthTone(ctx, chain.outGain, now, 0.38, 96, 44, 'sawtooth', 0.3, 0.35);
        this.synthTone(ctx, chain.outGain, now + 0.015, 0.42, 587.3, 582, 'triangle', 0.22, 0.48);
        this.synthTone(ctx, chain.outGain, now + 0.02, 0.35, 1174.7, 1168, 'sine', 0.15, 0.45);
        break;
      }
      case 'staff': {
        this.synthTone(ctx, chain.outGain, now + 0.02, 0.46, 440, 444, 'triangle', 0.2, 0.55);
        this.synthTone(ctx, chain.outGain, now + 0.06, 0.48, 659.25, 662, 'sine', 0.18, 0.6);
        this.synthTone(ctx, chain.outGain, now + 0.1, 0.52, 1318.5, 1324, 'sine', 0.14, 0.65);
        break;
      }
      case 'greatsword':
      case 'sword_shield':
      default: {
        this.synthTone(ctx, chain.outGain, now + 0.02, 0.38, 1568, 1555, 'triangle', 0.19, 0.45);
        this.synthTone(ctx, chain.outGain, now + 0.04, 0.42, 2349.3, 2360, 'sine', 0.15, 0.5);
        this.synthFilteredNoise(
          ctx,
          chain.outGain,
          now + 0.015,
          0.14,
          3400,
          1500,
          'bandpass',
          3.2,
          0.18,
        );
        break;
      }
    }

    if (isMythic || rarity === 'legendary') {
      const chord = isMythic ? [50, 62, 66, 69, 76, 86] : [62, 66, 69, 74];
      for (let i = 0; i < chord.length; i++) {
        this.synthTone(
          ctx,
          chain.outGain,
          now + 0.07 + i * 0.05,
          0.68,
          midiToFreq(chord[i]),
          midiToFreq(chord[i]),
          'triangle',
          0.16,
          0.68,
        );
      }
    } else if (rarity === 'epic' || rarity === 'rare') {
      const chord = rarity === 'epic' ? [62, 69, 74] : [69, 76];
      for (let i = 0; i < chord.length; i++) {
        this.synthTone(
          ctx,
          chain.outGain,
          now + 0.07 + i * 0.05,
          0.45,
          midiToFreq(chord[i]),
          midiToFreq(chord[i]),
          'sine',
          0.15,
          0.52,
        );
      }
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.92);
  }

  playClassSwapStinger(heroClass: HeroClassId, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    if (heroClass === 'vanguard') {
      this.synthTone(
        ctx,
        chain.outGain,
        now,
        0.55,
        midiToFreq(50),
        midiToFreq(50),
        'sawtooth',
        0.24,
        0.5,
      );
      this.synthTone(
        ctx,
        chain.outGain,
        now + 0.05,
        0.58,
        midiToFreq(57),
        midiToFreq(57),
        'sawtooth',
        0.2,
        0.55,
      );
      this.synthTone(
        ctx,
        chain.outGain,
        now + 0.11,
        0.65,
        midiToFreq(62),
        midiToFreq(62),
        'triangle',
        0.22,
        0.6,
      );
      this.synthTone(ctx, chain.outGain, now, 0.2, 135, 48, 'sine', 0.36);
    } else if (heroClass === 'shadowblade') {
      this.synthFilteredNoise(
        ctx,
        chain.outGain,
        now,
        0.22,
        420,
        1650,
        'bandpass',
        2.4,
        0.28,
        0.35,
      );
      const notes = [62, 63, 69, 74];
      for (let i = 0; i < notes.length; i++) {
        this.synthTone(
          ctx,
          chain.outGain,
          now + i * 0.055,
          0.48,
          midiToFreq(notes[i]),
          midiToFreq(notes[i]),
          'triangle',
          0.18,
          0.55,
        );
      }
    } else {
      const notes = [62, 69, 76, 78, 86];
      for (let i = 0; i < notes.length; i++) {
        this.synthTone(
          ctx,
          chain.outGain,
          now + i * 0.06,
          0.68,
          midiToFreq(notes[i]),
          midiToFreq(notes[i]),
          i % 2 === 0 ? 'sine' : 'triangle',
          0.18,
          0.68,
        );
      }
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.98);
  }

  playPortalWarpStinger(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    this.synthTone(ctx, chain.outGain, now, 0.72, 148, 30, 'sine', 0.46, 0.45);
    this.synthTone(ctx, chain.outGain, now + 0.03, 0.78, 196, 784, 'sawtooth', 0.2, 0.65);
    this.synthTone(ctx, chain.outGain, now + 0.08, 0.82, 293.66, 1174.66, 'triangle', 0.18, 0.7);
    this.synthFilteredNoise(
      ctx,
      chain.outGain,
      now,
      0.65,
      260,
      1850,
      'bandpass',
      2.2,
      0.26,
      0.55,
    );

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.95);
  }

  playElementalReactionSfx(reaction: ElementalReactionType, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    let totalDur = 0.68;

    switch (reaction) {
      case 'shatter': {
        totalDur = 0.65;
        this.synthTone(ctx, chain.outGain, now, 0.26, 165, 34, 'sine', 0.44, 0.3);
        this.synthFilteredNoise(ctx, chain.outGain, now, 0.2, 4600, 1600, 'highpass', 1.8, 0.38, 0.4);
        const shards = [2349, 2960, 3729, 4698];
        for (let i = 0; i < shards.length; i++) {
          this.synthTone(
            ctx,
            chain.outGain,
            now + i * 0.025,
            0.38,
            shards[i],
            shards[i] * 0.95,
            'sine',
            0.16,
            0.55,
          );
        }
        break;
      }
      case 'volatile_blast': {
        totalDur = 0.75;
        this.synthTone(ctx, chain.outGain, now, 0.5, 115, 25, 'sawtooth', 0.48, 0.38);
        this.synthFilteredNoise(ctx, chain.outGain, now, 0.62, 1650, 210, 'bandpass', 2.2, 0.44, 0.45);
        this.synthTone(ctx, chain.outGain, now + 0.04, 0.35, 380, 760, 'triangle', 0.18, 0.35);
        break;
      }
      case 'superconduct': {
        totalDur = 0.62;
        this.synthFmZap(ctx, chain.outGain, now, 0.34, 1720, 185, 72, 520, 0.32, 0.45);
        this.synthFilteredNoise(ctx, chain.outGain, now, 0.18, 3900, 1200, 'bandpass', 1.6, 0.36, 0.35);
        this.synthTone(ctx, chain.outGain, now + 0.05, 0.42, 2637, 1975, 'sine', 0.16, 0.5);
        break;
      }
      case 'abyssal_singularity': {
        totalDur = 0.95;
        // Gravitational inward pitch rise -> catastrophic sub-drop at t = 0.28s
        this.synthTone(ctx, chain.outGain, now, 0.28, 52, 210, 'sawtooth', 0.28, 0.45);
        this.synthTone(ctx, chain.outGain, now + 0.28, 0.58, 145, 22, 'sine', 0.56, 0.55);
        this.synthTone(ctx, chain.outGain, now + 0.28, 0.52, midiToFreq(62), midiToFreq(50), 'triangle', 0.22, 0.65);
        break;
      }
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, totalDur);
  }

  playParrySfx(counterSuccess: boolean, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    // Sovereign golden shield/anvil bell ring
    this.synthTone(ctx, chain.outGain, now, 0.18, 185, 62, 'triangle', 0.36, 0.25);
    this.synthTone(ctx, chain.outGain, now, 0.42, 1760, 1748, 'sine', 0.24, 0.55);
    this.synthTone(ctx, chain.outGain, now + 0.01, 0.48, 2637, 2650, 'triangle', 0.2, 0.6);

    if (counterSuccess) {
      this.synthTone(ctx, chain.outGain, now + 0.03, 0.55, 3520, 3540, 'sine', 0.18, 0.65);
      this.synthFilteredNoise(ctx, chain.outGain, now + 0.02, 0.22, 2800, 900, 'bandpass', 2.4, 0.26, 0.35);
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.62);
  }

  playExecutionStrikeSfx(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    this.synthTone(ctx, chain.outGain, now, 0.48, 195, 26, 'sawtooth', 0.54, 0.4);
    this.synthFilteredNoise(ctx, chain.outGain, now, 0.26, 2200, 420, 'bandpass', 1.8, 0.42, 0.35);
    this.synthTone(ctx, chain.outGain, now + 0.03, 0.55, midiToFreq(62), midiToFreq(50), 'sawtooth', 0.24, 0.55);
    this.synthTone(ctx, chain.outGain, now + 0.06, 0.6, midiToFreq(74), midiToFreq(74), 'triangle', 0.2, 0.6);

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.72);
  }

  playAwakeningSfx(active: boolean, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    if (!active) {
      this.synthTone(ctx, chain.outGain, now, 0.45, midiToFreq(69), midiToFreq(50), 'triangle', 0.18, 0.5);
      this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.5);
      return;
    }

    // Epic Archon Choir Chord + Rolling Thunder Roar
    this.synthTone(ctx, chain.outGain, now, 0.85, 118, 32, 'sine', 0.5, 0.5);
    this.synthFilteredNoise(ctx, chain.outGain, now, 0.82, 950, 140, 'lowpass', 1.4, 0.38, 0.55);
    const choir = [50, 57, 62, 66, 69, 74];
    for (let i = 0; i < choir.length; i++) {
      this.synthTone(
        ctx,
        chain.outGain,
        now + i * 0.045,
        0.95,
        midiToFreq(choir[i]),
        midiToFreq(choir[i]),
        i < 3 ? 'sawtooth' : 'triangle',
        0.16,
        0.72,
      );
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 1.15);
  }

  playButcherInvasionSfx(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    // Monstrous tritone dread war-horn (D2 + Ab2 + D1)
    this.synthTone(ctx, chain.outGain, now, 1.35, midiToFreq(26), midiToFreq(26), 'sawtooth', 0.38, 0.65);
    this.synthFmZap(ctx, chain.outGain, now, 1.3, midiToFreq(38), midiToFreq(37), 24, 35, 0.34, 0.7);
    this.synthTone(ctx, chain.outGain, now + 0.08, 1.25, midiToFreq(44), midiToFreq(43), 'sawtooth', 0.24, 0.7);

    // 5 rattling iron chain clanks
    for (let c = 0; c < 5; c++) {
      const ct = now + 0.12 + c * 0.14;
      this.synthFilteredNoise(ctx, chain.outGain, ct, 0.09, 3400 + c * 180, 1900, 'bandpass', 4.5, 0.22, 0.4);
      this.synthTone(ctx, chain.outGain, ct, 0.08, 1850 + c * 140, 1420, 'triangle', 0.12, 0.35);
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 1.45);
  }

  playGoblinSpawnSfx(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    // Mischievous bouncy trickster bell-laugh + coin jingle
    const giggleNotes = [74, 78, 80, 81, 84, 86];
    for (let i = 0; i < giggleNotes.length; i++) {
      const t = now + i * 0.065;
      this.synthTone(
        ctx,
        chain.outGain,
        t,
        0.18,
        midiToFreq(giggleNotes[i]),
        midiToFreq(giggleNotes[i] + 1),
        'triangle',
        0.2,
        0.42,
      );
    }
    this.synthTone(ctx, chain.outGain, now + 0.35, 0.28, 2637, 2637, 'sine', 0.18, 0.45);

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.72);
  }

  playMimicRevealSfx(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    this.synthTone(ctx, chain.outGain, now, 0.09, 420, 110, 'triangle', 0.38);
    this.synthFmZap(ctx, chain.outGain, now + 0.05, 0.55, 145, 58, 36, 75, 0.36, 0.5);
    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.68);
  }

  playRunewordForgedSfx(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    // Double mythic anvil strike -> glorious 5-note Elder Runeword awakening chord
    for (let h = 0; h < 2; h++) {
      const ht = now + h * 0.16;
      this.synthTone(ctx, chain.outGain, ht, 0.22, 180, 64, 'triangle', 0.32, 0.35);
      this.synthTone(ctx, chain.outGain, ht, 0.3, 1568 * (1 + h * 0.12), 1560, 'sine', 0.2, 0.5);
    }

    const chord = [62, 69, 74, 78, 86];
    for (let i = 0; i < chord.length; i++) {
      this.synthTone(
        ctx,
        chain.outGain,
        now + 0.32 + i * 0.06,
        0.95,
        midiToFreq(chord[i]),
        midiToFreq(chord[i]),
        i % 2 === 0 ? 'triangle' : 'sine',
        0.19,
        0.72,
      );
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 1.45);
  }

  playRunePickupSfx(runeId: RuneId, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    const offset = RUNE_MIDI_OFFSETS[runeId] ?? 0;
    const baseMidi = 69 + Math.min(19, Math.round(offset * 0.5));

    // Lithic carved-stone tap + resonant elder crystal fifth
    this.synthTone(ctx, chain.outGain, now, 0.11, 520, 260, 'triangle', 0.24, 0.3);
    this.synthTone(
      ctx,
      chain.outGain,
      now + 0.02,
      0.52,
      midiToFreq(baseMidi),
      midiToFreq(baseMidi),
      'triangle',
      0.21,
      0.6,
    );
    this.synthTone(
      ctx,
      chain.outGain,
      now + 0.075,
      0.58,
      midiToFreq(baseMidi + 7),
      midiToFreq(baseMidi + 7),
      'sine',
      0.18,
      0.65,
    );

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.72);
  }

  // ==========================================================================
  // Phase 4 Multiplayer Co-op Procedural Web Audio SFX
  // ==========================================================================

  playMpChatPopSfx(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    // Warm subtle parchment whisper + crystal droplet pop
    this.synthFilteredNoise(ctx, chain.outGain, now, 0.05, 1900, 950, 'bandpass', 2.4, 0.09);
    this.synthTone(ctx, chain.outGain, now + 0.01, 0.11, 659.25, 987.77, 'sine', 0.14, 0.25);
    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.16);
  }

  playMpEmojiBurstSfx(emojiId: EmojiReactionId, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    const isUrgent = emojiId === 'skull_danger' || emojiId === 'sos_help';
    const baseMidi = isUrgent ? 72 : 74;
    const topInterval = isUrgent ? 6 : emojiId === 'laugh_imp' ? 4 : 9;

    // Bouncy wooden marimba pop + crystal sparkle overtone
    this.synthTone(
      ctx,
      chain.outGain,
      now,
      0.13,
      midiToFreq(baseMidi - 12),
      midiToFreq(baseMidi),
      'triangle',
      0.2,
      0.3,
    );
    this.synthTone(
      ctx,
      chain.outGain,
      now + 0.055,
      0.24,
      midiToFreq(baseMidi + topInterval),
      midiToFreq(baseMidi + topInterval),
      'sine',
      0.18,
      0.42,
    );
    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.34);
  }

  playMpTacticalPingSfx(pingType: TacticalPingType, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    let totalDur = 0.55;

    switch (pingType) {
      case 'attack': {
        // Assertive brass war-horn fifth call (D4 -> A4)
        this.synthTone(ctx, chain.outGain, now, 0.22, midiToFreq(62), midiToFreq(62), 'sawtooth', 0.22, 0.45);
        this.synthTone(ctx, chain.outGain, now + 0.11, 0.38, midiToFreq(69), midiToFreq(69), 'sawtooth', 0.24, 0.52);
        break;
      }
      case 'danger': {
        // Urgent tritone two-pulse alarm chime (A5 -> Eb5 -> A5)
        totalDur = 0.58;
        this.synthTone(ctx, chain.outGain, now, 0.14, midiToFreq(81), midiToFreq(81), 'triangle', 0.24, 0.35);
        this.synthTone(ctx, chain.outGain, now + 0.11, 0.14, midiToFreq(75), midiToFreq(75), 'triangle', 0.22, 0.35);
        this.synthTone(ctx, chain.outGain, now + 0.22, 0.26, midiToFreq(81), midiToFreq(81), 'sine', 0.24, 0.42);
        break;
      }
      case 'loot': {
        // Shimmering treasure sonar bell (F#5 -> A5 -> D6)
        const notes = [78, 81, 86];
        for (let i = 0; i < notes.length; i++) {
          this.synthTone(
            ctx,
            chain.outGain,
            now + i * 0.06,
            0.36,
            midiToFreq(notes[i]),
            midiToFreq(notes[i]),
            'sine',
            0.19,
            0.55,
          );
        }
        break;
      }
      case 'group':
      default: {
        // Warm welcoming rally chime (D5 -> G5 -> A5)
        this.synthTone(ctx, chain.outGain, now, 0.24, midiToFreq(74), midiToFreq(74), 'triangle', 0.2, 0.45);
        this.synthTone(ctx, chain.outGain, now + 0.08, 0.36, midiToFreq(81), midiToFreq(81), 'sine', 0.21, 0.52);
        break;
      }
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, totalDur);
  }

  playMpSocialEmoteSfx(emoteId: SocialEmoteId, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    if (emoteId === 'downed_kneel') {
      this.synthTone(ctx, chain.outGain, now, 0.42, midiToFreq(65), midiToFreq(57), 'triangle', 0.22, 0.45);
      this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.46);
      return;
    }

    const notes =
      emoteId === 'taunt' ? [62, 65, 69] : emoteId === 'revive_channel' ? [69, 74, 78] : [74, 78, 81];
    for (let i = 0; i < notes.length; i++) {
      this.synthTone(
        ctx,
        chain.outGain,
        now + i * 0.055,
        0.28,
        midiToFreq(notes[i]),
        midiToFreq(notes[i]),
        'triangle',
        0.14,
        0.45,
      );
    }
    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.44);
  }

  playMpHighFiveClashSfx(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    // Resounding golden twin-blade steel ring + anvil punch
    this.synthTone(ctx, chain.outGain, now, 0.2, 180, 58, 'triangle', 0.36, 0.25);
    this.synthTone(ctx, chain.outGain, now, 0.52, 1760, 1752, 'sine', 0.22, 0.6);
    this.synthTone(ctx, chain.outGain, now + 0.015, 0.58, 2637, 2648, 'triangle', 0.2, 0.65);
    this.synthTone(ctx, chain.outGain, now + 0.03, 0.62, 3520, 3532, 'sine', 0.16, 0.68);

    // Triumphant major fifth brass/bell Sworn Brethren chord (D4 + A4 + D5 + F#5 + A5)
    const chord = [62, 69, 74, 78, 81];
    for (let i = 0; i < chord.length; i++) {
      this.synthTone(
        ctx,
        chain.outGain,
        now + 0.05 + i * 0.045,
        0.78,
        midiToFreq(chord[i]),
        midiToFreq(chord[i]),
        i < 2 ? 'sawtooth' : 'triangle',
        0.17,
        0.68,
      );
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 1.05);
  }

  playMpTeammateRevivedSfx(worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    const now = ctx.currentTime;
    // Angelic warm choir swell (D3 + A3 + F#4)
    this.synthTone(ctx, chain.outGain, now, 1.05, midiToFreq(50), midiToFreq(50), 'triangle', 0.2, 0.72);
    this.synthTone(ctx, chain.outGain, now + 0.05, 1.05, midiToFreq(57), midiToFreq(57), 'sawtooth', 0.15, 0.72);

    // Celestial 7-note ascending harp glissando
    const harp = [62, 66, 69, 71, 74, 78, 81, 86];
    for (let i = 0; i < harp.length; i++) {
      this.synthTone(
        ctx,
        chain.outGain,
        now + i * 0.055,
        0.75,
        midiToFreq(harp[i]),
        midiToFreq(harp[i]),
        i % 2 === 0 ? 'triangle' : 'sine',
        0.17,
        0.74,
      );
    }

    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 1.25);
  }

  playMpVoicePttSfx(active: boolean): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    const chain = this.createSpatialVoiceChain(ctx);
    if (!chain) return;

    const now = ctx.currentTime;
    if (active) {
      this.synthTone(ctx, chain.outGain, now, 0.028, 880, 1320, 'sine', 0.11);
    } else {
      this.synthTone(ctx, chain.outGain, now, 0.028, 1174.66, 783.99, 'sine', 0.1);
    }
    this.scheduleChainCleanup(ctx, chain.outGain, chain.tailNode, now, 0.06);
  }

  // ==========================================================================
  // Core 20 SfxId Synthesizers
  // ==========================================================================

  playSfx(id: SfxId, worldPos?: Vec3): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      return;
    }
    if (ctx.state !== 'running') return;

    const nowMs = this.nowWallMs();
    const prevMs = this.sfxLastPlayedMs.get(id) ?? -999;
    const minGapMs = id === 'ui_click' ? 18 : 34;
    if (nowMs - prevMs < minGapMs) return;

    const chain = this.createSpatialVoiceChain(ctx, worldPos);
    if (!chain) return;

    this.sfxLastPlayedMs.set(id, nowMs);
    const { outGain, tailNode } = chain;

    let totalDuration = 0.35;
    const now = ctx.currentTime;
    const pitchJitter = this.range(0.95, 1.05);

    switch (id) {
      case 'sword_swing': {
        totalDuration = 0.24;
        this.synthFilteredNoise(
          ctx,
          outGain,
          now,
          0.2,
          1100 * pitchJitter,
          260,
          'bandpass',
          1.8,
          0.36,
        );
        this.synthTone(ctx, outGain, now, 0.14, 2150 * pitchJitter, 1450, 'sine', 0.055);
        break;
      }
      case 'hit_flesh': {
        totalDuration = 0.22;
        this.synthTone(ctx, outGain, now, 0.14, 155 * pitchJitter, 42, 'triangle', 0.46);
        this.synthFilteredNoise(
          ctx,
          outGain,
          now,
          0.11,
          780 * pitchJitter,
          220,
          'lowpass',
          2.2,
          0.32,
        );
        break;
      }
      case 'hit_crit': {
        totalDuration = 0.45;
        this.synthTone(ctx, outGain, now, 0.22, 190, 36, 'sawtooth', 0.44);
        this.synthTone(ctx, outGain, now, 0.32, 1480 * pitchJitter, 1420, 'triangle', 0.24, 0.28);
        this.synthTone(
          ctx,
          outGain,
          now + 0.02,
          0.36,
          2220 * pitchJitter,
          2180,
          'sine',
          0.2,
          0.35,
        );
        this.synthFilteredNoise(ctx, outGain, now, 0.14, 2600, 700, 'bandpass', 1.4, 0.34);
        break;
      }
      case 'fireball_cast': {
        totalDuration = 0.38;
        this.synthFilteredNoise(
          ctx,
          outGain,
          now,
          0.34,
          220,
          1250 * pitchJitter,
          'bandpass',
          2.4,
          0.38,
        );
        this.synthTone(ctx, outGain, now, 0.26, 130 * pitchJitter, 310, 'sawtooth', 0.18, 0.2);
        break;
      }
      case 'explosion': {
        totalDuration = 0.78;
        this.synthTone(ctx, outGain, now, 0.55, 105, 24, 'sine', 0.62, 0.35);
        this.synthTone(ctx, outGain, now, 0.32, 145, 34, 'sawtooth', 0.32);
        this.synthFilteredNoise(ctx, outGain, now, 0.72, 1350, 130, 'lowpass', 1.2, 0.55, 0.42);
        break;
      }
      case 'frost_shatter': {
        totalDuration = 0.58;
        this.synthFilteredNoise(
          ctx,
          outGain,
          now,
          0.18,
          4200,
          1800,
          'highpass',
          1.5,
          0.32,
          0.35,
        );
        const freqs = [2080, 2790, 3520, 4460];
        for (let i = 0; i < freqs.length; i++) {
          this.synthTone(
            ctx,
            outGain,
            now + i * 0.028,
            0.36,
            freqs[i] * pitchJitter,
            freqs[i] * 0.96,
            'sine',
            0.14,
            0.48,
          );
        }
        break;
      }
      case 'lightning_zap': {
        totalDuration = 0.48;
        this.synthFilteredNoise(ctx, outGain, now, 0.14, 3600, 900, 'bandpass', 1.2, 0.44);
        this.synthFmZap(ctx, outGain, now, 0.26, 1380 * pitchJitter, 165, 58, 420, 0.28);
        this.synthFilteredNoise(
          ctx,
          outGain,
          now + 0.04,
          0.4,
          280,
          75,
          'lowpass',
          1.0,
          0.3,
          0.45,
        );
        break;
      }
      case 'dodge_whoosh': {
        totalDuration = 0.26;
        this.synthFilteredNoise(
          ctx,
          outGain,
          now,
          0.22,
          320,
          880 * pitchJitter,
          'bandpass',
          2.0,
          0.3,
        );
        this.synthTone(ctx, outGain, now, 0.2, 220, 95, 'sine', 0.16);
        break;
      }
      case 'player_hurt': {
        totalDuration = 0.34;
        this.synthTone(ctx, outGain, now, 0.22, 145, 46, 'sawtooth', 0.42);
        this.synthTone(ctx, outGain, now, 0.18, 218 * pitchJitter, 142, 'triangle', 0.26);
        this.synthFilteredNoise(ctx, outGain, now, 0.14, 950, 260, 'lowpass', 1.6, 0.28);
        break;
      }
      case 'potion_drink': {
        totalDuration = 0.56;
        const gulps = [320, 390, 480];
        for (let i = 0; i < gulps.length; i++) {
          const gt = now + i * 0.095;
          this.synthTone(ctx, outGain, gt, 0.085, gulps[i], gulps[i] * 1.75, 'sine', 0.24);
        }
        this.synthTone(ctx, outGain, now + 0.26, 0.28, 880, 1320, 'triangle', 0.16, 0.4);
        break;
      }
      case 'loot_drop_rare': {
        totalDuration = 0.65;
        this.synthTone(
          ctx,
          outGain,
          now,
          0.36,
          midiToFreq(81),
          midiToFreq(81),
          'triangle',
          0.22,
          0.45,
        );
        this.synthTone(
          ctx,
          outGain,
          now + 0.09,
          0.52,
          midiToFreq(88),
          midiToFreq(88),
          'sine',
          0.24,
          0.5,
        );
        break;
      }
      case 'loot_drop_legendary': {
        totalDuration = 1.35;
        this.synthTone(
          ctx,
          outGain,
          now,
          0.85,
          midiToFreq(50),
          midiToFreq(50),
          'sawtooth',
          0.22,
          0.55,
        );
        const notes = [74, 78, 81, 86];
        for (let i = 0; i < notes.length; i++) {
          this.synthTone(
            ctx,
            outGain,
            now + i * 0.085,
            0.85,
            midiToFreq(notes[i]),
            midiToFreq(notes[i]),
            i % 2 === 0 ? 'triangle' : 'sine',
            0.2,
            0.65,
          );
        }
        break;
      }
      case 'gold_pickup': {
        totalDuration = 0.34;
        const comboSemi = PICKUP_COMBO_SEMITONES[this.pickupComboStep] ?? 0;
        const comboMult = Math.pow(2, (comboSemi * 0.5) / 12);
        this.synthTone(
          ctx,
          outGain,
          now,
          0.16,
          1318.5 * comboMult,
          1318.5 * comboMult,
          'sine',
          0.22,
          0.25,
        );
        this.synthTone(
          ctx,
          outGain,
          now + 0.055,
          0.26,
          1975.5 * comboMult,
          1975.5 * comboMult,
          'sine',
          0.24,
          0.3,
        );
        break;
      }
      case 'chest_open': {
        totalDuration = 0.82;
        this.synthTone(ctx, outGain, now, 0.12, 160, 68, 'triangle', 0.34);
        this.synthTone(ctx, outGain, now + 0.08, 0.24, 195, 315, 'sawtooth', 0.12);
        const chord = [69, 73, 76, 81];
        for (let i = 0; i < chord.length; i++) {
          this.synthTone(
            ctx,
            outGain,
            now + 0.22 + i * 0.055,
            0.48,
            midiToFreq(chord[i]),
            midiToFreq(chord[i]),
            'triangle',
            0.16,
            0.5,
          );
        }
        break;
      }
      case 'shrine_bless': {
        totalDuration = 1.25;
        const notes = [62, 69, 74, 76, 81];
        for (let i = 0; i < notes.length; i++) {
          this.synthTone(
            ctx,
            outGain,
            now + i * 0.07,
            0.95,
            midiToFreq(notes[i]),
            midiToFreq(notes[i]),
            'sine',
            0.16,
            0.7,
          );
        }
        break;
      }
      case 'level_up': {
        totalDuration = 1.3;
        this.synthTone(ctx, outGain, now, 0.55, 110, 55, 'triangle', 0.34, 0.35);
        const arp = [62, 66, 69, 74, 81];
        for (let i = 0; i < arp.length; i++) {
          this.synthTone(
            ctx,
            outGain,
            now + i * 0.09,
            0.78,
            midiToFreq(arp[i]),
            midiToFreq(arp[i]),
            'triangle',
            0.21,
            0.6,
          );
        }
        break;
      }
      case 'boss_roar': {
        totalDuration = 1.15;
        this.synthFmZap(ctx, outGain, now, 0.98, 108, 48, 31, 68, 0.42, 0.65);
        this.synthFilteredNoise(
          ctx,
          outGain,
          now,
          0.95,
          580,
          170,
          'bandpass',
          2.4,
          0.45,
          0.6,
        );
        break;
      }
      case 'portal_hum': {
        totalDuration = 0.95;
        this.synthTone(ctx, outGain, now, 0.88, 110, 114, 'sawtooth', 0.16, 0.55);
        this.synthTone(ctx, outGain, now, 0.88, 221, 217, 'sine', 0.18, 0.55);
        this.synthTone(ctx, outGain, now + 0.05, 0.8, 330, 440, 'triangle', 0.12, 0.6);
        break;
      }
      case 'ui_click': {
        totalDuration = 0.08;
        this.synthTone(ctx, outGain, now, 0.045, 980 * pitchJitter, 380, 'triangle', 0.2);
        break;
      }
      case 'ui_equip': {
        totalDuration = 0.24;
        this.synthTone(ctx, outGain, now, 0.09, 210, 95, 'triangle', 0.28);
        this.synthTone(
          ctx,
          outGain,
          now + 0.05,
          0.16,
          1480 * pitchJitter,
          1120,
          'sine',
          0.18,
          0.22,
        );
        this.synthFilteredNoise(
          ctx,
          outGain,
          now + 0.04,
          0.08,
          3200,
          1600,
          'bandpass',
          3.0,
          0.18,
        );
        break;
      }
    }

    this.scheduleChainCleanup(ctx, outGain, tailNode, now, totalDuration);
  }

  private synthTone(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    duration: number,
    freqStart: number,
    freqEnd: number,
    type: OscillatorType,
    peakGain: number,
    reverbSend = 0,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(18, freqStart), startTime);
    if (Math.abs(freqEnd - freqStart) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(18, freqEnd), startTime + duration);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(type === 'sawtooth' ? 2400 : 5600, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.012, duration * 0.22));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(filter);
    filter.connect(env);
    env.connect(dest);

    let wet: GainNode | null = null;
    if (this.reverbConvolver && reverbSend > 0.01) {
      wet = ctx.createGain();
      wet.gain.value = reverbSend;
      env.connect(wet);
      wet.connect(this.reverbConvolver);
    }

    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      env.disconnect();
      wet?.disconnect();
    };
  }

  private synthFilteredNoise(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    duration: number,
    freqStart: number,
    freqEnd: number,
    filterType: BiquadFilterType,
    q: number,
    peakGain: number,
    reverbSend = 0,
  ): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(q, startTime);
    filter.frequency.setValueAtTime(Math.max(40, freqStart), startTime);
    if (Math.abs(freqEnd - freqStart) > 1) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startTime + duration);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.018, duration * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(dest);

    let wet: GainNode | null = null;
    if (this.reverbConvolver && reverbSend > 0.01) {
      wet = ctx.createGain();
      wet.gain.value = reverbSend;
      env.connect(wet);
      wet.connect(this.reverbConvolver);
    }

    const offset = this.range(0, Math.max(0.05, 1.9 - duration));
    src.start(startTime, offset, duration + 0.03);
    src.stop(startTime + duration + 0.03);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      env.disconnect();
      wet?.disconnect();
    };
  }

  private synthFmZap(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    duration: number,
    carrierStart: number,
    carrierEnd: number,
    modFreq: number,
    modDepth: number,
    peakGain: number,
    reverbSend = 0,
  ): void {
    const carrier = ctx.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(carrierStart, startTime);
    carrier.frequency.exponentialRampToValueAtTime(
      Math.max(24, carrierEnd),
      startTime + duration,
    );

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(modFreq, startTime);

    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(modDepth, startTime);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, startTime);
    filter.frequency.exponentialRampToValueAtTime(280, startTime + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.04, duration * 0.18));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    carrier.connect(filter);
    filter.connect(env);
    env.connect(dest);

    let wet: GainNode | null = null;
    if (this.reverbConvolver && reverbSend > 0.01) {
      wet = ctx.createGain();
      wet.gain.value = reverbSend;
      env.connect(wet);
      wet.connect(this.reverbConvolver);
    }

    mod.start(startTime);
    carrier.start(startTime);
    mod.stop(startTime + duration + 0.02);
    carrier.stop(startTime + duration + 0.02);
    carrier.onended = () => {
      mod.disconnect();
      modGain.disconnect();
      carrier.disconnect();
      filter.disconnect();
      env.disconnect();
      wet?.disconnect();
    };
  }

  dispose(): void {
    this.disposed = true;
    this.gestureCleanup?.();

    for (const ch of this.moodChannels.values()) {
      ch.sustained?.stopAndDisconnect();
      ch.sustained = null;
      try {
        ch.gainNode.disconnect();
      } catch {}
    }
    this.moodChannels.clear();

    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }

    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.reverbConvolver = null;
    this.reverbReturnGain = null;
    this.noiseBuffer = null;
    this.sfxLastPlayedMs.clear();
    this.dropIdToComboStep.clear();
    this.pickupComboStep = 0;
    this.pickupComboTimerSec = 0;
    this.hasActivePickupCombo = false;
    this.activeSfxVoices = 0;
  }
}
