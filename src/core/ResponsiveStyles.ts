// ResponsiveStyles.ts — Inject responsive CSS for all device classes (Mobile, Tablet, Desktop)

export function injectResponsiveStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('ar-responsive-styles');
  if (existing) return;

  const style = document.createElement('style');
  style.id = 'ar-responsive-styles';
  style.textContent = `
/* ══════════════════════════════════════════════════════════════
   ABYSSAL REALMS — Responsive Styles (Vietnamese UI)
   Tối ưu hiển thị & cảm ứng cho Mobile, Tablet và PC
══════════════════════════════════════════════════════════════ */

:root {
  --hud-font-size: 14px;
  --hud-bar-h: 10px;
  --hud-padding: 8px;
  --ui-scale: 1;
}

/* Preserve strict z-index layer hierarchy so touch layer NEVER blocks menus or multiplayer */
#game-canvas-container {
  position: fixed;
  inset: 0;
  z-index: 1;
}

#ui-hud-layer {
  position: fixed;
  inset: 0;
  z-index: 10;
  pointer-events: none;
}

#ui-touch-layer {
  position: fixed;
  inset: 0;
  z-index: 15;
  pointer-events: none;
}

#ui-menus-layer {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}

#ui-multiplayer-layer {
  position: fixed;
  inset: 0;
  z-index: 24;
  pointer-events: none;
}

/* Smooth native touch scrolling inside all menus, modals, and chat feeds */
.ar-title-shell,
.ar-modal-window,
.ar-atlas-layout,
.ar-codex-layout,
.ar-subpanel-body,
.ar-inv-grid-scroll,
.ar-stats-scroll,
.mp-lobby-body,
.mp-chat-feed {
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* ── Mobile & Landscape Phone Optimizations ───────────────── */
@media (max-height: 540px), (max-width: 960px) {
  .ar-title-shell {
    padding: 8px 12px !important;
    gap: 8px !important;
    max-height: 98vh !important;
  }

  .ar-title-crown {
    width: 40px !important;
    height: 30px !important;
  }

  .ar-title-eyebrow {
    font-size: 9px !important;
    letter-spacing: 0.2em !important;
  }

  .ar-title-main {
    font-size: clamp(20px, 3.4vw, 30px) !important;
  }

  .ar-title-sub {
    font-size: 11px !important;
  }

  .ar-title-cta-bar {
    gap: 8px !important;
    margin: 2px 0 !important;
    flex-wrap: wrap !important;
  }

  .ar-title-cta-btn {
    padding: 9px 14px !important;
    font-size: 11.5px !important;
  }

  /* Keep 3 hero cards side-by-side in landscape so all 3 are visible at once */
  .ar-hero-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    gap: 8px !important;
  }

  .ar-hero-card {
    padding: 10px 12px !important;
    gap: 6px !important;
  }

  .ar-hero-emblem {
    width: 36px !important;
    height: 36px !important;
  }

  .ar-hero-card-title {
    font-size: 14px !important;
  }

  .ar-hero-card-sub {
    font-size: 10px !important;
  }

  .ar-hero-lore {
    font-size: 10.5px !important;
    line-height: 1.3 !important;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .ar-controls-guide {
    display: none !important;
  }

  /* Scale bottom HUD action dock down on phone landscape so it doesn't collide with touch controls */
  .ar-bottom-dock {
    transform: translateX(-50%) scale(0.74) !important;
    transform-origin: bottom center !important;
    bottom: 2px !important;
  }

  .ar-top-right {
    transform: scale(0.8) !important;
    transform-origin: top right !important;
    top: 6px !important;
    right: 6px !important;
  }

  .ar-top-left {
    transform: scale(0.82) !important;
    transform-origin: top left !important;
    top: 6px !important;
    left: 6px !important;
  }

  .ar-modal-window {
    width: 98vw !important;
    height: 96vh !important;
  }
}

@media (max-width: 600px) and (orientation: portrait) {
  .ar-hero-grid {
    grid-template-columns: 1fr !important;
  }
}
`;
  document.head.appendChild(style);
}

export function setDeviceClass(deviceClass: 'mobile' | 'tablet' | 'desktop'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.device = deviceClass;
}

export function scaleUIForDevice(deviceClass: 'mobile' | 'tablet' | 'desktop'): void {
  setDeviceClass(deviceClass);

  if (typeof document === 'undefined') return;
  let metaViewport = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
  if (!metaViewport) {
    metaViewport = document.createElement('meta');
    metaViewport.name = 'viewport';
    document.head.appendChild(metaViewport);
  }

  if (deviceClass === 'mobile' || deviceClass === 'tablet') {
    metaViewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
    document.body.style.overscrollBehavior = 'none';
    document.body.style.touchAction = 'manipulation';
  } else {
    metaViewport.content = 'width=device-width, initial-scale=1';
  }
}
