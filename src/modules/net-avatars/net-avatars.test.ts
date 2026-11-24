import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HeroAnimState,
  HeroClassId,
  IHeroRig,
  ItemRarity,
  PeerVoiceState,
  RemotePeerSnapshot,
  SocialEmoteId,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { shortestAngleDelta } from './interpolation';
import { createRemoteAvatarManager, RemoteAvatarManager } from './index';

// ----------------------------------------------------------------------------
// Lightweight Headless DOM Shim for testing #ui-multiplayer-layer overlays
// ----------------------------------------------------------------------------
class MockClassList {
  private readonly tokens = new Set<string>();
  constructor(private readonly owner: MockDomElement) {}

  syncFromString(cls: string): void {
    this.tokens.clear();
    for (const part of cls.split(/\s+/).filter(Boolean)) {
      this.tokens.add(part);
    }
  }

  add(...names: string[]): void {
    for (const n of names) if (n) this.tokens.add(n);
    this.owner._syncClassAttr();
  }

  remove(...names: string[]): void {
    for (const n of names) this.tokens.delete(n);
    this.owner._syncClassAttr();
  }

  toggle(name: string, force?: boolean): boolean {
    const next = force !== undefined ? force : !this.tokens.has(name);
    if (next) this.tokens.add(name);
    else this.tokens.delete(name);
    this.owner._syncClassAttr();
    return next;
  }

  contains(name: string): boolean {
    return this.tokens.has(name);
  }

  toString(): string {
    return [...this.tokens].join(' ');
  }
}

class MockDomElement {
  public readonly tagName: string;
  public id = '';
  public children: MockDomElement[] = [];
  public parentElement: MockDomElement | null = null;
  public style: Record<string, string> = {};
  public readonly classList: MockClassList;
  private _className = '';
  private _textContent = '';
  private _innerHTML = '';
  private readonly attrs = new Map<string, string>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    this.classList = new MockClassList(this);
  }

  get className(): string {
    return this._className;
  }
  set className(val: string) {
    this._className = String(val ?? '');
    this.classList.syncFromString(this._className);
  }

  _syncClassAttr(): void {
    this._className = this.classList.toString();
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join('');
  }
  set textContent(val: string) {
    this._textContent = String(val ?? '');
    this.children = [];
  }

  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(val: string) {
    this._innerHTML = String(val ?? '');
    this.children = [];
  }

  setAttribute(name: string, val: string): void {
    const strVal = String(val);
    this.attrs.set(name, strVal);
    if (name === 'id') this.id = strVal;
    if (name === 'class') this.className = strVal;
  }

  getAttribute(name: string): string | null {
    if (name === 'id' && this.id) return this.id;
    if (name === 'class' && this._className) return this._className;
    return this.attrs.get(name) ?? null;
  }

  appendChild(child: MockDomElement): MockDomElement {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: MockDomElement): MockDomElement {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  findAll(predicate: (el: MockDomElement) => boolean): MockDomElement[] {
    const out: MockDomElement[] = [];
    const visit = (node: MockDomElement) => {
      if (predicate(node)) out.push(node);
      for (const ch of node.children) visit(ch);
    };
    for (const ch of this.children) visit(ch);
    return out;
  }
}

function installMockDom(): {
  head: MockDomElement;
  body: MockDomElement;
  mpLayer: MockDomElement;
  cleanup: () => void;
} {
  const head = new MockDomElement('head');
  const body = new MockDomElement('body');
  const mpLayer = new MockDomElement('div');
  mpLayer.id = 'ui-multiplayer-layer';
  body.appendChild(mpLayer);

  const findById = (root: MockDomElement, id: string): MockDomElement | null => {
    if (root.id === id) return root;
    for (const ch of root.children) {
      const hit = findById(ch, id);
      if (hit) return hit;
    }
    return null;
  };

  const mockDocument = {
    head,
    body,
    createElement: (tag: string) => new MockDomElement(tag),
    getElementById: (id: string) => findById(head, id) ?? findById(body, id),
  };

  const mockWindow = {
    innerWidth: 1280,
    innerHeight: 720,
  };

  vi.stubGlobal('document', mockDocument);
  vi.stubGlobal('window', mockWindow);

  return {
    head,
    body,
    mpLayer,
    cleanup: () => {
      vi.unstubAllGlobals();
    },
  };
}

interface SpyRigHandle {
  rig: IHeroRig;
  setClassStyle: ReturnType<typeof vi.fn>;
  setWeaponVisual: ReturnType<typeof vi.fn>;
  playAnim: ReturnType<typeof vi.fn>;
  playSocialEmote: ReturnType<typeof vi.fn>;
  setAwakenedVisual: ReturnType<typeof vi.fn>;
  triggerSlashTrail: ReturnType<typeof vi.fn>;
  playEquipFlourish: ReturnType<typeof vi.fn>;
  flashHit: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function createSpyRig(initialClass: HeroClassId = 'vanguard'): SpyRigHandle {
  const root = new THREE.Group();
  root.name = `MockHeroRig_${initialClass}`;

  const setClassStyle = vi.fn<(heroClass: HeroClassId) => void>();
  const setWeaponVisual = vi.fn<(weapon: WeaponVisualType, rarity?: ItemRarity) => void>();
  const playAnim = vi.fn<(state: HeroAnimState, speedMultiplier?: number) => void>();
  const playSocialEmote = vi.fn<(emoteId: SocialEmoteId) => void>();
  const setAwakenedVisual = vi.fn<(active: boolean) => void>();
  const triggerSlashTrail = vi.fn<(colorHex?: number, durationSec?: number) => void>();
  const playEquipFlourish = vi.fn<(rarity?: ItemRarity) => void>();
  const flashHit = vi.fn<(colorHex?: number) => void>();
  const update = vi.fn<(dt: number, moveSpeedNormalized: number) => void>();
  const dispose = vi.fn<() => void>();

  const rig: IHeroRig = {
    root,
    setClassStyle,
    setWeaponVisual,
    playAnim,
    playSocialEmote,
    setAwakenedVisual,
    triggerSlashTrail,
    playEquipFlourish,
    flashHit,
    update,
    getWeaponTipWorldPosition: (out = new THREE.Vector3()) => out.copy(root.position),
    dispose,
  };

  return {
    rig,
    setClassStyle,
    setWeaponVisual,
    playAnim,
    playSocialEmote,
    setAwakenedVisual,
    triggerSlashTrail,
    playEquipFlourish,
    flashHit,
    update,
    dispose,
  };
}

function makePeerSnapshot(overrides: Partial<RemotePeerSnapshot> = {}): RemotePeerSnapshot {
  return {
    peerId: 'peer-alpha',
    nickname: 'Valkyrie',
    isHost: true,
    heroClass: 'vanguard',
    level: 12,
    hp: 420,
    maxHp: 500,
    position: { x: 2, y: 0, z: 3 },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    animState: 'idle',
    socialEmote: null,
    weaponVisual: 'greatsword',
    weaponRarity: 'epic',
    awakened: false,
    downed: false,
    pingMs: 95,
    ...overrides,
  };
}

describe('RemoteAvatarManager (net-avatars)', () => {
  let scene: THREE.Scene;
  let domEnv: ReturnType<typeof installMockDom>;

  beforeEach(() => {
    scene = new THREE.Scene();
    domEnv = installMockDom();
    eventBus.clear();
  });

  afterEach(() => {
    eventBus.clear();
    domEnv.cleanup();
  });

  it('spawns, syncs state (class, weapon, rarity, Archon wings, downed kneel, emotes, companion orb), and despawns peers cleanly', () => {
    const spyRigs = new Map<string, SpyRigHandle>();
    let spawnIdx = 0;
    const manager = createRemoteAvatarManager((cls) => {
      const handle = createSpyRig(cls);
      spyRigs.set(`rig-${++spawnIdx}`, handle);
      return handle.rig;
    });

    manager.init(scene);

    const peer1 = makePeerSnapshot({
      peerId: 'peer-1',
      heroClass: 'arcanist',
      weaponVisual: 'staff',
      weaponRarity: 'legendary',
      awakened: true,
      activePet: 'celestial_owl',
      animState: 'run',
    });

    manager.syncPeers([peer1]);

    const handle = spyRigs.get('rig-1')!;
    expect(handle).toBeDefined();
    expect(scene.children).toContain(handle.rig.root);
    expect(handle.setClassStyle).toHaveBeenCalledWith('arcanist');
    expect(handle.setWeaponVisual).toHaveBeenCalledWith('staff', 'legendary');
    expect(handle.setAwakenedVisual).toHaveBeenCalledWith(true);
    expect(handle.playAnim).toHaveBeenCalledWith('run');

    // Verify orbiting companion spirit orb is spawned & visible in THREE.Scene
    const attachmentGroup = scene.children.find((c) => c.name === 'RemoteAvatarAttachments') as THREE.Group;
    expect(attachmentGroup).toBeDefined();
    const spiritOrb = attachmentGroup.children.find((c) => c.name === 'RemoteCompanionSpiritOrb')!;
    expect(spiritOrb.visible).toBe(true);

    // Advance elapsed time to verify companion orb orbits around avatar
    manager.update(1 / 120, 0.5, {}, () => ({ x: 640, y: 360, visible: true }));
    const orbPosT1 = spiritOrb.position.clone();
    manager.update(1 / 120, 1.4, {}, () => ({ x: 640, y: 360, visible: true }));
    expect(spiritOrb.position.distanceTo(orbPosT1)).toBeGreaterThan(0.25);

    // Sync social emote -> downed kneel -> revive recovery -> remove activePet
    manager.syncPeers([
      {
        ...peer1,
        socialEmote: 'dance',
        activePet: undefined,
      },
    ]);
    expect(handle.playSocialEmote).toHaveBeenCalledWith('dance');
    expect(spiritOrb.visible).toBe(false);

    manager.syncPeers([
      {
        ...peer1,
        downed: true,
        downedBleedoutSec: 18,
      },
    ]);
    expect(handle.playSocialEmote).toHaveBeenCalledWith('downed_kneel');

    manager.syncPeers([
      {
        ...peer1,
        downed: false,
        animState: 'idle',
      },
    ]);
    expect(handle.playAnim).toHaveBeenCalledWith('idle');
    expect(handle.playEquipFlourish).toHaveBeenCalledWith('legendary');

    // Disconnect peer -> removes from scene and disposes rig
    manager.syncPeers([]);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(scene.children).not.toContain(handle.rig.root);

    manager.dispose();
  });

  it('performs smooth 120Hz Velocity-Assisted Hermite interpolation, shortest-arc yaw rotation, and >16m teleport snapping', () => {
    const spyHandle = createSpyRig('shadowblade');
    const manager = new RemoteAvatarManager(() => spyHandle.rig);
    manager.init(scene);

    // Initial spawn at (0, 0, 0) facing +175 deg (+3.054 rad)
    const startRot = 3.05;
    manager.syncPeers([
      makePeerSnapshot({
        peerId: 'peer-glide',
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 4.5, y: 0, z: 0 },
        rotationY: startRot,
        pingMs: 120,
      }),
    ]);

    // Packet arrives 5m away with velocity and rotation across +/-PI boundary (-3.05 rad)
    const targetRot = -3.05;
    manager.syncPeers([
      makePeerSnapshot({
        peerId: 'peer-glide',
        position: { x: 5, y: 0, z: 0 },
        velocity: { x: 4.5, y: 0, z: 0 },
        rotationY: targetRot,
        pingMs: 120,
      }),
    ]);

    // Step at 120Hz: intermediate frames should glide smoothly between 0 and 5 (never teleporting)
    manager.update(1 / 120, 1 / 120, {}, () => ({ x: 640, y: 360, visible: true }));
    const earlyX = spyHandle.rig.root.position.x;
    expect(earlyX).toBeGreaterThan(0.01);
    expect(earlyX).toBeLessThan(2.5);

    // Rotation must cross +/-PI via shortest arc (abs angle stays near PI, never sweeping through 0!)
    expect(Math.abs(spyHandle.rig.root.rotation.y)).toBeGreaterThan(2.85);

    for (let frame = 2; frame <= 36; frame++) {
      manager.update(1 / 120, frame / 120, {}, () => ({ x: 640, y: 360, visible: true }));
    }

    expect(spyHandle.rig.root.position.x).toBeCloseTo(5, 1);
    expect(Math.abs(shortestAngleDelta(spyHandle.rig.root.rotation.y, targetRot))).toBeLessThan(0.05);

    // Teleport > 16m (e.g. 25m warp) -> snaps immediately without intermediate trailing!
    manager.syncPeers([
      makePeerSnapshot({
        peerId: 'peer-glide',
        position: { x: 30, y: 0, z: -12 },
        velocity: { x: 0, y: 0, z: 0 },
        rotationY: 0.5,
        pingMs: 120,
      }),
    ]);

    expect(spyHandle.rig.root.position.x).toBeCloseTo(30, 5);
    expect(spyHandle.rig.root.position.z).toBeCloseTo(-12, 5);
    expect(spyHandle.rig.root.rotation.y).toBeCloseTo(0.5, 5);

    manager.dispose();
  });

  it('renders remote skill visuals, paired high-five clash step + facing, and all 4 3D tactical ground ping pillars', () => {
    const spyHandle = createSpyRig('vanguard');
    const manager = new RemoteAvatarManager(() => spyHandle.rig);
    manager.init(scene);

    manager.syncPeers([
      makePeerSnapshot({
        peerId: 'peer-combat',
        position: { x: 0, y: 0, z: 0 },
        rotationY: 0,
      }),
    ]);

    const effectsRoot = scene.children.find((c) => c.name === 'RemoteMultiplayerEffectsRoot') as THREE.Group;
    expect(effectsRoot).toBeDefined();

    // 1. Remote skill visual (slash ribbon + projectile + nova burst)
    manager.playRemoteSkillVisual(
      'peer-combat',
      'fire',
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 6, y: 0, z: 0 },
    );
    expect(spyHandle.triggerSlashTrail).toHaveBeenCalled();
    expect(effectsRoot.children.some((c) => c.name === 'RemoteSkillVisual_fire')).toBe(true);

    // 2. Paired clash: steps avatar toward midpoint (3, 0, 4), faces partner, and plays high_five_strike!
    const midpoint: Vec3 = { x: 3, y: 0, z: 4 };
    const expectedClashYaw = Math.atan2(3, 4);
    manager.triggerRemotePairedClash('peer-combat', midpoint);

    expect(spyHandle.playSocialEmote).toHaveBeenCalledWith('high_five_strike');
    expect(spyHandle.rig.root.rotation.y).toBeCloseTo(expectedClashYaw, 3);
    expect(spyHandle.rig.root.position.x).toBeGreaterThan(0.5);
    expect(spyHandle.rig.root.position.z).toBeGreaterThan(0.5);

    // 3. Spawn all 4 Tactical Ground Ping Pillars (Attack, Loot, Danger, Group)
    manager.spawnTacticalPing('peer-combat', 'Valkyrie', 'attack', { x: 8, y: 0, z: 2 });
    manager.spawnTacticalPing('peer-combat', 'Valkyrie', 'loot', { x: -4, y: 0, z: 6 });
    manager.spawnTacticalPing('peer-combat', 'Valkyrie', 'danger', { x: 12, y: 0, z: -5 });
    manager.spawnTacticalPing('peer-combat', 'Valkyrie', 'group', { x: 2, y: 0, z: -8 });

    expect(manager.getActiveTacticalPings()).toHaveLength(4);
    expect(effectsRoot.children.some((c) => c.name === 'TacticalPingPillar_attack')).toBe(true);
    expect(effectsRoot.children.some((c) => c.name === 'TacticalPingPillar_loot')).toBe(true);
    expect(effectsRoot.children.some((c) => c.name === 'TacticalPingPillar_danger')).toBe(true);
    expect(effectsRoot.children.some((c) => c.name === 'TacticalPingPillar_group')).toBe(true);

    // Advance beyond ping & skill VFX lifetime -> cleans up automatically
    for (let i = 0; i < 30; i++) {
      manager.update(0.22, i * 0.22, {}, () => ({ x: 640, y: 360, visible: true }));
    }
    expect(manager.getActiveTacticalPings()).toHaveLength(0);

    manager.dispose();
  });

  it('renders world-to-screen DOM overlays in #ui-multiplayer-layer: nameplates, green voice bars, comic speech bubbles, spring emojis, and off-screen edge arrows', () => {
    const spyA = createSpyRig('vanguard');
    const spyB = createSpyRig('arcanist');
    let count = 0;
    const manager = createRemoteAvatarManager(() => (++count === 1 ? spyA.rig : spyB.rig));
    manager.init(scene);

    manager.syncPeers([
      makePeerSnapshot({
        peerId: 'peer-onscreen',
        nickname: 'SirRoland',
        heroClass: 'vanguard',
        hp: 300,
        maxHp: 400,
        position: { x: 2, y: 0, z: 2 },
        downed: false,
      }),
      makePeerSnapshot({
        peerId: 'peer-downed-offscreen',
        nickname: 'Lyra',
        heroClass: 'arcanist',
        hp: 0,
        maxHp: 320,
        position: { x: -45, y: 0, z: -30 },
        downed: true,
        downedBleedoutSec: 14,
      }),
    ]);

    manager.showSpeechBubble('peer-onscreen', 'SirRoland', 'Rally at the cathedral gate!');
    manager.spawnEmojiBurst('peer-onscreen', 'crown_gg', { x: 2, y: 0, z: 2 });
    manager.spawnTacticalPing('peer-onscreen', 'SirRoland', 'danger', { x: 50, y: 0, z: 50 });

    const voiceStates: Record<string, PeerVoiceState> = {
      'peer-onscreen': {
        peerId: 'peer-onscreen',
        isSpeaking: true,
        voiceLevel: 0.85,
        mutedByLocal: false,
        volume: 1,
        connectedAudio: true,
      },
    };

    const projectFn = (pos: Vec3) => {
      if (pos.x < -20) {
        return { x: -180, y: 340, visible: false };
      }
      if (pos.x > 25) {
        return { x: 1480, y: 120, visible: false };
      }
      return { x: 620, y: 310, visible: true };
    };

    // Step spring physics across 10 frames (~83ms) to reach underdamped overshoot peak (> 1.0x scale)
    for (let f = 1; f <= 10; f++) {
      manager.update(1 / 120, f / 120, voiceStates, projectFn);
    }

    const overlayRoot = domEnv.mpLayer.children.find((el) =>
      el.classList.contains('ar-net-avatars-overlay'),
    );
    expect(overlayRoot).toBeDefined();

    // 1. Nameplate + Class Crest + HP bar + Animated Green Voice Soundwave Bars
    const nameplates = overlayRoot!.findAll((el) => el.classList.contains('ar-peer-nameplate'));
    const rolandPlate = nameplates.find((el) => el.getAttribute('data-peer-id') === 'peer-onscreen')!;
    expect(rolandPlate).toBeDefined();
    expect(rolandPlate.textContent).toContain('SirRoland');

    const hpFill = rolandPlate.findAll((el) => el.classList.contains('ar-peer-hp-fill'))[0];
    expect(hpFill.style.width).toBe('75.0%');

    const voiceBarsWrap = rolandPlate.findAll((el) => el.classList.contains('ar-peer-voice-bars'))[0];
    expect(voiceBarsWrap.classList.contains('is-speaking')).toBe(true);
    expect(voiceBarsWrap.style.display).toBe('inline-flex');
    const bars = voiceBarsWrap.findAll((el) => el.classList.contains('ar-voice-bar'));
    expect(bars).toHaveLength(4);
    expect(bars[0].style.height).toMatch(/%$/);

    // 2. 3D Comic Speech Bubble
    const speechBubble = overlayRoot!.findAll((el) => el.classList.contains('ar-speech-bubble'))[0];
    expect(speechBubble).toBeDefined();
    expect(speechBubble.textContent).toContain('Rally at the cathedral gate!');

    // 3. Bouncy Spring-Physics Overhead Emoji (verify real spring overshoot > 1.0!)
    const emojiBurst = overlayRoot!.findAll((el) => el.classList.contains('ar-emoji-burst'))[0];
    expect(emojiBurst).toBeDefined();
    expect(emojiBurst.getAttribute('data-emoji-id')).toBe('crown_gg');
    const scaleMatch = /scale\(([0-9.]+)\)/.exec(emojiBurst.style.transform);
    expect(scaleMatch).not.toBeNull();
    expect(Number(scaleMatch![1])).toBeGreaterThan(1.0);

    // 4. Off-Screen Edge Arrows for BOTH downed teammate AND off-screen tactical ping
    const offscreenArrows = overlayRoot!.findAll((el) => el.classList.contains('ar-offscreen-arrow'));
    expect(offscreenArrows.length).toBe(2);
    expect(offscreenArrows.some((a) => a.getAttribute('data-kind') === 'downed')).toBe(true);
    expect(offscreenArrows.some((a) => a.getAttribute('data-kind') === 'ping')).toBe(true);

    // Stop speaking -> green voice bars collapse cleanly
    voiceStates['peer-onscreen'].isSpeaking = false;
    manager.update(1 / 120, 0.2, voiceStates, projectFn);
    expect(voiceBarsWrap.classList.contains('is-speaking')).toBe(false);
    expect(voiceBarsWrap.style.display).toBe('none');

    manager.dispose();
    expect(domEnv.mpLayer.children).toHaveLength(0);
  });

  it('works with default createHeroRig factory and isolates remote rigs from local player EventBus broadcasts', () => {
    domEnv.cleanup(); // Also verify pure headless Node safety without document/window!
    const manager = createRemoteAvatarManager();
    manager.init(scene);

    manager.syncPeers([
      makePeerSnapshot({
        peerId: 'peer-real-rig',
        heroClass: 'arcanist',
        weaponVisual: 'staff',
        weaponRarity: 'legendary',
        awakened: true,
        activePet: 'void_kitsune',
      }),
    ]);

    // Emit local player EventBus events — remote HeroRig must remain isolated!
    eventBus.emit('hero:classChanged', { heroClass: 'vanguard' });
    eventBus.emit('hero:gearChanged', {
      slot: 'weapon',
      weaponVisual: 'daggers',
      rarity: 'common',
    });
    eventBus.emit('player:awakeningChanged', {
      active: false,
      position: { x: 0, y: 0, z: 0 },
    });

    expect(() => {
      manager.update(1 / 60, 0.5, {}, () => ({ x: 400, y: 300, visible: true }));
    }).not.toThrow();

    manager.dispose();
  });
});
