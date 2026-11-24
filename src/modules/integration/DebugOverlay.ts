import type {
  BiomeId,
  DlssMode,
  DungeonFloorData,
  EngineTelemetryStats,
  PlayerRuntimeState,
  Vec3,
} from '../../contracts/types';
import { BIOME_CONFIG, clamp } from '../../core/Constants';
import { eventBus, TypedEventBus } from '../../core/EventBus';
import { t } from '../../core/i18n/index.js';

export interface DebugOverlayHooks {
  onToggleGodMode?: (enabled: boolean) => void;
  onGrantGold?: (amount: number) => void;
  onSkipFloor?: () => void;
  onHealPlayer?: () => void;
  onGrantLevel?: () => void;
  onWarpSanctuary?: () => void;
  onWarpColosseum?: () => void;
  onSpawnButcher?: () => void;
  onSpawnGoblin?: () => void;
  onFillFury?: () => void;
  onGrantAllRunes?: () => void;
}

export interface DebugOverlayOptions extends DebugOverlayHooks {
  initiallyVisible?: boolean;
  goldGrantAmount?: number;
  toggleKey?: string;
  bus?: TypedEventBus;
}

export interface DebugOverlaySnapshot {
  fps?: number;
  drawCalls?: number;
  triangles?: number;
  stats?: EngineTelemetryStats;
  playerPos?: Vec3;
  playerPosition?: Vec3;
  player?: Pick<PlayerRuntimeState, 'position' | 'hp' | 'level' | 'gold' | 'stats'>;
  floor?: Pick<DungeonFloorData, 'floorNumber' | 'biome' | 'seed'>;
  seed?: number;
  biome?: BiomeId;
  floorNumber?: number;
  activeEnemies?: number;
  activeEnemyCount?: number;
  godMode?: boolean;
}

export interface DebugTelemetryState {
  visible: boolean;
  godMode: boolean;
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  dlssMode: DlssMode;
  renderScale: number;
  playerPosition: Vec3;
  playerLevel: number;
  playerHp: number;
  playerMaxHp: number;
  playerGold: number;
  floorNumber: number;
  biome: BiomeId;
  seed: number;
  activeEnemyCount: number;
  eventsObserved: number;
  lastEventLabel: string;
}

const STYLE_ELEMENT_ID = 'abyssal-debug-overlay-styles';

const OVERLAY_CSS = `
.abyssal-debug-overlay {
  position: fixed;
  top: 14px;
  left: 14px;
  z-index: 9999;
  width: 320px;
  padding: 11px 13px;
  background: rgba(10, 9, 16, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.58);
  border-radius: 6px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.76), inset 0 0 18px rgba(200, 155, 60, 0.08);
  backdrop-filter: blur(8px);
  color: #f1e9d2;
  font-family: 'Consolas', 'JetBrains Mono', 'SFMono-Regular', ui-monospace, monospace;
  font-size: 11.2px;
  line-height: 1.42;
  pointer-events: auto;
  user-select: none;
}

.abyssal-debug-overlay[data-hidden="true"] {
  display: none !important;
  pointer-events: none !important;
}

.abyssal-debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  margin-bottom: 7px;
  border-bottom: 1px solid rgba(200, 155, 60, 0.32);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #e6be68;
  text-transform: uppercase;
  font-size: 11px;
}

.abyssal-debug-hotkey {
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(200, 155, 60, 0.16);
  border: 1px solid rgba(200, 155, 60, 0.42);
  color: #f1e9d2;
  font-size: 10px;
}

.abyssal-debug-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  margin-bottom: 8px;
}

.abyssal-debug-label {
  color: #9e937b;
}

.abyssal-debug-val {
  text-align: right;
  color: #f1e9d2;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abyssal-debug-val[data-tone="good"] {
  color: #69db7c;
}

.abyssal-debug-val[data-tone="warn"] {
  color: #ffd43b;
}

.abyssal-debug-val[data-tone="bad"] {
  color: #ff6b6b;
}

.abyssal-debug-section-title {
  margin-top: 6px;
  margin-bottom: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(200, 155, 60, 0.22);
  color: #b8aa8e;
  font-size: 9.8px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.abyssal-debug-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
}

.abyssal-debug-btn {
  appearance: none;
  padding: 4px 5px;
  border-radius: 4px;
  border: 1px solid rgba(200, 155, 60, 0.44);
  background: linear-gradient(180deg, rgba(36, 30, 48, 0.95) 0%, rgba(19, 16, 28, 0.95) 100%);
  color: #f1e9d2;
  font-family: inherit;
  font-size: 10.2px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease, transform 0.06s ease;
}

.abyssal-debug-btn:hover {
  border-color: #e6be68;
  background: linear-gradient(180deg, rgba(54, 44, 70, 0.98) 0%, rgba(28, 22, 40, 0.98) 100%);
}

.abyssal-debug-btn:active {
  transform: translateY(1px);
}

.abyssal-debug-btn[data-active="true"] {
  border-color: #40c057;
  background: linear-gradient(180deg, rgba(32, 82, 46, 0.95) 0%, rgba(18, 48, 28, 0.95) 100%);
  color: #b2f2bb;
}

.abyssal-debug-btn[data-accent="crimson"] {
  border-color: rgba(224, 49, 49, 0.6);
  color: #ffc9c9;
}

.abyssal-debug-btn[data-accent="arcane"] {
  border-color: rgba(174, 62, 201, 0.6);
  color: #eebefa;
}

.abyssal-debug-btn[data-accent="cyan"] {
  border-color: rgba(51, 154, 240, 0.6);
  color: #a5d8ff;
}
`;

export class DebugOverlay {
  private hooks: DebugOverlayHooks;
  private readonly goldGrantAmount: number;
  private readonly toggleKey: string;
  private readonly bus: TypedEventBus;

  private state: DebugTelemetryState;
  private rootEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private domRefs: {
    fps?: HTMLElement;
    render?: HTMLElement;
    upscale?: HTMLElement;
    coords?: HTMLElement;
    hero?: HTMLElement;
    floor?: HTMLElement;
    seed?: HTMLElement;
    enemies?: HTMLElement;
    events?: HTMLElement;
    tier?: HTMLElement;
    device?: HTMLElement;
    godBtn?: HTMLButtonElement;
  } = {};

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private unsubscribes: Array<() => void> = [];
  private domRefreshAccumSec = 0;
  private dirty = true;

  constructor(options?: DebugOverlayOptions) {
    this.hooks = {
      onToggleGodMode: options?.onToggleGodMode,
      onGrantGold: options?.onGrantGold,
      onSkipFloor: options?.onSkipFloor,
      onHealPlayer: options?.onHealPlayer,
      onGrantLevel: options?.onGrantLevel,
      onWarpSanctuary: options?.onWarpSanctuary,
      onWarpColosseum: options?.onWarpColosseum,
      onSpawnButcher: options?.onSpawnButcher,
      onSpawnGoblin: options?.onSpawnGoblin,
      onFillFury: options?.onFillFury,
      onGrantAllRunes: options?.onGrantAllRunes,
    };
    this.goldGrantAmount = options?.goldGrantAmount ?? 500;
    this.toggleKey = options?.toggleKey ?? 'F3';
    this.bus = options?.bus ?? eventBus;

    this.state = {
      visible: options?.initiallyVisible ?? false,
      godMode: false,
      fps: 60,
      frameTimeMs: 16.7,
      drawCalls: 0,
      triangles: 0,
      dlssMode: 'native',
      renderScale: 1.0,
      playerPosition: { x: 0, y: 0, z: 0 },
      playerLevel: 1,
      playerHp: 100,
      playerMaxHp: 100,
      playerGold: 0,
      floorNumber: 1,
      biome: 'crypt',
      seed: 0,
      activeEnemyCount: 0,
      eventsObserved: 0,
      lastEventLabel: 'idle',
    };

    this.subscribeTelemetryEvents();
  }

  /**
   * Mounts the developer HUD widget into `container` (or `document.body` when omitted)
   * and binds the `F3` keyboard toggle listener. Safe no-op for DOM creation in headless Node.
   */
  mount(container?: HTMLElement, hooks?: DebugOverlayHooks): void {
    if (hooks) {
      this.setHooks(hooks);
    }

    this.bindKeyboardShortcut();

    if (typeof document === 'undefined') {
      return;
    }

    const host = container ?? document.body;
    if (!host) return;

    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }

    this.ensureStylesInjected();

    const root = document.createElement('div');
    root.className = 'abyssal-debug-overlay';
    root.setAttribute('data-hidden', this.state.visible ? 'false' : 'true');

    // Prevent clicks inside the dev overlay from bleeding through into gameplay canvas actions
    const stopProp = (ev: Event): void => {
      ev.stopPropagation();
    };
    root.addEventListener('mousedown', stopProp);
    root.addEventListener('pointerdown', stopProp);
    root.addEventListener('click', stopProp);
    root.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    const header = document.createElement('div');
    header.className = 'abyssal-debug-header';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = t('debug.title');
    const keyBadge = document.createElement('span');
    keyBadge.className = 'abyssal-debug-hotkey';
    keyBadge.textContent = this.toggleKey;
    header.appendChild(titleSpan);
    header.appendChild(keyBadge);
    root.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'abyssal-debug-grid';

    const addRow = (label: string): HTMLElement => {
      const lbl = document.createElement('span');
      lbl.className = 'abyssal-debug-label';
      lbl.textContent = label;
      const val = document.createElement('span');
      val.className = 'abyssal-debug-val';
      grid.appendChild(lbl);
      grid.appendChild(val);
      return val;
    };

    this.domRefs.fps = addRow(t('debug.fps') + ' / Khung');
    this.domRefs.render = addRow(t('debug.drawCalls') + ' / ' + t('debug.triangles'));
    this.domRefs.upscale = addRow('DLSS / Tỉ Lệ');
    this.domRefs.coords = addRow(t('debug.position') + ' XYZ');
    this.domRefs.hero = addRow('Trạng Thái Anh Hùng');
    this.domRefs.floor = addRow(t('debug.floor') + ' / ' + t('debug.biome'));
    this.domRefs.seed = addRow('Hạt Giống Thế Giới');
    this.domRefs.enemies = addRow(t('debug.entities') + ' Địch');
    this.domRefs.events = addRow('EventBus');
    this.domRefs.tier = addRow(t('debug.tier'));
    this.domRefs.device = addRow(t('debug.device'));

    root.appendChild(grid);

    const makeBtn = (
      label: string,
      onClick: () => void,
      accent?: 'crimson' | 'arcane' | 'cyan',
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'abyssal-debug-btn';
      btn.textContent = label;
      if (accent) {
        btn.setAttribute('data-accent', accent);
      }
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onClick();
      });
      return btn;
    };

    // Core Dev Controls
    const coreTitle = document.createElement('div');
    coreTitle.className = 'abyssal-debug-section-title';
    coreTitle.textContent = 'Cheat Cơ Bản & Điều Khiển Tầng';
    root.appendChild(coreTitle);

    const coreActions = document.createElement('div');
    coreActions.className = 'abyssal-debug-actions';

    const godBtn = makeBtn('Chế Độ Thần: TẮT', () => {
      this.toggleGodMode();
    });
    this.domRefs.godBtn = godBtn;

    coreActions.appendChild(godBtn);
    coreActions.appendChild(makeBtn(`+${this.goldGrantAmount} Vàng`, () => this.triggerGrantGold()));
    coreActions.appendChild(makeBtn('Bỏ Qua Tầng', () => this.triggerSkipFloor()));
    coreActions.appendChild(makeBtn('Hồi Phục Đầy', () => this.triggerHealPlayer()));
    coreActions.appendChild(makeBtn('+1 Cấp', () => this.triggerGrantLevel()));
    coreActions.appendChild(makeBtn('Cuồng Nộ Tối Đa', () => this.triggerFillFury(), 'arcane'));
    root.appendChild(coreActions);

    // Phase 3 Expansion Quick-Actions
    const expTitle = document.createElement('div');
    expTitle.className = 'abyssal-debug-section-title';
    expTitle.textContent = 'Dịch Chuyển Mở Rộng & Triệu Hồi';
    root.appendChild(expTitle);

    const expActions = document.createElement('div');
    expActions.className = 'abyssal-debug-actions';
    expActions.appendChild(makeBtn('Thánh Địa', () => this.triggerWarpSanctuary(), 'cyan'));
    expActions.appendChild(makeBtn('Đấu Trường', () => this.triggerWarpColosseum(), 'crimson'));
    expActions.appendChild(makeBtn('Tất Cả Rune', () => this.triggerGrantAllRunes(), 'arcane'));
    expActions.appendChild(makeBtn('Đồ Tể!', () => this.triggerSpawnButcher(), 'crimson'));
    expActions.appendChild(makeBtn('Goblin!', () => this.triggerSpawnGoblin()));
    root.appendChild(expActions);

    host.appendChild(root);
    this.rootEl = root;
    this.dirty = true;
    this.syncDomImmediate();
  }

  /**
   * Registers or updates debug action hooks (`onToggleGodMode`, `onGrantGold`, `onSkipFloor`,
   * `onWarpSanctuary`, `onWarpColosseum`, `onSpawnButcher`, `onSpawnGoblin`, `onFillFury`, `onGrantAllRunes`, etc.).
   */
  setHooks(hooks: DebugOverlayHooks): void {
    this.hooks = {
      ...this.hooks,
      ...hooks,
    };
  }

  /**
   * Toggles visibility of the F3 Developer HUD (or sets explicit visibility when `force` is passed).
   */
  toggle(force?: boolean): boolean {
    this.state.visible = force !== undefined ? force : !this.state.visible;
    if (this.rootEl) {
      this.rootEl.setAttribute('data-hidden', this.state.visible ? 'false' : 'true');
    }
    if (this.state.visible) {
      this.syncDomImmediate();
    }
    return this.state.visible;
  }

  show(): void {
    this.toggle(true);
  }

  hide(): void {
    this.toggle(false);
  }

  isVisible(): boolean {
    return this.state.visible;
  }

  isGodMode(): boolean {
    return this.state.godMode;
  }

  /**
   * Toggles or explicitly sets God Mode and notifies `onToggleGodMode`.
   */
  toggleGodMode(force?: boolean): boolean {
    this.state.godMode = force !== undefined ? force : !this.state.godMode;
    this.dirty = true;
    this.syncDomImmediate();
    this.hooks.onToggleGodMode?.(this.state.godMode);
    return this.state.godMode;
  }

  /**
   * Invokes the `onGrantGold` debug callback (defaults to `goldGrantAmount`, 500g).
   */
  triggerGrantGold(amount = this.goldGrantAmount): void {
    const safeAmount = Math.max(0, Math.round(amount));
    this.hooks.onGrantGold?.(safeAmount);
  }

  /**
   * Invokes the `onSkipFloor` debug callback to advance immediately to the next dungeon floor.
   */
  triggerSkipFloor(): void {
    this.hooks.onSkipFloor?.();
  }

  /**
   * Invokes `onHealPlayer` to replenish hero vitals & potions.
   */
  triggerHealPlayer(): void {
    this.hooks.onHealPlayer?.();
  }

  /**
   * Invokes `onGrantLevel` to grant an immediate character level-up.
   */
  triggerGrantLevel(): void {
    this.hooks.onGrantLevel?.();
  }

  /**
   * Invokes `onWarpSanctuary` to teleport immediately to the Bastion Sanctuary Hub.
   */
  triggerWarpSanctuary(): void {
    this.hooks.onWarpSanctuary?.();
  }

  /**
   * Invokes `onWarpColosseum` to teleport immediately into the Crimson Colosseum Boss Rush.
   */
  triggerWarpColosseum(): void {
    this.hooks.onWarpColosseum?.();
  }

  /**
   * Invokes `onSpawnButcher` to trigger a live Butcher Dread Invasion in the current dungeon.
   */
  triggerSpawnButcher(): void {
    this.hooks.onSpawnButcher?.();
  }

  /**
   * Invokes `onSpawnGoblin` to spawn an elusive Treasure Goblin nearby.
   */
  triggerSpawnGoblin(): void {
    this.hooks.onSpawnGoblin?.();
  }

  /**
   * Invokes `onFillFury` to top off `[R]` Awakening Fury immediately.
   */
  triggerFillFury(): void {
    this.hooks.onFillFury?.();
  }

  /**
   * Invokes `onGrantAllRunes` to grant a full stack of all 12 Runeword runes.
   */
  triggerGrantAllRunes(): void {
    this.hooks.onGrantAllRunes?.();
  }

  /**
   * Updates live engine, player, dungeon, and enemy telemetry.
   * DOM text updates are throttled when visible so per-frame overhead is negligible.
   */
  update(snapshot: DebugOverlaySnapshot, dt = 1 / 60): void {
    const fpsRaw = snapshot.fps ?? snapshot.stats?.fps;
    if (fpsRaw !== undefined && Number.isFinite(fpsRaw)) {
      this.state.fps = clamp(fpsRaw, 0, 999);
      this.state.frameTimeMs =
        snapshot.stats?.frameTimeMs !== undefined && Number.isFinite(snapshot.stats.frameTimeMs)
          ? snapshot.stats.frameTimeMs
          : this.state.fps > 0.1
            ? 1000 / this.state.fps
            : 0;
    }

    const drawsRaw = snapshot.drawCalls ?? snapshot.stats?.drawCalls;
    if (drawsRaw !== undefined && Number.isFinite(drawsRaw)) {
      this.state.drawCalls = Math.max(0, Math.round(drawsRaw));
    }

    const trisRaw = snapshot.triangles ?? snapshot.stats?.triangles;
    if (trisRaw !== undefined && Number.isFinite(trisRaw)) {
      this.state.triangles = Math.max(0, Math.round(trisRaw));
    }

    if (snapshot.stats?.dlssMode) {
      this.state.dlssMode = snapshot.stats.dlssMode;
    }
    if (
      snapshot.stats?.renderScale !== undefined &&
      Number.isFinite(snapshot.stats.renderScale)
    ) {
      this.state.renderScale = clamp(snapshot.stats.renderScale, 0.25, 2.0);
    }

    const pos =
      snapshot.playerPosition ?? snapshot.playerPos ?? snapshot.player?.position;
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)) {
      this.state.playerPosition = { x: pos.x, y: pos.y, z: pos.z };
    }

    if (snapshot.player) {
      if (Number.isFinite(snapshot.player.level)) {
        this.state.playerLevel = snapshot.player.level;
      }
      if (Number.isFinite(snapshot.player.hp)) {
        this.state.playerHp = Math.round(snapshot.player.hp);
      }
      if (Number.isFinite(snapshot.player.stats?.maxHp)) {
        this.state.playerMaxHp = Math.round(snapshot.player.stats.maxHp);
      }
      if (Number.isFinite(snapshot.player.gold)) {
        this.state.playerGold = Math.round(snapshot.player.gold);
      }
    }

    const floorNum = snapshot.floorNumber ?? snapshot.floor?.floorNumber;
    if (floorNum !== undefined && Number.isFinite(floorNum)) {
      this.state.floorNumber = Math.max(0, Math.round(floorNum));
    }

    const biome = snapshot.biome ?? snapshot.floor?.biome;
    if (biome && BIOME_CONFIG[biome]) {
      this.state.biome = biome;
    }

    const seed = snapshot.seed ?? snapshot.floor?.seed;
    if (seed !== undefined && Number.isFinite(seed)) {
      this.state.seed = seed >>> 0;
    }

    const enemies = snapshot.activeEnemyCount ?? snapshot.activeEnemies;
    if (enemies !== undefined && Number.isFinite(enemies)) {
      this.state.activeEnemyCount = Math.max(0, Math.round(enemies));
    }

    if (snapshot.godMode !== undefined) {
      this.state.godMode = snapshot.godMode;
    }

    this.dirty = true;
    if (!this.state.visible || !this.rootEl) return;

    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    this.domRefreshAccumSec += safeDt;
    if (this.domRefreshAccumSec >= 0.1) {
      this.domRefreshAccumSec = 0;
      this.syncDomImmediate();
    }
  }

  /**
   * Returns a defensive copy of the current telemetry state for assertions and diagnostics.
   */
  getTelemetryState(): DebugTelemetryState {
    return {
      ...this.state,
      playerPosition: { ...this.state.playerPosition },
    };
  }

  /**
   * Cleans up keyboard listeners, EventBus subscriptions, and injected DOM elements.
   */
  dispose(): void {
    if (this.keydownHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes.length = 0;

    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
    this.domRefs = {};
  }

  private bindKeyboardShortcut(): void {
    if (
      this.keydownHandler ||
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function'
    ) {
      return;
    }

    this.keydownHandler = (e: KeyboardEvent): void => {
      if (e.code === this.toggleKey || e.key === this.toggleKey) {
        e.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  }

  private subscribeTelemetryEvents(): void {
    const track = (label: string): void => {
      this.state.eventsObserved++;
      this.state.lastEventLabel = label;
      this.dirty = true;
    };

    this.unsubscribes.push(
      this.bus.on('combat:damageDealt', () => track('combat:damageDealt')),
      this.bus.on('combat:enemyKilled', () => track('combat:enemyKilled')),
      this.bus.on('combat:elementalReaction', (p) => track(`reaction:${p.reaction}`)),
      this.bus.on('combat:parryTriggered', () => track('combat:parryTriggered')),
      this.bus.on('combat:executionStrike', () => track('combat:executionStrike')),
      this.bus.on('player:awakeningChanged', (p) =>
        track(`awakening:${p.active ? 'on' : 'off'}`),
      ),
      this.bus.on('player:levelUp', (p) => track(`player:levelUp(${p.level})`)),
      this.bus.on('boss:spawned', (p) => track(`boss:spawned(${p.bossId})`)),
      this.bus.on('boss:phaseChanged', (p) => track(`boss:phase(${p.phase})`)),
      this.bus.on('boss:defeated', (p) => track(`boss:defeated(${p.bossId})`)),
      this.bus.on('event:butcherInvasion', () => track('event:butcherInvasion')),
      this.bus.on('event:goblinSpawned', () => track('event:goblinSpawned')),
      this.bus.on('event:mimicRevealed', () => track('event:mimicRevealed')),
      this.bus.on('event:runewordForged', (p) => track(`runeword:${p.runewordName}`)),
      this.bus.on('rune:pickedUp', (p) => track(`rune:${p.runeId}`)),
      this.bus.on('loot:dropped', () => track('loot:dropped')),
    );
  }

  private ensureStylesInjected(): void {
    if (typeof document === 'undefined' || !document.head) return;
    const existing = document.getElementById(STYLE_ELEMENT_ID);
    if (existing) return;

    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = OVERLAY_CSS;
    document.head.appendChild(style);
    this.styleEl = style;
  }

  private syncDomImmediate(): void {
    if (!this.rootEl || !this.dirty) return;
    this.dirty = false;

    const { fps, frameTimeMs, drawCalls, triangles, playerPosition } = this.state;

    if (this.domRefs.fps) {
      this.domRefs.fps.textContent = `${Math.round(fps)} FPS (${frameTimeMs.toFixed(1)} ms)`;
      this.domRefs.fps.setAttribute(
        'data-tone',
        fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad',
      );
    }

    if (this.domRefs.render) {
      this.domRefs.render.textContent = `${drawCalls} dc / ${formatCompactCount(triangles)} tris`;
    }

    if (this.domRefs.upscale) {
      this.domRefs.upscale.textContent = `${this.state.dlssMode.toUpperCase()} (${Math.round(this.state.renderScale * 100)}%)`;
    }

    if (this.domRefs.coords) {
      this.domRefs.coords.textContent = `${playerPosition.x.toFixed(1)}, ${playerPosition.y.toFixed(1)}, ${playerPosition.z.toFixed(1)}`;
    }

    if (this.domRefs.hero) {
      this.domRefs.hero.textContent = `Lv.${this.state.playerLevel} | ${this.state.playerHp}/${this.state.playerMaxHp} HP | ${this.state.playerGold}g`;
    }

    if (this.domRefs.floor) {
      this.domRefs.floor.textContent = `F${this.state.floorNumber} (${this.state.biome})`;
    }

    if (this.domRefs.seed) {
      this.domRefs.seed.textContent = `#${this.state.seed}`;
    }

    if (this.domRefs.enemies) {
      this.domRefs.enemies.textContent = `${this.state.activeEnemyCount}`;
    }

    if (this.domRefs.events) {
      this.domRefs.events.textContent = `${this.state.eventsObserved} (${this.state.lastEventLabel})`;
    }

    if (this.domRefs.godBtn) {
      this.domRefs.godBtn.textContent = this.state.godMode ? 'Chế Độ Thần: BẬT' : 'Chế Độ Thần: TẮT';
      this.domRefs.godBtn.setAttribute('data-active', this.state.godMode ? 'true' : 'false');
    }

    if (this.domRefs.tier) {
      this.domRefs.tier.textContent = t('settings.quality');
    }

    if (this.domRefs.device) {
      this.domRefs.device.textContent = t('settings.deviceDetected');
    }
  }
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function createDebugOverlay(options?: DebugOverlayOptions): DebugOverlay {
  return new DebugOverlay(options);
}
