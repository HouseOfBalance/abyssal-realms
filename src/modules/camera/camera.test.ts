import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { eventBus } from '../../core/EventBus';
import { CameraRig, createCameraRig } from './index';

class MockCanvasElement extends EventTarget {
  public width = 1280;
  public height = 720;

  getBoundingClientRect(): DOMRect {
    return {
      left: 0,
      top: 0,
      right: this.width,
      bottom: this.height,
      width: this.width,
      height: this.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

function makeEvent<T extends Record<string, unknown>>(type: string, props: T): Event & T {
  const evt = new Event(type, { cancelable: true }) as Event & T;
  Object.assign(evt, props);
  return evt;
}

describe('CameraRig (ICameraRig)', () => {
  it('creates an isometric PerspectiveCamera and supports immediate & spring-damped target tracking', () => {
    const rig = createCameraRig();
    expect(rig).toBeInstanceOf(CameraRig);
    expect(rig.camera).toBeInstanceOf(THREE.PerspectiveCamera);

    // Immediate snap
    rig.setTarget({ x: 10, y: 0, z: 20 }, true);
    const snappedPos = rig.camera.position.clone();
    expect(snappedPos.x).toBeGreaterThan(10);
    expect(snappedPos.z).toBeGreaterThan(20);
    expect(snappedPos.y).toBeGreaterThan(8);

    // Smooth spring tracking without snapping
    rig.setTarget({ x: 30, y: 0, z: 20 }, false);
    expect(rig.camera.position.x).toBeCloseTo(snappedPos.x, 4);

    rig.update(1 / 60);
    const midX = rig.camera.position.x;
    expect(midX).toBeGreaterThan(snappedPos.x);
    expect(midX).toBeLessThan(snappedPos.x + 20);

    // Converges smoothly without overshoot
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60);
    }
    expect(rig.camera.position.x).toBeCloseTo(snappedPos.x + 20, 2);
    expect(rig.camera.position.x).toBeLessThanOrEqual(snappedPos.x + 20.01);

    rig.dispose();
  });

  it('couples zoom distance and pitch between close action view and overhead tactical view', () => {
    const rig = createCameraRig();
    const canvas = new MockCanvasElement();
    rig.attachControls(canvas as unknown as HTMLElement);
    rig.setTarget({ x: 0, y: 0, z: 0 }, true);

    // Zoom all the way in (negative deltaY)
    for (let i = 0; i < 20; i++) {
      canvas.dispatchEvent(makeEvent('wheel', { deltaY: -200, deltaMode: 0 }));
    }
    for (let i = 0; i < 60; i++) rig.update(1 / 60);

    const closePos = rig.camera.position.clone();
    const closeDist = closePos.distanceTo(new THREE.Vector3(0, 1.35, 0));
    const closePitch = Math.atan2(closePos.y - 1.35, Math.hypot(closePos.x, closePos.z));

    // Zoom all the way out (positive deltaY)
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(makeEvent('wheel', { deltaY: 200, deltaMode: 0 }));
    }
    for (let i = 0; i < 60; i++) rig.update(1 / 60);

    const farPos = rig.camera.position.clone();
    const farDist = farPos.distanceTo(new THREE.Vector3(0, 0.65, 0));
    const farPitch = Math.atan2(farPos.y - 0.65, Math.hypot(farPos.x, farPos.z));

    expect(closeDist).toBeCloseTo(8.5, 1);
    expect(farDist).toBeCloseTo(26.0, 1);
    expect(farPitch).toBeGreaterThan(closePitch + 0.45);

    rig.dispose();
  });

  it('rotates orbital yaw via right-mouse drag and [ / ] keys with configurable sensitivity', () => {
    const rig = new CameraRig();
    const canvas = new MockCanvasElement();
    rig.attachControls(canvas as unknown as HTMLElement);
    rig.setTarget({ x: 0, y: 0, z: 0 }, true);

    const startYaw = rig.getYaw();

    // Stationary right-click (< deadzone) does not jitter yaw
    canvas.dispatchEvent(makeEvent('mousedown', { button: 2, clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(makeEvent('mousemove', { clientX: 401, clientY: 300 }));
    canvas.dispatchEvent(makeEvent('mouseup', { button: 2, clientX: 401, clientY: 300 }));
    rig.update(0.1);
    expect(rig.getYaw()).toBeCloseTo(startYaw, 5);

    // Right-mouse drag orbits yaw
    canvas.dispatchEvent(makeEvent('mousedown', { button: 2, clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(makeEvent('mousemove', { clientX: 520, clientY: 300 }));
    canvas.dispatchEvent(makeEvent('mouseup', { button: 2, clientX: 520, clientY: 300 }));
    for (let i = 0; i < 40; i++) rig.update(1 / 60);
    const afterDragYaw = rig.getYaw();
    expect(afterDragYaw).toBeLessThan(startYaw - 0.5);

    // '[' and ']' bracket keys with higher sensitivity
    rig.setSensitivity(2.0);
    canvas.dispatchEvent(
      makeEvent('keydown', { key: ']', code: 'BracketRight', repeat: false, ctrlKey: false, metaKey: false, altKey: false }),
    );
    for (let i = 0; i < 15; i++) rig.update(1 / 60);
    canvas.dispatchEvent(makeEvent('keyup', { key: ']', code: 'BracketRight' }));
    for (let i = 0; i < 30; i++) rig.update(1 / 60);

    expect(rig.getYaw()).toBeGreaterThan(afterDragYaw + 0.8);

    rig.dispose();
  });

  it('applies trauma-based Perlin/sinusoidal shake via addShake and eventBus camera:shake', () => {
    const rig = createCameraRig();
    rig.setTarget({ x: 0, y: 0, z: 0 }, true);
    const restPos = rig.camera.position.clone();

    eventBus.emit('camera:shake', { trauma: 0.9 });
    rig.update(1 / 60);
    const shakenDist = rig.camera.position.distanceTo(restPos);
    expect(shakenDist).toBeGreaterThan(0.01);

    // Decays cleanly back to exact rest position
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60);
    }
    expect(rig.camera.position.distanceTo(restPos)).toBeLessThan(1e-4);

    rig.dispose();
  });

  it('plays cinematic boss intro pan sweeping to the boss and returning to the hero', () => {
    const rig = createCameraRig();
    const heroPos = { x: 0, y: 0, z: 0 };
    const bossPos = { x: 40, y: 0, z: -30 };

    rig.setTarget(heroPos, true);
    const heroCamPos = rig.camera.position.clone();

    rig.playBossIntroPan(bossPos, 2.0);

    // Advance into hold phase (~50% of 2.0s = 1.0s)
    for (let i = 0; i < 50; i++) {
      rig.setTarget(heroPos, false);
      rig.update(0.02);
    }
    // Screen center ray should now point right near bossPos
    const midGround = rig.screenToGroundWorld(640, 360, 0);
    expect(midGround).not.toBeNull();
    expect(Math.hypot(midGround!.x - bossPos.x, midGround!.z - bossPos.z)).toBeLessThan(2.0);

    // Finish remaining duration -> smoothly returns to hero
    for (let i = 0; i < 60; i++) {
      rig.setTarget(heroPos, false);
      rig.update(0.02);
    }
    expect(rig.camera.position.distanceTo(heroCamPos)).toBeLessThan(0.25);

    rig.dispose();
  });

  it('fades obstructing wall meshes while keeping shared-material walls opaque, then restores when clear', () => {
    const rig = createCameraRig();
    rig.setTarget({ x: 0, y: 0, z: 0 }, true);

    const sharedWallMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const wallGeo = new THREE.BoxGeometry(6, 8, 2);

    // Place obstructing wall directly along sightline between camera (+X, +Y, +Z) and origin (0, 1, 0)
    const blockingWall = new THREE.Mesh(wallGeo, sharedWallMat);
    blockingWall.position.set(4, 3.5, 4);
    blockingWall.rotation.y = Math.PI / 4;

    // Place a second wall far off to the side sharing the exact same material
    const clearWall = new THREE.Mesh(wallGeo, sharedWallMat);
    clearWall.position.set(-25, 3.5, -25);

    rig.setOccluderMeshes([blockingWall, clearWall]);

    for (let i = 0; i < 30; i++) {
      rig.update(1 / 60);
    }

    const blockingMatDuring = blockingWall.material as THREE.MeshStandardMaterial;
    const clearMatDuring = clearWall.material as THREE.MeshStandardMaterial;

    expect(blockingMatDuring.transparent).toBe(true);
    expect(blockingMatDuring.opacity).toBeLessThan(0.35);
    // Unoccluded wall sharing sharedWallMat must remain completely opaque!
    expect(clearMatDuring).toBe(sharedWallMat);
    expect(clearMatDuring.opacity).toBe(1.0);

    // Move hero clear of the wall and verify smooth restoration back to original shared material
    rig.setTarget({ x: 20, y: 0, z: 20 }, true);
    for (let i = 0; i < 90; i++) {
      rig.update(1 / 60);
    }

    expect(blockingWall.material).toBe(sharedWallMat);
    expect((blockingWall.material as THREE.MeshStandardMaterial).opacity).toBe(1.0);

    wallGeo.dispose();
    sharedWallMat.dispose();
    rig.dispose();
  });

  it('accurately projects worldToScreen and unprojects screenToGroundWorld', () => {
    const rig = createCameraRig();
    const canvas = new MockCanvasElement();
    rig.attachControls(canvas as unknown as HTMLElement);
    rig.setTarget({ x: 5, y: 0, z: -8 }, true);

    const targetGround = { x: 7.5, y: 0, z: -6.25 };
    const screen = rig.worldToScreen(targetGround);
    expect(screen.visible).toBe(true);
    expect(screen.x).toBeGreaterThan(0);
    expect(screen.x).toBeLessThan(1280);
    expect(screen.y).toBeGreaterThan(0);
    expect(screen.y).toBeLessThan(720);

    const unprojected = rig.screenToGroundWorld(screen.x, screen.y, 0);
    expect(unprojected).not.toBeNull();
    expect(unprojected!.x).toBeCloseTo(targetGround.x, 3);
    expect(unprojected!.y).toBeCloseTo(0, 5);
    expect(unprojected!.z).toBeCloseTo(targetGround.z, 3);

    // Elevated plane groundY = 2.5 round-trip
    const elevatedPoint = { x: 4.0, y: 2.5, z: -9.0 };
    const elevatedScreen = rig.worldToScreen(elevatedPoint);
    const elevatedWorld = rig.screenToGroundWorld(elevatedScreen.x, elevatedScreen.y, 2.5);
    expect(elevatedWorld).not.toBeNull();
    expect(elevatedWorld!.x).toBeCloseTo(elevatedPoint.x, 3);
    expect(elevatedWorld!.y).toBeCloseTo(2.5, 5);
    expect(elevatedWorld!.z).toBeCloseTo(elevatedPoint.z, 3);

    // Point far behind camera is marked invisible
    const behindCam = {
      x: rig.camera.position.x + 20,
      y: rig.camera.position.y + 20,
      z: rig.camera.position.z + 20,
    };
    expect(rig.worldToScreen(behindCam).visible).toBe(false);

    rig.dispose();
  });

  it('supports spring-damped addFovPunch and auto-reacts to dodge, crit, gear flourish, and portal warp events', () => {
    const rig = createCameraRig();
    expect(rig.camera.fov).toBeCloseTo(45, 4);

    // Direct positive FOV punch
    rig.addFovPunch?.(6.0);
    expect(rig.camera.fov).toBeGreaterThan(48.5);
    rig.update(0.04);
    expect(rig.camera.fov).toBeGreaterThan(50.0);

    // Settles smoothly back to 45 deg
    for (let i = 0; i < 120; i++) {
      rig.update(1 / 120);
    }
    expect(rig.camera.fov).toBeCloseTo(45, 2);

    // Auto-reacts to player:dodge (speed widening kick)
    eventBus.emit('player:dodge', {
      position: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
    });
    expect(rig.camera.fov).toBeGreaterThan(47.0);
    for (let i = 0; i < 120; i++) rig.update(1 / 120);
    expect(rig.camera.fov).toBeCloseTo(45, 2);

    // Auto-reacts to hero:gearChanged (weapon flourish zoom-in kick)
    eventBus.emit('hero:gearChanged', {
      slot: 'weapon',
      weaponVisual: 'greatsword',
      rarity: 'legendary',
    });
    expect(rig.camera.fov).toBeLessThan(43.2);
    for (let i = 0; i < 120; i++) rig.update(1 / 120);
    expect(rig.camera.fov).toBeCloseTo(45, 2);

    // Auto-reacts to critical hits (combat:damageDealt) without collapsing on multi-hit AoE crits
    for (let i = 0; i < 8; i++) {
      eventBus.emit('combat:damageDealt', {
        result: {
          finalDamage: 120,
          isCrit: true,
          isDodged: false,
          killed: false,
          healedSource: 0,
          hitPosition: { x: 2, y: 1, z: 2 },
          damageType: 'physical',
        },
        targetIsPlayer: false,
        targetId: `enemy_${i}`,
      });
    }
    expect(rig.camera.fov).toBeLessThan(44.2);
    expect(rig.camera.fov).toBeGreaterThan(42.5);
    for (let i = 0; i < 120; i++) rig.update(1 / 120);

    // Auto-reacts to dungeon:portalWarp and preserves surge across immediate floor spawn setTarget
    eventBus.emit('dungeon:portalWarp', {
      fromFloor: 1,
      toFloor: 2,
      position: { x: 10, y: 0, z: 10 },
    });
    rig.setTarget({ x: 0, y: 0, z: 0 }, true);
    expect(rig.camera.fov).toBeGreaterThan(50.5);

    // Dispose cleans up listeners and resets FOV
    rig.dispose();
    expect(rig.camera.fov).toBeCloseTo(45, 4);
    eventBus.emit('player:dodge', {
      position: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
    });
    expect(rig.camera.fov).toBeCloseTo(45, 4);
  });

  it('maintains frame-rate-independent damping across 60Hz, 120Hz, and 144Hz refresh rates', () => {
    const setupIdenticalRig = (): CameraRig => {
      const rig = new CameraRig();
      const canvas = new MockCanvasElement();
      rig.attachControls(canvas as unknown as HTMLElement);
      rig.setTarget({ x: 0, y: 0, z: 0 }, true);
      rig.setTarget({ x: 24, y: 0, z: -18 }, false);
      canvas.dispatchEvent(makeEvent('wheel', { deltaY: -150, deltaMode: 0 }));
      canvas.dispatchEvent(makeEvent('mousedown', { button: 2, clientX: 300, clientY: 300 }));
      canvas.dispatchEvent(makeEvent('mousemove', { clientX: 410, clientY: 300 }));
      canvas.dispatchEvent(makeEvent('mouseup', { button: 2, clientX: 410, clientY: 300 }));
      rig.addShake(0.8);
      rig.addFovPunch(6.0);
      return rig;
    };

    const rig60 = setupIdenticalRig();
    const rig120 = setupIdenticalRig();
    const rig144 = setupIdenticalRig();

    // Advance all three rigs by exact 0.25s elapsed time:
    // 15 * (1/60) === 30 * (1/120) === 36 * (1/144) === 0.25s
    for (let i = 0; i < 15; i++) rig60.update(1 / 60);
    for (let i = 0; i < 30; i++) rig120.update(1 / 120);
    for (let i = 0; i < 36; i++) rig144.update(1 / 144);

    expect(rig120.camera.fov).toBeCloseTo(rig60.camera.fov, 4);
    expect(rig144.camera.fov).toBeCloseTo(rig60.camera.fov, 4);
    expect(rig120.getYaw()).toBeCloseTo(rig60.getYaw(), 4);
    expect(rig144.getYaw()).toBeCloseTo(rig60.getYaw(), 4);
    expect(rig120.camera.position.distanceTo(rig60.camera.position)).toBeLessThan(1e-4);
    expect(rig144.camera.position.distanceTo(rig60.camera.position)).toBeLessThan(1e-4);

    rig60.dispose();
    rig120.dispose();
    rig144.dispose();
  });

  it('performs dramatic 0.45s playExecutionZoom on combat:executionStrike and crisp parry snap on combat:parryTriggered', () => {
    const rig = new CameraRig();
    const heroPos = { x: 0, y: 0, z: 0 };
    const bossPos = { x: 4, y: 0, z: -3 };
    rig.setTarget(heroPos, true);

    const restDist = rig.camera.position.distanceTo(new THREE.Vector3(0, 1, 0));

    // Trigger via eventBus + direct call on same frame (verifies deduplication guard)
    eventBus.emit('combat:executionStrike', {
      position: bossPos,
      targetId: 'boss_1',
      damage: 950,
    });
    rig.playExecutionZoom(bossPos);

    expect(rig.camera.fov).toBeLessThan(41.5);
    expect(rig.camera.fov).toBeGreaterThan(38.0);

    // Advance into peak of 0.45s execution zoom (~0.15s)
    for (let i = 0; i < 18; i++) {
      rig.setTarget(heroPos, false);
      rig.update(1 / 120);
    }
    const peakExecDist = rig.camera.position.distanceTo(new THREE.Vector3(2.4, 1.35, -1.8));
    expect(peakExecDist).toBeLessThan(restDist * 0.68);

    // Settle past 0.45s + shake/FOV decay -> smoothly returns to standard framing
    for (let i = 0; i < 110; i++) {
      rig.setTarget(heroPos, false);
      rig.update(1 / 120);
    }
    expect(rig.camera.fov).toBeCloseTo(45, 2);
    expect(rig.camera.position.distanceTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(restDist, 1);

    // Golden counter-parry snap on combat:parryTriggered
    eventBus.emit('combat:parryTriggered', {
      position: heroPos,
      counterSuccess: true,
    });
    expect(rig.camera.fov).toBeLessThan(43.0);
    rig.update(1 / 120);
    const parryDist = rig.camera.position.distanceTo(new THREE.Vector3(0, 1, 0));
    expect(parryDist).toBeLessThan(restDist - 0.5);

    for (let i = 0; i < 120; i++) {
      rig.update(1 / 120);
    }
    expect(rig.camera.fov).toBeCloseTo(45, 2);
    expect(rig.camera.position.distanceTo(new THREE.Vector3(0, 1, 0))).toBeCloseTo(restDist, 1);

    rig.dispose();
  });
});
