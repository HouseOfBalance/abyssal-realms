import type * as THREE from 'three';
import type {
  Attributes,
  DerivedStats,
  EnemyEntity,
  EquipSlot,
  GroundLootDrop,
  HeroClassId,
  ILootSystem,
  ItemAffix,
  ItemInstance,
  ItemRarity,
  PlayerRuntimeState,
  RuneId,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import {
  HERO_CLASS_CONFIG,
  MYTHIC_COLOR,
  RARITY_COLORS,
  SeededRng,
  clamp,
  distXZ,
} from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import { t } from '../../core/i18n/index.js';
import { GroundLootRenderer, type ActiveDropEntry } from './GroundLootRenderer';
import { ItemGenerator, MAX_UPGRADE_LEVEL } from './ItemGenerator';
import { ALL_EQUIP_SLOTS, ALL_RUNE_IDS, RUNE_VISUAL_META } from './itemTables';

export const MAX_INVENTORY_SLOTS = 40;
export const MAX_STASH_SLOTS = 60;

const ATTRIBUTE_KEYS = new Set<keyof Attributes>([
  'strength',
  'dexterity',
  'intelligence',
  'vitality',
]);

const MAGNET_RADIUS_GOLD = 4.8;
const MAGNET_RADIUS_ORB = 4.5;
const MAGNET_RADIUS_POTION = 4.0;
const MAGNET_RADIUS_RUNE = 4.2;
const HOMING_LAUNCH_DISTANCE_MAGNET = 2.25;
const AUTO_PICKUP_ITEM_DISTANCE = 1.4;
const ITEM_AUTO_PICKUP_GRACE_SEC = 0.55;

function cloneItem(item: ItemInstance): ItemInstance {
  return {
    id: item.id,
    name: item.name,
    slot: item.slot,
    rarity: item.rarity,
    ...(item.isMythic !== undefined ? { isMythic: item.isMythic } : {}),
    levelReq: item.levelReq,
    itemLevel: item.itemLevel,
    upgradeLevel: item.upgradeLevel,
    ...(item.weaponVisual ? { weaponVisual: item.weaponVisual } : {}),
    affixes: item.affixes.map((a): ItemAffix => ({
      label: a.label,
      statKey: a.statKey,
      value: a.value,
      ...(a.isPercent !== undefined ? { isPercent: a.isPercent } : {}),
    })),
    ...(item.legendaryPower
      ? {
          legendaryPower: {
            id: item.legendaryPower.id,
            description: item.legendaryPower.description,
          },
        }
      : {}),
    ...(item.sockets !== undefined ? { sockets: item.sockets } : {}),
    ...(item.socketedRunes ? { socketedRunes: [...item.socketedRunes] } : {}),
    ...(item.runewordId !== undefined ? { runewordId: item.runewordId } : {}),
    ...(item.runewordName !== undefined ? { runewordName: item.runewordName } : {}),
    ...(item.setId !== undefined ? { setId: item.setId } : {}),
    ...(item.setName !== undefined ? { setName: item.setName } : {}),
    goldValue: item.goldValue,
    icon: item.icon,
  };
}

export class LootSystem implements ILootSystem {
  private generator: ItemGenerator;
  private renderer: GroundLootRenderer;
  private rng: SeededRng;

  private inventory: ItemInstance[] = [];
  private equipped: Partial<Record<EquipSlot, ItemInstance>> = {};
  private stash: ItemInstance[] = [];
  private activeDrops: ActiveDropEntry[] = [];
  private homingEntries: ActiveDropEntry[] = [];

  private dropIdCounter = 0;
  private fallbackWeaponVisual: WeaponVisualType = 'greatsword';
  private starterClassSynced = false;
  private fullInventoryToastCooldownSec = 0;

  constructor(seed = Date.now() ^ 0x517cc1b7) {
    this.rng = new SeededRng(seed);
    this.generator = new ItemGenerator(seed ^ 0x27d4eb2d);
    this.renderer = new GroundLootRenderer();
    this.setupStarterGear('vanguard', false);
  }

  public init(scene: THREE.Scene): void {
    this.renderer.attach(scene);
  }

  /**
   * Initializes class-appropriate starter gear and clears inventory.
   * Shared Stash is preserved across hero runs unless cleared/deserialized.
   */
  public setupStarterGear(heroClass: HeroClassId = 'vanguard', markSynced = true): void {
    this.inventory = [];
    this.equipped = this.generator.createStarterGear(heroClass);
    const classCfg = HERO_CLASS_CONFIG[heroClass] ?? HERO_CLASS_CONFIG.vanguard;
    this.fallbackWeaponVisual = classCfg.startingWeapon;
    this.starterClassSynced = markSynced;
  }

  public generateItem(
    itemLevel: number,
    forcedRarity?: ItemRarity,
    forcedSlot?: EquipSlot,
  ): ItemInstance {
    return this.generator.generateItem(itemLevel, forcedRarity, forcedSlot);
  }

  public generateMythicItem(itemLevel: number, forcedSlot?: EquipSlot): ItemInstance {
    return this.generator.generateMythicItem(itemLevel, forcedSlot);
  }

  private nextDropId(): string {
    this.dropIdCounter += 1;
    return `drop_${this.dropIdCounter}_${Math.floor(this.rng.next() * 0xffff)
      .toString(16)
      .padStart(4, '0')}`;
  }

  private computeScatterPosition(origin: Vec3, index: number, total: number): Vec3 {
    const baseAngle =
      total <= 1
        ? this.rng.range(0, Math.PI * 2)
        : (index / total) * Math.PI * 2 + this.rng.range(-0.28, 0.28);
    const radius = total <= 1 ? this.rng.range(0.25, 0.55) : this.rng.range(0.55, 1.35);
    return {
      x: (Number.isFinite(origin.x) ? origin.x : 0) + Math.cos(baseAngle) * radius,
      y: Number.isFinite(origin.y) ? origin.y : 0,
      z: (Number.isFinite(origin.z) ? origin.z : 0) + Math.sin(baseAngle) * radius,
    };
  }

  private spawnDropBatch(
    origin: Vec3,
    specs: Array<{
      kind: GroundLootDrop['kind'];
      item?: ItemInstance;
      runeId?: RuneId;
      amount?: number;
    }>,
  ): GroundLootDrop[] {
    const result: GroundLootDrop[] = [];
    let playedMythicCue = false;
    let playedLegendaryCue = false;
    let playedRareCue = false;

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const pos = this.computeScatterPosition(origin, i, specs.length);
      const drop: GroundLootDrop = {
        id: this.nextDropId(),
        position: pos,
        kind: spec.kind,
        ...(spec.item ? { item: spec.item } : {}),
        ...(spec.runeId ? { runeId: spec.runeId } : {}),
        ...(spec.amount !== undefined ? { amount: spec.amount } : {}),
        pickedUp: false,
      };

      const entry = this.renderer.createDropEntry(drop, origin, this.rng.next());
      this.activeDrops.push(entry);
      result.push(drop);

      eventBus.emit('loot:dropped', { drop });

      if (spec.kind === 'item' && spec.item) {
        if (spec.item.isMythic && !playedMythicCue) {
          playedMythicCue = true;
          eventBus.emit('sfx:request', { id: 'loot_drop_legendary', position: pos });
          eventBus.emit('lighting:flash', {
            colorHex: MYTHIC_COLOR.hex,
            intensity: 1.85,
            durationSec: 0.45,
          });
        } else if (spec.item.rarity === 'legendary' && !playedLegendaryCue && !playedMythicCue) {
          playedLegendaryCue = true;
          eventBus.emit('sfx:request', { id: 'loot_drop_legendary', position: pos });
          eventBus.emit('lighting:flash', {
            colorHex: RARITY_COLORS.legendary.hex,
            intensity: 1.35,
            durationSec: 0.35,
          });
        } else if (
          (spec.item.rarity === 'epic' || spec.item.rarity === 'rare') &&
          !playedRareCue &&
          !playedLegendaryCue &&
          !playedMythicCue
        ) {
          playedRareCue = true;
          eventBus.emit('sfx:request', { id: 'loot_drop_rare', position: pos });
        }
      } else if (spec.kind === 'rune' && !playedRareCue && !playedLegendaryCue && !playedMythicCue) {
        playedRareCue = true;
        eventBus.emit('sfx:request', { id: 'loot_drop_rare', position: pos });
      }
    }

    return result;
  }

  public spawnRuneDrop(position: Vec3, runeId: RuneId): GroundLootDrop {
    const validRune: RuneId = RUNE_VISUAL_META[runeId] ? runeId : 'sol';
    const [drop] = this.spawnDropBatch(position, [
      {
        kind: 'rune',
        runeId: validRune,
        amount: 1,
      },
    ]);
    return drop;
  }

  private rollContextualRune(floorNumber: number): RuneId {
    const tierMax = floorNumber >= 5 ? 3 : floorNumber >= 3 ? 2 : 1;
    const pool = ALL_RUNE_IDS.filter((id) => RUNE_VISUAL_META[id].tier <= tierMax);
    return this.rng.pick(pool.length > 0 ? pool : ALL_RUNE_IDS);
  }

  public spawnEnemyLoot(enemy: EnemyEntity, floorNumber: number): GroundLootDrop[] {
    const safeFloor = Math.max(1, Math.round(Number.isFinite(floorNumber) ? floorNumber : 1));
    const tierBonus = Number.isFinite(enemy.lootTierBonus) ? enemy.lootTierBonus : 0;
    const baseItemLevel = Math.max(1, safeFloor * 3 - 1 + Math.round(tierBonus));

    const specs: Array<{
      kind: GroundLootDrop['kind'];
      item?: ItemInstance;
      runeId?: RuneId;
      amount?: number;
    }> = [];

    if (enemy.archetype === 'treasure_goblin') {
      // Treasure Goblin jackpot explosion!
      for (let i = 0; i < 5; i++) {
        specs.push({
          kind: 'gold',
          amount: this.rng.int(65, 115) * safeFloor,
        });
      }
      specs.push({ kind: 'potion', amount: 1 });
      specs.push({ kind: 'rune', runeId: this.rollContextualRune(safeFloor + 1), amount: 1 });
      specs.push({
        kind: 'item',
        item:
          this.rng.chance(0.35) || safeFloor >= 5
            ? this.generator.generateMythicItem(baseItemLevel + 2)
            : this.generator.generateItem(baseItemLevel + 2, 'legendary'),
      });
      specs.push({
        kind: 'item',
        item: this.generator.generateItem(baseItemLevel + 1, 'epic'),
      });
      return this.spawnDropBatch(enemy.position, specs);
    }

    if (enemy.archetype === 'chest_mimic') {
      for (let i = 0; i < 3; i++) {
        specs.push({
          kind: 'gold',
          amount: this.rng.int(40, 75) * safeFloor,
        });
      }
      specs.push({ kind: 'health_orb', amount: 25 });
      if (this.rng.chance(0.55)) {
        specs.push({ kind: 'rune', runeId: this.rollContextualRune(safeFloor), amount: 1 });
      }
      specs.push({
        kind: 'item',
        item: this.generator.generateItem(
          baseItemLevel + 1,
          this.rng.chance(0.45) ? 'legendary' : 'epic',
        ),
      });
      return this.spawnDropBatch(enemy.position, specs);
    }

    if (enemy.isBoss) {
      for (let i = 0; i < 3; i++) {
        specs.push({
          kind: 'gold',
          amount: this.rng.int(55, 95) * safeFloor,
        });
      }
      specs.push({ kind: 'health_orb', amount: 30 });
      specs.push({ kind: 'health_orb', amount: 30 });
      specs.push({ kind: 'potion', amount: 1 });

      const dropMythic =
        enemy.archetype === 'the_butcher' ||
        safeFloor >= 5 ||
        (safeFloor >= 3 && this.rng.chance(0.28));

      if (dropMythic) {
        specs.push({
          kind: 'item',
          item: this.generator.generateMythicItem(baseItemLevel + 2),
        });
      }
      specs.push({
        kind: 'item',
        item: this.generator.generateItem(baseItemLevel + 2, 'legendary'),
      });
      specs.push({
        kind: 'item',
        item: this.generator.generateItem(baseItemLevel + 1, 'epic'),
      });
      const bonusRarity = this.generator.rollRarity(baseItemLevel + 1, 3.5, 'rare');
      specs.push({
        kind: 'item',
        item: this.generator.generateItem(baseItemLevel + 1, bonusRarity),
      });
    } else if (enemy.isElite) {
      const goldCount = this.rng.chance(0.5) ? 2 : 1;
      for (let i = 0; i < goldCount; i++) {
        specs.push({
          kind: 'gold',
          amount: this.rng.int(26, 48) * safeFloor,
        });
      }
      if (this.rng.chance(0.65)) {
        specs.push({ kind: 'health_orb', amount: 22 });
      }
      if (this.rng.chance(0.3)) {
        specs.push({ kind: 'potion', amount: 1 });
      }

      if (safeFloor >= 4 && this.rng.chance(0.06)) {
        specs.push({
          kind: 'item',
          item: this.generator.generateMythicItem(baseItemLevel + 1),
        });
      } else {
        const eliteRarity = this.generator.rollRarity(baseItemLevel + 1, 2.5 + tierBonus, 'uncommon');
        specs.push({
          kind: 'item',
          item: this.generator.generateItem(baseItemLevel + 1, eliteRarity),
        });
      }

      if (this.rng.chance(0.45)) {
        const secondRarity = this.generator.rollRarity(baseItemLevel, 1.5 + tierBonus);
        specs.push({
          kind: 'item',
          item: this.generator.generateItem(baseItemLevel, secondRarity),
        });
      }
    } else {
      if (this.rng.chance(0.75)) {
        specs.push({
          kind: 'gold',
          amount: this.rng.int(10, 24) * safeFloor,
        });
      }
      if (this.rng.chance(0.32)) {
        specs.push({ kind: 'health_orb', amount: 18 });
      }
      if (this.rng.chance(0.12)) {
        specs.push({ kind: 'potion', amount: 1 });
      }
      const itemDropChance = clamp(0.28 + tierBonus * 0.08, 0.22, 0.75);
      if (this.rng.chance(itemDropChance)) {
        const rarity = this.generator.rollRarity(baseItemLevel, tierBonus);
        specs.push({
          kind: 'item',
          item: this.generator.generateItem(baseItemLevel, rarity),
        });
      }
    }

    return this.spawnDropBatch(enemy.position, specs);
  }

  public spawnChestLoot(
    position: Vec3,
    floorNumber: number,
    isCursed = false,
  ): GroundLootDrop[] {
    const safeFloor = Math.max(1, Math.round(Number.isFinite(floorNumber) ? floorNumber : 1));
    const baseItemLevel = Math.max(1, safeFloor * 3 + (isCursed ? 2 : 0));

    eventBus.emit('vfx:request', {
      type: 'chest_open',
      position,
      colorHex: isCursed ? 0xff4d6d : 0xffd43b,
      scale: isCursed ? 1.35 : 1.0,
    });
    eventBus.emit('sfx:request', { id: 'chest_open', position });

    const specs: Array<{
      kind: GroundLootDrop['kind'];
      item?: ItemInstance;
      runeId?: RuneId;
      amount?: number;
    }> = [];

    if (isCursed) {
      for (let i = 0; i < 3; i++) {
        specs.push({
          kind: 'gold',
          amount: this.rng.int(42, 80) * safeFloor,
        });
      }
      specs.push({ kind: 'health_orb', amount: 25 });
      specs.push({ kind: 'health_orb', amount: 25 });
      specs.push({ kind: 'potion', amount: 1 });

      if (safeFloor >= 4 && this.rng.chance(0.25)) {
        specs.push({
          kind: 'item',
          item: this.generator.generateMythicItem(baseItemLevel),
        });
      } else {
        const headlineRarity: ItemRarity = this.rng.chance(0.4) ? 'legendary' : 'epic';
        specs.push({
          kind: 'item',
          item: this.generator.generateItem(baseItemLevel, headlineRarity),
        });
      }

      for (let i = 0; i < 2; i++) {
        const extraRarity = this.generator.rollRarity(baseItemLevel, 3.0, 'rare');
        specs.push({
          kind: 'item',
          item: this.generator.generateItem(baseItemLevel, extraRarity),
        });
      }
    } else {
      for (let i = 0; i < 2; i++) {
        specs.push({
          kind: 'gold',
          amount: this.rng.int(20, 46) * safeFloor,
        });
      }
      specs.push({ kind: 'health_orb', amount: 20 });
      if (this.rng.chance(0.5)) {
        specs.push({ kind: 'potion', amount: 1 });
      }

      const mainRarity = this.generator.rollRarity(baseItemLevel, 2.2, 'uncommon');
      specs.push({
        kind: 'item',
        item: this.generator.generateItem(baseItemLevel, mainRarity),
      });
      if (this.rng.chance(0.6)) {
        const secondRarity = this.generator.rollRarity(baseItemLevel, 1.2);
        specs.push({
          kind: 'item',
          item: this.generator.generateItem(baseItemLevel, secondRarity),
        });
      }
    }

    return this.spawnDropBatch(position, specs);
  }

  public getGroundDrops(): GroundLootDrop[] {
    const out: GroundLootDrop[] = [];
    for (let i = 0; i < this.activeDrops.length; i++) {
      const d = this.activeDrops[i].drop;
      if (!d.pickedUp) {
        out.push(d);
      }
    }
    return out;
  }

  private beginHomingArc(entry: ActiveDropEntry): void {
    const fromPos: Vec3 = {
      x: entry.drop.position.x,
      y: entry.drop.position.y,
      z: entry.drop.position.z,
    };
    this.renderer.startHomingFlight(entry, fromPos);
    this.homingEntries.push(entry);
    eventBus.emit('loot:pickupStarted', { drop: entry.drop, fromPos });
  }

  private finalizePickupArrival(entry: ActiveDropEntry, impactWorldPos: Vec3): void {
    const drop = entry.drop;
    this.renderer.removeDropEntry(entry);

    const arrivalPos: Vec3 = {
      x: impactWorldPos.x,
      y: impactWorldPos.y,
      z: impactWorldPos.z,
    };
    drop.position.x = arrivalPos.x;
    drop.position.y = arrivalPos.y;
    drop.position.z = arrivalPos.z;

    eventBus.emit('loot:pickedUp', { drop, screenStart: arrivalPos });

    if (drop.kind === 'item' && drop.item) {
      const isMythic = Boolean(drop.item.isMythic);
      const colorHex = isMythic ? MYTHIC_COLOR.hex : RARITY_COLORS[drop.item.rarity].hex;

      eventBus.emit('vfx:request', {
        type: 'loot_pickup',
        position: arrivalPos,
        colorHex,
        scale: isMythic
          ? 1.75
          : drop.item.rarity === 'legendary'
            ? 1.5
            : drop.item.rarity === 'epic'
              ? 1.25
              : 1.05,
      });
      if (isMythic || drop.item.rarity === 'legendary' || drop.item.rarity === 'epic') {
        eventBus.emit('lighting:flash', {
          colorHex,
          intensity: isMythic ? 1.45 : drop.item.rarity === 'legendary' ? 1.1 : 0.7,
          durationSec: isMythic ? 0.3 : 0.22,
        });
      }
      eventBus.emit('sfx:request', {
        id:
          isMythic || drop.item.rarity === 'legendary'
            ? 'loot_drop_legendary'
            : drop.item.rarity === 'epic' || drop.item.rarity === 'rare'
              ? 'loot_drop_rare'
              : 'ui_equip',
        position: arrivalPos,
      });
      eventBus.emit('ui:toast', {
        message: isMythic
          ? t('loot.pickedUp.mythic', { name: drop.item.name })
          : t('loot.pickedUp.item', { name: drop.item.name }),
        rarity: drop.item.rarity,
      });
    } else if (drop.kind === 'rune') {
      const runeId: RuneId = drop.runeId ?? 'sol';
      const meta = RUNE_VISUAL_META[runeId] ?? RUNE_VISUAL_META.sol;
      eventBus.emit('rune:pickedUp', { runeId, position: arrivalPos });
      eventBus.emit('vfx:request', {
        type: 'loot_pickup',
        position: arrivalPos,
        colorHex: meta.colorHex,
        scale: 1.3,
      });
      eventBus.emit('sfx:request', { id: 'loot_drop_rare', position: arrivalPos });
      eventBus.emit('ui:toast', {
        message: `Acquired ${meta.name}`,
        rarity: meta.tier === 3 ? 'legendary' : meta.tier === 2 ? 'epic' : 'rare',
      });
    } else if (drop.kind === 'gold') {
      eventBus.emit('vfx:request', {
        type: 'loot_pickup',
        position: arrivalPos,
        colorHex: 0xffd43b,
        scale: 0.9,
      });
      eventBus.emit('sfx:request', { id: 'gold_pickup', position: arrivalPos });
    } else if (drop.kind === 'health_orb') {
      const floorPos: Vec3 = {
        x: arrivalPos.x,
        y: Math.max(0, arrivalPos.y - 1.05),
        z: arrivalPos.z,
      };
      eventBus.emit('vfx:request', {
        type: 'heal_aura',
        position: floorPos,
        colorHex: 0xff4d6d,
        scale: 0.95,
      });
      eventBus.emit('sfx:request', { id: 'potion_drink', position: arrivalPos });
    } else if (drop.kind === 'potion') {
      eventBus.emit('vfx:request', {
        type: 'loot_pickup',
        position: arrivalPos,
        colorHex: 0xe03131,
        scale: 0.95,
      });
      eventBus.emit('sfx:request', { id: 'gold_pickup', position: arrivalPos });
      eventBus.emit('ui:toast', { message: '+1 Health Potion', rarity: 'uncommon' });
    }
  }

  public pickupDrop(
    dropId: string,
    player: PlayerRuntimeState,
  ): { picked: GroundLootDrop | null; inventoryFull?: boolean } {
    const idx = this.activeDrops.findIndex(
      (entry) => entry.drop.id === dropId && !entry.drop.pickedUp,
    );
    if (idx === -1) {
      return { picked: null };
    }

    const entry = this.activeDrops[idx];
    const drop = entry.drop;

    if (drop.kind === 'item') {
      if (!drop.item) {
        drop.pickedUp = true;
        this.renderer.removeDropEntry(entry);
        this.activeDrops.splice(idx, 1);
        return { picked: null };
      }

      if (this.inventory.length >= MAX_INVENTORY_SLOTS) {
        if (this.fullInventoryToastCooldownSec <= 0) {
          this.fullInventoryToastCooldownSec = 2.5;
          eventBus.emit('ui:toast', {
            message: `Inventory Full (${MAX_INVENTORY_SLOTS}/${MAX_INVENTORY_SLOTS})! Salvage or Stash gear.`,
            rarity: 'common',
          });
        }
        return { picked: null, inventoryFull: true };
      }

      this.starterClassSynced = true;
      this.inventory.push(drop.item);
      drop.pickedUp = true;
      this.activeDrops.splice(idx, 1);
      this.beginHomingArc(entry);
      return { picked: drop, inventoryFull: false };
    }

    if (drop.kind === 'rune') {
      drop.pickedUp = true;
      this.activeDrops.splice(idx, 1);
      this.beginHomingArc(entry);
      return { picked: drop, inventoryFull: false };
    }

    if (drop.kind === 'gold') {
      const amt = Math.max(1, Math.round(drop.amount ?? 10));
      player.gold = Math.max(0, (player.gold || 0) + amt);
      drop.pickedUp = true;
      this.activeDrops.splice(idx, 1);
      this.beginHomingArc(entry);
      return { picked: drop };
    }

    if (drop.kind === 'health_orb') {
      const maxHp = Math.max(1, player.stats?.maxHp || 100);
      const healAmount = Math.max(12, Math.round(maxHp * 0.2 + (drop.amount ?? 0) * 0.5));
      player.hp = Math.min(maxHp, (player.hp || 0) + healAmount);
      drop.pickedUp = true;
      this.activeDrops.splice(idx, 1);
      this.beginHomingArc(entry);
      return { picked: drop };
    }

    if (drop.kind === 'potion') {
      const addCount = Math.max(1, Math.round(drop.amount ?? 1));
      const maxPotions = Math.max(1, player.maxHealthPotions || 5);
      if (player.healthPotions < maxPotions) {
        player.healthPotions = Math.min(maxPotions, player.healthPotions + addCount);
      } else {
        const maxHp = Math.max(1, player.stats?.maxHp || 100);
        player.hp = Math.min(maxHp, player.hp + Math.round(maxHp * 0.15));
      }
      drop.pickedUp = true;
      this.activeDrops.splice(idx, 1);
      this.beginHomingArc(entry);
      return { picked: drop };
    }

    return { picked: null };
  }

  public getInventory(): ItemInstance[] {
    return this.inventory;
  }

  public getEquipped(): Partial<Record<EquipSlot, ItemInstance>> {
    return this.equipped;
  }

  public getStash(): ItemInstance[] {
    return this.stash;
  }

  public depositToStash(itemId: string): boolean {
    const invIdx = this.inventory.findIndex((itm) => itm.id === itemId);
    if (invIdx === -1) {
      return false;
    }
    if (this.stash.length >= MAX_STASH_SLOTS) {
      eventBus.emit('ui:toast', {
        message: `Shared Stash Full (${MAX_STASH_SLOTS}/${MAX_STASH_SLOTS})!`,
        rarity: 'common',
      });
      return false;
    }

    this.starterClassSynced = true;
    const [moved] = this.inventory.splice(invIdx, 1);
    this.stash.push(moved);
    eventBus.emit('sfx:request', { id: 'ui_equip' });
    return true;
  }

  public withdrawFromStash(itemId: string): boolean {
    const stashIdx = this.stash.findIndex((itm) => itm.id === itemId);
    if (stashIdx === -1) {
      return false;
    }
    if (this.inventory.length >= MAX_INVENTORY_SLOTS) {
      eventBus.emit('ui:toast', {
        message: `Inventory Full (${MAX_INVENTORY_SLOTS}/${MAX_INVENTORY_SLOTS})! Cannot withdraw.`,
        rarity: 'common',
      });
      return false;
    }

    this.starterClassSynced = true;
    const [moved] = this.stash.splice(stashIdx, 1);
    this.inventory.push(moved);
    eventBus.emit('sfx:request', { id: 'ui_equip' });
    return true;
  }

  public addDirectItemToInventory(item: ItemInstance): boolean {
    if (!item) {
      return false;
    }
    if (this.inventory.length >= MAX_INVENTORY_SLOTS) {
      eventBus.emit('ui:toast', {
        message: `Inventory Full (${MAX_INVENTORY_SLOTS}/${MAX_INVENTORY_SLOTS})!`,
        rarity: 'common',
      });
      return false;
    }

    this.starterClassSynced = true;
    this.generator.registerSnapshot(item);
    this.inventory.push(item);
    eventBus.emit('sfx:request', { id: 'ui_equip' });
    return true;
  }

  public loadStash(items?: ItemInstance[]): void {
    const safeStash = Array.isArray(items) ? items : [];
    this.stash = safeStash.slice(0, MAX_STASH_SLOTS).map((itm) => {
      const cloned = cloneItem(itm);
      this.generator.registerSnapshot(cloned);
      return cloned;
    });
  }

  public equipItem(itemId: string): boolean {
    const invIdx = this.inventory.findIndex((itm) => itm.id === itemId);
    if (invIdx === -1) {
      return false;
    }

    this.starterClassSynced = true;
    const itemToEquip = this.inventory[invIdx];
    const targetSlot = itemToEquip.slot;
    const previouslyEquipped = this.equipped[targetSlot];

    if (previouslyEquipped) {
      this.inventory[invIdx] = previouslyEquipped;
    } else {
      this.inventory.splice(invIdx, 1);
    }

    this.equipped[targetSlot] = itemToEquip;
    if (targetSlot === 'weapon' && itemToEquip.weaponVisual) {
      this.fallbackWeaponVisual = itemToEquip.weaponVisual;
    }

    const currentWeaponVisual = this.equipped.weapon?.weaponVisual ?? this.fallbackWeaponVisual;
    eventBus.emit('sfx:request', { id: 'ui_equip' });
    eventBus.emit('hero:gearChanged', {
      slot: targetSlot,
      item: itemToEquip,
      weaponVisual: currentWeaponVisual,
      rarity: itemToEquip.rarity,
    });
    return true;
  }

  public unequipSlot(slot: EquipSlot): boolean {
    const current = this.equipped[slot];
    if (!current) {
      return false;
    }
    if (this.inventory.length >= MAX_INVENTORY_SLOTS) {
      eventBus.emit('ui:toast', {
        message: `Inventory Full (${MAX_INVENTORY_SLOTS}/${MAX_INVENTORY_SLOTS})! Cannot unequip.`,
        rarity: 'common',
      });
      return false;
    }

    this.starterClassSynced = true;
    delete this.equipped[slot];
    this.inventory.push(current);

    const currentWeaponVisual = this.equipped.weapon?.weaponVisual ?? this.fallbackWeaponVisual;
    eventBus.emit('sfx:request', { id: 'ui_equip' });
    eventBus.emit('hero:gearChanged', {
      slot,
      item: undefined,
      weaponVisual: currentWeaponVisual,
      rarity: this.equipped.weapon?.rarity,
    });
    return true;
  }

  public salvageItem(itemId: string): { goldGained: number } {
    const invIdx = this.inventory.findIndex((itm) => itm.id === itemId);
    if (invIdx === -1) {
      return { goldGained: 0 };
    }

    this.starterClassSynced = true;
    const [removed] = this.inventory.splice(invIdx, 1);
    const goldGained = Math.max(5, Math.round(removed.goldValue * 0.45));
    eventBus.emit('sfx:request', { id: 'gold_pickup' });
    return { goldGained };
  }

  public upgradeItem(
    itemId: string,
    playerGold: number,
  ): { success: boolean; cost: number; newUpgradeLevel: number } {
    let targetItem: ItemInstance | undefined = this.inventory.find((itm) => itm.id === itemId);
    if (!targetItem) {
      for (const slot of ALL_EQUIP_SLOTS) {
        if (this.equipped[slot]?.id === itemId) {
          targetItem = this.equipped[slot];
          break;
        }
      }
    }
    if (!targetItem) {
      targetItem = this.stash.find((itm) => itm.id === itemId);
    }

    if (!targetItem) {
      return { success: false, cost: 0, newUpgradeLevel: 0 };
    }

    if (targetItem.upgradeLevel >= MAX_UPGRADE_LEVEL) {
      return {
        success: false,
        cost: 0,
        newUpgradeLevel: targetItem.upgradeLevel,
      };
    }

    const cost = this.generator.computeUpgradeCost(targetItem);
    if (!Number.isFinite(playerGold) || playerGold < cost) {
      return {
        success: false,
        cost,
        newUpgradeLevel: targetItem.upgradeLevel,
      };
    }

    this.starterClassSynced = true;
    const newUpgradeLevel = this.generator.upgradeItemInPlace(targetItem);
    eventBus.emit('sfx:request', { id: 'ui_equip' });

    return {
      success: true,
      cost,
      newUpgradeLevel,
    };
  }

  public computeEquipmentBonuses(): {
    attributes: Partial<Attributes>;
    stats: Partial<DerivedStats>;
    weaponVisual: WeaponVisualType;
    weaponRarity?: ItemRarity;
  } {
    const attributes: Partial<Attributes> = {};
    const stats: Partial<DerivedStats> = {};

    for (const slot of ALL_EQUIP_SLOTS) {
      const item = this.equipped[slot];
      if (!item) continue;

      for (let i = 0; i < item.affixes.length; i++) {
        const affix = item.affixes[i];
        if (!Number.isFinite(affix.value)) continue;

        if (ATTRIBUTE_KEYS.has(affix.statKey as keyof Attributes)) {
          const key = affix.statKey as keyof Attributes;
          attributes[key] = Number(((attributes[key] ?? 0) + affix.value).toFixed(2));
        } else {
          const key = affix.statKey as keyof DerivedStats;
          stats[key] = Number(((stats[key] ?? 0) + affix.value).toFixed(4));
        }
      }
    }

    const equippedWeapon = this.equipped.weapon;
    const weaponVisual: WeaponVisualType =
      equippedWeapon?.weaponVisual ?? this.fallbackWeaponVisual;
    const weaponRarity: ItemRarity | undefined = equippedWeapon?.rarity;

    return {
      attributes,
      stats,
      weaponVisual,
      ...(weaponRarity ? { weaponRarity } : {}),
    };
  }

  public serialize(): {
    inventory: ItemInstance[];
    equipped: Partial<Record<EquipSlot, ItemInstance>>;
    stash: ItemInstance[];
  } {
    const equippedCopy: Partial<Record<EquipSlot, ItemInstance>> = {};
    for (const slot of ALL_EQUIP_SLOTS) {
      const item = this.equipped[slot];
      if (item) {
        equippedCopy[slot] = cloneItem(item);
      }
    }

    return {
      inventory: this.inventory.slice(0, MAX_INVENTORY_SLOTS).map(cloneItem),
      equipped: equippedCopy,
      stash: this.stash.slice(0, MAX_STASH_SLOTS).map(cloneItem),
    };
  }

  public deserialize(data: {
    inventory: ItemInstance[];
    equipped: Partial<Record<EquipSlot, ItemInstance>>;
    stash?: ItemInstance[];
  }): void {
    this.starterClassSynced = true;
    this.generator.clearSnapshots();

    const safeInv = Array.isArray(data?.inventory) ? data.inventory : [];
    this.inventory = safeInv.slice(0, MAX_INVENTORY_SLOTS).map((itm) => {
      const cloned = cloneItem(itm);
      this.generator.registerSnapshot(cloned);
      return cloned;
    });

    const nextEquipped: Partial<Record<EquipSlot, ItemInstance>> = {};
    if (data?.equipped && typeof data.equipped === 'object') {
      for (const slot of ALL_EQUIP_SLOTS) {
        const itm = data.equipped[slot];
        if (itm) {
          const cloned = cloneItem(itm);
          this.generator.registerSnapshot(cloned);
          nextEquipped[slot] = cloned;
        }
      }
    }
    this.equipped = nextEquipped;

    if (Array.isArray(data?.stash)) {
      this.stash = data.stash.slice(0, MAX_STASH_SLOTS).map((itm) => {
        const cloned = cloneItem(itm);
        this.generator.registerSnapshot(cloned);
        return cloned;
      });
    } else {
      this.stash = [];
    }

    if (this.equipped.weapon?.weaponVisual) {
      this.fallbackWeaponVisual = this.equipped.weapon.weaponVisual;
    }
  }

  public update(dt: number, elapsedSec: number, player: PlayerRuntimeState): void {
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : 0;

    if (!this.starterClassSynced && player?.heroClass) {
      this.starterClassSynced = true;
      if (player.heroClass !== 'vanguard') {
        this.setupStarterGear(player.heroClass, true);
      }
    }

    if (this.fullInventoryToastCooldownSec > 0) {
      this.fullInventoryToastCooldownSec = Math.max(0, this.fullInventoryToastCooldownSec - safeDt);
    }

    // Advance custom GLSL scrolling aurora pillar & ground vortex uniforms
    this.renderer.syncShaderTime(safeElapsed);

    // 1. Advance active 3D Bezier Homing Spiral Arc pickups (~0.30s) into live player torso (y + 1.05)
    for (let h = this.homingEntries.length - 1; h >= 0; h--) {
      const homingEntry = this.homingEntries[h];
      const targetBase = player?.position ?? homingEntry.homingStartWorld;
      const step = this.renderer.updateHomingFlight(homingEntry, safeDt, targetBase);
      if (step.completed) {
        this.homingEntries.splice(h, 1);
        this.finalizePickupArrival(homingEntry, step.worldPos);
      }
    }

    // 2. Update ground drops & check magnet pull / proximity pickup
    for (let i = this.activeDrops.length - 1; i >= 0; i--) {
      const entry = this.activeDrops[i];
      if (!entry || entry.drop.pickedUp) {
        continue;
      }

      if (player?.alive && player.position) {
        const dist = distXZ(entry.drop.position, player.position);
        const kind = entry.drop.kind;

        const shouldMagnetGold = kind === 'gold' && dist <= MAGNET_RADIUS_GOLD;
        const shouldMagnetOrb = kind === 'health_orb' && dist <= MAGNET_RADIUS_ORB;
        const shouldMagnetPotion =
          kind === 'potion' &&
          dist <= MAGNET_RADIUS_POTION &&
          player.healthPotions < (player.maxHealthPotions || 5);
        const shouldMagnetRune = kind === 'rune' && dist <= MAGNET_RADIUS_RUNE && entry.ageSec >= 0.25;

        if (
          (shouldMagnetGold || shouldMagnetOrb || shouldMagnetPotion || shouldMagnetRune) &&
          entry.ageSec >= 0.16
        ) {
          entry.magnetized = true;
        }

        if (entry.magnetized) {
          entry.magnetSpeed = Math.min(22.0, entry.magnetSpeed + safeDt * 26.0);
          if (dist <= HOMING_LAUNCH_DISTANCE_MAGNET || dist <= entry.magnetSpeed * safeDt) {
            this.pickupDrop(entry.drop.id, player);
            continue;
          } else if (dist > 0.0001) {
            const inv = 1 / dist;
            const dx = (player.position.x - entry.drop.position.x) * inv;
            const dz = (player.position.z - entry.drop.position.z) * inv;
            entry.drop.position.x += dx * entry.magnetSpeed * safeDt;
            entry.drop.position.z += dz * entry.magnetSpeed * safeDt;
            entry.drop.position.y = player.position.y;
          }
        } else if (
          kind === 'item' &&
          entry.ageSec >= ITEM_AUTO_PICKUP_GRACE_SEC &&
          dist <= AUTO_PICKUP_ITEM_DISTANCE
        ) {
          const res = this.pickupDrop(entry.drop.id, player);
          if (res.picked) {
            continue;
          }
        }
      }

      this.renderer.updateEntryVisual(entry, safeDt, safeElapsed);
    }
  }

  public clearGroundDrops(): void {
    // Flush any in-flight homing arcs cleanly before clearing floor meshes
    for (let i = 0; i < this.homingEntries.length; i++) {
      const entry = this.homingEntries[i];
      this.finalizePickupArrival(entry, {
        x: entry.rootGroup.position.x,
        y: entry.rootGroup.position.y,
        z: entry.rootGroup.position.z,
      });
    }
    this.homingEntries.length = 0;
    this.activeDrops.length = 0;
    this.renderer.clearAll();
  }

  public dispose(): void {
    this.homingEntries.length = 0;
    this.activeDrops.length = 0;
    this.renderer.dispose();
    this.generator.clearSnapshots();
  }
}
