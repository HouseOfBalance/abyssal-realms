export const MP_UI_STYLE_ELEMENT_ID = 'abyssal-realms-multiplayer-ui-styles';

export const MP_UI_SCOPED_CSS = `
.mp-ui-root {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
  font-family: var(--font-body, 'Inter', 'Segoe UI', system-ui, sans-serif);
  color: var(--text-primary, #f1e9d2);
  z-index: 24;
}

.mp-ui-root * {
  box-sizing: border-box;
  user-select: none;
}

.mp-ui-root input[type="text"] {
  user-select: text;
}

.mp-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* =========================================================================
   1. TOP-BAR CO-OP [P] TRIGGER PILL & TACTICAL QUICK-PING STRIP
   ========================================================================= */
.mp-top-bar {
  position: absolute;
  top: 14px;
  left: 262px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 12;
  pointer-events: auto;
}

.mp-coop-trigger-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: linear-gradient(180deg, rgba(22, 17, 34, 0.94) 0%, rgba(11, 9, 18, 0.96) 100%);
  border: 1px solid rgba(200, 155, 60, 0.72);
  border-radius: 18px;
  color: #ffe8a3;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.07em;
  cursor: pointer;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.85),
    inset 0 0 12px rgba(200, 155, 60, 0.16);
  transition: transform 0.14s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.mp-coop-trigger-pill:hover {
  transform: translateY(-1px);
  border-color: #ffd43b;
  box-shadow: 0 0 18px rgba(255, 212, 59, 0.48), 0 6px 18px rgba(0, 0, 0, 0.9);
}

.mp-coop-trigger-pill.is-connected {
  border-color: #51cf66;
  box-shadow: 0 0 16px rgba(64, 192, 87, 0.42), 0 4px 16px rgba(0, 0, 0, 0.85);
}

.mp-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #868e96;
  box-shadow: 0 0 6px rgba(134, 142, 150, 0.6);
  flex-shrink: 0;
}

.mp-coop-trigger-pill.is-connecting .mp-status-dot {
  background: #fcc419;
  box-shadow: 0 0 10px #fcc419;
  animation: mpPulseFast 0.9s ease-in-out infinite;
}

.mp-coop-trigger-pill.is-connected .mp-status-dot {
  background: #51cf66;
  box-shadow: 0 0 10px #51cf66;
}

.mp-quick-ping-strip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  background: rgba(12, 10, 20, 0.86);
  border: 1px solid rgba(200, 155, 60, 0.36);
  border-radius: 14px;
}

.mp-quick-ping-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid rgba(200, 155, 60, 0.35);
  background: rgba(24, 20, 36, 0.9);
  color: #f1e9d2;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.14s ease;
}

.mp-quick-ping-btn:hover {
  transform: scale(1.12);
  border-color: #ffd43b;
}

/* =========================================================================
   2. TOP-LEFT VOICE CONTROL DOCK, SWORN BRETHREN BUFF & PARTY HUD FRAMES
   ========================================================================= */
.mp-top-left-dock {
  position: absolute;
  top: 90px;
  left: 16px;
  width: 246px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 11;
  pointer-events: none;
}

.mp-voice-dock {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: linear-gradient(180deg, rgba(16, 14, 26, 0.92) 0%, rgba(9, 8, 15, 0.94) 100%);
  border: 1px solid rgba(200, 155, 60, 0.48);
  border-left: 3px solid #51cf66;
  border-radius: 5px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.82);
}

.mp-voice-dock.is-muted {
  border-left-color: #ff6b6b;
}

.mp-voice-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.mp-voice-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  background: rgba(26, 22, 38, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.42);
  border-radius: 4px;
  color: #e9dec5;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.mp-voice-btn:hover {
  border-color: #ffd43b;
  color: #fff9db;
}

.mp-voice-btn.is-active {
  background: rgba(43, 138, 62, 0.34);
  border-color: #69db7c;
  color: #d3f9d8;
}

.mp-voice-btn.is-danger {
  background: rgba(166, 30, 42, 0.36);
  border-color: #ff6b6b;
  color: #ffc9c9;
}

.mp-voice-btn-icon {
  width: 13px;
  height: 13px;
  display: inline-block;
}

.mp-vu-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mp-mic-vu-meter {
  flex: 1;
  height: 5px;
  background: #08070d;
  border: 1px solid rgba(200, 155, 60, 0.32);
  border-radius: 3px;
  overflow: hidden;
}

.mp-mic-vu-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #2f9e44 0%, #69db7c 70%, #ffe066 100%);
  transition: width 0.06s linear;
}

.mp-mic-vu-meter.is-speaking {
  border-color: #69db7c;
  box-shadow: 0 0 8px rgba(81, 207, 102, 0.65);
}

.mp-vu-status-label {
  font-size: 9.5px;
  font-weight: 700;
  color: #b7ad97;
  white-space: nowrap;
}

/* Sworn Brethren Co-op Buff Badge */
.mp-sworn-buff-badge {
  display: none;
  pointer-events: auto;
  flex-direction: column;
  gap: 3px;
  padding: 7px 10px;
  background: linear-gradient(90deg, rgba(56, 38, 10, 0.94) 0%, rgba(24, 16, 28, 0.94) 100%);
  border: 1px solid #ffd43b;
  border-left: 3px solid #fcc419;
  border-radius: 4px;
  box-shadow: 0 0 16px rgba(255, 212, 59, 0.38), 0 4px 12px rgba(0, 0, 0, 0.85);
}

.mp-sworn-buff-badge.is-visible {
  display: flex;
  animation: mpGoldenGlow 1.8s ease-in-out infinite;
}

.mp-sworn-buff-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10.5px;
  font-weight: 800;
  color: #ffe066;
  letter-spacing: 0.06em;
}

.mp-sworn-buff-sub {
  font-size: 9.5px;
  font-weight: 600;
  color: #fff3bf;
}

/* Party Member HUD Frames */
.mp-party-frames {
  display: flex;
  flex-direction: column;
  gap: 7px;
  pointer-events: auto;
}

.mp-party-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 10px;
  background: linear-gradient(180deg, rgba(17, 14, 27, 0.92) 0%, rgba(10, 8, 16, 0.94) 100%);
  border: 1px solid rgba(200, 155, 60, 0.5);
  border-radius: 5px;
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.82);
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.mp-party-frame.is-speaking {
  border-color: #51cf66;
  box-shadow: 0 0 14px rgba(81, 207, 102, 0.55), 0 5px 16px rgba(0, 0, 0, 0.82);
}

.mp-party-frame.is-downed {
  border-color: #ff4d4f;
  background: linear-gradient(180deg, rgba(58, 10, 16, 0.95) 0%, rgba(22, 7, 12, 0.96) 100%);
  animation: mpCrimsonAlert 0.75s ease-in-out infinite alternate;
}

.mp-pf-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mp-pf-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #120f1d;
  border: 2px solid rgba(200, 155, 60, 0.65);
  padding: 2px;
  flex-shrink: 0;
  position: relative;
}

.mp-party-frame.is-speaking .mp-pf-avatar {
  border-color: #51cf66;
  box-shadow: 0 0 0 3px rgba(81, 207, 102, 0.35), 0 0 12px #51cf66;
}

.mp-pf-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.mp-pf-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11.5px;
  font-weight: 800;
  color: #f8eed8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-pf-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9.5px;
  color: #beb5a2;
  font-variant-numeric: tabular-nums;
}

.mp-pf-tp-mini {
  padding: 2px 5px;
  background: rgba(34, 28, 52, 0.9);
  border: 1px solid rgba(200, 155, 60, 0.45);
  border-radius: 3px;
  color: #ffd43b;
  font-size: 10px;
  cursor: pointer;
}

.mp-pf-tp-mini:hover {
  border-color: #ffd43b;
  background: rgba(66, 52, 22, 0.92);
}

.mp-pf-hp-track {
  position: relative;
  width: 100%;
  height: 8px;
  background: #08070d;
  border: 1px solid rgba(200, 155, 60, 0.42);
  border-radius: 2px;
  overflow: hidden;
}

.mp-pf-hp-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #b02525 0%, #f03e3e 65%, #ff8787 100%);
  transition: width 0.1s linear;
}

.mp-downed-alert-badge {
  display: none;
  align-items: center;
  justify-content: center;
  padding: 3px 6px;
  background: linear-gradient(90deg, #c92a2a, #e03131);
  border: 1px solid #ffc9c9;
  border-radius: 3px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.05em;
  color: #fff5f5;
  text-shadow: 0 1px 3px #000;
  animation: mpPulseFast 0.55s ease-in-out infinite alternate;
}

.mp-party-frame.is-downed .mp-downed-alert-badge {
  display: flex;
}

/* =========================================================================
   LOCAL PLAYER DOWNED BLEEDOUT OVERLAY & [H] HIGH-FIVE PROMPT BANNER
   ========================================================================= */
.mp-local-downed-overlay {
  display: none;
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 42%, rgba(150, 10, 18, 0.45) 85%, rgba(92, 4, 10, 0.78) 100%);
  z-index: 14;
  align-items: center;
  justify-content: center;
}

.mp-local-downed-overlay.is-visible {
  display: flex;
}

.mp-bleedout-card {
  pointer-events: auto;
  margin-bottom: 150px;
  min-width: 380px;
  padding: 16px 24px;
  background: linear-gradient(180deg, rgba(38, 8, 14, 0.95) 0%, rgba(16, 6, 10, 0.96) 100%);
  border: 1.5px solid #ff6b6b;
  border-radius: 6px;
  text-align: center;
  box-shadow: 0 0 32px rgba(224, 49, 49, 0.65), 0 10px 28px rgba(0, 0, 0, 0.92);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mp-bleedout-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 17px;
  font-weight: 900;
  color: #ffc9c9;
  letter-spacing: 0.08em;
}

.mp-bleedout-bar {
  width: 100%;
  height: 10px;
  background: #09060a;
  border: 1px solid #ff8787;
  border-radius: 3px;
  overflow: hidden;
}

.mp-bleedout-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #8a0f17, #ff4d4f);
  transition: width 0.1s linear;
}

.mp-revive-progress-wrap {
  display: none;
  flex-direction: column;
  gap: 4px;
}

.mp-revive-progress-wrap.is-active {
  display: flex;
}

.mp-revive-bar {
  width: 100%;
  height: 9px;
  background: #0a0912;
  border: 1px solid #ffd43b;
  border-radius: 3px;
  overflow: hidden;
}

.mp-revive-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #f59f00, #ffe066, #fff9db);
}

.mp-sos-call-btn {
  align-self: center;
  padding: 5px 14px;
  background: linear-gradient(180deg, #c92a2a, #861818);
  border: 1px solid #ffa8a8;
  border-radius: 4px;
  color: #fff;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

/* [H] High-Five / Đập Kiếm Prompt Banner */
.mp-highfive-banner {
  display: none;
  position: absolute;
  bottom: 162px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
  align-items: center;
  gap: 10px;
  padding: 8px 18px;
  background: linear-gradient(180deg, rgba(42, 30, 10, 0.96) 0%, rgba(18, 13, 8, 0.97) 100%);
  border: 1.5px solid #ffd43b;
  border-radius: 6px;
  box-shadow: 0 0 24px rgba(255, 212, 59, 0.55), 0 6px 20px rgba(0, 0, 0, 0.9);
  cursor: pointer;
  z-index: 15;
}

.mp-highfive-banner.is-visible {
  display: inline-flex;
  animation: mpGoldenGlow 1.1s ease-in-out infinite alternate;
}

.mp-highfive-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  background: linear-gradient(180deg, #5c4314, #261b07);
  border: 1px solid #ffe066;
  border-radius: 4px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 13px;
  font-weight: 900;
  color: #fff3bf;
}

.mp-highfive-text {
  display: flex;
  flex-direction: column;
}

.mp-highfive-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 13px;
  font-weight: 800;
  color: #ffe8a3;
}

.mp-highfive-sub {
  font-size: 10px;
  color: #d9c79e;
}

/* =========================================================================
   3. TRANSLUCENT PARTY CHAT BOX & 12-EMOJI BAR
   ========================================================================= */
.mp-chat-box {
  position: absolute;
  left: 16px;
  bottom: 140px;
  width: 344px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  background: rgba(11, 9, 18, 0.54);
  border: 1px solid rgba(200, 155, 60, 0.28);
  border-radius: 6px;
  opacity: 0.76;
  pointer-events: auto;
  transition: opacity 0.18s ease, background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  z-index: 13;
}

.mp-chat-box:hover,
.mp-chat-box.is-focused {
  opacity: 1;
  background: rgba(13, 11, 22, 0.92);
  border-color: rgba(200, 155, 60, 0.72);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.86);
}

.mp-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 3px;
  border-bottom: 1px solid rgba(200, 155, 60, 0.22);
}

.mp-chat-header-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10.5px;
  font-weight: 800;
  color: #ffe8a3;
  letter-spacing: 0.05em;
}

.mp-chat-collapse-btn {
  height: 22px;
  padding: 0 9px;
  background: linear-gradient(180deg, rgba(46, 36, 18, 0.95), rgba(24, 18, 10, 0.96));
  border: 1px solid rgba(226, 180, 84, 0.65);
  border-radius: 11px;
  color: #ffe8a3;
  font-size: 10.5px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}

.mp-chat-collapse-btn:hover {
  border-color: #ffd43b;
  color: #fff;
}

.mp-chat-box.is-collapsed {
  width: auto;
  padding: 4px 8px;
  opacity: 0.92;
  background: rgba(14, 11, 24, 0.92);
  border-color: rgba(200, 155, 60, 0.65);
  border-radius: 16px;
}

.mp-chat-box.is-collapsed .mp-chat-header {
  border-bottom: none;
  padding-bottom: 0;
}

.mp-chat-box.is-collapsed .mp-chat-header-title,
.mp-chat-box.is-collapsed .mp-chat-feed,
.mp-chat-box.is-collapsed .mp-emoji-bar,
.mp-chat-box.is-collapsed .mp-chat-input-row {
  display: none !important;
}

@media (max-height: 540px), (max-width: 960px) {
  .mp-top-bar {
    top: 6px;
    left: 160px;
    transform: scale(0.85);
    transform-origin: top left;
  }

  .mp-top-left-dock {
    top: 38px;
    left: 8px;
    width: 210px;
    transform: scale(0.84);
    transform-origin: top left;
  }

  .mp-chat-box {
    left: 12px;
    bottom: 184px;
    width: 270px;
    padding: 6px 8px;
  }

  .mp-chat-feed {
    max-height: 76px;
    min-height: 40px;
    font-size: 10.5px;
  }
}

.mp-chat-feed {
  max-height: 132px;
  min-height: 64px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-right: 4px;
  font-size: 11.5px;
  line-height: 1.35;
}

.mp-chat-line {
  word-break: break-word;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
}

.mp-chat-tag {
  font-weight: 800;
  margin-right: 4px;
  font-size: 10.5px;
}

.mp-chat-line.ch-party .mp-chat-tag { color: #74c0fc; }
.mp-chat-line.ch-emote .mp-chat-tag { color: #e599f7; }
.mp-chat-line.ch-emote { font-style: italic; color: #f3d9fa; }
.mp-chat-line.ch-loot .mp-chat-tag { color: #ffd43b; }
.mp-chat-line.ch-system .mp-chat-tag { color: #63e6be; }
.mp-chat-line.ch-system { color: #c3fae8; }

.mp-chat-sender {
  font-weight: 700;
  margin-right: 4px;
}

.mp-emoji-bar {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 3px;
}

.mp-emoji-pill {
  height: 23px;
  padding: 0 3px;
  background: rgba(24, 20, 36, 0.85);
  border: 1px solid rgba(200, 155, 60, 0.32);
  border-radius: 4px;
  color: #fff3d6;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.1s ease, border-color 0.12s ease, background 0.12s ease;
}

.mp-emoji-pill:hover {
  transform: translateY(-1px) scale(1.05);
  border-color: #ffd43b;
  background: rgba(54, 42, 20, 0.9);
}

.mp-chat-input-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.mp-chat-input {
  flex: 1;
  height: 28px;
  padding: 0 9px;
  background: rgba(7, 6, 12, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.42);
  border-radius: 4px;
  color: #f8eed8;
  font-size: 11.5px;
  outline: none;
}

.mp-chat-input:focus {
  border-color: #ffd43b;
  box-shadow: 0 0 10px rgba(255, 212, 59, 0.32);
}

.mp-chat-send-btn {
  height: 28px;
  padding: 0 10px;
  background: linear-gradient(180deg, #4f3b16, #281d0a);
  border: 1px solid #d9ab4e;
  border-radius: 4px;
  color: #ffe8a3;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

/* =========================================================================
   4. 8-SLICE RADIAL EMOTE / EMOJI WHEEL & ALT+CLICK TACTICAL PING ROSE
   ========================================================================= */
.mp-radial-wheel-backdrop {
  display: none;
  position: absolute;
  inset: 0;
  pointer-events: auto;
  background: radial-gradient(circle at center, rgba(12, 9, 20, 0.58) 0%, transparent 62%);
  z-index: 22;
}

.mp-radial-wheel-backdrop.is-open {
  display: block;
}

.mp-radial-wheel {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 332px;
  height: 332px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(200, 155, 60, 0.65);
  background: radial-gradient(circle, rgba(16, 12, 26, 0.96) 28%, rgba(20, 16, 34, 0.88) 70%, rgba(10, 8, 16, 0.94) 100%);
  box-shadow: 0 0 38px rgba(0, 0, 0, 0.92), inset 0 0 28px rgba(200, 155, 60, 0.2);
}

.mp-wheel-slice {
  position: absolute;
  width: 78px;
  height: 62px;
  margin-left: -39px;
  margin-top: -31px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: rgba(24, 19, 38, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.48);
  border-radius: 8px;
  color: #f3e8ce;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.mp-wheel-slice:hover,
.mp-wheel-slice.is-selected {
  transform: scale(1.13);
  background: linear-gradient(180deg, rgba(78, 56, 18, 0.96), rgba(36, 25, 10, 0.96));
  border-color: #ffd43b;
  box-shadow: 0 0 16px rgba(255, 212, 59, 0.68);
  color: #fff9db;
}

.mp-wheel-slice-icon {
  font-size: 20px;
  line-height: 1;
}

.mp-wheel-slice-label {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 9.5px;
  font-weight: 800;
  white-space: nowrap;
}

.mp-wheel-center-hub {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 112px;
  height: 112px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: linear-gradient(180deg, #1b152b 0%, #0e0b17 100%);
  border: 1.5px solid #d9ab4e;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px;
  text-align: center;
}

.mp-wheel-mode-toggle {
  padding: 3px 8px;
  background: rgba(48, 36, 16, 0.92);
  border: 1px solid #ffd43b;
  border-radius: 10px;
  color: #ffe8a3;
  font-size: 9.5px;
  font-weight: 800;
  cursor: pointer;
}

.mp-wheel-highfive-btn {
  padding: 3px 7px;
  background: rgba(201, 42, 42, 0.35);
  border: 1px solid #ff8787;
  border-radius: 8px;
  color: #ffe3e3;
  font-size: 9px;
  font-weight: 800;
  cursor: pointer;
}

/* Tactical Ping 4-Way Rose & Sonar Ripple */
.mp-ping-rose {
  display: none;
  position: absolute;
  width: 168px;
  height: 168px;
  margin-left: -84px;
  margin-top: -84px;
  pointer-events: auto;
  z-index: 23;
}

.mp-ping-rose.is-open {
  display: block;
}

.mp-ping-rose-btn {
  position: absolute;
  width: 64px;
  height: 44px;
  margin-left: -32px;
  margin-top: -22px;
  background: rgba(16, 13, 26, 0.95);
  border: 1.5px solid rgba(200, 155, 60, 0.65);
  border-radius: 6px;
  color: #fff3d6;
  font-size: 10px;
  font-weight: 800;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.mp-ping-rose-btn.is-selected,
.mp-ping-rose-btn:hover {
  border-color: #ffd43b;
  transform: scale(1.1);
  box-shadow: 0 0 14px rgba(255, 212, 59, 0.65);
}

.mp-ping-sonar {
  position: absolute;
  width: 48px;
  height: 48px;
  margin-left: -24px;
  margin-top: -24px;
  border-radius: 50%;
  border: 2px solid #ffd43b;
  pointer-events: none;
  animation: mpSonarExpand 0.65s ease-out forwards;
  z-index: 19;
}

/* =========================================================================
   5. FULL ONLINE CO-OP LOBBY MODAL (OPENLOBBY / KEY P)
   ========================================================================= */
.mp-lobby-backdrop {
  display: none;
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(16, 12, 28, 0.86) 0%, rgba(5, 4, 9, 0.92) 100%);
  pointer-events: auto;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 30;
}

.mp-lobby-backdrop.is-open {
  display: flex;
}

.mp-lobby-modal {
  width: min(980px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  background: linear-gradient(180deg, #161224 0%, #0c0a14 100%);
  border: 1.5px solid #c89b3c;
  border-radius: 8px;
  padding: 18px 22px;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.95),
    inset 0 0 32px rgba(200, 155, 60, 0.12);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mp-lobby-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(200, 155, 60, 0.35);
  padding-bottom: 10px;
}

.mp-lobby-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: #ffe8a3;
}

.mp-lobby-sub {
  font-size: 11.5px;
  color: #b7ad97;
}

.mp-lobby-close-btn {
  width: 32px;
  height: 32px;
  background: rgba(34, 24, 42, 0.9);
  border: 1px solid rgba(200, 155, 60, 0.6);
  border-radius: 4px;
  color: #ffe8a3;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}

.mp-lobby-top-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.mp-field-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mp-field-label {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11px;
  font-weight: 800;
  color: #d9b35f;
  text-transform: uppercase;
}

.mp-text-input {
  height: 32px;
  padding: 0 10px;
  background: #08070d;
  border: 1px solid rgba(200, 155, 60, 0.55);
  border-radius: 4px;
  color: #fff3d6;
  font-size: 12.5px;
  font-weight: 600;
  outline: none;
}

.mp-text-input:focus {
  border-color: #ffd43b;
  box-shadow: 0 0 10px rgba(255, 212, 59, 0.35);
}

.mp-transport-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.mp-transport-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 9px 12px;
  background: rgba(20, 16, 32, 0.88);
  border: 1px solid rgba(200, 155, 60, 0.36);
  border-radius: 6px;
  color: #d8ceb8;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease;
}

.mp-transport-tab.is-selected {
  background: linear-gradient(180deg, rgba(58, 42, 16, 0.92), rgba(26, 20, 12, 0.94));
  border-color: #ffd43b;
  color: #fff9db;
  box-shadow: 0 0 16px rgba(255, 212, 59, 0.28);
}

.mp-transport-tab-title {
  font-size: 12px;
  font-weight: 800;
}

.mp-transport-tab-desc {
  font-size: 10px;
  color: #a99e86;
}

.mp-relay-row {
  display: none;
  align-items: center;
  gap: 10px;
}

.mp-relay-row.is-visible {
  display: flex;
}

.mp-lobby-actions-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 12px;
}

.mp-action-panel {
  padding: 12px 14px;
  background: rgba(18, 15, 28, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.42);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.mp-cta-btn {
  height: 36px;
  padding: 0 14px;
  background: linear-gradient(180deg, #6b4e1b 0%, #38270c 100%);
  border: 1px solid #f3c669;
  border-radius: 5px;
  color: #fff3bf;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: filter 0.12s ease, transform 0.12s ease;
}

.mp-cta-btn:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
}

.mp-cta-btn.mp-bot-cta {
  background: linear-gradient(180deg, #1d5e3a 0%, #0f3320 100%);
  border-color: #69db7c;
  color: #d3f9d8;
}

.mp-cta-btn.mp-danger-cta {
  background: linear-gradient(180deg, #7d1a22 0%, #420c11 100%);
  border-color: #ff8787;
  color: #ffe3e3;
}

.mp-room-code-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: #07060c;
  border: 1.5px solid #ffd43b;
  border-radius: 6px;
  box-shadow: inset 0 0 18px rgba(255, 212, 59, 0.18), 0 0 16px rgba(255, 212, 59, 0.25);
}

.mp-room-code-display {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 28px;
  font-weight: 900;
  letter-spacing: 0.22em;
  color: #ffe066;
  text-shadow: 0 0 18px rgba(255, 212, 59, 0.85);
}

.mp-copy-btns {
  display: flex;
  gap: 6px;
}

.mp-mini-btn {
  padding: 5px 9px;
  background: rgba(34, 28, 48, 0.95);
  border: 1px solid rgba(200, 155, 60, 0.6);
  border-radius: 4px;
  color: #ffe8a3;
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
}

.mp-mini-btn:hover {
  border-color: #ffd43b;
  background: rgba(62, 48, 22, 0.95);
}

.mp-error-banner {
  display: none;
  padding: 7px 12px;
  background: rgba(140, 20, 30, 0.35);
  border: 1px solid #ff6b6b;
  border-radius: 4px;
  color: #ffc9c9;
  font-size: 11.5px;
  font-weight: 700;
}

.mp-error-banner.is-visible {
  display: block;
}

/* 4-Player Party Roster Grid */
.mp-roster-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.mp-roster-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.mp-roster-card {
  padding: 10px 11px;
  background: linear-gradient(180deg, rgba(22, 18, 35, 0.95) 0%, rgba(12, 10, 20, 0.96) 100%);
  border: 1px solid rgba(200, 155, 60, 0.48);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mp-roster-card.is-speaking {
  border-color: #51cf66;
  box-shadow: 0 0 14px rgba(81, 207, 102, 0.45);
}

.mp-roster-card.is-empty {
  border-style: dashed;
  border-color: rgba(200, 155, 60, 0.25);
  opacity: 0.65;
  align-items: center;
  justify-content: center;
  min-height: 158px;
  text-align: center;
  font-size: 11px;
  color: #9e937b;
}

.mp-rc-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mp-rc-emblem {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.mp-rc-title-col {
  flex: 1;
  min-width: 0;
}

.mp-rc-name {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12px;
  font-weight: 800;
  color: #fff3d6;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mp-host-crown {
  width: 14px;
  height: 14px;
  color: #ffd43b;
  display: inline-block;
  flex-shrink: 0;
}

.mp-ping-pill {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 9.5px;
  font-weight: 800;
  background: rgba(47, 158, 68, 0.25);
  border: 1px solid #51cf66;
  color: #b2f2bb;
  font-variant-numeric: tabular-nums;
}

.mp-ping-pill.ping-mid {
  background: rgba(240, 140, 0, 0.25);
  border-color: #fcc419;
  color: #ffec99;
}

.mp-ping-pill.ping-high {
  background: rgba(201, 42, 42, 0.28);
  border-color: #ff6b6b;
  color: #ffc9c9;
}

.mp-voice-waveform {
  height: 16px;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  padding: 2px 6px;
  background: #08070d;
  border: 1px solid rgba(81, 207, 102, 0.28);
  border-radius: 3px;
}

.mp-wave-bar {
  flex: 1;
  height: 22%;
  background: linear-gradient(180deg, #8ce99a, #2f9e44);
  border-radius: 1px;
  transition: height 0.06s linear;
}

.mp-vol-row {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #cbb88d;
}

.mp-peer-vol-slider {
  flex: 1;
  accent-color: #ffd43b;
  cursor: pointer;
}

.mp-rc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

@keyframes mpPulseFast {
  from { opacity: 0.65; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1.03); }
}

@keyframes mpGoldenGlow {
  from { box-shadow: 0 0 14px rgba(255, 212, 59, 0.35), 0 5px 16px rgba(0, 0, 0, 0.85); }
  to { box-shadow: 0 0 26px rgba(255, 212, 59, 0.72), 0 5px 18px rgba(0, 0, 0, 0.9); }
}

@keyframes mpCrimsonAlert {
  from { box-shadow: 0 0 10px rgba(255, 77, 79, 0.45); }
  to { box-shadow: 0 0 22px rgba(255, 77, 79, 0.88); }
}

@keyframes mpSonarExpand {
  0% { transform: scale(0.35); opacity: 0.95; }
  100% { transform: scale(2.1); opacity: 0; }
}
`;
