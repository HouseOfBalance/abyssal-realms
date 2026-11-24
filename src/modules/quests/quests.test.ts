import { beforeEach, describe, expect, it } from 'vitest';
import type {
  BiomeId,
  DungeonFloorData,
  EnemyEntity,
  InteractableProp,
  ItemInstance,
  SaveProfileData,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { createQuestSystem, QuestSystem } from './index';

function makeMockFloor(
  floorNumber: number,
  biome: BiomeId,
  interactables: InteractableProp[] = [],
  seed = 42,
): DungeonFloorData {
  return {
    floorNumber,
    biome,
    seed,
    cols: 20,
    rows: 20,
    tileSize: 2,
    tiles: [],
    explored: [],
    rooms: [
      {
        id: 'room_spawn',
        type: 'spawn',
        x: 1,
        y: 1,
        width: 4,
        height: 4,
        centerGrid: { col: 3, row: 3 },
        centerWorld: { x: 6, y: 0, z: 6 },
        connectedRoomIds: ['room_elite', 'room_boss'],
        cleared: true,
      },
      {
        id: 'room_elite',
        type: 'elite',
        x: 8,
        y: 8,
        width: 5,
        height: 5,
        centerGrid: { col: 10, row: 10 },
        centerWorld: { x: 20, y: 0, z: 20 },
        connectedRoomIds: ['room_spawn', 'room_boss'],
        cleared: false,
      },
      {
        id: 'room_boss',
        type: 'boss',
        x: 14,
        y: 14,
        width: 5,
        height: 5,
        centerGrid: { col: 16, row: 16 },
        centerWorld: { x: 32, y: 0, z: 32 },
        connectedRoomIds: ['room_elite'],
        cleared: false,
      },
    ],
    playerSpawn: { x: 6, y: 0, z: 6 },
    bossSpawn: { x: 32, y: 0, z: 32 },
    portalPosition: { x: 34, y: 0, z: 32 },
    interactables,
    torchPositions: [],
    worldToGrid: () => ({ col: 0, row: 0 }),
    gridToWorld: () => ({ x: 0, y: 0, z: 0 }),
    isWalkableWorld: () => true,
    findPath: () => [],
    revealRadius: () => {},
  };
}

function makeMockEnemy(
  id: string,
  overrides: Partial<EnemyEntity> = {},
): EnemyEntity {
  return {
    id,
    name: 'Risen Skeleton',
    archetype: 'skeleton_warrior',
    isBoss: false,
    isElite: false,
    affixes: [],
    position: { x: 10, y: 0, z: 10 },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    radius: 0.6,
    hp: 0,
    maxHp: 50,
    armor: 5,
    moveSpeed: 3,
    attackDamage: 10,
    damageType: 'physical',
    attackRange: 1.8,
    attackCooldownSec: 1.2,
    xpReward: 25,
    lootTierBonus: 0,
    statuses: [],
    alive: false,
    roomId: 'room_elite',
    ...overrides,
  };
}

describe('QuestSystem (IQuestSystem contract + Phase 3 Expansion)', () => {
  beforeEach(() => {
    eventBus.clear();
    const tmp = createQuestSystem();
    tmp.clearSaveGame();
    if (tmp instanceof QuestSystem) {
      tmp.dispose();
    }
  });

  it('generates Floor 1..6 Main Story Quests plus 2 procedural Side Bounties per floor', () => {
    const qs = createQuestSystem();

    const f1 = makeMockFloor(1, 'crypt', [
      {
        id: 'cursed_1',
        type: 'cursed_chest',
        position: { x: 12, y: 0, z: 12 },
        roomId: 'room_elite',
        used: false,
        label: 'Cursed Chest',
      },
      {
        id: 'shrine_1',
        type: 'shrine_power',
        position: { x: 14, y: 0, z: 14 },
        roomId: 'room_elite',
        used: false,
        label: 'Shrine of Power',
      },
      {
        id: 'tome_1',
        type: 'lore_tome',
        position: { x: 16, y: 0, z: 16 },
        roomId: 'room_spawn',
        used: false,
        label: 'Ancient Tome',
      },
    ]);

    qs.initFloorQuests(f1);
    const q1 = qs.getActiveQuests();
    expect(q1).toHaveLength(3);
    expect(q1[0].isMainQuest).toBe(true);
    expect(q1[0].title).toContain('Người Khổng Lồ Xương');
    expect(q1.filter((q) => !q.isMainQuest)).toHaveLength(2);

    qs.initFloorQuests(makeMockFloor(4, 'void'));
    const q4 = qs.getActiveQuests();
    expect(q4).toHaveLength(3);
    expect(q4[0].title).toContain('Malakor');

    qs.initFloorQuests(
      makeMockFloor(5, 'cathedral', [
        {
          id: 'obelisk_f5',
          type: 'corrupted_obelisk',
          position: { x: 18, y: 0, z: 18 },
          roomId: 'room_elite',
          used: false,
          label: 'Corrupted Obelisk',
        },
      ]),
    );
    const q5 = qs.getActiveQuests();
    expect(q5).toHaveLength(3);
    expect(q5[0].isMainQuest).toBe(true);
    expect(q5[0].title).toContain('Valkyria');

    qs.initFloorQuests(makeMockFloor(6, 'observatory'));
    const q6 = qs.getActiveQuests();
    expect(q6).toHaveLength(3);
    expect(q6[0].isMainQuest).toBe(true);
    expect(q6[0].title).toContain('Chronos');
  });

  it('generates Sanctuary Hub welcome quest and Crimson Colosseum challenge quest', () => {
    const qs = createQuestSystem();

    // Sanctuary Hub (floor 0)
    const hubFloor = makeMockFloor(0, 'sanctuary', [
      {
        id: 'hub_waypoint',
        type: 'waypoint_map',
        position: { x: 20, y: 0, z: 20 },
        roomId: 'room_spawn',
        used: false,
        label: 'Waypoint Map',
      },
      {
        id: 'hub_stash',
        type: 'stash_chest',
        position: { x: 24, y: 0, z: 20 },
        roomId: 'room_spawn',
        used: false,
        label: 'Shared Stash',
      },
      {
        id: 'hub_tome',
        type: 'lore_tome',
        position: { x: 16, y: 0, z: 20 },
        roomId: 'room_spawn',
        used: false,
        label: 'Bastion Chronicle',
      },
    ]);

    qs.initFloorQuests(hubFloor);
    const hubQuests = qs.getActiveQuests();
    expect(hubQuests[0].id).toBe('quest_main_sanctuary');
    expect(hubQuests[0].isMainQuest).toBe(true);

    const wpRes = qs.onInteractableUsed(hubFloor.interactables[0]);
    expect(wpRes.completedQuests.some((q) => q.id === 'quest_main_sanctuary')).toBe(true);

    // Crimson Colosseum
    const colosseumFloor = makeMockFloor(1, 'colosseum');
    qs.initFloorQuests(colosseumFloor);
    const colQuests = qs.getActiveQuests();
    expect(colQuests).toHaveLength(3);
    expect(colQuests[0].id).toBe('quest_main_colosseum');
    expect(colQuests[0].title).toContain('Colosseum');

    for (let i = 1; i <= 20; i++) {
      qs.onEnemyKilled(makeMockEnemy(`glad_${i}`));
    }
    const colBossRes = qs.onEnemyKilled(
      makeMockEnemy('col_boss_1', {
        archetype: 'ignis_forgemaster',
        isBoss: true,
      }),
    );
    expect(colBossRes.completedQuests.some((q) => q.id === 'quest_main_colosseum')).toBe(true);
    expect(
      qs.getAchievements().find((a) => a.id === 'colosseum_gladiator')?.unlocked,
    ).toBe(true);
  });

  it('completes Main Story Quest on Pinnacle Boss kill while keeping Butcher invasions separate', () => {
    const qs = createQuestSystem();
    qs.initFloorQuests(makeMockFloor(5, 'cathedral'));

    // Killing invading Butcher unlocks Fresh Meat Defier without prematurely completing Floor 5 Main Quest
    const butcherRes = qs.onEnemyKilled(
      makeMockEnemy('invader_butcher', {
        name: 'The Butcher',
        archetype: 'the_butcher',
        isBoss: true,
      }),
    );
    expect(butcherRes.completedQuests.some((q) => q.isMainQuest)).toBe(false);
    expect(
      qs.getAchievements().find((a) => a.id === 'fresh_meat_defier')?.unlocked,
    ).toBe(true);

    // Killing Floor 5 boss Valkyria completes Floor 5 Main Story Quest
    const bossRes = qs.onEnemyKilled(
      makeMockEnemy('boss_valkyria', {
        name: 'Valkyria, Seraph of Eternal Rime',
        archetype: 'valkyria_rime_seraph',
        isBoss: true,
      }),
    );
    expect(bossRes.completedQuests.some((q) => q.isMainQuest && q.status === 'completed')).toBe(
      true,
    );
  });

  it('runs a 30-second Cursed Chest Ambush Event spawning 3 escalating waves and completing cleanly', () => {
    const qs = createQuestSystem();
    const cursedProp: InteractableProp = {
      id: 'cursed_chest_f2',
      type: 'cursed_chest',
      position: { x: 18, y: 0, z: 22 },
      roomId: 'room_cursed',
      used: false,
      label: 'Cursed Chest',
    };

    qs.initFloorQuests(makeMockFloor(2, 'caverns', [cursedProp]));
    const interactRes = qs.onInteractableUsed(cursedProp);
    expect(interactRes.startedCursedEvent).toBe(true);
    expect(qs.getCursedEvent()?.active).toBe(true);
    expect(qs.getCursedEvent()?.remainingSec).toBe(30);
    expect(qs.getCursedEvent()?.totalWaves).toBe(3);

    const spawnedWaves: Array<{ x: number; y: number; z: number }> = [];
    let completedCount = 0;

    const dt = 1 / 60;
    for (let step = 0; step < 1805; step++) {
      const tick = qs.updateCursedEvent(dt);
      if (tick.spawnWaveAt) {
        spawnedWaves.push(tick.spawnWaveAt);
      }
      if (tick.eventCompleted) {
        completedCount += 1;
        break;
      }
    }

    expect(spawnedWaves).toHaveLength(3);
    expect(spawnedWaves[0]).toEqual({ x: 18, y: 0, z: 22 });
    expect(completedCount).toBe(1);
    expect(qs.getCursedEvent()).toBeNull();

    const cursebreakerAch = qs
      .getAchievements()
      .find((a) => a.id === 'cursed_survivor');
    expect(cursebreakerAch?.unlocked).toBe(true);
  });

  it('provides 24 Lore Codex entries across all 8 biomes and unlocks biome entries via lore_tome props', () => {
    const qs = createQuestSystem();
    const initialCodex = qs.getLoreCodex();
    expect(initialCodex).toHaveLength(24);

    const biomes: BiomeId[] = [
      'sanctuary',
      'crypt',
      'caverns',
      'forge',
      'void',
      'cathedral',
      'observatory',
      'colosseum',
    ];
    for (const b of biomes) {
      expect(initialCodex.filter((l) => l.biome === b)).toHaveLength(3);
    }
    expect(initialCodex.every((l) => !l.unlocked)).toBe(true);

    qs.initFloorQuests(makeMockFloor(5, 'cathedral'));
    const res = qs.onInteractableUsed({
      id: 'tome_cathedral_a',
      type: 'lore_tome',
      position: { x: 4, y: 0, z: 8 },
      roomId: 'room_spawn',
      used: true,
      label: 'Glacial Tome',
    });

    expect(res.unlockedLore).toBeDefined();
    expect(res.unlockedLore?.biome).toBe('cathedral');
    expect(res.unlockedLore?.unlocked).toBe(true);
    expect(qs.getLoreCodex().filter((l) => l.unlocked)).toHaveLength(1);
  });

  it('tracks all 18 Achievements including Goblin Snatcher, Runemaster, Awakened Archon, and Seraph & Time Slayer', () => {
    const qs = createQuestSystem();
    qs.initFloorQuests(makeMockFloor(5, 'cathedral'));
    expect(qs.getAchievements()).toHaveLength(18);

    // 5 Elite kills -> First Blood & Elite Hunter
    for (let i = 1; i <= 5; i++) {
      qs.onEnemyKilled(makeMockEnemy(`elite_${i}`, { isElite: true }));
    }

    // Treasure Goblin -> Goblin Snatcher
    qs.onEnemyKilled(
      makeMockEnemy('goblin_1', {
        archetype: 'treasure_goblin',
      }),
    );

    // Runeword forged -> Runemaster
    const runewordSword: ItemInstance = {
      id: 'rw_item_1',
      name: 'Grief Greatsword',
      slot: 'weapon',
      rarity: 'legendary',
      isMythic: true,
      levelReq: 1,
      itemLevel: 15,
      upgradeLevel: 0,
      affixes: [],
      runewordId: 'grief',
      runewordName: 'Grief',
      goldValue: 1000,
      icon: 'sword',
    };
    eventBus.emit('event:runewordForged', {
      runewordName: 'Grief',
      item: runewordSword,
    });

    // Awakening -> Awakened Archon
    eventBus.emit('player:awakeningChanged', {
      active: true,
      position: { x: 0, y: 0, z: 0 },
    });

    // Mythic item drop -> Legendary Finder
    eventBus.emit('loot:pickedUp', {
      drop: {
        id: 'drop_mythic_1',
        position: { x: 0, y: 0, z: 0 },
        kind: 'item',
        pickedUp: true,
        item: runewordSword,
      },
    });

    // Valkyria + Chronos -> Seraph & Time Slayer + Untouchable
    eventBus.emit('boss:spawned', {
      bossId: 'valkyria_rime_seraph',
      title: 'Valkyria',
      position: { x: 32, y: 0, z: 32 },
    });
    qs.onEnemyKilled(
      makeMockEnemy('boss_valk', {
        archetype: 'valkyria_rime_seraph',
        isBoss: true,
      }),
    );
    expect(
      qs.getAchievements().find((a) => a.id === 'seraph_time_slayer')?.unlocked,
    ).toBe(false);

    qs.initFloorQuests(makeMockFloor(6, 'observatory'));
    qs.onEnemyKilled(
      makeMockEnemy('boss_chronos', {
        archetype: 'chronos_time_architect',
        isBoss: true,
      }),
    );

    const unlockedIds = new Set(
      qs
        .getAchievements()
        .filter((a) => a.unlocked)
        .map((a) => a.id),
    );
    expect(unlockedIds.has('first_blood')).toBe(true);
    expect(unlockedIds.has('elite_hunter')).toBe(true);
    expect(unlockedIds.has('goblin_snatcher')).toBe(true);
    expect(unlockedIds.has('runemaster')).toBe(true);
    expect(unlockedIds.has('awakened_archon')).toBe(true);
    expect(unlockedIds.has('legendary_finder')).toBe(true);
    expect(unlockedIds.has('boss_slayer')).toBe(true);
    expect(unlockedIds.has('untouchable')).toBe(true);
    expect(unlockedIds.has('seraph_time_slayer')).toBe(true);
  });

  it('persists and restores SaveProfileData including Phase 3 stash, runes, companions, and colosseumBestWave', () => {
    const qs1 = createQuestSystem();
    expect(qs1.hasSaveGame()).toBe(false);
    expect(qs1.loadGame()).toBeNull();

    const stashRelic: ItemInstance = {
      id: 'stash_mythic_helm',
      name: 'Crown of Eternal Rime',
      slot: 'helmet',
      rarity: 'legendary',
      isMythic: true,
      levelReq: 5,
      itemLevel: 20,
      upgradeLevel: 4,
      affixes: [{ label: '+25 Intelligence', statKey: 'intelligence', value: 25 }],
      sockets: 3,
      socketedRunes: ['jah', 'ist', 'ber'],
      runewordId: 'enigma',
      runewordName: 'Enigma',
      goldValue: 2500,
      icon: 'helm',
    };

    const expansionSave: SaveProfileData = {
      version: 1,
      savedAt: 1700000000000,
      heroClass: 'arcanist',
      level: 12,
      xp: 980,
      unspentSkillPoints: 2,
      unspentAttributePoints: 6,
      baseAttributes: { strength: 8, dexterity: 12, intelligence: 34, vitality: 18 },
      gold: 4850,
      highestFloor: 6,
      killsTotal: 210,
      allocatedPassives: { archmage_1: 3 },
      loot: { inventory: [], equipped: {} },
      stash: [stashRelic],
      runes: { jah: 2, ist: 1, ber: 3, zod: 1 },
      activePet: 'void_kitsune',
      activeMercenary: 'storm_arcanist',
      colosseumBestWave: 14,
      unlockedLoreIds: ['lore_crypt_01', 'lore_cathedral_02', 'lore_observatory_01'],
      unlockedAchievementIds: ['first_blood', 'runemaster', 'awakened_archon'],
    };

    qs1.saveGame(expansionSave);
    expect(qs1.hasSaveGame()).toBe(true);

    const qs2 = createQuestSystem();
    expect(qs2.hasSaveGame()).toBe(true);
    const loaded = qs2.loadGame();
    expect(loaded).toEqual(expansionSave);
    expect(loaded?.stash).toHaveLength(1);
    expect(loaded?.runes?.ber).toBe(3);
    expect(loaded?.activePet).toBe('void_kitsune');
    expect(loaded?.activeMercenary).toBe('storm_arcanist');
    expect(loaded?.colosseumBestWave).toBe(14);
    expect(qs2.getLoreCodex().filter((l) => l.unlocked)).toHaveLength(3);
    expect(qs2.getAchievements().filter((a) => a.unlocked)).toHaveLength(3);

    qs2.clearSaveGame();
    expect(qs2.hasSaveGame()).toBe(false);
    expect(qs1.loadGame()).toBeNull();
  });

  it('fails an active Cursed Chest Ambush cleanly if the player dies mid-event', () => {
    const qs = createQuestSystem();
    const cursedProp: InteractableProp = {
      id: 'cursed_chest_fail',
      type: 'cursed_chest',
      position: { x: 8, y: 0, z: 8 },
      roomId: 'room_cursed',
      used: false,
      label: 'Cursed Chest',
    };

    qs.initFloorQuests(makeMockFloor(1, 'crypt', [cursedProp]));
    qs.startCursedChestEvent(cursedProp);
    expect(qs.updateCursedEvent(1.0).spawnWaveAt).toEqual({ x: 8, y: 0, z: 8 });

    eventBus.emit('combat:damageDealt', {
      targetIsPlayer: true,
      targetId: 'player',
      result: {
        finalDamage: 999,
        isCrit: false,
        isDodged: false,
        killed: true,
        healedSource: 0,
        hitPosition: { x: 8, y: 0, z: 8 },
        damageType: 'void',
      },
    });

    const failTick = qs.updateCursedEvent(0.016);
    expect(failTick.eventFailed).toBe(true);
    expect(failTick.eventCompleted).toBe(false);
    expect(qs.getCursedEvent()).toBeNull();
  });
});
