import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ISocialInteractionSystem,
  PlayerRuntimeState,
  RemotePeerSnapshot,
  SocialEmoteId,
  Vec3,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import {
  CAMARADERIE_INVITE_RADIUS_M,
  createSocialInteractionSystem,
  DOWNED_BLEEDOUT_TOTAL_SEC,
  EMOTE_DURATIONS_SEC,
  REVIVE_CHANNEL_DURATION_SEC,
  SocialInteractionSystem,
  SWORN_BRETHREN_DURATION_SEC,
} from './index';

function makePlayer(pos: Vec3 = { x: 0, y: 0, z: 0 }, maxHp = 200): PlayerRuntimeState {
  return {
    id: 'player',
    heroClass: 'vanguard',
    name: 'Aurelius',
    level: 8,
    xp: 0,
    xpToNextLevel: 400,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    position: { ...pos },
    velocity: { x: 2, y: 0, z: -1 },
    facingDir: { x: 0, y: 0, z: 1 },
    rotationY: 0,
    radius: 0.45,
    hp: maxHp,
    mana: 80,
    stamina: 100,
    baseAttributes: { strength: 18, dexterity: 12, intelligence: 10, vitality: 16 },
    stats: {
      maxHp,
      hpRegen: 2,
      maxMana: 100,
      manaRegen: 4,
      maxStamina: 100,
      staminaRegen: 15,
      moveSpeed: 6.5,
      attackPower: 55,
      spellPower: 40,
      armor: 30,
      critChance: 0.25,
      critMultiplier: 1.8,
      attackSpeed: 1.15,
      cooldownReduction: 0.1,
      lifeSteal: 0.05,
      dodgeChance: 0.05,
    },
    statuses: [
      {
        id: 'burn_1',
        type: 'burn',
        remainingSec: 3,
        durationSec: 3,
        stacks: 1,
        potency: 8,
        sourceId: 'enemy_1',
      },
    ],
    isDodging: false,
    invulnerableSec: 0,
    alive: true,
    healthPotions: 3,
    maxHealthPotions: 5,
    potionCooldownSec: 0,
    gold: 250,
    floorsCleared: 2,
    killsTotal: 42,
  };
}

function makeRemotePeer(
  peerId: string,
  pos: Vec3,
  downed = false,
  nickname = 'Seraphina',
): RemotePeerSnapshot {
  return {
    peerId,
    nickname,
    isHost: false,
    heroClass: 'arcanist',
    level: 8,
    hp: downed ? 1 : 180,
    maxHp: 180,
    position: { ...pos },
    velocity: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    animState: 'idle',
    socialEmote: downed ? 'downed_kneel' : null,
    weaponVisual: 'staff',
    weaponRarity: 'epic',
    awakened: false,
    downed,
    downedBleedoutSec: downed ? 12.0 : undefined,
    pingMs: 32,
  };
}

describe('SocialInteractionSystem', () => {
  let scene: THREE.Scene;
  let system: ISocialInteractionSystem;

  beforeEach(() => {
    scene = new THREE.Scene();
    system = createSocialInteractionSystem();
    system.init(scene);
  });

  afterEach(() => {
    system.dispose();
  });

  it('triggers all 8 solo emotes with auto-duration, 3D holographic rings/sparkles, and mp:socialEmote events', () => {
    expect(system).toBeInstanceOf(SocialInteractionSystem);
    const vfxRoot = scene.getObjectByName('SocialInteractionVfxRoot');
    expect(vfxRoot).toBeDefined();

    const soloEmotes: SocialEmoteId[] = [
      'wave',
      'cheer',
      'dance',
      'taunt',
      'kneel_pray',
      'sit_rest',
      'laugh',
      'point',
    ];

    const emitted: Array<{ emoteId: SocialEmoteId; position: Vec3 }> = [];
    const unsub = eventBus.on('mp:socialEmote', (payload) => {
      emitted.push(payload);
    });

    const holoGroup = scene.getObjectByName('SoloEmoteHologramGroup') as THREE.Group;
    expect(holoGroup).toBeDefined();
    expect(holoGroup.visible).toBe(false);

    for (let i = 0; i < soloEmotes.length; i++) {
      const emoteId = soloEmotes[i];
      const pos = { x: i * 2, y: 0, z: -i };
      system.triggerSoloEmote(emoteId, pos);

      expect(system.getLocalActiveEmote()).toBe(emoteId);
      expect(holoGroup.visible).toBe(true);
      expect(holoGroup.position.x).toBe(pos.x);
      expect(holoGroup.position.z).toBe(pos.z);
    }

    expect(emitted).toHaveLength(soloEmotes.length);
    expect(emitted[0].emoteId).toBe('wave');
    expect(emitted[soloEmotes.length - 1].emoteId).toBe('point');

    // Point has auto-duration 2.2s: stays active mid-way, clears after duration elapses
    const pointDuration = EMOTE_DURATIONS_SEC.point;
    system.update(pointDuration * 0.5, 1.0, { x: 4, y: 0, z: 2 });
    expect(system.getLocalActiveEmote()).toBe('point');
    expect(holoGroup.position.x).toBe(4);
    expect(holoGroup.visible).toBe(true);

    system.update(pointDuration * 0.6, 2.5, { x: 4, y: 0, z: 2 });
    expect(system.getLocalActiveEmote()).toBeNull();
    expect(holoGroup.visible).toBe(false);

    unsub();
  });

  it('spawns a 3.8m golden Camaraderie Invitation Ring for 6s and accepts remote invites within 4.2m at midpoint', () => {
    const emoteEvents: SocialEmoteId[] = [];
    const unsub = eventBus.on('mp:socialEmote', ({ emoteId }) => {
      emoteEvents.push(emoteId);
    });

    // Player A presses [H] with no nearby invite -> spawns 3.8m ring for 6s
    const initRes = system.requestPairedHighFive({ x: 10, y: 0, z: 10 }, 'peer-a', 'Aurelius');
    expect(initRes.acceptedImmediatePeerId).toBeUndefined();
    expect(initRes.midpoint).toBeUndefined();
    expect(system.getLocalActiveEmote()).toBe('high_five_ready');
    expect(emoteEvents).toContain('high_five_ready');

    const ringGroup = scene.getObjectByName('CamaraderieInviteRing_0') as THREE.Group;
    const disc38m = ringGroup.getObjectByName('CamaraderieDisc38m') as THREE.Mesh;
    expect(ringGroup.visible).toBe(true);
    expect(disc38m.scale.x).toBeCloseTo(CAMARADERIE_INVITE_RADIUS_M, 5);

    // Expires cleanly after 6.0s
    system.update(6.1, 6.1, { x: 10, y: 0, z: 10 });
    expect(system.getLocalActiveEmote()).toBeNull();
    expect(ringGroup.visible).toBe(false);

    // Remote teammate sends paired invite at (13.6, 0, 10) -> 3.6m away (<= 4.2m)
    system.receiveRemotePairedRequest('peer-b', 'Seraphina', 'blade_clash', {
      x: 13.6,
      y: 0,
      z: 10,
    });

    // Far away position (> 4.2m) sees no nearby invite
    expect(system.getNearbyPendingInvite({ x: 20, y: 0, z: 10 })).toBeNull();

    // Nearby position (3.6m <= 4.2m) detects pending invite
    const nearby = system.getNearbyPendingInvite({ x: 10, y: 0, z: 10 });
    expect(nearby).not.toBeNull();
    expect(nearby?.fromPeerId).toBe('peer-b');
    expect(nearby?.fromName).toBe('Seraphina');

    // Pressing [H] within 4.2m immediately accepts at midpoint!
    const acceptRes = system.requestPairedHighFive({ x: 10, y: 0, z: 10 }, 'peer-a', 'Aurelius');
    expect(acceptRes.acceptedImmediatePeerId).toBe('peer-b');
    expect(acceptRes.midpoint).toEqual({ x: 11.8, y: 0, z: 10 });
    expect(system.getLocalActiveEmote()).toBe('high_five_strike');
    expect(system.getNearbyPendingInvite({ x: 10, y: 0, z: 10 })).toBeNull();

    unsub();
  });

  it('erupts 3D Fresnel shockwave + twin light blades + sparks, emits mp:highFiveClash, and grants 60s Sworn Brethren buff', () => {
    // Baseline social buff multipliers are 1.0 when inactive
    expect(system.getSocialBuffState()).toEqual({
      swornBrethrenSec: 0,
      xpGoldMultiplier: 1.0,
      moveSpeedBonus: 1.0,
      powerMultiplier: 1.0,
    });

    const clashes: Vec3[] = [];
    const unsub = eventBus.on('mp:highFiveClash', ({ position }) => {
      clashes.push(position);
    });

    const midpoint: Vec3 = { x: 6, y: 0, z: -4 };
    const localPos: Vec3 = { x: 5, y: 0, z: -4 };
    system.executePairedCelebration(midpoint, localPos);

    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toEqual(midpoint);

    // Verify 3D Golden Fresnel Shockwave + Twin Crossing Light Blades +Sworn Brethren Aura
    const clashGroup = scene.getObjectByName('PairedClashCelebrationGroup') as THREE.Group;
    const twinBlades = scene.getObjectByName('TwinCrossingLightBlades') as THREE.Group;
    const swornGroup = scene.getObjectByName('SwornBrethrenAuraGroup') as THREE.Group;
    expect(clashGroup.visible).toBe(true);
    expect(clashGroup.position.x).toBe(6);
    expect(clashGroup.position.z).toBe(-4);
    expect(twinBlades.children).toHaveLength(2);
    expect(swornGroup.visible).toBe(true);

    const activeBuff = system.getSocialBuffState();
    expect(activeBuff.swornBrethrenSec).toBe(SWORN_BRETHREN_DURATION_SEC);
    expect(activeBuff.xpGoldMultiplier).toBe(1.25);
    expect(activeBuff.moveSpeedBonus).toBe(1.15);
    expect(activeBuff.powerMultiplier).toBe(1.2);

    // Tick halfway (30s) -> buff remains active, transient shockwave finishes cleanly
    system.update(0.6, 0.6, localPos);
    system.update(29.4, 30.0, localPos);
    expect(system.getSocialBuffState().swornBrethrenSec).toBeCloseTo(30.0, 1);
    expect(system.getSocialBuffState().xpGoldMultiplier).toBe(1.25);

    // Tick past 60s -> buff expires back to neutral 1.0 multipliers
    system.update(30.5, 60.5, localPos);
    expect(system.getSocialBuffState()).toEqual({
      swornBrethrenSec: 0,
      xpGoldMultiplier: 1.0,
      moveSpeedBonus: 1.0,
      powerMultiplier: 1.0,
    });
    expect(swornGroup.visible).toBe(false);

    unsub();
  });

  it('handles 15s downed bleedout state, distress beacon ring, and reviveLocalPlayer (65% MaxHP + 3s i-frames + mp:teammateRevived)', () => {
    const player = makePlayer({ x: -3, y: 0, z: 5 }, 200);
    player.hp = 0;
    player.alive = false;

    const revives: Vec3[] = [];
    const emoteCues: SocialEmoteId[] = [];
    const unsub = eventBus.on('mp:teammateRevived', ({ position }) => {
      revives.push(position);
    });
    const unsubEmote = eventBus.on('mp:socialEmote', ({ emoteId }) => {
      emoteCues.push(emoteId);
    });

    system.enterDownedState(player);

    const downed = system.getLocalDownedState();
    expect(downed.isDowned).toBe(true);
    expect(downed.bleedoutRemainingSec).toBe(DOWNED_BLEEDOUT_TOTAL_SEC);
    expect(downed.bleedoutTotalSec).toBe(15.0);
    expect(system.getLocalActiveEmote()).toBe('downed_kneel');
    expect(emoteCues).toContain('downed_kneel');
    expect(player.alive).toBe(true);
    expect(player.hp).toBe(1);
    expect(player.statuses).toHaveLength(0);

    // 3D Crimson-Gold Distress Beacon Ring is active
    const beacon0 = scene.getObjectByName('DownedDistressBeacon_0') as THREE.Group;
    expect(beacon0.visible).toBe(true);

    // Solo emotes cannot override downed_kneel while bleeding out
    system.triggerSoloEmote('dance', player.position);
    expect(system.getLocalActiveEmote()).toBe('downed_kneel');

    // Advance 5s of bleedout
    system.update(5.0, 5.0, player.position);
    expect(system.getLocalDownedState().bleedoutRemainingSec).toBeCloseTo(10.0, 2);

    // Revive local player -> 65% of 200 MaxHP = 130 HP + 3.0s i-frames + mp:teammateRevived!
    system.reviveLocalPlayer(player, 'Seraphina');

    const postRevive = system.getLocalDownedState();
    expect(postRevive.isDowned).toBe(false);
    expect(postRevive.bleedoutRemainingSec).toBe(0);
    expect(postRevive.reviverName).toBe('Seraphina');
    expect(system.getLocalActiveEmote()).toBeNull();

    expect(player.alive).toBe(true);
    expect(player.hp).toBe(130);
    expect(player.invulnerableSec).toBeGreaterThanOrEqual(3.0);
    expect(revives).toHaveLength(1);
    expect(revives[0]).toEqual({ x: -3, y: 0, z: 5 });
    expect(beacon0.visible).toBe(false);

    const ascensionGroup = scene.getObjectByName('ReviveAscensionBurstGroup') as THREE.Group;
    expect(ascensionGroup.visible).toBe(true);

    unsub();
    unsubEmote();
  });

  it('expires downed bleedout after 15.0s if no teammate revives the player', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 }, 250);
    system.enterDownedState(player);
    expect(system.getLocalDownedState().isDowned).toBe(true);

    system.update(15.1, 15.1, player.position);
    expect(system.getLocalDownedState().isDowned).toBe(false);
    expect(system.getLocalDownedState().bleedoutRemainingSec).toBe(0);
    expect(player.alive).toBe(false);
    expect(player.hp).toBe(0);
  });

  it('channels a 3D Golden Celestial Revive Beam within 3.5m for 1.6s to complete teammate revival', () => {
    const localPos: Vec3 = { x: 0, y: 0, z: 0 };
    const farPeer = makeRemotePeer('peer-far', { x: 3.9, y: 0, z: 0 }, true, 'Kaelen');
    const nearPeer = makeRemotePeer('peer-near', { x: 2.8, y: 0, z: 0 }, true, 'Seraphina');

    const revives: Vec3[] = [];
    const emoteCues: SocialEmoteId[] = [];
    const unsub = eventBus.on('mp:teammateRevived', ({ position }) => {
      revives.push(position);
    });
    const unsubEmote = eventBus.on('mp:socialEmote', ({ emoteId }) => {
      emoteCues.push(emoteId);
    });

    const beamGroup = scene.getObjectByName('CelestialReviveBeamGroup') as THREE.Group;

    // Outside 3.5m range -> cannot channel
    const outOfRange = system.tryChannelTeammateRevive(0.5, localPos, [farPeer], true);
    expect(outOfRange).toEqual({
      channelingPeerId: null,
      progress01: 0,
      completedPeerId: null,
    });
    expect(beamGroup.visible).toBe(false);

    // Within 3.5m (2.8m) holding [F] -> channels 3D Golden Celestial Revive Beam!
    const step1 = system.tryChannelTeammateRevive(0.8, localPos, [nearPeer], true);
    expect(step1.channelingPeerId).toBe('peer-near');
    expect(step1.progress01).toBeCloseTo(0.8 / REVIVE_CHANNEL_DURATION_SEC, 2);
    expect(step1.completedPeerId).toBeNull();
    expect(system.getLocalActiveEmote()).toBe('revive_channel');
    expect(emoteCues).toContain('revive_channel');
    expect(beamGroup.visible).toBe(true);

    // Releasing [F] mid-channel cancels cleanly
    const canceled = system.tryChannelTeammateRevive(0.1, localPos, [nearPeer], false);
    expect(canceled).toEqual({
      channelingPeerId: null,
      progress01: 0,
      completedPeerId: null,
    });
    expect(beamGroup.visible).toBe(false);
    expect(system.getLocalActiveEmote()).toBeNull();

    // Full 1.6s channel completes and returns completedPeerId!
    const half = system.tryChannelTeammateRevive(0.8, localPos, [nearPeer], true);
    expect(half.channelingPeerId).toBe('peer-near');
    expect(half.progress01).toBeCloseTo(0.5, 2);

    const finish = system.tryChannelTeammateRevive(0.85, localPos, [nearPeer], true);
    expect(finish.completedPeerId).toBe('peer-near');
    expect(finish.progress01).toBe(1);
    expect(beamGroup.visible).toBe(false);
    expect(revives).toHaveLength(1);
    expect(revives[0]).toEqual({ x: 2.8, y: 0, z: 0 });

    unsub();
    unsubEmote();
  });

  it('disposes all 3D scene objects cleanly and ignores post-dispose calls', () => {
    expect(scene.getObjectByName('SocialInteractionVfxRoot')).toBeDefined();
    system.dispose();
    expect(scene.getObjectByName('SocialInteractionVfxRoot')).toBeUndefined();

    system.triggerSoloEmote('wave', { x: 0, y: 0, z: 0 });
    expect(system.getLocalActiveEmote()).toBeNull();
  });
});
