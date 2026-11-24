import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type {
  GroundLootDrop,
  HeroAnimState,
  HeroClassId,
  ItemRarity,
  SocialEmoteId,
  WeaponVisualType,
} from '../../contracts/types';
import { eventBus } from '../../core/EventBus';
import { createHeroRig, HeroRig } from './index';

describe('HeroRig (src/modules/hero-model)', () => {
  it('creates articulated 3D hierarchy with all required limb & multi-segment cape pivots', () => {
    const rig = createHeroRig('vanguard');
    expect(rig).toBeInstanceOf(HeroRig);
    expect(rig.root).toBeInstanceOf(THREE.Group);

    const requiredPivotNames = [
      'PelvisPivot',
      'TorsoPivot',
      'HeadPivot',
      'RightShoulderPivot',
      'RightElbowPivot',
      'RightHandPivot',
      'LeftShoulderPivot',
      'LeftElbowPivot',
      'LeftHandPivot',
      'RightHipPivot',
      'RightKneePivot',
      'RightBootPivot',
      'LeftHipPivot',
      'LeftKneePivot',
      'LeftBootPivot',
      'CapeSeg0',
      'CapeSeg1',
      'CapeSeg2',
      'CapeSeg3',
      'HeroMainSlashRibbon',
      'HeroOffSlashRibbon',
    ];

    for (const name of requiredPivotNames) {
      expect(rig.root.getObjectByName(name), `Missing pivot ${name}`).toBeDefined();
    }

    rig.dispose();
  });

  it('switches cleanly across all 3 HeroClassId styles with distinct silhouettes', () => {
    const rig = createHeroRig('vanguard');
    const classes: HeroClassId[] = ['vanguard', 'shadowblade', 'arcanist'];

    for (const cls of classes) {
      rig.setClassStyle(cls);
      let meshCount = 0;
      rig.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          meshCount++;
        }
      });
      expect(meshCount).toBeGreaterThan(25);
    }

    rig.dispose();
  });

  it('swaps all 5 WeaponVisualType models and scales rune emissive glow by ItemRarity', () => {
    const rig = createHeroRig('vanguard');
    const weapons: WeaponVisualType[] = [
      'greatsword',
      'daggers',
      'staff',
      'warhammer',
      'sword_shield',
    ];
    const rarities: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

    for (const w of weapons) {
      rig.setWeaponVisual(w, 'rare');
      const tip = rig.getWeaponTipWorldPosition();
      expect(Number.isFinite(tip.x)).toBe(true);
      expect(Number.isFinite(tip.y)).toBe(true);
      expect(Number.isFinite(tip.z)).toBe(true);

      if (w === 'staff') {
        expect(rig.root.getObjectByName('StaffFloatingCrystalOrb')).toBeDefined();
      }
      if (w === 'daggers') {
        expect(rig.root.getObjectByName('OffWeaponTip')).toBeDefined();
      }
    }

    const intensities: number[] = [];
    for (const rarity of rarities) {
      rig.setWeaponVisual('greatsword', rarity);
      // Let materialize flash decay so we measure steady-state rarity rune intensity
      for (let i = 0; i < 10; i++) {
        rig.update(0.05, 0);
      }
      const socket = rig.root.getObjectByName('MainWeaponSocket')!;
      let maxEmissive = 0;
      socket.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          maxEmissive = Math.max(maxEmissive, child.material.emissiveIntensity);
        }
      });
      intensities.push(maxEmissive);
    }

    for (let i = 1; i < intensities.length; i++) {
      expect(intensities[i]).toBeGreaterThan(intensities[i - 1]);
    }

    rig.dispose();
  });

  it('animates all 11 HeroAnimState states, flashHit, and weapon tip world tracking', () => {
    const rig = createHeroRig('shadowblade');
    rig.root.position.set(10, 0, -5);
    rig.root.rotation.y = Math.PI / 3;

    const states: HeroAnimState[] = [
      'idle',
      'run',
      'dodge',
      'attack_1',
      'attack_2',
      'attack_3',
      'whirlwind',
      'leap_slam',
      'cast',
      'hit',
      'death',
    ];

    const tipOut = new THREE.Vector3();
    for (const state of states) {
      rig.playAnim(state, 1.1);
      for (let step = 0; step < 8; step++) {
        rig.update(1 / 60, state === 'run' ? 0.9 : 0.0);
      }
      const tip = rig.getWeaponTipWorldPosition(tipOut);
      expect(tip).toBe(tipOut);
      expect(Number.isFinite(tip.x) && Number.isFinite(tip.y) && Number.isFinite(tip.z)).toBe(
        true,
      );
      expect(tip.distanceTo(rig.root.position)).toBeLessThan(4.0);
    }

    rig.playAnim('idle');
    rig.update(0.1, 0);
    rig.flashHit(0xff3333);
    rig.update(0.2, 0);

    rig.dispose();
    rig.dispose();
  });

  it('generates 3D GPU weapon ribbon trails during attacks, flourishes, and EventBus hooks', () => {
    const rig = createHeroRig('vanguard') as HeroRig;
    rig.root.position.set(4, 0, 2);

    const mainRibbon = rig.root.getObjectByName('HeroMainSlashRibbon') as THREE.Mesh;
    const offRibbon = rig.root.getObjectByName('HeroOffSlashRibbon') as THREE.Mesh;
    expect(mainRibbon.material).toBeInstanceOf(THREE.ShaderMaterial);

    // 1. Attack slash automatically emits GPU ribbon geometry
    rig.playAnim('attack_1', 1.0);
    for (let i = 0; i < 12; i++) {
      rig.update(1 / 60, 0);
    }
    expect(mainRibbon.visible).toBe(true);
    expect(mainRibbon.geometry.drawRange.count).toBeGreaterThan(0);

    // 2. Additive pickup gesture via EventBus while running
    rig.playAnim('run', 1.0);
    const leftShoulder = rig.root.getObjectByName('LeftShoulderPivot')!;
    rig.update(1 / 60, 0.85);
    const baseShoulderX = leftShoulder.rotation.x;

    const fakeDrop: GroundLootDrop = {
      id: 'drop_1',
      position: { x: 4.5, y: 0, z: 2.8 },
      kind: 'gold',
      amount: 25,
      pickedUp: true,
    };
    eventBus.emit('loot:pickupStarted', { drop: fakeDrop, fromPos: fakeDrop.position });
    for (let i = 0; i < 6; i++) {
      rig.update(1 / 60, 0.85);
    }
    expect(leftShoulder.rotation.x).not.toBeCloseTo(baseShoulderX, 2);

    // 3. Dual-dagger equip flourish via EventBus 'hero:gearChanged' spins both sockets & emits dual ribbons
    eventBus.emit('hero:gearChanged', {
      slot: 'weapon',
      weaponVisual: 'daggers',
      rarity: 'legendary',
    });
    for (let i = 0; i < 10; i++) {
      rig.update(1 / 60, 0);
    }
    expect(mainRibbon.visible).toBe(true);
    expect(offRibbon.visible).toBe(true);

    // 4. Class swap via EventBus 'hero:classChanged' + explicit triggerSlashTrail
    eventBus.emit('hero:classChanged', { heroClass: 'arcanist' });
    rig.triggerSlashTrail(0x339af0, 0.45);
    for (let i = 0; i < 8; i++) {
      rig.update(1 / 60, 0);
    }
    expect(mainRibbon.visible).toBe(true);

    rig.dispose();
  });

  it('supports Phase 3 parry ward/360 riposte, vaulting execute finisher, and 4-wing GLSL Awakening visual', () => {
    const rig = createHeroRig('vanguard') as HeroRig;
    const pelvis = rig.root.getObjectByName('PelvisPivot')!;
    const rollPivot = rig.root.getObjectByName('RollPivot')!;
    const mainRibbon = rig.root.getObjectByName('HeroMainSlashRibbon') as THREE.Mesh;

    const wingsMount = rig.root.getObjectByName('AwakeningWingsMount')!;
    const crownHalo = rig.root.getObjectByName('SovereignCrownHalo')!;
    const astralAura = rig.root.getObjectByName('AwakeningAstralAura')!;

    expect(wingsMount.visible).toBe(false);
    expect(rig.root.getObjectByName('AwakeningWing_upper_R')).toBeDefined();
    expect(rig.root.getObjectByName('AwakeningWing_upper_L')).toBeDefined();
    expect(rig.root.getObjectByName('AwakeningWing_lower_R')).toBeDefined();
    expect(rig.root.getObjectByName('AwakeningWing_lower_L')).toBeDefined();

    // 1. Activate Awakening via EventBus -> 4 GLSL wings + Sovereign Crown Halo + Astral Aura unfurl
    eventBus.emit('player:awakeningChanged', { active: true, position: { x: 0, y: 0, z: 0 } });
    expect(wingsMount.visible).toBe(true);
    expect(crownHalo.visible).toBe(true);
    expect(astralAura.visible).toBe(true);
    for (let i = 0; i < 15; i++) {
      rig.update(1 / 60, 0.5);
    }
    expect(wingsMount.scale.x).toBeGreaterThan(0.5);

    // 2. Parry Ward Brace -> Upgrade immediately to 360° Golden Counter-Riposte Slash
    eventBus.emit('combat:parryTriggered', {
      position: { x: 0, y: 0, z: 0 },
      counterSuccess: false,
    });
    rig.update(1 / 60, 0);
    eventBus.emit('combat:parryTriggered', {
      position: { x: 0, y: 0, z: 0 },
      counterSuccess: true,
    });
    let maxSpinY = 0;
    for (let i = 0; i < 20; i++) {
      rig.update(1 / 60, 0);
      maxSpinY = Math.max(maxSpinY, rollPivot.rotation.y);
    }
    expect(maxSpinY).toBeGreaterThan(Math.PI * 0.8);
    expect(mainRibbon.visible).toBe(true);

    // 3. Vaulting Overhead Execution Finisher vaults hero pelvis high into the air
    const restY = pelvis.position.y;
    rig.playExecuteFinisher();
    let peakPelvisY = restY;
    for (let i = 0; i < 25; i++) {
      rig.update(1 / 60, 0);
      peakPelvisY = Math.max(peakPelvisY, pelvis.position.y);
    }
    expect(peakPelvisY).toBeGreaterThan(restY + 1.0);

    // 4. Deactivate Awakening -> smoothly folds & hides
    rig.setAwakenedVisual(false);
    for (let i = 0; i < 30; i++) {
      rig.update(1 / 30, 0);
    }
    expect(wingsMount.visible).toBe(false);
    expect(crownHalo.visible).toBe(false);
    expect(astralAura.visible).toBe(false);

    rig.dispose();
  });

  it('animates all 12 Phase 4 SocialEmoteIds, movement/attack cancel, downed_kneel hold, and co-op avatar isolation', () => {
    const localRig = createHeroRig('vanguard') as HeroRig;
    const remotePeerRig = createHeroRig('shadowblade') as HeroRig;
    remotePeerRig.root.position.set(14, 0, 14);

    const mainRibbon = localRig.root.getObjectByName('HeroMainSlashRibbon') as THREE.Mesh;
    const pelvis = localRig.root.getObjectByName('PelvisPivot')!;

    const allEmotes: SocialEmoteId[] = [
      'wave',
      'cheer',
      'dance',
      'taunt',
      'kneel_pray',
      'sit_rest',
      'laugh',
      'point',
      'high_five_ready',
      'high_five_strike',
      'downed_kneel',
      'revive_channel',
    ];

    for (const emoteId of allEmotes) {
      localRig.playAnim('idle');
      localRig.playSocialEmote(emoteId);
      expect(localRig.getActiveSocialEmote()).toBe(emoteId);

      for (let step = 0; step < 10; step++) {
        localRig.update(1 / 60, 0);
      }
      expect(Number.isFinite(pelvis.position.y)).toBe(true);

      if (emoteId === 'high_five_strike') {
        expect(mainRibbon.visible).toBe(true);
      }
    }

    // 1. Looping idle emotes ('dance', 'sit_rest', 'kneel_pray', 'high_five_ready') cancel when moving > 0.15 or attacking
    localRig.playAnim('idle');
    localRig.playSocialEmote('dance');
    for (let i = 0; i < 40; i++) {
      localRig.update(0.05, 0);
    }
    expect(localRig.getActiveSocialEmote()).toBe('dance'); // still looping at 2.0s!

    localRig.update(1 / 60, 0.45); // moveSpeedNormalized > 0.15 cancels dance
    expect(localRig.getActiveSocialEmote()).toBeNull();

    localRig.playSocialEmote('sit_rest');
    localRig.update(0.2, 0);
    expect(pelvis.position.y).toBeLessThan(0.6); // seated near floor
    localRig.playAnim('attack_1'); // attacking cancels sit_rest
    expect(localRig.getActiveSocialEmote()).toBeNull();

    // 2. `downed_kneel` holds across time & minor movement until cleared by `playAnim('idle')` or `playEquipFlourish`
    localRig.playSocialEmote('downed_kneel');
    for (let i = 0; i < 30; i++) {
      localRig.update(0.1, 0.35);
    }
    expect(localRig.getActiveSocialEmote()).toBe('downed_kneel');

    localRig.playEquipFlourish('legendary');
    expect(localRig.getActiveSocialEmote()).toBeNull();

    localRig.playSocialEmote('downed_kneel');
    localRig.update(0.2, 0);
    expect(localRig.getActiveSocialEmote()).toBe('downed_kneel');
    localRig.playAnim('idle');
    expect(localRig.getActiveSocialEmote()).toBeNull();

    // 3. Co-op multi-avatar EventBus isolation: local 'hero:classChanged' updates localRig ONLY, not remotePeerRig
    remotePeerRig.playSocialEmote('wave');
    eventBus.emit('hero:classChanged', { heroClass: 'arcanist' });
    expect(remotePeerRig.getActiveSocialEmote()).toBe('wave');

    remotePeerRig.dispose();
    localRig.dispose();
  });
});
