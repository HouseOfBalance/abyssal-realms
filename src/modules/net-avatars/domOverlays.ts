import type {
  EmojiReactionId,
  HeroClassId,
  ICameraRig,
  PeerVoiceState,
  RemotePeerSnapshot,
  TacticalPingType,
  Vec3,
} from '../../contracts/types';
import { clamp } from '../../core/Constants';
import { sanitizeVec3 } from './interpolation';
import { type ActiveTacticalPing, TACTICAL_PING_THEMES } from './remoteEffects';

export interface EmojiVisualMeta {
  glyph: string;
  caption: string;
  accentCss: string;
  hex: number;
}

export const EMOJI_REACTION_META: Record<EmojiReactionId, EmojiVisualMeta> = {
  crown_gg: { glyph: '\uD83D\uDC51', caption: 'GG!', accentCss: '#ffd43b', hex: 0xffd43b },
  fire_hype: { glyph: '\uD83D\uDD25', caption: 'HYPE!', accentCss: '#ff6b35', hex: 0xff6b35 },
  skull_danger: { glyph: '\uD83D\uDC80', caption: 'DANGER!', accentCss: '#ff4d4d', hex: 0xff4d4d },
  laugh_imp: { glyph: '\uD83D\uDE08', caption: 'HAHA!', accentCss: '#da77f2', hex: 0xda77f2 },
  heart_thanks: { glyph: '\u2764\uFE0F', caption: 'THANKS!', accentCss: '#ff6b8b', hex: 0xff6b8b },
  chest_loot: { glyph: '\uD83D\uDC8E', caption: 'LOOT!', accentCss: '#fab005', hex: 0xfab005 },
  sos_help: { glyph: '\uD83C\uDD98', caption: 'HELP!', accentCss: '#ff3b3b', hex: 0xff3b3b },
  swords_boss: { glyph: '\u2694\uFE0F', caption: 'BOSS!', accentCss: '#74c0fc', hex: 0x74c0fc },
};

const PING_ICONS: Record<TacticalPingType, string> = {
  attack: '\u2694',
  loot: '\u2726',
  danger: '\u26A0',
  group: '\u2691',
};

const STYLE_ELEMENT_ID = 'ar-net-avatars-overlay-styles';
let mountedOverlayStyleCount = 0;

const OVERLAY_SCOPED_CSS = `
.ar-net-avatars-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
  font-family: var(--font-body, 'Inter', 'Segoe UI', sans-serif);
}

.ar-peer-nameplate {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px 9px 6px;
  min-width: 124px;
  background: linear-gradient(180deg, rgba(16, 13, 24, 0.9) 0%, rgba(9, 8, 15, 0.86) 100%);
  border: 1px solid rgba(200, 155, 60, 0.52);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.68), 0 0 10px rgba(200, 155, 60, 0.14);
  will-change: transform, opacity;
  pointer-events: none;
}

.ar-peer-nameplate.is-awakened {
  border-color: #ffd43b;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.72), 0 0 14px rgba(255, 212, 59, 0.45);
}

.ar-peer-nameplate.is-downed {
  border-color: #ff4d4d;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.78), 0 0 16px rgba(255, 59, 59, 0.62);
}

.ar-peer-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: nowrap;
}

.ar-peer-class-crest {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ar-peer-class-crest svg {
  width: 16px;
  height: 16px;
  display: block;
}

.ar-peer-host-crown {
  font-size: 11px;
  line-height: 1;
  color: #ffd43b;
  text-shadow: 0 0 6px rgba(255, 212, 59, 0.7);
}

.ar-peer-nickname {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #f4ecd8;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
}

.ar-peer-level {
  font-size: 10px;
  font-weight: 600;
  color: #c89b3c;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(200, 155, 60, 0.14);
}

.ar-peer-voice-bars {
  display: none;
  align-items: flex-end;
  gap: 2px;
  height: 13px;
  padding: 1px 4px;
  margin-left: 2px;
  border-radius: 4px;
  background: rgba(47, 158, 68, 0.22);
  border: 1px solid rgba(105, 219, 124, 0.62);
  box-shadow: 0 0 8px rgba(64, 192, 87, 0.48);
}

.ar-peer-voice-bars.is-speaking {
  display: inline-flex;
}

.ar-voice-bar {
  width: 2.5px;
  height: 45%;
  min-height: 2px;
  border-radius: 1.5px;
  background: linear-gradient(180deg, #8ce99a 0%, #40c057 100%);
  box-shadow: 0 0 4px rgba(105, 219, 124, 0.85);
}

.ar-peer-hp-track {
  width: 100%;
  height: 5px;
  border-radius: 3px;
  background: rgba(5, 5, 10, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.ar-peer-hp-fill {
  height: 100%;
  width: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #2f9e44 0%, #69db7c 100%);
  transition: width 0.08s linear;
}

.ar-peer-status-pill {
  display: none;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: 3px;
  text-transform: uppercase;
}

.ar-speech-bubble {
  position: absolute;
  left: 0;
  top: 0;
  max-width: 230px;
  min-width: 90px;
  padding: 7px 11px 8px;
  background: linear-gradient(180deg, #f8f1df 0%, #e7d9b9 100%);
  color: #1a1423;
  border: 2px solid #2b1f14;
  border-radius: 12px;
  box-shadow: 0 5px 0 #2b1f14, 0 9px 20px rgba(0, 0, 0, 0.65);
  transform-origin: 50% 100%;
  will-change: transform, opacity;
  pointer-events: none;
}

.ar-speech-sender {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7c4d12;
  margin-bottom: 2px;
}

.ar-speech-text {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.32;
  color: #171221;
  word-break: break-word;
}

.ar-speech-tail {
  position: absolute;
  left: 50%;
  bottom: -9px;
  width: 12px;
  height: 12px;
  background: #e7d9b9;
  border-right: 2px solid #2b1f14;
  border-bottom: 2px solid #2b1f14;
  transform: translateX(-50%) rotate(45deg);
}

.ar-emoji-burst {
  position: absolute;
  left: 0;
  top: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 5px 9px;
  border-radius: 999px;
  background: radial-gradient(circle at 50% 35%, rgba(28, 22, 42, 0.94), rgba(11, 9, 18, 0.88));
  border: 1.5px solid #ffd43b;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.65), 0 0 14px rgba(255, 212, 59, 0.45);
  transform-origin: 50% 85%;
  will-change: transform, opacity;
  pointer-events: none;
}

.ar-emoji-glyph {
  font-size: 24px;
  line-height: 1.05;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7));
}

.ar-emoji-caption {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #fff3bf;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
}

.ar-ping-world-badge {
  position: absolute;
  left: 0;
  top: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(12, 10, 20, 0.9);
  border: 1.5px solid #ffd43b;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #f8f1df;
  white-space: nowrap;
  will-change: transform, opacity;
  pointer-events: none;
}

.ar-offscreen-arrow {
  position: absolute;
  left: 0;
  top: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(14, 11, 22, 0.93);
  border: 1.5px solid #ff4d4d;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.75);
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #f8f1df;
  white-space: nowrap;
  will-change: transform, opacity;
  pointer-events: none;
}

.ar-offscreen-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 13px;
  line-height: 1;
}
`;

function renderClassCrestSvg(heroClass: HeroClassId): string {
  if (heroClass === 'shadowblade') {
    return `<svg viewBox="0 0 20 20" aria-hidden="true">
      <polygon points="10,1 18,10 10,19 2,10" fill="rgba(47,158,68,0.28)" stroke="#51cf66" stroke-width="1.5"/>
      <path d="M6 14 L14 6 M7 6 L14 13" stroke="#b2f2bb" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;
  }
  if (heroClass === 'arcanist') {
    return `<svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="rgba(51,154,240,0.26)" stroke="#4dabf7" stroke-width="1.5"/>
      <polygon points="10,3 12.2,8 17,10 12.2,12 10,17 7.8,12 3,10 7.8,8" fill="#a5d8ff"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 3 H16 V10 C16 14.5 10 18 10 18 C10 18 4 14.5 4 10 Z" fill="rgba(201,42,42,0.32)" stroke="#ff6b6b" stroke-width="1.5"/>
    <path d="M10 5 V15 M7 8 H13" stroke="#ffe3e3" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`;
}

interface PeerNameplateRefs {
  peerId: string;
  el: HTMLDivElement;
  crestEl: HTMLSpanElement;
  crownEl: HTMLSpanElement;
  nameEl: HTMLSpanElement;
  levelEl: HTMLSpanElement;
  voiceWrapEl: HTMLDivElement;
  voiceBars: HTMLSpanElement[];
  hpFillEl: HTMLDivElement;
  statusPillEl: HTMLDivElement;
  appliedClass: HeroClassId | null;
}

interface SpeechBubbleEntry {
  peerId: string;
  senderName: string;
  text: string;
  elapsedSec: number;
  durationSec: number;
  fallbackPos: Vec3;
  el: HTMLDivElement | null;
  senderEl: HTMLDivElement | null;
  textEl: HTMLDivElement | null;
}

interface SpringEmojiEntry {
  id: string;
  peerId: string;
  emojiId: EmojiReactionId;
  fallbackPos: Vec3;
  elapsedSec: number;
  durationSec: number;
  scale: number;
  scaleVel: number;
  offsetY: number;
  velY: number;
  tiltDeg: number;
  tiltVel: number;
  el: HTMLDivElement | null;
}

interface OffscreenArrowRefs {
  key: string;
  el: HTMLDivElement;
  chevronEl: HTMLSpanElement;
  labelEl: HTMLSpanElement;
}

interface PingWorldBadgeRefs {
  id: string;
  el: HTMLDivElement;
}

export interface AvatarOverlayPeerInput {
  snapshot: RemotePeerSnapshot;
  interpolatedPos: Vec3;
}

const EDGE_MARGIN_PX = 42;
const SPEECH_BUBBLE_DURATION_SEC = 4.6;
const EMOJI_BURST_DURATION_SEC = 2.45;
const MAX_EMOJI_BURSTS = 24;

/**
 * World-to-Screen DOM Overlay Manager scoped inside `#ui-multiplayer-layer`.
 * Renders Teammate Nameplates, Class Crests, HP Bars, Animated Green Voice Soundwave Bars,
 * 3D Comic Speech Bubbles, Bouncy Spring-Physics Overhead Emojis, and Off-Screen Edge Arrows.
 */
export class MultiplayerDomOverlayController {
  private overlayRoot: HTMLDivElement | null = null;
  private styleInjected = false;

  private readonly nameplates = new Map<string, PeerNameplateRefs>();
  private readonly speechBubbles = new Map<string, SpeechBubbleEntry>();
  private readonly emojiBursts: SpringEmojiEntry[] = [];
  private readonly pingBadges = new Map<string, PingWorldBadgeRefs>();
  private readonly offscreenArrows = new Map<string, OffscreenArrowRefs>();

  private emojiSeq = 0;
  private disposed = false;

  private hasDom(): boolean {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  private getViewportDimensions(): { width: number; height: number } {
    if (typeof window !== 'undefined') {
      const w = Number(window.innerWidth);
      const h = Number(window.innerHeight);
      if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        return { width: w, height: h };
      }
    }
    return { width: 1280, height: 720 };
  }

  public ensureMounted(): HTMLDivElement | null {
    if (this.disposed || !this.hasDom()) return null;

    if (!this.styleInjected && document.head) {
      let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ELEMENT_ID;
        styleEl.textContent = OVERLAY_SCOPED_CSS;
        document.head.appendChild(styleEl);
      }
      this.styleInjected = true;
      mountedOverlayStyleCount += 1;
    }

    let mpLayer = document.getElementById('ui-multiplayer-layer');
    if (!mpLayer && document.body) {
      mpLayer = document.createElement('div');
      mpLayer.id = 'ui-multiplayer-layer';
      document.body.appendChild(mpLayer);
    }
    if (!mpLayer) return null;

    if (!this.overlayRoot) {
      const root = document.createElement('div');
      root.className = 'ar-net-avatars-overlay';
      root.setAttribute('data-net-avatars-overlay', 'true');
      this.overlayRoot = root;
    }

    // Re-attach cleanly if another UI component reset #ui-multiplayer-layer
    if (this.overlayRoot.parentElement !== mpLayer) {
      mpLayer.appendChild(this.overlayRoot);
    }

    return this.overlayRoot;
  }

  public getOverlayRoot(): HTMLDivElement | null {
    return this.overlayRoot;
  }

  public showSpeechBubble(
    peerId: string,
    senderName: string,
    text: string,
    anchorPos: Vec3,
  ): void {
    if (this.disposed) return;
    const cleanText = String(text ?? '').trim();
    if (!cleanText) return;

    const root = this.ensureMounted();
    const safeAnchor = sanitizeVec3(anchorPos);

    let entry = this.speechBubbles.get(peerId);
    if (!entry) {
      let el: HTMLDivElement | null = null;
      let senderEl: HTMLDivElement | null = null;
      let textEl: HTMLDivElement | null = null;

      if (root) {
        el = document.createElement('div');
        el.className = 'ar-speech-bubble';
        el.setAttribute('data-peer-id', peerId);

        senderEl = document.createElement('div');
        senderEl.className = 'ar-speech-sender';

        textEl = document.createElement('div');
        textEl.className = 'ar-speech-text';

        const tailEl = document.createElement('div');
        tailEl.className = 'ar-speech-tail';

        el.appendChild(senderEl);
        el.appendChild(textEl);
        el.appendChild(tailEl);
        root.appendChild(el);
      }

      entry = {
        peerId,
        senderName: senderName || 'Ally',
        text: cleanText,
        elapsedSec: 0,
        durationSec: SPEECH_BUBBLE_DURATION_SEC,
        fallbackPos: safeAnchor,
        el,
        senderEl,
        textEl,
      };
      this.speechBubbles.set(peerId, entry);
    } else {
      entry.senderName = senderName || entry.senderName;
      entry.text = cleanText;
      entry.elapsedSec = 0;
      entry.fallbackPos = safeAnchor;
      if (root && entry.el && entry.el.parentElement !== root) {
        root.appendChild(entry.el);
      }
    }

    if (entry.senderEl) entry.senderEl.textContent = entry.senderName;
    if (entry.textEl) entry.textEl.textContent = entry.text;
  }

  public spawnEmojiBurst(
    peerId: string,
    emojiId: EmojiReactionId,
    fallbackPos: Vec3,
  ): SpringEmojiEntry {
    const validEmoji: EmojiReactionId = EMOJI_REACTION_META[emojiId] ? emojiId : 'crown_gg';
    const meta = EMOJI_REACTION_META[validEmoji];
    const safePos = sanitizeVec3(fallbackPos);

    while (this.emojiBursts.length >= MAX_EMOJI_BURSTS) {
      const oldest = this.emojiBursts.shift();
      oldest?.el?.remove();
    }

    const root = this.ensureMounted();
    let el: HTMLDivElement | null = null;

    if (root) {
      el = document.createElement('div');
      el.className = 'ar-emoji-burst';
      el.setAttribute('data-peer-id', peerId);
      el.setAttribute('data-emoji-id', validEmoji);
      el.style.borderColor = meta.accentCss;

      const glyphEl = document.createElement('span');
      glyphEl.className = 'ar-emoji-glyph';
      glyphEl.textContent = meta.glyph;

      const captionEl = document.createElement('span');
      captionEl.className = 'ar-emoji-caption';
      captionEl.style.color = meta.accentCss;
      captionEl.textContent = meta.caption;

      el.appendChild(glyphEl);
      el.appendChild(captionEl);
      root.appendChild(el);
    }

    const alternateSign = this.emojiSeq % 2 === 0 ? 1 : -1;
    const entry: SpringEmojiEntry = {
      id: `emoji_${++this.emojiSeq}`,
      peerId,
      emojiId: validEmoji,
      fallbackPos: safePos,
      elapsedSec: 0,
      durationSec: EMOJI_BURST_DURATION_SEC,
      // Underdamped spring launch parameters (bounces past 1.25x before settling at 1.0x)
      scale: 0.18,
      scaleVel: 10.2,
      offsetY: 0,
      velY: -125,
      tiltDeg: -14 * alternateSign,
      tiltVel: 155 * alternateSign,
      el,
    };

    this.emojiBursts.push(entry);
    return entry;
  }

  public removePeerDom(peerId: string): void {
    const plate = this.nameplates.get(peerId);
    if (plate) {
      plate.el.remove();
      this.nameplates.delete(peerId);
    }
    const bubble = this.speechBubbles.get(peerId);
    if (bubble) {
      bubble.el?.remove();
      this.speechBubbles.delete(peerId);
    }
    const arrowKey = `downed_${peerId}`;
    const arrow = this.offscreenArrows.get(arrowKey);
    if (arrow) {
      arrow.el.remove();
      this.offscreenArrows.delete(arrowKey);
    }
  }

  private getOrCreateNameplate(peerId: string, root: HTMLDivElement): PeerNameplateRefs {
    let refs = this.nameplates.get(peerId);
    if (refs) {
      if (refs.el.parentElement !== root) {
        root.appendChild(refs.el);
      }
      return refs;
    }

    const el = document.createElement('div');
    el.className = 'ar-peer-nameplate';
    el.setAttribute('data-peer-id', peerId);

    const headerEl = document.createElement('div');
    headerEl.className = 'ar-peer-header';

    const crestEl = document.createElement('span');
    crestEl.className = 'ar-peer-class-crest';

    const crownEl = document.createElement('span');
    crownEl.className = 'ar-peer-host-crown';
    crownEl.textContent = '\uD83D\uDC51';

    const nameEl = document.createElement('span');
    nameEl.className = 'ar-peer-nickname';

    const levelEl = document.createElement('span');
    levelEl.className = 'ar-peer-level';

    const voiceWrapEl = document.createElement('div');
    voiceWrapEl.className = 'ar-peer-voice-bars';
    voiceWrapEl.setAttribute('data-voice-indicator', 'true');
    const voiceBars: HTMLSpanElement[] = [];
    for (let i = 0; i < 4; i++) {
      const bar = document.createElement('span');
      bar.className = 'ar-voice-bar';
      voiceBars.push(bar);
      voiceWrapEl.appendChild(bar);
    }

    headerEl.appendChild(crestEl);
    headerEl.appendChild(crownEl);
    headerEl.appendChild(nameEl);
    headerEl.appendChild(levelEl);
    headerEl.appendChild(voiceWrapEl);

    const hpTrackEl = document.createElement('div');
    hpTrackEl.className = 'ar-peer-hp-track';
    const hpFillEl = document.createElement('div');
    hpFillEl.className = 'ar-peer-hp-fill';
    hpTrackEl.appendChild(hpFillEl);

    const statusPillEl = document.createElement('div');
    statusPillEl.className = 'ar-peer-status-pill';

    el.appendChild(headerEl);
    el.appendChild(hpTrackEl);
    el.appendChild(statusPillEl);
    root.appendChild(el);

    refs = {
      peerId,
      el,
      crestEl,
      crownEl,
      nameEl,
      levelEl,
      voiceWrapEl,
      voiceBars,
      hpFillEl,
      statusPillEl,
      appliedClass: null,
    };
    this.nameplates.set(peerId, refs);
    return refs;
  }

  private getOrCreateOffscreenArrow(
    key: string,
    kind: 'ping' | 'downed',
    targetId: string,
    root: HTMLDivElement,
  ): OffscreenArrowRefs {
    let refs = this.offscreenArrows.get(key);
    if (refs) {
      if (refs.el.parentElement !== root) {
        root.appendChild(refs.el);
      }
      return refs;
    }

    const el = document.createElement('div');
    el.className = 'ar-offscreen-arrow';
    el.setAttribute('data-kind', kind);
    el.setAttribute('data-target-id', targetId);

    const chevronEl = document.createElement('span');
    chevronEl.className = 'ar-offscreen-chevron';
    chevronEl.textContent = '\u27A4';

    const labelEl = document.createElement('span');
    labelEl.className = 'ar-offscreen-label';

    el.appendChild(chevronEl);
    el.appendChild(labelEl);
    root.appendChild(el);

    refs = { key, el, chevronEl, labelEl };
    this.offscreenArrows.set(key, refs);
    return refs;
  }

  private computeEdgeClamp(
    screenX: number,
    screenY: number,
    vw: number,
    vh: number,
  ): { edgeX: number; edgeY: number; angleDeg: number } {
    const cx = vw * 0.5;
    const cy = vh * 0.5;
    let dx = Number.isFinite(screenX) ? screenX - cx : 0;
    let dy = Number.isFinite(screenY) ? screenY - cy : -1;

    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) {
      dy = -1;
    }

    const halfW = Math.max(24, cx - EDGE_MARGIN_PX);
    const halfH = Math.max(24, cy - EDGE_MARGIN_PX);
    const tx = Math.abs(dx) > 1e-5 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const ty = Math.abs(dy) > 1e-5 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const t = Math.min(tx, ty);

    const edgeX = clamp(cx + dx * t, EDGE_MARGIN_PX, vw - EDGE_MARGIN_PX);
    const edgeY = clamp(cy + dy * t, EDGE_MARGIN_PX, vh - EDGE_MARGIN_PX);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    return { edgeX, edgeY, angleDeg };
  }

  private isScreenPointInSafeBounds(
    screen: { x: number; y: number; visible: boolean },
    vw: number,
    vh: number,
  ): boolean {
    if (!screen.visible) return false;
    return (
      screen.x >= EDGE_MARGIN_PX * 0.5 &&
      screen.x <= vw - EDGE_MARGIN_PX * 0.5 &&
      screen.y >= EDGE_MARGIN_PX * 0.5 &&
      screen.y <= vh - EDGE_MARGIN_PX * 0.5
    );
  }

  public update(
    dt: number,
    elapsedSec: number,
    peers: readonly AvatarOverlayPeerInput[],
    pings: readonly ActiveTacticalPing[],
    voiceStates: Record<string, PeerVoiceState>,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    if (this.disposed) return;

    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : 0;
    const root = this.ensureMounted();
    const { width: vw, height: vh } = this.getViewportDimensions();

    const peerPosMap = new Map<string, Vec3>();
    const activePeerIds = new Set<string>();
    const usedArrowKeys = new Set<string>();
    const usedPingBadgeIds = new Set<string>();

    // 1. Update Teammate Nameplates + Class Crests + HP Bars + Green Voice Bars + Downed Off-Screen Arrows
    for (const { snapshot, interpolatedPos } of peers) {
      activePeerIds.add(snapshot.peerId);
      peerPosMap.set(snapshot.peerId, interpolatedPos);

      if (!root) continue;

      const headWorld: Vec3 = {
        x: interpolatedPos.x,
        y: interpolatedPos.y + (snapshot.downed ? 1.55 : 2.32),
        z: interpolatedPos.z,
      };
      const screen = worldToScreen(headWorld);
      const plate = this.getOrCreateNameplate(snapshot.peerId, root);

      if (plate.appliedClass !== snapshot.heroClass) {
        plate.appliedClass = snapshot.heroClass;
        plate.crestEl.setAttribute('data-hero-class', snapshot.heroClass);
        plate.crestEl.innerHTML = renderClassCrestSvg(snapshot.heroClass);
      }

      plate.crownEl.style.display = snapshot.isHost ? 'inline' : 'none';
      plate.nameEl.textContent = snapshot.nickname || 'Ally';
      plate.levelEl.textContent = `Lv.${Math.max(1, Math.floor(snapshot.level || 1))}`;

      plate.el.classList.toggle('is-awakened', Boolean(snapshot.awakened));
      plate.el.classList.toggle('is-downed', Boolean(snapshot.downed));

      const hpRatio = clamp(snapshot.hp / Math.max(1, snapshot.maxHp), 0, 1);
      plate.hpFillEl.style.width = `${(hpRatio * 100).toFixed(1)}%`;
      if (snapshot.downed || hpRatio <= 0.28) {
        plate.hpFillEl.style.background = 'linear-gradient(90deg, #c92a2a 0%, #ff6b6b 100%)';
      } else if (snapshot.awakened) {
        plate.hpFillEl.style.background = 'linear-gradient(90deg, #f08c00 0%, #ffd43b 100%)';
      } else {
        plate.hpFillEl.style.background = 'linear-gradient(90deg, #2f9e44 0%, #69db7c 100%)';
      }

      if (snapshot.downed) {
        const bleedSec =
          snapshot.downedBleedoutSec !== undefined
            ? ` \u2022 ${Math.max(0, Math.ceil(snapshot.downedBleedoutSec))}s`
            : '';
        plate.statusPillEl.style.display = 'inline-block';
        plate.statusPillEl.style.background = 'rgba(201, 42, 42, 0.34)';
        plate.statusPillEl.style.color = '#ffa8a8';
        plate.statusPillEl.textContent = `DOWNED${bleedSec}`;
      } else if (snapshot.awakened) {
        plate.statusPillEl.style.display = 'inline-block';
        plate.statusPillEl.style.background = 'rgba(255, 212, 59, 0.22)';
        plate.statusPillEl.style.color = '#ffe066';
        plate.statusPillEl.textContent = '\u2726 ARCHON';
      } else {
        plate.statusPillEl.style.display = 'none';
      }

      // Animated Green Voice Soundwave Bars when speaking
      const voiceState = voiceStates ? voiceStates[snapshot.peerId] : undefined;
      const isSpeaking = Boolean(voiceState?.isSpeaking && !voiceState?.mutedByLocal);
      plate.voiceWrapEl.classList.toggle('is-speaking', isSpeaking);
      plate.voiceWrapEl.style.display = isSpeaking ? 'inline-flex' : 'none';

      if (isSpeaking) {
        const baseLevel = clamp(Number.isFinite(voiceState?.voiceLevel) ? voiceState!.voiceLevel : 0.65, 0.25, 1);
        for (let b = 0; b < plate.voiceBars.length; b++) {
          const wave = 0.5 + 0.5 * Math.sin(safeElapsed * (11.5 + b * 3.7) + b * 1.35);
          const barPct = clamp((0.28 + baseLevel * 0.72 * wave) * 100, 22, 100);
          plate.voiceBars[b].style.height = `${barPct.toFixed(0)}%`;
        }
      }

      const inBounds = this.isScreenPointInSafeBounds(screen, vw, vh);
      if (screen.visible) {
        plate.el.style.display = 'flex';
        plate.el.style.transform = `translate(-50%, -100%) translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;
      } else {
        plate.el.style.display = 'none';
      }

      // Off-screen edge arrow for downed teammates!
      if (snapshot.downed && !inBounds) {
        const arrowKey = `downed_${snapshot.peerId}`;
        usedArrowKeys.add(arrowKey);
        const arrow = this.getOrCreateOffscreenArrow(arrowKey, 'downed', snapshot.peerId, root);
        const { edgeX, edgeY, angleDeg } = this.computeEdgeClamp(screen.x, screen.y, vw, vh);
        const pulseAlpha = 0.84 + 0.16 * Math.sin(safeElapsed * 7.5);

        arrow.el.style.display = 'inline-flex';
        arrow.el.style.borderColor = '#ff4d4d';
        arrow.el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.78), 0 0 14px rgba(255, 59, 59, 0.72)';
        arrow.el.style.opacity = pulseAlpha.toFixed(2);
        arrow.el.style.transform = `translate(-50%, -50%) translate3d(${edgeX.toFixed(1)}px, ${edgeY.toFixed(1)}px, 0)`;
        arrow.chevronEl.style.color = '#ff6b6b';
        arrow.chevronEl.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;
        arrow.labelEl.textContent = `\uD83C\uDD98 REVIVE ${snapshot.nickname || 'Ally'}`;
      }
    }

    // Prune stale nameplates of disconnected peers
    for (const [peerId, plate] of this.nameplates.entries()) {
      if (!activePeerIds.has(peerId)) {
        plate.el.remove();
        this.nameplates.delete(peerId);
      }
    }

    // 2. Update 3D Comic Speech Bubbles
    for (const [peerId, bubble] of this.speechBubbles.entries()) {
      bubble.elapsedSec += safeDt;
      if (bubble.elapsedSec >= bubble.durationSec) {
        bubble.el?.remove();
        this.speechBubbles.delete(peerId);
        continue;
      }

      const livePos = peerPosMap.get(peerId) ?? bubble.fallbackPos;
      if (peerPosMap.has(peerId)) {
        bubble.fallbackPos = { ...livePos };
      }
      if (!root || !bubble.el) continue;

      const bubbleWorld: Vec3 = {
        x: livePos.x,
        y: livePos.y + 2.96,
        z: livePos.z,
      };
      const screen = worldToScreen(bubbleWorld);
      if (!screen.visible) {
        bubble.el.style.display = 'none';
        continue;
      }

      // Snappy comic pop-in + gentle fade-out
      const popU = clamp(bubble.elapsedSec / 0.18, 0, 1);
      const popScale =
        popU < 1 ? 0.55 + 0.53 * Math.sin(popU * Math.PI * 0.68) : 1 + 0.015 * Math.sin(safeElapsed * 3.2);
      const rem = bubble.durationSec - bubble.elapsedSec;
      const opacity = rem < 0.45 ? clamp(rem / 0.45, 0, 1) : 1;

      bubble.el.style.display = 'block';
      bubble.el.style.opacity = opacity.toFixed(2);
      bubble.el.style.transform = `translate(-50%, -100%) translate3d(${screen.x.toFixed(1)}px, ${(screen.y - 10).toFixed(1)}px, 0) perspective(400px) rotateX(4deg) scale(${popScale.toFixed(3)})`;
    }

    // 3. Update Bouncy Spring-Physics Overhead Emojis (2nd-order Hooke's Law spring)
    const springStiffness = 245;
    const springDamping = 13.2;
    const tiltStiffness = 180;
    const tiltDamping = 11.5;

    for (let i = this.emojiBursts.length - 1; i >= 0; i--) {
      const burst = this.emojiBursts[i];
      burst.elapsedSec += safeDt;

      if (burst.elapsedSec >= burst.durationSec) {
        burst.el?.remove();
        this.emojiBursts.splice(i, 1);
        continue;
      }

      // Sub-step spring integration for rock-solid stability across arbitrary dt
      let remDt = safeDt;
      while (remDt > 1e-5) {
        const h = Math.min(remDt, 1 / 120);
        remDt -= h;

        const scaleAccel = -springStiffness * (burst.scale - 1.0) - springDamping * burst.scaleVel;
        burst.scaleVel += scaleAccel * h;
        burst.scale = Math.max(0.08, burst.scale + burst.scaleVel * h);

        // Upward buoyancy launch + gentle bobbing settle around -44px
        const yAccel = -48 * (burst.offsetY + 44) - 6.8 * burst.velY;
        burst.velY += yAccel * h;
        burst.offsetY += burst.velY * h;

        const tiltAccel = -tiltStiffness * burst.tiltDeg - tiltDamping * burst.tiltVel;
        burst.tiltVel += tiltAccel * h;
        burst.tiltDeg += burst.tiltVel * h;
      }

      const liveOwnerPos = peerPosMap.get(burst.peerId);
      const anchorWorld: Vec3 = liveOwnerPos
        ? { x: liveOwnerPos.x, y: liveOwnerPos.y + 2.85, z: liveOwnerPos.z }
        : { x: burst.fallbackPos.x, y: burst.fallbackPos.y + 2.45, z: burst.fallbackPos.z };

      if (!root || !burst.el) continue;

      const screen = worldToScreen(anchorWorld);
      if (!screen.visible) {
        burst.el.style.display = 'none';
        continue;
      }

      const rem = burst.durationSec - burst.elapsedSec;
      const opacity = rem < 0.4 ? clamp(rem / 0.4, 0, 1) : 1;

      burst.el.style.display = 'inline-flex';
      burst.el.style.opacity = opacity.toFixed(2);
      burst.el.style.transform = `translate(-50%, -100%) translate3d(${screen.x.toFixed(1)}px, ${(screen.y + burst.offsetY).toFixed(1)}px, 0) scale(${burst.scale.toFixed(3)}) rotate(${burst.tiltDeg.toFixed(1)}deg)`;
    }

    // 4. Update Tactical Ping On-Screen Badges & Off-Screen Edge Arrows
    if (root) {
      for (const ping of pings) {
        const theme = TACTICAL_PING_THEMES[ping.pingType];
        const icon = PING_ICONS[ping.pingType];
        const pingTopWorld: Vec3 = {
          x: ping.position.x,
          y: ping.position.y + 3.15,
          z: ping.position.z,
        };
        const screen = worldToScreen(pingTopWorld);
        const inBounds = this.isScreenPointInSafeBounds(screen, vw, vh);
        const rem = ping.durationSec - ping.elapsedSec;
        const fade = rem < 0.65 ? clamp(rem / 0.65, 0, 1) : 1;

        if (inBounds) {
          usedPingBadgeIds.add(ping.id);
          let badge = this.pingBadges.get(ping.id);
          if (!badge) {
            const el = document.createElement('div');
            el.className = 'ar-ping-world-badge';
            el.setAttribute('data-ping-id', ping.id);
            el.setAttribute('data-ping-type', ping.pingType);
            root.appendChild(el);
            badge = { id: ping.id, el };
            this.pingBadges.set(ping.id, badge);
          } else if (badge.el.parentElement !== root) {
            root.appendChild(badge.el);
          }

          badge.el.style.display = 'inline-flex';
          badge.el.style.borderColor = theme.cssColor;
          badge.el.style.boxShadow = `0 4px 12px rgba(0,0,0,0.7), 0 0 10px ${theme.cssGlow}`;
          badge.el.style.opacity = fade.toFixed(2);
          badge.el.textContent = `${icon} ${theme.label} \u2022 ${ping.senderName}`;
          badge.el.style.transform = `translate(-50%, -100%) translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;
        } else {
          const arrowKey = `ping_${ping.id}`;
          usedArrowKeys.add(arrowKey);
          const arrow = this.getOrCreateOffscreenArrow(arrowKey, 'ping', ping.id, root);
          arrow.el.setAttribute('data-ping-type', ping.pingType);

          const { edgeX, edgeY, angleDeg } = this.computeEdgeClamp(screen.x, screen.y, vw, vh);
          arrow.el.style.display = 'inline-flex';
          arrow.el.style.borderColor = theme.cssColor;
          arrow.el.style.boxShadow = `0 4px 14px rgba(0,0,0,0.76), 0 0 12px ${theme.cssGlow}`;
          arrow.el.style.opacity = fade.toFixed(2);
          arrow.el.style.transform = `translate(-50%, -50%) translate3d(${edgeX.toFixed(1)}px, ${edgeY.toFixed(1)}px, 0)`;
          arrow.chevronEl.style.color = theme.cssColor;
          arrow.chevronEl.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;
          arrow.labelEl.textContent = `${icon} ${theme.label} (${ping.senderName})`;
        }
      }
    }

    // Prune unused world ping badges & off-screen edge arrows
    for (const [badgeId, badge] of this.pingBadges.entries()) {
      if (!usedPingBadgeIds.has(badgeId)) {
        badge.el.remove();
        this.pingBadges.delete(badgeId);
      }
    }

    for (const [arrowKey, arrow] of this.offscreenArrows.entries()) {
      if (!usedArrowKeys.has(arrowKey)) {
        arrow.el.remove();
        this.offscreenArrows.delete(arrowKey);
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const plate of this.nameplates.values()) plate.el.remove();
    this.nameplates.clear();

    for (const bubble of this.speechBubbles.values()) bubble.el?.remove();
    this.speechBubbles.clear();

    for (const burst of this.emojiBursts) burst.el?.remove();
    this.emojiBursts.length = 0;

    for (const badge of this.pingBadges.values()) badge.el.remove();
    this.pingBadges.clear();

    for (const arrow of this.offscreenArrows.values()) arrow.el.remove();
    this.offscreenArrows.clear();

    if (this.overlayRoot) {
      this.overlayRoot.remove();
      this.overlayRoot = null;
    }

    if (this.styleInjected) {
      this.styleInjected = false;
      mountedOverlayStyleCount = Math.max(0, mountedOverlayStyleCount - 1);
      if (mountedOverlayStyleCount === 0 && typeof document !== 'undefined') {
        document.getElementById(STYLE_ELEMENT_ID)?.remove();
      }
    }
  }
}
