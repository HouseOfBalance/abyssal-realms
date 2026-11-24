import * as THREE from 'three';
import type { ICameraRig, ItemRarity, Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { CameraShakeController } from './CameraNoise';
import { WallOcclusionFader } from './WallOcclusionFader';

const DEFAULT_FOV = 45;
const MIN_DYNAMIC_FOV = 29;
const MAX_DYNAMIC_FOV = 63;
const MAX_FOV_OFFSET_DEG = 18;
const FOV_SPRING_OMEGA = 11.0;
const CRIT_FOV_COOLDOWN_SEC = 0.085;
const DEFAULT_NEAR = 0.25;
const DEFAULT_FAR = 220;

// Classic 45-degree dark-fantasy isometric yaw (+X, +Z octant looking toward -X, -Z)
const DEFAULT_YAW_RAD = Math.PI / 4;
const DEFAULT_ZOOM_T = 0.55;

// Coupled zoom bounds: close action view (zoom=0) -> overhead tactical view (zoom=1)
const MIN_DISTANCE = 8.5;
const MAX_DISTANCE = 26.0;
const MIN_PITCH_RAD = THREE.MathUtils.degToRad(34);
const MAX_PITCH_RAD = THREE.MathUtils.degToRad(68);
const LOOK_AT_HEIGHT_CLOSE = 1.35;
const LOOK_AT_HEIGHT_FAR = 0.65;

// Critically-damped spring & smoothing constants
const SPRING_OMEGA = 11.5;
const ZOOM_DAMP_SPEED = 14.0;
const YAW_DAMP_SPEED = 16.0;

// Input tuning (scaled by sensitivity)
const WHEEL_ZOOM_STEP = 0.085;
const DRAG_ORBIT_RAD_PER_PX = 0.0065;
const DRAG_DEADZONE_PX = 3.0;
const KEY_ORBIT_RAD_PER_SEC = 1.85;
const KEY_TAP_NUDGE_RAD = 0.05;

const DEFAULT_BOSS_PAN_DURATION_SEC = 3.2;
const EXECUTION_ZOOM_DURATION_SEC = 0.45;
const PARRY_SNAP_DECAY = 16.0;
const MIN_EXECUTION_PITCH_RAD = THREE.MathUtils.degToRad(24);
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 720;

interface BossPanState {
  startPos: THREE.Vector3;
  bossPos: THREE.Vector3;
  elapsedSec: number;
  durationSec: number;
}

interface ExecutionZoomState {
  targetPos: THREE.Vector3;
  elapsedSec: number;
  durationSec: number;
}

function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as HTMLElement;
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

export class CameraRig implements ICameraRig {
  public readonly camera: THREE.PerspectiveCamera;

  private readonly heroTargetPos = new THREE.Vector3(0, 0, 0);
  private readonly currentFocus = new THREE.Vector3(0, 0, 0);
  private readonly focusVelocity = new THREE.Vector3(0, 0, 0);

  private zoom = DEFAULT_ZOOM_T;
  private targetZoom = DEFAULT_ZOOM_T;
  private yaw = DEFAULT_YAW_RAD;
  private targetYaw = DEFAULT_YAW_RAD;
  private sensitivity = 1.0;

  // Dynamic spring-damped FOV punch state (frame-rate invariant at 60/120/144Hz)
  private fovOffset = 0;
  private fovVelocity = 0;
  private critFovCooldownSec = 0;
  private parrySnapWeight = 0;

  private bossPan: BossPanState | null = null;
  private executionZoom: ExecutionZoomState | null = null;

  private readonly shakeController = new CameraShakeController();
  private readonly occlusionFader = new WallOcclusionFader();
  private readonly eventUnsubs: Array<() => void> = [];

  // Controls & input state
  private domElement: HTMLElement | null = null;
  private detachControlsFn: (() => void) | null = null;
  private isPointerOrbitDown = false;
  private isOrbitDragEngaged = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastPointerX = 0;
  private orbitKeyLeft = false;
  private orbitKeyRight = false;

  // Reusable math scratchpad to avoid per-frame GC allocations
  private readonly lookAtPoint = new THREE.Vector3();
  private readonly renderFocus = new THREE.Vector3();
  private readonly execFocusOffset = new THREE.Vector3();
  private readonly baseCamPos = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camBack = new THREE.Vector3();
  private readonly ndcPointer = new THREE.Vector2();
  private readonly groundRaycaster = new THREE.Raycaster();
  private readonly projScratch = new THREE.Vector3();
  private readonly viewScratch = new THREE.Vector3();

  constructor() {
    const initialAspect = this.computeInitialAspect();
    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_FOV,
      initialAspect,
      DEFAULT_NEAR,
      DEFAULT_FAR,
    );

    this.eventUnsubs.push(
      eventBus.on('camera:shake', ({ trauma }) => {
        this.addShake(trauma);
      }),
      eventBus.on('player:dodge', () => {
        this.addFovPunch(3.8);
      }),
      eventBus.on('combat:damageDealt', ({ result, targetIsPlayer }) => {
        if (result.isCrit && !targetIsPlayer && this.critFovCooldownSec <= 0) {
          this.critFovCooldownSec = CRIT_FOV_COOLDOWN_SEC;
          this.addFovPunch(-1.8);
        }
      }),
      eventBus.on('combat:executionStrike', ({ position }) => {
        this.playExecutionZoom(position);
      }),
      eventBus.on('combat:parryTriggered', ({ counterSuccess }) => {
        this.triggerParrySnap(counterSuccess);
      }),
      eventBus.on('player:awakeningChanged', ({ active }) => {
        if (active) {
          this.addFovPunch(4.5);
          this.addShake(0.3);
        }
      }),
      eventBus.on('event:butcherInvasion', () => {
        this.addFovPunch(-2.5);
        this.addShake(0.5);
      }),
      eventBus.on('hero:gearChanged', ({ rarity }) => {
        this.addFovPunch(this.computeFlourishFovKick(rarity));
      }),
      eventBus.on('hero:classChanged', () => {
        this.addFovPunch(-2.4);
      }),
      eventBus.on('dungeon:portalWarp', () => {
        this.addFovPunch(8.5);
      }),
    );

    this.renderFocus.copy(this.currentFocus);
    this.applyCameraPose(0, 0, 1, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  attachControls(domElement: HTMLElement): void {
    this.detachControls();
    if (!domElement || typeof domElement.addEventListener !== 'function') return;

    this.domElement = domElement;
    this.syncCameraAspect();

    const handledEvents = new WeakSet<Event>();
    const markOnce = (e: Event): boolean => {
      if (handledEvents.has(e)) return false;
      handledEvents.add(e);
      return true;
    };

    const onContextMenu = (e: MouseEvent): void => {
      if (typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
    };

    const onMouseDown = (e: MouseEvent): void => {
      // Right mouse button (2) or middle mouse button (1) orbits yaw
      if (e.button === 2 || e.button === 1) {
        this.isPointerOrbitDown = true;
        // Middle click engages immediately; right click uses a small deadzone so
        // quick stationary right-clicks for Skill Slot 1 do not jitter camera yaw.
        this.isOrbitDragEngaged = e.button === 1;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.lastPointerX = e.clientX;
      }
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!markOnce(e)) return;
      if (!this.isPointerOrbitDown) return;

      if (!this.isOrbitDragEngaged) {
        const totalDx = e.clientX - this.dragStartX;
        const movedDist = Math.hypot(totalDx, e.clientY - this.dragStartY);
        if (movedDist < DRAG_DEADZONE_PX) {
          return;
        }
        this.isOrbitDragEngaged = true;
        const effectiveDx =
          Math.abs(totalDx) > DRAG_DEADZONE_PX
            ? totalDx - Math.sign(totalDx) * DRAG_DEADZONE_PX
            : 0;
        this.lastPointerX = e.clientX;
        if (effectiveDx !== 0) {
          this.targetYaw -= effectiveDx * DRAG_ORBIT_RAD_PER_PX * this.sensitivity;
        }
        return;
      }

      const dx = e.clientX - this.lastPointerX;
      this.lastPointerX = e.clientX;
      if (Number.isFinite(dx) && dx !== 0) {
        this.targetYaw -= dx * DRAG_ORBIT_RAD_PER_PX * this.sensitivity;
      }
    };

    const resetPointerOrbit = (): void => {
      this.isPointerOrbitDown = false;
      this.isOrbitDragEngaged = false;
    };

    const onWheel = (e: WheelEvent): void => {
      if (typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      let pixelDelta = e.deltaY;
      if (e.deltaMode === 1) {
        pixelDelta *= 32;
      } else if (e.deltaMode === 2) {
        pixelDelta *= 320;
      }
      if (!Number.isFinite(pixelDelta) || pixelDelta === 0) return;

      // Normalize wheel ticks across notched mice and high-resolution trackpads
      const normalizedTicks = clamp(pixelDelta / 100, -2.5, 2.5);
      this.targetZoom = clamp(
        this.targetZoom + normalizedTicks * WHEEL_ZOOM_STEP * this.sensitivity,
        0,
        1,
      );
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!markOnce(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableElement(e.target)) return;

      if (e.code === 'BracketLeft' || e.key === '[') {
        if (!e.repeat && !this.orbitKeyLeft) {
          this.targetYaw -= KEY_TAP_NUDGE_RAD * this.sensitivity;
        }
        this.orbitKeyLeft = true;
      } else if (e.code === 'BracketRight' || e.key === ']') {
        if (!e.repeat && !this.orbitKeyRight) {
          this.targetYaw += KEY_TAP_NUDGE_RAD * this.sensitivity;
        }
        this.orbitKeyRight = true;
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      if (!markOnce(e)) return;
      if (e.code === 'BracketLeft' || e.key === '[') {
        this.orbitKeyLeft = false;
      } else if (e.code === 'BracketRight' || e.key === ']') {
        this.orbitKeyRight = false;
      }
    };

    const onWindowBlur = (): void => {
      resetPointerOrbit();
      this.orbitKeyLeft = false;
      this.orbitKeyRight = false;
    };

    const onResize = (): void => {
      this.syncCameraAspect();
    };

    domElement.addEventListener('contextmenu', onContextMenu);
    domElement.addEventListener('mousedown', onMouseDown);
    domElement.addEventListener('mousemove', onMouseMove);
    domElement.addEventListener('mouseup', resetPointerOrbit);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('keydown', onKeyDown);
    domElement.addEventListener('keyup', onKeyUp);

    const win =
      typeof window !== 'undefined' && typeof window.addEventListener === 'function'
        ? window
        : null;
    if (win && (win as unknown) !== (domElement as unknown)) {
      win.addEventListener('mousemove', onMouseMove);
      win.addEventListener('mouseup', resetPointerOrbit);
      win.addEventListener('keydown', onKeyDown);
      win.addEventListener('keyup', onKeyUp);
      win.addEventListener('blur', onWindowBlur);
      win.addEventListener('resize', onResize);
    }

    this.detachControlsFn = () => {
      domElement.removeEventListener('contextmenu', onContextMenu);
      domElement.removeEventListener('mousedown', onMouseDown);
      domElement.removeEventListener('mousemove', onMouseMove);
      domElement.removeEventListener('mouseup', resetPointerOrbit);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('keydown', onKeyDown);
      domElement.removeEventListener('keyup', onKeyUp);
      if (win && (win as unknown) !== (domElement as unknown)) {
        win.removeEventListener('mousemove', onMouseMove);
        win.removeEventListener('mouseup', resetPointerOrbit);
        win.removeEventListener('keydown', onKeyDown);
        win.removeEventListener('keyup', onKeyUp);
        win.removeEventListener('blur', onWindowBlur);
        win.removeEventListener('resize', onResize);
      }
      resetPointerOrbit();
      this.orbitKeyLeft = false;
      this.orbitKeyRight = false;
    };
  }

  setTarget(pos: Vec3, immediate = false): void {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
      return;
    }

    this.heroTargetPos.set(pos.x, pos.y, pos.z);

    if (immediate) {
      this.bossPan = null;
      this.executionZoom = null;
      this.parrySnapWeight = 0;
      this.currentFocus.copy(this.heroTargetPos);
      this.renderFocus.copy(this.currentFocus);
      this.focusVelocity.set(0, 0, 0);
      this.zoom = this.targetZoom;
      this.yaw = this.targetYaw;
      this.applyCameraPose(0, 0, 1, 0);
      this.camera.updateMatrixWorld(true);
    }
  }

  addShake(trauma: number): void {
    this.shakeController.addTrauma(trauma);
  }

  addFovPunch(deltaDeg: number): void {
    if (!Number.isFinite(deltaDeg) || deltaDeg === 0) return;

    this.fovOffset = clamp(
      this.fovOffset + deltaDeg * 0.75,
      -MAX_FOV_OFFSET_DEG,
      MAX_FOV_OFFSET_DEG,
    );
    this.fovVelocity = clamp(
      this.fovVelocity + deltaDeg * 10.5,
      -MAX_FOV_OFFSET_DEG * 22,
      MAX_FOV_OFFSET_DEG * 22,
    );
    this.syncCameraFov();
  }

  playExecutionZoom(targetPos: Vec3): void {
    if (
      !targetPos ||
      !Number.isFinite(targetPos.x) ||
      !Number.isFinite(targetPos.y) ||
      !Number.isFinite(targetPos.z)
    ) {
      return;
    }

    const alreadyJustStarted =
      this.executionZoom !== null && this.executionZoom.elapsedSec < 0.04;

    this.executionZoom = {
      targetPos: new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z),
      elapsedSec: 0,
      durationSec: EXECUTION_ZOOM_DURATION_SEC,
    };

    if (!alreadyJustStarted) {
      this.addFovPunch(-5.5);
      this.addShake(0.48);
    }
  }

  playBossIntroPan(bossPos: Vec3, durationSec?: number): void {
    if (
      !bossPos ||
      !Number.isFinite(bossPos.x) ||
      !Number.isFinite(bossPos.y) ||
      !Number.isFinite(bossPos.z)
    ) {
      return;
    }

    const validDuration =
      durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0
        ? Math.max(0.05, durationSec)
        : DEFAULT_BOSS_PAN_DURATION_SEC;

    this.bossPan = {
      startPos: this.currentFocus.clone(),
      bossPos: new THREE.Vector3(bossPos.x, bossPos.y, bossPos.z),
      elapsedSec: 0,
      durationSec: validDuration,
    };
    this.focusVelocity.set(0, 0, 0);
  }

  setOccluderMeshes(meshes: THREE.Object3D[]): void {
    this.occlusionFader.setOccluders(meshes);
  }

  screenToGroundWorld(clientX: number, clientY: number, groundY = 0): Vec3 | null {
    if (
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY) ||
      !Number.isFinite(groundY)
    ) {
      return null;
    }

    const vp = this.getViewportRect();
    this.ndcPointer.set(
      ((clientX - vp.left) / vp.width) * 2 - 1,
      -((clientY - vp.top) / vp.height) * 2 + 1,
    );

    this.camera.updateMatrixWorld();
    this.groundRaycaster.setFromCamera(this.ndcPointer, this.camera);

    const origin = this.groundRaycaster.ray.origin;
    const dir = this.groundRaycaster.ray.direction;

    if (Math.abs(dir.y) < 1e-6) {
      return null;
    }

    const t = (groundY - origin.y) / dir.y;
    if (!Number.isFinite(t) || t < 0 || t > 1000) {
      return null;
    }

    return {
      x: origin.x + dir.x * t,
      y: groundY,
      z: origin.z + dir.z * t,
    };
  }

  worldToScreen(worldPos: Vec3): { x: number; y: number; visible: boolean } {
    if (
      !worldPos ||
      !Number.isFinite(worldPos.x) ||
      !Number.isFinite(worldPos.y) ||
      !Number.isFinite(worldPos.z)
    ) {
      return { x: 0, y: 0, visible: false };
    }

    this.camera.updateMatrixWorld();

    // Verify point lies in front of camera near plane in view space (-Z forward)
    this.viewScratch
      .set(worldPos.x, worldPos.y, worldPos.z)
      .applyMatrix4(this.camera.matrixWorldInverse);
    const inFront = this.viewScratch.z < -this.camera.near;

    this.projScratch.set(worldPos.x, worldPos.y, worldPos.z).project(this.camera);

    const vp = this.getViewportRect();
    const x = vp.left + (this.projScratch.x * 0.5 + 0.5) * vp.width;
    const y = vp.top + (-this.projScratch.y * 0.5 + 0.5) * vp.height;

    const visible =
      inFront &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      this.projScratch.x >= -1 &&
      this.projScratch.x <= 1 &&
      this.projScratch.y >= -1 &&
      this.projScratch.y <= 1 &&
      this.projScratch.z >= -1 &&
      this.projScratch.z <= 1;

    return { x, y, visible };
  }

  setSensitivity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.sensitivity = clamp(value, 0.05, 5.0);
  }

  /**
   * Current orbital yaw in radians around world Y (useful for camera-relative inspection).
   */
  getYaw(): number {
    return this.yaw;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    const safeDt = Math.min(dt, 0.5);

    if (this.critFovCooldownSec > 0) {
      this.critFovCooldownSec = Math.max(0, this.critFovCooldownSec - safeDt);
    }

    this.syncCameraAspect();
    this.stepFovSpring(safeDt);

    // 1. Continuous '[' / ']' keyboard orbital rotation
    const keyDir = (this.orbitKeyRight ? 1 : 0) - (this.orbitKeyLeft ? 1 : 0);
    if (keyDir !== 0) {
      this.targetYaw += keyDir * KEY_ORBIT_RAD_PER_SEC * this.sensitivity * safeDt;
    }

    // 2. Smooth zoom & orbital yaw interpolation
    const zoomAlpha = 1 - Math.exp(-ZOOM_DAMP_SPEED * safeDt);
    const yawAlpha = 1 - Math.exp(-YAW_DAMP_SPEED * safeDt);
    this.zoom += (this.targetZoom - this.zoom) * zoomAlpha;
    this.yaw += (this.targetYaw - this.yaw) * yawAlpha;

    // 3. Target focus update: Boss Intro Pan vs Analytical Critically-Damped Spring
    let panZoomOffset = 0;
    let panYawOffset = 0;

    if (this.bossPan) {
      this.bossPan.elapsedSec += safeDt;
      const u = clamp(this.bossPan.elapsedSec / this.bossPan.durationSec, 0, 1);

      if (u >= 1) {
        this.currentFocus.copy(this.heroTargetPos);
        this.focusVelocity.set(0, 0, 0);
        this.bossPan = null;
      } else if (u < 0.35) {
        // Phase 1: Sweep smoothly from hero to boss
        const t = smootherstep(0, 0.35, u);
        this.currentFocus.lerpVectors(this.bossPan.startPos, this.bossPan.bossPos, t);
        panZoomOffset = -0.18 * t;
        panYawOffset = 0.14 * Math.sin(u * Math.PI) * t;
      } else if (u < 0.68) {
        // Phase 2: Dramatic hold on boss
        this.currentFocus.copy(this.bossPan.bossPos);
        panZoomOffset = -0.18;
        panYawOffset = 0.14 * Math.sin(u * Math.PI);
      } else {
        // Phase 3: Sweep smoothly back to live hero target
        const t = smootherstep(0.68, 1.0, u);
        this.currentFocus.lerpVectors(this.bossPan.bossPos, this.heroTargetPos, t);
        const weight = 1 - t;
        panZoomOffset = -0.18 * weight;
        panYawOffset = 0.14 * Math.sin(u * Math.PI) * weight;
      }
    } else {
      this.stepSpring3D(safeDt);
    }

    // 4. Dramatic 0.45s execution close-in action zoom & golden parry snap
    this.renderFocus.copy(this.currentFocus);
    let actionZoomOffset = 0;
    let actionYawOffset = 0;
    let distanceScale = 1.0;
    let pitchOffsetRad = 0;

    if (this.executionZoom) {
      this.executionZoom.elapsedSec += safeDt;
      const u = clamp(
        this.executionZoom.elapsedSec / this.executionZoom.durationSec,
        0,
        1,
      );
      if (u >= 1) {
        this.executionZoom = null;
      } else {
        let execWeight: number;
        if (u < 0.22) {
          execWeight = smootherstep(0, 0.22, u);
        } else if (u < 0.48) {
          execWeight = 1.0;
        } else {
          execWeight = 1.0 - smootherstep(0.48, 1.0, u);
        }

        // Frame hero + executed enemy together within a bounded action radius
        this.execFocusOffset.subVectors(this.executionZoom.targetPos, this.currentFocus);
        const offsetLen = this.execFocusOffset.length();
        if (offsetLen > 6.5) {
          this.execFocusOffset.multiplyScalar(6.5 / offsetLen);
        }
        this.renderFocus.addScaledVector(this.execFocusOffset, 0.6 * execWeight);

        actionZoomOffset -= 0.38 * execWeight;
        actionYawOffset += 0.085 * execWeight;
        distanceScale *= 1.0 - 0.22 * execWeight;
        pitchOffsetRad -= 0.08 * execWeight;
      }
    }

    if (this.parrySnapWeight > 1e-4) {
      this.parrySnapWeight *= Math.exp(-PARRY_SNAP_DECAY * safeDt);
      if (this.parrySnapWeight <= 1e-4) {
        this.parrySnapWeight = 0;
      } else {
        actionZoomOffset -= 0.1 * this.parrySnapWeight;
        actionYawOffset -= 0.038 * this.parrySnapWeight;
        distanceScale *= 1.0 - 0.09 * this.parrySnapWeight;
      }
    }

    // 5. Position camera in clean base pose first so wall occlusion raycasts never flicker on crits
    this.applyCameraPose(
      panZoomOffset + actionZoomOffset,
      panYawOffset + actionYawOffset,
      distanceScale,
      pitchOffsetRad,
    );
    this.camera.updateMatrixWorld(true);

    // 6. Raycast & smoothly fade obstructing dungeon wall meshes
    this.occlusionFader.update(safeDt, this.camera, this.renderFocus);

    // 6. Layer trauma-based Perlin + sinusoidal directional/rotational shake
    const shake = this.shakeController.update(safeDt);
    if (
      shake.localOffset.lengthSq() > 1e-10 ||
      Math.abs(shake.pitchOffset) > 1e-7 ||
      Math.abs(shake.yawOffset) > 1e-7 ||
      Math.abs(shake.rollOffset) > 1e-7
    ) {
      this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
      this.camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
      this.camBack.setFromMatrixColumn(this.camera.matrixWorld, 2).normalize();

      this.camera.position
        .addScaledVector(this.camRight, shake.localOffset.x)
        .addScaledVector(this.camUp, shake.localOffset.y)
        .addScaledVector(this.camBack, shake.localOffset.z);

      this.camera.rotateX(shake.pitchOffset);
      this.camera.rotateY(shake.yawOffset);
      this.camera.rotateZ(shake.rollOffset);
      this.camera.updateMatrixWorld(true);
    }
  }

  dispose(): void {
    this.detachControls();
    for (const unsub of this.eventUnsubs) {
      unsub();
    }
    this.eventUnsubs.length = 0;
    this.occlusionFader.dispose();
    this.shakeController.reset();
    this.fovOffset = 0;
    this.fovVelocity = 0;
    this.critFovCooldownSec = 0;
    this.parrySnapWeight = 0;
    this.syncCameraFov();
    this.bossPan = null;
    this.executionZoom = null;
  }

  private triggerParrySnap(counterSuccess: boolean): void {
    if (counterSuccess) {
      this.parrySnapWeight = 1.0;
      this.addFovPunch(-3.4);
      this.addShake(0.32);
    } else {
      this.parrySnapWeight = Math.max(this.parrySnapWeight, 0.45);
      this.addFovPunch(-1.6);
      this.addShake(0.14);
    }
  }

  private computeFlourishFovKick(rarity?: ItemRarity): number {
    switch (rarity) {
      case 'legendary':
        return -3.2;
      case 'epic':
        return -2.6;
      case 'rare':
        return -2.2;
      case 'uncommon':
        return -1.9;
      default:
        return -1.6;
    }
  }

  private stepFovSpring(dt: number): void {
    if (dt <= 0) return;
    if (Math.abs(this.fovOffset) <= 1e-5 && Math.abs(this.fovVelocity) <= 1e-4) {
      if (this.fovOffset !== 0 || this.fovVelocity !== 0) {
        this.fovOffset = 0;
        this.fovVelocity = 0;
        this.syncCameraFov();
      }
      return;
    }

    // Closed-form analytical critically-damped harmonic oscillator (100% 60/120/144Hz invariant)
    const exp = Math.exp(-FOV_SPRING_OMEGA * dt);
    const temp = (this.fovVelocity + FOV_SPRING_OMEGA * this.fovOffset) * dt;
    this.fovOffset = clamp(
      (this.fovOffset + temp) * exp,
      -MAX_FOV_OFFSET_DEG,
      MAX_FOV_OFFSET_DEG,
    );
    this.fovVelocity = (this.fovVelocity - temp * FOV_SPRING_OMEGA) * exp;

    if (Math.abs(this.fovOffset) <= 1e-4 && Math.abs(this.fovVelocity) <= 1e-3) {
      this.fovOffset = 0;
      this.fovVelocity = 0;
    }

    this.syncCameraFov();
  }

  private syncCameraFov(): void {
    const desiredFov = clamp(DEFAULT_FOV + this.fovOffset, MIN_DYNAMIC_FOV, MAX_DYNAMIC_FOV);
    if (Math.abs(this.camera.fov - desiredFov) > 1e-4) {
      this.camera.fov = desiredFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private detachControls(): void {
    if (this.detachControlsFn) {
      this.detachControlsFn();
      this.detachControlsFn = null;
    }
    this.domElement = null;
  }

  private stepSpring3D(dt: number): void {
    if (dt <= 0) return;

    const exp = Math.exp(-SPRING_OMEGA * dt);

    const dx = this.currentFocus.x - this.heroTargetPos.x;
    const dy = this.currentFocus.y - this.heroTargetPos.y;
    const dz = this.currentFocus.z - this.heroTargetPos.z;

    const tx = (this.focusVelocity.x + SPRING_OMEGA * dx) * dt;
    const ty = (this.focusVelocity.y + SPRING_OMEGA * dy) * dt;
    const tz = (this.focusVelocity.z + SPRING_OMEGA * dz) * dt;

    this.currentFocus.set(
      this.heroTargetPos.x + (dx + tx) * exp,
      this.heroTargetPos.y + (dy + ty) * exp,
      this.heroTargetPos.z + (dz + tz) * exp,
    );

    this.focusVelocity.set(
      (this.focusVelocity.x - tx * SPRING_OMEGA) * exp,
      (this.focusVelocity.y - ty * SPRING_OMEGA) * exp,
      (this.focusVelocity.z - tz * SPRING_OMEGA) * exp,
    );
  }

  private applyCameraPose(
    zoomOffset: number,
    yawOffset: number,
    distanceScale: number,
    pitchOffsetRad: number,
  ): void {
    const effZoom = clamp(this.zoom + zoomOffset, 0, 1);
    const effYaw = this.yaw + yawOffset;

    const distance = lerp(MIN_DISTANCE, MAX_DISTANCE, effZoom) * distanceScale;
    const pitch = clamp(
      lerp(MIN_PITCH_RAD, MAX_PITCH_RAD, effZoom) + pitchOffsetRad,
      MIN_EXECUTION_PITCH_RAD,
      MAX_PITCH_RAD,
    );
    const lookAtHeight = lerp(LOOK_AT_HEIGHT_CLOSE, LOOK_AT_HEIGHT_FAR, effZoom);

    this.lookAtPoint.set(
      this.renderFocus.x,
      this.renderFocus.y + lookAtHeight,
      this.renderFocus.z,
    );

    const horizDist = Math.cos(pitch) * distance;
    const vertDist = Math.sin(pitch) * distance;

    this.baseCamPos.set(
      this.lookAtPoint.x + Math.sin(effYaw) * horizDist,
      this.lookAtPoint.y + vertDist,
      this.lookAtPoint.z + Math.cos(effYaw) * horizDist,
    );

    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.baseCamPos);
    this.camera.lookAt(this.lookAtPoint);
  }

  private computeInitialAspect(): number {
    if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
      return window.innerWidth / window.innerHeight;
    }
    return DEFAULT_VIEWPORT_WIDTH / DEFAULT_VIEWPORT_HEIGHT;
  }

  private getViewportRect(): { left: number; top: number; width: number; height: number } {
    if (this.domElement && typeof this.domElement.getBoundingClientRect === 'function') {
      const rect = this.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }
    }

    if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }

    return {
      left: 0,
      top: 0,
      width: DEFAULT_VIEWPORT_WIDTH,
      height: DEFAULT_VIEWPORT_HEIGHT,
    };
  }

  private syncCameraAspect(): void {
    if (!this.domElement || typeof this.domElement.getBoundingClientRect !== 'function') {
      return;
    }
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const desiredAspect = rect.width / rect.height;
    if (Number.isFinite(desiredAspect) && desiredAspect > 0) {
      if (Math.abs(this.camera.aspect - desiredAspect) > 1e-4) {
        this.camera.aspect = desiredAspect;
        this.camera.updateProjectionMatrix();
      }
    }
  }
}

export function createCameraRig(): ICameraRig {
  return new CameraRig();
}
