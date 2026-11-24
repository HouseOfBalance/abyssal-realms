import type {
  BossId,
  DamageResult,
  DamageType,
  DlssMode,
  ElementalReactionType,
  EmojiReactionId,
  EnemyEntity,
  EquipSlot,
  GroundLootDrop,
  HeroClassId,
  ItemInstance,
  ItemRarity,
  RuneId,
  SfxId,
  SocialEmoteId,
  TacticalPingType,
  TargetFpsLimit,
  Vec3,
  VfxEffectType,
  WeaponVisualType,
} from '../contracts/types';

export interface GameEventMap {
  'combat:damageDealt': { result: DamageResult; targetIsPlayer: boolean; targetId: string };
  'combat:enemyKilled': { enemy: EnemyEntity };
  'combat:elementalReaction': {
    reaction: ElementalReactionType;
    position: Vec3;
    damage: number;
  };
  'combat:parryTriggered': { position: Vec3; counterSuccess: boolean };
  'combat:executionStrike': { position: Vec3; targetId: string; damage: number };
  'player:awakeningChanged': { active: boolean; position: Vec3 };
  'player:levelUp': { level: number; position: Vec3 };
  'player:dodge': { position: Vec3; direction: Vec3 };
  'mp:openLobby': Record<string, never>;
  'mp:chatPop': { senderName: string; position?: Vec3 };
  'mp:emojiBurst': { emojiId: EmojiReactionId; position: Vec3 };
  'mp:tacticalPing': { pingType: TacticalPingType; position: Vec3 };
  'mp:socialEmote': { emoteId: SocialEmoteId; position: Vec3 };
  'mp:highFiveClash': { position: Vec3 };
  'mp:teammateRevived': { position: Vec3 };
  'mp:voicePtt': { active: boolean };
  'boss:spawned': { bossId: BossId; title: string; position: Vec3 };
  'boss:phaseChanged': { bossId: BossId; phase: 1 | 2 | 3 };
  'boss:defeated': { bossId: BossId; position: Vec3 };
  'event:butcherInvasion': { position: Vec3 };
  'event:goblinSpawned': { position: Vec3 };
  'event:mimicRevealed': { position: Vec3 };
  'event:runewordForged': { runewordName: string; item: ItemInstance };
  'rune:pickedUp': { runeId: RuneId; position: Vec3 };
  'loot:dropped': { drop: GroundLootDrop };
  'loot:pickupStarted': { drop: GroundLootDrop; fromPos: Vec3 };
  'loot:pickedUp': { drop: GroundLootDrop; screenStart?: Vec3 };
  'hero:gearChanged': {
    slot: EquipSlot | 'all';
    item?: ItemInstance;
    weaponVisual: WeaponVisualType;
    rarity?: ItemRarity;
  };
  'hero:classChanged': { heroClass: HeroClassId };
  'dungeon:portalWarp': { fromFloor: number; toFloor: number; position: Vec3 };
  'engine:dlssChanged': { mode: DlssMode; renderScale: number; targetFps: TargetFpsLimit };
  'vfx:request': {
    type: VfxEffectType;
    position: Vec3;
    direction?: Vec3;
    colorHex?: number;
    radius?: number;
    scale?: number;
  };
  'sfx:request': { id: SfxId; position?: Vec3 };
  'camera:shake': { trauma: number };
  'engine:hitstop': { durationSec: number; timeScale?: number };
  'lighting:flash': { colorHex: number; intensity: number; durationSec: number };
  'ui:banner': {
    title: string;
    subtitle?: string;
    tone?: 'gold' | 'crimson' | 'arcane' | 'emerald';
  };
  'ui:toast': { message: string; rarity?: ItemRarity };
  'ui:damageNumber': {
    worldPos: Vec3;
    amount: number;
    isCrit: boolean;
    damageType: DamageType;
    isPlayerHit?: boolean;
  };
}

type EventHandler<T> = (payload: T) => void;

export class TypedEventBus {
  private listeners = new Map<keyof GameEventMap, Set<EventHandler<any>>>();

  on<K extends keyof GameEventMap>(event: K, handler: EventHandler<GameEventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[EventBus] Error in listener for ${String(event)}:`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const eventBus = new TypedEventBus();
