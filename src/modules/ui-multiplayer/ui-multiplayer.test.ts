import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MultiplayerUICallbacks,
  MultiplayerUISnapshot,
  NetChatMessage,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { MultiplayerUI, createMultiplayerUI } from './index';

class MockClassList {
  private tokens = new Set<string>();
  constructor(private owner: MockDomElement) {}

  syncFromString(cls: string): void {
    this.tokens.clear();
    for (const t of cls.split(/\s+/).filter(Boolean)) {
      this.tokens.add(t);
    }
  }

  add(...items: string[]): void {
    for (const item of items) {
      if (item) this.tokens.add(item);
    }
    this.owner._syncClassString();
  }

  remove(...items: string[]): void {
    for (const item of items) {
      this.tokens.delete(item);
    }
    this.owner._syncClassString();
  }

  toggle(token: string, force?: boolean): boolean {
    const next = force !== undefined ? force : !this.tokens.has(token);
    if (next) this.tokens.add(token);
    else this.tokens.delete(token);
    this.owner._syncClassString();
    return next;
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }

  toArray(): string[] {
    return [...this.tokens];
  }
}

class MockDomElement {
  public tagName: string;
  public id = '';
  public title = '';
  public type = '';
  public value = '';
  public placeholder = '';
  public maxLength = 524288;
  public min = '';
  public max = '';
  public step = '';
  public scrollTop = 0;
  public scrollHeight = 240;
  public children: MockDomElement[] = [];
  public parentElement: MockDomElement | null = null;
  public style: Record<string, any> = {};
  public classList: MockClassList;

  private _className = '';
  private _textContent = '';
  private _innerHTML = '';
  private listeners = new Map<string, Array<(ev: any) => void>>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    this.classList = new MockClassList(this);
  }

  get className(): string {
    return this._className;
  }

  set className(val: string) {
    this._className = val;
    this.classList.syncFromString(val);
  }

  _syncClassString(): void {
    this._className = this.classList.toArray().join(' ');
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

  appendChild<T extends MockDomElement>(child: T): T {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: MockDomElement[]): void {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  remove(): void {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  addEventListener(event: string, handler: (ev: any) => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(handler);
    this.listeners.set(event, arr);
  }

  removeEventListener(event: string, handler: (ev: any) => void): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(handler);
    if (idx >= 0) arr.splice(idx, 1);
  }

  dispatch(event: string, payload: Record<string, any> = {}): any {
    const ev = {
      type: event,
      target: this,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
      ...payload,
    };
    const arr = this.listeners.get(event) ?? [];
    for (const fn of [...arr]) {
      fn(ev);
    }
    return ev;
  }

  click(): void {
    this.dispatch('click');
  }

  focus(): void {
    this.dispatch('focus');
  }

  blur(): void {
    this.dispatch('blur');
  }

  findAllByClass(cls: string): MockDomElement[] {
    const result: MockDomElement[] = [];
    if (this.classList.contains(cls)) result.push(this);
    for (const child of this.children) {
      result.push(...child.findAllByClass(cls));
    }
    return result;
  }
}

class MockWindowTarget {
  public innerWidth = 1440;
  public innerHeight = 900;
  public location = {
    origin: 'https://abyssal-realms.example',
    pathname: '/',
    search: '?room=z9k4m2',
  };
  private listeners = new Map<string, Array<(ev: any) => void>>();

  addEventListener(event: string, handler: (ev: any) => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(handler);
    this.listeners.set(event, arr);
  }

  removeEventListener(event: string, handler: (ev: any) => void): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(handler);
    if (idx >= 0) arr.splice(idx, 1);
  }

  dispatch(event: string, payload: Record<string, any> = {}): any {
    const ev = {
      type: event,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
      ...payload,
    };
    const arr = this.listeners.get(event) ?? [];
    for (const fn of [...arr]) {
      fn(ev);
    }
    return ev;
  }

  listenerCount(event: string): number {
    return (this.listeners.get(event) ?? []).length;
  }
}

function createCallbacksMock(): {
  [K in keyof MultiplayerUICallbacks]: ReturnType<typeof vi.fn>;
} {
  return {
    onHostRoom: vi.fn(),
    onJoinRoom: vi.fn(),
    onLeaveRoom: vi.fn(),
    onSpawnBotPartner: vi.fn(),
    onTeleportToPeer: vi.fn(),
    onDropGiftForParty: vi.fn(),
    onSendChat: vi.fn(),
    onTriggerEmoji: vi.fn(),
    onTriggerEmote: vi.fn(),
    onTriggerPing: vi.fn(),
    onTriggerHighFive: vi.fn(),
    onToggleMicEnable: vi.fn(),
    onSetVoiceMode: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleDeafen: vi.fn(),
    onToggleSpatialAudio: vi.fn(),
    onSetPeerMuted: vi.fn(),
    onSetPeerVolume: vi.fn(),
  };
}

function createSampleSnapshot(): MultiplayerUISnapshot {
  return {
    connection: {
      connected: true,
      connecting: false,
      mode: 'webrtc_cloud',
      roomCode: 'K7X9Q2',
      localPeerId: 'peer-host',
      localNickname: 'Valerius',
      isHost: true,
      peerCount: 2,
    },
    peers: [
      {
        peerId: 'peer-seraphina',
        nickname: 'Seraphina',
        isHost: false,
        isSimulated: true,
        heroClass: 'arcanist',
        level: 12,
        hp: 340,
        maxHp: 500,
        position: { x: 4, y: 0, z: 6 },
        velocity: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        animState: 'idle',
        weaponVisual: 'staff',
        weaponRarity: 'legendary',
        awakened: true,
        downed: false,
        pingMs: 38,
      },
      {
        peerId: 'peer-kaelen',
        nickname: 'Kaelen',
        isHost: false,
        heroClass: 'shadowblade',
        level: 11,
        hp: 25,
        maxHp: 420,
        position: { x: -3, y: 0, z: 5 },
        velocity: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        animState: 'hit',
        weaponVisual: 'daggers',
        awakened: false,
        downed: true,
        downedBleedoutSec: 9.4,
        pingMs: 142,
      },
    ],
    localVoice: {
      micEnabled: true,
      micPermission: 'granted',
      mode: 'ptt',
      pttActive: false,
      muted: false,
      deafened: false,
      spatialAudio: true,
      isSpeaking: true,
      voiceLevel: 0.72,
    },
    peerVoice: {
      'peer-seraphina': {
        peerId: 'peer-seraphina',
        isSpeaking: true,
        voiceLevel: 0.84,
        mutedByLocal: false,
        volume: 1.25,
        connectedAudio: true,
      },
      'peer-kaelen': {
        peerId: 'peer-kaelen',
        isSpeaking: false,
        voiceLevel: 0,
        mutedByLocal: true,
        volume: 0.8,
        connectedAudio: true,
      },
    },
    socialBuff: {
      swornBrethrenSec: 46.2,
      xpGoldMultiplier: 1.25,
      moveSpeedBonus: 1.15,
      powerMultiplier: 1.2,
    },
    downedState: {
      isDowned: false,
      bleedoutRemainingSec: 15,
      bleedoutTotalSec: 15,
      reviveProgress01: 0,
    },
    nearbyInviteName: 'Seraphina',
  };
}

describe('MultiplayerUI', () => {
  let headEl: MockDomElement;
  let layerEl: MockDomElement;
  let mockWin: MockWindowTarget;
  let clipboardSpy: ReturnType<typeof vi.fn>;
  let callbacks: ReturnType<typeof createCallbacksMock>;

  beforeEach(() => {
    headEl = new MockDomElement('head');
    layerEl = new MockDomElement('div');
    layerEl.id = 'ui-multiplayer-layer';
    mockWin = new MockWindowTarget();
    clipboardSpy = vi.fn().mockResolvedValue(undefined);
    callbacks = createCallbacksMock();

    (globalThis as any).document = {
      head: headEl,
      createElement: (tag: string) => new MockDomElement(tag),
      getElementById: (id: string) => headEl.children.find((c) => c.id === id) ?? null,
    };
    (globalThis as any).window = mockWin;
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: clipboardSpy } },
      configurable: true,
    });
    eventBus.clear();
  });

  afterEach(() => {
    eventBus.clear();
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it('mounts Top-Bar CO-OP [P] pill, opens/closes Online Lobby via Key P & EventBus, and wires Transport/Host/Join/Bot/Copy/Roster actions', () => {
    const ui = createMultiplayerUI();
    expect(ui).toBeInstanceOf(MultiplayerUI);

    ui.mount(layerEl as unknown as HTMLElement, callbacks);
    expect(headEl.children.length).toBe(1);
    expect(layerEl.children.length).toBe(1);
    expect(ui.isLobbyOpen()).toBe(false);

    const root = layerEl.children[0];

    // URL ?room=z9k4m2 auto-prefills Join Room Code input in uppercase
    const joinInput = root.findAllByClass('mp-join-code-input')[0];
    expect(joinInput.value).toBe('Z9K4M2');

    // Toggle Lobby via Key P and EventBus 'mp:openLobby'
    mockWin.dispatch('keydown', { key: 'p' });
    expect(ui.isLobbyOpen()).toBe(true);
    mockWin.dispatch('keydown', { key: 'Escape' });
    expect(ui.isLobbyOpen()).toBe(false);

    eventBus.emit('mp:openLobby', {});
    expect(ui.isLobbyOpen()).toBe(true);

    // Switch transport tab to Relay Server (wss://) -> reveals relay input & passes relayUrl to Host/Join
    const relayTab = root.findAllByClass('mp-tab-websocket_relay')[0];
    relayTab.click();
    expect(relayTab.classList.contains('is-selected')).toBe(true);

    const nickInput = root.findAllByClass('mp-nickname-input')[0];
    nickInput.value = 'DragonSlayer';
    nickInput.dispatch('input');

    const relayInput = root.findAllByClass('mp-relay-input')[0];
    relayInput.value = 'wss://relay.abyssal.gg';

    root.findAllByClass('mp-host-btn')[0].click();
    expect(callbacks.onHostRoom).toHaveBeenCalledWith(
      'websocket_relay',
      'DragonSlayer',
      'wss://relay.abyssal.gg',
    );

    root.findAllByClass('mp-join-btn')[0].click();
    expect(callbacks.onJoinRoom).toHaveBeenCalledWith(
      'Z9K4M2',
      'websocket_relay',
      'DragonSlayer',
      'wss://relay.abyssal.gg',
    );

    // Spawn AI Bot Partner CTA
    root.findAllByClass('mp-spawn-bot-btn')[0].click();
    expect(callbacks.onSpawnBotPartner).toHaveBeenCalledTimes(1);

    // Live 4-player Roster & Room Code Copy buttons
    const snap = createSampleSnapshot();
    ui.update(0.016, snap);

    const pill = root.findAllByClass('mp-coop-trigger-pill')[0];
    expect(pill.textContent).toContain('3/4');
    expect(pill.textContent).toContain('K7X9Q2');

    const codeDisplay = root.findAllByClass('mp-room-code-display')[0];
    expect(codeDisplay.textContent).toBe('K7X9Q2');

    root.findAllByClass('mp-copy-code-btn')[0].click();
    expect(clipboardSpy).toHaveBeenCalledWith('K7X9Q2');

    root.findAllByClass('mp-copy-link-btn')[0].click();
    expect(clipboardSpy).toHaveBeenCalledWith('https://abyssal-realms.example/?room=K7X9Q2');

    // Roster has 1 local + 2 peers + 1 empty placeholder = 4 slots
    const rosterGrid = root.findAllByClass('mp-roster-grid')[0];
    expect(rosterGrid.children.length).toBe(4);

    // Per-peer Mute, 0%-200% Volume Slider, Teleport to Ally, and Drop Gift (100g / Potion)
    const peerMuteBtns = root.findAllByClass('mp-peer-mute-btn');
    peerMuteBtns[0].click(); // Seraphina was unmuted -> mute true
    expect(callbacks.onSetPeerMuted).toHaveBeenCalledWith('peer-seraphina', true);

    const sliders = root.findAllByClass('mp-peer-vol-slider');
    sliders[0].value = '175';
    sliders[0].dispatch('input');
    expect(callbacks.onSetPeerVolume).toHaveBeenCalledWith('peer-seraphina', 1.75);

    root.findAllByClass('mp-teleport-btn')[0].click();
    expect(callbacks.onTeleportToPeer).toHaveBeenCalledWith('peer-seraphina');

    root.findAllByClass('mp-card-gift-gold-btn')[0].click();
    root.findAllByClass('mp-card-gift-potion-btn')[0].click();
    expect(callbacks.onDropGiftForParty).toHaveBeenNthCalledWith(1, 'gold');
    expect(callbacks.onDropGiftForParty).toHaveBeenNthCalledWith(2, 'potion');

    root.findAllByClass('mp-leave-btn')[0].click();
    expect(callbacks.onLeaveRoom).toHaveBeenCalledTimes(1);

    ui.dispose();
    expect(layerEl.children.length).toBe(0);
    expect(headEl.children.length).toBe(0);
    expect(mockWin.listenerCount('keydown')).toBe(0);
  });

  it('renders Top-Left Co-op Party HUD Frames, Speaking Ring, Downed Revive Badge, Sworn Brethren Buff, Voice Dock, and Local Bleedout Overlay', () => {
    const ui = createMultiplayerUI();
    ui.mount(layerEl as unknown as HTMLElement, callbacks);
    const root = layerEl.children[0];

    const snap = createSampleSnapshot();
    ui.update(0.016, snap);

    // Party frames: Seraphina speaking emerald ring, Kaelen downed crimson 🆘 CỨU ĐỒNG ĐỘI [F]!
    const partyFrames = root.findAllByClass('mp-party-frame');
    expect(partyFrames.length).toBe(2);
    expect(partyFrames[0].classList.contains('is-speaking')).toBe(true);
    expect(partyFrames[0].textContent).toContain('Seraphina');

    expect(partyFrames[1].classList.contains('is-downed')).toBe(true);
    expect(partyFrames[1].textContent).toContain('🆘 CỨU ĐỒNG ĐỘI [F]!');

    // Sworn Brethren Co-op Buff active
    const swornBadge = root.findAllByClass('mp-sworn-buff-badge')[0];
    expect(swornBadge.classList.contains('is-visible')).toBe(true);
    expect(swornBadge.textContent).toContain('47s');
    expect(swornBadge.textContent).toContain('+25% XP/Gold');

    // [H] High-Five / Đập Kiếm prompt banner visible when nearbyInviteName is present
    const hfBanner = root.findAllByClass('mp-highfive-banner')[0];
    expect(hfBanner.classList.contains('is-visible')).toBe(true);
    expect(hfBanner.textContent).toContain('Seraphina');
    hfBanner.click();
    expect(callbacks.onTriggerHighFive).toHaveBeenCalledTimes(1);

    // Voice Control Dock buttons
    root.findAllByClass('mp-mic-enable-btn')[0].click();
    root.findAllByClass('mp-mic-mute-btn')[0].click();
    root.findAllByClass('mp-voice-mode-btn')[0].click();
    root.findAllByClass('mp-deafen-btn')[0].click();
    root.findAllByClass('mp-spatial-btn')[0].click();

    expect(callbacks.onToggleMicEnable).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(1);
    expect(callbacks.onSetVoiceMode).toHaveBeenCalledWith('open_mic');
    expect(callbacks.onToggleDeafen).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleSpatialAudio).toHaveBeenCalledTimes(1);

    // Local Player Downed Bleedout Overlay + Savior Revive Channel Progress
    snap.downedState = {
      isDowned: true,
      bleedoutRemainingSec: 11.2,
      bleedoutTotalSec: 15,
      reviveProgress01: 0.65,
      reviverName: 'Seraphina',
    };
    ui.update(0.016, snap);

    const downedOverlay = root.findAllByClass('mp-local-downed-overlay')[0];
    expect(downedOverlay.classList.contains('is-visible')).toBe(true);
    expect(downedOverlay.textContent).toContain('11.2s');
    expect(downedOverlay.textContent).toContain('Seraphina đang cứu bạn... (65%)');

    root.findAllByClass('mp-sos-call-btn')[0].click();
    expect(callbacks.onTriggerEmoji).toHaveBeenCalledWith('sos_help');
    expect(callbacks.onTriggerPing).toHaveBeenCalledWith('danger');

    ui.dispose();
  });

  it('handles Party Chat focus/send/Esc, blocks hotkeys while typing, formats 4 channels, fires 12-Emoji Bar & slash commands', () => {
    const ui = createMultiplayerUI();
    ui.mount(layerEl as unknown as HTMLElement, callbacks);
    const root = layerEl.children[0];

    expect(ui.isChatFocused()).toBe(false);

    // Press Enter -> focuses chat input -> isChatFocused() becomes true
    mockWin.dispatch('keydown', { key: 'Enter' });
    expect(ui.isChatFocused()).toBe(true);

    // While chat is focused, pressing 'p' or 'h' or 'g' on window MUST NOT open lobby / wheel / high-five
    mockWin.dispatch('keydown', { key: 'p' });
    mockWin.dispatch('keydown', { key: 'h' });
    mockWin.dispatch('keydown', { key: 'g' });
    expect(ui.isLobbyOpen()).toBe(false);
    expect(callbacks.onTriggerHighFive).not.toHaveBeenCalled();

    // Type regular chat message and press Enter on input -> sends & blurs
    const chatInput = root.findAllByClass('mp-chat-input')[0];
    chatInput.value = 'Tập trung đánh Boss Malakor anh em ơi!';
    chatInput.dispatch('keydown', { key: 'Enter' });
    expect(callbacks.onSendChat).toHaveBeenCalledWith('Tập trung đánh Boss Malakor anh em ơi!');
    expect(ui.isChatFocused()).toBe(false);

    // Slash commands: /wave, /dance, /cheer, /taunt, /sit, /pray, /highfive
    const slashCases: Array<[string, string]> = [
      ['/wave', 'wave'],
      ['/dance', 'dance'],
      ['/cheer', 'cheer'],
      ['/taunt', 'taunt'],
      ['/sit', 'sit_rest'],
      ['/pray', 'kneel_pray'],
    ];
    for (const [cmd, expectedEmote] of slashCases) {
      chatInput.focus();
      chatInput.value = cmd;
      chatInput.dispatch('keydown', { key: 'Enter' });
      expect(callbacks.onTriggerEmote).toHaveBeenLastCalledWith(expectedEmote);
    }

    chatInput.focus();
    expect(ui.isChatFocused()).toBe(true);
    chatInput.value = '/highfive';
    chatInput.dispatch('keydown', { key: 'Enter' });
    expect(callbacks.onTriggerHighFive).toHaveBeenCalledTimes(1);

    // Escape blurs chat without sending
    chatInput.focus();
    chatInput.value = 'draft text';
    mockWin.dispatch('keydown', { key: 'Escape' });
    expect(ui.isChatFocused()).toBe(false);
    expect(callbacks.onSendChat).toHaveBeenCalledTimes(1);

    // 12-Emoji Quick Bar
    const emojiPills = root.findAllByClass('mp-emoji-pill');
    expect(emojiPills.length).toBe(12);
    emojiPills[0].click(); // 👑 GG -> crown_gg
    expect(callbacks.onTriggerEmoji).toHaveBeenCalledWith('crown_gg');
    emojiPills[1].click(); // 🔥 -> fire_hype
    expect(callbacks.onTriggerEmoji).toHaveBeenCalledWith('fire_hype');

    // Append [Party], [Emote], [Loot], [System] messages
    const sampleMsgs: NetChatMessage[] = [
      {
        id: 'm1',
        senderId: 'p1',
        senderName: 'Seraphina',
        heroClass: 'arcanist',
        channel: 'party',
        text: 'Ready!',
        timestamp: 1,
      },
      {
        id: 'm2',
        senderId: 'p1',
        senderName: 'Seraphina',
        heroClass: 'arcanist',
        channel: 'emote',
        text: 'dances joyfully!',
        timestamp: 2,
      },
      {
        id: 'm3',
        senderId: 'p2',
        senderName: 'Kaelen',
        heroClass: 'shadowblade',
        channel: 'loot',
        text: 'Obtained Crown of Eternity',
        rarity: 'legendary',
        isMythic: true,
        timestamp: 3,
      },
      {
        id: 'm4',
        senderId: 'sys',
        senderName: '',
        heroClass: 'vanguard',
        channel: 'system',
        text: 'Sworn Brethren activated!',
        timestamp: 4,
      },
    ];
    for (const m of sampleMsgs) ui.appendChatMessage(m);

    const chatLines = root.findAllByClass('mp-chat-line');
    expect(chatLines.length).toBe(4);
    expect(chatLines[0].textContent).toContain('[Đội]');
    expect(chatLines[1].textContent).toContain('[Biểu Cảm]');
    expect(chatLines[2].textContent).toContain('[Chiến Lợi Phẩm]');
    expect(chatLines[3].textContent).toContain('[Hệ Thống]');

    ui.dispose();
  });

  it('supports 8-Slice Radial Emote/Emoji Wheel (Hold Key G / Key B), Key H High-Five, and Alt + Click Tactical Pings', () => {
    const ui = createMultiplayerUI();
    ui.mount(layerEl as unknown as HTMLElement, callbacks);
    const root = layerEl.children[0];

    // Hold Key G -> opens 8-Slice Emote Wheel -> move mouse East (slice 2 = 'dance') -> release Key G
    mockWin.dispatch('keydown', { key: 'g' });
    const wheelBackdrop = root.findAllByClass('mp-radial-wheel-backdrop')[0];
    expect(wheelBackdrop.classList.contains('is-open')).toBe(true);
    expect(root.findAllByClass('mp-wheel-slice').length).toBe(8);

    // Center of 1440x900 is (720, 450); moving East to (840, 450) selects octant 2 ('dance')
    mockWin.dispatch('pointermove', { clientX: 840, clientY: 450 });
    mockWin.dispatch('keyup', { key: 'g' });
    expect(callbacks.onTriggerEmote).toHaveBeenCalledWith('dance');
    expect(wheelBackdrop.classList.contains('is-open')).toBe(false);

    // Hold Key B -> opens 8-Slice Emoji Wheel -> move mouse North (slice 0 = 'crown_gg') -> release Key B
    mockWin.dispatch('keydown', { key: 'b' });
    expect(wheelBackdrop.classList.contains('is-open')).toBe(true);
    mockWin.dispatch('pointermove', { clientX: 720, clientY: 320 });
    mockWin.dispatch('keyup', { key: 'b' });
    expect(callbacks.onTriggerEmoji).toHaveBeenCalledWith('crown_gg');

    // Alt + Drag South -> triggers 'danger' Tactical Ping
    mockWin.dispatch('pointerdown', { altKey: true, button: 0, clientX: 600, clientY: 400 });
    mockWin.dispatch('pointermove', { clientX: 600, clientY: 470 });
    mockWin.dispatch('pointerup', { clientX: 600, clientY: 470 });
    expect(callbacks.onTriggerPing).toHaveBeenCalledWith('danger');

    // Key H -> triggers High-Five
    mockWin.dispatch('keydown', { key: 'h' });
    expect(callbacks.onTriggerHighFive).toHaveBeenCalledTimes(1);

    ui.dispose();
  });
});
