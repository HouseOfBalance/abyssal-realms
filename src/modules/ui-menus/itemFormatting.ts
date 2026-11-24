import { MYTHIC_COLOR, RARITY_COLORS } from '../../core/Constants';
import type {
  Attributes,
  DerivedStats,
  ItemInstance,
  MenusRefreshContext,
  RuneDefinition,
  RuneId,
} from '../../contracts/types';
import {
  escapeHtml,
  formatStatValue,
  getStatLabel,
  safeNum,
  SVG_GOLD_COIN,
} from './icons';

export const FALLBACK_RUNE_CATALOG: ReadonlyArray<RuneDefinition> = [
  { id: 'sol', name: 'Sol', tier: 1, colorHex: 0xffd43b, icon: '☀', statBonus: { label: 'Sức Tấn Công', statKey: 'attackPower', value: 8 } },
  { id: 'ist', name: 'Ist', tier: 1, colorHex: 0x69db7c, icon: '✦', statBonus: { label: 'Tỉ Lệ Chí Mạng', statKey: 'critChance', value: 0.03, isPercent: true } },
  { id: 'mal', name: 'Mal', tier: 1, colorHex: 0x74c0fc, icon: '◈', statBonus: { label: 'Giáp', statKey: 'armor', value: 18 } },
  { id: 'gul', name: 'Gul', tier: 1, colorHex: 0x63e6be, icon: '❖', statBonus: { label: 'Tỉ Lệ Né Tránh', statKey: 'dodgeChance', value: 0.03, isPercent: true } },
  { id: 'vex', name: 'Vex', tier: 2, colorHex: 0xff922b, icon: '🔥', statBonus: { label: 'Sức Mạnh Phép', statKey: 'spellPower', value: 12 } },
  { id: 'ohm', name: 'Ohm', tier: 2, colorHex: 0xff6b6b, icon: '⚔', statBonus: { label: 'Sát Thương Chí Mạng', statKey: 'critMultiplier', value: 0.18, isPercent: true } },
  { id: 'lo', name: 'Lo', tier: 2, colorHex: 0xfcc419, icon: '⚡', statBonus: { label: 'Tốc Độ Đánh', statKey: 'attackSpeed', value: 0.07 } },
  { id: 'sur', name: 'Sur', tier: 2, colorHex: 0x4dabf7, icon: '✧', statBonus: { label: 'Mana Tối Đa', statKey: 'maxMana', value: 30 } },
  { id: 'ber', name: 'Ber', tier: 3, colorHex: 0xda77f2, icon: '♛', statBonus: { label: 'Máu Tối Đa', statKey: 'maxHp', value: 65 } },
  { id: 'jah', name: 'Jah', tier: 3, colorHex: 0xff4d6d, icon: '❖', statBonus: { label: 'Hút Máu', statKey: 'lifeSteal', value: 0.04, isPercent: true } },
  { id: 'cham', name: 'Cham', tier: 3, colorHex: 0x99e9f2, icon: '❄', statBonus: { label: 'Giảm Hồi Chiêu', statKey: 'cooldownReduction', value: 0.06, isPercent: true } },
  { id: 'zod', name: 'Zod', tier: 3, colorHex: 0xffe066, icon: 'Ω', statBonus: { label: 'Sức Mạnh Toàn Năng', statKey: 'attackPower', value: 18 } },
];

export function hexToCss(hex: number | undefined, fallback = '#ffd43b'): string {
  if (typeof hex !== 'number' || !Number.isFinite(hex)) return fallback;
  return `#${(hex >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

export function getRuneDefMap(ctx: MenusRefreshContext): Map<RuneId, RuneDefinition> {
  const map = new Map<RuneId, RuneDefinition>();
  for (const r of FALLBACK_RUNE_CATALOG) {
    map.set(r.id, r);
  }
  for (const r of ctx.runeDefinitions ?? []) {
    map.set(r.id, r);
  }
  return map;
}

export function getItemAccentInfo(item: ItemInstance): {
  css: string;
  tierLabel: string;
  slotExtraClass: string;
} {
  if (item.isMythic) {
    return {
      css: MYTHIC_COLOR.css,
      tierLabel: MYTHIC_COLOR.label,
      slotExtraClass: 'is-mythic',
    };
  }
  if (item.setName) {
    return {
      css: '#20c997',
      tierLabel: `Set ${RARITY_COLORS[item.rarity]?.label ?? 'Relic'}`,
      slotExtraClass: 'is-set-item',
    };
  }
  const r = RARITY_COLORS[item.rarity] ?? RARITY_COLORS.common;
  return {
    css: r.css,
    tierLabel: r.label,
    slotExtraClass: '',
  };
}

export function renderItemSocketPipsHtml(
  item: ItemInstance,
  runeMap: Map<RuneId, RuneDefinition>,
): string {
  const totalSockets = Math.max(
    safeNum(item.sockets, 0),
    (item.socketedRunes ?? []).length,
  );
  if (totalSockets <= 0) return '';

  const runes = item.socketedRunes ?? [];
  const pips = Array.from({ length: totalSockets }, (_, i) => {
    const rId = runes[i];
    if (!rId) {
      return `<span class="ar-socket-pip"></span>`;
    }
    const def = runeMap.get(rId);
    const col = hexToCss(def?.colorHex, '#ffd43b');
    return `<span class="ar-socket-pip is-filled" style="--rune-color:${col};"></span>`;
  }).join('');

  return `<div class="ar-item-sockets-row">${pips}</div>`;
}

export function computeAffixComparison(
  candidate: ItemInstance,
  equippedItem: ItemInstance | undefined,
): Array<{
  statKey: keyof (DerivedStats & Attributes);
  diff: number;
  isPercent?: boolean;
}> {
  const map = new Map<
    keyof (DerivedStats & Attributes),
    { cand: number; eq: number; isPercent?: boolean }
  >();

  for (const af of candidate.affixes ?? []) {
    const cur = map.get(af.statKey) ?? { cand: 0, eq: 0, isPercent: af.isPercent };
    cur.cand += safeNum(af.value, 0);
    if (af.isPercent) cur.isPercent = true;
    map.set(af.statKey, cur);
  }

  for (const af of equippedItem?.affixes ?? []) {
    const cur = map.get(af.statKey) ?? { cand: 0, eq: 0, isPercent: af.isPercent };
    cur.eq += safeNum(af.value, 0);
    if (af.isPercent) cur.isPercent = true;
    map.set(af.statKey, cur);
  }

  const out: Array<{
    statKey: keyof (DerivedStats & Attributes);
    diff: number;
    isPercent?: boolean;
  }> = [];
  for (const [statKey, vals] of map.entries()) {
    out.push({
      statKey,
      diff: vals.cand - vals.eq,
      isPercent: vals.isPercent,
    });
  }
  return out;
}

export function buildRichItemTooltipHtml(
  item: ItemInstance,
  ctx: MenusRefreshContext,
  comparedEquipped: ItemInstance | undefined,
  isEquippedSlot: boolean,
  footerHint?: string,
): string {
  const accent = getItemAccentInfo(item);
  const upg = safeNum(item.upgradeLevel, 0);
  const playerLevel = safeNum(ctx.player?.level, 1);
  const reqMet = playerLevel >= safeNum(item.levelReq, 1);
  const runeMap = getRuneDefMap(ctx);

  const mythicBanner = item.isMythic
    ? `<div style="padding:3px 8px;border-radius:3px;background:rgba(255,30,66,0.22);border:1px solid #ff4d6d;color:#ff8fa3;font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">
        ❖ Cổ Vật Thần Thoại Nguyên Thủy (6 Dòng Cường Hóa)
      </div>`
    : '';

  const setHeader = item.setName
    ? `<div style="font-size:11px;font-weight:700;color:#38d9a9;">
        ❖ Bộ Trang Bị: ${escapeHtml(item.setName)}
      </div>`
    : '';

  const runewordHeader = item.runewordName
    ? `<div style="font-family:var(--font-display);font-size:12px;font-weight:700;color:#ffe066;">
        ✦ Từ Khóa Rune: '${escapeHtml(item.runewordName)}'
      </div>`
    : '';

  const affixesHtml = (item.affixes ?? [])
    .map((af) => {
      const valStr = formatStatValue(af.statKey, af.value, af.isPercent);
      const sign = af.value >= 0 ? '+' : '';
      return `<div class="ar-tt-affix"><span style="${item.isMythic ? 'color:#ffb3c1;' : ''}">${sign}${escapeHtml(valStr)} ${escapeHtml(af.label || getStatLabel(af.statKey))}</span></div>`;
    })
    .join('');

  // Sockets & Socketed Runes breakdown
  const totalSockets = Math.max(
    safeNum(item.sockets, 0),
    (item.socketedRunes ?? []).length,
  );
  let socketsHtml = '';
  if (totalSockets > 0) {
    const runes = item.socketedRunes ?? [];
    const rows = Array.from({ length: totalSockets }, (_, i) => {
      const rId = runes[i];
      if (!rId) {
        return `<div style="font-size:11px;color:#8f846e;">○ Rãnh Rune Trống</div>`;
      }
      const def = runeMap.get(rId);
      const rCol = hexToCss(def?.colorHex, '#ffd43b');
      const bonusStr = def
        ? `+${formatStatValue(def.statBonus.statKey, def.statBonus.value, def.statBonus.isPercent)} ${def.statBonus.label || getStatLabel(def.statBonus.statKey)}`
        : '';
      return `<div style="font-size:11.5px;color:${rCol};font-weight:600;">● [${escapeHtml((def?.name ?? rId).toUpperCase())}] <span style="color:#dfd3bc;font-weight:400;">${escapeHtml(bonusStr)}</span></div>`;
    }).join('');
    socketsHtml = `
      <div style="padding:7px 9px;border-radius:4px;background:rgba(12,10,20,0.85);border:1px solid rgba(200,155,60,0.25);display:flex;flex-direction:column;gap:3px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#cbb994;">Rãnh Rune (${runes.length}/${totalSockets})</div>
        ${rows}
      </div>
    `;
  }

  // Runeword mythic power box if formed
  let runewordPowerHtml = '';
  if (item.runewordName) {
    const matchedRecipe = (ctx.runewordRecipes ?? []).find(
      (rw) => rw.id === item.runewordId || rw.name === item.runewordName,
    );
    runewordPowerHtml = `
      <div style="padding:8px 10px;border-radius:4px;background:rgba(255,212,59,0.12);border:1px solid rgba(255,212,59,0.5);color:#ffe89e;font-size:11.5px;line-height:1.4;">
        <strong>✦ Từ Khóa Rune Đã Rèn '${escapeHtml(item.runewordName)}':</strong>
        ${escapeHtml(matchedRecipe?.mythicPower ?? 'Cộng hưởng cổ ngữ cổ đại cường hóa mọi đòn đánh.')}
      </div>
    `;
  }

  // Set bonuses breakdown if item belongs to a Set
  let setBonusHtml = '';
  if (item.setName || item.setId) {
    const setDef =
      (ctx.itemSets ?? []).find((s) => s.id === item.setId || s.name === item.setName) ??
      (ctx.activeSets ?? []).find(
        (as) => as.set.id === item.setId || as.set.name === item.setName,
      )?.set;
    const activeCount =
      (ctx.activeSets ?? []).find(
        (as) => as.set.id === item.setId || as.set.name === item.setName,
      )?.pieces ??
      Object.values(ctx.equipped ?? {}).filter(
        (eq) => eq && (eq.setId === item.setId || (item.setName && eq.setName === item.setName)),
      ).length;

    if (setDef) {
      setBonusHtml = `
        <div style="padding:8px 10px;border-radius:4px;background:rgba(32,201,151,0.1);border:1px solid rgba(32,201,151,0.42);font-size:11px;display:flex;flex-direction:column;gap:4px;">
          <div style="font-weight:700;color:#63e6be;">❖ ${escapeHtml(setDef.name)} (${activeCount}/4 Đã Trang Bị)</div>
          <div style="color:${activeCount >= 2 ? '#69db7c' : '#868e96'};">
            (2) ${escapeHtml(setDef.twoPieceBonus.description)}
          </div>
          <div style="color:${activeCount >= 4 ? '#69db7c' : '#868e96'};">
            (4) ${escapeHtml(setDef.fourPieceBonus.description)} — ${escapeHtml(setDef.fourPieceBonus.specialEffect)}
          </div>
        </div>
      `;
    }
  }

  let compareHtml = '';
  if (!isEquippedSlot) {
    const deltas = computeAffixComparison(item, comparedEquipped);
    const rows = deltas
      .map((d) => {
        if (Math.abs(d.diff) < 0.001) return '';
        const cls = d.diff > 0 ? 'ar-tt-delta-pos' : 'ar-tt-delta-neg';
        const sign = d.diff > 0 ? '+' : '';
        return `<div class="${cls}">${sign}${escapeHtml(formatStatValue(d.statKey, d.diff, d.isPercent))} ${escapeHtml(getStatLabel(d.statKey))}</div>`;
      })
      .filter(Boolean)
      .join('');

    const legNote =
      item.legendaryPower && !comparedEquipped?.legendaryPower
        ? `<div class="ar-tt-delta-pos">✦ Nhận Nội Tại Huyền Thoại</div>`
        : !item.legendaryPower && comparedEquipped?.legendaryPower
          ? `<div class="ar-tt-delta-neg">✦ Thay Thế Nội Tại Huyền Thoại Đang Mặc</div>`
          : '';

    compareHtml = `
      <div class="ar-tt-compare">
        <div class="ar-tt-compare-title">
          ${
            comparedEquipped
              ? `Thay Đổi Chỉ Số So Với ${escapeHtml(comparedEquipped.name)}`
              : 'Ô Trống — Trang Bị Sẽ Nhận:'
          }
        </div>
        ${rows || `<div class="ar-tt-delta-neutral">Chỉ Số Chính Tương Đương</div>`}
        ${legNote}
      </div>
    `;
  }

  return `
    ${mythicBanner}
    <div class="ar-tt-header">
      ${setHeader}
      ${runewordHeader}
      <div class="ar-tt-name" style="color:${accent.css};">
        ${escapeHtml(item.name)} ${upg > 0 ? `<span style="color:#ffd97d;">+${upg}</span>` : ''}
      </div>
      <div class="ar-tt-sub">
        <span style="color:${accent.css};font-weight:600;">${escapeHtml(accent.tierLabel)} ${escapeHtml(item.slot.toUpperCase())}</span>
        <span>Cấp Vật Phẩm ${safeNum(item.itemLevel, 1)}</span>
      </div>
      <div class="ar-tt-sub">
        <span style="${reqMet ? '' : 'color:#ff6b6b;font-weight:700;'}">Yêu Cầu Cấp ${safeNum(item.levelReq, 1)}</span>
        <span>Cường Hóa +${upg}/10</span>
      </div>
    </div>

    <div class="ar-tt-affixes">
      ${affixesHtml || `<div style="font-size:11.5px;color:#867c68;">Rèn Luyện Tiêu Chuẩn</div>`}
    </div>

    ${socketsHtml}
    ${runewordPowerHtml}

    ${
      item.legendaryPower
        ? `<div class="ar-tt-legendary">
            <strong>✦ Nội Tại Huyền Thoại:</strong> ${escapeHtml(item.legendaryPower.description)}
          </div>`
        : ''
    }

    ${setBonusHtml}
    ${compareHtml}

    <div class="ar-tt-footer">
      <span style="display:inline-flex;align-items:center;gap:4px;color:#ffd97d;">
        ${SVG_GOLD_COIN} Giá Trị: ${safeNum(item.goldValue, 0)}g
      </span>
      <span>${escapeHtml(footerHint ?? (isEquippedSlot ? 'Click Phải: Tháo Ra' : 'Click Đôi/Phải: Trang Bị'))}</span>
    </div>
  `;
}
