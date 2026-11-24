import type {
  ActiveWorldEventStatus,
  DamageType,
  DlssMode,
  HudSnapshot,
  ICameraRig,
  IHudUI,
  ItemRarity,
  PetId,
  QuestState,
  SkillSlotIndex,
  TargetFpsLimit,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import { BIOME_CONFIG, DAMAGE_TYPE_COLORS, MYTHIC_COLOR, clamp } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { t } from '../../core/i18n/index.js';
import {
  renderBossSkullSvg,
  renderGoldCoinSvg,
  renderMenuButtonSvg,
  renderPotionSvg,
  renderSkillSvg,
  renderStatusSvg,
  renderWingOrnamentSvg,
} from './icons';
import { MinimapRenderer } from './minimap';
import { WorldOverlayManager } from './overlays';
import { HUD_SCOPED_CSS, HUD_STYLE_ELEMENT_ID } from './styles';

type PanelToggleTarget = 'inventory' | 'skills' | 'quests' | 'settings';

interface SkillSlotRefs {
  btn: HTMLButtonElement;
  iconWrap: HTMLDivElement;
  cdSweep: HTMLDivElement;
  manaPip: HTMLSpanElement;
  ttName: HTMLDivElement;
  ttMeta: HTMLDivElement;
  ttDesc: HTMLDivElement;
  lastSkillSig: string;
  wasOnCooldown: boolean;
}

const SKILL_HOTKEYS: readonly string[] = ['LMB', 'RMB', '1', '2', '3', '4'];
const STAMINA_PIP_COUNT = 4;
const POTION_MAX_COOLDOWN_REF = 8;

const DLSS_MODE_LABELS: Record<DlssMode, string> = {
  native: 'NATIVE',
  dlaa: 'DLAA',
  quality: 'DLSS QUALITY',
  balanced: 'DLSS BALANCED',
  performance: 'DLSS PERF',
  ultra_performance: 'DLSS ULTRA',
};

const WEAPON_DISPLAY_NAMES: Record<WeaponVisualType, string> = {
  greatsword: 'Đại Kiếm Khắc Rune',
  daggers: 'Song Kiếm Độc Nha',
  staff: 'Trượng Tinh Tú',
  warhammer: 'Búa Chiến Titan',
  sword_shield: 'Kiếm & Khiên Hiệp Sĩ',
};

const PET_DISPLAY_NAMES: Record<PetId, string> = {
  celestial_owl: 'Cú Thiên Giới',
  ember_wyrmling: 'Rồng Lửa Non',
  void_kitsune: 'Hồ Ly Hư Không',
};

function toRoman(num: number): string {
  if (num <= 0) return '0';
  if (num === 1) return 'I';
  if (num === 2) return 'II';
  if (num === 3) return 'III';
  if (num === 4) return 'IV';
  if (num === 5) return 'V';
  if (num === 6) return 'VI';
  return String(num);
}

let activeStyleMountCount = 0;

function createWaveSvg(fillColor: string, extraClass = ''): string {
  const cls = extraClass ? `ar-globe-wave ${extraClass}` : 'ar-globe-wave';
  return `<svg viewBox="0 0 240 16" preserveAspectRatio="none" class="${cls}" aria-hidden="true">
    <path d="M0 8 Q 30 0, 60 8 T 120 8 T 180 8 T 240 8 L 240 16 L 0 16 Z" fill="${fillColor}"/>
  </svg>`;
}

export class HudUI implements IHudUI {
  private container: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private visible = true;
  private elapsedSec = 0;

  private overlays: WorldOverlayManager | null = null;
  private minimap: MinimapRenderer | null = null;

  // Low-HP vignette
  private lowHpVignetteEl: HTMLDivElement | null = null;

  // Boss & Cursed Event refs
  private bossFrameEl: HTMLDivElement | null = null;
  private bossNameEl: HTMLDivElement | null = null;
  private bossSubEl: HTMLDivElement | null = null;
  private bossPhaseEl: HTMLDivElement | null = null;
  private bossTrailEl: HTMLDivElement | null = null;
  private bossFillEl: HTMLDivElement | null = null;
  private bossHpTextEl: HTMLDivElement | null = null;
  private bossStaggerRowEl: HTMLDivElement | null = null;
  private bossStaggerFillEl: HTMLDivElement | null = null;
  private bossStaggerLabelEl: HTMLSpanElement | null = null;
  private lastBossId = '';
  private bossTrailPct = 100;

  private cursedBannerEl: HTMLDivElement | null = null;
  private cursedTimerEl: HTMLSpanElement | null = null;
  private cursedWavesEl: HTMLSpanElement | null = null;

  // Top-left Companion & Training Dummy DPS Meter refs
  private compCardEl: HTMLDivElement | null = null;
  private compNameEl: HTMLSpanElement | null = null;
  private compLvlEl: HTMLSpanElement | null = null;
  private compHpFillEl: HTMLDivElement | null = null;
  private compPetEl: HTMLSpanElement | null = null;
  private compHpTextEl: HTMLSpanElement | null = null;

  private dpsCardEl: HTMLDivElement | null = null;
  private dpsMainValEl: HTMLDivElement | null = null;
  private dpsPeakEl: HTMLSpanElement | null = null;
  private dpsTotalEl: HTMLSpanElement | null = null;

  // Top-right refs
  private biomeTitleEl: HTMLDivElement | null = null;
  private floorSubEl: HTMLDivElement | null = null;
  private dlssPillEl: HTMLDivElement | null = null;
  private dlssTextEl: HTMLSpanElement | null = null;
  private fpsBadgeEl: HTMLDivElement | null = null;
  private worldEventsStackEl: HTMLDivElement | null = null;
  private lastWorldEventsSig = '';
  private questTrackerEl: HTMLDivElement | null = null;
  private questListEl: HTMLDivElement | null = null;
  private lastBiomeKey = '';
  private lastFpsInt = -1;
  private lastDlssSig = '';
  private lastQuestSig = '';
  private cachedDlssMode: DlssMode = 'quality';
  private cachedRenderScale = 0.77;
  private cachedTargetFps: TargetFpsLimit = 120;

  // Combo meter refs
  private comboWidgetEl: HTMLDivElement | null = null;
  private comboRankEl: HTMLDivElement | null = null;
  private comboCountEl: HTMLDivElement | null = null;
  private comboMultEl: HTMLDivElement | null = null;
  private comboFuseEl: HTMLDivElement | null = null;
  private comboPeakTimer = 4;

  // Bottom dock refs
  private playerStatusesEl: HTMLDivElement | null = null;
  private lastPlayerStatusSig = '';
  private masteryClusterEl: HTMLDivElement | null = null;
  private furyPillEl: HTMLDivElement | null = null;
  private furyFillEl: HTMLDivElement | null = null;
  private furyTextEl: HTMLSpanElement | null = null;
  private parryPillEl: HTMLDivElement | null = null;
  private parryTextEl: HTMLSpanElement | null = null;
  private staminaPipFills: HTMLDivElement[] = [];
  private goldValEl: HTMLSpanElement | null = null;
  private lastGold = -1;

  private hpGlobeEl: HTMLDivElement | null = null;
  private hpLiquidEl: HTMLDivElement | null = null;
  private hpValEl: HTMLDivElement | null = null;
  private lastHpText = '';
  private prevHp = -1;
  private hpRippleTimerSec = 0;

  private manaGlobeEl: HTMLDivElement | null = null;
  private manaLiquidEl: HTMLDivElement | null = null;
  private manaValEl: HTMLDivElement | null = null;
  private lastManaText = '';
  private prevMana = -1;
  private manaRippleTimerSec = 0;

  private skillSlots: SkillSlotRefs[] = [];

  private potionBtnEl: HTMLButtonElement | null = null;
  private potionSweepEl: HTMLDivElement | null = null;
  private potionCountEl: HTMLSpanElement | null = null;

  private inventoryBtnEl: HTMLButtonElement | null = null;
  private bagPopTimerSec = 0;
  private attrBadgeEl: HTMLSpanElement | null = null;
  private skillBadgeEl: HTMLSpanElement | null = null;
  private lastWorldToScreen: ICameraRig['worldToScreen'] | null = null;

  private levelCrestEl: HTMLSpanElement | null = null;
  private xpFillEl: HTMLDivElement | null = null;
  private xpReadoutEl: HTMLSpanElement | null = null;
  private lastXpSig = '';

  // ── Performance throttle ──────────────────────────────────────────────────
  private performanceTier: 'low' | 'medium' | 'high' = 'high';
  private lastHudUpdate = 0;
  private rafPending = false;
  private rafQueue: Array<() => void> = [];

  // Click callbacks
  private skillClickHandlers: Array<(slot: SkillSlotIndex) => void> = [];
  private panelToggleHandlers: Array<(panel: PanelToggleTarget) => void> = [];

  // EventBus unsubscribers & microtask deduplication counters
  private unsubscribers: Array<() => void> = [];
  private busSeenThisTick = new Map<string, number>();
  private directSeenThisTick = new Map<string, number>();
  private dedupClearScheduled = false;
  private ownsStyleRef = false;

  public mount(container: HTMLElement): void {
    if (this.rootEl) {
      this.teardownDomOnly();
    }

    this.container = container;
    this.ensureStylesInjected();

    const root = document.createElement('div');
    root.className = 'ar-hud-root';
    if (!this.visible) {
      root.classList.add('ar-hud-hidden');
    }
    this.rootEl = root;

    // 1. Low-HP Crimson Vignette
    const vignette = document.createElement('div');
    vignette.className = 'ar-low-hp-vignette';
    root.appendChild(vignette);
    this.lowHpVignetteEl = vignette;

    // 2. Pooled World-Space Overlays + Center Banner + Bottom-Left Toasts
    this.overlays = new WorldOverlayManager(root);

    // 3. Top-Left Companion Mini-Status & Sanctuary DPS Meter
    this.buildTopLeft(root);

    // 4. Top-Center Pinnacle Boss Bar & Cursed Event Timer
    this.buildTopCenter(root);

    // 4. Top-Right Fog-of-War Minimap & Active Quest Tracker
    this.buildTopRight(root);

    // 5. Kill-Streak Combo Meter
    this.buildComboWidget(root);

    // 6. Bottom Ornate Action Bar
    this.buildBottomActionBar(root);

    container.appendChild(root);
    this.bindEventBus();
  }

  private ensureStylesInjected(): void {
    if (typeof document === 'undefined') return;
    let styleEl = document.getElementById(HUD_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = HUD_STYLE_ELEMENT_ID;
      styleEl.textContent = HUD_SCOPED_CSS;
      document.head.appendChild(styleEl);
    }
    if (!this.ownsStyleRef) {
      activeStyleMountCount++;
      this.ownsStyleRef = true;
    }
  }

  private bindEventBus(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    this.unsubscribers.push(
      eventBus.on('ui:damageNumber', (p) => {
        const key = this.makeDmgKey(p.worldPos, p.amount, p.isCrit, p.damageType, p.isPlayerHit);
        if (this.consumeCounter(this.directSeenThisTick, key)) return;
        this.incrementCounter(this.busSeenThisTick, key);
        this.overlays?.spawnDamageNumber(
          p.worldPos,
          p.amount,
          p.isCrit,
          p.damageType,
          p.isPlayerHit,
        );
      }),
    );

    this.unsubscribers.push(
      eventBus.on('ui:banner', (p) => {
        const key = `b:${p.title}:${p.subtitle ?? ''}:${p.tone ?? 'gold'}`;
        if (this.consumeCounter(this.directSeenThisTick, key)) return;
        this.incrementCounter(this.busSeenThisTick, key);
        this.overlays?.showBanner(p.title, p.subtitle, p.tone);
      }),
    );

    this.unsubscribers.push(
      eventBus.on('ui:toast', (p) => {
        const key = `t:${p.message}:${p.rarity ?? ''}`;
        if (this.consumeCounter(this.directSeenThisTick, key)) return;
        this.incrementCounter(this.busSeenThisTick, key);
        this.overlays?.showToast(p.message, p.rarity);
      }),
    );

    this.unsubscribers.push(
      eventBus.on('engine:dlssChanged', (p) => {
        this.cachedDlssMode = p.mode;
        this.cachedRenderScale = p.renderScale;
        this.cachedTargetFps = p.targetFps;
      }),
    );

    this.unsubscribers.push(
      eventBus.on('combat:damageDealt', (p) => {
        if (p.targetIsPlayer && p.result.finalDamage > 0) {
          this.triggerGlobeRipple('hp', 'ar-hit-ripple');
        }
      }),
    );

    this.unsubscribers.push(
      eventBus.on('combat:elementalReaction', (p) => {
        this.overlays?.spawnReactionCallout(p.position, p.reaction, p.damage);
      }),
    );

    this.unsubscribers.push(
      eventBus.on('loot:pickedUp', (p) => {
        if (p.drop.kind !== 'item' && p.drop.kind !== 'rune' && !p.drop.item) return;
        const rarity: ItemRarity = p.drop.item?.rarity ?? 'rare';
        const overrideColor = p.drop.item?.isMythic
          ? MYTHIC_COLOR.css
          : p.drop.kind === 'rune'
            ? '#ffe066'
            : undefined;
        const startScreen = this.resolvePickupStartScreen(p.drop.position, p.screenStart);
        this.overlays?.spawnFlyingLootToBag(
          startScreen,
          () => this.getInventoryButtonCenter(),
          rarity,
          (colorCss) => this.triggerInventoryBagPop(colorCss),
          overrideColor,
        );
      }),
    );

    this.unsubscribers.push(
      eventBus.on('rune:pickedUp', (p) => {
        const startScreen = this.resolvePickupStartScreen(p.position);
        this.overlays?.spawnFlyingLootToBag(
          startScreen,
          () => this.getInventoryButtonCenter(),
          'legendary',
          (colorCss) => this.triggerInventoryBagPop(colorCss),
          '#ffe066',
        );
      }),
    );

    this.unsubscribers.push(
      eventBus.on('event:runewordForged', (p) => {
        this.overlays?.showGearSwapBanner(
          `${t('craft.runeword')}: ${p.runewordName}`,
          `${t('craft.runewordUnlocked').toUpperCase()} \u2022 ${p.item.slot.toUpperCase()}`,
          'legendary',
          MYTHIC_COLOR.css,
        );
      }),
    );

    this.unsubscribers.push(
      eventBus.on('hero:gearChanged', (p) => {
        const rarity: ItemRarity = p.rarity ?? p.item?.rarity ?? 'common';
        const isMythic = Boolean(p.item?.isMythic);
        const upg = p.item && p.item.upgradeLevel > 0 ? ` +${p.item.upgradeLevel}` : '';
        const baseName = p.item?.runewordName ?? p.item?.name;
        const title = baseName
          ? `${baseName}${upg}`
          : WEAPON_DISPLAY_NAMES[p.weaponVisual] ?? t('item.weapon') + ' ' + t('item.equip');
        const slotLabel =
          p.slot === 'all' ? 'KHO VŨ KHÍ' : `${p.slot.toUpperCase()} ${t('item.equip').toUpperCase()}`;
        const tierLabel = isMythic
          ? `${t('rarity.mythic').toUpperCase()} PRIMAL`
          : p.item?.setName
            ? `BỘ (${p.item.setName.toUpperCase()})`
            : t(`rarity.${p.item?.rarity ?? rarity}`).toUpperCase();
        const meta = `${tierLabel} \u2022 ${slotLabel}`;
        this.overlays?.showGearSwapBanner(
          title,
          meta,
          rarity,
          isMythic ? MYTHIC_COLOR.css : undefined,
        );
      }),
    );
  }

  private resolvePickupStartScreen(worldPos: Vec3, screenStart?: Vec3): { x: number; y: number } {
    const vw = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight || 720 : 720;

    if (screenStart && Number.isFinite(screenStart.x) && Number.isFinite(screenStart.y)) {
      const looksLikeWorldVec3 =
        Math.abs(screenStart.z || 0) > 1e-3 || Math.abs(screenStart.y) < 32;
      if (!looksLikeWorldVec3) {
        return { x: screenStart.x, y: screenStart.y };
      }
      if (this.lastWorldToScreen) {
        const proj = this.lastWorldToScreen(screenStart);
        if (proj.visible && Number.isFinite(proj.x) && Number.isFinite(proj.y)) {
          return { x: proj.x, y: proj.y };
        }
      }
    }

    if (this.lastWorldToScreen) {
      const proj = this.lastWorldToScreen({
        x: worldPos.x,
        y: worldPos.y + 1.0,
        z: worldPos.z,
      });
      if (proj.visible && Number.isFinite(proj.x) && Number.isFinite(proj.y)) {
        return { x: proj.x, y: proj.y };
      }
    }

    return { x: vw * 0.5, y: vh * 0.52 };
  }

  private getInventoryButtonCenter(): { x: number; y: number } {
    const vw = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight || 720 : 720;
    if (this.inventoryBtnEl && typeof this.inventoryBtnEl.getBoundingClientRect === 'function') {
      const rect = this.inventoryBtnEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
      }
    }
    return { x: vw * 0.5 + 158, y: vh - 48 };
  }

  private triggerInventoryBagPop(colorCss: string): void {
    if (!this.inventoryBtnEl) return;
    this.inventoryBtnEl.style.setProperty('--bag-pop-color', colorCss);
    this.inventoryBtnEl.classList.remove('ar-bag-pop');
    void this.inventoryBtnEl.offsetWidth;
    this.inventoryBtnEl.classList.add('ar-bag-pop');
    this.bagPopTimerSec = 0.46;
  }

  private triggerGlobeRipple(
    globe: 'hp' | 'mana',
    cls: 'ar-hit-ripple' | 'ar-heal-ripple' | 'ar-cast-ripple',
  ): void {
    const el = globe === 'hp' ? this.hpGlobeEl : this.manaGlobeEl;
    if (!el) return;
    el.classList.remove('ar-hit-ripple', 'ar-heal-ripple', 'ar-cast-ripple');
    void el.offsetWidth;
    el.classList.add(cls);
    if (globe === 'hp') this.hpRippleTimerSec = 0.52;
    else this.manaRippleTimerSec = 0.46;
  }

  private makeDmgKey(
    pos: Vec3,
    amount: number,
    isCrit: boolean,
    damageType: DamageType,
    isPlayerHit?: boolean,
  ): string {
    const rx = Math.round((pos?.x ?? 0) * 50);
    const ry = Math.round((pos?.y ?? 0) * 50);
    const rz = Math.round((pos?.z ?? 0) * 50);
    return `d:${rx},${ry},${rz}:${Math.round(amount)}:${isCrit ? 1 : 0}:${damageType}:${isPlayerHit ? 1 : 0}`;
  }

  private incrementCounter(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
    if (!this.dedupClearScheduled) {
      this.dedupClearScheduled = true;
      queueMicrotask(() => {
        this.busSeenThisTick.clear();
        this.directSeenThisTick.clear();
        this.dedupClearScheduled = false;
      });
    }
  }

  private consumeCounter(map: Map<string, number>, key: string): boolean {
    const count = map.get(key) ?? 0;
    if (count > 0) {
      if (count === 1) map.delete(key);
      else map.set(key, count - 1);
      return true;
    }
    return false;
  }

  private buildTopLeft(root: HTMLElement): void {
    const wrap = document.createElement('div');
    wrap.className = 'ar-top-left';

    // Companion & Mercenary Mini-Status Card
    const compCard = document.createElement('div');
    compCard.className = 'ar-companion-card';
    const compHdr = document.createElement('div');
    compHdr.className = 'ar-comp-header';
    this.compNameEl = document.createElement('span');
    this.compNameEl.className = 'ar-comp-name';
    this.compLvlEl = document.createElement('span');
    this.compLvlEl.className = 'ar-comp-lvl';
    compHdr.append(this.compNameEl, this.compLvlEl);

    const hpTrack = document.createElement('div');
    hpTrack.className = 'ar-comp-hp-track';
    this.compHpFillEl = document.createElement('div');
    this.compHpFillEl.className = 'ar-comp-hp-fill';
    hpTrack.appendChild(this.compHpFillEl);

    const petRow = document.createElement('div');
    petRow.className = 'ar-comp-pet-row';
    this.compPetEl = document.createElement('span');
    this.compHpTextEl = document.createElement('span');
    petRow.append(this.compPetEl, this.compHpTextEl);

    compCard.append(compHdr, hpTrack, petRow);
    this.compCardEl = compCard;

    // Live Training Dummy DPS Meter (Sanctuary Hub)
    const dpsCard = document.createElement('div');
    dpsCard.className = 'ar-dps-meter-card';
    const dpsTitle = document.createElement('div');
    dpsTitle.className = 'ar-dps-title';
    dpsTitle.textContent = '\u2694 Hình Nộm DPS';
    this.dpsMainValEl = document.createElement('div');
    this.dpsMainValEl.className = 'ar-dps-main-val';
    this.dpsMainValEl.textContent = '0 DPS';
    const dpsSub = document.createElement('div');
    dpsSub.className = 'ar-dps-sub-stats';
    this.dpsPeakEl = document.createElement('span');
    this.dpsTotalEl = document.createElement('span');
    dpsSub.append(this.dpsPeakEl, this.dpsTotalEl);
    dpsCard.append(dpsTitle, this.dpsMainValEl, dpsSub);
    this.dpsCardEl = dpsCard;

    wrap.append(compCard, dpsCard);
    root.appendChild(wrap);
  }

  private buildTopCenter(root: HTMLElement): void {
    const wrap = document.createElement('div');
    wrap.className = 'ar-top-center';

    // Pinnacle Boss Health Bar
    const bossFrame = document.createElement('div');
    bossFrame.className = 'ar-boss-frame';

    const hdr = document.createElement('div');
    hdr.className = 'ar-boss-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'ar-boss-title-group';
    const skull = document.createElement('div');
    skull.className = 'ar-boss-skull';
    skull.innerHTML = renderBossSkullSvg();

    const textCol = document.createElement('div');
    this.bossNameEl = document.createElement('div');
    this.bossNameEl.className = 'ar-boss-name';
    this.bossSubEl = document.createElement('div');
    this.bossSubEl.className = 'ar-boss-subtitle';
    textCol.append(this.bossNameEl, this.bossSubEl);
    titleGroup.append(skull, textCol);

    this.bossPhaseEl = document.createElement('div');
    this.bossPhaseEl.className = 'ar-boss-phase-badge';
    hdr.append(titleGroup, this.bossPhaseEl);

    const barShell = document.createElement('div');
    barShell.className = 'ar-boss-bar-shell';

    this.bossTrailEl = document.createElement('div');
    this.bossTrailEl.className = 'ar-boss-bar-trail';

    this.bossFillEl = document.createElement('div');
    this.bossFillEl.className = 'ar-boss-bar-fill';

    // Phase notches at 30% (Phase 3) and 65% (Phase 2)
    const notch30 = document.createElement('div');
    notch30.className = 'ar-boss-notch';
    notch30.style.left = '30%';

    const notch65 = document.createElement('div');
    notch65.className = 'ar-boss-notch';
    notch65.style.left = '65%';

    this.bossHpTextEl = document.createElement('div');
    this.bossHpTextEl.className = 'ar-boss-hp-text';

    barShell.append(this.bossTrailEl, this.bossFillEl, notch30, notch65, this.bossHpTextEl);

    // Boss Stagger Bar beneath Boss HP
    const staggerRow = document.createElement('div');
    staggerRow.className = 'ar-boss-stagger-row';
    const staggerTrack = document.createElement('div');
    staggerTrack.className = 'ar-boss-stagger-track';
    const staggerFill = document.createElement('div');
    staggerFill.className = 'ar-boss-stagger-fill';
    staggerTrack.appendChild(staggerFill);
    const staggerLabel = document.createElement('span');
    staggerLabel.className = 'ar-boss-stagger-label';
    staggerLabel.textContent = `${t('hud.stagger')} 0%`;
    staggerRow.append(staggerTrack, staggerLabel);

    this.bossStaggerRowEl = staggerRow;
    this.bossStaggerFillEl = staggerFill;
    this.bossStaggerLabelEl = staggerLabel;

    bossFrame.append(hdr, barShell, staggerRow);
    this.bossFrameEl = bossFrame;

    // Cursed Event Countdown Banner
    const cursedBanner = document.createElement('div');
    cursedBanner.className = 'ar-cursed-banner';
    const cursedTitle = document.createElement('span');
    cursedTitle.className = 'ar-cursed-title';
    cursedTitle.textContent = '\u2620 ' + t('event.cursed');
    const cursedTimer = document.createElement('span');
    cursedTimer.className = 'ar-cursed-timer';
    const cursedWaves = document.createElement('span');
    cursedWaves.className = 'ar-cursed-waves';
    cursedBanner.append(cursedTitle, cursedTimer, cursedWaves);
    this.cursedTimerEl = cursedTimer;
    this.cursedWavesEl = cursedWaves;
    this.cursedBannerEl = cursedBanner;

    wrap.append(bossFrame, cursedBanner);
    root.appendChild(wrap);
  }

  private buildTopRight(root: HTMLElement): void {
    const wrap = document.createElement('div');
    wrap.className = 'ar-top-right';

    const mapCard = document.createElement('div');
    mapCard.className = 'ar-minimap-card';

    const hdr = document.createElement('div');
    hdr.className = 'ar-minimap-header';
    const titleWrap = document.createElement('div');
    this.biomeTitleEl = document.createElement('div');
    this.biomeTitleEl.className = 'ar-biome-title';
    this.floorSubEl = document.createElement('div');
    this.floorSubEl.className = 'ar-floor-sub';
    titleWrap.append(this.biomeTitleEl, this.floorSubEl);
    hdr.appendChild(titleWrap);

    const telemetryRow = document.createElement('div');
    telemetryRow.className = 'ar-telemetry-row';

    const dlssPill = document.createElement('div');
    dlssPill.className = 'ar-perf-pill';
    const dlssDot = document.createElement('span');
    dlssDot.className = 'ar-perf-dot';
    const dlssText = document.createElement('span');
    dlssText.textContent = 'DLSS QUALITY 0.77x \u2022 120Hz';
    dlssPill.append(dlssDot, dlssText);
    this.dlssPillEl = dlssPill;
    this.dlssTextEl = dlssText;

    this.fpsBadgeEl = document.createElement('div');
    this.fpsBadgeEl.className = 'ar-fps-badge';
    this.fpsBadgeEl.textContent = '120 FPS';
    telemetryRow.append(dlssPill, this.fpsBadgeEl);

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'ar-minimap-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'ar-minimap-canvas';
    const north = document.createElement('span');
    north.className = 'ar-minimap-north';
    north.textContent = 'N';
    canvasWrap.append(canvas, north);

    this.minimap = new MinimapRenderer(canvas);

    const legend = document.createElement('div');
    legend.className = 'ar-minimap-legend';
    legend.innerHTML =
      '<span style="color:#ff6b6b">\u25CF K\u1ebb Thù</span>' +
      '<span style="color:#74c0fc">\u25C6 B\u1ec7 Th\u1edd</span>' +
      '<span style="color:#ffd43b">\u25A0 R\u01b0\u01a1ng</span>' +
      '<span style="color:#ffa8a8">\u2620 ' + t('hud.boss') + '</span>';

    mapCard.append(hdr, telemetryRow, canvasWrap, legend);

    // Active Quest Tracker
    const tracker = document.createElement('div');
    tracker.className = 'ar-quest-tracker';
    const trackerHdr = document.createElement('div');
    trackerHdr.className = 'ar-quest-tracker-hdr';
    trackerHdr.textContent = t('quest.active');
    this.questListEl = document.createElement('div');
    this.questListEl.style.display = 'flex';
    this.questListEl.style.flexDirection = 'column';
    this.questListEl.style.gap = '7px';
    tracker.append(trackerHdr, this.questListEl);
    this.questTrackerEl = tracker;

    // Dynamic World Event Trackers (Butcher, Goblin, Escort, Rift, Colosseum, Obelisk Pacts)
    const worldEventsStack = document.createElement('div');
    worldEventsStack.className = 'ar-world-events-stack';
    this.worldEventsStackEl = worldEventsStack;

    wrap.append(mapCard, worldEventsStack, tracker);
    root.appendChild(wrap);
  }

  private buildComboWidget(root: HTMLElement): void {
    const widget = document.createElement('div');
    widget.className = 'ar-combo-widget';

    this.comboRankEl = document.createElement('div');
    this.comboRankEl.className = 'ar-combo-rank';
    this.comboCountEl = document.createElement('div');
    this.comboCountEl.className = 'ar-combo-count';
    this.comboMultEl = document.createElement('div');
    this.comboMultEl.className = 'ar-combo-mult';

    const fuseTrack = document.createElement('div');
    fuseTrack.className = 'ar-combo-fuse-track';
    this.comboFuseEl = document.createElement('div');
    this.comboFuseEl.className = 'ar-combo-fuse-fill';
    fuseTrack.appendChild(this.comboFuseEl);

    widget.append(this.comboRankEl, this.comboCountEl, this.comboMultEl, fuseTrack);
    this.comboWidgetEl = widget;
    root.appendChild(widget);
  }

  private buildBottomActionBar(root: HTMLElement): void {
    const dock = document.createElement('div');
    dock.className = 'ar-bottom-dock';

    // Upper sub-row: Active Statuses, Stamina Pips, Gold Pill
    const upperRow = document.createElement('div');
    upperRow.className = 'ar-status-stamina-row';

    this.playerStatusesEl = document.createElement('div');
    this.playerStatusesEl.className = 'ar-player-statuses';

    // [R] Awakening Fury & [V] Parry Mastery Cluster
    const masteryCluster = document.createElement('div');
    masteryCluster.className = 'ar-mastery-cluster';

    const furyPill = document.createElement('div');
    furyPill.className = 'ar-fury-pill';
    this.stopWorldClickThrough(furyPill);
    const furyFill = document.createElement('div');
    furyFill.className = 'ar-fury-fill-bg';
    const furyKey = document.createElement('span');
    furyKey.className = 'ar-mastery-key';
    furyKey.textContent = 'R';
    const furyText = document.createElement('span');
    furyText.className = 'ar-fury-text';
    furyText.textContent = `${t('hud.fury')} 0%`;
    furyPill.append(furyFill, furyKey, furyText);
    furyPill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window !== 'undefined' && typeof KeyboardEvent !== 'undefined') {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }),
        );
      }
    });
    this.furyPillEl = furyPill;
    this.furyFillEl = furyFill;
    this.furyTextEl = furyText;

    const parryPill = document.createElement('div');
    parryPill.className = 'ar-parry-pill';
    this.stopWorldClickThrough(parryPill);
    const parryKey = document.createElement('span');
    parryKey.className = 'ar-mastery-key';
    parryKey.textContent = 'V';
    const parryText = document.createElement('span');
    parryText.className = 'ar-parry-text';
    parryText.textContent = 'ĐỠ ĐÒN';
    parryPill.append(parryKey, parryText);
    parryPill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window !== 'undefined' && typeof KeyboardEvent !== 'undefined') {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true }),
        );
      }
    });
    this.parryPillEl = parryPill;
    this.parryTextEl = parryText;

    masteryCluster.append(furyPill, parryPill);
    this.masteryClusterEl = masteryCluster;

    const staminaCluster = document.createElement('div');
    staminaCluster.className = 'ar-stamina-cluster';
    const stamLabel = document.createElement('span');
    stamLabel.className = 'ar-stamina-label';
    stamLabel.textContent = t('hud.stamina').toUpperCase();
    const pipsWrap = document.createElement('div');
    pipsWrap.className = 'ar-stamina-pips';
    this.staminaPipFills = [];
    for (let i = 0; i < STAMINA_PIP_COUNT; i++) {
      const pip = document.createElement('div');
      pip.className = 'ar-stamina-pip';
      const fill = document.createElement('div');
      fill.className = 'ar-stamina-pip-fill';
      pip.appendChild(fill);
      pipsWrap.appendChild(pip);
      this.staminaPipFills.push(fill);
    }
    staminaCluster.append(stamLabel, pipsWrap);

    const goldPill = document.createElement('div');
    goldPill.className = 'ar-gold-pill';
    const coinSpan = document.createElement('span');
    coinSpan.innerHTML = renderGoldCoinSvg();
    this.goldValEl = document.createElement('span');
    this.goldValEl.textContent = '0';
    goldPill.append(coinSpan, this.goldValEl);

    upperRow.append(this.playerStatusesEl, masteryCluster, staminaCluster, goldPill);

    // Main Action Pedestal
    const pedestal = document.createElement('div');
    pedestal.className = 'ar-action-pedestal';

    const leftWing = document.createElement('div');
    leftWing.innerHTML = renderWingOrnamentSvg('left');

    // Crimson Health Globe
    const hpGlobe = this.createGlobe('hp', t('hud.hp').toUpperCase(), '#ff6b6b', '#c92a2a');
    this.hpGlobeEl = hpGlobe.housing;
    this.hpLiquidEl = hpGlobe.liquid;
    this.hpValEl = hpGlobe.val;

    // Center Bridge (6 Skill Slots + Potion + Quick Menus + Golden XP Bar)
    const bridge = document.createElement('div');
    bridge.className = 'ar-center-bridge';
    this.stopWorldClickThrough(bridge);

    const slotsRow = document.createElement('div');
    slotsRow.className = 'ar-slots-row';

    this.skillSlots = [];
    for (let i = 0; i < 6; i++) {
      const slotIdx = i as SkillSlotIndex;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ar-skill-slot';

      const hotkey = document.createElement('span');
      hotkey.className = 'ar-hotkey-badge';
      hotkey.textContent = SKILL_HOTKEYS[i];

      const iconWrap = document.createElement('div');
      iconWrap.className = 'ar-skill-icon-wrap';

      const cdSweep = document.createElement('div');
      cdSweep.className = 'ar-skill-cd-sweep';

      const manaPip = document.createElement('span');
      manaPip.className = 'ar-mana-cost-pip';
      manaPip.style.display = 'none';

      const tooltip = document.createElement('div');
      tooltip.className = 'ar-skill-tooltip';
      const ttName = document.createElement('div');
      ttName.className = 'ar-tt-name';
      const ttMeta = document.createElement('div');
      ttMeta.className = 'ar-tt-meta';
      const ttDesc = document.createElement('div');
      ttDesc.className = 'ar-tt-desc';
      tooltip.append(ttName, ttMeta, ttDesc);

      btn.append(hotkey, iconWrap, cdSweep, manaPip, tooltip);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        eventBus.emit('sfx:request', { id: 'ui_click' });
        for (const handler of this.skillClickHandlers) {
          handler(slotIdx);
        }
      });

      slotsRow.appendChild(btn);
      this.skillSlots.push({
        btn,
        iconWrap,
        cdSweep,
        manaPip,
        ttName,
        ttMeta,
        ttDesc,
        lastSkillSig: '',
        wasOnCooldown: false,
      });
    }

    const div1 = document.createElement('div');
    div1.className = 'ar-divider-vert';
    slotsRow.appendChild(div1);

    // Health Potion Slot (Q)
    const potionBtn = document.createElement('button');
    potionBtn.type = 'button';
    potionBtn.className = 'ar-potion-slot';
    potionBtn.title = t('item.hpPotion') + ' [Q]';

    const potKey = document.createElement('span');
    potKey.className = 'ar-hotkey-badge';
    potKey.textContent = 'Q';

    const potIcon = document.createElement('div');
    potIcon.className = 'ar-skill-icon-wrap';
    potIcon.innerHTML = renderPotionSvg();

    const potSweep = document.createElement('div');
    potSweep.className = 'ar-skill-cd-sweep';

    const potCount = document.createElement('span');
    potCount.className = 'ar-potion-count';
    potCount.textContent = '0/0';

    potionBtn.append(potKey, potIcon, potSweep, potCount);
    potionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window !== 'undefined' && typeof KeyboardEvent !== 'undefined') {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }),
        );
      }
    });
    this.potionBtnEl = potionBtn;
    this.potionSweepEl = potSweep;
    this.potionCountEl = potCount;
    slotsRow.appendChild(potionBtn);

    const div2 = document.createElement('div');
    div2.className = 'ar-divider-vert';
    slotsRow.appendChild(div2);

    // Quick Menu Buttons: Inventory (I), Skills (K), Quests (J), Settings (Esc)
    const menusWrap = document.createElement('div');
    menusWrap.className = 'ar-quick-menus';

    const menuSpecs: Array<{
      panel: PanelToggleTarget;
      keyLabel: string;
      title: string;
      badgeKind?: 'attr' | 'skill';
    }> = [
      { panel: 'inventory', keyLabel: 'I', title: t('inventory.title') + ' [I]', badgeKind: 'attr' },
      { panel: 'skills', keyLabel: 'K', title: t('skill.ultimateSkill') + ' [K]', badgeKind: 'skill' },
      { panel: 'quests', keyLabel: 'J', title: t('quest.title') + ' [J]' },
      { panel: 'settings', keyLabel: 'Esc', title: t('settings.title') + ' [Esc]' },
    ];

    for (const spec of menuSpecs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ar-menu-btn';
      btn.title = spec.title;
      btn.innerHTML = renderMenuButtonSvg(spec.panel);

      const kSpan = document.createElement('span');
      kSpan.className = 'ar-menu-btn-key';
      kSpan.textContent = spec.keyLabel;
      btn.appendChild(kSpan);

      if (spec.badgeKind) {
        const badge = document.createElement('span');
        badge.className = 'ar-unspent-badge';
        btn.appendChild(badge);
        if (spec.badgeKind === 'attr') this.attrBadgeEl = badge;
        else this.skillBadgeEl = badge;
      }

      if (spec.panel === 'inventory') {
        this.inventoryBtnEl = btn;
      }

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        eventBus.emit('sfx:request', { id: 'ui_click' });
        for (const handler of this.panelToggleHandlers) {
          handler(spec.panel);
        }
      });
      menusWrap.appendChild(btn);
    }

    slotsRow.appendChild(menusWrap);

    // Full-Width Golden XP Bar Row
    const xpRow = document.createElement('div');
    xpRow.className = 'ar-xp-bar-row';
    this.levelCrestEl = document.createElement('span');
    this.levelCrestEl.className = 'ar-level-crest';
    this.levelCrestEl.textContent = `${t('hud.level')} 1`;

    const xpTrack = document.createElement('div');
    xpTrack.className = 'ar-xp-track';
    this.xpFillEl = document.createElement('div');
    this.xpFillEl.className = 'ar-xp-fill';
    const xpSegs = document.createElement('div');
    xpSegs.className = 'ar-xp-segments';
    xpTrack.append(this.xpFillEl, xpSegs);

    this.xpReadoutEl = document.createElement('span');
    this.xpReadoutEl.className = 'ar-xp-readout';
    this.xpReadoutEl.textContent = `0 / 100 ${t('hud.exp')}`;

    xpRow.append(this.levelCrestEl, xpTrack, this.xpReadoutEl);
    bridge.append(slotsRow, xpRow);

    // Sapphire Mana Globe
    const manaGlobe = this.createGlobe('mana', t('hud.mana').toUpperCase(), '#74c0fc', '#1d6fe8');
    this.manaGlobeEl = manaGlobe.housing;
    this.manaLiquidEl = manaGlobe.liquid;
    this.manaValEl = manaGlobe.val;

    const rightWing = document.createElement('div');
    rightWing.innerHTML = renderWingOrnamentSvg('right');

    pedestal.append(
      leftWing.firstElementChild ?? leftWing,
      hpGlobe.housing,
      bridge,
      manaGlobe.housing,
      rightWing.firstElementChild ?? rightWing,
    );

    dock.append(upperRow, pedestal);
    root.appendChild(dock);
  }

  private createGlobe(
    kind: 'hp' | 'mana',
    label: string,
    waveFrontHex: string,
    waveBackHex: string,
  ): {
    housing: HTMLDivElement;
    liquid: HTMLDivElement;
    val: HTMLDivElement;
  } {
    const housing = document.createElement('div');
    housing.className = `ar-globe-housing ar-${kind}-globe`;
    this.stopWorldClickThrough(housing);

    const clip = document.createElement('div');
    clip.className = 'ar-globe-clip';

    const liquid = document.createElement('div');
    liquid.className = 'ar-globe-liquid';
    liquid.innerHTML =
      createWaveSvg(waveBackHex, 'ar-wave-back') +
      createWaveSvg(waveFrontHex) +
      '<div class="ar-globe-caustics"></div>' +
      '<div class="ar-globe-caustics ar-caustics-secondary"></div>';
    clip.appendChild(liquid);

    const ripple = document.createElement('div');
    ripple.className = 'ar-globe-ripple';

    const gloss = document.createElement('div');
    gloss.className = 'ar-globe-gloss';

    const readout = document.createElement('div');
    readout.className = 'ar-globe-readout';
    const val = document.createElement('div');
    val.className = 'ar-globe-val';
    val.textContent = '100/100';
    const lbl = document.createElement('div');
    lbl.className = 'ar-globe-label';
    lbl.textContent = label;
    readout.append(val, lbl);

    housing.append(clip, ripple, gloss, readout);
    return { housing, liquid, val };
  }

  private stopWorldClickThrough(el: HTMLElement): void {
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stop);
    el.addEventListener('mousedown', stop);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  public setPerformanceTier(tier: string): void {
    if (tier === 'low' || tier === 'medium' || tier === 'high') {
      this.performanceTier = tier;
    }
  }

  private scheduleRaf(fn: () => void): void {
    this.rafQueue.push(fn);
    if (!this.rafPending) {
      this.rafPending = true;
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
          this.rafPending = false;
          const batch = this.rafQueue.splice(0);
          for (const f of batch) f();
        });
      } else {
        // SSR / test fallback: run synchronously
        this.rafPending = false;
        const batch = this.rafQueue.splice(0);
        for (const f of batch) f();
      }
    }
  }

  public setVisible(visible: boolean): void {
    this.visible = Boolean(visible);
    if (this.rootEl) {
      this.rootEl.classList.toggle('ar-hud-hidden', !this.visible);
    }
  }

  public spawnDamageNumber(
    worldPos: Vec3,
    amount: number,
    isCrit: boolean,
    damageType: DamageType,
    isPlayerHit?: boolean,
  ): void {
    const key = this.makeDmgKey(worldPos, amount, isCrit, damageType, isPlayerHit);
    if (this.consumeCounter(this.busSeenThisTick, key)) return;
    this.incrementCounter(this.directSeenThisTick, key);
    this.overlays?.spawnDamageNumber(worldPos, amount, isCrit, damageType, isPlayerHit);
  }

  public showBanner(
    title: string,
    subtitle?: string,
    tone: 'gold' | 'crimson' | 'arcane' | 'emerald' = 'gold',
  ): void {
    const key = `b:${title}:${subtitle ?? ''}:${tone}`;
    if (this.consumeCounter(this.busSeenThisTick, key)) return;
    this.incrementCounter(this.directSeenThisTick, key);
    this.overlays?.showBanner(title, subtitle, tone);
  }

  public showToast(message: string, rarity?: ItemRarity): void {
    const key = `t:${message}:${rarity ?? ''}`;
    if (this.consumeCounter(this.busSeenThisTick, key)) return;
    this.incrementCounter(this.directSeenThisTick, key);
    this.overlays?.showToast(message, rarity);
  }

  public onSkillSlotClick(handler: (slot: SkillSlotIndex) => void): void {
    this.skillClickHandlers.push(handler);
  }

  public onPanelToggleClick(handler: (panel: PanelToggleTarget) => void): void {
    this.panelToggleHandlers.push(handler);
  }

  public update(
    dt: number,
    snapshot: HudSnapshot,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    if (!this.rootEl || !this.visible) return;

    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0.016;

    // ── Performance throttle: cap DOM redraws per tier ──────────────────────
    const tierInterval =
      this.performanceTier === 'low' ? 1 / 20 : this.performanceTier === 'medium' ? 1 / 30 : 0;
    this.lastHudUpdate += safeDt;
    const shouldRedraw = this.lastHudUpdate >= tierInterval;
    if (!shouldRedraw) {
      // Still run timers and overlay update even when throttled
      if (this.hpRippleTimerSec > 0) {
        this.hpRippleTimerSec -= safeDt;
        if (this.hpRippleTimerSec <= 0) this.hpGlobeEl?.classList.remove('ar-hit-ripple', 'ar-heal-ripple');
      }
      if (this.manaRippleTimerSec > 0) {
        this.manaRippleTimerSec -= safeDt;
        if (this.manaRippleTimerSec <= 0) this.manaGlobeEl?.classList.remove('ar-cast-ripple');
      }
      if (this.bagPopTimerSec > 0) {
        this.bagPopTimerSec -= safeDt;
        if (this.bagPopTimerSec <= 0) this.inventoryBtnEl?.classList.remove('ar-bag-pop');
      }
      this.overlays?.update(safeDt, snapshot, worldToScreen);
      return;
    }
    this.lastHudUpdate = 0;
    this.elapsedSec += safeDt;
    this.lastWorldToScreen = worldToScreen;

    if (this.hpRippleTimerSec > 0) {
      this.hpRippleTimerSec -= safeDt;
      if (this.hpRippleTimerSec <= 0) {
        this.hpGlobeEl?.classList.remove('ar-hit-ripple', 'ar-heal-ripple');
      }
    }
    if (this.manaRippleTimerSec > 0) {
      this.manaRippleTimerSec -= safeDt;
      if (this.manaRippleTimerSec <= 0) {
        this.manaGlobeEl?.classList.remove('ar-cast-ripple');
      }
    }
    if (this.bagPopTimerSec > 0) {
      this.bagPopTimerSec -= safeDt;
      if (this.bagPopTimerSec <= 0) {
        this.inventoryBtnEl?.classList.remove('ar-bag-pop');
      }
    }

    this.updateGlobesAndActionBar(snapshot);
    this.updateTopLeft(snapshot);
    this.updateBossAndCursedEvent(safeDt, snapshot);
    this.updateTopRight(snapshot);
    this.updateComboMeter(snapshot);
    this.overlays?.update(safeDt, snapshot, worldToScreen);
  }

  private updateGlobesAndActionBar(snapshot: HudSnapshot): void {
    const { player, skills } = snapshot;

    // Health Globe + Low-HP Vignette
    const maxHp = Math.max(1, player.stats.maxHp || 1);
    const curHp = clamp(Number.isFinite(player.hp) ? player.hp : 0, 0, maxHp);
    if (this.prevHp >= 0) {
      if (curHp < this.prevHp - 0.5) {
        this.triggerGlobeRipple('hp', 'ar-hit-ripple');
      } else if (curHp > this.prevHp + 2) {
        this.triggerGlobeRipple('hp', 'ar-heal-ripple');
      }
    }
    this.prevHp = curHp;

    const hpRatio = curHp / maxHp;
    const hpPct = clamp(hpRatio * 100, 0, 100);

    if (this.hpLiquidEl) {
      this.hpLiquidEl.style.height = `${hpPct.toFixed(1)}%`;
    }
    const hpText = `${Math.ceil(curHp)}/${Math.round(maxHp)}`;
    if (this.hpValEl && this.lastHpText !== hpText) {
      this.lastHpText = hpText;
      this.hpValEl.textContent = hpText;
    }

    const isLowHp = player.alive && hpRatio <= 0.3;
    const hasShield = player.statuses.some((s) => s.type === 'shield' && s.remainingSec > 0);
    this.hpGlobeEl?.classList.toggle('ar-critical', isLowHp);
    this.hpGlobeEl?.classList.toggle('ar-shielded', hasShield);
    this.lowHpVignetteEl?.classList.toggle('ar-active', isLowHp);

    // Mana Globe
    const maxMana = Math.max(1, player.stats.maxMana || 1);
    const curMana = clamp(Number.isFinite(player.mana) ? player.mana : 0, 0, maxMana);
    if (this.prevMana >= 0 && curMana < this.prevMana - 1.5) {
      this.triggerGlobeRipple('mana', 'ar-cast-ripple');
    }
    this.prevMana = curMana;

    const manaPct = clamp((curMana / maxMana) * 100, 0, 100);
    if (this.manaLiquidEl) {
      this.manaLiquidEl.style.height = `${manaPct.toFixed(1)}%`;
    }
    const manaText = `${Math.floor(curMana)}/${Math.round(maxMana)}`;
    if (this.manaValEl && this.lastManaText !== manaText) {
      this.lastManaText = manaText;
      this.manaValEl.textContent = manaText;
    }

    // Stamina Pips
    const maxStam = Math.max(1, player.stats.maxStamina || 100);
    const stamRatio = clamp((player.stamina || 0) / maxStam, 0, 1);
    for (let i = 0; i < this.staminaPipFills.length; i++) {
      const pipFill = clamp(stamRatio * STAMINA_PIP_COUNT - i, 0, 1) * 100;
      this.staminaPipFills[i].style.width = `${pipFill.toFixed(0)}%`;
    }

    // Gold Pill
    const goldInt = Math.max(0, Math.floor(player.gold || 0));
    if (this.goldValEl && this.lastGold !== goldInt) {
      this.lastGold = goldInt;
      this.goldValEl.textContent = goldInt.toLocaleString();
    }

    // [R] Awakening Fury & [V] Parry Mastery Cluster
    const mastery = snapshot.mastery;
    if (this.masteryClusterEl) {
      this.masteryClusterEl.classList.toggle('ar-visible', Boolean(mastery));
      if (mastery && this.furyPillEl && this.furyFillEl && this.furyTextEl && this.parryPillEl && this.parryTextEl) {
        const maxFury = Math.max(1, mastery.maxFury || 100);
        const furyPct = clamp((mastery.fury / maxFury) * 100, 0, 100);
        const isReady = !mastery.awakened && furyPct >= 99.9;

        this.furyPillEl.classList.toggle('ar-fury-awakened', mastery.awakened);
        this.furyPillEl.classList.toggle('ar-fury-ready', isReady);

        if (mastery.awakened) {
          const dur = Math.max(0.1, mastery.awakenedDurationSec || 10);
          const drainPct = clamp((mastery.awakenedRemainingSec / dur) * 100, 0, 100);
          this.furyFillEl.style.width = `${drainPct.toFixed(1)}%`;
          this.furyTextEl.textContent = `THỨC TỈNH ${Math.max(0, mastery.awakenedRemainingSec).toFixed(1)}s`;
        } else {
          this.furyFillEl.style.width = `${furyPct.toFixed(1)}%`;
          this.furyTextEl.textContent = isReady
            ? 'CUỒNG NỘ THỨC TỈNH!'
            : `THỨC TỈNH ${Math.floor(furyPct)}%`;
        }

        const parryCd = Math.max(0, mastery.parryCooldownSec || 0);
        this.parryPillEl.classList.toggle('ar-parry-active', mastery.parryActiveWindow);
        this.parryPillEl.classList.toggle(
          'ar-parry-cd',
          !mastery.parryActiveWindow && parryCd > 0.04,
        );
        if (mastery.parryActiveWindow) {
          this.parryTextEl.textContent = 'ĐANG ĐỠ ĐÒN!';
        } else if (parryCd > 0.04) {
          this.parryTextEl.textContent = `ĐỠ ĐÒN ${parryCd.toFixed(1)}s`;
        } else {
          this.parryTextEl.textContent = 'ĐỠ ĐÒN SẴN SÀNG';
        }
      }
    }

    // Player Active Status Effects
    if (this.playerStatusesEl) {
      const activeStatuses = player.statuses.filter((s) => s.remainingSec > 0);
      const sig = activeStatuses
        .map((s) => `${s.type}:${s.stacks}:${Math.ceil(s.remainingSec)}`)
        .join('|');
      if (this.lastPlayerStatusSig !== sig) {
        this.lastPlayerStatusSig = sig;
        this.playerStatusesEl.innerHTML = '';
        for (const st of activeStatuses.slice(0, 7)) {
          const chip = document.createElement('div');
          chip.className = 'ar-status-chip';
          chip.title = `${st.type.toUpperCase()} (${st.remainingSec.toFixed(1)}s)`;
          chip.innerHTML = renderStatusSvg(st.type);

          if (st.stacks > 1) {
            const stacks = document.createElement('span');
            stacks.className = 'ar-status-stacks';
            stacks.textContent = String(st.stacks);
            chip.appendChild(stacks);
          }

          const timer = document.createElement('span');
          timer.className = 'ar-status-timer';
          timer.textContent = `${Math.ceil(st.remainingSec)}s`;
          chip.appendChild(timer);

          this.playerStatusesEl.appendChild(chip);
        }
      }
    }

    // 6 Skill Slots
    for (let i = 0; i < 6; i++) {
      const uiSlot = this.skillSlots[i];
      const entry = skills[i];
      if (!uiSlot) continue;

      if (!entry) {
        uiSlot.iconWrap.innerHTML = '';
        uiSlot.manaPip.style.display = 'none';
        uiSlot.btn.classList.remove('ar-on-cd', 'ar-no-mana');
        continue;
      }

      const { def, remainingCd, totalCd } = entry;
      const skillSig = `${def.id}:${def.icon}:${def.manaCost}:${def.cooldownSec}`;
      if (uiSlot.lastSkillSig !== skillSig) {
        uiSlot.lastSkillSig = skillSig;
        uiSlot.iconWrap.innerHTML = renderSkillSvg(def, i as SkillSlotIndex);
        const accent = DAMAGE_TYPE_COLORS[def.damageType]?.css ?? '#c89b3c';
        uiSlot.ttName.textContent = def.name;
        uiSlot.ttName.style.color = accent;
        uiSlot.ttMeta.textContent = `${def.damageType.toUpperCase()} \u2022 ${def.manaCost > 0 ? `${def.manaCost} ${t('hud.mana')}` : 'Không Tốn'} \u2022 ${def.cooldownSec > 0 ? `${def.cooldownSec}s ${t('hud.skillCooldown')}` : 'Tức Thì'}`;
        uiSlot.ttDesc.textContent = def.description;

        if (def.manaCost > 0) {
          uiSlot.manaPip.style.display = 'inline-block';
          uiSlot.manaPip.textContent = String(Math.round(def.manaCost));
        } else {
          uiSlot.manaPip.style.display = 'none';
        }
      }

      const onCd = remainingCd > 0.04;
      if (!onCd && uiSlot.wasOnCooldown) {
        uiSlot.btn.classList.remove('ar-ready-flash');
        void uiSlot.btn.offsetWidth;
        uiSlot.btn.classList.add('ar-ready-flash');
      }
      uiSlot.wasOnCooldown = onCd;
      uiSlot.btn.classList.toggle('ar-on-cd', onCd);

      if (onCd) {
        const denom = Math.max(0.1, totalCd || def.cooldownSec || 1);
        const deg = clamp((remainingCd / denom) * 360, 0, 360);
        uiSlot.cdSweep.style.background = `conic-gradient(rgba(6, 5, 10, 0.84) ${deg.toFixed(1)}deg, rgba(6, 5, 10, 0.2) ${deg.toFixed(1)}deg)`;
        uiSlot.cdSweep.textContent =
          remainingCd >= 10 ? String(Math.ceil(remainingCd)) : remainingCd.toFixed(1);
      }

      const lacksMana = curMana + 1e-3 < def.manaCost;
      uiSlot.btn.classList.toggle('ar-no-mana', lacksMana);
    }

    // Potion Slot (Q)
    if (this.potionBtnEl && this.potionCountEl && this.potionSweepEl) {
      const count = Math.max(0, player.healthPotions);
      const maxPot = Math.max(1, player.maxHealthPotions);
      this.potionCountEl.textContent = `${count}/${maxPot}`;
      this.potionBtnEl.style.opacity = count > 0 ? '1' : '0.52';

      const potCd = Math.max(0, player.potionCooldownSec || 0);
      const potOnCd = potCd > 0.04;
      this.potionBtnEl.classList.toggle('ar-on-cd', potOnCd);
      if (potOnCd) {
        const deg = clamp((potCd / POTION_MAX_COOLDOWN_REF) * 360, 0, 360);
        this.potionSweepEl.style.background = `conic-gradient(rgba(8, 6, 12, 0.84) ${deg.toFixed(1)}deg, transparent ${deg.toFixed(1)}deg)`;
        this.potionSweepEl.textContent = potCd.toFixed(1);
      }
    }

    // Unspent Attribute & Skill Point Badges
    const attrPts = Math.max(0, Math.floor(player.unspentAttributePoints || 0));
    if (this.attrBadgeEl) {
      this.attrBadgeEl.classList.toggle('ar-has-points', attrPts > 0);
      if (attrPts > 0) this.attrBadgeEl.textContent = String(attrPts);
    }
    const skillPts = Math.max(0, Math.floor(player.unspentSkillPoints || 0));
    if (this.skillBadgeEl) {
      this.skillBadgeEl.classList.toggle('ar-has-points', skillPts > 0);
      if (skillPts > 0) this.skillBadgeEl.textContent = String(skillPts);
    }

    // Golden XP Bar & Level Medallion
    const xpNext = Math.max(1, player.xpToNextLevel || 100);
    const xpCur = clamp(player.xp || 0, 0, xpNext);
    const xpSig = `${player.level}:${Math.floor(xpCur)}:${Math.floor(xpNext)}`;
    if (this.lastXpSig !== xpSig) {
      this.lastXpSig = xpSig;
      const pct = clamp((xpCur / xpNext) * 100, 0, 100);
      if (this.levelCrestEl) this.levelCrestEl.textContent = `${t('hud.level')} ${player.level}`;
      if (this.xpFillEl) this.xpFillEl.style.width = `${pct.toFixed(1)}%`;
      if (this.xpReadoutEl) {
        this.xpReadoutEl.textContent = `${Math.floor(xpCur).toLocaleString()} / ${Math.floor(xpNext).toLocaleString()} ${t('hud.exp')} (${Math.floor(pct)}%)`;
      }
    }
  }

  private updateBossAndCursedEvent(dt: number, snapshot: HudSnapshot): void {
    const { boss, cursedEvent } = snapshot;

    // Pinnacle Boss Health Bar
    if (boss && boss.entity.alive && boss.entity.hp > 0 && this.bossFrameEl) {
      this.bossFrameEl.classList.add('ar-visible');
      const entity = boss.entity;
      const maxHp = Math.max(1, entity.maxHp);
      const hpPct = clamp((entity.hp / maxHp) * 100, 0, 100);

      if (this.lastBossId !== entity.id) {
        this.lastBossId = entity.id;
        this.bossTrailPct = hpPct;
        if (this.bossNameEl) this.bossNameEl.textContent = entity.name;
      }

      if (hpPct < this.bossTrailPct) {
        this.bossTrailPct = Math.max(hpPct, this.bossTrailPct - dt * 28);
      } else {
        this.bossTrailPct = hpPct;
      }

      if (this.bossSubEl) {
        this.bossSubEl.textContent = boss.title;
      }
      if (this.bossPhaseEl) {
        this.bossPhaseEl.textContent = `PHASE ${toRoman(boss.phase)} / ${toRoman(boss.maxPhases)}`;
      }
      if (this.bossFillEl) {
        this.bossFillEl.style.width = `${hpPct.toFixed(2)}%`;
      }
      if (this.bossTrailEl) {
        this.bossTrailEl.style.width = `${this.bossTrailPct.toFixed(2)}%`;
      }
      if (this.bossHpTextEl) {
        this.bossHpTextEl.textContent = `${Math.ceil(entity.hp).toLocaleString()} / ${Math.round(maxHp).toLocaleString()} (${Math.ceil(hpPct)}%)`;
      }

      // Boss Stagger Bar beneath Boss HP
      const mastery = snapshot.mastery;
      if (this.bossStaggerRowEl && this.bossStaggerFillEl && this.bossStaggerLabelEl) {
        if (mastery && mastery.bossMaxStagger > 0) {
          this.bossStaggerRowEl.classList.add('ar-visible');
          const stagPct = mastery.bossStaggered
            ? 100
            : clamp((mastery.bossStagger / Math.max(1, mastery.bossMaxStagger)) * 100, 0, 100);
          this.bossStaggerFillEl.style.width = `${stagPct.toFixed(1)}%`;
          this.bossStaggerRowEl.classList.toggle('ar-staggered', mastery.bossStaggered);
          this.bossStaggerLabelEl.textContent = mastery.bossStaggered
            ? '\u26A1 [F / LMB] KẾT LIỄU! \u26A1'
            : `${t('hud.stagger')} ${Math.floor(stagPct)}%`;
        } else {
          this.bossStaggerRowEl.classList.remove('ar-visible', 'ar-staggered');
        }
      }
    } else if (this.bossFrameEl) {
      this.bossFrameEl.classList.remove('ar-visible');
      this.lastBossId = '';
    }

    // Cursed Event Countdown Timer
    if (cursedEvent && cursedEvent.active && this.cursedBannerEl) {
      this.cursedBannerEl.classList.add('ar-visible');
      const rem = Math.max(0, cursedEvent.remainingSec);
      const mins = Math.floor(rem / 60);
      const secs = rem - mins * 60;
      if (this.cursedTimerEl) {
        this.cursedTimerEl.textContent = `${String(mins).padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
      }
      if (this.cursedWavesEl) {
        this.cursedWavesEl.textContent = `Wave ${cursedEvent.wavesSpawned}/${cursedEvent.totalWaves}`;
      }
    } else if (this.cursedBannerEl) {
      this.cursedBannerEl.classList.remove('ar-visible');
    }
  }

  private updateTopLeft(snapshot: HudSnapshot): void {
    const { companions, dummyMetrics, inSanctuary, floor } = snapshot;

    if (this.compCardEl) {
      if (companions) {
        this.compCardEl.classList.add('ar-visible');
        if (this.compNameEl) this.compNameEl.textContent = companions.mercenaryName;
        if (this.compLvlEl) {
          this.compLvlEl.textContent = companions.mercenaryAlive
            ? `${t('companion.level')} ${companions.mercenaryLevel}`
            : 'HỒI SINH';
        }
        const maxHp = Math.max(1, companions.mercenaryMaxHp || 1);
        const curHp = companions.mercenaryAlive ? clamp(companions.mercenaryHp, 0, maxHp) : 0;
        const hpPct = (curHp / maxHp) * 100;
        if (this.compHpFillEl) this.compHpFillEl.style.width = `${hpPct.toFixed(1)}%`;
        if (this.compPetEl) {
          const petLabel = PET_DISPLAY_NAMES[companions.activePet] ?? companions.activePet;
          this.compPetEl.textContent = `\u2726 ${petLabel}`;
        }
        if (this.compHpTextEl) {
          this.compHpTextEl.textContent = companions.mercenaryAlive
            ? `${Math.ceil(curHp)}/${Math.round(maxHp)}`
            : 'Đã Ngã';
        }
      } else {
        this.compCardEl.classList.remove('ar-visible');
      }
    }

    const showDummy =
      Boolean(dummyMetrics) &&
      (Boolean(inSanctuary) || floor.biome === 'sanctuary' || Boolean(dummyMetrics?.active));
    if (this.dpsCardEl) {
      this.dpsCardEl.classList.toggle('ar-visible', showDummy);
      if (showDummy && dummyMetrics) {
        if (this.dpsMainValEl) {
          this.dpsMainValEl.textContent = `${Math.round(dummyMetrics.rollingDps).toLocaleString()} DPS`;
        }
        if (this.dpsPeakEl) {
          this.dpsPeakEl.textContent = `Đỉnh: ${Math.round(dummyMetrics.peakHit).toLocaleString()}`;
        }
        if (this.dpsTotalEl) {
          this.dpsTotalEl.textContent = `${Math.round(dummyMetrics.totalDamage).toLocaleString()} (${dummyMetrics.hitsCount} đòn)`;
        }
      }
    }
  }

  private updateTopRight(snapshot: HudSnapshot): void {
    const { floor, fps, quests, engineStats, worldEvents } = snapshot;

    const biomeCfg = BIOME_CONFIG[floor.biome] ?? BIOME_CONFIG.crypt;
    const biomeKey = `${floor.biome}:${floor.floorNumber}`;
    if (this.lastBiomeKey !== biomeKey) {
      this.lastBiomeKey = biomeKey;
      if (this.biomeTitleEl) this.biomeTitleEl.textContent = biomeCfg.name;
      if (this.floorSubEl) {
        if (floor.biome === 'sanctuary' || floor.floorNumber === 0) {
          this.floorSubEl.textContent = `${t('hub.sanctuary')} \u2022 ${t('map.safe')}`;
        } else if (floor.biome === 'colosseum') {
          this.floorSubEl.textContent = 'Đấu Trường \u2022 Trùm Liên Tiếp';
        } else {
          this.floorSubEl.textContent = `${t('hud.floor')} ${toRoman(floor.floorNumber)} \u2022 Độ Sâu ${floor.floorNumber}`;
        }
      }
    }

    // DLSS • 120Hz Live Performance Pill + FPS Badge
    const dlssMode: DlssMode = engineStats?.dlssMode ?? this.cachedDlssMode;
    const scale =
      engineStats?.renderScale !== undefined && Number.isFinite(engineStats.renderScale)
        ? engineStats.renderScale
        : this.cachedRenderScale;
    const targetFps: TargetFpsLimit = engineStats?.targetFps ?? this.cachedTargetFps;
    const hzText = targetFps === 0 ? 'UNCAPPED' : `${targetFps}Hz`;
    const modeLabel = DLSS_MODE_LABELS[dlssMode] ?? 'DLSS QUALITY';
    const dlssSig = `${dlssMode}:${scale.toFixed(2)}:${hzText}:${engineStats?.internalWidth ?? 0}:${Math.round((engineStats?.frameTimeMs ?? 0) * 10)}`;
    if (this.lastDlssSig !== dlssSig) {
      this.lastDlssSig = dlssSig;
      if (this.dlssTextEl) {
        this.dlssTextEl.textContent = `${modeLabel} ${scale.toFixed(2)}x \u2022 ${hzText}`;
      }
      if (this.dlssPillEl) {
        this.dlssPillEl.classList.toggle('ar-dlss-native', dlssMode === 'native');
        if (engineStats?.internalWidth && engineStats?.internalHeight) {
          const ft =
            engineStats.frameTimeMs !== undefined ? ` \u2022 ${engineStats.frameTimeMs.toFixed(2)}ms` : '';
          this.dlssPillEl.title = `Internal ${engineStats.internalWidth}\u00D7${engineStats.internalHeight}${ft}`;
        }
      }
    }

    const liveFps = engineStats?.fps ?? fps;
    const fpsInt = Math.max(0, Math.round(Number.isFinite(liveFps) ? liveFps : 60));
    if (this.fpsBadgeEl && this.lastFpsInt !== fpsInt) {
      this.lastFpsInt = fpsInt;
      this.fpsBadgeEl.textContent = `${fpsInt} ${t('hud.fps')}`;
      this.fpsBadgeEl.style.color =
        fpsInt >= 90 ? '#38d9a9' : fpsInt >= 50 ? '#69db7c' : fpsInt >= 30 ? '#ffd43b' : '#ff6b6b';
    }

    // Render Fog-of-War Minimap
    this.minimap?.render(snapshot, this.elapsedSec);

    // Dynamic World Event Trackers
    this.renderWorldEvents(worldEvents);

    // Active Quest Tracker
    this.renderQuestTracker(quests);
  }

  private renderWorldEvents(ev?: ActiveWorldEventStatus): void {
    if (!this.worldEventsStackEl) return;
    if (!ev) {
      this.worldEventsStackEl.classList.remove('ar-visible');
      this.lastWorldEventsSig = '';
      return;
    }

    const hasEscort = Boolean(ev.escortState?.active);
    const hasRift = Boolean(ev.riftState?.active);
    const hasColo = Boolean(ev.colosseumState?.active);
    const hasPacts = ev.activePacts.length > 0;
    const anyActive =
      ev.butcherActive || ev.goblinActive || hasEscort || hasRift || hasColo || hasPacts;

    this.worldEventsStackEl.classList.toggle('ar-visible', anyActive);
    if (!anyActive) {
      this.lastWorldEventsSig = '';
      return;
    }

    const sig = [
      ev.butcherActive ? 'B1' : 'B0',
      ev.goblinActive ? `G:${(ev.goblinEscapeSec ?? 0).toFixed(1)}` : 'G0',
      hasEscort
        ? `E:${Math.round((ev.escortState?.progress01 ?? 0) * 100)}:${ev.escortState?.insideLight ? 1 : 0}`
        : 'E0',
      hasRift
        ? `R:${(ev.riftState?.remainingSec ?? 0).toFixed(1)}:${ev.riftState?.kills ?? 0}:${ev.riftState?.tierLabel ?? ''}`
        : 'R0',
      hasColo
        ? `C:${ev.colosseumState?.wave}/${ev.colosseumState?.maxWaves}:${ev.colosseumState?.bestWave}:${ev.colosseumState?.completed ? 1 : 0}`
        : 'C0',
      ev.activePacts.map((p) => p.id).join(','),
    ].join('|');

    if (this.lastWorldEventsSig === sig) return;
    this.lastWorldEventsSig = sig;

    this.worldEventsStackEl.innerHTML = '';

    if (ev.butcherActive) {
      const card = document.createElement('div');
      card.className = 'ar-event-card ar-ev-butcher';
      const hdr = document.createElement('div');
      hdr.className = 'ar-ev-hdr';
      hdr.style.color = '#ffa8a8';
      hdr.textContent = '\u2620 TÊN ĐỒ TỂ XÂM LƯỢC!';
      const sub = document.createElement('div');
      sub.style.color = '#ffc9c9';
      sub.textContent = '"THỊT TƯƠI!" — Giết Hoặc Sống Sót';
      card.append(hdr, sub);
      this.worldEventsStackEl.appendChild(card);
    }

    if (ev.goblinActive) {
      const card = document.createElement('div');
      card.className = 'ar-event-card ar-ev-goblin';
      const hdr = document.createElement('div');
      hdr.className = 'ar-ev-hdr';
      hdr.style.color = '#ffd43b';
      const left = document.createElement('span');
      left.textContent = '\u2726 Yêu Tinh Kho Báu';
      const right = document.createElement('span');
      right.textContent = `${Math.max(0, ev.goblinEscapeSec ?? 0).toFixed(1)}s`;
      hdr.append(left, right);
      card.appendChild(hdr);
      this.worldEventsStackEl.appendChild(card);
    }

    if (ev.escortState?.active) {
      const card = document.createElement('div');
      card.className = 'ar-event-card ar-ev-escort';
      const pct = clamp(Math.round(ev.escortState.progress01 * 100), 0, 100);
      const hdr = document.createElement('div');
      hdr.className = 'ar-ev-hdr';
      const left = document.createElement('span');
      left.textContent = 'Hộ Tống Linh Hồn';
      const right = document.createElement('span');
      right.style.color = ev.escortState.insideLight ? '#99e9f2' : '#ff6b6b';
      right.textContent = ev.escortState.insideLight ? `${pct}%` : 'VỀ ÁNH SÁNG!';
      hdr.append(left, right);
      const bar = document.createElement('div');
      bar.className = 'ar-ev-bar';
      const fill = document.createElement('div');
      fill.className = 'ar-ev-bar-fill';
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      card.append(hdr, bar);
      this.worldEventsStackEl.appendChild(card);
    }

    if (ev.riftState?.active) {
      const card = document.createElement('div');
      card.className = 'ar-event-card ar-ev-rift';
      const hdr = document.createElement('div');
      hdr.className = 'ar-ev-hdr';
      hdr.style.color = '#e599f7';
      const left = document.createElement('span');
      left.textContent = `Khe Nứt [${ev.riftState.tierLabel}]`;
      const right = document.createElement('span');
      right.textContent = `${Math.max(0, ev.riftState.remainingSec).toFixed(1)}s`;
      hdr.append(left, right);
      const sub = document.createElement('div');
      sub.style.color = '#d0bfff';
      sub.textContent = `Tiêu Diệt Trong Rift: ${ev.riftState.kills}`;
      card.append(hdr, sub);
      this.worldEventsStackEl.appendChild(card);
    }

    if (ev.colosseumState?.active) {
      const card = document.createElement('div');
      card.className = 'ar-event-card ar-ev-colosseum';
      const hdr = document.createElement('div');
      hdr.className = 'ar-ev-hdr';
      hdr.style.color = '#ffd43b';
      const left = document.createElement('span');
      left.textContent = '\u2694 Đấu Trường';
      const right = document.createElement('span');
      right.textContent = ev.colosseumState.completed
        ? 'VÔ ĐỊCH!'
        : `Đợt ${ev.colosseumState.wave}/${ev.colosseumState.maxWaves}`;
      hdr.append(left, right);
      const sub = document.createElement('div');
      sub.style.color = '#ced4da';
      sub.textContent = `Kỷ Lục Tốt Nhất: Đợt ${ev.colosseumState.bestWave}`;
      card.append(hdr, sub);
      this.worldEventsStackEl.appendChild(card);
    }

    if (hasPacts) {
      const pactsRow = document.createElement('div');
      pactsRow.className = 'ar-pacts-wrap';
      for (const pact of ev.activePacts) {
        const chip = document.createElement('span');
        chip.className = 'ar-pact-chip';
        const toneColor =
          pact.tone === 'crimson' ? '#ff6b6b' : pact.tone === 'arcane' ? '#da77f2' : '#ffd43b';
        chip.style.borderColor = toneColor;
        chip.style.color = toneColor;
        chip.textContent = `\u2666 ${pact.title}`;
        chip.title = `${pact.blessingText} | ${pact.curseText}`;
        pactsRow.appendChild(chip);
      }
      this.worldEventsStackEl.appendChild(pactsRow);
    }
  }

  private renderQuestTracker(quests: QuestState[]): void {
    if (!this.questTrackerEl || !this.questListEl) return;

    const sorted = [...quests].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      if (a.isMainQuest !== b.isMainQuest) return a.isMainQuest ? -1 : 1;
      return 0;
    });

    const displayed = sorted.filter((q) => q.status === 'active').slice(0, 3);
    const listToShow = displayed.length > 0 ? displayed : sorted.slice(0, 2);

    if (listToShow.length === 0) {
      this.questTrackerEl.style.display = 'none';
      return;
    }
    this.questTrackerEl.style.display = 'flex';

    const sig = listToShow
      .map(
        (q) =>
          `${q.id}:${q.status}:${q.objectives.map((o) => `${o.current}/${o.required}:${o.completed ? 1 : 0}`).join(',')}`,
      )
      .join('|');

    if (this.lastQuestSig === sig) return;
    this.lastQuestSig = sig;

    this.questListEl.innerHTML = '';
    for (const q of listToShow) {
      const itemEl = document.createElement('div');
      itemEl.className = q.isMainQuest ? 'ar-quest-item' : 'ar-quest-item ar-side-quest';

      const titleEl = document.createElement('div');
      titleEl.className = 'ar-quest-title';
      const crown = document.createElement('span');
      crown.className = 'ar-quest-crown';
      crown.textContent = q.isMainQuest ? '\u265B' : '\u25C6';
      const titleText = document.createElement('span');
      titleText.textContent = q.title;
      titleEl.append(crown, titleText);
      itemEl.appendChild(titleEl);

      for (const obj of q.objectives) {
        const objRow = document.createElement('div');
        objRow.className = obj.completed ? 'ar-quest-obj ar-obj-done' : 'ar-quest-obj';
        const desc = document.createElement('span');
        desc.textContent = obj.description;
        const count = document.createElement('span');
        count.className = 'ar-quest-obj-count';
        count.textContent = obj.completed
          ? '\u2713'
          : `${Math.min(obj.current, obj.required)}/${obj.required}`;
        objRow.append(desc, count);
        itemEl.appendChild(objRow);
      }

      this.questListEl.appendChild(itemEl);
    }
  }

  private updateComboMeter(snapshot: HudSnapshot): void {
    if (!this.comboWidgetEl) return;
    const { count, timerSec, multiplier } = snapshot.combo;

    if (count >= 2 && timerSec > 0) {
      this.comboWidgetEl.classList.add('ar-visible');
      if (timerSec > this.comboPeakTimer) {
        this.comboPeakTimer = timerSec;
      }

      let rank = 'ĐẪM MÁU';
      if (count >= 50) rank = 'THẦN THÁNH';
      else if (count >= 35) rank = 'HỦY DIỆT';
      else if (count >= 20) rank = 'TÀN SÁT';
      else if (count >= 10) rank = 'TÀN NHẪN';
      else if (count >= 5) rank = 'MAN RỢ';

      if (this.comboRankEl) this.comboRankEl.textContent = rank;
      if (this.comboCountEl) this.comboCountEl.textContent = `${count} ${t('hud.kills').toUpperCase()}`;
      if (this.comboMultEl) {
        this.comboMultEl.textContent = `${multiplier.toFixed(2)}x ${t('hud.chainKill')}`;
      }
      if (this.comboFuseEl) {
        const pct = clamp((timerSec / Math.max(1, this.comboPeakTimer)) * 100, 0, 100);
        this.comboFuseEl.style.width = `${pct.toFixed(1)}%`;
      }
    } else {
      this.comboWidgetEl.classList.remove('ar-visible');
      this.comboPeakTimer = 4;
    }
  }

  private teardownDomOnly(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    this.overlays?.dispose();
    this.overlays = null;
    this.minimap = null;

    this.rootEl?.remove();
    this.rootEl = null;
    this.inventoryBtnEl = null;
    this.lastWorldToScreen = null;
    this.skillSlots = [];
    this.staminaPipFills = [];
  }

  public dispose(): void {
    this.teardownDomOnly();
    this.skillClickHandlers = [];
    this.panelToggleHandlers = [];
    this.container = null;

    if (this.ownsStyleRef) {
      this.ownsStyleRef = false;
      activeStyleMountCount = Math.max(0, activeStyleMountCount - 1);
      if (activeStyleMountCount === 0 && typeof document !== 'undefined') {
        document.getElementById(HUD_STYLE_ELEMENT_ID)?.remove();
      }
    }
  }
}

export function createHudUI(): IHudUI {
  return new HudUI();
}
