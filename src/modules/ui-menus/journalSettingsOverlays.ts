import { BIOME_CONFIG, HERO_CLASS_CONFIG } from '../../core/Constants';
import { detectDevice } from '../../core/DeviceDetector';
import { eventBus } from '../../core/EventBus';
import { t } from '../../core/i18n/index.js';
import type {
  BiomeId,
  DlssMode,
  GameSettings,
  LoreEntry,
  MenuPanelId,
  MenusCallbacks,
  MenusRefreshContext,
  QuestState,
  TargetFpsLimit,
} from '../../contracts/types';
import {
  escapeHtml,
  safeNum,
  SVG_GOLD_COIN,
  SVG_SHATTERED_CROWN,
  SVG_SKULL,
  SVG_TROPHY,
} from './icons';
import { bindWindowTopbarEvents, renderWindowTopbar } from './sharedHeader';

type JournalTab = 'quests' | 'lore' | 'achievements';
type LoreBiomeFilter = 'all' | BiomeId;

const DLSS_MODE_OPTIONS: ReadonlyArray<{
  mode: DlssMode;
  label: string;
  scaleText: string;
}> = [
  { mode: 'native', label: 'Gốc', scaleText: '1.00x Gốc' },
  { mode: 'dlaa', label: 'DLAA', scaleText: '1.00x + CAS' },
  { mode: 'quality', label: 'Chất Lượng', scaleText: '0.77x Tỷ Lệ' },
  { mode: 'balanced', label: 'Cân Bằng', scaleText: '0.67x Tỷ Lệ' },
  { mode: 'performance', label: 'Hiệu Năng', scaleText: '0.50x Tỷ Lệ' },
  { mode: 'ultra_performance', label: 'Siêu Hiệu Năng', scaleText: '0.38x Tỷ Lệ' },
];

const TARGET_FPS_OPTIONS: ReadonlyArray<{
  fps: TargetFpsLimit;
  label: string;
}> = [
  { fps: 60, label: '60 Hz' },
  { fps: 120, label: '120 Hz' },
  { fps: 144, label: '144 Hz' },
  { fps: 0, label: 'Không Giới Hạn' },
];

export class JournalAndOverlaysController {
  private journalTab: JournalTab = 'quests';
  private loreFilter: LoreBiomeFilter = 'all';
  private selectedLoreId: string | null = null;
  private isSliderDragging = false;

  isActivelyDraggingControl(): boolean {
    return this.isSliderDragging;
  }

  /* =========================================================
     JOURNAL & LORE CODEX ('quests')
     ========================================================= */
  renderJournal(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    onSwitchPanel: (panel: MenuPanelId) => void,
    onClose: () => void,
    isEntering = false,
  ): void {
    const quests = ctx.quests ?? [];
    const lore = ctx.lore ?? [];
    const achievements = ctx.achievements ?? [];

    const unlockedLoreCount = lore.filter((l) => l.unlocked).length;
    const unlockedAchCount = achievements.filter((a) => a.unlocked).length;

    let bodyHtml = '';
    if (this.journalTab === 'quests') {
      bodyHtml = this.renderQuestsSubtab(quests);
    } else if (this.journalTab === 'lore') {
      bodyHtml = this.renderLoreSubtab(lore);
    } else {
      bodyHtml = this.renderAchievementsSubtab(achievements);
    }

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop" data-backdrop="closeable">
        <div class="ar-modal-window ${isEntering ? 'is-entering' : ''}" role="dialog" aria-label="Nhật Ký và Pho Tri Thức">
          ${renderWindowTopbar(
            'quests',
            'Biên Niên Sử Vực Thẳm & Pho Tri Thức',
            'Nhiệm Vụ Thám Hiểm, Những Cuốn Sách Đã Giải Mã & Thành Tích',
            ctx,
          )}

          <div class="ar-codex-layout">
            <div class="ar-subtabs-bar">
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button
                  type="button"
                  class="ar-nav-tab ${this.journalTab === 'quests' ? 'is-active' : ''}"
                  data-journal-tab="quests"
                >
                  <span>📜 ${t('quest.title')} (${quests.length})</span>
                </button>
                <button
                  type="button"
                  class="ar-nav-tab ${this.journalTab === 'lore' ? 'is-active' : ''}"
                  data-journal-tab="lore"
                >
                  <span>📖 Truyện Lore (${unlockedLoreCount}/${lore.length})</span>
                </button>
                <button
                  type="button"
                  class="ar-nav-tab ${this.journalTab === 'achievements' ? 'is-active' : ''}"
                  data-journal-tab="achievements"
                >
                  <span>🏆 Thành Tích (${unlockedAchCount}/${achievements.length})</span>
                </button>
              </div>
              <div style="font-size:11.5px;color:#a89b82;">
                Tầng Cao Nhất Đạt Được: <strong style="color:#ffd97d;">Tầng ${Math.max(1, safeNum(ctx.player?.floorsCleared, 0) + 1)}</strong>
              </div>
            </div>

            <div class="ar-tab-spring" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;">
              ${bodyHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    bindWindowTopbarEvents(mountEl, { onSwitchPanel, onClose });

    const backdrop = mountEl.querySelector<HTMLElement>('[data-backdrop="closeable"]');
    backdrop?.addEventListener('click', (ev) => {
      if (ev.target === backdrop) {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        onClose();
      }
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-journal-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.journalTab as JournalTab | undefined;
        if (!next || next === this.journalTab) return;
        this.journalTab = next;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        this.renderJournal(mountEl, ctx, onSwitchPanel, onClose);
      });
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-lore-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bf = btn.dataset.loreFilter as LoreBiomeFilter | undefined;
        if (!bf || bf === this.loreFilter) return;
        this.loreFilter = bf;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        this.renderJournal(mountEl, ctx, onSwitchPanel, onClose);
      });
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-lore-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.loreId;
        if (!id) return;
        this.selectedLoreId = id;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        this.renderJournal(mountEl, ctx, onSwitchPanel, onClose);
      });
    });
  }

  private renderQuestsSubtab(quests: QuestState[]): string {
    if (quests.length === 0) {
      return `
        <div class="ar-subpanel" style="flex:1;align-items:center;justify-content:center;padding:32px;text-align:center;">
          <div style="font-family:var(--font-display);font-size:16px;color:#e6c473;">Chưa Có Nhiệm Vụ Đang Thực Hiện</div>
          <p style="font-size:12.5px;color:#9e937b;margin-top:6px;">Tiến sâu vào Vực Thẳm Huyền Bí để nhận Nhiệm Vụ Cốt Truyện Chính và Nhiệm Vụ Phụ.</p>
        </div>
      `;
    }

    const mainQuests = quests.filter((q) => q.isMainQuest);
    const sideQuests = quests.filter((q) => !q.isMainQuest);

    const renderQuestCard = (q: QuestState) => {
      const done = q.status === 'completed';
      const objsHtml = (q.objectives ?? [])
        .map((obj) => {
          const cur = safeNum(obj.current, 0);
          const req = Math.max(1, safeNum(obj.required, 1));
          const pct = Math.min(100, Math.round((cur / req) * 100));
          return `
            <div class="ar-obj-row">
              <div style="display:flex;justify-content:space-between;gap:8px;">
                <span style="color:${obj.completed ? '#8ce99a' : '#e8dcc4'};">
                  ${obj.completed ? '✓ ' : '• '}${escapeHtml(obj.description)}
                </span>
                <strong style="color:${obj.completed ? '#69db7c' : '#ffd97d'};white-space:nowrap;">${cur} / ${req}</strong>
              </div>
              <div class="ar-obj-progress-track">
                <div class="ar-obj-progress-fill ${obj.completed ? 'is-done' : ''}" style="width:${pct}%;"></div>
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <article class="ar-quest-card ${q.isMainQuest ? 'is-main' : ''} ${done ? 'is-completed' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:${q.isMainQuest ? '#f0c463' : '#9e937b'};">
                ${q.isMainQuest ? '✦ Cốt Truyện Chính' : '⚔ Nhiệm Vụ Phụ'} • Tầng ${safeNum(q.floorNumber, 1)}
              </div>
              <h3 style="font-family:var(--font-display);font-size:15px;color:#fff3d6;margin-top:2px;">
                ${escapeHtml(q.title)}
              </h3>
            </div>
            <span style="padding:3px 8px;border-radius:3px;font-size:10.5px;font-weight:700;text-transform:uppercase;background:${done ? 'rgba(47,158,68,0.25)' : 'rgba(200,155,60,0.2)'};border:1px solid ${done ? '#51cf66' : '#e0b04f'};color:${done ? '#8ce99a' : '#ffe39e'};">
              ${done ? t('quest.completed') : t('quest.active')}
            </span>
          </div>

          <p style="font-size:12px;color:#bfb299;line-height:1.45;">${escapeHtml(q.description)}</p>

          <div style="display:flex;flex-direction:column;gap:7px;margin-top:2px;">
            ${objsHtml}
          </div>

          <div style="display:flex;align-items:center;gap:14px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.07);font-size:11.5px;">
            <span style="color:#9e937b;">${t('quest.reward')}:</span>
            <strong style="color:#74c0fc;">+${safeNum(q.xpReward, 0)} XP</strong>
            <strong style="color:#ffd97d;display:inline-flex;align-items:center;gap:4px;">
              ${SVG_GOLD_COIN} +${safeNum(q.goldReward, 0)} Vàng
            </strong>
          </div>
        </article>
      `;
    };

    return `
      <div class="ar-quest-columns">
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div class="ar-stats-section-title" style="margin-top:0;">Biên Niên Sử Cốt Truyện Chính</div>
          ${mainQuests.map(renderQuestCard).join('') || `<div style="font-size:12px;color:#8e836e;">Tất cả nhiệm vụ chính đã hoàn tất.</div>`}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div class="ar-stats-section-title" style="margin-top:0;">Nhiệm Vụ Phụ Trong Tầng</div>
          ${sideQuests.map(renderQuestCard).join('') || `<div style="font-size:12px;color:#8e836e;">Không có nhiệm vụ phụ nào trên tầng này.</div>`}
        </div>
      </div>
    `;
  }

  private renderLoreSubtab(lore: LoreEntry[]): string {
    const filtered = lore.filter((l) =>
      this.loreFilter === 'all' ? true : l.biome === this.loreFilter,
    );

    // Ensure selectedLoreId points to an entry in filtered list (preferring unlocked)
    let activeEntry: LoreEntry | undefined = filtered.find((l) => l.id === this.selectedLoreId);
    if (!activeEntry) {
      activeEntry = filtered.find((l) => l.unlocked) ?? filtered[0];
      this.selectedLoreId = activeEntry?.id ?? null;
    }

    const filterBtns = (
      [
        'all',
        'sanctuary',
        'crypt',
        'caverns',
        'forge',
        'void',
        'cathedral',
        'observatory',
        'colosseum',
      ] as LoreBiomeFilter[]
    )
      .map((bf) => {
        const label =
          bf === 'all'
            ? 'Tất Cả Cõi'
            : (BIOME_CONFIG[bf]?.name ?? bf);
        return `<button type="button" class="ar-filter-pill ${this.loreFilter === bf ? 'is-active' : ''}" data-lore-filter="${bf}">${escapeHtml(label)}</button>`;
      })
      .join('');

    const listHtml = filtered
      .map((entry) => {
        const biomeName = BIOME_CONFIG[entry.biome]?.name ?? entry.biome;
        const isSel = activeEntry?.id === entry.id;
        return `
          <button
            type="button"
            class="ar-lore-item-btn ${isSel ? 'is-active' : ''} ${entry.unlocked ? '' : 'is-locked'}"
            data-lore-id="${escapeHtml(entry.id)}"
          >
            <div style="font-family:var(--font-display);font-size:12.5px;font-weight:700;color:${entry.unlocked ? '#fff1cf' : '#9e937b'};">
              ${entry.unlocked ? '📖 ' + escapeHtml(entry.title) : '🔒 Cổ Thư Vực Thẳm Chưa Giải Mã'}
            </div>
            <div style="font-size:10.5px;color:#9e937b;">${escapeHtml(biomeName)}</div>
          </button>
        `;
      })
      .join('');

    let readerHtml = '';
    if (!activeEntry) {
      readerHtml = `<div style="color:#9e937b;font-size:13px;">Không có cổ thư nào được ghi nhận ở cõi này.</div>`;
    } else if (!activeEntry.unlocked) {
      const biomeInfo = BIOME_CONFIG[activeEntry.biome];
      readerHtml = `
        <div style="margin:auto;text-align:center;max-width:380px;display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:32px;opacity:0.55;">🔒</div>
          <h3 style="font-family:var(--font-display);font-size:17px;color:#d6c6a5;">Cổ Thư Bị Phong Ấn Trong Bóng Tối</h3>
          <p style="font-size:12.5px;color:#9e937b;line-height:1.55;">
            Khám phá <strong style="color:#ffd97d;">${escapeHtml(biomeInfo?.name ?? activeEntry.biome)}</strong> và tương tác với các Bục Cổ Thư phát sáng (<kbd class="ar-keycap">F</kbd>) để giải mã biên niên sử này.
          </p>
        </div>
      `;
    } else {
      const biomeInfo = BIOME_CONFIG[activeEntry.biome];
      readerHtml = `
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#c89b3c;">
            ${escapeHtml(biomeInfo?.name ?? activeEntry.biome)}
          </div>
          <h3 style="font-family:var(--font-display);font-size:22px;color:#fff4d8;margin-top:4px;">
            ${escapeHtml(activeEntry.title)}
          </h3>
        </div>
        <div style="height:1px;background:linear-gradient(90deg,rgba(200,155,60,0.5),transparent);"></div>
        <div class="ar-lore-text">${escapeHtml(activeEntry.text)}</div>
      `;
    }

    return `
      <div class="ar-lore-reader">
        <div class="ar-subpanel">
          <div class="ar-subpanel-header" style="flex-wrap:wrap;gap:6px;">
            ${filterBtns}
          </div>
          <div class="ar-subpanel-body" style="gap:6px;">
            ${listHtml || `<div style="font-size:12px;color:#8e836e;">Chưa có cổ thư nào được lưu trữ.</div>`}
          </div>
        </div>
        <div class="ar-lore-parchment">
          ${readerHtml}
        </div>
      </div>
    `;
  }

  private renderAchievementsSubtab(
    achievements: Array<{ id: string; title: string; description: string; unlocked: boolean }>,
  ): string {
    const unlocked = achievements.filter((a) => a.unlocked).length;
    const total = Math.max(1, achievements.length);
    const pct = Math.round((unlocked / total) * 100);

    const cards = achievements
      .map(
        (ach) => `
        <div class="ar-ach-card ${ach.unlocked ? 'is-unlocked' : 'is-locked'}">
          <div style="flex-shrink:0;margin-top:2px;">${SVG_TROPHY}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <div style="font-family:var(--font-display);font-size:13px;font-weight:700;color:#fff2d4;">
                ${escapeHtml(ach.title)}
              </div>
              <span style="font-size:9.5px;font-weight:700;text-transform:uppercase;color:${ach.unlocked ? '#ffd97d' : '#868e96'};">
                ${ach.unlocked ? '✦ Đã Mở Khóa' : 'Đã Khóa'}
              </span>
            </div>
            <div style="font-size:11.5px;color:#bfb299;margin-top:4px;line-height:1.4;">
              ${escapeHtml(ach.description)}
            </div>
          </div>
        </div>
      `,
      )
      .join('');

    return `
      <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#d6c8ad;">
          <span>Tiến Độ Thành Tích</span>
          <strong style="color:#ffd97d;">${unlocked} / ${achievements.length} (${pct}%)</strong>
        </div>
        <div class="ar-xp-bar-track" style="height:8px;">
          <div class="ar-xp-bar-fill" style="width:${pct}%;"></div>
        </div>
      </div>
      <div class="ar-ach-grid">
        ${cards || `<div style="font-size:12px;color:#8e836e;">Thực hiện những chiến công anh hùng dưới Vực Thẳm để mở khóa thành tích.</div>`}
      </div>
    `;
  }

  /* =========================================================
     SETTINGS PANEL ('settings')
     ========================================================= */
  renderSettings(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    returnPanel: MenuPanelId,
    onSwitchPanel: (panel: MenuPanelId) => void,
    onCloseOrBack: () => void,
    isEntering = false,
  ): void {
    const s: GameSettings = {
      masterVolume: safeNum(ctx.settings?.masterVolume, 0.8),
      musicVolume: safeNum(ctx.settings?.musicVolume, 0.55),
      sfxVolume: safeNum(ctx.settings?.sfxVolume, 0.85),
      graphicsQuality: ctx.settings?.graphicsQuality ?? 'high',
      cameraSensitivity: safeNum(ctx.settings?.cameraSensitivity, 1.0),
      showDamageNumbers: ctx.settings?.showDamageNumbers ?? true,
      dlssMode: ctx.settings?.dlssMode ?? 'quality',
      dlssSharpness: safeNum(ctx.settings?.dlssSharpness, 0.72),
      targetFps: ctx.settings?.targetFps ?? 120,
      dynamicResolution: ctx.settings?.dynamicResolution ?? true,
    };

    let deviceClassLabel = t('settings.deviceDesktop');
    let detectedTierLabel = t('settings.quality.high');
    let rawDeviceClass = 'desktop';
    let rawTier = 'high';
    try {
      const detected = detectDevice();
      rawDeviceClass = detected.deviceClass;
      rawTier = detected.tier;
      deviceClassLabel =
        detected.deviceClass === 'mobile'
          ? t('settings.deviceMobile')
          : detected.deviceClass === 'tablet'
            ? t('settings.deviceTablet')
            : t('settings.deviceDesktop');
      detectedTierLabel = t(`settings.quality.${detected.tier}`);
    } catch {
      // Fallback for mocked test window without window.screen
    }

    const isStandaloneModal = returnPanel === 'title' || returnPanel === 'pause';

    const headerHtml = isStandaloneModal
      ? `
        <header class="ar-window-topbar">
          <div class="ar-topbar-brand">
            <div class="ar-topbar-crest">${SVG_SHATTERED_CROWN}</div>
            <div>
              <div class="ar-topbar-title">Cài Đặt Thánh Địa</div>
              <div class="ar-topbar-subtitle">Siêu Phân Giải DLSS, Nhịp Độ 120Hz &amp; Âm Thanh</div>
            </div>
          </div>
          <button type="button" class="ar-close-btn" data-action="close-settings" aria-label="Quay Lại">✕</button>
        </header>
      `
      : renderWindowTopbar(
          'settings',
          'Cài Đặt Thánh Địa',
          'Siêu Phân Giải DLSS, Nhịp Độ 120Hz & Âm Thanh',
          ctx,
        );

    const dlssButtonsHtml = DLSS_MODE_OPTIONS.map(
      (opt) => `
        <button
          type="button"
          class="ar-dlss-btn ${s.dlssMode === opt.mode ? 'is-active' : ''}"
          data-dlss-mode="${opt.mode}"
        >
          <span class="ar-dlss-btn-name">${escapeHtml(opt.label)}</span>
          <span class="ar-dlss-btn-scale">${escapeHtml(opt.scaleText)}</span>
        </button>
      `,
    ).join('');

    const fpsButtonsHtml = TARGET_FPS_OPTIONS.map(
      (opt) => `
        <button
          type="button"
          class="ar-seg-btn ${s.targetFps === opt.fps ? 'is-active' : ''}"
          data-target-fps="${opt.fps}"
        >${escapeHtml(opt.label)}</button>
      `,
    ).join('');

    const qualityLabels: Record<GameSettings['graphicsQuality'], string> = {
      low: t('settings.quality.low'),
      medium: t('settings.quality.medium'),
      high: t('settings.quality.high'),
    };

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop" data-backdrop="closeable">
        <div class="ar-modal-window ${isStandaloneModal ? 'is-medium' : ''} ${isEntering ? 'is-entering' : ''}" role="dialog" aria-label="Cài Đặt">
          ${headerHtml}

          <div class="ar-settings-body" data-scroll-key="settings-scroll">
            <div class="ar-setting-row" data-role="device-detection-badge" style="background:rgba(59,72,104,0.24);border:1px solid rgba(116,192,252,0.45);border-radius:5px;padding:10px 14px;">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title" style="color:#a5d8ff;">🖥 ${escapeHtml(t('settings.deviceDetected'))}: ${escapeHtml(deviceClassLabel)} (${escapeHtml(rawDeviceClass)})</span>
                <span class="ar-setting-hint">${escapeHtml(t('settings.quality.autoDetected'))}: <strong style="color:#ffd97d;">${escapeHtml(detectedTierLabel)} (${escapeHtml(rawTier)})</strong></span>
              </div>
              <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:3px;background:rgba(47,158,68,0.22);border:1px solid #51cf66;color:#8ce99a;">
                ${escapeHtml(t('settings.quality.auto'))}
              </span>
            </div>

            <div class="ar-stats-section-title" style="margin-top:0;">Siêu Phân Giải DLSS &amp; Động Cơ 120Hz</div>

            <div class="ar-setting-row" style="flex-wrap:wrap;">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">Chế Độ Siêu Phân Giải DLSS</span>
                <span class="ar-setting-hint">Nâng Cấp Hình Ảnh Giữ Cạnh Tương Phản Thích Ứng &amp; DLAA</span>
              </div>
              <div class="ar-dlss-grid">
                ${dlssButtonsHtml}
              </div>
            </div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">Độ Sắc Nét Tái Tạo DLSS</span>
                <span class="ar-setting-hint">Cường độ làm sắc nét thích ứng tương phản (CAS)</span>
              </div>
              <div class="ar-slider-wrap">
                <input type="range" class="ar-range-input" data-setting-slider="dlssSharpness" min="0" max="1" step="0.01" value="${s.dlssSharpness}" />
                <span class="ar-slider-val" data-slider-readout="dlssSharpness">${Math.round((s.dlssSharpness ?? 0.72) * 100)}%</span>
              </div>
            </div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">Giới Hạn Tốc Độ Khung Hình (FPS)</span>
                <span class="ar-setting-hint">Mục tiêu tần số quét cao (60Hz / 120Hz / 144Hz / Không Giới Hạn)</span>
              </div>
              <div class="ar-segmented">
                ${fpsButtonsHtml}
              </div>
            </div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">Độ Phân Giải Động 120Hz</span>
                <span class="ar-setting-hint">Tự động điều chỉnh tỉ lệ render nội bộ (±15%) để giữ vững tốc độ khung hình</span>
              </div>
              <button
                type="button"
                class="ar-toggle-switch ${s.dynamicResolution ? 'is-on' : ''}"
                data-action="toggle-dynamic-res"
                aria-pressed="${s.dynamicResolution}"
              >
                <span class="ar-toggle-knob"></span>
              </button>
            </div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">Thiết Lập Chất Lượng Đồ Họa</span>
                <span class="ar-setting-hint">Điều chỉnh độ phân giải đổ bóng, khử răng cưa MSAA &amp; hiệu ứng UnrealBloom</span>
              </div>
              <div class="ar-segmented">
                ${(['low', 'medium', 'high'] as Array<GameSettings['graphicsQuality']>)
                  .map(
                    (q) => `
                    <button
                      type="button"
                      class="ar-seg-btn ${s.graphicsQuality === q ? 'is-active' : ''}"
                      data-quality="${q}"
                    >${escapeHtml(qualityLabels[q])}</button>
                  `,
                  )
                  .join('')}
              </div>
            </div>

            <div class="ar-stats-section-title">Hòa Âm &amp; Âm Thanh</div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">${escapeHtml(t('settings.masterVolume'))}</span>
                <span class="ar-setting-hint">Mức âm lượng tổng thể trên toàn cõi</span>
              </div>
              <div class="ar-slider-wrap">
                <input type="range" class="ar-range-input" data-setting-slider="masterVolume" min="0" max="1" step="0.01" value="${s.masterVolume}" />
                <span class="ar-slider-val" data-slider-readout="masterVolume">${Math.round(s.masterVolume * 100)}%</span>
              </div>
            </div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">${escapeHtml(t('settings.musicVolume'))}</span>
                <span class="ar-setting-hint">Nhạc nền giả tưởng đen tối &amp; nhạc chiến đấu trùm</span>
              </div>
              <div class="ar-slider-wrap">
                <input type="range" class="ar-range-input" data-setting-slider="musicVolume" min="0" max="1" step="0.01" value="${s.musicVolume}" />
                <span class="ar-slider-val" data-slider-readout="musicVolume">${Math.round(s.musicVolume * 100)}%</span>
              </div>
            </div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">${escapeHtml(t('settings.sfxVolume'))}</span>
                <span class="ar-setting-hint">Tiếng va chạm vũ khí, phép thuật, âm báo nhặt đồ &amp; giao diện</span>
              </div>
              <div class="ar-slider-wrap">
                <input type="range" class="ar-range-input" data-setting-slider="sfxVolume" min="0" max="1" step="0.01" value="${s.sfxVolume}" />
                <span class="ar-slider-val" data-slider-readout="sfxVolume">${Math.round(s.sfxVolume * 100)}%</span>
              </div>
            </div>

            <div class="ar-stats-section-title">Điều Khiển &amp; Hiển Thị Chiến Đấu</div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">Độ Nhạy Xoay Camera</span>
                <span class="ar-setting-hint">Tốc độ kéo chuột phải &amp; xoay góc nhìn camera</span>
              </div>
              <div class="ar-slider-wrap">
                <input type="range" class="ar-range-input" data-setting-slider="cameraSensitivity" min="0.2" max="2.5" step="0.05" value="${s.cameraSensitivity}" />
                <span class="ar-slider-val" data-slider-readout="cameraSensitivity">${s.cameraSensitivity.toFixed(2)}x</span>
              </div>
            </div>

            <div class="ar-setting-row">
              <div class="ar-setting-label-group">
                <span class="ar-setting-title">${escapeHtml(t('settings.showDamage'))}</span>
                <span class="ar-setting-hint">Hiển thị số sát thương &amp; đòn chí mạng trong không gian 3D</span>
              </div>
              <button
                type="button"
                class="ar-toggle-switch ${s.showDamageNumbers ? 'is-on' : ''}"
                data-action="toggle-dmg-numbers"
                aria-pressed="${s.showDamageNumbers}"
              >
                <span class="ar-toggle-knob"></span>
              </button>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:8px;">
              <button type="button" class="ar-btn ar-btn-sm" data-action="reset-defaults">
                ↺ ${escapeHtml(t('settings.reset'))}
              </button>
              <button type="button" class="ar-btn ar-btn-gold" data-action="done-settings">
                ${returnPanel === 'title' ? '← Quay Lại Màn Hình Chính' : returnPanel === 'pause' ? '← Quay Lại Tạm Dừng' : '✓ Hoàn Tất'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    if (!isStandaloneModal) {
      bindWindowTopbarEvents(mountEl, { onSwitchPanel, onClose: onCloseOrBack });
    } else {
      mountEl.querySelector('[data-action="close-settings"]')?.addEventListener('click', () => {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        onCloseOrBack();
      });
    }

    const backdrop = mountEl.querySelector<HTMLElement>('[data-backdrop="closeable"]');
    backdrop?.addEventListener('click', (ev) => {
      if (ev.target === backdrop) {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        onCloseOrBack();
      }
    });

    const emitChange = (patch: Partial<GameSettings>, rerender = false) => {
      Object.assign(s, patch);
      if (ctx.settings) {
        Object.assign(ctx.settings, s);
      }
      callbacks?.onSettingsChange({ ...s });
      if (rerender) {
        this.renderSettings(
          mountEl,
          ctx,
          callbacks,
          returnPanel,
          onSwitchPanel,
          onCloseOrBack,
          false,
        );
      }
    };

    // Sliders update live without tearing down DOM mid-drag
    mountEl.querySelectorAll<HTMLInputElement>('[data-setting-slider]').forEach((input) => {
      const key = input.dataset.settingSlider as
        | 'masterVolume'
        | 'musicVolume'
        | 'sfxVolume'
        | 'cameraSensitivity'
        | 'dlssSharpness';

      const onSlideStart = () => {
        this.isSliderDragging = true;
      };
      const onSlideEnd = () => {
        this.isSliderDragging = false;
      };
      input.addEventListener('pointerdown', onSlideStart);
      input.addEventListener('pointerup', onSlideEnd);
      input.addEventListener('pointercancel', onSlideEnd);
      input.addEventListener('blur', onSlideEnd);

      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        if (!Number.isFinite(val)) return;
        const readout = mountEl.querySelector<HTMLElement>(`[data-slider-readout="${key}"]`);
        if (readout) {
          readout.textContent =
            key === 'cameraSensitivity' ? `${val.toFixed(2)}x` : `${Math.round(val * 100)}%`;
        }
        emitChange({ [key]: val }, false);
      });
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-dlss-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.dlssMode as DlssMode | undefined;
        if (!mode || mode === s.dlssMode) return;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        emitChange({ dlssMode: mode }, true);
      });
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-target-fps]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = Number(btn.dataset.targetFps);
        if (![60, 120, 144, 0].includes(raw)) return;
        const fps = raw as TargetFpsLimit;
        if (fps === s.targetFps) return;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        emitChange({ targetFps: fps }, true);
      });
    });

    mountEl
      .querySelector<HTMLButtonElement>('[data-action="toggle-dynamic-res"]')
      ?.addEventListener('click', () => {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        emitChange({ dynamicResolution: !s.dynamicResolution }, true);
      });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.quality as GameSettings['graphicsQuality'] | undefined;
        if (!q || q === s.graphicsQuality) return;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        emitChange({ graphicsQuality: q }, true);
      });
    });

    mountEl
      .querySelector<HTMLButtonElement>('[data-action="toggle-dmg-numbers"]')
      ?.addEventListener('click', () => {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        emitChange({ showDamageNumbers: !s.showDamageNumbers }, true);
      });

    mountEl
      .querySelector<HTMLButtonElement>('[data-action="reset-defaults"]')
      ?.addEventListener('click', () => {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        emitChange(
          {
            masterVolume: 0.8,
            musicVolume: 0.55,
            sfxVolume: 0.85,
            graphicsQuality: 'high',
            dlssMode: 'quality',
            dlssSharpness: 0.72,
            targetFps: 120,
            dynamicResolution: true,
            cameraSensitivity: 1.0,
            showDamageNumbers: true,
          },
          true,
        );
      });

    mountEl
      .querySelector<HTMLButtonElement>('[data-action="done-settings"]')
      ?.addEventListener('click', () => {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        onCloseOrBack();
      });
  }

  /* =========================================================
     PAUSE SCREEN ('pause')
     ========================================================= */
  renderPause(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    onOpenSubpanel: (panel: MenuPanelId) => void,
    onResume: () => void,
  ): void {
    const p = ctx.player;
    const classTitle = HERO_CLASS_CONFIG[p.heroClass]?.title ?? p.heroClass;

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop" data-backdrop="pause">
        <div class="ar-dramatic-card" role="dialog" aria-label="Tạm Dừng Trò Chơi">
          <div style="width:52px;height:40px;">${SVG_SHATTERED_CROWN}</div>
          <div>
            <div class="ar-title-eyebrow">Tạm Dừng Chuyến Thám Hiểm</div>
            <h2 class="ar-dramatic-title tone-gold" style="font-size:30px;margin-top:4px;">Tạm Dừng Thánh Địa</h2>
          </div>

          <div class="ar-run-stats-grid">
            <div class="ar-run-stat-box">
              <span>Anh Hùng</span>
              <strong>Cấp ${safeNum(p.level, 1)} ${escapeHtml(classTitle)}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Độ Sâu Vực Thẳm</span>
              <strong>Tầng ${Math.max(1, safeNum(p.floorsCleared, 0) + 1)}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Quái Vật Đã Diệt</span>
              <strong>${safeNum(p.killsTotal, 0).toLocaleString()}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Vàng Vực Thẳm</span>
              <strong style="color:#ffd97d;">${Math.floor(safeNum(p.gold, 0)).toLocaleString()}g</strong>
            </div>
          </div>

          <div class="ar-menu-stack">
            <button type="button" class="ar-btn ar-btn-primary" data-action="pause-resume">
              ⚔ Tiếp Tục Thám Hiểm
            </button>
            <button type="button" class="ar-btn ar-btn-coop" data-action="open-coop-lobby">
              🌐 ONLINE CO-OP (KHÁC MẠNG / P2P)
            </button>
            <button type="button" class="ar-btn" data-action="pause-inventory">
              🛡 Nhân Vật, Túi Đồ &amp; Lò Rèn
            </button>
            <button type="button" class="ar-btn" data-action="pause-skills">
              ✦ Chòm Sao Kỹ Năng
            </button>
            <button type="button" class="ar-btn" data-action="pause-quests">
              📜 Nhật Ký &amp; Nhiệm Vụ
            </button>
            <button type="button" class="ar-btn" data-action="pause-world-map">
              🗺 Bản Đồ Thế Giới
            </button>
            <button type="button" class="ar-btn" data-action="pause-settings">
              ⚙ Cài Đặt Thánh Địa
            </button>
            <button type="button" class="ar-btn ar-btn-danger" data-action="pause-title">
              ↩ Về Màn Hình Chính
            </button>
          </div>
        </div>
      </div>
    `;

    mountEl.querySelector('[data-action="pause-resume"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      onResume();
    });
    mountEl.querySelector('[data-action="open-coop-lobby"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      callbacks?.onOpenMultiplayerLobby?.();
      eventBus.emit('mp:openLobby', {});
    });
    mountEl.querySelector('[data-action="pause-inventory"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      onOpenSubpanel('inventory');
    });
    mountEl.querySelector('[data-action="pause-skills"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      onOpenSubpanel('skills');
    });
    mountEl.querySelector('[data-action="pause-quests"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      onOpenSubpanel('quests');
    });
    mountEl.querySelector('[data-action="pause-world-map"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      onOpenSubpanel('world_map');
    });
    mountEl.querySelector('[data-action="pause-settings"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      onOpenSubpanel('settings');
    });
    mountEl.querySelector('[data-action="pause-title"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      callbacks?.onReturnToTitle();
    });
  }

  /* =========================================================
     YOU DIED SCREEN ('death')
     ========================================================= */
  renderDeath(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
  ): void {
    const p = ctx.player;
    const classTitle = HERO_CLASS_CONFIG[p.heroClass]?.title ?? p.heroClass;

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop is-death">
        <div class="ar-dramatic-card is-death" role="alertdialog" aria-label="Bạn Đã Ngã Xuống">
          <div>${SVG_SKULL}</div>
          <div>
            <div class="ar-title-eyebrow" style="color:#ff8787;">Linh Hồn Bạn Tan Biến Vào Vực Thẳm</div>
            <h2 class="ar-dramatic-title tone-crimson" style="margin-top:4px;">Bạn Đã Ngã Xuống</h2>
            <p style="font-size:13px;color:#d6b8bc;margin-top:6px;line-height:1.5;">
              Dẫu máu thịt và sắt thép tan vỡ trong bóng tối, lời thề Vương Miện vẫn trói buộc linh hồn bạn trỗi dậy lần nữa.
            </p>
          </div>

          <div class="ar-run-stats-grid">
            <div class="ar-run-stat-box">
              <span>Anh Hùng Ngã Xuống</span>
              <strong>Cấp ${safeNum(p.level, 1)} ${escapeHtml(classTitle)}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Số Tầng Đã Vượt</span>
              <strong>${safeNum(p.floorsCleared, 0)}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Quái Vật Đã Diệt</span>
              <strong>${safeNum(p.killsTotal, 0).toLocaleString()}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Vàng Còn Giữ Lại</span>
              <strong style="color:#ffd97d;">${Math.floor(safeNum(p.gold, 0)).toLocaleString()}g</strong>
            </div>
          </div>

          <div class="ar-menu-stack">
            <button type="button" class="ar-btn ar-btn-primary" data-action="death-respawn">
              ⚔ Trỗi Dậy Lần Nữa (Hồi Sinh / Thử Lại)
            </button>
            <button type="button" class="ar-btn" data-action="death-title">
              ↩ Về Màn Hình Chính
            </button>
          </div>
        </div>
      </div>
    `;

    mountEl.querySelector('[data-action="death-respawn"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      callbacks?.onRespawnOrRetry();
    });
    mountEl.querySelector('[data-action="death-title"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      callbacks?.onReturnToTitle();
    });
  }

  /* =========================================================
     ASCENDANT VICTORY SCREEN ('victory')
     ========================================================= */
  renderVictory(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    onResumeVigil: () => void,
  ): void {
    const p = ctx.player;
    const classTitle = HERO_CLASS_CONFIG[p.heroClass]?.title ?? p.heroClass;
    const unlockedAch = (ctx.achievements ?? []).filter((a) => a.unlocked).length;
    const totalAch = (ctx.achievements ?? []).length;
    const legendariesEquipped = Object.values(ctx.equipped ?? {}).filter(
      (item) => item?.rarity === 'legendary',
    ).length;

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop is-victory">
        <div class="ar-dramatic-card is-victory" role="dialog" aria-label="Chiến Thắng Thăng Hoa">
          <div class="ar-title-crown" style="width:84px;height:64px;">${SVG_SHATTERED_CROWN}</div>
          <div>
            <div class="ar-title-eyebrow" style="color:#ffe08a;">Vương Miện Vỡ Vụn Đã Được Thu Hồi</div>
            <h2 class="ar-dramatic-title tone-gold" style="margin-top:4px;">Chiến Thắng Thăng Hoa</h2>
            <p style="font-size:13.5px;color:#e8dcc4;margin-top:8px;line-height:1.55;">
              Malakor, Hoàng Đế Hư Không đã gục ngã tại Thánh Điện Tinh Tú. Tên của bạn được khắc ghi mãi mãi bằng cổ ngữ vàng khắp Vực Thẳm Huyền Bí!
            </p>
          </div>

          <div class="ar-run-stats-grid" style="grid-template-columns:repeat(3,1fr);">
            <div class="ar-run-stat-box">
              <span>Người Thăng Hoa</span>
              <strong>${escapeHtml(classTitle)}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Cấp Độ Cuối</span>
              <strong>Cấp ${safeNum(p.level, 1)}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Số Tầng Đã Vượt</span>
              <strong>${Math.max(4, safeNum(p.floorsCleared, 4))}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Kẻ Thù Đã Diệt</span>
              <strong>${safeNum(p.killsTotal, 0).toLocaleString()}</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Kho Báu Vàng</span>
              <strong style="color:#ffd97d;">${Math.floor(safeNum(p.gold, 0)).toLocaleString()}g</strong>
            </div>
            <div class="ar-run-stat-box">
              <span>Chiến Công / Thánh Vật</span>
              <strong>${unlockedAch}/${totalAch} • ${legendariesEquipped}★</strong>
            </div>
          </div>

          <div class="ar-menu-stack">
            <button type="button" class="ar-btn ar-btn-gold" data-action="victory-continue">
              ✦ Tiếp Tục Khám Phá Cõi Vực Thẳm
            </button>
            <button type="button" class="ar-btn ar-btn-emerald" data-action="victory-retry">
              ⚔ Bắt Đầu Hành Trình Mới
            </button>
            <button type="button" class="ar-btn" data-action="victory-title">
              ↩ Về Màn Hình Chính
            </button>
          </div>
        </div>
      </div>
    `;

    mountEl.querySelector('[data-action="victory-continue"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      onResumeVigil();
    });
    mountEl.querySelector('[data-action="victory-retry"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      callbacks?.onRespawnOrRetry();
    });
    mountEl.querySelector('[data-action="victory-title"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      callbacks?.onReturnToTitle();
    });
  }
}
