import { describe, expect, it, vi } from 'vitest';
import type {
  EnemyEntity,
  EquipSlot,
  ILootSystem,
  ItemInstance,
  ItemRarity,
  PlayerRuntimeState,
  RuneId,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { ALL_RUNE_IDS, RunewordSystem, createRunewordSystem } from './index';

function makeTestItem(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    id: overrides.id ?? 'itm_test_1',
    name: overrides.name ?? 'Obsidian Plate',
    slot: overrides.slot ?? 'chest',
    rarity: overrides.rarity ?? 'epic',
    levelReq: overrides.levelReq ?? 5,
    itemLevel: overrides.itemLevel ?? 8,
    upgradeLevel: overrides.upgradeLevel ?? 0,
    affixes: overrides.affixes ?? [{ label: 'Armor', statKey: 'armor', value: 25 }],
    goldValue: overrides.goldValue ?? 120,
    icon: overrides.icon ?? '🧥',
    ...overrides,
  };
}

function makeTestEnemy(overrides: Partial<EnemyEntity> = {}): EnemyEntity {
  return {
    id: overrides.id ?? 'enemy_1',
    name: overrides.name ?? 'Skeleton Warrior',
    archetype: overrides.archetype ?? 'skeleton_warrior',
    isBoss: overrides.isBoss ?? false,
    isElite: overrides.isElite ?? false,
    affixes: overrides.affixes ?? [],
    position: overrides.position ?? { x: 4, y: 0, z: 4 },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    radius: 0.5,
    hp: 100,
    maxHp: 100,
    armor: 10,
    moveSpeed: 3.5,
    attackDamage: 12,
    damageType: 'physical',
    attackRange: 1.5,
    attackCooldownSec: 1.2,
    xpReward: 25,
    lootTierBonus: overrides.lootTierBonus ?? 0,
    statuses: [],
    alive: true,
    roomId: 'room_1',
  };
}

function makeTestPlayer(hp = 200, alive = true): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'Kaelen',
    level: 10,
    xp: 0,
    xpToNextLevel: 500,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { x: 10, y: 0, z: 12 },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.45,
    hp,
    mana: 100,
    stamina: 100,
    baseAttributes: { strength: 20, dexterity: 12, intelligence: 10, vitality: 18 },
    stats: {
      maxHp: 320,
      hpRegen: 3,
      maxMana: 100,
      manaRegen: 4,
      maxStamina: 100,
      staminaRegen: 20,
      moveSpeed: 6.5,
      attackPower: 50,
      spellPower: 25,
      armor: 60,
      critChance: 0.1,
      critMultiplier: 1.6,
      attackSpeed: 1.1,
      cooldownReduction: 0.05,
      lifeSteal: 0,
      dodgeChance: 0.05,
    },
    statuses: [],
    isDodging: false,
    invulnerableSec: 0,
    alive,
    healthPotions: 3,
    maxHealthPotions: 5,
    potionCooldownSec: 0,
    gold: 2000,
    floorsCleared: 3,
    killsTotal: 75,
  };
}

function makeMockLootSystem(withOptionalHelpers = false): ILootSystem {
  const inventory: ItemInstance[] = [];
  let seq = 0;

  const base: ILootSystem = {
    init: () => {},
    generateItem: (itemLevel: number, forcedRarity?: ItemRarity, forcedSlot?: EquipSlot) => {
      seq += 1;
      const slot = forcedSlot ?? 'weapon';
      const rarity = forcedRarity ?? 'rare';
      return makeTestItem({
        id: `gambled_${seq}`,
        name: `${rarity.toUpperCase()} Blade ${seq}`,
        slot,
        rarity,
        itemLevel,
        weaponVisual: slot === 'weapon' ? 'greatsword' : undefined,
        affixes: [
          { label: 'Attack Power', statKey: 'attackPower', value: 20 + itemLevel * 2 },
          { label: 'Crit Chance', statKey: 'critChance', value: 0.06, isPercent: true },
        ],
        goldValue: 80 + itemLevel * 15,
      });
    },
    spawnEnemyLoot: () => [],
    spawnChestLoot: () => [],
    getGroundDrops: () => [],
    pickupDrop: () => ({ picked: null }),
    getInventory: () => inventory,
    getEquipped: () => ({}),
    equipItem: () => false,
    unequipSlot: () => false,
    salvageItem: () => ({ goldGained: 0 }),
    upgradeItem: () => ({ success: false, cost: 0, newUpgradeLevel: 0 }),
    computeEquipmentBonuses: () => ({
      attributes: {},
      stats: {},
      weaponVisual: 'greatsword',
    }),
    serialize: () => ({ inventory: [...inventory], equipped: {} }),
    deserialize: () => {},
    update: () => {},
    clearGroundDrops: () => {},
    dispose: () => {},
  };

  if (withOptionalHelpers) {
    base.generateMythicItem = (itemLevel: number, forcedSlot?: EquipSlot) => {
      seq += 1;
      return makeTestItem({
        id: `mythic_${seq}`,
        name: `Primal Doombringer ${seq}`,
        slot: forcedSlot ?? 'weapon',
        rarity: 'legendary',
        isMythic: true,
        itemLevel,
        affixes: [{ label: 'Primal Power', statKey: 'attackPower', value: 95 }],
        goldValue: 900,
      });
    };
    base.addDirectItemToInventory = (item: ItemInstance) => {
      if (inventory.length >= 40) return false;
      inventory.push(item);
      return true;
    };
  }

  return base;
}

describe('RunewordSystem', () => {
  it('defines all 12 Ancient Runes across Tiers 1-3 with distinct colors, icons, and socket bonuses', () => {
    const sys = createRunewordSystem();
    const defs = sys.getRuneDefinitions();

    expect(defs).toHaveLength(12);

    const expectedIds: RuneId[] = [
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
    ];
    const ids = defs.map((d) => d.id);
    for (const id of expectedIds) {
      expect(ids).toContain(id);
    }

    const tiers = new Set(defs.map((d) => d.tier));
    expect(tiers.has(1)).toBe(true);
    expect(tiers.has(2)).toBe(true);
    expect(tiers.has(3)).toBe(true);

    const colors = new Set(defs.map((d) => d.colorHex));
    const icons = new Set(defs.map((d) => d.icon));
    expect(colors.size).toBe(12);
    expect(icons.size).toBe(12);

    for (const def of defs) {
      expect(def.statBonus.value).toBeGreaterThan(0);
      expect(def.statBonus.label.length).toBeGreaterThan(0);
    }
  });

  it('rolls higher rune drop rates on Elites, Bosses, Treasure Goblins, and The Butcher than normal foes', () => {
    const sys = new RunewordSystem(424242);
    const trials = 400;

    const normal = makeTestEnemy({ archetype: 'skeleton_warrior', isElite: false, isBoss: false });
    const elite = makeTestEnemy({ archetype: 'void_assassin', isElite: true, isBoss: false });
    const boss = makeTestEnemy({ archetype: 'malakor_void_emperor', isBoss: true });
    const goblin = makeTestEnemy({ archetype: 'treasure_goblin' });
    const butcher = makeTestEnemy({ archetype: 'the_butcher', isBoss: true });

    let normalDrops = 0;
    let eliteDrops = 0;
    let bossDrops = 0;
    let goblinDrops = 0;
    let butcherDrops = 0;

    for (let i = 0; i < trials; i++) {
      if (sys.rollEnemyRuneDrop(normal, 3)) normalDrops++;
      if (sys.rollEnemyRuneDrop(elite, 3)) eliteDrops++;
      if (sys.rollEnemyRuneDrop(boss, 4)) bossDrops++;
      if (sys.rollEnemyRuneDrop(goblin, 3)) goblinDrops++;
      const butcherRune = sys.rollEnemyRuneDrop(butcher, 5);
      if (butcherRune) {
        expect(ALL_RUNE_IDS).toContain(butcherRune);
        butcherDrops++;
      }
    }

    expect(butcherDrops).toBe(trials);
    expect(goblinDrops).toBeGreaterThan(eliteDrops);
    expect(bossDrops).toBeGreaterThan(eliteDrops);
    expect(eliteDrops).toBeGreaterThan(normalDrops * 2);
  });

  it('drills up to 3-4 sockets on weapons/chest/helm/offhand and enforces gold & max-socket limits', () => {
    const sys = new RunewordSystem(1337);
    const weapon = makeTestItem({ slot: 'weapon', sockets: 0, itemLevel: 5 });
    const helm = makeTestItem({ slot: 'helmet', sockets: 0, itemLevel: 5 });

    // Insufficient gold fails cleanly
    const brokeAttempt = sys.addSocketToItem(weapon, 5);
    expect(brokeAttempt.success).toBe(false);
    expect(brokeAttempt.cost).toBeGreaterThan(5);
    expect(weapon.sockets).toBe(0);

    // Drill weapon up to 4 sockets
    for (let expected = 1; expected <= 4; expected++) {
      const res = sys.addSocketToItem(weapon, 5000);
      expect(res.success).toBe(true);
      expect(res.maxSockets).toBe(4);
      expect(weapon.sockets).toBe(expected);
    }
    const fifthAttempt = sys.addSocketToItem(weapon, 5000);
    expect(fifthAttempt.success).toBe(false);
    expect(weapon.sockets).toBe(4);

    // Drill helmet up to 3 sockets
    for (let expected = 1; expected <= 3; expected++) {
      const res = sys.addSocketToItem(helm, 5000);
      expect(res.success).toBe(true);
      expect(res.maxSockets).toBe(3);
      expect(helm.sockets).toBe(expected);
    }
    expect(sys.addSocketToItem(helm, 5000).success).toBe(false);
  });

  it('defines all 8 Legendary Runewords, forges exact ordered patterns, emits event:runewordForged, and unsockets cleanly', () => {
    const sys = new RunewordSystem(9001);
    const recipes = sys.getRunewordRecipes();
    expect(recipes).toHaveLength(8);

    const names = recipes.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Enigma',
        'Grief',
        'Infinity',
        'Breath of the Dying',
        'Call to Arms',
        'Chains of Honor',
        'Heart of the Oak',
        'Obsidian Eclipse',
      ]),
    );

    const chest = makeTestItem({ id: 'chest_enigma', slot: 'chest', sockets: 3 });
    sys.grantRune('jah', 2);
    sys.grantRune('ist', 2);
    sys.grantRune('ber', 2);

    const forgedSpy = vi.fn();
    const unsub = eventBus.on('event:runewordForged', forgedSpy);

    try {
      // Wrong order ['ist', 'jah', 'ber'] must NOT forge Enigma
      expect(sys.socketRuneIntoItem(chest, 'ist').formedRuneword).toBeUndefined();
      expect(sys.socketRuneIntoItem(chest, 'jah').formedRuneword).toBeUndefined();
      expect(sys.socketRuneIntoItem(chest, 'ber').formedRuneword).toBeUndefined();
      expect(chest.runewordId).toBeUndefined();
      expect(forgedSpy).not.toHaveBeenCalled();

      // Unsocket refunds all 3 runes back to inventory
      const refunded = sys.unsocketRunesFromItem(chest);
      expect(refunded).toEqual(['ist', 'jah', 'ber']);
      expect(sys.getOwnedRunes().jah).toBe(2);
      expect(sys.getOwnedRunes().ist).toBe(2);
      expect(sys.getOwnedRunes().ber).toBe(2);

      // Exact order ['jah', 'ist', 'ber'] on chest forges Enigma!
      expect(sys.socketRuneIntoItem(chest, 'jah').success).toBe(true);
      expect(sys.socketRuneIntoItem(chest, 'ist').success).toBe(true);
      const finalRes = sys.socketRuneIntoItem(chest, 'ber');

      expect(finalRes.success).toBe(true);
      expect(finalRes.formedRuneword?.id).toBe('enigma');
      expect(chest.runewordId).toBe('enigma');
      expect(chest.runewordName).toBe('Enigma');
      expect(forgedSpy).toHaveBeenCalledTimes(1);
      expect(forgedSpy).toHaveBeenCalledWith({
        runewordName: 'Enigma',
        item: chest,
      });

      // Verify Grief ['mal', 'lo'] on a 4-socket weapon and breaking pattern on extra rune
      const sword = makeTestItem({ id: 'sword_grief', slot: 'weapon', sockets: 4 });
      sys.grantRune('mal', 1);
      sys.grantRune('lo', 1);
      sys.grantRune('sol', 1);

      sys.socketRuneIntoItem(sword, 'mal');
      const griefRes = sys.socketRuneIntoItem(sword, 'lo');
      expect(griefRes.formedRuneword?.name).toBe('Grief');
      expect(sword.runewordId).toBe('grief');

      // Socketing a 3rd non-matching rune clears Grief
      sys.socketRuneIntoItem(sword, 'sol');
      expect(sword.runewordId).toBeUndefined();
      expect(sword.runewordName).toBeUndefined();
    } finally {
      unsub();
    }
  });

  it('activates 2-piece and 4-piece Class Item Set bonuses alongside Runeword & Rune socket stats', () => {
    const sys = new RunewordSystem(777);
    const sets = sys.getItemSets();
    expect(sets).toHaveLength(3);
    expect(sets.map((s) => s.name)).toEqual([
      'Battlegear of the Immortal King',
      'Vestments of the Nightstalker',
      'Regalia of the Astral Archon',
    ]);

    // Deterministic assignItemSetOrSockets check across seeds
    let rolledSocketsCount = 0;
    let rolledSetsCount = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sample = makeTestItem({
        id: `sample_${seed}`,
        slot: 'chest',
        rarity: 'legendary',
        sockets: undefined,
      });
      sys.assignItemSetOrSockets(sample, seed * 9973);
      if ((sample.sockets ?? 0) > 0) rolledSocketsCount++;
      if (sample.setId) rolledSetsCount++;
    }
    expect(rolledSocketsCount).toBeGreaterThan(5);
    expect(rolledSetsCount).toBeGreaterThan(5);

    // Equip 1 piece -> no set bonus active yet
    const ikHelm = makeTestItem({
      slot: 'helmet',
      setId: 'immortal_king',
      setName: 'Battlegear of the Immortal King',
    });
    const onePc = sys.computeRunewordAndSetBonuses({ helmet: ikHelm });
    expect(onePc.activeSets).toHaveLength(0);
    expect(onePc.stats.maxHp).toBeUndefined();

    // Equip 2 pieces -> 2-piece Immortal King bonus active (+140 HP, +55 Armor, +5.0 HP Regen)
    const ikGloves = makeTestItem({
      slot: 'gloves',
      setId: 'immortal_king',
      setName: 'Battlegear of the Immortal King',
    });
    const twoPc = sys.computeRunewordAndSetBonuses({
      helmet: ikHelm,
      gloves: ikGloves,
    });
    expect(twoPc.activeSets).toHaveLength(1);
    expect(twoPc.activeSets[0].pieces).toBe(2);
    expect(twoPc.stats.maxHp).toBe(140);
    expect(twoPc.stats.armor).toBe(55);

    // Equip 4 pieces + Grief weapon ('mal' + 'lo') -> 2pc + 4pc + rune + runeword bonuses!
    const ikBoots = makeTestItem({
      slot: 'boots',
      setId: 'immortal_king',
      setName: 'Battlegear of the Immortal King',
    });
    const ikChest = makeTestItem({
      slot: 'chest',
      setId: 'immortal_king',
      setName: 'Battlegear of the Immortal King',
    });
    const griefWeapon = makeTestItem({ slot: 'weapon', sockets: 2 });
    sys.grantRune('mal', 1);
    sys.grantRune('lo', 1);
    sys.socketRuneIntoItem(griefWeapon, 'mal');
    sys.socketRuneIntoItem(griefWeapon, 'lo');

    const fourPcAndRw = sys.computeRunewordAndSetBonuses({
      helmet: ikHelm,
      gloves: ikGloves,
      boots: ikBoots,
      chest: ikChest,
      weapon: griefWeapon,
    });

    expect(fourPcAndRw.activeSets[0].pieces).toBe(4);
    expect(fourPcAndRw.activeRunewords).toContain('grief');
    // 140 (IK 2pc) + 45 (Mal rune) = 185 maxHp
    expect(fourPcAndRw.stats.maxHp).toBe(185);
    // 48 (IK 4pc) + 42 (Grief bonus) = 90 attackPower
    expect(fourPcAndRw.stats.attackPower).toBe(90);
    // Lo rune (+0.05 critChance)
    expect(fourPcAndRw.stats.critChance).toBeCloseTo(0.05, 4);
  });

  it('gambles mystery items including Mythic Primal Crimson jackpots and activates Blood Altar boons', () => {
    const sys = new RunewordSystem(20261124);
    const lootFallback = makeMockLootSystem(false);
    const lootWithHelpers = makeMockLootSystem(true);

    // Insufficient gold fails
    expect(sys.gambleMysteryItem(10, 20, lootFallback).success).toBe(false);

    // Roll multiple gambles to confirm Mythic Primal Crimson items appear and enter inventory
    let mythicCount = 0;
    for (let i = 0; i < 35; i++) {
      const targetLoot = i % 2 === 0 ? lootFallback : lootWithHelpers;
      const res = sys.gambleMysteryItem(12, 5000, targetLoot, 'weapon');
      expect(res.success).toBe(true);
      expect(res.cost).toBeGreaterThan(0);
      expect(res.item?.slot).toBe('weapon');
      if (res.item?.isMythic) {
        mythicCount++;
        expect(res.item.rarity).toBe('legendary');
      }
    }
    expect(mythicCount).toBeGreaterThanOrEqual(1);
    expect(
      lootFallback.getInventory().length + lootWithHelpers.getInventory().length,
    ).toBe(35);

    // Blood Altar sacrifices 25% current HP and grants floor-wide boons
    const player = makeTestPlayer(200, true);
    const altarRes = sys.activateBloodAltar(player);
    expect(altarRes.success).toBe(true);
    expect(altarRes.boon).toBeDefined();
    expect(altarRes.boon?.hpSacrificePercent).toBe(25);
    expect(player.hp).toBe(150);
    expect(sys.getActiveBloodBoons()).toHaveLength(1);

    const boonStats = sys.computeRunewordAndSetBonuses({}).stats;
    expect(Object.keys(boonStats).length).toBeGreaterThan(0);

    // Clear floor boons removes temporary altar buffs
    sys.clearFloorBoons();
    expect(sys.getActiveBloodBoons()).toHaveLength(0);
    expect(Object.keys(sys.computeRunewordAndSetBonuses({}).stats)).toHaveLength(0);

    // Dead or 1-HP player cannot sacrifice at Blood Altar
    expect(sys.activateBloodAltar(makeTestPlayer(1, true)).success).toBe(false);
    expect(sys.activateBloodAltar(makeTestPlayer(100, false)).success).toBe(false);
  });

  it('serializes and deserializes owned runes accurately', () => {
    const sys = createRunewordSystem();
    sys.grantRune('ber', 3);
    sys.grantRune('jah', 1);
    sys.grantRune('zod', 2);

    const saved = sys.serialize();
    expect(saved.runes.ber).toBe(3);
    expect(saved.runes.jah).toBe(1);
    expect(saved.runes.zod).toBe(2);
    expect(saved.runes.sol).toBe(0);

    const restored = createRunewordSystem();
    restored.deserialize(saved);
    expect(restored.getOwnedRunes()).toEqual(saved.runes);

    // Resilient against empty/undefined payload
    restored.deserialize(undefined);
    expect(restored.getOwnedRunes().ber).toBe(0);
  });
});
