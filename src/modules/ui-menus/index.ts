import type {
  IMenusUI,
  MenuPanelId,
  MenusCallbacks,
  MenusRefreshContext,
  PlayerRuntimeState,
} from '../../contracts/types';
import { ExpansionModalsController } from './expansionModals';
import { InventoryPanelController } from './inventoryPanel';
import { JournalAndOverlaysController } from './journalSettingsOverlays';
import type { InventorySubTab } from './sanctuaryWorkbenches';
import { ConstellationPanelController } from './skillsConstellationPanel';
import { MENUS_CSS, MENUS_STYLE_ID } from './styles';
import { TitleScreenController } from './titleScreen';

function createDefaultPlayerState(): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'Champion',
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.5,
    hp: 150,
    mana: 80,
    stamina: 100,
    baseAttributes: {
      strength: 16,
      dexterity: 9,
      intelligence: 7,
      vitality: 15,
    },
    stats: {
      maxHp: 150,
      hpRegen: 1.5,
      maxMana: 80,
      manaRegen: 3,
      maxStamina: 100,
      staminaRegen: 15,
      moveSpeed: 6,
      attackPower: 24,
      spellPower: 12,
      armor: 18,
      critChance: 0.08,
      critMultiplier: 1.75,
      attackSpeed: 1.0,
      cooldownReduction: 0,
      lifeSteal: 0,
      dodgeChance: 0.05,
    },
    statuses: [],
    isDodging: false,
    invulnerableSec: 0,
    alive: true,
    healthPotions: 3,
    maxHealthPotions: 5,
    potionCooldownSec: 0,
    gold: 0,
    floorsCleared: 0,
    killsTotal: 0,
  };
}

function createDefaultRefreshContext(): MenusRefreshContext {
  return {
    hasSaveGame: false,
    player: createDefaultPlayerState(),
    inventory: [],
    equipped: {},
    stash: [],
    passiveNodes: [],
    allocatedPassives: {},
    quests: [],
    lore: [],
    achievements: [],
    settings: {
      masterVolume: 0.8,
      musicVolume: 0.55,
      sfxVolume: 0.85,
      graphicsQuality: 'high',
      cameraSensitivity: 1.0,
      showDamageNumbers: true,
      dlssMode: 'quality',
      dlssSharpness: 0.72,
      targetFps: 120,
      dynamicResolution: true,
    },
  };
}

export class MenusUI implements IMenusUI {
  private container: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private callbacks: MenusCallbacks | null = null;
  private activePanel: MenuPanelId = 'none';
  private settingsReturnPanel: MenuPanelId = 'none';
  private context: MenusRefreshContext = createDefaultRefreshContext();
  private lastRenderSignature = '';

  private readonly titleController = new TitleScreenController();
  private readonly inventoryController = new InventoryPanelController();
  private readonly constellationController = new ConstellationPanelController();
  private readonly journalAndOverlays = new JournalAndOverlaysController();
  private readonly expansionModals = new ExpansionModalsController();

  mount(container: HTMLElement, callbacks: MenusCallbacks): void {
    this.disposeRootOnly();
    this.container = container;
    this.callbacks = callbacks;

    this.injectScopedStyles();

    if (typeof document !== 'undefined') {
      const root = document.createElement('div');
      root.className = 'ar-menus-root is-hidden';
      container.appendChild(root);
      this.rootEl = root;
    }

    if (this.activePanel !== 'none') {
      this.renderActivePanel(undefined, true);
    }
  }

  openInventoryTab(subTab: InventorySubTab): void {
    this.inventoryController.setSubTab(subTab);
    this.openPanel('inventory');
  }

  openPanel(panel: MenuPanelId): void {
    const isChangingPanel = this.activePanel !== panel;
    if (panel === 'settings') {
      if (this.activePanel === 'title') {
        this.settingsReturnPanel = 'title';
      } else if (this.activePanel === 'pause') {
        this.settingsReturnPanel = 'pause';
      } else if (this.activePanel !== 'settings') {
        this.settingsReturnPanel = 'none';
      }
    } else {
      this.settingsReturnPanel = 'none';
    }

    if (this.activePanel === 'title' && panel !== 'title') {
      this.titleController.stopAtmosphere();
    }
    if (this.activePanel === 'skills' && panel !== 'skills') {
      this.constellationController.stopLoop();
    }

    this.activePanel = panel;
    this.lastRenderSignature = '';

    if (!this.rootEl) return;

    if (panel === 'none') {
      this.rootEl.classList.add('is-hidden');
      this.rootEl.innerHTML = '';
      return;
    }

    this.rootEl.classList.remove('is-hidden');
    this.renderActivePanel(undefined, isChangingPanel);
  }

  togglePanel(panel: 'inventory' | 'skills' | 'quests' | 'settings' | 'pause'): void {
    if (this.activePanel === panel) {
      if (panel === 'settings' && this.settingsReturnPanel === 'title') {
        this.openPanel('title');
      } else {
        this.openPanel('none');
      }
    } else {
      this.openPanel(panel);
    }
  }

  getActivePanel(): MenuPanelId {
    return this.activePanel;
  }

  isBlockingGameplayInput(): boolean {
    return this.activePanel !== 'none';
  }

  refresh(context: MenusRefreshContext): void {
    this.context = context;
    if (this.activePanel !== 'inventory') {
      this.inventoryController.syncSilentBaseline(context);
    }
    if (this.activePanel !== 'skills') {
      this.constellationController.syncSilentBaseline(context);
    }

    if (!this.rootEl || this.activePanel === 'none') {
      return;
    }
    if (
      this.activePanel === 'settings' &&
      this.journalAndOverlays.isActivelyDraggingControl()
    ) {
      return;
    }

    const nextSig = this.computePanelSignature(this.activePanel, context);
    if (nextSig === this.lastRenderSignature) {
      return;
    }

    this.renderActivePanel(nextSig, false);
  }

  dispose(): void {
    this.titleController.dispose();
    this.inventoryController.dispose();
    this.constellationController.dispose();
    this.disposeRootOnly();
    this.callbacks = null;
    this.container = null;
    this.activePanel = 'none';
    this.lastRenderSignature = '';

    if (typeof document !== 'undefined') {
      const remainingRoots = document.querySelectorAll('.ar-menus-root');
      if (remainingRoots.length === 0) {
        document.getElementById(MENUS_STYLE_ID)?.remove();
      }
    }
  }

  private disposeRootOnly(): void {
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
  }

  private injectScopedStyles(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById(MENUS_STYLE_ID)) return;
    const styleEl = document.createElement('style');
    styleEl.id = MENUS_STYLE_ID;
    styleEl.textContent = MENUS_CSS;
    document.head.appendChild(styleEl);
  }

  private closeInGameModal = (): void => {
    this.openPanel('none');
    this.callbacks?.onResumeGame();
  };

  private renderActivePanel(precomputedSig?: string, isEntering = false): void {
    if (!this.rootEl || this.activePanel === 'none') return;

    const scrollMemory = this.captureScrollPositions(this.rootEl);
    this.lastRenderSignature =
      precomputedSig ?? this.computePanelSignature(this.activePanel, this.context);

    switch (this.activePanel) {
      case 'title':
        this.titleController.render(
          this.rootEl,
          this.context,
          this.callbacks,
          () => this.openPanel('settings'),
        );
        break;

      case 'inventory':
        this.inventoryController.render(
          this.rootEl,
          this.context,
          this.callbacks,
          (next) => this.openPanel(next),
          this.closeInGameModal,
          isEntering,
        );
        break;

      case 'skills':
        this.constellationController.render(
          this.rootEl,
          this.context,
          this.callbacks,
          (next) => this.openPanel(next),
          this.closeInGameModal,
          isEntering,
        );
        break;

      case 'quests':
        this.journalAndOverlays.renderJournal(
          this.rootEl,
          this.context,
          (next) => this.openPanel(next),
          this.closeInGameModal,
          isEntering,
        );
        break;

      case 'settings':
        this.journalAndOverlays.renderSettings(
          this.rootEl,
          this.context,
          this.callbacks,
          this.settingsReturnPanel,
          (next) => this.openPanel(next),
          () => {
            if (this.settingsReturnPanel === 'title') {
              this.openPanel('title');
            } else if (this.settingsReturnPanel === 'pause') {
              this.openPanel('pause');
            } else {
              this.closeInGameModal();
            }
          },
          isEntering,
        );
        break;

      case 'pause':
        this.journalAndOverlays.renderPause(
          this.rootEl,
          this.context,
          this.callbacks,
          (sub) => this.openPanel(sub),
          this.closeInGameModal,
        );
        break;

      case 'death':
        this.journalAndOverlays.renderDeath(this.rootEl, this.context, this.callbacks);
        break;

      case 'victory':
        this.journalAndOverlays.renderVictory(
          this.rootEl,
          this.context,
          this.callbacks,
          this.closeInGameModal,
        );
        break;

      case 'obelisk':
        this.expansionModals.renderObeliskDraft(
          this.rootEl,
          this.context,
          this.callbacks,
          this.closeInGameModal,
          isEntering,
        );
        break;

      case 'world_map':
        this.expansionModals.renderWorldMap(
          this.rootEl,
          this.context,
          this.callbacks,
          (next) => this.openPanel(next),
          this.closeInGameModal,
          isEntering,
        );
        break;
    }

    this.restoreScrollPositions(this.rootEl, scrollMemory);
  }

  private captureScrollPositions(root: HTMLElement): Map<string, number> {
    const map = new Map<string, number>();
    root.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((el) => {
      const k = el.dataset.scrollKey;
      if (k && el.scrollTop > 0) {
        map.set(k, el.scrollTop);
      }
    });
    return map;
  }

  private restoreScrollPositions(root: HTMLElement, map: Map<string, number>): void {
    if (map.size === 0) return;
    root.querySelectorAll<HTMLElement>('[data-scroll-key]').forEach((el) => {
      const k = el.dataset.scrollKey;
      const saved = k ? map.get(k) : undefined;
      if (saved !== undefined) {
        el.scrollTop = saved;
      }
    });
  }

  private computePanelSignature(panel: MenuPanelId, ctx: MenusRefreshContext): string {
    const p = ctx.player;
    const headerSig = `${p?.level}:${Math.floor(p?.gold ?? 0)}:${p?.unspentAttributePoints}:${p?.unspentSkillPoints}:${(ctx.quests ?? []).filter((q) => q.status === 'active').length}`;

    switch (panel) {
      case 'none':
        return 'none';
      case 'title':
        return `title:${Boolean(ctx.hasSaveGame)}`;
      case 'inventory': {
        const serializeItemSig = (i: {
          id: string;
          upgradeLevel: number;
          sockets?: number;
          socketedRunes?: string[];
          runewordId?: string;
        }) =>
          `${i.id}+${i.upgradeLevel}s${i.sockets ?? 0}[${(i.socketedRunes ?? []).join('.')}]${i.runewordId ?? ''}`;

        const eqSig = Object.entries(ctx.equipped ?? {})
          .map(([slot, item]) => `${slot}=${item ? serializeItemSig(item) : ''}`)
          .join(',');
        const invSig = (ctx.inventory ?? []).map(serializeItemSig).join(',');
        const stashSig = (ctx.stash ?? []).map(serializeItemSig).join(',');
        const runesSig = Object.entries(ctx.ownedRunes ?? {})
          .map(([r, c]) => `${r}:${c}`)
          .join(',');
        const comp = ctx.companions;
        const compSig = comp
          ? `${comp.activePet}:${comp.activeMercenary}:${Math.round(comp.mercenaryHp)}:${comp.mercenaryAlive}`
          : '';
        const attrSig = p?.baseAttributes
          ? `${p.baseAttributes.strength},${p.baseAttributes.dexterity},${p.baseAttributes.intelligence},${p.baseAttributes.vitality}`
          : '';
        const statSig = p?.stats ? Object.values(p.stats).join(',') : '';
        return `inv:${this.inventoryController.getSubTab()}:${headerSig}:${Math.round(p?.hp ?? 0)}:${Math.floor(p?.xp ?? 0)}:${attrSig}:${statSig}:${eqSig}:${invSig}:${stashSig}:${runesSig}:${compSig}`;
      }
      case 'skills': {
        const allocSig = Object.entries(ctx.allocatedPassives ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join(',');
        return `skills:${headerSig}:${(ctx.passiveNodes ?? []).length}:${allocSig}`;
      }
      case 'quests': {
        const qSig = (ctx.quests ?? [])
          .map(
            (q) =>
              `${q.id}:${q.status}:${(q.objectives ?? []).map((o) => `${o.current}/${o.required}`).join(',')}`,
          )
          .join('|');
        const loreUnlocked = (ctx.lore ?? []).filter((l) => l.unlocked).length;
        const achUnlocked = (ctx.achievements ?? []).filter((a) => a.unlocked).length;
        return `quests:${headerSig}:${qSig}:${loreUnlocked}/${(ctx.lore ?? []).length}:${achUnlocked}/${(ctx.achievements ?? []).length}`;
      }
      case 'settings': {
        const s = ctx.settings;
        return `settings:${this.settingsReturnPanel}:${headerSig}:${s?.masterVolume?.toFixed(2)}:${s?.musicVolume?.toFixed(2)}:${s?.sfxVolume?.toFixed(2)}:${s?.graphicsQuality}:${s?.dlssMode ?? 'quality'}:${(s?.dlssSharpness ?? 0.72).toFixed(2)}:${s?.targetFps ?? 120}:${Boolean(s?.dynamicResolution ?? true)}:${s?.cameraSensitivity?.toFixed(2)}:${s?.showDamageNumbers}`;
      }
      case 'obelisk': {
        const pactSig = (ctx.obeliskChoices ?? []).map((c) => c.id).join(',');
        return `obelisk:${pactSig}`;
      }
      case 'world_map': {
        return `world_map:${headerSig}:${ctx.highestFloorUnlocked ?? 0}:${ctx.colosseumBestWave ?? 0}:${p?.floorsCleared ?? 0}`;
      }
      case 'pause':
      case 'death':
      case 'victory': {
        const achUnlocked = (ctx.achievements ?? []).filter((a) => a.unlocked).length;
        return `${panel}:${p?.heroClass}:${p?.level}:${p?.floorsCleared}:${p?.killsTotal}:${Math.floor(p?.gold ?? 0)}:${achUnlocked}`;
      }
    }
  }
}

export function createMenusUI(): IMenusUI {
  return new MenusUI();
}
