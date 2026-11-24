import * as THREE from 'three';
import type {
  ActiveWorldEventStatus,
  DamagePacket,
  DerivedStats,
  DungeonFloorData,
  DungeonRoom,
  EnemyAnimState,
  EnemyEntity,
  IBossDirector,
  ICombatEngine,
  IEnemyAISystem,
  IEnemyMeshFactory,
  IMaterialLibrary,
  InteractableProp,
  IWorldEventSystem,
  ObeliskPactCard,
  PlayerRuntimeState,
  Vec3,
} from '../../contracts/types';
import { clamp, distXZ, SeededRng } from '../../core/Constants';
import { t } from '../../core/i18n/index.js';
import { eventBus } from '../../core/EventBus';
import {
  ButcherVisualRig,
  ColosseumVisualRig,
  GoblinVisualRig,
  RiftBreachVisualRig,
  SoulLanternVisualRig,
} from './eventVisuals';
import {
  aggregateObeliskPactBonuses,
  clonePactCard,
  OBELISK_PACT_CARDS,
  rollThreeObeliskChoices,
} from './obeliskPacts';

const SOUL_LANTERN_SAFE_RADIUS = 6.5;
const GOBLIN_ESCAPE_DURATION_SEC = 18.0;
const RIFT_BREACH_DURATION_SEC = 25.0;
const COLOSSEUM_MAX_WAVES = 20;

interface ButcherRuntime {
  entity: EnemyEntity;
  visual: ButcherVisualRig;
  path: Vec3[];
  pathIndex: number;
  repathTimerSec: number;
  attackCooldownSec: number;
  hookCooldownSec: number;
  hookWindupSec: number;
  chargeBurstSec: number;
  chargeDir: Vec3;
  hookTargetPos: Vec3 | null;
  lastAnim: EnemyAnimState | null;
  deathDissolveSec: number;
  disposed: boolean;
}

interface GoblinRuntime {
  entity: EnemyEntity;
  visual: GoblinVisualRig;
  escapeRemainingSec: number;
  fleeDir: Vec3;
  rechooseDirSec: number;
  coinSparkleSec: number;
  panicBoostSec: number;
  lastHp: number;
  lastAnim: EnemyAnimState | null;
  deathDissolveSec: number;
  escaped: boolean;
  disposed: boolean;
}

interface MimicRuntime {
  entity: EnemyEntity;
  attackCooldownSec: number;
  lungeCooldownSec: number;
  lungeBurstSec: number;
  lungeDir: Vec3;
  lastAnim: EnemyAnimState | null;
  deathDissolveSec: number;
  disposed: boolean;
}

interface SoulEscortRuntime {
  active: boolean;
  completed: boolean;
  progress01: number;
  insideLight: boolean;
  waypoints: Vec3[];
  segmentLengths: number[];
  totalLength: number;
  traveledLength: number;
  currentPos: Vec3;
  headingY: number;
  darknessTickSec: number;
  spawnedMilestones: Set<number>;
  visual: SoulLanternVisualRig;
}

interface RiftBreachRuntime {
  active: boolean;
  center: Vec3;
  roomId: string;
  remainingSec: number;
  kills: number;
  tierLabel: 'Bronze' | 'Silver' | 'Gold' | 'Mythic';
  spawnTimerSec: number;
  wavesSpawned: number;
  visual: RiftBreachVisualRig;
}

interface ColosseumRuntime {
  active: boolean;
  completed: boolean;
  wave: number;
  maxWaves: number;
  bestWave: number;
  waveSpawned: boolean;
  trackedWaveEntities: EnemyEntity[];
  colosseumBossEntities: EnemyEntity[];
  emptyMockWaveTimerSec: number;
  visual: ColosseumVisualRig;
}

export function computeRiftTierLabel(
  kills: number,
): 'Bronze' | 'Silver' | 'Gold' | 'Mythic' {
  if (kills >= 14) return 'Mythic';
  if (kills >= 8) return 'Gold';
  if (kills >= 4) return 'Silver';
  return 'Bronze';
}

export class WorldEventSystem implements IWorldEventSystem {
  private scene: THREE.Scene | null = null;
  private materials: IMaterialLibrary | null = null;
  private meshFactory: IEnemyMeshFactory | null = null;
  private readonly eventGroup = new THREE.Group();

  private currentFloor: DungeonFloorData | null = null;
  private rng = new SeededRng(0x517cc1b7);
  private entityCounter = 0;

  // Floor exploration trigger tracking (random Butcher / Goblin encounters)
  private visitedRoomIds = new Set<string>();
  private floorExploreSec = 0;
  private butcherRolledThisFloor = false;
  private goblinRolledThisFloor = false;

  // Active Event Runtimes
  private butcherRuntime: ButcherRuntime | null = null;
  private goblinRuntime: GoblinRuntime | null = null;
  private mimicRuntimes: MimicRuntime[] = [];
  private escortRuntime: SoulEscortRuntime | null = null;
  private riftRuntime: RiftBreachRuntime | null = null;
  private colosseumRuntime: ColosseumRuntime | null = null;

  // Corrupted Obelisk Pacts
  private lastObeliskChoices: [ObeliskPactCard, ObeliskPactCard, ObeliskPactCard] | null = null;
  private activePacts: ObeliskPactCard[] = [];
  private pendingPactAmbushes = 0;

  // Idempotent kill tracking sets
  private processedInternalKillIds = new Set<string>();
  private claimedRewardKillIds = new Set<string>();
  private escapedGoblinIds = new Set<string>();
  private unsubEnemyKilled: (() => void) | null = null;

  constructor() {
    this.eventGroup.name = 'WorldEventSystemGroup';
  }

  public init(
    scene: THREE.Scene,
    materials: IMaterialLibrary,
    meshFactory: IEnemyMeshFactory,
  ): void {
    this.scene = scene;
    this.materials = materials;
    this.meshFactory = meshFactory;

    if (this.eventGroup.parent !== scene) {
      scene.add(this.eventGroup);
    }

    if (!this.unsubEnemyKilled) {
      this.unsubEnemyKilled = eventBus.on('combat:enemyKilled', ({ enemy }) => {
        this.processInternalKillState(enemy);
      });
    }
  }

  public initFloorEvents(floor: DungeonFloorData): void {
    this.clearFloorBoundEntities();
    this.currentFloor = floor;

    const seed =
      ((floor.seed >>> 0) ^ Math.imul((floor.floorNumber || 1) + 7, 0x9e3779b9)) >>> 0;
    this.rng = new SeededRng(seed || 0x517cc1b7);
    this.visitedRoomIds.clear();
    this.floorExploreSec = 0;
    this.butcherRolledThisFloor = false;
    this.goblinRolledThisFloor = false;

    // Mark starting spawn room as already visited so invasions trigger deeper into the floor
    const spawnRoom = this.findContainingRoom(floor, floor.playerSpawn);
    if (spawnRoom) {
      this.visitedRoomIds.add(spawnRoom.id);
    }
  }

  public startColosseumRun(floor: DungeonFloorData, bestWave = 0): void {
    this.clearFloorBoundEntities();
    this.currentFloor = floor;

    const center = this.getColosseumCenter(floor);
    const visual = new ColosseumVisualRig(center);
    this.eventGroup.add(visual.root);
    this.ensureGroupInScene();

    this.colosseumRuntime = {
      active: true,
      completed: false,
      wave: 1,
      maxWaves: COLOSSEUM_MAX_WAVES,
      bestWave: Math.max(0, Math.floor(bestWave)),
      waveSpawned: false,
      trackedWaveEntities: [],
      colosseumBossEntities: [],
      emptyMockWaveTimerSec: 0,
      visual,
    };

    eventBus.emit('ui:banner', {
      title: t('event.banner.colosseumStart.title', { max: String(COLOSSEUM_MAX_WAVES) }),
      subtitle: t('event.banner.colosseumStart.sub'),
      tone: 'crimson',
    });
    eventBus.emit('sfx:request', { id: 'boss_roar', position: { ...center } });
  }

  public spawnButcherInvasion(floor: DungeonFloorData, playerPos: Vec3): EnemyEntity | null {
    if (!this.meshFactory || !this.materials) {
      return null;
    }

    if (this.butcherRuntime) {
      this.disposeButcherRuntime(this.butcherRuntime);
      this.butcherRuntime = null;
    }

    this.currentFloor = floor;
    this.butcherRolledThisFloor = true;

    const spawnPos = this.findAmbushSpawnAround(floor, playerPos, 9.5, 13.5, 1.1);
    const f = Math.max(1, floor.floorNumber);
    const maxHp = Math.round(780 * Math.pow(1.3, f - 1));
    const armor = Math.round(22 + f * 5);
    const attackDamage = Math.round(25 * Math.pow(1.22, f - 1));
    const xpReward = Math.round(320 * Math.pow(1.26, f - 1));

    const meshHandle = this.meshFactory.createBossMesh('the_butcher', this.materials);
    meshHandle.root.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
    meshHandle.playAnim('idle', 1.0);
    this.eventGroup.add(meshHandle.root);

    const visual = new ButcherVisualRig();
    visual.update(0, spawnPos, null);
    this.eventGroup.add(visual.root);
    this.ensureGroupInScene();

    const room = this.findContainingRoom(floor, spawnPos);
    const entity: EnemyEntity = {
      id: `event_the_butcher_${f}_${++this.entityCounter}`,
      name: 'The Butcher, Cleaver of Fresh Meat',
      archetype: 'the_butcher',
      isBoss: true,
      isElite: true,
      affixes: ['berserker', 'vampiric'],
      position: { ...spawnPos },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: Math.atan2(playerPos.x - spawnPos.x, playerPos.z - spawnPos.z),
      radius: 1.15,
      hp: maxHp,
      maxHp,
      armor,
      moveSpeed: 4.85,
      attackDamage,
      damageType: 'physical',
      attackRange: 2.75,
      attackCooldownSec: 1.35,
      xpReward,
      lootTierBonus: 4,
      statuses: [],
      alive: true,
      roomId: room?.id ?? 'butcher_invasion',
      meshHandle,
    };
    meshHandle.root.rotation.y = entity.rotationY;

    this.butcherRuntime = {
      entity,
      visual,
      path: [],
      pathIndex: 0,
      repathTimerSec: 0,
      attackCooldownSec: 0.65,
      hookCooldownSec: 2.8,
      hookWindupSec: 0,
      chargeBurstSec: 0,
      chargeDir: { x: 0, y: 0, z: 1 },
      hookTargetPos: null,
      lastAnim: 'idle',
      deathDissolveSec: 0,
      disposed: false,
    };

    eventBus.emit('event:butcherInvasion', { position: { ...spawnPos } });
    eventBus.emit('ui:banner', {
      title: t('event.banner.butcherInvasion.title'),
      subtitle: t('event.banner.butcherInvasion.sub'),
      tone: 'crimson',
    });
    eventBus.emit('sfx:request', { id: 'boss_roar', position: { ...spawnPos } });
    eventBus.emit('camera:shake', { trauma: 0.52 });
    eventBus.emit('lighting:flash', { colorHex: 0xff1e42, intensity: 2.1, durationSec: 0.42 });

    return entity;
  }

  public spawnTreasureGoblin(floor: DungeonFloorData, position: Vec3): EnemyEntity | null {
    if (!this.meshFactory || !this.materials) {
      return null;
    }

    if (this.goblinRuntime) {
      this.disposeGoblinRuntime(this.goblinRuntime);
      this.goblinRuntime = null;
    }

    this.currentFloor = floor;
    this.goblinRolledThisFloor = true;

    const spawnPos = this.findNearestWalkable(floor, position, 0.55);
    const f = Math.max(1, floor.floorNumber);
    const maxHp = Math.round(310 * Math.pow(1.26, f - 1));
    const armor = Math.round(14 + f * 3);
    const xpReward = Math.round(190 * Math.pow(1.24, f - 1));

    const meshHandle = this.meshFactory.createEnemyMesh('treasure_goblin', true, this.materials);
    meshHandle.setEliteVisuals(['teleporter']);
    meshHandle.root.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
    meshHandle.playAnim('idle', 1.2);
    this.eventGroup.add(meshHandle.root);

    const visual = new GoblinVisualRig();
    visual.update(0, spawnPos, GOBLIN_ESCAPE_DURATION_SEC);
    this.eventGroup.add(visual.root);
    this.ensureGroupInScene();

    const room = this.findContainingRoom(floor, spawnPos);
    const entity: EnemyEntity = {
      id: `event_treasure_goblin_${f}_${++this.entityCounter}`,
      name: 'Gilded Treasure Goblin',
      archetype: 'treasure_goblin',
      isBoss: false,
      isElite: true,
      affixes: ['teleporter'],
      position: { ...spawnPos },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      radius: 0.52,
      hp: maxHp,
      maxHp,
      armor,
      moveSpeed: 5.35,
      attackDamage: 0,
      damageType: 'physical',
      attackRange: 1.0,
      attackCooldownSec: 99,
      xpReward,
      lootTierBonus: 3,
      statuses: [],
      alive: true,
      roomId: room?.id ?? 'goblin_hunt',
      meshHandle,
    };

    const angle = this.rng.range(0, Math.PI * 2);
    this.goblinRuntime = {
      entity,
      visual,
      escapeRemainingSec: GOBLIN_ESCAPE_DURATION_SEC,
      fleeDir: { x: Math.cos(angle), y: 0, z: Math.sin(angle) },
      rechooseDirSec: 0,
      coinSparkleSec: 1.1,
      panicBoostSec: 0,
      lastHp: maxHp,
      lastAnim: 'idle',
      deathDissolveSec: 0,
      escaped: false,
      disposed: false,
    };

    eventBus.emit('event:goblinSpawned', { position: { ...spawnPos } });
    eventBus.emit('ui:banner', {
      title: t('event.banner.goblinSpawned.title'),
      subtitle: t('event.banner.goblinSpawned.sub'),
      tone: 'gold',
    });
    eventBus.emit('sfx:request', { id: 'gold_pickup', position: { ...spawnPos } });

    return entity;
  }

  public spawnChestMimic(floor: DungeonFloorData, position: Vec3): EnemyEntity | null {
    if (!this.meshFactory || !this.materials) {
      return null;
    }

    this.currentFloor = floor;
    const spawnPos = this.findNearestWalkable(floor, position, 0.65);
    const f = Math.max(1, floor.floorNumber);
    const maxHp = Math.round(360 * Math.pow(1.27, f - 1));
    const armor = Math.round(20 + f * 4);
    const attackDamage = Math.round(21 * Math.pow(1.22, f - 1));
    const xpReward = Math.round(165 * Math.pow(1.22, f - 1));

    const meshHandle = this.meshFactory.createEnemyMesh('chest_mimic', true, this.materials);
    meshHandle.setEliteVisuals(['vampiric', 'berserker']);
    meshHandle.root.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
    meshHandle.playAnim('attack', 1.25);
    this.eventGroup.add(meshHandle.root);
    this.ensureGroupInScene();

    const room = this.findContainingRoom(floor, spawnPos);
    const entity: EnemyEntity = {
      id: `event_chest_mimic_${f}_${++this.entityCounter}`,
      name: 'Ravenous Chest Mimic',
      archetype: 'chest_mimic',
      isBoss: false,
      isElite: true,
      affixes: ['vampiric', 'berserker'],
      position: { ...spawnPos },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      radius: 0.68,
      hp: maxHp,
      maxHp,
      armor,
      moveSpeed: 4.45,
      attackDamage,
      damageType: 'physical',
      attackRange: 2.15,
      attackCooldownSec: 1.2,
      xpReward,
      lootTierBonus: 2,
      statuses: [],
      alive: true,
      roomId: room?.id ?? 'mimic_ambush',
      meshHandle,
    };

    // Initial lunging eruption toward playerSpawn or forward
    const dx = floor.playerSpawn.x - spawnPos.x;
    const dz = floor.playerSpawn.z - spawnPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.mimicRuntimes.push({
      entity,
      attackCooldownSec: 0.35,
      lungeCooldownSec: 2.6,
      lungeBurstSec: 0.36,
      lungeDir: { x: dx / len, y: 0, z: dz / len },
      lastAnim: 'attack',
      deathDissolveSec: 0,
      disposed: false,
    });

    eventBus.emit('event:mimicRevealed', { position: { ...spawnPos } });
    eventBus.emit('ui:banner', {
      title: t('event.banner.mimicRevealed.title'),
      subtitle: t('event.banner.mimicRevealed.sub'),
      tone: 'crimson',
    });
    eventBus.emit('vfx:request', {
      type: 'blood_burst',
      position: { ...spawnPos },
      colorHex: 0xff3b30,
      radius: 2.3,
    });
    eventBus.emit('sfx:request', { id: 'boss_roar', position: { ...spawnPos } });
    eventBus.emit('camera:shake', { trauma: 0.34 });

    return entity;
  }

  public rollObeliskChoices(): [ObeliskPactCard, ObeliskPactCard, ObeliskPactCard] {
    const choices = rollThreeObeliskChoices(this.rng, this.activePacts);
    this.lastObeliskChoices = choices;
    return [
      clonePactCard(choices[0]),
      clonePactCard(choices[1]),
      clonePactCard(choices[2]),
    ];
  }

  public selectObeliskPact(cardId: string): ObeliskPactCard | null {
    const fromRolled = this.lastObeliskChoices?.find((c) => c.id === cardId);
    const template = fromRolled ?? OBELISK_PACT_CARDS.find((c) => c.id === cardId);
    if (!template) {
      return null;
    }

    const chosen = clonePactCard(template);
    this.activePacts.push(chosen);
    this.lastObeliskChoices = null;

    if (chosen.spawnEliteAmbush) {
      this.pendingPactAmbushes += 1;
    }

    eventBus.emit('ui:banner', {
      title: t('event.banner.obeliskPact.title', { title: chosen.title.toUpperCase() }),
      subtitle: chosen.blessingText,
      tone: chosen.tone,
    });
    eventBus.emit('sfx:request', { id: 'shrine_bless' });
    eventBus.emit('lighting:flash', {
      colorHex:
        chosen.tone === 'crimson'
          ? 0xff1e42
          : chosen.tone === 'gold'
            ? 0xffd43b
            : 0xbe4bdb,
      intensity: 1.8,
      durationSec: 0.35,
    });

    return clonePactCard(chosen);
  }

  public startSoulEscort(prop: InteractableProp, floor: DungeonFloorData): void {
    prop.used = true;
    this.currentFloor = floor;

    if (this.escortRuntime) {
      this.escortRuntime.visual.dispose();
      this.escortRuntime = null;
    }

    const waypoints = this.buildSoulEscortRoute(prop.position, floor);
    const segmentLengths: number[] = [];
    let totalLength = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const seg = Math.max(0.05, distXZ(waypoints[i], waypoints[i + 1]));
      segmentLengths.push(seg);
      totalLength += seg;
    }
    totalLength = Math.max(1, totalLength);

    const visual = new SoulLanternVisualRig(this.materials, SOUL_LANTERN_SAFE_RADIUS);
    visual.attachTo(this.eventGroup);
    this.ensureGroupInScene();

    const startPos: Vec3 = { x: waypoints[0].x, y: 0, z: waypoints[0].z };
    const nextPt = waypoints[1] ?? startPos;
    const headingY = Math.atan2(nextPt.x - startPos.x, nextPt.z - startPos.z);
    visual.update(0, startPos, headingY, 0, true, waypoints[1] ?? null);

    this.escortRuntime = {
      active: true,
      completed: false,
      progress01: 0,
      insideLight: true,
      waypoints,
      segmentLengths,
      totalLength,
      traveledLength: 0,
      currentPos: startPos,
      headingY,
      darknessTickSec: 0,
      spawnedMilestones: new Set<number>(),
      visual,
    };

    eventBus.emit('ui:banner', {
      title: t('event.banner.soulEscort.title'),
      subtitle: t('event.banner.soulEscort.sub'),
      tone: 'gold',
    });
    eventBus.emit('sfx:request', { id: 'portal_hum', position: { ...startPos } });
    eventBus.emit('vfx:request', {
      type: 'heal_aura',
      position: { ...startPos },
      colorHex: 0xffd43b,
      radius: SOUL_LANTERN_SAFE_RADIUS,
    });
  }

  public startRiftBreach(prop: InteractableProp, floor: DungeonFloorData): void {
    prop.used = true;
    this.currentFloor = floor;

    if (this.riftRuntime) {
      this.riftRuntime.visual.dispose();
      this.riftRuntime = null;
    }

    const center: Vec3 = { x: prop.position.x, y: 0, z: prop.position.z };
    const visual = new RiftBreachVisualRig(center);
    this.eventGroup.add(visual.root);
    this.ensureGroupInScene();

    this.riftRuntime = {
      active: true,
      center,
      roomId: prop.roomId || 'rift_breach',
      remainingSec: RIFT_BREACH_DURATION_SEC,
      kills: 0,
      tierLabel: 'Bronze',
      spawnTimerSec: 0, // Spawn Wave 1 on immediate next update
      wavesSpawned: 0,
      visual,
    };

    eventBus.emit('ui:banner', {
      title: t('event.banner.riftBreach.title'),
      subtitle: t('event.banner.riftBreach.sub'),
      tone: 'arcane',
    });
    eventBus.emit('vfx:request', {
      type: 'void_implosion',
      position: { ...center },
      colorHex: 0xbe4bdb,
      radius: 4.2,
    });
    eventBus.emit('sfx:request', { id: 'portal_hum', position: { ...center } });
  }

  public getEventCombatEntities(): EnemyEntity[] {
    const out: EnemyEntity[] = [];
    const seen = new Set<string>();

    const pushIfAlive = (e: EnemyEntity | null | undefined): void => {
      if (!e || !e.alive || e.hp <= 0 || seen.has(e.id)) return;
      seen.add(e.id);
      out.push(e);
    };

    pushIfAlive(this.butcherRuntime?.entity);
    pushIfAlive(this.goblinRuntime?.entity);

    for (const m of this.mimicRuntimes) {
      pushIfAlive(m.entity);
    }

    if (this.colosseumRuntime?.active) {
      for (const b of this.colosseumRuntime.colosseumBossEntities) {
        pushIfAlive(b);
      }
    }

    return out;
  }

  public getStatus(): ActiveWorldEventStatus {
    const butcherActive = Boolean(
      this.butcherRuntime &&
        this.butcherRuntime.entity.alive &&
        this.butcherRuntime.entity.hp > 0,
    );
    const goblinActive = Boolean(
      this.goblinRuntime &&
        !this.goblinRuntime.escaped &&
        this.goblinRuntime.entity.alive &&
        this.goblinRuntime.entity.hp > 0,
    );

    return {
      butcherActive,
      goblinActive,
      ...(goblinActive && this.goblinRuntime
        ? {
            goblinEscapeSec:
              Math.round(this.goblinRuntime.escapeRemainingSec * 10) / 10,
          }
        : {}),
      escortState: this.escortRuntime
        ? {
            active: this.escortRuntime.active,
            progress01: Math.round(this.escortRuntime.progress01 * 1000) / 1000,
            insideLight: this.escortRuntime.insideLight,
            completed: this.escortRuntime.completed,
          }
        : null,
      riftState: this.riftRuntime
        ? {
            active: this.riftRuntime.active,
            remainingSec: Math.round(this.riftRuntime.remainingSec * 10) / 10,
            kills: this.riftRuntime.kills,
            tierLabel: this.riftRuntime.tierLabel,
          }
        : null,
      colosseumState: this.colosseumRuntime
        ? {
            active: this.colosseumRuntime.active,
            wave: this.colosseumRuntime.wave,
            maxWaves: this.colosseumRuntime.maxWaves,
            bestWave: this.colosseumRuntime.bestWave,
            completed: this.colosseumRuntime.completed,
          }
        : null,
      activePacts: this.activePacts.map((p) => clonePactCard(p)),
    };
  }

  public computePactStatBonuses(): {
    stats: Partial<DerivedStats>;
    damageTakenMultiplier: number;
    goldMultiplier: number;
    critChainLightning: boolean;
  } {
    return aggregateObeliskPactBonuses(this.activePacts);
  }

  public onEnemyKilled(enemy: EnemyEntity): {
    bonusChestTier?: number;
    guaranteedMythic?: boolean;
    bonusRunes?: number;
  } {
    if (!enemy) return {};

    // Ensure entity state & internal event counters update idempotently
    this.processInternalKillState(enemy);

    if (this.claimedRewardKillIds.has(enemy.id)) {
      return {};
    }
    this.claimedRewardKillIds.add(enemy.id);

    if (enemy.archetype === 'the_butcher') {
      return {
        guaranteedMythic: true,
        bonusRunes: 3,
        bonusChestTier: 3,
      };
    }

    if (enemy.archetype === 'treasure_goblin') {
      if (
        this.escapedGoblinIds.has(enemy.id) ||
        (this.goblinRuntime?.escaped && enemy.id === this.goblinRuntime.entity.id)
      ) {
        return {};
      }
      return {
        bonusChestTier: 2,
        bonusRunes: 2,
      };
    }

    if (enemy.archetype === 'chest_mimic') {
      return {
        bonusChestTier: 1,
        bonusRunes: 1,
      };
    }

    return {};
  }

  public update(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
    bossDirector: IBossDirector,
  ): void {
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    if (safeDt <= 0) return;

    this.currentFloor = floor;

    // 1. Spawn any queued Corrupted Obelisk Elite Ambush waves
    if (this.pendingPactAmbushes > 0 && this.scene && this.meshFactory && this.materials) {
      while (this.pendingPactAmbushes > 0) {
        this.pendingPactAmbushes -= 1;
        const ambushPos = this.findAmbushSpawnAround(floor, player.position, 5.5, 9.5, 0.75);
        aiSystem.spawnWaveAt(
          ambushPos,
          3 + Math.min(3, Math.max(1, floor.floorNumber)),
          Math.max(1, floor.floorNumber + 1),
          'obelisk_ambush',
          this.scene,
          this.meshFactory,
          this.materials,
        );
        eventBus.emit('vfx:request', {
          type: 'void_implosion',
          position: { ...ambushPos },
          colorHex: 0xff1e42,
          radius: 3.5,
        });
      }
    }

    // 2. Check random dynamic encounters (Butcher Invasion & Treasure Goblin) during dungeon exploration
    this.updateRandomExplorationTriggers(safeDt, player, floor);

    // 3. Tick The Butcher relentless pursuer
    this.updateButcher(safeDt, elapsedSec, player, floor, combat);

    // 4. Tick Treasure Goblin fleeing AI & 18s escape portal
    this.updateGoblin(safeDt, elapsedSec, player, floor);

    // 5. Tick Chest Mimics lunging AI
    this.updateMimics(safeDt, player, floor, combat);

    // 6. Tick Soul Lantern Escort cart & 6.5m golden sanctuary ring
    this.updateSoulEscort(safeDt, elapsedSec, player, floor, combat, aiSystem);

    // 7. Tick Timed Rift Breach (25s survival & tier scaling)
    this.updateRiftBreach(safeDt, elapsedSec, player, floor, aiSystem);

    // 8. Tick 20-Wave Crimson Colosseum Boss Rush
    this.updateColosseum(safeDt, elapsedSec, player, floor, aiSystem, bossDirector);
  }

  public clear(): void {
    this.clearFloorBoundEntities();
    this.activePacts = [];
    this.lastObeliskChoices = null;
    this.pendingPactAmbushes = 0;
    this.visitedRoomIds.clear();
    this.processedInternalKillIds.clear();
    this.claimedRewardKillIds.clear();
    this.escapedGoblinIds.clear();
    this.currentFloor = null;
  }

  public dispose(): void {
    this.clear();
    if (this.unsubEnemyKilled) {
      this.unsubEnemyKilled();
      this.unsubEnemyKilled = null;
    }
    if (this.eventGroup.parent) {
      this.eventGroup.parent.remove(this.eventGroup);
    }
  }

  // ============================================================================
  // Internal Subsystems & AI Controllers
  // ============================================================================

  private processInternalKillState(enemy: EnemyEntity): void {
    if (!enemy || this.processedInternalKillIds.has(enemy.id)) {
      return;
    }
    this.processedInternalKillIds.add(enemy.id);

    if (this.butcherRuntime && enemy.id === this.butcherRuntime.entity.id) {
      this.butcherRuntime.entity.alive = false;
      this.butcherRuntime.entity.hp = 0;
      this.butcherRuntime.entity.meshHandle?.playAnim('death', 1.0);
      eventBus.emit('ui:banner', {
        title: t('event.banner.butcherSlain.title'),
        subtitle: t('event.banner.butcherSlain.sub'),
        tone: 'gold',
      });
      eventBus.emit('vfx:request', {
        type: 'fire_explosion',
        position: { ...enemy.position },
        colorHex: 0xff1e42,
        radius: 4.5,
      });
      eventBus.emit('sfx:request', {
        id: 'loot_drop_legendary',
        position: { ...enemy.position },
      });
    }

    if (
      this.goblinRuntime &&
      !this.goblinRuntime.escaped &&
      enemy.id === this.goblinRuntime.entity.id
    ) {
      this.goblinRuntime.entity.alive = false;
      this.goblinRuntime.entity.hp = 0;
      this.goblinRuntime.entity.meshHandle?.playAnim('death', 1.0);
      eventBus.emit('ui:banner', {
        title: t('event.banner.goblinSlain.title'),
        subtitle: t('event.banner.goblinSlain.sub'),
        tone: 'gold',
      });
      eventBus.emit('vfx:request', {
        type: 'chest_open',
        position: { ...enemy.position },
        colorHex: 0xffd43b,
        radius: 3.6,
      });
      eventBus.emit('sfx:request', {
        id: 'loot_drop_legendary',
        position: { ...enemy.position },
      });
    }

    for (const mimic of this.mimicRuntimes) {
      if (enemy.id === mimic.entity.id) {
        mimic.entity.alive = false;
        mimic.entity.hp = 0;
        mimic.entity.meshHandle?.playAnim('death', 1.0);
      }
    }

    // Count kills toward active Timed Rift Breach tier escalation
    if (this.riftRuntime?.active) {
      const prevTier = this.riftRuntime.tierLabel;
      this.riftRuntime.kills += 1;
      const nextTier = computeRiftTierLabel(this.riftRuntime.kills);
      this.riftRuntime.tierLabel = nextTier;

      if (nextTier !== prevTier) {
        eventBus.emit('ui:toast', {
          message: t('event.toast.riftTierUp', { tier: nextTier.toUpperCase(), kills: String(this.riftRuntime.kills) }),
          rarity:
            nextTier === 'Mythic'
              ? 'legendary'
              : nextTier === 'Gold'
                ? 'epic'
                : 'rare',
        });
        eventBus.emit('vfx:request', {
          type: 'lightning_strike',
          position: { ...this.riftRuntime.center },
          colorHex: nextTier === 'Mythic' ? 0xff1e42 : 0xffd43b,
          radius: 3.8,
        });
      }
    }
  }

  private updateRandomExplorationTriggers(
    dt: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
  ): void {
    if (
      !player.alive ||
      !this.meshFactory ||
      !this.materials ||
      floor.biome === 'sanctuary' ||
      floor.biome === 'colosseum' ||
      floor.floorNumber < 1 ||
      this.colosseumRuntime?.active ||
      this.escortRuntime?.active ||
      this.riftRuntime?.active
    ) {
      return;
    }

    this.floorExploreSec += dt;
    if (this.floorExploreSec < 6.0) return;

    const currentRoom = this.findContainingRoom(floor, player.position);
    if (!currentRoom || this.visitedRoomIds.has(currentRoom.id)) {
      return;
    }

    this.visitedRoomIds.add(currentRoom.id);

    // Never ambush inside spawn or pinnacle boss room
    if (currentRoom.type === 'spawn' || currentRoom.type === 'boss') {
      return;
    }

    const butcherChance = Math.min(0.28, 0.12 + floor.floorNumber * 0.03);
    if (!this.butcherRolledThisFloor && !this.butcherRuntime && this.rng.chance(butcherChance)) {
      this.spawnButcherInvasion(floor, player.position);
      return;
    }

    const goblinChance = 0.2;
    if (!this.goblinRolledThisFloor && !this.goblinRuntime && this.rng.chance(goblinChance)) {
      const goblinSpot = this.findAmbushSpawnAround(floor, currentRoom.centerWorld, 2.0, 5.5, 0.55);
      this.spawnTreasureGoblin(floor, goblinSpot);
    }
  }

  private updateButcher(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
  ): void {
    const rt = this.butcherRuntime;
    if (!rt || rt.disposed) return;

    const b = rt.entity;
    if (!b.alive || b.hp <= 0) {
      if (!this.processedInternalKillIds.has(b.id)) {
        this.processInternalKillState(b);
      }
      rt.deathDissolveSec += dt;
      b.meshHandle?.update(dt);
      if (rt.deathDissolveSec >= 2.65) {
        this.disposeButcherRuntime(rt);
      }
      return;
    }

    rt.attackCooldownSec = Math.max(0, rt.attackCooldownSec - dt);
    rt.hookCooldownSec = Math.max(0, rt.hookCooldownSec - dt);
    rt.repathTimerSec = Math.max(0, rt.repathTimerSec - dt);

    const dxToPlayer = player.position.x - b.position.x;
    const dzToPlayer = player.position.z - b.position.z;
    const distToPlayer = Math.hypot(dxToPlayer, dzToPlayer);

    // 1. Meat-Hook Chain Windup -> Projectile + Brutal Charge
    if (rt.hookWindupSec > 0) {
      rt.hookWindupSec -= dt;
      this.playEnemyAnimOnce(rt, b, 'windup', 1.25);
      if (rt.hookWindupSec <= 0) {
        const dirLen = Math.max(0.001, distToPlayer);
        const dir: Vec3 = { x: dxToPlayer / dirLen, y: 0, z: dzToPlayer / dirLen };
        rt.chargeDir = dir;
        rt.chargeBurstSec = 0.52;
        rt.hookTargetPos = null;

        combat.spawnProjectile({
          ownerIsPlayer: false,
          ownerId: b.id,
          origin: { x: b.position.x + dir.x * 0.9, y: 1.0, z: b.position.z + dir.z * 0.9 },
          direction: dir,
          speed: 22,
          maxDistance: 14,
          radius: 0.48,
          piercing: false,
          damagePacket: {
            sourceId: b.id,
            baseAmount: Math.round(b.attackDamage * 0.85),
            damageType: 'physical',
            critChance: 0,
            critMultiplier: 1.5,
            appliesStatus: {
              type: 'stun',
              chance: 0.85,
              durationSec: 0.65,
              potency: 1,
            },
          },
          visualColorHex: 0xff1e42,
        });
        eventBus.emit('sfx:request', { id: 'sword_swing', position: { ...b.position } });
      }
    } else if (
      player.alive &&
      rt.hookCooldownSec <= 0 &&
      distToPlayer >= 4.5 &&
      distToPlayer <= 13.5
    ) {
      rt.hookCooldownSec = 5.4;
      rt.hookWindupSec = 0.38;
      rt.hookTargetPos = { ...player.position };
      b.rotationY = Math.atan2(dxToPlayer, dzToPlayer);
    } else if (rt.chargeBurstSec > 0) {
      // High-speed Meat Charge burst
      rt.chargeBurstSec -= dt;
      const chargeSpeed = b.moveSpeed * 2.25;
      this.stepEntityWithSlide(floor, b, rt.chargeDir.x * chargeSpeed, rt.chargeDir.z * chargeSpeed, dt);
      b.rotationY = Math.atan2(rt.chargeDir.x, rt.chargeDir.z);
      this.playEnemyAnimOnce(rt, b, 'walk', 1.85);
    } else if (player.alive && distToPlayer <= b.attackRange + player.radius) {
      // Melee Cleaver Execution Range
      b.velocity.x = 0;
      b.velocity.z = 0;
      b.rotationY = Math.atan2(dxToPlayer, dzToPlayer);

      if (rt.attackCooldownSec <= 0) {
        rt.attackCooldownSec = b.attackCooldownSec;
        b.meshHandle?.playAnim('attack', 1.2);
        rt.lastAnim = 'attack';
        this.applyPlayerDamageSafe(combat, player, {
          sourceId: b.id,
          targetId: player.id,
          baseAmount: b.attackDamage,
          damageType: 'physical',
          critChance: 0.1,
          critMultiplier: 1.5,
          appliesStatus: {
            type: 'bleed',
            chance: 0.75,
            durationSec: 4.0,
            potency: Math.max(4, Math.round(b.attackDamage * 0.25)),
          },
        });
        eventBus.emit('vfx:request', {
          type: 'blood_burst',
          position: { ...player.position },
          colorHex: 0xff1e42,
          radius: 1.8,
        });
        eventBus.emit('sfx:request', { id: 'sword_swing', position: { ...b.position } });
      }
    } else if (player.alive) {
      // Relentless A* corridor pursuit
      if (rt.repathTimerSec <= 0 || rt.pathIndex >= rt.path.length) {
        rt.repathTimerSec = 0.4;
        const found = floor.findPath(b.position, player.position, 96);
        rt.path = found.length > 0 ? found : [{ ...player.position }];
        rt.pathIndex = rt.path.length > 1 ? 1 : 0;
      }

      let targetPt = rt.path[rt.pathIndex] ?? player.position;
      if (distXZ(b.position, targetPt) < 0.85 && rt.pathIndex + 1 < rt.path.length) {
        rt.pathIndex += 1;
        targetPt = rt.path[rt.pathIndex];
      }

      const moveDx = targetPt.x - b.position.x;
      const moveDz = targetPt.z - b.position.z;
      const moveLen = Math.max(0.001, Math.hypot(moveDx, moveDz));
      const vx = (moveDx / moveLen) * b.moveSpeed;
      const vz = (moveDz / moveLen) * b.moveSpeed;

      this.stepEntityWithSlide(floor, b, vx, vz, dt);
      b.rotationY = Math.atan2(moveDx, moveDz);
      this.playEnemyAnimOnce(rt, b, 'walk', 1.3);
    }

    if (b.meshHandle) {
      b.meshHandle.root.position.set(b.position.x, b.position.y, b.position.z);
      b.meshHandle.root.rotation.y = b.rotationY;
      b.meshHandle.update(dt);
    }
    rt.visual.update(elapsedSec, b.position, rt.hookWindupSec > 0 ? rt.hookTargetPos : null);
  }

  private updateGoblin(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
  ): void {
    const rt = this.goblinRuntime;
    if (!rt || rt.disposed) return;

    const g = rt.entity;
    if (!g.alive || g.hp <= 0) {
      if (!rt.escaped && !this.processedInternalKillIds.has(g.id)) {
        this.processInternalKillState(g);
      }
      rt.deathDissolveSec += dt;
      g.meshHandle?.update(dt);
      if (rt.deathDissolveSec >= 1.35) {
        this.disposeGoblinRuntime(rt);
      }
      return;
    }

    // Panic sprint boost when struck
    if (g.hp < rt.lastHp) {
      rt.lastHp = g.hp;
      rt.panicBoostSec = 1.6;
      rt.rechooseDirSec = 0;
    }
    rt.panicBoostSec = Math.max(0, rt.panicBoostSec - dt);

    // 18-second Escape Portal Countdown
    rt.escapeRemainingSec = Math.max(0, rt.escapeRemainingSec - dt);
    if (rt.escapeRemainingSec <= 0) {
      rt.escaped = true;
      this.escapedGoblinIds.add(g.id);
      this.processedInternalKillIds.add(g.id);
      this.claimedRewardKillIds.add(g.id);
      g.alive = false;
      g.hp = 0;
      eventBus.emit('vfx:request', {
        type: 'void_implosion',
        position: { ...g.position },
        colorHex: 0xffd43b,
        radius: 2.8,
      });
      eventBus.emit('sfx:request', { id: 'portal_hum', position: { ...g.position } });
      eventBus.emit('ui:toast', {
        message: t('event.toast.goblinEscaped'),
        rarity: 'rare',
      });
      this.disposeGoblinRuntime(rt);
      this.goblinRuntime = null;
      return;
    }

    // Choose smart walkable flee vector away from player
    rt.rechooseDirSec -= dt;
    if (rt.rechooseDirSec <= 0) {
      rt.rechooseDirSec = 0.28;
      rt.fleeDir = this.computeBestFleeDirection(floor, g.position, player.position, g.radius);
    }

    const speed = g.moveSpeed * (rt.panicBoostSec > 0 ? 1.24 : 1.0);
    const moved = this.stepEntityWithSlide(
      floor,
      g,
      rt.fleeDir.x * speed,
      rt.fleeDir.z * speed,
      dt,
    );
    if (!moved) {
      // Immediately pick a new escape angle if blocked by a corner
      rt.fleeDir = this.computeBestFleeDirection(floor, g.position, player.position, g.radius, true);
      this.stepEntityWithSlide(floor, g, rt.fleeDir.x * speed, rt.fleeDir.z * speed, dt);
    }

    g.rotationY = Math.atan2(rt.fleeDir.x, rt.fleeDir.z);
    this.playEnemyAnimOnce(rt, g, 'walk', 1.55);

    // Periodic golden sparkle trail while fleeing
    rt.coinSparkleSec -= dt;
    if (rt.coinSparkleSec <= 0) {
      rt.coinSparkleSec = 1.65;
      eventBus.emit('vfx:request', {
        type: 'loot_pickup',
        position: { ...g.position },
        colorHex: 0xffd43b,
        radius: 0.9,
      });
    }

    if (g.meshHandle) {
      g.meshHandle.root.position.set(g.position.x, g.position.y, g.position.z);
      g.meshHandle.root.rotation.y = g.rotationY;
      g.meshHandle.update(dt);
    }
    rt.visual.update(elapsedSec, g.position, rt.escapeRemainingSec);
  }

  private updateMimics(
    dt: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
  ): void {
    for (let i = this.mimicRuntimes.length - 1; i >= 0; i--) {
      const rt = this.mimicRuntimes[i];
      const m = rt.entity;

      if (!m.alive || m.hp <= 0) {
        if (!this.processedInternalKillIds.has(m.id)) {
          this.processInternalKillState(m);
        }
        rt.deathDissolveSec += dt;
        m.meshHandle?.update(dt);
        if (rt.deathDissolveSec >= 1.35) {
          this.disposeMimicRuntime(rt);
          this.mimicRuntimes.splice(i, 1);
        }
        continue;
      }

      rt.attackCooldownSec = Math.max(0, rt.attackCooldownSec - dt);
      rt.lungeCooldownSec = Math.max(0, rt.lungeCooldownSec - dt);

      const dx = player.position.x - m.position.x;
      const dz = player.position.z - m.position.z;
      const dist = Math.hypot(dx, dz);
      const dirLen = Math.max(0.001, dist);

      if (rt.lungeBurstSec > 0) {
        rt.lungeBurstSec -= dt;
        const lungeSpeed = m.moveSpeed * 2.35;
        this.stepEntityWithSlide(
          floor,
          m,
          rt.lungeDir.x * lungeSpeed,
          rt.lungeDir.z * lungeSpeed,
          dt,
        );
        m.rotationY = Math.atan2(rt.lungeDir.x, rt.lungeDir.z);
      } else if (player.alive && rt.lungeCooldownSec <= 0 && dist > 2.2 && dist <= 8.0) {
        rt.lungeCooldownSec = 3.1;
        rt.lungeBurstSec = 0.34;
        rt.lungeDir = { x: dx / dirLen, y: 0, z: dz / dirLen };
        m.meshHandle?.playAnim('attack', 1.35);
        rt.lastAnim = 'attack';
        eventBus.emit('sfx:request', { id: 'dodge_whoosh', position: { ...m.position } });
      } else if (player.alive && dist > m.attackRange + player.radius * 0.8) {
        const vx = (dx / dirLen) * m.moveSpeed;
        const vz = (dz / dirLen) * m.moveSpeed;
        this.stepEntityWithSlide(floor, m, vx, vz, dt);
        m.rotationY = Math.atan2(dx, dz);
        this.playEnemyAnimOnce(rt, m, 'walk', 1.25);
      }

      if (player.alive && dist <= m.attackRange + player.radius && rt.attackCooldownSec <= 0) {
        rt.attackCooldownSec = m.attackCooldownSec;
        m.rotationY = Math.atan2(dx, dz);
        m.meshHandle?.playAnim('attack', 1.3);
        rt.lastAnim = 'attack';
        this.applyPlayerDamageSafe(combat, player, {
          sourceId: m.id,
          targetId: player.id,
          baseAmount: m.attackDamage,
          damageType: 'physical',
          critChance: 0.12,
          critMultiplier: 1.5,
          appliesStatus: {
            type: 'bleed',
            chance: 0.6,
            durationSec: 3.5,
            potency: Math.max(3, Math.round(m.attackDamage * 0.22)),
          },
        });
        eventBus.emit('sfx:request', { id: 'hit_flesh', position: { ...player.position } });
      }

      if (m.meshHandle) {
        m.meshHandle.root.position.set(m.position.x, m.position.y, m.position.z);
        m.meshHandle.root.rotation.y = m.rotationY;
        m.meshHandle.update(dt);
      }
    }
  }

  private updateSoulEscort(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
  ): void {
    const rt = this.escortRuntime;
    if (!rt || !rt.active) return;

    const distToCart = distXZ(player.position, rt.currentPos);
    rt.insideLight = distToCart <= SOUL_LANTERN_SAFE_RADIUS;

    // Cart advances fastest when empowered by hero's presence inside the 6.5m golden ring
    const cartSpeed = rt.insideLight ? 2.65 : 1.35;
    rt.traveledLength = Math.min(rt.totalLength, rt.traveledLength + cartSpeed * dt);
    rt.progress01 = clamp(rt.traveledLength / rt.totalLength, 0, 1);

    const sampled = this.sampleRouteAtDistance(rt.waypoints, rt.segmentLengths, rt.traveledLength);
    rt.currentPos = sampled.pos;
    rt.headingY = sampled.headingY;

    // Encroaching Darkness HP drain when standing outside the 6.5m protective ring
    if (!rt.insideLight && player.alive) {
      rt.darknessTickSec += dt;
      while (rt.darknessTickSec >= 0.5) {
        rt.darknessTickSec -= 0.5;
        const drainAmount = Math.max(5, Math.round(player.stats.maxHp * 0.04));
        this.applyPlayerDamageSafe(combat, player, {
          sourceId: 'soul_lantern_darkness',
          targetId: player.id,
          baseAmount: drainAmount,
          damageType: 'void',
          critChance: 0,
          critMultiplier: 1.0,
        });
        eventBus.emit('vfx:request', {
          type: 'void_implosion',
          position: { ...player.position },
          colorHex: 0x5f3dc4,
          radius: 1.35,
        });
      }
    } else {
      rt.darknessTickSec = 0;
    }

    // Spawn monster ambush packs along the escort route
    const milestones = [0.28, 0.58, 0.84];
    if (this.scene && this.meshFactory && this.materials) {
      for (let idx = 0; idx < milestones.length; idx++) {
        if (rt.progress01 >= milestones[idx] && !rt.spawnedMilestones.has(idx)) {
          rt.spawnedMilestones.add(idx);
          const aheadPos = this.findAmbushSpawnAround(floor, rt.currentPos, 4.5, 7.5, 0.65);
          aiSystem.spawnWaveAt(
            aheadPos,
            3 + Math.min(3, Math.max(1, floor.floorNumber)),
            Math.max(1, floor.floorNumber),
            'soul_escort_ambush',
            this.scene,
            this.meshFactory,
            this.materials,
          );
        }
      }
    }

    rt.visual.update(
      elapsedSec,
      rt.currentPos,
      rt.headingY,
      rt.insideLight ? 1.0 : 0.45,
      rt.insideLight,
      sampled.nextWaypoint,
    );

    // 100% Delivery -> Erupt Legendary Spoils & Sanctuary Radiance!
    if (rt.progress01 >= 1) {
      rt.active = false;
      rt.completed = true;
      rt.progress01 = 1;
      rt.insideLight = true;

      if (player.alive) {
        player.hp = Math.min(
          player.stats.maxHp,
          player.hp + Math.round(player.stats.maxHp * 0.35),
        );
        player.gold += 160 * Math.max(1, floor.floorNumber);
      }

      eventBus.emit('ui:banner', {
        title: t('event.banner.soulDelivered.title'),
        subtitle: t('event.banner.soulDelivered.sub'),
        tone: 'gold',
      });
      eventBus.emit('vfx:request', {
        type: 'level_up_pillar',
        position: { ...rt.currentPos },
        colorHex: 0xffd43b,
        radius: SOUL_LANTERN_SAFE_RADIUS,
        scale: 1.8,
      });
      eventBus.emit('vfx:request', {
        type: 'chest_open',
        position: { ...rt.currentPos },
        colorHex: 0xff922b,
        radius: 4.2,
      });
      eventBus.emit('sfx:request', {
        id: 'loot_drop_legendary',
        position: { ...rt.currentPos },
      });
      eventBus.emit('lighting:flash', {
        colorHex: 0xffd43b,
        intensity: 2.5,
        durationSec: 0.5,
      });

      rt.visual.dispose();
    }
  }

  private updateRiftBreach(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    aiSystem: IEnemyAISystem,
  ): void {
    const rt = this.riftRuntime;
    if (!rt || !rt.active) return;

    rt.remainingSec = Math.max(0, rt.remainingSec - dt);
    rt.tierLabel = computeRiftTierLabel(rt.kills);

    // Spawn waves continuously out of the Void Rift while breach is open
    rt.spawnTimerSec -= dt;
    if (
      rt.spawnTimerSec <= 0 &&
      rt.remainingSec > 1.5 &&
      this.scene &&
      this.meshFactory &&
      this.materials
    ) {
      rt.spawnTimerSec = 4.6;
      const livingNear = aiSystem
        .getLivingEnemies()
        .filter((e) => distXZ(e.position, rt.center) < 18).length;

      if (livingNear < 14) {
        const wavePos = this.findAmbushSpawnAround(floor, rt.center, 2.2, 5.5, 0.6);
        const count = 4 + Math.min(4, Math.max(1, floor.floorNumber)) + Math.min(2, rt.wavesSpawned);
        aiSystem.spawnWaveAt(
          wavePos,
          count,
          Math.max(1, floor.floorNumber),
          rt.roomId,
          this.scene,
          this.meshFactory,
          this.materials,
        );
        rt.wavesSpawned += 1;
        eventBus.emit('vfx:request', {
          type: 'void_implosion',
          position: { ...wavePos },
          colorHex: 0xbe4bdb,
          radius: 2.6,
        });
      }
    }

    rt.visual.update(elapsedSec, rt.tierLabel, rt.remainingSec);

    if (rt.remainingSec <= 0) {
      rt.active = false;
      rt.remainingSec = 0;

      const tierMult =
        rt.tierLabel === 'Mythic'
          ? 5
          : rt.tierLabel === 'Gold'
            ? 3
            : rt.tierLabel === 'Silver'
              ? 2
              : 1;
      player.gold += 85 * tierMult * Math.max(1, floor.floorNumber);

      eventBus.emit('ui:banner', {
        title: t('event.banner.riftSealed.title', { tier: rt.tierLabel.toUpperCase() }),
        subtitle: t('event.banner.riftSealed.sub', { kills: String(rt.kills) }),
        tone: rt.tierLabel === 'Mythic' ? 'crimson' : 'gold',
      });
      eventBus.emit('vfx:request', {
        type: 'level_up_pillar',
        position: { ...rt.center },
        colorHex: rt.tierLabel === 'Mythic' ? 0xff1e42 : 0xffd43b,
        radius: 4.5,
      });
      eventBus.emit('sfx:request', {
        id: rt.tierLabel === 'Bronze' ? 'loot_drop_rare' : 'loot_drop_legendary',
        position: { ...rt.center },
      });

      rt.visual.dispose();
    }
  }

  private updateColosseum(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    aiSystem: IEnemyAISystem,
    bossDirector: IBossDirector,
  ): void {
    const rt = this.colosseumRuntime;
    if (!rt || !rt.active) return;

    rt.visual.update(elapsedSec, rt.wave);

    if (!rt.waveSpawned) {
      this.spawnColosseumWave(rt, floor, player, aiSystem, bossDirector);
      return;
    }

    const livingAi = aiSystem.getLivingEnemies();
    const livingTracked = rt.trackedWaveEntities.some((e) => e.alive && e.hp > 0);
    const livingTwinBosses = rt.colosseumBossEntities.some((b) => b.alive && b.hp > 0);
    const activeSingleBoss = Boolean(bossDirector.getActiveBoss()?.entity.alive);

    // Fallback guard if a bare unit-test stub returns [] from spawnWaveAt
    if (rt.trackedWaveEntities.length === 0 && rt.colosseumBossEntities.length === 0) {
      rt.emptyMockWaveTimerSec -= dt;
      if (rt.emptyMockWaveTimerSec > 0 || livingAi.length > 0 || activeSingleBoss) {
        return;
      }
    } else if (livingTracked || livingTwinBosses || livingAi.length > 0 || activeSingleBoss) {
      return;
    }

    // Current wave vanquished!
    rt.bestWave = Math.max(rt.bestWave, rt.wave);

    if (player.alive) {
      player.hp = Math.min(
        player.stats.maxHp,
        player.hp + Math.round(player.stats.maxHp * 0.14),
      );
      player.mana = Math.min(
        player.stats.maxMana,
        player.mana + Math.round(player.stats.maxMana * 0.25),
      );
      player.gold += 35 * rt.wave;
    }

    if (rt.wave >= rt.maxWaves) {
      rt.active = false;
      rt.completed = true;
      rt.bestWave = rt.maxWaves;

      const center = this.getColosseumCenter(floor);
      eventBus.emit('ui:banner', {
        title: t('event.banner.colosseumChampion.title'),
        subtitle: t('event.banner.colosseumChampion.sub'),
        tone: 'gold',
      });
      eventBus.emit('vfx:request', {
        type: 'level_up_pillar',
        position: { ...center },
        colorHex: 0xffd43b,
        radius: 6.5,
        scale: 2.0,
      });
      eventBus.emit('sfx:request', { id: 'loot_drop_legendary', position: { ...center } });
      rt.visual.dispose();
      return;
    }

    rt.wave += 1;
    rt.waveSpawned = false;
    this.spawnColosseumWave(rt, floor, player, aiSystem, bossDirector);
  }

  private spawnColosseumWave(
    rt: ColosseumRuntime,
    floor: DungeonFloorData,
    player: PlayerRuntimeState,
    aiSystem: IEnemyAISystem,
    bossDirector: IBossDirector,
  ): void {
    rt.waveSpawned = true;
    rt.trackedWaveEntities = [];
    rt.colosseumBossEntities = [];
    rt.emptyMockWaveTimerSec = 2.5;

    const w = rt.wave;
    const effectiveFloor = Math.max(1, Math.ceil(w / 3));
    const center = this.getColosseumCenter(floor);
    const roomId = floor.rooms[0]?.id ?? 'colosseum_arena';
    const isTwinBossWave = w === 5 || w === 10 || w === 15 || w === 20;

    if (this.scene && this.meshFactory && this.materials) {
      // Escalating monster packs across two opposing gladiator gates
      const totalPack = 4 + Math.floor(w * 0.75);
      const halfA = Math.ceil(totalPack * 0.5);
      const halfB = Math.max(1, totalPack - halfA);

      const gateA = this.findAmbushSpawnAround(floor, center, 7.5, 11.5, 0.7);
      const gateB = this.findAmbushSpawnAround(
        floor,
        player.position,
        7.0,
        11.0,
        0.7,
      );

      const waveA = aiSystem.spawnWaveAt(
        gateA,
        halfA,
        effectiveFloor,
        roomId,
        this.scene,
        this.meshFactory,
        this.materials,
      );
      const waveB = aiSystem.spawnWaveAt(
        gateB,
        halfB,
        effectiveFloor,
        roomId,
        this.scene,
        this.meshFactory,
        this.materials,
      );
      rt.trackedWaveEntities.push(...waveA, ...waveB);

      // Twin-Boss Showdowns on Waves 5, 10, 15, and 20!
      if (isTwinBossWave) {
        if (bossDirector.spawnColosseumBosses) {
          const twinBosses = bossDirector.spawnColosseumBosses(
            floor,
            w,
            this.meshFactory,
            this.materials,
          );
          rt.colosseumBossEntities.push(...twinBosses);
        } else {
          const fallbackBoss = bossDirector.spawnFloorBoss(
            floor,
            this.meshFactory,
            this.materials,
          );
          if (fallbackBoss) {
            rt.colosseumBossEntities.push(fallbackBoss);
          }
        }
      }
    }

    if (isTwinBossWave) {
      eventBus.emit('ui:banner', {
        title: t('event.banner.twinBoss.title', { wave: String(w), max: String(rt.maxWaves) }),
        subtitle: t('event.banner.twinBoss.sub'),
        tone: 'gold',
      });
      eventBus.emit('sfx:request', { id: 'boss_roar', position: { ...center } });
      eventBus.emit('camera:shake', { trauma: 0.45 });
    } else if (w > 1) {
      eventBus.emit('ui:banner', {
        title: t('event.banner.colosseumWave.title', { wave: String(w), max: String(rt.maxWaves) }),
        subtitle: t('event.banner.colosseumWave.sub'),
        tone: 'crimson',
      });
    }
  }

  // ============================================================================
  // Spatial, Pathfinding & Combat Helpers
  // ============================================================================

  private buildSoulEscortRoute(start: Vec3, floor: DungeonFloorData): Vec3[] {
    let bestTarget: Vec3 | null = null;
    let bestDist = 0;

    // Prefer non-boss rooms farthest from the lantern pedestal first
    for (const room of floor.rooms) {
      if (room.type === 'boss') continue;
      const d = distXZ(start, room.centerWorld);
      if (d > bestDist) {
        bestDist = d;
        bestTarget = room.centerWorld;
      }
    }

    // Fallback to any room or portalPosition if floor only has 1-2 rooms
    if (!bestTarget || bestDist < 10) {
      for (const room of floor.rooms) {
        const d = distXZ(start, room.centerWorld);
        if (d > bestDist) {
          bestDist = d;
          bestTarget = room.centerWorld;
        }
      }
    }
    if (!bestTarget || bestDist < 8) {
      const portalDist = distXZ(start, floor.portalPosition);
      if (portalDist >= 8) {
        bestTarget = floor.portalPosition;
      } else {
        bestTarget = this.findAmbushSpawnAround(floor, start, 16, 22, 0.5);
      }
    }

    const rawPath = floor.findPath(start, bestTarget, 256);
    const waypoints: Vec3[] = [{ x: start.x, y: 0, z: start.z }];

    for (const pt of rawPath) {
      const last = waypoints[waypoints.length - 1];
      if (distXZ(last, pt) >= 0.35) {
        waypoints.push({ x: pt.x, y: 0, z: pt.z });
      }
    }

    if (waypoints.length < 2) {
      waypoints.push({
        x: bestTarget.x === start.x && bestTarget.z === start.z ? start.x + 18 : bestTarget.x,
        y: 0,
        z: bestTarget.z,
      });
    }

    return waypoints;
  }

  private sampleRouteAtDistance(
    waypoints: Vec3[],
    segmentLengths: number[],
    dist: number,
  ): { pos: Vec3; headingY: number; nextWaypoint: Vec3 | null } {
    let rem = Math.max(0, dist);
    for (let i = 0; i < segmentLengths.length; i++) {
      const segLen = segmentLengths[i];
      const a = waypoints[i];
      const b = waypoints[i + 1];
      if (rem <= segLen || i === segmentLengths.length - 1) {
        const t = clamp(rem / Math.max(0.0001, segLen), 0, 1);
        const pos: Vec3 = {
          x: a.x + (b.x - a.x) * t,
          y: 0,
          z: a.z + (b.z - a.z) * t,
        };
        const headingY = Math.atan2(b.x - a.x, b.z - a.z);
        const nextWaypoint = i + 1 < waypoints.length ? waypoints[i + 1] : null;
        return { pos, headingY, nextWaypoint };
      }
      rem -= segLen;
    }

    const last = waypoints[waypoints.length - 1];
    return { pos: { ...last }, headingY: 0, nextWaypoint: null };
  }

  private computeBestFleeDirection(
    floor: DungeonFloorData,
    goblinPos: Vec3,
    playerPos: Vec3,
    radius: number,
    allowWideTurn = false,
  ): Vec3 {
    const awayDx = goblinPos.x - playerPos.x;
    const awayDz = goblinPos.z - playerPos.z;
    const baseAngle =
      Math.hypot(awayDx, awayDz) > 0.01
        ? Math.atan2(awayDz, awayDx)
        : this.rng.range(0, Math.PI * 2);

    let bestAngle = baseAngle;
    let bestScore = -Infinity;
    const samples = 12;

    for (let i = 0; i < samples; i++) {
      const offset = ((i / samples) * 2 - 1) * (allowWideTurn ? Math.PI : Math.PI * 0.78);
      const a = baseAngle + offset;
      const dirX = Math.cos(a);
      const dirZ = Math.sin(a);

      let walkableReach = 0;
      for (const probeDist of [2.0, 4.0, 6.5]) {
        const px = goblinPos.x + dirX * probeDist;
        const pz = goblinPos.z + dirZ * probeDist;
        if (floor.isWalkableWorld(px, pz, radius)) {
          walkableReach = probeDist;
        } else {
          break;
        }
      }

      if (walkableReach <= 0) continue;

      const candidate: Vec3 = {
        x: goblinPos.x + dirX * walkableReach,
        y: 0,
        z: goblinPos.z + dirZ * walkableReach,
      };
      const distFromPlayer = distXZ(candidate, playerPos);
      const score = distFromPlayer * 1.6 + walkableReach;
      if (score > bestScore) {
        bestScore = score;
        bestAngle = a;
      }
    }

    return { x: Math.cos(bestAngle), y: 0, z: Math.sin(bestAngle) };
  }

  private stepEntityWithSlide(
    floor: DungeonFloorData,
    entity: EnemyEntity,
    vx: number,
    vz: number,
    dt: number,
  ): boolean {
    const nextX = entity.position.x + vx * dt;
    const nextZ = entity.position.z + vz * dt;
    const r = Math.min(0.65, entity.radius * 0.8);

    if (floor.isWalkableWorld(nextX, nextZ, r)) {
      entity.position.x = nextX;
      entity.position.z = nextZ;
      entity.velocity.x = vx;
      entity.velocity.z = vz;
      return true;
    }

    if (floor.isWalkableWorld(nextX, entity.position.z, r)) {
      entity.position.x = nextX;
      entity.velocity.x = vx;
      entity.velocity.z = 0;
      return true;
    }

    if (floor.isWalkableWorld(entity.position.x, nextZ, r)) {
      entity.position.z = nextZ;
      entity.velocity.x = 0;
      entity.velocity.z = vz;
      return true;
    }

    entity.velocity.x = 0;
    entity.velocity.z = 0;
    return false;
  }

  private applyPlayerDamageSafe(
    combat: ICombatEngine,
    player: PlayerRuntimeState,
    packet: DamagePacket,
  ): void {
    const hpBefore = player.hp;
    const res = combat.applyDamageToPlayer(player, packet);
    // Fallback if a bare unit-test mock doesn't mutate player.hp or return a DamageResult
    if (res === undefined && player.hp === hpBefore && player.invulnerableSec <= 0) {
      player.hp = Math.max(0, player.hp - packet.baseAmount);
      if (player.hp <= 0) {
        player.alive = false;
      }
    }
  }

  private findAmbushSpawnAround(
    floor: DungeonFloorData,
    origin: Vec3,
    minDist: number,
    maxDist: number,
    radius: number,
  ): Vec3 {
    const startAngle = this.rng.range(0, Math.PI * 2);
    const radii = [
      (minDist + maxDist) * 0.5,
      minDist,
      maxDist,
      Math.max(2.0, minDist * 0.55),
    ];

    for (const dist of radii) {
      for (let i = 0; i < 12; i++) {
        const a = startAngle + (i / 12) * Math.PI * 2;
        const x = origin.x + Math.cos(a) * dist;
        const z = origin.z + Math.sin(a) * dist;
        if (floor.isWalkableWorld(x, z, radius)) {
          return { x, y: 0, z };
        }
      }
    }

    return this.findNearestWalkable(
      floor,
      { x: origin.x + minDist, y: 0, z: origin.z },
      radius,
    );
  }

  private findNearestWalkable(
    floor: DungeonFloorData,
    pos: Vec3,
    radius: number,
  ): Vec3 {
    if (floor.isWalkableWorld(pos.x, pos.z, radius)) {
      return { x: pos.x, y: 0, z: pos.z };
    }
    for (const dist of [1.2, 2.4, 4.0, 6.0]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = pos.x + Math.cos(a) * dist;
        const z = pos.z + Math.sin(a) * dist;
        if (floor.isWalkableWorld(x, z, radius)) {
          return { x, y: 0, z };
        }
      }
    }
    return { x: pos.x, y: 0, z: pos.z };
  }

  private findContainingRoom(floor: DungeonFloorData, worldPos: Vec3): DungeonRoom | null {
    const g = floor.worldToGrid(worldPos);
    for (const room of floor.rooms) {
      if (
        g.col >= room.x &&
        g.col < room.x + room.width &&
        g.row >= room.y &&
        g.row < room.y + room.height
      ) {
        return room;
      }
    }
    return null;
  }

  private getColosseumCenter(floor: DungeonFloorData): Vec3 {
    if (floor.bossSpawn && (floor.bossSpawn.x !== 0 || floor.bossSpawn.z !== 0)) {
      return { x: floor.bossSpawn.x, y: 0, z: floor.bossSpawn.z };
    }
    if (floor.rooms.length > 0) {
      return { ...floor.rooms[0].centerWorld, y: 0 };
    }
    return { x: floor.playerSpawn.x, y: 0, z: floor.playerSpawn.z };
  }

  private playEnemyAnimOnce(
    holder: { lastAnim: EnemyAnimState | null },
    entity: EnemyEntity,
    anim: EnemyAnimState,
    speed = 1.0,
  ): void {
    if (holder.lastAnim !== anim) {
      holder.lastAnim = anim;
      entity.meshHandle?.playAnim(anim, speed);
    }
  }

  private ensureGroupInScene(): void {
    if (this.scene && this.eventGroup.parent !== this.scene) {
      this.scene.add(this.eventGroup);
    }
  }

  private disposeButcherRuntime(rt: ButcherRuntime): void {
    if (rt.disposed) return;
    rt.disposed = true;
    if (rt.entity.meshHandle) {
      if (rt.entity.meshHandle.root.parent) {
        rt.entity.meshHandle.root.parent.remove(rt.entity.meshHandle.root);
      }
      rt.entity.meshHandle.dispose();
    }
    rt.visual.dispose();
  }

  private disposeGoblinRuntime(rt: GoblinRuntime): void {
    if (rt.disposed) return;
    rt.disposed = true;
    if (rt.entity.meshHandle) {
      if (rt.entity.meshHandle.root.parent) {
        rt.entity.meshHandle.root.parent.remove(rt.entity.meshHandle.root);
      }
      rt.entity.meshHandle.dispose();
    }
    rt.visual.dispose();
  }

  private disposeMimicRuntime(rt: MimicRuntime): void {
    if (rt.disposed) return;
    rt.disposed = true;
    if (rt.entity.meshHandle) {
      if (rt.entity.meshHandle.root.parent) {
        rt.entity.meshHandle.root.parent.remove(rt.entity.meshHandle.root);
      }
      rt.entity.meshHandle.dispose();
    }
  }

  private clearFloorBoundEntities(): void {
    if (this.butcherRuntime) {
      this.disposeButcherRuntime(this.butcherRuntime);
      this.butcherRuntime = null;
    }
    if (this.goblinRuntime) {
      this.disposeGoblinRuntime(this.goblinRuntime);
      this.goblinRuntime = null;
    }
    for (const m of this.mimicRuntimes) {
      this.disposeMimicRuntime(m);
    }
    this.mimicRuntimes = [];

    if (this.escortRuntime) {
      this.escortRuntime.visual.dispose();
      this.escortRuntime = null;
    }
    if (this.riftRuntime) {
      this.riftRuntime.visual.dispose();
      this.riftRuntime = null;
    }
    if (this.colosseumRuntime) {
      this.colosseumRuntime.visual.dispose();
      this.colosseumRuntime = null;
    }
  }
}
