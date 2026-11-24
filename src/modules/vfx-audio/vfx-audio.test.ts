import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type {
  ElementalReactionType,
  EmojiReactionId,
  GroundLootDrop,
  HeroClassId,
  ItemInstance,
  MusicMood,
  RuneId,
  SfxId,
  SocialEmoteId,
  TacticalPingType,
  VfxEffectType,
  WeaponVisualType,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { createVfxAudioSystem, VfxAudioSystem } from './index';

const ALL_VFX: readonly VfxEffectType[] = [
  'slash_arc',
  'hit_sparks',
  'blood_burst',
  'fire_explosion',
  'frost_nova',
  'lightning_strike',
  'poison_cloud',
  'void_implosion',
  'heal_aura',
  'level_up_pillar',
  'dodge_afterimage',
  'loot_pickup',
  'chest_open',
];

const ALL_SFX: readonly SfxId[] = [
  'sword_swing',
  'hit_flesh',
  'hit_crit',
  'fireball_cast',
  'explosion',
  'frost_shatter',
  'lightning_zap',
  'dodge_whoosh',
  'player_hurt',
  'potion_drink',
  'loot_drop_rare',
  'loot_drop_legendary',
  'gold_pickup',
  'chest_open',
  'shrine_bless',
  'level_up',
  'boss_roar',
  'portal_hum',
  'ui_click',
  'ui_equip',
];

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

function createMockAudioParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime(v: number) {
      this.value = v;
    },
    linearRampToValueAtTime(v: number) {
      this.value = v;
    },
    exponentialRampToValueAtTime(v: number) {
      this.value = v;
    },
    setTargetAtTime(v: number) {
      this.value = v;
    },
  };
}

function createMockNode() {
  return {
    connect() {
      return this;
    },
    disconnect() {},
  };
}

class MockAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'running';
  currentTime = 0;
  sampleRate = 22050;
  destination = createMockNode();
  oscCount = 0;
  noiseCount = 0;
  lastOscFreqs: number[] = [];

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createGain() {
    return { ...createMockNode(), gain: createMockAudioParam(1) };
  }

  createDynamicsCompressor() {
    return {
      ...createMockNode(),
      threshold: createMockAudioParam(-10),
      knee: createMockAudioParam(10),
      ratio: createMockAudioParam(4),
      attack: createMockAudioParam(0.005),
      release: createMockAudioParam(0.1),
    };
  }

  createBiquadFilter() {
    return {
      ...createMockNode(),
      type: 'lowpass',
      frequency: createMockAudioParam(1000),
      Q: createMockAudioParam(1),
    };
  }

  createStereoPanner() {
    return {
      ...createMockNode(),
      pan: createMockAudioParam(0),
    };
  }

  createConvolver() {
    return {
      ...createMockNode(),
      buffer: null as unknown,
    };
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const chData: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
      chData.push(new Float32Array(length));
    }
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData(ch: number) {
        return chData[ch];
      },
    };
  }

  createBufferSource() {
    this.noiseCount++;
    return {
      ...createMockNode(),
      buffer: null as unknown,
      onended: null as (() => void) | null,
      start() {},
      stop() {
        this.onended?.();
      },
    };
  }

  createOscillator() {
    this.oscCount++;
    const ctxRef = this;
    const freqParam = {
      value: 440,
      setValueAtTime(v: number) {
        this.value = v;
        ctxRef.lastOscFreqs.push(v);
      },
      linearRampToValueAtTime(v: number) {
        this.value = v;
      },
      exponentialRampToValueAtTime(v: number) {
        this.value = v;
      },
      setTargetAtTime(v: number) {
        this.value = v;
      },
    };
    return {
      ...createMockNode(),
      type: 'sine',
      frequency: freqParam,
      onended: null as (() => void) | null,
      start() {},
      stop() {
        this.onended?.();
      },
    };
  }

  createConstantSource() {
    return {
      ...createMockNode(),
      offset: createMockAudioParam(0),
      onended: null as (() => void) | null,
      start() {},
      stop() {
        this.onended?.();
      },
    };
  }
}

describe('VfxAudioSystem', () => {
  it('runs all 13 VFX types, EventBus requests, and headless audio fallback safely', () => {
    const scene = new THREE.Scene();
    const sys = createVfxAudioSystem();
    expect(sys).toBeInstanceOf(VfxAudioSystem);

    sys.init(scene);
    expect(scene.getObjectByName('AbyssalVfxRoot')).toBeDefined();

    for (let i = 0; i < ALL_VFX.length; i++) {
      sys.spawnVfx(
        ALL_VFX[i],
        { x: i * 1.5, y: 0, z: -i },
        { direction: { x: 0.6, y: 0, z: 0.8 }, radius: 2.8, scale: 1.1 },
      );
    }

    eventBus.emit('vfx:request', {
      type: 'slash_arc',
      position: { x: 2, y: 0, z: 3 },
      direction: { x: 1, y: 0, z: 0 },
      colorHex: 0xff3366,
      radius: 2.5,
      scale: 1.2,
    });

    sys.unlockAudio();
    sys.setVolumes(0.8, 0.6, 0.9);
    for (const mood of ALL_MOODS) {
      sys.setMusicMood(mood);
    }
    for (const sfx of ALL_SFX) {
      sys.playSfx(sfx, { x: 1, y: 0, z: 1 });
    }

    for (let f = 0; f < 90; f++) {
      sys.update(1 / 60, { x: 0, y: 0, z: 0 });
    }

    sys.dispose();
    expect(scene.getObjectByName('AbyssalVfxRoot')).toBeUndefined();
  });

  it('synthesizes all 20 SFX (with distance attenuation) and crossfades all 8 MusicMoods via Web Audio', () => {
    const g = globalThis as unknown as { AudioContext?: unknown };
    const prevAudioCtx = g.AudioContext;
    let createdCtx: MockAudioContext | null = null;

    class TrackedMockAudioContext extends MockAudioContext {
      constructor() {
        super();
        createdCtx = this;
      }
    }

    g.AudioContext = TrackedMockAudioContext;

    try {
      const scene = new THREE.Scene();
      const sys = createVfxAudioSystem();
      sys.init(scene);
      sys.unlockAudio();
      sys.setVolumes(0.85, 0.55, 0.9);

      for (const mood of ALL_MOODS) {
        sys.setMusicMood(mood);
        for (let step = 0; step < 12; step++) {
          if (createdCtx) {
            (createdCtx as MockAudioContext).currentTime += 0.05;
          }
          sys.update(0.05, { x: 10, y: 0, z: 10 });
        }
      }

      for (let i = 0; i < ALL_SFX.length; i++) {
        eventBus.emit('sfx:request', {
          id: ALL_SFX[i],
          position: i % 2 === 0 ? { x: 12, y: 0, z: 11 } : undefined,
        });
      }

      const oscBeforeFar = createdCtx ? (createdCtx as MockAudioContext).oscCount : 0;
      sys.playSfx('explosion', { x: 200, y: 0, z: 200 });
      const oscAfterFar = createdCtx ? (createdCtx as MockAudioContext).oscCount : 0;
      expect(oscAfterFar).toBe(oscBeforeFar);
      expect(oscBeforeFar).toBeGreaterThan(20);

      sys.dispose();
    } finally {
      g.AudioContext = prevAudioCtx;
    }
  });

  it('handles Phase 2 Fresnel shockwaves, homing soul-trails, combo pickup chimes, and forge/class/portal stingers', () => {
    const g = globalThis as unknown as { AudioContext?: unknown };
    const prevAudioCtx = g.AudioContext;
    let createdCtx: MockAudioContext | null = null;

    class TrackedMockAudioContext extends MockAudioContext {
      constructor() {
        super();
        createdCtx = this;
      }
    }

    g.AudioContext = TrackedMockAudioContext;

    try {
      const scene = new THREE.Scene();
      const sys = createVfxAudioSystem() as VfxAudioSystem;
      sys.init(scene);
      sys.unlockAudio();
      sys.update(1 / 120, { x: 5, y: 0, z: 5 });

      const root = scene.getObjectByName('AbyssalVfxRoot')!;
      const fresnelShaders = root.children.filter(
        (c) =>
          c instanceof THREE.Mesh &&
          c.material instanceof THREE.ShaderMaterial &&
          'uFresnelPower' in c.material.uniforms,
      );
      expect(fresnelShaders.length).toBeGreaterThan(0);

      const arrivalRootFreqs: number[] = [];
      for (let i = 0; i < 4; i++) {
        const drop: GroundLootDrop = {
          id: `drop_combo_${i}`,
          position: { x: 6 + i * 0.5, y: 0, z: 5 },
          kind: i === 3 ? 'health_orb' : 'gold',
          amount: 25,
          pickedUp: false,
        };

        eventBus.emit('loot:pickupStarted', { drop, fromPos: drop.position });
        expect(sys.getPickupComboStep()).toBe(i);

        for (let f = 0; f < 15; f++) {
          sys.update(1 / 60, { x: 5 + f * 0.05, y: 0, z: 5 });
        }

        const freqIdxBefore = createdCtx ? (createdCtx as MockAudioContext).lastOscFreqs.length : 0;
        eventBus.emit('loot:pickedUp', { drop });
        if (createdCtx && (createdCtx as MockAudioContext).lastOscFreqs.length > freqIdxBefore) {
          arrivalRootFreqs.push((createdCtx as MockAudioContext).lastOscFreqs[freqIdxBefore]);
        }
        expect(sys.getPickupComboStep()).toBe(i);
      }

      expect(arrivalRootFreqs.length).toBe(4);
      expect(arrivalRootFreqs[1]).toBeGreaterThan(arrivalRootFreqs[0]);
      expect(arrivalRootFreqs[2]).toBeGreaterThan(arrivalRootFreqs[1]);
      expect(arrivalRootFreqs[3]).toBeGreaterThan(arrivalRootFreqs[2]);

      sys.update(1.35, { x: 6, y: 0, z: 5 });
      expect(sys.getPickupComboStep()).toBe(0);

      const weapons: WeaponVisualType[] = [
        'greatsword',
        'daggers',
        'staff',
        'warhammer',
        'sword_shield',
      ];
      for (const w of weapons) {
        eventBus.emit('hero:gearChanged', {
          slot: 'weapon',
          weaponVisual: w,
          rarity: w === 'staff' ? 'legendary' : 'epic',
        });
      }

      const classes: HeroClassId[] = ['vanguard', 'shadowblade', 'arcanist'];
      for (const cls of classes) {
        eventBus.emit('hero:classChanged', { heroClass: cls });
      }

      const oscBeforePortal = createdCtx ? (createdCtx as MockAudioContext).oscCount : 0;
      eventBus.emit('dungeon:portalWarp', {
        fromFloor: 1,
        toFloor: 2,
        position: { x: 6, y: 0, z: 6 },
      });
      const oscAfterPortal = createdCtx ? (createdCtx as MockAudioContext).oscCount : 0;
      expect(oscAfterPortal).toBeGreaterThan(oscBeforePortal);

      for (let f = 0; f < 60; f++) {
        sys.update(1 / 120, { x: 6, y: 0, z: 6 });
      }

      sys.dispose();
    } finally {
      g.AudioContext = prevAudioCtx;
    }
  });

  it('handles Phase 3 elemental reactions, parry/execution/awakening mastery, Butcher/Goblin invasions, and Runeword events', () => {
    const g = globalThis as unknown as { AudioContext?: unknown };
    const prevAudioCtx = g.AudioContext;
    let createdCtx: MockAudioContext | null = null;

    class TrackedMockAudioContext extends MockAudioContext {
      constructor() {
        super();
        createdCtx = this;
      }
    }

    g.AudioContext = TrackedMockAudioContext;

    try {
      const scene = new THREE.Scene();
      const sys = createVfxAudioSystem();
      sys.init(scene);
      sys.unlockAudio();
      sys.update(1 / 60, { x: 0, y: 0, z: 0 });

      // Test new sanctuary & invasion soundtracks
      for (const mood of ['sanctuary', 'invasion'] as const) {
        sys.setMusicMood(mood);
        for (let i = 0; i < 16; i++) {
          if (createdCtx) {
            (createdCtx as MockAudioContext).currentTime += 0.06;
          }
          sys.update(0.06, { x: 0, y: 0, z: 0 });
        }
      }

      const oscBefore = createdCtx ? (createdCtx as MockAudioContext).oscCount : 0;

      // All 4 Elemental Reactions
      const reactions: ElementalReactionType[] = [
        'shatter',
        'volatile_blast',
        'superconduct',
        'abyssal_singularity',
      ];
      for (const reaction of reactions) {
        eventBus.emit('combat:elementalReaction', {
          reaction,
          position: { x: 2, y: 0, z: 2 },
          damage: 450,
        });
      }

      // Parry (guard + counter-riposte), Execution Strike, and Awakening Overdrive
      eventBus.emit('combat:parryTriggered', {
        position: { x: 1, y: 0, z: 1 },
        counterSuccess: false,
      });
      eventBus.emit('combat:parryTriggered', {
        position: { x: 1, y: 0, z: 1 },
        counterSuccess: true,
      });
      eventBus.emit('combat:executionStrike', {
        position: { x: 3, y: 0, z: 2 },
        targetId: 'boss_1',
        damage: 2500,
      });
      eventBus.emit('player:awakeningChanged', {
        active: true,
        position: { x: 0, y: 0, z: 0 },
      });
      eventBus.emit('player:awakeningChanged', {
        active: false,
        position: { x: 0, y: 0, z: 0 },
      });

      // Butcher Invasion, Treasure Goblin, Chest Mimic
      eventBus.emit('event:butcherInvasion', { position: { x: 6, y: 0, z: 4 } });
      eventBus.emit('event:goblinSpawned', { position: { x: -4, y: 0, z: 5 } });
      eventBus.emit('event:mimicRevealed', { position: { x: 2, y: 0, z: -3 } });

      // Runeword Forged & Rune Pickups
      const dummyItem: ItemInstance = {
        id: 'item_rw_1',
        name: 'Enigma Archon Plate',
        slot: 'chest',
        rarity: 'legendary',
        isMythic: true,
        levelReq: 10,
        itemLevel: 20,
        upgradeLevel: 5,
        affixes: [],
        runewordId: 'enigma',
        runewordName: 'Enigma',
        goldValue: 1200,
        icon: 'chest',
      };
      eventBus.emit('event:runewordForged', {
        runewordName: 'Enigma',
        item: dummyItem,
      });

      const runes: RuneId[] = ['sol', 'vex', 'jah', 'ber', 'zod'];
      for (const runeId of runes) {
        eventBus.emit('rune:pickedUp', {
          runeId,
          position: { x: 1, y: 0, z: -1 },
        });
      }

      const oscAfter = createdCtx ? (createdCtx as MockAudioContext).oscCount : 0;
      expect(oscAfter).toBeGreaterThan(oscBefore + 35);

      for (let f = 0; f < 45; f++) {
        sys.update(1 / 60, { x: 0, y: 0, z: 0 });
      }

      sys.dispose();
    } finally {
      g.AudioContext = prevAudioCtx;
    }
  });

  it('handles all 7 Phase 4 multiplayer co-op events (chatPop, emojiBurst, tacticalPing, socialEmote, highFiveClash, teammateRevived, voicePtt)', () => {
    const g = globalThis as unknown as { AudioContext?: unknown };
    const prevAudioCtx = g.AudioContext;
    let createdCtx: MockAudioContext | null = null;

    class TrackedMockAudioContext extends MockAudioContext {
      constructor() {
        super();
        createdCtx = this;
      }
    }

    g.AudioContext = TrackedMockAudioContext;

    try {
      const scene = new THREE.Scene();
      const sys = createVfxAudioSystem();
      sys.init(scene);
      sys.unlockAudio();
      sys.update(1 / 60, { x: 0, y: 0, z: 0 });

      const oscBefore = createdCtx ? (createdCtx as MockAudioContext).oscCount : 0;

      // 1. mp:chatPop (with & without position)
      eventBus.emit('mp:chatPop', { senderName: 'Vaelen', position: { x: 2, y: 0, z: 2 } });
      eventBus.emit('mp:chatPop', { senderName: 'Lyra' });

      // 2. mp:emojiBurst
      const emojis: EmojiReactionId[] = [
        'crown_gg',
        'fire_hype',
        'skull_danger',
        'laugh_imp',
        'heart_thanks',
        'chest_loot',
        'sos_help',
        'swords_boss',
      ];
      for (const emojiId of emojis) {
        eventBus.emit('mp:emojiBurst', { emojiId, position: { x: 1, y: 0, z: 2 } });
      }

      // 3. mp:tacticalPing (all 4 ping types)
      const pings: TacticalPingType[] = ['attack', 'danger', 'loot', 'group'];
      for (const pingType of pings) {
        eventBus.emit('mp:tacticalPing', { pingType, position: { x: 3, y: 0, z: -2 } });
      }

      // 4. mp:socialEmote
      const emotes: SocialEmoteId[] = ['cheer', 'dance', 'taunt', 'downed_kneel', 'revive_channel'];
      for (const emoteId of emotes) {
        eventBus.emit('mp:socialEmote', { emoteId, position: { x: -1, y: 0, z: 1 } });
      }

      // 5. mp:highFiveClash & 6. mp:teammateRevived
      eventBus.emit('mp:highFiveClash', { position: { x: 0.5, y: 0, z: 0.5 } });
      eventBus.emit('mp:teammateRevived', { position: { x: -2, y: 0, z: 2 } });

      // 7. mp:voicePtt (active true & false)
      eventBus.emit('mp:voicePtt', { active: true });
      eventBus.emit('mp:voicePtt', { active: false });

      const oscAfter = createdCtx ? (createdCtx as MockAudioContext).oscCount : 0;
      expect(oscAfter).toBeGreaterThan(oscBefore + 30);

      for (let f = 0; f < 40; f++) {
        sys.update(1 / 60, { x: 0, y: 0, z: 0 });
      }

      sys.dispose();
    } finally {
      g.AudioContext = prevAudioCtx;
    }
  });
});
