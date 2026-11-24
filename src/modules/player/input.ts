import type { SkillSlotIndex, Vec2 } from '../../contracts/types';

const ACTION_BUFFER_TTL_SEC = 0.14;

function normalizeKeyCode(e: KeyboardEvent): string {
  if (e.code) return e.code;
  const k = (e.key || '').toLowerCase();
  switch (k) {
    case 'w':
      return 'KeyW';
    case 'a':
      return 'KeyA';
    case 's':
      return 'KeyS';
    case 'd':
      return 'KeyD';
    case 'arrowup':
      return 'ArrowUp';
    case 'arrowdown':
      return 'ArrowDown';
    case 'arrowleft':
      return 'ArrowLeft';
    case 'arrowright':
      return 'ArrowRight';
    case ' ':
      return 'Space';
    case 'shift':
      return 'ShiftLeft';
    case '1':
      return 'Digit1';
    case '2':
      return 'Digit2';
    case '3':
      return 'Digit3';
    case '4':
      return 'Digit4';
    case 'f':
      return 'KeyF';
    case 'e':
      return 'KeyE';
    case 'q':
      return 'KeyQ';
    case 'v':
      return 'KeyV';
    case 'r':
      return 'KeyR';
    case '[':
      return 'BracketLeft';
    case ']':
      return 'BracketRight';
    default:
      return '';
  }
}

function keyCodeToSkillSlot(code: string): SkillSlotIndex | null {
  switch (code) {
    case 'Digit1':
    case 'Numpad1':
      return 2;
    case 'Digit2':
    case 'Numpad2':
      return 3;
    case 'Digit3':
    case 'Numpad3':
      return 4;
    case 'Digit4':
    case 'Numpad4':
      return 5;
    default:
      return null;
  }
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function isUiOverlayControl(target: EventTarget | null): boolean {
  if (!target || typeof Element === 'undefined') return false;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      '#ui-hud-layer button, #ui-menus-layer button, [data-skill-slot], [data-panel-toggle], [data-ui-interactive]',
    ),
  );
}

/**
 * Manages responsive keyboard & mouse input for ARPG movement, dodge, skills, interact, and potions.
 */
export class PlayerInputManager {
  private heldKeys = new Set<string>();
  private virtualMove: Vec2 = { x: 0, y: 0 };
  private leftMouseDown = false;
  private rightMouseDown = false;
  private rightDownPos: Vec2 = { x: 0, y: 0 };
  private rightDraggingCamera = false;

  private dodgeBufferSec = 0;
  private interactBufferSec = 0;
  private potionBufferSec = 0;
  private parryBufferSec = 0;
  private awakeningBufferSec = 0;
  private bufferedCastSlot: SkillSlotIndex | null = null;
  private bufferedCastTtlSec = 0;

  private cleanupFns: Array<() => void> = [];

  attach(domElement: HTMLElement): void {
    this.detach();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (isEditableElement(e.target)) return;
      // Ignore browser/system shortcuts like Ctrl+R, Alt+Tab, Meta+...
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const code = normalizeKeyCode(e);
      if (!code) return;

      if (code === 'Space') {
        // Prevent page scrolling when pressing Space
        e.preventDefault();
      }

      const wasHeld = this.heldKeys.has(code);
      this.heldKeys.add(code);

      if (!e.repeat && !wasHeld) {
        if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight') {
          this.dodgeBufferSec = ACTION_BUFFER_TTL_SEC;
        } else if (code === 'KeyF' || code === 'KeyE') {
          this.interactBufferSec = ACTION_BUFFER_TTL_SEC;
        } else if (code === 'KeyQ') {
          this.potionBufferSec = ACTION_BUFFER_TTL_SEC;
        } else if (code === 'KeyV') {
          this.parryBufferSec = ACTION_BUFFER_TTL_SEC;
        } else if (code === 'KeyR') {
          this.awakeningBufferSec = ACTION_BUFFER_TTL_SEC;
        } else {
          const slot = keyCodeToSkillSlot(code);
          if (slot !== null) {
            this.bufferedCastSlot = slot;
            this.bufferedCastTtlSec = ACTION_BUFFER_TTL_SEC;
          }
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      const code = normalizeKeyCode(e);
      if (code) {
        this.heldKeys.delete(code);
      }
    };

    const onMouseDown = (e: MouseEvent): void => {
      if (isUiOverlayControl(e.target)) return;

      if (e.button === 0) {
        this.leftMouseDown = true;
        this.bufferedCastSlot = 0;
        this.bufferedCastTtlSec = ACTION_BUFFER_TTL_SEC;
      } else if (e.button === 1) {
        // Middle mouse button triggers Perfect Parry
        e.preventDefault();
        this.parryBufferSec = ACTION_BUFFER_TTL_SEC;
      } else if (e.button === 2) {
        this.rightMouseDown = true;
        this.rightDraggingCamera = false;
        this.rightDownPos = { x: e.clientX, y: e.clientY };
        this.bufferedCastSlot = 1;
        this.bufferedCastTtlSec = ACTION_BUFFER_TTL_SEC;
      }
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (this.rightMouseDown && !this.rightDraggingCamera) {
        const dx = e.clientX - this.rightDownPos.x;
        const dy = e.clientY - this.rightDownPos.y;
        if (Math.hypot(dx, dy) > 8) {
          this.rightDraggingCamera = true;
        }
      }
    };

    const onMouseUp = (e: MouseEvent): void => {
      if (e.button === 0) {
        this.leftMouseDown = false;
      } else if (e.button === 2) {
        this.rightMouseDown = false;
        this.rightDraggingCamera = false;
      }
    };

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    const onBlur = (): void => {
      this.clearState();
    };

    const onVisibilityChange = (): void => {
      if (typeof document !== 'undefined' && document.hidden) {
        this.clearState();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('blur', onBlur);
      this.cleanupFns.push(() => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('blur', onBlur);
      });
    } else {
      // Fallback if window is absent in a minimal mock DOM environment
      domElement.addEventListener('keydown', onKeyDown as EventListener);
      domElement.addEventListener('keyup', onKeyUp as EventListener);
      this.cleanupFns.push(() => {
        domElement.removeEventListener('keydown', onKeyDown as EventListener);
        domElement.removeEventListener('keyup', onKeyUp as EventListener);
      });
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
      this.cleanupFns.push(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      });
    }

    domElement.addEventListener('mousedown', onMouseDown);
    domElement.addEventListener('mouseup', onMouseUp);
    domElement.addEventListener('contextmenu', onContextMenu);
    this.cleanupFns.push(() => {
      domElement.removeEventListener('mousedown', onMouseDown);
      domElement.removeEventListener('mouseup', onMouseUp);
      domElement.removeEventListener('contextmenu', onContextMenu);
    });
  }

  setVirtualMove(x: number, y: number): void {
    this.virtualMove.x = Number.isFinite(x) ? x : 0;
    this.virtualMove.y = Number.isFinite(y) ? y : 0;
  }

  triggerTouchDodge(): void {
    this.dodgeBufferSec = ACTION_BUFFER_TTL_SEC;
  }

  triggerTouchInteract(): void {
    this.interactBufferSec = ACTION_BUFFER_TTL_SEC;
  }

  triggerTouchPotion(): void {
    this.potionBufferSec = ACTION_BUFFER_TTL_SEC;
  }

  triggerTouchParry(): void {
    this.parryBufferSec = ACTION_BUFFER_TTL_SEC;
  }

  triggerTouchAwakening(): void {
    this.awakeningBufferSec = ACTION_BUFFER_TTL_SEC;
  }

  triggerTouchCast(slot: SkillSlotIndex): void {
    this.bufferedCastSlot = slot;
    this.bufferedCastTtlSec = ACTION_BUFFER_TTL_SEC;
  }

  /**
   * Returns normalized screen-space movement axes:
   * `x` in [-1, 1] (A = -1, D = +1), `y` in [-1, 1] (S = -1, W = +1).
   */
  getMoveInput(): Vec2 {
    let x = this.virtualMove.x;
    let y = this.virtualMove.y;

    if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) y += 1;
    if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) y -= 1;
    if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) x += 1;
    if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) x -= 1;

    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    return { x, y };
  }

  /**
   * Returns orbital yaw rotation input (-1 for `[`, +1 for `]`) to keep fallback camera yaw aligned.
   */
  getOrbitalYawInput(): number {
    let dir = 0;
    if (this.heldKeys.has('BracketLeft')) dir -= 1;
    if (this.heldKeys.has('BracketRight')) dir += 1;
    return dir;
  }

  tickBuffers(dt: number): void {
    if (this.dodgeBufferSec > 0) {
      this.dodgeBufferSec = Math.max(0, this.dodgeBufferSec - dt);
    }
    if (this.interactBufferSec > 0) {
      this.interactBufferSec = Math.max(0, this.interactBufferSec - dt);
    }
    if (this.potionBufferSec > 0) {
      this.potionBufferSec = Math.max(0, this.potionBufferSec - dt);
    }
    if (this.parryBufferSec > 0) {
      this.parryBufferSec = Math.max(0, this.parryBufferSec - dt);
    }
    if (this.awakeningBufferSec > 0) {
      this.awakeningBufferSec = Math.max(0, this.awakeningBufferSec - dt);
    }
    if (this.bufferedCastTtlSec > 0) {
      this.bufferedCastTtlSec = Math.max(0, this.bufferedCastTtlSec - dt);
      if (this.bufferedCastTtlSec <= 0) {
        this.bufferedCastSlot = null;
      }
    }
  }

  consumeDodgeRequest(): boolean {
    if (this.dodgeBufferSec > 0) {
      this.dodgeBufferSec = 0;
      return true;
    }
    return false;
  }

  consumeInteractRequest(): boolean {
    if (this.interactBufferSec > 0) {
      this.interactBufferSec = 0;
      return true;
    }
    return false;
  }

  consumePotionRequest(): boolean {
    if (this.potionBufferSec > 0) {
      this.potionBufferSec = 0;
      return true;
    }
    return false;
  }

  consumeParryRequest(): boolean {
    if (this.parryBufferSec > 0) {
      this.parryBufferSec = 0;
      return true;
    }
    return false;
  }

  consumeAwakeningRequest(): boolean {
    if (this.awakeningBufferSec > 0) {
      this.awakeningBufferSec = 0;
      return true;
    }
    return false;
  }

  consumeCastSlotRequest(): SkillSlotIndex | null {
    if (this.bufferedCastSlot !== null && this.bufferedCastTtlSec > 0) {
      const slot = this.bufferedCastSlot;
      this.bufferedCastSlot = null;
      this.bufferedCastTtlSec = 0;
      return slot;
    }

    // Continuous hold-to-cast priority: Skill 1..4 > RMB (1) > LMB (0)
    if (this.heldKeys.has('Digit1') || this.heldKeys.has('Numpad1')) return 2;
    if (this.heldKeys.has('Digit2') || this.heldKeys.has('Numpad2')) return 3;
    if (this.heldKeys.has('Digit3') || this.heldKeys.has('Numpad3')) return 4;
    if (this.heldKeys.has('Digit4') || this.heldKeys.has('Numpad4')) return 5;
    if (this.rightMouseDown && !this.rightDraggingCamera) return 1;
    if (this.leftMouseDown) return 0;

    return null;
  }

  clearTransientBuffers(): void {
    this.dodgeBufferSec = 0;
    this.interactBufferSec = 0;
    this.potionBufferSec = 0;
    this.parryBufferSec = 0;
    this.awakeningBufferSec = 0;
    this.bufferedCastSlot = null;
    this.bufferedCastTtlSec = 0;
  }

  clearState(): void {
    this.heldKeys.clear();
    this.leftMouseDown = false;
    this.rightMouseDown = false;
    this.rightDraggingCamera = false;
    this.clearTransientBuffers();
  }

  detach(): void {
    for (const fn of this.cleanupFns) {
      fn();
    }
    this.cleanupFns = [];
    this.clearState();
  }
}
