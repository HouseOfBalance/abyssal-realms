import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type {
  BossId,
  EliteAffix,
  EnemyAnimState,
  EnemyArchetypeId,
  IMaterialLibrary,
  MaterialKey,
} from '../../contracts/types';
import { createEnemyMeshFactory, EnemyMeshFactory } from './index';

function createMockMaterials(withUpstreamShaderHook = false): IMaterialLibrary {
  const cache = new Map<MaterialKey, THREE.MeshStandardMaterial>();
  const get = (key: MaterialKey): THREE.MeshStandardMaterial => {
    let m = cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x888888 });
      if (withUpstreamShaderHook) {
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uUpstreamMaterialTest = { value: 42 };
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            '#include <common>\nuniform float uUpstreamMaterialTest;\n',
          );
        };
        m.customProgramCacheKey = () => 'upstream_proc_mat_v1';
      }
      cache.set(key, m);
    }
    return m;
  };
  return {
    get,
    clone: (key: MaterialKey) => {
      const base = get(key);
      const c = base.clone();
      c.onBeforeCompile = base.onBeforeCompile;
      c.customProgramCacheKey = base.customProgramCacheKey;
      return c;
    },
    getTexture: () => new THREE.Texture(),
    dispose: () => {
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
}

function assertNoNaNTransforms(root: THREE.Object3D): void {
  let valid = true;
  root.traverse((obj) => {
    if (
      !Number.isFinite(obj.position.x) ||
      !Number.isFinite(obj.position.y) ||
      !Number.isFinite(obj.position.z) ||
      !Number.isFinite(obj.rotation.x) ||
      !Number.isFinite(obj.rotation.y) ||
      !Number.isFinite(obj.rotation.z) ||
      !Number.isFinite(obj.scale.x) ||
      !Number.isFinite(obj.scale.y) ||
      !Number.isFinite(obj.scale.z)
    ) {
      valid = false;
    }
  });
  expect(valid).toBe(true);
}

describe('EnemyMeshFactory', () => {
  const archetypes: EnemyArchetypeId[] = [
    'skeleton_warrior',
    'bone_archer',
    'dark_cultist',
    'plague_spider',
    'abyssal_golem',
    'void_assassin',
    'hellhound',
    'lich_summoner',
    'frost_revenant',
    'ice_wraith',
    'clockwork_automaton',
    'astral_weaver',
    'treasure_goblin',
    'chest_mimic',
  ];

  const bosses: BossId[] = [
    'bone_colossus',
    'arachne_broodmother',
    'ignis_forgemaster',
    'malakor_void_emperor',
    'valkyria_rime_seraph',
    'chronos_time_architect',
    'the_butcher',
  ];

  const animStates: EnemyAnimState[] = [
    'idle',
    'walk',
    'windup',
    'attack',
    'cast',
    'hit',
    'death',
  ];

  const allAffixes: EliteAffix[] = [
    'vampiric',
    'molten',
    'frozen_pulse',
    'teleporter',
    'berserker',
    'arcane_enchanted',
  ];

  it('builds all 8 enemy archetypes and runs all 7 animation states without NaN', () => {
    const factory = createEnemyMeshFactory();
    expect(factory).toBeInstanceOf(EnemyMeshFactory);
    const materials = createMockMaterials();

    for (const archetype of archetypes) {
      const handle = factory.createEnemyMesh(archetype, false, materials);
      let meshCount = 0;
      handle.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshCount++;
      });
      expect(meshCount).toBeGreaterThan(8);

      for (const state of animStates) {
        handle.playAnim(state, 1.1);
        for (let step = 0; step < 6; step++) {
          handle.update(0.12);
          assertNoNaNTransforms(handle.root);
        }
      }

      const modelRoot = handle.root.getObjectByName('model_root')!;
      expect(modelRoot.position.y).toBeLessThan(0);

      handle.dispose();
    }

    materials.dispose();
  });

  it('builds all 4 monumental bosses at 2.5x-3.5x scale with crowns, wings, tendrils & weakpoints', () => {
    const factory = createEnemyMeshFactory();
    const materials = createMockMaterials();

    for (const bossId of bosses) {
      const handle = factory.createBossMesh(bossId, materials);
      const modelRoot = handle.root.getObjectByName('model_root')!;
      expect(modelRoot.scale.x).toBeGreaterThanOrEqual(2.5);
      expect(modelRoot.scale.x).toBeLessThanOrEqual(3.5);

      let hasWing = false;
      let hasTendril = false;
      let hasCrown = false;
      handle.root.traverse((obj) => {
        if (obj.name.startsWith('boss_wing_')) hasWing = true;
        if (obj.name.startsWith('tendril_')) hasTendril = true;
        if (obj.name.includes('crown')) hasCrown = true;
      });
      expect(hasWing).toBe(true);
      expect(hasTendril).toBe(true);
      expect(hasCrown).toBe(true);

      for (const state of animStates) {
        handle.playAnim(state, 1.0);
        handle.update(0.2);
        assertNoNaNTransforms(handle.root);
      }
      handle.dispose();
    }

    materials.dispose();
  });

  it('applies elite aura ring & orbiting shards and supports flashHit & clean disposal', () => {
    const factory = createEnemyMeshFactory();
    const materials = createMockMaterials();
    const scene = new THREE.Scene();

    const eliteHandle = factory.createEnemyMesh('skeleton_warrior', true, materials);
    scene.add(eliteHandle.root);

    eliteHandle.setEliteVisuals(allAffixes);
    const eliteRoot = eliteHandle.root.getObjectByName('elite_visuals_root')!;
    expect(eliteRoot.children.length).toBeGreaterThan(4);

    eliteHandle.flashHit(0xff3333);
    eliteHandle.update(0.05);
    assertNoNaNTransforms(eliteHandle.root);

    eliteHandle.setEliteVisuals(['frozen_pulse', 'arcane_enchanted']);
    eliteHandle.update(0.1);
    assertNoNaNTransforms(eliteHandle.root);

    eliteHandle.dispose();
    expect(eliteHandle.root.parent).toBeNull();

    eliteHandle.playAnim('walk');
    eliteHandle.flashHit();
    eliteHandle.update(0.016);

    materials.dispose();
  });

  it('injects custom GLSL edge-burn dissolve shader (molten orange & void violet) and chains upstream hooks', () => {
    const factory = createEnemyMeshFactory();
    const materials = createMockMaterials(true);

    const moltenEnemy = factory.createEnemyMesh('hellhound', false, materials);
    const voidBoss = factory.createBossMesh('malakor_void_emperor', materials);

    const inspectFirstMeshMaterial = (root: THREE.Object3D): THREE.MeshStandardMaterial => {
      let found: THREE.MeshStandardMaterial | null = null;
      root.traverse((obj) => {
        if (!found && (obj as THREE.Mesh).isMesh) {
          const mat = (obj as THREE.Mesh).material;
          if (mat instanceof THREE.MeshStandardMaterial) {
            found = mat;
          }
        }
      });
      if (!found) throw new Error('Expected MeshStandardMaterial on enemy rig');
      return found;
    };

    const moltenMat = inspectFirstMeshMaterial(moltenEnemy.root);
    const voidMat = inspectFirstMeshMaterial(voidBoss.root);

    expect(moltenMat.customProgramCacheKey()).toContain('upstream_proc_mat_v1|ar_enemy_dissolve_v1');

    const compileMockShader = (mat: THREE.MeshStandardMaterial) => {
      const shader = {
        uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      } as unknown as THREE.WebGLProgramParametersWithUniforms;
      mat.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
      return shader;
    };

    const moltenShader = compileMockShader(moltenMat);
    const voidShader = compileMockShader(voidMat);

    // Upstream hook preserved alongside custom dissolve GLSL
    expect(moltenShader.fragmentShader).toContain('uUpstreamMaterialTest');
    expect(moltenShader.vertexShader).toContain('vEnemyDissolvePos');
    expect(moltenShader.fragmentShader).toContain('arDissolveFbm');
    expect(moltenShader.fragmentShader).toContain('discard;');

    // Distinct molten-orange vs void-violet ember border palettes
    const moltenOuter = moltenShader.uniforms.uEnemyDissolveEdgeOuter.value as THREE.Color;
    const voidOuter = voidShader.uniforms.uEnemyDissolveEdgeOuter.value as THREE.Color;
    expect(moltenOuter.getHex()).toBe(0xff4d00);
    expect(voidOuter.getHex()).toBe(0xae3ec9);

    // Alive -> dissolve progress is 0; Death -> ramps smoothly to 1.0
    expect(moltenShader.uniforms.uEnemyDissolveProgress.value).toBe(0);
    moltenEnemy.playAnim('death');
    for (let i = 0; i < 7; i++) moltenEnemy.update(0.1);
    const midDissolve = moltenShader.uniforms.uEnemyDissolveProgress.value as number;
    expect(midDissolve).toBeGreaterThan(0.25);
    expect(midDissolve).toBeLessThan(1.0);

    for (let i = 0; i < 8; i++) moltenEnemy.update(0.1);
    expect(moltenShader.uniforms.uEnemyDissolveProgress.value).toBeCloseTo(1.0, 3);

    moltenEnemy.dispose();
    voidBoss.dispose();
    materials.dispose();
  });

  it('applies punchy volume-preserving hit squash-and-stretch impulse on flashHit', () => {
    const factory = createEnemyMeshFactory();
    const materials = createMockMaterials();
    const handle = factory.createEnemyMesh('abyssal_golem', false, materials);
    const modelRoot = handle.root.getObjectByName('model_root')!;
    const baseScale = modelRoot.scale.y;

    // Immediate frame-0 squash: compressed Y, expanded XZ
    handle.flashHit(0xffffff);
    expect(modelRoot.scale.y).toBeLessThan(baseScale * 0.88);
    expect(modelRoot.scale.x).toBeGreaterThan(baseScale * 1.06);

    // Elastic rebound stretch phase (~0.105s in)
    handle.update(0.055);
    handle.update(0.05);
    expect(modelRoot.scale.y).toBeGreaterThan(baseScale * 1.03);
    expect(modelRoot.scale.x).toBeLessThan(baseScale * 0.99);

    // Smoothly settles back to exact baseScale after impulse completes (~0.24s)
    handle.update(0.08);
    handle.update(0.08);
    expect(modelRoot.scale.y).toBeCloseTo(baseScale, 4);
    expect(modelRoot.scale.x).toBeCloseTo(baseScale, 4);

    handle.dispose();
    materials.dispose();
  });

  it('verifies Phase 3 expansion landmarks (6-winged Valkyria, Chronos gyroscopes, Butcher cleaver/hook, Goblin sack, Mimic tongue & frost dissolve)', () => {
    const factory = createEnemyMeshFactory();
    const materials = createMockMaterials();

    const valkyria = factory.createBossMesh('valkyria_rime_seraph', materials);
    let wingCount = 0;
    let firstValkyriaMat: THREE.MeshStandardMaterial | null = null;
    valkyria.root.traverse((obj) => {
      if (obj.name.startsWith('boss_wing_')) wingCount++;
      if (!firstValkyriaMat && (obj as THREE.Mesh).isMesh) {
        const m = (obj as THREE.Mesh).material;
        if (m instanceof THREE.MeshStandardMaterial) firstValkyriaMat = m;
      }
    });
    expect(wingCount).toBe(6);

    const frostShader = {
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    firstValkyriaMat!.onBeforeCompile(frostShader, null as unknown as THREE.WebGLRenderer);
    expect((frostShader.uniforms.uEnemyDissolveEdgeOuter.value as THREE.Color).getHex()).toBe(
      0x22b8cf,
    );

    const chronos = factory.createBossMesh('chronos_time_architect', materials);
    const gyro = chronos.root.getObjectByName('chronos_gyro_x')!;
    expect(gyro).toBeTruthy();
    chronos.update(0.25);
    expect(gyro.rotation.y).toBeGreaterThan(0);

    const butcher = factory.createBossMesh('the_butcher', materials);
    expect(butcher.root.getObjectByName('butcher_cleaver')).toBeTruthy();
    expect(butcher.root.getObjectByName('butcher_meathook')).toBeTruthy();

    const goblin = factory.createEnemyMesh('treasure_goblin', false, materials);
    expect(goblin.root.getObjectByName('goblin_loot_sack')).toBeTruthy();

    const mimic = factory.createEnemyMesh('chest_mimic', false, materials);
    expect(mimic.root.getObjectByName('mimic_tongue_0')).toBeTruthy();
    expect(mimic.root.getObjectByName('mimic_lower_jaw')).toBeTruthy();

    valkyria.dispose();
    chronos.dispose();
    butcher.dispose();
    goblin.dispose();
    mimic.dispose();
    materials.dispose();
  });
});
