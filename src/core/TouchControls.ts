// TouchControls.ts — Non-blocking Mobile ARPG Virtual Joystick & Ergonomic Arc Action Buttons

export interface TouchControlsState {
  moveX: number; // -1 to 1
  moveY: number; // -1 to 1
  isAttacking: boolean;
  isDodging: boolean;
  isInteracting: boolean;
  isUsingPotion: boolean;
  skillPressed: number | null;
  isUltimate: boolean;
  cameraRotX: number;
  cameraRotY: number;
  zoomDelta: number;
}

export interface TouchControlsCallbacks {
  onAttack?: () => void;
  onDodge?: () => void;
  onSkill?: (index: number) => void;
  onUltimate?: () => void;
  onPotion?: () => void;
  onInteract?: () => void;
  onMenu?: () => void;
  onMap?: () => void;
  onChat?: () => void;
  onEmoteWheel?: () => void;
}

const JOYSTICK_RADIUS = 52;
const DEADZONE = 0.1;

export class TouchControls {
  private container: HTMLElement;
  private rootWrap: HTMLDivElement;
  private joyZone: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: TouchControlsCallbacks;
  private state: TouchControlsState;
  private visible = false;

  // Joystick tracking
  private joystickActive = false;
  private joystickTouchId = -1;
  private joystickOriginX = 85;
  private joystickOriginY = 85;
  private joystickCurrentX = 85;
  private joystickCurrentY = 85;

  private readonly onResizeBound: () => void;

  constructor(container: HTMLElement, callbacks: TouchControlsCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.state = this.defaultState();

    // Ensure container itself never blocks clicks outside the joystick & buttons
    this.container.style.pointerEvents = 'none';

    this.rootWrap = document.createElement('div');
    this.rootWrap.className = 'ar-touch-controls-root';
    this.rootWrap.style.cssText =
      'position:absolute;inset:0;pointer-events:none;display:none;user-select:none;';

    // 1. Bottom-Left Virtual Joystick Zone (only 176x176px captures touch)
    this.joyZone = document.createElement('div');
    this.joyZone.style.cssText =
      'position:absolute;left:10px;bottom:8px;width:170px;height:170px;pointer-events:auto;touch-action:none;';

    this.canvas = document.createElement('canvas');
    this.canvas.width = 170;
    this.canvas.height = 170;
    this.canvas.style.cssText = 'width:170px;height:170px;display:block;touch-action:none;';
    this.joyZone.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    this.rootWrap.appendChild(this.joyZone);

    // 2. Bottom-Right Ergonomic ARPG Action Arc (non-overlapping buttons)
    this.buildActionButtons(this.rootWrap);

    this.container.appendChild(this.rootWrap);

    this.onResizeBound = () => this.drawJoystick();
    this.bindJoystickEvents();
    this.drawJoystick();
  }

  private defaultState(): TouchControlsState {
    return {
      moveX: 0,
      moveY: 0,
      isAttacking: false,
      isDodging: false,
      isInteracting: false,
      isUsingPotion: false,
      skillPressed: null,
      isUltimate: false,
      cameraRotX: 0,
      cameraRotY: 0,
      zoomDelta: 0,
    };
  }

  private buildActionButtons(parent: HTMLElement): void {
    const pad = document.createElement('div');
    pad.style.cssText =
      'position:absolute;right:12px;bottom:10px;width:220px;height:190px;pointer-events:none;';

    // Clean Mobile ARPG Arc coordinates (right, bottom in px, size in px)
    const specs: Array<{
      id: string;
      right: number;
      bottom: number;
      size: number;
      label: string;
      sub?: string;
      bg: string;
      border: string;
      action: () => void;
    }> = [
      // Primary Attack (bottom-right corner, largest button)
      {
        id: 'attack',
        right: 6,
        bottom: 6,
        size: 68,
        label: '⚔',
        sub: 'Đánh',
        bg: 'radial-gradient(circle, rgba(210,45,45,0.92) 0%, rgba(120,18,22,0.95) 100%)',
        border: '#ff8787',
        action: () => {
          this.state.isAttacking = true;
          this.callbacks.onAttack?.();
        },
      },
      // Skill 1 (left of Attack)
      {
        id: 'skill1',
        right: 84,
        bottom: 8,
        size: 48,
        label: '1',
        bg: 'rgba(35,75,165,0.88)',
        border: '#74c0fc',
        action: () => {
          this.state.skillPressed = 0;
          this.callbacks.onSkill?.(0);
        },
      },
      // Skill 2 (diagonal up-left of Attack)
      {
        id: 'skill2',
        right: 66,
        bottom: 66,
        size: 48,
        label: '2',
        bg: 'rgba(30,115,155,0.88)',
        border: '#66d9e8',
        action: () => {
          this.state.skillPressed = 1;
          this.callbacks.onSkill?.(1);
        },
      },
      // Skill 3 (above Attack)
      {
        id: 'skill3',
        right: 8,
        bottom: 84,
        size: 48,
        label: '3',
        bg: 'rgba(35,140,105,0.88)',
        border: '#63e6be',
        action: () => {
          this.state.skillPressed = 2;
          this.callbacks.onSkill?.(2);
        },
      },
      // Ultimate / Awakening (outer top-left of arc)
      {
        id: 'ultimate',
        right: 118,
        bottom: 108,
        size: 46,
        label: '★',
        sub: 'Nộ',
        bg: 'radial-gradient(circle, rgba(215,145,15,0.92) 0%, rgba(130,75,10,0.95) 100%)',
        border: '#ffe066',
        action: () => {
          this.state.isUltimate = true;
          this.callbacks.onUltimate?.();
        },
      },
      // Dodge Roll (outer bottom-left of arc)
      {
        id: 'dodge',
        right: 140,
        bottom: 10,
        size: 46,
        label: '💨',
        sub: 'Né',
        bg: 'rgba(115,55,175,0.88)',
        border: '#d0bfff',
        action: () => {
          this.state.isDodging = true;
          this.callbacks.onDodge?.();
        },
      },
      // Health Potion
      {
        id: 'potion',
        right: 140,
        bottom: 62,
        size: 42,
        label: '💊',
        bg: 'rgba(40,145,65,0.88)',
        border: '#8ce99a',
        action: () => {
          this.state.isUsingPotion = true;
          this.callbacks.onPotion?.();
        },
      },
      // Interact / Pick Up [F]
      {
        id: 'interact',
        right: 62,
        bottom: 122,
        size: 44,
        label: '🖐',
        sub: 'Nhặt',
        bg: 'rgba(165,120,35,0.9)',
        border: '#ffd43b',
        action: () => {
          this.state.isInteracting = true;
          this.callbacks.onInteract?.();
        },
      },
    ];

    for (const s of specs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.touchBtn = s.id;
      btn.style.cssText = `
        position:absolute;
        right:${s.right}px;
        bottom:${s.bottom}px;
        width:${s.size}px;
        height:${s.size}px;
        border-radius:50%;
        background:${s.bg};
        border:2px solid ${s.border};
        color:#fff;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        font-family:var(--font-body, sans-serif);
        font-weight:800;
        font-size:${Math.round(s.size * 0.36)}px;
        line-height:1;
        box-shadow:0 4px 12px rgba(0,0,0,0.75);
        pointer-events:auto;
        touch-action:none;
        cursor:pointer;
        user-select:none;
        padding:0;
      `;

      const mainSpan = document.createElement('span');
      mainSpan.textContent = s.label;
      btn.appendChild(mainSpan);

      if (s.sub) {
        const subSpan = document.createElement('span');
        subSpan.textContent = s.sub;
        subSpan.style.cssText = 'font-size:9px;font-weight:700;opacity:0.9;margin-top:1px;';
        btn.appendChild(subSpan);
      }

      const trigger = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        btn.style.transform = 'scale(0.9)';
        s.action();
        setTimeout(() => {
          btn.style.transform = 'scale(1)';
          this.state.isAttacking = false;
          this.state.isDodging = false;
          this.state.isUsingPotion = false;
          this.state.isInteracting = false;
          this.state.skillPressed = null;
          this.state.isUltimate = false;
        }, 110);
      };

      btn.addEventListener('touchstart', trigger, { passive: false });
      btn.addEventListener('mousedown', trigger);
      pad.appendChild(btn);
    }

    parent.appendChild(pad);
  }

  private bindJoystickEvents(): void {
    const c = this.canvas;

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = c.getBoundingClientRect();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (!this.joystickActive) {
          this.joystickActive = true;
          this.joystickTouchId = t.identifier;
          this.joystickOriginX = 85;
          this.joystickOriginY = 85;
          this.updateJoystickKnob(t.clientX - rect.left, t.clientY - rect.top);
        }
      }
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = c.getBoundingClientRect();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.joystickTouchId) {
          this.updateJoystickKnob(t.clientX - rect.left, t.clientY - rect.top);
        }
      }
    };

    const onEnd = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this.joystickTouchId) {
          this.resetJoystick();
        }
      }
    };

    c.addEventListener('touchstart', onStart, { passive: false });
    c.addEventListener('touchmove', onMove, { passive: false });
    c.addEventListener('touchend', onEnd, { passive: false });
    c.addEventListener('touchcancel', onEnd, { passive: false });
    window.addEventListener('resize', this.onResizeBound);
  }

  private updateJoystickKnob(localX: number, localY: number): void {
    const dx = localX - this.joystickOriginX;
    const dy = localY - this.joystickOriginY;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, JOYSTICK_RADIUS);
    const angle = Math.atan2(dy, dx);
    const nx = (clamped * Math.cos(angle)) / JOYSTICK_RADIUS;
    const ny = (clamped * Math.sin(angle)) / JOYSTICK_RADIUS;

    this.state.moveX = Math.abs(nx) > DEADZONE ? nx : 0;
    this.state.moveY = Math.abs(ny) > DEADZONE ? ny : 0;

    this.joystickCurrentX = this.joystickOriginX + Math.cos(angle) * clamped;
    this.joystickCurrentY = this.joystickOriginY + Math.sin(angle) * clamped;
    this.drawJoystick();
  }

  private resetJoystick(): void {
    this.joystickActive = false;
    this.joystickTouchId = -1;
    this.state.moveX = 0;
    this.state.moveY = 0;
    this.joystickCurrentX = this.joystickOriginX;
    this.joystickCurrentY = this.joystickOriginY;
    this.drawJoystick();
  }

  private drawJoystick(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 170, 170);

    const cx = this.joystickOriginX;
    const cy = this.joystickOriginY;

    // Outer base ring
    ctx.beginPath();
    ctx.arc(cx, cy, JOYSTICK_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14, 12, 22, 0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 155, 60, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Thumb knob
    const kx = this.joystickActive ? this.joystickCurrentX : cx;
    const ky = this.joystickActive ? this.joystickCurrentY : cy;
    ctx.beginPath();
    ctx.arc(kx, ky, JOYSTICK_RADIUS * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = this.joystickActive ? 'rgba(240, 196, 99, 0.85)' : 'rgba(200, 155, 60, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 244, 210, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  public setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.rootWrap.style.display = visible ? 'block' : 'none';
    if (!visible && this.joystickActive) {
      this.resetJoystick();
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public getState(): Readonly<TouchControlsState> {
    return this.state;
  }

  public destroy(): void {
    window.removeEventListener('resize', this.onResizeBound);
    this.rootWrap.remove();
  }
}

export function createTouchControls(
  containerId: string,
  callbacks: TouchControlsCallbacks = {},
): TouchControls | null {
  if (typeof document === 'undefined') return null;
  const container = document.getElementById(containerId);
  if (!container) return null;
  return new TouchControls(container, callbacks);
}
