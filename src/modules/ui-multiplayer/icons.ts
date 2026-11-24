import type { HeroClassId, TacticalPingType } from '../../contracts/types';

export function renderCoopGlobeSvg(): string {
  return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" />
    <ellipse cx="12" cy="12" rx="4.4" ry="9.2" />
    <path d="M3.2 9h17.6M3.2 15h17.6" />
  </svg>`;
}

export function renderCrownSvg(): string {
  return `<svg viewBox="0 0 24 24" class="mp-svg" fill="currentColor" aria-hidden="true">
    <path d="M3 18h18l-1.8-9.5-4.7 3.8L12 5.5 9.5 12.3 4.8 8.5 3 18zm0 2h18v1.8H3V20z" />
  </svg>`;
}

export function renderClassEmblemSvg(heroClass: HeroClassId): string {
  if (heroClass === 'vanguard') {
    return `<svg viewBox="0 0 28 28" class="mp-svg" fill="none" aria-hidden="true">
      <path d="M14 2.5L23.5 6v7.4c0 6.1-4.1 10.6-9.5 12.6-5.4-2-9.5-6.5-9.5-12.6V6L14 2.5z" fill="rgba(201,42,42,0.28)" stroke="#ff8787" stroke-width="1.7"/>
      <path d="M14 6.5v14M10.2 10.5h7.6" stroke="#ffd8a8" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }
  if (heroClass === 'shadowblade') {
    return `<svg viewBox="0 0 28 28" class="mp-svg" fill="none" aria-hidden="true">
      <path d="M6 22L21.5 6.5M9.5 6.5L22 19" stroke="#69db7c" stroke-width="2.1" stroke-linecap="round"/>
      <path d="M14 3.5l3.2 4.8-3.2 3.2-3.2-3.2L14 3.5z" fill="rgba(47,158,68,0.38)" stroke="#b2f2bb" stroke-width="1.4"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 28 28" class="mp-svg" fill="none" aria-hidden="true">
    <circle cx="14" cy="14" r="9.5" fill="rgba(51,154,240,0.22)" stroke="#74c0fc" stroke-width="1.6"/>
    <polygon points="14,5 17.5,12.5 23,14 17.5,15.5 14,23 10.5,15.5 5,14 10.5,12.5" fill="rgba(156,54,181,0.35)" stroke="#d0bfff" stroke-width="1.4"/>
  </svg>`;
}

export function renderMicSvg(muted: boolean): string {
  if (muted) {
    return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 11.4 4.2M12 17.5V21M8.5 21h7M3.5 3.5l17 17" />
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </svg>`;
}

export function renderHeadphonesSvg(deafened: boolean): string {
  if (deafened) {
    return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
      <path d="M4 13v-1a8 8 0 0 1 14.3-4.9M20 12v1" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M3.5 3.5l17 17" />
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
    <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
    <rect x="3" y="13" width="4" height="6" rx="1.5" />
    <rect x="17" y="13" width="4" height="6" rx="1.5" />
  </svg>`;
}

export function renderSpatialRadarSvg(): string {
  return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15" />
  </svg>`;
}

export function renderTwinBladesSvg(): string {
  return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M4 20L19.5 4.5M15 4h5v5M20 20L4.5 4.5M9 4H4v5" />
  </svg>`;
}

export function renderPingIconSvg(pingType: TacticalPingType): string {
  switch (pingType) {
    case 'attack':
      return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M4 20L20 4M14 4h6v6M6 14l4 4" />
      </svg>`;
    case 'loot':
      return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
        <polygon points="12,3 20,9 16,20 8,20 4,9" />
        <path d="M4 9h16M12 3l-4 6 4 11 4-11-4-6z" />
      </svg>`;
    case 'danger':
      return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
        <polygon points="12,3 22,20 2,20" />
        <path d="M12 9v5M12 17.2h.01" stroke-linecap="round" />
      </svg>`;
    case 'group':
      return `<svg viewBox="0 0 24 24" class="mp-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3l8 3.5v5.5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6.5L12 3z" />
        <path d="M12 8v8M8 12h8" stroke-linecap="round" />
      </svg>`;
  }
}
