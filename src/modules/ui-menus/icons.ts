import type {
  Attributes,
  DerivedStats,
  EquipSlot,
  HeroClassId,
  ItemInstance,
  ItemRarity,
  WeaponVisualType,
} from '../../contracts/types';

export function escapeHtml(str: string | number | undefined | null): string {
  const s = String(str ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeNum(val: number | undefined | null, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

const STAT_META: Record<
  keyof (DerivedStats & Attributes),
  { label: string; isPercent?: boolean; decimals?: number; suffix?: string }
> = {
  strength: { label: 'Sức Mạnh' },
  dexterity: { label: 'Nhanh Nhẹn' },
  intelligence: { label: 'Trí Tuệ' },
  vitality: { label: 'Sinh Lực' },
  maxHp: { label: 'Máu Tối Đa' },
  hpRegen: { label: 'Hồi Phục Máu', decimals: 1, suffix: '/s' },
  maxMana: { label: 'Mana Tối Đa' },
  manaRegen: { label: 'Hồi Phục Mana', decimals: 1, suffix: '/s' },
  maxStamina: { label: 'Thể Lực Tối Đa' },
  staminaRegen: { label: 'Hồi Phục Thể Lực', decimals: 1, suffix: '/s' },
  moveSpeed: { label: 'Tốc Độ Di Chuyển', decimals: 1 },
  attackPower: { label: 'Sức Tấn Công' },
  spellPower: { label: 'Sức Mạnh Phép' },
  armor: { label: 'Giáp' },
  critChance: { label: 'Tỉ Lệ Chí Mạng', isPercent: true, decimals: 1 },
  critMultiplier: { label: 'Sát Thương Chí Mạng', isPercent: true, decimals: 0 },
  attackSpeed: { label: 'Tốc Độ Đánh', decimals: 2, suffix: 'x' },
  cooldownReduction: { label: 'Giảm Hồi Chiêu', isPercent: true, decimals: 1 },
  lifeSteal: { label: 'Hút Máu', isPercent: true, decimals: 1 },
  dodgeChance: { label: 'Tỉ Lệ Né Tránh', isPercent: true, decimals: 1 },
};

export function getStatLabel(key: keyof (DerivedStats & Attributes)): string {
  return STAT_META[key]?.label ?? String(key);
}

export function formatStatValue(
  key: keyof (DerivedStats & Attributes),
  rawValue: number,
  explicitPercent?: boolean,
): string {
  const meta = STAT_META[key];
  const val = safeNum(rawValue, 0);
  const usePct = explicitPercent ?? meta?.isPercent ?? false;
  if (usePct) {
    // Handle both fractional (0.12 -> 12%) and already-percentage (12 -> 12%) conventions gracefully
    const pctVal = Math.abs(val) <= 2.5 && key !== 'critMultiplier'
      ? val * 100
      : key === 'critMultiplier' && Math.abs(val) <= 5
        ? val * 100
        : val;
    const dec = meta?.decimals ?? (Math.abs(pctVal % 1) > 0.05 ? 1 : 0);
    return `${pctVal.toFixed(dec)}%`;
  }
  const dec = meta?.decimals ?? (Math.abs(val % 1) > 0.05 ? 1 : 0);
  return `${val.toFixed(dec)}${meta?.suffix ?? ''}`;
}

const RARITY_UPGRADE_FACTOR: Record<ItemRarity, number> = {
  common: 1.0,
  uncommon: 1.3,
  rare: 1.7,
  epic: 2.2,
  legendary: 3.0,
};

export function estimateUpgradeCost(item: ItemInstance): number {
  const factor = RARITY_UPGRADE_FACTOR[item.rarity] ?? 1.0;
  const lvl = Math.max(0, Math.min(10, safeNum(item.upgradeLevel, 0)));
  const stepMult = Math.pow(1.35, lvl);
  return Math.max(15, Math.round((25 + safeNum(item.itemLevel, 1) * 10) * factor * stepMult));
}

export function estimateSalvageGold(item: ItemInstance): number {
  return Math.max(5, Math.round(safeNum(item.goldValue, 20) * 0.45));
}

export const SVG_SHATTERED_CROWN = `
<svg viewBox="0 0 96 72" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="arCrownGold" x1="0" y1="6" x2="0" y2="66" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFF4D2"/>
      <stop offset="50%" stop-color="#E5B352"/>
      <stop offset="100%" stop-color="#7D5214"/>
    </linearGradient>
    <linearGradient id="arVoidGem" x1="0" y1="20" x2="0" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FF6B6B"/>
      <stop offset="100%" stop-color="#9C192B"/>
    </linearGradient>
  </defs>
  <path d="M48 6L55 24L48 31L41 24L48 6Z" fill="url(#arCrownGold)" stroke="#FFE7A8" stroke-width="1.2"/>
  <path d="M14 22L29 37L37 21L44 43L20 52L14 22Z" fill="url(#arCrownGold)" stroke="#FFE7A8" stroke-width="1.3"/>
  <path d="M82 22L67 37L59 21L52 43L76 52L82 22Z" fill="url(#arCrownGold)" stroke="#FFE7A8" stroke-width="1.3"/>
  <path d="M22 55H74L70 64H26L22 55Z" fill="url(#arCrownGold)" stroke="#FFE7A8" stroke-width="1.3"/>
  <polygon points="48,34 53,43 48,51 43,43" fill="url(#arVoidGem)" stroke="#FFD8D8" stroke-width="1"/>
  <circle cx="27" cy="44" r="2.6" fill="#4DABF7"/>
  <circle cx="69" cy="44" r="2.6" fill="#DA77F2"/>
</svg>`;

export function getHeroClassSvg(heroClass: HeroClassId): string {
  switch (heroClass) {
    case 'vanguard':
      return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none">
        <path d="M24 5L39 11V23C39 33.2 32.4 40.5 24 44C15.6 40.5 9 33.2 9 23V11L24 5Z" fill="rgba(201,42,42,0.28)" stroke="#FF8787" stroke-width="2"/>
        <path d="M24 9V38M16 19H32" stroke="#FFD97D" stroke-width="2.4" stroke-linecap="round"/>
      </svg>`;
    case 'shadowblade':
      return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none">
        <path d="M11 37L36 10L39 13L16 39L11 37Z" fill="rgba(47,158,68,0.35)" stroke="#69DB7C" stroke-width="1.8"/>
        <path d="M37 37L12 10L9 13L32 39L37 37Z" fill="rgba(47,158,68,0.35)" stroke="#69DB7C" stroke-width="1.8"/>
        <circle cx="24" cy="24" r="4" fill="#B2F2BB"/>
      </svg>`;
    case 'arcanist':
      return `<svg viewBox="0 0 48 48" width="34" height="34" fill="none">
        <circle cx="24" cy="18" r="9" fill="rgba(51,154,240,0.26)" stroke="#74C0FC" stroke-width="1.8"/>
        <polygon points="24,11 28,18 24,25 20,18" fill="#D0BFFF"/>
        <path d="M24 27V43M18 32L24 27L30 32" stroke="#FFD97D" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
  }
}

export function getHeroPaperDollSilhouette(heroClass: HeroClassId): string {
  const tint =
    heroClass === 'vanguard'
      ? '#c92a2a'
      : heroClass === 'shadowblade'
        ? '#2f9e44'
        : '#339af0';
  return `<svg viewBox="0 0 140 260" width="132" height="242" fill="none">
    <defs>
      <radialGradient id="arAura" cx="50%" cy="40%" r="50%">
        <stop offset="0%" stop-color="${tint}" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="${tint}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="70" cy="122" rx="58" ry="96" fill="url(#arAura)"/>
    <circle cx="70" cy="36" r="16" stroke="#C89B3C" stroke-opacity="0.6" stroke-width="1.6" fill="rgba(22,18,32,0.8)"/>
    <path d="M44 64L70 54L96 64L90 132H50L44 64Z" stroke="#C89B3C" stroke-opacity="0.55" stroke-width="1.6" fill="rgba(22,18,32,0.75)"/>
    <path d="M44 66L26 124L36 128L50 82" stroke="#C89B3C" stroke-opacity="0.42" stroke-width="1.5"/>
    <path d="M96 66L114 124L104 128L90 82" stroke="#C89B3C" stroke-opacity="0.42" stroke-width="1.5"/>
    <path d="M53 132L46 226H62L70 156L78 226H94L87 132" stroke="#C89B3C" stroke-opacity="0.48" stroke-width="1.6" fill="rgba(18,15,28,0.65)"/>
    <circle cx="70" cy="86" r="7" fill="${tint}" fill-opacity="0.7"/>
  </svg>`;
}

export function getWeaponVisualSvg(weapon: WeaponVisualType, color = '#f3e6c8'): string {
  switch (weapon) {
    case 'greatsword':
      return `<svg viewBox="0 0 36 36" width="30" height="30" fill="none">
        <path d="M29 5L31 7L14 24L11 23L12 20L29 5Z" fill="${color}" stroke="#fff" stroke-width="0.8"/>
        <path d="M9 19L17 27M11 25L6 30" stroke="#e6b956" stroke-width="2.4" stroke-linecap="round"/>
      </svg>`;
    case 'daggers':
      return `<svg viewBox="0 0 36 36" width="30" height="30" fill="none">
        <path d="M8 27L24 8L26 10L11 29L8 27Z" fill="${color}"/>
        <path d="M28 27L12 8L10 10L25 29L28 27Z" fill="${color}" opacity="0.85"/>
      </svg>`;
    case 'staff':
      return `<svg viewBox="0 0 36 36" width="30" height="30" fill="none">
        <line x1="8" y1="29" x2="25" y2="12" stroke="#d9a84e" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="26.5" cy="10.5" r="4.5" fill="${color}" stroke="#fff" stroke-width="1"/>
      </svg>`;
    case 'warhammer':
      return `<svg viewBox="0 0 36 36" width="30" height="30" fill="none">
        <line x1="8" y1="28" x2="24" y2="12" stroke="#c89b3c" stroke-width="2.6" stroke-linecap="round"/>
        <rect x="18" y="6" width="12" height="8" rx="1.5" transform="rotate(45 24 10)" fill="${color}"/>
      </svg>`;
    case 'sword_shield':
      return `<svg viewBox="0 0 36 36" width="30" height="30" fill="none">
        <path d="M18 6L28 10V18C28 24.5 23.6 28.8 18 31C12.4 28.8 8 24.5 8 18V10L18 6Z" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.8"/>
        <path d="M18 10V26M13 16H23" stroke="#ffd97d" stroke-width="2"/>
      </svg>`;
  }
}

export function getSlotSvg(slot: EquipSlot, color = '#d8cab0'): string {
  switch (slot) {
    case 'weapon':
      return getWeaponVisualSvg('greatsword', color);
    case 'offhand':
      return `<svg viewBox="0 0 36 36" width="28" height="28" fill="none">
        <path d="M18 5L29 9.5V18.5C29 25.4 24.2 29.8 18 32C11.8 29.8 7 25.4 7 18.5V9.5L18 5Z" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="1.9"/>
        <circle cx="18" cy="17.5" r="3.5" fill="${color}"/>
      </svg>`;
    case 'helmet':
      return `<svg viewBox="0 0 36 36" width="28" height="28" fill="none">
        <path d="M9 21C9 12.5 13 8 18 8C23 8 27 12.5 27 21V28L22 26V20H14V26L9 28V21Z" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.8"/>
        <path d="M18 8V18" stroke="#ffd97d" stroke-width="1.6"/>
      </svg>`;
    case 'chest':
      return `<svg viewBox="0 0 36 36" width="28" height="28" fill="none">
        <path d="M11 8L18 11L25 8L30 13L27 18L26 29H10L9 18L6 13L11 8Z" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.8"/>
      </svg>`;
    case 'gloves':
      return `<svg viewBox="0 0 36 36" width="28" height="28" fill="none">
        <path d="M12 15V9H15V14M15 14V8H18V14M18 14V9H21V15M21 15L24 13L25 22L22 28H12L10 21V15H12Z" fill="${color}" fill-opacity="0.24" stroke="${color}" stroke-width="1.7"/>
      </svg>`;
    case 'boots':
      return `<svg viewBox="0 0 36 36" width="28" height="28" fill="none">
        <path d="M13 8H21V21L28 25V29H11V22L13 19V8Z" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.8"/>
      </svg>`;
    case 'ring':
      return `<svg viewBox="0 0 36 36" width="28" height="28" fill="none">
        <circle cx="18" cy="20" r="8" stroke="${color}" stroke-width="2.4"/>
        <polygon points="18,7 22,11 18,14 14,11" fill="#74c0fc" stroke="#fff" stroke-width="0.8"/>
      </svg>`;
    case 'amulet':
      return `<svg viewBox="0 0 36 36" width="28" height="28" fill="none">
        <path d="M11 8C11 15 14 19 18 20C22 19 25 15 25 8" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/>
        <polygon points="18,18 23,24 18,30 13,24" fill="${color}" stroke="#fff" stroke-width="0.9"/>
      </svg>`;
  }
}

export function getItemSvg(item: ItemInstance, rarityCss: string): string {
  if (item.weaponVisual) {
    return getWeaponVisualSvg(item.weaponVisual, rarityCss);
  }
  return getSlotSvg(item.slot, rarityCss);
}

export const SVG_GOLD_COIN = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none">
  <circle cx="10" cy="10" r="8" fill="#FFD43B" stroke="#F08C00" stroke-width="1.5"/>
  <circle cx="10" cy="10" r="4.5" stroke="#FFF3BF" stroke-width="1"/>
</svg>`;

export const SVG_ANVIL = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none">
  <path d="M4 8H18L21 11L17 13H14L15 18H18V20H6V18H9L10 13H7L4 8Z" fill="#FFB56B" stroke="#FFE8CC" stroke-width="1.1"/>
</svg>`;

export const SVG_SKULL = `<svg viewBox="0 0 64 64" width="62" height="62" fill="none">
  <path d="M32 8C19 8 11 17 11 29C11 36.5 14.5 42 19 45V53H26V48H30V53H34V48H38V53H45V45C49.5 42 53 36.5 53 29C53 17 45 8 32 8Z" fill="rgba(201,42,42,0.24)" stroke="#FF6B6B" stroke-width="2.2"/>
  <circle cx="24" cy="29" r="5" fill="#FF6B6B"/>
  <circle cx="40" cy="29" r="5" fill="#FF6B6B"/>
  <path d="M29 38L32 33L35 38H29Z" fill="#FFA8A8"/>
</svg>`;

export const SVG_TROPHY = `<svg viewBox="0 0 32 32" width="28" height="28" fill="none">
  <path d="M9 6H23V14C23 18.2 19.8 21 16 21C12.2 21 9 18.2 9 14V6Z" fill="rgba(245,196,82,0.32)" stroke="#FFD97D" stroke-width="1.8"/>
  <path d="M9 9H5C5 13 7 15 9 15M23 9H27C27 13 25 15 23 15" stroke="#E0B04F" stroke-width="1.6"/>
  <path d="M16 21V26M11 26H21" stroke="#FFD97D" stroke-width="2" stroke-linecap="round"/>
</svg>`;
