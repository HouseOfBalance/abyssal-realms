import type { BiomeId, LoreEntry } from '../../contracts/types';

export interface LoreDefinition {
  id: string;
  title: string;
  biome: BiomeId;
  text: string;
}

/**
 * 24 atmospheric Dark-Fantasy Lore Codex entries across all 8 biomes (3 per biome),
 * chronicling the Bastion of the Fallen, the descent from the Crypt to the Void,
 * the Sunken Cathedral of Rime, the Clockwork Astral Observatory, and the Crimson Colosseum.
 */
export const LORE_CODEX_DEFINITIONS: readonly LoreDefinition[] = [
  // ─── Floor I: Forgotten Crypt of Kings ('crypt') ───────────────────────────
  {
    id: 'lore_crypt_01',
    title: 'I. Oath of the Sunless Dynasty',
    biome: 'crypt',
    text:
      'Before mortar dried upon the High Citadel, King Aurelian hammered star-gold into the Crown of First Light and pressed it over the weeping Abyssal Rift. Twelve generations of royal blood swore never to know warm soil in death; encased in ossuary plate, they stood cold vigil beneath the flagstones so the waking world above might forget what scratched at the dark.',
  },
  {
    id: 'lore_crypt_02',
    title: 'II. Ledger of the Bone Architect',
    biome: 'crypt',
    text:
      'Forgive my chisels, Sovereign. As the seal thinned, single wardens crumbled like chalk against Void tremors. By Regent Malakor’s decree I bound three hundred fallen paladins into one towering ossuary frame—the Bone Colossus—anchoring the crypt’s keystone to its ribcage. Tonight its hollow sockets burned violet, and it knelt not to the Crown, but to the chasm below.',
  },
  {
    id: 'lore_crypt_03',
    title: 'III. The Night the Crown Fractured',
    biome: 'crypt',
    text:
      'Under a bled-out eclipse, Arch-Regent Malakor ascended the chancel not to renew the ward, but to unmake it. Three times his mace fell upon the Crown of First Light. Four shards tore downward through stone and root, dragging cathedral, throne, and legion four leagues into the hungry earth while dead kings rose screaming from their sarcophagi.',
  },

  // ─── Floor II: Venomous Brood Caverns ('caverns') ──────────────────────────
  {
    id: 'lore_caverns_01',
    title: 'IV. Beneath the Blighted World-Roots',
    biome: 'caverns',
    text:
      'Scout’s final dispatch, Obsidian Veil: The ancient subterranean forest is dead, drowned in luminous bile leaking from the rift. Pale cave-weavers that once hunted blind salamanders now tower taller than warhorses, their carapaces hardened like oiled iron and their fangs dripping a necrotic venom that rots steel mail before the heart stops beating.',
  },
  {
    id: 'lore_caverns_02',
    title: 'V. Song of Matriarch Arachne',
    biome: 'caverns',
    text:
      'When the Emerald Shard plunged into the root-sea, the eldest weaver swallowed its fallen fire whole. Cultists who worship in the silk-choked grottoes call her Arachne, Broodmother of Ten Thousand Eyes. Her webs snare memory as readily as bone; heroes trapped in her cocoons whisper childhood prayers for centuries while feeding her clutch.',
  },
  {
    id: 'lore_caverns_03',
    title: 'VI. Last Testament of the Silver Company',
    biome: 'caverns',
    text:
      'Scratched into a corroded buckler beside six dry husks: Beware the iron coffers bound in crimson chains. Greed bade Aldric pry the lock before we cleared the grotto. Instantly the runes shrieked, blood-mist sealed our retreat, and three relentless waves clawed straight out of the stone. Only those who outlast the thirty-bell toll live to claim cursed gold.',
  },

  // ─── Floor III: Infernal Obsidian Forge ('forge') ──────────────────────────
  {
    id: 'lore_forge_01',
    title: 'VII. Anvils of the Chained Titans',
    biome: 'forge',
    text:
      'Long before mortal masons stacked their first keep, primordial titans carved this obsidian caldera to harness the planet’s molten arteries. Every hammer-fall upon these runed anvils still rings with creation-heat fierce enough to fuse demon marrow with black iron—a foundry Malakor seized to arm an immortal vanguard.',
  },
  {
    id: 'lore_forge_02',
    title: 'VIII. Edict of Ignis the Forgemaster',
    biome: 'forge',
    text:
      'I, Ignis, Master Artificer of the Royal Mint, refused to set the Shattered Shards into Malakor’s dread regalia. For my defiance he poured my mortal body into a brazen furnace-hulk and chained my soul to the bellows. Now my own hands hammer weapons of ruin without rest; pray some merciful blade shatters my core and quenches this eternal slag.',
  },
  {
    id: 'lore_forge_03',
    title: 'IX. Tempering Soulsteel in Suffering',
    biome: 'forge',
    text:
      'Artificer’s Margin-Note: Mundane steel dulls against Abyssal hides, yet relics salvaged and tempered upon dungeon anvils drink the condensed gold-essence of slain horrors. Up to the tenth tempering, each strike aligns dormant runes within blade and harness—turning battered heirlooms into instruments worthy of slaying gods.',
  },

  // ─── Floor IV: Astral Void Sanctum ('void') ────────────────────────────────
  {
    id: 'lore_void_01',
    title: 'X. Geometry of the Unmade Sky',
    biome: 'void',
    text:
      'Treatise of High Weaver Seraphina: Beyond the Obsidian Forge, stone surrenders to memory. Stairs of fractured starlight hang above an inverted firmament where dead constellations wheel backward. Do not stare too long past the parapet—the Sanctum is not built inside the Void; the Void is dreaming the Sanctum into shape.',
  },
  {
    id: 'lore_void_02',
    title: 'XI. Malakor’s Apotheosis',
    biome: 'void',
    text:
      'From the Sermon of the Hollow Throne: "Aurelian caged eternity so frightened shepherds might die of fever at sixty winters. I shattered his gilded lie! When the four shards drink the last boundary between star and cavern, grief, age, and hunger shall dissolve together in the Sovereign Silence of the Astral Void."',
  },
  {
    id: 'lore_void_03',
    title: 'XII. Prophecy of the Crownbearer',
    biome: 'void',
    text:
      'The forbidden final verse of the Sunless Codex: "Three oaths converge upon the fractured dais—Juggernaut of Crimson Iron, Phantom of the Obsidian Veil, Weaver of Astral Cataclysm. Whoever strikes Malakor from his throne reclaims the Shattered Crown, yet must forever stand watch where light and nothingness meet."',
  },

  // ─── Map 0: Bastion of the Fallen ('sanctuary') ────────────────────────────
  {
    id: 'lore_sanctuary_01',
    title: 'XIII. Covenant of the Last Bastion',
    biome: 'sanctuary',
    text:
      'When the High Cathedral tore into the earth, veteran mercenaries, exiled smiths, and astral cartographers chained a cliffside promontory directly over the chasm with anchors of blessed cold-iron. They named it the Bastion of the Fallen—a neutral hearth where anvils ring, shared vaults guard ancestral relics, and the Sundial Waypoint pierces every layer of the Rift.',
  },
  {
    id: 'lore_sanctuary_02',
    title: 'XIV. Lexicon of the Twelve Elder Runes',
    biome: 'sanctuary',
    text:
      'Runesmith’s Grimoire: Twelve syllable-stones—Sol through Zod—predate spoken language. Set singly into drilled sockets, a rune lends modest virtue; yet align them in exact ancient meter—Jah-Ist-Ber for Enigma, Mal-Lo for Grief—and the steel awakens with a Runeword loud enough to shake the Void itself.',
  },
  {
    id: 'lore_sanctuary_03',
    title: 'XV. Bonds of Familiar & Crimson Blood',
    biome: 'sanctuary',
    text:
      'No champion endures the deeper strata wholly alone. Spirits of Celestial Owl, Ember Wyrmling, and Void Kitsune bind willingly to heroes at the Menagerie Shrine, darting through battle-smoke to gather fallen gold and runes—while darker souls kneel beside the Blood Altar, offering a quarter of their lifeblood for fleeting, terrifying power.',
  },

  // ─── Floor V: Sunken Cathedral of Rime ('cathedral') ───────────────────────
  {
    id: 'lore_cathedral_01',
    title: 'XVI. Hymn of the Glacial Nave',
    biome: 'cathedral',
    text:
      'Beneath Malakor’s Void-throne lies the true nave of Aurelian’s Grand Cathedral, flash-frozen mid-prayer. Stained glass of sapphire rime refracts howling blizzards across mirror-slick aisles where careless footfalls slide straight into Frost Revenant halberds.',
  },
  {
    id: 'lore_cathedral_02',
    title: 'XVII. Valkyria, Seraph of Eternal Rime',
    biome: 'cathedral',
    text:
      'Valkyria descended on six crystalline wings to quarantine the Abyssal breach, unleashing a winter meant to halt time through sheer cold. Centuries in the dark froze pity within her breast; now the Rime Seraph judges every warm heartbeat a contagion to be impaled upon glacial spears.',
  },
  {
    id: 'lore_cathedral_03',
    title: 'XVIII. Temptation of the Corrupted Obelisks',
    biome: 'cathedral',
    text:
      'Three blood-lit glyphs flare whenever a hand nears a Corrupted Obelisk. Every pact exacts its toll—brittle bones or an instant ambush of Elite horrors—in exchange for storm-chained criticals and bottomless fortune. Wise hunters read the curse twice before signing in frost.',
  },

  // ─── Floor VI: Clockwork Astral Observatory ('observatory') ────────────────
  {
    id: 'lore_observatory_01',
    title: 'XIX. Gears of the Inverted Firmament',
    biome: 'observatory',
    text:
      'At the deepest nadir of the Rift stands an impossible planetarium of brushed celestial brass. Twin teleporter rings hum in sympathetic resonance across chasms of spinning escapement wheels, built to measure the exact heartbeat before creation began.',
  },
  {
    id: 'lore_observatory_02',
    title: 'XX. Chronos, Architect of the Astral Loom',
    biome: 'observatory',
    text:
      'Before Malakor wore flesh, Chronos tended the Astral Loom. Seeing every timeline end in ash, the Architect replaced his own ribcage with an hourglass of star-sand and locked Floor Six behind sweeping chronal beams—determined to rewind any mortal defiant enough to challenge fate.',
  },
  {
    id: 'lore_observatory_03',
    title: 'XXI. Treatise on Elemental Convergence',
    biome: 'observatory',
    text:
      'Archmage’s Marginalia: Elements do not merely wound—they react. Hammer rime-chilled armor to Shatter crystal shrapnel; touch flame to virulent venom for a Volatile Blast; arc lightning across frost to Superconduct resistance away; or collide Void with fire to collapse an Abyssal Singularity.',
  },

  // ─── Endgame Arena: Crimson Bloodhunt Colosseum ('colosseum') ──────────────
  {
    id: 'lore_colosseum_01',
    title: 'XXII. Edict of the Undying Sands',
    biome: 'colosseum',
    text:
      'Carved inside a pocket of crimson limbo, the Bloodhunt Colosseum knows neither truce nor retreat. Twenty escalating waves of abyssal gladiators answer the war-horn, culminating in twin-boss showdowns where fallen sovereigns fight side by side for the crowd’s roar.',
  },
  {
    id: 'lore_colosseum_02',
    title: 'XXIII. Legend of the Cleaver in the Dark',
    biome: 'colosseum',
    text:
      'Veteran’s Warning: Should dungeon torches gutter to blood-moon crimson and iron chains drag across the stone, run—or ready your parry ward. The Butcher hunts by scent of wounded heroes, roaring "FRESH MEAT!" before hurling his meat-hook, yet those who fell him claim Mythic Primal steel.',
  },
  {
    id: 'lore_colosseum_03',
    title: 'XXIV. Apotheosis of the Awakened Archon',
    biome: 'colosseum',
    text:
      'Scroll of the Final Trial: When righteous fury overflows its vessel, mortal limits burn away. Four wings of living starlight unfurl beneath a Sovereign Halo—an Awakened Archon whose every parry rings like a cathedral bell and whose execution strike cleaves staggered titans in two.',
  },
];

export function buildLoreCodex(unlockedIds: ReadonlySet<string>): LoreEntry[] {
  return LORE_CODEX_DEFINITIONS.map((def) => ({
    id: def.id,
    title: def.title,
    biome: def.biome,
    text: def.text,
    unlocked: unlockedIds.has(def.id),
  }));
}
