import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DungeonFloorData,
  HudSnapshot,
  PlayerRuntimeState,
  SkillSlotIndex,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { HudUI, createHudUI } from './index';

class MockClassList {
  private set = new Set<string>();
  constructor(private owner: MockElement) {}
  private sync(val: string) {
    this.set.clear();
    for (const token of val.split(/\s+/).filter(Boolean)) this.set.add(token);
  }
  setFromClassName(val: string) {
    this.sync(val);
  }
  add(...tokens: string[]) {
    for (const t of tokens) this.set.add(t);
    this.owner._syncClassNameFromList();
  }
  remove(...tokens: string[]) {
    for (const t of tokens) this.set.delete(t);
    this.owner._syncClassNameFromList();
  }
  toggle(token: string, force?: boolean) {
    const shouldHave = force !== undefined ? force : !this.set.has(token);
    if (shouldHave) this.set.add(token);
    else this.set.delete(token);
    this.owner._syncClassNameFromList();
    return shouldHave;
  }
  contains(token: string) {
    return this.set.has(token);
  }
  toArray() {
    return [...this.set];
  }
}

class MockElement {
  public tagName: string;
  public id = '';
  public title = '';
  public type = '';
  public width = 0;
  public height = 0;
  public offsetWidth = 54;
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public style: Record<string, any> = {
    setProperty(k: string, v: string) {
      this[k] = v;
    },
  };
  public classList: MockClassList;
  private _className = '';
  private _textContent = '';
  private _innerHTML = '';
  private listeners = new Map<string, Array<(e: any) => void>>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    this.classList = new MockClassList(this);
  }

  get className() {
    return this._className;
  }
  set className(val: string) {
    this._className = val;
    this.classList.setFromClassName(val);
  }

  _syncClassNameFromList() {
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

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val: string) {
    this._innerHTML = val;
    this.children = [];
  }

  get firstElementChild(): MockElement | null {
    return this.children[0] ?? null;
  }

  appendChild<T extends MockElement>(child: T): T {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: MockElement[]) {
    for (const n of nodes) this.appendChild(n);
  }

  remove() {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  addEventListener(event: string, fn: (e: any) => void) {
    const arr = this.listeners.get(event) ?? [];
    arr.push(fn);
    this.listeners.set(event, arr);
  }

  click() {
    const handlers = this.listeners.get('click') ?? [];
    const ev = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    for (const h of handlers) h(ev);
  }

  getContext(kind: string) {
    if (kind !== '2d') return null;
    return {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      createRadialGradient: () => ({ addColorStop: vi.fn() }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
    };
  }

  queryAllByClass(cls: string): MockElement[] {
    const out: MockElement[] = [];
    if (this.classList.contains(cls)) out.push(this);
    for (const c of this.children) {
      out.push(...c.queryAllByClass(cls));
    }
    return out;
  }
}

function createMockSnapshot(): HudSnapshot {
  const cols = 16;
  const rows = 16;
  const tiles = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 'floor' as const),
  );
  const explored = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => true),
  );

  const floor: DungeonFloorData = {
    floorNumber: 1,
    biome: 'crypt',
    seed: 42,
    cols,
    rows,
    tileSize: 2,
    tiles,
    explored,
    rooms: [
      {
        id: 'r1',
        type: 'spawn',
        x: 2,
        y: 2,
        width: 4,
        height: 4,
        centerGrid: { col: 4, row: 4 },
        centerWorld: { x: 8, y: 0, z: 8 },
        connectedRoomIds: ['r2'],
        cleared: true,
      },
      {
        id: 'r2',
        type: 'boss',
        x: 10,
        y: 10,
        width: 4,
        height: 4,
        centerGrid: { col: 12, row: 12 },
        centerWorld: { x: 24, y: 0, z: 24 },
        connectedRoomIds: ['r1'],
        cleared: false,
      },
    ],
    playerSpawn: { x: 8, y: 0, z: 8 },
    bossSpawn: { x: 24, y: 0, z: 24 },
    portalPosition: { x: 26, y: 0, z: 24 },
    interactables: [
      {
        id: 'prop-chest',
        type: 'chest',
        position: { x: 9, y: 0, z: 8 },
        roomId: 'r1',
        used: false,
        label: 'Gilded Reliquary',
      },
    ],
    torchPositions: [],
    worldToGrid: (p) => ({ col: Math.floor(p.x / 2), row: Math.floor(p.z / 2) }),
    gridToWorld: (col, row) => ({ x: col * 2, y: 0, z: row * 2 }),
    isWalkableWorld: () => true,
    findPath: () => [],
    revealRadius: () => {},
  };

  const player: PlayerRuntimeState = {
    id: 'player',
    heroClass: 'vanguard',
    name: 'Kaelen',
    level: 4,
    xp: 240,
    xpToNextLevel: 400,
    unspentSkillPoints: 2,
    unspentAttributePoints: 3,
    position: { x: 8, y: 0, z: 8 },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: -1 },
    rotationY: 0,
    radius: 0.5,
    hp: 65,
    mana: 40,
    stamina: 75,
    baseAttributes: { strength: 16, dexterity: 9, intelligence: 7, vitality: 15 },
    stats: {
      maxHp: 250,
      hpRegen: 2,
      maxMana: 100,
      manaRegen: 5,
      maxStamina: 100,
      staminaRegen: 20,
      moveSpeed: 6,
      attackPower: 35,
      spellPower: 15,
      armor: 40,
      critChance: 0.15,
      critMultiplier: 1.75,
      attackSpeed: 1,
      cooldownReduction: 0,
      lifeSteal: 0,
      dodgeChance: 0.05,
    },
    statuses: [
      {
        id: 'st-shield',
        type: 'shield',
        remainingSec: 4.2,
        durationSec: 6,
        stacks: 1,
        potency: 60,
        sourceId: 'player',
      },
    ],
    isDodging: false,
    invulnerableSec: 0,
    alive: true,
    healthPotions: 3,
    maxHealthPotions: 5,
    potionCooldownSec: 1.5,
    gold: 1480,
    floorsCleared: 0,
    killsTotal: 19,
  };

  return {
    player,
    skills: Array.from({ length: 6 }, (_, idx) => ({
      def: {
        id: `skill_${idx}`,
        name: idx === 4 ? 'Whirlwind Tempest' : `Skill ${idx}`,
        description: 'Test skill description',
        icon: 'whirlwind',
        heroClass: 'vanguard',
        slotHint: idx as SkillSlotIndex,
        damageType: idx === 5 ? 'fire' : 'physical',
        targeting: 'melee_arc',
        manaCost: idx === 5 ? 60 : 10,
        cooldownSec: 8,
        baseDamageMultiplier: 1.5,
        range: 3,
        radius: 2,
        animState: 'attack_1',
      },
      remainingCd: idx === 2 ? 3.4 : 0,
      totalCd: 8,
      ready: idx !== 2,
    })),
    floor,
    enemies: [
      {
        id: 'elite-1',
        name: 'Dread Executioner',
        archetype: 'skeleton_warrior',
        isBoss: false,
        isElite: true,
        affixes: ['vampiric', 'molten'],
        position: { x: 11, y: 0, z: 9 },
        velocity: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        radius: 0.7,
        hp: 180,
        maxHp: 300,
        armor: 25,
        moveSpeed: 3.5,
        attackDamage: 22,
        damageType: 'physical',
        attackRange: 2,
        attackCooldownSec: 1.5,
        xpReward: 80,
        lootTierBonus: 1,
        statuses: [],
        alive: true,
        roomId: 'r1',
      },
    ],
    groundDrops: [
      {
        id: 'drop-1',
        position: { x: 10, y: 0, z: 8 },
        kind: 'item',
        pickedUp: false,
        item: {
          id: 'item-1',
          name: 'Soulreaver Greatsword',
          slot: 'weapon',
          rarity: 'legendary',
          levelReq: 1,
          itemLevel: 5,
          upgradeLevel: 2,
          affixes: [],
          goldValue: 500,
          icon: 'sword',
        },
      },
    ],
    boss: {
      entity: {
        id: 'boss-1',
        name: 'Ossuary Bone Colossus',
        archetype: 'bone_colossus',
        isBoss: true,
        isElite: false,
        affixes: [],
        position: { x: 24, y: 0, z: 24 },
        velocity: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        radius: 1.6,
        hp: 1250,
        maxHp: 2000,
        armor: 50,
        moveSpeed: 3,
        attackDamage: 45,
        damageType: 'physical',
        attackRange: 3.5,
        attackCooldownSec: 2,
        xpReward: 500,
        lootTierBonus: 3,
        statuses: [],
        alive: true,
        roomId: 'r2',
      },
      bossId: 'bone_colossus',
      title: 'Warden of the Shattered Crypt',
      phase: 2,
      maxPhases: 3,
      introActive: false,
    },
    quests: [
      {
        id: 'q-main',
        title: 'Shatter the Ossuary Seal',
        isMainQuest: true,
        description: 'Defeat the Bone Colossus',
        floorNumber: 1,
        objectives: [
          {
            id: 'obj-1',
            description: 'Slay the Bone Colossus',
            current: 0,
            required: 1,
            completed: false,
          },
        ],
        status: 'active',
        xpReward: 300,
        goldReward: 200,
      },
    ],
    cursedEvent: {
      active: true,
      roomId: 'r1',
      position: { x: 9, y: 0, z: 8 },
      remainingSec: 18.4,
      wavesSpawned: 2,
      totalWaves: 3,
    },
    combo: { count: 14, timerSec: 3.2, multiplier: 1.35 },
    nearbyInteractable: floor.interactables[0],
    fps: 60,
  };
}

describe('HudUI', () => {
  let headEl: MockElement;
  let hostEl: MockElement;

  beforeEach(() => {
    headEl = new MockElement('head');
    hostEl = new MockElement('div');

    (globalThis as any).document = {
      head: headEl,
      createElement: (tag: string) => new MockElement(tag),
      getElementById: (id: string) => {
        for (const c of headEl.children) {
          if (c.id === id) return c;
        }
        return null;
      },
    };
    (globalThis as any).window = {
      innerWidth: 1440,
      innerHeight: 900,
      devicePixelRatio: 2,
      dispatchEvent: vi.fn(),
    };
    eventBus.clear();
  });

  afterEach(() => {
    eventBus.clear();
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it('mounts, renders globes/skills/boss/minimap/overlays, handles clicks, and disposes cleanly', () => {
    const hud = createHudUI();
    expect(hud).toBeInstanceOf(HudUI);

    hud.mount(hostEl as unknown as HTMLElement);
    expect(headEl.children.length).toBe(1);
    expect(hostEl.children.length).toBe(1);

    const clickedSlots: SkillSlotIndex[] = [];
    const toggledPanels: string[] = [];
    hud.onSkillSlotClick((s) => clickedSlots.push(s));
    hud.onPanelToggleClick((p) => toggledPanels.push(p));

    const snapshot = createMockSnapshot();
    const worldToScreen = (pos: { x: number; y: number; z: number }) => ({
      x: 500 + pos.x * 12,
      y: 400 - pos.y * 20,
      visible: true,
    });

    hud.spawnDamageNumber({ x: 11, y: 1, z: 9 }, 482, true, 'fire', false);
    hud.showBanner('FLOOR I', 'Forgotten Crypt of Kings', 'gold');
    hud.showToast('Obtained Soulreaver Greatsword', 'legendary');

    hud.update(0.05, snapshot, worldToScreen);

    const root = hostEl.children[0];
    // Boss frame visible with phase II / III
    const bossFrame = root.queryAllByClass('ar-boss-frame')[0];
    expect(bossFrame.classList.contains('ar-visible')).toBe(true);
    expect(bossFrame.textContent).toContain('Ossuary Bone Colossus');
    expect(bossFrame.textContent).toContain('PHASE II / III');

    // Cursed event timer active
    const cursedBanner = root.queryAllByClass('ar-cursed-banner')[0];
    expect(cursedBanner.classList.contains('ar-visible')).toBe(true);
    expect(cursedBanner.textContent).toContain('Wave 2/3');

    // Low HP (65/250 = 26%) triggers critical globe & crimson vignette + shield halo
    const hpGlobe = root.queryAllByClass('ar-hp-globe')[0];
    expect(hpGlobe.classList.contains('ar-critical')).toBe(true);
    expect(hpGlobe.classList.contains('ar-shielded')).toBe(true);

    // Skill slot 2 on cooldown & slot 5 mana-shortage dimmed (40 < 60 mana)
    const skillBtns = root.queryAllByClass('ar-skill-slot');
    expect(skillBtns.length).toBe(6);
    expect(skillBtns[2].classList.contains('ar-on-cd')).toBe(true);
    expect(skillBtns[5].classList.contains('ar-no-mana')).toBe(true);

    // Click skill slot 4 and Inventory menu button
    skillBtns[4].click();
    expect(clickedSlots).toEqual([4]);

    const menuBtns = root.queryAllByClass('ar-menu-btn');
    expect(menuBtns.length).toBe(4);
    menuBtns[0].click();
    menuBtns[1].click();
    expect(toggledPanels).toEqual(['inventory', 'skills']);

    // Unspent attribute (3) and skill (2) badges active
    const badges = root.queryAllByClass('ar-unspent-badge');
    expect(badges[0].classList.contains('ar-has-points')).toBe(true);
    expect(badges[0].textContent).toBe('3');
    expect(badges[1].textContent).toBe('2');

    // Crit floating damage number rendered & positioned
    const critNums = root.queryAllByClass('ar-crit');
    expect(critNums.length).toBe(1);
    expect(critNums[0].textContent).toContain('482!');

    // Visibility toggle & dispose cleanup
    hud.setVisible(false);
    expect(root.classList.contains('ar-hud-hidden')).toBe(true);

    hud.dispose();
    expect(hostEl.children.length).toBe(0);
    expect(headEl.children.length).toBe(0);
  });

  it('deduplicates simultaneous EventBus + forwarded HUD calls in the same tick', () => {
    const hud = createHudUI();
    hud.mount(hostEl as unknown as HTMLElement);

    // Simulate main.ts also forwarding ui:toast -> hud.showToast
    const unsub = eventBus.on('ui:toast', (p) => {
      hud.showToast(p.message, p.rarity);
    });

    eventBus.emit('ui:toast', { message: 'Quest Completed!', rarity: 'epic' });

    const root = hostEl.children[0];
    const toastCards = root.queryAllByClass('ar-toast-card');
    expect(toastCards.length).toBe(1);

    unsub();
    hud.dispose();
  });

  it('supports Phase 2 DLSS 120Hz pill, globe hit/cast ripples, flying loot-to-bag arc, and gear-swap micro-banner', () => {
    const hud = createHudUI();
    hud.mount(hostEl as unknown as HTMLElement);

    const snapshot = createMockSnapshot();
    snapshot.engineStats = {
      fps: 120,
      drawCalls: 145,
      triangles: 48200,
      dlssMode: 'quality',
      renderScale: 0.77,
      targetFps: 120,
      internalWidth: 1478,
      internalHeight: 831,
      frameTimeMs: 8.31,
    };

    const worldToScreen = (pos: { x: number; y: number; z: number }) => ({
      x: 500 + pos.x * 12,
      y: 420 - pos.y * 20,
      visible: true,
    });

    hud.update(0.016, snapshot, worldToScreen);

    const root = hostEl.children[0];
    const perfPill = root.queryAllByClass('ar-perf-pill')[0];
    const fpsBadge = root.queryAllByClass('ar-fps-badge')[0];
    expect(perfPill.textContent).toContain('DLSS QUALITY 0.77x');
    expect(perfPill.textContent).toContain('120Hz');
    expect(fpsBadge.textContent).toBe('120 FPS');

    // Trigger HP hit ripple & Mana cast ripple via delta
    snapshot.player.hp = 45;
    snapshot.player.mana = 22;
    hud.update(0.016, snapshot, worldToScreen);

    const hpGlobe = root.queryAllByClass('ar-hp-globe')[0];
    const manaGlobe = root.queryAllByClass('ar-mana-globe')[0];
    expect(hpGlobe.classList.contains('ar-hit-ripple')).toBe(true);
    expect(manaGlobe.classList.contains('ar-cast-ripple')).toBe(true);

    // Emit loot:pickedUp for a legendary item -> spawns flying orb & pops [I] button on arrival
    eventBus.emit('loot:pickedUp', {
      drop: snapshot.groundDrops[0],
      screenStart: { x: 620, y: 410, z: 0 },
    });

    const flyingOrbs = root.queryAllByClass('ar-flying-loot-orb');
    const activeOrb = flyingOrbs.find((o) => o.style.opacity === '1');
    expect(activeOrb).toBeDefined();

    // Advance past 0.48s Bezier arc flight (3 steps of 0.2s)
    hud.update(0.2, snapshot, worldToScreen);
    hud.update(0.2, snapshot, worldToScreen);
    hud.update(0.2, snapshot, worldToScreen);

    const invBtn = root.queryAllByClass('ar-menu-btn')[0];
    expect(invBtn.classList.contains('ar-bag-pop')).toBe(true);

    // Emit hero:gearChanged -> floating micro-banner appears
    eventBus.emit('hero:gearChanged', {
      slot: 'weapon',
      item: snapshot.groundDrops[0].item,
      weaponVisual: 'greatsword',
      rarity: 'legendary',
    });

    const gearChip = root.queryAllByClass('ar-gear-swap-chip')[0];
    expect(gearChip.classList.contains('ar-visible')).toBe(true);
    expect(gearChip.textContent).toContain('Soulreaver Greatsword +2');
    expect(gearChip.textContent).toContain('HUYỀN THOẠI');

    hud.dispose();
  });

  it('renders Phase 3 Mastery (Awakening/Parry), Boss Stagger Execute, Elemental Reactions, Companions, World Events, New Biomes, and Sanctuary DPS Meter', () => {
    const hud = createHudUI();
    hud.mount(hostEl as unknown as HTMLElement);

    const snapshot = createMockSnapshot();
    snapshot.floor.biome = 'sanctuary';
    snapshot.floor.floorNumber = 0;
    snapshot.floor.tiles[3][3] = 'hazard_ice';
    snapshot.floor.tiles[4][4] = 'teleporter_pad';
    snapshot.inSanctuary = true;

    snapshot.mastery = {
      fury: 100,
      maxFury: 100,
      awakened: false,
      awakenedRemainingSec: 0,
      awakenedDurationSec: 10,
      parryCooldownSec: 0,
      parryActiveWindow: true,
      bossStagger: 100,
      bossMaxStagger: 100,
      bossStaggered: true,
      canExecuteTargetId: 'boss-1',
    };

    snapshot.companions = {
      activePet: 'celestial_owl',
      unlockedPets: ['celestial_owl'],
      activeMercenary: 'iron_templar',
      unlockedMercenaries: ['iron_templar'],
      mercenaryName: 'Ser Vaelen',
      mercenaryHp: 420,
      mercenaryMaxHp: 500,
      mercenaryAlive: true,
      mercenaryLevel: 5,
    };

    snapshot.dummyMetrics = {
      active: true,
      rollingDps: 14850,
      peakHit: 3620,
      totalDamage: 92400,
      hitsCount: 38,
    };

    snapshot.worldEvents = {
      butcherActive: true,
      goblinActive: true,
      goblinEscapeSec: 11.4,
      escortState: { active: true, progress01: 0.64, insideLight: true, completed: false },
      riftState: { active: true, remainingSec: 42.5, kills: 19, tierLabel: 'Tier II' },
      colosseumState: { active: true, wave: 4, maxWaves: 10, bestWave: 7, completed: false },
      activePacts: [
        {
          id: 'pact_blood',
          title: 'Blood Frenzy',
          curseText: '+20% Damage Taken',
          blessingText: '+45% Attack Speed',
          tone: 'crimson',
          statModifiers: {},
        },
      ],
    };

    const worldToScreen = (pos: { x: number; y: number; z: number }) => ({
      x: 520 + pos.x * 10,
      y: 440 - pos.y * 18,
      visible: true,
    });

    // Emit all 4 elemental reactions
    eventBus.emit('combat:elementalReaction', {
      reaction: 'shatter',
      position: { x: 10, y: 1, z: 10 },
      damage: 940,
    });
    eventBus.emit('combat:elementalReaction', {
      reaction: 'abyssal_singularity',
      position: { x: 12, y: 1, z: 10 },
      damage: 1850,
    });

    hud.update(0.016, snapshot, worldToScreen);

    const root = hostEl.children[0];

    // [R] Awakening Fury ready & [V] Parry active window
    const furyPill = root.queryAllByClass('ar-fury-pill')[0];
    const parryPill = root.queryAllByClass('ar-parry-pill')[0];
    expect(furyPill.classList.contains('ar-fury-ready')).toBe(true);
    expect(furyPill.textContent).toContain('CUỒNG NỘ THỨC TỈNH!');
    expect(parryPill.classList.contains('ar-parry-active')).toBe(true);
    expect(parryPill.textContent).toContain('ĐANG ĐỠ ĐÒN!');

    // Boss Stagger Bar flashing EXECUTE!
    const staggerRow = root.queryAllByClass('ar-boss-stagger-row')[0];
    expect(staggerRow.classList.contains('ar-staggered')).toBe(true);
    expect(staggerRow.textContent).toContain('[F / LMB] KẾT LIỄU!');

    // Elemental Reaction world-space callouts active
    const reactions = root
      .queryAllByClass('ar-reaction-callout')
      .filter((el) => Number(el.style.opacity) > 0);
    expect(reactions.length).toBe(2);
    expect(reactions[0].textContent).toContain('PHÁ BĂNG!');
    expect(reactions[1].textContent).toContain('DỊ ĐIỂM HƯ KHÔNG!');

    // Companion card & Live Training Dummy DPS Meter
    const compCard = root.queryAllByClass('ar-companion-card')[0];
    expect(compCard.classList.contains('ar-visible')).toBe(true);
    expect(compCard.textContent).toContain('Ser Vaelen');
    expect(compCard.textContent).toContain('Cú Thiên Giới');

    const dpsCard = root.queryAllByClass('ar-dps-meter-card')[0];
    expect(dpsCard.classList.contains('ar-visible')).toBe(true);
    expect(dpsCard.textContent).toContain('14,850 DPS');

    // World Event Trackers (Butcher, Goblin, Escort, Rift, Colosseum, Obelisk Pact)
    const evStack = root.queryAllByClass('ar-world-events-stack')[0];
    expect(evStack.classList.contains('ar-visible')).toBe(true);
    expect(evStack.textContent).toContain('TÊN ĐỒ TỂ XÂM LƯỢC!');
    expect(evStack.textContent).toContain('Yêu Tinh Kho Báu');
    expect(evStack.textContent).toContain('Hộ Tống Linh Hồn');
    expect(evStack.textContent).toContain('Khe Nứt [Tier II]');
    expect(evStack.textContent).toContain('Đợt 4/10');
    expect(evStack.textContent).toContain('Blood Frenzy');

    // Also verify cathedral, observatory, colosseum biomes render cleanly on minimap
    for (const biome of ['cathedral', 'observatory', 'colosseum'] as const) {
      snapshot.floor.biome = biome;
      snapshot.floor.floorNumber = 5;
      hud.update(0.016, snapshot, worldToScreen);
    }

    hud.dispose();
  });
});
