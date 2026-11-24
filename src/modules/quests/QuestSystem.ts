import type {
  BiomeId,
  BossId,
  CursedEventState,
  DungeonFloorData,
  EnemyEntity,
  InteractableProp,
  IQuestSystem,
  LoreEntry,
  QuestState,
  SaveProfileData,
  Vec3,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementView,
  buildAchievementsList,
} from './achievementsData';
import { buildLoreCodex, LORE_CODEX_DEFINITIONS, type LoreDefinition } from './loreData';
import {
  generateQuestsForFloor,
  type ObjectiveTriggerKind,
} from './questGenerator';
import { SaveStorageManager } from './saveStorage';

export const CURSED_EVENT_DURATION_SEC = 30;
export const CURSED_EVENT_TOTAL_WAVES = 3;

const PINNACLE_BOSS_IDS: ReadonlySet<string> = new Set<BossId>([
  'bone_colossus',
  'arachne_broodmother',
  'ignis_forgemaster',
  'malakor_void_emperor',
  'valkyria_rime_seraph',
  'chronos_time_architect',
]);

const ALL_BOSS_IDS: ReadonlySet<string> = new Set<BossId>([
  'bone_colossus',
  'arachne_broodmother',
  'ignis_forgemaster',
  'malakor_void_emperor',
  'valkyria_rime_seraph',
  'chronos_time_architect',
  'the_butcher',
]);

function cloneQuestState(q: QuestState): QuestState {
  return {
    id: q.id,
    title: q.title,
    isMainQuest: q.isMainQuest,
    description: q.description,
    floorNumber: q.floorNumber,
    objectives: q.objectives.map((o) => ({ ...o })),
    status: q.status,
    xpReward: q.xpReward,
    goldReward: q.goldReward,
  };
}

export class QuestSystem implements IQuestSystem {
  private readonly saveStorage = new SaveStorageManager();

  // Floor Quest State
  private currentFloorNumber = 1;
  private currentBiome: BiomeId = 'crypt';
  private expectedBossId: BossId = 'bone_colossus';
  private quests: QuestState[] = [];
  private objectiveTriggers = new Map<string, ObjectiveTriggerKind>();
  private processedPropIds = new Set<string>();
  private questProcessedEnemyIds = new Set<string>();
  private sanctuaryDummyStruck = false;
  private colosseumKillsOnFloor = 0;

  // Cursed Chest Ambush State
  private cursedEvent: CursedEventState | null = null;
  private activeCursedPropId: string | null = null;
  private lastCursedEventPosition: Vec3 | null = null;
  private cursedEventFailedPending = false;

  // Persistent / Run Progression State (Lore & Achievements)
  private unlockedLoreIds = new Set<string>();
  private unlockedAchievementIds = new Set<string>();

  // Achievement Tracking Counters
  private statsEnemyIdsSeen = new Set<string>();
  private totalKillsCount = 0;
  private eliteKillsCount = 0;
  private bossKillsCount = 0;
  private shrinesUsedCount = 0;
  private questsCompletedCount = 0;
  private bossEncounterActive = false;
  private tookDamageDuringBoss = false;
  private tookDamageOnFloor = false;
  private defeatedValkyria = false;
  private defeatedChronos = false;

  // EventBus Cleanup Handles
  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    this.hydrateMetaProgressFromSave();
    this.registerEventBusListeners();
  }

  private hydrateMetaProgressFromSave(): void {
    const saved = this.saveStorage.load();
    if (!saved) return;

    for (const loreId of saved.unlockedLoreIds) {
      if (LORE_CODEX_DEFINITIONS.some((d) => d.id === loreId)) {
        this.unlockedLoreIds.add(loreId);
      }
    }
    for (const achId of saved.unlockedAchievementIds) {
      if (ACHIEVEMENT_DEFINITIONS.some((a) => a.id === achId)) {
        this.unlockedAchievementIds.add(achId);
      }
    }
    this.totalKillsCount = Math.max(this.totalKillsCount, saved.killsTotal || 0);
    if (saved.highestFloor >= 6) {
      this.defeatedValkyria = true;
    }
  }

  private registerEventBusListeners(): void {
    this.unsubscribers.push(
      eventBus.on('combat:damageDealt', ({ result, targetIsPlayer, targetId }) => {
        if (targetIsPlayer) {
          if (!result.isDodged && result.finalDamage > 0) {
            this.tookDamageOnFloor = true;
            if (this.bossEncounterActive) {
              this.tookDamageDuringBoss = true;
            }
          }
          if (result.killed && this.cursedEvent?.active) {
            this.cursedEventFailedPending = true;
          }
          return;
        }

        // Hitting the Sanctuary Training Dummy advances Sanctuary readiness once
        if (
          this.currentBiome === 'sanctuary' &&
          targetId === 'training_dummy' &&
          !this.sanctuaryDummyStruck &&
          result.finalDamage > 0
        ) {
          this.sanctuaryDummyStruck = true;
          const completed: QuestState[] = [];
          this.advanceObjectives('sanctuary_station', 1, completed);
        }
      }),

      eventBus.on('combat:enemyKilled', ({ enemy }) => {
        this.recordEnemyKillStats(enemy);
      }),

      eventBus.on('boss:spawned', ({ bossId }) => {
        if (bossId !== 'the_butcher') {
          this.bossEncounterActive = true;
          this.tookDamageDuringBoss = false;
        }
      }),

      eventBus.on('boss:defeated', ({ bossId }) => {
        this.recordBossDefeatAchievements(bossId, !this.tookDamageDuringBoss);
        if (bossId !== 'the_butcher') {
          this.bossEncounterActive = false;
        }
      }),

      eventBus.on('event:runewordForged', () => {
        this.unlockAchievement('runemaster');
      }),

      eventBus.on('player:awakeningChanged', ({ active }) => {
        if (active) {
          this.unlockAchievement('awakened_archon');
        }
      }),

      eventBus.on('loot:dropped', ({ drop }) => {
        if (
          drop.kind === 'item' &&
          (drop.item?.rarity === 'legendary' || drop.item?.isMythic)
        ) {
          this.unlockAchievement('legendary_finder');
        }
      }),

      eventBus.on('loot:pickedUp', ({ drop }) => {
        if (
          drop.kind === 'item' &&
          (drop.item?.rarity === 'legendary' || drop.item?.isMythic)
        ) {
          this.unlockAchievement('legendary_finder');
        }
      }),

      eventBus.on('player:levelUp', ({ level }) => {
        if (level >= 5) {
          this.unlockAchievement('ascendant_hero');
        }
      }),
    );
  }

  initFloorQuests(floor: DungeonFloorData): void {
    const biome: BiomeId = floor.biome || 'crypt';
    this.currentBiome = biome;
    this.currentFloorNumber =
      biome === 'sanctuary' || floor.floorNumber === 0
        ? 0
        : Math.max(1, Math.floor(floor.floorNumber || 1));

    const generated = generateQuestsForFloor(floor);
    this.quests = generated.quests;
    this.objectiveTriggers = generated.objectiveTriggers;
    this.expectedBossId = generated.expectedBossId;

    this.processedPropIds.clear();
    this.questProcessedEnemyIds.clear();
    this.sanctuaryDummyStruck = false;
    this.colosseumKillsOnFloor = 0;

    this.cursedEvent = null;
    this.activeCursedPropId = null;
    this.cursedEventFailedPending = false;

    this.bossEncounterActive = false;
    this.tookDamageDuringBoss = false;
    this.tookDamageOnFloor = false;
  }

  onEnemyKilled(enemy: EnemyEntity): { completedQuests: QuestState[] } {
    if (!enemy || enemy.id === 'training_dummy') {
      return { completedQuests: [] };
    }

    if (enemy.id) {
      if (this.questProcessedEnemyIds.has(enemy.id)) {
        return { completedQuests: [] };
      }
      this.questProcessedEnemyIds.add(enemy.id);
    }

    this.recordEnemyKillStats(enemy);

    const isButcher = enemy.archetype === 'the_butcher';
    const isAnyBoss = Boolean(enemy.isBoss) || ALL_BOSS_IDS.has(enemy.archetype);
    const isFloorPinnacleBoss =
      this.currentBiome === 'colosseum'
        ? isAnyBoss
        : !isButcher &&
          (Boolean(enemy.isBoss) ||
            enemy.archetype === this.expectedBossId ||
            PINNACLE_BOSS_IDS.has(enemy.archetype));

    const completedQuests: QuestState[] = [];

    // Every killed hostile enemy counts toward monster bounties and seal/gladiator kills
    this.advanceObjectives('slay_monsters', 1, completedQuests);
    this.advanceObjectives('main_seal_kills', 1, completedQuests);

    if (this.currentBiome === 'colosseum') {
      this.colosseumKillsOnFloor += 1;
      if (this.colosseumKillsOnFloor >= 20 || isAnyBoss) {
        this.unlockAchievement('colosseum_gladiator');
      }
    }

    if (enemy.isElite || (this.currentBiome === 'colosseum' && isAnyBoss)) {
      this.advanceObjectives('slay_elites', 1, completedQuests);
    }

    if (isButcher) {
      this.unlockAchievement('fresh_meat_defier');
      this.unlockAchievement('boss_slayer');
    }

    if (isFloorPinnacleBoss) {
      if (this.currentBiome !== 'colosseum') {
        // Ensure preliminary seal objective never soft-locks if player rushes the floor boss
        this.forceCompleteObjectives('main_seal_kills', completedQuests);
      }
      this.advanceObjectives('main_boss_kill', 1, completedQuests);

      const flawlessBoss = this.bossEncounterActive
        ? !this.tookDamageDuringBoss
        : !this.tookDamageOnFloor;
      this.recordBossDefeatAchievements(enemy.archetype, flawlessBoss);
      this.bossEncounterActive = false;
    }

    return { completedQuests: completedQuests.map(cloneQuestState) };
  }

  onInteractableUsed(prop: InteractableProp): {
    unlockedLore?: LoreEntry;
    startedCursedEvent?: boolean;
    completedQuests: QuestState[];
  } {
    if (!prop) {
      return { completedQuests: [] };
    }

    if (prop.id && this.processedPropIds.has(prop.id)) {
      return { completedQuests: [] };
    }
    if (prop.id) {
      this.processedPropIds.add(prop.id);
    }

    const completedQuests: QuestState[] = [];
    let unlockedLore: LoreEntry | undefined;
    let startedCursedEvent: boolean | undefined;

    if (this.currentBiome === 'sanctuary') {
      this.advanceObjectives('sanctuary_welcome', 1, completedQuests);
      this.advanceObjectives('sanctuary_station', 1, completedQuests);
    }

    switch (prop.type) {
      case 'lore_tome': {
        unlockedLore = this.unlockNextLoreForProp(prop);
        this.advanceObjectives('uncover_lore', 1, completedQuests);
        break;
      }

      case 'cursed_chest': {
        this.startCursedChestEvent(prop);
        startedCursedEvent = true;
        break;
      }

      case 'shrine_heal':
      case 'shrine_power':
      case 'shrine_frenzy': {
        this.shrinesUsedCount += 1;
        if (this.shrinesUsedCount >= 3) {
          this.unlockAchievement('shrine_pilgrim');
        }
        this.advanceObjectives('cleanse_shrines', 1, completedQuests);
        break;
      }

      case 'corrupted_obelisk':
      case 'soul_lantern':
      case 'rift_breach': {
        this.advanceObjectives('conquer_world_event', 1, completedQuests);
        break;
      }

      default:
        break;
    }

    return {
      ...(unlockedLore ? { unlockedLore } : {}),
      ...(startedCursedEvent ? { startedCursedEvent: true } : {}),
      completedQuests: completedQuests.map(cloneQuestState),
    };
  }

  startCursedChestEvent(prop: InteractableProp): void {
    if (!prop) return;

    // Idempotent guard if called right after `onInteractableUsed` for the exact same prop
    if (
      this.cursedEvent?.active &&
      this.activeCursedPropId === prop.id &&
      this.cursedEvent.wavesSpawned === 0 &&
      this.cursedEvent.remainingSec >= CURSED_EVENT_DURATION_SEC - 0.25
    ) {
      return;
    }

    const pos: Vec3 = {
      x: Number.isFinite(prop.position?.x) ? prop.position.x : 0,
      y: Number.isFinite(prop.position?.y) ? prop.position.y : 0,
      z: Number.isFinite(prop.position?.z) ? prop.position.z : 0,
    };

    this.activeCursedPropId = prop.id || 'cursed_chest';
    this.lastCursedEventPosition = { ...pos };
    this.cursedEventFailedPending = false;

    this.cursedEvent = {
      active: true,
      roomId: prop.roomId || 'cursed_room',
      position: pos,
      remainingSec: CURSED_EVENT_DURATION_SEC,
      wavesSpawned: 0,
      totalWaves: CURSED_EVENT_TOTAL_WAVES,
    };

    eventBus.emit('ui:banner', {
      title: 'HÒM NGUYỀN RỦA THỨC TỈNH',
      subtitle: 'Sống Sót 30 Giây Trước 3 Đợt Sóng Vực Thẳm Leo Thang!',
      tone: 'crimson',
    });
    eventBus.emit('sfx:request', { id: 'boss_roar', position: pos });
    eventBus.emit('lighting:flash', {
      colorHex: 0xc92a2a,
      intensity: 1.35,
      durationSec: 0.45,
    });
    eventBus.emit('camera:shake', { trauma: 0.4 });
  }

  updateCursedEvent(dt: number): {
    spawnWaveAt: Vec3 | null;
    eventCompleted: boolean;
    eventFailed: boolean;
  } {
    if (this.cursedEventFailedPending) {
      const failPos = this.cursedEvent ? { ...this.cursedEvent.position } : null;
      this.cursedEventFailedPending = false;
      this.cursedEvent = null;
      this.activeCursedPropId = null;

      eventBus.emit('ui:banner', {
        title: 'PHỤC KÍCH NGUYỀN RỦA THẤT BẠI',
        subtitle: 'Lời Nguyền Máu Đã Lấy Đi Thêm Một Nạn Nhân.',
        tone: 'crimson',
      });
      if (failPos) {
        eventBus.emit('sfx:request', { id: 'player_hurt', position: failPos });
      }

      return {
        spawnWaveAt: null,
        eventCompleted: false,
        eventFailed: true,
      };
    }

    if (!this.cursedEvent || !this.cursedEvent.active) {
      return {
        spawnWaveAt: null,
        eventCompleted: false,
        eventFailed: false,
      };
    }

    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.cursedEvent.remainingSec = Math.max(0, this.cursedEvent.remainingSec - safeDt);

    const elapsedSec = CURSED_EVENT_DURATION_SEC - this.cursedEvent.remainingSec;
    const eventPos: Vec3 = { ...this.cursedEvent.position };

    // 3 escalating waves at 0s (remaining <= 30s), 10s (remaining <= 20s), and 20s (remaining <= 10s)
    let targetWaveCount = 1;
    if (elapsedSec >= 20) {
      targetWaveCount = 3;
    } else if (elapsedSec >= 10) {
      targetWaveCount = 2;
    }

    let spawnWaveAt: Vec3 | null = null;
    if (this.cursedEvent.wavesSpawned < targetWaveCount) {
      this.cursedEvent.wavesSpawned += 1;
      spawnWaveAt = { ...eventPos };
      this.emitCursedWaveFeedback(this.cursedEvent.wavesSpawned, eventPos);
    }

    // Check 30-second survival completion
    if (this.cursedEvent.remainingSec <= 0) {
      this.cursedEvent.wavesSpawned = CURSED_EVENT_TOTAL_WAVES;
      this.lastCursedEventPosition = { ...eventPos };
      this.cursedEvent = null;
      this.activeCursedPropId = null;

      const completedFromEvent: QuestState[] = [];
      this.advanceObjectives('survive_cursed_chest', 1, completedFromEvent);
      this.unlockAchievement('cursed_survivor');

      // Celebratory banner & bonus cursed chest reward notifications
      eventBus.emit('ui:banner', {
        title: 'LỜI NGUYỀN ĐÃ BỊ PHÁ VỠ!',
        subtitle: 'Vượt Qua Phục Kích — Phần Thưởng Hòm Nguyền Rủa Mở Khóa!',
        tone: 'gold',
      });
      eventBus.emit('ui:toast', {
        message: 'Phục Kích Nguyền Rủa Hoàn Thành! Phần Thưởng Hòm Nguyền Rủa Mở Khóa!',
        rarity: 'legendary',
      });
      eventBus.emit('vfx:request', {
        type: 'chest_open',
        position: eventPos,
        colorHex: 0xff922b,
        radius: 3.5,
        scale: 1.45,
      });
      eventBus.emit('sfx:request', { id: 'chest_open', position: eventPos });
      eventBus.emit('sfx:request', { id: 'loot_drop_legendary', position: eventPos });
      eventBus.emit('lighting:flash', {
        colorHex: 0xff922b,
        intensity: 1.5,
        durationSec: 0.55,
      });

      return {
        spawnWaveAt,
        eventCompleted: true,
        eventFailed: false,
      };
    }

    return {
      spawnWaveAt,
      eventCompleted: false,
      eventFailed: false,
    };
  }

  getActiveQuests(): QuestState[] {
    return this.quests.map(cloneQuestState);
  }

  getCursedEvent(): CursedEventState | null {
    if (!this.cursedEvent || !this.cursedEvent.active) {
      return null;
    }
    return {
      active: this.cursedEvent.active,
      roomId: this.cursedEvent.roomId,
      position: { ...this.cursedEvent.position },
      remainingSec: this.cursedEvent.remainingSec,
      wavesSpawned: this.cursedEvent.wavesSpawned,
      totalWaves: this.cursedEvent.totalWaves,
    };
  }

  getLastCursedEventPosition(): Vec3 | null {
    return this.lastCursedEventPosition ? { ...this.lastCursedEventPosition } : null;
  }

  getLoreCodex(): LoreEntry[] {
    return buildLoreCodex(this.unlockedLoreIds);
  }

  getAchievements(): AchievementView[] {
    return buildAchievementsList(this.unlockedAchievementIds);
  }

  saveGame(profile: SaveProfileData): void {
    if (!profile) return;

    // Sync any IDs present in incoming profile into runtime sets
    if (Array.isArray(profile.unlockedLoreIds)) {
      for (const id of profile.unlockedLoreIds) {
        if (typeof id === 'string') {
          this.unlockedLoreIds.add(id);
        }
      }
    }
    if (Array.isArray(profile.unlockedAchievementIds)) {
      for (const id of profile.unlockedAchievementIds) {
        if (typeof id === 'string') {
          this.unlockedAchievementIds.add(id);
        }
      }
    }

    const mergedLoreIds = Array.from(
      new Set([...(profile.unlockedLoreIds ?? []), ...this.unlockedLoreIds]),
    );
    const mergedAchievementIds = Array.from(
      new Set([...(profile.unlockedAchievementIds ?? []), ...this.unlockedAchievementIds]),
    );

    const payload: SaveProfileData = {
      ...profile,
      version: profile.version || 1,
      savedAt: profile.savedAt > 0 ? profile.savedAt : Date.now(),
      unlockedLoreIds: mergedLoreIds,
      unlockedAchievementIds: mergedAchievementIds,
    };

    this.saveStorage.save(payload);
  }

  loadGame(): SaveProfileData | null {
    const loaded = this.saveStorage.load();
    if (!loaded) return null;

    for (const id of loaded.unlockedLoreIds) {
      this.unlockedLoreIds.add(id);
    }
    for (const id of loaded.unlockedAchievementIds) {
      this.unlockedAchievementIds.add(id);
    }
    this.totalKillsCount = Math.max(this.totalKillsCount, loaded.killsTotal || 0);
    if (loaded.highestFloor >= 6) {
      this.defeatedValkyria = true;
    }

    return loaded;
  }

  hasSaveGame(): boolean {
    return this.saveStorage.hasSave();
  }

  clearSaveGame(): void {
    this.saveStorage.clear();
  }

  dispose(): void {
    while (this.unsubscribers.length > 0) {
      const unsub = this.unsubscribers.pop();
      unsub?.();
    }
    this.cursedEvent = null;
  }

  // ─── Internal Progression & Feedback Helpers ────────────────────────────────

  private recordEnemyKillStats(enemy: EnemyEntity): void {
    if (!enemy || enemy.id === 'training_dummy') return;
    if (enemy.id) {
      if (this.statsEnemyIdsSeen.has(enemy.id)) return;
      this.statsEnemyIdsSeen.add(enemy.id);
    }

    this.totalKillsCount += 1;
    if (this.totalKillsCount >= 1) {
      this.unlockAchievement('first_blood');
    }
    if (this.totalKillsCount >= 50) {
      this.unlockAchievement('abyssal_reaper');
    }

    if (enemy.isElite) {
      this.eliteKillsCount += 1;
      if (this.eliteKillsCount >= 5) {
        this.unlockAchievement('elite_hunter');
      }
    }

    if (enemy.archetype === 'treasure_goblin') {
      this.unlockAchievement('goblin_snatcher');
    }

    if (enemy.archetype === 'the_butcher') {
      this.unlockAchievement('fresh_meat_defier');
    }

    if (enemy.isBoss || ALL_BOSS_IDS.has(enemy.archetype)) {
      this.bossKillsCount += 1;
      this.unlockAchievement('boss_slayer');
      this.recordBossArchetypeProgress(enemy.archetype);
    }
  }

  private recordBossArchetypeProgress(archetypeOrBossId: string): void {
    if (archetypeOrBossId === 'the_butcher') {
      this.unlockAchievement('fresh_meat_defier');
    }
    if (archetypeOrBossId === 'malakor_void_emperor') {
      this.unlockAchievement('crown_reclaimer');
    }
    if (archetypeOrBossId === 'valkyria_rime_seraph') {
      this.defeatedValkyria = true;
    }
    if (archetypeOrBossId === 'chronos_time_architect') {
      this.defeatedChronos = true;
    }
    if (this.defeatedValkyria && this.defeatedChronos) {
      this.unlockAchievement('seraph_time_slayer');
    }
  }

  private recordBossDefeatAchievements(bossId: string, flawless: boolean): void {
    this.unlockAchievement('boss_slayer');
    this.recordBossArchetypeProgress(bossId);

    if (this.currentBiome === 'colosseum') {
      this.unlockAchievement('colosseum_gladiator');
    }

    if (flawless && bossId !== 'the_butcher') {
      this.unlockAchievement('untouchable');
    }
  }

  private advanceObjectives(
    trigger: ObjectiveTriggerKind,
    delta: number,
    newlyCompletedOut: QuestState[],
  ): void {
    if (delta <= 0) return;

    for (const quest of this.quests) {
      if (quest.status === 'completed') continue;

      let touched = false;
      for (const obj of quest.objectives) {
        if (obj.completed) continue;
        if (this.objectiveTriggers.get(obj.id) !== trigger) continue;

        obj.current = Math.min(obj.required, obj.current + delta);
        if (obj.current >= obj.required) {
          obj.completed = true;
        }
        touched = true;
      }

      if (touched && quest.objectives.every((o) => o.completed)) {
        this.completeQuest(quest, newlyCompletedOut);
      }
    }
  }

  private forceCompleteObjectives(
    trigger: ObjectiveTriggerKind,
    newlyCompletedOut: QuestState[],
  ): void {
    for (const quest of this.quests) {
      if (quest.status === 'completed') continue;

      let touched = false;
      for (const obj of quest.objectives) {
        if (obj.completed) continue;
        if (this.objectiveTriggers.get(obj.id) !== trigger) continue;

        obj.current = obj.required;
        obj.completed = true;
        touched = true;
      }

      if (touched && quest.objectives.every((o) => o.completed)) {
        this.completeQuest(quest, newlyCompletedOut);
      }
    }
  }

  private completeQuest(quest: QuestState, newlyCompletedOut: QuestState[]): void {
    if (quest.status === 'completed') return;
    quest.status = 'completed';
    newlyCompletedOut.push(quest);

    this.questsCompletedCount += 1;
    if (this.questsCompletedCount >= 4) {
      this.unlockAchievement('bounty_champion');
    }

    if (quest.id === 'quest_main_colosseum') {
      this.unlockAchievement('colosseum_gladiator');
    }

    eventBus.emit('ui:toast', {
      message: `Nhiệm Vụ Hoàn Thành: ${quest.title} (+${quest.xpReward} XP, +${quest.goldReward} vàng)`,
      rarity: quest.isMainQuest ? 'legendary' : 'epic',
    });

    if (quest.isMainQuest) {
      eventBus.emit('ui:banner', {
        title: 'NHIỆM VỤ CHÍNH HOÀN THÀNH',
        subtitle: quest.title,
        tone: 'gold',
      });
      eventBus.emit('sfx:request', { id: 'level_up' });
    } else {
      eventBus.emit('sfx:request', { id: 'shrine_bless' });
    }
  }

  private unlockNextLoreForProp(prop: InteractableProp): LoreEntry {
    let targetDef: LoreDefinition | undefined;

    // 1. Exact ID match if not yet unlocked
    if (prop.loreId) {
      const exact = LORE_CODEX_DEFINITIONS.find((d) => d.id === prop.loreId);
      if (exact && !this.unlockedLoreIds.has(exact.id)) {
        targetDef = exact;
      }
    }

    // 2. Next locked entry for the current floor's biome
    if (!targetDef) {
      targetDef = LORE_CODEX_DEFINITIONS.find(
        (d) => d.biome === this.currentBiome && !this.unlockedLoreIds.has(d.id),
      );
    }

    // 3. Any remaining locked entry across all 8 biomes
    if (!targetDef) {
      targetDef = LORE_CODEX_DEFINITIONS.find((d) => !this.unlockedLoreIds.has(d.id));
    }

    // 4. Fallback if all 24 entries are already unlocked
    if (!targetDef) {
      targetDef =
        (prop.loreId ? LORE_CODEX_DEFINITIONS.find((d) => d.id === prop.loreId) : undefined) ??
        LORE_CODEX_DEFINITIONS.find((d) => d.biome === this.currentBiome) ??
        LORE_CODEX_DEFINITIONS[0];
    }

    const wasAlreadyUnlocked = this.unlockedLoreIds.has(targetDef.id);
    this.unlockedLoreIds.add(targetDef.id);

    if (!wasAlreadyUnlocked) {
      eventBus.emit('ui:toast', {
        message: `Lore Khám Phá: ${targetDef.title}`,
        rarity: 'rare',
      });
      eventBus.emit('sfx:request', { id: 'shrine_bless', position: prop.position });
    }

    if (this.unlockedLoreIds.size >= 4) {
      this.unlockAchievement('loremaster');
    }

    return {
      id: targetDef.id,
      title: targetDef.title,
      biome: targetDef.biome,
      text: targetDef.text,
      unlocked: true,
    };
  }

  private unlockAchievement(achievementId: string): boolean {
    if (this.unlockedAchievementIds.has(achievementId)) {
      return false;
    }
    const def = ACHIEVEMENT_DEFINITIONS.find((a) => a.id === achievementId);
    if (!def) {
      return false;
    }

    this.unlockedAchievementIds.add(def.id);
    eventBus.emit('ui:toast', {
      message: `Thành Tích Mở Khóa: ${def.title}`,
      rarity: 'legendary',
    });
    eventBus.emit('sfx:request', { id: 'loot_drop_rare' });
    return true;
  }

  private emitCursedWaveFeedback(waveNumber: number, pos: Vec3): void {
    if (waveNumber === 1) {
      eventBus.emit('ui:toast', {
        message: 'Phục Kích Nguyền Rủa — Đợt I / III!',
        rarity: 'rare',
      });
      eventBus.emit('vfx:request', {
        type: 'void_implosion',
        position: pos,
        colorHex: 0xc92a2a,
        radius: 2.8,
        scale: 1.0,
      });
      eventBus.emit('sfx:request', { id: 'portal_hum', position: pos });
    } else if (waveNumber === 2) {
      eventBus.emit('ui:toast', {
        message: 'Phục Kích Nguyền Rủa — Đợt II / III! Những kẻ kinh hoàng mạnh hơn xuất hiện!',
        rarity: 'epic',
      });
      eventBus.emit('vfx:request', {
        type: 'fire_explosion',
        position: pos,
        colorHex: 0xff6b35,
        radius: 3.4,
        scale: 1.25,
      });
      eventBus.emit('sfx:request', { id: 'explosion', position: pos });
      eventBus.emit('camera:shake', { trauma: 0.3 });
    } else {
      eventBus.emit('ui:toast', {
        message: 'Phục Kích Nguyền Rủa — Đợt Cuối III / III! Giữ vững trận tuyến!',
        rarity: 'legendary',
      });
      eventBus.emit('vfx:request', {
        type: 'void_implosion',
        position: pos,
        colorHex: 0xda77f2,
        radius: 4.2,
        scale: 1.5,
      });
      eventBus.emit('sfx:request', { id: 'boss_roar', position: pos });
      eventBus.emit('camera:shake', { trauma: 0.45 });
    }
  }
}

export function createQuestSystem(): IQuestSystem {
  return new QuestSystem();
}
