import * as THREE from 'three';
import type {
  BossId,
  DamagePacket,
  DamageType,
  DungeonFloorData,
  DungeonRoom,
  EnemyEntity,
  IBossDirector,
  ICombatEngine,
  IEnemyAISystem,
  IEnemyMeshFactory,
  IMaterialLibrary,
  PlayerRuntimeState,
  ProjectileSpec,
  SfxId,
  TelegraphZone,
  Vec3,
  VfxEffectType,
} from '../../contracts/types';
import { clamp, DAMAGE_TYPE_COLORS, distXZ, SeededRng } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { BossArenaHazardManager } from './arenaHazards';
import {
  BOSS_BLUEPRINTS,
  type BossAttackDef,
  type BossBlueprint,
  computeColosseumBossStats,
  computeScaledBossStats,
  getDefaultStatusDuration,
  selectBossIdForFloor,
  selectColosseumBossPair,
} from './bossData';
import { isPointInsideTelegraph, TelegraphRenderer } from './telegraphRenderer';

type BossActionState = 'pursue' | 'windup' | 'recover';

interface ScheduledBossAction {
  sourceId: string;
  delaySec: number;
  run: (
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
  ) => void;
}

interface BossRuntimeInstance {
  entity: EnemyEntity;
  blueprint: BossBlueprint;
  engaged: boolean;
  introTimerSec: number;
  phase: 1 | 2 | 3;
  phase2Triggered: boolean;
  phase3Triggered: boolean;
  forceUltimateNext: boolean;
  defeatTriggered: boolean;
  deathAnimSec: number;
  actionState: BossActionState;
  activeAttack: BossAttackDef | null;
  windupRemainingSec: number;
  recoverRemainingSec: number;
  globalActionCooldownSec: number;
  hazardRefreshTimerSec: number;
  clockHandAngleRad: number;
  attackCooldowns: Map<string, number>;
  isColosseumTwin: boolean;
}

export class BossDirector implements IBossDirector {
  private scene: THREE.Scene | null = null;
  private meshFactory: IEnemyMeshFactory | null = null;
  private materials: IMaterialLibrary | null = null;

  private readonly bossGroup = new THREE.Group();
  private readonly telegraphs = new TelegraphRenderer();
  private readonly hazardManager = new BossArenaHazardManager();

  private instances: BossRuntimeInstance[] = [];
  private scheduledActions: ScheduledBossAction[] = [];
  private bossRoom: DungeonRoom | null = null;
  private rng = new SeededRng(9001);
  private bossPositionsScratch = new Map<string, Vec3>();

  private unsubKilled: (() => void) | null = null;
  private unsubDamaged: (() => void) | null = null;

  constructor() {
    this.bossGroup.name = 'BossDirectorEntities';
  }

  init(scene: THREE.Scene): void {
    this.scene = scene;
    if (this.bossGroup.parent !== scene) {
      scene.add(this.bossGroup);
    }
    this.telegraphs.attachToScene(scene);
    this.hazardManager.attachToScene(scene);
    this.ensureSubscriptions();
  }

  spawnFloorBoss(
    floor: DungeonFloorData,
    meshFactory: IEnemyMeshFactory,
    materials: IMaterialLibrary,
  ): EnemyEntity {
    this.clear();
    this.ensureSubscriptions();

    this.meshFactory = meshFactory;
    this.materials = materials;
    this.rng = new SeededRng(
      (((floor.seed ?? 1337) >>> 0) ^ 0x9e3779b9 ^ Math.imul(floor.floorNumber, 7919)) >>> 0,
    );

    // Handle peaceful Sanctuary Hub or initial Colosseum arena load gracefully (no standard floor boss)
    if (
      floor.biome === 'sanctuary' ||
      floor.biome === 'colosseum' ||
      floor.floorNumber <= 0
    ) {
      const inertPos: Vec3 = {
        x: floor.bossSpawn?.x ?? 0,
        y: 0,
        z: floor.bossSpawn?.z ?? 0,
      };
      return {
        id: `inert_boss_${floor.biome}_${floor.floorNumber}`,
        name: 'Dormant Guardian',
        archetype: 'bone_colossus',
        isBoss: true,
        isElite: false,
        affixes: [],
        position: inertPos,
        velocity: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        radius: 1.2,
        hp: 0,
        maxHp: 1,
        armor: 0,
        moveSpeed: 0,
        attackDamage: 0,
        damageType: 'physical',
        attackRange: 0,
        attackCooldownSec: 99,
        xpReward: 0,
        lootTierBonus: 0,
        statuses: [],
        alive: false,
        roomId: 'none',
      };
    }

    const bossId: BossId = selectBossIdForFloor(floor.floorNumber, floor.biome);
    const blueprint = BOSS_BLUEPRINTS[bossId];
    const scaled = computeScaledBossStats(blueprint, floor.floorNumber);

    // Only match explicit 'boss' room so hub/special maps without one never misclassify 'spawn'
    const bossRoom = floor.rooms.find((r) => r.type === 'boss') ?? null;
    if (bossRoom) {
      bossRoom.cleared = false;
    }
    this.bossRoom = bossRoom;

    const rawSpawn = floor.bossSpawn ?? bossRoom?.centerWorld ?? floor.playerSpawn ?? {
      x: 0,
      y: 0,
      z: 0,
    };
    const spawnPos: Vec3 = {
      x: rawSpawn.x,
      y: 0,
      z: rawSpawn.z,
    };

    const inst = this.createBossInstance({
      id: `boss_${bossId}_floor_${floor.floorNumber}`,
      bossId,
      blueprint,
      stats: scaled,
      spawnPos,
      roomId: bossRoom?.id ?? 'boss_arena',
      engaged: false,
      introTimerSec: 0,
      initialCooldownSec: 0.55,
      isColosseumTwin: false,
      meshFactory,
      materials,
    });

    this.instances.push(inst);
    return inst.entity;
  }

  spawnColosseumBosses(
    floor: DungeonFloorData,
    waveNumber: number,
    meshFactory: IEnemyMeshFactory,
    materials: IMaterialLibrary,
  ): EnemyEntity[] {
    this.clear();
    this.ensureSubscriptions();

    this.meshFactory = meshFactory;
    this.materials = materials;
    this.bossRoom = floor.rooms.find((r) => r.type === 'boss') ?? floor.rooms[0] ?? null;
    this.rng = new SeededRng(
      (((floor.seed ?? 7777) >>> 0) ^ 0x85ebca6b ^ Math.imul(waveNumber, 12289)) >>> 0,
    );

    const pair = selectColosseumBossPair(waveNumber);
    const center =
      floor.bossSpawn ??
      this.bossRoom?.centerWorld ?? {
        x: floor.cols * floor.tileSize * 0.5,
        y: 0,
        z: floor.rows * floor.tileSize * 0.5,
      };

    const spawnedEntities: EnemyEntity[] = [];

    for (let i = 0; i < pair.length; i++) {
      const bossId = pair[i];
      const blueprint = BOSS_BLUEPRINTS[bossId];
      const scaled = computeColosseumBossStats(blueprint, waveNumber);

      const offsetSign = i === 0 ? -1 : 1;
      const desiredPos: Vec3 = {
        x: center.x + offsetSign * 4.6,
        y: 0,
        z: center.z + (i === 0 ? -1.2 : 1.2),
      };
      const spawnPos = this.computeWalkableTargetNear(desiredPos, floor, center);

      const inst = this.createBossInstance({
        id: `colosseum_boss_${waveNumber}_${i}_${bossId}`,
        bossId,
        blueprint,
        stats: scaled,
        spawnPos,
        roomId: this.bossRoom?.id ?? 'colosseum_arena',
        engaged: true,
        introTimerSec: 1.45,
        initialCooldownSec: i === 0 ? 0.5 : 1.4,
        isColosseumTwin: true,
        meshFactory,
        materials,
      });

      inst.entity.meshHandle?.playAnim('cast', 0.95);
      this.instances.push(inst);
      spawnedEntities.push(inst.entity);
    }

    const bpA = BOSS_BLUEPRINTS[pair[0]];
    const bpB = BOSS_BLUEPRINTS[pair[1]];

    eventBus.emit('boss:spawned', {
      bossId: pair[0],
      title: `${bpA.shortName} & ${bpB.shortName} — Twin Colosseum Champions`,
      position: { x: center.x, y: 0, z: center.z },
    });

    eventBus.emit('ui:banner', {
      title: `WAVE ${waveNumber} — TWIN PINNACLE SHOWDOWN`,
      subtitle: `${bpA.shortName} & ${bpB.shortName} Enter the Crimson Colosseum!`,
      tone: 'crimson',
    });

    eventBus.emit('sfx:request', {
      id: 'boss_roar',
      position: { x: center.x, y: 0, z: center.z },
    });

    eventBus.emit('camera:shake', { trauma: 0.65 });
    eventBus.emit('lighting:flash', {
      colorHex: bpA.themeColorHex,
      intensity: 1.7,
      durationSec: 0.5,
    });

    return spawnedEntities;
  }

  getActiveBossEntities(): EnemyEntity[] {
    return this.instances
      .filter((inst) => inst.engaged && inst.entity.alive && !inst.defeatTriggered)
      .map((inst) => inst.entity);
  }

  getActiveBoss(): {
    entity: EnemyEntity;
    bossId: BossId;
    title: string;
    phase: 1 | 2 | 3;
    maxPhases: 3;
    introActive: boolean;
  } | null {
    const livingEngaged = this.instances.filter(
      (inst) => inst.engaged && inst.entity.alive && !inst.defeatTriggered,
    );
    if (livingEngaged.length === 0) {
      return null;
    }

    // Focus the boss currently at lower HP ratio (or primary index 0 on tie)
    let primary = livingEngaged[0];
    for (let i = 1; i < livingEngaged.length; i++) {
      const candidate = livingEngaged[i];
      const candRatio = candidate.entity.hp / Math.max(1, candidate.entity.maxHp);
      const primRatio = primary.entity.hp / Math.max(1, primary.entity.maxHp);
      if (candRatio < primRatio - 0.01) {
        primary = candidate;
      }
    }

    const title =
      livingEngaged.length > 1
        ? `${primary.blueprint.subtitle} • Twin Showdown (${livingEngaged.length} Alive)`
        : primary.blueprint.subtitle;

    return {
      entity: primary.entity,
      bossId: primary.blueprint.bossId,
      title,
      phase: primary.phase,
      maxPhases: 3,
      introActive: primary.introTimerSec > 0,
    };
  }

  getActiveTelegraphs(): TelegraphZone[] {
    return this.telegraphs.getActiveZones();
  }

  update(
    dt: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
  ): void {
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    if (safeDt <= 0 || this.instances.length === 0) return;

    let anyEngagedAlive = false;
    this.bossPositionsScratch.clear();

    // 1. Check boss deaths & arena engagement across all boss instances
    for (const inst of this.instances) {
      const boss = inst.entity;
      if (boss.hp <= 0 || !boss.alive) {
        if (!inst.defeatTriggered) {
          this.triggerInstanceDefeated(inst);
        }
        inst.deathAnimSec += safeDt;
        boss.meshHandle?.update(safeDt);
        if (inst.deathAnimSec >= 2.8 && boss.meshHandle) {
          boss.meshHandle.root.visible = false;
        }
        continue;
      }

      if (!inst.engaged) {
        const damaged = boss.hp < boss.maxHp;
        if (damaged || (player.alive && this.isPlayerInBossArena(inst, player, floor))) {
          this.startBossEncounter(inst, player);
        } else {
          boss.meshHandle?.update(safeDt);
          continue;
        }
      }

      anyEngagedAlive = true;
      this.bossPositionsScratch.set(boss.id, boss.position);

      // Check 3-Phase HP thresholds (Phase 1: 100-65%, Phase 2: 65-30%, Phase 3: <30%)
      const hpRatio = boss.hp / Math.max(1, boss.maxHp);
      if (!inst.phase2Triggered && hpRatio <= 0.65) {
        this.enterPhase2(inst, player, floor, aiSystem);
      }
      if (!inst.phase3Triggered && hpRatio <= 0.3) {
        this.enterPhase3(inst, player, floor, aiSystem);
      }
    }

    if (!anyEngagedAlive) {
      return;
    }

    // 2. Advance ground Telegraph Decals and resolve combat damage on completion
    const { detonated } = this.telegraphs.update(safeDt);
    for (const zone of detonated) {
      this.resolveTelegraphDetonation(zone, player, combat);
    }

    // 3. Update persistent Phase 2+ Arena Hazards & Phase 3 Enrage Auras
    this.hazardManager.update(safeDt, this.bossPositionsScratch, player, combat);

    // 4. Execute scheduled multi-stage combo follow-ups
    for (let i = this.scheduledActions.length - 1; i >= 0; i--) {
      const item = this.scheduledActions[i];
      item.delaySec -= safeDt;
      if (item.delaySec <= 0) {
        this.scheduledActions.splice(i, 1);
        item.run(player, floor, combat, aiSystem);
      }
    }

    // 5. Update each living engaged boss's tactical AI state machine
    for (const inst of this.instances) {
      if (!inst.engaged || !inst.entity.alive || inst.defeatTriggered) continue;
      this.updateBossInstanceAI(inst, safeDt, player, floor, combat, aiSystem);
    }
  }

  clear(): void {
    this.telegraphs.clear();
    this.hazardManager.clear();
    this.scheduledActions = [];
    this.bossPositionsScratch.clear();

    for (const inst of this.instances) {
      if (inst.entity.meshHandle) {
        this.bossGroup.remove(inst.entity.meshHandle.root);
        inst.entity.meshHandle.dispose();
      }
    }

    this.instances = [];
    this.bossRoom = null;
  }

  dispose(): void {
    this.clear();
    this.telegraphs.dispose();
    this.hazardManager.dispose();
    if (this.bossGroup.parent) {
      this.bossGroup.parent.remove(this.bossGroup);
    }
    if (this.unsubKilled) {
      this.unsubKilled();
      this.unsubKilled = null;
    }
    if (this.unsubDamaged) {
      this.unsubDamaged();
      this.unsubDamaged = null;
    }
    this.scene = null;
    this.meshFactory = null;
    this.materials = null;
  }

  private createBossInstance(params: {
    id: string;
    bossId: BossId;
    blueprint: BossBlueprint;
    stats: { maxHp: number; armor: number; attackDamage: number; xpReward: number };
    spawnPos: Vec3;
    roomId: string;
    engaged: boolean;
    introTimerSec: number;
    initialCooldownSec: number;
    isColosseumTwin: boolean;
    meshFactory: IEnemyMeshFactory;
    materials: IMaterialLibrary;
  }): BossRuntimeInstance {
    const meshHandle = params.meshFactory.createBossMesh(params.bossId, params.materials);
    meshHandle.root.position.set(params.spawnPos.x, params.spawnPos.y, params.spawnPos.z);
    meshHandle.playAnim('idle', 1.0);
    this.bossGroup.add(meshHandle.root);

    if (this.scene && this.bossGroup.parent !== this.scene) {
      this.scene.add(this.bossGroup);
      this.telegraphs.attachToScene(this.scene);
      this.hazardManager.attachToScene(this.scene);
    }

    const entity: EnemyEntity = {
      id: params.id,
      name: params.blueprint.name,
      archetype: params.bossId,
      isBoss: true,
      isElite: false,
      affixes: [],
      position: { ...params.spawnPos },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      radius: params.blueprint.collisionRadius,
      hp: params.stats.maxHp,
      maxHp: params.stats.maxHp,
      armor: params.stats.armor,
      moveSpeed: params.blueprint.baseMoveSpeed,
      attackDamage: params.stats.attackDamage,
      damageType: params.blueprint.primaryDamageType,
      attackRange: params.blueprint.preferredRange,
      attackCooldownSec: 2.2,
      xpReward: params.stats.xpReward,
      lootTierBonus: params.blueprint.lootTierBonus,
      statuses: [],
      alive: true,
      roomId: params.roomId,
      meshHandle,
    };

    return {
      entity,
      blueprint: params.blueprint,
      engaged: params.engaged,
      introTimerSec: params.introTimerSec,
      phase: 1,
      phase2Triggered: false,
      phase3Triggered: false,
      forceUltimateNext: false,
      defeatTriggered: false,
      deathAnimSec: 0,
      actionState: 'pursue',
      activeAttack: null,
      windupRemainingSec: 0,
      recoverRemainingSec: 0,
      globalActionCooldownSec: params.initialCooldownSec,
      hazardRefreshTimerSec: 7.0,
      clockHandAngleRad: 0,
      attackCooldowns: new Map<string, number>(),
      isColosseumTwin: params.isColosseumTwin,
    };
  }

  private updateBossInstanceAI(
    inst: BossRuntimeInstance,
    safeDt: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
  ): void {
    const boss = inst.entity;

    // Tick per-instance attack cooldowns
    for (const [atkId, rem] of inst.attackCooldowns.entries()) {
      if (rem > 0) {
        const next = rem - safeDt;
        if (next <= 0) inst.attackCooldowns.delete(atkId);
        else inst.attackCooldowns.set(atkId, next);
      }
    }

    // Intro cinematic roar hold
    if (inst.introTimerSec > 0) {
      inst.introTimerSec = Math.max(0, inst.introTimerSec - safeDt);
      this.rotateBossToward(inst, player.position, safeDt * 6);
      this.syncBossTransform(inst, safeDt);
      return;
    }

    // Respect stun / freeze / chill statuses
    const isDisabled = boss.statuses.some(
      (s) => (s.type === 'stun' || s.type === 'freeze') && s.remainingSec > 0,
    );
    const isChilled = boss.statuses.some((s) => s.type === 'chill' && s.remainingSec > 0);
    const chillFactor = isChilled ? 0.7 : 1.0;

    if (isDisabled || !player.alive) {
      boss.velocity.x = 0;
      boss.velocity.z = 0;
      boss.meshHandle?.playAnim('idle', 0.25);
      this.syncBossTransform(inst, safeDt);
      return;
    }

    // Periodic arena hazard replenishment in Phase 2 & 3
    if (inst.phase >= 2) {
      inst.hazardRefreshTimerSec -= safeDt;
      const desiredHazards = inst.isColosseumTwin ? 2 : inst.phase === 3 ? 4 : 3;
      if (
        inst.hazardRefreshTimerSec <= 0 &&
        this.hazardManager.getActiveHazardCount(boss.id) < desiredHazards
      ) {
        inst.hazardRefreshTimerSec = inst.phase === 3 ? 6.8 : 9.2;
        this.spawnArenaHazardNearPlayer(inst, player, floor);
      }
    }

    const twinTempoScale = inst.isColosseumTwin ? 0.88 : 1.0;
    const phaseMoveMult = inst.phase === 3 ? 1.34 : inst.phase === 2 ? 1.18 : 1.0;
    const phaseTempoMult =
      (inst.phase === 3 ? 1.32 : inst.phase === 2 ? 1.16 : 1.0) * twinTempoScale;
    const phaseCdMult =
      (inst.phase === 3 ? 0.62 : inst.phase === 2 ? 0.78 : 1.0) / twinTempoScale;

    if (inst.actionState === 'pursue') {
      inst.globalActionCooldownSec = Math.max(0, inst.globalActionCooldownSec - safeDt);
      this.rotateBossToward(inst, player.position, safeDt * 6.5);

      const dist = distXZ(boss.position, player.position);
      const effectiveSpeed = inst.blueprint.baseMoveSpeed * phaseMoveMult * chillFactor;
      boss.moveSpeed = effectiveSpeed;

      if (dist > inst.blueprint.preferredRange) {
        this.moveBossToward(inst, player.position, effectiveSpeed, safeDt, floor);
        boss.meshHandle?.playAnim('walk', phaseMoveMult * chillFactor);
      } else {
        boss.velocity.x = 0;
        boss.velocity.z = 0;
        boss.meshHandle?.playAnim('idle', 1.0);
      }

      if (inst.globalActionCooldownSec <= 0) {
        const chosen = this.selectNextAttack(inst, dist);
        if (chosen) {
          inst.activeAttack = chosen;
          inst.actionState = 'windup';
          inst.windupRemainingSec =
            chosen.windupSec / Math.max(0.4, phaseTempoMult * chillFactor);
          boss.velocity.x = 0;
          boss.velocity.z = 0;
          boss.meshHandle?.playAnim(
            chosen.kind === 'cleave_cone' ? 'windup' : 'cast',
            phaseTempoMult,
          );
        }
      }
    } else if (inst.actionState === 'windup') {
      inst.windupRemainingSec -= safeDt;
      this.rotateBossToward(inst, player.position, safeDt * 7.5);
      boss.velocity.x = 0;
      boss.velocity.z = 0;

      if (inst.windupRemainingSec <= 0 && inst.activeAttack) {
        const atk = inst.activeAttack;
        this.executeAttackPattern(inst, atk, player, floor, combat, aiSystem, phaseTempoMult);
        inst.attackCooldowns.set(atk.id, atk.cooldownSec * phaseCdMult);
        inst.actionState = 'recover';
        inst.recoverRemainingSec =
          clamp(atk.telegraphDurationSec * 0.52, 0.32, 0.85) * phaseCdMult;
        inst.activeAttack = null;
      }
    } else {
      // 'recover'
      inst.recoverRemainingSec -= safeDt;
      boss.velocity.x = 0;
      boss.velocity.z = 0;
      if (inst.recoverRemainingSec <= 0) {
        inst.actionState = 'pursue';
        const baseGap = inst.phase === 3 ? 0.38 : inst.phase === 2 ? 0.65 : 0.95;
        inst.globalActionCooldownSec = inst.isColosseumTwin ? baseGap * 1.25 : baseGap;
      }
    }

    this.syncBossTransform(inst, safeDt);
  }

  private ensureSubscriptions(): void {
    if (!this.unsubKilled) {
      this.unsubKilled = eventBus.on('combat:enemyKilled', ({ enemy }) => {
        const match = this.instances.find((inst) => inst.entity.id === enemy.id);
        if (match && !match.defeatTriggered) {
          this.triggerInstanceDefeated(match);
        }
      });
    }
    if (!this.unsubDamaged) {
      this.unsubDamaged = eventBus.on('combat:damageDealt', ({ targetId, result }) => {
        const match = this.instances.find((inst) => inst.entity.id === targetId);
        if (match && !result.isDodged && result.finalDamage > 0) {
          match.entity.meshHandle?.flashHit();
          if (match.entity.hp <= 0 && !match.defeatTriggered) {
            this.triggerInstanceDefeated(match);
          }
        }
      });
    }
  }

  private isPlayerInBossArena(
    inst: BossRuntimeInstance,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
  ): boolean {
    if (this.bossRoom) {
      const grid = floor.worldToGrid(player.position);
      const inRoomGrid =
        grid.col >= this.bossRoom.x &&
        grid.col < this.bossRoom.x + this.bossRoom.width &&
        grid.row >= this.bossRoom.y &&
        grid.row < this.bossRoom.y + this.bossRoom.height;
      if (inRoomGrid) return true;

      const halfW = Math.max(4, this.bossRoom.width * floor.tileSize * 0.5 - 0.5);
      const halfH = Math.max(4, this.bossRoom.height * floor.tileSize * 0.5 - 0.5);
      const dx = Math.abs(player.position.x - this.bossRoom.centerWorld.x);
      const dz = Math.abs(player.position.z - this.bossRoom.centerWorld.z);
      if (dx <= halfW && dz <= halfH) return true;
    }

    return distXZ(player.position, inst.entity.position) <= 13.5;
  }

  private startBossEncounter(inst: BossRuntimeInstance, player: PlayerRuntimeState): void {
    if (inst.engaged) return;

    inst.engaged = true;
    inst.introTimerSec = 1.9;
    inst.phase = 1;

    const dx = player.position.x - inst.entity.position.x;
    const dz = player.position.z - inst.entity.position.z;
    if (Math.hypot(dx, dz) > 0.01) {
      inst.entity.rotationY = Math.atan2(dx, dz);
    }

    inst.entity.meshHandle?.playAnim('cast', 0.9);
    this.syncBossTransform(inst, 0);

    eventBus.emit('boss:spawned', {
      bossId: inst.blueprint.bossId,
      title: inst.blueprint.fullTitle,
      position: { ...inst.entity.position },
    });

    eventBus.emit('ui:banner', {
      title: inst.blueprint.name.toUpperCase(),
      subtitle: inst.blueprint.subtitle,
      tone: inst.blueprint.bannerTone,
    });

    eventBus.emit('sfx:request', {
      id: 'boss_roar',
      position: { ...inst.entity.position },
    });

    eventBus.emit('camera:shake', { trauma: 0.5 });

    eventBus.emit('lighting:flash', {
      colorHex: inst.blueprint.themeColorHex,
      intensity: 1.5,
      durationSec: 0.45,
    });
  }

  private enterPhase2(
    inst: BossRuntimeInstance,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    aiSystem: IEnemyAISystem,
  ): void {
    inst.phase2Triggered = true;
    inst.phase = 2;

    eventBus.emit('boss:phaseChanged', {
      bossId: inst.blueprint.bossId,
      phase: 2,
    });

    eventBus.emit('ui:banner', {
      title: `${inst.blueprint.shortName.toUpperCase()} — PHASE II`,
      subtitle: inst.blueprint.phase2Subtitle,
      tone: 'crimson',
    });

    eventBus.emit('sfx:request', {
      id: 'boss_roar',
      position: { ...inst.entity.position },
    });

    eventBus.emit('vfx:request', {
      type: inst.blueprint.phaseTransitionVfx,
      position: { ...inst.entity.position },
      colorHex: inst.blueprint.themeColorHex,
      radius: 5.0,
      scale: 1.6,
    });

    eventBus.emit('camera:shake', { trauma: 0.58 });
    eventBus.emit('lighting:flash', {
      colorHex: inst.blueprint.themeColorHex,
      intensity: 1.8,
      durationSec: 0.45,
    });

    const minionCount = inst.isColosseumTwin
      ? Math.max(2, Math.ceil(inst.blueprint.phase2MinionCount * 0.5))
      : inst.blueprint.phase2MinionCount;
    this.summonMinionWave(inst, minionCount, floor, aiSystem);

    const hazardCount = inst.isColosseumTwin ? 2 : 3;
    for (let i = 0; i < hazardCount; i++) {
      const pos = this.pickArenaHazardPosition(inst, player, floor, i, hazardCount);
      this.hazardManager.spawnHazard({
        position: pos,
        radius: 2.35,
        damagePerTick: Math.max(8, Math.round(inst.entity.attackDamage * 0.42)),
        damageType: inst.blueprint.hazardDamageType,
        appliesStatus: inst.blueprint.hazardStatus,
        colorHex: inst.blueprint.hazardColorHex,
        sourceId: inst.entity.id,
        durationSec: 24,
      });
    }
  }

  private enterPhase3(
    inst: BossRuntimeInstance,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    aiSystem: IEnemyAISystem,
  ): void {
    inst.phase3Triggered = true;
    inst.phase = 3;
    inst.forceUltimateNext = true;
    inst.globalActionCooldownSec = 0.15;

    eventBus.emit('boss:phaseChanged', {
      bossId: inst.blueprint.bossId,
      phase: 3,
    });

    eventBus.emit('ui:banner', {
      title: `${inst.blueprint.shortName.toUpperCase()} — ENRAGED!`,
      subtitle: inst.blueprint.phase3Subtitle,
      tone: 'crimson',
    });

    eventBus.emit('sfx:request', {
      id: 'boss_roar',
      position: { ...inst.entity.position },
    });

    eventBus.emit('vfx:request', {
      type: inst.blueprint.phaseTransitionVfx,
      position: { ...inst.entity.position },
      colorHex: 0xff2244,
      radius: 6.5,
      scale: 2.0,
    });

    eventBus.emit('camera:shake', { trauma: 0.78 });
    eventBus.emit('lighting:flash', {
      colorHex: 0xff2244,
      intensity: 2.2,
      durationSec: 0.6,
    });

    this.hazardManager.activateEnrageAura(inst.entity.id, inst.blueprint.themeColorHex);

    const livingMinions = aiSystem
      .getLivingEnemies()
      .filter((e) => !e.isBoss && e.roomId === inst.entity.roomId).length;
    if (livingMinions < 3) {
      const count = inst.isColosseumTwin ? 2 : inst.blueprint.phase3MinionCount;
      this.summonMinionWave(inst, count, floor, aiSystem);
    }

    const extraHazards = inst.isColosseumTwin ? 1 : 2;
    for (let i = 0; i < extraHazards; i++) {
      const pos = this.pickArenaHazardPosition(inst, player, floor, i, extraHazards);
      this.hazardManager.spawnHazard({
        position: pos,
        radius: 2.55,
        damagePerTick: Math.max(10, Math.round(inst.entity.attackDamage * 0.48)),
        damageType: inst.blueprint.hazardDamageType,
        appliesStatus: inst.blueprint.hazardStatus,
        colorHex: inst.blueprint.hazardColorHex,
        sourceId: inst.entity.id,
        durationSec: 26,
      });
    }
  }

  private summonMinionWave(
    inst: BossRuntimeInstance,
    count: number,
    floor: DungeonFloorData,
    aiSystem: IEnemyAISystem,
  ): void {
    if (!this.scene || !this.meshFactory || !this.materials || count <= 0) {
      return;
    }

    const center = this.bossRoom?.centerWorld ?? inst.entity.position;
    const angle = this.rng.range(0, Math.PI * 2);
    let spawnOrigin: Vec3 = { ...center };

    for (const dist of [4.5, 3.2, 2.0]) {
      const candidate = {
        x: inst.entity.position.x + Math.cos(angle) * dist,
        y: 0,
        z: inst.entity.position.z + Math.sin(angle) * dist,
      };
      if (floor.isWalkableWorld(candidate.x, candidate.z, 0.6)) {
        spawnOrigin = candidate;
        break;
      }
    }

    aiSystem.spawnWaveAt(
      spawnOrigin,
      count,
      Math.max(1, floor.floorNumber),
      inst.entity.roomId,
      this.scene,
      this.meshFactory,
      this.materials,
    );

    eventBus.emit('vfx:request', {
      type: 'void_implosion',
      position: spawnOrigin,
      colorHex: inst.blueprint.themeColorHex,
      scale: 1.2,
    });
  }

  private selectNextAttack(inst: BossRuntimeInstance, distToPlayer: number): BossAttackDef | null {
    if (inst.forceUltimateNext) {
      const ult = inst.blueprint.attacks.find((a) => a.kind === 'ultimate_signature');
      inst.forceUltimateNext = false;
      if (ult) {
        inst.attackCooldowns.delete(ult.id);
        return ult;
      }
    }

    const eligible = inst.blueprint.attacks.filter((atk) => {
      if (atk.minPhase > inst.phase) return false;
      if ((inst.attackCooldowns.get(atk.id) ?? 0) > 0) return false;
      return distToPlayer <= atk.range + 1.5;
    });

    if (eligible.length === 0) {
      const offCooldown = inst.blueprint.attacks.filter(
        (atk) => atk.minPhase <= inst.phase && (inst.attackCooldowns.get(atk.id) ?? 0) <= 0,
      );
      if (offCooldown.length === 0) return null;
      let totalW = 0;
      for (const a of offCooldown) totalW += a.weight;
      let roll = this.rng.range(0, totalW);
      for (const a of offCooldown) {
        roll -= a.weight;
        if (roll <= 0) return a;
      }
      return offCooldown[0];
    }

    let totalWeight = 0;
    for (const atk of eligible) {
      totalWeight += atk.weight;
    }

    let pick = this.rng.range(0, totalWeight);
    for (const atk of eligible) {
      pick -= atk.weight;
      if (pick <= 0) return atk;
    }
    return eligible[eligible.length - 1];
  }

  private executeAttackPattern(
    inst: BossRuntimeInstance,
    atk: BossAttackDef,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
    tempoMult: number,
  ): void {
    const boss = inst.entity;
    const baseDmg = Math.round(boss.attackDamage * atk.damageMultiplier);
    const dur = Math.max(0.55, atk.telegraphDurationSec / Math.sqrt(tempoMult));
    const dirToPlayer = Math.atan2(
      player.position.x - boss.position.x,
      player.position.z - boss.position.z,
    );
    boss.rotationY = dirToPlayer;

    boss.meshHandle?.playAnim(
      atk.kind === 'cleave_cone' || atk.kind === 'shockwave_ring' ? 'attack' : 'cast',
      tempoMult,
    );

    switch (atk.kind) {
      case 'cleave_cone': {
        this.telegraphs.spawn({
          shape: 'cone',
          position: { x: boss.position.x, y: 0, z: boss.position.z },
          directionY: dirToPlayer,
          radius: atk.radius,
          angleRad: atk.angleRad ?? Math.PI * 0.6,
          durationSec: dur,
          damage: baseDmg,
          damageType: atk.damageType,
          appliesStatus: atk.appliesStatus,
          sourceId: boss.id,
        });
        eventBus.emit('sfx:request', { id: 'sword_swing', position: { ...boss.position } });

        if (inst.phase >= 2 && this.rng.chance(0.55)) {
          this.scheduledActions.push({
            sourceId: boss.id,
            delaySec: dur * 0.65,
            run: (pl) => {
              if (!inst.entity.alive) return;
              const nextDir = Math.atan2(
                pl.position.x - inst.entity.position.x,
                pl.position.z - inst.entity.position.z,
              );
              inst.entity.rotationY = nextDir;
              inst.entity.meshHandle?.playAnim('attack', tempoMult * 1.15);
              this.telegraphs.spawn({
                shape: 'cone',
                position: { ...inst.entity.position },
                directionY: nextDir,
                radius: atk.radius * 1.06,
                angleRad: (atk.angleRad ?? Math.PI * 0.6) * 0.92,
                durationSec: Math.max(0.55, dur * 0.85),
                damage: Math.round(baseDmg * 0.95),
                damageType: atk.damageType,
                appliesStatus: atk.appliesStatus,
                sourceId: inst.entity.id,
              });
            },
          });
        }
        break;
      }

      case 'meteor_circle': {
        const leadPos = this.computeWalkableTargetNear(
          {
            x: player.position.x + player.velocity.x * 0.35,
            y: 0,
            z: player.position.z + player.velocity.z * 0.35,
          },
          floor,
          boss.position,
        );
        this.telegraphs.spawn({
          shape: 'circle',
          position: leadPos,
          directionY: 0,
          radius: atk.radius,
          durationSec: dur,
          damage: baseDmg,
          damageType: atk.damageType,
          appliesStatus: atk.appliesStatus,
          sourceId: boss.id,
        });
        eventBus.emit('sfx:request', { id: 'fireball_cast', position: { ...boss.position } });
        break;
      }

      case 'meteor_cluster': {
        const count = (atk.count ?? 3) + (inst.phase === 3 ? 1 : 0);
        eventBus.emit('sfx:request', { id: 'fireball_cast', position: { ...boss.position } });

        for (let i = 0; i < count; i++) {
          const delay = i * 0.22;
          this.scheduledActions.push({
            sourceId: boss.id,
            delaySec: delay,
            run: (pl, fl) => {
              if (!inst.entity.alive) return;
              const angle = this.rng.range(0, Math.PI * 2);
              const spread = i === 0 ? 0 : this.rng.range(2.2, 5.4);
              const target = this.computeWalkableTargetNear(
                {
                  x: pl.position.x + Math.cos(angle) * spread,
                  y: 0,
                  z: pl.position.z + Math.sin(angle) * spread,
                },
                fl,
                inst.entity.position,
              );
              this.telegraphs.spawn({
                shape: 'circle',
                position: target,
                directionY: angle,
                radius: atk.radius,
                durationSec: dur,
                damage: baseDmg,
                damageType: atk.damageType,
                appliesStatus: atk.appliesStatus,
                sourceId: inst.entity.id,
              });
            },
          });
        }
        break;
      }

      case 'shockwave_ring': {
        const innerR = atk.innerRadius ?? 3.3;
        this.telegraphs.spawn({
          shape: 'ring',
          position: { ...boss.position },
          directionY: 0,
          innerRadius: innerR,
          radius: atk.radius,
          durationSec: dur,
          damage: baseDmg,
          damageType: atk.damageType,
          appliesStatus: atk.appliesStatus,
          sourceId: boss.id,
        });
        eventBus.emit('sfx:request', { id: 'boss_roar', position: { ...boss.position } });

        if (inst.phase >= 2) {
          this.scheduledActions.push({
            sourceId: boss.id,
            delaySec: dur * 0.78,
            run: () => {
              if (!inst.entity.alive) return;
              inst.entity.meshHandle?.playAnim('attack', tempoMult);
              this.telegraphs.spawn({
                shape: 'circle',
                position: { ...inst.entity.position },
                directionY: 0,
                radius: innerR + 0.65,
                durationSec: Math.max(0.7, dur * 0.82),
                damage: Math.round(baseDmg * 0.95),
                damageType: atk.damageType,
                appliesStatus: atk.appliesStatus,
                sourceId: inst.entity.id,
              });
            },
          });
        }
        break;
      }

      case 'void_beam_line': {
        this.telegraphs.spawn({
          shape: 'line',
          position: { ...boss.position },
          directionY: dirToPlayer,
          radius: atk.length ?? atk.radius,
          length: atk.length ?? atk.radius,
          width: atk.width ?? 2.3,
          durationSec: dur,
          damage: baseDmg,
          damageType: atk.damageType,
          appliesStatus: atk.appliesStatus,
          sourceId: boss.id,
        });
        eventBus.emit('sfx:request', { id: 'lightning_zap', position: { ...boss.position } });
        break;
      }

      case 'cross_beams': {
        const beamCount = 4;
        const baseAngle = dirToPlayer;
        for (let i = 0; i < beamCount; i++) {
          this.telegraphs.spawn({
            shape: 'line',
            position: { ...boss.position },
            directionY: baseAngle + (i * Math.PI * 2) / beamCount,
            radius: atk.length ?? 15,
            length: atk.length ?? 15,
            width: atk.width ?? 2.2,
            durationSec: dur,
            damage: baseDmg,
            damageType: atk.damageType,
            appliesStatus: atk.appliesStatus,
            sourceId: boss.id,
          });
        }
        eventBus.emit('sfx:request', { id: 'lightning_zap', position: { ...boss.position } });
        break;
      }

      case 'rotating_clock_beams': {
        // Chronos Celestial Clock-Hand Sweep: Minute Hand + Hour Hand ticking clockwise!
        const minuteAngle = dirToPlayer;
        const hourAngle = minuteAngle + (inst.clockHandAngleRad % (Math.PI * 2)) + 1.9;
        inst.clockHandAngleRad += Math.PI * 0.35;
        const len = atk.length ?? 16.5;
        const w = atk.width ?? 2.2;

        // Minute hand (long fast lightning beam)
        this.telegraphs.spawn({
          shape: 'line',
          position: { ...boss.position },
          directionY: minuteAngle,
          radius: len,
          length: len,
          width: w,
          durationSec: dur,
          damage: baseDmg,
          damageType: atk.damageType,
          appliesStatus: atk.appliesStatus,
          sourceId: boss.id,
        });
        // Hour hand (heavy wide temporal beam)
        this.telegraphs.spawn({
          shape: 'line',
          position: { ...boss.position },
          directionY: hourAngle,
          radius: len * 0.72,
          length: len * 0.72,
          width: w * 1.25,
          durationSec: dur,
          damage: baseDmg,
          damageType: 'void',
          appliesStatus: 'chill',
          sourceId: boss.id,
        });
        eventBus.emit('sfx:request', { id: 'lightning_zap', position: { ...boss.position } });

        if (inst.phase >= 2) {
          this.scheduledActions.push({
            sourceId: boss.id,
            delaySec: dur * 0.58,
            run: () => {
              if (!inst.entity.alive) return;
              const stepRad = Math.PI * 0.22;
              this.telegraphs.spawn({
                shape: 'line',
                position: { ...inst.entity.position },
                directionY: minuteAngle + stepRad,
                radius: len,
                length: len,
                width: w,
                durationSec: Math.max(0.65, dur * 0.88),
                damage: Math.round(baseDmg * 0.94),
                damageType: atk.damageType,
                appliesStatus: atk.appliesStatus,
                sourceId: inst.entity.id,
              });
              this.telegraphs.spawn({
                shape: 'line',
                position: { ...inst.entity.position },
                directionY: minuteAngle + stepRad + Math.PI,
                radius: len,
                length: len,
                width: w,
                durationSec: Math.max(0.65, dur * 0.88),
                damage: Math.round(baseDmg * 0.94),
                damageType: 'void',
                appliesStatus: 'chill',
                sourceId: inst.entity.id,
              });
            },
          });
        }
        break;
      }

      case 'projectile_fan': {
        const pCount = (atk.projectileCount ?? 5) + (inst.phase === 3 ? 2 : 0);
        const spread = atk.angleRad ?? Math.PI * 0.45;
        this.fireProjectileFan(
          inst,
          combat,
          boss.position,
          dirToPlayer,
          pCount,
          spread,
          atk.projectileSpeed ?? 12.5,
          atk.range,
          atk.radius,
          baseDmg,
          atk.damageType,
          atk.appliesStatus,
        );
        eventBus.emit('sfx:request', {
          id: atk.damageType === 'ice' ? 'frost_shatter' : 'fireball_cast',
          position: { ...boss.position },
        });
        break;
      }

      case 'projectile_nova': {
        const pCount = (atk.projectileCount ?? 8) + (inst.phase === 3 ? 4 : 0);
        this.fireProjectileRing(
          inst,
          combat,
          boss.position,
          dirToPlayer,
          pCount,
          atk.projectileSpeed ?? 12.0,
          atk.range,
          atk.radius,
          baseDmg,
          atk.damageType,
          atk.appliesStatus,
        );
        eventBus.emit('sfx:request', { id: 'fireball_cast', position: { ...boss.position } });
        break;
      }

      case 'ultimate_signature': {
        this.executeUltimateSignature(inst, atk, player, floor, combat, aiSystem, baseDmg, dur);
        break;
      }

      default:
        break;
    }
  }

  private executeUltimateSignature(
    inst: BossRuntimeInstance,
    atk: BossAttackDef,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
    baseDmg: number,
    dur: number,
  ): void {
    const boss = inst.entity;
    const bossId = inst.blueprint.bossId;

    eventBus.emit('sfx:request', { id: 'boss_roar', position: { ...boss.position } });
    eventBus.emit('camera:shake', { trauma: 0.55 });
    eventBus.emit('lighting:flash', {
      colorHex: inst.blueprint.themeColorHex,
      intensity: 1.6,
      durationSec: 0.4,
    });

    if (bossId === 'bone_colossus') {
      const innerR = atk.innerRadius ?? 3.3;
      this.telegraphs.spawn({
        shape: 'circle',
        position: { ...boss.position },
        directionY: 0,
        radius: innerR + 0.5,
        durationSec: dur * 0.85,
        damage: baseDmg,
        damageType: 'physical',
        appliesStatus: 'stun',
        sourceId: boss.id,
      });

      this.scheduledActions.push({
        sourceId: boss.id,
        delaySec: dur * 0.55,
        run: (pl, _fl, cb) => {
          if (!inst.entity.alive) return;
          this.telegraphs.spawn({
            shape: 'ring',
            position: { ...inst.entity.position },
            directionY: 0,
            innerRadius: innerR,
            radius: atk.radius,
            durationSec: dur,
            damage: baseDmg,
            damageType: 'physical',
            appliesStatus: 'vulnerable',
            sourceId: inst.entity.id,
          });
          const aim = Math.atan2(
            pl.position.x - inst.entity.position.x,
            pl.position.z - inst.entity.position.z,
          );
          for (let k = 0; k < 4; k++) {
            this.telegraphs.spawn({
              shape: 'line',
              position: { ...inst.entity.position },
              directionY: aim + (k * Math.PI) / 2,
              radius: 13.5,
              length: 13.5,
              width: 2.0,
              durationSec: dur * 1.05,
              damage: Math.round(baseDmg * 0.88),
              damageType: 'poison',
              appliesStatus: 'bleed',
              sourceId: inst.entity.id,
            });
          }
          this.fireProjectileRing(
            inst,
            cb,
            inst.entity.position,
            aim + Math.PI * 0.25,
            atk.projectileCount ?? 8,
            atk.projectileSpeed ?? 11.5,
            16,
            0.45,
            Math.round(baseDmg * 0.65),
            'physical',
            'bleed',
          );
        },
      });
    } else if (bossId === 'arachne_broodmother') {
      const baseAim = Math.atan2(
        player.position.x - boss.position.x,
        player.position.z - boss.position.z,
      );
      for (let c = -1; c <= 1; c++) {
        const idx = c + 1;
        this.scheduledActions.push({
          sourceId: boss.id,
          delaySec: idx * 0.28,
          run: () => {
            if (!inst.entity.alive) return;
            this.telegraphs.spawn({
              shape: 'cone',
              position: { ...inst.entity.position },
              directionY: baseAim + c * 0.62,
              radius: atk.radius,
              angleRad: atk.angleRad ?? Math.PI * 0.42,
              durationSec: dur * 0.9,
              damage: baseDmg,
              damageType: 'poison',
              appliesStatus: 'poison',
              sourceId: inst.entity.id,
            });
          },
        });
      }

      for (let m = 0; m < 4; m++) {
        this.scheduledActions.push({
          sourceId: boss.id,
          delaySec: 0.2 + m * 0.22,
          run: (pl, fl) => {
            if (!inst.entity.alive) return;
            const ang = this.rng.range(0, Math.PI * 2);
            const dist = m === 0 ? 0 : this.rng.range(2.5, 5.8);
            const pos = this.computeWalkableTargetNear(
              {
                x: pl.position.x + Math.cos(ang) * dist,
                y: 0,
                z: pl.position.z + Math.sin(ang) * dist,
              },
              fl,
              inst.entity.position,
            );
            this.telegraphs.spawn({
              shape: 'circle',
              position: pos,
              directionY: ang,
              radius: 3.1,
              durationSec: dur,
              damage: Math.round(baseDmg * 0.9),
              damageType: 'poison',
              appliesStatus: 'chill',
              sourceId: inst.entity.id,
            });
          },
        });
      }

      this.fireProjectileRing(
        inst,
        combat,
        boss.position,
        baseAim,
        atk.projectileCount ?? 10,
        atk.projectileSpeed ?? 12.5,
        16,
        0.42,
        Math.round(baseDmg * 0.6),
        'poison',
        'poison',
      );
    } else if (bossId === 'ignis_forgemaster') {
      const baseAim = Math.atan2(
        player.position.x - boss.position.x,
        player.position.z - boss.position.z,
      );
      for (let i = 0; i < 4; i++) {
        this.telegraphs.spawn({
          shape: 'line',
          position: { ...boss.position },
          directionY: baseAim + (i * Math.PI) / 2,
          radius: atk.length ?? 15,
          length: atk.length ?? 15,
          width: atk.width ?? 2.3,
          durationSec: dur * 0.92,
          damage: baseDmg,
          damageType: 'fire',
          appliesStatus: 'burn',
          sourceId: boss.id,
        });
      }

      this.scheduledActions.push({
        sourceId: boss.id,
        delaySec: dur * 0.65,
        run: (pl, fl) => {
          if (!inst.entity.alive) return;
          for (let i = 0; i < 4; i++) {
            this.telegraphs.spawn({
              shape: 'line',
              position: { ...inst.entity.position },
              directionY: baseAim + Math.PI * 0.25 + (i * Math.PI) / 2,
              radius: atk.length ?? 15,
              length: atk.length ?? 15,
              width: atk.width ?? 2.2,
              durationSec: dur * 0.92,
              damage: baseDmg,
              damageType: 'lightning',
              appliesStatus: 'burn',
              sourceId: inst.entity.id,
            });
          }
          this.telegraphs.spawn({
            shape: 'ring',
            position: { ...inst.entity.position },
            directionY: 0,
            innerRadius: atk.innerRadius ?? 3.6,
            radius: atk.radius,
            durationSec: dur,
            damage: baseDmg,
            damageType: 'fire',
            appliesStatus: 'burn',
            sourceId: inst.entity.id,
          });
          const meteorPos = this.computeWalkableTargetNear(pl.position, fl, inst.entity.position);
          this.telegraphs.spawn({
            shape: 'circle',
            position: meteorPos,
            directionY: 0,
            radius: 3.4,
            durationSec: dur,
            damage: Math.round(baseDmg * 0.92),
            damageType: 'fire',
            appliesStatus: 'burn',
            sourceId: inst.entity.id,
          });
        },
      });
    } else if (bossId === 'valkyria_rime_seraph') {
      // Valkyria — Absolute Zero Judgement:
      // Safe-eye blizzard ring + triple fanning glacial spear cones + cathedral icicle rain + rime feather burst!
      const baseAim = Math.atan2(
        player.position.x - boss.position.x,
        player.position.z - boss.position.z,
      );
      const innerR = atk.innerRadius ?? 3.4;

      this.telegraphs.spawn({
        shape: 'ring',
        position: { ...boss.position },
        directionY: 0,
        innerRadius: innerR,
        radius: atk.radius,
        durationSec: dur,
        damage: baseDmg,
        damageType: 'ice',
        appliesStatus: 'freeze',
        sourceId: boss.id,
      });

      for (let c = -1; c <= 1; c++) {
        this.scheduledActions.push({
          sourceId: boss.id,
          delaySec: 0.25 + (c + 1) * 0.24,
          run: () => {
            if (!inst.entity.alive) return;
            this.telegraphs.spawn({
              shape: 'cone',
              position: { ...inst.entity.position },
              directionY: baseAim + c * 0.66,
              radius: 8.6,
              angleRad: atk.angleRad ?? Math.PI * 0.44,
              durationSec: Math.max(0.65, dur * 0.88),
              damage: Math.round(baseDmg * 0.94),
              damageType: 'ice',
              appliesStatus: 'chill',
              sourceId: inst.entity.id,
            });
          },
        });
      }

      this.scheduledActions.push({
        sourceId: boss.id,
        delaySec: dur * 0.65,
        run: (pl, fl, cb) => {
          if (!inst.entity.alive) return;
          for (let m = 0; m < 3; m++) {
            const ang = baseAim + (m * Math.PI * 2) / 3;
            const pos = this.computeWalkableTargetNear(
              {
                x: pl.position.x + Math.cos(ang) * (m === 0 ? 0 : 3.2),
                y: 0,
                z: pl.position.z + Math.sin(ang) * (m === 0 ? 0 : 3.2),
              },
              fl,
              inst.entity.position,
            );
            this.telegraphs.spawn({
              shape: 'circle',
              position: pos,
              directionY: ang,
              radius: 3.2,
              durationSec: Math.max(0.7, dur * 0.85),
              damage: Math.round(baseDmg * 0.9),
              damageType: 'ice',
              appliesStatus: 'freeze',
              sourceId: inst.entity.id,
            });
          }
          this.fireProjectileRing(
            inst,
            cb,
            inst.entity.position,
            baseAim,
            atk.projectileCount ?? 10,
            atk.projectileSpeed ?? 13.8,
            18,
            0.44,
            Math.round(baseDmg * 0.62),
            'ice',
            'chill',
          );
        },
      });
    } else if (bossId === 'chronos_time_architect') {
      // Chronos — Grand Horologium Cataclysm:
      // Warp to observatory center -> 3 sequential clockwise-ticking 4-hand clock laser salvos + time-slow wells!
      if (!inst.isColosseumTwin) {
        const center = this.computeWalkableTargetNear(
          this.bossRoom?.centerWorld ?? boss.position,
          floor,
          boss.position,
        );
        eventBus.emit('vfx:request', {
          type: 'lightning_strike',
          position: { ...boss.position },
          colorHex: 0xffd43b,
          scale: 1.4,
        });
        boss.position.x = center.x;
        boss.position.z = center.z;
      }

      const startAngle = Math.atan2(
        player.position.x - boss.position.x,
        player.position.z - boss.position.z,
      );

      for (let tick = 0; tick < 3; tick++) {
        this.scheduledActions.push({
          sourceId: boss.id,
          delaySec: tick * 0.44,
          run: () => {
            if (!inst.entity.alive) return;
            const rotOffset = startAngle + tick * (Math.PI / 6);
            for (let hand = 0; hand < 4; hand++) {
              this.telegraphs.spawn({
                shape: 'line',
                position: { ...inst.entity.position },
                directionY: rotOffset + (hand * Math.PI) / 2,
                radius: atk.length ?? 17.0,
                length: atk.length ?? 17.0,
                width: atk.width ?? 2.25,
                durationSec: Math.max(0.7, dur * 0.88),
                damage: Math.round(baseDmg * 0.92),
                damageType: tick % 2 === 0 ? 'lightning' : 'void',
                appliesStatus: tick % 2 === 0 ? 'stun' : 'chill',
                sourceId: inst.entity.id,
              });
            }
            eventBus.emit('sfx:request', {
              id: 'lightning_zap',
              position: { ...inst.entity.position },
            });
          },
        });
      }

      this.scheduledActions.push({
        sourceId: boss.id,
        delaySec: 0.55,
        run: (pl, fl, cb) => {
          if (!inst.entity.alive) return;
          this.telegraphs.spawn({
            shape: 'ring',
            position: { ...inst.entity.position },
            directionY: 0,
            innerRadius: atk.innerRadius ?? 3.6,
            radius: atk.radius,
            durationSec: dur,
            damage: baseDmg,
            damageType: 'void',
            appliesStatus: 'chill',
            sourceId: inst.entity.id,
          });
          const wellPos = this.computeWalkableTargetNear(pl.position, fl, inst.entity.position);
          this.hazardManager.spawnHazard({
            position: wellPos,
            radius: 2.6,
            damagePerTick: Math.max(12, Math.round(inst.entity.attackDamage * 0.45)),
            damageType: 'void',
            appliesStatus: 'chill',
            colorHex: 0x748ffc,
            sourceId: inst.entity.id,
            durationSec: 18,
          });
          this.fireProjectileRing(
            inst,
            cb,
            inst.entity.position,
            startAngle + 0.2,
            atk.projectileCount ?? 12,
            atk.projectileSpeed ?? 13.6,
            19,
            0.46,
            Math.round(baseDmg * 0.65),
            'lightning',
            'chill',
          );
        },
      });
    } else if (bossId === 'the_butcher') {
      // The Butcher — Bloodhunt Cleaver Cataclysm:
      // Relentless double meat-cleaver cones + criss-crossing hook chains + heated furnace chain ring!
      const aim = Math.atan2(
        player.position.x - boss.position.x,
        player.position.z - boss.position.z,
      );
      this.telegraphs.spawn({
        shape: 'cone',
        position: { ...boss.position },
        directionY: aim,
        radius: 7.0,
        angleRad: atk.angleRad ?? Math.PI * 0.65,
        durationSec: Math.max(0.6, dur * 0.82),
        damage: baseDmg,
        damageType: 'physical',
        appliesStatus: 'bleed',
        sourceId: boss.id,
      });

      for (const hookOffset of [-0.32, 0.32]) {
        this.telegraphs.spawn({
          shape: 'line',
          position: { ...boss.position },
          directionY: aim + hookOffset,
          radius: atk.length ?? 15.0,
          length: atk.length ?? 15.0,
          width: atk.width ?? 2.2,
          durationSec: dur * 0.9,
          damage: Math.round(baseDmg * 0.92),
          damageType: 'physical',
          appliesStatus: 'stun',
          sourceId: boss.id,
        });
      }

      this.scheduledActions.push({
        sourceId: boss.id,
        delaySec: dur * 0.6,
        run: (pl) => {
          if (!inst.entity.alive) return;
          const nextAim = Math.atan2(
            pl.position.x - inst.entity.position.x,
            pl.position.z - inst.entity.position.z,
          );
          this.telegraphs.spawn({
            shape: 'ring',
            position: { ...inst.entity.position },
            directionY: 0,
            innerRadius: atk.innerRadius ?? 3.2,
            radius: atk.radius,
            durationSec: dur * 0.9,
            damage: baseDmg,
            damageType: 'fire',
            appliesStatus: 'burn',
            sourceId: inst.entity.id,
          });
          this.telegraphs.spawn({
            shape: 'cone',
            position: { ...inst.entity.position },
            directionY: nextAim,
            radius: 7.2,
            angleRad: Math.PI * 0.65,
            durationSec: Math.max(0.6, dur * 0.82),
            damage: baseDmg,
            damageType: 'physical',
            appliesStatus: 'bleed',
            sourceId: inst.entity.id,
          });
        },
      });
    } else {
      // Malakor: Shattered Crown Apocalypse!
      if (!inst.isColosseumTwin) {
        const arenaCenter = this.computeWalkableTargetNear(
          this.bossRoom?.centerWorld ?? boss.position,
          floor,
          boss.position,
        );
        eventBus.emit('vfx:request', {
          type: 'void_implosion',
          position: { ...boss.position },
          colorHex: 0xbe4bdb,
          scale: 1.5,
        });
        boss.position.x = arenaCenter.x;
        boss.position.z = arenaCenter.z;
        eventBus.emit('vfx:request', {
          type: 'void_implosion',
          position: { ...boss.position },
          colorHex: 0xffe066,
          scale: 1.8,
        });
      }

      const aim = Math.atan2(
        player.position.x - boss.position.x,
        player.position.z - boss.position.z,
      );
      const innerR = atk.innerRadius ?? 3.6;

      this.telegraphs.spawn({
        shape: 'ring',
        position: { ...boss.position },
        directionY: 0,
        innerRadius: innerR,
        radius: atk.radius,
        durationSec: dur,
        damage: baseDmg,
        damageType: 'void',
        appliesStatus: 'vulnerable',
        sourceId: boss.id,
      });

      for (let i = 0; i < 4; i++) {
        this.telegraphs.spawn({
          shape: 'line',
          position: { ...boss.position },
          directionY: aim + (i * Math.PI) / 2,
          radius: atk.length ?? 16.5,
          length: atk.length ?? 16.5,
          width: atk.width ?? 2.2,
          durationSec: dur * 0.95,
          damage: Math.round(baseDmg * 0.92),
          damageType: 'void',
          appliesStatus: 'vulnerable',
          sourceId: boss.id,
        });
      }

      this.scheduledActions.push({
        sourceId: boss.id,
        delaySec: dur * 0.75,
        run: (_pl, _fl, cb) => {
          if (!inst.entity.alive) return;
          this.telegraphs.spawn({
            shape: 'circle',
            position: { ...inst.entity.position },
            directionY: 0,
            radius: innerR + 0.85,
            durationSec: Math.max(0.75, dur * 0.85),
            damage: baseDmg,
            damageType: 'void',
            appliesStatus: 'stun',
            sourceId: inst.entity.id,
          });
          this.fireProjectileRing(
            inst,
            cb,
            inst.entity.position,
            aim + 0.26,
            atk.projectileCount ?? 12,
            atk.projectileSpeed ?? 13.0,
            18,
            0.46,
            Math.round(baseDmg * 0.65),
            'void',
            'chill',
          );
        },
      });

      const living = aiSystem
        .getLivingEnemies()
        .filter((e) => !e.isBoss && e.roomId === boss.roomId).length;
      if (living === 0 && !inst.isColosseumTwin) {
        this.summonMinionWave(inst, 2, floor, aiSystem);
      }
    }
  }

  private fireProjectileFan(
    inst: BossRuntimeInstance,
    combat: ICombatEngine,
    origin: Vec3,
    centerAngle: number,
    count: number,
    totalSpreadRad: number,
    speed: number,
    maxDistance: number,
    radius: number,
    damage: number,
    damageType: DamageType,
    status?: BossAttackDef['appliesStatus'],
  ): void {
    const colorHex = DAMAGE_TYPE_COLORS[damageType]?.hex ?? 0xff6b35;

    for (let i = 0; i < count; i++) {
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const angle = centerAngle - totalSpreadRad * 0.5 + t * totalSpreadRad;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);

      const spec: ProjectileSpec = {
        ownerIsPlayer: false,
        ownerId: inst.entity.id,
        origin: { x: origin.x + dx * 1.1, y: 1.05, z: origin.z + dz * 1.1 },
        direction: { x: dx, y: 0, z: dz },
        speed,
        maxDistance,
        radius,
        piercing: false,
        damagePacket: {
          sourceId: inst.entity.id,
          baseAmount: damage,
          damageType,
          critChance: 0,
          critMultiplier: 1.5,
          appliesStatus: status
            ? {
                type: status,
                chance: 0.75,
                durationSec: getDefaultStatusDuration(status),
                potency: Math.max(3, Math.round(damage * 0.2)),
              }
            : undefined,
        },
        visualColorHex: colorHex,
      };
      combat.spawnProjectile(spec);
    }
  }

  private fireProjectileRing(
    inst: BossRuntimeInstance,
    combat: ICombatEngine,
    origin: Vec3,
    startAngle: number,
    count: number,
    speed: number,
    maxDistance: number,
    radius: number,
    damage: number,
    damageType: DamageType,
    status?: BossAttackDef['appliesStatus'],
  ): void {
    const colorHex = DAMAGE_TYPE_COLORS[damageType]?.hex ?? 0xda77f2;

    for (let i = 0; i < count; i++) {
      const angle = startAngle + (i * Math.PI * 2) / count;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);

      const spec: ProjectileSpec = {
        ownerIsPlayer: false,
        ownerId: inst.entity.id,
        origin: { x: origin.x + dx * 1.15, y: 1.1, z: origin.z + dz * 1.15 },
        direction: { x: dx, y: 0, z: dz },
        speed,
        maxDistance,
        radius,
        piercing: false,
        damagePacket: {
          sourceId: inst.entity.id,
          baseAmount: damage,
          damageType,
          critChance: 0,
          critMultiplier: 1.5,
          appliesStatus: status
            ? {
                type: status,
                chance: 0.75,
                durationSec: getDefaultStatusDuration(status),
                potency: Math.max(3, Math.round(damage * 0.2)),
              }
            : undefined,
        },
        visualColorHex: colorHex,
      };
      combat.spawnProjectile(spec);
    }
  }

  private resolveTelegraphDetonation(
    zone: TelegraphZone,
    player: PlayerRuntimeState,
    combat: ICombatEngine,
  ): void {
    const { vfx, sfx } = this.getDetonationEffects(zone);
    const effectPos: Vec3 =
      zone.shape === 'line'
        ? {
            x: zone.position.x + Math.sin(zone.directionY) * ((zone.length ?? 10) * 0.45),
            y: 0.3,
            z: zone.position.z + Math.cos(zone.directionY) * ((zone.length ?? 10) * 0.45),
          }
        : { x: zone.position.x, y: 0.3, z: zone.position.z };

    eventBus.emit('vfx:request', {
      type: vfx,
      position: effectPos,
      direction: { x: Math.sin(zone.directionY), y: 0, z: Math.cos(zone.directionY) },
      colorHex: DAMAGE_TYPE_COLORS[zone.damageType]?.hex,
      radius: zone.radius,
      scale: clamp(zone.radius / 3.8, 0.85, 2.1),
    });
    eventBus.emit('sfx:request', { id: sfx, position: effectPos });
    eventBus.emit('camera:shake', {
      trauma: zone.shape === 'ring' ? 0.38 : 0.26,
    });

    if (!player.alive) return;

    if (isPointInsideTelegraph(player.position, zone, 0.08)) {
      const kbDirX = player.position.x - zone.position.x;
      const kbDirZ = player.position.z - zone.position.z;
      const kbLen = Math.hypot(kbDirX, kbDirZ) || 1;

      const packet: DamagePacket = {
        sourceId: zone.sourceId,
        targetId: player.id,
        baseAmount: zone.damage,
        damageType: zone.damageType,
        critChance: 0,
        critMultiplier: 1.5,
        knockback: {
          x: (kbDirX / kbLen) * 3.2,
          y: 0,
          z: (kbDirZ / kbLen) * 3.2,
        },
        appliesStatus: zone.appliesStatus
          ? {
              type: zone.appliesStatus,
              chance: 1.0,
              durationSec: getDefaultStatusDuration(zone.appliesStatus),
              potency: Math.max(4, Math.round(zone.damage * 0.2)),
            }
          : undefined,
      };
      combat.applyDamageToPlayer(player, packet);
    }
  }

  private getDetonationEffects(zone: TelegraphZone): { vfx: VfxEffectType; sfx: SfxId } {
    switch (zone.damageType) {
      case 'fire':
        return { vfx: 'fire_explosion', sfx: 'explosion' };
      case 'poison':
        return { vfx: 'poison_cloud', sfx: 'explosion' };
      case 'void':
        return { vfx: 'void_implosion', sfx: 'explosion' };
      case 'lightning':
        return { vfx: 'lightning_strike', sfx: 'lightning_zap' };
      case 'ice':
        return { vfx: 'frost_nova', sfx: 'frost_shatter' };
      case 'physical':
      default:
        return zone.shape === 'cone'
          ? { vfx: 'slash_arc', sfx: 'sword_swing' }
          : { vfx: 'hit_sparks', sfx: 'explosion' };
    }
  }

  private triggerInstanceDefeated(inst: BossRuntimeInstance): void {
    if (inst.defeatTriggered) return;

    inst.defeatTriggered = true;
    inst.entity.hp = 0;
    inst.entity.alive = false;
    inst.entity.velocity.x = 0;
    inst.entity.velocity.z = 0;

    // Immediately cancel all telegraphs, scheduled actions, and hazards owned by this slain boss!
    this.telegraphs.clearBySource(inst.entity.id);
    this.hazardManager.clearBySource(inst.entity.id);
    this.scheduledActions = this.scheduledActions.filter((s) => s.sourceId !== inst.entity.id);

    inst.entity.meshHandle?.playAnim('death', 1.0);
    const deathPos: Vec3 = { ...inst.entity.position };

    const remainingBosses = this.instances.filter(
      (other) => other.entity.alive && !other.defeatTriggered,
    ).length;
    const allBossesDefeated = remainingBosses === 0;

    if (allBossesDefeated) {
      if (this.bossRoom) {
        this.bossRoom.cleared = true;
      }
      this.telegraphs.clear();
      this.hazardManager.clear();
      this.scheduledActions = [];
    }

    eventBus.emit('engine:hitstop', {
      durationSec: allBossesDefeated ? 0.65 : 0.35,
      timeScale: 0.14,
    });

    eventBus.emit('boss:defeated', {
      bossId: inst.blueprint.bossId,
      position: deathPos,
    });

    eventBus.emit('ui:banner', {
      title: allBossesDefeated ? 'PINNACLE BOSS VANQUISHED' : `${inst.blueprint.shortName.toUpperCase()} SLAIN!`,
      subtitle: allBossesDefeated
        ? `${inst.blueprint.name} Has Fallen`
        : `${remainingBosses} Champion Remains in the Colosseum!`,
      tone: 'gold',
    });

    eventBus.emit('camera:shake', { trauma: allBossesDefeated ? 0.85 : 0.6 });

    eventBus.emit('lighting:flash', {
      colorHex: 0xffd43b,
      intensity: allBossesDefeated ? 2.4 : 1.7,
      durationSec: 0.7,
    });

    eventBus.emit('vfx:request', {
      type: inst.blueprint.deathVfx,
      position: deathPos,
      colorHex: inst.blueprint.themeColorHex,
      radius: 5.5,
      scale: 2.2,
    });

    eventBus.emit('vfx:request', {
      type: 'level_up_pillar',
      position: deathPos,
      colorHex: 0xffd43b,
      scale: 1.9,
    });

    eventBus.emit('sfx:request', {
      id: 'explosion',
      position: deathPos,
    });
  }

  private spawnArenaHazardNearPlayer(
    inst: BossRuntimeInstance,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
  ): void {
    const pos = this.pickArenaHazardPosition(inst, player, floor, 0, 1);
    this.hazardManager.spawnHazard({
      position: pos,
      radius: 2.35,
      damagePerTick: Math.max(8, Math.round(inst.entity.attackDamage * 0.44)),
      damageType: inst.blueprint.hazardDamageType,
      appliesStatus: inst.blueprint.hazardStatus,
      colorHex: inst.blueprint.hazardColorHex,
      sourceId: inst.entity.id,
      durationSec: 20,
    });
  }

  private pickArenaHazardPosition(
    inst: BossRuntimeInstance,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    index: number,
    total: number,
  ): Vec3 {
    const center = this.bossRoom?.centerWorld ?? inst.entity.position ?? player.position;
    const baseAngle = (index * Math.PI * 2) / Math.max(1, total) + this.rng.range(-0.4, 0.4);

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = baseAngle + attempt * 0.75;
      const r = this.rng.range(3.5, 7.5);
      const candidate: Vec3 = {
        x: center.x + Math.cos(angle) * r,
        y: 0,
        z: center.z + Math.sin(angle) * r,
      };
      if (
        floor.isWalkableWorld(candidate.x, candidate.z, 0.9) &&
        distXZ(candidate, player.position) >= 2.2
      ) {
        return candidate;
      }
    }

    return this.computeWalkableTargetNear(center, floor, inst.entity.position);
  }

  private computeWalkableTargetNear(
    desired: Vec3,
    floor: DungeonFloorData,
    fallback?: Vec3,
  ): Vec3 {
    if (floor.isWalkableWorld(desired.x, desired.z, 0.6)) {
      return { x: desired.x, y: 0, z: desired.z };
    }
    const fallbackOrigin = fallback ?? this.bossRoom?.centerWorld ?? desired;
    for (let step = 1; step <= 5; step++) {
      const t = step / 5;
      const ix = desired.x + (fallbackOrigin.x - desired.x) * t;
      const iz = desired.z + (fallbackOrigin.z - desired.z) * t;
      if (floor.isWalkableWorld(ix, iz, 0.6)) {
        return { x: ix, y: 0, z: iz };
      }
    }
    return { x: fallbackOrigin.x, y: 0, z: fallbackOrigin.z };
  }

  private rotateBossToward(
    inst: BossRuntimeInstance,
    target: Vec3,
    maxStepRad: number,
  ): void {
    const dx = target.x - inst.entity.position.x;
    const dz = target.z - inst.entity.position.z;
    if (dx * dx + dz * dz < 1e-4) return;

    const desired = Math.atan2(dx, dz);
    let diff = desired - inst.entity.rotationY;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) <= maxStepRad) {
      inst.entity.rotationY = desired;
    } else {
      inst.entity.rotationY += Math.sign(diff) * maxStepRad;
    }
  }

  private moveBossToward(
    inst: BossRuntimeInstance,
    target: Vec3,
    speed: number,
    dt: number,
    floor: DungeonFloorData,
  ): void {
    const boss = inst.entity;
    let dx = target.x - boss.position.x;
    let dz = target.z - boss.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) {
      boss.velocity.x = 0;
      boss.velocity.z = 0;
      return;
    }

    dx /= dist;
    dz /= dist;

    // Twin-boss separation steering so two Colosseum bosses flank rather than overlap
    for (const other of this.instances) {
      if (other === inst || !other.entity.alive) continue;
      const ox = boss.position.x - other.entity.position.x;
      const oz = boss.position.z - other.entity.position.z;
      const oDist = Math.hypot(ox, oz);
      const minSep = boss.radius + other.entity.radius + 1.2;
      if (oDist > 1e-3 && oDist < minSep) {
        const push = ((minSep - oDist) / minSep) * 1.4;
        dx += (ox / oDist) * push;
        dz += (oz / oDist) * push;
      }
    }

    const norm = Math.hypot(dx, dz) || 1;
    const ux = dx / norm;
    const uz = dz / norm;
    const step = speed * dt;
    const checkRadius = Math.min(boss.radius, 0.9);

    const nx = boss.position.x + ux * step;
    const nz = boss.position.z + uz * step;

    if (floor.isWalkableWorld(nx, nz, checkRadius)) {
      boss.position.x = nx;
      boss.position.z = nz;
      boss.velocity.x = ux * speed;
      boss.velocity.z = uz * speed;
    } else if (floor.isWalkableWorld(nx, boss.position.z, checkRadius)) {
      boss.position.x = nx;
      boss.velocity.x = ux * speed;
      boss.velocity.z = 0;
    } else if (floor.isWalkableWorld(boss.position.x, nz, checkRadius)) {
      boss.position.z = nz;
      boss.velocity.x = 0;
      boss.velocity.z = uz * speed;
    } else {
      boss.velocity.x = 0;
      boss.velocity.z = 0;
    }
  }

  private syncBossTransform(inst: BossRuntimeInstance, dt: number): void {
    const { meshHandle, position, rotationY } = inst.entity;
    if (!meshHandle) return;
    meshHandle.root.position.set(position.x, position.y, position.z);
    meshHandle.root.rotation.y = rotationY;
    if (dt > 0) {
      meshHandle.update(dt);
    }
  }
}

export function createBossDirector(): IBossDirector {
  return new BossDirector();
}
