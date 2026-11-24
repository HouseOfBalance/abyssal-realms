import * as THREE from 'three';
import type {
  DamagePacket,
  DamageType,
  ICombatEngine,
  PlayerRuntimeState,
  StatusEffectType,
  Vec3,
  VfxEffectType,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { getDefaultStatusDuration } from './bossData';

export interface BossArenaHazard {
  id: string;
  position: Vec3;
  radius: number;
  damagePerTick: number;
  damageType: DamageType;
  appliesStatus?: StatusEffectType;
  sourceId: string;
  ageSec: number;
  warmupSec: number;
  durationSec: number;
  tickTimerSec: number;
  group: THREE.Group;
  poolMat: THREE.MeshBasicMaterial;
  rimMat: THREE.MeshBasicMaterial;
  pylonMesh: THREE.Mesh;
  ownedGeometries: THREE.BufferGeometry[];
  ownedMaterials: THREE.Material[];
}

interface BossEnrageVisual {
  group: THREE.Group;
  shards: THREE.Mesh[];
  ringMat: THREE.MeshBasicMaterial;
  ownedGeos: THREE.BufferGeometry[];
  ownedMats: THREE.Material[];
  time: number;
}

function getHazardTickVfx(damageType: DamageType): VfxEffectType {
  switch (damageType) {
    case 'fire':
      return 'fire_explosion';
    case 'ice':
      return 'frost_nova';
    case 'lightning':
      return 'lightning_strike';
    case 'void':
      return 'void_implosion';
    case 'physical':
      return 'blood_burst';
    case 'poison':
    default:
      return 'poison_cloud';
  }
}

export class BossArenaHazardManager {
  private readonly root = new THREE.Group();
  private hazards: BossArenaHazard[] = [];
  private enrageVisuals = new Map<string, BossEnrageVisual>();
  private nextId = 1;

  constructor() {
    this.root.name = 'BossArenaHazards';
  }

  attachToScene(scene: THREE.Scene): void {
    if (this.root.parent !== scene) {
      scene.add(this.root);
    }
  }

  spawnHazard(params: {
    position: Vec3;
    radius: number;
    damagePerTick: number;
    damageType: DamageType;
    appliesStatus?: StatusEffectType;
    colorHex: number;
    sourceId: string;
    durationSec?: number;
  }): void {
    const ownedGeometries: THREE.BufferGeometry[] = [];
    const ownedMaterials: THREE.Material[] = [];

    const group = new THREE.Group();
    group.position.set(params.position.x, 0.035, params.position.z);

    const poolGeo = new THREE.CircleGeometry(params.radius, 36);
    poolGeo.rotateX(-Math.PI * 0.5);
    const poolMat = new THREE.MeshBasicMaterial({
      color: params.colorHex,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const poolMesh = new THREE.Mesh(poolGeo, poolMat);
    poolMesh.renderOrder = 8;

    const rimGeo = new THREE.RingGeometry(
      Math.max(0.2, params.radius - 0.14),
      params.radius,
      40,
    );
    rimGeo.rotateX(-Math.PI * 0.5);
    const rimMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(params.colorHex).lerp(new THREE.Color(0xffd43b), 0.35).getHex(),
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.y = 0.01;
    rimMesh.renderOrder = 9;

    const innerRimGeo = new THREE.RingGeometry(
      params.radius * 0.44,
      params.radius * 0.5,
      28,
    );
    innerRimGeo.rotateX(-Math.PI * 0.5);
    const innerRimMesh = new THREE.Mesh(innerRimGeo, rimMat);
    innerRimMesh.position.y = 0.01;
    innerRimMesh.renderOrder = 9;

    const pylonGeo = new THREE.OctahedronGeometry(0.32, 0);
    const pylonMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(params.colorHex).lerp(new THREE.Color(0xffffff), 0.3).getHex(),
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
    });
    const pylonMesh = new THREE.Mesh(pylonGeo, pylonMat);
    pylonMesh.position.y = 0.9;
    pylonMesh.scale.set(0.85, 1.8, 0.85);

    ownedGeometries.push(poolGeo, rimGeo, innerRimGeo, pylonGeo);
    ownedMaterials.push(poolMat, rimMat, pylonMat);

    group.add(poolMesh, rimMesh, innerRimMesh, pylonMesh);
    this.root.add(group);

    this.hazards.push({
      id: `boss_hazard_${this.nextId++}`,
      position: { ...params.position },
      radius: params.radius,
      damagePerTick: params.damagePerTick,
      damageType: params.damageType,
      appliesStatus: params.appliesStatus,
      sourceId: params.sourceId,
      ageSec: 0,
      warmupSec: 1.15,
      durationSec: params.durationSec ?? 22,
      tickTimerSec: 0,
      group,
      poolMat,
      rimMat,
      pylonMesh,
      ownedGeometries,
      ownedMaterials,
    });
  }

  activateEnrageAura(sourceId: string, themeColorHex: number): void {
    this.removeEnrageAura(sourceId);

    const group = new THREE.Group();
    group.name = `BossEnrageAura_${sourceId}`;

    const outerRingGeo = new THREE.RingGeometry(1.65, 2.05, 40);
    outerRingGeo.rotateX(-Math.PI * 0.5);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff2233).lerp(new THREE.Color(themeColorHex), 0.35).getHex(),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, ringMat);
    outerRing.position.y = 0.06;

    const shardGeo = new THREE.OctahedronGeometry(0.24, 0);
    const shardMat = new THREE.MeshBasicMaterial({
      color: 0xffc048,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });

    const shards: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const shard = new THREE.Mesh(shardGeo, shardMat);
      shard.scale.set(0.7, 1.75, 0.7);
      group.add(shard);
      shards.push(shard);
    }

    group.add(outerRing);
    this.root.add(group);

    this.enrageVisuals.set(sourceId, {
      group,
      shards,
      ringMat,
      ownedGeos: [outerRingGeo, shardGeo],
      ownedMats: [ringMat, shardMat],
      time: 0,
    });
  }

  removeEnrageAura(sourceId: string): void {
    const existing = this.enrageVisuals.get(sourceId);
    if (!existing) return;
    this.root.remove(existing.group);
    for (const g of existing.ownedGeos) g.dispose();
    for (const m of existing.ownedMats) m.dispose();
    this.enrageVisuals.delete(sourceId);
  }

  update(
    dt: number,
    bossPositionsById: ReadonlyMap<string, Vec3>,
    player: PlayerRuntimeState,
    combat: ICombatEngine,
  ): void {
    // Update persistent arena hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.ageSec += dt;

      if (h.ageSec >= h.durationSec) {
        this.disposeHazard(h);
        this.hazards.splice(i, 1);
        continue;
      }

      const fadeOut = clamp((h.durationSec - h.ageSec) / 1.2, 0, 1);
      const armed = h.ageSec >= h.warmupSec;
      const pulse = 0.5 + 0.5 * Math.sin(h.ageSec * (armed ? 7.5 : 14));

      h.poolMat.opacity = (armed ? 0.24 + pulse * 0.14 : 0.1 + pulse * 0.1) * fadeOut;
      h.rimMat.opacity = (armed ? 0.65 + pulse * 0.28 : 0.4 + pulse * 0.3) * fadeOut;
      h.pylonMesh.rotation.y += dt * 2.6;
      h.pylonMesh.position.y = 0.85 + Math.sin(h.ageSec * 3.8) * 0.18;

      if (armed && player.alive) {
        h.tickTimerSec -= dt;
        if (h.tickTimerSec <= 0 && distXZ(player.position, h.position) <= h.radius) {
          h.tickTimerSec = 0.95;
          const packet: DamagePacket = {
            sourceId: h.sourceId,
            targetId: player.id,
            baseAmount: h.damagePerTick,
            damageType: h.damageType,
            critChance: 0,
            critMultiplier: 1.5,
            appliesStatus: h.appliesStatus
              ? {
                  type: h.appliesStatus,
                  chance: 0.85,
                  durationSec: getDefaultStatusDuration(h.appliesStatus),
                  potency: Math.max(3, Math.round(h.damagePerTick * 0.25)),
                }
              : undefined,
          };
          combat.applyDamageToPlayer(player, packet);
          eventBus.emit('vfx:request', {
            type: getHazardTickVfx(h.damageType),
            position: { x: player.position.x, y: 0.4, z: player.position.z },
            scale: 0.55,
          });
        }
      }
    }

    // Update Phase 3 Boss Enrage Auras for all enraged bosses
    for (const [sourceId, vis] of this.enrageVisuals.entries()) {
      const bossPos = bossPositionsById.get(sourceId);
      if (!bossPos) continue;

      vis.time += dt;
      vis.group.position.set(bossPos.x, bossPos.y, bossPos.z);
      vis.group.rotation.y += dt * 1.8;

      const ringPulse = 0.72 + 0.25 * Math.sin(vis.time * 9);
      vis.ringMat.opacity = ringPulse;

      const orbitR = 1.95;
      for (let i = 0; i < vis.shards.length; i++) {
        const angle = vis.time * 2.8 + (i * Math.PI * 2) / vis.shards.length;
        const shard = vis.shards[i];
        shard.position.set(
          Math.cos(angle) * orbitR,
          1.35 + Math.sin(vis.time * 4.5 + i) * 0.28,
          Math.sin(angle) * orbitR,
        );
        shard.rotation.y = -angle;
        shard.rotation.z = Math.sin(vis.time * 5 + i) * 0.25;
      }
    }
  }

  getActiveHazardCount(sourceId?: string): number {
    if (!sourceId) return this.hazards.length;
    return this.hazards.filter((h) => h.sourceId === sourceId).length;
  }

  clearBySource(sourceId: string): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      if (this.hazards[i].sourceId === sourceId) {
        this.disposeHazard(this.hazards[i]);
        this.hazards.splice(i, 1);
      }
    }
    this.removeEnrageAura(sourceId);
  }

  clearEnrageAuras(): void {
    for (const id of [...this.enrageVisuals.keys()]) {
      this.removeEnrageAura(id);
    }
  }

  clear(): void {
    for (const h of this.hazards) {
      this.disposeHazard(h);
    }
    this.hazards = [];
    this.clearEnrageAuras();
  }

  dispose(): void {
    this.clear();
    if (this.root.parent) {
      this.root.parent.remove(this.root);
    }
  }

  private disposeHazard(h: BossArenaHazard): void {
    this.root.remove(h.group);
    for (const g of h.ownedGeometries) g.dispose();
    for (const m of h.ownedMaterials) m.dispose();
  }
}
