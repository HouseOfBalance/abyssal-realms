import type {
  BiomeId,
  BossId,
  DungeonFloorData,
  QuestObjective,
  QuestState,
} from '../../contracts/types';
import { clamp, SeededRng } from '../../core/Constants';

export type ObjectiveTriggerKind =
  | 'main_seal_kills'
  | 'main_boss_kill'
  | 'slay_monsters'
  | 'slay_elites'
  | 'cleanse_shrines'
  | 'uncover_lore'
  | 'survive_cursed_chest'
  | 'conquer_world_event'
  | 'sanctuary_welcome'
  | 'sanctuary_station';

export interface GeneratedFloorQuests {
  quests: QuestState[];
  objectiveTriggers: Map<string, ObjectiveTriggerKind>;
  expectedBossId: BossId;
}

interface MainQuestTemplate {
  bossId: BossId;
  title: string;
  description: string;
  sealObjectiveText: string;
  bossObjectiveText: string;
  baseSealKills: number;
  xpReward: number;
  goldReward: number;
}

const MAIN_QUEST_BY_FLOOR: Record<number, MainQuestTemplate> = {
  1: {
    bossId: 'bone_colossus',
    title: 'Phá Vỡ Ấn Hầm Mộ & Tiêu Diệt Người Khổng Lồ Xương',
    description:
      'Phá bỏ những lá bùa tử linh trói buộc Hầm Mộ Vua Bị Lãng Quên và hủy diệt Người Khổng Lồ Xương sừng sững canh giữ bậc thang vực thẳm.',
    sealObjectiveText: 'Phá Vỡ Ấn Hầm Mộ (Tiêu Diệt Lính Canh Hầm Mộ)',
    bossObjectiveText: 'Tiêu Diệt Người Khổng Lồ Xương',
    baseSealKills: 6,
    xpReward: 250,
    goldReward: 150,
  },
  2: {
    bossId: 'arachne_broodmother',
    title: 'Thanh Tẩy Mạng Nhện Dịch Bệnh & Tiêu Diệt Arachne Mẹ Của Bầy',
    description:
      'Chém xuyên qua Hang Động Bầy Độc bên dưới những rễ cây ô nhiễm và chấm dứt triều đại độc tố của Arachne, Thủ Lĩnh Của Vực Sâu.',
    sealObjectiveText: 'Thiêu Rụi Bầy Độc (Tiêu Diệt Quái Vật Hang Động)',
    bossObjectiveText: 'Tiêu Diệt Arachne Mẹ Của Bầy',
    baseSealKills: 8,
    xpReward: 500,
    goldReward: 300,
  },
  3: {
    bossId: 'ignis_forgemaster',
    title: 'Dập Tắt Đe Địa Ngục & Tiêu Diệt Ignis Chủ Lò Rèn',
    description:
      'Xông vào Lò Rèn Obsidian Địa Ngục nơi các titan sa ngã rèn vũ khí hủy diệt, và quật ngã Ignis Chủ Lò Rèn trở lại vào xỉ nóng.',
    sealObjectiveText: 'Phá Vỡ Quân Đoàn Địa Ngục (Tiêu Diệt Lính Canh Lò Rèn)',
    bossObjectiveText: 'Tiêu Diệt Ignis Chủ Lò Rèn',
    baseSealKills: 10,
    xpReward: 850,
    goldReward: 500,
  },
  4: {
    bossId: 'malakor_void_emperor',
    title: 'Lấy Lại Vương Miện Vỡ Vụn Từ Malakor',
    description:
      'Leo lên Thánh Địa Hư Không Thiên Thể ở rìa sáng tạo, đối mặt Hoàng Đế Malakor trên ngai vàng vỡ vụn của hắn, và lấy lại Vương Miện Vỡ Vụn.',
    sealObjectiveText: 'Tiêu Diệt Đội Vệ Binh Danh Dự Thiên Thể (Tiêu Diệt Nô Lệ Hư Không)',
    bossObjectiveText: 'Đánh Bại Malakor, Hoàng Đế Hư Không',
    baseSealKills: 12,
    xpReward: 1500,
    goldReward: 1000,
  },
  5: {
    bossId: 'valkyria_rime_seraph',
    title: 'Phá Vỡ Ca Đoàn Băng & Tiêu Diệt Valkyria, Thiên Sứ Của Vĩnh Băng',
    description:
      'Vượt qua gian giữa đóng băng của Đại Thánh Đường Băng Giá Chìm, chịu đựng những cơn bão tuyết gào thét, và hạ gục Valkyria, Thiên Sứ Sáu Cánh Sa Ngã.',
    sealObjectiveText: 'Thanh Lọc Giáo Hội Băng Giá (Tiêu Diệt Lính Canh Đại Thánh Đường)',
    bossObjectiveText: 'Tiêu Diệt Valkyria, Thiên Sứ Của Vĩnh Băng',
    baseSealKills: 14,
    xpReward: 2200,
    goldReward: 1400,
  },
  6: {
    bossId: 'chronos_time_architect',
    title: 'Cắt Đứt Khung Dệt Thiên Thể & Tiêu Diệt Chronos, Kiến Trúc Sư Thời Gian',
    description:
      'Leo lên Đài Quan Sát Thiên Thể Bánh Răng nơi những cỗ máy thiên thể bằng đồng uốn cong nhân quả, và đập tan Chronos trước khi vĩnh cửu bị viết lại.',
    sealObjectiveText: 'Phá Hủy Đồn Bánh Răng (Tiêu Diệt Lính Canh Đài Quan Sát)',
    bossObjectiveText: 'Đánh Bại Chronos, Kiến Trúc Sư Thời Gian',
    baseSealKills: 16,
    xpReward: 3200,
    goldReward: 2200,
  },
};

const BIOME_MONSTER_BOUNTY_FLAVOR: Record<
  BiomeId,
  { title: string; description: string; objectiveLabel: string }
> = {
  sanctuary: {
    title: 'Sẵn Sàng Của Thành Trì',
    description: 'Rèn giũa tư thế của bạn trong Thành Trì Của Những Người Ngã Xuống.',
    objectiveLabel: 'Luyện Tập Trong Thánh Địa',
  },
  crypt: {
    title: 'Tiền Thưởng: Tiêu Diệt Những Xác Chết Trỗi Dậy',
    description: 'Đưa những kẻ chết không yên của hoàng gia hầm mộ trở lại mồ yên tĩnh.',
    objectiveLabel: 'Tiêu Diệt Quái Vật Hầm Mộ Trỗi Dậy',
  },
  caverns: {
    title: 'Tiền Thưởng: Tiêu Diệt Bầy Độc',
    description: 'Giảm thiểu những kẻ kinh hoàng độc địa đang hoành hành dưới rễ cây ô nhiễm.',
    objectiveLabel: 'Tiêu Diệt Sinh Vật Hang Động Độc Địa',
  },
  forge: {
    title: 'Tiền Thưởng: Nghiền Nát Những Kẻ Bị Trói Vào Lò Rèn',
    description: 'Phá hủy những cấu trúc địa ngục và thợ rèn quỷ tuần tra xưởng đúc.',
    objectiveLabel: 'Tiêu Diệt Cư Dân Lò Rèn Địa Ngục',
  },
  void: {
    title: 'Tiền Thưởng: Trục Xuất Sinh Vật Hư Không',
    description: 'Tiêu hủy những dị thể thiên thể đang tràn qua Thánh Địa vỡ nát.',
    objectiveLabel: 'Tiêu Diệt Thực Thể Hư Không Thiên Thể',
  },
  cathedral: {
    title: 'Tiền Thưởng: Làm Tan Chảy Ca Đoàn Đóng Băng',
    description: 'Đập vỡ Hồn Ma Băng và Yêu Quái Băng ám ảnh gian giữa băng giá chìm.',
    objectiveLabel: 'Tiêu Diệt Quái Vật Bị Băng Trói',
  },
  observatory: {
    title: 'Tiền Thưởng: Tháo Rời Đội Bánh Răng',
    description: 'Phá vỡ những người máy đồng và Thợ Dệt Thiên Thể canh giữ bánh răng thiên thể.',
    objectiveLabel: 'Tiêu Diệt Cấu Trúc Đài Quan Sát',
  },
  colosseum: {
    title: 'Tiền Thưởng: Thảm Sát Dưới Trăng Máu',
    description: 'Nhuộm đỏ bãi đất bằng máu bằng cách tiêu diệt các đợt chiến binh Đấu Trường không ngừng nghỉ.',
    objectiveLabel: 'Tiêu Diệt Chiến Binh Đấu Trường',
  },
};

const BIOME_ELITE_BOUNTY_FLAVOR: Record<
  BiomeId,
  { title: string; description: string; objectiveLabel: string }
> = {
  sanctuary: {
    title: 'Champions of the Hearth',
    description: 'Consult veteran masters stationed across the Bastion.',
    objectiveLabel: 'Inspect Sanctuary Stations',
  },
  crypt: {
    title: 'Bounty: Oathbreaker Champions',
    description: 'Hunt down the empowered Deathguards commanding the crypt legions.',
    objectiveLabel: 'Slay Elite Monsters',
  },
  caverns: {
    title: 'Bounty: Apex Predators of the Deep',
    description: 'Slay the mutated brood-champions stalking the darkest grottoes.',
    objectiveLabel: 'Slay Elite Monsters',
  },
  forge: {
    title: 'Bounty: Hellforged Overseers',
    description: 'Strike down the rune-branded Elite wardens stoking the titan furnaces.',
    objectiveLabel: 'Slay Elite Monsters',
  },
  void: {
    title: 'Bounty: Heralds of Annihilation',
    description: 'Eliminate Malakor’s Elite Void-ascendants before their rituals complete.',
    objectiveLabel: 'Slay Elite Monsters',
  },
  cathedral: {
    title: 'Bounty: Knights of Absolute Zero',
    description: 'Fell Valkyria’s Elite glacial commanders patrolling the frozen aisles.',
    objectiveLabel: 'Slay Elite Monsters',
  },
  observatory: {
    title: 'Bounty: Wardens of the Paradox',
    description: 'Destroy the Elite chronal sentinels anchoring the Observatory’s time-locks.',
    objectiveLabel: 'Slay Elite Monsters',
  },
  colosseum: {
    title: 'Bounty: Blood of Arena Champions',
    description: 'Cut down empowered Gladiators and Bosses upon the Colosseum floor.',
    objectiveLabel: 'Slay Elite Gladiators or Bosses',
  },
};

interface SideBountyCandidate {
  kind: Exclude<
    ObjectiveTriggerKind,
    'main_seal_kills' | 'main_boss_kill' | 'sanctuary_welcome' | 'sanctuary_station'
  >;
  weight: number;
  build: () => { quest: QuestState; trigger: ObjectiveTriggerKind; objectiveId: string };
}

function getMainQuestTemplate(floorNumber: number, biome: BiomeId): MainQuestTemplate {
  const preset = MAIN_QUEST_BY_FLOOR[floorNumber];
  if (preset) return preset;

  if (biome === 'cathedral') {
    return MAIN_QUEST_BY_FLOOR[5];
  }

  const extraFloors = Math.max(1, floorNumber - 6);
  return {
    bossId: 'chronos_time_architect',
    title: `Fracture of Eternity — Purge Floor ${floorNumber}`,
    description: `Beyond the Observatory, temporal rifts multiply endlessly. Hunt down the Sovereign ruling Floor ${floorNumber}.`,
    sealObjectiveText: 'Cull the Chronal Vanguard',
    bossObjectiveText: 'Slay the Abyssal Sovereign',
    baseSealKills: clamp(16 + extraFloors * 2, 8, 28),
    xpReward: 3200 + extraFloors * 600,
    goldReward: 2200 + extraFloors * 400,
  };
}

function generateSanctuaryQuests(floor: DungeonFloorData): GeneratedFloorQuests {
  const objectiveTriggers = new Map<string, ObjectiveTriggerKind>();
  const interactables = Array.isArray(floor.interactables) ? floor.interactables : [];
  const hasLoreTome = interactables.some((p) => !p.used && p.type === 'lore_tome');
  const stationReq = interactables.length >= 2 ? 2 : 1;

  const mainId = 'quest_main_sanctuary';
  const mainObjId = `${mainId}_obj_welcome`;
  objectiveTriggers.set(mainObjId, 'sanctuary_welcome');

  const quests: QuestState[] = [
    {
      id: mainId,
      title: 'Bastion of the Fallen — Prepare for the Descent',
      description:
        'Take refuge in the last cliffside stronghold above the Rift. Visit the Bastion’s forge, stash, menagerie, or waypoint plaza before stepping into the Abyss.',
      isMainQuest: true,
      floorNumber: 0,
      objectives: [
        {
          id: mainObjId,
          description: 'Visit a Sanctuary Station or Step Into the Waypoint / Abyssal Portal',
          current: 0,
          required: 1,
          completed: false,
        },
      ],
      status: 'active',
      xpReward: 100,
      goldReward: 100,
    },
  ];

  // Side Quest 1: Bastion Tour / Training Dummy
  const stationQuestId = 'quest_side_sanctuary_arms';
  const stationObjId = `${stationQuestId}_obj_1`;
  objectiveTriggers.set(stationObjId, 'sanctuary_station');
  quests.push({
    id: stationQuestId,
    title: 'Arms of the Last Hearth',
    isMainQuest: false,
    description:
      'Test your steel against the Armored Training Dummy and inspect the Bastion’s artisan stations.',
    floorNumber: 0,
    objectives: [
      {
        id: stationObjId,
        description:
          stationReq > 1
            ? 'Inspect Bastion Stations or Strike the Training Dummy'
            : 'Inspect a Bastion Station or Strike the Training Dummy',
        current: 0,
        required: stationReq,
        completed: false,
      },
    ],
    status: 'active',
    xpReward: 75,
    goldReward: 75,
  });

  // Side Quest 2: Sanctuary Lore (if tome present) or Combat Readiness
  if (hasLoreTome) {
    const loreQuestId = 'quest_side_sanctuary_lore';
    const loreObjId = `${loreQuestId}_obj_1`;
    objectiveTriggers.set(loreObjId, 'uncover_lore');
    quests.push({
      id: loreQuestId,
      title: 'Chronicles of the Bastion',
      isMainQuest: false,
      description:
        'Read the inscribed records preserved by scholars of the Bastion of the Fallen.',
      floorNumber: 0,
      objectives: [
        {
          id: loreObjId,
          description: 'Uncover a Sanctuary Lore Tome',
          current: 0,
          required: 1,
          completed: false,
        },
      ],
      status: 'active',
      xpReward: 80,
      goldReward: 60,
    });
  }

  return {
    quests,
    objectiveTriggers,
    expectedBossId: 'bone_colossus',
  };
}

function generateColosseumQuests(floor: DungeonFloorData): GeneratedFloorQuests {
  const floorNum = Math.max(1, Math.floor(floor.floorNumber || 1));
  const objectiveTriggers = new Map<string, ObjectiveTriggerKind>();

  const mainId = 'quest_main_colosseum';
  const waveKillsObjId = `${mainId}_obj_gladiators`;
  const bossObjId = `${mainId}_obj_champion`;

  objectiveTriggers.set(waveKillsObjId, 'main_seal_kills');
  objectiveTriggers.set(bossObjId, 'main_boss_kill');

  const eliteQuestId = 'quest_side_colosseum_elites';
  const eliteObjId = `${eliteQuestId}_obj_1`;
  objectiveTriggers.set(eliteObjId, 'slay_elites');

  const carnageQuestId = 'quest_side_colosseum_slay';
  const carnageObjId = `${carnageQuestId}_obj_1`;
  objectiveTriggers.set(carnageObjId, 'slay_monsters');

  const quests: QuestState[] = [
    {
      id: mainId,
      title: 'Trial of Blood: Conquer the Crimson Colosseum',
      isMainQuest: true,
      description:
        'Stand defiant upon the blood-soaked sands of the Undying Arena, survive relentless gladiator waves, and fell the Colosseum’s Arena Boss Champions.',
      floorNumber: floorNum,
      objectives: [
        {
          id: waveKillsObjId,
          description: 'Slay Gladiators in the Crimson Colosseum',
          current: 0,
          required: 20,
          completed: false,
        },
        {
          id: bossObjId,
          description: 'Vanquish a Colosseum Arena Boss',
          current: 0,
          required: 1,
          completed: false,
        },
      ],
      status: 'active',
      xpReward: 2600,
      goldReward: 1800,
    },
    {
      id: eliteQuestId,
      title: BIOME_ELITE_BOUNTY_FLAVOR.colosseum.title,
      isMainQuest: false,
      description: BIOME_ELITE_BOUNTY_FLAVOR.colosseum.description,
      floorNumber: floorNum,
      objectives: [
        {
          id: eliteObjId,
          description: BIOME_ELITE_BOUNTY_FLAVOR.colosseum.objectiveLabel,
          current: 0,
          required: 3,
          completed: false,
        },
      ],
      status: 'active',
      xpReward: 1200,
      goldReward: 900,
    },
    {
      id: carnageQuestId,
      title: BIOME_MONSTER_BOUNTY_FLAVOR.colosseum.title,
      isMainQuest: false,
      description: BIOME_MONSTER_BOUNTY_FLAVOR.colosseum.description,
      floorNumber: floorNum,
      objectives: [
        {
          id: carnageObjId,
          description: BIOME_MONSTER_BOUNTY_FLAVOR.colosseum.objectiveLabel,
          current: 0,
          required: 35,
          completed: false,
        },
      ],
      status: 'active',
      xpReward: 1400,
      goldReward: 1000,
    },
  ];

  return {
    quests,
    objectiveTriggers,
    expectedBossId: 'malakor_void_emperor',
  };
}

export function generateQuestsForFloor(floor: DungeonFloorData): GeneratedFloorQuests {
  const biome: BiomeId = floor.biome || 'crypt';

  // Special Hub & Arena Modes
  if (biome === 'sanctuary' || floor.floorNumber === 0) {
    return generateSanctuaryQuests(floor);
  }
  if (biome === 'colosseum') {
    return generateColosseumQuests(floor);
  }

  const floorNum = Math.max(1, Math.floor(floor.floorNumber || 1));
  const seed = ((floor.seed || 1337) ^ Math.imul(floorNum, 0x9e3779b9)) >>> 0;
  const rng = new SeededRng(seed || 1337);

  const objectiveTriggers = new Map<string, ObjectiveTriggerKind>();
  const quests: QuestState[] = [];

  // ─── 1. Main Story Quest (Floors 1–6 + Endless 7+) ──────────────────────────
  const mainTpl = getMainQuestTemplate(floorNum, biome);
  const mainId = `quest_main_f${floorNum}`;
  const sealObjId = `${mainId}_obj_seal`;
  const bossObjId = `${mainId}_obj_boss`;

  const mainObjectives: QuestObjective[] = [
    {
      id: sealObjId,
      description: mainTpl.sealObjectiveText,
      current: 0,
      required: mainTpl.baseSealKills,
      completed: false,
    },
    {
      id: bossObjId,
      description: mainTpl.bossObjectiveText,
      current: 0,
      required: 1,
      completed: false,
    },
  ];

  objectiveTriggers.set(sealObjId, 'main_seal_kills');
  objectiveTriggers.set(bossObjId, 'main_boss_kill');

  quests.push({
    id: mainId,
    title: mainTpl.title,
    isMainQuest: true,
    description: mainTpl.description,
    floorNumber: floorNum,
    objectives: mainObjectives,
    status: 'active',
    xpReward: mainTpl.xpReward,
    goldReward: mainTpl.goldReward,
  });

  // ─── 2. Inspect Floor Interactables & Rooms for Procedural Side Bounties ───
  const interactables = Array.isArray(floor.interactables) ? floor.interactables : [];
  const rooms = Array.isArray(floor.rooms) ? floor.rooms : [];

  const availableShrines = interactables.filter(
    (p) =>
      !p.used &&
      (p.type === 'shrine_heal' || p.type === 'shrine_power' || p.type === 'shrine_frenzy'),
  ).length;

  const availableLoreTomes = interactables.filter(
    (p) => !p.used && p.type === 'lore_tome',
  ).length;

  const availableCursedChests = interactables.filter(
    (p) => !p.used && p.type === 'cursed_chest',
  ).length;

  const availableWorldEvents = interactables.filter(
    (p) =>
      !p.used &&
      (p.type === 'corrupted_obelisk' || p.type === 'soul_lantern' || p.type === 'rift_breach'),
  ).length;

  const eliteRoomsCount = rooms.filter((r) => r.type === 'elite').length;

  const baseSideXp = 120 * floorNum;
  const baseSideGold = 80 * floorNum;

  const candidates: SideBountyCandidate[] = [];

  // Candidate A: Slay Monsters (always available)
  const monsterFlavor = BIOME_MONSTER_BOUNTY_FLAVOR[biome];
  const monsterKillsReq = clamp(8 + floorNum * 2 + rng.int(0, 2), 8, 24);
  candidates.push({
    kind: 'slay_monsters',
    weight: 1.0,
    build: () => {
      const qId = `quest_side_f${floorNum}_slay`;
      const objId = `${qId}_obj_1`;
      return {
        objectiveId: objId,
        trigger: 'slay_monsters',
        quest: {
          id: qId,
          title: monsterFlavor.title,
          isMainQuest: false,
          description: monsterFlavor.description,
          floorNumber: floorNum,
          objectives: [
            {
              id: objId,
              description: monsterFlavor.objectiveLabel,
              current: 0,
              required: monsterKillsReq,
              completed: false,
            },
          ],
          status: 'active',
          xpReward: baseSideXp,
          goldReward: baseSideGold,
        },
      };
    },
  });

  // Candidate B: Slay Elites (always available as fallback; scales with elite rooms)
  const eliteFlavor = BIOME_ELITE_BOUNTY_FLAVOR[biome];
  const eliteKillsReq = eliteRoomsCount >= 2 && floorNum >= 2 ? 2 : 1;
  candidates.push({
    kind: 'slay_elites',
    weight: eliteRoomsCount > 0 ? 1.15 : 0.85,
    build: () => {
      const qId = `quest_side_f${floorNum}_elites`;
      const objId = `${qId}_obj_1`;
      return {
        objectiveId: objId,
        trigger: 'slay_elites',
        quest: {
          id: qId,
          title: eliteFlavor.title,
          isMainQuest: false,
          description: eliteFlavor.description,
          floorNumber: floorNum,
          objectives: [
            {
              id: objId,
              description: eliteFlavor.objectiveLabel,
              current: 0,
              required: eliteKillsReq,
              completed: false,
            },
          ],
          status: 'active',
          xpReward: Math.round(baseSideXp * 1.25),
          goldReward: Math.round(baseSideGold * 1.25),
        },
      };
    },
  });

  // Candidate C: Survive a Cursed Chest (when floor has a cursed chest)
  if (availableCursedChests >= 1) {
    candidates.push({
      kind: 'survive_cursed_chest',
      weight: 1.4,
      build: () => {
        const qId = `quest_side_f${floorNum}_cursed`;
        const objId = `${qId}_obj_1`;
        return {
          objectiveId: objId,
          trigger: 'survive_cursed_chest',
          quest: {
            id: qId,
            title: 'Bounty: Break the Blood-Curse',
            isMainQuest: false,
            description:
              'Awaken a Cursed Chest and survive its 30-second abyssal ambush to claim untainted spoils.',
            floorNumber: floorNum,
            objectives: [
              {
                id: objId,
                description: 'Survive a Cursed Chest Ambush',
                current: 0,
                required: 1,
                completed: false,
              },
            ],
            status: 'active',
            xpReward: Math.round(baseSideXp * 1.5),
            goldReward: Math.round(baseSideGold * 1.5),
          },
        };
      },
    });
  }

  // Candidate D: Cleanse Shrines (when floor has shrines)
  if (availableShrines >= 1) {
    const shrinesReq = Math.min(availableShrines, 2);
    candidates.push({
      kind: 'cleanse_shrines',
      weight: 1.2,
      build: () => {
        const qId = `quest_side_f${floorNum}_shrines`;
        const objId = `${qId}_obj_1`;
        return {
          objectiveId: objId,
          trigger: 'cleanse_shrines',
          quest: {
            id: qId,
            title: 'Bounty: Sanctify the Forgotten Altars',
            isMainQuest: false,
            description:
              'Channel ancient dungeon shrines to purge abyssal corruption from sacred ground.',
            floorNumber: floorNum,
            objectives: [
              {
                id: objId,
                description:
                  shrinesReq > 1 ? 'Cleanse & Activate Ancient Shrines' : 'Cleanse & Activate a Shrine',
                current: 0,
                required: shrinesReq,
                completed: false,
              },
            ],
            status: 'active',
            xpReward: Math.round(baseSideXp * 1.15),
            goldReward: Math.round(baseSideGold * 1.15),
          },
        };
      },
    });
  }

  // Candidate E: Uncover Lore (when floor has lore tomes)
  if (availableLoreTomes >= 1) {
    const loreReq = availableLoreTomes >= 2 && floorNum >= 3 ? 2 : 1;
    candidates.push({
      kind: 'uncover_lore',
      weight: 1.2,
      build: () => {
        const qId = `quest_side_f${floorNum}_lore`;
        const objId = `${qId}_obj_1`;
        return {
          objectiveId: objId,
          trigger: 'uncover_lore',
          quest: {
            id: qId,
            title: 'Bounty: Whispers of the Fallen',
            isMainQuest: false,
            description:
              'Recover lost Lore Tomes left behind by scholars and sentinels swallowed by the Rift.',
            floorNumber: floorNum,
            objectives: [
              {
                id: objId,
                description:
                  loreReq > 1 ? 'Uncover Ancient Lore Tomes' : 'Uncover an Ancient Lore Tome',
                current: 0,
                required: loreReq,
                completed: false,
              },
            ],
            status: 'active',
            xpReward: Math.round(baseSideXp * 1.1),
            goldReward: Math.round(baseSideGold * 1.1),
          },
        };
      },
    });
  }

  // Candidate F: World Event Omen (Corrupted Obelisk, Soul Lantern, or Rift Breach)
  if (availableWorldEvents >= 1) {
    candidates.push({
      kind: 'conquer_world_event',
      weight: 1.25,
      build: () => {
        const qId = `quest_side_f${floorNum}_omen`;
        const objId = `${qId}_obj_1`;
        return {
          objectiveId: objId,
          trigger: 'conquer_world_event',
          quest: {
            id: qId,
            title: 'Bounty: Answer the Abyssal Omen',
            isMainQuest: false,
            description:
              'Confront a Corrupted Obelisk, Soul Lantern, or Rift Breach resonating within this floor.',
            floorNumber: floorNum,
            objectives: [
              {
                id: objId,
                description: 'Activate an Obelisk, Soul Lantern, or Rift Breach',
                current: 0,
                required: 1,
                completed: false,
              },
            ],
            status: 'active',
            xpReward: Math.round(baseSideXp * 1.35),
            goldReward: Math.round(baseSideGold * 1.35),
          },
        };
      },
    });
  }

  // Weighted deterministic selection without replacement for 2 Side Bounties
  const pool = [...candidates];
  const targetSideCount = Math.min(2, pool.length);

  for (let i = 0; i < targetSideCount; i++) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = rng.range(0, totalWeight);
    let chosenIdx = pool.length - 1;

    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j].weight;
      if (roll <= 0) {
        chosenIdx = j;
        break;
      }
    }

    const [chosen] = pool.splice(chosenIdx, 1);
    const built = chosen.build();
    objectiveTriggers.set(built.objectiveId, built.trigger);
    quests.push(built.quest);
  }

  return {
    quests,
    objectiveTriggers,
    expectedBossId: mainTpl.bossId,
  };
}
