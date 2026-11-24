export const MENUS_STYLE_ID = 'abyssal-realms-ui-menus-styles';

export const MENUS_CSS = `
.ar-menus-root {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  font-family: var(--font-body, 'Inter', 'Segoe UI', system-ui, sans-serif);
  color: var(--text-primary, #f1e9d2);
  z-index: 20;
  overflow: hidden;
}

.ar-menus-root.is-hidden {
  display: none;
  pointer-events: none;
}

/* Active screen / backdrop captures pointer events cleanly */
.ar-screen-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 50% 25%, rgba(36, 24, 52, 0.52) 0%, rgba(7, 6, 10, 0.86) 72%),
    rgba(6, 5, 10, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  animation: arFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.ar-screen-backdrop.is-title {
  background:
    radial-gradient(ellipse at 50% 18%, rgba(200, 155, 60, 0.16) 0%, transparent 55%),
    radial-gradient(ellipse at 20% 80%, rgba(201, 42, 42, 0.14) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 80%, rgba(156, 54, 181, 0.14) 0%, transparent 50%),
    linear-gradient(180deg, rgba(7, 6, 11, 0.88) 0%, rgba(11, 8, 17, 0.94) 55%, rgba(5, 4, 8, 0.98) 100%);
  backdrop-filter: blur(6px);
}

.ar-screen-backdrop.is-death {
  background:
    radial-gradient(circle at 50% 42%, rgba(160, 18, 24, 0.36) 0%, rgba(12, 4, 6, 0.92) 68%),
    rgba(6, 2, 4, 0.86);
  backdrop-filter: blur(10px);
}

.ar-screen-backdrop.is-victory {
  background:
    radial-gradient(circle at 50% 35%, rgba(235, 182, 68, 0.28) 0%, rgba(32, 18, 52, 0.88) 65%),
    rgba(8, 6, 14, 0.85);
  backdrop-filter: blur(10px);
}

@keyframes arFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes arSpringModalIn {
  0% { opacity: 0; transform: scale(0.935) translateY(14px); }
  65% { opacity: 1; transform: scale(1.012) translateY(-2px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes arTabContentSpring {
  0% { opacity: 0; transform: translateY(8px) scale(0.992); }
  70% { opacity: 1; transform: translateY(-1px) scale(1.002); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes arSlotEquipPop {
  0% { transform: scale(0.82); }
  55% { transform: scale(1.16); }
  100% { transform: scale(1); }
}

@keyframes arShockwaveRing {
  0% {
    opacity: 0.98;
    transform: translate(-50%, -50%) scale(0.45);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(2.15);
  }
}

@keyframes arStatPopGreen {
  0% {
    transform: scale(1);
    background: rgba(64, 192, 87, 0.38);
  }
  40% {
    transform: scale(1.045);
    background: rgba(64, 192, 87, 0.28);
  }
  100% {
    transform: scale(1);
    background: transparent;
  }
}

@keyframes arStatPopRed {
  0% {
    transform: scale(1);
    background: rgba(224, 49, 49, 0.38);
  }
  40% {
    transform: scale(1.035);
    background: rgba(224, 49, 49, 0.25);
  }
  100% {
    transform: scale(1);
    background: transparent;
  }
}

@keyframes arAnvilSparkFly {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) rotate(var(--spark-angle, 0deg)) translateX(4px) scale(1.15);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) rotate(var(--spark-angle, 0deg)) translateX(var(--spark-dist, 64px)) scale(0.2);
  }
}

@keyframes arAnvilCardForge {
  0% { transform: scale(0.98); box-shadow: 0 0 0 rgba(255, 169, 77, 0); }
  45% { transform: scale(1.022); box-shadow: 0 0 32px rgba(255, 169, 77, 0.65), inset 0 0 24px rgba(255, 146, 43, 0.35); }
  100% { transform: scale(1); box-shadow: 0 0 0 rgba(255, 169, 77, 0); }
}

@keyframes arPulseGold {
  0%, 100% { box-shadow: 0 0 14px rgba(200, 155, 60, 0.28), inset 0 0 12px rgba(200, 155, 60, 0.12); }
  50% { box-shadow: 0 0 26px rgba(235, 186, 78, 0.56), inset 0 0 18px rgba(200, 155, 60, 0.24); }
}

@keyframes arCrownFloat {
  0%, 100% { transform: translateY(0px); filter: drop-shadow(0 0 18px rgba(200, 155, 60, 0.45)); }
  50% { transform: translateY(-5px); filter: drop-shadow(0 0 28px rgba(255, 196, 82, 0.72)); }
}

/* Custom Dark-Fantasy Scrollbars */
.ar-menus-root ::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}
.ar-menus-root ::-webkit-scrollbar-track {
  background: rgba(8, 7, 13, 0.75);
  border-left: 1px solid rgba(200, 155, 60, 0.14);
}
.ar-menus-root ::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(200, 155, 60, 0.58), rgba(132, 96, 34, 0.65));
  border-radius: 3px;
}
.ar-menus-root ::-webkit-scrollbar-thumb:hover {
  background: rgba(226, 178, 76, 0.85);
}

/* Ornate Glassmorphic Window Shell */
.ar-modal-window {
  position: relative;
  width: min(1320px, 95vw);
  height: min(840px, 92vh);
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(180deg, rgba(22, 18, 31, 0.94) 0%, rgba(12, 10, 18, 0.96) 100%);
  border: 1px solid rgba(200, 155, 60, 0.52);
  border-radius: 6px;
  box-shadow:
    0 28px 80px rgba(0, 0, 0, 0.88),
    0 0 0 1px rgba(255, 224, 150, 0.08) inset,
    0 0 42px rgba(200, 155, 60, 0.12);
  overflow: hidden;
}

.ar-modal-window::before {
  content: '';
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(200, 155, 60, 0.16);
  border-radius: 4px;
  pointer-events: none;
  z-index: 2;
}

.ar-modal-window.is-entering {
  animation: arSpringModalIn 0.28s cubic-bezier(0.22, 1.28, 0.36, 1) both;
}

.ar-tab-spring {
  animation: arTabContentSpring 0.24s cubic-bezier(0.22, 1.25, 0.36, 1) both;
}

.ar-modal-window.is-compact {
  width: min(620px, 92vw);
  height: auto;
  max-height: 90vh;
}

.ar-modal-window.is-medium {
  width: min(760px, 92vw);
  height: auto;
  max-height: 90vh;
}

/* Shared Top Navigation Bar inside In-Game Panels */
.ar-window-topbar {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  background:
    linear-gradient(90deg, rgba(16, 13, 24, 0.96) 0%, rgba(30, 23, 42, 0.92) 50%, rgba(16, 13, 24, 0.96) 100%);
  border-bottom: 1px solid rgba(200, 155, 60, 0.38);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
  flex-shrink: 0;
}

.ar-topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 190px;
}

.ar-topbar-crest {
  width: 28px;
  height: 28px;
  color: #e6b956;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ar-topbar-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #f4e6c3;
}

.ar-topbar-subtitle {
  font-size: 11px;
  color: var(--text-muted, #9e937b);
  letter-spacing: 0.04em;
}

.ar-topbar-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ar-nav-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 15px;
  background: rgba(14, 11, 22, 0.72);
  border: 1px solid rgba(200, 155, 60, 0.25);
  border-radius: 4px;
  color: #b7ab93;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.16s ease;
}

.ar-nav-tab:hover {
  color: #f6ecd4;
  border-color: rgba(200, 155, 60, 0.62);
  background: rgba(38, 29, 52, 0.82);
}

.ar-nav-tab.is-active {
  color: #ffd97d;
  background: linear-gradient(180deg, rgba(72, 52, 24, 0.72) 0%, rgba(32, 23, 16, 0.88) 100%);
  border-color: #e0b04f;
  box-shadow: 0 0 16px rgba(200, 155, 60, 0.28), inset 0 1px 0 rgba(255, 232, 175, 0.25);
}

.ar-nav-hotkey {
  font-family: var(--font-body, sans-serif);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.48);
  border: 1px solid rgba(200, 155, 60, 0.3);
  color: #cbb98e;
}

.ar-nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: linear-gradient(135deg, #f59f00, #d9480f);
  color: #fff;
  font-family: var(--font-body, sans-serif);
  font-size: 10px;
  font-weight: 800;
  box-shadow: 0 0 8px rgba(245, 159, 0, 0.6);
}

.ar-topbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.ar-gold-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 4px;
  background: rgba(12, 10, 16, 0.85);
  border: 1px solid rgba(226, 176, 68, 0.42);
  color: #ffd97d;
  font-weight: 700;
  font-size: 13px;
}

.ar-close-btn {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(28, 16, 22, 0.82);
  border: 1px solid rgba(200, 155, 60, 0.38);
  border-radius: 4px;
  color: #d9ccb2;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ar-close-btn:hover {
  background: rgba(168, 32, 38, 0.85);
  border-color: #ff8787;
  color: #fff;
  transform: scale(1.04);
}

/* Ornate Buttons */
.ar-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 4px;
  border: 1px solid rgba(200, 155, 60, 0.48);
  background: linear-gradient(180deg, rgba(38, 31, 52, 0.92) 0%, rgba(20, 16, 29, 0.96) 100%);
  color: #f3e8ce;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.16s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.ar-btn:hover:not(:disabled) {
  border-color: #f0c463;
  color: #fff8e6;
  background: linear-gradient(180deg, rgba(58, 46, 76, 0.95) 0%, rgba(30, 23, 44, 0.98) 100%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 14px rgba(200, 155, 60, 0.3);
  transform: translateY(-1px);
}

.ar-btn:active:not(:disabled) {
  transform: translateY(0px);
}

.ar-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  filter: grayscale(0.45);
}

.ar-btn-primary {
  background: linear-gradient(180deg, #b82828 0%, #731419 100%);
  border-color: #e6a84c;
  color: #fff4df;
  box-shadow: 0 6px 22px rgba(184, 40, 40, 0.42), inset 0 1px 0 rgba(255, 220, 175, 0.32);
}

.ar-btn-primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #d63333 0%, #8e1920 100%);
  border-color: #ffd97d;
  box-shadow: 0 8px 28px rgba(209, 46, 46, 0.62), 0 0 20px rgba(230, 168, 76, 0.42);
}

.ar-btn-gold {
  background: linear-gradient(180deg, #9c7125 0%, #5c3f11 100%);
  border-color: #f2c96b;
  color: #fff7e2;
  box-shadow: 0 5px 18px rgba(200, 155, 60, 0.3), inset 0 1px 0 rgba(255, 240, 195, 0.35);
}

.ar-btn-gold:hover:not(:disabled) {
  background: linear-gradient(180deg, #b8872d 0%, #734f15 100%);
  border-color: #ffe299;
  box-shadow: 0 6px 24px rgba(224, 176, 79, 0.5);
}

.ar-btn-emerald {
  background: linear-gradient(180deg, #27793a 0%, #164923 100%);
  border-color: #74d688;
  color: #edfff1;
  box-shadow: 0 6px 20px rgba(47, 158, 68, 0.34), inset 0 1px 0 rgba(200, 255, 210, 0.28);
}

.ar-btn-emerald:hover:not(:disabled) {
  background: linear-gradient(180deg, #319649 0%, #1d5d2d 100%);
  border-color: #a3f2b3;
  box-shadow: 0 8px 26px rgba(47, 158, 68, 0.52);
}

@keyframes arCoopShimmer {
  0%, 100% {
    box-shadow: 0 6px 22px rgba(59, 130, 246, 0.36), 0 0 14px rgba(156, 54, 181, 0.28), inset 0 1px 0 rgba(208, 235, 255, 0.35);
  }
  50% {
    box-shadow: 0 8px 28px rgba(77, 171, 247, 0.58), 0 0 22px rgba(204, 93, 232, 0.45), inset 0 1px 0 rgba(235, 250, 255, 0.5);
  }
}

.ar-btn-coop {
  background: linear-gradient(135deg, #1b4f9c 0%, #5f278f 55%, #19376d 100%);
  border-color: #74c0fc;
  color: #eef8ff;
  animation: arCoopShimmer 2.8s ease-in-out infinite;
}

.ar-btn-coop:hover:not(:disabled) {
  background: linear-gradient(135deg, #2464c4 0%, #7932b5 55%, #224b94 100%);
  border-color: #d0ebff;
  color: #ffffff;
  transform: translateY(-1px) scale(1.015);
}

.ar-btn-danger {
  background: linear-gradient(180deg, rgba(92, 24, 30, 0.9) 0%, rgba(48, 12, 17, 0.95) 100%);
  border-color: rgba(224, 79, 79, 0.55);
  color: #ffc9c9;
}

.ar-btn-danger:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(138, 32, 40, 0.95) 0%, rgba(76, 16, 24, 0.98) 100%);
  border-color: #ff8787;
  color: #fff;
}

.ar-btn-sm {
  padding: 6px 11px;
  font-size: 11px;
  letter-spacing: 0.06em;
}

/* =========================================================
   1. TITLE & HERO SELECTION SCREEN
   ========================================================= */
.ar-title-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

.ar-title-shell {
  position: relative;
  z-index: 2;
  width: min(1240px, 95vw);
  max-height: 96vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
}

.ar-title-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
}

.ar-title-crown {
  width: 72px;
  height: 54px;
  animation: arCrownFloat 4.2s ease-in-out infinite;
}

.ar-title-eyebrow {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: #c89b3c;
}

.ar-title-main {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: clamp(28px, 4vw, 48px);
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  background: linear-gradient(180deg, #fff6dc 0%, #e7be67 52%, #9e6b20 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.9));
  line-height: 1.06;
}

.ar-title-sub {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: clamp(13px, 1.6vw, 18px);
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: #d7c5a1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ar-title-sub::before,
.ar-title-sub::after {
  content: '';
  width: 48px;
  height: 1px;
  background: linear-gradient(90deg, transparent, #c89b3c, transparent);
}

/* 3-Card Hero Selector */
.ar-hero-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  width: 100%;
}

@media (max-width: 920px) {
  .ar-hero-grid {
    grid-template-columns: 1fr;
  }
}

.ar-hero-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(22, 18, 32, 0.88) 0%, rgba(11, 9, 17, 0.95) 100%);
  border: 1px solid rgba(200, 155, 60, 0.28);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

.ar-hero-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--hero-accent, #c89b3c);
  opacity: 0.45;
  transition: opacity 0.2s ease;
}

.ar-hero-card:hover {
  transform: translateY(-3px);
  border-color: rgba(226, 180, 84, 0.65);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.72), 0 0 22px var(--hero-glow, rgba(200, 155, 60, 0.22));
}

.ar-hero-card.is-selected {
  border-color: #f3c868;
  background:
    radial-gradient(circle at 50% 0%, var(--hero-glow, rgba(200, 155, 60, 0.26)) 0%, transparent 65%),
    linear-gradient(180deg, rgba(31, 25, 44, 0.96) 0%, rgba(14, 11, 22, 0.98) 100%);
  box-shadow:
    0 16px 38px rgba(0, 0, 0, 0.82),
    0 0 28px var(--hero-glow, rgba(200, 155, 60, 0.35)),
    inset 0 0 0 1px rgba(255, 222, 148, 0.28);
  transform: translateY(-4px);
}

.ar-hero-card.is-selected::before {
  opacity: 1;
  height: 4px;
}

.ar-hero-card-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ar-hero-emblem {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle, rgba(35, 28, 48, 0.95) 0%, rgba(12, 10, 18, 0.98) 100%);
  border: 1px solid var(--hero-accent, #c89b3c);
  box-shadow: 0 0 16px var(--hero-glow, rgba(200, 155, 60, 0.3));
  flex-shrink: 0;
}

.ar-hero-card-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 19px;
  font-weight: 700;
  color: #fff3d6;
  letter-spacing: 0.06em;
}

.ar-hero-card-sub {
  font-size: 11.5px;
  color: #b8aa8f;
  line-height: 1.3;
}

.ar-hero-selected-pill {
  margin-left: auto;
  padding: 3px 8px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: rgba(200, 155, 60, 0.22);
  border: 1px solid rgba(240, 196, 99, 0.65);
  color: #ffe094;
}

.ar-hero-lore {
  font-size: 12px;
  line-height: 1.45;
  color: #cfc3ab;
}

.ar-hero-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 4px;
  background: rgba(8, 7, 14, 0.72);
  border: 1px solid rgba(200, 155, 60, 0.18);
  font-size: 11.5px;
}

.ar-hero-meta-label {
  color: #9e937b;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.08em;
}

.ar-hero-meta-val {
  color: #f4e6c3;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.ar-hero-attrs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px 10px;
  padding-top: 2px;
}

.ar-hero-attr-bar {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ar-hero-attr-head {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: #c5b89e;
}

.ar-hero-attr-head strong {
  color: #fff1cf;
}

.ar-hero-attr-track {
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.ar-hero-attr-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--attr-color, #c89b3c);
}

.ar-hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: auto;
}

.ar-hero-tag {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(200, 155, 60, 0.22);
  color: #d7c8ab;
}

.ar-title-cta-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 14px;
  padding: 4px 0;
}

.ar-title-cta-btn {
  min-width: 240px;
  padding: 13px 28px;
  font-size: 15px;
  letter-spacing: 0.13em;
}

.ar-controls-guide {
  width: 100%;
  padding: 10px 16px;
  border-radius: 5px;
  background: rgba(11, 9, 18, 0.82);
  border: 1px solid rgba(200, 155, 60, 0.24);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 18px;
}

.ar-controls-guide-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #e0b04f;
}

.ar-control-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: #cfc3ab;
}

.ar-keycap {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  background: linear-gradient(180deg, #272235 0%, #15121e 100%);
  border: 1px solid rgba(200, 155, 60, 0.42);
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
  color: #ffe39e;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

/* =========================================================
   2. CHARACTER, INVENTORY & BLACKSMITH PANEL
   ========================================================= */
.ar-inv-layout {
  position: relative;
  z-index: 3;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 315px 355px minmax(0, 1fr);
  gap: 14px;
  padding: 14px 18px;
  overflow: hidden;
}

@media (max-width: 1140px) {
  .ar-inv-layout {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
}

.ar-subpanel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgba(10, 8, 16, 0.72);
  border: 1px solid rgba(200, 155, 60, 0.24);
  border-radius: 5px;
  overflow: hidden;
}

.ar-subpanel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 13px;
  background: linear-gradient(90deg, rgba(32, 24, 44, 0.85) 0%, rgba(16, 13, 24, 0.85) 100%);
  border-bottom: 1px solid rgba(200, 155, 60, 0.24);
  flex-shrink: 0;
}

.ar-subpanel-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #ecc875;
}

.ar-subpanel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Hero Summary Banner */
.ar-char-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 4px;
  background: linear-gradient(135deg, rgba(36, 27, 50, 0.8) 0%, rgba(15, 12, 24, 0.9) 100%);
  border: 1px solid rgba(200, 155, 60, 0.3);
}

.ar-char-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ar-char-name {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 15px;
  font-weight: 700;
  color: #fff3d6;
}

.ar-char-class-tag {
  font-size: 11px;
  color: #cbb994;
  text-transform: capitalize;
}

.ar-level-badge {
  padding: 3px 8px;
  border-radius: 3px;
  background: rgba(200, 155, 60, 0.22);
  border: 1px solid rgba(235, 186, 78, 0.6);
  color: #ffe299;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11.5px;
  font-weight: 700;
}

.ar-xp-bar-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ar-xp-bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: #b3a68c;
}

.ar-xp-bar-track {
  height: 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  border: 1px solid rgba(200, 155, 60, 0.25);
  overflow: hidden;
}

.ar-xp-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #b88328, #ffd97d);
}

/* Attributes Block */
.ar-unspent-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(220, 148, 28, 0.18);
  border: 1px solid rgba(245, 178, 56, 0.65);
  color: #ffe39e;
  font-size: 11.5px;
  font-weight: 700;
  animation: arPulseGold 2.2s infinite;
}

.ar-attr-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ar-attr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 9px;
  border-radius: 4px;
  background: rgba(18, 15, 28, 0.82);
  border: 1px solid rgba(200, 155, 60, 0.18);
}

.ar-attr-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ar-attr-icon {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
}

.ar-attr-name {
  font-size: 12.5px;
  font-weight: 700;
  color: #f3e7cd;
}

.ar-attr-desc {
  font-size: 10px;
  color: #968b74;
}

.ar-attr-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ar-attr-val {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 15px;
  font-weight: 700;
  color: #ffd97d;
  min-width: 28px;
  text-align: right;
}

.ar-attr-plus {
  width: 25px;
  height: 25px;
  border-radius: 4px;
  border: 1px solid #f0c463;
  background: linear-gradient(180deg, #b8872d 0%, #6e4c14 100%);
  color: #fff8e6;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.14s ease;
}

.ar-attr-plus:hover:not(:disabled) {
  transform: scale(1.1);
  background: linear-gradient(180deg, #d69f38 0%, #8c621a 100%);
  box-shadow: 0 0 12px rgba(240, 196, 99, 0.65);
}

.ar-attr-plus:disabled {
  opacity: 0.22;
  cursor: default;
  border-color: rgba(200, 155, 60, 0.25);
  background: rgba(30, 26, 40, 0.5);
}

/* Derived Stats */
.ar-stats-section-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #c89b3c;
  padding-bottom: 3px;
  border-bottom: 1px solid rgba(200, 155, 60, 0.18);
  margin-top: 4px;
}

.ar-stats-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 3px;
}

.ar-stat-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  padding: 3px 6px;
  border-radius: 3px;
}

.ar-stat-line:nth-child(odd) {
  background: rgba(255, 255, 255, 0.025);
}

.ar-stat-line span {
  color: #b7ab93;
}

.ar-stat-line strong {
  color: #f5ebd4;
  font-weight: 600;
}

/* Paper-Doll 8-Slot Layout */
.ar-paperdoll-stage {
  position: relative;
  display: grid;
  grid-template-columns: 74px 1fr 74px;
  grid-template-rows: repeat(4, 72px);
  gap: 10px;
  align-items: center;
  justify-items: center;
  padding: 10px 8px;
  background:
    radial-gradient(circle at 50% 48%, rgba(200, 155, 60, 0.11) 0%, rgba(12, 10, 20, 0.92) 70%);
  border: 1px solid rgba(200, 155, 60, 0.22);
  border-radius: 5px;
}

.ar-paperdoll-silhouette {
  grid-column: 2;
  grid-row: 1 / 5;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0.72;
}

/* Item Slot Cell (used in Paper Doll & 40-Slot Grid) */
.ar-item-slot {
  position: relative;
  width: 66px;
  height: 66px;
  border-radius: 5px;
  background: radial-gradient(circle at 50% 35%, rgba(30, 25, 44, 0.9) 0%, rgba(11, 9, 18, 0.96) 100%);
  border: 1px solid rgba(200, 155, 60, 0.24);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.14s ease;
  overflow: hidden;
}

.ar-item-slot.is-inv-cell {
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
  min-height: 52px;
}

.ar-item-slot:hover {
  transform: translateY(-1px) scale(1.03);
  border-color: #f0c463;
  z-index: 2;
}

.ar-item-slot.is-selected {
  outline: 2px solid #ffe08a;
  outline-offset: 1px;
  box-shadow: 0 0 18px rgba(255, 217, 125, 0.55);
}

.ar-item-slot.rarity-common {
  border-color: rgba(208, 208, 208, 0.55);
  box-shadow: inset 0 0 12px rgba(208, 208, 208, 0.12);
}
.ar-item-slot.rarity-uncommon {
  border-color: rgba(64, 192, 87, 0.72);
  background: radial-gradient(circle at 50% 35%, rgba(32, 82, 46, 0.45) 0%, rgba(11, 14, 13, 0.96) 100%);
  box-shadow: inset 0 0 14px rgba(64, 192, 87, 0.2);
}
.ar-item-slot.rarity-rare {
  border-color: rgba(51, 154, 240, 0.8);
  background: radial-gradient(circle at 50% 35%, rgba(26, 68, 118, 0.52) 0%, rgba(10, 13, 22, 0.96) 100%);
  box-shadow: inset 0 0 16px rgba(51, 154, 240, 0.24);
}
.ar-item-slot.rarity-epic {
  border-color: rgba(190, 75, 219, 0.85);
  background: radial-gradient(circle at 50% 35%, rgba(88, 30, 112, 0.56) 0%, rgba(14, 10, 22, 0.96) 100%);
  box-shadow: inset 0 0 18px rgba(190, 75, 219, 0.28);
}
.ar-item-slot.rarity-legendary {
  border-color: rgba(255, 146, 43, 0.95);
  background: radial-gradient(circle at 50% 35%, rgba(132, 64, 14, 0.62) 0%, rgba(18, 11, 9, 0.96) 100%);
  box-shadow: 0 0 14px rgba(255, 146, 43, 0.32), inset 0 0 20px rgba(255, 146, 43, 0.34);
}

@keyframes arMythicPulse {
  0%, 100% {
    box-shadow: 0 0 16px rgba(255, 30, 66, 0.55), inset 0 0 20px rgba(255, 30, 66, 0.42);
    border-color: #ff1e42;
  }
  50% {
    box-shadow: 0 0 28px rgba(255, 64, 96, 0.92), 0 0 10px rgba(255, 212, 59, 0.55), inset 0 0 26px rgba(255, 30, 66, 0.65);
    border-color: #ff758f;
  }
}

.ar-item-slot.is-mythic {
  border-width: 1.5px;
  border-color: #ff1e42 !important;
  background: radial-gradient(circle at 50% 32%, rgba(168, 12, 42, 0.72) 0%, rgba(22, 6, 12, 0.98) 100%) !important;
  animation: arMythicPulse 2s ease-in-out infinite;
}

.ar-item-slot.is-set-item:not(.is-mythic) {
  border-color: rgba(32, 201, 151, 0.9);
  box-shadow: 0 0 12px rgba(32, 201, 151, 0.28), inset 0 0 16px rgba(32, 201, 151, 0.28);
}

.ar-item-sockets-row {
  position: absolute;
  bottom: 3px;
  right: 4px;
  display: flex;
  gap: 2.5px;
  align-items: center;
  z-index: 3;
  pointer-events: none;
}

.ar-socket-pip {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(8, 6, 14, 0.92);
  border: 1px solid rgba(215, 195, 155, 0.72);
}

.ar-socket-pip.is-filled {
  background: var(--rune-color, #ffd43b);
  border-color: #fff9db;
  box-shadow: 0 0 6px var(--rune-color, #ffd43b);
}

/* Inventory Expansion Sub-Navigation */
.ar-inv-subnav {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  background: rgba(11, 9, 18, 0.92);
  border-bottom: 1px solid rgba(200, 155, 60, 0.24);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.ar-inv-subtab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  border-radius: 4px;
  background: rgba(22, 18, 34, 0.8);
  border: 1px solid rgba(200, 155, 60, 0.22);
  color: #bfb299;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.22, 1.25, 0.36, 1);
}

.ar-inv-subtab-btn:hover {
  border-color: rgba(240, 196, 99, 0.65);
  color: #fff3d6;
}

.ar-inv-subtab-btn.is-active {
  background: linear-gradient(180deg, rgba(166, 118, 38, 0.5) 0%, rgba(68, 44, 16, 0.85) 100%);
  border-color: #ffd97d;
  color: #fff7e0;
  box-shadow: 0 0 14px rgba(200, 155, 60, 0.3);
}

/* Runeword, Stash, Gambler & Companions Layouts */
.ar-bench-3col {
  position: relative;
  z-index: 3;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 330px 320px minmax(0, 1fr);
  gap: 14px;
  padding: 14px 18px;
  overflow: hidden;
}

.ar-bench-2col {
  position: relative;
  z-index: 3;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 14px 18px;
  overflow: hidden;
}

@media (max-width: 1080px) {
  .ar-bench-3col,
  .ar-bench-2col {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
}

.ar-rune-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.ar-rune-tile {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 4px;
  background: rgba(16, 13, 26, 0.88);
  border: 1px solid rgba(200, 155, 60, 0.24);
  color: #f1e9d2;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.ar-rune-tile:hover:not(:disabled) {
  border-color: #ffd97d;
  background: rgba(34, 27, 52, 0.94);
  transform: translateY(-1px);
}

.ar-rune-tile:disabled {
  opacity: 0.4;
  cursor: default;
}

.ar-rune-gem {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11px;
  font-weight: 800;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.22), rgba(10, 8, 16, 0.92));
  border: 1.5px solid var(--rune-hex, #ffd43b);
  color: var(--rune-hex, #ffd43b);
  box-shadow: 0 0 10px var(--rune-hex, #ffd43b);
  flex-shrink: 0;
}

.ar-socket-well-row {
  display: flex;
  justify-content: center;
  gap: 10px;
  padding: 10px;
  border-radius: 5px;
  background: rgba(8, 6, 14, 0.82);
  border: 1px solid rgba(200, 155, 60, 0.24);
}

.ar-socket-well {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px dashed rgba(200, 155, 60, 0.48);
  background: radial-gradient(circle, rgba(24, 18, 36, 0.9), rgba(6, 5, 10, 0.98));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  font-weight: 700;
  color: #cbb994;
}

.ar-socket-well.is-socketed {
  border-style: solid;
  border-color: var(--rune-hex, #ffd43b);
  box-shadow: 0 0 14px var(--rune-hex, #ffd43b), inset 0 0 10px var(--rune-hex, #ffd43b);
  color: #fff9db;
}

/* Corrupted Obelisk 3-Card Roguelike Draft */
.ar-obelisk-shell {
  position: relative;
  z-index: 3;
  width: min(1100px, 95vw);
  max-height: 92vh;
  overflow-y: auto;
  padding: 26px 28px;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(20, 10, 26, 0.97) 0%, rgba(8, 5, 14, 0.99) 100%);
  border: 1px solid rgba(224, 49, 88, 0.65);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.95), 0 0 55px rgba(180, 24, 68, 0.35);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.ar-obelisk-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 900px) {
  .ar-obelisk-grid {
    grid-template-columns: 1fr;
  }
}

.ar-obelisk-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 18px;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(28, 18, 38, 0.92) 0%, rgba(12, 9, 20, 0.98) 100%);
  border: 1px solid var(--pact-accent, #e03131);
  box-shadow: inset 0 0 24px var(--pact-glow, rgba(224, 49, 49, 0.16));
  transition: all 0.2s cubic-bezier(0.22, 1.28, 0.36, 1);
}

.ar-obelisk-card:hover {
  transform: translateY(-4px) scale(1.012);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.82), 0 0 26px var(--pact-glow, rgba(224, 49, 49, 0.38));
}

.ar-pact-box {
  padding: 10px 12px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.45;
}

.ar-pact-box.is-blessing {
  background: rgba(47, 158, 68, 0.14);
  border: 1px solid rgba(81, 207, 102, 0.45);
  color: #b2f2bb;
}

.ar-pact-box.is-curse {
  background: rgba(201, 42, 42, 0.16);
  border: 1px solid rgba(255, 107, 107, 0.48);
  color: #ffc9c9;
}

/* Waypoint Atlas ('world_map') */
.ar-atlas-layout {
  position: relative;
  z-index: 3;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ar-atlas-featured-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.ar-atlas-floors-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 920px) {
  .ar-atlas-featured-row,
  .ar-atlas-floors-grid {
    grid-template-columns: 1fr;
  }
}

.ar-waypoint-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 15px 16px;
  border-radius: 5px;
  background: linear-gradient(180deg, rgba(24, 20, 38, 0.92) 0%, rgba(12, 10, 20, 0.97) 100%);
  border: 1px solid rgba(200, 155, 60, 0.34);
  transition: all 0.16s ease;
}

.ar-waypoint-card:hover:not(.is-locked) {
  border-color: #ffd97d;
  transform: translateY(-2px);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.7), 0 0 18px rgba(200, 155, 60, 0.22);
}

.ar-waypoint-card.is-locked {
  opacity: 0.48;
  filter: grayscale(0.55);
}

.ar-paperdoll-stage .ar-item-slot {
  overflow: visible;
}

.ar-item-slot.is-just-equipped {
  overflow: visible;
  z-index: 6;
  animation: arSlotEquipPop 0.38s cubic-bezier(0.22, 1.4, 0.36, 1);
}

.ar-slot-shockwave,
.ar-slot-shockwave-secondary {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  border: 2.5px solid var(--sw-color, #ffd97d);
  box-shadow: 0 0 18px var(--sw-color, #ffd97d), inset 0 0 10px var(--sw-color, #ffd97d);
  pointer-events: none;
  animation: arShockwaveRing 0.62s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.ar-slot-shockwave-secondary {
  border-width: 1.5px;
  animation-delay: 0.09s;
  animation-duration: 0.68s;
}

.ar-stat-pop-up {
  animation: arStatPopGreen 0.72s cubic-bezier(0.22, 1.3, 0.36, 1);
  border-radius: 4px;
}

.ar-stat-pop-up strong,
.ar-stat-pop-up .ar-attr-val {
  color: #69db7c !important;
  text-shadow: 0 0 10px rgba(81, 207, 102, 0.65);
}

.ar-stat-pop-down {
  animation: arStatPopRed 0.72s cubic-bezier(0.22, 1.3, 0.36, 1);
  border-radius: 4px;
}

.ar-stat-pop-down strong,
.ar-stat-pop-down .ar-attr-val {
  color: #ff6b6b !important;
  text-shadow: 0 0 10px rgba(255, 107, 107, 0.65);
}

.ar-stat-delta-chip {
  display: inline-block;
  margin-left: 5px;
  padding: 0px 5px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.ar-stat-delta-chip.is-up {
  background: rgba(47, 158, 68, 0.28);
  border: 1px solid rgba(105, 219, 124, 0.65);
  color: #8ce99a;
}

.ar-stat-delta-chip.is-down {
  background: rgba(201, 42, 42, 0.28);
  border: 1px solid rgba(255, 135, 135, 0.65);
  color: #ffa8a8;
}

/* Blacksmith Anvil Spark Burst */
.ar-forge-card {
  position: relative;
  overflow: visible;
}

.ar-forge-card.is-forging {
  border-color: #ffd43b;
  animation: arAnvilCardForge 0.65s cubic-bezier(0.22, 1.35, 0.36, 1);
}

.ar-anvil-spark-burst {
  position: absolute;
  top: 44%;
  left: 50%;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 12;
}

.ar-anvil-spark {
  position: absolute;
  top: 0;
  left: 0;
  width: 11px;
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg, #fff9db, #ffd43b, #ff6b35);
  box-shadow: 0 0 8px #ffa94d;
  animation: arAnvilSparkFly 0.62s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* DLSS & High-Refresh Controls */
.ar-dlss-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  min-width: 320px;
}

@media (max-width: 720px) {
  .ar-dlss-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    min-width: 0;
    width: 100%;
  }
}

.ar-dlss-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 9px;
  border-radius: 4px;
  background: rgba(14, 11, 22, 0.92);
  border: 1px solid rgba(200, 155, 60, 0.28);
  color: #bfb299;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.22, 1.25, 0.36, 1);
}

.ar-dlss-btn:hover {
  border-color: rgba(240, 196, 99, 0.68);
  color: #fff3d6;
  transform: translateY(-1px);
}

.ar-dlss-btn.is-active {
  background: linear-gradient(180deg, rgba(43, 138, 62, 0.55) 0%, rgba(20, 68, 34, 0.85) 100%);
  border-color: #74d688;
  color: #edfff1;
  box-shadow: 0 0 14px rgba(64, 192, 87, 0.32);
}

.ar-dlss-btn-name {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ar-dlss-btn-scale {
  font-size: 9.5px;
  color: #96f2d7;
  opacity: 0.88;
}

.ar-slot-placeholder-icon {
  width: 28px;
  height: 28px;
  opacity: 0.26;
  color: #c89b3c;
}

.ar-slot-label-tiny {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(199, 182, 150, 0.45);
  margin-top: 2px;
}

.ar-item-icon-wrap {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ar-item-upgrade-badge {
  position: absolute;
  top: 3px;
  right: 4px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(12, 9, 16, 0.88);
  border: 1px solid rgba(255, 212, 96, 0.65);
  color: #ffd97d;
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1.1;
}

.ar-item-ilvl-badge {
  position: absolute;
  bottom: 2px;
  left: 4px;
  font-size: 9px;
  color: rgba(241, 233, 210, 0.72);
  text-shadow: 0 1px 2px #000;
}

.ar-item-legendary-star {
  position: absolute;
  top: 3px;
  left: 4px;
  color: #ffab40;
  font-size: 10px;
  filter: drop-shadow(0 0 4px rgba(255, 146, 43, 0.9));
}

/* Blacksmith Forge Station */
.ar-forge-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 12px;
  border-radius: 5px;
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 107, 53, 0.14) 0%, transparent 70%),
    rgba(16, 12, 20, 0.9);
  border: 1px solid rgba(226, 134, 62, 0.42);
}

.ar-forge-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ar-forge-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #ffb56b;
}

.ar-forge-pips {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 3px;
}

.ar-forge-pip {
  height: 6px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 168, 76, 0.25);
}

.ar-forge-pip.is-filled {
  background: linear-gradient(90deg, #ff922b, #ffd43b);
  border-color: #ffe066;
  box-shadow: 0 0 6px rgba(255, 169, 77, 0.65);
}

.ar-forge-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ar-forge-actions .ar-btn {
  flex: 1 1 auto;
}

/* 40-Slot Inventory Grid */
.ar-inv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.ar-inv-filter-group {
  display: flex;
  gap: 4px;
}

.ar-filter-pill {
  padding: 4px 9px;
  border-radius: 3px;
  background: rgba(20, 16, 30, 0.8);
  border: 1px solid rgba(200, 155, 60, 0.24);
  color: #b7ab93;
  font-size: 11px;
  cursor: pointer;
}

.ar-filter-pill.is-active {
  background: rgba(200, 155, 60, 0.24);
  border-color: #e6b956;
  color: #ffe39e;
  font-weight: 600;
}

.ar-inv-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
}

@media (max-width: 720px) {
  .ar-inv-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

/* Floating Rich Item & Skill Tooltip */
.ar-floating-tooltip {
  position: fixed;
  z-index: 999;
  width: 330px;
  max-width: calc(100vw - 24px);
  pointer-events: none;
  padding: 13px 15px;
  border-radius: 5px;
  background: linear-gradient(180deg, rgba(16, 13, 24, 0.98) 0%, rgba(8, 7, 13, 0.99) 100%);
  border: 1px solid var(--tt-border, #c89b3c);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.92),
    0 0 22px var(--tt-glow, rgba(200, 155, 60, 0.25));
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ar-floating-tooltip.is-hidden {
  display: none;
}

.ar-tt-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(200, 155, 60, 0.24);
}

.ar-tt-name {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 14.5px;
  font-weight: 700;
  line-height: 1.25;
}

.ar-tt-sub {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #b5a88e;
}

.ar-tt-affixes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ar-tt-affix {
  font-size: 12px;
  color: #99c8ff;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ar-tt-affix::before {
  content: '◆';
  font-size: 8px;
  color: #c89b3c;
}

.ar-tt-legendary {
  padding: 8px 10px;
  border-radius: 4px;
  background: rgba(255, 146, 43, 0.12);
  border: 1px solid rgba(255, 146, 43, 0.45);
  color: #ffc078;
  font-size: 11.5px;
  line-height: 1.4;
}

.ar-tt-compare {
  padding-top: 7px;
  border-top: 1px solid rgba(200, 155, 60, 0.22);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ar-tt-compare-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9e937b;
  margin-bottom: 2px;
}

.ar-tt-delta-pos {
  color: #51cf66;
  font-size: 11.5px;
  font-weight: 600;
}

.ar-tt-delta-neg {
  color: #ff6b6b;
  font-size: 11.5px;
  font-weight: 600;
}

.ar-tt-delta-neutral {
  color: #adb5bd;
  font-size: 11.5px;
}

.ar-tt-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 10.5px;
  color: #9e937b;
}

/* =========================================================
   3. CONSTELLATION SKILL TREE
   ========================================================= */
.ar-skills-layout {
  position: relative;
  z-index: 3;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 14px;
  padding: 14px 18px;
}

@media (max-width: 980px) {
  .ar-skills-layout {
    grid-template-columns: 1fr;
  }
}

.ar-constellation-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 440px;
  border-radius: 5px;
  border: 1px solid rgba(200, 155, 60, 0.32);
  background: #06050b;
  overflow: hidden;
}

.ar-constellation-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}

.ar-constellation-canvas:active {
  cursor: grabbing;
}

.ar-constellation-hud-top {
  position: absolute;
  top: 12px;
  left: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  gap: 10px;
  flex-wrap: wrap;
}

.ar-constellation-hud-top > * {
  pointer-events: auto;
}

.ar-skill-points-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 4px;
  background: rgba(14, 11, 24, 0.92);
  border: 1px solid rgba(235, 186, 78, 0.55);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.65);
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 12.5px;
  color: #f4e6c3;
}

.ar-skill-points-pill.has-points {
  animation: arPulseGold 2.2s infinite;
  border-color: #ffd97d;
}

.ar-constellation-legend {
  position: absolute;
  bottom: 12px;
  left: 14px;
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  border-radius: 4px;
  background: rgba(10, 8, 18, 0.85);
  border: 1px solid rgba(200, 155, 60, 0.22);
  font-size: 11px;
  color: #bfb299;
  pointer-events: none;
}

.ar-branch-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
}

/* =========================================================
   4. JOURNAL & LORE CODEX, SETTINGS, PAUSE, DEATH, VICTORY
   ========================================================= */
.ar-codex-layout {
  position: relative;
  z-index: 3;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 18px;
  gap: 12px;
}

.ar-subtabs-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid rgba(200, 155, 60, 0.24);
  padding-bottom: 10px;
  flex-shrink: 0;
}

.ar-quest-columns {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  overflow-y: auto;
}

@media (max-width: 880px) {
  .ar-quest-columns {
    grid-template-columns: 1fr;
  }
}

.ar-quest-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px 15px;
  border-radius: 5px;
  background: linear-gradient(180deg, rgba(24, 19, 35, 0.88) 0%, rgba(13, 11, 20, 0.94) 100%);
  border: 1px solid rgba(200, 155, 60, 0.28);
}

.ar-quest-card.is-main {
  border-color: rgba(235, 186, 78, 0.62);
  box-shadow: inset 0 0 18px rgba(200, 155, 60, 0.08);
}

.ar-quest-card.is-completed {
  opacity: 0.78;
  border-color: rgba(64, 192, 87, 0.48);
}

.ar-obj-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.ar-obj-progress-track {
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.ar-obj-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #c89b3c, #ffd97d);
}

.ar-obj-progress-fill.is-done {
  background: linear-gradient(90deg, #2f9e44, #69db7c);
}

/* Lore 2-Pane Reader */
.ar-lore-reader {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr);
  gap: 14px;
}

@media (max-width: 880px) {
  .ar-lore-reader {
    grid-template-columns: 1fr;
  }
}

.ar-lore-item-btn {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: 4px;
  background: rgba(18, 14, 28, 0.8);
  border: 1px solid rgba(200, 155, 60, 0.2);
  color: #e6dac1;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: all 0.14s ease;
}

.ar-lore-item-btn:hover {
  border-color: rgba(200, 155, 60, 0.55);
  background: rgba(32, 25, 46, 0.88);
}

.ar-lore-item-btn.is-active {
  border-color: #f0c463;
  background: rgba(68, 49, 22, 0.48);
}

.ar-lore-item-btn.is-locked {
  opacity: 0.5;
}

.ar-lore-parchment {
  padding: 26px 32px;
  overflow-y: auto;
  background:
    radial-gradient(circle at 50% 20%, rgba(56, 41, 24, 0.22) 0%, rgba(12, 10, 18, 0.95) 80%);
  border: 1px solid rgba(200, 155, 60, 0.34);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ar-lore-text {
  font-size: 14.5px;
  line-height: 1.78;
  color: #e8dcc4;
  white-space: pre-line;
}

.ar-lore-text::first-letter {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 36px;
  font-weight: 700;
  float: left;
  line-height: 0.9;
  padding-right: 8px;
  padding-top: 3px;
  color: #f2c96b;
}

/* Achievements Grid */
.ar-ach-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-content: start;
}

.ar-ach-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 14px;
  border-radius: 5px;
  background: rgba(16, 13, 24, 0.88);
  border: 1px solid rgba(200, 155, 60, 0.22);
}

.ar-ach-card.is-unlocked {
  border-color: rgba(235, 186, 78, 0.65);
  background: linear-gradient(135deg, rgba(52, 38, 18, 0.55) 0%, rgba(16, 13, 24, 0.92) 100%);
}

.ar-ach-card.is-locked {
  opacity: 0.55;
  filter: grayscale(0.5);
}

/* Settings Controls */
.ar-settings-body {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.ar-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border-radius: 5px;
  background: rgba(15, 12, 24, 0.78);
  border: 1px solid rgba(200, 155, 60, 0.2);
}

.ar-setting-label-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ar-setting-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #f4e6c3;
}

.ar-setting-hint {
  font-size: 11px;
  color: #968b74;
}

.ar-slider-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
}

.ar-range-input {
  flex: 1;
  accent-color: #e0b04f;
  cursor: pointer;
  height: 6px;
}

.ar-slider-val {
  min-width: 44px;
  text-align: right;
  font-weight: 700;
  font-size: 12.5px;
  color: #ffd97d;
}

.ar-segmented {
  display: inline-flex;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(200, 155, 60, 0.42);
}

.ar-seg-btn {
  padding: 6px 14px;
  background: rgba(14, 11, 22, 0.9);
  border: none;
  border-right: 1px solid rgba(200, 155, 60, 0.25);
  color: #b7ab93;
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
}

.ar-seg-btn:last-child {
  border-right: none;
}

.ar-seg-btn.is-active {
  background: linear-gradient(180deg, #a67826 0%, #634412 100%);
  color: #fff8e6;
}

.ar-toggle-switch {
  position: relative;
  width: 50px;
  height: 26px;
  border-radius: 13px;
  background: rgba(35, 30, 48, 0.95);
  border: 1px solid rgba(200, 155, 60, 0.4);
  cursor: pointer;
  transition: all 0.18s ease;
}

.ar-toggle-switch.is-on {
  background: linear-gradient(90deg, #2b8a3e, #40c057);
  border-color: #8ce99a;
}

.ar-toggle-knob {
  position: absolute;
  top: 2px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #f8f1df;
  transition: transform 0.18s ease;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5);
}

.ar-toggle-switch.is-on .ar-toggle-knob {
  transform: translateX(22px);
}

/* Pause / Death / Victory Dramatic Screens */
.ar-dramatic-card {
  position: relative;
  z-index: 3;
  width: min(560px, 92vw);
  padding: 32px 34px;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(20, 15, 28, 0.96) 0%, rgba(9, 7, 14, 0.98) 100%);
  border: 1px solid rgba(200, 155, 60, 0.55);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.92), 0 0 40px rgba(200, 155, 60, 0.16);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 18px;
}

.ar-dramatic-card.is-death {
  border-color: rgba(214, 51, 51, 0.72);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.95), 0 0 55px rgba(201, 42, 42, 0.35);
}

.ar-dramatic-card.is-victory {
  width: min(640px, 94vw);
  border-color: #f3c868;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.95), 0 0 65px rgba(240, 196, 99, 0.38);
}

.ar-dramatic-title {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: clamp(26px, 3.5vw, 38px);
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.ar-dramatic-title.tone-crimson {
  color: #ff5a5f;
  text-shadow: 0 0 26px rgba(224, 49, 49, 0.75);
}

.ar-dramatic-title.tone-gold {
  background: linear-gradient(180deg, #fff8e3 0%, #f5c862 55%, #b87f20 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 18px rgba(245, 200, 98, 0.45));
}

.ar-run-stats-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.ar-run-stat-box {
  padding: 10px 12px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(200, 155, 60, 0.22);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ar-run-stat-box span {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9e937b;
}

.ar-run-stat-box strong {
  font-family: var(--font-display, 'Cinzel', Georgia, serif);
  font-size: 17px;
  color: #fff2d2;
}

.ar-menu-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.ar-menu-stack .ar-btn {
  width: 100%;
  padding: 12px 18px;
}
`;
