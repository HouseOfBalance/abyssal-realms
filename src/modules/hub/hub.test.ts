import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type {
  IMaterialLibrary,
  InteractableType,
  MaterialKey,
} from '../../contracts/types';
import { distXZ } from '../../core/Constants';
import { createSanctuaryHub, SanctuaryHub } from './index';

function createMockMaterialLibrary(): IMaterialLibrary {
  const cache = new Map<MaterialKey, THREE.MeshStandardMaterial>();
  const tex = new THREE.Texture();

  const get = (key: MaterialKey): THREE.MeshStandardMaterial => {
    let mat = cache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ name: key, color: 0x888888 });
      cache.set(key, mat);
    }
    return mat;
  };

  return {
    get,
    clone(key: MaterialKey): THREE.MeshStandardMaterial {
      return get(key).clone();
    },
    getTexture(_key: MaterialKey): THREE.Texture {
      return tex;
    },
    dispose(): void {
      for (const m of cache.values()) {
        m.dispose();
      }
      cache.clear();
      tex.dispose();
    },
  };
}

describe('SanctuaryHub — Bastion of the Fallen (Map 0)', () => {
  it('generates symmetric Map 0 Sanctuary floor with all 8 interactables and full A* pathfinding', () => {
    const hub = createSanctuaryHub();
    const floor = hub.generateSanctuaryFloor();

    expect(floor.floorNumber).toBe(0);
    expect(floor.biome).toBe('sanctuary');
    expect(floor.cols).toBe(44);
    expect(floor.rows).toBe(44);
    expect(floor.tileSize).toBe(2.0);
    expect(floor.rooms.length).toBeGreaterThanOrEqual(5);
    expect(floor.rooms.every((r) => r.cleared)).toBe(true);

    // Verify bilateral East-West symmetry across X = 0
    for (let r = 0; r < floor.rows; r++) {
      for (let c = 0; c < floor.cols; c++) {
        expect(floor.tiles[r][c]).toBe(floor.tiles[r][floor.cols - 1 - c]);
      }
    }

    // Verify all required Sanctuary interactables exist
    const requiredTypes: InteractableType[] = [
      'waypoint_map',
      'blacksmith_anvil',
      'stash_chest',
      'gambler_npc',
      'companion_shrine',
      'lore_tome',
      'training_dummy',
      'portal_next_floor',
    ];
    for (const type of requiredTypes) {
      const prop = floor.interactables.find((p) => p.type === type);
      expect(prop, `Missing Sanctuary interactable: ${type}`).toBeDefined();
      expect(floor.isWalkableWorld(prop!.position.x, prop!.position.z, 0.4)).toBe(true);
    }

    // Waypoint sun-dial sits at center plaza (0, 0, 0)
    const waypoint = floor.interactables.find((p) => p.type === 'waypoint_map')!;
    expect(waypoint.position.x).toBe(0);
    expect(waypoint.position.z).toBe(0);

    // Player spawn is walkable, outer void cliff is not walkable
    expect(floor.isWalkableWorld(floor.playerSpawn.x, floor.playerSpawn.z, 0.5)).toBe(true);
    expect(floor.isWalkableWorld(-43, -43, 0.2)).toBe(false);

    // Full A* pathfinding reaches every wing & interactable from playerSpawn
    for (const prop of floor.interactables) {
      const path = floor.findPath(floor.playerSpawn, prop.position);
      expect(path.length, `Expected non-empty path to ${prop.type}`).toBeGreaterThan(0);
      const last = path[path.length - 1];
      expect(distXZ(last, prop.position)).toBeLessThanOrEqual(0.5);
      for (const wp of path) {
        expect(floor.isWalkableWorld(wp.x, wp.z, 0.2)).toBe(true);
      }
    }

    // Verify worldToGrid / gridToWorld round-trip & revealRadius
    const cornerGrid = { col: 0, row: 0 };
    expect(floor.explored[0][0]).toBe(false);
    const cornerWorld = floor.gridToWorld(cornerGrid.col, cornerGrid.row);
    expect(floor.worldToGrid(cornerWorld)).toEqual(cornerGrid);
    floor.revealRadius(cornerWorld, 3.0);
    expect(floor.explored[0][0]).toBe(true);
  });

  it('builds custom 3D Sanctuary landmarks and violently tilts/spins/flashes the Armored Training Dummy on hit', () => {
    const hub = new SanctuaryHub();
    const floor = hub.generateSanctuaryFloor();
    const scene = new THREE.Scene();
    const materials = createMockMaterialLibrary();

    hub.populateHubScene(floor, scene, materials);

    const root = scene.getObjectByName('SanctuaryHubRoot');
    expect(root).toBeDefined();

    // Check all custom 3D Sanctuary landmarks exist in the scene graph
    const expectedLandmarks = [
      'Landmark_AstralWaypointSundial',
      'Landmark_BlacksmithPavilion',
      'Landmark_GamblerTentAndBloodAltar',
      'CrimsonBloodAltarFountain',
      'Landmark_GildedStashVault',
      'Landmark_CompanionMenagerieShrine',
      'Landmark_ValorSparringRing',
      'SanctuaryTrainingDummyRig',
    ];
    for (const name of expectedLandmarks) {
      expect(scene.getObjectByName(name), `Expected 3D landmark ${name}`).toBeDefined();
    }

    const rig = hub.getTrainingDummyRig()!;
    expect(rig).not.toBeNull();
    expect(rig.getMotionSnapshot().tiltMagnitudeRad).toBe(0);
    expect(rig.getMotionSnapshot().flashing).toBe(false);

    // Strike the dummy with a heavy critical hit and verify violent spring tilt, spin & flash
    hub.update(0.016, 0.016, { x: 0, y: 0, z: 25.5 });
    hub.recordDummyDamage(1850, true);

    const snapOnHit = rig.getMotionSnapshot();
    expect(snapOnHit.tiltMagnitudeRad).toBeGreaterThan(0.15);
    expect(Math.abs(snapOnHit.spinVelocityRadSec)).toBeGreaterThan(5);
    expect(snapOnHit.flashing).toBe(true);

    // Advance physics and confirm spring oscillation + flash decay settle cleanly
    for (let i = 0; i < 180; i++) {
      hub.update(1 / 60, (i + 2) / 60, { x: 0, y: 0, z: 25.5 });
    }
    const snapSettled = rig.getMotionSnapshot();
    expect(snapSettled.flashing).toBe(false);
    expect(snapSettled.tiltMagnitudeRad).toBeLessThan(0.02);

    hub.dispose();
    expect(scene.getObjectByName('SanctuaryHubRoot')).toBeUndefined();
    expect(hub.getTrainingDummyEntity()).toBeNull();
    materials.dispose();
  });

  it('maintains an immortal Training Dummy entity and computes 5s rolling DPS with 5s idle auto-decay', () => {
    const hub = createSanctuaryHub();
    const floor = hub.generateSanctuaryFloor();
    const dummy = hub.getTrainingDummyEntity()!;
    const dummyProp = floor.interactables.find((p) => p.type === 'training_dummy')!;

    expect(dummy).not.toBeNull();
    expect(dummy.position.x).toBe(dummyProp.position.x);
    expect(dummy.position.z).toBe(dummyProp.position.z);
    expect(dummy.maxHp).toBeGreaterThanOrEqual(1_000_000);
    expect(dummy.alive).toBe(true);

    // Attempt lethal damage & knockback displacement — dummy must never die or drift off post
    dummy.hp = 0;
    dummy.alive = false;
    dummy.position.x += 4.5;
    expect(dummy.alive).toBe(true);
    expect(dummy.hp).toBeGreaterThan(0);

    hub.update(0.1, 0.1, floor.playerSpawn);
    expect(dummy.position.x).toBe(dummyProp.position.x);
    expect(dummy.hp).toBe(dummy.maxHp);

    // Initial idle state
    expect(hub.getDummyMetrics()).toEqual({
      active: false,
      rollingDps: 0,
      peakHit: 0,
      totalDamage: 0,
      hitsCount: 0,
    });

    // t = 0.1s: Deal 500 normal + 1500 crit = 2000 total -> 2000 / 5s = 400 DPS
    hub.recordDummyDamage(500, false);
    hub.recordDummyDamage(1500, true);
    const m1 = hub.getDummyMetrics();
    expect(m1.active).toBe(true);
    expect(m1.hitsCount).toBe(2);
    expect(m1.totalDamage).toBe(2000);
    expect(m1.peakHit).toBe(1500);
    expect(m1.rollingDps).toBeCloseTo(400, 1);

    // Advance 3.0s (t = 3.1s) and deal another 1000 damage -> 3000 in 5s window = 600 DPS
    hub.update(3.0, 3.1, floor.playerSpawn);
    hub.recordDummyDamage(1000, false);
    const m2 = hub.getDummyMetrics();
    expect(m2.active).toBe(true);
    expect(m2.hitsCount).toBe(3);
    expect(m2.totalDamage).toBe(3000);
    expect(m2.peakHit).toBe(1500);
    expect(m2.rollingDps).toBeCloseTo(600, 1);

    // Advance 2.5s (t = 5.6s): first two hits (at t=0.1s) aged past 5s window; 1000 hit remains -> 200 DPS
    hub.update(2.5, 5.6, floor.playerSpawn);
    const m3 = hub.getDummyMetrics();
    expect(m3.active).toBe(true);
    expect(m3.rollingDps).toBeCloseTo(200, 1);
    expect(m3.totalDamage).toBe(3000);

    // Advance another 3.0s (5.5s since last hit -> >= 5s idle): auto-decays to inactive & 0 DPS
    hub.update(3.0, 8.6, floor.playerSpawn);
    const m4 = hub.getDummyMetrics();
    expect(m4.active).toBe(false);
    expect(m4.rollingDps).toBe(0);

    // Explicit reset clears cumulative session stats
    hub.resetDummyMetrics();
    expect(hub.getDummyMetrics()).toEqual({
      active: false,
      rollingDps: 0,
      peakHit: 0,
      totalDamage: 0,
      hitsCount: 0,
    });
  });
});
