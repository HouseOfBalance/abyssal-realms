import { RARITY_COLORS } from '../../core/Constants';
import { t } from '../../core/i18n/index.js';
import { eventBus } from '../../core/EventBus';
import type {
  Attributes,
  DerivedStats,
  EquipSlot,
  ItemInstance,
  MenuPanelId,
  MenusCallbacks,
  MenusRefreshContext,
} from '../../contracts/types';
import {
  escapeHtml,
  estimateSalvageGold,
  estimateUpgradeCost,
  formatStatValue,
  getHeroPaperDollSilhouette,
  getItemSvg,
  getSlotSvg,
  getStatLabel,
  safeNum,
  SVG_ANVIL,
} from './icons';
import {
  buildRichItemTooltipHtml,
  getItemAccentInfo,
  getRuneDefMap,
  renderItemSocketPipsHtml,
} from './itemFormatting';
import {
  type InventorySubTab,
  SanctuaryWorkbenchesController,
} from './sanctuaryWorkbenches';
import { bindWindowTopbarEvents, renderWindowTopbar } from './sharedHeader';

type InvFilter = 'all' | 'weapons' | 'armor' | 'jewelry';

const PAPERDOLL_SLOTS: Array<{
  slot: EquipSlot;
  label: string;
  col: number;
  row: number;
}> = [
  { slot: 'helmet', label: 'Mũ Giáp', col: 1, row: 1 },
  { slot: 'weapon', label: 'Vũ Khí', col: 1, row: 2 },
  { slot: 'gloves', label: 'Găng Tay', col: 1, row: 3 },
  { slot: 'boots', label: 'Giày', col: 1, row: 4 },
  { slot: 'amulet', label: 'Vòng Cổ', col: 3, row: 1 },
  { slot: 'chest', label: 'Áo Giáp', col: 3, row: 2 },
  { slot: 'offhand', label: 'Tay Phụ', col: 3, row: 3 },
  { slot: 'ring', label: 'Nhẫn', col: 3, row: 4 },
];

const ATTRIBUTE_CONFIG: Array<{
  key: keyof Attributes;
  label: string;
  desc: string;
  color: string;
  glyph: string;
}> = [
  {
    key: 'strength',
    label: 'Sức Mạnh',
    desc: '+Sức Tấn Công & Giáp Vật Lý',
    color: '#ff6b6b',
    glyph: '⚔',
  },
  {
    key: 'dexterity',
    label: 'Nhanh Nhẹn',
    desc: '+Tỉ Lệ Chí Mạng, Né Tránh & Tốc Độ Tấn Công',
    color: '#51cf66',
    glyph: '✦',
  },
  {
    key: 'intelligence',
    label: 'Trí Tuệ',
    desc: '+Sức Mạnh Phép, Mana Tối Đa & Giảm Hồi Chiêu',
    color: '#4dabf7',
    glyph: '✧',
  },
  {
    key: 'vitality',
    label: 'Sinh Lực',
    desc: '+Máu Tối Đa & Hồi Phục Máu',
    color: '#fcc419',
    glyph: '♥',
  },
];

const ALL_DERIVED_KEYS: Array<keyof DerivedStats> = [
  'attackPower',
  'spellPower',
  'critChance',
  'critMultiplier',
  'attackSpeed',
  'cooldownReduction',
  'lifeSteal',
  'maxHp',
  'hpRegen',
  'armor',
  'dodgeChance',
  'maxMana',
  'manaRegen',
  'maxStamina',
  'staminaRegen',
  'moveSpeed',
];

interface StatFlashEntry {
  dir: 'up' | 'down';
  deltaText: string;
  until: number;
}

export class InventoryPanelController {
  private subTab: InventorySubTab = 'armory';
  private selectedSource:
    | { kind: 'inventory'; itemId: string }
    | { kind: 'equipped'; slot: EquipSlot }
    | null = null;
  private filter: InvFilter = 'all';

  private baselineInitialized = false;
  private prevEquippedIds: Partial<Record<EquipSlot, string | undefined>> = {};
  private prevUpgradeLevels = new Map<string, number>();
  private prevAttributes: Attributes | null = null;
  private prevStats: DerivedStats | null = null;

  private slotShockwaves = new Map<EquipSlot, { colorCss: string; until: number }>();
  private statFlashes = new Map<keyof (DerivedStats & Attributes), StatFlashEntry>();
  private anvilBurstUntil = 0;
  private unsubs: Array<() => void> = [];
  private readonly workbenches = new SanctuaryWorkbenchesController();

  constructor() {
    this.unsubs.push(
      eventBus.on('hero:gearChanged', (payload) => {
        const now = Date.now();
        const rarityCss = payload.item?.isMythic
          ? '#ff1e42'
          : payload.rarity
            ? (RARITY_COLORS[payload.rarity]?.css ?? '#ffd97d')
            : '#ffd97d';
        if (payload.slot === 'all') {
          for (const { slot } of PAPERDOLL_SLOTS) {
            this.slotShockwaves.set(slot, { colorCss: rarityCss, until: now + 750 });
          }
        } else {
          this.slotShockwaves.set(payload.slot, { colorCss: rarityCss, until: now + 750 });
        }
      }),
    );
    this.unsubs.push(
      eventBus.on('event:runewordForged', ({ item }) => {
        const now = Date.now();
        this.anvilBurstUntil = now + 900;
        this.slotShockwaves.set(item.slot, { colorCss: '#ffe066', until: now + 900 });
      }),
    );
  }

  setSubTab(tab: InventorySubTab): void {
    this.subTab = tab;
  }

  getSubTab(): InventorySubTab {
    return this.subTab;
  }

  syncSilentBaseline(ctx: MenusRefreshContext): void {
    this.recordSnapshot(ctx);
    this.baselineInitialized = true;
  }

  private detectChangesAndRecord(ctx: MenusRefreshContext, suppressDiffs: boolean): void {
    const now = Date.now();
    if (!this.baselineInitialized || suppressDiffs) {
      this.recordSnapshot(ctx);
      this.baselineInitialized = true;
      return;
    }

    const equipped = ctx.equipped ?? {};
    for (const { slot } of PAPERDOLL_SLOTS) {
      const prevId = this.prevEquippedIds[slot];
      const curItem = equipped[slot];
      const curId = curItem?.id;
      if (prevId !== curId) {
        const accent = curItem ? getItemAccentInfo(curItem).css : '#c89b3c';
        this.slotShockwaves.set(slot, { colorCss: accent, until: now + 750 });
      }
    }

    const allItems: Array<{ item: ItemInstance; equippedSlot?: EquipSlot }> = [];
    for (const { slot } of PAPERDOLL_SLOTS) {
      const eq = equipped[slot];
      if (eq) allItems.push({ item: eq, equippedSlot: slot });
    }
    for (const inv of ctx.inventory ?? []) {
      allItems.push({ item: inv });
    }

    for (const { item, equippedSlot } of allItems) {
      const prevUpg = this.prevUpgradeLevels.get(item.id);
      const curUpg = safeNum(item.upgradeLevel, 0);
      if (prevUpg !== undefined && curUpg > prevUpg) {
        this.anvilBurstUntil = now + 780;
        if (equippedSlot) {
          this.slotShockwaves.set(equippedSlot, { colorCss: '#ffd43b', until: now + 750 });
        }
      }
    }

    const curAttrs = ctx.player?.baseAttributes;
    if (curAttrs && this.prevAttributes) {
      for (const { key } of ATTRIBUTE_CONFIG) {
        const diff = safeNum(curAttrs[key], 0) - safeNum(this.prevAttributes[key], 0);
        if (Math.abs(diff) > 1e-4) {
          const sign = diff > 0 ? '+' : '';
          this.statFlashes.set(key, {
            dir: diff > 0 ? 'up' : 'down',
            deltaText: `${sign}${formatStatValue(key, diff)}`,
            until: now + 800,
          });
        }
      }
    }

    const curStats = ctx.player?.stats;
    if (curStats && this.prevStats) {
      for (const key of ALL_DERIVED_KEYS) {
        const diff = safeNum(curStats[key], 0) - safeNum(this.prevStats[key], 0);
        if (Math.abs(diff) > 1e-4) {
          const sign = diff > 0 ? '+' : '';
          this.statFlashes.set(key, {
            dir: diff > 0 ? 'up' : 'down',
            deltaText: `${sign}${formatStatValue(key, diff)}`,
            until: now + 800,
          });
        }
      }
    }

    this.recordSnapshot(ctx);
  }

  private recordSnapshot(ctx: MenusRefreshContext): void {
    const equipped = ctx.equipped ?? {};
    const nextEq: Partial<Record<EquipSlot, string | undefined>> = {};
    this.prevUpgradeLevels.clear();

    for (const { slot } of PAPERDOLL_SLOTS) {
      const eq = equipped[slot];
      nextEq[slot] = eq?.id;
      if (eq) {
        this.prevUpgradeLevels.set(eq.id, safeNum(eq.upgradeLevel, 0));
      }
    }
    for (const inv of ctx.inventory ?? []) {
      this.prevUpgradeLevels.set(inv.id, safeNum(inv.upgradeLevel, 0));
    }

    this.prevEquippedIds = nextEq;
    if (ctx.player?.baseAttributes) {
      this.prevAttributes = { ...ctx.player.baseAttributes };
    }
    if (ctx.player?.stats) {
      this.prevStats = { ...ctx.player.stats };
    }
  }

  render(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    onSwitchPanel: (panel: MenuPanelId) => void,
    onClose: () => void,
    isEntering = false,
  ): void {
    this.detectChangesAndRecord(ctx, isEntering);

    const stashCount = (ctx.stash ?? []).length;
    const totalOwnedRunes = Object.values(ctx.ownedRunes ?? {}).reduce(
      (sum, c) => sum + safeNum(c, 0),
      0,
    );

    const subNavHtml = `
      <div class="ar-inv-subnav" role="tablist" aria-label="Các Tab Thánh Địa">
        <button type="button" class="ar-inv-subtab-btn ${this.subTab === 'armory' ? 'is-active' : ''}" data-inv-subtab="armory">
          <span>🛡 Kho Vũ Khí &amp; Thợ Rèn</span>
        </button>
        <button type="button" class="ar-inv-subtab-btn ${this.subTab === 'runewords' ? 'is-active' : ''}" data-inv-subtab="runewords">
          <span>✦ ${t('craft.runeword')} &amp; Bàn Gắn Đá</span>
          ${totalOwnedRunes > 0 ? `<span class="ar-nav-badge" style="background:rgba(200,155,60,0.45);box-shadow:none;">${totalOwnedRunes}</span>` : ''}
        </button>
        <button type="button" class="ar-inv-subtab-btn ${this.subTab === 'stash' ? 'is-active' : ''}" data-inv-subtab="stash">
          <span>🏛 ${t('inventory.stash')} (${stashCount})</span>
        </button>
        <button type="button" class="ar-inv-subtab-btn ${this.subTab === 'gambler' ? 'is-active' : ''}" data-inv-subtab="gambler">
          <span>🎲 Nhà Cờ Bạc &amp; Bàn Thờ Máu</span>
        </button>
        <button type="button" class="ar-inv-subtab-btn ${this.subTab === 'companions' ? 'is-active' : ''}" data-inv-subtab="companions">
          <span>🦉 ${t('companion.title')}</span>
        </button>
      </div>
    `;

    const resolvedSelection = this.resolveSelectedItem(ctx.inventory ?? [], ctx.equipped ?? {});

    let bodyContentHtml = '';
    if (this.subTab === 'armory') {
      bodyContentHtml = this.renderArmoryBodyHtml(ctx, resolvedSelection);
    } else if (this.subTab === 'runewords') {
      bodyContentHtml = this.workbenches.renderRunewordBenchHtml(ctx);
    } else if (this.subTab === 'stash') {
      bodyContentHtml = this.workbenches.renderStashHtml(ctx);
    } else if (this.subTab === 'gambler') {
      bodyContentHtml = this.workbenches.renderGamblerAndAltarHtml(ctx);
    } else {
      bodyContentHtml = this.workbenches.renderCompanionsHtml(ctx);
    }

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop" data-backdrop="closeable">
        <div class="ar-modal-window ${isEntering ? 'is-entering' : ''}" role="dialog" aria-label="Nhân Vật, Túi Đồ & Bàn Làm Việc Thánh Địa">
          ${renderWindowTopbar(
            'inventory',
            'Nhân Vật & Lò Rèn Thánh Địa',
            'Kho Vũ Khí, Từ Khóa Rune, Kho Đồ, Cờ Bạc & Đồng Hành',
            ctx,
          )}
          ${subNavHtml}
          ${bodyContentHtml}
        </div>

        <div class="ar-floating-tooltip is-hidden" data-role="item-tooltip"></div>
      </div>
    `;

    this.bindEvents(mountEl, ctx, callbacks, resolvedSelection, onSwitchPanel, onClose);
  }

  private renderArmoryBodyHtml(
    ctx: MenusRefreshContext,
    resolvedSelection: {
      item: ItemInstance;
      source: { kind: 'inventory'; itemId: string } | { kind: 'equipped'; slot: EquipSlot };
    } | null,
  ): string {
    const now = Date.now();
    const player = ctx.player;
    const inventory = ctx.inventory ?? [];
    const equipped = ctx.equipped ?? {};
    const runeMap = getRuneDefMap(ctx);

    const xpPct =
      safeNum(player.xpToNextLevel, 100) > 0
        ? Math.min(
            100,
            Math.round((safeNum(player.xp, 0) / safeNum(player.xpToNextLevel, 100)) * 100),
          )
        : 0;
    const unspentAttr = safeNum(player.unspentAttributePoints, 0);

    const attrsHtml = ATTRIBUTE_CONFIG.map((a) => {
      const val = Math.round(safeNum(player.baseAttributes?.[a.key], 10));
      const flash = this.getActiveFlash(a.key, now);
      const popCls = flash ? (flash.dir === 'up' ? 'ar-stat-pop-up' : 'ar-stat-pop-down') : '';
      return `
        <div class="ar-attr-row ${popCls}">
          <div class="ar-attr-info">
            <div class="ar-attr-icon" style="color:${a.color};border:1px solid ${a.color}44;">${a.glyph}</div>
            <div>
              <div class="ar-attr-name">${a.label}</div>
              <div class="ar-attr-desc">${a.desc}</div>
            </div>
          </div>
          <div class="ar-attr-right">
            ${
              flash
                ? `<span class="ar-stat-delta-chip ${flash.dir === 'up' ? 'is-up' : 'is-down'}">${escapeHtml(flash.deltaText)}</span>`
                : ''
            }
            <span class="ar-attr-val">${val}</span>
            <button
              type="button"
              class="ar-attr-plus"
              data-spend-attr="${a.key}"
              ${unspentAttr <= 0 ? 'disabled' : ''}
              title="${unspentAttr > 0 ? `Phân bổ +1 ${a.label}` : 'Không còn điểm thuộc tính'}"
            >+</button>
          </div>
        </div>
      `;
    }).join('');

    const stats = player.stats;
    const offenseKeys: Array<keyof DerivedStats> = [
      'attackPower',
      'spellPower',
      'critChance',
      'critMultiplier',
      'attackSpeed',
      'cooldownReduction',
      'lifeSteal',
    ];
    const defenseKeys: Array<keyof DerivedStats> = ['maxHp', 'hpRegen', 'armor', 'dodgeChance'];
    const resourceKeys: Array<keyof DerivedStats> = [
      'maxMana',
      'manaRegen',
      'maxStamina',
      'staminaRegen',
      'moveSpeed',
    ];

    const renderStatRows = (keys: Array<keyof DerivedStats>) =>
      keys
        .map((k) => {
          const flash = this.getActiveFlash(k, now);
          const popCls = flash
            ? flash.dir === 'up'
              ? 'ar-stat-pop-up'
              : 'ar-stat-pop-down'
            : '';
          return `
            <div class="ar-stat-line ${popCls}">
              <span>${escapeHtml(getStatLabel(k))}</span>
              <span>
                <strong>${escapeHtml(formatStatValue(k, stats?.[k]))}</strong>
                ${
                  flash
                    ? `<span class="ar-stat-delta-chip ${flash.dir === 'up' ? 'is-up' : 'is-down'}">${escapeHtml(flash.deltaText)}</span>`
                    : ''
                }
              </span>
            </div>
          `;
        })
        .join('');

    const paperDollSlotsHtml = PAPERDOLL_SLOTS.map(({ slot, label, col, row }) => {
      const eqItem = equipped[slot];
      const isSelected =
        resolvedSelection?.source.kind === 'equipped' && resolvedSelection.source.slot === slot;
      const sw = this.getActiveShockwave(slot, now);
      const shockwaveMarkup = sw
        ? `<span class="ar-slot-shockwave" style="--sw-color:${sw.colorCss};"></span>
           <span class="ar-slot-shockwave-secondary" style="--sw-color:${sw.colorCss};"></span>`
        : '';

      if (!eqItem) {
        return `
          <div
            class="ar-item-slot ${sw ? 'is-just-equipped' : ''}"
            style="grid-column:${col};grid-row:${row};"
            data-equip-slot="${slot}"
            title="${escapeHtml(label)} (Empty)"
          >
            ${shockwaveMarkup}
            <div class="ar-slot-placeholder-icon">${getSlotSvg(slot, '#c89b3c')}</div>
            <div class="ar-slot-label-tiny">${escapeHtml(label)}</div>
          </div>
        `;
      }

      const accent = getItemAccentInfo(eqItem);
      return `
        <div
          class="ar-item-slot rarity-${eqItem.rarity} ${accent.slotExtraClass} ${isSelected ? 'is-selected' : ''} ${sw ? 'is-just-equipped' : ''}"
          style="grid-column:${col};grid-row:${row};"
          data-equip-slot="${slot}"
          data-equipped-item-id="${escapeHtml(eqItem.id)}"
        >
          ${shockwaveMarkup}
          ${
            eqItem.isMythic
              ? `<span class="ar-item-legendary-star" style="color:#ff4d6d;">❖</span>`
              : eqItem.setName
                ? `<span class="ar-item-legendary-star" style="color:#38d9a9;">◈</span>`
                : eqItem.legendaryPower
                  ? `<span class="ar-item-legendary-star">✦</span>`
                  : ''
          }
          ${
            eqItem.upgradeLevel > 0
              ? `<span class="ar-item-upgrade-badge">+${eqItem.upgradeLevel}</span>`
              : ''
          }
          <div class="ar-item-icon-wrap">${getItemSvg(eqItem, accent.css)}</div>
          <span class="ar-item-ilvl-badge">iLv ${safeNum(eqItem.itemLevel, 1)}</span>
          ${renderItemSocketPipsHtml(eqItem, runeMap)}
        </div>
      `;
    }).join('');

    const isAnvilForging = now < this.anvilBurstUntil;
    const forgeHtml = this.renderBlacksmithForge(resolvedSelection, isAnvilForging, runeMap);

    const filteredItems = inventory.filter((item) => {
      if (this.filter === 'weapons') return item.slot === 'weapon' || item.slot === 'offhand';
      if (this.filter === 'armor') {
        return (
          item.slot === 'helmet' ||
          item.slot === 'chest' ||
          item.slot === 'gloves' ||
          item.slot === 'boots'
        );
      }
      if (this.filter === 'jewelry') return item.slot === 'ring' || item.slot === 'amulet';
      return true;
    });

    const TOTAL_SLOTS = 40;
    const invCellsHtml = Array.from({ length: TOTAL_SLOTS }, (_, idx) => {
      const item = filteredItems[idx];
      if (!item) {
        return `<div class="ar-item-slot is-inv-cell" aria-hidden="true" style="cursor:default;opacity:0.42;"></div>`;
      }
      const accent = getItemAccentInfo(item);
      const isSelected =
        resolvedSelection?.source.kind === 'inventory' &&
        resolvedSelection.source.itemId === item.id;
      const lvlTooHigh = safeNum(item.levelReq, 1) > safeNum(player.level, 1);

      return `
        <div
          class="ar-item-slot is-inv-cell rarity-${item.rarity} ${accent.slotExtraClass} ${isSelected ? 'is-selected' : ''}"
          data-inv-item-id="${escapeHtml(item.id)}"
        >
          ${
            item.isMythic
              ? `<span class="ar-item-legendary-star" style="color:#ff4d6d;">❖</span>`
              : item.setName
                ? `<span class="ar-item-legendary-star" style="color:#38d9a9;">◈</span>`
                : item.legendaryPower
                  ? `<span class="ar-item-legendary-star">✦</span>`
                  : ''
          }
          ${
            item.upgradeLevel > 0
              ? `<span class="ar-item-upgrade-badge">+${item.upgradeLevel}</span>`
              : ''
          }
          <div class="ar-item-icon-wrap">${getItemSvg(item, accent.css)}</div>
          <span class="ar-item-ilvl-badge" style="${lvlTooHigh ? 'color:#ff6b6b;' : ''}">
            Lv ${safeNum(item.levelReq, 1)}
          </span>
          ${renderItemSocketPipsHtml(item, runeMap)}
        </div>
      `;
    }).join('');

    return `
      <div class="ar-inv-layout">
        <!-- LEFT: ATTRIBUTES & DERIVED STATS -->
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">Thuộc Tính Nhân Vật</span>
            <span style="font-size:11px;color:#b8aa8f;">Tầng ${Math.max(1, safeNum(player.floorsCleared, 0) + 1)}</span>
          </div>
          <div class="ar-subpanel-body" data-scroll-key="char-stats">
            <div class="ar-char-summary">
              <div class="ar-char-summary-row">
                <div>
                  <div class="ar-char-name">${escapeHtml(player.name || 'Anh Hùng Vực Thẳm')}</div>
                  <div class="ar-char-class-tag">${escapeHtml(player.heroClass)} • ${safeNum(player.killsTotal, 0)} Đã Tiêu Diệt</div>
                </div>
                <span class="ar-level-badge">Cấp ${safeNum(player.level, 1)}</span>
              </div>
              <div class="ar-xp-bar-wrap">
                <div class="ar-xp-bar-label">
                  <span>Kinh Nghiệm</span>
                  <span>${Math.floor(safeNum(player.xp, 0))} / ${Math.floor(safeNum(player.xpToNextLevel, 100))} (${xpPct}%)</span>
                </div>
                <div class="ar-xp-bar-track">
                  <div class="ar-xp-bar-fill" style="width:${xpPct}%;"></div>
                </div>
              </div>
            </div>

            ${
              unspentAttr > 0
                ? `<div class="ar-unspent-banner">
                    <span>✦ Điểm Thuộc Tính Chưa Dùng</span>
                    <strong>+${unspentAttr}</strong>
                  </div>`
                : ''
            }

            <div class="ar-attr-list">
              ${attrsHtml}
            </div>

            <div class="ar-stats-section-title">Sức Mạnh Tấn Công</div>
            <div class="ar-stats-grid">${renderStatRows(offenseKeys)}</div>

            <div class="ar-stats-section-title">Phòng Thủ &amp; Sinh Tồn</div>
            <div class="ar-stats-grid">${renderStatRows(defenseKeys)}</div>

            <div class="ar-stats-section-title">Tài Nguyên &amp; Di Chuyển</div>
            <div class="ar-stats-grid">${renderStatRows(resourceKeys)}</div>
          </div>
        </section>

        <!-- CENTER: 8-SLOT PAPER-DOLL & BLACKSMITH FORGE -->
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">Trang Bị (8 Ô)</span>
            <span style="font-size:10.5px;color:#9e937b;">Click Phải để Tháo Ra</span>
          </div>
          <div class="ar-subpanel-body">
            <div class="ar-paperdoll-stage">
              <div class="ar-paperdoll-silhouette">
                ${getHeroPaperDollSilhouette(player.heroClass)}
              </div>
              ${paperDollSlotsHtml}
            </div>

            ${forgeHtml}
          </div>
        </section>

        <!-- RIGHT: 40-SLOT INVENTORY GRID -->
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">Ba Lô Chiến (${inventory.length} / 40)</span>
            <span style="font-size:10.5px;color:#9e937b;">Click Xem • Click Đôi/Phải Để Trang Bị</span>
          </div>
          <div class="ar-subpanel-body" data-scroll-key="inv-grid">
            <div class="ar-inv-toolbar">
              <div class="ar-inv-filter-group">
                ${(['all', 'weapons', 'armor', 'jewelry'] as InvFilter[])
                  .map(
                    (f) => `
                    <button
                      type="button"
                      class="ar-filter-pill ${this.filter === f ? 'is-active' : ''}"
                      data-inv-filter="${f}"
                    >${f === 'all' ? 'Tất Cả' : f === 'weapons' ? 'Vũ Khí' : f === 'armor' ? 'Giáp' : 'Trang Sức'}</button>
                  `,
                  )
                  .join('')}
              </div>
              <span style="font-size:10.5px;color:#9e937b;">Di chuột lên vật phẩm để xem chỉ số &amp; đá rune</span>
            </div>

            <div class="ar-inv-grid">
              ${invCellsHtml}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  private getActiveShockwave(
    slot: EquipSlot,
    now: number,
  ): { colorCss: string; until: number } | null {
    const entry = this.slotShockwaves.get(slot);
    if (!entry) return null;
    if (now >= entry.until) {
      this.slotShockwaves.delete(slot);
      return null;
    }
    return entry;
  }

  private getActiveFlash(
    key: keyof (DerivedStats & Attributes),
    now: number,
  ): StatFlashEntry | null {
    const entry = this.statFlashes.get(key);
    if (!entry) return null;
    if (now >= entry.until) {
      this.statFlashes.delete(key);
      return null;
    }
    return entry;
  }

  private resolveSelectedItem(
    inventory: ItemInstance[],
    equipped: Partial<Record<EquipSlot, ItemInstance>>,
  ): {
    item: ItemInstance;
    source: { kind: 'inventory'; itemId: string } | { kind: 'equipped'; slot: EquipSlot };
  } | null {
    if (this.selectedSource) {
      if (this.selectedSource.kind === 'inventory') {
        const targetId = this.selectedSource.itemId;
        const found = inventory.find((i) => i.id === targetId);
        if (found) {
          return { item: found, source: this.selectedSource };
        }
      } else {
        const eq = equipped[this.selectedSource.slot];
        if (eq) {
          return { item: eq, source: this.selectedSource };
        }
      }
    }

    if (inventory.length > 0) {
      this.selectedSource = { kind: 'inventory', itemId: inventory[0].id };
      return { item: inventory[0], source: this.selectedSource };
    }
    for (const { slot } of PAPERDOLL_SLOTS) {
      const eq = equipped[slot];
      if (eq) {
        this.selectedSource = { kind: 'equipped', slot };
        return { item: eq, source: this.selectedSource };
      }
    }
    this.selectedSource = null;
    return null;
  }

  private renderBlacksmithForge(
    selected: {
      item: ItemInstance;
      source: { kind: 'inventory'; itemId: string } | { kind: 'equipped'; slot: EquipSlot };
    } | null,
    isAnvilForging: boolean,
    runeMap: ReturnType<typeof getRuneDefMap>,
  ): string {
    if (!selected) {
      return `
        <div class="ar-forge-card">
          <div class="ar-forge-head">
            <span class="ar-forge-title">${SVG_ANVIL} Đe Thợ Rèn</span>
            <span style="font-size:11px;color:#9e937b;">Rảnh rỗi</span>
          </div>
          <p style="font-size:12px;color:#a99d86;line-height:1.45;">
            Chọn bất kỳ vật phẩm đang trang bị hoặc trong túi để rèn luyện affixes (+1 đến +10), trang bị/tháo ra, gắn Rune, hoặc phân rã thành Vàng Vực Thẳm.
          </p>
        </div>
      `;
    }

    const { item, source } = selected;
    const accent = getItemAccentInfo(item);
    const upgLvl = Math.min(10, Math.max(0, safeNum(item.upgradeLevel, 0)));
    const isMaxed = upgLvl >= 10;
    const upgradeCost = estimateUpgradeCost(item);
    const salvageGold = estimateSalvageGold(item);

    const pipsHtml = Array.from({ length: 10 }, (_, idx) => {
      return `<div class="ar-forge-pip ${idx < upgLvl ? 'is-filled' : ''}"></div>`;
    }).join('');

    const sparksMarkup = isAnvilForging
      ? `<div class="ar-anvil-spark-burst" aria-hidden="true">
          ${Array.from(
            { length: 12 },
            (_, idx) =>
              `<span class="ar-anvil-spark" style="--spark-angle:${idx * 30}deg;--spark-dist:${54 + (idx % 3) * 18}px;"></span>`,
          ).join('')}
        </div>`
      : '';

    return `
      <div class="ar-forge-card ${isAnvilForging ? 'is-forging' : ''}">
        ${sparksMarkup}
        <div class="ar-forge-head">
          <span class="ar-forge-title">${SVG_ANVIL} Đe Thợ Rèn</span>
          <span style="font-size:11.5px;font-weight:700;color:#ffd97d;">Cấp Rèn +${upgLvl} / +10</span>
        </div>

        <div style="display:flex;align-items:center;gap:10px;">
          <div class="ar-item-slot rarity-${item.rarity} ${accent.slotExtraClass} ${isAnvilForging ? 'is-just-equipped' : ''}" style="width:46px;height:46px;cursor:default;flex-shrink:0;">
            ${getItemSvg(item, accent.css)}
            ${renderItemSocketPipsHtml(item, runeMap)}
          </div>
          <div style="min-width:0;flex:1;">
            <div style="font-family:var(--font-display);font-size:13px;font-weight:700;color:${accent.css};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${item.isMythic ? '❖ ' : item.setName ? '◈ ' : ''}${escapeHtml(item.name)} ${upgLvl > 0 ? `+${upgLvl}` : ''}
            </div>
            <div style="font-size:11px;color:#b5a88e;">
              ${escapeHtml(accent.tierLabel)} ${escapeHtml(item.slot.toUpperCase())} • iLv ${safeNum(item.itemLevel, 1)} ${item.runewordName ? `• '${escapeHtml(item.runewordName)}'` : ''}
            </div>
          </div>
        </div>

        <div class="ar-forge-pips" title="Cấp Rèn Thợ Rèn (+${upgLvl} trên +10)">
          ${pipsHtml}
        </div>

        <div class="ar-forge-actions">
          ${
            source.kind === 'inventory'
              ? `<button type="button" class="ar-btn ar-btn-sm ar-btn-emerald" data-action="forge-equip">
                  ${t('item.equip')}
                </button>`
              : `<button type="button" class="ar-btn ar-btn-sm" data-action="forge-unequip">
                  ${t('item.unequip')}
                </button>`
          }
          <button
            type="button"
            class="ar-btn ar-btn-sm ar-btn-gold"
            data-action="forge-upgrade"
            ${isMaxed ? 'disabled' : ''}
          >
            ${isMaxed ? 'Tối Đa +10' : `⚒ ${t('craft.upgrade')} +${upgLvl + 1} (${upgradeCost}g)`}
          </button>
          ${
            source.kind === 'inventory'
              ? `<button type="button" class="ar-btn ar-btn-sm" data-action="forge-deposit-stash" title="Gửi vào Kho Chung">
                  🏛 ${t('inventory.stash')}
                </button>
                <button type="button" class="ar-btn ar-btn-sm ar-btn-danger" data-action="forge-salvage" title="Phân rã vật phẩm lấy vàng">
                  🔥 Phân Rã (+${salvageGold}g)
                </button>`
              : ''
          }
        </div>
      </div>
    `;
  }

  private bindEvents(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    selected: {
      item: ItemInstance;
      source: { kind: 'inventory'; itemId: string } | { kind: 'equipped'; slot: EquipSlot };
    } | null,
    onSwitchPanel: (panel: MenuPanelId) => void,
    onClose: () => void,
  ): void {
    bindWindowTopbarEvents(mountEl, { onSwitchPanel, onClose });

    const backdrop = mountEl.querySelector<HTMLElement>('[data-backdrop="closeable"]');
    backdrop?.addEventListener('click', (ev) => {
      if (ev.target === backdrop) {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        onClose();
      }
    });

    // Sub-tab switcher
    mountEl.querySelectorAll<HTMLButtonElement>('[data-inv-subtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTab = btn.dataset.invSubtab as InventorySubTab | undefined;
        if (!nextTab || nextTab === this.subTab) return;
        this.subTab = nextTab;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        this.render(mountEl, ctx, callbacks, onSwitchPanel, onClose, false);
      });
    });

    if (this.subTab !== 'armory') {
      this.workbenches.bindWorkbenchEvents(
        mountEl,
        ctx,
        callbacks,
        () => this.render(mountEl, ctx, callbacks, onSwitchPanel, onClose, false),
        (el, x, y) => this.positionTooltip(el, x, y),
      );
      return;
    }

    // Attribute + buttons
    mountEl.querySelectorAll<HTMLButtonElement>('[data-spend-attr]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const attr = btn.dataset.spendAttr as keyof Attributes | undefined;
        if (!attr) return;
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onSpendAttribute(attr);
      });
    });

    // Filter pills
    mountEl.querySelectorAll<HTMLButtonElement>('[data-inv-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.invFilter as InvFilter | undefined;
        if (!f || f === this.filter) return;
        this.filter = f;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        this.render(mountEl, ctx, callbacks, onSwitchPanel, onClose, false);
      });
    });

    // Tooltip helper
    const tooltipEl = mountEl.querySelector<HTMLElement>('[data-role="item-tooltip"]');
    const showTooltip = (ev: MouseEvent, item: ItemInstance, isEquippedSlot: boolean) => {
      if (!tooltipEl) return;
      const accent = getItemAccentInfo(item);
      tooltipEl.style.setProperty('--tt-border', accent.css);
      tooltipEl.style.setProperty('--tt-glow', `${accent.css}44`);
      tooltipEl.innerHTML = buildRichItemTooltipHtml(
        item,
        ctx,
        ctx.equipped?.[item.slot],
        isEquippedSlot,
      );
      tooltipEl.classList.remove('is-hidden');
      this.positionTooltip(tooltipEl, ev.clientX, ev.clientY);
    };

    const moveTooltip = (ev: MouseEvent) => {
      if (!tooltipEl || tooltipEl.classList.contains('is-hidden')) return;
      this.positionTooltip(tooltipEl, ev.clientX, ev.clientY);
    };

    const hideTooltip = () => {
      tooltipEl?.classList.add('is-hidden');
    };

    // Equipped Paper-Doll Slots
    mountEl.querySelectorAll<HTMLElement>('[data-equipped-item-id]').forEach((slotEl) => {
      const slot = slotEl.dataset.equipSlot as EquipSlot | undefined;
      if (!slot) return;
      const item = ctx.equipped?.[slot];
      if (!item) return;

      slotEl.addEventListener('mouseenter', (ev) => showTooltip(ev, item, true));
      slotEl.addEventListener('mousemove', moveTooltip);
      slotEl.addEventListener('mouseleave', hideTooltip);

      slotEl.addEventListener('click', () => {
        this.selectedSource = { kind: 'equipped', slot };
        eventBus.emit('sfx:request', { id: 'ui_click' });
        this.render(mountEl, ctx, callbacks, onSwitchPanel, onClose, false);
      });

      slotEl.addEventListener('dblclick', () => {
        hideTooltip();
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onUnequipSlot(slot);
      });

      slotEl.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        hideTooltip();
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onUnequipSlot(slot);
      });
    });

    // Inventory Grid Slots
    mountEl.querySelectorAll<HTMLElement>('[data-inv-item-id]').forEach((cellEl) => {
      const itemId = cellEl.dataset.invItemId;
      if (!itemId) return;
      const item = (ctx.inventory ?? []).find((i) => i.id === itemId);
      if (!item) return;

      cellEl.addEventListener('mouseenter', (ev) => showTooltip(ev, item, false));
      cellEl.addEventListener('mousemove', moveTooltip);
      cellEl.addEventListener('mouseleave', hideTooltip);

      cellEl.addEventListener('click', () => {
        this.selectedSource = { kind: 'inventory', itemId };
        eventBus.emit('sfx:request', { id: 'ui_click' });
        this.render(mountEl, ctx, callbacks, onSwitchPanel, onClose, false);
      });

      cellEl.addEventListener('dblclick', () => {
        hideTooltip();
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onEquipItem(itemId);
      });

      cellEl.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        hideTooltip();
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onEquipItem(itemId);
      });
    });

    // Blacksmith Forge Action Buttons
    if (selected) {
      mountEl
        .querySelector<HTMLButtonElement>('[data-action="forge-equip"]')
        ?.addEventListener('click', () => {
          this.selectedSource = { kind: 'equipped', slot: selected.item.slot };
          eventBus.emit('sfx:request', { id: 'ui_equip' });
          callbacks?.onEquipItem(selected.item.id);
        });

      mountEl
        .querySelector<HTMLButtonElement>('[data-action="forge-unequip"]')
        ?.addEventListener('click', () => {
          if (selected.source.kind === 'equipped') {
            this.selectedSource = { kind: 'inventory', itemId: selected.item.id };
            eventBus.emit('sfx:request', { id: 'ui_equip' });
            callbacks?.onUnequipSlot(selected.source.slot);
          }
        });

      mountEl
        .querySelector<HTMLButtonElement>('[data-action="forge-upgrade"]')
        ?.addEventListener('click', () => {
          eventBus.emit('sfx:request', { id: 'ui_equip' });
          callbacks?.onUpgradeItem(selected.item.id);
        });

      mountEl
        .querySelector<HTMLButtonElement>('[data-action="forge-deposit-stash"]')
        ?.addEventListener('click', () => {
          eventBus.emit('sfx:request', { id: 'ui_equip' });
          callbacks?.onDepositStash?.(selected.item.id);
        });

      mountEl
        .querySelector<HTMLButtonElement>('[data-action="forge-salvage"]')
        ?.addEventListener('click', () => {
          eventBus.emit('sfx:request', { id: 'ui_click' });
          callbacks?.onSalvageItem(selected.item.id);
        });
    }
  }

  private positionTooltip(tooltipEl: HTMLElement, clientX: number, clientY: number): void {
    const pad = 16;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    const rect = tooltipEl.getBoundingClientRect();
    const w = rect.width || 330;
    const h = rect.height || 240;

    let x = clientX + 18;
    let y = clientY + 14;
    if (x + w + pad > vw) {
      x = Math.max(pad, clientX - w - 18);
    }
    if (y + h + pad > vh) {
      y = Math.max(pad, vh - h - pad);
    }
    tooltipEl.style.left = `${Math.round(x)}px`;
    tooltipEl.style.top = `${Math.round(y)}px`;
  }

  dispose(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;
    this.slotShockwaves.clear();
    this.statFlashes.clear();
  }
}
