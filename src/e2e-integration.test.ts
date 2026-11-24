import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createMaterialLibrary } from './modules/materials';
import { createLightingDirector } from './modules/lighting';
import { createHeroRig } from './modules/hero-model';
import { createPlayerController } from './modules/player';
import { createSkillSystem } from './modules/skills';
import { createDungeonGenerator } from './modules/dungeon';
import { createDungeonMeshBuilder } from './modules/world-mesh';
import { createHazardSystem } from './modules/hazards';
import { createCombatEngine } from './modules/combat';
import { createEnemyMeshFactory } from './modules/enemy-meshes';
import { createEnemyAISystem } from './modules/ai';
import { createBossDirector } from './modules/bosses';
import { LootSystem } from './modules/loot';
import { createQuestSystem } from './modules/quests';
import { createVfxAudioSystem } from './modules/vfx-audio';
import { createBalanceValidator } from './modules/integration';
import { createSanctuaryHub } from './modules/hub';
import { createRunewordSystem } from './modules/runewords';
import { createCompanionSystem } from './modules/companions';
import { createWorldEventSystem } from './modules/events';
import { createCombatMasterySystem } from './modules/mastery';
import { createMultiplayerTransport } from './modules/net-core';
import { createVoiceChatSystem } from './modules/net-voice';
import { createSocialInteractionSystem } from './modules/emotes';
import { createRemoteAvatarManager } from './modules/net-avatars';

describe('Abyssal Realms — Full 25-Module Expansion Cross-System Integration', () => {
  it('integrates Sanctuary Hub, Floors 1–6, Colosseum Twin-Bosses, Runewords, Companions, Mastery & World Events', () => {
    const scene = new THREE.Scene();
    const materials = createMaterialLibrary();
    const lighting = createLightingDirector();
    const heroRig = createHeroRig('vanguard');
    const playerCtrl = createPlayerController();
    const skills = createSkillSystem();
    const dungeonGen = createDungeonGenerator();
    const dungeonMesh = createDungeonMeshBuilder();
    const hazards = createHazardSystem();
    const combat = createCombatEngine();
    const enemyMeshes = createEnemyMeshFactory();
    const enemyAI = createEnemyAISystem();
    const bosses = createBossDirector();
    const loot = new LootSystem(1337);
    const quests = createQuestSystem();
    const vfxAudio = createVfxAudioSystem();
    const validator = createBalanceValidator();

    const sanctuaryHub = createSanctuaryHub();
    const runewords = createRunewordSystem();
    const companions = createCompanionSystem();
    const worldEvents = createWorldEventSystem();
    const mastery = createCombatMasterySystem();

    lighting.init(scene);
    combat.init(scene);
    bosses.init(scene);
    loot.init(scene);
    vfxAudio.init(scene);
    companions.init(scene, materials);
    worldEvents.init(scene, materials, enemyMeshes);
    mastery.init(scene);
    scene.add(heroRig.root);

    // 1. Verify Map 0: Sanctuary Hub + Immortal Training Dummy + Runeword Forging
    const hubFloor = sanctuaryHub.generateSanctuaryFloor();
    expect(hubFloor.biome).toBe('sanctuary');
    expect(validator.validateFloor(hubFloor).valid).toBe(true);
    const hubGroup = dungeonMesh.buildFloor(hubFloor, materials);
    scene.add(hubGroup);
    sanctuaryHub.populateHubScene(hubFloor, scene, materials);

    playerCtrl.init('vanguard', hubFloor.playerSpawn, heroRig);
    companions.respawnAt(hubFloor.playerSpawn, 1);

    const dummy = sanctuaryHub.getTrainingDummyEntity();
    expect(dummy).not.toBeNull();
    if (dummy) {
      const hitRes = combat.applyDamageToEnemy(dummy, {
        sourceId: 'player',
        targetId: dummy.id,
        baseAmount: 250,
        damageType: 'fire',
        critChance: 1.0,
        critMultiplier: 2.0,
      });
      expect(hitRes.killed).toBe(false);
      expect(dummy.alive).toBe(true);
      sanctuaryHub.recordDummyDamage(hitRes.finalDamage, hitRes.isCrit);
      expect(sanctuaryHub.getDummyMetrics().totalDamage).toBeGreaterThan(0);
    }

    // Forge Enigma Runeword ('jah', 'ist', 'ber') on a Mythic Chestpiece
    const mythicChest = loot.generateMythicItem!(10, 'chest');
    expect(mythicChest.isMythic).toBe(true);
    mythicChest.sockets = 3;
    mythicChest.socketedRunes = [];
    runewords.grantRune('jah', 1);
    runewords.grantRune('ist', 1);
    runewords.grantRune('ber', 1);
    runewords.socketRuneIntoItem(mythicChest, 'jah');
    runewords.socketRuneIntoItem(mythicChest, 'ist');
    const forged = runewords.socketRuneIntoItem(mythicChest, 'ber');
    expect(forged.formedRuneword).toBeDefined();

    scene.remove(hubGroup);
    sanctuaryHub.dispose();
    dungeonMesh.dispose();

    // 2. Verify Campaign Floors 1–6 (Crypt, Caverns, Forge, Void, Cathedral of Rime, Astral Observatory)
    for (const floorNum of [1, 2, 3, 4, 5, 6]) {
      const floor = dungeonGen.generateFloor(floorNum, 2000 + floorNum * 97);
      const report = validator.validateFloor(floor);
      expect(report.valid).toBe(true);

      const group = dungeonMesh.buildFloor(floor, materials);
      scene.add(group);
      lighting.applyBiome(floor.biome, floor.torchPositions);
      hazards.populateFloor(floor, scene, materials);

      const enemies = enemyAI.spawnFloorEnemies(floor, scene, enemyMeshes, materials);
      expect(enemies.length).toBeGreaterThan(0);

      const boss = bosses.spawnFloorBoss(floor, enemyMeshes, materials);
      expect(boss.isBoss).toBe(true);
      expect(boss.hp).toBeGreaterThan(0);

      worldEvents.initFloorEvents(floor);
      quests.initFloorQuests(floor);

      const heroClass = floorNum % 3 === 1 ? 'vanguard' : floorNum % 3 === 2 ? 'shadowblade' : 'arcanist';
      loot.setupStarterGear(heroClass);
      playerCtrl.init(heroClass, floor.playerSpawn, heroRig);
      companions.respawnAt(floor.playerSpawn, floorNum * 3);

      // Test Awakening [R] & Parry [V] on Floor 5
      if (floorNum === 5) {
        expect(floor.biome).toBe('cathedral');
        mastery.addFury(100);
        expect(mastery.triggerAwakening(playerCtrl.state)).toBe(true);
        heroRig.setAwakenedVisual?.(true);
        mastery.triggerParry(playerCtrl.state, enemies, combat);
      }
      if (floorNum === 6) {
        expect(floor.biome).toBe('observatory');
      }

      for (let step = 0; step < 10; step++) {
        const dt = 1 / 60;
        skills.update(dt);
        playerCtrl.update(dt, floor, false);
        heroRig.update(dt, 0.5);
        hazards.update(dt, playerCtrl.state.position);
        const targets = [...enemyAI.getLivingEnemies(), ...worldEvents.getEventCombatEntities(), boss];
        combat.tickStatuses(dt, playerCtrl.state, targets);
        combat.updateProjectiles(dt, floor, playerCtrl.state, targets);
        enemyAI.update(dt, playerCtrl.state, floor, combat);
        bosses.update(dt, playerCtrl.state, floor, combat, enemyAI);
        worldEvents.update(dt, step * dt, playerCtrl.state, floor, combat, enemyAI, bosses);
        companions.update(dt, step * dt, playerCtrl.state, floor, targets, loot, combat, false);
        mastery.update(dt, step * dt, playerCtrl.state, targets, boss, combat);
        loot.update(dt, step * dt, playerCtrl.state);
        materials.updateShaders?.(step * dt, playerCtrl.state.position);
        dungeonMesh.setPlayerPosition?.(playerCtrl.state.position);
        dungeonMesh.update(dt, step * dt);
      }

      scene.remove(group);
      dungeonMesh.dispose();
      hazards.dispose();
      combat.clearFloorEntities();
      enemyAI.clear();
      bosses.clear();
      worldEvents.clear();
      mastery.resetFloor();
      loot.clearGroundDrops();
    }

    // 3. Verify Crimson Bloodhunt Colosseum + Twin-Boss Showdown
    const colFloor = dungeonGen.generateColosseumFloor!(1, 8888);
    expect(colFloor.biome).toBe('colosseum');
    expect(validator.validateFloor(colFloor).valid).toBe(true);
    const twinBosses = bosses.spawnColosseumBosses!(colFloor, 5, enemyMeshes, materials);
    expect(twinBosses.length).toBe(2);

    // 4. Verify Phase 4 Online Co-op Transport, Spatial Voice, Remote Avatars & Paired Emotes
    const netTransport = createMultiplayerTransport();
    const voiceChat = createVoiceChatSystem();
    const socialEmotes = createSocialInteractionSystem();
    const remoteAvatars = createRemoteAvatarManager();

    socialEmotes.init(scene);
    remoteAvatars.init(scene);

    const botPeerId = netTransport.spawnSimulatedPartner('arcanist');
    expect(botPeerId).toBeTruthy();

    heroRig.playSocialEmote?.('dance');
    socialEmotes.triggerSoloEmote('dance', playerCtrl.state.position);

    // Simulate Paired 2-Player Blade Clash -> Sworn Brethren Buff!
    socialEmotes.receiveRemotePairedRequest(
      botPeerId,
      'Seraphina',
      'blade_clash',
      { ...playerCtrl.state.position },
    );
    const clashRes = socialEmotes.requestPairedHighFive(
      playerCtrl.state.position,
      'local_hero',
      'Vanguard',
    );
    expect(clashRes.acceptedImmediatePeerId).toBe(botPeerId);
    if (clashRes.midpoint) {
      socialEmotes.executePairedCelebration(clashRes.midpoint, playerCtrl.state.position);
    }
    expect(socialEmotes.getSocialBuffState().swornBrethrenSec).toBeGreaterThan(0);

    // Simulate Co-op Downed State & Revival + 120Hz Remote Avatar & Spatial Voice Update
    socialEmotes.enterDownedState(playerCtrl.state);
    expect(socialEmotes.getLocalDownedState().isDowned).toBe(true);
    socialEmotes.reviveLocalPlayer(playerCtrl.state, 'Seraphina');
    expect(socialEmotes.getLocalDownedState().isDowned).toBe(false);

    for (let tick = 0; tick < 10; tick++) {
      const dt = 1 / 60;
      netTransport.update(dt, {
        peerId: 'local_hero',
        nickname: 'Vanguard',
        isHost: true,
        heroClass: 'vanguard',
        level: 10,
        hp: 200,
        maxHp: 200,
        position: { ...playerCtrl.state.position },
        velocity: { x: 0, y: 0, z: 0 },
        rotationY: 0,
        animState: 'idle',
        weaponVisual: 'greatsword',
        awakened: false,
        downed: false,
        pingMs: 0,
      });
      const peers = netTransport.getRemotePeers();
      expect(peers.length).toBeGreaterThan(0);
      voiceChat.injectSimulatedVoiceLevel(peers[0].peerId, 0.8);
      voiceChat.updateSpatialPositions(dt, playerCtrl.state.position, 0, {
        [peers[0].peerId]: peers[0].position,
      });
      remoteAvatars.syncPeers(peers);
      remoteAvatars.spawnEmojiBurst(peers[0].peerId, 'crown_gg', peers[0].position);
      remoteAvatars.spawnTacticalPing(peers[0].peerId, 'Seraphina', 'attack', peers[0].position);
      remoteAvatars.update(
        dt,
        tick * dt,
        { [peers[0].peerId]: voiceChat.getPeerVoiceState(peers[0].peerId) },
        () => ({ x: 400, y: 300, visible: true }),
      );
      socialEmotes.update(dt, tick * dt, playerCtrl.state.position);
    }

    remoteAvatars.dispose();
    socialEmotes.dispose();
    voiceChat.dispose();
    netTransport.dispose();
    bosses.dispose();
    companions.dispose();
    worldEvents.dispose();
    mastery.dispose();
    heroRig.dispose();
    lighting.dispose();
    combat.dispose();
    loot.dispose();
    vfxAudio.dispose();
    materials.dispose();
  });
});
