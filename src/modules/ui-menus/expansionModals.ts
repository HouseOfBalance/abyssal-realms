import { BIOME_CONFIG } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import type {
  BiomeId,
  DerivedStats,
  MenuPanelId,
  MenusCallbacks,
  MenusRefreshContext,
  ObeliskPactCard,
} from '../../contracts/types';
import {
  escapeHtml,
  formatStatValue,
  getStatLabel,
  safeNum,
} from './icons';
import { bindWindowTopbarEvents, renderWindowTopbar } from './sharedHeader';

const FALLBACK_OBELISK_CHOICES: ReadonlyArray<ObeliskPactCard> = [
  {
    id: 'pact_blood_frenzy',
    title: 'Giao Ước Tàn Sát Đỏ Thẫm',
    blessingText: '+35% Sức Tấn Công, +20% Tốc Độ Đánh & +8% Hút Máu trong chuyến thám hiểm này.',
    curseText: 'Bạn chịu thêm +20% sát thương nhận vào từ mọi nguồn vực thẳm.',
    tone: 'crimson',
    statModifiers: { attackPower: 28, attackSpeed: 0.2, lifeSteal: 0.08 },
    damageTakenMultiplier: 1.2,
  },
  {
    id: 'pact_golden_avarice',
    title: 'Lời Thề Tham Lam Mạ Vàng',
    blessingText: '+75% Vàng Nhặt Được & +12% Tỉ Lệ Chí Mạng.',
    curseText: 'Triệu hồi ngay lập tức một đợt Phục Kích Quỷ Tinh Anh quanh Tảng Đá Thần!',
    tone: 'gold',
    statModifiers: { critChance: 0.12 },
    goldFindMultiplier: 1.75,
    spawnEliteAmbush: true,
  },
  {
    id: 'pact_storm_conduit',
    title: 'Khế Ước Bão Tố Tinh Tú',
    blessingText: 'Đòn chí mạng phóng ra tia Xích Sét + +18% Giảm Hồi Chiêu.',
    curseText: 'Máu Tối Đa giảm -45 khi cơn bão cuộn trào trong cơ thể bạn.',
    tone: 'arcane',
    statModifiers: { cooldownReduction: 0.18, maxHp: -45 },
    critChainLightning: true,
  },
];

const CAMPAIGN_FLOORS: ReadonlyArray<{
  floor: number;
  roman: string;
  biome: BiomeId;
  bossName: string;
  hazardsNote: string;
  accent: string;
}> = [
  {
    floor: 1,
    roman: 'Tầng I',
    biome: 'crypt',
    bossName: 'Khổng Lồ Xương',
    hazardsNote: 'Gai Xương Hầm Mộ & Bệ Thờ Nguyền Rủa',
    accent: '#91a7ff',
  },
  {
    floor: 2,
    roman: 'Tầng II',
    biome: 'caverns',
    bossName: 'Chúa Nhện Arachne',
    hazardsNote: 'Khe Phun Nọc Độc & Lưới Nhện Dịch Bệnh',
    accent: '#51cf66',
  },
  {
    floor: 3,
    roman: 'Tầng III',
    biome: 'forge',
    bossName: 'Thợ Rèn Lửa Ignis',
    hazardsNote: 'Dung Nham Nóng Chảy & Lưỡi Dao Con Lắc',
    accent: '#ff6b35',
  },
  {
    floor: 4,
    roman: 'Tầng IV',
    biome: 'void',
    bossName: 'Malakor, Hoàng Đế Hư Không',
    hazardsNote: 'Tháp Pháo Tinh Tú & Khe Nứt Kỳ Dị',
    accent: '#da77f2',
  },
  {
    floor: 5,
    roman: 'Tầng V',
    biome: 'cathedral',
    bossName: 'Valkyria, Thiên Thần Sương Giá',
    hazardsNote: 'Mặt Băng Trơn Trượt & Bão Tuyết Lạnh Giá',
    accent: '#74c0fc',
  },
  {
    floor: 6,
    roman: 'Tầng VI',
    biome: 'observatory',
    bossName: 'Chronos, Kiến Trúc Sư Thời Gian',
    hazardsNote: 'Bệ Dịch Chuyển & Tia Laser Quét',
    accent: '#ffd43b',
  },
];

const TONE_PALETTE: Record<
  ObeliskPactCard['tone'],
  { accent: string; glow: string; badge: string }
> = {
  crimson: {
    accent: '#ff4d6d',
    glow: 'rgba(255, 77, 109, 0.34)',
    badge: '🩸 Giao Ước Huyết Tộc',
  },
  gold: {
    accent: '#fcc419',
    glow: 'rgba(252, 196, 25, 0.34)',
    badge: '👑 Giao Ước Tham Lam',
  },
  arcane: {
    accent: '#cc5de8',
    glow: 'rgba(204, 93, 232, 0.34)',
    badge: '✦ Giao Ước Tinh Tú',
  },
};

export class ExpansionModalsController {
  /* =========================================================
     CORRUPTED OBELISK 3-CARD ROGUELIKE DRAFT ('obelisk')
     ========================================================= */
  renderObeliskDraft(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    onCloseModal: () => void,
    isEntering = false,
  ): void {
    const choices =
      (ctx.obeliskChoices ?? []).length > 0 ? ctx.obeliskChoices! : FALLBACK_OBELISK_CHOICES;

    const cardsHtml = choices
      .slice(0, 3)
      .map((card) => {
        const theme = TONE_PALETTE[card.tone] ?? TONE_PALETTE.crimson;
        const statPills = Object.entries(card.statModifiers ?? {})
          .map(([k, v]) => {
            const key = k as keyof DerivedStats;
            const num = safeNum(v as number, 0);
            if (Math.abs(num) < 1e-5) return '';
            const sign = num >= 0 ? '+' : '';
            const color = num >= 0 ? '#8ce99a' : '#ffa8a8';
            return `<span style="font-size:10.5px;padding:2px 6px;border-radius:3px;background:rgba(0,0,0,0.48);border:1px solid ${color}66;color:${color};">${sign}${escapeHtml(formatStatValue(key, num))} ${escapeHtml(getStatLabel(key))}</span>`;
          })
          .filter(Boolean)
          .join('');

        return `
          <article
            class="ar-obelisk-card"
            style="--pact-accent:${theme.accent};--pact-glow:${theme.glow};"
          >
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <span style="font-size:10.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:${theme.accent};">
                ${theme.badge}
              </span>
              ${
                card.spawnEliteAmbush
                  ? `<span style="font-size:9.5px;padding:2px 6px;border-radius:3px;background:rgba(224,49,49,0.28);border:1px solid #ff6b6b;color:#ffc9c9;font-weight:700;">⚔ Phục Kích</span>`
                  : ''
              }
            </div>

            <h3 style="font-family:var(--font-display);font-size:18px;font-weight:700;color:#fff4dc;line-height:1.25;">
              ${escapeHtml(card.title)}
            </h3>

            <div class="ar-pact-box is-blessing">
              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#69db7c;margin-bottom:3px;">
                ✦ Phước Lành Vực Thẳm
              </div>
              <div>${escapeHtml(card.blessingText)}</div>
            </div>

            <div class="ar-pact-box is-curse">
              <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#ff8787;margin-bottom:3px;">
                ☠ Cái Giá Hắc Ám
              </div>
              <div>${escapeHtml(card.curseText)}</div>
            </div>

            ${
              statPills
                ? `<div style="display:flex;flex-wrap:wrap;gap:5px;">${statPills}</div>`
                : ''
            }

            <button
              type="button"
              class="ar-btn ar-btn-primary"
              data-select-pact="${escapeHtml(card.id)}"
              style="margin-top:auto;width:100%;"
            >
              ❖ Phong Ấn Giao Ước: ${escapeHtml(card.title)}
            </button>
          </article>
        `;
      })
      .join('');

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop is-death" data-backdrop="closeable">
        <div class="ar-obelisk-shell ${isEntering ? 'ar-tab-spring' : ''}" role="dialog" aria-label="Chọn Giao Ước Tảng Đá Thần Tha Hóa">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
            <div>
              <div class="ar-title-eyebrow" style="color:#ff758f;">Ba Cổ Ngữ Rực Cháy Trên Tảng Đá</div>
              <h2 class="ar-dramatic-title tone-crimson" style="font-size:28px;margin-top:3px;text-align:left;">
                Tảng Đá Thần Tha Hóa — Chọn Giao Ước
              </h2>
              <p style="font-size:12.5px;color:#d6c0c8;margin-top:4px;">
                Trói buộc một sắc lệnh cấm kỵ vào linh hồn bạn cho phần còn lại của chuyến thám hiểm, hoặc rời đi bình an.
              </p>
            </div>
            <button type="button" class="ar-close-btn" data-action="close-obelisk" title="Rời Khỏi Tảng Đá">✕</button>
          </div>

          <div class="ar-obelisk-grid">
            ${cardsHtml}
          </div>

          <div style="display:flex;justify-content:center;">
            <button type="button" class="ar-btn ar-btn-sm" data-action="decline-obelisk">
              Lùi Bước Khỏi Tảng Đá (Từ Chối)
            </button>
          </div>
        </div>
      </div>
    `;

    mountEl.querySelectorAll<HTMLButtonElement>('[data-select-pact]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pactId = btn.dataset.selectPact;
        if (!pactId) return;
        eventBus.emit('sfx:request', { id: 'shrine_bless' });
        onCloseModal();
        callbacks?.onSelectObeliskPact?.(pactId);
      });
    });

    const decline = () => {
      eventBus.emit('sfx:request', { id: 'ui_click' });
      onCloseModal();
    };
    mountEl.querySelector('[data-action="close-obelisk"]')?.addEventListener('click', decline);
    mountEl.querySelector('[data-action="decline-obelisk"]')?.addEventListener('click', decline);

    const backdrop = mountEl.querySelector<HTMLElement>('[data-backdrop="closeable"]');
    backdrop?.addEventListener('click', (ev) => {
      if (ev.target === backdrop) decline();
    });
  }

  /* =========================================================
     WAYPOINT ATLAS WORLD MAP ('world_map')
     ========================================================= */
  renderWorldMap(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    onSwitchPanel: (panel: MenuPanelId) => void,
    onCloseModal: () => void,
    isEntering = false,
  ): void {
    const highestUnlocked = Math.max(
      1,
      safeNum(ctx.highestFloorUnlocked, safeNum(ctx.player?.floorsCleared, 0) + 1),
    );
    const bestWave = safeNum(ctx.colosseumBestWave, 0);

    const floorCardsHtml = CAMPAIGN_FLOORS.map((f) => {
      const biomeCfg = BIOME_CONFIG[f.biome];
      const unlocked = f.floor <= highestUnlocked;

      return `
        <article
          class="ar-waypoint-card ${unlocked ? '' : 'is-locked'}"
          style="border-color:${unlocked ? `${f.accent}66` : 'rgba(200,155,60,0.2)'};"
        >
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:10.5px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${f.accent};">
              ${escapeHtml(f.roman)}
            </span>
            <span style="font-size:10px;padding:2px 7px;border-radius:3px;background:${unlocked ? 'rgba(47,158,68,0.22)' : 'rgba(0,0,0,0.5)'};border:1px solid ${unlocked ? '#51cf66' : '#868e96'};color:${unlocked ? '#8ce99a' : '#adb5bd'};font-weight:700;">
              ${unlocked ? 'Đã Kết Nối' : 'Đã Phong Ấn'}
            </span>
          </div>

          <h3 style="font-family:var(--font-display);font-size:16px;color:#fff4dc;">
            ${escapeHtml(biomeCfg?.name ?? f.biome)}
          </h3>

          <div style="font-size:11.5px;color:#bfb299;line-height:1.4;">
            <div><strong>Trùm Đỉnh Cao:</strong> <span style="color:#ffd97d;">${escapeHtml(f.bossName)}</span></div>
            <div style="color:#968b74;margin-top:2px;">${escapeHtml(f.hazardsNote)}</div>
          </div>

          <button
            type="button"
            class="ar-btn ar-btn-sm ${unlocked ? 'ar-btn-gold' : ''}"
            data-travel-floor="${f.floor}"
            ${unlocked ? '' : 'disabled'}
            style="margin-top:auto;width:100%;"
          >
            ${unlocked ? `✦ Dịch Chuyển Đến ${escapeHtml(f.roman)}` : `🔒 Chinh Phục Tầng ${f.floor - 1} Trước`}
          </button>
        </article>
      `;
    }).join('');

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop" data-backdrop="closeable">
        <div class="ar-modal-window ${isEntering ? 'is-entering' : ''}" role="dialog" aria-label="Bản Đồ Thế Giới Điểm Dịch Chuyển">
          ${renderWindowTopbar(
            'world_map',
            'Bản Đồ Điểm Dịch Chuyển Tinh Tú',
            'Thánh Địa Pháo Đài, Tầng I–VI & Đấu Trường Đỏ Thẫm',
            ctx,
          )}

          <div class="ar-atlas-layout" data-scroll-key="atlas-scroll">
            <div class="ar-stats-section-title" style="margin-top:0;">Thánh Địa Pháo Đài &amp; Đấu Trường Cuối Game</div>
            <div class="ar-atlas-featured-row">
              <!-- SANCTUARY HUB -->
              <article class="ar-waypoint-card" style="border-color:rgba(116,192,252,0.62);background:radial-gradient(circle at 20% 20%,rgba(59,72,104,0.38),rgba(12,10,20,0.96));">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#74c0fc;">
                    🏛 Trung Tâm An Toàn
                  </span>
                  <span style="font-size:10.5px;color:#a5d8ff;font-weight:700;">Luôn Kết Nối</span>
                </div>
                <h3 style="font-family:var(--font-display);font-size:19px;color:#fff4dc;">
                  ${escapeHtml(BIOME_CONFIG.sanctuary.name)}
                </h3>
                <p style="font-size:12px;color:#cfc3ab;line-height:1.45;">
                  Quay về Pháo Đài dưới ánh trăng để sắp xếp <strong>Kho Chứa Chung</strong>, rèn <strong>Từ Khóa Rune</strong>, thử vận may với <strong>Nhà Cờ Bạc Bí Ẩn</strong>, chiêu mộ <strong>Đồng Hành</strong>, và đo sát thương DPS trên <strong>Hình Nộm Huấn Luyện</strong> bất tử.
                </p>
                <button type="button" class="ar-btn ar-btn-emerald" data-travel-dest="sanctuary" style="margin-top:auto;">
                  🏛 Dịch Chuyển Về Thánh Địa Pháo Đài
                </button>
              </article>

              <!-- CRIMSON COLOSSEUM -->
              <article class="ar-waypoint-card" style="border-color:rgba(255,77,109,0.68);background:radial-gradient(circle at 80% 20%,rgba(168,20,42,0.38),rgba(14,8,14,0.96));">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#ff6b6b;">
                    ⚔ Đấu Trường Trùm Bất Tận
                  </span>
                  <span style="font-size:11px;color:#ffd97d;font-weight:800;">
                    🏆 Đợt Cao Nhất: ${bestWave}
                  </span>
                </div>
                <h3 style="font-family:var(--font-display);font-size:19px;color:#fff4dc;">
                  ${escapeHtml(BIOME_CONFIG.colosseum.name)}
                </h3>
                <p style="font-size:12px;color:#e2c6ca;line-height:1.45;">
                  Bước vào đấu trường đẫm máu để đối mặt với quân đoàn quái vật leo thang, Song Trùm Đối Đầu, Rune cấp cao và chiến lợi phẩm <strong>Thần Thoại Nguyên Thủy</strong> đảm bảo!
                </p>
                <button type="button" class="ar-btn ar-btn-primary" data-travel-dest="colosseum" style="margin-top:auto;">
                  🔥 Vào Đấu Trường Đỏ Thẫm
                </button>
              </article>
            </div>

            <div class="ar-stats-section-title">Điểm Dịch Chuyển Thám Hiểm Vực Thẳm (Tầng I – VI)</div>
            <div class="ar-atlas-floors-grid">
              ${floorCardsHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    bindWindowTopbarEvents(mountEl, { onSwitchPanel, onClose: onCloseModal });

    const backdrop = mountEl.querySelector<HTMLElement>('[data-backdrop="closeable"]');
    backdrop?.addEventListener('click', (ev) => {
      if (ev.target === backdrop) {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        onCloseModal();
      }
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-travel-dest]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dest = btn.dataset.travelDest as 'sanctuary' | 'colosseum' | undefined;
        if (!dest) return;
        eventBus.emit('sfx:request', { id: 'portal_hum' });
        onCloseModal();
        callbacks?.onTravelDestination?.(dest);
      });
    });

    mountEl.querySelectorAll<HTMLButtonElement>('[data-travel-floor]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const floorNum = parseInt(btn.dataset.travelFloor ?? '', 10);
        if (!Number.isFinite(floorNum) || floorNum < 1) return;
        eventBus.emit('sfx:request', { id: 'portal_hum' });
        onCloseModal();
        callbacks?.onTravelDestination?.(floorNum);
      });
    });
  }
}
