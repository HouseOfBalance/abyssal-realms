import type {
  DamageType,
  InteractableType,
  SkillDefinition,
  SkillSlotIndex,
  StatusEffectType,
} from '../../contracts/types';
import { DAMAGE_TYPE_COLORS } from '../../core/Constants';

export function renderSkillSvg(skill: SkillDefinition, slotIndex: SkillSlotIndex): string {
  const rawIcon = (skill.icon ?? '').trim();
  if (rawIcon.startsWith('<svg')) {
    return rawIcon;
  }

  const accent = DAMAGE_TYPE_COLORS[skill.damageType]?.css ?? '#f1e9d2';
  const secondary = getSecondaryTone(skill.damageType);
  const key = `${rawIcon} ${skill.id} ${skill.name}`.toLowerCase();

  if (key.includes('whirlwind') || key.includes('tempest') || key.includes('spin') || key.includes('cyclone')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <defs>
        <linearGradient id="sk-ww-${slotIndex}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="55%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="${secondary}"/>
        </linearGradient>
      </defs>
      <path d="M9 24c0-8.5 7-15 16-15 6.2 0 11.4 3.1 14 8-3.5-2.6-8-3.8-12.8-3.2-6.8.8-11.7 5.2-11.7 10.2 0 4.2 3.4 7.6 8.5 8.4-7.8 1.4-14-3.1-14-8.4z" fill="url(#sk-ww-${slotIndex})"/>
      <path d="M39 24c0 8.5-7 15-16 15-6.2 0-11.4-3.1-14-8 3.5 2.6 8 3.8 12.8 3.2 6.8-.8 11.7-5.2 11.7-10.2 0-4.2-3.4-7.6-8.5-8.4 7.8-1.4 14 3.1 14 8.4z" fill="${accent}" opacity="0.88"/>
      <circle cx="24" cy="24" r="3.8" fill="#fff8e7"/>
    </svg>`;
  }

  if (key.includes('charge') || key.includes('juggernaut') || key.includes('rush')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <polygon points="41,24 22,10 26,19 8,19 13,24 8,29 26,29 22,38" fill="${accent}" stroke="#fff3bf" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M5 14h11M5 34h11" stroke="#c89b3c" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  }

  if (key.includes('leap') || key.includes('slam') || key.includes('seismic') || key.includes('shatter') || key.includes('hammer') || key.includes('crush')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M13 13l10-5 12 8-7 9-15-12z" fill="${accent}" stroke="#fff3d6" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M23 18l-8 15" stroke="#d8c39e" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M7 37l8-3 5 4 5-5 6 4 10-3" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="24" cy="35" r="3" fill="#fff3bf"/>
    </svg>`;
  }

  if (key.includes('meteor') || key.includes('cataclysm') || key.includes('comet') || key.includes('inferno')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M38 8L22 20l4 2-10 9 9-4 2 4L40 14z" fill="${secondary}" opacity="0.75"/>
      <path d="M34 10L18 24l10 6L41 14z" fill="${accent}"/>
      <circle cx="16" cy="32" r="8.5" fill="${accent}" stroke="#fff4cc" stroke-width="1.6"/>
      <circle cx="14.5" cy="30.5" r="4" fill="#fff9db"/>
    </svg>`;
  }

  if (key.includes('lightning') || key.includes('chain') || key.includes('thunder') || key.includes('shock') || key.includes('storm') || key.includes('zap')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <polygon points="27,5 12,25 23,25 18,43 36,20 25,20" fill="${accent}" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>
      <polyline points="8,15 14,18 10,23" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round"/>
      <polyline points="39,28 34,32 38,37" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
  }

  if (key.includes('lance') || key.includes('spear') || key.includes('icicle')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <polygon points="39,9 23,19 29,25" fill="#ffffff"/>
      <polygon points="39,9 14,34 19,39 41,13" fill="${accent}" stroke="#e7f5ff" stroke-width="1.2"/>
      <polygon points="30,7 13,22 17,26" fill="${accent}" opacity="0.85"/>
      <polygon points="41,18 26,35 22,31" fill="${accent}" opacity="0.85"/>
    </svg>`;
  }

  if (key.includes('frost') || key.includes('ice') || key.includes('blizzard') || key.includes('glacial') || key.includes('chill') || key.includes('freeze')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <polygon points="24,6 29,18 42,24 29,30 24,42 19,30 6,24 19,18" fill="${accent}" opacity="0.85" stroke="#e7f5ff" stroke-width="1.3"/>
      <polygon points="24,13 27,21 35,24 27,27 24,35 21,27 13,24 21,21" fill="#ffffff"/>
    </svg>`;
  }

  if (key.includes('venom') || key.includes('poison') || key.includes('toxin') || key.includes('plague') || key.includes('blight')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M24 8c6 8 12 13.5 12 20.5a12 12 0 0 1-24 0C12 21.5 18 16 24 8z" fill="${accent}" opacity="0.9" stroke="#d3f9d8" stroke-width="1.4"/>
      <circle cx="20" cy="28" r="2.4" fill="#081c11"/>
      <circle cx="28" cy="28" r="2.4" fill="#081c11"/>
      <path d="M21 34h6" stroke="#081c11" stroke-width="2" stroke-linecap="round"/>
      <circle cx="15" cy="14" r="2" fill="${accent}"/>
      <circle cx="34" cy="16" r="1.6" fill="${accent}"/>
    </svg>`;
  }

  if (key.includes('barrage') || key.includes('fan') || key.includes('knives') || key.includes('volley') || key.includes('multishot')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M24 7l3.5 13h-7L24 7zm-13 5l9.5 9.5-5 4.5L11 12zm26 0l-4.5 14-5-4.5L37 12z" fill="${accent}" stroke="#f8f9fa" stroke-width="1.1"/>
      <circle cx="24" cy="36" r="4" fill="#fff3bf" stroke="${accent}" stroke-width="2"/>
      <path d="M24 22v11M18 26l5 8M30 26l-5 8" stroke="#dee2e6" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
  }

  if (key.includes('shadow') || key.includes('dash') || key.includes('step') || key.includes('blink') || key.includes('teleport') || key.includes('phantom') || key.includes('veil')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M10 34c6-2 11-7 15-16l5 3c-3 8-8 14-16 17l-4-4z" fill="${secondary}" opacity="0.75"/>
      <path d="M18 12l19-4-5 19-4.5-4.5L13 36l-3-3 14.5-14.5L18 12z" fill="${accent}" stroke="#f8f0fc" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
  }

  if (key.includes('lacerate') || key.includes('riposte') || key.includes('rend_cross')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M9 11c11 6 20 15 30 26M15 8c9 6 17 14 25 23M7 18c9 6 17 14 24 22" stroke="${accent}" stroke-width="3.2" stroke-linecap="round" fill="none"/>
      <path d="M39 11C28 17 19 26 9 37" stroke="#fff0f6" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    </svg>`;
  }

  if (key.includes('dagger') || key.includes('twin') || key.includes('backstab') || key.includes('assassinate') || key.includes('fang')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M11 37L33 9l4 4-22 28-4-4z" fill="${accent}" stroke="#ffffff" stroke-width="1.1"/>
      <path d="M37 37L15 9l-4 4 22 28 4-4z" fill="#e9ecef" opacity="0.9" stroke="${accent}" stroke-width="1.1"/>
      <circle cx="24" cy="24" r="3.2" fill="#ffd43b"/>
    </svg>`;
  }

  if (key.includes('shield') || key.includes('bastion') || key.includes('bulwark') || key.includes('aegis') || key.includes('guard') || key.includes('ward') || key.includes('barrier')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M24 6l15 6v11c0 10.5-6.4 17.4-15 20-8.6-2.6-15-9.5-15-20V12l15-6z" fill="${secondary}" stroke="${accent}" stroke-width="2.2"/>
      <path d="M24 11l10 4v8c0 7.2-4.2 12.2-10 14.4-5.8-2.2-10-7.2-10-14.4v-8l10-4z" fill="${accent}" opacity="0.82"/>
      <path d="M24 15v16M17 22h14" stroke="#fff9db" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  }

  if (key.includes('cry') || key.includes('roar') || key.includes('rage') || key.includes('wrath') || key.includes('frenzy') || key.includes('blood')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <circle cx="24" cy="24" r="10" fill="${accent}" opacity="0.9"/>
      <circle cx="24" cy="24" r="15" fill="none" stroke="${accent}" stroke-width="2.2" stroke-dasharray="6 4"/>
      <path d="M24 9v6M24 33v6M9 24h6M33 24h6M13.5 13.5l4.2 4.2M30.3 30.3l4.2 4.2M34.5 13.5l-4.2 4.2M17.7 30.3l-4.2 4.2" stroke="#fff3bf" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  if (key.includes('fireball') || key.includes('pyro') || key.includes('flame') || key.includes('ember') || key.includes('burn')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M26 6c2 7-4 10-3 16 3-2 6-6 6-10 6 5 9 11 9 17a14 14 0 1 1-28 0c0-7 5-13 10-17-1 4 1 7 4 8-1-6 0-11 2-14z" fill="${accent}" stroke="#fff3bf" stroke-width="1.2"/>
      <path d="M24 23c2 3 5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 3-6 5-9z" fill="#fff9db"/>
    </svg>`;
  }

  if (key.includes('aether') || key.includes('rift')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M24 5c7 6 11 12 11 19s-4 13-11 19c-7-6-11-12-11-19S17 11 24 5z" fill="${secondary}" stroke="${accent}" stroke-width="2"/>
      <polygon points="26,11 18,24 24,24 21,37 31,22 25,22" fill="#fff9db"/>
    </svg>`;
  }

  if (key.includes('reflex') || key.includes('haste')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <path d="M10 18h20l-4-5 13 7-13 7 4-5H10z" fill="${accent}"/>
      <path d="M14 31h18l-3-4 10 5.5L29 38l3-4H14z" fill="#e599f7" opacity="0.9"/>
    </svg>`;
  }

  if (key.includes('void') || key.includes('astral') || key.includes('nova') || key.includes('singularity') || key.includes('arcane') || key.includes('orb')) {
    return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
      <ellipse cx="24" cy="24" rx="17" ry="7" transform="rotate(-30 24 24)" fill="none" stroke="${accent}" stroke-width="2"/>
      <ellipse cx="24" cy="24" rx="17" ry="7" transform="rotate(30 24 24)" fill="none" stroke="#f3d9fa" stroke-width="1.5"/>
      <circle cx="24" cy="24" r="7.5" fill="${secondary}" stroke="${accent}" stroke-width="2"/>
      <circle cx="24" cy="24" r="3.2" fill="#ffffff"/>
    </svg>`;
  }

  // Fallback by targeting mode
  switch (skill.targeting) {
    case 'projectile':
      return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
        <path d="M39 9L16 24l8 2 2 8L39 9z" fill="${accent}" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M9 39l11-11M7 33l8-8M15 41l8-8" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    case 'aoe_self':
    case 'aoe_cursor':
      return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
        <circle cx="24" cy="24" r="15" fill="none" stroke="${accent}" stroke-width="2.4"/>
        <polygon points="24,10 28,20 38,24 28,28 24,38 20,28 10,24 20,20" fill="${accent}" stroke="#fff9db" stroke-width="1.1"/>
      </svg>`;
    case 'dash':
      return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
        <path d="M8 30h18l-4 6 18-12L22 12l4 6H12z" fill="${accent}" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>`;
    case 'buff':
      return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
        <path d="M24 8l12 12h-7v18H19V20h-7L24 8z" fill="${accent}" stroke="#fff3bf" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>`;
    case 'melee_arc':
    default:
      return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
        <path d="M37 9c3 9 0 20-9 27-7 5-15 5-20 2 7-1 14-5 19-12 5-6 7-12 6-18l4 1z" fill="${accent}" opacity="0.88"/>
        <path d="M12 36L35 13" stroke="#fff8e7" stroke-width="3" stroke-linecap="round"/>
        <path d="M10 30l8 8M9 39l5-5" stroke="#c89b3c" stroke-width="2.6" stroke-linecap="round"/>
      </svg>`;
  }
}

function getSecondaryTone(damageType: DamageType): string {
  switch (damageType) {
    case 'fire':
      return '#b51717';
    case 'ice':
      return '#1864ab';
    case 'lightning':
      return '#e67700';
    case 'poison':
      return '#2b8a3e';
    case 'void':
      return '#5f3dc4';
    case 'physical':
    default:
      return '#862e2e';
  }
}

export function renderPotionSvg(): string {
  return `<svg viewBox="0 0 48 48" class="ar-svg-icon" aria-hidden="true">
    <path d="M20 7h8v5l-2 3v4l9 10a9 9 0 0 1-6.8 14.9H19.8A9 9 0 0 1 13 29l9-10v-4l-2-3V7z" fill="#2a1018" stroke="#d8b068" stroke-width="2" stroke-linejoin="round"/>
    <path d="M15.5 29.5c3-1.5 6 1.5 9 0s5-1.5 8 0c2 3.8.5 11.5-5.2 11.5h-6.6c-5.7 0-7.2-7.7-5.2-11.5z" fill="#e03131"/>
    <path d="M18 33c1.5 3.5 3.5 5.5 6.5 6" stroke="#ffc9c9" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    <rect x="19" y="5" width="10" height="3.5" rx="1" fill="#c89b3c"/>
  </svg>`;
}

export function renderGoldCoinSvg(): string {
  return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" fill="#e8a838" stroke="#fff3bf" stroke-width="1.3"/>
    <circle cx="12" cy="12" r="6.5" fill="none" stroke="#7c4d12" stroke-width="1.2"/>
    <polygon points="12,7.5 14.2,12 12,16.5 9.8,12" fill="#fff9db"/>
  </svg>`;
}

export function renderMenuButtonSvg(panel: 'inventory' | 'skills' | 'quests' | 'settings'): string {
  switch (panel) {
    case 'inventory':
      return `<svg viewBox="0 0 28 28" class="ar-svg-icon" aria-hidden="true">
        <path d="M9 8V6.5a5 5 0 0 1 10 0V8h3.5a1.5 1.5 0 0 1 1.5 1.5v12A2.5 2.5 0 0 1 21.5 24h-15A2.5 2.5 0 0 1 4 21.5v-12A1.5 1.5 0 0 1 5.5 8H9zm2 0h6V6.5a3 3 0 0 0-6 0V8z" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <polygon points="14,12 17,16 14,20 11,16" fill="currentColor"/>
      </svg>`;
    case 'skills':
      return `<svg viewBox="0 0 28 28" class="ar-svg-icon" aria-hidden="true">
        <polygon points="14,3 17,10.8 25,14 17,17.2 14,25 11,17.2 3,14 11,10.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="14" cy="14" r="3" fill="currentColor"/>
      </svg>`;
    case 'quests':
      return `<svg viewBox="0 0 28 28" class="ar-svg-icon" aria-hidden="true">
        <path d="M6 5.5A2.5 2.5 0 0 1 8.5 3H22v19H8.5A2.5 2.5 0 0 0 6 24.5v-19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M6 22.5A2.5 2.5 0 0 1 8.5 20H22v5H8.5A2.5 2.5 0 0 1 6 22.5z" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M10.5 8.5h7.5M10.5 12.5h7.5M10.5 16.5h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`;
    case 'settings':
      return `<svg viewBox="0 0 28 28" class="ar-svg-icon" aria-hidden="true">
        <circle cx="14" cy="14" r="4.2" fill="none" stroke="currentColor" stroke-width="1.9"/>
        <path d="M14 3.5v3M14 21.5v3M3.5 14h3M21.5 14h3M6.6 6.6l2.1 2.1M19.3 19.3l2.1 2.1M21.4 6.6l-2.1 2.1M8.7 19.3l-2.1 2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
  }
}

export function renderBossSkullSvg(): string {
  return `<svg viewBox="0 0 36 36" class="ar-svg-icon" aria-hidden="true">
    <path d="M8 11l5 4 5-7 5 7 5-4-2 8H10L8 11z" fill="#c89b3c"/>
    <path d="M10 19a8 8 0 0 1 16 0c0 3.6-1.8 6-3.5 7.2V30h-9v-3.8C11.8 25 10 22.6 10 19z" fill="#f1e9d2" stroke="#4a151b" stroke-width="1.4"/>
    <circle cx="14.8" cy="20.5" r="2.1" fill="#c92a2a"/>
    <circle cx="21.2" cy="20.5" r="2.1" fill="#c92a2a"/>
    <path d="M16 27v3M18 27v3M20 27v3" stroke="#2b1216" stroke-width="1.3"/>
  </svg>`;
}

export function renderInteractableSvg(type: InteractableType): string {
  switch (type) {
    case 'cursed_chest':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <rect x="3" y="8" width="18" height="12" rx="2" fill="#5c1118" stroke="#ff6b6b" stroke-width="1.6"/>
        <path d="M3 12h18M12 10v5" stroke="#ffd43b" stroke-width="1.8"/>
      </svg>`;
    case 'chest':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <rect x="3" y="8" width="18" height="12" rx="2" fill="#4f3617" stroke="#ffd43b" stroke-width="1.6"/>
        <path d="M3 12h18M12 10v5" stroke="#fff3bf" stroke-width="1.8"/>
      </svg>`;
    case 'shrine_heal':
    case 'shrine_power':
    case 'shrine_frenzy': {
      const fill =
        type === 'shrine_heal' ? '#40c057' : type === 'shrine_power' ? '#ffd43b' : '#da77f2';
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <polygon points="12,2 18,11 12,21 6,11" fill="${fill}" stroke="#ffffff" stroke-width="1.3"/>
      </svg>`;
    }
    case 'portal_next_floor':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <ellipse cx="12" cy="12" rx="7" ry="9.5" fill="none" stroke="#be4bdb" stroke-width="2"/>
        <ellipse cx="12" cy="12" rx="3.8" ry="6" fill="#e599f7"/>
      </svg>`;
    case 'lore_tome':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" fill="#3b2854" stroke="#e5dbff" stroke-width="1.5"/>
        <path d="M9 9h6M9 13h5" stroke="#ffd43b" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;
    case 'stash_chest':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <rect x="3" y="6" width="18" height="14" rx="2" fill="#28354a" stroke="#ffd43b" stroke-width="1.7"/>
        <path d="M3 11h18M9 11v4h6v-4" stroke="#74c0fc" stroke-width="1.6"/>
      </svg>`;
    case 'gambler_npc':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="#3d1e4d" stroke="#ffd43b" stroke-width="1.6"/>
        <circle cx="8.5" cy="8.5" r="1.5" fill="#fff3bf"/>
        <circle cx="12" cy="12" r="1.5" fill="#fff3bf"/>
        <circle cx="15.5" cy="15.5" r="1.5" fill="#fff3bf"/>
      </svg>`;
    case 'companion_shrine':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <circle cx="12" cy="9" r="4" fill="#63e6be" stroke="#ffffff" stroke-width="1.3"/>
        <path d="M5 20c1.5-4 4-6 7-6s5.5 2 7 6" fill="none" stroke="#63e6be" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    case 'waypoint_map':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="#182842" stroke="#74c0fc" stroke-width="1.6"/>
        <polygon points="12,4 14.5,9.5 20,12 14.5,14.5 12,20 9.5,14.5 4,12 9.5,9.5" fill="#ffd43b"/>
      </svg>`;
    case 'training_dummy':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <circle cx="12" cy="6" r="3" fill="#d8b068" stroke="#fff3bf" stroke-width="1.3"/>
        <path d="M5 11h14M12 9v12M9 21h6" stroke="#ffd43b" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    case 'corrupted_obelisk':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <polygon points="12,2 17,7 16,21 8,21 7,7" fill="#4a0e1c" stroke="#ff4d6d" stroke-width="1.5"/>
        <path d="M12 7v9" stroke="#ffd43b" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
    case 'soul_lantern':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <rect x="7" y="6" width="10" height="13" rx="2" fill="#102a38" stroke="#66d9e8" stroke-width="1.5"/>
        <circle cx="12" cy="12.5" r="3" fill="#99e9f2"/>
      </svg>`;
    case 'rift_breach':
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <path d="M12 2l4 7-2 3 3 4-5 6-4-7 2-3-3-4 5-6z" fill="#ae3ec9" stroke="#f3d9fa" stroke-width="1.4"/>
      </svg>`;
    case 'blacksmith_anvil':
    default:
      return `<svg viewBox="0 0 24 24" class="ar-svg-inline" aria-hidden="true">
        <path d="M4 9h13l3 3-3 2h-4l2 5H7l2-5H6L4 9z" fill="#adb5bd" stroke="#f8f9fa" stroke-width="1.3" stroke-linejoin="round"/>
      </svg>`;
  }
}

export function renderStatusSvg(type: StatusEffectType): string {
  switch (type) {
    case 'burn':
      return `<svg viewBox="0 0 20 20" class="ar-svg-status"><path d="M10 2c2 4-2 6-1 9 2-1 3-3 3-5 3 2.5 4 5.5 4 8a6 6 0 1 1-12 0c0-3.5 3-7 6-12z" fill="#ff6b35"/></svg>`;
    case 'chill':
    case 'freeze':
      return `<svg viewBox="0 0 20 20" class="ar-svg-status"><polygon points="10,2 12.2,7.8 18,10 12.2,12.2 10,18 7.8,12.2 2,10 7.8,7.8" fill="#74c0fc"/></svg>`;
    case 'poison':
      return `<svg viewBox="0 0 20 20" class="ar-svg-status"><path d="M10 3c3.5 4.5 6 7.2 6 10.5a6 6 0 1 1-12 0C4 10.2 6.5 7.5 10 3z" fill="#69db7c"/></svg>`;
    case 'bleed':
      return `<svg viewBox="0 0 20 20" class="ar-svg-status"><path d="M10 2.5c3.5 5 5.5 7.5 5.5 10.8a5.5 5.5 0 1 1-11 0C4.5 10 6.5 7.5 10 2.5z" fill="#e03131"/></svg>`;
    case 'stun':
      return `<svg viewBox="0 0 20 20" class="ar-svg-status"><polygon points="11,2 5,11 10,11 8,18 15,9 10,9" fill="#ffd43b"/></svg>`;
    case 'vulnerable':
      return `<svg viewBox="0 0 20 20" class="ar-svg-status"><path d="M10 2l7 3v5c0 4.8-3 7.8-7 9-4-1.2-7-4.2-7-9V5l7-3z" fill="none" stroke="#ff8787" stroke-width="1.8"/><path d="M7 6l6 8M13 6l-6 8" stroke="#ff8787" stroke-width="1.8"/></svg>`;
    case 'shield':
      return `<svg viewBox="0 0 20 20" class="ar-svg-status"><path d="M10 2l7 3v5c0 4.8-3 7.8-7 9-4-1.2-7-4.2-7-9V5l7-3z" fill="#74c0fc"/></svg>`;
    case 'haste':
    default:
      return `<svg viewBox="0 0 20 20" class="ar-svg-status"><path d="M4 13l6-5 6 5M4 8l6-5 6 5" fill="none" stroke="#63e6be" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
}

export function renderWingOrnamentSvg(side: 'left' | 'right'): string {
  const flip = side === 'right' ? 'transform="scale(-1,1) translate(-44,0)"' : '';
  return `<svg viewBox="0 0 44 74" class="ar-wing-ornament ar-wing-${side}" aria-hidden="true">
    <g ${flip}>
      <path d="M42 10C28 10 15 17 5 30c9-2 16 0 22 5-10 0-17 4-23 13 9-2 17 0 24 6-6 3-11 7-14 13 10-4 19-4 28-1V10z"
        fill="rgba(18,15,26,0.95)" stroke="#c89b3c" stroke-width="1.4" stroke-linejoin="round"/>
      <polygon points="35,37 39,32 43,37 39,42" fill="#c89b3c"/>
    </g>
  </svg>`;
}
