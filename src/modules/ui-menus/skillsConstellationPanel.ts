import { eventBus } from '../../core/EventBus';
import type {
  Attributes,
  DerivedStats,
  MenuPanelId,
  MenusCallbacks,
  MenusRefreshContext,
  PassiveBranch,
  PassiveNode,
} from '../../contracts/types';
import { escapeHtml, formatStatValue, getStatLabel, safeNum } from './icons';
import { bindWindowTopbarEvents, renderWindowTopbar } from './sharedHeader';

const BRANCH_THEME: Record<
  PassiveBranch,
  { label: string; core: string; glow: string; dim: string }
> = {
  warlord: {
    label: 'Chiến Thần',
    core: '#ff6b6b',
    glow: 'rgba(224, 49, 49, 0.58)',
    dim: 'rgba(224, 49, 49, 0.22)',
  },
  assassin: {
    label: 'Sát Thủ',
    core: '#51cf66',
    glow: 'rgba(47, 158, 68, 0.58)',
    dim: 'rgba(47, 158, 68, 0.22)',
  },
  archmage: {
    label: 'Đại Pháp Sư',
    core: '#5c7cfa',
    glow: 'rgba(77, 171, 247, 0.6)',
    dim: 'rgba(156, 54, 181, 0.25)',
  },
};

interface BgStar {
  nx: number;
  ny: number;
  r: number;
  phase: number;
  speed: number;
}

interface ScreenNode {
  node: PassiveNode;
  sx: number;
  sy: number;
  radius: number;
  rank: number;
  allocatable: boolean;
}

interface AstralBurst {
  nodeId: string | '__nexus__';
  bornMs: number;
  durationMs: number;
  color: string;
  isKeystone: boolean;
}

export class ConstellationPanelController {
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private isDragging = false;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private hoveredNodeId: string | null = null;
  private rafId: number | null = null;
  private resizeHandler: (() => void) | null = null;

  private activeMountEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private latestCtx: MenusRefreshContext | null = null;
  private latestCallbacks: MenusCallbacks | null = null;
  private screenNodes: ScreenNode[] = [];

  private baselineInitialized = false;
  private prevAllocated: Record<string, number> = {};
  private prevBonusTotals = new Map<keyof (DerivedStats & Attributes), number>();
  private bonusFlashes = new Map<
    keyof (DerivedStats & Attributes),
    { dir: 'up' | 'down'; deltaText: string; until: number }
  >();
  private astralBursts: AstralBurst[] = [];

  private readonly bgStars: BgStar[] = Array.from({ length: 110 }, (_, i) => ({
    nx: ((i * 73 + 19) % 1000) / 1000,
    ny: ((i * 137 + 41) % 1000) / 1000,
    r: 0.6 + (i % 4) * 0.45,
    phase: (i * 0.77) % (Math.PI * 2),
    speed: 0.8 + (i % 5) * 0.35,
  }));

  syncSilentBaseline(ctx: MenusRefreshContext): void {
    this.prevAllocated = { ...(ctx.allocatedPassives ?? {}) };
    this.prevBonusTotals = this.computeCurrentBonuses(ctx);
    this.baselineInitialized = true;
  }

  private computeCurrentBonuses(
    ctx: MenusRefreshContext,
  ): Map<keyof (DerivedStats & Attributes), number> {
    const map = new Map<keyof (DerivedStats & Attributes), number>();
    const allocated = ctx.allocatedPassives ?? {};
    for (const n of ctx.passiveNodes ?? []) {
      const rank = safeNum(allocated[n.id], 0);
      if (rank <= 0) continue;
      for (const [k, v] of Object.entries(n.statModifiers ?? {})) {
        const statKey = k as keyof (DerivedStats & Attributes);
        map.set(statKey, (map.get(statKey) ?? 0) + safeNum(v as number, 0) * rank);
      }
    }
    return map;
  }

  private detectConstellationChanges(ctx: MenusRefreshContext, suppressDiffs: boolean): void {
    const now = Date.now();
    const nextAlloc = ctx.allocatedPassives ?? {};
    const nextBonuses = this.computeCurrentBonuses(ctx);

    if (!this.baselineInitialized || suppressDiffs) {
      this.prevAllocated = { ...nextAlloc };
      this.prevBonusTotals = nextBonuses;
      this.baselineInitialized = true;
      return;
    }

    let prevSum = 0;
    let nextSum = 0;
    for (const v of Object.values(this.prevAllocated)) prevSum += safeNum(v, 0);
    for (const v of Object.values(nextAlloc)) nextSum += safeNum(v, 0);

    for (const n of ctx.passiveNodes ?? []) {
      const oldR = safeNum(this.prevAllocated[n.id], 0);
      const newR = safeNum(nextAlloc[n.id], 0);
      if (newR > oldR) {
        const theme = BRANCH_THEME[n.branch] ?? BRANCH_THEME.warlord;
        this.astralBursts.push({
          nodeId: n.id,
          bornMs: now,
          durationMs: n.isKeystone ? 920 : 680,
          color: n.isKeystone ? '#ffd97d' : theme.core,
          isKeystone: n.isKeystone,
        });
      }
    }

    if (prevSum > 0 && nextSum === 0) {
      this.astralBursts.push({
        nodeId: '__nexus__',
        bornMs: now,
        durationMs: 760,
        color: '#ffd97d',
        isKeystone: true,
      });
    }

    const allKeys = new Set<keyof (DerivedStats & Attributes)>([
      ...this.prevBonusTotals.keys(),
      ...nextBonuses.keys(),
    ]);
    for (const key of allKeys) {
      const diff = (nextBonuses.get(key) ?? 0) - (this.prevBonusTotals.get(key) ?? 0);
      if (Math.abs(diff) > 1e-4) {
        const sign = diff > 0 ? '+' : '';
        this.bonusFlashes.set(key, {
          dir: diff > 0 ? 'up' : 'down',
          deltaText: `${sign}${formatStatValue(key, diff)}`,
          until: now + 800,
        });
      }
    }

    this.prevAllocated = { ...nextAlloc };
    this.prevBonusTotals = nextBonuses;
  }

  render(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    callbacks: MenusCallbacks | null,
    onSwitchPanel: (panel: MenuPanelId) => void,
    onClose: () => void,
    isEntering = false,
  ): void {
    this.latestCtx = ctx;
    this.latestCallbacks = callbacks;
    this.detectConstellationChanges(ctx, isEntering);

    // If already mounted cleanly in-place on the skills screen, update HUD + sidebar without resetting canvas!
    const existingCanvas = mountEl.querySelector<HTMLCanvasElement>('[data-role="constellation-canvas"]');
    if (this.activeMountEl === mountEl && existingCanvas && this.canvasEl === existingCanvas) {
      this.updateDynamicDom(mountEl, ctx, onSwitchPanel, onClose);
      return;
    }

    this.stopLoop();
    this.activeMountEl = mountEl;

    mountEl.innerHTML = `
      <div class="ar-screen-backdrop" data-backdrop="closeable">
        <div class="ar-modal-window ${isEntering ? 'is-entering' : ''}" role="dialog" aria-label="Cây Kỹ Năng Chòm Sao">
          <div data-role="skills-topbar-slot">
            ${renderWindowTopbar(
              'skills',
              'Chòm Sao Tinh Tú',
              'Bản Đồ Sao Thụ Động: Chiến Thần, Sát Thủ & Đại Pháp Sư',
              ctx,
            )}
          </div>

          <div class="ar-skills-layout">
            <div class="ar-constellation-stage">
              <canvas class="ar-constellation-canvas" data-role="constellation-canvas"></canvas>

              <div class="ar-constellation-hud-top">
                <div data-role="skills-points-slot">
                  ${this.renderPointsPillHtml(ctx)}
                </div>

                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <button type="button" class="ar-btn ar-btn-sm" data-action="zoom-in" title="Phóng To">+</button>
                  <button type="button" class="ar-btn ar-btn-sm" data-action="zoom-out" title="Thu Nhỏ">−</button>
                  <button type="button" class="ar-btn ar-btn-sm" data-action="zoom-reset" title="Căn Giữa Bản Đồ Sao">Căn Giữa</button>
                  <button type="button" class="ar-btn ar-btn-sm ar-btn-danger" data-action="respec-tree">
                    ↺ Đặt Lại Chòm Sao
                  </button>
                </div>
              </div>

              <div class="ar-constellation-legend">
                <span><i class="ar-branch-dot" style="background:#ff6b6b;"></i>Chiến Thần</span>
                <span><i class="ar-branch-dot" style="background:#51cf66;"></i>Sát Thủ</span>
                <span><i class="ar-branch-dot" style="background:#5c7cfa;"></i>Đại Pháp Sư</span>
                <span>◆ Tinh Thạch Chính</span>
              </div>
            </div>

            <aside class="ar-subpanel">
              <div class="ar-subpanel-header">
                <span class="ar-subpanel-title">Đồng Bộ Tinh Tú</span>
              </div>
              <div class="ar-subpanel-body" data-role="skills-sidebar-body">
                ${this.renderSidebarHtml(ctx)}
              </div>
            </aside>
          </div>
        </div>

        <div class="ar-floating-tooltip is-hidden" data-role="skill-tooltip"></div>
      </div>
    `;

    this.canvasEl = mountEl.querySelector<HTMLCanvasElement>('[data-role="constellation-canvas"]');
    this.tooltipEl = mountEl.querySelector<HTMLElement>('[data-role="skill-tooltip"]');

    bindWindowTopbarEvents(mountEl, { onSwitchPanel, onClose });

    const backdrop = mountEl.querySelector<HTMLElement>('[data-backdrop="closeable"]');
    backdrop?.addEventListener('click', (ev) => {
      if (ev.target === backdrop) {
        eventBus.emit('sfx:request', { id: 'ui_click' });
        onClose();
      }
    });

    this.bindControls(mountEl);
    if (this.canvasEl) {
      this.bindCanvasInteractions(this.canvasEl);
      this.startLoop(this.canvasEl);
    }
  }

  private updateDynamicDom(
    mountEl: HTMLElement,
    ctx: MenusRefreshContext,
    onSwitchPanel: (panel: MenuPanelId) => void,
    onClose: () => void,
  ): void {
    const topbarSlot = mountEl.querySelector<HTMLElement>('[data-role="skills-topbar-slot"]');
    if (topbarSlot) {
      topbarSlot.innerHTML = renderWindowTopbar(
        'skills',
        'Chòm Sao Tinh Tú',
        'Bản Đồ Sao Thụ Động: Chiến Thần, Sát Thủ & Đại Pháp Sư',
        ctx,
      );
      bindWindowTopbarEvents(topbarSlot, { onSwitchPanel, onClose });
    }

    const pointsSlot = mountEl.querySelector<HTMLElement>('[data-role="skills-points-slot"]');
    if (pointsSlot) {
      pointsSlot.innerHTML = this.renderPointsPillHtml(ctx);
    }

    const sidebarSlot = mountEl.querySelector<HTMLElement>('[data-role="skills-sidebar-body"]');
    if (sidebarSlot) {
      sidebarSlot.innerHTML = this.renderSidebarHtml(ctx);
    }

    // Refresh tooltip if currently hovering a node
    if (this.hoveredNodeId && this.tooltipEl && !this.tooltipEl.classList.contains('is-hidden')) {
      const hovered = (ctx.passiveNodes ?? []).find((n) => n.id === this.hoveredNodeId);
      if (hovered) {
        this.tooltipEl.innerHTML = this.buildNodeTooltipHtml(hovered, ctx);
      }
    }
  }

  private renderPointsPillHtml(ctx: MenusRefreshContext): string {
    const unspent = safeNum(ctx.player?.unspentSkillPoints, 0);
    const totalAllocated = Object.values(ctx.allocatedPassives ?? {}).reduce(
      (acc, r) => acc + safeNum(r, 0),
      0,
    );
    return `
      <div class="ar-skill-points-pill ${unspent > 0 ? 'has-points' : ''}">
        <span>✦ Điểm Chưa Dùng: <strong style="color:#ffd97d;font-size:14px;">${unspent}</strong></span>
        <span style="color:#8f846e;">|</span>
        <span style="font-family:var(--font-body);font-size:11.5px;color:#c7baa0;">Đã Phân Bổ: ${totalAllocated}</span>
      </div>
    `;
  }

  private renderSidebarHtml(ctx: MenusRefreshContext): string {
    const nodes = ctx.passiveNodes ?? [];
    const allocated = ctx.allocatedPassives ?? {};

    const branchTotals: Record<PassiveBranch, number> = {
      warlord: 0,
      assassin: 0,
      archmage: 0,
    };
    const activeKeystones: PassiveNode[] = [];
    const bonusTotals = new Map<keyof (DerivedStats & Attributes), number>();

    for (const n of nodes) {
      const rank = safeNum(allocated[n.id], 0);
      if (rank <= 0) continue;
      if (branchTotals[n.branch] !== undefined) {
        branchTotals[n.branch] += rank;
      }
      if (n.isKeystone) {
        activeKeystones.push(n);
      }
      for (const [k, v] of Object.entries(n.statModifiers ?? {})) {
        const statKey = k as keyof (DerivedStats & Attributes);
        bonusTotals.set(statKey, (bonusTotals.get(statKey) ?? 0) + safeNum(v as number, 0) * rank);
      }
    }

    const branchRows = (['warlord', 'assassin', 'archmage'] as PassiveBranch[])
      .map((b) => {
        const theme = BRANCH_THEME[b];
        const pts = branchTotals[b];
        const pct = Math.min(100, pts * 8);
        return `
          <div style="display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:${theme.core};font-weight:700;">${theme.label}</span>
              <strong style="color:#f4e6c3;">${pts} Cấp</strong>
            </div>
            <div class="ar-hero-attr-track">
              <div class="ar-hero-attr-fill" style="width:${pct}%;--attr-color:${theme.core};"></div>
            </div>
          </div>
        `;
      })
      .join('');

    const keystonesHtml =
      activeKeystones.length > 0
        ? activeKeystones
            .map(
              (ks) => `
              <div style="padding:8px 10px;border-radius:4px;background:rgba(200,155,60,0.12);border:1px solid rgba(240,196,99,0.48);">
                <div style="font-family:var(--font-display);font-size:12px;font-weight:700;color:#ffe094;">◆ ${escapeHtml(ks.name)}</div>
                <div style="font-size:11px;color:#d6c8ad;margin-top:2px;line-height:1.35;">${escapeHtml(ks.description)}</div>
              </div>
            `,
            )
            .join('')
        : `<div style="font-size:11.5px;color:#8e836e;">Chưa đánh thức Tinh Thạch Chính nào. Hãy vươn tới các ngôi sao ngoài cùng của mỗi nhánh để mở khóa sức mạnh đột phá.</div>`;

    const now = Date.now();
    const bonusHtml = Array.from(bonusTotals.entries())
      .filter(([, val]) => Math.abs(val) > 0.0001)
      .map(([k, val]) => {
        const sign = val >= 0 ? '+' : '';
        const flash = this.bonusFlashes.get(k);
        const activeFlash = flash && now < flash.until ? flash : null;
        if (flash && now >= flash.until) this.bonusFlashes.delete(k);
        const popCls = activeFlash
          ? activeFlash.dir === 'up'
            ? 'ar-stat-pop-up'
            : 'ar-stat-pop-down'
          : '';
        return `
          <div class="ar-stat-line ${popCls}">
            <span>${escapeHtml(getStatLabel(k))}</span>
            <span>
              <strong style="color:${val >= 0 ? '#8ce99a' : '#ff8787'};">${sign}${escapeHtml(formatStatValue(k, val))}</strong>
              ${
                activeFlash
                  ? `<span class="ar-stat-delta-chip ${activeFlash.dir === 'up' ? 'is-up' : 'is-down'}">${escapeHtml(activeFlash.deltaText)}</span>`
                  : ''
              }
            </span>
          </div>
        `;
      })
      .join('');

    return `
      <div class="ar-stats-section-title" style="margin-top:0;">Thông Thạo Nhánh</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${branchRows}
      </div>

      <div class="ar-stats-section-title">Tinh Thạch Đã Thức Tỉnh</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${keystonesHtml}
      </div>

      <div class="ar-stats-section-title">Tổng Chỉ Số Chòm Sao</div>
      <div class="ar-stats-grid">
        ${bonusHtml || `<div style="font-size:11.5px;color:#8e836e;">Phân bổ các ngôi sao trong chòm sao để cường hóa anh hùng của bạn.</div>`}
      </div>

      <div style="margin-top:auto;padding-top:10px;border-top:1px solid rgba(200,155,60,0.18);font-size:11px;color:#968b74;line-height:1.45;">
        <div>• <strong>Chuột Trái Vào Sao</strong>: Nâng Cấp</div>
        <div>• <strong>Kéo / Cuộn Chuột</strong>: Di Chuyển &amp; Thu Phóng Bản Đồ Sao</div>
      </div>
    `;
  }

  private bindControls(mountEl: HTMLElement): void {
    mountEl.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => {
      this.zoom = Math.min(2.4, this.zoom * 1.2);
      eventBus.emit('sfx:request', { id: 'ui_click' });
    });
    mountEl.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => {
      this.zoom = Math.max(0.55, this.zoom / 1.2);
      eventBus.emit('sfx:request', { id: 'ui_click' });
    });
    mountEl.querySelector('[data-action="zoom-reset"]')?.addEventListener('click', () => {
      this.panX = 0;
      this.panY = 0;
      this.zoom = 1;
      eventBus.emit('sfx:request', { id: 'ui_click' });
    });
    mountEl.querySelector('[data-action="respec-tree"]')?.addEventListener('click', () => {
      eventBus.emit('sfx:request', { id: 'ui_equip' });
      this.latestCallbacks?.onResetPassives();
    });
  }

  private bindCanvasInteractions(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      this.isDragging = true;
      this.dragMoved = false;
      this.dragStartX = ev.clientX - this.panX;
      this.dragStartY = ev.clientY - this.panY;
    });

    canvas.addEventListener('mousemove', (ev) => {
      if (this.isDragging) {
        const nx = ev.clientX - this.dragStartX;
        const ny = ev.clientY - this.dragStartY;
        if (Math.hypot(nx - this.panX, ny - this.panY) > 4) {
          this.dragMoved = true;
        }
        this.panX = nx;
        this.panY = ny;
      }

      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;

      let hit: ScreenNode | null = null;
      for (let i = this.screenNodes.length - 1; i >= 0; i--) {
        const sn = this.screenNodes[i];
        if (Math.hypot(mx - sn.sx, my - sn.sy) <= sn.radius + 6) {
          hit = sn;
          break;
        }
      }

      this.hoveredNodeId = hit ? hit.node.id : null;
      canvas.style.cursor = hit
        ? hit.allocatable
          ? 'pointer'
          : 'help'
        : this.isDragging
          ? 'grabbing'
          : 'grab';

      if (hit && this.tooltipEl && this.latestCtx) {
        const theme = BRANCH_THEME[hit.node.branch] ?? BRANCH_THEME.warlord;
        this.tooltipEl.style.setProperty('--tt-border', hit.node.isKeystone ? '#ffd97d' : theme.core);
        this.tooltipEl.style.setProperty('--tt-glow', theme.glow);
        this.tooltipEl.innerHTML = this.buildNodeTooltipHtml(hit.node, this.latestCtx);
        this.tooltipEl.classList.remove('is-hidden');
        this.positionTooltip(this.tooltipEl, ev.clientX, ev.clientY);
      } else {
        this.tooltipEl?.classList.add('is-hidden');
      }
    });

    const endDrag = () => {
      this.isDragging = false;
    };
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
      this.hoveredNodeId = null;
      this.tooltipEl?.classList.add('is-hidden');
    });

    canvas.addEventListener('click', (ev) => {
      if (this.dragMoved || !this.latestCtx) return;
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;

      for (let i = this.screenNodes.length - 1; i >= 0; i--) {
        const sn = this.screenNodes[i];
        if (Math.hypot(mx - sn.sx, my - sn.sy) <= sn.radius + 6) {
          if (sn.rank < sn.node.maxRank && safeNum(this.latestCtx.player?.unspentSkillPoints, 0) > 0) {
            eventBus.emit('sfx:request', { id: 'ui_equip' });
            this.latestCallbacks?.onAllocatePassive(sn.node.id);
          } else {
            eventBus.emit('sfx:request', { id: 'ui_click' });
            this.latestCallbacks?.onAllocatePassive(sn.node.id);
          }
          break;
        }
      }
    });

    canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoom = Math.max(0.55, Math.min(2.4, this.zoom * factor));
      },
      { passive: false },
    );
  }

  private buildNodeTooltipHtml(node: PassiveNode, ctx: MenusRefreshContext): string {
    const theme = BRANCH_THEME[node.branch] ?? BRANCH_THEME.warlord;
    const allocated = ctx.allocatedPassives ?? {};
    const rank = safeNum(allocated[node.id], 0);
    const unspent = safeNum(ctx.player?.unspentSkillPoints, 0);
    const prereqsMet = this.arePrerequisitesMet(node, allocated);

    const modsHtml = Object.entries(node.statModifiers ?? {})
      .map(([k, v]) => {
        const key = k as keyof (DerivedStats & Attributes);
        const perRank = safeNum(v as number, 0);
        const sign = perRank >= 0 ? '+' : '';
        const totalTxt =
          rank > 0 && node.maxRank > 1
            ? ` <span style="color:#ffd97d;">(Hiện tại: ${sign}${escapeHtml(formatStatValue(key, perRank * rank))})</span>`
            : '';
        return `<div class="ar-tt-affix"><span>${sign}${escapeHtml(formatStatValue(key, perRank))} ${escapeHtml(getStatLabel(key))} mỗi cấp${totalTxt}</span></div>`;
      })
      .join('');

    let statusLine = '';
    if (rank >= node.maxRank) {
      statusLine = `<span style="color:#ffd97d;font-weight:700;">✦ Đã Tinh Thông (${rank}/${node.maxRank})</span>`;
    } else if (!prereqsMet) {
      const missingNames = (node.prerequisites ?? [])
        .filter((pid) => safeNum(allocated[pid], 0) <= 0)
        .map((pid) => (ctx.passiveNodes ?? []).find((n) => n.id === pid)?.name ?? pid);
      statusLine = `<span style="color:#ff6b6b;">Yêu Cầu: ${escapeHtml(missingNames.join(', ') || 'Ngôi Sao Liên Kết')}</span>`;
    } else if (unspent <= 0) {
      statusLine = `<span style="color:#adb5bd;">Cần 1 Điểm Kỹ Năng Chưa Dùng</span>`;
    } else {
      statusLine = `<span style="color:#51cf66;font-weight:700;">Nhấn Để Nâng Cấp (${rank + 1}/${node.maxRank})</span>`;
    }

    return `
      <div class="ar-tt-header">
        <div class="ar-tt-name" style="color:${node.isKeystone ? '#ffd97d' : theme.core};">
          ${node.isKeystone ? '◆ ' : ''}${escapeHtml(node.name)}
        </div>
        <div class="ar-tt-sub">
          <span style="color:${theme.core};font-weight:700;">${theme.label} • ${node.isKeystone ? 'Tinh Thạch Chính' : 'Ngôi Sao Chòm Sao'}</span>
          <span style="color:#ffe39e;font-weight:700;">Cấp ${rank} / ${node.maxRank}</span>
        </div>
      </div>

      <div style="font-size:12px;color:#dfd3bc;line-height:1.45;">
        ${escapeHtml(node.description)}
      </div>

      ${modsHtml ? `<div class="ar-tt-affixes">${modsHtml}</div>` : ''}

      <div class="ar-tt-footer">
        ${statusLine}
      </div>
    `;
  }

  private arePrerequisitesMet(
    node: PassiveNode,
    allocated: Record<string, number>,
  ): boolean {
    const prereqs = node.prerequisites ?? [];
    if (prereqs.length === 0) return true;
    return prereqs.every((pid) => safeNum(allocated[pid], 0) > 0);
  }

  private startLoop(canvas: HTMLCanvasElement): void {
    const ctx2d = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx2d || typeof window === 'undefined') return;

    const syncSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, canvas.clientWidth || 800);
      const h = Math.max(1, canvas.clientHeight || 560);
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncSize();
    this.resizeHandler = syncSize;
    window.addEventListener('resize', syncSize);

    const startTime = performance.now();
    const renderFrame = (now: number) => {
      syncSize();
      const elapsed = (now - startTime) * 0.001;
      this.drawConstellation(ctx2d, canvas.clientWidth || 800, canvas.clientHeight || 560, elapsed);
      this.rafId = window.requestAnimationFrame(renderFrame);
    };
    this.rafId = window.requestAnimationFrame(renderFrame);
  }

  private drawConstellation(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    elapsed: number,
  ): void {
    g.clearRect(0, 0, w, h);

    // 1. Deep Astral Void & Sector Nebulae
    const bgGrad = g.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    bgGrad.addColorStop(0, '#161126');
    bgGrad.addColorStop(0.55, '#0b0814');
    bgGrad.addColorStop(1, '#050409');
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, w, h);

    // Twinkling stars
    for (const s of this.bgStars) {
      const twinkle = 0.28 + 0.42 * (0.5 + 0.5 * Math.sin(elapsed * s.speed + s.phase));
      g.fillStyle = `rgba(245, 232, 200, ${twinkle.toFixed(3)})`;
      g.beginPath();
      g.arc(s.nx * w, s.ny * h, s.r, 0, Math.PI * 2);
      g.fill();
    }

    const cx = w * 0.5 + this.panX;
    const cy = h * 0.5 + this.panY;

    // Astrolabe ornamental rings
    const baseRadius = Math.min(w, h) * 0.42 * this.zoom;
    g.save();
    for (const frac of [0.28, 0.56, 0.84, 1.05]) {
      g.strokeStyle = 'rgba(200, 155, 60, 0.09)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, baseRadius * frac, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();

    const ctx = this.latestCtx;
    const nodes = ctx?.passiveNodes ?? [];
    const allocated = ctx?.allocatedPassives ?? {};
    const unspent = safeNum(ctx?.player?.unspentSkillPoints, 0);

    if (nodes.length === 0) {
      g.fillStyle = '#bfb299';
      g.font = '14px Cinzel, Georgia, serif';
      g.textAlign = 'center';
      g.fillText('Đang Chờ Đồng Bộ Chòm Sao Tinh Tú...', w * 0.5, h * 0.5);
      this.screenNodes = [];
      return;
    }

    // Auto-normalize node positions around their natural origin/bounds
    let maxExtent = 0.001;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const px = safeNum(n.position?.x, 0);
      const py = safeNum(n.position?.y, 0);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      maxExtent = Math.max(maxExtent, Math.hypot(px, py));
    }

    // Determine whether coordinates are already centered near (0,0) or offset in positive quadrant
    const centerShiftX = minX >= 0 && maxX > 1.5 ? (minX + maxX) * 0.5 : 0;
    const centerShiftY = minY >= 0 && maxY > 1.5 ? (minY + maxY) * 0.5 : 0;
    if (centerShiftX !== 0 || centerShiftY !== 0) {
      maxExtent = 0.001;
      for (const n of nodes) {
        const dx = safeNum(n.position?.x, 0) - centerShiftX;
        const dy = safeNum(n.position?.y, 0) - centerShiftY;
        maxExtent = Math.max(maxExtent, Math.hypot(dx, dy));
      }
    }

    const worldScale = (Math.min(w, h) * 0.39 * this.zoom) / maxExtent;

    const nodeMap = new Map<string, ScreenNode>();
    const computed: ScreenNode[] = [];

    for (const n of nodes) {
      const nx = safeNum(n.position?.x, 0) - centerShiftX;
      const ny = safeNum(n.position?.y, 0) - centerShiftY;
      const sx = cx + nx * worldScale;
      const sy = cy + ny * worldScale;
      const rank = safeNum(allocated[n.id], 0);
      const prereqsMet = this.arePrerequisitesMet(n, allocated);
      const allocatable = rank < n.maxRank && unspent > 0 && prereqsMet;
      const radius = (n.isKeystone ? 22 : 14) * Math.max(0.8, Math.min(1.3, this.zoom));

      const sn: ScreenNode = { node: n, sx, sy, radius, rank, allocatable };
      nodeMap.set(n.id, sn);
      computed.push(sn);
    }
    this.screenNodes = computed;

    // 2. Draw Prerequisite Lines & Root Nexus Spokes
    for (const sn of computed) {
      const theme = BRANCH_THEME[sn.node.branch] ?? BRANCH_THEME.warlord;
      const prereqs = sn.node.prerequisites ?? [];

      if (prereqs.length === 0) {
        // Spoke from central Astral Nexus to starter node
        g.save();
        g.strokeStyle = sn.rank > 0 ? theme.core : 'rgba(200, 155, 60, 0.28)';
        g.lineWidth = sn.rank > 0 ? 2.4 : 1.2;
        if (sn.rank <= 0) g.setLineDash([4, 5]);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(sn.sx, sn.sy);
        g.stroke();
        g.restore();
      }

      for (const pid of prereqs) {
        const parent = nodeMap.get(pid);
        if (!parent) continue;

        const bothAllocated = parent.rank > 0 && sn.rank > 0;
        const canUnlockFromParent = parent.rank > 0 && sn.rank < sn.node.maxRank;
        const isHoveredLink =
          this.hoveredNodeId === sn.node.id || this.hoveredNodeId === parent.node.id;

        g.save();
        if (bothAllocated) {
          g.shadowColor = theme.core;
          g.shadowBlur = 12;
          g.strokeStyle = theme.core;
          g.lineWidth = isHoveredLink ? 3.8 : 3;
          g.beginPath();
          g.moveTo(parent.sx, parent.sy);
          g.lineTo(sn.sx, sn.sy);
          g.stroke();

          // Traveling starlight mote along active constellation beam
          const t = (elapsed * 0.55 + (sn.sx * 0.01)) % 1;
          const mx = parent.sx + (sn.sx - parent.sx) * t;
          const my = parent.sy + (sn.sy - parent.sy) * t;
          g.fillStyle = '#fff9db';
          g.beginPath();
          g.arc(mx, my, 2.5, 0, Math.PI * 2);
          g.fill();
        } else if (canUnlockFromParent) {
          const pulse = 0.5 + 0.35 * Math.sin(elapsed * 3.2);
          g.strokeStyle =
            unspent > 0
              ? `rgba(255, 217, 125, ${pulse.toFixed(2)})`
              : 'rgba(200, 155, 60, 0.38)';
          g.lineWidth = isHoveredLink ? 2.6 : 1.9;
          g.beginPath();
          g.moveTo(parent.sx, parent.sy);
          g.lineTo(sn.sx, sn.sy);
          g.stroke();
        } else {
          g.strokeStyle = isHoveredLink
            ? 'rgba(200, 155, 60, 0.45)'
            : 'rgba(155, 142, 118, 0.2)';
          g.lineWidth = 1.2;
          g.setLineDash([4, 5]);
          g.beginPath();
          g.moveTo(parent.sx, parent.sy);
          g.lineTo(sn.sx, sn.sy);
          g.stroke();
        }
        g.restore();
      }
    }

    // 3. Draw Central Shattered Astral Nexus
    g.save();
    const nexusGrad = g.createRadialGradient(cx, cy, 2, cx, cy, 22 * this.zoom);
    nexusGrad.addColorStop(0, '#fff3bf');
    nexusGrad.addColorStop(0.45, '#e0b04f');
    nexusGrad.addColorStop(1, 'rgba(200, 155, 60, 0)');
    g.fillStyle = nexusGrad;
    g.beginPath();
    g.arc(cx, cy, 22 * this.zoom, 0, Math.PI * 2);
    g.fill();

    g.strokeStyle = '#ffd97d';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(cx, cy, 11 * this.zoom, 0, Math.PI * 2);
    g.stroke();
    g.restore();

    // 4. Draw Constellation Nodes
    for (const sn of computed) {
      const theme = BRANCH_THEME[sn.node.branch] ?? BRANCH_THEME.warlord;
      const isHovered = this.hoveredNodeId === sn.node.id;
      const r = isHovered ? sn.radius * 1.14 : sn.radius;

      g.save();

      // Outer Keystone rotating ring or Allocatable halo
      if (sn.node.isKeystone) {
        g.save();
        g.translate(sn.sx, sn.sy);
        g.rotate(elapsed * 0.4);
        g.strokeStyle = sn.rank > 0 ? '#ffd97d' : 'rgba(200, 155, 60, 0.45)';
        g.lineWidth = 1.5;
        g.strokeRect(-r * 0.92, -r * 0.92, r * 1.84, r * 1.84);
        g.restore();
      }

      if (sn.allocatable) {
        const haloR = r + 5 + 2.5 * Math.sin(elapsed * 4);
        g.strokeStyle = 'rgba(255, 220, 120, 0.7)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(sn.sx, sn.sy, haloR, 0, Math.PI * 2);
        g.stroke();
      }

      // Main socket fill
      if (sn.rank > 0) {
        g.shadowColor = sn.node.isKeystone ? '#ffd97d' : theme.core;
        g.shadowBlur = isHovered ? 22 : 15;
        const fillG = g.createRadialGradient(sn.sx, sn.sy, 2, sn.sx, sn.sy, r);
        fillG.addColorStop(0, '#fff9db');
        fillG.addColorStop(0.5, theme.core);
        fillG.addColorStop(1, '#1a1326');
        g.fillStyle = fillG;
      } else {
        g.fillStyle = isHovered ? '#28203a' : '#141020';
      }

      g.beginPath();
      g.arc(sn.sx, sn.sy, r, 0, Math.PI * 2);
      g.fill();

      // Border rim
      g.shadowBlur = 0;
      g.lineWidth = sn.node.isKeystone ? 2.6 : 2;
      g.strokeStyle =
        sn.rank >= sn.node.maxRank
          ? '#ffd97d'
          : sn.rank > 0
            ? theme.core
            : sn.allocatable
              ? '#f0c463'
              : 'rgba(180, 162, 130, 0.42)';
      g.stroke();

      // Inner star diamond
      const ir = r * 0.36;
      g.fillStyle = sn.rank > 0 ? '#fff' : sn.allocatable ? '#ffe08a' : theme.core;
      g.globalAlpha = sn.rank > 0 || sn.allocatable ? 0.95 : 0.45;
      g.beginPath();
      g.moveTo(sn.sx, sn.sy - ir);
      g.lineTo(sn.sx + ir, sn.sy);
      g.lineTo(sn.sx, sn.sy + ir);
      g.lineTo(sn.sx - ir, sn.sy);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;

      // Rank pill below node
      const rankText = `${sn.rank}/${sn.node.maxRank}`;
      g.font = 'bold 10px Inter, Segoe UI, sans-serif';
      g.textAlign = 'center';
      const labelY = sn.sy + r + 12;
      g.fillStyle = 'rgba(8, 6, 14, 0.85)';
      g.fillRect(sn.sx - 15, labelY - 9, 30, 12);
      g.fillStyle = sn.rank > 0 ? '#ffd97d' : '#b7ab93';
      g.fillText(rankText, sn.sx, labelY);

      // Show Keystone titles or hovered node name directly on star-map
      if (sn.node.isKeystone || isHovered) {
        g.font = '600 11px Cinzel, Georgia, serif';
        g.fillStyle = sn.node.isKeystone ? '#ffe39e' : '#f4e6c3';
        g.fillText(sn.node.name, sn.sx, sn.sy - r - 8);
      }

      g.restore();
    }

    // 5. Draw Active Astral Allocation Shockwaves & Starburst Sparks
    const nowMs = Date.now();
    if (this.astralBursts.length > 0) {
      this.astralBursts = this.astralBursts.filter((b) => nowMs - b.bornMs < b.durationMs);
      for (const burst of this.astralBursts) {
        const progress = Math.max(0, Math.min(1, (nowMs - burst.bornMs) / burst.durationMs));
        const ease = 1 - Math.pow(1 - progress, 3);
        const alpha = 1 - progress;
        const target =
          burst.nodeId === '__nexus__' ? { sx: cx, sy: cy } : nodeMap.get(burst.nodeId);
        if (!target) continue;

        const maxR = (burst.isKeystone ? 68 : 48) * this.zoom;
        g.save();
        g.strokeStyle = burst.color;
        g.globalAlpha = alpha * 0.9;
        g.lineWidth = (burst.isKeystone ? 3.2 : 2.4) * (1 - progress * 0.5);
        g.beginPath();
        g.arc(target.sx, target.sy, 10 + maxR * ease, 0, Math.PI * 2);
        g.stroke();

        // Secondary inner shockwave
        g.globalAlpha = alpha * 0.55;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(target.sx, target.sy, 6 + maxR * 0.68 * ease, 0, Math.PI * 2);
        g.stroke();

        // 10 radial starburst sparks
        const sparkCount = burst.isKeystone ? 12 : 8;
        g.fillStyle = '#fff9db';
        g.globalAlpha = alpha;
        for (let i = 0; i < sparkCount; i++) {
          const ang = (i / sparkCount) * Math.PI * 2 + progress * 0.35;
          const dist = 10 + maxR * 1.08 * ease;
          const px = target.sx + Math.cos(ang) * dist;
          const py = target.sy + Math.sin(ang) * dist;
          g.beginPath();
          g.arc(px, py, 2.2 * (1 - progress * 0.6), 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      }
    }
  }

  private positionTooltip(tooltipEl: HTMLElement, clientX: number, clientY: number): void {
    const pad = 16;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    const rect = tooltipEl.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || 200;

    let x = clientX + 18;
    let y = clientY + 14;
    if (x + w + pad > vw) x = Math.max(pad, clientX - w - 18);
    if (y + h + pad > vh) y = Math.max(pad, vh - h - pad);
    tooltipEl.style.left = `${Math.round(x)}px`;
    tooltipEl.style.top = `${Math.round(y)}px`;
  }

  stopLoop(): void {
    if (this.rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.resizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    this.activeMountEl = null;
    this.canvasEl = null;
    this.tooltipEl = null;
  }

  dispose(): void {
    this.stopLoop();
  }
}
