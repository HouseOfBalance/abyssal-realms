import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type {
  EnemyEntity,
  EquipSlot,
  GroundLootDrop,
  ItemRarity,
  PlayerRuntimeState,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import {
  ALL_EQUIP_SLOTS,
  ALL_RARITIES,
  ALL_WEAPON_VISUALS,
  LootSystem,
  MAX_INVENTORY_SLOTS,
  MAX_UPGRADE_LEVEL,
  NAMED_LEGENDARIES,
  createLootSystem,
} from './index';

function makeMockPlayer(overrides: Partial<PlayerRuntimeState> = {}): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'TestHero',
    level: 5,
    xp: 0,
    xpToNextLevel: 500,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.5,
    hp: 60,
    mana: 50,
    stamina: 100,
    baseAttributes: { strength: 16, dexterity: 9, intelligence: 7, vitality: 15 },
    stats: {
      maxHp: 150,
      hpRegen: 2,
      maxMana: 80,
      manaRegen: 3,
      maxStamina: 100,
      staminaRegen: 15,
      moveSpeed: 6.5,
      attackPower: 20,
      spellPower: 10,
      armor: 25,
      critChance: 0.05,
      critMultiplier: 1.5,
      attackSpeed: 1,
      cooldownReduction: 0,
      lifeSteal: 0,
      dodgeChance: 0.05,
    },
    statuses: [],
    isDodging: false,
    invulnerableSec: 0,
    alive: true,
    healthPotions: 2,
    maxHealthPotions: 5,
    potionCooldownSec: 0,
    gold: 500,
    floorsCleared: 0,
    killsTotal: 0,
    ...overrides,
  };
}

function makeMockBoss(): EnemyEntity {
  return {
    id: 'boss_1',
    name: 'Bone Colossus',
    archetype: 'bone_colossus',
    isBoss: true,
    isElite: true,
    affixes: [],
    position: { x: 2, y: 0, z: 2 },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    radius: 1.5,
    hp: 0,
    maxHp: 2500,
    armor: 50,
    moveSpeed: 4,
    attackDamage: 40,
    damageType: 'physical',
    attackRange: 3,
    attackCooldownSec: 2,
    xpReward: 500,
    lootTierBonus: 3,
    statuses: [],
    alive: false,
    roomId: 'boss_room',
  };
}

describe('LootSystem & Procedural Itemizer', () => {
  it('defines 12 handcrafted Named Legendaries across all 8 slots and 5 weapon visuals', () => {
    expect(NAMED_LEGENDARIES).toHaveLength(12);

    const legendarySlots = new Set<EquipSlot>(NAMED_LEGENDARIES.map((l) => l.slot));
    for (const slot of ALL_EQUIP_SLOTS) {
      expect(legendarySlots.has(slot)).toBe(true);
    }

    const legendaryWeapons = new Set<WeaponVisualType>(
      NAMED_LEGENDARIES.filter((l) => l.weaponVisual).map((l) => l.weaponVisual!),
    );
    for (const vis of ALL_WEAPON_VISUALS) {
      expect(legendaryWeapons.has(vis)).toBe(true);
    }

    const names = NAMED_LEGENDARIES.map((l) => l.name);
    expect(names).toContain('Crown of the Shattered King');
    expect(names).toContain('Soulreaver Greatsword');
    expect(names).toContain('Whispering Voidfangs');
    expect(names).toContain('Astral Nexus Staff');
  });

  it('generates valid items across all 5 rarities and 8 slots with monotonic affix scaling', () => {
    const loot = createLootSystem();

    for (const rarity of ALL_RARITIES) {
      for (const slot of ALL_EQUIP_SLOTS) {
        const low = loot.generateItem(1, rarity, slot);
        const high = loot.generateItem(12, rarity, slot);

        expect(low.rarity).toBe(rarity);
        expect(low.slot).toBe(slot);
        expect(high.goldValue).toBeGreaterThan(low.goldValue);
        expect(low.affixes.length).toBeGreaterThanOrEqual(1);

        if (slot === 'weapon') {
          expect(ALL_WEAPON_VISUALS).toContain(low.weaponVisual);
        } else {
          expect(low.weaponVisual).toBeUndefined();
        }

        if (rarity === 'legendary') {
          expect(low.legendaryPower?.id).toBeTruthy();
          expect(low.legendaryPower?.description.length).toBeGreaterThan(15);
        }
      }
    }

    // Verify affix counts and average stat budgets scale monotonically by rarity and itemLevel
    const rarityOrder: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    for (let i = 1; i < rarityOrder.length; i++) {
      const prev = loot.generateItem(6, rarityOrder[i - 1], 'chest');
      const curr = loot.generateItem(6, rarityOrder[i], 'chest');
      expect(curr.affixes.length).toBeGreaterThan(prev.affixes.length);
      expect(curr.goldValue).toBeGreaterThan(prev.goldValue);
    }

    for (const rarity of rarityOrder) {
      let avgLow = 0;
      let avgHigh = 0;
      const samples = 16;
      for (let s = 0; s < samples; s++) {
        const slot = ALL_EQUIP_SLOTS[s % ALL_EQUIP_SLOTS.length];
        const lowItem = loot.generateItem(1, rarity, slot);
        const highItem = loot.generateItem(10, rarity, slot);
        avgLow += lowItem.affixes.reduce((sum, a) => sum + (a.isPercent ? a.value * 150 : a.value), 0);
        avgHigh += highItem.affixes.reduce((sum, a) => sum + (a.isPercent ? a.value * 150 : a.value), 0);
      }
      expect(avgHigh).toBeGreaterThan(avgLow);
    }
  });

  it('initializes starter gear, manages 40-slot cap, equip/unequip swap, salvage, and +12%/lvl upgrades', () => {
    const loot = new LootSystem(42);
    const equipped = loot.getEquipped();
    expect(equipped.weapon).toBeDefined();
    expect(equipped.chest).toBeDefined();
    expect(equipped.boots).toBeDefined();
    expect(loot.getInventory()).toHaveLength(0);

    const bonuses0 = loot.computeEquipmentBonuses();
    expect(bonuses0.weaponVisual).toBe('greatsword');
    expect((bonuses0.stats.armor ?? 0)).toBeGreaterThan(0);

    // Generate a Legendary Staff, place into inventory via chest/deserialize, equip swap
    const staff = loot.generateItem(8, 'legendary', 'weapon');
    loot.getInventory().push(staff);
    expect(loot.equipItem(staff.id)).toBe(true);
    expect(loot.getEquipped().weapon?.id).toBe(staff.id);
    // Old starter weapon swapped into inventory
    expect(loot.getInventory()).toHaveLength(1);

    // Upgrade from +0 to +10 (+12% per level)
    const baseFirstAffix = staff.affixes[0].value;
    for (let step = 1; step <= MAX_UPGRADE_LEVEL; step++) {
      const res = loot.upgradeItem(staff.id, 999999);
      expect(res.success).toBe(true);
      expect(res.newUpgradeLevel).toBe(step);
      expect(staff.affixes[0].value).toBeCloseTo(baseFirstAffix * (1 + 0.12 * step), 2);
    }
    // Cannot upgrade past +10
    expect(loot.upgradeItem(staff.id, 999999).success).toBe(false);

    // Salvage starter weapon in inventory
    const starterId = loot.getInventory()[0].id;
    const { goldGained } = loot.salvageItem(starterId);
    expect(goldGained).toBeGreaterThan(0);
    expect(loot.getInventory()).toHaveLength(0);

    // Fill 40-slot inventory and check unequip & pickup cap enforcement
    for (let i = 0; i < MAX_INVENTORY_SLOTS; i++) {
      loot.getInventory().push(loot.generateItem(2, 'common', 'ring'));
    }
    expect(loot.unequipSlot('weapon')).toBe(false);

    // Serialize & deserialize preserves state cleanly
    const saved = loot.serialize();
    const restored = createLootSystem();
    restored.deserialize(saved);
    expect(restored.getInventory()).toHaveLength(MAX_INVENTORY_SLOTS);
    expect(restored.getEquipped().weapon?.id).toBe(staff.id);
    expect(restored.getEquipped().weapon?.upgradeLevel).toBe(MAX_UPGRADE_LEVEL);
  });

  it('renders 3D ground drops with Diablo light pillars and magnet-pulls gold & health orbs', () => {
    const scene = new THREE.Scene();
    const loot = createLootSystem();
    loot.init(scene);

    const bossDrops = loot.spawnEnemyLoot(makeMockBoss(), 3);
    expect(bossDrops.length).toBeGreaterThanOrEqual(6);
    expect(bossDrops.some((d) => d.kind === 'item' && d.item?.rarity === 'legendary')).toBe(true);
    expect(scene.children.length).toBe(1);

    // Place player within magnet radius of drops and simulate frames
    const player = makeMockPlayer({ position: { x: 2, y: 0, z: 2 }, hp: 50, gold: 100 });
    for (let i = 0; i < 40; i++) {
      loot.update(0.05, i * 0.05, player);
    }

    // Gold and health orbs should have been magnetized and collected automatically
    expect(player.gold).toBeGreaterThan(100);
    expect(player.hp).toBeGreaterThan(50);

    loot.clearGroundDrops();
    expect(loot.getGroundDrops()).toHaveLength(0);
    loot.dispose();
  });

  it('uses custom GLSL ShaderMaterial aurora pillars and flies pickups along a ~0.30s Bezier homing spiral', () => {
    const scene = new THREE.Scene();
    const loot = createLootSystem();
    loot.init(scene);

    const startedEvents: Array<{ drop: GroundLootDrop; fromPos: Vec3 }> = [];
    const completedEvents: Array<{ drop: GroundLootDrop; screenStart?: Vec3 }> = [];
    const gearEvents: string[] = [];

    const offStart = eventBus.on('loot:pickupStarted', (ev) => startedEvents.push(ev));
    const offDone = eventBus.on('loot:pickedUp', (ev) => completedEvents.push(ev));
    const offGear = eventBus.on('hero:gearChanged', (ev) => gearEvents.push(String(ev.slot)));

    try {
      const drops = loot.spawnChestLoot({ x: 5, y: 0, z: 5 }, 4, true);
      const legendaryOrEpicDrop = drops.find(
        (d) =>
          d.kind === 'item' &&
          (d.item?.rarity === 'legendary' ||
            d.item?.rarity === 'epic' ||
            d.item?.rarity === 'rare'),
      );
      expect(legendaryOrEpicDrop).toBeDefined();

      // Verify custom GLSL ShaderMaterial is attached on Rare/Epic/Legendary pillar meshes
      const container = scene.children[0] as THREE.Group;
      let shaderMeshCount = 0;
      container.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.ShaderMaterial) {
          shaderMeshCount += 1;
        }
      });
      expect(shaderMeshCount).toBeGreaterThanOrEqual(2);

      const player = makeMockPlayer({ position: { x: 1, y: 0, z: 1 } });

      // Trigger pickup — should emit loot:pickupStarted immediately and keep mesh in 3D homing flight
      const pickRes = loot.pickupDrop(legendaryOrEpicDrop!.id, player);
      expect(pickRes.picked?.id).toBe(legendaryOrEpicDrop!.id);
      expect(startedEvents.some((e) => e.drop.id === legendaryOrEpicDrop!.id)).toBe(true);
      expect(completedEvents.some((e) => e.drop.id === legendaryOrEpicDrop!.id)).toBe(false);

      // Mid-flight (~0.15s) while player sprints to (3, 0, -1): still flying, elevated arc > 1.0
      player.position = { x: 3, y: 0, z: -1 };
      for (let step = 1; step <= 3; step++) {
        loot.update(0.05, step * 0.05, player);
      }
      expect(completedEvents.some((e) => e.drop.id === legendaryOrEpicDrop!.id)).toBe(false);

      // Complete flight (> 0.31s total) -> arrives at live player torso (y + 1.05) and emits loot:pickedUp
      for (let step = 4; step <= 8; step++) {
        loot.update(0.05, step * 0.05, player);
      }
      const arrived = completedEvents.find((e) => e.drop.id === legendaryOrEpicDrop!.id);
      expect(arrived).toBeDefined();
      expect(arrived!.screenStart?.x).toBeCloseTo(3, 1);
      expect(arrived!.screenStart?.y).toBeCloseTo(1.05, 1);
      expect(arrived!.screenStart?.z).toBeCloseTo(-1, 1);

      // Equipping the picked-up item emits hero:gearChanged
      const invItem = loot.getInventory()[0];
      expect(invItem).toBeDefined();
      expect(loot.equipItem(invItem.id)).toBe(true);
      expect(gearEvents).toContain(invItem.slot);
    } finally {
      offStart();
      offDone();
      offGear();
      loot.dispose();
    }
  });

  it('supports Phase 3 Mythic Primal items (6 affixes + crimson-gold pillar), Rune drops, and Shared Stash', () => {
    const scene = new THREE.Scene();
    const loot = new LootSystem(999);
    loot.init(scene);

    // 1. Mythic Primal Crimson items across all 8 slots
    for (const slot of ALL_EQUIP_SLOTS) {
      const mythic = loot.generateMythicItem(12, slot);
      const regularLeg = loot.generateItem(12, 'legendary', slot);
      expect(mythic.isMythic).toBe(true);
      expect(mythic.rarity).toBe('legendary');
      expect(mythic.slot).toBe(slot);
      expect(mythic.affixes).toHaveLength(6);
      expect(mythic.sockets).toBeGreaterThanOrEqual(1);
      expect(mythic.legendaryPower?.id).toBeTruthy();
      expect(mythic.goldValue).toBeGreaterThan(regularLeg.goldValue);
    }

    // Verify Butcher boss drop spawns Mythic Primal Crimson GLSL Light Pillar
    const butcher = { ...makeMockBoss(), id: 'butcher_1', archetype: 'the_butcher' as const };
    const butcherDrops = loot.spawnEnemyLoot(butcher, 5);
    expect(butcherDrops.some((d) => d.kind === 'item' && d.item?.isMythic)).toBe(true);

    // 2. Rune Ground Drops + Bezier Homing Spiral emitting 'rune:pickedUp'
    const runeEvents: string[] = [];
    const offRune = eventBus.on('rune:pickedUp', (ev) => runeEvents.push(ev.runeId));
    try {
      const runeDrop = loot.spawnRuneDrop({ x: 4, y: 0, z: 4 }, 'zod');
      expect(runeDrop.kind).toBe('rune');
      expect(runeDrop.runeId).toBe('zod');

      const player = makeMockPlayer({ position: { x: 2, y: 0, z: 2 } });
      const pickRes = loot.pickupDrop(runeDrop.id, player);
      expect(pickRes.picked?.id).toBe(runeDrop.id);
      expect(runeEvents).toHaveLength(0); // Still flying along ~0.30s Bezier spiral

      for (let step = 0; step < 8; step++) {
        loot.update(0.05, step * 0.05, player);
      }
      expect(runeEvents).toContain('zod');
    } finally {
      offRune();
    }

    // 3. Shared Stash & addDirectItemToInventory + backward-compatible serialize/deserialize
    const customRelic = loot.generateMythicItem(15, 'weapon');
    customRelic.socketedRunes = ['jah', 'ber'];
    customRelic.runewordId = 'rw_enigma_blade';
    customRelic.runewordName = 'Abyssal Sovereign';
    customRelic.setId = 'set_crimson_archon';
    customRelic.setName = 'Panoply of the Crimson Archon';

    expect(loot.addDirectItemToInventory(customRelic)).toBe(true);
    expect(loot.getInventory()).toHaveLength(1);
    expect(loot.depositToStash(customRelic.id)).toBe(true);
    expect(loot.getInventory()).toHaveLength(0);
    expect(loot.getStash()).toHaveLength(1);

    // Serialize WITH stash and restore
    const serializedWithStash = loot.serialize();
    expect(serializedWithStash.stash).toHaveLength(1);

    const restored = new LootSystem(123);
    restored.deserialize(serializedWithStash);
    expect(restored.getStash()).toHaveLength(1);
    expect(restored.withdrawFromStash(customRelic.id)).toBe(true);
    expect(restored.getStash()).toHaveLength(0);
    expect(restored.getInventory()[0].isMythic).toBe(true);
    expect(restored.getInventory()[0].runewordName).toBe('Abyssal Sovereign');
    expect(restored.getInventory()[0].setName).toBe('Panoply of the Crimson Archon');
    expect(restored.getInventory()[0].socketedRunes).toEqual(['jah', 'ber']);

    // Backward-compatible deserialize WITHOUT stash field
    restored.deserialize({
      inventory: serializedWithStash.inventory,
      equipped: serializedWithStash.equipped,
    });
    expect(restored.getStash()).toHaveLength(0);

    loot.dispose();
    restored.dispose();
  });
});
