import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenusCallbacks, MenusRefreshContext } from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { MenusUI, createMenusUI } from './index';

class SimpleMockElement {
  public tagName: string;
  public id = '';
  public className = '';
  public textContent = '';
  private _innerHTML = '';
  public children: SimpleMockElement[] = [];
  public parentElement: SimpleMockElement | null = null;
  public dataset: Record<string, string> = {};
  private selectorProxies = new Map<string, SimpleMockElement>();
  private listeners = new Map<string, Array<(ev?: any) => void>>();
  public style: Record<string, any> = {
    setProperty: vi.fn(),
  };

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    this.selectorProxies.clear();
  }

  public classList = {
    add: (...tokens: string[]) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const t of tokens) set.add(t);
      this.className = [...set].join(' ');
    },
    remove: (...tokens: string[]) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const t of tokens) set.delete(t);
      this.className = [...set].join(' ');
    },
    contains: (token: string) =>
      this.className.split(/\s+/).filter(Boolean).includes(token),
  };

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  appendChild<T extends SimpleMockElement>(child: T): T {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  addEventListener(event: string, fn: (ev?: any) => void): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(fn);
    this.listeners.set(event, arr);
  }

  click(): void {
    for (const fn of this.listeners.get('click') ?? []) {
      fn({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    }
  }

  querySelector(selector: string): SimpleMockElement | null {
    const attrMatch = selector.match(/^\[([a-z0-9-]+)="([^"]+)"\]$/i);
    if (attrMatch) {
      const needle = `${attrMatch[1]}="${attrMatch[2]}"`;
      if (this._innerHTML.includes(needle)) {
        let proxy = this.selectorProxies.get(selector);
        if (!proxy) {
          proxy = new SimpleMockElement('button');
          this.selectorProxies.set(selector, proxy);
        }
        return proxy;
      }
    }
    return null;
  }

  querySelectorAll(): SimpleMockElement[] {
    return [];
  }
}

function createSampleContext(hasSaveGame = true): MenusRefreshContext {
  return {
    hasSaveGame,
    player: {
      id: 'player',
      heroClass: 'vanguard',
      name: 'Valerius',
      level: 6,
      xp: 310,
      xpToNextLevel: 500,
      unspentSkillPoints: 2,
      unspentAttributePoints: 3,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      facingDir: { x: 0, y: 0, z: 1 },
      rotationY: 0,
      radius: 0.5,
      hp: 260,
      mana: 90,
      stamina: 100,
      baseAttributes: { strength: 20, dexterity: 11, intelligence: 8, vitality: 18 },
      stats: {
        maxHp: 320,
        hpRegen: 3.2,
        maxMana: 110,
        manaRegen: 4.5,
        maxStamina: 100,
        staminaRegen: 18,
        moveSpeed: 6.2,
        attackPower: 48,
        spellPower: 16,
        armor: 64,
        critChance: 0.14,
        critMultiplier: 1.85,
        attackSpeed: 1.12,
        cooldownReduction: 0.08,
        lifeSteal: 0.04,
        dodgeChance: 0.07,
      },
      statuses: [],
      isDodging: false,
      invulnerableSec: 0,
      alive: true,
      healthPotions: 4,
      maxHealthPotions: 5,
      potionCooldownSec: 0,
      gold: 1250,
      floorsCleared: 2,
      killsTotal: 94,
    },
    inventory: [
      {
        id: 'itm_1',
        name: 'Soulreaver Greatsword',
        slot: 'weapon',
        rarity: 'legendary',
        levelReq: 5,
        itemLevel: 7,
        upgradeLevel: 3,
        weaponVisual: 'greatsword',
        affixes: [{ label: 'Attack Power', statKey: 'attackPower', value: 32 }],
        legendaryPower: {
          id: 'soulreaver',
          description: 'Critical strikes unleash a crimson shockwave.',
        },
        goldValue: 480,
        icon: 'greatsword',
      },
    ],
    equipped: {
      helmet: {
        id: 'eq_helm',
        name: 'Iron Crown',
        slot: 'helmet',
        rarity: 'rare',
        levelReq: 2,
        itemLevel: 4,
        upgradeLevel: 1,
        affixes: [{ label: 'Armor', statKey: 'armor', value: 18 }],
        goldValue: 110,
        icon: 'helmet',
      },
    },
    passiveNodes: [
      {
        id: 'warlord_might',
        name: 'Oath of Iron',
        description: '+4 Strength per rank',
        branch: 'warlord',
        isKeystone: false,
        position: { x: 0, y: -64 },
        prerequisites: [],
        maxRank: 3,
        statModifiers: { strength: 4 },
      },
      {
        id: 'blood_pact',
        name: 'Keystone: Blood Pact',
        description: '+90 Max HP, +8% Life Steal',
        branch: 'warlord',
        isKeystone: true,
        position: { x: 0, y: -220 },
        prerequisites: ['warlord_might'],
        maxRank: 1,
        statModifiers: { maxHp: 90, lifeSteal: 0.08 },
        specialKeystoneId: 'blood_pact',
      },
    ],
    allocatedPassives: { warlord_might: 2, blood_pact: 1 },
    quests: [
      {
        id: 'q1',
        title: 'Shatter the Ossuary Seal',
        isMainQuest: true,
        description: 'Slay the Bone Colossus',
        floorNumber: 1,
        objectives: [
          {
            id: 'o1',
            description: 'Defeat Bone Colossus',
            current: 0,
            required: 1,
            completed: false,
          },
        ],
        status: 'active',
        xpReward: 400,
        goldReward: 250,
      },
    ],
    lore: [
      {
        id: 'lore_1',
        title: 'Oath of the First King',
        biome: 'crypt',
        text: 'Before the Crown shattered, four wardens held the seal.',
        unlocked: true,
      },
    ],
    achievements: [
      {
        id: 'ach_1',
        title: 'First Blood',
        description: 'Slay your first abyssal monster.',
        unlocked: true,
      },
    ],
    settings: {
      masterVolume: 0.8,
      musicVolume: 0.55,
      sfxVolume: 0.85,
      graphicsQuality: 'high',
      cameraSensitivity: 1.0,
      showDamageNumbers: true,
    },
  };
}

describe('MenusUI', () => {
  let headEl: SimpleMockElement;
  let hostEl: SimpleMockElement;
  let callbacks: MenusCallbacks;

  beforeEach(() => {
    headEl = new SimpleMockElement('head');
    hostEl = new SimpleMockElement('div');

    (globalThis as any).document = {
      head: headEl,
      createElement: (tag: string) => new SimpleMockElement(tag),
      getElementById: (id: string) =>
        headEl.children.find((c) => c.id === id) ?? null,
      querySelectorAll: (sel: string) => {
        if (sel === '.ar-menus-root') {
          return hostEl.children.filter((c) => c.classList.contains('ar-menus-root'));
        }
        return [];
      },
    };
    (globalThis as any).window = {
      innerWidth: 1440,
      innerHeight: 900,
      screen: { width: 1440, height: 900 },
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    };

    callbacks = {
      onStartNewGame: vi.fn(),
      onContinueGame: vi.fn(),
      onResumeGame: vi.fn(),
      onRespawnOrRetry: vi.fn(),
      onReturnToTitle: vi.fn(),
      onEquipItem: vi.fn(),
      onUnequipSlot: vi.fn(),
      onSalvageItem: vi.fn(),
      onUpgradeItem: vi.fn(),
      onSpendAttribute: vi.fn(),
      onAllocatePassive: vi.fn(),
      onResetPassives: vi.fn(),
      onSettingsChange: vi.fn(),
      onOpenMultiplayerLobby: vi.fn(),
    };
  });

  afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it('implements IMenusUI lifecycle, renders all 8 panels, toggles cleanly, and disposes', () => {
    const menus = createMenusUI();
    expect(menus).toBeInstanceOf(MenusUI);
    expect(menus.getActivePanel()).toBe('none');
    expect(menus.isBlockingGameplayInput()).toBe(false);

    menus.mount(hostEl as unknown as HTMLElement, callbacks);
    expect(headEl.children.length).toBe(1);
    expect(hostEl.children.length).toBe(1);

    const root = hostEl.children[0];
    expect(root.classList.contains('is-hidden')).toBe(true);

    // 1. Title screen with save game
    menus.refresh(createSampleContext(true));
    menus.openPanel('title');
    expect(menus.getActivePanel()).toBe('title');
    expect(menus.isBlockingGameplayInput()).toBe(true);
    expect(root.innerHTML).toContain('Vực Thẳm Huyền Bí');
    expect(root.innerHTML).toContain('Vanguard');
    expect(root.innerHTML).toContain('Shadowblade');
    expect(root.innerHTML).toContain('Arcanist');
    expect(root.innerHTML).toContain('✦ Tiếp Tục');
    expect(root.innerHTML).toContain('Hướng Dẫn Điều Khiển');

    // Without save game hides Continue Journey
    menus.refresh(createSampleContext(false));
    expect(root.innerHTML).not.toContain('✦ Tiếp Tục');

    // 2. Inventory & Blacksmith panel
    menus.togglePanel('inventory');
    expect(menus.getActivePanel()).toBe('inventory');
    expect(root.innerHTML).toContain('Soulreaver Greatsword');
    expect(root.innerHTML).toContain('Đe Thợ Rèn');
    expect(root.innerHTML).toContain('Điểm Thuộc Tính Chưa Dùng');

    menus.togglePanel('inventory');
    expect(menus.getActivePanel()).toBe('none');
    expect(menus.isBlockingGameplayInput()).toBe(false);

    // 3. Constellation Skills panel
    menus.openPanel('skills');
    expect(menus.getActivePanel()).toBe('skills');
    expect(root.innerHTML).toContain('Chòm Sao Tinh Tú');
    expect(root.innerHTML).toContain('Đặt Lại Chòm Sao');
    expect(root.innerHTML).toContain('Keystone: Blood Pact');

    // 4. Journal & Lore Codex panel
    menus.openPanel('quests');
    expect(root.innerHTML).toContain('Shatter the Ossuary Seal');
    expect(root.innerHTML).toContain('Truyện Lore');
    expect(root.innerHTML).toContain('Thành Tích');

    // 5. Settings (including DLSS Super-Resolution, Sharpness, 120Hz Target FPS & Dynamic Res), Pause, Death, Victory
    menus.openPanel('settings');
    expect(root.innerHTML).toContain('Thiết Lập Chất Lượng Đồ Họa');
    expect(root.innerHTML).toContain('Chế Độ Siêu Phân Giải DLSS');
    expect(root.innerHTML).toContain('data-dlss-mode="ultra_performance"');
    expect(root.innerHTML).toContain('Độ Sắc Nét Tái Tạo DLSS');
    expect(root.innerHTML).toContain('120 Hz');
    expect(root.innerHTML).toContain('144 Hz');
    expect(root.innerHTML).toContain('Không Giới Hạn');
    expect(root.innerHTML).toContain('Độ Phân Giải Động 120Hz');
    expect(root.innerHTML).toContain('Thiết bị được phát hiện');

    menus.openPanel('pause');
    expect(root.innerHTML).toContain('Tiếp Tục Thám Hiểm');

    menus.openPanel('death');
    expect(root.innerHTML).toContain('Bạn Đã Ngã Xuống');

    menus.openPanel('victory');
    expect(root.innerHTML).toContain('Chiến Thắng Thăng Hoa');

    // Clean disposal
    menus.dispose();
    expect(hostEl.children.length).toBe(0);
    expect(headEl.children.length).toBe(0);
    expect(menus.getActivePanel()).toBe('none');
  });

  it('triggers equip shockwaves, green/red stat pops, and Blacksmith anvil spark bursts on live updates', () => {
    const menus = createMenusUI();
    menus.mount(hostEl as unknown as HTMLElement, callbacks);
    const root = hostEl.children[0];

    const ctx1 = createSampleContext(true);
    menus.refresh(ctx1);
    menus.openPanel('inventory');
    expect(root.innerHTML).toContain('is-entering');
    expect(root.innerHTML).not.toContain('ar-slot-shockwave');

    // Simulate equipping weapon + upgrading helmet + stat gain & armor drop
    const ctx2 = createSampleContext(true);
    ctx2.equipped.weapon = ctx2.inventory[0];
    ctx2.inventory = [];
    ctx2.equipped.helmet!.upgradeLevel = 2; // Upgraded +1 -> +2!
    ctx2.player.stats.attackPower = 80; // +32 green pop!
    ctx2.player.stats.armor = 50; // -14 red pop!

    menus.refresh(ctx2);

    expect(root.innerHTML).toContain('ar-slot-shockwave');
    expect(root.innerHTML).toContain('ar-anvil-spark-burst');
    expect(root.innerHTML).toContain('is-forging');
    expect(root.innerHTML).toContain('ar-stat-pop-up');
    expect(root.innerHTML).toContain('ar-stat-pop-down');
    expect(root.innerHTML).toContain('+32');
    expect(root.innerHTML).toContain('-14');

    menus.dispose();
  });

  it('renders Phase 3 Sanctuary sub-tabs, Mythic/Set/Socket visuals, Obelisk draft, and Waypoint Atlas', () => {
    const menus = createMenusUI() as MenusUI;
    menus.mount(hostEl as unknown as HTMLElement, callbacks);
    const root = hostEl.children[0];

    const ctx = createSampleContext(true);
    ctx.inventory[0].isMythic = true;
    ctx.inventory[0].sockets = 3;
    ctx.inventory[0].socketedRunes = ['sol', 'vex', 'lo'];
    ctx.inventory[0].runewordName = 'Grief of Kings';
    ctx.equipped.helmet!.setName = 'Bulwark of the Shattered King';
    ctx.stash = [
      {
        id: 'stash_1',
        name: 'Vaulted Voidblade',
        slot: 'weapon',
        rarity: 'epic',
        levelReq: 4,
        itemLevel: 6,
        upgradeLevel: 0,
        affixes: [{ label: 'Attack Power', statKey: 'attackPower', value: 22 }],
        goldValue: 300,
        icon: 'daggers',
      },
    ];
    ctx.highestFloorUnlocked = 6;
    ctx.colosseumBestWave = 9;
    ctx.obeliskChoices = [
      {
        id: 'pact_1',
        title: 'Pact of Bloodthunder',
        blessingText: '+40% Crit Multiplier',
        curseText: '+15% Damage Taken',
        tone: 'crimson',
        statModifiers: { critMultiplier: 0.4 },
      },
      {
        id: 'pact_2',
        title: 'Oath of Starfire',
        blessingText: 'Chain Lightning on Crit',
        curseText: '-30 Max HP',
        tone: 'arcane',
        statModifiers: { maxHp: -30 },
        critChainLightning: true,
      },
      {
        id: 'pact_3',
        title: 'Gilded Covenant',
        blessingText: '+80% Gold Find',
        curseText: 'Elite Ambush',
        tone: 'gold',
        statModifiers: { critChance: 0.08 },
        spawnEliteAmbush: true,
      },
    ];

    menus.refresh(ctx);
    menus.openPanel('inventory');
    expect(root.innerHTML).toContain('is-mythic');
    expect(root.innerHTML).toContain('is-set-item');
    expect(root.innerHTML).toContain('ar-item-sockets-row');

    // Runeword & Socket Bench sub-tab
    menus.openInventoryTab('runewords');
    expect(root.innerHTML).toContain('Bàn Gắn Đá Rune');
    expect(root.innerHTML).toContain('Túi Đá Rune');
    expect(root.innerHTML).toContain('Grief of Kings');

    // Shared Stash sub-tab
    menus.openInventoryTab('stash');
    expect(root.innerHTML).toContain('Kho Chứa Chung Pháo Đài');
    expect(root.innerHTML).toContain('Vaulted Voidblade');

    // Mystery Gambler & Blood Altar sub-tab
    menus.openInventoryTab('gambler');
    expect(root.innerHTML).toContain('Thương Nhân Cổ Vật Bí Ẩn');
    expect(root.innerHTML).toContain('Bàn Thờ Máu Đỏ Thẫm');

    // Companions sub-tab
    menus.openInventoryTab('companions');
    expect(root.innerHTML).toContain('Thú Cưng Tinh Tú');
    expect(root.innerHTML).toContain('Lính Đánh Thuê Thề Ước');

    // Corrupted Obelisk 3-card roguelike draft modal
    menus.openPanel('obelisk');
    expect(menus.getActivePanel()).toBe('obelisk');
    expect(root.innerHTML).toContain('Tảng Đá Thần Tha Hóa');
    expect(root.innerHTML).toContain('Pact of Bloodthunder');
    expect(root.innerHTML).toContain('Oath of Starfire');
    expect(root.innerHTML).toContain('Gilded Covenant');

    // Waypoint Atlas world_map modal
    menus.openPanel('world_map');
    expect(menus.getActivePanel()).toBe('world_map');
    expect(root.innerHTML).toContain('Pháo Đài Những Người Đã Ngã');
    expect(root.innerHTML).toContain('Tháp Băng Giá');
    expect(root.innerHTML).toContain('Thư Viện Huyền Bí');
    expect(root.innerHTML).toContain('Vườn Tà Độc');
    expect(root.innerHTML).toContain('Đợt Cao Nhất: 9');

    menus.dispose();
  });

  it('renders ONLINE CO-OP (KHÁC MẠNG / P2P) CTA on Title & Pause and fires callback + mp:openLobby event', () => {
    const menus = createMenusUI();
    menus.mount(hostEl as unknown as HTMLElement, callbacks);
    const root = hostEl.children[0];

    let mpOpenLobbyCount = 0;
    const unsub = eventBus.on('mp:openLobby', () => {
      mpOpenLobbyCount += 1;
    });

    // 1. Title screen Co-op CTA
    menus.openPanel('title');
    expect(root.innerHTML).toContain('ONLINE CO-OP (KHÁC MẠNG / P2P)');
    const titleCoopBtn = root.querySelector('[data-action="open-coop-lobby"]');
    expect(titleCoopBtn).not.toBeNull();
    titleCoopBtn?.click();
    expect(callbacks.onOpenMultiplayerLobby).toHaveBeenCalledTimes(1);
    expect(mpOpenLobbyCount).toBe(1);

    // 2. Pause menu Co-op CTA
    menus.openPanel('pause');
    expect(root.innerHTML).toContain('ONLINE CO-OP (KHÁC MẠNG / P2P)');
    const pauseCoopBtn = root.querySelector('[data-action="open-coop-lobby"]');
    expect(pauseCoopBtn).not.toBeNull();
    pauseCoopBtn?.click();
    expect(callbacks.onOpenMultiplayerLobby).toHaveBeenCalledTimes(2);
    expect(mpOpenLobbyCount).toBe(2);

    unsub();
    menus.dispose();
  });
});
