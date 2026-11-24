import type * as THREE from 'three';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GridCoord {
  col: number;
  row: number;
}

export type HeroClassId = 'vanguard' | 'shadowblade' | 'arcanist';

export type DamageType = 'physical' | 'fire' | 'ice' | 'lightning' | 'poison' | 'void';

export type StatusEffectType =
  | 'burn'
  | 'chill'
  | 'freeze'
  | 'poison'
  | 'bleed'
  | 'stun'
  | 'vulnerable'
  | 'shield'
  | 'haste';

export interface Attributes {
  strength: number;
  dexterity: number;
  intelligence: number;
  vitality: number;
}

export interface DerivedStats {
  maxHp: number;
  hpRegen: number;
  maxMana: number;
  manaRegen: number;
  maxStamina: number;
  staminaRegen: number;
  moveSpeed: number;
  attackPower: number;
  spellPower: number;
  armor: number;
  critChance: number;
  critMultiplier: number;
  attackSpeed: number;
  cooldownReduction: number;
  lifeSteal: number;
  dodgeChance: number;
}

export interface ActiveStatusEffect {
  id: string;
  type: StatusEffectType;
  remainingSec: number;
  durationSec: number;
  stacks: number;
  potency: number;
  sourceId: string;
}

export type HeroAnimState =
  | 'idle'
  | 'run'
  | 'dodge'
  | 'attack_1'
  | 'attack_2'
  | 'attack_3'
  | 'whirlwind'
  | 'leap_slam'
  | 'cast'
  | 'hit'
  | 'death';

export type WeaponVisualType = 'greatsword' | 'daggers' | 'staff' | 'warhammer' | 'sword_shield';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type DlssMode =
  | 'native'
  | 'dlaa'
  | 'quality'
  | 'balanced'
  | 'performance'
  | 'ultra_performance';

export type TargetFpsLimit = 60 | 120 | 144 | 0;

export interface EngineTelemetryStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  renderScale?: number;
  dlssMode?: DlssMode;
  targetFps?: TargetFpsLimit;
  internalWidth?: number;
  internalHeight?: number;
  frameTimeMs?: number;
}

export interface IHeroRig {
  readonly root: THREE.Group;
  setClassStyle(heroClass: HeroClassId): void;
  setWeaponVisual(weapon: WeaponVisualType, rarity?: ItemRarity): void;
  playAnim(state: HeroAnimState, speedMultiplier?: number): void;
  playPickupGesture?(targetWorldPos?: Vec3): void;
  playEquipFlourish?(rarity?: ItemRarity): void;
  playParryAnim?(counterSuccess?: boolean): void;
  playExecuteFinisher?(): void;
  playSocialEmote?(emoteId: SocialEmoteId): void;
  setAwakenedVisual?(active: boolean): void;
  triggerSlashTrail?(colorHex?: number, durationSec?: number): void;
  flashHit(colorHex?: number): void;
  update(dt: number, moveSpeedNormalized: number): void;
  getWeaponTipWorldPosition(out?: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export type SkillSlotIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type SkillTargeting = 'melee_arc' | 'projectile' | 'aoe_self' | 'aoe_cursor' | 'dash' | 'buff';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  heroClass: HeroClassId | 'any';
  slotHint: SkillSlotIndex;
  damageType: DamageType;
  targeting: SkillTargeting;
  manaCost: number;
  cooldownSec: number;
  baseDamageMultiplier: number;
  range: number;
  radius: number;
  projectileCount?: number;
  projectileSpeed?: number;
  appliesStatus?: {
    type: StatusEffectType;
    chance: number;
    durationSec: number;
    potency: number;
  };
  animState: HeroAnimState;
}

export type PassiveBranch = 'warlord' | 'assassin' | 'archmage';

export interface PassiveNode {
  id: string;
  name: string;
  description: string;
  branch: PassiveBranch;
  isKeystone: boolean;
  position: Vec2;
  prerequisites: string[];
  maxRank: number;
  statModifiers: Partial<DerivedStats & Attributes>;
  specialKeystoneId?: 'blood_pact' | 'elemental_overload' | 'phantom_crit';
}

export interface StatBonusBundle {
  attributes: Partial<Attributes>;
  stats: Partial<DerivedStats>;
  keystones?: string[];
}

export interface ISkillSystem {
  getEquippedSkills(heroClass: HeroClassId): SkillDefinition[];
  getAllSkills(): SkillDefinition[];
  canCast(slot: SkillSlotIndex, currentMana: number): boolean;
  triggerCast(
    slot: SkillSlotIndex,
    cooldownReduction: number,
  ): { skill: SkillDefinition; manaSpent: number } | null;
  getCooldownState(slot: SkillSlotIndex): { remaining: number; total: number; ready: boolean };
  getPassiveTree(): PassiveNode[];
  getAllocatedPassives(): Record<string, number>;
  allocatePassive(nodeId: string, availablePoints: number): boolean;
  resetPassives(): number;
  computePassiveBonuses(): {
    attributes: Partial<Attributes>;
    stats: Partial<DerivedStats>;
    keystones: string[];
  };
  loadAllocatedPassives(saved: Record<string, number>): void;
  update(dt: number): void;
}

export type BiomeId =
  | 'sanctuary'
  | 'crypt'
  | 'caverns'
  | 'forge'
  | 'void'
  | 'cathedral'
  | 'observatory'
  | 'colosseum';

export type TileType =
  | 'void'
  | 'wall'
  | 'floor'
  | 'corridor'
  | 'door'
  | 'hazard_lava'
  | 'hazard_poison'
  | 'hazard_ice'
  | 'teleporter_pad';

export type RoomType =
  | 'spawn'
  | 'combat'
  | 'elite'
  | 'treasure'
  | 'shrine'
  | 'trap'
  | 'cursed_event'
  | 'boss';

export type InteractableType =
  | 'chest'
  | 'cursed_chest'
  | 'shrine_heal'
  | 'shrine_power'
  | 'shrine_frenzy'
  | 'portal_next_floor'
  | 'lore_tome'
  | 'blacksmith_anvil'
  | 'stash_chest'
  | 'gambler_npc'
  | 'companion_shrine'
  | 'waypoint_map'
  | 'training_dummy'
  | 'corrupted_obelisk'
  | 'soul_lantern'
  | 'rift_breach';

export interface InteractableProp {
  id: string;
  type: InteractableType;
  position: Vec3;
  roomId: string;
  used: boolean;
  label: string;
  loreId?: string;
}

export interface DungeonRoom {
  id: string;
  type: RoomType;
  x: number;
  y: number;
  width: number;
  height: number;
  centerGrid: GridCoord;
  centerWorld: Vec3;
  connectedRoomIds: string[];
  cleared: boolean;
}

export interface DungeonFloorData {
  floorNumber: number;
  biome: BiomeId;
  seed: number;
  cols: number;
  rows: number;
  tileSize: number;
  tiles: TileType[][];
  explored: boolean[][];
  rooms: DungeonRoom[];
  playerSpawn: Vec3;
  bossSpawn: Vec3;
  portalPosition: Vec3;
  interactables: InteractableProp[];
  torchPositions: Vec3[];
  worldToGrid(worldPos: Vec3): GridCoord;
  gridToWorld(col: number, row: number): Vec3;
  isWalkableWorld(x: number, z: number, radius?: number): boolean;
  findPath(fromWorld: Vec3, toWorld: Vec3, maxSteps?: number): Vec3[];
  revealRadius(worldPos: Vec3, radiusWorld: number): void;
}

export interface IDungeonGenerator {
  generateFloor(floorNumber: number, seed?: number): DungeonFloorData;
  generateColosseumFloor?(waveTier?: number, seed?: number): DungeonFloorData;
}

export type MaterialKey =
  | 'floor_sanctuary'
  | 'floor_crypt'
  | 'floor_caverns'
  | 'floor_forge'
  | 'floor_void'
  | 'floor_cathedral'
  | 'floor_observatory'
  | 'floor_colosseum'
  | 'wall_stone'
  | 'wall_obsidian'
  | 'metal_steel'
  | 'metal_gold'
  | 'metal_dark_iron'
  | 'brass_clockwork'
  | 'wood_oak'
  | 'rune_glow_blue'
  | 'rune_glow_crimson'
  | 'rune_glow_emerald'
  | 'rune_glow_void'
  | 'crystal_cyan'
  | 'ice_glacier'
  | 'mythic_crimson'
  | 'bone'
  | 'flesh_demon'
  | 'cloth_crimson'
  | 'cloth_shadow'
  | 'cloth_arcane'
  | 'lava_emissive';

export interface IMaterialLibrary {
  get(key: MaterialKey): THREE.MeshStandardMaterial;
  clone(key: MaterialKey): THREE.MeshStandardMaterial;
  getTexture(key: MaterialKey): THREE.Texture;
  updateShaders?(elapsedSec: number, playerPos?: Vec3): void;
  dispose(): void;
}

export interface IDungeonMeshBuilder {
  buildFloor(floor: DungeonFloorData, materials: IMaterialLibrary): THREE.Group;
  setInteractableUsed(propId: string): void;
  setPortalActive(active: boolean): void;
  setPlayerPosition?(playerPos: Vec3): void;
  getWallMeshesForOcclusion(): THREE.Object3D[];
  update(dt: number, elapsedSec: number): void;
  dispose(): void;
}

export interface HazardInstance {
  id: string;
  kind:
    | 'spike_trap'
    | 'pendulum_blade'
    | 'poison_vent'
    | 'lava_pool'
    | 'arcane_turret'
    | 'breakable_barrel'
    | 'breakable_urn';
  position: Vec3;
  radius: number;
  destroyed?: boolean;
}

export interface IHazardSystem {
  populateFloor(floor: DungeonFloorData, scene: THREE.Scene, materials: IMaterialLibrary): void;
  damageDestructibleAt(
    position: Vec3,
    radius: number,
    damage: number,
  ): { broken: HazardInstance[] };
  update(
    dt: number,
    playerPos: Vec3,
  ): {
    playerDamageEvents: Array<{
      amount: number;
      type: DamageType;
      status?: StatusEffectType;
    }>;
  };
  dispose(): void;
}

export interface ILightingDirector {
  init(scene: THREE.Scene): void;
  applyBiome(biome: BiomeId, torchPositions: Vec3[]): void;
  setEventAtmosphere?(mode: 'none' | 'blood_moon' | 'darkness_escort' | 'awakening'): void;
  triggerFlash(colorHex: number, intensity: number, durationSec: number): void;
  update(dt: number, playerPos: Vec3): void;
  dispose(): void;
}

export interface IEngineCore {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  mount(container: HTMLElement, camera: THREE.PerspectiveCamera): void;
  startLoop(
    onFixedUpdate: (dt: number) => void,
    onRenderUpdate: (dt: number, elapsed: number) => void,
  ): void;
  stopLoop(): void;
  triggerHitstop(durationSec: number, timeScale?: number): void;
  setBloomStrength(strength: number): void;
  setQuality(quality: 'low' | 'medium' | 'high'): void;
  setDlssMode?(mode: DlssMode, sharpness?: number): void;
  setTargetFps?(fps: TargetFpsLimit, dynamicRes?: boolean): void;
  triggerScreenWarp?(durationSec?: number, intensity?: number): void;
  triggerChromaticPulse?(intensity?: number, durationSec?: number): void;
  getStats(): EngineTelemetryStats;
  dispose(): void;
}

export interface ICameraRig {
  readonly camera: THREE.PerspectiveCamera;
  attachControls(domElement: HTMLElement): void;
  setTarget(pos: Vec3, immediate?: boolean): void;
  addShake(trauma: number): void;
  addFovPunch?(deltaDeg: number): void;
  playExecutionZoom?(targetPos: Vec3): void;
  playBossIntroPan(bossPos: Vec3, durationSec?: number): void;
  setOccluderMeshes(meshes: THREE.Object3D[]): void;
  screenToGroundWorld(clientX: number, clientY: number, groundY?: number): Vec3 | null;
  worldToScreen(worldPos: Vec3): { x: number; y: number; visible: boolean };
  setSensitivity(value: number): void;
  update(dt: number): void;
  dispose(): void;
}

export type EnemyArchetypeId =
  | 'skeleton_warrior'
  | 'bone_archer'
  | 'dark_cultist'
  | 'plague_spider'
  | 'abyssal_golem'
  | 'void_assassin'
  | 'hellhound'
  | 'lich_summoner'
  | 'frost_revenant'
  | 'ice_wraith'
  | 'clockwork_automaton'
  | 'astral_weaver'
  | 'treasure_goblin'
  | 'chest_mimic';

export type BossId =
  | 'bone_colossus'
  | 'arachne_broodmother'
  | 'ignis_forgemaster'
  | 'malakor_void_emperor'
  | 'valkyria_rime_seraph'
  | 'chronos_time_architect'
  | 'the_butcher';

export type EliteAffix =
  | 'vampiric'
  | 'molten'
  | 'frozen_pulse'
  | 'teleporter'
  | 'berserker'
  | 'arcane_enchanted';

export type EnemyAnimState = 'idle' | 'walk' | 'windup' | 'attack' | 'cast' | 'hit' | 'death';

export interface IEnemyMeshHandle {
  readonly root: THREE.Group;
  playAnim(state: EnemyAnimState, speed?: number): void;
  flashHit(colorHex?: number): void;
  setEliteVisuals(affixes: EliteAffix[]): void;
  update(dt: number): void;
  dispose(): void;
}

export interface IEnemyMeshFactory {
  createEnemyMesh(
    archetype: EnemyArchetypeId,
    isElite: boolean,
    materials: IMaterialLibrary,
  ): IEnemyMeshHandle;
  createBossMesh(bossId: BossId, materials: IMaterialLibrary): IEnemyMeshHandle;
}

export interface EnemyEntity {
  id: string;
  name: string;
  archetype: EnemyArchetypeId | BossId;
  isBoss: boolean;
  isElite: boolean;
  affixes: EliteAffix[];
  position: Vec3;
  velocity: Vec3;
  rotationY: number;
  radius: number;
  hp: number;
  maxHp: number;
  armor: number;
  moveSpeed: number;
  attackDamage: number;
  damageType: DamageType;
  attackRange: number;
  attackCooldownSec: number;
  xpReward: number;
  lootTierBonus: number;
  statuses: ActiveStatusEffect[];
  alive: boolean;
  roomId: string;
  meshHandle?: IEnemyMeshHandle;
}

export interface TelegraphZone {
  id: string;
  shape: 'circle' | 'cone' | 'line' | 'ring';
  position: Vec3;
  directionY: number;
  radius: number;
  innerRadius?: number;
  angleRad?: number;
  length?: number;
  width?: number;
  elapsedSec: number;
  durationSec: number;
  damage: number;
  damageType: DamageType;
  appliesStatus?: StatusEffectType;
  sourceId: string;
}

export interface DamagePacket {
  sourceId: string;
  targetId: string;
  baseAmount: number;
  damageType: DamageType;
  critChance: number;
  critMultiplier: number;
  knockback?: Vec3;
  lifeSteal?: number;
  appliesStatus?: {
    type: StatusEffectType;
    chance: number;
    durationSec: number;
    potency: number;
  };
}

export interface DamageResult {
  finalDamage: number;
  isCrit: boolean;
  isDodged: boolean;
  killed: boolean;
  healedSource: number;
  appliedStatus?: StatusEffectType;
  hitPosition: Vec3;
  damageType: DamageType;
}

export interface ProjectileSpec {
  ownerIsPlayer: boolean;
  ownerId: string;
  origin: Vec3;
  direction: Vec3;
  speed: number;
  maxDistance: number;
  radius: number;
  piercing: boolean;
  homing?: boolean;
  aoeExplosionRadius?: number;
  damagePacket: Omit<DamagePacket, 'targetId'>;
  visualColorHex: number;
}

export interface PlayerRuntimeState {
  id: 'player';
  heroClass: HeroClassId;
  name: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  unspentSkillPoints: number;
  unspentAttributePoints: number;
  position: Vec3;
  velocity: Vec3;
  facingDir: Vec3;
  rotationY: number;
  radius: number;
  hp: number;
  mana: number;
  stamina: number;
  baseAttributes: Attributes;
  stats: DerivedStats;
  statuses: ActiveStatusEffect[];
  isDodging: boolean;
  invulnerableSec: number;
  alive: boolean;
  healthPotions: number;
  maxHealthPotions: number;
  potionCooldownSec: number;
  gold: number;
  floorsCleared: number;
  killsTotal: number;
}

export interface IPlayerController {
  readonly state: PlayerRuntimeState;
  init(heroClass: HeroClassId, spawnPos: Vec3, rig: IHeroRig): void;
  attachInput(domElement: HTMLElement): void;
  recomputeStats(
    equipmentBonuses: { attributes: Partial<Attributes>; stats: Partial<DerivedStats> },
    passiveBonuses: {
      attributes: Partial<Attributes>;
      stats: Partial<DerivedStats>;
      keystones: string[];
    },
  ): void;
  grantXp(amount: number): { leveledUp: boolean; newLevel: number };
  spendAttributePoint(attr: keyof Attributes): boolean;
  useHealthPotion(): boolean;
  respawnAt(pos: Vec3): void;
  setCursorWorldTarget(target: Vec3 | null): void;
  update(
    dt: number,
    floor: DungeonFloorData,
    uiBlockingInput: boolean,
  ): {
    castSlotRequested: SkillSlotIndex | null;
    interactRequested: boolean;
    dodgeTriggered?: boolean;
    parryRequested?: boolean;
    awakeningRequested?: boolean;
  };
  dispose(): void;
}

export interface ICombatEngine {
  init(scene: THREE.Scene): void;
  performMeleeArc(
    attackerPos: Vec3,
    facingDir: Vec3,
    range: number,
    arcAngleRad: number,
    packet: Omit<DamagePacket, 'targetId'>,
    targets: EnemyEntity[],
  ): DamageResult[];
  performAoE(
    center: Vec3,
    radius: number,
    packet: Omit<DamagePacket, 'targetId'>,
    targets: EnemyEntity[],
  ): DamageResult[];
  spawnProjectile(spec: ProjectileSpec): void;
  applyDamageToEnemy(enemy: EnemyEntity, packet: DamagePacket): DamageResult;
  applyDamageToPlayer(player: PlayerRuntimeState, packet: DamagePacket): DamageResult;
  tickStatuses(dt: number, player: PlayerRuntimeState, enemies: EnemyEntity[]): void;
  updateProjectiles(
    dt: number,
    floor: DungeonFloorData,
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
  ): void;
  getComboState(): { count: number; timerSec: number; multiplier: number };
  clearFloorEntities(): void;
  dispose(): void;
}

export interface IEnemyAISystem {
  spawnFloorEnemies(
    floor: DungeonFloorData,
    scene: THREE.Scene,
    meshFactory: IEnemyMeshFactory,
    materials: IMaterialLibrary,
  ): EnemyEntity[];
  spawnWaveAt(
    position: Vec3,
    count: number,
    floorNumber: number,
    roomId: string,
    scene: THREE.Scene,
    meshFactory: IEnemyMeshFactory,
    materials: IMaterialLibrary,
  ): EnemyEntity[];
  getEnemies(): EnemyEntity[];
  getLivingEnemies(): EnemyEntity[];
  update(
    dt: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
  ): void;
  clear(): void;
}

export interface IBossDirector {
  init(scene: THREE.Scene): void;
  spawnFloorBoss(
    floor: DungeonFloorData,
    meshFactory: IEnemyMeshFactory,
    materials: IMaterialLibrary,
  ): EnemyEntity;
  spawnColosseumBosses?(
    floor: DungeonFloorData,
    waveNumber: number,
    meshFactory: IEnemyMeshFactory,
    materials: IMaterialLibrary,
  ): EnemyEntity[];
  getActiveBoss(): {
    entity: EnemyEntity;
    bossId: BossId;
    title: string;
    phase: 1 | 2 | 3;
    maxPhases: 3;
    introActive: boolean;
  } | null;
  getActiveTelegraphs(): TelegraphZone[];
  update(
    dt: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
  ): void;
  clear(): void;
  dispose(): void;
}

export type EquipSlot =
  | 'weapon'
  | 'offhand'
  | 'helmet'
  | 'chest'
  | 'gloves'
  | 'boots'
  | 'ring'
  | 'amulet';

export interface ItemAffix {
  label: string;
  statKey: keyof (DerivedStats & Attributes);
  value: number;
  isPercent?: boolean;
}

export type RuneId =
  | 'sol'
  | 'vex'
  | 'jah'
  | 'ohm'
  | 'ber'
  | 'zod'
  | 'ist'
  | 'mal'
  | 'gul'
  | 'sur'
  | 'lo'
  | 'cham';

export type PetId = 'celestial_owl' | 'ember_wyrmling' | 'void_kitsune';

export type MercenaryId = 'iron_templar' | 'sylvan_ranger' | 'storm_arcanist';

export type ElementalReactionType =
  | 'shatter'
  | 'volatile_blast'
  | 'superconduct'
  | 'abyssal_singularity';

export interface ItemInstance {
  id: string;
  name: string;
  slot: EquipSlot;
  rarity: ItemRarity;
  isMythic?: boolean;
  levelReq: number;
  itemLevel: number;
  upgradeLevel: number;
  weaponVisual?: WeaponVisualType;
  affixes: ItemAffix[];
  legendaryPower?: {
    id: string;
    description: string;
  };
  sockets?: number;
  socketedRunes?: RuneId[];
  runewordId?: string;
  runewordName?: string;
  setId?: string;
  setName?: string;
  goldValue: number;
  icon: string;
}

export interface GroundLootDrop {
  id: string;
  position: Vec3;
  kind: 'item' | 'gold' | 'health_orb' | 'potion' | 'rune';
  item?: ItemInstance;
  runeId?: RuneId;
  amount?: number;
  pickedUp: boolean;
}

export interface ILootSystem {
  init(scene: THREE.Scene): void;
  generateItem(
    itemLevel: number,
    forcedRarity?: ItemRarity,
    forcedSlot?: EquipSlot,
  ): ItemInstance;
  generateMythicItem?(itemLevel: number, forcedSlot?: EquipSlot): ItemInstance;
  spawnEnemyLoot(enemy: EnemyEntity, floorNumber: number): GroundLootDrop[];
  spawnChestLoot(position: Vec3, floorNumber: number, isCursed?: boolean): GroundLootDrop[];
  spawnRuneDrop?(position: Vec3, runeId: RuneId): GroundLootDrop;
  getGroundDrops(): GroundLootDrop[];
  pickupDrop(
    dropId: string,
    player: PlayerRuntimeState,
  ): { picked: GroundLootDrop | null; inventoryFull?: boolean };
  getInventory(): ItemInstance[];
  getEquipped(): Partial<Record<EquipSlot, ItemInstance>>;
  getStash?(): ItemInstance[];
  depositToStash?(itemId: string): boolean;
  withdrawFromStash?(itemId: string): boolean;
  addDirectItemToInventory?(item: ItemInstance): boolean;
  equipItem(itemId: string): boolean;
  unequipSlot(slot: EquipSlot): boolean;
  salvageItem(itemId: string): { goldGained: number };
  upgradeItem(
    itemId: string,
    playerGold: number,
  ): { success: boolean; cost: number; newUpgradeLevel: number };
  computeEquipmentBonuses(): {
    attributes: Partial<Attributes>;
    stats: Partial<DerivedStats>;
    weaponVisual: WeaponVisualType;
    weaponRarity?: ItemRarity;
  };
  serialize(): {
    inventory: ItemInstance[];
    equipped: Partial<Record<EquipSlot, ItemInstance>>;
  };
  deserialize(data: {
    inventory: ItemInstance[];
    equipped: Partial<Record<EquipSlot, ItemInstance>>;
  }): void;
  update(dt: number, elapsedSec: number, player: PlayerRuntimeState): void;
  clearGroundDrops(): void;
  dispose(): void;
}

export interface QuestObjective {
  id: string;
  description: string;
  current: number;
  required: number;
  completed: boolean;
}

export interface QuestState {
  id: string;
  title: string;
  isMainQuest: boolean;
  description: string;
  floorNumber: number;
  objectives: QuestObjective[];
  status: 'active' | 'completed';
  xpReward: number;
  goldReward: number;
}

export interface LoreEntry {
  id: string;
  title: string;
  biome: BiomeId;
  text: string;
  unlocked: boolean;
}

export interface CursedEventState {
  active: boolean;
  roomId: string;
  position: Vec3;
  remainingSec: number;
  wavesSpawned: number;
  totalWaves: number;
}

export interface SaveProfileData {
  version: number;
  savedAt: number;
  heroClass: HeroClassId;
  level: number;
  xp: number;
  unspentSkillPoints: number;
  unspentAttributePoints: number;
  baseAttributes: Attributes;
  gold: number;
  highestFloor: number;
  killsTotal: number;
  allocatedPassives: Record<string, number>;
  loot: {
    inventory: ItemInstance[];
    equipped: Partial<Record<EquipSlot, ItemInstance>>;
  };
  stash?: ItemInstance[];
  runes?: Partial<Record<RuneId, number>>;
  activePet?: PetId;
  activeMercenary?: MercenaryId;
  colosseumBestWave?: number;
  unlockedLoreIds: string[];
  unlockedAchievementIds: string[];
}

export interface IQuestSystem {
  initFloorQuests(floor: DungeonFloorData): void;
  onEnemyKilled(enemy: EnemyEntity): { completedQuests: QuestState[] };
  onInteractableUsed(prop: InteractableProp): {
    unlockedLore?: LoreEntry;
    startedCursedEvent?: boolean;
    completedQuests: QuestState[];
  };
  startCursedChestEvent(prop: InteractableProp): void;
  updateCursedEvent(dt: number): {
    spawnWaveAt: Vec3 | null;
    eventCompleted: boolean;
    eventFailed: boolean;
  };
  getActiveQuests(): QuestState[];
  getCursedEvent(): CursedEventState | null;
  getLoreCodex(): LoreEntry[];
  getAchievements(): Array<{
    id: string;
    title: string;
    description: string;
    unlocked: boolean;
  }>;
  saveGame(profile: SaveProfileData): void;
  loadGame(): SaveProfileData | null;
  hasSaveGame(): boolean;
  clearSaveGame(): void;
}

export type VfxEffectType =
  | 'slash_arc'
  | 'hit_sparks'
  | 'blood_burst'
  | 'fire_explosion'
  | 'frost_nova'
  | 'lightning_strike'
  | 'poison_cloud'
  | 'void_implosion'
  | 'heal_aura'
  | 'level_up_pillar'
  | 'dodge_afterimage'
  | 'loot_pickup'
  | 'chest_open';

export type SfxId =
  | 'sword_swing'
  | 'hit_flesh'
  | 'hit_crit'
  | 'fireball_cast'
  | 'explosion'
  | 'frost_shatter'
  | 'lightning_zap'
  | 'dodge_whoosh'
  | 'player_hurt'
  | 'potion_drink'
  | 'loot_drop_rare'
  | 'loot_drop_legendary'
  | 'gold_pickup'
  | 'chest_open'
  | 'shrine_bless'
  | 'level_up'
  | 'boss_roar'
  | 'portal_hum'
  | 'ui_click'
  | 'ui_equip';

export type MusicMood =
  | 'title'
  | 'sanctuary'
  | 'explore'
  | 'combat'
  | 'invasion'
  | 'boss'
  | 'victory'
  | 'defeat';

export interface IVfxAudioSystem {
  init(scene: THREE.Scene): void;
  unlockAudio(): void;
  spawnVfx(
    type: VfxEffectType,
    position: Vec3,
    options?: { direction?: Vec3; colorHex?: number; radius?: number; scale?: number },
  ): void;
  playSfx(id: SfxId, worldPos?: Vec3): void;
  setMusicMood(mood: MusicMood): void;
  setVolumes(master: number, music: number, sfx: number): void;
  update(dt: number, listenerPos: Vec3): void;
  dispose(): void;
}

export interface GameSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  graphicsQuality: 'low' | 'medium' | 'high';
  cameraSensitivity: number;
  showDamageNumbers: boolean;
  dlssMode?: DlssMode;
  dlssSharpness?: number;
  targetFps?: TargetFpsLimit;
  dynamicResolution?: boolean;
}

export interface HudSnapshot {
  player: PlayerRuntimeState;
  skills: Array<{
    def: SkillDefinition;
    remainingCd: number;
    totalCd: number;
    ready: boolean;
  }>;
  floor: DungeonFloorData;
  enemies: EnemyEntity[];
  groundDrops: GroundLootDrop[];
  boss: ReturnType<IBossDirector['getActiveBoss']>;
  quests: QuestState[];
  cursedEvent: CursedEventState | null;
  combo: { count: number; timerSec: number; multiplier: number };
  nearbyInteractable: InteractableProp | null;
  fps: number;
  engineStats?: EngineTelemetryStats;
  mastery?: MasteryHudState;
  worldEvents?: ActiveWorldEventStatus;
  companions?: CompanionRosterState;
  dummyMetrics?: TrainingDummyMetrics;
  inSanctuary?: boolean;
}

export interface IHudUI {
  mount(container: HTMLElement): void;
  setVisible(visible: boolean): void;
  spawnDamageNumber(
    worldPos: Vec3,
    amount: number,
    isCrit: boolean,
    damageType: DamageType,
    isPlayerHit?: boolean,
  ): void;
  showBanner(
    title: string,
    subtitle?: string,
    tone?: 'gold' | 'crimson' | 'arcane' | 'emerald',
  ): void;
  showToast(message: string, rarity?: ItemRarity): void;
  update(
    dt: number,
    snapshot: HudSnapshot,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void;
  onSkillSlotClick(handler: (slot: SkillSlotIndex) => void): void;
  onPanelToggleClick(
    handler: (panel: 'inventory' | 'skills' | 'quests' | 'settings') => void,
  ): void;
  dispose(): void;
}

export type MenuPanelId =
  | 'none'
  | 'title'
  | 'inventory'
  | 'skills'
  | 'quests'
  | 'settings'
  | 'pause'
  | 'death'
  | 'victory'
  | 'obelisk'
  | 'world_map';

export interface MenusCallbacks {
  onStartNewGame: (heroClass: HeroClassId) => void;
  onContinueGame: () => void;
  onResumeGame: () => void;
  onRespawnOrRetry: () => void;
  onReturnToTitle: () => void;
  onEquipItem: (itemId: string) => void;
  onUnequipSlot: (slot: EquipSlot) => void;
  onSalvageItem: (itemId: string) => void;
  onUpgradeItem: (itemId: string) => void;
  onSpendAttribute: (attr: keyof Attributes) => void;
  onAllocatePassive: (nodeId: string) => void;
  onResetPassives: () => void;
  onSettingsChange: (settings: GameSettings) => void;
  onAddSocket?: (itemId: string) => void;
  onSocketRune?: (itemId: string, runeId: RuneId) => void;
  onUnsocketRunes?: (itemId: string) => void;
  onDepositStash?: (itemId: string) => void;
  onWithdrawStash?: (itemId: string) => void;
  onGambleItem?: (slot?: EquipSlot) => void;
  onBloodAltar?: () => void;
  onSelectPet?: (petId: PetId) => void;
  onSelectMercenary?: (mercId: MercenaryId) => void;
  onSelectObeliskPact?: (cardId: string) => void;
  onTravelDestination?: (dest: 'sanctuary' | 'colosseum' | number) => void;
  onOpenMultiplayerLobby?: () => void;
}

export interface MenusRefreshContext {
  hasSaveGame: boolean;
  player: PlayerRuntimeState;
  inventory: ItemInstance[];
  equipped: Partial<Record<EquipSlot, ItemInstance>>;
  stash?: ItemInstance[];
  ownedRunes?: Record<RuneId, number>;
  runeDefinitions?: RuneDefinition[];
  runewordRecipes?: RunewordDefinition[];
  itemSets?: ItemSetDefinition[];
  activeSets?: Array<{ set: ItemSetDefinition; pieces: number }>;
  companions?: CompanionRosterState;
  obeliskChoices?: ObeliskPactCard[];
  highestFloorUnlocked?: number;
  colosseumBestWave?: number;
  passiveNodes: PassiveNode[];
  allocatedPassives: Record<string, number>;
  quests: QuestState[];
  lore: LoreEntry[];
  achievements: Array<{
    id: string;
    title: string;
    description: string;
    unlocked: boolean;
  }>;
  settings: GameSettings;
}

export interface IMenusUI {
  mount(container: HTMLElement, callbacks: MenusCallbacks): void;
  openPanel(panel: MenuPanelId): void;
  togglePanel(panel: 'inventory' | 'skills' | 'quests' | 'settings' | 'pause'): void;
  getActivePanel(): MenuPanelId;
  isBlockingGameplayInput(): boolean;
  refresh(context: MenusRefreshContext): void;
  dispose(): void;
}

// ============================================================================
// Phase 3 Expansion Contracts (Modules #21 - #25)
// ============================================================================

export interface TrainingDummyMetrics {
  active: boolean;
  rollingDps: number;
  peakHit: number;
  totalDamage: number;
  hitsCount: number;
}

export interface ISanctuaryHub {
  generateSanctuaryFloor(): DungeonFloorData;
  populateHubScene(
    floor: DungeonFloorData,
    scene: THREE.Scene,
    materials: IMaterialLibrary,
  ): void;
  getTrainingDummyEntity(): EnemyEntity | null;
  recordDummyDamage(amount: number, isCrit: boolean): void;
  getDummyMetrics(): TrainingDummyMetrics;
  resetDummyMetrics(): void;
  update(dt: number, elapsedSec: number, playerPos: Vec3): void;
  dispose(): void;
}

export interface RuneDefinition {
  id: RuneId;
  name: string;
  tier: 1 | 2 | 3;
  colorHex: number;
  icon: string;
  statBonus: ItemAffix;
}

export interface RunewordDefinition {
  id: string;
  name: string;
  allowedSlots: EquipSlot[];
  pattern: RuneId[];
  bonusAffixes: ItemAffix[];
  mythicPower: string;
}

export interface ItemSetDefinition {
  id: string;
  name: string;
  heroClass: HeroClassId | 'any';
  twoPieceBonus: {
    description: string;
    stats: Partial<DerivedStats>;
  };
  fourPieceBonus: {
    description: string;
    stats: Partial<DerivedStats>;
    specialEffect: string;
  };
}

export interface BloodAltarBoon {
  id: string;
  name: string;
  hpSacrificePercent: number;
  description: string;
  statsBonus: Partial<DerivedStats>;
}

export interface IRunewordSystem {
  getRuneDefinitions(): RuneDefinition[];
  getRunewordRecipes(): RunewordDefinition[];
  getItemSets(): ItemSetDefinition[];
  getOwnedRunes(): Record<RuneId, number>;
  grantRune(runeId: RuneId, count?: number): void;
  rollEnemyRuneDrop(enemy: EnemyEntity, floorNumber: number): RuneId | null;
  assignItemSetOrSockets(item: ItemInstance, rngSeed?: number): ItemInstance;
  addSocketToItem(
    item: ItemInstance,
    playerGold: number,
  ): { success: boolean; cost: number; maxSockets: number };
  socketRuneIntoItem(
    item: ItemInstance,
    runeId: RuneId,
  ): { success: boolean; formedRuneword?: RunewordDefinition };
  unsocketRunesFromItem(item: ItemInstance): RuneId[];
  gambleMysteryItem(
    playerLevel: number,
    playerGold: number,
    loot: ILootSystem,
    slot?: EquipSlot,
  ): { success: boolean; cost: number; item?: ItemInstance };
  activateBloodAltar(player: PlayerRuntimeState): { success: boolean; boon?: BloodAltarBoon };
  getActiveBloodBoons(): BloodAltarBoon[];
  clearFloorBoons(): void;
  computeRunewordAndSetBonuses(equipped: Partial<Record<EquipSlot, ItemInstance>>): {
    attributes: Partial<Attributes>;
    stats: Partial<DerivedStats>;
    activeSets: Array<{ set: ItemSetDefinition; pieces: number }>;
    activeRunewords: string[];
  };
  serialize(): { runes: Record<RuneId, number> };
  deserialize(data?: { runes?: Partial<Record<RuneId, number>> }): void;
}

export interface CompanionRosterState {
  activePet: PetId;
  unlockedPets: PetId[];
  activeMercenary: MercenaryId;
  unlockedMercenaries: MercenaryId[];
  mercenaryName: string;
  mercenaryHp: number;
  mercenaryMaxHp: number;
  mercenaryAlive: boolean;
  mercenaryLevel: number;
}

export interface ICompanionSystem {
  init(scene: THREE.Scene, materials: IMaterialLibrary): void;
  setActivePet(petId: PetId): void;
  setActiveMercenary(mercId: MercenaryId): void;
  getState(): CompanionRosterState;
  respawnAt(pos: Vec3, playerLevel: number): void;
  update(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    enemies: EnemyEntity[],
    loot: ILootSystem,
    combat: ICombatEngine,
    inSanctuary?: boolean,
  ): void;
  computeCompanionAuraBonuses(): Partial<DerivedStats>;
  dispose(): void;
}

export interface ObeliskPactCard {
  id: string;
  title: string;
  curseText: string;
  blessingText: string;
  tone: 'crimson' | 'gold' | 'arcane';
  statModifiers: Partial<DerivedStats>;
  damageTakenMultiplier?: number;
  goldFindMultiplier?: number;
  critChainLightning?: boolean;
  spawnEliteAmbush?: boolean;
}

export interface ActiveWorldEventStatus {
  butcherActive: boolean;
  goblinActive: boolean;
  goblinEscapeSec?: number;
  escortState: {
    active: boolean;
    progress01: number;
    insideLight: boolean;
    completed: boolean;
  } | null;
  riftState: {
    active: boolean;
    remainingSec: number;
    kills: number;
    tierLabel: string;
  } | null;
  colosseumState: {
    active: boolean;
    wave: number;
    maxWaves: number;
    bestWave: number;
    completed: boolean;
  } | null;
  activePacts: ObeliskPactCard[];
}

export interface IWorldEventSystem {
  init(
    scene: THREE.Scene,
    materials: IMaterialLibrary,
    meshFactory: IEnemyMeshFactory,
  ): void;
  initFloorEvents(floor: DungeonFloorData): void;
  startColosseumRun(floor: DungeonFloorData, bestWave?: number): void;
  spawnButcherInvasion(floor: DungeonFloorData, playerPos: Vec3): EnemyEntity | null;
  spawnTreasureGoblin(floor: DungeonFloorData, position: Vec3): EnemyEntity | null;
  spawnChestMimic(floor: DungeonFloorData, position: Vec3): EnemyEntity | null;
  rollObeliskChoices(): [ObeliskPactCard, ObeliskPactCard, ObeliskPactCard];
  selectObeliskPact(cardId: string): ObeliskPactCard | null;
  startSoulEscort(prop: InteractableProp, floor: DungeonFloorData): void;
  startRiftBreach(prop: InteractableProp, floor: DungeonFloorData): void;
  getEventCombatEntities(): EnemyEntity[];
  getStatus(): ActiveWorldEventStatus;
  computePactStatBonuses(): {
    stats: Partial<DerivedStats>;
    damageTakenMultiplier: number;
    goldMultiplier: number;
    critChainLightning: boolean;
  };
  onEnemyKilled(enemy: EnemyEntity): {
    bonusChestTier?: number;
    guaranteedMythic?: boolean;
    bonusRunes?: number;
  };
  update(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    combat: ICombatEngine,
    aiSystem: IEnemyAISystem,
    bossDirector: IBossDirector,
  ): void;
  clear(): void;
  dispose(): void;
}

export interface MasteryHudState {
  fury: number;
  maxFury: number;
  awakened: boolean;
  awakenedRemainingSec: number;
  awakenedDurationSec: number;
  parryCooldownSec: number;
  parryActiveWindow: boolean;
  bossStagger: number;
  bossMaxStagger: number;
  bossStaggered: boolean;
  canExecuteTargetId: string | null;
}

export interface ICombatMasterySystem {
  init(scene: THREE.Scene): void;
  triggerParry(
    player: PlayerRuntimeState,
    enemies: EnemyEntity[],
    combat: ICombatEngine,
  ): { started: boolean; instantCountered: number };
  interceptIncomingPlayerHit(
    player: PlayerRuntimeState,
    attackerPos: Vec3 | null,
    rawDamage: number,
  ): { parried: boolean; damageMultiplier: number };
  triggerAwakening(player: PlayerRuntimeState): boolean;
  tryExecuteStaggeredTarget(
    player: PlayerRuntimeState,
    targets: EnemyEntity[],
    combat: ICombatEngine,
  ): { executed: boolean; target?: EnemyEntity; damageDealt?: number };
  getAwakeningMultipliers(): {
    damageMultiplier: number;
    attackSpeedMultiplier: number;
    moveSpeedMultiplier: number;
    cooldownMultiplier: number;
    lifeStealBonus: number;
  };
  getHudState(): MasteryHudState;
  addFury(amount: number): void;
  update(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    targets: EnemyEntity[],
    activeBoss: EnemyEntity | null,
    combat: ICombatEngine,
  ): void;
  resetFloor(): void;
  dispose(): void;
}

// ============================================================================
// Phase 4 Cross-Network Multiplayer, Voice Chat, Emotes & Co-op Contracts (#26 - #30)
// ============================================================================

export type MultiplayerTransportMode = 'webrtc_cloud' | 'websocket_relay' | 'local_tabs';

export type SocialEmoteId =
  | 'wave'
  | 'cheer'
  | 'dance'
  | 'taunt'
  | 'kneel_pray'
  | 'sit_rest'
  | 'laugh'
  | 'point'
  | 'high_five_ready'
  | 'high_five_strike'
  | 'downed_kneel'
  | 'revive_channel';

export type EmojiReactionId =
  | 'crown_gg'
  | 'fire_hype'
  | 'skull_danger'
  | 'laugh_imp'
  | 'heart_thanks'
  | 'chest_loot'
  | 'sos_help'
  | 'swords_boss';

export type TacticalPingType = 'attack' | 'loot' | 'danger' | 'group';

export type PairedInteractionKind = 'high_five' | 'blade_clash' | 'revive';

export interface RemotePeerSnapshot {
  peerId: string;
  nickname: string;
  isHost: boolean;
  isSimulated?: boolean;
  heroClass: HeroClassId;
  level: number;
  hp: number;
  maxHp: number;
  position: Vec3;
  velocity: Vec3;
  rotationY: number;
  animState: HeroAnimState;
  socialEmote?: SocialEmoteId | null;
  weaponVisual: WeaponVisualType;
  weaponRarity?: ItemRarity;
  awakened: boolean;
  downed: boolean;
  downedBleedoutSec?: number;
  activePet?: PetId;
  pingMs: number;
}

export interface NetChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  heroClass: HeroClassId;
  channel: 'party' | 'emote' | 'loot' | 'system';
  text: string;
  rarity?: ItemRarity;
  isMythic?: boolean;
  timestamp: number;
}

export type NetPacket =
  | { type: 'player_state'; state: RemotePeerSnapshot }
  | {
      type: 'world_sync';
      zoneMode: 'sanctuary' | 'dungeon' | 'colosseum';
      floorNumber: number;
      seed: number;
    }
  | {
      type: 'skill_cast';
      peerId: string;
      slot: SkillSlotIndex;
      skillId: string;
      damageType: DamageType;
      origin: Vec3;
      facingDir: Vec3;
      targetPos?: Vec3;
    }
  | {
      type: 'combat_hit';
      peerId: string;
      enemyId: string;
      damage: number;
      isCrit: boolean;
      damageType: DamageType;
      killed: boolean;
    }
  | { type: 'chat_message'; message: NetChatMessage }
  | { type: 'emoji_burst'; peerId: string; emojiId: EmojiReactionId; position: Vec3 }
  | {
      type: 'tactical_ping';
      peerId: string;
      senderName: string;
      pingType: TacticalPingType;
      position: Vec3;
    }
  | { type: 'social_emote'; peerId: string; emoteId: SocialEmoteId }
  | {
      type: 'paired_request';
      fromPeerId: string;
      fromName: string;
      kind: PairedInteractionKind;
      position: Vec3;
    }
  | {
      type: 'paired_accept';
      fromPeerId: string;
      targetPeerId: string;
      kind: PairedInteractionKind;
      midpoint: Vec3;
    }
  | { type: 'revive_complete'; saviorPeerId: string; revivedPeerId: string }
  | {
      type: 'loot_gift';
      fromPeerId: string;
      fromName: string;
      item?: ItemInstance;
      goldAmount?: number;
      potionCount?: number;
      position: Vec3;
    }
  | { type: 'ping_probe'; sentAt: number }
  | { type: 'ping_ack'; sentAt: number };

export interface MultiplayerConnectionInfo {
  connected: boolean;
  connecting: boolean;
  mode: MultiplayerTransportMode;
  roomCode: string;
  localPeerId: string;
  localNickname: string;
  isHost: boolean;
  relayUrl?: string;
  peerCount: number;
  errorMessage?: string;
}

export interface IMultiplayerTransport {
  getConnectionInfo(): MultiplayerConnectionInfo;
  setLocalNickname(name: string): void;
  hostRoom(
    mode: MultiplayerTransportMode,
    options?: { customRoomCode?: string; relayUrl?: string },
  ): Promise<string>;
  joinRoom(
    roomCode: string,
    mode: MultiplayerTransportMode,
    options?: { relayUrl?: string },
  ): Promise<boolean>;
  leaveRoom(): void;
  spawnSimulatedPartner(heroClass?: HeroClassId): string;
  removeSimulatedPartners(): void;
  broadcast(packet: NetPacket, reliable?: boolean): void;
  sendToPeer(peerId: string, packet: NetPacket): void;
  onPacket(handler: (fromPeerId: string, packet: NetPacket) => void): () => void;
  onPeersChanged(handler: (peers: RemotePeerSnapshot[]) => void): () => void;
  getRemotePeers(): RemotePeerSnapshot[];
  getUnderlyingPeerJsInstance(): unknown;
  update(dt: number, localSnapshot: RemotePeerSnapshot): void;
  dispose(): void;
}

export interface PeerVoiceState {
  peerId: string;
  isSpeaking: boolean;
  voiceLevel: number;
  mutedByLocal: boolean;
  volume: number;
  connectedAudio: boolean;
}

export interface LocalVoiceState {
  micEnabled: boolean;
  micPermission: 'prompt' | 'granted' | 'denied' | 'unavailable';
  mode: 'ptt' | 'open_mic';
  pttActive: boolean;
  muted: boolean;
  deafened: boolean;
  spatialAudio: boolean;
  isSpeaking: boolean;
  voiceLevel: number;
}

export interface IVoiceChatSystem {
  attachPeerNetwork(peerJsInstance: unknown, activeRemotePeerIds: string[]): void;
  enableMicrophone(): Promise<boolean>;
  disableMicrophone(): void;
  setVoiceMode(mode: 'ptt' | 'open_mic'): void;
  setPushToTalkActive(active: boolean): void;
  setMuted(muted: boolean): void;
  setDeafened(deafened: boolean): void;
  setSpatialAudio(enabled: boolean): void;
  setPeerMuted(peerId: string, muted: boolean): void;
  setPeerVolume(peerId: string, volume: number): void;
  injectSimulatedVoiceLevel(peerId: string, level: number): void;
  getLocalState(): LocalVoiceState;
  getPeerVoiceState(peerId: string): PeerVoiceState;
  updateSpatialPositions(
    dt: number,
    listenerPos: Vec3,
    listenerYaw: number,
    peerPositions: Record<string, Vec3>,
  ): void;
  dispose(): void;
}

export interface SocialBuffState {
  swornBrethrenSec: number;
  xpGoldMultiplier: number;
  moveSpeedBonus: number;
  powerMultiplier: number;
}

export interface LocalDownedState {
  isDowned: boolean;
  bleedoutRemainingSec: number;
  bleedoutTotalSec: number;
  reviveProgress01: number;
  reviverName?: string;
}

export interface ISocialInteractionSystem {
  init(scene: THREE.Scene): void;
  triggerSoloEmote(emoteId: SocialEmoteId, playerPos: Vec3): void;
  requestPairedHighFive(playerPos: Vec3, localPeerId: string, localName: string): {
    acceptedImmediatePeerId?: string;
    midpoint?: Vec3;
  };
  receiveRemotePairedRequest(
    fromPeerId: string,
    fromName: string,
    kind: PairedInteractionKind,
    position: Vec3,
  ): void;
  executePairedCelebration(midpoint: Vec3, localPos: Vec3): void;
  enterDownedState(player: PlayerRuntimeState): void;
  reviveLocalPlayer(player: PlayerRuntimeState, saviorName?: string): void;
  tryChannelTeammateRevive(
    dt: number,
    localPos: Vec3,
    downedPeers: RemotePeerSnapshot[],
    holdingInteract: boolean,
  ): { channelingPeerId: string | null; progress01: number; completedPeerId: string | null };
  getLocalActiveEmote(): SocialEmoteId | null;
  getLocalDownedState(): LocalDownedState;
  getSocialBuffState(): SocialBuffState;
  getNearbyPendingInvite(localPos: Vec3): {
    fromPeerId: string;
    fromName: string;
    kind: PairedInteractionKind;
    position: Vec3;
  } | null;
  update(dt: number, elapsedSec: number, localPos: Vec3): void;
  dispose(): void;
}

export interface IRemoteAvatarManager {
  init(scene: THREE.Scene): void;
  syncPeers(peers: RemotePeerSnapshot[]): void;
  playRemoteSkillVisual(
    peerId: string,
    damageType: DamageType,
    origin: Vec3,
    facingDir: Vec3,
    targetPos?: Vec3,
  ): void;
  showSpeechBubble(peerId: string, senderName: string, text: string): void;
  spawnEmojiBurst(peerId: string, emojiId: EmojiReactionId, fallbackPos: Vec3): void;
  spawnTacticalPing(
    peerId: string,
    senderName: string,
    pingType: TacticalPingType,
    position: Vec3,
  ): void;
  triggerRemotePairedClash(peerId: string, midpoint: Vec3): void;
  update(
    dt: number,
    elapsedSec: number,
    voiceStates: Record<string, PeerVoiceState>,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void;
  dispose(): void;
}

export interface MultiplayerUICallbacks {
  onHostRoom: (
    mode: MultiplayerTransportMode,
    nickname: string,
    relayUrl?: string,
  ) => void;
  onJoinRoom: (
    roomCode: string,
    mode: MultiplayerTransportMode,
    nickname: string,
    relayUrl?: string,
  ) => void;
  onLeaveRoom: () => void;
  onSpawnBotPartner: () => void;
  onTeleportToPeer: (peerId: string) => void;
  onDropGiftForParty: (kind: 'gold' | 'potion') => void;
  onSendChat: (text: string) => void;
  onTriggerEmoji: (emojiId: EmojiReactionId) => void;
  onTriggerEmote: (emoteId: SocialEmoteId) => void;
  onTriggerPing: (pingType: TacticalPingType, worldPos?: Vec3) => void;
  onTriggerHighFive: () => void;
  onToggleMicEnable: () => void;
  onSetVoiceMode: (mode: 'ptt' | 'open_mic') => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleSpatialAudio: () => void;
  onSetPeerMuted: (peerId: string, muted: boolean) => void;
  onSetPeerVolume: (peerId: string, volume: number) => void;
}

export interface MultiplayerUISnapshot {
  connection: MultiplayerConnectionInfo;
  peers: RemotePeerSnapshot[];
  localVoice: LocalVoiceState;
  peerVoice: Record<string, PeerVoiceState>;
  socialBuff: SocialBuffState;
  downedState: LocalDownedState;
  nearbyInviteName?: string | null;
}

export interface IMultiplayerUI {
  mount(container: HTMLElement, callbacks: MultiplayerUICallbacks): void;
  openLobby(): void;
  closeLobby(): void;
  toggleLobby(): void;
  isLobbyOpen(): boolean;
  isChatFocused(): boolean;
  appendChatMessage(msg: NetChatMessage): void;
  update(dt: number, snapshot: MultiplayerUISnapshot): void;
  dispose(): void;
}
