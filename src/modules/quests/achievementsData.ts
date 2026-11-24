export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
}

export interface AchievementView {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}

/**
 * 18 unlockable dark-fantasy ARPG Achievements (12 core + 6 Phase 3 Expansion)
 * tracking combat mastery, invasions, treasure goblins, runewords, awakening,
 * pinnacle bosses, and Colosseum glory.
 */
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  // ─── Core Achievements (1–12) ──────────────────────────────────────────────
  {
    id: 'first_blood',
    title: 'First Blood',
    description: 'Slay your first creature lurking in the Abyssal Realms.',
  },
  {
    id: 'abyssal_reaper',
    title: 'Abyssal Reaper',
    description: 'Slay 50 monsters across your descent into the dark.',
  },
  {
    id: 'elite_hunter',
    title: 'Elite Hunter',
    description: 'Vanquish 5 Champion or Elite monsters bearing abyssal affixes.',
  },
  {
    id: 'boss_slayer',
    title: 'Boss Slayer',
    description: 'Fell a Pinnacle Floor Boss in mortal combat.',
  },
  {
    id: 'crown_reclaimer',
    title: 'Sovereign of the Shattered Crown',
    description: 'Defeat Malakor, the Void Emperor, in the Astral Void Sanctum.',
  },
  {
    id: 'untouchable',
    title: 'Untouchable',
    description: 'Defeat a Floor Boss without taking any health damage during the encounter.',
  },
  {
    id: 'legendary_finder',
    title: 'Legendary Finder',
    description: 'Discover or claim a Legendary or Mythic Primal item of ancient power.',
  },
  {
    id: 'cursed_survivor',
    title: 'Cursebreaker',
    description: 'Survive a 30-second Cursed Chest Ambush and claim its bonus spoils.',
  },
  {
    id: 'shrine_pilgrim',
    title: 'Sanctified Pilgrim',
    description: 'Channel blessings from 3 ancient shrines in the depths.',
  },
  {
    id: 'loremaster',
    title: 'Chronicler of the Forgotten',
    description: 'Uncover 4 lost Lore Tomes inscribed by the fallen.',
  },
  {
    id: 'bounty_champion',
    title: 'Bounty Champion',
    description: 'Complete 4 Main Story Quests or Side Bounties.',
  },
  {
    id: 'ascendant_hero',
    title: 'Ascendant Hero',
    description: 'Reach Hero Level 5 through battle and bloodshed.',
  },

  // ─── Phase 3 Expansion Achievements (13–18) ────────────────────────────────
  {
    id: 'fresh_meat_defier',
    title: 'Fresh Meat Defier',
    description: 'Survive an ambush by The Butcher and cleave the dread demon down.',
  },
  {
    id: 'goblin_snatcher',
    title: 'Goblin Snatcher',
    description: 'Slay a fleeing Treasure Goblin before it escapes into its portal.',
  },
  {
    id: 'runemaster',
    title: 'Runemaster',
    description: 'Forge a Legendary Runeword by socketing ancient runes in sacred sequence.',
  },
  {
    id: 'awakened_archon',
    title: 'Awakened Archon',
    description: 'Unleash your Abyssal Awakening ultimate form at maximum Fury.',
  },
  {
    id: 'seraph_time_slayer',
    title: 'Seraph & Time Slayer',
    description: 'Vanquish both Valkyria, Seraph of Eternal Rime, and Chronos, Architect of Time.',
  },
  {
    id: 'colosseum_gladiator',
    title: 'Colosseum Gladiator',
    description: 'Prove your might in the Crimson Bloodhunt Colosseum by conquering arena waves or bosses.',
  },
];

export function buildAchievementsList(unlockedIds: ReadonlySet<string>): AchievementView[] {
  return ACHIEVEMENT_DEFINITIONS.map((def) => ({
    id: def.id,
    title: def.title,
    description: def.description,
    unlocked: unlockedIds.has(def.id),
  }));
}
