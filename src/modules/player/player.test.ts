import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DungeonFloorData,
  HeroAnimState,
  HeroClassId,
  IHeroRig,
  ItemRarity,
  TileType,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { createPlayerController, PlayerController } from './index';

class FakeEventTarget {
  private listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, handler: (event: any) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: (event: any) => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type: string, event: Record<string, any> = {}): void {
    const payload = {
      preventDefault: vi.fn(),
      target: null,
      ...event,
    };
    for (const fn of this.listeners.get(type) ?? []) {
      fn(payload);
    }
  }
}

function createMockHeroRig(): IHeroRig & {
  lastAnim: HeroAnimState | null;
  lastWeapon: WeaponVisualType | null;
  lastClass: HeroClassId | null;
  hitFlashes: number;
} {
  const root = new THREE.Group();
  return {
    root,
    lastAnim: null,
    lastWeapon: null,
    lastClass: null,
    hitFlashes: 0,
    setClassStyle(heroClass: HeroClassId) {
      this.lastClass = heroClass;
    },
    setWeaponVisual(weapon: WeaponVisualType, _rarity?: ItemRarity) {
      this.lastWeapon = weapon;
    },
    playAnim(state: HeroAnimState) {
      this.lastAnim = state;
    },
    flashHit() {
      this.hitFlashes += 1;
    },
    update() {},
    getWeaponTipWorldPosition(out = new THREE.Vector3()) {
      return out.copy(root.position);
    },
    dispose() {},
  };
}

function createSyntheticFloor(
  isWalkableFn: (x: number, z: number, radius?: number) => boolean = () => true,
): DungeonFloorData & { revealedPositions: Vec3[] } {
  const revealedPositions: Vec3[] = [];
  return {
    floorNumber: 1,
    biome: 'crypt',
    seed: 42,
    cols: 20,
    rows: 20,
    tileSize: 2,
    tiles: [],
    explored: [],
    rooms: [],
    playerSpawn: { x: 0, y: 0, z: 0 },
    bossSpawn: { x: 20, y: 0, z: 20 },
    portalPosition: { x: 22, y: 0, z: 22 },
    interactables: [],
    torchPositions: [],
    revealedPositions,
    worldToGrid: (p) => ({ col: Math.floor(p.x / 2), row: Math.floor(p.z / 2) }),
    gridToWorld: (col, row) => ({ x: col * 2 + 1, y: 0, z: row * 2 + 1 }),
    isWalkableWorld: (x, z, radius = 0) => isWalkableFn(x, z, radius),
    findPath: () => [],
    revealRadius: (pos) => {
      revealedPositions.push({ ...pos });
    },
  };
}

describe('PlayerController & RPG Systems', () => {
  const origWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = origWindow;
    eventBus.clear();
  });

  it('initializes all 3 hero classes with accurate base attributes and starting weapons', () => {
    const ctrl = createPlayerController();
    const rig = createMockHeroRig();

    ctrl.init('arcanist', { x: 4, y: 0, z: -6 }, rig);
    expect(ctrl.state.heroClass).toBe('arcanist');
    expect(ctrl.state.name).toBe('Arcanist');
    expect(ctrl.state.position).toEqual({ x: 4, y: 0, z: -6 });
    expect(ctrl.state.baseAttributes).toEqual({
      strength: 7,
      dexterity: 10,
      intelligence: 18,
      vitality: 10,
    });
    expect(rig.lastClass).toBe('arcanist');
    expect(rig.lastWeapon).toBe('staff');
    expect(ctrl.state.hp).toBe(ctrl.state.stats.maxHp);
    expect(ctrl.state.mana).toBe(ctrl.state.stats.maxMana);
    expect(ctrl.state.stamina).toBe(ctrl.state.stats.maxStamina);
    ctrl.dispose();
  });

  it('supports isometric / camera-relative WASD movement, cursor aiming, and smooth rotationY', () => {
    const fakeWin = new FakeEventTarget();
    const fakeDom = new FakeEventTarget();
    (globalThis as any).window = fakeWin;

    const ctrl = new PlayerController();
    const rig = createMockHeroRig();
    const floor = createSyntheticFloor();

    ctrl.init('shadowblade', { x: 0, y: 0, z: 0 }, rig);
    ctrl.attachInput(fakeDom as unknown as HTMLElement);

    // Explicitly align camera yaw to 0 (North = -Z, East = +X)
    ctrl.setCameraYaw(0);
    fakeWin.emit('keydown', { code: 'KeyW', key: 'w' });
    fakeWin.emit('keydown', { code: 'KeyD', key: 'd' });

    // Aim cursor due West (-X) while moving North-East (+X, -Z)
    ctrl.setCursorWorldTarget({ x: -10, y: 0, z: 0 });

    for (let i = 0; i < 16; i++) {
      ctrl.update(1 / 60, floor, false);
    }

    expect(ctrl.state.position.x).toBeGreaterThan(0.2);
    expect(ctrl.state.position.z).toBeLessThan(-0.2);
    // Diagonal velocity magnitude never exceeds moveSpeed
    const speed = Math.hypot(ctrl.state.velocity.x, ctrl.state.velocity.z);
    expect(speed).toBeLessThanOrEqual(ctrl.state.stats.moveSpeed + 0.01);

    // Facing points accurately from updated hero position toward cursor (-10, 0, 0)
    const expectedDx = -10 - ctrl.state.position.x;
    const expectedDz = 0 - ctrl.state.position.z;
    const expectedLen = Math.hypot(expectedDx, expectedDz);
    expect(ctrl.state.facingDir.x).toBeCloseTo(expectedDx / expectedLen, 4);
    expect(ctrl.state.facingDir.z).toBeCloseTo(expectedDz / expectedLen, 4);
    expect(ctrl.state.rotationY).toBeCloseTo(Math.atan2(expectedDx, expectedDz), 1);

    // Live THREE.PerspectiveCamera basis alignment
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(10, 12, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    ctrl.setCamera(cam);
    ctrl.update(1 / 60, floor, false);
    expect(Number.isFinite(ctrl.state.position.x)).toBe(true);

    ctrl.dispose();
  });

  it('respects chill/haste/stun statuses, passive regeneration, death event, and respawnAt', () => {
    const fakeWin = new FakeEventTarget();
    const fakeDom = new FakeEventTarget();
    (globalThis as any).window = fakeWin;

    const ctrl = new PlayerController();
    const rig = createMockHeroRig();
    const floor = createSyntheticFloor();

    ctrl.init('vanguard', { x: 0, y: 0, z: 0 }, rig);
    ctrl.attachInput(fakeDom as unknown as HTMLElement);
    ctrl.setCameraYaw(0);

    // Regeneration check
    ctrl.state.hp = 100;
    ctrl.state.mana = 20;
    ctrl.state.stamina = 40;
    ctrl.update(0.1, floor, false);
    expect(ctrl.state.hp).toBeGreaterThan(100);
    expect(ctrl.state.mana).toBeGreaterThan(20);
    expect(ctrl.state.stamina).toBeGreaterThan(40);

    // Stun blocks movement & casting
    ctrl.state.statuses.push({
      id: 'stun_1',
      type: 'stun',
      remainingSec: 1.5,
      durationSec: 1.5,
      stacks: 1,
      potency: 1,
      sourceId: 'boss',
    });
    fakeWin.emit('keydown', { code: 'KeyW' });
    fakeDom.emit('mousedown', { button: 0, clientX: 50, clientY: 50 });
    const stunnedRes = ctrl.update(1 / 60, floor, false);
    expect(stunnedRes.castSlotRequested).toBeNull();
    expect(Math.hypot(ctrl.state.velocity.x, ctrl.state.velocity.z)).toBe(0);

    // Lethal damage triggers death animation; respawnAt restores hero
    ctrl.state.hp = 0;
    eventBus.emit('combat:damageDealt', {
      targetIsPlayer: true,
      targetId: 'player',
      result: {
        finalDamage: 120,
        isCrit: false,
        isDodged: false,
        killed: true,
        healedSource: 0,
        hitPosition: { x: 0, y: 0, z: 0 },
        damageType: 'physical',
      },
    });
    expect(ctrl.state.alive).toBe(false);
    expect(rig.lastAnim).toBe('death');

    ctrl.respawnAt({ x: 5, y: 0, z: -3 });
    expect(ctrl.state.alive).toBe(true);
    expect(ctrl.state.hp).toBe(ctrl.state.stats.maxHp);
    expect(ctrl.state.position).toEqual({ x: 5, y: 0, z: -3 });
    expect(ctrl.state.statuses).toHaveLength(0);
    expect(rig.lastAnim).toBe('idle');

    ctrl.dispose();
  });

  it('executes Space/Shift dodge roll with stamina cost, velocity burst, i-frames, and eventBus emission', () => {
    const fakeWin = new FakeEventTarget();
    const fakeDom = new FakeEventTarget();
    (globalThis as any).window = fakeWin;

    const ctrl = createPlayerController();
    const rig = createMockHeroRig();
    const floor = createSyntheticFloor();

    ctrl.init('vanguard', { x: 0, y: 0, z: 0 }, rig);
    ctrl.attachInput(fakeDom as unknown as HTMLElement);

    const dodgeEvents: Array<{ position: Vec3; direction: Vec3 }> = [];
    eventBus.on('player:dodge', (payload) => dodgeEvents.push(payload));

    const startStamina = ctrl.state.stamina;
    ctrl.setCursorWorldTarget({ x: 0, y: 0, z: 10 });
    fakeWin.emit('keydown', { code: 'Space', key: ' ' });

    const res = ctrl.update(1 / 60, floor, false);
    expect(res.dodgeTriggered).toBe(true);
    expect(ctrl.state.isDodging).toBe(true);
    expect(ctrl.state.invulnerableSec).toBeGreaterThan(0.3);
    expect(ctrl.state.stamina).toBeLessThan(startStamina);
    expect(Math.hypot(ctrl.state.velocity.x, ctrl.state.velocity.z)).toBeGreaterThan(
      ctrl.state.stats.moveSpeed * 1.8,
    );
    expect(dodgeEvents).toHaveLength(1);
    expect(dodgeEvents[0].direction.z).toBeCloseTo(1, 3);

    ctrl.dispose();
  });

  it('maps LMB (0), RMB (1), Keys 1-4 (2-5), Interact (F/E), and Potion (Q) accurately', () => {
    const fakeWin = new FakeEventTarget();
    const fakeDom = new FakeEventTarget();
    (globalThis as any).window = fakeWin;

    const ctrl = createPlayerController();
    const rig = createMockHeroRig();
    const floor = createSyntheticFloor();

    ctrl.init('vanguard', { x: 0, y: 0, z: 0 }, rig);
    ctrl.attachInput(fakeDom as unknown as HTMLElement);

    // LMB -> 0
    fakeDom.emit('mousedown', { button: 0, clientX: 100, clientY: 100 });
    expect(ctrl.update(1 / 60, floor, false).castSlotRequested).toBe(0);
    fakeDom.emit('mouseup', { button: 0 });

    // RMB -> 1
    fakeDom.emit('mousedown', { button: 2, clientX: 100, clientY: 100 });
    expect(ctrl.update(1 / 60, floor, false).castSlotRequested).toBe(1);
    fakeDom.emit('mouseup', { button: 2 });

    // Keys 1..4 -> slots 2..5
    const keyMap: Array<[string, 2 | 3 | 4 | 5]> = [
      ['Digit1', 2],
      ['Digit2', 3],
      ['Digit3', 4],
      ['Digit4', 5],
    ];
    for (const [code, expectedSlot] of keyMap) {
      fakeWin.emit('keydown', { code });
      expect(ctrl.update(1 / 60, floor, false).castSlotRequested).toBe(expectedSlot);
      fakeWin.emit('keyup', { code });
    }

    // Interact F & E
    fakeWin.emit('keydown', { code: 'KeyF', key: 'f' });
    expect(ctrl.update(1 / 60, floor, false).interactRequested).toBe(true);
    expect(ctrl.update(1 / 60, floor, false).interactRequested).toBe(false);
    fakeWin.emit('keyup', { code: 'KeyF', key: 'f' });

    fakeWin.emit('keydown', { code: 'KeyE', key: 'e' });
    expect(ctrl.update(1 / 60, floor, false).interactRequested).toBe(true);
    fakeWin.emit('keyup', { code: 'KeyE', key: 'e' });

    // Potion Q when injured
    ctrl.state.hp = 50;
    const prevPotions = ctrl.state.healthPotions;
    fakeWin.emit('keydown', { code: 'KeyQ', key: 'q' });
    ctrl.update(1 / 60, floor, false);
    expect(ctrl.state.healthPotions).toBe(prevPotions - 1);
    expect(ctrl.state.hp).toBeGreaterThan(50);
    expect(ctrl.state.potionCooldownSec).toBeGreaterThan(0);

    // UI blocking suppresses input
    fakeWin.emit('keydown', { code: 'Digit1' });
    fakeWin.emit('keydown', { code: 'KeyF' });
    const blocked = ctrl.update(1 / 60, floor, true);
    expect(blocked.castSlotRequested).toBeNull();
    expect(blocked.interactRequested).toBe(false);

    ctrl.dispose();
  });

  it('slides smoothly along dungeon walls and deflects around doorway corners without snagging', () => {
    const fakeWin = new FakeEventTarget();
    const fakeDom = new FakeEventTarget();
    (globalThis as any).window = fakeWin;

    // Wall blocks z < 0 (so walkable requires z - radius >= 0)
    const wallFloor = createSyntheticFloor((_x, z, r = 0) => z - r >= 0);

    const ctrl = new PlayerController();
    const rig = createMockHeroRig();
    ctrl.init('vanguard', { x: 0, y: 0, z: 0.5 }, rig);
    ctrl.attachInput(fakeDom as unknown as HTMLElement);
    ctrl.setCameraYaw(0);

    // Press W (-Z into wall) + D (+X parallel to wall)
    fakeWin.emit('keydown', { code: 'KeyW' });
    fakeWin.emit('keydown', { code: 'KeyD' });

    for (let i = 0; i < 30; i++) {
      ctrl.update(1 / 60, wallFloor, false);
    }

    // Clamped flush against wall on Z, slid smoothly along +X!
    expect(ctrl.state.position.z).toBeGreaterThanOrEqual(ctrl.state.radius - 1e-4);
    expect(ctrl.state.position.z).toBeLessThan(0.45);
    expect(ctrl.state.position.x).toBeGreaterThan(1.5);

    // Doorway corner test: pillar at x <= 0, z < 0; open doorway for x > 0
    const doorwayFloor = createSyntheticFloor((x, z, r = 0) => {
      // Circle vs half-slab (x <= 0, z <= 0)
      const closestX = Math.min(x, 0);
      const closestZ = Math.min(z, 0);
      if (x <= 0 && z <= 0) return false;
      return Math.hypot(x - closestX, z - closestZ) >= r;
    });

    fakeWin.emit('keyup', { code: 'KeyD' });
    // Position hero slightly clipping the pillar corner (x = 0.2 < radius 0.42) and press pure W (-Z)
    ctrl.respawnAt({ x: 0.2, y: 0, z: 0.5 });
    for (let i = 0; i < 35; i++) {
      ctrl.update(1 / 60, doorwayFloor, false);
    }

    // Hero deflected around the corner at x=0 and walked cleanly into z < 0 through the doorway!
    expect(ctrl.state.position.z).toBeLessThan(-0.2);

    ctrl.dispose();
  });

  it('recomputes derived stats with equipment, passives, and all 3 keystones, plus XP level-ups', () => {
    const ctrl = createPlayerController();
    const rig = createMockHeroRig();
    ctrl.init('arcanist', { x: 2, y: 0, z: 3 }, rig);

    const baseSpellPower = ctrl.state.stats.spellPower;
    const baseMaxHp = ctrl.state.stats.maxHp;

    // Apply equipment + elemental_overload + blood_pact + phantom_crit keystones individually
    ctrl.recomputeStats(
      {
        attributes: { intelligence: 10, vitality: 5 },
        stats: { spellPower: 25, critChance: 0.1, critMultiplier: 0.8 },
      },
      {
        attributes: { dexterity: 5 },
        stats: { maxHp: 40 },
        keystones: ['elemental_overload'],
      },
    );

    expect(ctrl.state.stats.spellPower).toBeGreaterThan((baseSpellPower + 25) * 1.25);
    expect(ctrl.state.stats.cooldownReduction).toBeGreaterThan(0.15);
    expect(ctrl.state.stats.maxHp).toBeGreaterThan(baseMaxHp + 80);

    ctrl.recomputeStats(
      { attributes: {}, stats: {} },
      { attributes: {}, stats: {}, keystones: ['blood_pact'] },
    );
    expect(ctrl.state.stats.lifeSteal).toBeCloseTo(0.08, 3);

    ctrl.recomputeStats(
      { attributes: {}, stats: {} },
      { attributes: {}, stats: {}, keystones: ['phantom_crit'] },
    );
    expect(ctrl.state.stats.critChance).toBeGreaterThan(0.22);
    expect(ctrl.state.stats.dodgeChance).toBeGreaterThan(0.14);

    // Multi-level XP grant (+1 skill point, +3 attribute points per level, full heal, event emitted)
    const levelUps: number[] = [];
    eventBus.on('player:levelUp', ({ level }) => levelUps.push(level));

    ctrl.state.hp = 10;
    const xpResult = ctrl.grantXp(320); // Enough for L1->L2 (100) + L2->L3 (190) = 290 XP!
    expect(xpResult.leveledUp).toBe(true);
    expect(xpResult.newLevel).toBe(3);
    expect(ctrl.state.level).toBe(3);
    expect(ctrl.state.unspentSkillPoints).toBe(2);
    expect(ctrl.state.unspentAttributePoints).toBe(6);
    expect(ctrl.state.hp).toBe(ctrl.state.stats.maxHp);
    expect(levelUps).toEqual([3]);

    // Spend attribute point
    const prevStr = ctrl.state.baseAttributes.strength;
    expect(ctrl.spendAttributePoint('strength')).toBe(true);
    expect(ctrl.state.baseAttributes.strength).toBe(prevStr + 1);
    expect(ctrl.state.unspentAttributePoints).toBe(5);

    ctrl.dispose();
  });

  it('binds Key V / Middle Mouse to parryRequested and Key R to awakeningRequested', () => {
    const fakeWin = new FakeEventTarget();
    const fakeDom = new FakeEventTarget();
    (globalThis as any).window = fakeWin;

    const ctrl = createPlayerController();
    const rig = createMockHeroRig();
    const floor = createSyntheticFloor();

    ctrl.init('vanguard', { x: 0, y: 0, z: 0 }, rig);
    ctrl.attachInput(fakeDom as unknown as HTMLElement);

    // Key V -> parryRequested
    fakeWin.emit('keydown', { code: 'KeyV', key: 'v' });
    const resV = ctrl.update(1 / 60, floor, false);
    expect(resV.parryRequested).toBe(true);
    expect(resV.awakeningRequested).toBe(false);
    expect(ctrl.update(1 / 60, floor, false).parryRequested).toBe(false);
    fakeWin.emit('keyup', { code: 'KeyV', key: 'v' });

    // Middle Mouse (button 1) -> parryRequested
    fakeDom.emit('mousedown', { button: 1, clientX: 60, clientY: 60 });
    expect(ctrl.update(1 / 60, floor, false).parryRequested).toBe(true);
    fakeDom.emit('mouseup', { button: 1 });

    // Key R -> awakeningRequested
    fakeWin.emit('keydown', { code: 'KeyR', key: 'r' });
    const resR = ctrl.update(1 / 60, floor, false);
    expect(resR.awakeningRequested).toBe(true);
    expect(ctrl.update(1 / 60, floor, false).awakeningRequested).toBe(false);
    fakeWin.emit('keyup', { code: 'KeyR', key: 'r' });

    ctrl.dispose();
  });

  it('applies ice skating speed boost and low-friction glide inertia on hazard_ice tiles', () => {
    const fakeWin = new FakeEventTarget();
    const fakeDom = new FakeEventTarget();
    (globalThis as any).window = fakeWin;

    const dryFloor = createSyntheticFloor();
    dryFloor.tiles = Array.from({ length: 20 }, () => new Array<TileType>(20).fill('floor'));

    const iceFloor = createSyntheticFloor();
    iceFloor.tiles = Array.from({ length: 20 }, () => new Array<TileType>(20).fill('hazard_ice'));

    // Measure dry floor stop speed after releasing movement
    const dryCtrl = new PlayerController();
    dryCtrl.init('shadowblade', { x: 10, y: 0, z: 10 }, createMockHeroRig());
    dryCtrl.attachInput(fakeDom as unknown as HTMLElement);
    dryCtrl.setCameraYaw(0);

    fakeWin.emit('keydown', { code: 'KeyD', key: 'd' });
    for (let i = 0; i < 45; i++) dryCtrl.update(1 / 60, dryFloor, false);
    const dryPeakSpeed = Math.hypot(dryCtrl.state.velocity.x, dryCtrl.state.velocity.z);

    fakeWin.emit('keyup', { code: 'KeyD', key: 'd' });
    for (let i = 0; i < 12; i++) dryCtrl.update(1 / 60, dryFloor, false); // 0.2s coasting
    const dryCoastSpeed = Math.hypot(dryCtrl.state.velocity.x, dryCtrl.state.velocity.z);
    dryCtrl.dispose();

    // Measure ice floor top speed & low-friction skating glide
    const iceCtrl = new PlayerController();
    iceCtrl.init('shadowblade', { x: 10, y: 0, z: 10 }, createMockHeroRig());
    iceCtrl.attachInput(fakeDom as unknown as HTMLElement);
    iceCtrl.setCameraYaw(0);

    fakeWin.emit('keydown', { code: 'KeyD', key: 'd' });
    for (let i = 0; i < 60; i++) iceCtrl.update(1 / 60, iceFloor, false);
    const icePeakSpeed = Math.hypot(iceCtrl.state.velocity.x, iceCtrl.state.velocity.z);

    fakeWin.emit('keyup', { code: 'KeyD', key: 'd' });
    for (let i = 0; i < 12; i++) iceCtrl.update(1 / 60, iceFloor, false); // 0.2s skating glide
    const iceCoastSpeed = Math.hypot(iceCtrl.state.velocity.x, iceCtrl.state.velocity.z);
    iceCtrl.dispose();

    expect(icePeakSpeed).toBeGreaterThan(dryPeakSpeed * 1.1);
    expect(iceCoastSpeed).toBeGreaterThan(dryCoastSpeed * 5 + 2.5);
  });

  it('warps between paired teleporter_pad tiles and enforces the 2.5s bounce-back cooldown', () => {
    const floor = createSyntheticFloor();
    floor.tiles = Array.from({ length: 20 }, () => new Array<TileType>(20).fill('floor'));
    // Pad A at (col=2, row=3) -> world (5, 0, 7); Pad B (2x2 cluster) around (col=15, row=14)
    floor.tiles[3][2] = 'teleporter_pad';
    floor.tiles[14][15] = 'teleporter_pad';
    floor.tiles[14][16] = 'teleporter_pad';
    floor.tiles[15][15] = 'teleporter_pad';
    floor.tiles[15][16] = 'teleporter_pad';

    const ctrl = new PlayerController();
    ctrl.init('arcanist', floor.gridToWorld(2, 3), createMockHeroRig());

    // Step 1: Warps immediately from Pad A -> Pad B
    ctrl.update(1 / 60, floor, false);
    const padBGrid = floor.worldToGrid(ctrl.state.position);
    expect(padBGrid.col).toBeGreaterThanOrEqual(15);
    expect(padBGrid.row).toBeGreaterThanOrEqual(14);

    // Step 2: Standing on Pad B during the 2.5s cooldown (e.g. 2.0s elapsed) does NOT bounce back
    for (let i = 0; i < 20; i++) {
      ctrl.update(0.1, floor, false);
    }
    expect(floor.worldToGrid(ctrl.state.position).col).toBeGreaterThanOrEqual(15);

    // Step 3: After >2.5s total elapsed (+0.6s -> 2.6s), cooldown expires and warps back to Pad A (2, 3)
    for (let i = 0; i < 6; i++) {
      ctrl.update(0.1, floor, false);
    }
    expect(floor.worldToGrid(ctrl.state.position)).toEqual({ col: 2, row: 3 });

    ctrl.dispose();
  });
});
