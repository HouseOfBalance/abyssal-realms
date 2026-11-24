import type * as THREE from 'three';
import type {
  Attributes,
  DerivedStats,
  DungeonFloorData,
  HeroAnimState,
  HeroClassId,
  IHeroRig,
  IPlayerController,
  PlayerRuntimeState,
  SkillSlotIndex,
  TileType,
  Vec3,
} from '../../contracts/types';
import { clamp, HERO_CLASS_CONFIG } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { resolveCircleSlideMove } from './collision';
import { PlayerInputManager } from './input';
import {
  computeDerivedStats,
  computeXpForNextLevel,
  type EquipmentStatBonuses,
  type PassiveStatBonuses,
} from './stats';

const DEFAULT_PLAYER_RADIUS = 0.42;
const DEFAULT_ISOMETRIC_YAW = Math.PI / 4; // 45° isometric camera default (matches CameraRig)
const ORBITAL_KEY_YAW_SPEED = 1.85; // rad/s when holding '[' or ']' (matches CameraRig)

const DODGE_STAMINA_COST = 30;
const DODGE_DURATION_SEC = 0.32;
const DODGE_IFRAME_SEC = 0.38;
const DODGE_COOLDOWN_SEC = 0.52;
const DODGE_SPEED_MULTIPLIER = 2.4;

const POTION_COOLDOWN_SEC = 4.0;
const POTION_STARTING_CHARGES = 3;
const POTION_MAX_CHARGES = 5;

const FOG_REVEAL_RADIUS = 18;
const TURN_SMOOTH_SPEED = 18.0;
const MOVE_ACCEL_RATE = 28.0;
const MOVE_DECEL_RATE = 24.0;

// Glacial ice skating physics & astral teleporter pad constants
const ICE_SPEED_BOOST_MULT = 1.18;
const ICE_ACCEL_RATE = 6.5;
const ICE_DECEL_RATE = 2.6;
const TELEPORTER_COOLDOWN_SEC = 2.5;

const VALID_ATTRIBUTES: ReadonlySet<keyof Attributes> = new Set([
  'strength',
  'dexterity',
  'intelligence',
  'vitality',
]);

function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(current: number, target: number, t: number): number {
  const diff = normalizeAngle(target - current);
  return normalizeAngle(current + diff * clamp(t, 0, 1));
}

function normalizeXZ(x: number, z: number, fallback: Vec3): Vec3 {
  const len = Math.hypot(x, z);
  if (!Number.isFinite(len) || len < 1e-5) {
    return { x: fallback.x, y: 0, z: fallback.z };
  }
  return { x: x / len, y: 0, z: z / len };
}

export class PlayerController implements IPlayerController {
  public readonly state: PlayerRuntimeState;

  private rig: IHeroRig | null = null;
  private cameraRef: THREE.Camera | null = null;
  private fallbackCameraYaw = DEFAULT_ISOMETRIC_YAW;

  private readonly input = new PlayerInputManager();
  private cursorWorldTarget: Vec3 | null = null;

  private lastEquipmentBonuses: EquipmentStatBonuses = { attributes: {}, stats: {} };
  private lastPassiveBonuses: PassiveStatBonuses = { attributes: {}, stats: {}, keystones: [] };
  private baseUnmodifiedMoveSpeed: number;

  private dodgeTimerSec = 0;
  private dodgeCooldownSec = 0;
  private teleporterCooldownSec = 0;
  private dodgeDir: Vec3 = { x: 0, y: 0, z: 1 };

  private lastLocomotionAnim: HeroAnimState | 'none' = 'idle';
  private castAnimHoldSec = 0;
  private deathAnimPlayed = false;

  private readonly unsubDamageDealt: () => void;

  constructor() {
    const defaultCfg = HERO_CLASS_CONFIG.vanguard;
    const baseAttrs: Attributes = { ...defaultCfg.baseAttributes };
    const initialStats = computeDerivedStats(
      1,
      baseAttrs,
      this.lastEquipmentBonuses,
      this.lastPassiveBonuses,
    );
    this.baseUnmodifiedMoveSpeed = initialStats.moveSpeed;

    this.state = {
      id: 'player',
      heroClass: 'vanguard',
      name: defaultCfg.title,
      level: 1,
      xp: 0,
      xpToNextLevel: computeXpForNextLevel(1),
      unspentSkillPoints: 0,
      unspentAttributePoints: 0,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      facingDir: { x: 0, y: 0, z: 1 },
      rotationY: 0,
      radius: DEFAULT_PLAYER_RADIUS,
      hp: initialStats.maxHp,
      mana: initialStats.maxMana,
      stamina: initialStats.maxStamina,
      baseAttributes: baseAttrs,
      stats: initialStats,
      statuses: [],
      isDodging: false,
      invulnerableSec: 0,
      alive: true,
      healthPotions: POTION_STARTING_CHARGES,
      maxHealthPotions: POTION_MAX_CHARGES,
      potionCooldownSec: 0,
      gold: 0,
      floorsCleared: 0,
      killsTotal: 0,
    };

    this.unsubDamageDealt = eventBus.on('combat:damageDealt', ({ result, targetIsPlayer }) => {
      if (!targetIsPlayer || result.isDodged || result.finalDamage <= 0) return;

      if (this.state.hp <= 0 || !this.state.alive) {
        this.state.hp = 0;
        this.state.alive = false;
        if (!this.deathAnimPlayed) {
          this.deathAnimPlayed = true;
          this.rig?.playAnim('death');
        }
      } else {
        this.rig?.flashHit(0xff3b3b);
      }
    });
  }

  /**
   * Optional helper allowing main loop integration to link the active PerspectiveCamera
   * so WASD tracks live orbital mouse-drag / '[' ']' camera rotation automatically.
   */
  public setCamera(camera: THREE.Camera | null): void {
    this.cameraRef = camera;
  }

  /**
   * Optional helper to explicitly set fallback isometric camera yaw (radians).
   */
  public setCameraYaw(yawRad: number): void {
    if (Number.isFinite(yawRad)) {
      this.fallbackCameraYaw = yawRad;
    }
  }

  public init(heroClass: HeroClassId, spawnPos: Vec3, rig: IHeroRig): void {
    const cfg = HERO_CLASS_CONFIG[heroClass] ?? HERO_CLASS_CONFIG.vanguard;

    this.rig = rig;
    this.cursorWorldTarget = null;
    this.dodgeTimerSec = 0;
    this.dodgeCooldownSec = 0;
    this.teleporterCooldownSec = 0;
    this.castAnimHoldSec = 0;
    this.deathAnimPlayed = false;
    this.lastLocomotionAnim = 'idle';

    this.lastEquipmentBonuses = { attributes: {}, stats: {} };
    this.lastPassiveBonuses = { attributes: {}, stats: {}, keystones: [] };

    this.state.heroClass = heroClass;
    this.state.name = cfg.title;
    this.state.level = 1;
    this.state.xp = 0;
    this.state.xpToNextLevel = computeXpForNextLevel(1);
    this.state.unspentSkillPoints = 0;
    this.state.unspentAttributePoints = 0;

    this.state.position = {
      x: Number.isFinite(spawnPos.x) ? spawnPos.x : 0,
      y: Number.isFinite(spawnPos.y) ? spawnPos.y : 0,
      z: Number.isFinite(spawnPos.z) ? spawnPos.z : 0,
    };
    this.state.velocity = { x: 0, y: 0, z: 0 };
    this.state.facingDir = { x: 0, y: 0, z: 1 };
    this.state.rotationY = 0;
    this.state.radius = DEFAULT_PLAYER_RADIUS;

    this.state.baseAttributes = { ...cfg.baseAttributes };
    this.state.statuses = [];
    this.state.isDodging = false;
    this.state.invulnerableSec = 0;
    this.state.alive = true;

    this.state.healthPotions = POTION_STARTING_CHARGES;
    this.state.maxHealthPotions = POTION_MAX_CHARGES;
    this.state.potionCooldownSec = 0;
    this.state.gold = 0;
    this.state.floorsCleared = 0;
    this.state.killsTotal = 0;

    this.recomputeStats(this.lastEquipmentBonuses, this.lastPassiveBonuses);
    this.state.hp = this.state.stats.maxHp;
    this.state.mana = this.state.stats.maxMana;
    this.state.stamina = this.state.stats.maxStamina;

    rig.setClassStyle(heroClass);
    rig.setWeaponVisual(cfg.startingWeapon, 'common');
    rig.root.position.set(this.state.position.x, this.state.position.y, this.state.position.z);
    rig.root.rotation.y = this.state.rotationY;
    rig.playAnim('idle');
  }

  public attachInput(domElement: HTMLElement): void {
    this.input.attach(domElement);
  }

  public setVirtualMoveInput(x: number, y: number): void {
    this.input.setVirtualMove(x, y);
  }

  public requestTouchDodge(): void {
    this.input.triggerTouchDodge();
  }

  public requestTouchInteract(): void {
    this.input.triggerTouchInteract();
  }

  public requestTouchCast(slot: SkillSlotIndex): void {
    this.input.triggerTouchCast(slot);
  }

  public requestTouchAwakening(): void {
    this.input.triggerTouchAwakening();
  }

  public requestTouchParry(): void {
    this.input.triggerTouchParry();
  }

  public recomputeStats(
    equipmentBonuses: { attributes: Partial<Attributes>; stats: Partial<DerivedStats> },
    passiveBonuses: {
      attributes: Partial<Attributes>;
      stats: Partial<DerivedStats>;
      keystones: string[];
    },
  ): void {
    this.lastEquipmentBonuses = {
      attributes: { ...(equipmentBonuses?.attributes ?? {}) },
      stats: { ...(equipmentBonuses?.stats ?? {}) },
    };
    this.lastPassiveBonuses = {
      attributes: { ...(passiveBonuses?.attributes ?? {}) },
      stats: { ...(passiveBonuses?.stats ?? {}) },
      keystones: [...(passiveBonuses?.keystones ?? [])],
    };

    const prevMaxHp = this.state.stats.maxHp;
    const prevMaxMana = this.state.stats.maxMana;
    const prevMaxStamina = this.state.stats.maxStamina;

    const nextStats = computeDerivedStats(
      this.state.level,
      this.state.baseAttributes,
      this.lastEquipmentBonuses,
      this.lastPassiveBonuses,
    );
    this.state.stats = nextStats;
    this.baseUnmodifiedMoveSpeed = nextStats.moveSpeed;

    if (this.state.alive) {
      if (nextStats.maxHp > prevMaxHp) {
        this.state.hp += nextStats.maxHp - prevMaxHp;
      }
      this.state.hp = clamp(this.state.hp, Math.min(1, this.state.hp), nextStats.maxHp);
    } else {
      this.state.hp = 0;
    }

    if (nextStats.maxMana > prevMaxMana) {
      this.state.mana += nextStats.maxMana - prevMaxMana;
    }
    this.state.mana = clamp(this.state.mana, 0, nextStats.maxMana);

    if (nextStats.maxStamina > prevMaxStamina) {
      this.state.stamina += nextStats.maxStamina - prevMaxStamina;
    }
    this.state.stamina = clamp(this.state.stamina, 0, nextStats.maxStamina);
  }

  public grantXp(amount: number): { leveledUp: boolean; newLevel: number } {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { leveledUp: false, newLevel: this.state.level };
    }

    this.state.xp += amount;
    let leveledUp = false;

    while (this.state.xp >= this.state.xpToNextLevel) {
      this.state.xp -= this.state.xpToNextLevel;
      this.state.level += 1;
      this.state.unspentSkillPoints += 1;
      this.state.unspentAttributePoints += 3;
      this.state.xpToNextLevel = computeXpForNextLevel(this.state.level);
      leveledUp = true;
    }

    if (leveledUp) {
      this.recomputeStats(this.lastEquipmentBonuses, this.lastPassiveBonuses);

      // Full heal & resource restoration on level up
      if (this.state.alive) {
        this.state.hp = this.state.stats.maxHp;
      }
      this.state.mana = this.state.stats.maxMana;
      this.state.stamina = this.state.stats.maxStamina;
      this.state.healthPotions = Math.min(
        this.state.maxHealthPotions,
        this.state.healthPotions + 1,
      );

      const posSnapshot: Vec3 = { ...this.state.position };
      eventBus.emit('player:levelUp', {
        level: this.state.level,
        position: posSnapshot,
      });
      eventBus.emit('vfx:request', {
        type: 'level_up_pillar',
        position: posSnapshot,
      });
      eventBus.emit('sfx:request', {
        id: 'level_up',
        position: posSnapshot,
      });
      eventBus.emit('lighting:flash', {
        colorHex: 0xffd43b,
        intensity: 2.0,
        durationSec: 0.45,
      });
      eventBus.emit('ui:banner', {
        title: `LÊN CẤP ${this.state.level}!`,
        subtitle: '+1 Điểm Kỹ Năng • +3 Điểm Thuộc Tính',
        tone: 'gold',
      });
    }

    return { leveledUp, newLevel: this.state.level };
  }

  public spendAttributePoint(attr: keyof Attributes): boolean {
    if (this.state.unspentAttributePoints <= 0) return false;
    if (!VALID_ATTRIBUTES.has(attr)) return false;

    this.state.unspentAttributePoints -= 1;
    this.state.baseAttributes[attr] += 1;
    this.recomputeStats(this.lastEquipmentBonuses, this.lastPassiveBonuses);

    eventBus.emit('sfx:request', { id: 'ui_click' });
    return true;
  }

  public useHealthPotion(): boolean {
    if (!this.state.alive) return false;
    if (this.state.healthPotions <= 0) return false;
    if (this.state.potionCooldownSec > 0) return false;
    if (this.state.hp >= this.state.stats.maxHp) return false;

    this.state.healthPotions -= 1;
    this.state.potionCooldownSec = POTION_COOLDOWN_SEC;

    const healAmount = Math.round(this.state.stats.maxHp * 0.45 + 35);
    this.state.hp = Math.min(this.state.stats.maxHp, this.state.hp + healAmount);

    const posSnapshot: Vec3 = { ...this.state.position };
    eventBus.emit('vfx:request', {
      type: 'heal_aura',
      position: posSnapshot,
    });
    eventBus.emit('sfx:request', {
      id: 'potion_drink',
      position: posSnapshot,
    });

    return true;
  }

  public respawnAt(pos: Vec3): void {
    this.state.position = {
      x: Number.isFinite(pos.x) ? pos.x : 0,
      y: Number.isFinite(pos.y) ? pos.y : 0,
      z: Number.isFinite(pos.z) ? pos.z : 0,
    };
    this.state.velocity = { x: 0, y: 0, z: 0 };
    this.state.statuses = [];
    this.state.isDodging = false;
    this.state.invulnerableSec = 1.5;
    this.state.potionCooldownSec = 0;
    this.state.alive = true;
    this.state.healthPotions = Math.max(this.state.healthPotions, POTION_STARTING_CHARGES);

    this.dodgeTimerSec = 0;
    this.dodgeCooldownSec = 0;
    this.teleporterCooldownSec = 0;
    this.castAnimHoldSec = 0;
    this.deathAnimPlayed = false;
    this.lastLocomotionAnim = 'idle';
    this.input.clearTransientBuffers();

    this.recomputeStats(this.lastEquipmentBonuses, this.lastPassiveBonuses);
    this.state.hp = this.state.stats.maxHp;
    this.state.mana = this.state.stats.maxMana;
    this.state.stamina = this.state.stats.maxStamina;

    if (this.rig) {
      this.rig.root.position.set(this.state.position.x, this.state.position.y, this.state.position.z);
      this.rig.root.rotation.y = this.state.rotationY;
      this.rig.playAnim('idle');
    }
  }

  public setCursorWorldTarget(target: Vec3 | null): void {
    if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
      this.cursorWorldTarget = {
        x: target.x,
        y: Number.isFinite(target.y) ? target.y : 0,
        z: target.z,
      };
    } else {
      this.cursorWorldTarget = null;
    }
  }

  public update(
    dt: number,
    floor: DungeonFloorData,
    uiBlockingInput: boolean,
  ): {
    castSlotRequested: SkillSlotIndex | null;
    interactRequested: boolean;
    dodgeTriggered?: boolean;
    parryRequested?: boolean;
    awakeningRequested?: boolean;
  } {
    if (!Number.isFinite(dt) || dt <= 0) {
      return {
        castSlotRequested: null,
        interactRequested: false,
        dodgeTriggered: false,
        parryRequested: false,
        awakeningRequested: false,
      };
    }

    const stepDt = Math.min(dt, 0.1);
    this.input.tickBuffers(stepDt);

    // Handle dead state cleanly
    if (!this.state.alive || this.state.hp <= 0) {
      this.state.hp = 0;
      this.state.alive = false;
      this.state.isDodging = false;
      this.state.velocity.x = 0;
      this.state.velocity.y = 0;
      this.state.velocity.z = 0;
      this.input.clearTransientBuffers();

      if (!this.deathAnimPlayed) {
        this.deathAnimPlayed = true;
        this.rig?.playAnim('death');
      }
      this.syncRigTransformAndUpdate(stepDt, 0);
      return {
        castSlotRequested: null,
        interactRequested: false,
        dodgeTriggered: false,
        parryRequested: false,
        awakeningRequested: false,
      };
    }

    // Tick timers
    if (this.state.invulnerableSec > 0) {
      this.state.invulnerableSec = Math.max(0, this.state.invulnerableSec - stepDt);
    }
    if (this.state.potionCooldownSec > 0) {
      this.state.potionCooldownSec = Math.max(0, this.state.potionCooldownSec - stepDt);
    }
    if (this.dodgeCooldownSec > 0) {
      this.dodgeCooldownSec = Math.max(0, this.dodgeCooldownSec - stepDt);
    }
    if (this.teleporterCooldownSec > 0) {
      this.teleporterCooldownSec = Math.max(0, this.teleporterCooldownSec - stepDt);
    }
    if (this.castAnimHoldSec > 0) {
      this.castAnimHoldSec = Math.max(0, this.castAnimHoldSec - stepDt);
    }

    // Passive HP / Mana / Stamina regeneration
    this.state.hp = Math.min(
      this.state.stats.maxHp,
      this.state.hp + this.state.stats.hpRegen * stepDt,
    );
    this.state.mana = Math.min(
      this.state.stats.maxMana,
      this.state.mana + this.state.stats.manaRegen * stepDt,
    );
    if (!this.state.isDodging) {
      this.state.stamina = Math.min(
        this.state.stats.maxStamina,
        this.state.stamina + this.state.stats.staminaRegen * stepDt,
      );
    }

    // Track '[' / ']' orbital yaw fallback when no live camera instance is linked
    if (!uiBlockingInput && !this.resolveActiveCamera()) {
      const yawInput = this.input.getOrbitalYawInput();
      if (yawInput !== 0) {
        this.fallbackCameraYaw = normalizeAngle(
          this.fallbackCameraYaw + yawInput * ORBITAL_KEY_YAW_SPEED * stepDt,
        );
      }
    }

    if (uiBlockingInput) {
      this.input.clearTransientBuffers();
    }

    const incapacitated = this.isIncapacitated();

    // Potion hotkey ('Q')
    if (!uiBlockingInput && this.input.consumePotionRequest()) {
      this.useHealthPotion();
    }

    // Compute camera-relative / isometric world movement direction
    const rawMove = uiBlockingInput || incapacitated ? { x: 0, y: 0 } : this.input.getMoveInput();
    const { forward, right } = this.getCameraPlanarBasis();
    let desiredMoveDir: Vec3 | null = null;

    if (Math.hypot(rawMove.x, rawMove.y) > 1e-4) {
      const wx = right.x * rawMove.x + forward.x * rawMove.y;
      const wz = right.z * rawMove.x + forward.z * rawMove.y;
      desiredMoveDir = normalizeXZ(wx, wz, this.state.facingDir);
    }

    // Dodge roll trigger ('Space' / 'Shift')
    let dodgeTriggered = false;
    if (!uiBlockingInput && !incapacitated && this.input.consumeDodgeRequest()) {
      if (
        !this.state.isDodging &&
        this.dodgeCooldownSec <= 0 &&
        this.state.stamina >= DODGE_STAMINA_COST
      ) {
        this.startDodgeRoll(desiredMoveDir);
        dodgeTriggered = true;
      }
    }

    // Update velocity & active dodge state
    // Detect glacial 'hazard_ice' tiles for responsive ice-skating inertia & speed boost
    const underCell = this.getTileAtWorld(floor, this.state.position);
    const onIce = underCell?.tile === 'hazard_ice';
    const surfaceSpeedMult = onIce ? ICE_SPEED_BOOST_MULT : 1.0;

    // Avoid double-applying chill/haste if CombatEngine.tickStatuses already scaled stats.moveSpeed
    const speedAlreadyScaledByCombat =
      Math.abs(this.state.stats.moveSpeed - this.baseUnmodifiedMoveSpeed) > 1e-3;
    const statusSpeedMult = speedAlreadyScaledByCombat ? 1.0 : this.getStatusMoveSpeedMultiplier();
    const effectiveMoveSpeed = incapacitated
      ? 0
      : this.state.stats.moveSpeed * statusSpeedMult * surfaceSpeedMult;

    if (this.state.isDodging) {
      this.dodgeTimerSec -= stepDt;
      if (this.dodgeTimerSec <= 0) {
        this.state.isDodging = false;
        this.dodgeTimerSec = 0;
      } else {
        // High-speed burst with gentle ease-out at end of roll
        const progress = 1 - clamp(this.dodgeTimerSec / DODGE_DURATION_SEC, 0, 1);
        const taper = 1 - progress * progress * 0.35;
        const burstSpeed = effectiveMoveSpeed * DODGE_SPEED_MULTIPLIER * taper;
        this.state.velocity.x = this.dodgeDir.x * burstSpeed;
        this.state.velocity.y = 0;
        this.state.velocity.z = this.dodgeDir.z * burstSpeed;
      }
    }

    if (!this.state.isDodging) {
      const targetVx = desiredMoveDir ? desiredMoveDir.x * effectiveMoveSpeed : 0;
      const targetVz = desiredMoveDir ? desiredMoveDir.z * effectiveMoveSpeed : 0;
      const accelRate = onIce ? ICE_ACCEL_RATE : MOVE_ACCEL_RATE;
      const decelRate = onIce ? ICE_DECEL_RATE : MOVE_DECEL_RATE;
      const rate = desiredMoveDir ? accelRate : decelRate;
      const blend = 1 - Math.exp(-rate * stepDt);

      this.state.velocity.x += (targetVx - this.state.velocity.x) * blend;
      this.state.velocity.y = 0;
      this.state.velocity.z += (targetVz - this.state.velocity.z) * blend;

      if (!desiredMoveDir && Math.hypot(this.state.velocity.x, this.state.velocity.z) < 0.02) {
        this.state.velocity.x = 0;
        this.state.velocity.z = 0;
      }
    }

    // Smooth sliding circle-vs-tile collision resolution
    const dx = this.state.velocity.x * stepDt;
    const dz = this.state.velocity.z * stepDt;
    const prevX = this.state.position.x;
    const prevZ = this.state.position.z;

    const resolvedPos = resolveCircleSlideMove(
      this.state.position,
      dx,
      dz,
      this.state.radius,
      floor,
    );
    this.state.position.x = resolvedPos.x;
    this.state.position.y = resolvedPos.y;
    this.state.position.z = resolvedPos.z;

    // Reflect actual wall-clipped velocity
    this.state.velocity.x = (this.state.position.x - prevX) / stepDt;
    this.state.velocity.z = (this.state.position.z - prevZ) / stepDt;

    // Check paired 'teleporter_pad' warping (2.5s warp cooldown prevents bounce-back)
    this.tryUseTeleporterPad(floor);

    // Reveal minimap fog-of-war around hero
    floor.revealRadius?.(this.state.position, FOG_REVEAL_RADIUS);

    // Cursor aiming & smooth rotationY
    this.updateAimingAndRotation(stepDt, desiredMoveDir, incapacitated);

    // Skill, Interact, Parry ('V' / MMB) & Awakening ('R') hotkeys
    let castSlotRequested: SkillSlotIndex | null = null;
    let interactRequested = false;
    let parryRequested = false;
    let awakeningRequested = false;

    if (!uiBlockingInput && !incapacitated) {
      awakeningRequested = this.input.consumeAwakeningRequest();
      if (!this.state.isDodging) {
        parryRequested = this.input.consumeParryRequest();
        interactRequested = this.input.consumeInteractRequest();
        castSlotRequested = this.input.consumeCastSlotRequest();
        if (parryRequested) {
          this.castAnimHoldSec = Math.max(this.castAnimHoldSec, 0.3);
          this.lastLocomotionAnim = 'none';
        } else if (castSlotRequested !== null) {
          this.castAnimHoldSec = 0.32 / Math.max(0.5, this.state.stats.attackSpeed);
          this.lastLocomotionAnim = 'none';
        }
      } else {
        this.input.clearTransientBuffers();
      }
    } else if (incapacitated) {
      this.input.clearTransientBuffers();
    }

    // Drive HeroRig locomotion & transforms
    const actualSpeed = Math.hypot(this.state.velocity.x, this.state.velocity.z);
    const moveSpeedNormalized = clamp(
      actualSpeed / Math.max(1, this.baseUnmodifiedMoveSpeed),
      0,
      1.5,
    );

    if (!this.state.isDodging && this.castAnimHoldSec <= 0) {
      const nextLocomotion: HeroAnimState = actualSpeed > 0.35 ? 'run' : 'idle';
      if (this.lastLocomotionAnim !== nextLocomotion) {
        this.lastLocomotionAnim = nextLocomotion;
        this.rig?.playAnim(nextLocomotion);
      }
    }

    this.syncRigTransformAndUpdate(stepDt, moveSpeedNormalized);

    return {
      castSlotRequested,
      interactRequested,
      dodgeTriggered,
      parryRequested,
      awakeningRequested,
    };
  }

  public dispose(): void {
    this.input.detach();
    this.unsubDamageDealt();
    this.rig = null;
    this.cameraRef = null;
    this.cursorWorldTarget = null;
  }

  private startDodgeRoll(desiredMoveDir: Vec3 | null): void {
    let dir: Vec3;
    if (desiredMoveDir) {
      dir = desiredMoveDir;
    } else if (this.cursorWorldTarget) {
      const toCursorX = this.cursorWorldTarget.x - this.state.position.x;
      const toCursorZ = this.cursorWorldTarget.z - this.state.position.z;
      dir = normalizeXZ(toCursorX, toCursorZ, this.state.facingDir);
    } else {
      dir = normalizeXZ(this.state.facingDir.x, this.state.facingDir.z, { x: 0, y: 0, z: 1 });
    }

    this.dodgeDir = dir;
    this.state.stamina = Math.max(0, this.state.stamina - DODGE_STAMINA_COST);
    this.state.isDodging = true;
    this.state.invulnerableSec = Math.max(this.state.invulnerableSec, DODGE_IFRAME_SEC);

    this.dodgeTimerSec = DODGE_DURATION_SEC;
    this.dodgeCooldownSec = DODGE_COOLDOWN_SEC;

    this.state.facingDir = { ...dir };
    this.state.rotationY = Math.atan2(dir.x, dir.z);

    this.lastLocomotionAnim = 'dodge';
    this.castAnimHoldSec = 0;
    this.rig?.playAnim('dodge', 1.15);

    const posSnapshot: Vec3 = { ...this.state.position };
    const dirSnapshot: Vec3 = { ...dir };

    eventBus.emit('player:dodge', {
      position: posSnapshot,
      direction: dirSnapshot,
    });
    eventBus.emit('vfx:request', {
      type: 'dodge_afterimage',
      position: posSnapshot,
      direction: dirSnapshot,
    });
    eventBus.emit('sfx:request', {
      id: 'dodge_whoosh',
      position: posSnapshot,
    });
  }

  private updateAimingAndRotation(
    dt: number,
    desiredMoveDir: Vec3 | null,
    incapacitated: boolean,
  ): void {
    if (incapacitated) return;

    if (this.state.isDodging) {
      this.state.facingDir = { ...this.dodgeDir };
      const targetRot = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
      this.state.rotationY = lerpAngle(
        this.state.rotationY,
        targetRot,
        1 - Math.exp(-TURN_SMOOTH_SPEED * 1.5 * dt),
      );
      return;
    }

    if (this.cursorWorldTarget) {
      const dx = this.cursorWorldTarget.x - this.state.position.x;
      const dz = this.cursorWorldTarget.z - this.state.position.z;
      if (Math.hypot(dx, dz) > 0.04) {
        this.state.facingDir = normalizeXZ(dx, dz, this.state.facingDir);
      }
    } else if (desiredMoveDir) {
      this.state.facingDir = { ...desiredMoveDir };
    }

    const targetRotationY = Math.atan2(this.state.facingDir.x, this.state.facingDir.z);
    const turnAlpha = 1 - Math.exp(-TURN_SMOOTH_SPEED * dt);
    this.state.rotationY = lerpAngle(this.state.rotationY, targetRotationY, turnAlpha);
  }

  private isIncapacitated(): boolean {
    for (const s of this.state.statuses) {
      if ((s.type === 'freeze' || s.type === 'stun') && s.remainingSec > 0) {
        return true;
      }
    }
    return false;
  }

  private getStatusMoveSpeedMultiplier(): number {
    let mult = 1.0;
    let chilled = false;
    let hasteBonus = 0;

    for (const s of this.state.statuses) {
      if (s.remainingSec <= 0) continue;
      if (s.type === 'chill') {
        chilled = true;
      } else if (s.type === 'haste') {
        const rawPotency = s.potency > 0 ? (s.potency > 1.5 ? s.potency / 100 : s.potency) : 0.3;
        hasteBonus = Math.max(hasteBonus, clamp(rawPotency, 0.15, 0.8));
      }
    }

    if (chilled) {
      mult *= 0.65; // -35% chill slow
    }
    if (hasteBonus > 0) {
      mult *= 1 + hasteBonus;
    }

    return mult;
  }

  private resolveActiveCamera(): THREE.Camera | null {
    if (this.cameraRef) return this.cameraRef;
    if (!this.rig?.root) return null;

    let rootObj: THREE.Object3D = this.rig.root;
    while (rootObj.parent) {
      rootObj = rootObj.parent;
    }

    for (const child of rootObj.children) {
      if ((child as unknown as { isCamera?: boolean }).isCamera) {
        this.cameraRef = child as THREE.Camera;
        return this.cameraRef;
      }
    }
    return null;
  }

  private getCameraPlanarBasis(): { forward: Vec3; right: Vec3 } {
    const cam = this.resolveActiveCamera();
    if (cam && cam.matrixWorld?.elements) {
      const e = cam.matrixWorld.elements;
      // Column 0 of matrixWorld is camera local +X (Right) in world space
      const rx = e[0];
      const rz = e[2];
      const rLen = Math.hypot(rx, rz);
      if (rLen > 1e-5) {
        const right: Vec3 = { x: rx / rLen, y: 0, z: rz / rLen };
        // Orthonormal screen-up vector on XZ plane (90° CCW from right when viewed from +Y)
        const forward: Vec3 = { x: right.z, y: 0, z: -right.x };
        return { forward, right };
      }
    }

    // Fallback isometric / orbital yaw basis
    const sinY = Math.sin(this.fallbackCameraYaw);
    const cosY = Math.cos(this.fallbackCameraYaw);
    return {
      forward: { x: -sinY, y: 0, z: -cosY },
      right: { x: cosY, y: 0, z: -sinY },
    };
  }

  private syncRigTransformAndUpdate(dt: number, moveSpeedNormalized: number): void {
    if (!this.rig) return;
    this.rig.root.position.set(
      this.state.position.x,
      this.state.position.y,
      this.state.position.z,
    );
    this.rig.root.rotation.y = this.state.rotationY;
    this.rig.update(dt, moveSpeedNormalized);
  }

  private getTileAtWorld(
    floor: DungeonFloorData | null | undefined,
    pos: Vec3,
  ): { tile: TileType; col: number; row: number } | null {
    if (!floor || !Array.isArray(floor.tiles) || floor.tiles.length === 0) return null;
    if (typeof floor.worldToGrid !== 'function') return null;

    const { col, row } = floor.worldToGrid(pos);
    if (
      !Number.isFinite(row) ||
      !Number.isFinite(col) ||
      row < 0 ||
      row >= floor.tiles.length
    ) {
      return null;
    }

    const rowArr = floor.tiles[row];
    if (!Array.isArray(rowArr) || col < 0 || col >= rowArr.length) return null;

    const tile = rowArr[col];
    return tile ? { tile, col, row } : null;
  }

  private tryUseTeleporterPad(floor: DungeonFloorData): boolean {
    if (this.teleporterCooldownSec > 0) return false;

    const currentCell = this.getTileAtWorld(floor, this.state.position);
    if (!currentCell || currentCell.tile !== 'teleporter_pad') return false;

    // Collect all 'teleporter_pad' cells and group 8-connected contiguous cells into pad islands
    const rawCells: Array<{ col: number; row: number }> = [];
    for (let r = 0; r < floor.tiles.length; r++) {
      const rowArr = floor.tiles[r];
      if (!rowArr) continue;
      for (let c = 0; c < rowArr.length; c++) {
        if (rowArr[c] === 'teleporter_pad') {
          rawCells.push({ col: c, row: r });
        }
      }
    }

    if (rawCells.length < 2) return false;

    const visited = new Uint8Array(rawCells.length);
    const islands: Array<{
      cells: Array<{ col: number; row: number }>;
      centerCol: number;
      centerRow: number;
    }> = [];

    for (let i = 0; i < rawCells.length; i++) {
      if (visited[i]) continue;
      visited[i] = 1;
      const cluster: Array<{ col: number; row: number }> = [rawCells[i]];
      let head = 0;

      while (head < cluster.length) {
        const cur = cluster[head++];
        for (let j = 0; j < rawCells.length; j++) {
          if (visited[j]) continue;
          const cand = rawCells[j];
          if (Math.abs(cand.col - cur.col) <= 1 && Math.abs(cand.row - cur.row) <= 1) {
            visited[j] = 1;
            cluster.push(cand);
          }
        }
      }

      let sumCol = 0;
      let sumRow = 0;
      for (const cell of cluster) {
        sumCol += cell.col;
        sumRow += cell.row;
      }
      const avgCol = sumCol / cluster.length;
      const avgRow = sumRow / cluster.length;

      let bestCell = cluster[0];
      let bestDistSq = Infinity;
      for (const cell of cluster) {
        const dSq = (cell.col - avgCol) ** 2 + (cell.row - avgRow) ** 2;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestCell = cell;
        }
      }

      islands.push({
        cells: cluster,
        centerCol: bestCell.col,
        centerRow: bestCell.row,
      });
    }

    if (islands.length < 2) return false;

    islands.sort((a, b) => a.centerRow - b.centerRow || a.centerCol - b.centerCol);

    const srcIdx = islands.findIndex((isl) =>
      isl.cells.some((c) => c.col === currentCell.col && c.row === currentCell.row),
    );
    if (srcIdx < 0) return false;

    // Deterministic pair routing: (0 <-> 1), (2 <-> 3), ..., wrapping odd trailing island to 0
    const partnerIdx =
      srcIdx % 2 === 0 ? (srcIdx + 1 < islands.length ? srcIdx + 1 : 0) : srcIdx - 1;
    const partner = islands[partnerIdx];
    if (!partner) return false;

    const destWorld = floor.gridToWorld(partner.centerCol, partner.centerRow);
    if (!Number.isFinite(destWorld.x) || !Number.isFinite(destWorld.z)) return false;

    const originPos: Vec3 = { ...this.state.position };
    this.state.position.x = destWorld.x;
    this.state.position.z = destWorld.z;
    this.state.velocity.x *= 0.35;
    this.state.velocity.z *= 0.35;

    this.teleporterCooldownSec = TELEPORTER_COOLDOWN_SEC;
    this.state.invulnerableSec = Math.max(this.state.invulnerableSec, 0.25);

    const destSnapshot: Vec3 = { ...this.state.position };
    eventBus.emit('vfx:request', {
      type: 'void_implosion',
      position: originPos,
      colorHex: 0x4dabf7,
      scale: 0.85,
    });
    eventBus.emit('vfx:request', {
      type: 'lightning_strike',
      position: destSnapshot,
      colorHex: 0x74c0fc,
      scale: 0.9,
    });
    eventBus.emit('sfx:request', {
      id: 'portal_hum',
      position: destSnapshot,
    });
    eventBus.emit('lighting:flash', {
      colorHex: 0x4dabf7,
      intensity: 1.35,
      durationSec: 0.25,
    });

    return true;
  }
}

export function createPlayerController(): IPlayerController {
  return new PlayerController();
}
