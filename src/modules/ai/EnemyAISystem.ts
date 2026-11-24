import type * as THREE from 'three';
import type {
  DamagePacket,
  DungeonFloorData,
  EliteAffix,
  EnemyAnimState,
  EnemyArchetypeId,
  EnemyEntity,
  ICombatEngine,
  IEnemyAISystem,
  IEnemyMeshFactory,
  IMaterialLibrary,
  PlayerRuntimeState,
  RoomType,
  Vec3,
} from '../../contracts/types';
import { distXZ, SeededRng } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  ARCHETYPE_CONFIGS,
  biomeForFloorNumber,
  buildRoomMonsterPack,
  computeScaledEnemyStats,
  generateEliteName,
  pickBiomeArchetype,
  rollEliteAffixes,
  type ArchetypeConfig,
} from './archetypes';
import { EliteAffixController } from './eliteAffixes';
import {
  computeSeparationForce,
  computeSurroundSlot,
  findRadialWalkableSpot,
  findRoomSpawnPosition,
  hasLineOfSight,
  lerpAngleY,
  moveWithWallSlide,
} from './steering';

type AIState = 'idle' | 'chase' | 'windup' | 'attack' | 'retreat';
type PendingAction = 'melee' | 'slam' | 'ranged' | 'summon';

interface EnemyRuntimeRecord {
  spawnIndex: number;
  config: ArchetypeConfig;
  baseMoveSpeed: number;
  state: AIState;
  pendingAction: PendingAction;
  aggroed: boolean;
  pendingPackAggro: boolean;
  aggroDelayTimer: number;
  stateTimer: number;
  attackCooldown: number;
  repathTimer: number;
  retreatCooldown: number;
  blinkCooldown: number;
  summonCooldown: number;
  flinchTimer: number;
  flinchImmunityTimer: number;
  backstabCharged: boolean;
  kiteWeaveSign: 1 | -1;
  surroundAngle: number;
  lockedAimAngle: number;
  path: Vec3[];
  pathIndex: number;
  lastPathGoal: Vec3;
  lastHp: number;
  lastOutVelocity: Vec3;
  knockbackVel: { x: number; z: number };
  lastAnimState: EnemyAnimState | null;
  lastAnimSpeed: number;
  deathStarted: boolean;
  deathTimer: number;
  meshDisposed: boolean;
  summonerOwnerId?: string;
  totalSummoned: number;
}

const POPULATED_ROOM_TYPES = new Set<RoomType>([
  'combat',
  'elite',
  'treasure',
  'cursed_event',
]);

const DEATH_CLEANUP_SEC = 1.35;
const MAX_ACTIVE_ENEMIES_FOR_SUMMON = 46;
const MAX_ACTIVE_MINIONS_PER_LICH = 3;
const MAX_TOTAL_SUMMONS_PER_LICH = 8;

// Performance tier → pathfinding throttle interval (seconds)
const AI_UPDATE_INTERVALS: Record<string, number> = {
  low: 0.5,
  medium: 0.3,
  high: 0.2,
  ultra: 0.1,
};

// Performance tier → max distance from player before AI is skipped entirely
const AI_DISTANCE_THRESHOLDS: Record<string, number> = {
  low: 25,
  medium: 35,
  high: Infinity,
  ultra: Infinity,
};

export class EnemyAISystem implements IEnemyAISystem {
  private enemies: EnemyEntity[] = [];
  private records = new Map<string, EnemyRuntimeRecord>();
  private trackedRoomIds = new Set<string>();
  private affixController = new EliteAffixController();

  private scene: THREE.Scene | null = null;
  private meshFactory: IEnemyMeshFactory | null = null;
  private materials: IMaterialLibrary | null = null;
  private currentFloor: DungeonFloorData | null = null;

  private nextEnemyCounter = 1;
  private rng = new SeededRng(0x9e3779b9);

  // Performance optimisation state
  private performanceTier: string = 'high';
  private aiUpdateInterval: number = AI_UPDATE_INTERVALS['high'];
  private distanceThreshold: number = AI_DISTANCE_THRESHOLDS['high'];
  private playerPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  /** Tracks the elapsed time since each enemy last ran a full AI update (for throttling). */
  private lastUpdateTime = new Map<string, number>();

  /** Set the active performance tier; adjusts AI throttle interval and culling distance. */
  setPerformanceTier(tier: string): void {
    this.performanceTier = tier;
    this.aiUpdateInterval = AI_UPDATE_INTERVALS[tier] ?? AI_UPDATE_INTERVALS['high'];
    this.distanceThreshold = AI_DISTANCE_THRESHOLDS[tier] ?? AI_DISTANCE_THRESHOLDS['high'];
  }

  /** Update the cached player world position used for distance-culling. */
  setPlayerPosition(pos: { x: number; y: number; z: number }): void {
    this.playerPosition.x = pos.x;
    this.playerPosition.y = pos.y;
    this.playerPosition.z = pos.z;
  }

  /** Returns the current per-enemy AI update interval in seconds. */
  getAIUpdateInterval(): number {
    return this.aiUpdateInterval;
  }

  spawnFloorEnemies(
    floor: DungeonFloorData,
    scene: THREE.Scene,
    meshFactory: IEnemyMeshFactory,
    materials: IMaterialLibrary,
  ): EnemyEntity[] {
    this.clear();

    this.scene = scene;
    this.meshFactory = meshFactory;
    this.materials = materials;
    this.currentFloor = floor;
    this.affixController.setScene(scene);

    const floorSeed = ((floor.seed || 1337) ^ Math.imul(floor.floorNumber || 1, 0x9e3779b9)) >>> 0;
    this.rng = new SeededRng(floorSeed || 1337);

    // Peaceful Sanctuary Hub never spawns hostile room packs
    if (floor.biome === 'sanctuary') {
      return [];
    }

    const spawned: EnemyEntity[] = [];
    const occupiedPositions: Vec3[] = [];

    for (const room of floor.rooms) {
      if (!POPULATED_ROOM_TYPES.has(room.type)) {
        continue;
      }

      const pack = buildRoomMonsterPack(room.type, floor.biome, floor.floorNumber, this.rng);
      if (pack.length === 0) continue;

      this.trackedRoomIds.add(room.id);
      room.cleared = false;

      for (const member of pack) {
        const cfg = ARCHETYPE_CONFIGS[member.archetype];
        const approxRadius = member.isElite ? cfg.radius * 1.2 : cfg.radius;
        const pos = findRoomSpawnPosition(floor, room, approxRadius, occupiedPositions, this.rng);
        occupiedPositions.push(pos);

        const entity = this.createSingleEnemy(
          member.archetype,
          member.isElite,
          member.affixes,
          pos,
          floor.floorNumber,
          room.id,
          1.0,
          false,
        );
        spawned.push(entity);
      }
    }

    return spawned;
  }

  spawnWaveAt(
    position: Vec3,
    count: number,
    floorNumber: number,
    roomId: string,
    scene: THREE.Scene,
    meshFactory: IEnemyMeshFactory,
    materials: IMaterialLibrary,
  ): EnemyEntity[] {
    this.scene = scene;
    this.meshFactory = meshFactory;
    this.materials = materials;
    this.affixController.setScene(scene);

    const safeCount = Math.max(0, Math.floor(count));
    if (safeCount === 0) return [];

    const rawBiome =
      this.currentFloor && this.currentFloor.floorNumber === floorNumber
        ? this.currentFloor.biome
        : biomeForFloorNumber(floorNumber);
    const biome = rawBiome === 'sanctuary' ? 'colosseum' : rawBiome;

    if (roomId) {
      this.trackedRoomIds.add(roomId);
      if (this.currentFloor) {
        const room = this.currentFloor.rooms.find((r) => r.id === roomId);
        if (room && room.type !== 'boss') {
          room.cleared = false;
        }
      }
    }

    const occupied: Vec3[] = this.getLivingEnemies().map((e) => e.position);
    const waveSpawned: EnemyEntity[] = [];

    for (let i = 0; i < safeCount; i++) {
      // Spawn 1 Champion Elite in waves of 4+ monsters
      const isElite = safeCount >= 4 && i === 0 && this.rng.chance(0.75);
      const affixes = isElite ? rollEliteAffixes(floorNumber, this.rng) : [];
      const archetype = pickBiomeArchetype(biome, this.rng);
      const cfg = ARCHETYPE_CONFIGS[archetype];
      const radius = isElite ? cfg.radius * 1.2 : cfg.radius;

      let spawnPos: Vec3;
      if (this.currentFloor) {
        spawnPos = findRadialWalkableSpot(
          this.currentFloor,
          position,
          2.0,
          5.6,
          radius,
          occupied,
          this.rng,
        );
      } else {
        const angle = (i / safeCount) * Math.PI * 2 + this.rng.range(-0.2, 0.2);
        const r = this.rng.range(2.2, 4.8);
        spawnPos = {
          x: position.x + Math.cos(angle) * r,
          y: 0,
          z: position.z + Math.sin(angle) * r,
        };
      }
      occupied.push(spawnPos);

      const entity = this.createSingleEnemy(
        archetype,
        isElite,
        affixes,
        spawnPos,
        floorNumber,
        roomId,
        1.0,
        true,
      );
      waveSpawned.push(entity);

      eventBus.emit('vfx:request', {
        type: 'void_implosion',
        position: { x: spawnPos.x, y: 0.4, z: spawnPos.z },
        colorHex: isElite ? 0xff922b : 0x9775fa,
        scale: isElite ? 0.9 : 0.65,
      });
    }

    return waveSpawned;
  }

  getEnemies(): EnemyEntity[] {
    return this.enemies;
  }

  getLivingEnemies(): EnemyEntity[] {
    return this.enemies.filter((e) => e.alive && e.hp > 0);
  }

  update(
    dt: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
  ): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const safeDt = Math.min(dt, 0.1);
    this.currentFloor = floor;

    // Keep playerPosition in sync so setPlayerPosition() callers and the
    // internal update() path always agree on the latest player world position.
    this.playerPosition.x = player.position.x;
    this.playerPosition.y = player.position.y;
    this.playerPosition.z = player.position.z;

    // Update Elite hazards first (molten death bombs, frozen pulses, rotating arcane beams)
    this.affixController.updateHazards(safeDt, player, combat);

    const livingEnemies = this.getLivingEnemies();
    const livingPositions = livingEnemies.map((e) => e.position);
    const playerRoomId = this.findContainingRoomId(floor, player.position);

    // Snapshot length so newly summoned skeletons start their next full tick cleanly
    const countSnapshot = this.enemies.length;

    for (let idx = 0; idx < countSnapshot; idx++) {
      const enemy = this.enemies[idx];
      const record = this.records.get(enemy.id);
      if (!record || record.meshDisposed) continue;

      // ── Performance optimisation ────────────────────────────────────────────
      // 1. Distance-cull: skip full AI for enemies that are far from the player.
      //    Enemies that are dead are always processed (death animation / cleanup).
      if (enemy.alive && enemy.hp > 0) {
        const dx = enemy.position.x - this.playerPosition.x;
        const dz = enemy.position.z - this.playerPosition.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > this.distanceThreshold * this.distanceThreshold) {
          // Keep ticking timers so enemies don't "freeze" when player approaches
          const rec = record;
          rec.attackCooldown = Math.max(0, rec.attackCooldown - safeDt);
          rec.repathTimer = Math.max(0, rec.repathTimer - safeDt);
          rec.retreatCooldown = Math.max(0, rec.retreatCooldown - safeDt);
          rec.aggroDelayTimer = Math.max(0, rec.aggroDelayTimer - safeDt);
          rec.flinchImmunityTimer = Math.max(0, rec.flinchImmunityTimer - safeDt);
          continue;
        }

        // 2. Per-enemy AI throttle: only run full state-machine at most once per aiUpdateInterval.
        const elapsed = (this.lastUpdateTime.get(enemy.id) ?? this.aiUpdateInterval) + safeDt;
        if (elapsed < this.aiUpdateInterval) {
          this.lastUpdateTime.set(enemy.id, elapsed);
          // Still integrate knockback and mesh update so motion looks correct
          const kbDecayFast = Math.exp(-9.5 * safeDt);
          record.knockbackVel.x *= kbDecayFast;
          record.knockbackVel.z *= kbDecayFast;
          if (Math.abs(record.knockbackVel.x) < 0.02) record.knockbackVel.x = 0;
          if (Math.abs(record.knockbackVel.z) < 0.02) record.knockbackVel.z = 0;
          if (Math.abs(record.knockbackVel.x) > 0 || Math.abs(record.knockbackVel.z) > 0) {
            const slid = moveWithWallSlide(
              floor,
              enemy.position,
              record.knockbackVel.x,
              record.knockbackVel.z,
              enemy.radius,
              safeDt,
            );
            this.commitTransformAndVel(enemy, record, slid.movedX, slid.movedZ, record.lastAnimState ?? 'idle', record.lastAnimSpeed, safeDt);
          } else if (enemy.meshHandle) {
            enemy.meshHandle.update(safeDt);
          }
          continue;
        }
        // Reset throttle timer
        this.lastUpdateTime.set(enemy.id, 0);
      }
      // ── End performance optimisation ────────────────────────────────────────

      // 1. Handle Death Lifecycle & Corpse Cleanup
      if (!enemy.alive || enemy.hp <= 0) {
        enemy.alive = false;
        enemy.hp = 0;
        enemy.velocity.x = 0;
        enemy.velocity.y = 0;
        enemy.velocity.z = 0;

        if (!record.deathStarted) {
          record.deathStarted = true;
          record.deathTimer = 0;
          this.setEnemyAnim(enemy, record, 'death', 1.0);
          this.affixController.onEliteKilled(enemy);
        }

        record.deathTimer += safeDt;
        enemy.meshHandle?.update(safeDt);

        if (record.deathTimer >= DEATH_CLEANUP_SEC && !record.meshDisposed) {
          if (enemy.meshHandle) {
            enemy.meshHandle.root.parent?.remove(enemy.meshHandle.root);
            enemy.meshHandle.dispose();
            enemy.meshHandle = undefined;
          }
          record.meshDisposed = true;
        }
        continue;
      }

      // 2. Detect Damage Taken -> Flash Hit, Alert Pack, Optional Flinch
      if (enemy.hp < record.lastHp) {
        const dmgTaken = record.lastHp - enemy.hp;
        record.lastHp = enemy.hp;
        enemy.meshHandle?.flashHit();
        this.alertEnemyAndPack(enemy);

        const hasPoise = enemy.isElite || record.config.role === 'heavy_slam';
        if (
          !hasPoise &&
          dmgTaken >= enemy.maxHp * 0.18 &&
          record.flinchImmunityTimer <= 0 &&
          record.state !== 'windup'
        ) {
          record.flinchTimer = 0.14;
          record.flinchImmunityTimer = 1.6;
          this.setEnemyAnim(enemy, record, 'hit', 1.25);
        }
      } else if (enemy.hp > record.lastHp) {
        record.lastHp = enemy.hp;
      }

      // 3. Absorb any External Knockback Impulse from CombatEngine
      const extVx = enemy.velocity.x - record.lastOutVelocity.x;
      const extVz = enemy.velocity.z - record.lastOutVelocity.z;
      if (Math.abs(extVx) > 0.01 || Math.abs(extVz) > 0.01) {
        record.knockbackVel.x += extVx;
        record.knockbackVel.z += extVz;
        const kbMag = Math.hypot(record.knockbackVel.x, record.knockbackVel.z);
        if (kbMag > 14) {
          record.knockbackVel.x = (record.knockbackVel.x / kbMag) * 14;
          record.knockbackVel.z = (record.knockbackVel.z / kbMag) * 14;
        }
      }
      const kbDecay = Math.exp(-9.5 * safeDt);
      record.knockbackVel.x *= kbDecay;
      record.knockbackVel.z *= kbDecay;
      if (Math.abs(record.knockbackVel.x) < 0.02) record.knockbackVel.x = 0;
      if (Math.abs(record.knockbackVel.z) < 0.02) record.knockbackVel.z = 0;

      // 4. Inspect Active Status Effects
      let isFrozen = false;
      let isStunned = false;
      let isChilled = false;
      let isHasted = false;
      for (const st of enemy.statuses) {
        if (st.remainingSec <= 0) continue;
        if (st.type === 'freeze') isFrozen = true;
        else if (st.type === 'stun') isStunned = true;
        else if (st.type === 'chill') isChilled = true;
        else if (st.type === 'haste') isHasted = true;
      }
      const isDisabled = isFrozen || isStunned;

      // 5. Update Elite Affix Behaviors
      this.affixController.updateEliteEntity(
        safeDt,
        enemy,
        record.config.role,
        record.aggroed,
        isDisabled,
        record.state === 'windup',
        player,
        floor,
        combat,
        livingPositions,
      );

      const berserk = this.affixController.getBerserkModifiers(enemy);
      // Avoid double-dipping chill/haste if CombatEngine.tickStatuses already scaled enemy.moveSpeed
      const chillFactor =
        isChilled && enemy.moveSpeed >= record.baseMoveSpeed * 0.9 ? 0.65 : 1.0;
      const hasteFactor =
        isHasted && enemy.moveSpeed <= record.baseMoveSpeed * 1.08 ? 1.3 : 1.0;
      const moveSpeedMult = berserk.moveSpeedMult * chillFactor * hasteFactor;
      const actionSpeedMult =
        berserk.actionSpeedMult * (isChilled ? 0.8 : 1.0) * (isHasted ? 1.25 : 1.0);
      const damageMult = berserk.damageMult;

      // 6. Respect Freeze & Stun Disable
      if (isDisabled) {
        if (record.state === 'windup') {
          record.state = 'chase';
          record.attackCooldown = Math.max(record.attackCooldown, 0.45);
        }
        const slid = moveWithWallSlide(
          floor,
          enemy.position,
          record.knockbackVel.x,
          record.knockbackVel.z,
          enemy.radius,
          safeDt,
        );
        this.commitTransformAndVel(
          enemy,
          record,
          slid.movedX,
          slid.movedZ,
          'idle',
          isFrozen ? 0.05 : 0.2,
          isFrozen ? 0 : safeDt * 0.25,
        );
        continue;
      }

      // 7. Tick Cooldowns
      record.attackCooldown = Math.max(0, record.attackCooldown - safeDt * actionSpeedMult);
      record.repathTimer = Math.max(0, record.repathTimer - safeDt);
      record.retreatCooldown = Math.max(0, record.retreatCooldown - safeDt);
      record.blinkCooldown = Math.max(0, record.blinkCooldown - safeDt);
      record.summonCooldown = Math.max(0, record.summonCooldown - safeDt);
      record.flinchImmunityTimer = Math.max(0, record.flinchImmunityTimer - safeDt);
      record.aggroDelayTimer = Math.max(0, record.aggroDelayTimer - safeDt);

      if (record.flinchTimer > 0) {
        record.flinchTimer = Math.max(0, record.flinchTimer - safeDt);
        const slid = moveWithWallSlide(
          floor,
          enemy.position,
          record.knockbackVel.x,
          record.knockbackVel.z,
          enemy.radius,
          safeDt,
        );
        this.commitTransformAndVel(enemy, record, slid.movedX, slid.movedZ, 'hit', 1.1, safeDt);
        continue;
      }

      // Stand down gracefully if player is dead
      if (!player.alive) {
        record.state = 'idle';
        const slid = moveWithWallSlide(
          floor,
          enemy.position,
          record.knockbackVel.x,
          record.knockbackVel.z,
          enemy.radius,
          safeDt,
        );
        this.commitTransformAndVel(enemy, record, slid.movedX, slid.movedZ, 'idle', 1.0, safeDt);
        continue;
      }

      const distToPlayer = distXZ(enemy.position, player.position);
      const angleToPlayer = Math.atan2(
        player.position.x - enemy.position.x,
        player.position.z - enemy.position.z,
      );

      let aiVelX = 0;
      let aiVelZ = 0;
      let desiredAnim: EnemyAnimState = 'idle';
      let desiredAnimSpeed = 1.0;

      // 8. Tactical State Machine
      switch (record.state) {
        case 'idle': {
          desiredAnim = 'idle';
          const sameRoom = playerRoomId !== null && enemy.roomId === playerRoomId;
          const packTriggered = record.pendingPackAggro && record.aggroDelayTimer <= 0;
          const directSightAggro =
            distToPlayer <= record.config.aggroRange &&
            (sameRoom || distToPlayer <= 7.0 || hasLineOfSight(floor, enemy.position, player.position));

          if (packTriggered || directSightAggro) {
            this.alertEnemyAndPack(enemy);
            record.state = 'chase';
          }
          break;
        }

        case 'chase': {
          const cfg = record.config;

          // Treasure Goblin frantic flee behavior
          if (cfg.role === 'flee_goblin') {
            if (distToPlayer < (cfg.kiteOptimalDist ?? 14.0)) {
              record.state = 'retreat';
              record.stateTimer = 1.35;
              record.kiteWeaveSign = this.rng.chance(0.5) ? 1 : -1;
              desiredAnim = 'walk';
              desiredAnimSpeed = Math.max(1.0, moveSpeedMult * 1.15);
            } else {
              desiredAnim = 'idle';
            }
            break;
          }

          // Void Assassin Blink Backstab
          if (
            cfg.role === 'blink_assassin' &&
            record.blinkCooldown <= 0 &&
            distToPlayer >= 3.2 &&
            distToPlayer <= 10.5
          ) {
            const backstabSpot = this.findBackstabPosition(floor, player, enemy.radius);
            if (backstabSpot) {
              const oldPos = { ...enemy.position };
              eventBus.emit('vfx:request', {
                type: 'void_implosion',
                position: { x: oldPos.x, y: 0.75, z: oldPos.z },
                colorHex: 0x845ef7,
                scale: 0.65,
              });
              enemy.position.x = backstabSpot.x;
              enemy.position.z = backstabSpot.z;
              const newAngle = Math.atan2(
                player.position.x - enemy.position.x,
                player.position.z - enemy.position.z,
              );
              enemy.rotationY = newAngle;
              record.lockedAimAngle = newAngle;
              record.blinkCooldown = 5.6;
              record.backstabCharged = true;
              record.pendingAction = 'melee';
              record.state = 'windup';
              record.stateTimer = cfg.windupSec / actionSpeedMult;

              eventBus.emit('vfx:request', {
                type: 'dodge_afterimage',
                position: { x: backstabSpot.x, y: 0.75, z: backstabSpot.z },
                colorHex: 0xb197fc,
                scale: 0.95,
              });
              eventBus.emit('sfx:request', { id: 'dodge_whoosh', position: { ...backstabSpot } });

              desiredAnim = 'windup';
              desiredAnimSpeed = actionSpeedMult;
              break;
            }
          }

          // Lich Summoner Skeleton Summon Check
          if (
            cfg.role === 'summoner' &&
            record.summonCooldown <= 0 &&
            distToPlayer <= 13.5 &&
            record.totalSummoned < MAX_TOTAL_SUMMONS_PER_LICH &&
            livingEnemies.length < MAX_ACTIVE_ENEMIES_FOR_SUMMON &&
            this.countActiveMinionsOf(enemy.id) < MAX_ACTIVE_MINIONS_PER_LICH
          ) {
            record.pendingAction = 'summon';
            record.state = 'windup';
            record.stateTimer = 0.82 / actionSpeedMult;
            record.lockedAimAngle = angleToPlayer;
            desiredAnim = 'windup';
            desiredAnimSpeed = actionSpeedMult;
            break;
          }

          // Ranged Kite / Retreat Check (bone_archer, dark_cultist, lich_summoner)
          const isRangedRole = cfg.role === 'ranged_kite' || cfg.role === 'summoner';
          if (
            isRangedRole &&
            distToPlayer < (cfg.kiteMinDist ?? 4.2) &&
            record.retreatCooldown <= 0
          ) {
            record.state = 'retreat';
            record.stateTimer = 0.95;
            record.kiteWeaveSign = this.rng.chance(0.5) ? 1 : -1;
            desiredAnim = 'walk';
            break;
          }

          // Attack Windup Transition Check
          if (isRangedRole) {
            const los = distToPlayer <= enemy.attackRange && hasLineOfSight(floor, enemy.position, player.position);
            if (los && record.attackCooldown <= 0) {
              record.pendingAction = 'ranged';
              record.state = 'windup';
              record.stateTimer = cfg.windupSec / actionSpeedMult;
              record.lockedAimAngle = angleToPlayer;
              desiredAnim = 'windup';
              desiredAnimSpeed = actionSpeedMult;
              break;
            }

            // Ranged tactical strafe if already at comfortable firing range with LOS
            if (los && distToPlayer <= (cfg.kiteOptimalDist ?? 8.2) + 1.0) {
              const sep = computeSeparationForce(enemy, livingEnemies, record.spawnIndex);
              const strafeAngle = angleToPlayer + (Math.PI * 0.5) * record.kiteWeaveSign;
              const strafeSpeed = enemy.moveSpeed * moveSpeedMult * 0.55;
              aiVelX = Math.sin(strafeAngle) * strafeSpeed + sep.x * 1.1;
              aiVelZ = Math.cos(strafeAngle) * strafeSpeed + sep.z * 1.1;
              enemy.rotationY = lerpAngleY(enemy.rotationY, angleToPlayer, 10, safeDt);
              desiredAnim = 'walk';
              desiredAnimSpeed = Math.max(0.65, moveSpeedMult * 0.75);
              break;
            }
          } else {
            const engageDist = enemy.attackRange + player.radius * 0.55;
            if (distToPlayer <= engageDist && record.attackCooldown <= 0) {
              record.pendingAction = cfg.role === 'heavy_slam' ? 'slam' : 'melee';
              record.state = 'windup';
              record.stateTimer = cfg.windupSec / actionSpeedMult;
              record.lockedAimAngle = angleToPlayer;
              desiredAnim = 'windup';
              desiredAnimSpeed = actionSpeedMult;
              break;
            }
          }

          // Chase Navigation: Throttled A* Pathfinding + Surround Slot + Separation Steering
          const closeWithLos =
            distToPlayer <= 4.6 && hasLineOfSight(floor, enemy.position, player.position);

          const navGoal =
            !isRangedRole && closeWithLos
              ? computeSurroundSlot(
                  floor,
                  enemy.position,
                  player.position,
                  Math.max(1.25, enemy.attackRange * 0.8),
                  record.surroundAngle,
                  enemy.radius,
                )
              : player.position;

          if (!closeWithLos) {
            const goalShifted = distXZ(record.lastPathGoal, player.position) > 2.2;
            if (record.repathTimer <= 0 || record.path.length === 0 || goalShifted) {
              record.path = floor.findPath(enemy.position, navGoal, 48);
              record.pathIndex = 0;
              record.lastPathGoal = { ...player.position };
              record.repathTimer = 0.36 + (record.spawnIndex % 6) * 0.045;

              // Skip starting node if already standing on it
              if (
                record.path.length > 1 &&
                distXZ(enemy.position, record.path[0]) < Math.max(0.85, enemy.radius * 1.3)
              ) {
                record.pathIndex = 1;
              }
            }
          } else {
            record.path = [];
            record.pathIndex = 0;
          }

          let steerTarget = navGoal;
          while (record.pathIndex < record.path.length) {
            const wp = record.path[record.pathIndex];
            if (distXZ(enemy.position, wp) <= Math.max(0.85, enemy.radius * 1.25)) {
              record.pathIndex++;
            } else {
              steerTarget = wp;
              break;
            }
          }

          const toTargetX = steerTarget.x - enemy.position.x;
          const toTargetZ = steerTarget.z - enemy.position.z;
          const toTargetLen = Math.hypot(toTargetX, toTargetZ);

          const dirX = toTargetLen > 0.05 ? toTargetX / toTargetLen : 0;
          const dirZ = toTargetLen > 0.05 ? toTargetZ / toTargetLen : 0;

          const sep = computeSeparationForce(enemy, livingEnemies, record.spawnIndex);
          const effectiveSpeed = enemy.moveSpeed * moveSpeedMult;

          let rawVx = dirX * effectiveSpeed + sep.x * 1.45;
          let rawVz = dirZ * effectiveSpeed + sep.z * 1.45;
          const rawMag = Math.hypot(rawVx, rawVz);
          if (rawMag > effectiveSpeed * 1.12) {
            rawVx = (rawVx / rawMag) * effectiveSpeed * 1.12;
            rawVz = (rawVz / rawMag) * effectiveSpeed * 1.12;
          }

          aiVelX = rawVx;
          aiVelZ = rawVz;

          const faceAngle =
            distToPlayer <= enemy.attackRange + 1.2 || rawMag < 0.3
              ? angleToPlayer
              : Math.atan2(rawVx, rawVz);
          enemy.rotationY = lerpAngleY(enemy.rotationY, faceAngle, 10.5, safeDt);
          desiredAnim = rawMag > 0.25 ? 'walk' : 'idle';
          desiredAnimSpeed = Math.max(0.6, moveSpeedMult);
          break;
        }

        case 'windup': {
          const totalWindup = Math.max(0.15, record.config.windupSec / actionSpeedMult);
          record.stateTimer -= safeDt;

          // Track player during early windup, lock aim in final 32% so player dodges feel fair
          if (record.stateTimer > totalWindup * 0.32) {
            record.lockedAimAngle = angleToPlayer;
          }
          enemy.rotationY = lerpAngleY(enemy.rotationY, record.lockedAimAngle, 14, safeDt);
          desiredAnim = 'windup';
          desiredAnimSpeed = actionSpeedMult;

          if (record.stateTimer <= 0) {
            this.executeAction(enemy, record, player, floor, combat, damageMult);
            record.state = 'attack';
            record.stateTimer = Math.max(0.18, record.config.recoverySec / actionSpeedMult);
            desiredAnim =
              record.pendingAction === 'summon' ||
              enemy.archetype === 'dark_cultist' ||
              enemy.archetype === 'lich_summoner' ||
              enemy.archetype === 'ice_wraith' ||
              enemy.archetype === 'astral_weaver'
                ? 'cast'
                : 'attack';
          }
          break;
        }

        case 'attack': {
          record.stateTimer -= safeDt;
          const isCaster =
            record.pendingAction === 'summon' ||
            enemy.archetype === 'dark_cultist' ||
            enemy.archetype === 'lich_summoner' ||
            enemy.archetype === 'ice_wraith' ||
            enemy.archetype === 'astral_weaver';
          desiredAnim = isCaster ? 'cast' : 'attack';
          desiredAnimSpeed = actionSpeedMult;

          if (record.stateTimer <= 0) {
            record.attackCooldown = enemy.attackCooldownSec;
            const cfg = record.config;
            const shouldKiteAfterShot =
              (cfg.role === 'ranged_kite' || cfg.role === 'summoner') &&
              distToPlayer < (cfg.kiteMinDist ?? 4.2) + 0.8 &&
              record.retreatCooldown <= 0;

            if (shouldKiteAfterShot) {
              record.state = 'retreat';
              record.stateTimer = 0.9;
              record.kiteWeaveSign = this.rng.chance(0.5) ? 1 : -1;
            } else {
              record.state = 'chase';
            }
          }
          break;
        }

        case 'retreat': {
          record.stateTimer -= safeDt;
          const cfg = record.config;

          const awayAngle = Math.atan2(
            enemy.position.x - player.position.x,
            enemy.position.z - player.position.z,
          );
          const kiteAngle = awayAngle + record.kiteWeaveSign * 0.42;
          const sep = computeSeparationForce(enemy, livingEnemies, record.spawnIndex);
          const kiteSpeed = enemy.moveSpeed * moveSpeedMult * 0.96;

          aiVelX = Math.sin(kiteAngle) * kiteSpeed + sep.x * 1.1;
          aiVelZ = Math.cos(kiteAngle) * kiteSpeed + sep.z * 1.1;

          enemy.rotationY = lerpAngleY(enemy.rotationY, Math.atan2(aiVelX, aiVelZ), 11, safeDt);
          desiredAnim = 'walk';
          desiredAnimSpeed = Math.max(0.75, moveSpeedMult);

          if (record.stateTimer <= 0 || distToPlayer >= (cfg.kiteOptimalDist ?? 8.2)) {
            record.retreatCooldown = 2.35;
            record.state = 'chase';
          }
          break;
        }
      }

      // 9. Integrate Movement + Wall Sliding + Sync 3D Mesh Handle
      const totalVx = aiVelX + record.knockbackVel.x;
      const totalVz = aiVelZ + record.knockbackVel.z;
      const slid = moveWithWallSlide(
        floor,
        enemy.position,
        totalVx,
        totalVz,
        enemy.radius,
        safeDt,
      );

      // Flip kiting weave direction if backed into a corner
      if (record.state === 'retreat') {
        const requestedSpeed = Math.hypot(aiVelX, aiVelZ);
        const actualSpeed = Math.hypot(slid.movedX, slid.movedZ);
        if (requestedSpeed > 1.0 && actualSpeed < requestedSpeed * 0.28) {
          record.kiteWeaveSign = record.kiteWeaveSign === 1 ? -1 : 1;
        }
      }

      this.commitTransformAndVel(
        enemy,
        record,
        slid.movedX,
        slid.movedZ,
        desiredAnim,
        desiredAnimSpeed,
        safeDt,
      );
    }

    // 10. Update Room Cleared Status
    this.updateClearedRooms(floor);
  }

  clear(): void {
    for (const enemy of this.enemies) {
      if (enemy.meshHandle) {
        enemy.meshHandle.root.parent?.remove(enemy.meshHandle.root);
        enemy.meshHandle.dispose();
        enemy.meshHandle = undefined;
      }
    }
    this.enemies = [];
    this.records.clear();
    this.trackedRoomIds.clear();
    this.affixController.clear();
    this.lastUpdateTime.clear();
  }

  dispose(): void {
    this.clear();
    this.affixController.dispose();
    this.scene = null;
    this.meshFactory = null;
    this.materials = null;
    this.currentFloor = null;
  }

  private createSingleEnemy(
    archetype: EnemyArchetypeId,
    isElite: boolean,
    affixes: EliteAffix[],
    position: Vec3,
    floorNumber: number,
    roomId: string,
    hpMultiplier: number,
    startAggroed: boolean,
    summonerOwnerId?: string,
  ): EnemyEntity {
    const cfg = ARCHETYPE_CONFIGS[archetype];
    const scaled = computeScaledEnemyStats(cfg, floorNumber, isElite, affixes, hpMultiplier);
    const spawnIndex = this.nextEnemyCounter++;
    const id = `enemy_${spawnIndex}_${archetype}`;

    const name = isElite
      ? generateEliteName(archetype, affixes, this.rng)
      : summonerOwnerId
        ? `Risen ${cfg.displayName}`
        : cfg.displayName;

    const initialRotY = this.rng.range(-Math.PI, Math.PI);

    let meshHandle = undefined;
    if (this.meshFactory && this.materials) {
      meshHandle = this.meshFactory.createEnemyMesh(archetype, isElite, this.materials);
      if (isElite && affixes.length > 0) {
        meshHandle.setEliteVisuals(affixes);
      }
      meshHandle.root.position.set(position.x, position.y, position.z);
      meshHandle.root.rotation.y = initialRotY;
      meshHandle.playAnim('idle', 1.0);
      this.scene?.add(meshHandle.root);
    }

    const entity: EnemyEntity = {
      id,
      name,
      archetype,
      isBoss: false,
      isElite,
      affixes: [...affixes],
      position: { x: position.x, y: position.y, z: position.z },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: initialRotY,
      radius: scaled.radius,
      hp: scaled.maxHp,
      maxHp: scaled.maxHp,
      armor: scaled.armor,
      moveSpeed: scaled.moveSpeed,
      attackDamage: scaled.attackDamage,
      damageType: cfg.damageType,
      attackRange: cfg.attackRange,
      attackCooldownSec: cfg.attackCooldownSec,
      xpReward: scaled.xpReward,
      lootTierBonus: scaled.lootTierBonus,
      statuses: [],
      alive: true,
      roomId,
      meshHandle,
    };

    // Golden-angle distribution so melee packs naturally encircle the player
    const surroundAngle = ((spawnIndex * 2.39996323) % (Math.PI * 2)) - Math.PI;

    const record: EnemyRuntimeRecord = {
      spawnIndex,
      config: cfg,
      baseMoveSpeed: scaled.moveSpeed,
      state: startAggroed ? 'chase' : 'idle',
      pendingAction: 'melee',
      aggroed: startAggroed,
      pendingPackAggro: false,
      aggroDelayTimer: 0,
      stateTimer: 0,
      attackCooldown: this.rng.range(0.15, 0.55),
      repathTimer: (spawnIndex % 6) * 0.06,
      retreatCooldown: 0,
      blinkCooldown: this.rng.range(0.8, 2.2),
      summonCooldown: this.rng.range(1.2, 2.8),
      flinchTimer: 0,
      flinchImmunityTimer: 0,
      backstabCharged: false,
      kiteWeaveSign: spawnIndex % 2 === 0 ? 1 : -1,
      surroundAngle,
      lockedAimAngle: initialRotY,
      path: [],
      pathIndex: 0,
      lastPathGoal: { x: position.x, y: 0, z: position.z },
      lastHp: scaled.maxHp,
      lastOutVelocity: { x: 0, y: 0, z: 0 },
      knockbackVel: { x: 0, z: 0 },
      lastAnimState: 'idle',
      lastAnimSpeed: 1.0,
      deathStarted: false,
      deathTimer: 0,
      meshDisposed: false,
      summonerOwnerId,
      totalSummoned: 0,
    };

    this.enemies.push(entity);
    this.records.set(entity.id, record);
    if (isElite && affixes.length > 0) {
      this.affixController.registerElite(entity, this.rng);
    }

    return entity;
  }

  private executeAction(
    enemy: EnemyEntity,
    record: EnemyRuntimeRecord,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    damageMult: number,
  ): void {
    const cfg = record.config;
    const aimDir: Vec3 = {
      x: Math.sin(record.lockedAimAngle),
      y: 0,
      z: Math.cos(record.lockedAimAngle),
    };
    const isVampiric = enemy.isElite && enemy.affixes.includes('vampiric');
    const baseDmg = Math.max(2, Math.round(enemy.attackDamage * damageMult));

    // 1. Lich Summoner Skeleton Summon
    if (record.pendingAction === 'summon') {
      record.summonCooldown = 8.5;
      const currentActive = this.countActiveMinionsOf(enemy.id);
      const canSpawn = Math.min(2, MAX_ACTIVE_MINIONS_PER_LICH - currentActive);
      const occupied = this.getLivingEnemies().map((e) => e.position);

      for (let i = 0; i < canSpawn; i++) {
        const skelPos = findRadialWalkableSpot(
          floor,
          enemy.position,
          1.5,
          3.2,
          ARCHETYPE_CONFIGS.skeleton_warrior.radius,
          occupied,
          this.rng,
        );
        occupied.push(skelPos);
        record.totalSummoned++;

        this.createSingleEnemy(
          'skeleton_warrior',
          false,
          [],
          skelPos,
          floor.floorNumber,
          enemy.roomId,
          0.62,
          true,
          enemy.id,
        );

        eventBus.emit('vfx:request', {
          type: 'void_implosion',
          position: { x: skelPos.x, y: 0.4, z: skelPos.z },
          colorHex: 0x9775fa,
          scale: 0.75,
        });
      }

      eventBus.emit('sfx:request', {
        id: 'shrine_bless',
        position: { ...enemy.position },
      });
      return;
    }

    // 2. Ranged Projectile Attack (bone_archer, dark_cultist, lich_summoner)
    if (record.pendingAction === 'ranged') {
      const projSpeed = cfg.projectileSpeed ?? 12.0;
      const projRadius = cfg.projectileRadius ?? 0.3;
      const projColor = cfg.projectileColorHex ?? 0xe9dfc4;

      const statusPayload = cfg.statusProc
        ? {
            type: cfg.statusProc.type,
            chance: cfg.statusProc.chance,
            durationSec: cfg.statusProc.durationSec,
            potency: Math.max(1, Number((baseDmg * cfg.statusProc.potencyRatio).toFixed(2))),
          }
        : undefined;

      combat.spawnProjectile({
        ownerIsPlayer: false,
        ownerId: enemy.id,
        origin: {
          x: enemy.position.x + aimDir.x * (enemy.radius + 0.32),
          y: 0.9,
          z: enemy.position.z + aimDir.z * (enemy.radius + 0.32),
        },
        direction: aimDir,
        speed: projSpeed,
        maxDistance: enemy.attackRange + 5.5,
        radius: projRadius,
        piercing: false,
        homing: cfg.projectileHoming,
        damagePacket: {
          sourceId: enemy.id,
          baseAmount: baseDmg,
          damageType: enemy.damageType,
          critChance: enemy.isElite ? 0.08 : 0.04,
          critMultiplier: 1.5,
          lifeSteal: isVampiric ? 0.45 : undefined,
          appliesStatus: statusPayload,
        },
        visualColorHex: projColor,
      });

      const rangedSfx =
        enemy.archetype === 'bone_archer'
          ? 'sword_swing'
          : enemy.archetype === 'ice_wraith'
            ? 'frost_shatter'
            : enemy.archetype === 'astral_weaver'
              ? 'lightning_zap'
              : 'fireball_cast';

      eventBus.emit('sfx:request', {
        id: rangedSfx,
        position: { ...enemy.position },
      });
      return;
    }

    // 3. Heavy AoE Ground Slam (abyssal_golem, clockwork_automaton)
    if (record.pendingAction === 'slam') {
      const slamRadius = cfg.slamRadius ?? 2.6;
      const slamCenter: Vec3 = {
        x: enemy.position.x + aimDir.x * 1.15,
        y: 0,
        z: enemy.position.z + aimDir.z * 1.15,
      };
      const isVoltaic = enemy.damageType === 'lightning';

      eventBus.emit('vfx:request', {
        type: isVoltaic ? 'lightning_strike' : 'hit_sparks',
        position: { x: slamCenter.x, y: 0.25, z: slamCenter.z },
        colorHex: isVoltaic ? 0xffd43b : 0xff922b,
        radius: slamRadius,
        scale: 1.45,
      });
      eventBus.emit('sfx:request', {
        id: isVoltaic ? 'lightning_zap' : 'explosion',
        position: slamCenter,
      });
      eventBus.emit('camera:shake', { trauma: 0.24 });

      if (player.alive && distXZ(player.position, slamCenter) <= slamRadius + player.radius) {
        const kbDirX = player.position.x - enemy.position.x;
        const kbDirZ = player.position.z - enemy.position.z;
        const kbLen = Math.hypot(kbDirX, kbDirZ) || 1;

        const packet: DamagePacket = {
          sourceId: enemy.id,
          targetId: 'player',
          baseAmount: baseDmg,
          damageType: enemy.damageType,
          critChance: 0.06,
          critMultiplier: 1.5,
          knockback: { x: (kbDirX / kbLen) * 5.5, y: 0, z: (kbDirZ / kbLen) * 5.5 },
          lifeSteal: isVampiric ? 0.45 : undefined,
          appliesStatus: cfg.statusProc
            ? {
                type: cfg.statusProc.type,
                chance: cfg.statusProc.chance,
                durationSec: cfg.statusProc.durationSec,
                potency: cfg.statusProc.potencyRatio,
              }
            : undefined,
        };
        const res = combat.applyDamageToPlayer(player, packet);
        this.affixController.applyVampiricOnHit(enemy, res.finalDamage);
      }
      return;
    }

    // 4. Standard / Backstab Melee Strike (skeleton_warrior, plague_spider, void_assassin, hellhound)
    const isBackstab = record.backstabCharged;
    record.backstabCharged = false;

    const strikeDmg = isBackstab ? Math.round(baseDmg * 1.55) : baseDmg;
    const strikeCrit = isBackstab ? 0.4 : enemy.isElite ? 0.1 : 0.05;

    const slashColor =
      enemy.damageType === 'void'
        ? 0xda77f2
        : enemy.damageType === 'fire'
          ? 0xff6b35
          : enemy.damageType === 'ice'
            ? 0x4dabf7
            : enemy.damageType === 'lightning'
              ? 0xffd43b
              : enemy.damageType === 'poison'
                ? 0x69db7c
                : 0xf1e9d2;

    eventBus.emit('vfx:request', {
      type: 'slash_arc',
      position: {
        x: enemy.position.x + aimDir.x * (enemy.radius + 0.45),
        y: 0.8,
        z: enemy.position.z + aimDir.z * (enemy.radius + 0.45),
      },
      direction: aimDir,
      colorHex: slashColor,
      scale: isBackstab ? 1.25 : 0.9,
    });
    eventBus.emit('sfx:request', { id: 'sword_swing', position: { ...enemy.position } });

    if (!player.alive) return;

    const toPlayerX = player.position.x - enemy.position.x;
    const toPlayerZ = player.position.z - enemy.position.z;
    const dist = Math.hypot(toPlayerX, toPlayerZ);
    const maxHitReach = enemy.attackRange + player.radius + 0.35;

    if (dist <= maxHitReach) {
      // Cone check along lockedAimAngle (~70 deg half-angle, or point-blank overlap)
      let inArc = dist <= enemy.radius + player.radius + 0.35;
      if (!inArc && dist > 0.001) {
        const dot = (toPlayerX / dist) * aimDir.x + (toPlayerZ / dist) * aimDir.z;
        inArc = dot >= Math.cos(1.22); // ~70 degrees half-angle
      }

      if (inArc) {
        const packet: DamagePacket = {
          sourceId: enemy.id,
          targetId: 'player',
          baseAmount: strikeDmg,
          damageType: enemy.damageType,
          critChance: strikeCrit,
          critMultiplier: isBackstab ? 1.75 : 1.5,
          lifeSteal: isVampiric ? 0.45 : undefined,
          appliesStatus: cfg.statusProc
            ? {
                type: cfg.statusProc.type,
                chance: cfg.statusProc.chance,
                durationSec: cfg.statusProc.durationSec,
                potency: Math.max(1, Number((strikeDmg * cfg.statusProc.potencyRatio).toFixed(2))),
              }
            : undefined,
        };
        const res = combat.applyDamageToPlayer(player, packet);
        this.affixController.applyVampiricOnHit(enemy, res.finalDamage);
      }
    }
  }

  private findBackstabPosition(
    floor: DungeonFloorData,
    player: PlayerRuntimeState,
    assassinRadius: number,
  ): Vec3 | null {
    let fx = player.facingDir.x;
    let fz = player.facingDir.z;
    const flen = Math.hypot(fx, fz);
    if (flen > 0.01) {
      fx /= flen;
      fz /= flen;
    } else {
      fx = Math.sin(player.rotationY);
      fz = Math.cos(player.rotationY);
    }

    const forwardYaw = Math.atan2(fx, fz);
    const offsetDist = player.radius + assassinRadius + 0.65;

    // Prefer directly behind the hero, then flanking angles
    for (const relYaw of [Math.PI, Math.PI + 0.85, Math.PI - 0.85, Math.PI * 0.5, -Math.PI * 0.5]) {
      const yaw = forwardYaw + relYaw;
      const bx = player.position.x + Math.sin(yaw) * offsetDist;
      const bz = player.position.z + Math.cos(yaw) * offsetDist;
      if (floor.isWalkableWorld(bx, bz, assassinRadius)) {
        return { x: bx, y: 0, z: bz };
      }
    }
    return null;
  }

  private alertEnemyAndPack(source: EnemyEntity): void {
    const srcRec = this.records.get(source.id);
    if (srcRec && !srcRec.aggroed) {
      srcRec.aggroed = true;
      srcRec.pendingPackAggro = false;
      if (srcRec.state === 'idle') {
        srcRec.state = 'chase';
      }
    }

    // Wake nearby packmates in the same room with staggered reaction delay
    for (const other of this.enemies) {
      if (other.id === source.id || !other.alive) continue;
      if (other.roomId !== source.roomId) continue;
      const rec = this.records.get(other.id);
      if (!rec || rec.aggroed || rec.pendingPackAggro) continue;
      if (distXZ(source.position, other.position) <= 10.5) {
        rec.pendingPackAggro = true;
        rec.aggroDelayTimer = this.rng.range(0.06, 0.24);
      }
    }
  }

  private countActiveMinionsOf(summonerId: string): number {
    let count = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.hp <= 0) continue;
      const rec = this.records.get(e.id);
      if (rec?.summonerOwnerId === summonerId) {
        count++;
      }
    }
    return count;
  }

  private findContainingRoomId(floor: DungeonFloorData, worldPos: Vec3): string | null {
    const grid = floor.worldToGrid(worldPos);
    for (const room of floor.rooms) {
      if (
        grid.col >= room.x &&
        grid.col < room.x + room.width &&
        grid.row >= room.y &&
        grid.row < room.y + room.height
      ) {
        return room.id;
      }
    }
    return null;
  }

  private updateClearedRooms(floor: DungeonFloorData): void {
    for (const room of floor.rooms) {
      if (!this.trackedRoomIds.has(room.id)) continue;
      // BossDirector owns boss arena completion state
      if (room.type === 'boss') continue;

      let livingInRoom = 0;
      for (const enemy of this.enemies) {
        if (enemy.roomId === room.id && enemy.alive && enemy.hp > 0) {
          livingInRoom++;
          break;
        }
      }
      room.cleared = livingInRoom === 0;
    }
  }

  private setEnemyAnim(
    enemy: EnemyEntity,
    record: EnemyRuntimeRecord,
    anim: EnemyAnimState,
    speed: number,
  ): void {
    if (!enemy.meshHandle) return;
    const speedChanged = Math.abs(speed - record.lastAnimSpeed) > 0.15;
    if (record.lastAnimState !== anim || speedChanged) {
      record.lastAnimState = anim;
      record.lastAnimSpeed = speed;
      enemy.meshHandle.playAnim(anim, speed);
    }
  }

  private commitTransformAndVel(
    enemy: EnemyEntity,
    record: EnemyRuntimeRecord,
    velX: number,
    velZ: number,
    anim: EnemyAnimState,
    animSpeed: number,
    meshDt: number,
  ): void {
    enemy.velocity.x = velX;
    enemy.velocity.y = 0;
    enemy.velocity.z = velZ;
    record.lastOutVelocity.x = velX;
    record.lastOutVelocity.y = 0;
    record.lastOutVelocity.z = velZ;

    if (enemy.meshHandle) {
      enemy.meshHandle.root.position.set(enemy.position.x, enemy.position.y, enemy.position.z);
      enemy.meshHandle.root.rotation.y = enemy.rotationY;
      this.setEnemyAnim(enemy, record, anim, animSpeed);
      if (meshDt > 0) {
        enemy.meshHandle.update(meshDt);
      }
    }
  }
}
