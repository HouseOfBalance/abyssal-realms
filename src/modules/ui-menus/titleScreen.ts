import { HERO_CLASS_CONFIG } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import type { HeroClassId, MenusCallbacks, MenusRefreshContext } from '../../contracts/types';
import {
  escapeHtml,
  getHeroClassSvg,
  getWeaponVisualSvg,
  SVG_SHATTERED_CROWN,
} from './icons';
import { t } from '../../core/i18n/index.js';

interface ClassPresentation {
  playstyle: string;
  lore: string;
  weaponLabel: string;
  accentCss: string;
  glowCss: string;
  tags: string[];
}

const CLASS_DETAILS: Record<HeroClassId, ClassPresentation> = {
  vanguard: {
    playstyle: 'Chiến Binh Cận Chiến • Tấn Công Diện Rộng & Phòng Thủ',
    lore: 'Khoác áo giáp rèn dưới những tòa thành sụp đổ, Tiền Phong nghiền nát đội hình quỷ dữ bằng những nhát kiếm đại hải, nhảy địa chấn và ý chí sắt đá bất khuất.',
    weaponLabel: 'Đại Kiếm Vực Thẳm',
    accentCss: '#e03131',
    glowCss: 'rgba(201, 42, 42, 0.34)',
    tags: ['Giáp Cao & Sinh Lực Lớn', 'Lốc Xoáy & Nhảy Địa Chấn', 'Tiền Vệ Bất Khả Chiến Bại'],
  },
  shadowblade: {
    playstyle: 'Sát Thủ Linh Hoạt • Chí Mạng, Chảy Máu & Độc',
    lore: 'Bóng ma vô hình của Màn Đêm Hắc Diện nhảy múa giữa những đòn chí tử, tẩm độc kẻ thù trước khi kích nổ loạt đòn bóng tối chí mạng.',
    weaponLabel: 'Song Đao Hắc Diện',
    accentCss: '#40c057',
    glowCss: 'rgba(47, 158, 68, 0.34)',
    tags: ['Chí Mạng & Né Tránh Cực Cao', 'Lướt Bóng & Độc', 'Đấu Sĩ Không Mệt Mỏi'],
  },
  arcanist: {
    playstyle: 'Pháp Thuật Tinh Tú • Thảm Họa Nguyên Tố',
    lore: 'Bậc thầy hình học hư không cấm kỵ và ngọn lửa thiên đình, triệu hồi thiên thạch tận thế, cầu băng và xích sét từ xa.',
    weaponLabel: 'Trượng Tinh Tú Nexus',
    accentCss: '#4dabf7',
    glowCss: 'rgba(51, 154, 240, 0.34)',
    tags: ['Phép Thuật AoE Khổng Lồ', 'Băng, Lửa & Sét', 'Thông Thạo Ma Pháp'],
  },
};

const HERO_ORDER: HeroClassId[] = ['vanguard', 'shadowblade', 'arcanist'];

interface EmberParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  hue: string;
}

export class TitleScreenController {
  private selectedClass: HeroClassId = 'vanguard';
  private rafId: number | null = null;
  private resizeHandler: (() => void) | null = null;

  getSelectedClass(): HeroClassId {
    return this.selectedClass;
  }

  render(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    onOpenSettings: () => void,
  ): void {
    this.stopAtmosphere();

    const cardsHtml = HERO_ORDER.map((classId) => {
      const cfg = HERO_CLASS_CONFIG[classId];
      const info = CLASS_DETAILS[classId];
      const isSelected = this.selectedClass === classId;
      const attrs = cfg.baseAttributes;

      const attrBars = [
        { label: 'Sức Mạnh', val: attrs.strength, color: '#ff6b6b' },
        { label: 'Nhanh Nhẹn', val: attrs.dexterity, color: '#51cf66' },
        { label: 'Trí Tuệ', val: attrs.intelligence, color: '#4dabf7' },
        { label: 'Sinh Lực', val: attrs.vitality, color: '#fcc419' },
      ]
        .map((a) => {
          const pct = Math.min(100, Math.round((a.val / 20) * 100));
          return `
            <div class="ar-hero-attr-bar">
              <div class="ar-hero-attr-head">
                <span>${a.label}</span>
                <strong>${a.val}</strong>
              </div>
              <div class="ar-hero-attr-track">
                <div class="ar-hero-attr-fill" style="width:${pct}%;--attr-color:${a.color}"></div>
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <article
          class="ar-hero-card ${isSelected ? 'is-selected' : ''}"
          data-hero-class="${classId}"
          style="--hero-accent:${info.accentCss};--hero-glow:${info.glowCss}"
          role="button"
          tabindex="0"
          aria-pressed="${isSelected}"
        >
          <div class="ar-hero-card-top">
            <div class="ar-hero-emblem">${getHeroClassSvg(classId)}</div>
            <div>
              <div class="ar-hero-card-title">${escapeHtml(cfg.title)}</div>
              <div class="ar-hero-card-sub">${escapeHtml(cfg.subtitle)}</div>
            </div>
            ${isSelected ? `<span class="ar-hero-selected-pill">Đã Chọn</span>` : ''}
          </div>

          <p class="ar-hero-lore">${escapeHtml(info.lore)}</p>

          <div class="ar-hero-meta-row">
            <span class="ar-hero-meta-label">Phong Cách Chơi</span>
            <span class="ar-hero-meta-val" style="color:${info.accentCss}">${escapeHtml(info.playstyle)}</span>
          </div>

          <div class="ar-hero-meta-row">
            <span class="ar-hero-meta-label">Vũ Khí Khởi Đầu</span>
            <span class="ar-hero-meta-val">
              ${getWeaponVisualSvg(cfg.startingWeapon, info.accentCss)}
              <span>${escapeHtml(info.weaponLabel)}</span>
            </span>
          </div>

          <div class="ar-hero-attrs">
            ${attrBars}
          </div>

          <div class="ar-hero-tags">
            ${info.tags.map((t) => `<span class="ar-hero-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
        </article>
      `;
    }).join('');

    const selectedCfg = HERO_CLASS_CONFIG[this.selectedClass];

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop is-title">
        <canvas class="ar-title-canvas" data-role="title-canvas"></canvas>
        <div class="ar-title-shell">
          <header class="ar-title-header">
            <div class="ar-title-crown">${SVG_SHATTERED_CROWN}</div>
            <div class="ar-title-eyebrow">Game Hành Động RPG 3D Giả Tưởng Tối</div>
            <h1 class="ar-title-main">Vực Thẳm Huyền Bí</h1>
            <div class="ar-title-sub">Vương Miện Vỡ Vụn</div>
          </header>

          <div class="ar-title-cta-bar">
            ${
              ctx.hasSaveGame
                ? `<button type="button" class="ar-btn ar-btn-emerald ar-title-cta-btn" data-action="continue-game">
                    ✦ ${t('menu.continue')}
                  </button>`
                : ''
            }
            <button type="button" class="ar-btn ar-btn-primary ar-title-cta-btn" data-action="start-new-game">
              ⚔ Vào Vực Thẳm với ${escapeHtml(selectedCfg.title)}
            </button>
            <button type="button" class="ar-btn ar-btn-coop ar-title-cta-btn" data-action="open-coop-lobby">
              🌐 ONLINE CO-OP (KHÁC MẠNG / P2P)
            </button>
            <button type="button" class="ar-btn" data-action="title-settings" style="padding:10px 18px;">
              ⚙ ${t('settings.title')}
            </button>
          </div>

          <section class="ar-hero-grid" aria-label="Chọn Nhân Vật Của Bạn">
            ${cardsHtml}
          </section>

          <footer class="ar-controls-guide" aria-label="Hướng Dẫn Điều Khiển Nhanh">
            <span class="ar-controls-guide-title">Hướng Dẫn Điều Khiển</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">WASD</kbd> Di Chuyển</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">LMB</kbd> / <kbd class="ar-keycap">RMB</kbd> Tấn Công Cơ Bản</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">1</kbd>–<kbd class="ar-keycap">4</kbd> Kỹ Năng Lớp</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">Space</kbd> Né Tránh</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">V</kbd> Đỡ Đòn • <kbd class="ar-keycap">R</kbd> Thức Tỉnh</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">Q</kbd> Thuốc • <kbd class="ar-keycap">F</kbd> Tương Tác</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">I</kbd> Trang Bị • <kbd class="ar-keycap">K</kbd> Kỹ Năng • <kbd class="ar-keycap">J</kbd> Nhật Ký</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">P</kbd> Hợp Tác • <kbd class="ar-keycap">T</kbd> Giọng Nói • <kbd class="ar-keycap">G</kbd> Ping</span>
            <span class="ar-control-chip"><kbd class="ar-keycap">Esc</kbd> Tạm Dừng</span>
          </footer>
        </div>
      </div>
    `;

    // Bind hero card selection
    mountEl.querySelectorAll<HTMLElement>('[data-hero-class]').forEach((card) => {
      const selectCard = () => {
        const chosen = card.dataset.heroClass as HeroClassId | undefined;
        if (!chosen || chosen === this.selectedClass) return;
        this.selectedClass = chosen;
        eventBus.emit('sfx:request', { id: 'ui_click' });
        this.render(mountEl, ctx, callbacks, onOpenSettings);
      };
      card.addEventListener('click', selectCard);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          selectCard();
        }
      });
    });

    const startBtn = mountEl.querySelector<HTMLButtonElement>('[data-action="start-new-game"]');
    startBtn?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      callbacks?.onStartNewGame(this.selectedClass);
    });

    const continueBtn = mountEl.querySelector<HTMLButtonElement>('[data-action="continue-game"]');
    continueBtn?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      callbacks?.onContinueGame();
    });

    const coopBtn = mountEl.querySelector<HTMLButtonElement>('[data-action="open-coop-lobby"]');
    coopBtn?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      callbacks?.onOpenMultiplayerLobby?.();
      eventBus.emit('mp:openLobby', {});
    });

    const settingsBtn = mountEl.querySelector<HTMLButtonElement>('[data-action="title-settings"]');
    settingsBtn?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      onOpenSettings();
    });

    const canvas = mountEl.querySelector<HTMLCanvasElement>('[data-role="title-canvas"]');
    if (canvas) {
      this.startAtmosphere(canvas);
    }
  }

  private startAtmosphere(canvas: HTMLCanvasElement): void {
    const ctx2d = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx2d || typeof window === 'undefined') return;

    const syncSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, canvas.clientWidth || window.innerWidth || 1280);
      const h = Math.max(1, canvas.clientHeight || window.innerHeight || 720);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncSize();
    this.resizeHandler = syncSize;
    window.addEventListener('resize', syncSize);

    const colors = ['#ffd97d', '#ff6b35', '#da77f2', '#74c0fc'];
    const particles: EmberParticle[] = Array.from({ length: 52 }, (_, i) => ({
      x: ((i * 97) % 100) * 0.01 * (window.innerWidth || 1280),
      y: ((i * 53) % 100) * 0.01 * (window.innerHeight || 720),
      vx: ((i % 7) - 3) * 0.14,
      vy: -0.25 - (i % 5) * 0.16,
      size: 1.1 + (i % 4) * 0.75,
      alpha: 0.18 + (i % 6) * 0.09,
      hue: colors[i % colors.length],
    }));

    const tick = () => {
      const w = canvas.clientWidth || window.innerWidth || 1280;
      const h = canvas.clientHeight || window.innerHeight || 720;
      ctx2d.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        ctx2d.globalAlpha = p.alpha;
        ctx2d.fillStyle = p.hue;
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.globalAlpha = 1;
      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  stopAtmosphere(): void {
    if (this.rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.resizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  dispose(): void {
    this.stopAtmosphere();
  }
}
