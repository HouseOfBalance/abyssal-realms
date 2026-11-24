import { eventBus } from '../../core/EventBus';
import type { MenuPanelId, MenusRefreshContext } from '../../contracts/types';
import { escapeHtml, safeNum, SVG_GOLD_COIN, SVG_SHATTERED_CROWN } from './icons';

export interface TopbarActions {
  onSwitchPanel: (panel: MenuPanelId) => void;
  onClose: () => void;
}

export function renderWindowTopbar(
  activePanel: MenuPanelId,
  title: string,
  subtitle: string,
  ctx: MenusRefreshContext,
): string {
  const attrPts = safeNum(ctx.player?.unspentAttributePoints, 0);
  const skillPts = safeNum(ctx.player?.unspentSkillPoints, 0);
  const activeQuests = (ctx.quests ?? []).filter((q) => q.status === 'active').length;
  const gold = Math.floor(safeNum(ctx.player?.gold, 0));

  return `
    <header class="ar-window-topbar">
      <div class="ar-topbar-brand">
        <div class="ar-topbar-crest">${SVG_SHATTERED_CROWN}</div>
        <div>
          <div class="ar-topbar-title">${escapeHtml(title)}</div>
          <div class="ar-topbar-subtitle">${escapeHtml(subtitle)}</div>
        </div>
      </div>

      <nav class="ar-topbar-tabs" aria-label="Điều Hướng Thánh Địa">
        <button type="button" class="ar-nav-tab ${activePanel === 'inventory' ? 'is-active' : ''}" data-nav-panel="inventory">
          <span>Nhân Vật &amp; Rèn</span>
          <span class="ar-nav-hotkey">I</span>
          ${attrPts > 0 ? `<span class="ar-nav-badge" title="Điểm Thuộc Tính Chưa Dùng">+${attrPts}</span>` : ''}
        </button>
        <button type="button" class="ar-nav-tab ${activePanel === 'skills' ? 'is-active' : ''}" data-nav-panel="skills">
          <span>Chòm Sao Kỹ Năng</span>
          <span class="ar-nav-hotkey">K</span>
          ${skillPts > 0 ? `<span class="ar-nav-badge" title="Điểm Kỹ Năng Chưa Dùng">+${skillPts}</span>` : ''}
        </button>
        <button type="button" class="ar-nav-tab ${activePanel === 'quests' ? 'is-active' : ''}" data-nav-panel="quests">
          <span>Nhật Ký &amp; Nhiệm Vụ</span>
          <span class="ar-nav-hotkey">J</span>
          ${activeQuests > 0 ? `<span class="ar-nav-badge" style="background:rgba(200,155,60,0.45);box-shadow:none;">${activeQuests}</span>` : ''}
        </button>
        <button type="button" class="ar-nav-tab ${activePanel === 'world_map' ? 'is-active' : ''}" data-nav-panel="world_map">
          <span>Bản Đồ Thế Giới</span>
          <span class="ar-nav-hotkey">M</span>
        </button>
        <button type="button" class="ar-nav-tab ${activePanel === 'settings' ? 'is-active' : ''}" data-nav-panel="settings">
          <span>Cài Đặt</span>
        </button>
      </nav>

      <div class="ar-topbar-right">
        <div class="ar-gold-pill" title="Vàng Vực Thẳm">
          ${SVG_GOLD_COIN}
          <span>${gold.toLocaleString()}</span>
        </div>
        <button type="button" class="ar-close-btn" data-action="close-modal" title="Đóng Bảng (Esc)" aria-label="Đóng">✕</button>
      </div>
    </header>
  `;
}

export function bindWindowTopbarEvents(root: HTMLElement, actions: TopbarActions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-nav-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.navPanel as MenuPanelId | undefined;
      if (target) {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        actions.onSwitchPanel(target);
      }
    });
  });

  const closeBtn = root.querySelector<HTMLButtonElement>('[data-action="close-modal"]');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      actions.onClose();
    });
  }
}
