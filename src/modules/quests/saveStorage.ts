import type {
  HeroClassId,
  ItemInstance,
  MercenaryId,
  PetId,
  RuneId,
  SaveProfileData,
} from '../../contracts/types';

export const SAVE_STORAGE_KEY = 'abyssal_realms_save_v1';
export const CURRENT_SAVE_VERSION = 1;

const VALID_HERO_CLASSES: ReadonlySet<HeroClassId> = new Set([
  'vanguard',
  'shadowblade',
  'arcanist',
]);

const VALID_PET_IDS: ReadonlySet<PetId> = new Set([
  'celestial_owl',
  'ember_wyrmling',
  'void_kitsune',
]);

const VALID_MERCENARY_IDS: ReadonlySet<MercenaryId> = new Set([
  'iron_templar',
  'sylvan_ranger',
  'storm_arcanist',
]);

const VALID_RUNE_IDS: ReadonlySet<RuneId> = new Set([
  'sol',
  'vex',
  'jah',
  'ohm',
  'ber',
  'zod',
  'ist',
  'mal',
  'gul',
  'sur',
  'lo',
  'cham',
]);

/**
 * Module-scoped in-memory fallback store so headless Node/Vitest environments
 * or restricted browser contexts without `localStorage` persist cleanly across
 * QuestSystem instances.
 */
let memoryFallbackStore: string | null = null;

function getBrowserLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const storage = window.localStorage;
      if (
        typeof storage.getItem === 'function' &&
        typeof storage.setItem === 'function' &&
        typeof storage.removeItem === 'function'
      ) {
        return storage;
      }
    }
    if (typeof globalThis !== 'undefined') {
      const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      if (desc && 'value' in desc && desc.value) {
        const storage = desc.value as Storage;
        if (
          typeof storage.getItem === 'function' &&
          typeof storage.setItem === 'function' &&
          typeof storage.removeItem === 'function'
        ) {
          return storage;
        }
      }
    }
  } catch {
    // Access to localStorage may throw SecurityError in sandboxed contexts
  }
  return null;
}

function readRawSave(): string | null {
  const storage = getBrowserLocalStorage();
  if (storage) {
    try {
      const val = storage.getItem(SAVE_STORAGE_KEY);
      if (val !== null) {
        memoryFallbackStore = val;
        return val;
      }
    } catch {
      // Fall through to memory store
    }
  }
  return memoryFallbackStore;
}

function writeRawSave(serialized: string): void {
  memoryFallbackStore = serialized;
  const storage = getBrowserLocalStorage();
  if (storage) {
    try {
      storage.setItem(SAVE_STORAGE_KEY, serialized);
    } catch {
      // QuotaExceededError or private-mode restriction: memoryFallbackStore retains data
    }
  }
}

function removeRawSave(): void {
  memoryFallbackStore = null;
  const storage = getBrowserLocalStorage();
  if (storage) {
    try {
      storage.removeItem(SAVE_STORAGE_KEY);
    } catch {
      // Ignore storage access errors
    }
  }
}

function isFiniteNonNegative(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

function validateAndNormalizeSave(raw: unknown): SaveProfileData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (
    typeof obj.heroClass !== 'string' ||
    !VALID_HERO_CLASSES.has(obj.heroClass as HeroClassId)
  ) {
    return null;
  }

  if (typeof obj.level !== 'number' || !Number.isFinite(obj.level) || obj.level < 1) {
    return null;
  }

  const attrs = obj.baseAttributes as Record<string, unknown> | undefined;
  if (
    !attrs ||
    typeof attrs !== 'object' ||
    typeof attrs.strength !== 'number' ||
    typeof attrs.dexterity !== 'number' ||
    typeof attrs.intelligence !== 'number' ||
    typeof attrs.vitality !== 'number'
  ) {
    return null;
  }

  const lootRaw = obj.loot as Record<string, unknown> | undefined;
  const inventory = Array.isArray(lootRaw?.inventory) ? lootRaw.inventory : [];
  const equipped =
    lootRaw?.equipped && typeof lootRaw.equipped === 'object' && !Array.isArray(lootRaw.equipped)
      ? lootRaw.equipped
      : {};

  const allocatedPassivesRaw = obj.allocatedPassives;
  const allocatedPassives: Record<string, number> = {};
  if (
    allocatedPassivesRaw &&
    typeof allocatedPassivesRaw === 'object' &&
    !Array.isArray(allocatedPassivesRaw)
  ) {
    for (const [k, v] of Object.entries(allocatedPassivesRaw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        allocatedPassives[k] = Math.floor(v);
      }
    }
  }

  const unlockedLoreIds = Array.isArray(obj.unlockedLoreIds)
    ? Array.from(new Set(obj.unlockedLoreIds.filter((id): id is string => typeof id === 'string')))
    : [];

  const unlockedAchievementIds = Array.isArray(obj.unlockedAchievementIds)
    ? Array.from(
        new Set(obj.unlockedAchievementIds.filter((id): id is string => typeof id === 'string')),
      )
    : [];

  const normalized: SaveProfileData = {
    version:
      typeof obj.version === 'number' && Number.isFinite(obj.version)
        ? obj.version
        : CURRENT_SAVE_VERSION,
    savedAt: isFiniteNonNegative(obj.savedAt) && obj.savedAt > 0 ? obj.savedAt : Date.now(),
    heroClass: obj.heroClass as HeroClassId,
    level: Math.max(1, Math.floor(obj.level)),
    xp: isFiniteNonNegative(obj.xp) ? obj.xp : 0,
    unspentSkillPoints: isFiniteNonNegative(obj.unspentSkillPoints)
      ? Math.floor(obj.unspentSkillPoints)
      : 0,
    unspentAttributePoints: isFiniteNonNegative(obj.unspentAttributePoints)
      ? Math.floor(obj.unspentAttributePoints)
      : 0,
    baseAttributes: {
      strength: Number.isFinite(attrs.strength) ? attrs.strength : 10,
      dexterity: Number.isFinite(attrs.dexterity) ? attrs.dexterity : 10,
      intelligence: Number.isFinite(attrs.intelligence) ? attrs.intelligence : 10,
      vitality: Number.isFinite(attrs.vitality) ? attrs.vitality : 10,
    },
    gold: isFiniteNonNegative(obj.gold) ? Math.floor(obj.gold) : 0,
    highestFloor:
      typeof obj.highestFloor === 'number' &&
      Number.isFinite(obj.highestFloor) &&
      obj.highestFloor >= 0
        ? Math.floor(obj.highestFloor)
        : 1,
    killsTotal: isFiniteNonNegative(obj.killsTotal) ? Math.floor(obj.killsTotal) : 0,
    allocatedPassives,
    loot: {
      inventory: JSON.parse(JSON.stringify(inventory)),
      equipped: JSON.parse(JSON.stringify(equipped)),
    },
    unlockedLoreIds,
    unlockedAchievementIds,
  };

  // Preserve Phase 3 optional SaveProfileData expansion fields
  if (Array.isArray(obj.stash)) {
    normalized.stash = JSON.parse(JSON.stringify(obj.stash)) as ItemInstance[];
  }

  if (obj.runes && typeof obj.runes === 'object' && !Array.isArray(obj.runes)) {
    const runesOut: Partial<Record<RuneId, number>> = {};
    for (const [k, v] of Object.entries(obj.runes as Record<string, unknown>)) {
      if (VALID_RUNE_IDS.has(k as RuneId) && isFiniteNonNegative(v)) {
        runesOut[k as RuneId] = Math.floor(v);
      }
    }
    normalized.runes = runesOut;
  }

  if (typeof obj.activePet === 'string' && VALID_PET_IDS.has(obj.activePet as PetId)) {
    normalized.activePet = obj.activePet as PetId;
  }

  if (
    typeof obj.activeMercenary === 'string' &&
    VALID_MERCENARY_IDS.has(obj.activeMercenary as MercenaryId)
  ) {
    normalized.activeMercenary = obj.activeMercenary as MercenaryId;
  }

  if (isFiniteNonNegative(obj.colosseumBestWave)) {
    normalized.colosseumBestWave = Math.floor(obj.colosseumBestWave);
  }

  return normalized;
}

export class SaveStorageManager {
  save(profile: SaveProfileData): void {
    const validated = validateAndNormalizeSave(profile);
    if (!validated) return;
    const serialized = JSON.stringify(validated);
    writeRawSave(serialized);
  }

  load(): SaveProfileData | null {
    const raw = readRawSave();
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return validateAndNormalizeSave(parsed);
    } catch {
      return null;
    }
  }

  hasSave(): boolean {
    return this.load() !== null;
  }

  clear(): void {
    removeRawSave();
  }
}
