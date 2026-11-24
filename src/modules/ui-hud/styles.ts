export const HUD_STYLE_ELEMENT_ID = 'abyssal-realms-hud-styles';

export const HUD_SCOPED_CSS = `
.ar-hud-root {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
  font-family: var(--font-body, 'Inter', 'Segoe UI', system-ui, sans-serif);
  color: var(--text-primary, #f1e9d2);
  transition: opacity 0.24s ease;
}

.ar-hud-root.ar-hud-hidden {
  opacity: 0;
  visibility: hidden;
}

.ar-hud-root * {
  box-sizing: border-box;
  user-select: none;
}

.ar-svg-icon {
  width: 100%;
  height: 100%;
  display: block;
}

.ar-svg-inline {
  width: 18px;
  height: 18px;
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}

.ar-svg-status {
  width: 15px;
  height: 15px;
  display: block;
}

/* Low HP Crimson Screen Vignette */
.ar-low-hp-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(ellipse at center, transparent 54%, rgba(168, 14, 22, 0.42) 88%, rgba(110, 5, 12, 0.72) 100%);
  transition: opacity 0.25s ease;
  z-index: 1;
}

.ar-low-hp-vignette.ar-active {
  animation: arLowHpPulse 1.15s ease-in-out infinite;
}

@keyframes arLowHpPulse {
  0%, 100% { opacity: 0.42; }
  50% { opacity: 0.88; }
}

/* World-Space Overlay Layer */
.ar-world-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
}

/* Pooled Floating Damage Numbers */
.ar-dmg-num {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  will-change: transform, opacity;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-weight: 800;
  font-size: 19px;
  letter-spacing: 0.03em;
  line-height: 1;
  white-space: nowrap;
  text-shadow:
    0 2px 4px rgba(0, 0, 0, 0.96),
    -1px -1px 0 #07060a,
    1px -1px 0 #07060a,
    -1px 1px 0 #07060a,
    1px 1px 0 #07060a;
  opacity: 0;
}

.ar-dmg-num.ar-crit {
  font-size: 27px;
  color: #ffd43b !important;
  letter-spacing: 0.05em;
  text-shadow:
    0 0 12px rgba(255, 196, 36, 0.85),
    0 2px 6px rgba(0, 0, 0, 0.98),
    -1.5px -1.5px 0 #261202,
    1.5px -1.5px 0 #261202,
    -1.5px 1.5px 0 #261202,
    1.5px 1.5px 0 #261202;
}

.ar-dmg-num.ar-player-hit {
  color: #ff4d4f !important;
  font-size: 20px;
}

.ar-dmg-num.ar-dodged {
  font-size: 14px;
  letter-spacing: 0.14em;
  color: #a5d8ff !important;
  font-style: italic;
}

/* Pooled Overhead Enemy & Elite HP Bars */
.ar-enemy-overhead {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  will-change: transform, opacity;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
}

.ar-enemy-overhead-name {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11px;
  font-weight: 700;
  color: #ffd875;
  letter-spacing: 0.05em;
  text-shadow: 0 1px 3px #000, 0 0 6px rgba(0, 0, 0, 0.95);
  margin-bottom: 2px;
  white-space: nowrap;
}

.ar-enemy-overhead-affixes {
  font-size: 9.5px;
  font-weight: 600;
  color: #e599f7;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 3px #000;
  margin-bottom: 3px;
  white-space: nowrap;
}

.ar-enemy-hp-track {
  width: 58px;
  height: 6px;
  background: rgba(8, 7, 13, 0.9);
  border: 1px solid rgba(180, 155, 110, 0.55);
  border-radius: 2px;
  overflow: hidden;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.78);
}

.ar-enemy-overhead.ar-is-elite .ar-enemy-hp-track {
  width: 96px;
  height: 8px;
  border: 1px solid #ffd43b;
  box-shadow: 0 0 9px rgba(255, 212, 59, 0.35), 0 2px 6px rgba(0, 0, 0, 0.9);
}

.ar-enemy-hp-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #9e1919 0%, #e03131 65%, #ff6b6b 100%);
  transform-origin: left center;
  transition: width 0.08s linear;
}

.ar-enemy-overhead.ar-is-elite .ar-enemy-hp-fill {
  background: linear-gradient(90deg, #862e9c 0%, #c92a2a 55%, #fcc419 100%);
}

.ar-enemy-statuses {
  display: flex;
  gap: 3px;
  margin-top: 2px;
  min-height: 5px;
}

.ar-enemy-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.8);
}

/* Pooled World-Space Ground Loot Labels */
.ar-loot-pill {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  will-change: transform, opacity;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  background: rgba(10, 8, 16, 0.88);
  border: 1px solid rgba(200, 155, 60, 0.5);
  border-left-width: 3px;
  border-radius: 3px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.85);
  opacity: 0;
}

.ar-loot-pill.ar-rarity-legendary {
  background: linear-gradient(90deg, rgba(46, 22, 6, 0.94), rgba(18, 12, 16, 0.92));
  box-shadow: 0 0 14px rgba(255, 146, 43, 0.45), 0 3px 10px rgba(0, 0, 0, 0.9);
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-weight: 700;
}

.ar-loot-pill.ar-rarity-epic {
  background: linear-gradient(90deg, rgba(36, 12, 48, 0.94), rgba(16, 12, 22, 0.92));
  box-shadow: 0 0 11px rgba(190, 75, 219, 0.36), 0 3px 10px rgba(0, 0, 0, 0.9);
}

.ar-loot-gem {
  width: 7px;
  height: 7px;
  transform: rotate(45deg);
  flex-shrink: 0;
}

/* [F] Interact World-Space Prompt Pill */
.ar-interact-pill {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  will-change: transform, opacity;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 13px 6px 8px;
  background: linear-gradient(180deg, rgba(24, 19, 32, 0.95) 0%, rgba(11, 9, 17, 0.96) 100%);
  border: 1px solid #d9ab4e;
  border-radius: 5px;
  box-shadow: 0 0 18px rgba(200, 155, 60, 0.34), 0 5px 16px rgba(0, 0, 0, 0.9);
  opacity: 0;
  z-index: 5;
}

.ar-interact-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  background: linear-gradient(180deg, #3c2e16 0%, #1d150a 100%);
  border: 1px solid #f3c669;
  border-radius: 4px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12px;
  font-weight: 800;
  color: #ffe8a3;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.ar-interact-text-wrap {
  display: flex;
  flex-direction: column;
}

.ar-interact-label {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 13px;
  font-weight: 700;
  color: #fff3d1;
  letter-spacing: 0.04em;
}

.ar-interact-sub {
  font-size: 10px;
  color: #cbb88d;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Top-Center Pinnacle Boss Health Bar & Cursed Event */
.ar-top-center {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(620px, 56vw);
  z-index: 6;
  pointer-events: none;
}

.ar-boss-frame {
  width: 100%;
  background: linear-gradient(180deg, rgba(20, 14, 24, 0.93) 0%, rgba(10, 8, 14, 0.95) 100%);
  border: 1px solid rgba(200, 155, 60, 0.72);
  border-radius: 4px;
  padding: 9px 16px 12px;
  box-shadow:
    0 8px 28px rgba(0, 0, 0, 0.88),
    inset 0 0 22px rgba(201, 42, 42, 0.18),
    0 0 1px 1px rgba(0, 0, 0, 0.9);
  position: relative;
  display: none;
}

.ar-boss-frame.ar-visible {
  display: block;
  animation: arBossReveal 0.38s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes arBossReveal {
  from { opacity: 0; transform: translateY(-14px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.ar-boss-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.ar-boss-title-group {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.ar-boss-skull {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  filter: drop-shadow(0 0 6px rgba(201, 42, 42, 0.65));
}

.ar-boss-name {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #f8eed8;
  text-transform: uppercase;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.95);
}

.ar-boss-subtitle {
  font-size: 11px;
  color: #d0b277;
  letter-spacing: 0.06em;
}

.ar-boss-phase-badge {
  padding: 2px 9px;
  border-radius: 3px;
  background: rgba(201, 42, 42, 0.25);
  border: 1px solid rgba(224, 92, 92, 0.65);
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ffc9c9;
  white-space: nowrap;
}

.ar-boss-bar-shell {
  position: relative;
  width: 100%;
  height: 16px;
  background: #09070d;
  border: 1px solid #c89b3c;
  border-radius: 2px;
  overflow: hidden;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.95);
}

.ar-boss-bar-trail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  background: linear-gradient(90deg, #ffe066, #fff9db);
  opacity: 0.78;
  transition: width 0.38s ease-out;
}

.ar-boss-bar-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  background: linear-gradient(180deg, #ff5252 0%, #c92a2a 48%, #7d1118 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32);
  transition: width 0.08s linear;
}

.ar-boss-notch {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #f5d076;
  box-shadow: 0 0 5px rgba(0, 0, 0, 0.95);
  z-index: 3;
}

.ar-boss-hp-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #fff9ec;
  text-shadow: 0 1px 3px #000, 0 0 5px #000;
  z-index: 4;
}

.ar-cursed-banner {
  display: none;
  align-items: center;
  gap: 12px;
  padding: 7px 18px;
  background: linear-gradient(90deg, rgba(48, 8, 16, 0.94), rgba(22, 9, 24, 0.94));
  border: 1px solid #ff6b6b;
  border-radius: 4px;
  box-shadow: 0 0 18px rgba(224, 49, 49, 0.45), 0 4px 14px rgba(0, 0, 0, 0.85);
}

.ar-cursed-banner.ar-visible {
  display: inline-flex;
  animation: arCursedPulse 1.3s ease-in-out infinite;
}

@keyframes arCursedPulse {
  0%, 100% { border-color: #ff6b6b; box-shadow: 0 0 14px rgba(224, 49, 49, 0.4), 0 4px 14px rgba(0, 0, 0, 0.85); }
  50% { border-color: #ffd43b; box-shadow: 0 0 22px rgba(255, 107, 107, 0.72), 0 4px 14px rgba(0, 0, 0, 0.85); }
}

.ar-cursed-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #ffa8a8;
  text-transform: uppercase;
}

.ar-cursed-timer {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 16px;
  font-weight: 800;
  color: #ffd43b;
  min-width: 54px;
  text-align: center;
}

.ar-cursed-waves {
  font-size: 11px;
  font-weight: 600;
  color: #f1e9d2;
  padding: 2px 7px;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 3px;
}

/* Top-Right Minimap & Quest Tracker */
.ar-top-right {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 224px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 6;
  pointer-events: none;
}

.ar-minimap-card {
  background: linear-gradient(180deg, rgba(17, 14, 24, 0.94) 0%, rgba(9, 8, 14, 0.96) 100%);
  border: 1px solid var(--border-gold, #c89b3c);
  border-radius: 5px;
  padding: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.88), inset 0 0 14px rgba(200, 155, 60, 0.12);
}

.ar-minimap-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}

.ar-biome-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11.5px;
  font-weight: 700;
  color: #f3e4be;
  line-height: 1.2;
  letter-spacing: 0.04em;
}

.ar-floor-sub {
  font-size: 10px;
  color: var(--text-muted, #9e937b);
  margin-top: 1px;
}

.ar-fps-badge {
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(8, 12, 10, 0.85);
  border: 1px solid rgba(200, 155, 60, 0.38);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #69db7c;
  white-space: nowrap;
}

.ar-telemetry-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  margin-bottom: 6px;
}

.ar-perf-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 3px;
  background: linear-gradient(90deg, rgba(10, 28, 22, 0.92) 0%, rgba(12, 18, 28, 0.92) 100%);
  border: 1px solid rgba(99, 230, 190, 0.48);
  box-shadow: 0 0 10px rgba(56, 217, 169, 0.16);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: #96f2d7;
  white-space: nowrap;
}

.ar-perf-pill.ar-dlss-native {
  background: rgba(16, 14, 24, 0.9);
  border-color: rgba(200, 155, 60, 0.42);
  color: #e9d8a6;
  box-shadow: none;
}

.ar-perf-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #38d9a9;
  box-shadow: 0 0 6px #38d9a9;
  flex-shrink: 0;
}

.ar-minimap-canvas-wrap {
  position: relative;
  width: 206px;
  height: 196px;
  border: 1px solid rgba(200, 155, 60, 0.55);
  border-radius: 3px;
  overflow: hidden;
  background: #060509;
}

.ar-minimap-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.ar-minimap-north {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 9px;
  font-weight: 800;
  color: #d9b35f;
  background: rgba(7, 6, 10, 0.78);
  padding: 0 4px;
  border-radius: 2px;
  border: 1px solid rgba(200, 155, 60, 0.35);
}

.ar-minimap-legend {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 9.5px;
  color: #9e937b;
}

/* Active Quest Tracker */
.ar-quest-tracker {
  background: linear-gradient(180deg, rgba(15, 13, 22, 0.86) 0%, rgba(10, 8, 15, 0.82) 100%);
  border: 1px solid rgba(200, 155, 60, 0.42);
  border-left: 3px solid #c89b3c;
  border-radius: 4px;
  padding: 8px 10px;
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.72);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ar-quest-tracker-hdr {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #c89b3c;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(200, 155, 60, 0.22);
  padding-bottom: 4px;
}

.ar-quest-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ar-quest-title {
  font-size: 11.5px;
  font-weight: 700;
  color: #f3e8ce;
  display: flex;
  align-items: center;
  gap: 5px;
}

.ar-quest-item.ar-side-quest .ar-quest-title {
  color: #d0d7de;
  font-weight: 600;
}

.ar-quest-crown {
  color: #ffd43b;
  font-size: 11px;
}

.ar-quest-obj {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 10.5px;
  color: #beb5a2;
  padding-left: 8px;
}

.ar-quest-obj.ar-obj-done {
  color: #69db7c;
  text-decoration: line-through;
  opacity: 0.8;
}

.ar-quest-obj-count {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #ffe08a;
  white-space: nowrap;
}

.ar-quest-obj.ar-obj-done .ar-quest-obj-count {
  color: #69db7c;
}

/* Kill-Streak Combo Meter */
.ar-combo-widget {
  position: absolute;
  right: 24px;
  top: 52%;
  transform: translateY(-50%) scale(0.92);
  text-align: right;
  padding: 10px 16px;
  background: linear-gradient(270deg, rgba(36, 10, 16, 0.88) 0%, rgba(12, 9, 18, 0.45) 100%);
  border-right: 3px solid #ffd43b;
  border-radius: 4px 0 0 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.15s cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 5;
}

.ar-combo-widget.ar-visible {
  opacity: 1;
  transform: translateY(-50%) scale(1);
}

.ar-combo-rank {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: #ff922b;
  text-transform: uppercase;
}

.ar-combo-count {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 32px;
  font-weight: 900;
  line-height: 1.05;
  color: #ffd43b;
  text-shadow: 0 0 14px rgba(255, 146, 43, 0.65), 0 2px 6px #000;
}

.ar-combo-mult {
  font-size: 11.5px;
  font-weight: 700;
  color: #ffe8cc;
  margin-top: 2px;
}

.ar-combo-fuse-track {
  width: 124px;
  height: 4px;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 2px;
  margin-top: 6px;
  margin-left: auto;
  overflow: hidden;
}

.ar-combo-fuse-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #ff6b35, #ffd43b);
}

/* Dramatic Center Banners */
.ar-center-banner {
  position: absolute;
  top: 24%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.94);
  min-width: min(560px, 84vw);
  padding: 18px 38px;
  text-align: center;
  background: radial-gradient(ellipse at center, rgba(16, 12, 24, 0.92) 0%, rgba(10, 8, 15, 0.65) 68%, transparent 100%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.38s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 8;
}

.ar-center-banner.ar-visible {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.ar-banner-rule {
  height: 2px;
  width: 100%;
  margin: 8px auto;
  background: linear-gradient(90deg, transparent 0%, var(--banner-accent, #c89b3c) 50%, transparent 100%);
}

.ar-banner-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--banner-accent, #ffd97d);
  text-shadow: 0 0 22px var(--banner-glow, rgba(200, 155, 60, 0.65)), 0 3px 10px #000;
}

.ar-banner-sub {
  font-size: 13px;
  letter-spacing: 0.08em;
  color: #efe5cf;
  margin-top: 4px;
  text-shadow: 0 2px 6px #000;
}

/* Bottom-Left Toasts */
.ar-toast-stack {
  position: absolute;
  left: 18px;
  bottom: 138px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-width: 340px;
  z-index: 7;
  pointer-events: none;
}

.ar-toast-card {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 13px;
  background: linear-gradient(90deg, rgba(18, 15, 27, 0.95) 0%, rgba(12, 10, 18, 0.88) 100%);
  border: 1px solid rgba(200, 155, 60, 0.45);
  border-left-width: 4px;
  border-radius: 4px;
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.82);
  font-size: 12.5px;
  font-weight: 600;
  color: #f1e9d2;
  animation: arToastSlideIn 0.24s cubic-bezier(0.16, 1, 0.3, 1);
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.ar-toast-card.ar-toast-leaving {
  opacity: 0;
  transform: translateX(-16px);
}

@keyframes arToastSlideIn {
  from { opacity: 0; transform: translateX(-22px); }
  to { opacity: 1; transform: translateX(0); }
}

/* =========================================================
   BOTTOM ORNATE DIABLO IV / HADES ACTION BAR & LIQUID GLOBES
   ========================================================= */
.ar-bottom-dock {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 6;
  pointer-events: none;
}

/* Upper sub-row: Active Status Effects, Stamina Pips, Gold Counter */
.ar-status-stamina-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 880px;
  padding: 0 18px;
  margin-bottom: 6px;
  gap: 10px;
}

.ar-player-statuses {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
}

.ar-status-chip {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  background: rgba(14, 12, 22, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.8);
}

.ar-status-stacks {
  position: absolute;
  top: -4px;
  right: -4px;
  font-size: 9px;
  font-weight: 800;
  background: #120f1a;
  border: 1px solid #c89b3c;
  color: #ffd43b;
  border-radius: 6px;
  padding: 0 3px;
  line-height: 1.2;
}

.ar-status-timer {
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 8.5px;
  font-weight: 700;
  color: #f8f9fa;
  text-shadow: 0 1px 2px #000;
}

.ar-stamina-cluster {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(12, 10, 18, 0.85);
  border: 1px solid rgba(200, 155, 60, 0.35);
  border-radius: 12px;
}

.ar-stamina-label {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #b7ad97;
}

.ar-stamina-pips {
  display: flex;
  gap: 4px;
}

.ar-stamina-pip {
  width: 24px;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(200, 155, 60, 0.42);
  border-radius: 2px;
  overflow: hidden;
  transform: skewX(-20deg);
}

.ar-stamina-pip-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #2f9e44, #8ce99a);
  box-shadow: 0 0 6px rgba(105, 219, 124, 0.55);
}

.ar-gold-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  background: rgba(14, 12, 20, 0.88);
  border: 1px solid rgba(200, 155, 60, 0.48);
  border-radius: 12px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12px;
  font-weight: 700;
  color: #ffd97d;
  font-variant-numeric: tabular-nums;
}

/* Main Ornate Pedestal Row */
.ar-action-pedestal {
  display: flex;
  align-items: flex-end;
  gap: 0;
  position: relative;
}

.ar-wing-ornament {
  width: 36px;
  height: 64px;
  margin-bottom: 8px;
  flex-shrink: 0;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.85));
}

/* Animated Liquid Health & Mana Globes */
.ar-globe-housing {
  position: relative;
  width: 104px;
  height: 104px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 35%, #221c2c 0%, #09070d 78%);
  border: 3px solid #c89b3c;
  box-shadow:
    0 6px 22px rgba(0, 0, 0, 0.95),
    inset 0 0 18px rgba(0, 0, 0, 0.92),
    0 0 0 2px #1a1422;
  flex-shrink: 0;
  z-index: 3;
  pointer-events: auto;
}

.ar-globe-housing.ar-hp-globe.ar-critical {
  border-color: #ff6b6b;
  box-shadow:
    0 0 20px rgba(224, 49, 49, 0.72),
    inset 0 0 18px rgba(0, 0, 0, 0.92);
}

.ar-globe-housing.ar-shielded::after {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 2px solid #74c0fc;
  box-shadow: 0 0 12px rgba(116, 192, 252, 0.75);
  pointer-events: none;
}

.ar-globe-clip {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  overflow: hidden;
  background: radial-gradient(circle at 50% 30%, rgba(30, 22, 38, 0.8), #060509 85%);
}

.ar-globe-liquid {
  position: absolute;
  left: -10%;
  width: 120%;
  bottom: 0;
  height: 100%;
  transition: height 0.14s ease-out;
}

.ar-hp-globe .ar-globe-liquid {
  background: linear-gradient(180deg, #ff4d4f 0%, #c92a2a 42%, #5c0a10 100%);
  box-shadow: 0 -4px 14px rgba(255, 77, 79, 0.65);
}

.ar-mana-globe .ar-globe-liquid {
  background: linear-gradient(180deg, #4dabf7 0%, #1d6fe8 44%, #0b2559 100%);
  box-shadow: 0 -4px 14px rgba(77, 171, 247, 0.65);
}

/* Phase 2: Specular Caustic Fluid Shimmer & Hit/Cast Ripples */
.ar-globe-caustics {
  position: absolute;
  inset: -35%;
  background:
    radial-gradient(circle at 30% 35%, rgba(255, 255, 255, 0.32) 0%, transparent 26%),
    radial-gradient(circle at 72% 62%, rgba(255, 240, 200, 0.24) 0%, transparent 28%),
    radial-gradient(circle at 48% 78%, rgba(255, 255, 255, 0.22) 0%, transparent 22%),
    conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(255, 255, 255, 0.16) 45deg, transparent 95deg, rgba(255, 255, 255, 0.14) 190deg, transparent 260deg, rgba(255, 255, 255, 0.18) 320deg, transparent 360deg);
  mix-blend-mode: screen;
  opacity: 0.62;
  pointer-events: none;
  animation: arCausticSwirl 7.5s linear infinite;
}

.ar-globe-caustics.ar-caustics-secondary {
  opacity: 0.42;
  animation: arCausticSwirlReverse 5.2s linear infinite;
}

@keyframes arCausticSwirl {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(180deg) scale(1.08); }
  100% { transform: rotate(360deg) scale(1); }
}

@keyframes arCausticSwirlReverse {
  0% { transform: rotate(360deg) scale(1.06); }
  50% { transform: rotate(180deg) scale(0.95); }
  100% { transform: rotate(0deg) scale(1.06); }
}

.ar-globe-ripple {
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  opacity: 0;
  pointer-events: none;
  z-index: 3;
}

.ar-globe-housing.ar-hit-ripple .ar-globe-ripple {
  border-color: #ffc9c9;
  box-shadow: 0 0 16px rgba(255, 107, 107, 0.9), inset 0 0 14px rgba(255, 255, 255, 0.75);
  animation: arGlobeShockRipple 0.48s cubic-bezier(0.16, 1, 0.3, 1);
}

.ar-globe-housing.ar-hit-ripple .ar-globe-liquid {
  animation: arLiquidSlosh 0.44s ease-out;
}

.ar-globe-housing.ar-cast-ripple .ar-globe-ripple {
  border-color: #a5d8ff;
  box-shadow: 0 0 16px rgba(77, 171, 247, 0.9), inset 0 0 12px rgba(255, 255, 255, 0.7);
  animation: arGlobeShockRipple 0.44s cubic-bezier(0.16, 1, 0.3, 1);
}

.ar-globe-housing.ar-heal-ripple .ar-globe-ripple {
  border-color: #8ce99a;
  box-shadow: 0 0 18px rgba(81, 207, 102, 0.9), inset 0 0 14px rgba(255, 243, 191, 0.8);
  animation: arGlobeShockRipple 0.55s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes arGlobeShockRipple {
  0% { opacity: 0.95; transform: scale(0.42); }
  100% { opacity: 0; transform: scale(1.08); }
}

@keyframes arLiquidSlosh {
  0% { transform: rotate(0deg); }
  28% { transform: rotate(-6deg) scaleY(1.04); }
  62% { transform: rotate(4.5deg) scaleY(0.98); }
  100% { transform: rotate(0deg); }
}

.ar-globe-wave {
  position: absolute;
  top: -9px;
  left: 0;
  width: 200%;
  height: 14px;
  animation: arWaveSlide 3.2s linear infinite;
}

.ar-globe-wave.ar-wave-back {
  top: -11px;
  opacity: 0.48;
  animation: arWaveSlideReverse 4.6s linear infinite;
}

@keyframes arWaveSlide {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

@keyframes arWaveSlideReverse {
  from { transform: translateX(-50%); }
  to { transform: translateX(0); }
}

.ar-globe-gloss {
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background:
    radial-gradient(ellipse 58% 34% at 36% 22%, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0.05) 60%, transparent 100%),
    radial-gradient(circle at 50% 50%, transparent 62%, rgba(0, 0, 0, 0.68) 100%);
  pointer-events: none;
}

.ar-globe-readout {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 4;
  text-shadow: 0 2px 5px #000, 0 0 8px rgba(0, 0, 0, 0.95);
}

.ar-globe-val {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 14px;
  font-weight: 800;
  color: #fff9eb;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.ar-globe-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(241, 233, 210, 0.78);
  margin-top: 2px;
}

/* Center Action Bridge between Globes */
.ar-center-bridge {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(22, 18, 31, 0.96) 0%, rgba(11, 9, 17, 0.98) 100%);
  border-top: 2px solid #c89b3c;
  border-bottom: 2px solid #8a6823;
  padding: 10px 16px 8px;
  margin: 0 -10px 8px;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.92), inset 0 1px 0 rgba(255, 235, 175, 0.22);
  z-index: 2;
  pointer-events: auto;
}

.ar-slots-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ar-divider-vert {
  width: 1px;
  height: 44px;
  background: linear-gradient(180deg, transparent, rgba(200, 155, 60, 0.65), transparent);
  margin: 0 3px;
}

/* Skill Slots & Potion Slot */
.ar-skill-slot,
.ar-potion-slot {
  position: relative;
  width: 54px;
  height: 54px;
  padding: 0;
  background: radial-gradient(circle at 50% 35%, #231d30 0%, #0d0b14 100%);
  border: 1.5px solid #9f7c35;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.85), 0 3px 8px rgba(0, 0, 0, 0.75);
  transition: transform 0.1s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  pointer-events: auto;
  color: #f1e9d2;
}

.ar-skill-slot:hover,
.ar-potion-slot:hover {
  border-color: #ffd97d;
  transform: translateY(-2px);
  box-shadow: 0 0 12px rgba(200, 155, 60, 0.45), inset 0 0 8px rgba(200, 155, 60, 0.2);
}

.ar-skill-slot:active,
.ar-potion-slot:active {
  transform: translateY(0) scale(0.96);
}

.ar-skill-slot.ar-ready-flash {
  animation: arSkillReadyFlash 0.42s ease-out;
}

@keyframes arSkillReadyFlash {
  0% { box-shadow: 0 0 0 0 rgba(255, 217, 125, 0.95), inset 0 0 18px rgba(255, 217, 125, 0.85); border-color: #ffffff; }
  100% { box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.85); border-color: #9f7c35; }
}

.ar-skill-icon-wrap {
  width: 38px;
  height: 38px;
  pointer-events: none;
  transition: filter 0.15s ease, opacity 0.15s ease;
}

.ar-skill-slot.ar-no-mana .ar-skill-icon-wrap {
  filter: saturate(0.25) brightness(0.55) hue-rotate(180deg);
  opacity: 0.72;
}

.ar-skill-slot.ar-no-mana {
  border-color: #2b4c7e;
}

.ar-skill-cd-sweep {
  position: absolute;
  inset: 0;
  border-radius: 4px;
  pointer-events: none;
  display: none;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 14px;
  font-weight: 800;
  color: #fff3bf;
  text-shadow: 0 1px 4px #000, 0 0 6px #000;
}

.ar-skill-slot.ar-on-cd .ar-skill-cd-sweep,
.ar-potion-slot.ar-on-cd .ar-skill-cd-sweep {
  display: flex;
}

.ar-hotkey-badge {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 5px;
  background: #14101d;
  border: 1px solid #c89b3c;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #f3dfb3;
  line-height: 1.2;
  pointer-events: none;
  z-index: 3;
}

.ar-mana-cost-pip {
  position: absolute;
  bottom: 2px;
  right: 3px;
  padding: 0 4px;
  border-radius: 2px;
  background: rgba(10, 22, 46, 0.9);
  border: 1px solid rgba(77, 171, 247, 0.55);
  font-size: 9px;
  font-weight: 700;
  color: #74c0fc;
  pointer-events: none;
}

.ar-skill-slot.ar-no-mana .ar-mana-cost-pip {
  color: #ff8787;
  border-color: rgba(255, 107, 107, 0.65);
}

.ar-potion-count {
  position: absolute;
  bottom: 2px;
  right: 3px;
  padding: 0 5px;
  border-radius: 3px;
  background: rgba(24, 10, 14, 0.92);
  border: 1px solid rgba(255, 135, 135, 0.55);
  font-size: 10px;
  font-weight: 800;
  color: #ffc9c9;
  pointer-events: none;
}

/* Hover Skill Tooltip */
.ar-skill-tooltip {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  width: 228px;
  padding: 9px 11px;
  background: linear-gradient(180deg, rgba(20, 16, 29, 0.98) 0%, rgba(10, 8, 16, 0.98) 100%);
  border: 1px solid #c89b3c;
  border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.95);
  text-align: left;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.14s ease;
  pointer-events: none;
  z-index: 20;
}

.ar-skill-slot:hover .ar-skill-tooltip {
  opacity: 1;
  visibility: visible;
}

.ar-tt-name {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12.5px;
  font-weight: 800;
  color: #ffd97d;
  margin-bottom: 3px;
}

.ar-tt-meta {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #a5b4fc;
  margin-bottom: 5px;
}

.ar-tt-desc {
  font-size: 10.5px;
  line-height: 1.35;
  color: #dcd3be;
  white-space: normal;
}

/* Quick Menu Buttons */
.ar-quick-menus {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ar-menu-btn {
  position: relative;
  width: 40px;
  height: 44px;
  padding: 6px 6px 10px;
  background: linear-gradient(180deg, #211b2d 0%, #100d18 100%);
  border: 1px solid rgba(200, 155, 60, 0.62);
  border-radius: 4px;
  color: #e8dab8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s ease, border-color 0.15s ease, color 0.15s ease;
  pointer-events: auto;
}

.ar-menu-btn:hover {
  border-color: #ffd97d;
  color: #fff9db;
  transform: translateY(-2px);
}

.ar-menu-btn.ar-bag-pop {
  animation: arBagCatchPop 0.44s cubic-bezier(0.22, 1, 0.36, 1);
  border-color: var(--bag-pop-color, #ffd43b);
  box-shadow: 0 0 18px var(--bag-pop-color, rgba(255, 212, 59, 0.85)), inset 0 0 10px var(--bag-pop-color, rgba(255, 212, 59, 0.45));
  color: #ffffff;
}

@keyframes arBagCatchPop {
  0% { transform: scale(1); }
  35% { transform: translateY(-4px) scale(1.26); }
  70% { transform: translateY(1px) scale(0.95); }
  100% { transform: translateY(0) scale(1); }
}

/* Phase 2: Flying Loot-to-Bag Orb & Floating Gear-Swap Micro-Banner */
.ar-flying-loot-orb {
  position: absolute;
  left: 0;
  top: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  pointer-events: none;
  will-change: transform, opacity;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 15;
  opacity: 0;
}

.ar-flying-loot-core {
  width: 12px;
  height: 12px;
  transform: rotate(45deg);
  border: 1.5px solid #ffffff;
  border-radius: 2px;
}

.ar-gear-swap-chip {
  position: absolute;
  bottom: 144px;
  left: 50%;
  transform: translate(-50%, 10px) scale(0.94);
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  background: linear-gradient(90deg, rgba(16, 12, 26, 0.94) 0%, rgba(28, 20, 38, 0.96) 50%, rgba(16, 12, 26, 0.94) 100%);
  border: 1px solid var(--gear-accent, #ffd43b);
  border-radius: 20px;
  box-shadow: 0 0 18px var(--gear-glow, rgba(255, 212, 59, 0.35)), 0 6px 18px rgba(0, 0, 0, 0.88);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.22s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 9;
}

.ar-gear-swap-chip.ar-visible {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}

.ar-gear-swap-diamond {
  width: 10px;
  height: 10px;
  transform: rotate(45deg);
  background: var(--gear-accent, #ffd43b);
  border: 1px solid #ffffff;
  box-shadow: 0 0 8px var(--gear-accent, #ffd43b);
  flex-shrink: 0;
}

.ar-gear-swap-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: var(--gear-accent, #ffe8a3);
  white-space: nowrap;
}

.ar-gear-swap-meta {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #cfc4ad;
  text-transform: uppercase;
  white-space: nowrap;
}

.ar-menu-btn-key {
  position: absolute;
  bottom: 1px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 8.5px;
  font-weight: 700;
  color: #b8a98a;
  letter-spacing: 0.03em;
}

.ar-unspent-badge {
  position: absolute;
  top: -6px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: linear-gradient(180deg, #ff922b 0%, #d9480f 100%);
  border: 1px solid #fff3bf;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  display: none;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 10px rgba(255, 146, 43, 0.85);
  animation: arBadgeBounce 1.2s ease-in-out infinite;
}

.ar-unspent-badge.ar-has-points {
  display: inline-flex;
}

@keyframes arBadgeBounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.16); }
}

/* Full-Width Golden XP Bar + Level Medallion */
.ar-xp-bar-row {
  position: relative;
  width: 100%;
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ar-level-crest {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 8px;
  background: linear-gradient(180deg, #3b2c14 0%, #1a1308 100%);
  border: 1px solid #e3b34c;
  border-radius: 3px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10.5px;
  font-weight: 800;
  color: #ffe599;
  white-space: nowrap;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
}

.ar-xp-track {
  position: relative;
  flex: 1;
  height: 7px;
  background: #08070c;
  border: 1px solid rgba(200, 155, 60, 0.55);
  border-radius: 3px;
  overflow: hidden;
}

.ar-xp-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #9c6f19 0%, #e5b244 65%, #fff3bf 100%);
  box-shadow: 0 0 8px rgba(255, 212, 59, 0.65);
  transition: width 0.2s ease-out;
}

.ar-xp-segments {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0%,
    transparent calc(10% - 1px),
    rgba(8, 7, 12, 0.72) calc(10% - 1px),
    rgba(8, 7, 12, 0.72) 10%
  );
  pointer-events: none;
}

.ar-xp-readout {
  font-size: 9.5px;
  font-weight: 600;
  color: #cbbd9d;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* =========================================================
   PHASE 3 EXPANSION: MASTERY, STAGGER, REACTIONS, COMPANIONS,
   WORLD EVENTS, MYTHIC LOOT, & SANCTUARY DPS METER
   ========================================================= */

/* Mythic Primal & Rune Ground Loot Pills */
.ar-loot-pill.ar-rarity-mythic {
  background: linear-gradient(90deg, rgba(64, 6, 18, 0.96), rgba(24, 8, 16, 0.94));
  box-shadow: 0 0 18px rgba(255, 30, 66, 0.65), 0 3px 10px rgba(0, 0, 0, 0.92);
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-weight: 800;
}

.ar-loot-pill.ar-rarity-rune {
  background: linear-gradient(90deg, rgba(48, 36, 10, 0.95), rgba(18, 14, 10, 0.94));
  box-shadow: 0 0 12px rgba(255, 224, 102, 0.45), 0 3px 10px rgba(0, 0, 0, 0.9);
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-weight: 700;
}

/* Pooled Elemental Reaction Callouts */
.ar-reaction-callout {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  will-change: transform, opacity;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 3px 10px;
  border-radius: 4px;
  background: radial-gradient(ellipse at center, rgba(14, 10, 24, 0.88) 0%, rgba(8, 6, 14, 0.4) 85%, transparent 100%);
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-weight: 900;
  font-size: 15px;
  letter-spacing: 0.1em;
  white-space: nowrap;
  text-shadow: 0 0 14px currentColor, 0 2px 5px #000, -1px -1px 0 #050408, 1px 1px 0 #050408;
  opacity: 0;
  z-index: 6;
}

.ar-reaction-dmg {
  font-size: 11px;
  font-weight: 800;
  color: #fff9db;
  letter-spacing: 0.04em;
  margin-top: 1px;
}

/* World-Space [F / LMB] EXECUTE! Prompt */
.ar-execute-prompt {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  will-change: transform, opacity;
  padding: 4px 12px;
  background: linear-gradient(90deg, rgba(120, 14, 24, 0.96), rgba(180, 92, 16, 0.96));
  border: 1.5px solid #ffe066;
  border-radius: 4px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12.5px;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: #fff9db;
  box-shadow: 0 0 18px rgba(255, 212, 59, 0.8), 0 4px 12px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
  opacity: 0;
  z-index: 6;
  animation: arExecuteFlash 0.42s ease-in-out infinite alternate;
}

@keyframes arExecuteFlash {
  from { transform: scale(1); filter: brightness(1); }
  to { transform: scale(1.06); filter: brightness(1.22); }
}

/* Boss Stagger Bar & Execute Banner beneath Boss HP */
.ar-boss-stagger-row {
  display: none;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.ar-boss-stagger-row.ar-visible {
  display: flex;
}

.ar-boss-stagger-track {
  position: relative;
  flex: 1;
  height: 7px;
  background: #0b0910;
  border: 1px solid rgba(255, 212, 59, 0.52);
  border-radius: 2px;
  overflow: hidden;
}

.ar-boss-stagger-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #d97706 0%, #fcc419 70%, #fff3bf 100%);
  transition: width 0.08s linear;
}

.ar-boss-stagger-row.ar-staggered .ar-boss-stagger-fill {
  background: linear-gradient(90deg, #ff1e42 0%, #ff922b 50%, #fff3bf 100%);
  box-shadow: 0 0 12px rgba(255, 212, 59, 0.9);
}

.ar-boss-stagger-label {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.07em;
  color: #ffd97d;
  white-space: nowrap;
}

.ar-boss-stagger-row.ar-staggered .ar-boss-stagger-label {
  color: #fff9db;
  background: linear-gradient(90deg, #c92a2a, #e67700);
  padding: 1px 8px;
  border: 1px solid #ffe066;
  border-radius: 3px;
  box-shadow: 0 0 14px rgba(255, 212, 59, 0.78);
  animation: arExecuteFlash 0.36s ease-in-out infinite alternate;
}

/* [R] Awakening Fury Gauge & [V] Parry Badge near Action Bar */
.ar-mastery-cluster {
  display: none;
  align-items: center;
  gap: 8px;
}

.ar-mastery-cluster.ar-visible {
  display: inline-flex;
}

.ar-fury-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 3px 6px;
  min-width: 148px;
  background: rgba(16, 11, 24, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.55);
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  pointer-events: auto;
}

.ar-fury-fill-bg {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: linear-gradient(90deg, rgba(156, 54, 181, 0.55), rgba(240, 140, 0, 0.65));
  transition: width 0.12s ease-out;
  pointer-events: none;
}

.ar-fury-pill.ar-fury-ready {
  border-color: #ffd43b;
  box-shadow: 0 0 14px rgba(255, 212, 59, 0.68);
}

.ar-fury-pill.ar-fury-awakened {
  border-color: #f3d9fa;
  box-shadow: 0 0 18px rgba(218, 119, 242, 0.88), inset 0 0 10px rgba(255, 212, 59, 0.45);
}

.ar-fury-pill.ar-fury-awakened .ar-fury-fill-bg {
  background: linear-gradient(90deg, rgba(190, 75, 219, 0.75), rgba(255, 212, 59, 0.8));
}

.ar-mastery-key {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  background: #1a1326;
  border: 1px solid #e3b34c;
  border-radius: 3px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 9.5px;
  font-weight: 800;
  color: #ffe8a3;
}

.ar-fury-text {
  position: relative;
  z-index: 2;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #fff3d6;
  white-space: nowrap;
}

.ar-parry-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 6px;
  background: rgba(14, 16, 26, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.55);
  border-radius: 14px;
  cursor: pointer;
  pointer-events: auto;
}

.ar-parry-pill.ar-parry-active {
  border-color: #fff3bf;
  background: linear-gradient(90deg, rgba(102, 77, 18, 0.92), rgba(45, 34, 12, 0.92));
  box-shadow: 0 0 15px rgba(255, 224, 102, 0.85);
}

.ar-parry-pill.ar-parry-cd {
  opacity: 0.68;
  border-color: rgba(140, 140, 160, 0.45);
}

.ar-parry-text {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #ffe8a3;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Top-Left Companion Mini-Status & Sanctuary Live DPS Meter */
.ar-top-left {
  position: absolute;
  top: 14px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 232px;
  z-index: 6;
  pointer-events: none;
}

.ar-companion-card,
.ar-dps-meter-card {
  display: none;
  flex-direction: column;
  gap: 6px;
  padding: 8px 11px;
  background: linear-gradient(180deg, rgba(16, 14, 25, 0.92) 0%, rgba(9, 8, 15, 0.94) 100%);
  border: 1px solid rgba(200, 155, 60, 0.52);
  border-left: 3px solid #63e6be;
  border-radius: 4px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.82);
}

.ar-companion-card.ar-visible,
.ar-dps-meter-card.ar-visible {
  display: flex;
}

.ar-dps-meter-card {
  border-left-color: #ff922b;
}

.ar-comp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.ar-comp-name {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11.5px;
  font-weight: 800;
  color: #f3e8ce;
}

.ar-comp-lvl {
  font-size: 9.5px;
  font-weight: 700;
  color: #63e6be;
  background: rgba(20, 48, 40, 0.75);
  padding: 1px 5px;
  border-radius: 3px;
}

.ar-comp-hp-track {
  width: 100%;
  height: 6px;
  background: #08070d;
  border: 1px solid rgba(200, 155, 60, 0.42);
  border-radius: 2px;
  overflow: hidden;
}

.ar-comp-hp-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #1b9aaa, #63e6be);
  transition: width 0.12s linear;
}

.ar-comp-pet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: #c5b99e;
}

.ar-dps-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: #ff922b;
  text-transform: uppercase;
}

.ar-dps-main-val {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 20px;
  font-weight: 900;
  color: #ffd43b;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.ar-dps-sub-stats {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #d0c6b0;
  font-variant-numeric: tabular-nums;
}

/* World Event Trackers Stack (Butcher, Goblin, Escort, Rift, Colosseum, Obelisk Pacts) */
.ar-world-events-stack {
  display: none;
  flex-direction: column;
  gap: 6px;
}

.ar-world-events-stack.ar-visible {
  display: flex;
}

.ar-event-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 9px;
  background: rgba(16, 12, 24, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.5);
  border-left-width: 3px;
  border-radius: 4px;
  font-size: 10.5px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.8);
}

.ar-event-card.ar-ev-butcher {
  background: linear-gradient(90deg, rgba(68, 8, 14, 0.95), rgba(24, 8, 12, 0.92));
  border-color: #ff4d4f;
  animation: arCursedPulse 1s ease-in-out infinite;
}

.ar-event-card.ar-ev-goblin {
  border-left-color: #ffd43b;
}

.ar-event-card.ar-ev-escort {
  border-left-color: #66d9e8;
}

.ar-event-card.ar-ev-rift {
  border-left-color: #da77f2;
}

.ar-event-card.ar-ev-colosseum {
  border-left-color: #ff6b35;
}

.ar-ev-hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-weight: 800;
  font-size: 10.5px;
  color: #fff3d6;
}

.ar-ev-bar {
  width: 100%;
  height: 5px;
  background: rgba(0, 0, 0, 0.65);
  border-radius: 2px;
  overflow: hidden;
}

.ar-ev-bar-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #22b8cf, #99e9f2);
}

.ar-pacts-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ar-pact-chip {
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(20, 14, 30, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.55);
  font-size: 9.5px;
  font-weight: 700;
  color: #ffe8a3;
  pointer-events: auto;
}
`;
