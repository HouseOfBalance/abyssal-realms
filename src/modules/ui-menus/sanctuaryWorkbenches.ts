import { eventBus } from '../../core/EventBus';
import type {
  EquipSlot,
  ItemInstance,
  ItemSetDefinition,
  MenusCallbacks,
  MenusRefreshContext,
  MercenaryId,
  PetId,
  RuneId,
  RunewordDefinition,
} from '../../contracts/types';
import {
  escapeHtml,
  formatStatValue,
  getItemSvg,
  getSlotSvg,
  getStatLabel,
  safeNum,
  SVG_GOLD_COIN,
} from './icons';
import {
  buildRichItemTooltipHtml,
  FALLBACK_RUNE_CATALOG,
  getItemAccentInfo,
  getRuneDefMap,
  hexToCss,
  renderItemSocketPipsHtml,
} from './itemFormatting';

export type InventorySubTab = 'armory' | 'runewords' | 'stash' | 'gambler' | 'companions';

const ALL_GAMBLE_SLOTS: ReadonlyArray<{ slot: EquipSlot; label: string }> = [
  { slot: 'weapon', label: 'Vũ Khí Bí Ẩn' },
  { slot: 'offhand', label: 'Vật Phẩm Tay Phụ Bí Ẩn' },
  { slot: 'helmet', label: 'Mũ Giáp Bí Ẩn' },
  { slot: 'chest', label: 'Áo Giáp Bí Ẩn' },
  { slot: 'gloves', label: 'Găng Tay Bí Ẩn' },
  { slot: 'boots', label: 'Giày Chiến Bí Ẩn' },
  { slot: 'ring', label: 'Nhẫn Bí Ẩn' },
  { slot: 'amulet', label: 'Bùa Hộ Mệnh Bí Ẩn' },
];

const FALLBACK_RUNEWORDS: ReadonlyArray<RunewordDefinition> = [
  { id: 'rw_enigma', name: 'Enigma of the Void', allowedSlots: ['chest'], pattern: ['jah', 'ist', 'ber'], bonusAffixes: [{ label: 'Máu Tối Đa', statKey: 'maxHp', value: 110 }, { label: 'Tốc Độ Di Chuyển', statKey: 'moveSpeed', value: 0.8 }], mythicPower: 'Ban Bước Đi Xuyên Không Tinh Tú và +12% Giảm Sát Thương.' },
  { id: 'rw_grief', name: 'Grief of Kings', allowedSlots: ['weapon'], pattern: ['sol', 'vex', 'lo'], bonusAffixes: [{ label: 'Sức Tấn Công', statKey: 'attackPower', value: 38 }, { label: 'Tốc Độ Đánh', statKey: 'attackSpeed', value: 0.16 }], mythicPower: 'Mỗi đòn đánh thứ 3 xé toạc giáp và kích hoạt sóng chấn động độc.' },
  { id: 'rw_infinity', name: 'Infinity Loom', allowedSlots: ['weapon', 'offhand'], pattern: ['ber', 'mal', 'sur'], bonusAffixes: [{ label: 'Sức Mạnh Phép', statKey: 'spellPower', value: 44 }, { label: 'Tỉ Lệ Chí Mạng', statKey: 'critChance', value: 0.08, isPercent: true }], mythicPower: 'Tỏa Hào Quang Phán Quyết, khuếch đại Phản Ứng Nguyên Tố thêm +25%.' },
  { id: 'rw_fortitude', name: 'Bastion Fortitude', allowedSlots: ['chest', 'helmet'], pattern: ['sol', 'mal', 'ohm'], bonusAffixes: [{ label: 'Giáp', statKey: 'armor', value: 65 }, { label: 'Hồi Phục Máu', statKey: 'hpRegen', value: 5 }], mythicPower: 'Triệu hồi Giáp Băng Giá khi bị tấn công, đóng băng kẻ địch xung quanh.' },
  { id: 'rw_breath', name: 'Breath of the Undying', allowedSlots: ['weapon'], pattern: ['vex', 'gul', 'zod'], bonusAffixes: [{ label: 'Sức Tấn Công', statKey: 'attackPower', value: 45 }, { label: 'Hút Máu', statKey: 'lifeSteal', value: 0.07, isPercent: true }], mythicPower: 'Kẻ địch bị hạ gục phát nổ trong Vụ Nổ Độc & Huyết Thẫm.' },
  { id: 'rw_spirit', name: 'Astral Spirit', allowedSlots: ['offhand', 'amulet'], pattern: ['sol', 'ist', 'sur'], bonusAffixes: [{ label: 'Sức Mạnh Phép', statKey: 'spellPower', value: 28 }, { label: 'Giảm Hồi Chiêu', statKey: 'cooldownReduction', value: 0.1, isPercent: true }], mythicPower: 'Hồi phục 6 Mana mỗi khi gây đòn chí mạng.' },
  { id: 'rw_chains', name: 'Chains of Honor', allowedSlots: ['chest', 'gloves'], pattern: ['mal', 'ohm', 'ber'], bonusAffixes: [{ label: 'Giáp', statKey: 'armor', value: 48 }, { label: 'Hút Máu', statKey: 'lifeSteal', value: 0.05, isPercent: true }], mythicPower: '+20% Sát Thương Thêm lên Quái Tinh Anh và Trùm Đỉnh Cao.' },
  { id: 'rw_doom', name: 'Rimefire Doom', allowedSlots: ['weapon', 'helmet'], pattern: ['ohm', 'lo', 'cham'], bonusAffixes: [{ label: 'Sát Thương Chí Mạng', statKey: 'critMultiplier', value: 0.35, isPercent: true }, { label: 'Tỉ Lệ Chí Mạng', statKey: 'critChance', value: 0.07, isPercent: true }], mythicPower: 'Truyền Sương Giá Băng Hỏa vào đòn đánh, kích hoạt Phá Băng lên kẻ địch bị làm lạnh.' },
];

const FALLBACK_ITEM_SETS: ReadonlyArray<ItemSetDefinition> = [
  {
    id: 'set_warlord',
    name: 'Bulwark of the Shattered King',
    heroClass: 'vanguard',
    twoPieceBonus: { description: '+65 Giáp & +80 Máu Tối Đa', stats: { armor: 65, maxHp: 80 } },
    fourPieceBonus: { description: '+35 Sức Tấn Công & +8% Hút Máu', stats: { attackPower: 35, lifeSteal: 0.08 }, specialEffect: 'Lốc Xoáy & Bổ Kiếm phóng ra sóng chấn động dung nham.' },
  },
  {
    id: 'set_veil',
    name: 'Raiment of the Whispering Veil',
    heroClass: 'shadowblade',
    twoPieceBonus: { description: '+8% Tỉ Lệ Chí Mạng & +8% Tỉ Lệ Né Tránh', stats: { critChance: 0.08, dodgeChance: 0.08 } },
    fourPieceBonus: { description: '+40% Sát Thương Chí Mạng & +15% Tốc Độ Đánh', stats: { critMultiplier: 0.4, attackSpeed: 0.15 }, specialEffect: 'Né tránh để lại một phân thân bóng tối phát nổ chí tử.' },
  },
  {
    id: 'set_archon',
    name: 'Vestments of the Astral Archon',
    heroClass: 'arcanist',
    twoPieceBonus: { description: '+32 Sức Mạnh Phép & +45 Mana Tối Đa', stats: { spellPower: 32, maxMana: 45 } },
    fourPieceBonus: { description: '+14% Giảm Hồi Chiêu & +10% Tỉ Lệ Chí Mạng', stats: { cooldownReduction: 0.14, critChance: 0.1 }, specialEffect: 'Phản Ứng Nguyên Tố cộng hưởng thêm một vụ nổ tinh tú thứ hai.' },
  },
];

const PET_CATALOG: ReadonlyArray<{
  id: PetId;
  name: string;
  title: string;
  auraDesc: string;
  color: string;
  glyph: string;
}> = [
  {
    id: 'celestial_owl',
    name: 'Cú Tinh Bàn',
    title: 'Linh Thú Ma Pháp Ánh Sao',
    auraDesc: 'Tự động nhặt Vàng/Cầu/Rune • Ban hào quang +Hồi Phục Mana & Giảm Hồi Chiêu',
    color: '#74c0fc',
    glyph: '🦉',
  },
  {
    id: 'ember_wyrmling',
    name: 'Rồng Lửa Non',
    title: 'Hậu Duệ Lò Rèn Hắc Diện',
    auraDesc: 'Tự động nhặt Vàng/Cầu/Rune • Ban hào quang +Sức Tấn Công & Tỉ Lệ Chí Mạng',
    color: '#ff922b',
    glyph: '🐉',
  },
  {
    id: 'void_kitsune',
    name: 'Hồ Ly Hư Không',
    title: 'Cửu Vĩ Linh Hồ Khe Nứt',
    auraDesc: 'Tự động nhặt Vàng/Cầu/Rune • Ban hào quang +Tốc Độ Di Chuyển, Né Tránh & Hút Máu',
    color: '#da77f2',
    glyph: '🦊',
  },
];

const MERC_CATALOG: ReadonlyArray<{
  id: MercenaryId;
  name: string;
  role: string;
  desc: string;
  color: string;
  glyph: string;
}> = [
  {
    id: 'iron_templar',
    name: 'Hiệp Sĩ Gareth, Chiến Binh Thép',
    role: 'Tiền Phong Tuyến Đầu • Khiêu Khích & Hào Quang Giáp Sắt',
    desc: 'Xung phong vào bầy quỷ với búa chiến và khiên, thu hút hỏa lực và tăng cường Giáp & Hồi Phục Máu của bạn.',
    color: '#fcc419',
    glyph: '🛡',
  },
  {
    id: 'sylvan_ranger',
    name: 'Lyra, Xạ Thủ Rừng Thẳm',
    role: 'Xạ Kích Tầm Xa • Mưa Tên Băng & Hào Quang Tốc Chiến',
    desc: 'Trút mưa tên băng xuyên thấu từ xa, làm chậm kẻ địch và tăng Tỉ Lệ Chí Mạng & Tốc Độ Đánh của bạn.',
    color: '#69db7c',
    glyph: '🏹',
  },
  {
    id: 'storm_arcanist',
    name: 'Malric, Pháp Sư Bão Tố',
    role: 'Pháp Sư Chiến Trận • Xích Sét & Hào Quang Dẫn Truyền',
    desc: 'Phóng cầu sét hồ quang kích hoạt phản ứng Siêu Dẫn đồng thời gia tăng Sức Mạnh Phép của bạn.',
    color: '#4dabf7',
    glyph: '⚡',
  },
];

export class SanctuaryWorkbenchesController {
  private benchSelectedItemId: string | null = null;
  private recipeViewMode: 'runewords' | 'sets' = 'runewords';

  /* =========================================================
     TAB 2: RUNEWORD & SOCKET BENCH
     ========================================================= */
  renderRunewordBenchHtml(ctx: MenusRefreshContext): string {
    const runeMap = getRuneDefMap(ctx);
    const ownedRunes = ctx.ownedRunes ?? ({} as Record<RuneId, number>);
    const allSocketableItems: Array<{ item: ItemInstance; worn: boolean }> = [];

    for (const eq of Object.values(ctx.equipped ?? {})) {
      if (eq) allSocketableItems.push({ item: eq, worn: true });
    }
    for (const inv of ctx.inventory ?? []) {
      allSocketableItems.push({ item: inv, worn: false });
    }

    let activeEntry = allSocketableItems.find((e) => e.item.id === this.benchSelectedItemId);
    if (!activeEntry && allSocketableItems.length > 0) {
      activeEntry = allSocketableItems[0];
      this.benchSelectedItemId = activeEntry.item.id;
    }

    const itemListHtml = allSocketableItems
      .map(({ item, worn }) => {
        const accent = getItemAccentInfo(item);
        const isSel = activeEntry?.item.id === item.id;
        const socks = Math.max(safeNum(item.sockets, 0), (item.socketedRunes ?? []).length);
        return `
          <button
            type="button"
            class="ar-lore-item-btn ${isSel ? 'is-active' : ''}"
            data-bench-item-id="${escapeHtml(item.id)}"
            style="flex-direction:row;align-items:center;justify-content:space-between;gap:8px;"
          >
            <div style="min-width:0;">
              <div style="font-family:var(--font-display);font-size:12px;font-weight:700;color:${accent.css};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${item.isMythic ? '❖ ' : item.setName ? '◈ ' : ''}${escapeHtml(item.name)}
              </div>
              <div style="font-size:10.5px;color:#9e937b;">
                ${worn ? 'Đang Trang Bị' : 'Trong Túi'} • ${escapeHtml(item.slot.toUpperCase())} ${item.runewordName ? `• '${escapeHtml(item.runewordName)}'` : ''}
              </div>
            </div>
            <span style="font-size:10.5px;font-weight:700;color:#ffd97d;white-space:nowrap;">
              ${(item.socketedRunes ?? []).length}/${socks} ○
            </span>
          </button>
        `;
      })
      .join('');

    let anvilSocketBox = `<div style="font-size:12px;color:#9e937b;">Nhận hoặc trang bị một vật phẩm để khoan Rãnh Rune và rèn Từ Khóa Rune.</div>`;
    if (activeEntry) {
      const target = activeEntry.item;
      const accent = getItemAccentInfo(target);
      const totalSockets = Math.max(
        safeNum(target.sockets, 0),
        (target.socketedRunes ?? []).length,
      );
      const socketed = target.socketedRunes ?? [];

      const wellsHtml =
        totalSockets > 0
          ? Array.from({ length: totalSockets }, (_, i) => {
              const rId = socketed[i];
              if (!rId) {
                return `<div class="ar-socket-well">Trống</div>`;
              }
              const def = runeMap.get(rId);
              const col = hexToCss(def?.colorHex, '#ffd43b');
              return `<div class="ar-socket-well is-socketed" style="--rune-hex:${col};">${escapeHtml((def?.name ?? rId).toUpperCase())}</div>`;
            }).join('')
          : `<div style="font-size:11.5px;color:#9e937b;padding:8px;">Chưa có rãnh nào — nhấn <strong>Thêm Rãnh</strong> bên dưới!</div>`;

      anvilSocketBox = `
        <div class="ar-forge-card" style="border-color:${accent.css}88;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="ar-item-slot rarity-${target.rarity} ${accent.slotExtraClass}" style="width:52px;height:52px;cursor:default;flex-shrink:0;">
              ${getItemSvg(target, accent.css)}
              ${renderItemSocketPipsHtml(target, runeMap)}
            </div>
            <div style="min-width:0;flex:1;">
              <div style="font-family:var(--font-display);font-size:13.5px;font-weight:700;color:${accent.css};">
                ${escapeHtml(target.name)}
              </div>
              <div style="font-size:11px;color:#b8aa8f;">
                ${escapeHtml(accent.tierLabel)} ${escapeHtml(target.slot.toUpperCase())} • Rãnh: ${socketed.length}/${totalSockets}
              </div>
              ${
                target.runewordName
                  ? `<div style="font-size:11.5px;font-weight:700;color:#ffe066;margin-top:2px;">✦ Từ Khóa Rune Đã Rèn: '${escapeHtml(target.runewordName)}'</div>`
                  : ''
              }
            </div>
          </div>

          <div class="ar-socket-well-row">
            ${wellsHtml}
          </div>

          <div class="ar-forge-actions">
            <button type="button" class="ar-btn ar-btn-sm ar-btn-gold" data-action="bench-add-socket" data-item-id="${escapeHtml(target.id)}">
              ⊕ Thêm Rãnh
            </button>
            <button
              type="button"
              class="ar-btn ar-btn-sm ar-btn-danger"
              data-action="bench-unsocket"
              data-item-id="${escapeHtml(target.id)}"
              ${socketed.length === 0 ? 'disabled' : ''}
            >
              ↺ Tháo Rune (${socketed.length})
            </button>
          </div>
        </div>
      `;
    }

    // Middle Pane: Owned Runes Grid
    const runeDefs =
      (ctx.runeDefinitions ?? []).length > 0 ? ctx.runeDefinitions! : FALLBACK_RUNE_CATALOG;
    const canSocketNow =
      activeEntry !== undefined &&
      (activeEntry.item.socketedRunes ?? []).length <
        Math.max(safeNum(activeEntry.item.sockets, 0), (activeEntry.item.socketedRunes ?? []).length);

    const runeTilesHtml = runeDefs
      .map((rDef) => {
        const count = safeNum(ownedRunes[rDef.id], 0);
        const col = hexToCss(rDef.colorHex, '#ffd43b');
        const bonusTxt = `+${formatStatValue(rDef.statBonus.statKey, rDef.statBonus.value, rDef.statBonus.isPercent)} ${rDef.statBonus.label || getStatLabel(rDef.statBonus.statKey)}`;
        return `
          <button
            type="button"
            class="ar-rune-tile"
            data-socket-rune-id="${rDef.id}"
            ${count <= 0 || !activeEntry ? 'disabled' : ''}
            title="${canSocketNow ? `Nhấn để gắn Rune ${rDef.name}` : 'Hãy thêm rãnh trống trên vật phẩm trước'}"
          >
            <div class="ar-rune-gem" style="--rune-hex:${col};">${escapeHtml(rDef.name.slice(0, 3))}</div>
            <div style="min-width:0;flex:1;">
              <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;">
                <span style="color:${col};">${escapeHtml(rDef.name)} <small style="color:#8f846e;">Bậc ${rDef.tier}</small></span>
                <span style="color:${count > 0 ? '#ffd97d' : '#868e96'};">x${count}</span>
              </div>
              <div style="font-size:10px;color:#bfb299;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapeHtml(bonusTxt)}
              </div>
            </div>
          </button>
        `;
      })
      .join('');

    // Right Pane: 8 Runeword Recipes & Set Bonuses
    const recipes =
      (ctx.runewordRecipes ?? []).length > 0 ? ctx.runewordRecipes! : FALLBACK_RUNEWORDS;
    const itemSets = (ctx.itemSets ?? []).length > 0 ? ctx.itemSets! : FALLBACK_ITEM_SETS;

    const recipesListHtml =
      this.recipeViewMode === 'runewords'
        ? recipes
            .map((rw) => {
              const patternBadges = rw.pattern
                .map((rId) => {
                  const col = hexToCss(runeMap.get(rId)?.colorHex, '#ffd43b');
                  return `<span style="padding:2px 6px;border-radius:3px;background:rgba(0,0,0,0.55);border:1px solid ${col};color:${col};font-size:10px;font-weight:800;text-transform:uppercase;">${escapeHtml(rId)}</span>`;
                })
                .join('<span style="color:#9e937b;font-size:10px;"> + </span>');

              const bonusLine = rw.bonusAffixes
                .map(
                  (af) =>
                    `+${formatStatValue(af.statKey, af.value, af.isPercent)} ${af.label || getStatLabel(af.statKey)}`,
                )
                .join(' • ');

              return `
                <div style="padding:10px 12px;border-radius:5px;background:rgba(16,13,26,0.88);border:1px solid rgba(200,155,60,0.28);display:flex;flex-direction:column;gap:5px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <span style="font-family:var(--font-display);font-size:13px;font-weight:700;color:#ffe066;">✦ ${escapeHtml(rw.name)}</span>
                    <span style="font-size:10px;text-transform:uppercase;color:#9e937b;">Vị Trí: ${escapeHtml(rw.allowedSlots.join(', '))}</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">${patternBadges}</div>
                  <div style="font-size:11px;color:#99c8ff;">${escapeHtml(bonusLine)}</div>
                  <div style="font-size:11px;color:#ffc078;line-height:1.35;">${escapeHtml(rw.mythicPower)}</div>
                </div>
              `;
            })
            .join('')
        : itemSets
            .map((setDef) => {
              const activePieces =
                (ctx.activeSets ?? []).find((as) => as.set.id === setDef.id)?.pieces ??
                Object.values(ctx.equipped ?? {}).filter(
                  (eq) => eq && (eq.setId === setDef.id || eq.setName === setDef.name),
                ).length;

              return `
                <div style="padding:11px 13px;border-radius:5px;background:rgba(12,24,22,0.72);border:1px solid rgba(32,201,151,0.42);display:flex;flex-direction:column;gap:5px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-family:var(--font-display);font-size:13px;font-weight:700;color:#63e6be;">❖ ${escapeHtml(setDef.name)}</span>
                    <span style="font-size:11px;font-weight:700;color:${activePieces >= 2 ? '#69db7c' : '#adb5bd'};">${activePieces} / 4 Đã Trang Bị</span>
                  </div>
                  <div style="font-size:11.5px;color:${activePieces >= 2 ? '#8ce99a' : '#9e937b'};">
                    <strong>(2 Món):</strong> ${escapeHtml(setDef.twoPieceBonus.description)}
                  </div>
                  <div style="font-size:11.5px;color:${activePieces >= 4 ? '#8ce99a' : '#9e937b'};">
                    <strong>(4 Món):</strong> ${escapeHtml(setDef.fourPieceBonus.description)} — ${escapeHtml(setDef.fourPieceBonus.specialEffect)}
                  </div>
                </div>
              `;
            })
            .join('');

    return `
      <div class="ar-bench-3col ar-tab-spring">
        <!-- LEFT: TARGET ITEM & SOCKET ANVIL -->
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">Bàn Gắn Đá Rune</span>
            <span style="font-size:10.5px;color:#9e937b;">Chọn Trang Bị</span>
          </div>
          <div class="ar-subpanel-body" data-scroll-key="bench-items">
            ${anvilSocketBox}
            <div class="ar-stats-section-title">Trang Bị Hiện Có (${allSocketableItems.length})</div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${itemListHtml}
            </div>
          </div>
        </section>

        <!-- MIDDLE: OWNED RUNE POUCH -->
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">Túi Đá Rune (12 Rune)</span>
            <span style="font-size:10.5px;color:#9e937b;">Nhấn Để Gắn</span>
          </div>
          <div class="ar-subpanel-body" data-scroll-key="bench-runes">
            <p style="font-size:11.5px;color:#b5a88e;line-height:1.4;">
              Gắn các Rune theo đúng thứ tự vào trang bị có rãnh để đánh thức <strong>Từ Khóa Rune</strong> cổ đại!
            </p>
            <div class="ar-rune-grid">
              ${runeTilesHtml}
            </div>
          </div>
        </section>

        <!-- RIGHT: 8 RUNEWORD RECIPES & SET BONUSES -->
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <div style="display:flex;gap:6px;">
              <button type="button" class="ar-filter-pill ${this.recipeViewMode === 'runewords' ? 'is-active' : ''}" data-recipe-mode="runewords">
                Công Thức Từ Khóa Rune (${recipes.length})
              </button>
              <button type="button" class="ar-filter-pill ${this.recipeViewMode === 'sets' ? 'is-active' : ''}" data-recipe-mode="sets">
                Bộ Trang Bị (${itemSets.length})
              </button>
            </div>
          </div>
          <div class="ar-subpanel-body" data-scroll-key="bench-recipes" style="gap:8px;">
            ${recipesListHtml}
          </div>
        </section>
      </div>
    `;
  }

  /* =========================================================
     TAB 3: SHARED BASTION STASH
     ========================================================= */
  renderStashHtml(ctx: MenusRefreshContext): string {
    const stash = ctx.stash ?? [];
    const inventory = ctx.inventory ?? [];
    const runeMap = getRuneDefMap(ctx);

    const renderVaultCells = (
      items: ItemInstance[],
      capacity: number,
      dataAttr: 'data-stash-withdraw-id' | 'data-stash-deposit-id',
    ) =>
      Array.from({ length: capacity }, (_, idx) => {
        const item = items[idx];
        if (!item) {
          return `<div class="ar-item-slot is-inv-cell" style="cursor:default;opacity:0.35;"></div>`;
        }
        const accent = getItemAccentInfo(item);
        return `
          <div
            class="ar-item-slot is-inv-cell rarity-${item.rarity} ${accent.slotExtraClass}"
            ${dataAttr}="${escapeHtml(item.id)}"
            title="${escapeHtml(item.name)}"
            aria-label="${escapeHtml(item.name)}"
          >
            ${item.isMythic ? `<span class="ar-item-legendary-star" style="color:#ff4d6d;">❖</span>` : item.legendaryPower ? `<span class="ar-item-legendary-star">✦</span>` : ''}
            ${item.upgradeLevel > 0 ? `<span class="ar-item-upgrade-badge">+${item.upgradeLevel}</span>` : ''}
            <div class="ar-item-icon-wrap">${getItemSvg(item, accent.css)}</div>
            <span class="ar-item-ilvl-badge">Lv ${safeNum(item.levelReq, 1)}</span>
            ${renderItemSocketPipsHtml(item, runeMap)}
          </div>
        `;
      }).join('');

    return `
      <div class="ar-bench-2col ar-tab-spring">
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">Kho Chứa Chung Pháo Đài (${stash.length} / 40)</span>
            <span style="font-size:11px;color:#8ce99a;">Nhấn Vật Phẩm Để Rút Ra →</span>
          </div>
          <div class="ar-subpanel-body" data-scroll-key="stash-vault">
            <div class="ar-inv-grid">
              ${renderVaultCells(stash, 40, 'data-stash-withdraw-id')}
            </div>
          </div>
        </section>

        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">Ba Lô Chiến Binh (${inventory.length} / 40)</span>
            <span style="font-size:11px;color:#ffd97d;">← Nhấn Vật Phẩm Để Cất Vào</span>
          </div>
          <div class="ar-subpanel-body" data-scroll-key="stash-pack">
            <div class="ar-inv-grid">
              ${renderVaultCells(inventory, 40, 'data-stash-deposit-id')}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  /* =========================================================
     TAB 4: MYSTERY GAMBLER & BLOOD ALTAR
     ========================================================= */
  renderGamblerAndAltarHtml(ctx: MenusRefreshContext): string {
    const p = ctx.player;
    const gold = Math.floor(safeNum(p?.gold, 0));
    const curHp = Math.round(safeNum(p?.hp, 100));
    const maxHp = Math.max(1, Math.round(safeNum(p?.stats?.maxHp, 100)));
    const hpPct = Math.min(100, Math.round((curHp / maxHp) * 100));

    const slotBtnsHtml = ALL_GAMBLE_SLOTS.map(
      ({ slot, label }) => `
        <button
          type="button"
          class="ar-lore-item-btn"
          data-gamble-slot="${slot}"
          style="flex-direction:row;align-items:center;gap:10px;padding:10px 12px;"
        >
          <div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
            ${getSlotSvg(slot, '#e5b352')}
          </div>
          <div style="flex:1;">
            <div style="font-family:var(--font-display);font-size:12.5px;font-weight:700;color:#fff3d6;">
              ${escapeHtml(label)}
            </div>
            <div style="font-size:10.5px;color:#b5a88e;">Quay ${escapeHtml(slot.toUpperCase())} — Hiếm đến Thần Thoại</div>
          </div>
          <span style="color:#ffd97d;font-size:11.5px;font-weight:700;">🎲 Quay</span>
        </button>
      `,
    ).join('');

    return `
      <div class="ar-bench-2col ar-tab-spring">
        <!-- MYSTERY GAMBLER -->
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">🎲 Thương Nhân Cổ Vật Bí Ẩn</span>
            <span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#ffd97d;">
              ${SVG_GOLD_COIN} ${gold.toLocaleString()}g
            </span>
          </div>
          <div class="ar-subpanel-body" data-scroll-key="gambler-body">
            <div style="padding:12px 14px;border-radius:5px;background:linear-gradient(135deg,rgba(88,30,112,0.38),rgba(16,12,26,0.92));border:1px solid rgba(190,75,219,0.5);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div style="flex:1;min-width:180px;">
                <div style="font-family:var(--font-display);font-size:14px;font-weight:700;color:#f3d9fa;">
                  ✦ Cầu Bí Ẩn Định Mệnh (Mọi Vị Trí)
                </div>
                <div style="font-size:11.5px;color:#d0bfff;margin-top:2px;">
                  Đặt cược Vàng Vực Thẳm vào cổ vật chưa giám định — có thể nhận Huyền Thoại, Bộ Trang Bị hoặc Thần Thoại Nguyên Thủy!
                </div>
              </div>
              <button type="button" class="ar-btn ar-btn-gold" data-gamble-any="true">
                🎲 Đánh Cược Cổ Vật Ngẫu Nhiên
              </button>
            </div>

            <div class="ar-stats-section-title">Đặt Cược Theo Vị Trí</div>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
              ${slotBtnsHtml}
            </div>
          </div>
        </section>

        <!-- CRIMSON BLOOD ALTAR -->
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title" style="color:#ff8787;">🩸 Bàn Thờ Máu Đỏ Thẫm</span>
            <span style="font-size:11px;color:#ffa8a8;">Hiến Tế Máu Thịt Đổi Sức Mạnh</span>
          </div>
          <div class="ar-subpanel-body" style="justify-content:center;align-items:center;text-align:center;padding:24px;">
            <div style="width:100%;max-width:440px;padding:22px 24px;border-radius:6px;background:radial-gradient(circle at 50% 25%,rgba(192,24,42,0.32),rgba(14,8,14,0.96));border:1px solid rgba(255,77,109,0.55);display:flex;flex-direction:column;gap:14px;">
              <div style="font-size:34px;">🩸</div>
              <h3 style="font-family:var(--font-display);font-size:20px;color:#ffc9c9;letter-spacing:0.08em;">
                Giao Ước Huyết Tộc Của Kẻ Ngã Xuống
              </h3>
              <p style="font-size:12.5px;color:#e2c6ca;line-height:1.55;">
                Hiến dâng một phần sinh lực hiện tại lên chén thánh hắc diện để đánh thức <strong>Huyết Phước</strong> mạnh mẽ cho toàn tầng (+Sức Tấn Công/Phép, Chí Mạng, Tốc Độ hoặc Hút Máu).
              </p>

              <div style="display:flex;flex-direction:column;gap:5px;text-align:left;">
                <div style="display:flex;justify-content:space-between;font-size:11.5px;color:#ffd8d8;">
                  <span>Bình Sinh Lực Hiện Tại</span>
                  <strong>${curHp} / ${maxHp} HP (${hpPct}%)</strong>
                </div>
                <div class="ar-xp-bar-track" style="height:8px;border-color:rgba(255,107,107,0.4);">
                  <div style="height:100%;width:${hpPct}%;background:linear-gradient(90deg,#a61e2b,#ff4d6d);"></div>
                </div>
              </div>

              <button type="button" class="ar-btn ar-btn-primary" data-action="invoke-blood-altar" style="width:100%;padding:13px 20px;">
                🩸 Hiến Dâng Sinh Lực Tại Bàn Thờ
              </button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  /* =========================================================
     TAB 5: COMPANIONS (PETS & MERCENARIES)
     ========================================================= */
  renderCompanionsHtml(ctx: MenusRefreshContext): string {
    const comp = ctx.companions;
    const activePet = comp?.activePet ?? 'celestial_owl';
    const activeMerc = comp?.activeMercenary ?? 'iron_templar';
    const unlockedPets = comp?.unlockedPets ?? ['celestial_owl', 'ember_wyrmling', 'void_kitsune'];
    const unlockedMercs = comp?.unlockedMercenaries ?? [
      'iron_templar',
      'sylvan_ranger',
      'storm_arcanist',
    ];

    const petCardsHtml = PET_CATALOG.map((pet) => {
      const isActive = activePet === pet.id;
      const isUnlocked = unlockedPets.includes(pet.id);
      return `
        <div
          class="ar-quest-card"
          style="border-color:${isActive ? pet.color : 'rgba(200,155,60,0.26)'};${isActive ? `box-shadow:0 0 20px ${pet.color}33;` : ''}"
        >
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="ar-hero-emblem" style="width:46px;height:46px;--hero-accent:${pet.color};font-size:22px;">
              ${pet.glyph}
            </div>
            <div style="flex:1;">
              <div style="font-family:var(--font-display);font-size:14.5px;font-weight:700;color:#fff3d6;">
                ${escapeHtml(pet.name)}
              </div>
              <div style="font-size:11px;color:${pet.color};">${escapeHtml(pet.title)}</div>
            </div>
            ${
              isActive
                ? `<span class="ar-hero-selected-pill">Đã Triệu Hồi</span>`
                : `<button type="button" class="ar-btn ar-btn-sm ar-btn-gold" data-select-pet="${pet.id}" ${!isUnlocked ? 'disabled' : ''}>
                    ${isUnlocked ? 'Triệu Hồi' : 'Đã Khóa'}
                  </button>`
            }
          </div>
          <div style="font-size:11.5px;color:#cfc3ab;line-height:1.45;">${escapeHtml(pet.auraDesc)}</div>
        </div>
      `;
    }).join('');

    const mercHp = Math.round(safeNum(comp?.mercenaryHp, 240));
    const mercMaxHp = Math.max(1, Math.round(safeNum(comp?.mercenaryMaxHp, 240)));
    const mercHpPct = Math.min(100, Math.round((mercHp / mercMaxHp) * 100));

    const mercCardsHtml = MERC_CATALOG.map((merc) => {
      const isActive = activeMerc === merc.id;
      const isUnlocked = unlockedMercs.includes(merc.id);
      return `
        <div
          class="ar-quest-card"
          style="border-color:${isActive ? merc.color : 'rgba(200,155,60,0.26)'};${isActive ? `box-shadow:0 0 20px ${merc.color}33;` : ''}"
        >
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="ar-hero-emblem" style="width:46px;height:46px;--hero-accent:${merc.color};font-size:22px;">
              ${merc.glyph}
            </div>
            <div style="flex:1;">
              <div style="font-family:var(--font-display);font-size:14.5px;font-weight:700;color:#fff3d6;">
                ${escapeHtml(isActive && comp?.mercenaryName ? comp.mercenaryName : merc.name)}
              </div>
              <div style="font-size:11px;color:${merc.color};">${escapeHtml(merc.role)}</div>
            </div>
            ${
              isActive
                ? `<span class="ar-hero-selected-pill">Đã Thề Ước</span>`
                : `<button type="button" class="ar-btn ar-btn-sm ar-btn-emerald" data-select-merc="${merc.id}" ${!isUnlocked ? 'disabled' : ''}>
                    ${isUnlocked ? 'Chiêu Mộ' : 'Đã Khóa'}
                  </button>`
            }
          </div>
          <div style="font-size:11.5px;color:#cfc3ab;line-height:1.45;">${escapeHtml(merc.desc)}</div>
          ${
            isActive
              ? `<div style="display:flex;flex-direction:column;gap:4px;padding-top:4px;">
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:#d6c8ad;">
                    <span>Cấp ${safeNum(comp?.mercenaryLevel, safeNum(ctx.player?.level, 1))} • ${comp?.mercenaryAlive !== false ? 'Sẵn Sàng Chiến Đấu' : 'Đang Hồi Phục'}</span>
                    <strong>${mercHp} / ${mercMaxHp} HP</strong>
                  </div>
                  <div class="ar-xp-bar-track">
                    <div style="height:100%;width:${mercHpPct}%;background:linear-gradient(90deg,#2f9e44,#69db7c);"></div>
                  </div>
                </div>`
              : ''
          }
        </div>
      `;
    }).join('');

    return `
      <div class="ar-bench-2col ar-tab-spring">
        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">🦉 Thú Cưng Tinh Tú</span>
            <span style="font-size:10.5px;color:#9e937b;">Tự Nhặt Đồ &amp; Hào Quang Thụ Động</span>
          </div>
          <div class="ar-subpanel-body" style="gap:10px;">
            ${petCardsHtml}
          </div>
        </section>

        <section class="ar-subpanel">
          <div class="ar-subpanel-header">
            <span class="ar-subpanel-title">⚔ Lính Đánh Thuê Thề Ước</span>
            <span style="font-size:10.5px;color:#9e937b;">Chiến Binh Đồng Hành Chủ Động</span>
          </div>
          <div class="ar-subpanel-body" style="gap:10px;">
            ${mercCardsHtml}
          </div>
        </section>
      </div>
    `;
  }

  /* =========================================================
     SHARED EVENT BINDING FOR WORKBENCH SUB-TABS
     ========================================================= */
  bindWorkbenchEvents(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    rerender: () => void,
    positionTooltip: (el: HTMLElement, x: number, y: number) => void,
  ): void {
    // Runeword bench item selection
    mountEl.querySelectorAll<HTMLButtonElement>('[data-bench-item-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.benchSelectedItemId = btn.dataset.benchItemId ?? null;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        rerender();
      });
    });

    // Recipe view mode toggle
    mountEl.querySelectorAll<HTMLButtonElement>('[data-recipe-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.recipeMode as 'runewords' | 'sets' | undefined;
        if (!mode || mode === this.recipeViewMode) return;
        this.recipeViewMode = mode;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        rerender();
      });
    });

    // Add Socket & Unsocket
    mountEl
      .querySelector<HTMLButtonElement>('[data-action="bench-add-socket"]')
      ?.addEventListener('click', (ev) => {
        const id = (ev.currentTarget as HTMLButtonElement).dataset.itemId;
        if (!id) return;
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onAddSocket?.(id);
      });

    mountEl
      .querySelector<HTMLButtonElement>('[data-action="bench-unsocket"]')
      ?.addEventListener('click', (ev) => {
        const id = (ev.currentTarget as HTMLButtonElement).dataset.itemId;
        if (!id) return;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        callbacks?.onUnsocketRunes?.(id);
      });

    // Click owned rune to socket
    mountEl.querySelectorAll<HTMLButtonElement>('[data-socket-rune-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const runeId = btn.dataset.socketRuneId as RuneId | undefined;
        if (!runeId || !this.benchSelectedItemId) return;
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onSocketRune?.(this.benchSelectedItemId, runeId);
      });
    });

    // Stash tooltips + Withdraw / Deposit
    const tooltipEl = mountEl.querySelector<HTMLElement>('[data-role="item-tooltip"]');
    const attachItemHover = (
      el: HTMLElement,
      item: ItemInstance,
      hint: string,
    ) => {
      const accent = getItemAccentInfo(item);
      el.addEventListener('mouseenter', (ev) => {
        if (!tooltipEl) return;
        tooltipEl.style.setProperty('--tt-border', accent.css);
        tooltipEl.style.setProperty('--tt-glow', `${accent.css}44`);
        tooltipEl.innerHTML = buildRichItemTooltipHtml(
          item,
          ctx,
          ctx.equipped?.[item.slot],
          false,
          hint,
        );
        tooltipEl.classList.remove('is-hidden');
        positionTooltip(tooltipEl, ev.clientX, ev.clientY);
      });
      el.addEventListener('mousemove', (ev) => {
        if (!tooltipEl || tooltipEl.classList.contains('is-hidden')) return;
        positionTooltip(tooltipEl, ev.clientX, ev.clientY);
      });
      el.addEventListener('mouseleave', () => {
        tooltipEl?.classList.add('is-hidden');
      });
    };

    mountEl.querySelectorAll<HTMLElement>('[data-stash-withdraw-id]').forEach((cell) => {
      const id = cell.dataset.stashWithdrawId;
      const item = (ctx.stash ?? []).find((i) => i.id === id);
      if (!id || !item) return;
      attachItemHover(cell, item, 'Nhấn: Rút Về Túi Đồ');
      cell.addEventListener('click', () => {
        tooltipEl?.classList.add('is-hidden');
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onWithdrawStash?.(id);
      });
    });

    mountEl.querySelectorAll<HTMLElement>('[data-stash-deposit-id]').forEach((cell) => {
      const id = cell.dataset.stashDepositId;
      const item = (ctx.inventory ?? []).find((i) => i.id === id);
      if (!id || !item) return;
      attachItemHover(cell, item, 'Nhấn: Cất Vào Kho Chứa Chung');
      cell.addEventListener('click', () => {
        tooltipEl?.classList.add('is-hidden');
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onDepositStash?.(id);
      });
    });

    // Mystery Gambler & Blood Altar
    mountEl.querySelector('[data-gamble-any]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      callbacks?.onGambleItem?.(undefined);
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-gamble-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = btn.dataset.gambleSlot as EquipSlot | undefined;
        if (!slot) return;
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onGambleItem?.(slot);
      });
    });

    mountEl.querySelector('[data-action="invoke-blood-altar"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'shrine_bless' });
      callbacks?.onBloodAltar?.();
    });

    // Companions: Pets & Mercenaries
    mountEl.querySelectorAll<HTMLButtonElement>('[data-select-pet]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const petId = btn.dataset.selectPet as PetId | undefined;
        if (!petId) return;
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onSelectPet?.(petId);
      });
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-select-merc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mercId = btn.dataset.selectMerc as MercenaryId | undefined;
        if (!mercId) return;
        eventBus.emit('sfx:request', { id: 'ui_equip' });
        callbacks?.onSelectMercenary?.(mercId);
      });
    });
  }
}
