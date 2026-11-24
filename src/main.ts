import * as THREE from 'three';
import type {
  ActiveStatusEffect,
  Attributes,
  DamagePacket,
  DamageResult,
  DamageType,
  DerivedStats,
  DungeonFloorData,
  EmojiReactionId,
  EnemyEntity,
  EquipSlot,
  GameSettings,
  HeroAnimState,
  HeroClassId,
  InteractableProp,
  MenuPanelId,
  MercenaryId,
  MultiplayerTransportMode,
  MusicMood,
  NetChatMessage,
  NetPacket,
  ObeliskPactCard,
  PeerVoiceState,
  PetId,
  PlayerRuntimeState,
  RemotePeerSnapshot,
  RuneId,
  SaveProfileData,
  SkillSlotIndex,
  SocialEmoteId,
  TacticalPingType,
  Vec3,
  VfxEffectType,
} from './contracts/types';
import { BIOME_CONFIG, DAMAGE_TYPE_COLORS, clamp, distXZ } from './core/Constants';
import { eventBus } from './core/EventBus';
import { detectDevice, watchDeviceChanges, type PerformanceTier } from './core/DeviceDetector.js';
import { t } from './core/i18n/index.js';
import { injectResponsiveStyles, scaleUIForDevice } from './core/ResponsiveStyles.js';
import { createTouchControls, type TouchControls } from './core/TouchControls.js';
import {
  computeRustDungeonHash,
  getRustEngineBanner,
  isRunningInRustApk,
  restoreSaveFromRustNativeIfNeeded,
  syncSaveToRustNative,
  triggerRustHaptic,
} from './core/RustNativeBridge.js';

// Core 20 Swarm Modules
import { createEngineCore } from './modules/engine';
import { createCameraRig } from './modules/camera';
import { createMaterialLibrary } from './modules/materials';
import { createLightingDirector } from './modules/lighting';
import { createHeroRig } from './modules/hero-model';
import { createPlayerController, PlayerController } from './modules/player';
import { createSkillSystem, SkillSystem } from './modules/skills';
import { createDungeonGenerator } from './modules/dungeon';
import { createDungeonMeshBuilder } from './modules/world-mesh';
import { createHazardSystem } from './modules/hazards';
import { createCombatEngine } from './modules/combat';
import { createEnemyMeshFactory } from './modules/enemy-meshes';
import { createEnemyAISystem } from './modules/ai';
import { BossDirector, createBossDirector } from './modules/bosses';
import { createLootSystem, LootSystem } from './modules/loot';
import { createQuestSystem } from './modules/quests';
import { createVfxAudioSystem } from './modules/vfx-audio';
import { createHudUI } from './modules/ui-hud';
import { createMenusUI, MenusUI } from './modules/ui-menus';
import { createBalanceValidator, createDebugOverlay } from './modules/integration';

// Phase 3 Expansion Modules (#21 - #25)
import { createSanctuaryHub } from './modules/hub';
import { ALL_RUNE_IDS, createRunewordSystem } from './modules/runewords';
import { createCompanionSystem } from './modules/companions';
import { createWorldEventSystem } from './modules/events';
import { createCombatMasterySystem } from './modules/mastery';

// Phase 4 Cross-Network Multiplayer, Voice, Social & Avatar Modules (#26 - #30)
import { createMultiplayerTransport, getRoomCodeFromUrl } from './modules/net-core';
import { createVoiceChatSystem } from './modules/net-voice';
import { createMultiplayerUI } from './modules/ui-multiplayer';
import { createSocialInteractionSystem } from './modules/emotes';
import { createRemoteAvatarManager } from './modules/net-avatars';

type ActiveZoneMode = 'sanctuary' | 'dungeon' | 'colosseum';

class AbyssalRealmsApp {
  // Thread 1: Engine, Camera, Materials, Lighting
  private readonly engine = createEngineCore();
  private readonly cameraRig = createCameraRig();
  private readonly materials = createMaterialLibrary();
  private readonly lighting = createLightingDirector();

  // Thread 2: Hero Model, Player Controller, Skill System
  private readonly heroRig = createHeroRig('vanguard');
  private readonly playerCtrl = createPlayerController() as PlayerController;
  private readonly skills = createSkillSystem() as SkillSystem;

  // Thread 3: Procedural Dungeon, 3D Architecture, Traps & Hazards
  private readonly dungeonGen = createDungeonGenerator();
  private readonly dungeonMesh = createDungeonMeshBuilder();
  private readonly hazards = createHazardSystem();

  // Thread 4: Combat Engine, Monster Models, Monster AI, Boss Encounters
  private readonly combat = createCombatEngine();
  private readonly enemyMeshes = createEnemyMeshFactory();
  private readonly enemyAI = createEnemyAISystem();
  private readonly bosses = createBossDirector() as BossDirector;

  // Thread 5: Loot & Crafting, Quests & Lore, VFX & Synth Audio
  private readonly loot = createLootSystem() as LootSystem;
  private readonly quests = createQuestSystem();
  private readonly vfxAudio = createVfxAudioSystem();

  // Thread 6: Action HUD, Full-Screen Menus, Telemetry & QA
  private readonly hud = createHudUI();
  private readonly menus = createMenusUI() as MenusUI;
  private readonly validator = createBalanceValidator();
  private readonly debugOverlay = createDebugOverlay();

  // Phase 3 Expansion Systems (#21 - #25)
  private readonly sanctuaryHub = createSanctuaryHub();
  private readonly runewords = createRunewordSystem();
  private readonly companions = createCompanionSystem();
  private readonly worldEvents = createWorldEventSystem();
  private readonly mastery = createCombatMasterySystem();

  // Phase 4 Cross-Network Multiplayer Systems (#26 - #30)
  private readonly netTransport = createMultiplayerTransport();
  private readonly voiceChat = createVoiceChatSystem();
  private readonly mpUI = createMultiplayerUI();
  private readonly socialEmotes = createSocialInteractionSystem();
  private readonly remoteAvatars = createRemoteAvatarManager();

  private currentFloor!: DungeonFloorData;
  private floorGroup: THREE.Group | null = null;
  private zoneMode: ActiveZoneMode = 'sanctuary';
  private runActive = false;
  private bossDefeatedOnFloor = false;
  private deathScreenTriggered = false;
  private godMode = false;
  private wasAwakenedLastTick = false;
  private wasSwornBrethrenActive = false;
  private applyingRemoteCombatHit = false;
  private holdingInteractKey = false;
  private localLastAnimState: HeroAnimState = 'idle';

  private highestFloorUnlocked = 1;
  private colosseumBestWave = 0;
  private currentObeliskChoices: ObeliskPactCard[] = [];
  private critChainCooldownSec = 0;

  private basicComboStep = 0;
  private cursorClientX = typeof window !== 'undefined' ? window.innerWidth * 0.5 : 640;
  private cursorClientY = typeof window !== 'undefined' ? window.innerHeight * 0.5 : 360;
  private menusRefreshTimer = 0;
  private touchControls: TouchControls | null = null;
  private activePerformanceTier: PerformanceTier = 'high';
  private portalWarpPending: {
    timerSec: number;
    destination: 'sanctuary' | 'colosseum' | number;
    openVictory: boolean;
  } | null = null;

  private settings: GameSettings = {
    masterVolume: 0.8,
    musicVolume: 0.65,
    sfxVolume: 0.85,
    graphicsQuality: 'high',
    cameraSensitivity: 1.0,
    showDamageNumbers: true,
    dlssMode: 'quality',
    dlssSharpness: 0.75,
    targetFps: 120,
    dynamicResolution: true,
  };

  public bootstrap(): void {
    if (typeof window === 'undefined') return;

    // ── Device Detection & Responsive UI ───────────────────────────────────
    const deviceProfile = detectDevice();
    this.activePerformanceTier = deviceProfile.tier;
    this.settings.graphicsQuality =
      deviceProfile.tier === 'low' ? 'low' : deviceProfile.tier === 'medium' ? 'medium' : 'high';
    this.settings.targetFps =
      deviceProfile.tier === 'low' ? 60 : deviceProfile.tier === 'medium' ? 60 : 120;
    this.settings.dlssMode =
      deviceProfile.tier === 'low'
        ? 'performance'
        : deviceProfile.tier === 'medium'
          ? 'balanced'
          : 'quality';

    injectResponsiveStyles();
    scaleUIForDevice(deviceProfile.deviceClass);
    this.applyPerformanceTierToSubsystems(deviceProfile.tier);

    // Touch controls for mobile/tablet or when running inside the Rust Android APK
    restoreSaveFromRustNativeIfNeeded('abyssal_realms_save_v1');
    if (deviceProfile.isTouchPrimary || isRunningInRustApk()) {
      scaleUIForDevice('mobile');
      this.ensureTouchControlsMounted();
    }

    // Watch for orientation / resize changes
    watchDeviceChanges((profile) => {
      scaleUIForDevice(profile.deviceClass);
      this.activePerformanceTier = profile.tier;
      this.applyPerformanceTierToSubsystems(profile.tier);
      if (profile.isTouchPrimary && !this.touchControls) {
        this.ensureTouchControlsMounted();
      }
    });

    const canvasContainer = document.getElementById('game-canvas-container') ?? document.body;
    const hudContainer = document.getElementById('ui-hud-layer') ?? document.body;
    const menusContainer = document.getElementById('ui-menus-layer') ?? document.body;
    const mpContainer = document.getElementById('ui-multiplayer-layer') ?? document.body;

    // Initialize 3D Core & Scene Subsystems
    this.engine.mount(canvasContainer, this.cameraRig.camera);
    this.cameraRig.attachControls(this.engine.renderer.domElement);
    this.playerCtrl.setCamera(this.cameraRig.camera);
    this.playerCtrl.attachInput(window.document.body);

    this.lighting.init(this.engine.scene);
    this.combat.init(this.engine.scene);
    this.bosses.init(this.engine.scene);
    this.loot.init(this.engine.scene);
    this.vfxAudio.init(this.engine.scene);
    this.companions.init(this.engine.scene, this.materials);
    this.worldEvents.init(this.engine.scene, this.materials, this.enemyMeshes);
    this.mastery.init(this.engine.scene);
    this.socialEmotes.init(this.engine.scene);
    this.remoteAvatars.init(this.engine.scene);
    this.engine.scene.add(this.heroRig.root);

    this.installPlayerDamageInterceptor();

    // Mount HUD, Menus, Multiplayer Suite & F3 Developer Telemetry
    this.hud.mount(hudContainer);
    this.hud.setVisible(false);
    this.hud.onSkillSlotClick((slot) => {
      if (this.runActive && !this.isUiBlockingGameplay()) {
        this.executeSkillCast(slot);
      }
    });
    this.hud.onPanelToggleClick((panel) => {
      if (!this.runActive) return;
      this.vfxAudio.playSfx('ui_click');
      this.menus.togglePanel(panel);
      this.syncMenusData();
    });

    this.mountMenusSystem(menusContainer);
    this.mountMultiplayerSystem(mpContainer);
    this.mountDebugOverlay();

    // Hide in-game multiplayer HUD & touch controls while on the Title Screen
    (this.mpUI as unknown as { setHudVisible?(v: boolean): void }).setHudVisible?.(false);
    if (deviceProfile.isTouchPrimary || isRunningInRustApk()) {
      (this.mpUI as unknown as { setChatCollapsed?(c: boolean): void }).setChatCollapsed?.(true);
    }
    this.touchControls?.setVisible(false);

    this.bindGlobalEvents();
    this.bindNetworkEvents();
    this.applySettings();

    // Build live 3D Sanctuary Stronghold diorama behind the Title Screen
    this.loadSanctuaryHub(true);
    this.menus.openPanel('title');
    this.syncMenusData();
    this.vfxAudio.setMusicMood('title');

    // Auto-open Co-op Lobby if player arrived via a shared ?room=XXXXXX invite URL!
    const inviteCode = getRoomCodeFromUrl();
    if (inviteCode) {
      this.mpUI.openLobby();
    }

    if (isRunningInRustApk()) {
      const banner = getRustEngineBanner() ?? 'Rust Native Core v2.0';
      const hash = computeRustDungeonHash(1337, 1) ?? '0';
      console.info(`[AbyssalRust] ${banner} | SeedParityHash=0x${hash}`);
    }

    this.engine.startLoop(
      (fixedDt) => this.onFixedUpdate(fixedDt),
      (renderDt, elapsed) => this.onRenderUpdate(renderDt, elapsed),
    );
  }

  private ensureTouchControlsMounted(): void {
    if (this.touchControls || typeof document === 'undefined') return;
    let touchDiv = document.getElementById('ui-touch-layer');
    if (!touchDiv) {
      touchDiv = document.createElement('div');
      touchDiv.id = 'ui-touch-layer';
      touchDiv.style.cssText = 'position:fixed;inset:0;z-index:15;pointer-events:none;';
      document.body.appendChild(touchDiv);
    }
    this.touchControls = createTouchControls('ui-touch-layer', {
      onAttack: () => this.playerCtrl.requestTouchCast(0),
      onSkill: (idx) => {
        const slot = clamp(idx + 2, 2, 5) as SkillSlotIndex;
        this.playerCtrl.requestTouchCast(slot);
      },
      onUltimate: () => {
        if (!this.mastery.getHudState().awakened && this.mastery.getHudState().fury >= 99) {
          this.playerCtrl.requestTouchAwakening();
        } else {
          this.playerCtrl.requestTouchCast(5);
        }
      },
      onDodge: () => this.playerCtrl.requestTouchDodge(),
      onPotion: () => {
        this.playerCtrl.useHealthPotion();
      },
      onInteract: () => this.playerCtrl.requestTouchInteract(),
      onMenu: () => {
        if (!this.runActive) return;
        this.vfxAudio.playSfx('ui_click');
        this.menus.togglePanel('inventory');
        this.syncMenusData();
      },
      onMap: () => {
        if (!this.runActive) return;
        this.vfxAudio.playSfx('ui_click');
        const active = this.menus.getActivePanel();
        this.menus.openPanel(active === 'world_map' ? 'none' : 'world_map');
        this.syncMenusData();
      },
      onChat: () => {
        this.vfxAudio.playSfx('ui_click');
        if (this.mpUI.isLobbyOpen()) this.mpUI.closeLobby();
        else this.mpUI.openLobby();
      },
      onEmoteWheel: () => {
        if (!this.runActive) return;
        this.triggerLocalHighFiveRequest();
      },
    });
  }

  private applyPerformanceTierToSubsystems(tier: PerformanceTier): void {
    if ('applyPerformanceTier' in this.engine) {
      (this.engine as unknown as { applyPerformanceTier(t: PerformanceTier): void }).applyPerformanceTier(tier);
    }
    if ('setPerformanceTier' in this.enemyAI) {
      (this.enemyAI as unknown as { setPerformanceTier(t: string): void }).setPerformanceTier(tier);
    }
    if ('setPerformanceTier' in this.dungeonMesh) {
      (this.dungeonMesh as unknown as { setPerformanceTier(t: string): void }).setPerformanceTier(tier);
    }
    if ('setPerformanceTier' in this.vfxAudio) {
      (this.vfxAudio as unknown as { setPerformanceTier(t: string): void }).setPerformanceTier(tier);
    }
    if ('setPerformanceTier' in this.hud) {
      (this.hud as unknown as { setPerformanceTier(t: string): void }).setPerformanceTier(tier);
    }
  }

  private isUiBlockingGameplay(): boolean {
    return (
      this.menus.isBlockingGameplayInput() ||
      this.mpUI.isLobbyOpen() ||
      this.mpUI.isChatFocused() ||
      this.socialEmotes.getLocalDownedState().isDowned
    );
  }

  private mountMenusSystem(menusContainer: HTMLElement): void {
    this.menus.mount(menusContainer, {
      onStartNewGame: (heroClass) => this.startNewGame(heroClass),
      onContinueGame: () => this.continueSavedGame(),
      onResumeGame: () => {
        this.vfxAudio.playSfx('ui_click');
        this.menus.openPanel('none');
      },
      onRespawnOrRetry: () => this.respawnHero(),
      onReturnToTitle: () => this.returnToTitle(),
      onOpenMultiplayerLobby: () => {
        this.vfxAudio.playSfx('ui_click');
        this.mpUI.openLobby();
      },
      onEquipItem: (itemId) => {
        if (this.loot.equipItem(itemId)) {
          this.vfxAudio.playSfx('ui_equip');
          this.syncPlayerStatsAndVisuals();
          this.saveCurrentRun();
          this.syncMenusData();
        }
      },
      onUnequipSlot: (slot: EquipSlot) => {
        if (this.loot.unequipSlot(slot)) {
          this.vfxAudio.playSfx('ui_equip');
          this.syncPlayerStatsAndVisuals();
          this.saveCurrentRun();
          this.syncMenusData();
        } else {
          this.hud.showToast(t('toast.inventoryFull'), 'common');
        }
      },
      onSalvageItem: (itemId) => {
        const { goldGained } = this.loot.salvageItem(itemId);
        if (goldGained > 0) {
          this.playerCtrl.state.gold += goldGained;
          this.vfxAudio.playSfx('gold_pickup');
          this.hud.showToast(t('toast.salvaged', { gold: String(goldGained) }), 'uncommon');
          this.saveCurrentRun();
          this.syncMenusData();
        }
      },
      onUpgradeItem: (itemId) => {
        const res = this.loot.upgradeItem(itemId, this.playerCtrl.state.gold);
        if (res.success) {
          this.playerCtrl.state.gold = Math.max(0, this.playerCtrl.state.gold - res.cost);
          this.vfxAudio.playSfx('shrine_bless');
          this.hud.showToast(t('toast.forged', { level: String(res.newUpgradeLevel), cost: String(res.cost) }), 'epic');
          this.syncPlayerStatsAndVisuals();
          const equippedMap = this.loot.getEquipped();
          for (const [slotKey, eqItem] of Object.entries(equippedMap)) {
            if (eqItem && eqItem.id === itemId) {
              const bonuses = this.loot.computeEquipmentBonuses();
              eventBus.emit('hero:gearChanged', {
                slot: slotKey as EquipSlot,
                item: eqItem,
                weaponVisual: bonuses.weaponVisual,
                rarity: eqItem.rarity,
              });
              break;
            }
          }
          this.saveCurrentRun();
          this.syncMenusData();
        } else {
          this.hud.showToast(
            res.cost > this.playerCtrl.state.gold
              ? t('toast.needGoldUpgrade', { cost: String(res.cost) })
              : t('toast.maxRank'),
            'common',
          );
        }
      },
      onSpendAttribute: (attr: keyof Attributes) => {
        if (this.playerCtrl.spendAttributePoint(attr)) {
          this.vfxAudio.playSfx('ui_click');
          this.syncPlayerStatsAndVisuals();
          this.saveCurrentRun();
          this.syncMenusData();
        }
      },
      onAllocatePassive: (nodeId: string) => {
        const pts = this.playerCtrl.state.unspentSkillPoints;
        if (this.skills.allocatePassive(nodeId, pts)) {
          this.playerCtrl.state.unspentSkillPoints = Math.max(0, pts - 1);
          this.vfxAudio.playSfx('shrine_bless');
          this.syncPlayerStatsAndVisuals();
          this.saveCurrentRun();
          this.syncMenusData();
        }
      },
      onResetPassives: () => {
        const refunded = this.skills.resetPassives();
        if (refunded > 0) {
          this.playerCtrl.state.unspentSkillPoints += refunded;
          this.vfxAudio.playSfx('ui_click');
          this.syncPlayerStatsAndVisuals();
          this.saveCurrentRun();
          this.syncMenusData();
        }
      },
      onSettingsChange: (nextSettings) => {
        this.settings = { ...nextSettings };
        this.applySettings();
        this.syncMenusData();
      },
      onAddSocket: (itemId) => {
        const target = this.findItemById(itemId);
        if (!target) return;
        const res = this.runewords.addSocketToItem(target, this.playerCtrl.state.gold);
        if (res.success) {
          this.playerCtrl.state.gold = Math.max(0, this.playerCtrl.state.gold - res.cost);
          this.vfxAudio.playSfx('ui_equip');
          this.hud.showToast(t('toast.drilledSocket', { cur: String(target.sockets), max: String(res.maxSockets) }), 'rare');
          this.syncPlayerStatsAndVisuals();
          this.saveCurrentRun();
          this.syncMenusData();
        } else {
          this.hud.showToast(
            this.playerCtrl.state.gold < res.cost
              ? t('toast.needGoldSocket', { cost: String(res.cost) })
              : t('toast.maxSockets'),
            'common',
          );
        }
      },
      onSocketRune: (itemId: string, runeId: RuneId) => {
        const target = this.findItemById(itemId);
        if (!target) return;
        const res = this.runewords.socketRuneIntoItem(target, runeId);
        if (res.success) {
          this.vfxAudio.playSfx('shrine_bless');
          if (res.formedRuneword) {
            this.hud.showBanner(
              t('banner.runewordAwakened', { name: res.formedRuneword.name.toUpperCase() }),
              res.formedRuneword.mythicPower,
              'gold',
            );
            this.announceLootOrFeatInPartyChat(
              `${t('chat.runewordForged', { name: res.formedRuneword.name })}`,
              'legendary',
              true,
            );
          } else {
            this.hud.showToast(t('toast.socketedRune', { rune: runeId.toUpperCase() }), 'epic');
          }
          this.syncPlayerStatsAndVisuals();
          this.saveCurrentRun();
          this.syncMenusData();
        } else {
          this.hud.showToast(t('toast.addSocketFirst'), 'common');
        }
      },
      onUnsocketRunes: (itemId) => {
        const target = this.findItemById(itemId);
        if (!target) return;
        const refunded = this.runewords.unsocketRunesFromItem(target);
        if (refunded.length > 0) {
          this.vfxAudio.playSfx('ui_click');
          this.hud.showToast(t('toast.recoveredRunes', { count: String(refunded.length) }), 'rare');
          this.syncPlayerStatsAndVisuals();
          this.saveCurrentRun();
          this.syncMenusData();
        }
      },
      onDepositStash: (itemId) => {
        if (this.loot.depositToStash?.(itemId)) {
          this.vfxAudio.playSfx('ui_equip');
          this.saveCurrentRun();
          this.syncMenusData();
        } else {
          this.hud.showToast(t('toast.stashFull'), 'common');
        }
      },
      onWithdrawStash: (itemId) => {
        if (this.loot.withdrawFromStash?.(itemId)) {
          this.vfxAudio.playSfx('ui_equip');
          this.saveCurrentRun();
          this.syncMenusData();
        } else {
          this.hud.showToast(t('toast.heroBagFull'), 'common');
        }
      },
      onGambleItem: (slot?: EquipSlot) => {
        const res = this.runewords.gambleMysteryItem(
          this.playerCtrl.state.level,
          this.playerCtrl.state.gold,
          this.loot,
          slot,
        );
        if (res.success && res.item) {
          this.playerCtrl.state.gold = Math.max(0, this.playerCtrl.state.gold - res.cost);
          this.vfxAudio.playSfx(res.item.isMythic ? 'loot_drop_legendary' : 'loot_drop_rare');
          this.hud.showToast(
            `${res.item.isMythic ? t('toast.mythicGamble', { item: res.item.name }) : t('toast.gambled', { item: res.item.name })}`,
            res.item.rarity,
          );
          if (res.item.isMythic) {
            this.announceLootOrFeatInPartyChat(
              `${t('chat.mythicGamble', { name: res.item.name })}`,
              'legendary',
              true,
            );
          }
          this.saveCurrentRun();
          this.syncMenusData();
        } else {
          this.hud.showToast(t('toast.needGoldGamble', { cost: String(res.cost) }), 'common');
        }
      },
      onBloodAltar: () => {
        const res = this.runewords.activateBloodAltar(this.playerCtrl.state);
        if (res.success && res.boon) {
          this.vfxAudio.playSfx('boss_roar');
          this.hud.showBanner(
            t('banner.bloodPact'),
            `${res.boon.name}: ${res.boon.description}`,
            'crimson',
          );
          this.syncPlayerStatsAndVisuals();
          this.syncMenusData();
        } else {
          this.hud.showToast(t('toast.inventoryFull'), 'common');
        }
      },
      onSelectPet: (petId: PetId) => {
        this.companions.setActivePet(petId);
        this.vfxAudio.playSfx('shrine_bless');
        this.syncPlayerStatsAndVisuals();
        this.saveCurrentRun();
        this.syncMenusData();
      },
      onSelectMercenary: (mercId: MercenaryId) => {
        this.companions.setActiveMercenary(mercId);
        this.vfxAudio.playSfx('ui_equip');
        this.saveCurrentRun();
        this.syncMenusData();
      },
      onSelectObeliskPact: (cardId: string) => {
        const chosen = this.worldEvents.selectObeliskPact(cardId);
        this.menus.openPanel('none');
        if (chosen) {
          this.vfxAudio.playSfx('shrine_bless');
          this.hud.showBanner(
            t('banner.obeliskPact', { title: chosen.title.toUpperCase() }),
            chosen.blessingText,
            chosen.tone,
          );
          if (chosen.spawnEliteAmbush && this.zoneMode !== 'sanctuary') {
            this.enemyAI.spawnWaveAt(
              this.playerCtrl.state.position,
              3,
              Math.max(1, this.currentFloor.floorNumber),
              'obelisk_ambush',
              this.engine.scene,
              this.enemyMeshes,
              this.materials,
            );
          }
          this.syncPlayerStatsAndVisuals();
        }
      },
      onTravelDestination: (dest) => {
        this.menus.openPanel('none');
        this.initiateWarpTo(dest, false);
      },
    });
  }

  private mountMultiplayerSystem(mpContainer: HTMLElement): void {
    this.mpUI.mount(mpContainer, {
      onHostRoom: async (
        mode: MultiplayerTransportMode,
        nickname: string,
        relayUrl?: string,
      ) => {
        this.netTransport.setLocalNickname(nickname);
        if (!this.runActive) {
          this.startNewGame(this.playerCtrl.state.heroClass || 'vanguard');
        }
        const code = await this.netTransport.hostRoom(mode, { relayUrl });
        if (code) {
          this.hud.showToast(t('toast.partyCreated', { code }), 'legendary');
          this.pushSystemChat(t('chat.coopCreated', { code }));
        }
      },
      onJoinRoom: async (
        roomCode: string,
        mode: MultiplayerTransportMode,
        nickname: string,
        relayUrl?: string,
      ) => {
        this.netTransport.setLocalNickname(nickname);
        if (!this.runActive) {
          this.startNewGame(this.playerCtrl.state.heroClass || 'vanguard');
        }
        const ok = await this.netTransport.joinRoom(roomCode, mode, { relayUrl });
        if (ok) {
          this.mpUI.closeLobby();
          this.hud.showBanner(t('banner.joinedParty'), t('banner.joinedRoom', { code: roomCode.toUpperCase() }), 'emerald');
          this.pushSystemChat(t('chat.coopJoined', { code: roomCode.toUpperCase() }));
        } else {
          const err = this.netTransport.getConnectionInfo().errorMessage ?? 'Could not reach room host';
          this.hud.showToast(err, 'common');
        }
      },
      onLeaveRoom: () => {
        this.netTransport.leaveRoom();
        this.voiceChat.disableMicrophone();
        this.remoteAvatars.syncPeers([]);
        this.hud.showToast(t('toast.leftParty'), 'common');
      },
      onSpawnBotPartner: () => {
        if (!this.runActive) {
          this.startNewGame(this.playerCtrl.state.heroClass || 'vanguard');
        }
        this.netTransport.spawnSimulatedPartner();
        this.mpUI.closeLobby();
        this.hud.showBanner(
          t('banner.botJoined'),
          t('banner.botHint'),
          'gold',
        );
      },
      onTeleportToPeer: (peerId: string) => {
        const peer = this.netTransport.getRemotePeers().find((p) => p.peerId === peerId);
        if (!peer || !this.runActive) return;
        const p = this.playerCtrl.state;
        p.position.x = peer.position.x + 1.1;
        p.position.z = peer.position.z + 1.1;
        this.heroRig.root.position.set(p.position.x, 0, p.position.z);
        this.currentFloor.revealRadius(p.position, 18);
        this.cameraRig.setTarget(p.position, true);
        this.mpUI.closeLobby();
        this.vfxAudio.spawnVfx('lightning_strike', p.position);
        this.vfxAudio.playSfx('portal_hum', p.position);
        this.hud.showToast(t('toast.teleported', { name: peer.nickname }), 'rare');
      },
      onDropGiftForParty: (kind: 'gold' | 'potion') => {
        const p = this.playerCtrl.state;
        if (kind === 'gold') {
          if (p.gold < 100) {
            this.hud.showToast(t('toast.needGoldGift'), 'common');
            return;
          }
          p.gold -= 100;
          const dropPos = { x: p.position.x + p.facingDir.x * 1.4, y: 0, z: p.position.z + p.facingDir.z * 1.4 };
          this.netTransport.broadcast(
            {
              type: 'loot_gift',
              fromPeerId: this.netTransport.getConnectionInfo().localPeerId,
              fromName: this.netTransport.getConnectionInfo().localNickname,
              goldAmount: 100,
              position: dropPos,
            },
            true,
          );
          this.triggerLocalSocialEmote('wave');
          this.hud.showToast(t('toast.giftGold'), 'legendary');
        } else {
          if (p.healthPotions < 1) {
            this.hud.showToast(t('toast.noPotions'), 'common');
            return;
          }
          p.healthPotions -= 1;
          const dropPos = { x: p.position.x + p.facingDir.x * 1.4, y: 0, z: p.position.z + p.facingDir.z * 1.4 };
          this.netTransport.broadcast(
            {
              type: 'loot_gift',
              fromPeerId: this.netTransport.getConnectionInfo().localPeerId,
              fromName: this.netTransport.getConnectionInfo().localNickname,
              potionCount: 1,
              position: dropPos,
            },
            true,
          );
          this.triggerLocalSocialEmote('wave');
          this.hud.showToast(t('toast.giftPotion'), 'uncommon');
        }
      },
      onSendChat: (text: string) => {
        this.sendLocalChatMessage(text);
      },
      onTriggerEmoji: (emojiId: EmojiReactionId) => {
        this.triggerLocalEmoji(emojiId);
      },
      onTriggerEmote: (emoteId: SocialEmoteId) => {
        this.triggerLocalSocialEmote(emoteId);
      },
      onTriggerPing: (pingType: TacticalPingType, worldPos?: Vec3) => {
        const target =
          worldPos ??
          this.cameraRig.screenToGroundWorld(this.cursorClientX, this.cursorClientY, 0) ??
          this.playerCtrl.state.position;
        this.triggerLocalTacticalPing(pingType, target);
      },
      onTriggerHighFive: () => {
        this.triggerLocalHighFiveRequest();
      },
      onToggleMicEnable: async () => {
        const st = this.voiceChat.getLocalState();
        if (st.micEnabled) {
          this.voiceChat.disableMicrophone();
          this.hud.showToast('Đã ngắt kết nối Microphone', 'common');
        } else {
          const ok = await this.voiceChat.enableMicrophone();
          if (ok) {
            const peers = this.netTransport.getRemotePeers().filter((p) => !p.isSimulated);
            this.voiceChat.attachPeerNetwork(
              this.netTransport.getUnderlyingPeerJsInstance(),
              peers.map((p) => p.peerId),
            );
            this.hud.showToast(
              this.voiceChat.getLocalState().mode === 'ptt'
                ? 'Đã Bật Giọng Nói — Giữ [T] để Nói!'
                : 'Đã Bật Mic Tự Động (Open Mic)!',
              'uncommon',
            );
          } else {
            this.hud.showToast('Không tìm thấy mic hoặc bị từ chối quyền', 'common');
          }
        }
      },
      onSetVoiceMode: (mode) => {
        this.voiceChat.setVoiceMode(mode);
      },
      onToggleMute: () => {
        const next = !this.voiceChat.getLocalState().muted;
        this.voiceChat.setMuted(next);
      },
      onToggleDeafen: () => {
        const next = !this.voiceChat.getLocalState().deafened;
        this.voiceChat.setDeafened(next);
      },
      onToggleSpatialAudio: () => {
        const next = !this.voiceChat.getLocalState().spatialAudio;
        this.voiceChat.setSpatialAudio(next);
        this.hud.showToast(
          next ? 'Âm Thanh Không Gian 3D: BẬT' : 'Đài Bộ Đàm Toàn Đội: BẬT',
          'rare',
        );
      },
      onSetPeerMuted: (peerId, muted) => {
        this.voiceChat.setPeerMuted(peerId, muted);
      },
      onSetPeerVolume: (peerId, volume) => {
        this.voiceChat.setPeerVolume(peerId, volume);
      },
    });
  }

  private mountDebugOverlay(): void {
    this.debugOverlay.mount(document.body, {
      onToggleGodMode: (enabled) => {
        this.godMode = enabled;
        this.hud.showToast(t('toast.godMode', { state: enabled ? 'BẬT' : 'TẮT' }), 'legendary');
      },
      onGrantGold: (amount) => {
        this.playerCtrl.state.gold += amount;
        this.vfxAudio.playSfx('gold_pickup');
        this.syncMenusData();
      },
      onSkipFloor: () => {
        if (!this.runActive) return;
        const nextFloor = Math.max(1, (this.currentFloor?.floorNumber ?? 0) + 1);
        this.highestFloorUnlocked = Math.max(this.highestFloorUnlocked, nextFloor);
        this.loadDungeonFloor(nextFloor);
      },
      onHealPlayer: () => {
        const p = this.playerCtrl.state;
        p.hp = p.stats.maxHp;
        p.mana = p.stats.maxMana;
        p.stamina = p.stats.maxStamina;
        p.healthPotions = p.maxHealthPotions;
        this.vfxAudio.spawnVfx('heal_aura', p.position);
      },
      onGrantLevel: () => {
        this.playerCtrl.grantXp(this.playerCtrl.state.xpToNextLevel);
        this.syncPlayerStatsAndVisuals();
        this.syncMenusData();
      },
      onWarpSanctuary: () => {
        if (!this.runActive) return;
        this.loadSanctuaryHub();
      },
      onWarpColosseum: () => {
        if (!this.runActive) return;
        this.loadColosseumArena();
      },
      onSpawnButcher: () => {
        if (!this.runActive || this.zoneMode === 'sanctuary') return;
        this.worldEvents.spawnButcherInvasion(this.currentFloor, this.playerCtrl.state.position);
      },
      onSpawnGoblin: () => {
        if (!this.runActive || this.zoneMode === 'sanctuary') return;
        const p = this.playerCtrl.state.position;
        this.worldEvents.spawnTreasureGoblin(this.currentFloor, { x: p.x + 3, y: 0, z: p.z + 3 });
      },
      onFillFury: () => {
        this.mastery.addFury(100);
        this.hud.showToast(t('toast.furyCharged'), 'legendary');
      },
      onGrantAllRunes: () => {
        for (const rId of ALL_RUNE_IDS) {
          this.runewords.grantRune(rId, 2);
        }
        this.vfxAudio.playSfx('loot_drop_legendary');
        this.hud.showToast(t('toast.allRunes'), 'legendary');
        this.syncMenusData();
      },
    });
  }

  private bindNetworkEvents(): void {
    this.netTransport.onPeersChanged((peers) => {
      this.remoteAvatars.syncPeers(peers);
      const realPeerIds = peers.filter((p) => !p.isSimulated).map((p) => p.peerId);
      this.voiceChat.attachPeerNetwork(this.netTransport.getUnderlyingPeerJsInstance(), realPeerIds);

      // Host syncs current world floor & seed whenever party membership changes!
      const conn = this.netTransport.getConnectionInfo();
      if (conn.connected && conn.isHost && this.currentFloor) {
        this.netTransport.broadcast(
          {
            type: 'world_sync',
            zoneMode: this.zoneMode,
            floorNumber: this.currentFloor.floorNumber,
            seed: this.currentFloor.seed,
          },
          true,
        );
      }
    });

    this.netTransport.onPacket((fromPeerId, packet: NetPacket) => {
      switch (packet.type) {
        case 'world_sync': {
          const conn = this.netTransport.getConnectionInfo();
          if (conn.isHost) break;
          const sameZone =
            this.zoneMode === packet.zoneMode &&
            this.currentFloor?.floorNumber === packet.floorNumber &&
            this.currentFloor?.seed === packet.seed;
          if (!sameZone && this.runActive) {
            if (packet.zoneMode === 'sanctuary') {
              this.loadSanctuaryHub(false);
            } else if (packet.zoneMode === 'colosseum') {
              this.loadColosseumArena(packet.seed);
            } else {
              this.loadDungeonFloor(packet.floorNumber, packet.seed);
            }
          }
          break;
        }

        case 'skill_cast': {
          this.remoteAvatars.playRemoteSkillVisual(
            packet.peerId,
            packet.damageType,
            packet.origin,
            packet.facingDir,
            packet.targetPos,
          );
          break;
        }

        case 'combat_hit': {
          const target = this.getAllCombatTargets().find((e) => e.id === packet.enemyId);
          if (target && target.alive) {
            this.applyingRemoteCombatHit = true;
            try {
              this.combat.applyDamageToEnemy(target, {
                sourceId: packet.peerId,
                targetId: target.id,
                baseAmount: packet.damage,
                damageType: packet.damageType,
                critChance: packet.isCrit ? 1 : 0,
                critMultiplier: 1.0,
              });
            } finally {
              this.applyingRemoteCombatHit = false;
            }
          }
          break;
        }

        case 'chat_message': {
          this.mpUI.appendChatMessage(packet.message);
          this.remoteAvatars.showSpeechBubble(
            packet.message.senderId,
            packet.message.senderName,
            packet.message.text,
          );
          const peer = this.netTransport
            .getRemotePeers()
            .find((p) => p.peerId === packet.message.senderId);
          if (peer?.isSimulated) {
            this.voiceChat.injectSimulatedVoiceLevel(peer.peerId, 0.78);
          }
          eventBus.emit('mp:chatPop', {
            senderName: packet.message.senderName,
            position: peer?.position,
          });
          break;
        }

        case 'emoji_burst': {
          this.remoteAvatars.spawnEmojiBurst(packet.peerId, packet.emojiId, packet.position);
          eventBus.emit('mp:emojiBurst', { emojiId: packet.emojiId, position: packet.position });
          break;
        }

        case 'tactical_ping': {
          this.remoteAvatars.spawnTacticalPing(
            packet.peerId,
            packet.senderName,
            packet.pingType,
            packet.position,
          );
          eventBus.emit('mp:tacticalPing', {
            pingType: packet.pingType,
            position: packet.position,
          });
          this.hud.showToast(
            t('toast.pingAlert', { name: packet.senderName, type: packet.pingType.toUpperCase() }),
            'rare',
          );
          break;
        }

        case 'paired_request': {
          this.socialEmotes.receiveRemotePairedRequest(
            packet.fromPeerId,
            packet.fromName,
            packet.kind,
            packet.position,
          );
          this.hud.showToast(
            `🤝 ${packet.fromName} ${t('toast.bladeClashWait')}`,
            'legendary',
          );
          break;
        }

        case 'paired_accept': {
          const localId = this.netTransport.getConnectionInfo().localPeerId;
          this.remoteAvatars.triggerRemotePairedClash(fromPeerId, packet.midpoint);
          if (packet.targetPeerId === localId || packet.fromPeerId === localId) {
            this.heroRig.playSocialEmote?.('high_five_strike');
            this.socialEmotes.executePairedCelebration(
              packet.midpoint,
              this.playerCtrl.state.position,
            );
            this.syncPlayerStatsAndVisuals();
            this.hud.showBanner(
              t('banner.swornBrethren'),
              t('banner.swornBrethrenBonus'),
              'gold',
            );
          }
          break;
        }

        case 'revive_complete': {
          const localId = this.netTransport.getConnectionInfo().localPeerId;
          if (packet.revivedPeerId === localId) {
            const savior =
              this.netTransport.getRemotePeers().find((p) => p.peerId === packet.saviorPeerId)
                ?.nickname ?? t('mp.guest');
            this.socialEmotes.reviveLocalPlayer(this.playerCtrl.state, savior);
            this.heroRig.playEquipFlourish?.('legendary');
            this.hud.showBanner(t('banner.resurrected'), t('banner.restoredSoul', { name: savior }), 'emerald');
          }
          break;
        }

        case 'loot_gift': {
          if (packet.goldAmount) {
            this.playerCtrl.state.gold += packet.goldAmount;
            this.vfxAudio.playSfx('gold_pickup', packet.position);
            this.hud.showToast(
              `🎁 ${packet.fromName} đã tặng +${packet.goldAmount} Vàng!`,
              'legendary',
            );
          } else if (packet.potionCount) {
            const p = this.playerCtrl.state;
            p.healthPotions = Math.min(p.maxHealthPotions, p.healthPotions + packet.potionCount);
            this.vfxAudio.playSfx('potion_drink', packet.position);
            this.hud.showToast(
              `🎁 ${packet.fromName} đã chia sẻ Bình Máu Đỏ!`,
              'uncommon',
            );
          }
          break;
        }
      }
    });
  }

  private sendLocalChatMessage(rawText: string): void {
    const text = rawText.trim();
    if (!text) return;

    // Handle /slash emote shortcuts directly if typed!
    const lower = text.toLowerCase();
    const slashMap: Record<string, SocialEmoteId> = {
      '/wave': 'wave',
      '/cheer': 'cheer',
      '/dance': 'dance',
      '/taunt': 'taunt',
      '/pray': 'kneel_pray',
      '/sit': 'sit_rest',
      '/laugh': 'laugh',
      '/point': 'point',
    };
    if (lower === '/highfive' || lower === '/clash') {
      this.triggerLocalHighFiveRequest();
      return;
    }
    if (slashMap[lower]) {
      this.triggerLocalSocialEmote(slashMap[lower]);
      return;
    }

    const conn = this.netTransport.getConnectionInfo();
    const msg: NetChatMessage = {
      id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: conn.localPeerId,
      senderName: conn.localNickname,
      heroClass: this.playerCtrl.state.heroClass,
      channel: 'party',
      text,
      timestamp: Date.now(),
    };
    this.mpUI.appendChatMessage(msg);
    this.netTransport.broadcast({ type: 'chat_message', message: msg }, true);
    eventBus.emit('mp:chatPop', {
      senderName: conn.localNickname,
      position: this.playerCtrl.state.position,
    });
  }

  private pushSystemChat(text: string): void {
    const conn = this.netTransport.getConnectionInfo();
    this.mpUI.appendChatMessage({
      id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: 'system',
      senderName: 'Sanctuary Herald',
      heroClass: this.playerCtrl.state.heroClass,
      channel: 'system',
      text,
      timestamp: Date.now(),
    });
    void conn;
  }

  private announceLootOrFeatInPartyChat(
    text: string,
    rarity: 'legendary' | 'epic',
    isMythic = false,
  ): void {
    const conn = this.netTransport.getConnectionInfo();
    if (!conn.connected && this.netTransport.getRemotePeers().length === 0) return;
    const msg: NetChatMessage = {
      id: `loot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: conn.localPeerId,
      senderName: conn.localNickname,
      heroClass: this.playerCtrl.state.heroClass,
      channel: 'loot',
      text: `${conn.localNickname}: ${text}`,
      rarity,
      isMythic,
      timestamp: Date.now(),
    };
    this.mpUI.appendChatMessage(msg);
    this.netTransport.broadcast({ type: 'chat_message', message: msg }, true);
  }

  private triggerLocalEmoji(emojiId: EmojiReactionId): void {
    const conn = this.netTransport.getConnectionInfo();
    const pos = { ...this.playerCtrl.state.position };
    this.remoteAvatars.spawnEmojiBurst(conn.localPeerId, emojiId, pos);
    this.netTransport.broadcast({ type: 'emoji_burst', peerId: conn.localPeerId, emojiId, position: pos }, true);
    eventBus.emit('mp:emojiBurst', { emojiId, position: pos });
  }

  private triggerLocalSocialEmote(emoteId: SocialEmoteId): void {
    const conn = this.netTransport.getConnectionInfo();
    const pos = { ...this.playerCtrl.state.position };
    this.socialEmotes.triggerSoloEmote(emoteId, pos);
    this.heroRig.playSocialEmote?.(emoteId);
    this.netTransport.broadcast({ type: 'social_emote', peerId: conn.localPeerId, emoteId }, true);
  }

  private triggerLocalTacticalPing(pingType: TacticalPingType, pos: Vec3): void {
    const conn = this.netTransport.getConnectionInfo();
    this.remoteAvatars.spawnTacticalPing(conn.localPeerId, conn.localNickname, pingType, pos);
    this.netTransport.broadcast(
      {
        type: 'tactical_ping',
        peerId: conn.localPeerId,
        senderName: conn.localNickname,
        pingType,
        position: pos,
      },
      true,
    );
    eventBus.emit('mp:tacticalPing', { pingType, position: pos });
  }

  private triggerLocalHighFiveRequest(): void {
    const conn = this.netTransport.getConnectionInfo();
    const pPos = this.playerCtrl.state.position;
    const res = this.socialEmotes.requestPairedHighFive(pPos, conn.localPeerId, conn.localNickname);

    if (res.acceptedImmediatePeerId && res.midpoint) {
      this.heroRig.playSocialEmote?.('high_five_strike');
      this.remoteAvatars.triggerRemotePairedClash(res.acceptedImmediatePeerId, res.midpoint);
      this.socialEmotes.executePairedCelebration(res.midpoint, pPos);
      this.syncPlayerStatsAndVisuals();
      this.netTransport.broadcast(
        {
          type: 'paired_accept',
          fromPeerId: conn.localPeerId,
          targetPeerId: res.acceptedImmediatePeerId,
          kind: 'blade_clash',
          midpoint: res.midpoint,
        },
        true,
      );
      this.hud.showBanner(
        'THỆ ƯỚC HUYNH ĐỆ GIAO KIẾM!',
        '+20% Sức Mạnh, +15% Tốc Độ & +25% XP/Vàng trong 60s!',
        'gold',
      );
    } else {
      this.heroRig.playSocialEmote?.('high_five_ready');
      this.netTransport.broadcast(
        {
          type: 'paired_request',
          fromPeerId: conn.localPeerId,
          fromName: conn.localNickname,
          kind: 'blade_clash',
          position: { ...pPos },
        },
        true,
      );
      this.hud.showToast('Đã Giơ Vũ Khí Giao Kiếm — Đang chờ đồng đội nhấn [H]!', 'legendary');
    }
  }

  private installPlayerDamageInterceptor(): void {
    const rawApplyPlayer = this.combat.applyDamageToPlayer.bind(this.combat);
    this.combat.applyDamageToPlayer = (
      player: PlayerRuntimeState,
      packet: DamagePacket,
    ): DamageResult => {
      if (
        this.zoneMode === 'sanctuary' ||
        this.godMode ||
        this.socialEmotes.getLocalDownedState().isDowned
      ) {
        return {
          finalDamage: 0,
          isCrit: false,
          isDodged: true,
          killed: false,
          healedSource: 0,
          hitPosition: { ...player.position },
          damageType: packet.damageType,
        };
      }

      const intercept = this.mastery.interceptIncomingPlayerHit(player, null, packet.baseAmount);
      if (intercept.parried) {
        this.heroRig.playParryAnim?.(true);
        return {
          finalDamage: 0,
          isCrit: false,
          isDodged: true,
          killed: false,
          healedSource: 0,
          hitPosition: { ...player.position },
          damageType: packet.damageType,
        };
      }

      const pactTakenMult = this.worldEvents.computePactStatBonuses().damageTakenMultiplier;
      const adjustedPacket: DamagePacket = {
        ...packet,
        baseAmount: Math.max(0, packet.baseAmount * intercept.damageMultiplier * pactTakenMult),
      };
      const out = rawApplyPlayer(player, adjustedPacket);

      // In Co-op Party, intercept lethal blow into 15s Downed Kneeling Bleedout so allies can Revive!
      if ((out.killed || player.hp <= 0) && this.netTransport.getRemotePeers().length > 0) {
        this.socialEmotes.enterDownedState(player);
        player.hp = 1;
        player.alive = true;
        this.heroRig.playSocialEmote?.('downed_kneel');
        this.hud.showBanner(
          'TRỌNG THƯƠNG — CHỜ ĐỒNG ĐỘI CỨU!',
          'Đồng đội có 15s để giữ [F] hồi sinh bạn!',
          'crimson',
        );
      }

      return out;
    };
  }

  private findItemById(itemId: string) {
    const inv = this.loot.getInventory().find((i) => i.id === itemId);
    if (inv) return inv;
    for (const eq of Object.values(this.loot.getEquipped())) {
      if (eq && eq.id === itemId) return eq;
    }
    return undefined;
  }

  private decorateDroppedItemsWithSetsAndSockets(): void {
    for (const drop of this.loot.getGroundDrops()) {
      if (drop.kind === 'item' && drop.item && drop.item.sockets === undefined) {
        this.runewords.assignItemSetOrSockets(drop.item);
      }
    }
  }

  private bindGlobalEvents(): void {
    const unlockOnce = (): void => {
      this.vfxAudio.unlockAudio();
    };
    window.addEventListener('pointerdown', unlockOnce, { passive: true });
    window.addEventListener('keydown', unlockOnce, { passive: true });

    window.addEventListener(
      'pointermove',
      (e) => {
        this.cursorClientX = e.clientX;
        this.cursorClientY = e.clientY;
      },
      { passive: true },
    );

    // Alt + Left Click drops a 3D Tactical Co-op Ping at cursor world position!
    window.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && e.altKey && this.runActive && !this.isUiBlockingGameplay()) {
        const worldPos = this.cameraRig.screenToGroundWorld(e.clientX, e.clientY, 0);
        if (worldPos) {
          this.triggerLocalTacticalPing('attack', worldPos);
        }
      }
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      const kLower = e.key.toLowerCase();
      if (kLower === 'f' || kLower === 'e') {
        this.holdingInteractKey = true;
      }
      if (e.repeat || this.mpUI.isChatFocused()) return;

      if (kLower === 'h' && this.runActive && !this.menus.isBlockingGameplayInput() && !this.mpUI.isLobbyOpen()) {
        this.triggerLocalHighFiveRequest();
        return;
      }

      const active = this.menus.getActivePanel();
      if (active === 'title' || active === 'death' || active === 'victory') {
        return;
      }
      if (!this.runActive) return;

      if (kLower === 'i' || kLower === 'c') {
        this.vfxAudio.playSfx('ui_click');
        this.menus.togglePanel('inventory');
        this.syncMenusData();
      } else if (kLower === 'k') {
        this.vfxAudio.playSfx('ui_click');
        this.menus.togglePanel('skills');
        this.syncMenusData();
      } else if (kLower === 'j') {
        this.vfxAudio.playSfx('ui_click');
        this.menus.togglePanel('quests');
        this.syncMenusData();
      } else if (kLower === 'm') {
        this.vfxAudio.playSfx('ui_click');
        this.menus.openPanel(active === 'world_map' ? 'none' : 'world_map');
        this.syncMenusData();
      } else if (e.key === 'Escape') {
        this.vfxAudio.playSfx('ui_click');
        if (this.mpUI.isLobbyOpen()) {
          this.mpUI.closeLobby();
        } else if (active !== 'none' && active !== 'pause') {
          this.menus.openPanel('none');
        } else {
          this.menus.togglePanel('pause');
        }
        this.syncMenusData();
      }
    });

    window.addEventListener('keyup', (e) => {
      const kLower = e.key.toLowerCase();
      if (kLower === 'f' || kLower === 'e') {
        this.holdingInteractKey = false;
      }
    });

    // Broadcast local combat hits to online party peers & track Training Dummy DPS
    eventBus.on('combat:damageDealt', ({ result, targetIsPlayer, targetId }) => {
      if (!this.runActive || targetIsPlayer) return;

      if (!this.applyingRemoteCombatHit && targetId !== 'training_dummy' && result.finalDamage > 0) {
        const conn = this.netTransport.getConnectionInfo();
        if (conn.connected) {
          this.netTransport.broadcast(
            {
              type: 'combat_hit',
              peerId: conn.localPeerId,
              enemyId: targetId,
              damage: result.finalDamage,
              isCrit: result.isCrit,
              damageType: result.damageType,
              killed: result.killed,
            },
            result.killed,
          );
        }
      }

      if (targetId === 'training_dummy') {
        this.sanctuaryHub.recordDummyDamage(result.finalDamage, result.isCrit);
        return;
      }

      if (
        result.isCrit &&
        this.critChainCooldownSec <= 0 &&
        this.worldEvents.computePactStatBonuses().critChainLightning
      ) {
        this.critChainCooldownSec = 0.35;
        const targets = this.getAllCombatTargets();
        this.combat.performAoE(
          result.hitPosition,
          4.2,
          {
            sourceId: 'pact_chain_lightning',
            baseAmount: Math.max(8, result.finalDamage * 0.42),
            damageType: 'lightning',
            critChance: 0,
            critMultiplier: 1.5,
          },
          targets,
        );
        this.vfxAudio.spawnVfx('lightning_strike', result.hitPosition, { radius: 4.2 });
      }
    });

    eventBus.on('loot:pickedUp', ({ drop }) => {
      if (!this.runActive || drop.kind !== 'item' || !drop.item) return;
      if (drop.item.isMythic || drop.item.rarity === 'legendary') {
        this.announceLootOrFeatInPartyChat(
          `Nhặt được ${drop.item.isMythic ? 'THẦN THOẠI NGUYÊN THỦY' : 'Huyền Thoại'} [${drop.item.name}]!`,
          'legendary',
          Boolean(drop.item.isMythic),
        );
      }
    });

    eventBus.on('rune:pickedUp', ({ runeId }) => {
      if (!this.runActive) return;
      this.runewords.grantRune(runeId, 1);
      this.hud.showToast(`Đã thu thập Rune ${runeId.toUpperCase()}!`, 'epic');
    });

    eventBus.on('combat:enemyKilled', ({ enemy }) => {
      if (!this.runActive) return;
      const player = this.playerCtrl.state;
      player.killsTotal += 1;

      const socialXpMult = this.socialEmotes.getSocialBuffState().xpGoldMultiplier;
      const lvl = this.playerCtrl.grantXp(Math.round(enemy.xpReward * socialXpMult));
      if (lvl.leveledUp) {
        this.syncPlayerStatsAndVisuals();
      }

      const floorNum = Math.max(1, this.currentFloor.floorNumber);
      this.loot.spawnEnemyLoot(enemy, floorNum);

      const droppedRune = this.runewords.rollEnemyRuneDrop(enemy, floorNum);
      if (droppedRune) {
        this.loot.spawnRuneDrop?.(enemy.position, droppedRune);
      }

      const evReward = this.worldEvents.onEnemyKilled(enemy);
      if (evReward.guaranteedMythic && this.loot.generateMythicItem) {
        const mythic = this.loot.generateMythicItem(floorNum + 2);
        this.runewords.assignItemSetOrSockets(mythic);
        this.loot.spawnChestLoot(enemy.position, floorNum + 2, true);
        this.loot.addDirectItemToInventory?.(mythic);
        this.hud.showBanner('THÁNH VẬT THẦN THOẠI ĐÃ NHẬN', mythic.name, 'crimson');
      } else if (evReward.bonusChestTier) {
        this.loot.spawnChestLoot(enemy.position, floorNum + evReward.bonusChestTier, true);
      }
      if (evReward.bonusRunes) {
        for (let i = 0; i < evReward.bonusRunes; i++) {
          const rId = ALL_RUNE_IDS[Math.floor(Math.random() * ALL_RUNE_IDS.length)];
          this.loot.spawnRuneDrop?.(enemy.position, rId);
        }
      }

      this.decorateDroppedItemsWithSetsAndSockets();

      const { completedQuests } = this.quests.onEnemyKilled(enemy);
      for (const q of completedQuests) {
        const totalGoldMult =
          this.worldEvents.computePactStatBonuses().goldMultiplier * socialXpMult;
        player.gold += Math.round(q.goldReward * totalGoldMult);
        const qLvl = this.playerCtrl.grantXp(Math.round(q.xpReward * socialXpMult));
        if (qLvl.leveledUp) {
          this.syncPlayerStatsAndVisuals();
        }
        this.hud.showToast(`Hoàn Thành Nhiệm Vụ: ${q.title} (+${q.goldReward} Vàng)`, 'legendary');
        this.vfxAudio.playSfx('shrine_bless');
      }
    });

    eventBus.on('boss:spawned', ({ bossId, position }) => {
      if (!this.runActive || bossId === 'the_butcher') return;
      this.cameraRig.playBossIntroPan(position, 2.4);
    });

    eventBus.on('boss:defeated', ({ bossId, position }) => {
      if (!this.runActive || bossId === 'the_butcher') return;
      if (this.zoneMode === 'colosseum') {
        this.loot.spawnChestLoot(position, 6, true);
        this.decorateDroppedItemsWithSetsAndSockets();
        return;
      }

      this.bossDefeatedOnFloor = true;
      this.dungeonMesh.setPortalActive(true);
      this.playerCtrl.state.floorsCleared = Math.max(
        this.playerCtrl.state.floorsCleared,
        this.currentFloor.floorNumber,
      );
      this.highestFloorUnlocked = Math.max(
        this.highestFloorUnlocked,
        this.currentFloor.floorNumber + 1,
      );
      this.loot.spawnChestLoot(position, this.currentFloor.floorNumber + 1, true);
      this.decorateDroppedItemsWithSetsAndSockets();
      this.hud.showBanner(
        'THỦ VỆ VỰC THẲM ĐÃ BỊ TIÊU DIỆT',
        'Cổng Không Gian & Điểm Dịch Chuyển Tới Tầng Sâu Đã Mở',
        'gold',
      );
      this.saveCurrentRun();
    });
  }

  private applySettings(): void {
    this.vfxAudio.setVolumes(
      this.settings.masterVolume,
      this.settings.musicVolume,
      this.settings.sfxVolume,
    );
    this.engine.setQuality(this.settings.graphicsQuality);
    this.engine.setDlssMode?.(
      this.settings.dlssMode ?? 'quality',
      this.settings.dlssSharpness ?? 0.75,
    );
    this.engine.setTargetFps?.(
      this.settings.targetFps ?? 120,
      this.settings.dynamicResolution ?? true,
    );
    this.cameraRig.setSensitivity(this.settings.cameraSensitivity);
  }

  private startNewGame(heroClass: HeroClassId): void {
    this.vfxAudio.unlockAudio();
    this.vfxAudio.playSfx('ui_click');

    this.skills.setHeroClass(heroClass);
    this.skills.resetPassives();
    this.loot.setupStarterGear(heroClass);
    this.runewords.deserialize({ runes: { sol: 1, ist: 1 } });
    this.heroRig.setClassStyle(heroClass);

    this.runActive = true;
    this.deathScreenTriggered = false;
    this.portalWarpPending = null;
    this.highestFloorUnlocked = 1;

    this.loadSanctuaryHub(false);

    this.playerCtrl.init(heroClass, this.currentFloor.playerSpawn, this.heroRig);
    this.playerCtrl.state.gold = 250;
    this.companions.respawnAt(this.currentFloor.playerSpawn, 1);
    this.syncPlayerStatsAndVisuals(true);

    eventBus.emit('hero:classChanged', { heroClass });
    this.heroRig.playEquipFlourish?.('rare');

    this.menus.openPanel('none');
    this.hud.setVisible(true);
    this.saveCurrentRun();
  }

  private continueSavedGame(): void {
    const saved = this.quests.loadGame();
    if (!saved) {
      this.startNewGame('vanguard');
      return;
    }

    this.vfxAudio.unlockAudio();
    this.vfxAudio.playSfx('ui_click');

    const heroClass = saved.heroClass;
    this.skills.setHeroClass(heroClass);
    this.skills.loadAllocatedPassives(saved.allocatedPassives ?? {});
    this.loot.deserialize(saved.loot);
    if (saved.stash && (this.loot as any).loadStash) {
      (this.loot as any).loadStash(saved.stash);
    }
    this.runewords.deserialize({ runes: saved.runes });
    if (saved.activePet) this.companions.setActivePet(saved.activePet);
    if (saved.activeMercenary) this.companions.setActiveMercenary(saved.activeMercenary);
    this.colosseumBestWave = Math.max(0, saved.colosseumBestWave ?? 0);
    this.highestFloorUnlocked = Math.max(1, saved.highestFloor || 1);

    this.heroRig.setClassStyle(heroClass);
    this.runActive = true;
    this.deathScreenTriggered = false;
    this.portalWarpPending = null;

    this.loadSanctuaryHub(false);

    this.playerCtrl.init(heroClass, this.currentFloor.playerSpawn, this.heroRig);
    const p = this.playerCtrl.state;
    p.level = Math.max(1, saved.level);
    p.xp = Math.max(0, saved.xp);
    p.unspentSkillPoints = Math.max(0, saved.unspentSkillPoints);
    p.unspentAttributePoints = Math.max(0, saved.unspentAttributePoints);
    p.baseAttributes = { ...saved.baseAttributes };
    p.gold = Math.max(0, saved.gold);
    p.floorsCleared = Math.max(0, saved.highestFloor - 1);
    p.killsTotal = Math.max(0, saved.killsTotal);

    this.companions.respawnAt(this.currentFloor.playerSpawn, p.level);
    this.syncPlayerStatsAndVisuals(true);
    this.menus.openPanel('none');
    this.hud.setVisible(true);
  }

  private respawnHero(): void {
    this.vfxAudio.playSfx('shrine_bless');
    this.deathScreenTriggered = false;
    this.socialEmotes.reviveLocalPlayer(this.playerCtrl.state);
    this.loadSanctuaryHub(false);
    this.playerCtrl.respawnAt(this.currentFloor.playerSpawn);
    this.companions.respawnAt(this.currentFloor.playerSpawn, this.playerCtrl.state.level);
    this.syncPlayerStatsAndVisuals(true);
    this.menus.openPanel('none');
    this.hud.setVisible(true);
  }

  private returnToTitle(): void {
    if (this.runActive) {
      this.saveCurrentRun();
    }
    this.runActive = false;
    this.hud.setVisible(false);
    this.loadSanctuaryHub(true);
    this.menus.openPanel('title');
    this.syncMenusData();
    this.vfxAudio.setMusicMood('title');
  }

  private broadcastHostWorldSync(): void {
    const conn = this.netTransport.getConnectionInfo();
    if (conn.connected && conn.isHost && this.currentFloor) {
      this.netTransport.broadcast(
        {
          type: 'world_sync',
          zoneMode: this.zoneMode,
          floorNumber: this.currentFloor.floorNumber,
          seed: this.currentFloor.seed,
        },
        true,
      );
    }
  }

  private teardownCurrentZone(): void {
    if (this.floorGroup) {
      this.engine.scene.remove(this.floorGroup);
      this.floorGroup = null;
    }
    this.sanctuaryHub.dispose();
    this.dungeonMesh.dispose();
    this.hazards.dispose();
    this.combat.clearFloorEntities();
    this.enemyAI.clear();
    this.bosses.clear();
    this.worldEvents.clear();
    this.mastery.resetFloor();
    this.loot.clearGroundDrops();
    this.lighting.setEventAtmosphere?.('none');
  }

  private loadSanctuaryHub(previewOnly = false): void {
    this.teardownCurrentZone();
    this.zoneMode = 'sanctuary';
    this.runewords.clearFloorBoons();

    this.currentFloor = this.sanctuaryHub.generateSanctuaryFloor();
    this.floorGroup = this.dungeonMesh.buildFloor(this.currentFloor, this.materials);
    this.engine.scene.add(this.floorGroup);
    this.sanctuaryHub.populateHubScene(this.currentFloor, this.engine.scene, this.materials);

    this.cameraRig.setOccluderMeshes(this.dungeonMesh.getWallMeshesForOcclusion());
    this.lighting.applyBiome('sanctuary', this.currentFloor.torchPositions);

    this.bossDefeatedOnFloor = true;
    this.dungeonMesh.setPortalActive(true);

    const spawn = this.currentFloor.playerSpawn;
    if (!previewOnly) {
      this.quests.initFloorQuests(this.currentFloor);
      const p = this.playerCtrl.state;
      p.position.x = spawn.x;
      p.position.y = 0;
      p.position.z = spawn.z;
      this.heroRig.root.position.set(spawn.x, 0, spawn.z);
      this.currentFloor.revealRadius(spawn, 48);
      this.companions.respawnAt(spawn, Math.max(1, p.level));
      this.cameraRig.setTarget(spawn, true);
      this.syncPlayerStatsAndVisuals();
      this.broadcastHostWorldSync();

      const meta = BIOME_CONFIG.sanctuary;
      this.hud.showBanner(
        meta.name,
        'Nhấn [M] Bản Đồ Thế Giới hoặc [P] Tổ Đội Hợp Tác Online!',
        'gold',
      );
    } else {
      this.heroRig.root.position.set(spawn.x, 0, spawn.z);
      this.heroRig.playAnim('idle');
      this.cameraRig.setTarget(spawn, true);
    }
  }

  private loadDungeonFloor(floorNumber: number, explicitSeed?: number): void {
    this.teardownCurrentZone();
    this.zoneMode = 'dungeon';
    this.runewords.clearFloorBoons();

    const seed = explicitSeed ?? ((Date.now() ^ (floorNumber * 0x9e3779b9)) >>> 0);
    this.currentFloor = this.dungeonGen.generateFloor(floorNumber, seed);

    const report = this.validator.validateFloor(this.currentFloor);
    if (!report.valid) {
      console.warn('[BalanceValidator] Floor warning:', report.errors);
    }

    this.floorGroup = this.dungeonMesh.buildFloor(this.currentFloor, this.materials);
    this.engine.scene.add(this.floorGroup);
    this.cameraRig.setOccluderMeshes(this.dungeonMesh.getWallMeshesForOcclusion());
    this.lighting.applyBiome(this.currentFloor.biome, this.currentFloor.torchPositions);
    this.hazards.populateFloor(this.currentFloor, this.engine.scene, this.materials);

    this.bossDefeatedOnFloor = false;
    this.dungeonMesh.setPortalActive(false);

    this.enemyAI.spawnFloorEnemies(
      this.currentFloor,
      this.engine.scene,
      this.enemyMeshes,
      this.materials,
    );
    this.bosses.spawnFloorBoss(this.currentFloor, this.enemyMeshes, this.materials);
    this.worldEvents.initFloorEvents(this.currentFloor);
    this.quests.initFloorQuests(this.currentFloor);

    const p = this.playerCtrl.state;
    p.position.x = this.currentFloor.playerSpawn.x;
    p.position.y = 0;
    p.position.z = this.currentFloor.playerSpawn.z;
    this.heroRig.root.position.set(p.position.x, 0, p.position.z);
    this.currentFloor.revealRadius(p.position, 18);
    this.companions.respawnAt(p.position, p.level);
    this.cameraRig.setTarget(p.position, true);
    this.syncPlayerStatsAndVisuals();
    this.broadcastHostWorldSync();

    const biomeMeta = BIOME_CONFIG[this.currentFloor.biome];
    this.hud.showBanner(biomeMeta.name, biomeMeta.subtitle, 'gold');
    this.vfxAudio.playSfx('portal_hum');
  }

  private loadColosseumArena(explicitSeed?: number): void {
    this.teardownCurrentZone();
    this.zoneMode = 'colosseum';

    this.currentFloor = this.dungeonGen.generateColosseumFloor
      ? this.dungeonGen.generateColosseumFloor(1, explicitSeed)
      : this.dungeonGen.generateFloor(4, explicitSeed);

    this.floorGroup = this.dungeonMesh.buildFloor(this.currentFloor, this.materials);
    this.engine.scene.add(this.floorGroup);
    this.cameraRig.setOccluderMeshes(this.dungeonMesh.getWallMeshesForOcclusion());
    this.lighting.applyBiome('colosseum', this.currentFloor.torchPositions);
    this.hazards.populateFloor(this.currentFloor, this.engine.scene, this.materials);

    this.bossDefeatedOnFloor = true;
    this.dungeonMesh.setPortalActive(true);

    this.quests.initFloorQuests(this.currentFloor);
    this.worldEvents.startColosseumRun(this.currentFloor, this.colosseumBestWave);

    const p = this.playerCtrl.state;
    p.position.x = this.currentFloor.playerSpawn.x;
    p.position.y = 0;
    p.position.z = this.currentFloor.playerSpawn.z;
    this.heroRig.root.position.set(p.position.x, 0, p.position.z);
    this.currentFloor.revealRadius(p.position, 48);
    this.companions.respawnAt(p.position, p.level);
    this.cameraRig.setTarget(p.position, true);
    this.syncPlayerStatsAndVisuals();
    this.broadcastHostWorldSync();

    const meta = BIOME_CONFIG.colosseum;
    this.hud.showBanner(meta.name, 'Sống Sót Qua 20 Đợt Quái Vật & Thử Thách Song Trùm!', 'crimson');
  }

  private initiateWarpTo(
    destination: 'sanctuary' | 'colosseum' | number,
    openVictory = false,
  ): void {
    if (this.portalWarpPending) return;
    this.saveCurrentRun();

    const fromFloor = this.currentFloor?.floorNumber ?? 0;
    const toFloor = typeof destination === 'number' ? destination : 0;
    eventBus.emit('dungeon:portalWarp', {
      fromFloor,
      toFloor,
      position: { ...this.playerCtrl.state.position },
    });
    this.engine.triggerScreenWarp?.(0.75, 1.0);
    this.engine.triggerChromaticPulse?.(0.85, 0.55);
    this.vfxAudio.playSfx('portal_hum', this.playerCtrl.state.position);
    this.playerCtrl.state.invulnerableSec = Math.max(this.playerCtrl.state.invulnerableSec, 1.0);

    this.portalWarpPending = {
      timerSec: 0.36,
      destination,
      openVictory,
    };
  }

  private syncPlayerStatsAndVisuals(refillVitals = false): void {
    const equipBonus = this.loot.computeEquipmentBonuses();
    const runeSetBonus = this.runewords.computeRunewordAndSetBonuses(this.loot.getEquipped());
    const petAura = this.companions.computeCompanionAuraBonuses();
    const pactBonus = this.worldEvents.computePactStatBonuses();
    const passiveBonus = this.skills.computePassiveBonuses();
    const awkMult = this.mastery.getAwakeningMultipliers();
    const socialBuff = this.socialEmotes.getSocialBuffState();

    const combinedAttrs: Partial<Attributes> = { ...equipBonus.attributes };
    for (const [k, v] of Object.entries(runeSetBonus.attributes)) {
      const key = k as keyof Attributes;
      combinedAttrs[key] = (combinedAttrs[key] ?? 0) + (v ?? 0);
    }

    const combinedStats: Partial<DerivedStats> = { ...equipBonus.stats };
    const addStats = (src: Partial<DerivedStats>): void => {
      for (const [k, v] of Object.entries(src)) {
        const key = k as keyof DerivedStats;
        combinedStats[key] = (combinedStats[key] ?? 0) + (v ?? 0);
      }
    };
    addStats(runeSetBonus.stats);
    addStats(petAura);
    addStats(pactBonus.stats);
    if (awkMult.lifeStealBonus > 0) {
      combinedStats.lifeSteal = (combinedStats.lifeSteal ?? 0) + awkMult.lifeStealBonus;
    }

    this.playerCtrl.recomputeStats(
      { attributes: combinedAttrs, stats: combinedStats },
      passiveBonus,
    );

    const st = this.playerCtrl.state.stats;
    const totalPowerMult = awkMult.damageMultiplier * socialBuff.powerMultiplier;
    st.attackPower = Math.round(st.attackPower * totalPowerMult);
    st.spellPower = Math.round(st.spellPower * totalPowerMult);
    st.attackSpeed = Number((st.attackSpeed * awkMult.attackSpeedMultiplier).toFixed(3));
    st.moveSpeed = Number(
      (st.moveSpeed * awkMult.moveSpeedMultiplier * socialBuff.moveSpeedBonus).toFixed(3),
    );
    if (awkMult.cooldownMultiplier < 1) {
      st.cooldownReduction = clamp(st.cooldownReduction + (1 - awkMult.cooldownMultiplier), 0, 0.8);
    }

    this.heroRig.setWeaponVisual(equipBonus.weaponVisual, equipBonus.weaponRarity);

    if (refillVitals) {
      const p = this.playerCtrl.state;
      p.hp = p.stats.maxHp;
      p.mana = p.stats.maxMana;
      p.stamina = p.stats.maxStamina;
    }
  }

  private saveCurrentRun(): void {
    if (!this.runActive) return;
    const p = this.playerCtrl.state;
    const comp = this.companions.getState();
    const colWave = this.worldEvents.getStatus().colosseumState?.bestWave ?? 0;
    this.colosseumBestWave = Math.max(this.colosseumBestWave, colWave);

    const profile: SaveProfileData = {
      version: 2,
      savedAt: Date.now(),
      heroClass: p.heroClass,
      level: p.level,
      xp: p.xp,
      unspentSkillPoints: p.unspentSkillPoints,
      unspentAttributePoints: p.unspentAttributePoints,
      baseAttributes: { ...p.baseAttributes },
      gold: p.gold,
      highestFloor: Math.max(this.highestFloorUnlocked, p.floorsCleared + 1),
      killsTotal: p.killsTotal,
      allocatedPassives: this.skills.getAllocatedPassives(),
      loot: this.loot.serialize(),
      stash: this.loot.getStash?.() ?? [],
      runes: this.runewords.serialize().runes,
      activePet: comp.activePet,
      activeMercenary: comp.activeMercenary,
      colosseumBestWave: this.colosseumBestWave,
      unlockedLoreIds: this.quests
        .getLoreCodex()
        .filter((l) => l.unlocked)
        .map((l) => l.id),
      unlockedAchievementIds: this.quests
        .getAchievements()
        .filter((a) => a.unlocked)
        .map((a) => a.id),
    };
    this.quests.saveGame(profile);
    syncSaveToRustNative('abyssal_realms_save_v1');
  }

  private syncMenusData(): void {
    const runeSet = this.runewords.computeRunewordAndSetBonuses(this.loot.getEquipped());
    this.menus.refresh({
      hasSaveGame: this.quests.hasSaveGame(),
      player: this.playerCtrl.state,
      inventory: this.loot.getInventory(),
      equipped: this.loot.getEquipped(),
      stash: this.loot.getStash?.() ?? [],
      ownedRunes: this.runewords.getOwnedRunes(),
      runeDefinitions: this.runewords.getRuneDefinitions(),
      runewordRecipes: this.runewords.getRunewordRecipes(),
      itemSets: this.runewords.getItemSets(),
      activeSets: runeSet.activeSets,
      companions: this.companions.getState(),
      obeliskChoices: this.currentObeliskChoices,
      highestFloorUnlocked: this.highestFloorUnlocked,
      colosseumBestWave: this.colosseumBestWave,
      passiveNodes: this.skills.getPassiveTree(),
      allocatedPassives: this.skills.getAllocatedPassives(),
      quests: this.quests.getActiveQuests(),
      lore: this.quests.getLoreCodex(),
      achievements: this.quests.getAchievements(),
      settings: this.settings,
    });
  }

  private getAllCombatTargets(): EnemyEntity[] {
    if (this.zoneMode === 'sanctuary') {
      const dummy = this.sanctuaryHub.getTrainingDummyEntity();
      return dummy ? [dummy] : [];
    }

    const merged = [...this.enemyAI.getLivingEnemies()];
    const seen = new Set(merged.map((e) => e.id));

    for (const evEntity of this.worldEvents.getEventCombatEntities()) {
      if (evEntity.alive && !seen.has(evEntity.id)) {
        merged.push(evEntity);
        seen.add(evEntity.id);
      }
    }

    const bossEntities =
      typeof (this.bosses as any).getActiveBossEntities === 'function'
        ? ((this.bosses as any).getActiveBossEntities() as EnemyEntity[])
        : [];
    for (const b of bossEntities) {
      if (b.alive && !seen.has(b.id)) {
        merged.push(b);
        seen.add(b.id);
      }
    }

    const singleBoss = this.bosses.getActiveBoss();
    if (singleBoss && singleBoss.entity.alive && !seen.has(singleBoss.entity.id)) {
      merged.push(singleBoss.entity);
    }

    return merged;
  }

  private executeSkillCast(slot: SkillSlotIndex): void {
    const player = this.playerCtrl.state;
    if (!player.alive || this.socialEmotes.getLocalDownedState().isDowned) return;

    const targets = this.getAllCombatTargets();

    if (slot === 0 && this.mastery.getHudState().canExecuteTargetId) {
      const exec = this.mastery.tryExecuteStaggeredTarget(player, targets, this.combat);
      if (exec.executed && exec.target) {
        this.heroRig.playExecuteFinisher?.();
        this.cameraRig.playExecutionZoom?.(exec.target.position);
        return;
      }
    }

    if (!this.skills.canCast(slot, player.mana)) {
      return;
    }

    const triggered = this.skills.triggerCast(slot, player.stats.cooldownReduction);
    if (!triggered) return;

    const { skill, manaSpent } = triggered;
    player.mana = Math.max(0, player.mana - manaSpent);

    let anim: HeroAnimState = skill.animState;
    if (slot === 0 && (anim === 'attack_1' || anim === 'attack_2')) {
      const cycle: HeroAnimState[] = ['attack_1', 'attack_2', 'attack_3'];
      anim = cycle[this.basicComboStep % cycle.length];
      this.basicComboStep += 1;
    }
    this.localLastAnimState = anim;
    this.heroRig.playAnim(anim, player.stats.attackSpeed);

    const isSpellType =
      skill.damageType === 'fire' ||
      skill.damageType === 'ice' ||
      skill.damageType === 'lightning' ||
      (skill.damageType === 'void' && player.heroClass === 'arcanist');
    const offensivePower = isSpellType
      ? Math.max(player.stats.spellPower, player.stats.attackPower * 0.75)
      : Math.max(player.stats.attackPower, player.stats.spellPower * 0.6);

    const comboMult = this.combat.getComboState().multiplier;
    const baseAmount = Math.max(1, offensivePower * skill.baseDamageMultiplier * comboMult);

    const isSelfBuffStatus =
      skill.appliesStatus?.type === 'shield' || skill.appliesStatus?.type === 'haste';

    const packetBase: Omit<DamagePacket, 'targetId'> = {
      sourceId: player.id,
      baseAmount,
      damageType: skill.damageType,
      critChance: player.stats.critChance,
      critMultiplier: player.stats.critMultiplier,
      lifeSteal: player.stats.lifeSteal,
      appliesStatus: !isSelfBuffStatus ? skill.appliesStatus : undefined,
    };

    if (isSelfBuffStatus && skill.appliesStatus) {
      this.applySelfBuff(
        skill.appliesStatus.type,
        skill.appliesStatus.durationSec,
        skill.appliesStatus.potency,
      );
    }

    const facing = player.facingDir;
    const colorHex = DAMAGE_TYPE_COLORS[skill.damageType].hex;
    this.heroRig.triggerSlashTrail?.(colorHex, 0.36);

    const cursorWorld =
      this.cameraRig.screenToGroundWorld(this.cursorClientX, this.cursorClientY, 0) ?? undefined;

    // Broadcast skill cast visual to co-op party peers!
    const conn = this.netTransport.getConnectionInfo();
    if (conn.connected) {
      this.netTransport.broadcast(
        {
          type: 'skill_cast',
          peerId: conn.localPeerId,
          slot,
          skillId: skill.id,
          damageType: skill.damageType,
          origin: { ...player.position },
          facingDir: { ...facing },
          targetPos: cursorWorld,
        },
        false,
      );
    }

    switch (skill.targeting) {
      case 'melee_arc': {
        const arcRad = Math.PI * 0.85;
        packetBase.knockback = { x: facing.x * 2.8, y: 0, z: facing.z * 2.8 };
        this.combat.performMeleeArc(player.position, facing, skill.range, arcRad, packetBase, targets);
        this.damageBreakablesNear(
          {
            x: player.position.x + facing.x * (skill.range * 0.5),
            y: 0,
            z: player.position.z + facing.z * (skill.range * 0.5),
          },
          skill.radius,
          baseAmount,
        );
        this.vfxAudio.spawnVfx('slash_arc', player.position, {
          direction: facing,
          colorHex,
          radius: skill.range,
        });
        this.vfxAudio.playSfx('sword_swing', player.position);
        break;
      }

      case 'aoe_self': {
        packetBase.knockback = { x: 0, y: 0, z: 0 };
        this.combat.performAoE(player.position, skill.radius, packetBase, targets);
        this.damageBreakablesNear(player.position, skill.radius, baseAmount);
        const vfxMap: Partial<Record<DamageType, VfxEffectType>> = {
          ice: 'frost_nova',
          poison: 'poison_cloud',
          fire: 'fire_explosion',
          lightning: 'lightning_strike',
          void: 'void_implosion',
        };
        this.vfxAudio.spawnVfx(vfxMap[skill.damageType] ?? 'slash_arc', player.position, {
          colorHex,
          radius: skill.radius,
        });
        this.vfxAudio.playSfx(
          skill.damageType === 'ice' ? 'frost_shatter' : 'sword_swing',
          player.position,
        );
        this.cameraRig.addShake(0.24);
        break;
      }

      case 'aoe_cursor': {
        const aimWorld = cursorWorld ?? {
          x: player.position.x + facing.x * (skill.range * 0.65),
          y: 0,
          z: player.position.z + facing.z * (skill.range * 0.65),
        };
        const dx = aimWorld.x - player.position.x;
        const dz = aimWorld.z - player.position.z;
        const dist = Math.hypot(dx, dz);
        const clampedDist = Math.min(dist, skill.range);
        const dirX = dist > 1e-4 ? dx / dist : facing.x;
        const dirZ = dist > 1e-4 ? dz / dist : facing.z;
        let impactPos: Vec3 = {
          x: player.position.x + dirX * clampedDist,
          y: 0,
          z: player.position.z + dirZ * clampedDist,
        };

        if (skill.animState === 'leap_slam') {
          impactPos = this.findSafestWalkablePointAlong(player.position, impactPos, player.radius);
          player.position.x = impactPos.x;
          player.position.z = impactPos.z;
          player.invulnerableSec = Math.max(player.invulnerableSec, 0.35);
          this.heroRig.root.position.set(impactPos.x, 0, impactPos.z);
          this.currentFloor.revealRadius(impactPos, 18);
        }

        this.combat.performAoE(impactPos, skill.radius, packetBase, targets);
        this.damageBreakablesNear(impactPos, skill.radius, baseAmount);
        this.vfxAudio.spawnVfx('fire_explosion', impactPos, {
          colorHex,
          radius: skill.radius,
        });
        this.vfxAudio.playSfx('explosion', impactPos);
        this.cameraRig.addShake(0.45);
        this.lighting.triggerFlash(colorHex, 2.2, 0.28);
        break;
      }

      case 'projectile': {
        const count = Math.max(1, skill.projectileCount ?? 1);
        const totalSpreadRad = count > 1 ? Math.min(Math.PI * 0.55, (count - 1) * 0.14) : 0;
        const baseAngle = Math.atan2(facing.x, facing.z);
        const origin: Vec3 = {
          x: player.position.x + facing.x * 0.65,
          y: 1.05,
          z: player.position.z + facing.z * 0.65,
        };

        for (let i = 0; i < count; i++) {
          const offset =
            count === 1 ? 0 : -totalSpreadRad * 0.5 + (i / (count - 1)) * totalSpreadRad;
          const angle = baseAngle + offset;
          const dir: Vec3 = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
          this.combat.spawnProjectile({
            ownerIsPlayer: true,
            ownerId: player.id,
            origin: { ...origin },
            direction: dir,
            speed: skill.projectileSpeed ?? 20,
            maxDistance: skill.range,
            radius: Math.max(0.32, Math.min(0.85, skill.radius * 0.45)),
            piercing: count >= 5 || skill.damageType === 'lightning',
            homing: skill.damageType === 'lightning',
            aoeExplosionRadius: skill.damageType === 'fire' ? 2.4 : undefined,
            damagePacket: packetBase,
            visualColorHex: colorHex,
          });
        }
        this.vfxAudio.playSfx(
          skill.damageType === 'lightning' ? 'lightning_zap' : 'fireball_cast',
          player.position,
        );
        break;
      }

      case 'dash': {
        const startPos = { ...player.position };
        const endTarget: Vec3 = {
          x: startPos.x + facing.x * skill.range,
          y: 0,
          z: startPos.z + facing.z * skill.range,
        };
        const safeEnd = this.findSafestWalkablePointAlong(startPos, endTarget, player.radius);
        this.vfxAudio.spawnVfx('dodge_afterimage', startPos, { direction: facing, colorHex });

        player.position.x = safeEnd.x;
        player.position.z = safeEnd.z;
        player.invulnerableSec = Math.max(player.invulnerableSec, 0.32);
        this.heroRig.root.position.set(safeEnd.x, 0, safeEnd.z);
        this.currentFloor.revealRadius(safeEnd, 18);

        const midPos: Vec3 = {
          x: (startPos.x + safeEnd.x) * 0.5,
          y: 0,
          z: (startPos.z + safeEnd.z) * 0.5,
        };
        this.combat.performAoE(midPos, skill.radius + skill.range * 0.35, packetBase, targets);
        this.damageBreakablesNear(safeEnd, skill.radius, baseAmount);
        this.vfxAudio.spawnVfx(
          skill.damageType === 'lightning' ? 'lightning_strike' : 'void_implosion',
          safeEnd,
          { colorHex, radius: skill.radius },
        );
        this.vfxAudio.playSfx('dodge_whoosh', safeEnd);
        break;
      }

      case 'buff': {
        if (skill.radius > 0 && skill.baseDamageMultiplier > 0) {
          this.combat.performAoE(player.position, skill.radius, packetBase, targets);
        }
        this.vfxAudio.spawnVfx('heal_aura', player.position, { colorHex, radius: skill.radius });
        this.vfxAudio.playSfx('shrine_bless', player.position);
        break;
      }
    }
  }

  private applySelfBuff(
    type: ActiveStatusEffect['type'],
    durationSec: number,
    potency: number,
  ): void {
    const statuses = this.playerCtrl.state.statuses;
    const existing = statuses.find((s) => s.type === type);
    if (existing) {
      existing.remainingSec = Math.max(existing.remainingSec, durationSec);
      existing.durationSec = Math.max(existing.durationSec, durationSec);
      existing.potency = Math.max(existing.potency, potency);
    } else {
      statuses.push({
        id: `self_${type}_${Date.now()}`,
        type,
        remainingSec: durationSec,
        durationSec,
        stacks: 1,
        potency,
        sourceId: 'player',
      });
    }
  }

  private findSafestWalkablePointAlong(from: Vec3, to: Vec3, radius: number): Vec3 {
    const steps = 18;
    let best: Vec3 = { x: from.x, y: 0, z: from.z };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      if (this.currentFloor.isWalkableWorld(x, z, radius)) {
        best = { x, y: 0, z };
      } else if (i < 4) {
        break;
      }
    }
    return best;
  }

  private damageBreakablesNear(pos: Vec3, radius: number, damage: number): void {
    const { broken } = this.hazards.damageDestructibleAt(pos, radius, damage);
    for (const prop of broken) {
      if (Math.random() < 0.65) {
        this.loot.spawnChestLoot(prop.position, Math.max(1, this.currentFloor.floorNumber), false);
        this.decorateDroppedItemsWithSetsAndSockets();
      }
    }
  }

  private findNearbyInteractable(): InteractableProp | null {
    if (!this.currentFloor) return null;
    const pPos = this.playerCtrl.state.position;
    let closest: InteractableProp | null = null;
    let bestDist = 3.2;

    for (const prop of this.currentFloor.interactables) {
      if (prop.used) continue;
      if (prop.type === 'portal_next_floor' && !this.bossDefeatedOnFloor) continue;
      const d = distXZ(pPos, prop.position);
      if (d < bestDist) {
        bestDist = d;
        closest = prop;
      }
    }
    return closest;
  }

  private handleInteract(prop: InteractableProp | null): void {
    const player = this.playerCtrl.state;

    if (this.mastery.getHudState().canExecuteTargetId) {
      const exec = this.mastery.tryExecuteStaggeredTarget(
        player,
        this.getAllCombatTargets(),
        this.combat,
      );
      if (exec.executed && exec.target) {
        this.heroRig.playExecuteFinisher?.();
        this.cameraRig.playExecutionZoom?.(exec.target.position);
        return;
      }
    }

    if (!prop) {
      const drops = this.loot.getGroundDrops();
      for (const drop of drops) {
        if (!drop.pickedUp && distXZ(player.position, drop.position) <= 2.6) {
          this.loot.pickupDrop(drop.id, player);
          return;
        }
      }
      return;
    }

    switch (prop.type) {
      case 'chest': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        if (this.zoneMode === 'dungeon' && this.currentFloor.floorNumber >= 2 && Math.random() < 0.18) {
          this.worldEvents.spawnChestMimic(this.currentFloor, prop.position);
          this.hud.showBanner('QUÁI RƯƠNG MIMIC PHỤC KÍCH!', 'Chiếc Rương Lộ Nanh Vuốt Sắc Nhọn!', 'crimson');
        } else {
          this.loot.spawnChestLoot(prop.position, Math.max(1, this.currentFloor.floorNumber), false);
          this.decorateDroppedItemsWithSetsAndSockets();
          this.vfxAudio.spawnVfx('chest_open', prop.position);
          this.vfxAudio.playSfx('chest_open', prop.position);
        }
        this.quests.onInteractableUsed(prop);
        break;
      }

      case 'cursed_chest': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        const res = this.quests.onInteractableUsed(prop);
        if (res.startedCursedEvent) {
          this.hud.showBanner(
            'RƯƠNG NGUYỀN RỦA THỨC TỈNH',
            'Sống Sót 30 Giây Trước Binh Đoàn Vực Thẳm!',
            'crimson',
          );
        }
        break;
      }

      case 'shrine_heal': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        player.hp = player.stats.maxHp;
        player.mana = player.stats.maxMana;
        player.healthPotions = Math.min(player.maxHealthPotions, player.healthPotions + 2);
        this.vfxAudio.spawnVfx('heal_aura', player.position);
        this.vfxAudio.playSfx('shrine_bless', prop.position);
        this.hud.showBanner('ĐỀN THỜ PHỤC HỒI', 'Đã Hồi Đầy Sinh Lực, Phép Lực & Bình Máu', 'emerald');
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'shrine_power': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        this.applySelfBuff('shield', 20, Math.round(player.stats.maxHp * 0.45));
        this.applySelfBuff('haste', 20, 0.25);
        this.vfxAudio.spawnVfx('level_up_pillar', player.position);
        this.vfxAudio.playSfx('shrine_bless', prop.position);
        this.hud.showBanner('ĐỀN THỜ BÁ VƯƠNG', 'Ban Phước Khiên Rune & Tăng Tốc', 'gold');
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'shrine_frenzy': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        this.applySelfBuff('haste', 25, 0.42);
        this.skills.resetCooldowns();
        this.mastery.addFury(50);
        this.vfxAudio.spawnVfx('lightning_strike', player.position);
        this.vfxAudio.playSfx('shrine_bless', prop.position);
        this.hud.showBanner(
          'ĐỀN THỜ CUỒNG HUYẾT',
          'Xóa Hồi Chiêu & +50 Cuồng Nộ',
          'crimson',
        );
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'lore_tome': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        const res = this.quests.onInteractableUsed(prop);
        this.vfxAudio.playSfx('shrine_bless', prop.position);
        if (res.unlockedLore) {
          this.hud.showBanner('KHÁM PHÁ SÁCH CỔ', res.unlockedLore.title, 'arcane');
          this.hud.showToast(`Nhấn [J] để đọc "${res.unlockedLore.title}"`, 'epic');
        }
        this.playerCtrl.grantXp(45 * Math.max(1, this.currentFloor.floorNumber));
        for (const q of res.completedQuests) {
          player.gold += q.goldReward;
          this.playerCtrl.grantXp(q.xpReward);
        }
        break;
      }

      case 'blacksmith_anvil': {
        this.vfxAudio.playSfx('ui_equip', prop.position);
        this.menus.openInventoryTab('armory');
        this.syncMenusData();
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'stash_chest': {
        this.vfxAudio.playSfx('chest_open', prop.position);
        this.dungeonMesh.setInteractableUsed(prop.id);
        this.menus.openInventoryTab('stash');
        this.syncMenusData();
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'gambler_npc': {
        this.vfxAudio.playSfx('ui_click', prop.position);
        this.menus.openInventoryTab('gambler');
        this.syncMenusData();
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'companion_shrine': {
        this.vfxAudio.playSfx('shrine_bless', prop.position);
        this.menus.openInventoryTab('companions');
        this.syncMenusData();
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'waypoint_map': {
        this.vfxAudio.playSfx('portal_hum', prop.position);
        this.menus.openPanel('world_map');
        this.syncMenusData();
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'training_dummy': {
        this.sanctuaryHub.resetDummyMetrics();
        this.vfxAudio.playSfx('ui_click', prop.position);
        this.hud.showToast(
          'Đã Đặt Lại Máy Đo DPS Hình Nhân — Hãy tấn công để thử nghiệm sát thương!',
          'rare',
        );
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'corrupted_obelisk': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        this.currentObeliskChoices = this.worldEvents.rollObeliskChoices();
        this.vfxAudio.playSfx('portal_hum', prop.position);
        this.menus.openPanel('obelisk');
        this.syncMenusData();
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'soul_lantern': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        this.worldEvents.startSoulEscort(prop, this.currentFloor);
        this.hud.showBanner(
          'HỘ TỐNG LỒNG ĐÈN LINH HỒN',
          'Hãy Ở Trong Vòng Ánh Sáng Vàng Khi Bóng Tối Buông Xuống!',
          'gold',
        );
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'rift_breach': {
        prop.used = true;
        this.dungeonMesh.setInteractableUsed(prop.id);
        this.worldEvents.startRiftBreach(prop, this.currentFloor);
        this.hud.showBanner(
          'KHE NỨT THỜI GIAN',
          'Tiêu Diệt Quái Vật Trong 25s Để Nâng Cấp Phần Thưởng Thần Thoại!',
          'arcane',
        );
        this.finishInteractableQuestCheck(prop);
        break;
      }

      case 'portal_next_floor': {
        if (!this.bossDefeatedOnFloor) return;
        if (this.zoneMode === 'sanctuary') {
          this.initiateWarpTo(this.highestFloorUnlocked, false);
        } else if (this.zoneMode === 'colosseum') {
          this.initiateWarpTo('sanctuary', false);
        } else {
          const currentNum = this.currentFloor.floorNumber;
          this.initiateWarpTo(currentNum + 1, currentNum === 6);
        }
        break;
      }
    }
  }

  private finishInteractableQuestCheck(prop: InteractableProp): void {
    const res = this.quests.onInteractableUsed(prop);
    for (const q of res.completedQuests) {
      this.playerCtrl.state.gold += q.goldReward;
      this.playerCtrl.grantXp(q.xpReward);
      this.hud.showToast(`Quest Complete: ${q.title} (+${q.goldReward}g)`, 'legendary');
    }
  }

  private buildLocalNetSnapshot(): RemotePeerSnapshot {
    const p = this.playerCtrl.state;
    const conn = this.netTransport.getConnectionInfo();
    const equip = this.loot.computeEquipmentBonuses();
    const downedSt = this.socialEmotes.getLocalDownedState();
    const moving = Math.hypot(p.velocity.x, p.velocity.z) > 0.35;
    const animState: HeroAnimState = p.isDodging
      ? 'dodge'
      : moving
        ? 'run'
        : this.localLastAnimState === 'run'
          ? 'idle'
          : 'idle';

    return {
      peerId: conn.localPeerId,
      nickname: conn.localNickname,
      isHost: conn.isHost,
      heroClass: p.heroClass,
      level: p.level,
      hp: p.hp,
      maxHp: p.stats.maxHp,
      position: { ...p.position },
      velocity: { ...p.velocity },
      rotationY: p.rotationY,
      animState,
      socialEmote: downedSt.isDowned ? 'downed_kneel' : this.socialEmotes.getLocalActiveEmote(),
      weaponVisual: equip.weaponVisual,
      weaponRarity: equip.weaponRarity,
      awakened: this.mastery.getHudState().awakened,
      downed: downedSt.isDowned,
      downedBleedoutSec: downedSt.bleedoutRemainingSec,
      activePet: this.companions.getState().activePet,
      pingMs: 0,
    };
  }

  private updateAtmosphereAndMusic(): void {
    const evStatus = this.worldEvents.getStatus();
    const masteryHud = this.mastery.getHudState();

    if (evStatus.butcherActive) {
      this.lighting.setEventAtmosphere?.('blood_moon');
    } else if (evStatus.escortState?.active) {
      this.lighting.setEventAtmosphere?.('darkness_escort');
    } else if (masteryHud.awakened) {
      this.lighting.setEventAtmosphere?.('awakening');
    } else {
      this.lighting.setEventAtmosphere?.('none');
    }

    const panel: MenuPanelId = this.menus.getActivePanel();
    if (!this.runActive || panel === 'title') {
      this.vfxAudio.setMusicMood('title');
      return;
    }
    if (panel === 'death') {
      this.vfxAudio.setMusicMood('defeat');
      return;
    }
    if (panel === 'victory') {
      this.vfxAudio.setMusicMood('victory');
      return;
    }
    if (this.zoneMode === 'sanctuary') {
      this.vfxAudio.setMusicMood('sanctuary');
      return;
    }
    if (evStatus.butcherActive || evStatus.goblinActive) {
      this.vfxAudio.setMusicMood('invasion');
      return;
    }

    const activeBoss = this.bosses.getActiveBoss();
    const pPos = this.playerCtrl.state.position;
    if (
      activeBoss &&
      activeBoss.entity.alive &&
      (this.zoneMode === 'colosseum' || distXZ(pPos, activeBoss.entity.position) < 28)
    ) {
      this.vfxAudio.setMusicMood('boss');
      return;
    }

    const living = this.getAllCombatTargets();
    const inCombat = living.some((e) => e.id !== 'training_dummy' && distXZ(pPos, e.position) < 16);
    const mood: MusicMood =
      inCombat ||
      this.quests.getCursedEvent()?.active ||
      evStatus.riftState?.active ||
      evStatus.escortState?.active ||
      this.zoneMode === 'colosseum'
        ? 'combat'
        : 'explore';
    this.vfxAudio.setMusicMood(mood);
  }

  private onFixedUpdate(dt: number): void {
    if (!this.currentFloor) return;
    if (this.critChainCooldownSec > 0) {
      this.critChainCooldownSec = Math.max(0, this.critChainCooldownSec - dt);
    }

    const elapsedSec = performance.now() * 0.001;

    if (!this.runActive) {
      this.heroRig.update(dt, 0);
      this.sanctuaryHub.update(dt, elapsedSec, this.currentFloor.playerSpawn);
      this.lighting.update(dt, this.currentFloor.playerSpawn);
      this.cameraRig.update(dt);
      this.vfxAudio.update(dt, this.currentFloor.playerSpawn);
      return;
    }

    const activePanel = this.menus.getActivePanel();
    if (activePanel === 'pause' || activePanel === 'victory' || activePanel === 'obelisk') {
      return;
    }

    if (this.portalWarpPending) {
      this.portalWarpPending.timerSec -= dt;
      this.cameraRig.update(dt);
      this.vfxAudio.update(dt, this.playerCtrl.state.position);
      if (this.portalWarpPending.timerSec <= 0) {
        const { destination, openVictory } = this.portalWarpPending;
        this.portalWarpPending = null;
        if (destination === 'sanctuary') {
          this.loadSanctuaryHub(false);
        } else if (destination === 'colosseum') {
          this.loadColosseumArena();
        } else {
          this.highestFloorUnlocked = Math.max(this.highestFloorUnlocked, destination);
          this.loadDungeonFloor(destination);
        }
        this.heroRig.playEquipFlourish?.('epic');
        if (openVictory) {
          this.menus.openPanel('victory');
          this.syncMenusData();
          this.vfxAudio.setMusicMood('victory');
        }
      }
      return;
    }

    const player = this.playerCtrl.state;
    const uiBlocking = this.isUiBlockingGameplay();

    if (this.touchControls) {
      const ts = this.touchControls.getState();
      this.playerCtrl.setVirtualMoveInput(ts.moveX, -ts.moveY);
    }

    const groundTarget = this.cameraRig.screenToGroundWorld(
      this.cursorClientX,
      this.cursorClientY,
      0,
    );
    this.playerCtrl.setCursorWorldTarget(groundTarget);

    this.skills.update(dt);
    const actions = this.playerCtrl.update(dt, this.currentFloor, uiBlocking);
    const speedNorm = clamp(
      Math.hypot(player.velocity.x, player.velocity.z) / Math.max(1, player.stats.moveSpeed),
      0,
      1.5,
    );
    this.heroRig.update(dt, speedNorm);

    // Tick Co-op Social Emotes, Bleedout & Teammate Revive Channeling
    this.socialEmotes.update(dt, elapsedSec, player.position);
    const downedPeers = this.netTransport.getRemotePeers().filter((p) => p.downed);
    if (downedPeers.length > 0 && !this.socialEmotes.getLocalDownedState().isDowned) {
      const rev = this.socialEmotes.tryChannelTeammateRevive(
        dt,
        player.position,
        downedPeers,
        this.holdingInteractKey,
      );
      if (rev.channelingPeerId) {
        this.heroRig.playSocialEmote?.('revive_channel');
      }
      if (rev.completedPeerId) {
        const conn = this.netTransport.getConnectionInfo();
        this.netTransport.broadcast(
          {
            type: 'revive_complete',
            saviorPeerId: conn.localPeerId,
            revivedPeerId: rev.completedPeerId,
          },
          true,
        );
        this.hud.showToast('Đã Hồi Sinh Đồng Đội!', 'legendary');
      }
    }

    // Check if local Co-op Downed Bleedout expired without rescue
    const localDowned = this.socialEmotes.getLocalDownedState();
    if (localDowned.isDowned && localDowned.bleedoutRemainingSec <= 0.02) {
      player.hp = 0;
      player.alive = false;
    }

    const allTargets = this.getAllCombatTargets();

    if (actions.parryRequested && !uiBlocking) {
      const parryRes = this.mastery.triggerParry(player, allTargets, this.combat);
      if (parryRes.started) {
        this.heroRig.playParryAnim?.(parryRes.instantCountered > 0);
        triggerRustHaptic(parryRes.instantCountered > 0 ? 45 : 20);
      }
    }
    if (actions.awakeningRequested && !uiBlocking) {
      if (this.mastery.triggerAwakening(player)) {
        this.skills.scaleActiveCooldowns(0.5);
        this.syncPlayerStatsAndVisuals();
        this.hud.showBanner(
          'THỨC TỈNH VỰC THẲM BÙNG NỔ',
          'Đôi Cánh Archon Hiện Hình — Tốc Độ & Sức Mạnh Tối Thượng!',
          'arcane',
        );
      }
    }

    if (actions.castSlotRequested !== null && !uiBlocking) {
      this.executeSkillCast(actions.castSlotRequested);
    }
    if (actions.interactRequested && !uiBlocking) {
      this.handleInteract(this.findNearbyInteractable());
    }

    if (this.zoneMode === 'sanctuary') {
      this.sanctuaryHub.update(dt, elapsedSec, player.position);
      this.combat.tickStatuses(dt, player, allTargets);
      this.combat.updateProjectiles(dt, this.currentFloor, player, allTargets);
      this.companions.update(
        dt,
        elapsedSec,
        player,
        this.currentFloor,
        [],
        this.loot,
        this.combat,
        true,
      );
      this.mastery.update(dt, elapsedSec, player, allTargets, null, this.combat);
    } else {
      const hazardOut = this.hazards.update(dt, player.position);
      for (const dmgEv of hazardOut.playerDamageEvents) {
        if (!this.godMode && player.alive) {
          this.combat.applyDamageToPlayer(player, {
            sourceId: 'hazard',
            targetId: player.id,
            baseAmount: dmgEv.amount,
            damageType: dmgEv.type,
            critChance: 0,
            critMultiplier: 1.5,
            appliesStatus: dmgEv.status
              ? { type: dmgEv.status, chance: 0.85, durationSec: 3.5, potency: 8 }
              : undefined,
          });
        }
      }

      const cursedStep = this.quests.updateCursedEvent(dt);
      if (cursedStep.spawnWaveAt) {
        this.enemyAI.spawnWaveAt(
          cursedStep.spawnWaveAt,
          4 + Math.max(1, this.currentFloor.floorNumber),
          Math.max(1, this.currentFloor.floorNumber),
          'cursed_event',
          this.engine.scene,
          this.enemyMeshes,
          this.materials,
        );
      }
      if (cursedStep.eventCompleted) {
        this.loot.spawnChestLoot(player.position, this.currentFloor.floorNumber + 1, true);
        this.decorateDroppedItemsWithSetsAndSockets();
      }

      const prevEscortCompleted = this.worldEvents.getStatus().escortState?.completed ?? false;
      const prevRiftActive = this.worldEvents.getStatus().riftState?.active ?? false;

      this.combat.tickStatuses(dt, player, allTargets);
      this.combat.updateProjectiles(dt, this.currentFloor, player, allTargets);
      this.enemyAI.update(dt, player, this.currentFloor, this.combat);
      this.bosses.update(dt, player, this.currentFloor, this.combat, this.enemyAI);
      this.worldEvents.update(
        dt,
        elapsedSec,
        player,
        this.currentFloor,
        this.combat,
        this.enemyAI,
        this.bosses,
      );
      this.companions.update(
        dt,
        elapsedSec,
        player,
        this.currentFloor,
        allTargets,
        this.loot,
        this.combat,
        false,
      );

      const activeBossEntity = this.bosses.getActiveBoss()?.entity ?? null;
      this.mastery.update(dt, elapsedSec, player, allTargets, activeBossEntity, this.combat);

      const postStatus = this.worldEvents.getStatus();
      if (!prevEscortCompleted && postStatus.escortState?.completed) {
        this.loot.spawnChestLoot(player.position, this.currentFloor.floorNumber + 2, true);
        this.decorateDroppedItemsWithSetsAndSockets();
      }
      if (
        prevRiftActive &&
        !postStatus.riftState?.active &&
        (postStatus.riftState?.kills ?? 0) > 0
      ) {
        this.loot.spawnChestLoot(player.position, this.currentFloor.floorNumber + 2, true);
        this.decorateDroppedItemsWithSetsAndSockets();
      }
      if (postStatus.colosseumState) {
        this.colosseumBestWave = Math.max(
          this.colosseumBestWave,
          postStatus.colosseumState.bestWave,
        );
      }
    }

    // Tick 20Hz Network Transport & 3D Spatial Voice Positions
    this.netTransport.update(dt, this.buildLocalNetSnapshot());
    const peerPositions: Record<string, Vec3> = {};
    for (const rp of this.netTransport.getRemotePeers()) {
      peerPositions[rp.peerId] = rp.position;
    }
    this.voiceChat.updateSpatialPositions(dt, player.position, player.rotationY, peerPositions);

    // Re-sync stats smoothly when Awakening Overdrive or Sworn Brethren Co-op Buff toggles
    const nowAwakened = this.mastery.getHudState().awakened;
    const nowBrethren = this.socialEmotes.getSocialBuffState().swornBrethrenSec > 0;
    if (this.wasAwakenedLastTick !== nowAwakened || this.wasSwornBrethrenActive !== nowBrethren) {
      this.wasAwakenedLastTick = nowAwakened;
      this.wasSwornBrethrenActive = nowBrethren;
      this.syncPlayerStatsAndVisuals();
    }

    if (this.godMode) {
      player.hp = player.stats.maxHp;
      player.mana = player.stats.maxMana;
      player.alive = true;
    }

    if ((!player.alive || player.hp <= 0) && !this.deathScreenTriggered) {
      this.deathScreenTriggered = true;
      this.saveCurrentRun();
      this.menus.openPanel('death');
      this.syncMenusData();
    }

    this.cameraRig.setTarget(player.position, false);
    this.cameraRig.update(dt);
    this.lighting.update(dt, player.position);
    this.vfxAudio.update(dt, player.position);
    this.updateAtmosphereAndMusic();
  }

  private onRenderUpdate(dt: number, elapsed: number): void {
    if (!this.currentFloor) return;

    const player = this.playerCtrl.state;
    const focusPos = this.runActive ? player.position : this.currentFloor.playerSpawn;

    this.materials.updateShaders?.(elapsed, focusPos);
    this.dungeonMesh.setPlayerPosition?.(focusPos);
    this.dungeonMesh.update(dt, elapsed);
    if ('updateFrustumCulling' in this.dungeonMesh) {
      (this.dungeonMesh as unknown as { updateFrustumCulling(c: THREE.Camera): void }).updateFrustumCulling(
        this.cameraRig.camera,
      );
    }
    if ('updateLOD' in this.enemyMeshes) {
      (this.enemyMeshes as unknown as { updateLOD(p: THREE.Vector3, t: PerformanceTier): void }).updateLOD(
        this.cameraRig.camera.position,
        this.activePerformanceTier,
      );
    }

    const peers = this.netTransport.getRemotePeers();
    const peerVoiceMap: Record<string, PeerVoiceState> = {};
    for (const p of peers) {
      peerVoiceMap[p.peerId] = this.voiceChat.getPeerVoiceState(p.peerId);
    }

    // Update 120Hz Interpolated Remote Hero Avatars & Overhead Speech/Emoji/Ping Overlays
    this.remoteAvatars.syncPeers(peers);
    this.remoteAvatars.update(dt, elapsed, peerVoiceMap, (worldPos) =>
      this.cameraRig.worldToScreen(worldPos),
    );

    const nearbyInvite = this.socialEmotes.getNearbyPendingInvite(focusPos);
    const activePanel = this.menus.getActivePanel();
    const gameplayHudActive = this.runActive && activePanel === 'none' && !this.mpUI.isLobbyOpen();
    this.touchControls?.setVisible(gameplayHudActive);
    (this.mpUI as unknown as { setHudVisible?(v: boolean): void }).setHudVisible?.(
      this.runActive && activePanel === 'none',
    );

    this.mpUI.update(dt, {
      connection: this.netTransport.getConnectionInfo(),
      peers,
      localVoice: this.voiceChat.getLocalState(),
      peerVoice: peerVoiceMap,
      socialBuff: this.socialEmotes.getSocialBuffState(),
      downedState: this.socialEmotes.getLocalDownedState(),
      nearbyInviteName: nearbyInvite?.fromName ?? null,
    });

    if (this.runActive) {
      this.loot.update(dt, elapsed, player);

      const equippedSkills = this.skills.getEquippedSkills(player.heroClass);
      const skillHudList = equippedSkills.map((def, idx) => {
        const cd = this.skills.getCooldownState((def.slotHint ?? idx) as SkillSlotIndex);
        return {
          def,
          remainingCd: cd.remaining,
          totalCd: cd.total,
          ready: cd.ready,
        };
      });

      const stats = this.engine.getStats();
      const allLiving = this.getAllCombatTargets();

      this.hud.update(
        dt,
        {
          player,
          skills: skillHudList,
          floor: this.currentFloor,
          enemies: allLiving,
          groundDrops: this.loot.getGroundDrops(),
          boss: this.bosses.getActiveBoss(),
          quests: this.quests.getActiveQuests(),
          cursedEvent: this.quests.getCursedEvent(),
          combo: this.combat.getComboState(),
          nearbyInteractable: this.findNearbyInteractable(),
          fps: stats.fps,
          engineStats: stats,
          mastery: this.mastery.getHudState(),
          worldEvents: this.worldEvents.getStatus(),
          companions: this.companions.getState(),
          dummyMetrics:
            this.zoneMode === 'sanctuary' ? this.sanctuaryHub.getDummyMetrics() : undefined,
          inSanctuary: this.zoneMode === 'sanctuary',
        },
        (worldPos) => this.cameraRig.worldToScreen(worldPos),
      );

      this.debugOverlay.update(
        {
          stats,
          player,
          floor: this.currentFloor,
          activeEnemyCount: allLiving.length,
          godMode: this.godMode,
        },
        dt,
      );

      this.menusRefreshTimer += dt;
      if (this.menus.getActivePanel() !== 'none' && this.menusRefreshTimer >= 0.2) {
        this.menusRefreshTimer = 0;
        this.syncMenusData();
      }
    }
  }
}

const app = new AbyssalRealmsApp();
app.bootstrap();
