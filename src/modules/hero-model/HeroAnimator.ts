import * as THREE from 'three';
import type { HeroAnimState, SocialEmoteId, WeaponVisualType } from '../../contracts/types';
import { clamp } from '../../core/Constants';
import type { HeroSkeletonNodes } from './SkeletonBuilder';
import { PELVIS_REST_Y } from './SkeletonBuilder';
import { evaluateSocialEmotePose, SOCIAL_EMOTE_DURATIONS } from './SocialEmotePoses';
import type { ActiveWeaponRig } from './WeaponBuilder';

type Vec3Tuple = [number, number, number];

interface RigPose {
  pelvisOffset: Vec3Tuple;
  pelvisRot: Vec3Tuple;
  rollRot: Vec3Tuple;
  torsoRot: Vec3Tuple;
  headRot: Vec3Tuple;
  rShoulder: Vec3Tuple;
  rElbow: Vec3Tuple;
  rHand: Vec3Tuple;
  lShoulder: Vec3Tuple;
  lElbow: Vec3Tuple;
  lHand: Vec3Tuple;
  rHip: Vec3Tuple;
  rKnee: Vec3Tuple;
  rBoot: Vec3Tuple;
  lHip: Vec3Tuple;
  lKnee: Vec3Tuple;
  lBoot: Vec3Tuple;
}

function createZeroPose(): RigPose {
  return {
    pelvisOffset: [0, 0, 0],
    pelvisRot: [0, 0, 0],
    rollRot: [0, 0, 0],
    torsoRot: [0, 0, 0],
    headRot: [0, 0, 0],
    rShoulder: [0, 0, 0],
    rElbow: [0, 0, 0],
    rHand: [0, 0, 0],
    lShoulder: [0, 0, 0],
    lElbow: [0, 0, 0],
    lHand: [0, 0, 0],
    rHip: [0, 0, 0],
    rKnee: [0, 0, 0],
    rBoot: [0, 0, 0],
    lHip: [0, 0, 0],
    lKnee: [0, 0, 0],
    lBoot: [0, 0, 0],
  };
}

function copyTuple(dst: Vec3Tuple, src: Vec3Tuple): void {
  dst[0] = src[0];
  dst[1] = src[1];
  dst[2] = src[2];
}

function setTuple(dst: Vec3Tuple, x: number, y: number, z: number): void {
  dst[0] = x;
  dst[1] = y;
  dst[2] = z;
}

function lerpTuple(out: Vec3Tuple, a: Vec3Tuple, b: Vec3Tuple, t: number): void {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

function wrapAngleRad(rad: number): number {
  const twoPi = Math.PI * 2;
  let a = (((rad + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
  if (Object.is(a, -0)) a = 0;
  return a;
}

function copyPoseWrapped(dst: RigPose, src: RigPose): void {
  copyTuple(dst.pelvisOffset, src.pelvisOffset);
  copyTuple(dst.pelvisRot, src.pelvisRot);
  setTuple(
    dst.rollRot,
    wrapAngleRad(src.rollRot[0]),
    wrapAngleRad(src.rollRot[1]),
    wrapAngleRad(src.rollRot[2]),
  );
  copyTuple(dst.torsoRot, src.torsoRot);
  copyTuple(dst.headRot, src.headRot);
  copyTuple(dst.rShoulder, src.rShoulder);
  copyTuple(dst.rElbow, src.rElbow);
  copyTuple(dst.rHand, src.rHand);
  copyTuple(dst.lShoulder, src.lShoulder);
  copyTuple(dst.lElbow, src.lElbow);
  copyTuple(dst.lHand, src.lHand);
  copyTuple(dst.rHip, src.rHip);
  copyTuple(dst.rKnee, src.rKnee);
  copyTuple(dst.rBoot, src.rBoot);
  copyTuple(dst.lHip, src.lHip);
  copyTuple(dst.lKnee, src.lKnee);
  copyTuple(dst.lBoot, src.lBoot);
}

function blendPoses(out: RigPose, a: RigPose, b: RigPose, t: number): void {
  lerpTuple(out.pelvisOffset, a.pelvisOffset, b.pelvisOffset, t);
  lerpTuple(out.pelvisRot, a.pelvisRot, b.pelvisRot, t);
  lerpTuple(out.rollRot, a.rollRot, b.rollRot, t);
  lerpTuple(out.torsoRot, a.torsoRot, b.torsoRot, t);
  lerpTuple(out.headRot, a.headRot, b.headRot, t);
  lerpTuple(out.rShoulder, a.rShoulder, b.rShoulder, t);
  lerpTuple(out.rElbow, a.rElbow, b.rElbow, t);
  lerpTuple(out.rHand, a.rHand, b.rHand, t);
  lerpTuple(out.lShoulder, a.lShoulder, b.lShoulder, t);
  lerpTuple(out.lElbow, a.lElbow, b.lElbow, t);
  lerpTuple(out.lHand, a.lHand, b.lHand, t);
  lerpTuple(out.rHip, a.rHip, b.rHip, t);
  lerpTuple(out.rKnee, a.rKnee, b.rKnee, t);
  lerpTuple(out.rBoot, a.rBoot, b.rBoot, t);
  lerpTuple(out.lHip, a.lHip, b.lHip, t);
  lerpTuple(out.lKnee, a.lKnee, b.lKnee, t);
  lerpTuple(out.lBoot, a.lBoot, b.lBoot, t);
}

function resetPose(p: RigPose): void {
  setTuple(p.pelvisOffset, 0, 0, 0);
  setTuple(p.pelvisRot, 0, 0, 0);
  setTuple(p.rollRot, 0, 0, 0);
  setTuple(p.torsoRot, 0, 0, 0);
  setTuple(p.headRot, 0, 0, 0);
  setTuple(p.rShoulder, 0, 0, 0);
  setTuple(p.rElbow, 0, 0, 0);
  setTuple(p.rHand, 0, 0, 0);
  setTuple(p.lShoulder, 0, 0, 0);
  setTuple(p.lElbow, 0, 0, 0);
  setTuple(p.lHand, 0, 0, 0);
  setTuple(p.rHip, 0, 0, 0);
  setTuple(p.rKnee, 0, 0, 0);
  setTuple(p.rBoot, 0, 0, 0);
  setTuple(p.lHip, 0, 0, 0);
  setTuple(p.lKnee, 0, 0, 0);
  setTuple(p.lBoot, 0, 0, 0);
}

function easeOutCubic(x: number): number {
  const u = clamp(x, 0, 1);
  return 1 - Math.pow(1 - u, 3);
}

function easeInOutQuad(x: number): number {
  const u = clamp(x, 0, 1);
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}

const WEAPON_SOCKET_BASE_ROT_X = Math.PI * 0.42;
const PICKUP_GESTURE_DURATION = 0.34;
const EQUIP_FLOURISH_DURATION = 0.58;

type SpecialCombatAction = 'none' | 'parry_ward' | 'parry_riposte' | 'execute_finisher';

const SPECIAL_ACTION_DURATIONS: Record<Exclude<SpecialCombatAction, 'none'>, number> = {
  parry_ward: 0.34,
  parry_riposte: 0.56,
  execute_finisher: 0.74,
};

const ONE_SHOT_DURATIONS: Partial<Record<HeroAnimState, number>> = {
  dodge: 0.46,
  attack_1: 0.42,
  attack_2: 0.42,
  attack_3: 0.56,
  whirlwind: 0.76,
  leap_slam: 0.68,
  cast: 0.5,
  hit: 0.28,
  death: 0.85,
};

export class HeroAnimator {
  private currentState: HeroAnimState = 'idle';
  private speedMultiplier = 1;
  private stateElapsed = 0;
  private globalTime = 0;
  private runCyclePhase = 0;

  // Crossfade state
  private readonly targetPose: RigPose = createZeroPose();
  private readonly idleScratchPose: RigPose = createZeroPose();
  private readonly runScratchPose: RigPose = createZeroPose();
  private readonly fromPose: RigPose = createZeroPose();
  private readonly currentPose: RigPose = createZeroPose();
  private blendElapsed = 1;
  private blendDuration = 0.09;

  // Additive Upper-Body Loot Snatch Gesture
  private pickupActive = false;
  private pickupElapsed = 0;
  private pickupDirX = 0.25; // >0 favors left arm (+X), <0 favors right arm (-X)
  private pickupDirZ = 0.6;
  private pickupUseRightArm = false;

  // Additive / Upper-Body 360° Weapon Equip & Class Swap Flourish
  private flourishActive = false;
  private flourishElapsed = 0;

  // Phase 3 Special Combat Mastery Actions (Parry Ward / 360° Riposte / Execution Cleave)
  private specialAction: SpecialCombatAction = 'none';
  private specialElapsed = 0;

  // Phase 4 Multiplayer Co-op Social Emotes & Downed/Revive Poses
  private activeEmote: SocialEmoteId | null = null;
  private emoteElapsed = 0;

  // Multi-segment cape spring state
  private readonly capePitch = [0.14, 0.1, 0.08, 0.06];
  private readonly capeRoll = [0, 0, 0, 0];
  private prevPelvisOffsetY = 0;

  getState(): HeroAnimState {
    return this.currentState;
  }

  getSpecialAction(): SpecialCombatAction {
    return this.specialAction;
  }

  getActiveSocialEmote(): SocialEmoteId | null {
    return this.activeEmote;
  }

  isFlareActionActive(): boolean {
    return (
      this.flourishActive ||
      this.specialAction === 'parry_riposte' ||
      this.specialAction === 'execute_finisher' ||
      this.activeEmote === 'high_five_strike' ||
      this.activeEmote === 'cheer' ||
      this.currentState === 'whirlwind' ||
      this.currentState === 'leap_slam' ||
      this.currentState === 'cast'
    );
  }

  getDeathDimFactor(): number {
    if (this.currentState === 'death') {
      const dur = ONE_SHOT_DURATIONS.death ?? 0.85;
      const u = clamp(this.stateElapsed / dur, 0, 1);
      return THREE.MathUtils.lerp(1, 0.18, u);
    }
    if (this.activeEmote === 'downed_kneel') {
      const u = clamp(this.emoteElapsed / 0.4, 0, 1);
      return THREE.MathUtils.lerp(1, 0.52, u);
    }
    return 1;
  }

  getGlobalTime(): number {
    return this.globalTime;
  }

  isOffhandPrimaryStrike(): boolean {
    return this.currentState === 'attack_2';
  }

  isPickupGestureActive(): boolean {
    return this.pickupActive;
  }

  isEquipFlourishActive(): boolean {
    return this.flourishActive;
  }

  getActiveTrailEmission(weaponType: WeaponVisualType): { emitMain: boolean; emitOff: boolean } {
    let emitMain = false;
    let emitOff = false;

    if (this.flourishActive && this.currentState !== 'death') {
      const fu = clamp(this.flourishElapsed / EQUIP_FLOURISH_DURATION, 0, 1);
      if (fu <= 0.78) {
        emitMain = true;
        if (weaponType === 'daggers') emitOff = true;
      }
    }

    if (this.activeEmote === 'high_five_strike' && this.currentState !== 'death') {
      const eu = clamp(this.emoteElapsed / 0.84, 0, 1);
      if (eu >= 0.14 && eu <= 0.82) {
        emitMain = true;
        if (weaponType === 'daggers') emitOff = true;
      }
      return { emitMain, emitOff };
    }

    if (this.specialAction !== 'none' && this.currentState !== 'death') {
      const sDur = SPECIAL_ACTION_DURATIONS[this.specialAction];
      const su = clamp(this.specialElapsed / sDur, 0, 1);
      if (this.specialAction === 'parry_ward' && su <= 0.45) {
        emitMain = true;
        if (weaponType === 'daggers') emitOff = true;
      } else if (this.specialAction === 'parry_riposte' && su >= 0.08 && su <= 0.86) {
        emitMain = true;
        if (weaponType === 'daggers') emitOff = true;
      } else if (this.specialAction === 'execute_finisher' && su >= 0.12 && su <= 0.82) {
        emitMain = true;
        if (weaponType === 'daggers') emitOff = true;
      }
      return { emitMain, emitOff };
    }

    const dur = ONE_SHOT_DURATIONS[this.currentState];
    if (dur !== undefined) {
      const u = clamp(this.stateElapsed / dur, 0, 1);
      if (this.currentState === 'attack_1' && u >= 0.14 && u <= 0.74) {
        emitMain = true;
      } else if (this.currentState === 'attack_2' && u >= 0.12 && u <= 0.74) {
        if (weaponType === 'daggers') {
          emitOff = true;
          emitMain = true;
        } else {
          emitMain = true;
        }
      } else if (this.currentState === 'attack_3' && u >= 0.22 && u <= 0.76) {
        emitMain = true;
        if (weaponType === 'daggers') emitOff = true;
      } else if (this.currentState === 'whirlwind' && u >= 0.02 && u <= 0.94) {
        emitMain = true;
        if (weaponType === 'daggers') emitOff = true;
      } else if (this.currentState === 'leap_slam' && u >= 0.16 && u <= 0.78) {
        emitMain = true;
      } else if (this.currentState === 'cast' && u >= 0.2 && u <= 0.75) {
        emitMain = true;
      }
    }

    return { emitMain, emitOff };
  }

  triggerPickupGesture(localOffsetX = 0.28, localOffsetZ = 0.65): void {
    if (this.currentState === 'death' || this.activeEmote === 'downed_kneel') return;
    this.pickupActive = true;
    this.pickupElapsed = 0;
    this.pickupDirX = clamp(Number.isFinite(localOffsetX) ? localOffsetX : 0.28, -1.5, 1.5);
    this.pickupDirZ = clamp(Number.isFinite(localOffsetZ) ? localOffsetZ : 0.65, -1.0, 1.5);
    // Favor free/off-hand left arm (+X) unless the loot lies distinctly on the hero's right (-X)
    this.pickupUseRightArm = this.pickupDirX < -0.28;
  }

  triggerEquipFlourish(): void {
    if (this.currentState === 'death') return;
    // `playEquipFlourish` clears `downed_kneel` (revive celebration!)
    if (this.activeEmote === 'downed_kneel') {
      copyPoseWrapped(this.fromPose, this.currentPose);
      this.activeEmote = null;
      this.emoteElapsed = 0;
      this.blendElapsed = 0;
      this.blendDuration = 0.12;
    }
    this.flourishActive = true;
    this.flourishElapsed = 0;
  }

  triggerSocialEmote(emoteId: SocialEmoteId): void {
    if (this.currentState === 'death') return;

    if (this.activeEmote === emoteId) {
      const dur = SOCIAL_EMOTE_DURATIONS[emoteId];
      if (dur === null || this.emoteElapsed < 0.25) {
        return;
      }
    }

    copyPoseWrapped(this.fromPose, this.currentPose);
    this.specialAction = 'none';
    this.specialElapsed = 0;
    this.activeEmote = emoteId;
    this.emoteElapsed = 0;
    this.blendElapsed = 0;
    this.blendDuration = emoteId === 'high_five_strike' ? 0.05 : 0.12;

    if (emoteId === 'downed_kneel') {
      this.pickupActive = false;
      this.flourishActive = false;
    }
  }

  triggerParryAnim(counterSuccess = false): void {
    if (this.currentState === 'death' || this.activeEmote === 'downed_kneel') return;
    const desired: SpecialCombatAction = counterSuccess ? 'parry_riposte' : 'parry_ward';

    if (this.specialAction === desired && this.specialElapsed < 0.08) {
      return;
    }
    if (
      this.specialAction === 'parry_riposte' &&
      desired === 'parry_ward' &&
      this.specialElapsed < 0.35
    ) {
      return;
    }

    copyPoseWrapped(this.fromPose, this.currentPose);
    this.activeEmote = null;
    this.emoteElapsed = 0;
    this.specialAction = desired;
    this.specialElapsed = 0;
    this.blendElapsed = 0;
    this.blendDuration = 0.04;
  }

  triggerExecuteFinisher(): void {
    if (this.currentState === 'death' || this.activeEmote === 'downed_kneel') return;
    if (this.specialAction === 'execute_finisher' && this.specialElapsed < 0.12) {
      return;
    }

    copyPoseWrapped(this.fromPose, this.currentPose);
    this.activeEmote = null;
    this.emoteElapsed = 0;
    this.specialAction = 'execute_finisher';
    this.specialElapsed = 0;
    this.blendElapsed = 0;
    this.blendDuration = 0.05;
  }

  playAnim(state: HeroAnimState, speedMultiplier = 1): void {
    const safeSpeed =
      Number.isFinite(speedMultiplier) && speedMultiplier > 0.05
        ? clamp(speedMultiplier, 0.1, 4.0)
        : 1;

    // `downed_kneel` holds until cleared by `playAnim('idle')` or `playEquipFlourish` (or fatal `death`)!
    if (this.activeEmote === 'downed_kneel') {
      if (state === 'idle' || state === 'death') {
        copyPoseWrapped(this.fromPose, this.currentPose);
        this.activeEmote = null;
        this.emoteElapsed = 0;
        this.currentState = state;
        this.speedMultiplier = safeSpeed;
        this.stateElapsed = 0;
        this.blendElapsed = 0;
        this.blendDuration = 0.12;
      }
      return;
    }

    // Preserve active non-downed social emotes when `playAnim('idle')` is polled while standing still;
    // cancel social emote immediately on any movement (`run`) or combat/action state!
    if (this.activeEmote !== null) {
      if (state === 'idle') {
        this.currentState = 'idle';
        this.speedMultiplier = safeSpeed;
        return;
      }
      copyPoseWrapped(this.fromPose, this.currentPose);
      this.activeEmote = null;
      this.emoteElapsed = 0;
      this.specialAction = 'none';
      this.specialElapsed = 0;
      this.currentState = state;
      this.speedMultiplier = safeSpeed;
      this.stateElapsed = 0;
      this.blendElapsed = 0;
      this.blendDuration = state === 'dodge' || state === 'hit' ? 0.05 : 0.1;
      if (state === 'death') {
        this.pickupActive = false;
        this.flourishActive = false;
      }
      return;
    }

    // Preserve active Parry Riposte or Execution Cleave against background idle/run polling
    if (this.specialAction !== 'none' && (state === 'idle' || state === 'run')) {
      this.currentState = state;
      this.speedMultiplier = safeSpeed;
      return;
    }

    if (state === this.currentState && this.specialAction === 'none') {
      this.speedMultiplier = safeSpeed;
      if (state === 'idle' || state === 'run' || state === 'death') {
        return;
      }
      if (
        (state === 'dodge' || state === 'whirlwind' || state === 'leap_slam') &&
        this.stateElapsed < 0.2
      ) {
        return;
      }
      if (this.stateElapsed < 0.08) {
        return;
      }
    }

    if (this.currentState === 'death' && state === 'hit') {
      return;
    }

    copyPoseWrapped(this.fromPose, this.currentPose);
    this.specialAction = 'none';
    this.specialElapsed = 0;
    this.currentState = state;
    this.speedMultiplier = safeSpeed;
    this.stateElapsed = 0;
    this.blendElapsed = 0;
    this.blendDuration = state === 'dodge' || state === 'hit' ? 0.05 : 0.09;

    if (state === 'death') {
      this.pickupActive = false;
      this.flourishActive = false;
    }
  }

  update(
    dt: number,
    moveSpeedNormalized: number,
    nodes: HeroSkeletonNodes,
    weaponRig: ActiveWeaponRig | null,
  ): void {
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const safeMove = Number.isFinite(moveSpeedNormalized) ? clamp(moveSpeedNormalized, 0, 1.5) : 0;

    this.globalTime += safeDt;
    this.stateElapsed += safeDt * this.speedMultiplier;

    if (this.pickupActive) {
      this.pickupElapsed += safeDt;
      if (this.pickupElapsed >= PICKUP_GESTURE_DURATION) {
        this.pickupActive = false;
        this.pickupElapsed = 0;
      }
    }

    if (this.flourishActive) {
      this.flourishElapsed += safeDt;
      if (this.flourishElapsed >= EQUIP_FLOURISH_DURATION) {
        this.flourishActive = false;
        this.flourishElapsed = 0;
      }
    }

    if (this.activeEmote !== null) {
      // Moving (`moveSpeedNormalized > 0.15`) automatically cancels idle/timed emotes (except `downed_kneel`)
      if (this.activeEmote !== 'downed_kneel' && safeMove > 0.15) {
        copyPoseWrapped(this.fromPose, this.currentPose);
        this.activeEmote = null;
        this.emoteElapsed = 0;
        this.blendElapsed = 0;
        this.blendDuration = 0.12;
      } else {
        this.emoteElapsed += safeDt;
        const emoteDur = SOCIAL_EMOTE_DURATIONS[this.activeEmote];
        if (emoteDur !== null && this.emoteElapsed >= emoteDur) {
          copyPoseWrapped(this.fromPose, this.currentPose);
          this.activeEmote = null;
          this.emoteElapsed = 0;
          this.blendElapsed = 0;
          this.blendDuration = 0.14;
        }
      }
    }

    if (this.specialAction !== 'none') {
      this.specialElapsed += safeDt;
      const specDur = SPECIAL_ACTION_DURATIONS[this.specialAction];
      if (this.specialElapsed >= specDur) {
        copyPoseWrapped(this.fromPose, this.currentPose);
        this.specialAction = 'none';
        this.specialElapsed = 0;
        this.blendElapsed = 0;
        this.blendDuration = 0.1;
      }
    }

    const weaponType: WeaponVisualType = weaponRig?.weaponType ?? 'greatsword';

    const runDrive =
      this.currentState === 'run' ? Math.max(0.45, safeMove) * this.speedMultiplier : safeMove;
    if (runDrive > 0.02 && this.activeEmote !== 'downed_kneel') {
      this.runCyclePhase += safeDt * (6.5 + runDrive * 5.2);
    }

    const oneShotDur = ONE_SHOT_DURATIONS[this.currentState];
    if (oneShotDur !== undefined && this.currentState !== 'death') {
      if (this.stateElapsed >= oneShotDur) {
        if (this.specialAction === 'none' && this.activeEmote === null) {
          copyPoseWrapped(this.fromPose, this.currentPose);
          this.blendElapsed = 0;
          this.blendDuration = 0.11;
        }
        this.currentState = safeMove > 0.1 ? 'run' : 'idle';
        this.speedMultiplier = 1;
        this.stateElapsed = 0;
      }
    }

    if (this.activeEmote !== null && this.currentState !== 'death') {
      evaluateSocialEmotePose(this.activeEmote, this.emoteElapsed, weaponType, this.targetPose);
    } else if (this.specialAction !== 'none' && this.currentState !== 'death') {
      this.evaluateSpecialActionPose(this.specialAction, weaponType, this.targetPose);
    } else {
      this.evaluateStatePose(this.currentState, safeMove, weaponType, this.targetPose);
    }

    if (this.blendElapsed < this.blendDuration) {
      this.blendElapsed = Math.min(this.blendDuration, this.blendElapsed + safeDt);
      const alpha = easeOutCubic(this.blendElapsed / Math.max(0.001, this.blendDuration));
      blendPoses(this.currentPose, this.fromPose, this.targetPose, alpha);
    } else {
      blendPoses(this.currentPose, this.targetPose, this.targetPose, 1);
    }

    // Layer additive upper-body loot snatch & 360° equip flourish poses cleanly
    this.applyAdditivePickupLayer(this.currentPose);
    const { weaponSpinRad, weaponScale, bodyScale } = this.applyAdditiveEquipFlourishLayer(
      this.currentPose,
      weaponType,
    );

    this.applyPoseToNodes(this.currentPose, nodes, weaponSpinRad, weaponScale, bodyScale);

    const pelvisVelY =
      safeDt > 1e-5 ? (this.currentPose.pelvisOffset[1] - this.prevPelvisOffsetY) / safeDt : 0;
    this.prevPelvisOffsetY = this.currentPose.pelvisOffset[1];
    this.updateCapeDynamics(safeDt, safeMove, pelvisVelY, nodes);
    this.updateOrnaments(safeDt, nodes, weaponRig);
  }

  private applyAdditivePickupLayer(p: RigPose): void {
    if (!this.pickupActive || this.currentState === 'death' || this.currentState === 'dodge') {
      return;
    }

    const u = clamp(this.pickupElapsed / PICKUP_GESTURE_DURATION, 0, 1);
    // Crisp reach-out (0..0.42) -> snatch-in-to-belt (0.42..0.78) -> settle (0.78..1.0)
    const reachEnv =
      u < 0.42
        ? easeOutCubic(u / 0.42)
        : u < 0.78
          ? 1 - 0.55 * easeInOutQuad((u - 0.42) / 0.36)
          : 0.45 * (1 - easeInOutQuad((u - 0.78) / 0.22));
    const clutchEnv =
      u >= 0.36 && u < 0.85
        ? Math.sin(((u - 0.36) / 0.49) * Math.PI)
        : 0;

    // Slight athletic dip & directional torso twist toward incoming loot
    const atten = this.currentState === 'idle' || this.currentState === 'run' ? 1.0 : 0.45;
    const w = reachEnv * atten;
    const cw = clutchEnv * atten;

    const yawSign = this.pickupUseRightArm ? 1 : -1;
    const lateralAim = clamp(this.pickupDirX * 0.45, -0.45, 0.45);

    p.pelvisOffset[1] -= 0.085 * w;
    p.torsoRot[0] += 0.26 * w - 0.08 * cw;
    p.torsoRot[1] += (yawSign * 0.34 - lateralAim * 0.35) * w;
    p.headRot[0] += 0.18 * w;
    p.headRot[1] -= yawSign * 0.22 * w;
    p.rKnee[0] += 0.14 * w;
    p.lKnee[0] += 0.14 * w;

    if (this.pickupUseRightArm) {
      p.rShoulder[0] = THREE.MathUtils.lerp(p.rShoulder[0], -1.08 + 0.55 * cw, w);
      p.rShoulder[1] += 0.25 * w;
      p.rShoulder[2] = THREE.MathUtils.lerp(p.rShoulder[2], -0.35 + 0.55 * cw, w);
      p.rElbow[0] = THREE.MathUtils.lerp(p.rElbow[0], -0.25 - 1.15 * cw, w);
      p.rHand[0] += -0.35 * w + 0.55 * cw;
    } else {
      // Sweeping left hand snatch out-and-into belt pouch
      p.lShoulder[0] = THREE.MathUtils.lerp(p.lShoulder[0], -1.12 + 0.58 * cw, w);
      p.lShoulder[1] -= 0.26 * w;
      p.lShoulder[2] = THREE.MathUtils.lerp(p.lShoulder[2], 0.36 - 0.58 * cw, w);
      p.lElbow[0] = THREE.MathUtils.lerp(p.lElbow[0], -0.22 - 1.18 * cw, w);
      p.lHand[0] += -0.35 * w + 0.58 * cw;
    }
  }

  private applyAdditiveEquipFlourishLayer(
    p: RigPose,
    weapon: WeaponVisualType,
  ): { weaponSpinRad: number; weaponScale: number; bodyScale: number } {
    if (!this.flourishActive || this.currentState === 'death') {
      return { weaponSpinRad: 0, weaponScale: 1, bodyScale: 1 };
    }

    const u = clamp(this.flourishElapsed / EQUIP_FLOURISH_DURATION, 0, 1);

    // 360° weapon twirl over first 66%, locking into heroic ready pose over final 34%
    const spinT = clamp(u / 0.66, 0, 1);
    const weaponSpinRad = easeInOutQuad(spinT) * Math.PI * 2;

    // Underdamped spring scale bounce on weapon (0.58 -> 1.18 -> 0.98 -> 1.0) & subtle body pop
    const weaponScale =
      1 - 0.42 * Math.exp(-9.5 * u) * Math.cos(19.0 * u);
    const bodyScale = 1 + 0.055 * Math.sin(Math.min(1, u * 2.2) * Math.PI);

    // Upper-body heroic twirl & chest-lifted ready stance (attenuated if mid-attack/dodge)
    const isLocomotion = this.currentState === 'idle' || this.currentState === 'run';
    const poseWeight =
      (u < 0.18
        ? easeOutCubic(u / 0.18)
        : u < 0.72
          ? 1
          : 1 - easeInOutQuad((u - 0.72) / 0.28)) * (isLocomotion ? 1 : 0.35);

    if (poseWeight > 0.001) {
      const lockPhase = u > 0.55 ? easeOutCubic((u - 0.55) / 0.45) : 0;
      p.torsoRot[0] = THREE.MathUtils.lerp(p.torsoRot[0], -0.14 + 0.08 * lockPhase, poseWeight);
      p.torsoRot[1] = THREE.MathUtils.lerp(
        p.torsoRot[1],
        THREE.MathUtils.lerp(-0.28, 0.26, lockPhase),
        poseWeight,
      );
      p.headRot[0] = THREE.MathUtils.lerp(p.headRot[0], -0.08, poseWeight);

      // Lift right weapon arm out & forward for clean 360° blade pinwheel, then lock into guard
      p.rShoulder[0] = THREE.MathUtils.lerp(
        p.rShoulder[0],
        THREE.MathUtils.lerp(-1.05, -0.58, lockPhase),
        poseWeight,
      );
      p.rShoulder[1] = THREE.MathUtils.lerp(p.rShoulder[1], 0.28, poseWeight);
      p.rShoulder[2] = THREE.MathUtils.lerp(
        p.rShoulder[2],
        THREE.MathUtils.lerp(-0.56, -0.32, lockPhase),
        poseWeight,
      );
      p.rElbow[0] = THREE.MathUtils.lerp(
        p.rElbow[0],
        THREE.MathUtils.lerp(-0.34, -0.62, lockPhase),
        poseWeight,
      );

      if (weapon === 'daggers') {
        // Mirror twin-dagger 360° flourish on offhand!
        p.lShoulder[0] = THREE.MathUtils.lerp(
          p.lShoulder[0],
          THREE.MathUtils.lerp(-1.05, -0.58, lockPhase),
          poseWeight,
        );
        p.lShoulder[1] = THREE.MathUtils.lerp(p.lShoulder[1], -0.28, poseWeight);
        p.lShoulder[2] = THREE.MathUtils.lerp(
          p.lShoulder[2],
          THREE.MathUtils.lerp(0.56, 0.32, lockPhase),
          poseWeight,
        );
        p.lElbow[0] = THREE.MathUtils.lerp(
          p.lElbow[0],
          THREE.MathUtils.lerp(-0.34, -0.64, lockPhase),
          poseWeight,
        );
      } else if (weapon === 'sword_shield') {
        // Brace shield proudly across chest
        p.lShoulder[0] = THREE.MathUtils.lerp(p.lShoulder[0], -0.82, poseWeight);
        p.lElbow[0] = THREE.MathUtils.lerp(p.lElbow[0], -0.92, poseWeight);
      }
    }

    return { weaponSpinRad, weaponScale, bodyScale };
  }

  private applyBaseWeaponGrip(p: RigPose, weapon: WeaponVisualType): void {
    if (weapon === 'daggers') {
      setTuple(p.rShoulder, -0.36, 0.18, -0.28);
      setTuple(p.rElbow, -0.84, 0, 0.14);
      setTuple(p.rHand, 0.12, 0, -0.08);
      setTuple(p.lShoulder, -0.42, -0.18, 0.28);
      setTuple(p.lElbow, -0.88, 0, -0.14);
      setTuple(p.lHand, 0.12, 0, 0.08);
    } else if (weapon === 'staff') {
      setTuple(p.rShoulder, -0.52, 0.08, -0.18);
      setTuple(p.rElbow, -0.58, 0, 0.06);
      setTuple(p.rHand, 0.08, 0, 0);
      setTuple(p.lShoulder, -0.38, -0.16, 0.22);
      setTuple(p.lElbow, -0.74, 0, -0.12);
      setTuple(p.lHand, -0.1, 0.2, 0);
    } else if (weapon === 'sword_shield') {
      setTuple(p.rShoulder, -0.38, 0.15, -0.24);
      setTuple(p.rElbow, -0.68, 0, 0.1);
      setTuple(p.rHand, 0.1, 0, 0);
      setTuple(p.lShoulder, -0.62, -0.34, 0.22);
      setTuple(p.lElbow, -0.82, 0.2, -0.24);
      setTuple(p.lHand, 0, 0.15, 0);
    } else {
      setTuple(p.rShoulder, -0.44, 0.2, -0.24);
      setTuple(p.rElbow, -0.66, 0, 0.16);
      setTuple(p.rHand, 0.14, 0, -0.06);
      setTuple(p.lShoulder, -0.5, -0.26, 0.18);
      setTuple(p.lElbow, -0.76, 0, -0.2);
      setTuple(p.lHand, 0, 0, 0);
    }
  }

  private computeIdlePose(p: RigPose, weapon: WeaponVisualType): void {
    resetPose(p);
    const t = this.globalTime;
    const breath = Math.sin(t * 2.2);
    const sway = Math.sin(t * 1.1);

    setTuple(p.pelvisOffset, sway * 0.012, breath * 0.016 - 0.015, 0);
    setTuple(p.pelvisRot, 0, -0.08 + sway * 0.03, 0);
    setTuple(p.torsoRot, 0.04 - breath * 0.025, 0.1 + sway * 0.03, 0);
    setTuple(p.headRot, -0.03 + breath * 0.02, -0.08 - sway * 0.04, 0);

    this.applyBaseWeaponGrip(p, weapon);
    p.rShoulder[0] += breath * 0.035;
    p.rShoulder[2] -= (breath * 0.5 + 0.5) * 0.03;
    p.lShoulder[0] -= breath * 0.03;
    p.lShoulder[2] += (breath * 0.5 + 0.5) * 0.03;

    setTuple(p.rHip, -0.08, 0, -0.05);
    setTuple(p.rKnee, 0.16, 0, 0);
    setTuple(p.rBoot, -0.08, 0, 0.04);

    setTuple(p.lHip, 0.06, 0, 0.05);
    setTuple(p.lKnee, 0.1, 0, 0);
    setTuple(p.lBoot, -0.06, 0, -0.04);
  }

  private computeRunPose(p: RigPose, moveScale: number, weapon: WeaponVisualType): void {
    resetPose(p);
    const phase = this.runCyclePhase;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const amp = clamp(moveScale, 0.35, 1.25);

    const bounce = Math.abs(s) * 0.065 * amp - 0.035 * amp;
    setTuple(p.pelvisOffset, c * 0.022 * amp, bounce, 0);
    setTuple(p.pelvisRot, 0.06 * amp, -s * 0.14 * amp, c * 0.04 * amp);
    setTuple(p.torsoRot, 0.22 * amp, s * 0.18 * amp, -c * 0.04 * amp);
    setTuple(p.headRot, -0.18 * amp, -s * 0.12 * amp, 0);

    const rSwingLift = Math.max(0, c);
    const lSwingLift = Math.max(0, -c);

    setTuple(p.rHip, s * 0.72 * amp - 0.06, 0, -0.03);
    setTuple(p.rKnee, (0.16 + rSwingLift * 0.92) * amp, 0, 0);
    setTuple(p.rBoot, (-0.12 - s * 0.25) * amp, 0, 0);

    setTuple(p.lHip, -s * 0.72 * amp - 0.06, 0, 0.03);
    setTuple(p.lKnee, (0.16 + lSwingLift * 0.92) * amp, 0, 0);
    setTuple(p.lBoot, (-0.12 + s * 0.25) * amp, 0, 0);

    this.applyBaseWeaponGrip(p, weapon);
    const armPump = weapon === 'staff' ? 0.26 : weapon === 'sword_shield' ? 0.34 : 0.45;
    p.rShoulder[0] += -s * armPump * amp;
    p.rElbow[0] += -0.12 * amp;

    const offPump = weapon === 'sword_shield' ? 0.22 : 0.48;
    p.lShoulder[0] += s * offPump * amp;
    p.lElbow[0] += -0.14 * amp;
  }

  private evaluateStatePose(
    state: HeroAnimState,
    moveNorm: number,
    weapon: WeaponVisualType,
    out: RigPose,
  ): void {
    if (state === 'idle') {
      this.computeIdlePose(this.idleScratchPose, weapon);
      if (moveNorm > 0.04) {
        const blend = clamp((moveNorm - 0.04) / 0.65, 0, 1);
        this.computeRunPose(this.runScratchPose, moveNorm, weapon);
        blendPoses(out, this.idleScratchPose, this.runScratchPose, blend);
      } else {
        blendPoses(out, this.idleScratchPose, this.idleScratchPose, 1);
      }
      return;
    }

    if (state === 'run') {
      this.computeRunPose(out, Math.max(0.45, moveNorm), weapon);
      return;
    }

    resetPose(out);
    const dur = ONE_SHOT_DURATIONS[state] ?? 0.45;
    const u = clamp(this.stateElapsed / dur, 0, 1);

    if (state === 'dodge') {
      const rollProgress = easeInOutQuad(u);
      const tuck = Math.sin(u * Math.PI);

      setTuple(out.pelvisOffset, 0, Math.sin(u * Math.PI) * 0.16 - 0.12 * tuck, 0);
      setTuple(out.rollRot, rollProgress * Math.PI * 2, 0, 0);
      setTuple(out.torsoRot, 0.58 * tuck, 0, 0);
      setTuple(out.headRot, 0.48 * tuck, 0, 0);

      setTuple(out.rShoulder, -0.95 * tuck - 0.3, 0.25, -0.2);
      setTuple(out.rElbow, -1.35 * tuck - 0.4, 0, 0.2);
      setTuple(out.lShoulder, -0.95 * tuck - 0.3, -0.25, 0.2);
      setTuple(out.lElbow, -1.35 * tuck - 0.4, 0, -0.2);

      setTuple(out.rHip, -1.38 * tuck, 0, -0.04);
      setTuple(out.rKnee, 1.75 * tuck + 0.12, 0, 0);
      setTuple(out.lHip, -1.28 * tuck, 0, 0.04);
      setTuple(out.lKnee, 1.68 * tuck + 0.12, 0, 0);
      return;
    }

    if (state === 'attack_1') {
      this.applyBaseWeaponGrip(out, weapon);
      if (u < 0.24) {
        const w = easeOutCubic(u / 0.24);
        setTuple(out.pelvisOffset, 0, -0.04 * w, -0.05 * w);
        setTuple(out.pelvisRot, 0, -0.22 * w, 0);
        setTuple(out.torsoRot, -0.08 * w, -0.58 * w, 0.06 * w);
        setTuple(out.headRot, 0.04 * w, 0.42 * w, 0);
        setTuple(out.rShoulder, -1.22 * w - 0.35 * (1 - w), -0.38 * w, -0.68 * w - 0.2);
        setTuple(out.rElbow, -0.62, 0, 0.15);
        setTuple(out.rHand, -0.25 * w, 0, 0);
      } else if (u < 0.64) {
        const s = easeOutCubic((u - 0.24) / 0.4);
        setTuple(out.pelvisOffset, 0, -0.08, THREE.MathUtils.lerp(-0.05, 0.18, s));
        setTuple(out.pelvisRot, 0.08 * s, THREE.MathUtils.lerp(-0.22, 0.32, s), 0);
        setTuple(
          out.torsoRot,
          THREE.MathUtils.lerp(-0.08, 0.28, s),
          THREE.MathUtils.lerp(-0.58, 0.78, s),
          -0.08 * s,
        );
        setTuple(out.headRot, -0.12 * s, THREE.MathUtils.lerp(0.42, -0.45, s), 0);
        setTuple(
          out.rShoulder,
          THREE.MathUtils.lerp(-1.22, -0.72, s),
          THREE.MathUtils.lerp(-0.38, 0.82, s),
          THREE.MathUtils.lerp(-0.88, 0.42, s),
        );
        setTuple(out.rElbow, THREE.MathUtils.lerp(-0.62, -0.14, s), 0, 0);
        setTuple(out.rHand, THREE.MathUtils.lerp(-0.25, 0.44, s), 0, -0.22 * s);
        setTuple(out.rHip, -0.42 * s, 0, -0.05);
        setTuple(out.rKnee, 0.52 * s, 0, 0);
        setTuple(out.lHip, 0.34 * s, 0, 0.05);
        setTuple(out.lKnee, 0.22 * s, 0, 0);
      } else {
        const r = easeInOutQuad((u - 0.64) / 0.36);
        this.computeIdlePose(this.idleScratchPose, weapon);
        setTuple(out.pelvisOffset, 0, -0.08, 0.18);
        setTuple(out.pelvisRot, 0.08, 0.32, 0);
        setTuple(out.torsoRot, 0.28, 0.78, -0.08);
        setTuple(out.headRot, -0.12, -0.45, 0);
        setTuple(out.rShoulder, -0.72, 0.82, 0.42);
        setTuple(out.rElbow, -0.14, 0, 0);
        setTuple(out.rHand, 0.44, 0, -0.22);
        setTuple(out.rHip, -0.42, 0, -0.05);
        setTuple(out.rKnee, 0.52, 0, 0);
        setTuple(out.lHip, 0.34, 0, 0.05);
        setTuple(out.lKnee, 0.22, 0, 0);
        blendPoses(out, out, this.idleScratchPose, r);
      }
      return;
    }

    if (state === 'attack_2') {
      this.applyBaseWeaponGrip(out, weapon);
      if (weapon === 'daggers') {
        if (u < 0.22) {
          const w = easeOutCubic(u / 0.22);
          setTuple(out.torsoRot, 0.08 * w, 0.56 * w, 0);
          setTuple(out.lShoulder, -1.18 * w - 0.4 * (1 - w), 0.35 * w, 0.78 * w);
          setTuple(out.lElbow, -0.55, 0, 0);
        } else if (u < 0.65) {
          const s = easeOutCubic((u - 0.22) / 0.43);
          setTuple(out.pelvisOffset, 0, -0.09, 0.16 * s);
          setTuple(out.torsoRot, 0.26, THREE.MathUtils.lerp(0.56, -0.82, s), 0.08 * s);
          setTuple(out.headRot, -0.14, THREE.MathUtils.lerp(-0.3, 0.48, s), 0);
          setTuple(
            out.lShoulder,
            THREE.MathUtils.lerp(-1.18, -0.68, s),
            THREE.MathUtils.lerp(0.35, -0.85, s),
            THREE.MathUtils.lerp(0.78, -0.45, s),
          );
          setTuple(out.lElbow, THREE.MathUtils.lerp(-0.55, -0.12, s), 0, 0);
          setTuple(out.lHand, 0.42 * s, 0, 0.2 * s);
          setTuple(out.rShoulder, -0.82, -0.4 * s, -0.55 * s);
          setTuple(out.rElbow, -0.35, 0, 0);
          setTuple(out.lHip, -0.44 * s, 0, 0.05);
          setTuple(out.lKnee, 0.54 * s, 0, 0);
          setTuple(out.rHip, 0.32 * s, 0, -0.05);
        } else {
          const r = easeInOutQuad((u - 0.65) / 0.35);
          this.computeIdlePose(this.idleScratchPose, weapon);
          setTuple(out.pelvisOffset, 0, -0.09, 0.16);
          setTuple(out.torsoRot, 0.26, -0.82, 0.08);
          setTuple(out.lShoulder, -0.68, -0.85, -0.45);
          setTuple(out.lElbow, -0.12, 0, 0);
          setTuple(out.lHand, 0.42, 0, 0.2);
          blendPoses(out, out, this.idleScratchPose, r);
        }
      } else {
        if (u < 0.24) {
          const w = easeOutCubic(u / 0.24);
          setTuple(out.torsoRot, 0.12 * w, 0.62 * w, -0.06 * w);
          setTuple(out.rShoulder, -0.72 * w - 0.4 * (1 - w), 0.72 * w, 0.48 * w);
          setTuple(out.rElbow, -0.75, 0, 0);
        } else if (u < 0.64) {
          const s = easeOutCubic((u - 0.24) / 0.4);
          setTuple(out.pelvisOffset, 0, -0.07, 0.15 * s);
          setTuple(out.pelvisRot, 0.06, THREE.MathUtils.lerp(0.18, -0.3, s), 0);
          setTuple(out.torsoRot, 0.22, THREE.MathUtils.lerp(0.62, -0.74, s), 0.08 * s);
          setTuple(out.headRot, -0.1, THREE.MathUtils.lerp(-0.35, 0.45, s), 0);
          setTuple(
            out.rShoulder,
            THREE.MathUtils.lerp(-0.72, -1.05, s),
            THREE.MathUtils.lerp(0.72, -0.62, s),
            THREE.MathUtils.lerp(0.48, -0.88, s),
          );
          setTuple(out.rElbow, THREE.MathUtils.lerp(-0.75, -0.14, s), 0, 0);
          setTuple(out.rHand, 0.38 * s, 0, 0.24 * s);
          if (weapon === 'sword_shield') {
            setTuple(out.lShoulder, -0.95, -0.15, 0.15);
            setTuple(out.lElbow, -0.45, 0, 0);
          }
          setTuple(out.lHip, -0.38 * s, 0, 0.05);
          setTuple(out.lKnee, 0.48 * s, 0, 0);
          setTuple(out.rHip, 0.3 * s, 0, -0.05);
        } else {
          const r = easeInOutQuad((u - 0.64) / 0.36);
          this.computeIdlePose(this.idleScratchPose, weapon);
          setTuple(out.pelvisOffset, 0, -0.07, 0.15);
          setTuple(out.torsoRot, 0.22, -0.74, 0.08);
          setTuple(out.rShoulder, -1.05, -0.62, -0.88);
          setTuple(out.rElbow, -0.14, 0, 0);
          setTuple(out.rHand, 0.38, 0, 0.24);
          blendPoses(out, out, this.idleScratchPose, r);
        }
      }
      return;
    }

    if (state === 'attack_3') {
      if (u < 0.34) {
        const w = easeOutCubic(u / 0.34);
        setTuple(out.pelvisOffset, 0, 0.12 * w, -0.08 * w);
        setTuple(out.torsoRot, -0.28 * w, -0.18 * w, 0);
        setTuple(out.headRot, -0.18 * w, 0.12 * w, 0);
        setTuple(out.rShoulder, -2.55 * w - 0.4 * (1 - w), 0.1 * w, -0.16);
        setTuple(out.rElbow, -0.48, 0, 0);
        setTuple(out.lShoulder, -2.25 * w - 0.4 * (1 - w), -0.15 * w, 0.18);
        setTuple(out.lElbow, -0.52, 0, 0);
        setTuple(out.rHip, -0.24 * w, 0, -0.05);
        setTuple(out.rKnee, 0.35 * w, 0, 0);
      } else if (u < 0.64) {
        const s = easeOutCubic((u - 0.34) / 0.3);
        setTuple(
          out.pelvisOffset,
          0,
          THREE.MathUtils.lerp(0.12, -0.2, s),
          THREE.MathUtils.lerp(-0.08, 0.25, s),
        );
        setTuple(
          out.torsoRot,
          THREE.MathUtils.lerp(-0.28, 0.48, s),
          THREE.MathUtils.lerp(-0.18, 0.28, s),
          0,
        );
        setTuple(out.headRot, THREE.MathUtils.lerp(-0.18, -0.24, s), -0.18 * s, 0);
        setTuple(out.rShoulder, THREE.MathUtils.lerp(-2.55, -0.34, s), 0.14, -0.1);
        setTuple(out.rElbow, THREE.MathUtils.lerp(-0.48, -0.12, s), 0, 0);
        setTuple(out.rHand, 0.46 * s, 0, 0);
        setTuple(out.lShoulder, THREE.MathUtils.lerp(-2.25, -0.48, s), -0.18, 0.22);
        setTuple(out.lElbow, THREE.MathUtils.lerp(-0.52, -0.4, s), 0, 0);
        setTuple(out.rHip, -0.68 * s, 0, -0.06);
        setTuple(out.rKnee, 0.82 * s, 0, 0);
        setTuple(out.rBoot, -0.14 * s, 0, 0);
        setTuple(out.lHip, 0.46 * s, 0, 0.06);
        setTuple(out.lKnee, 0.44 * s, 0, 0);
      } else {
        const r = easeInOutQuad((u - 0.64) / 0.36);
        this.computeIdlePose(this.idleScratchPose, weapon);
        setTuple(out.pelvisOffset, 0, -0.2, 0.25);
        setTuple(out.torsoRot, 0.48, 0.28, 0);
        setTuple(out.rShoulder, -0.34, 0.14, -0.1);
        setTuple(out.rElbow, -0.12, 0, 0);
        setTuple(out.rHand, 0.46, 0, 0);
        setTuple(out.lShoulder, -0.48, -0.18, 0.22);
        setTuple(out.lElbow, -0.4, 0, 0);
        setTuple(out.rHip, -0.68, 0, -0.06);
        setTuple(out.rKnee, 0.82, 0, 0);
        setTuple(out.lHip, 0.46, 0, 0.06);
        setTuple(out.lKnee, 0.44, 0, 0);
        blendPoses(out, out, this.idleScratchPose, r);
      }
      return;
    }

    if (state === 'whirlwind') {
      const spinProgress = easeInOutQuad(u);
      const env = Math.sin(Math.min(1, u * 4) * (Math.PI * 0.5)) * (u > 0.82 ? (1 - u) / 0.18 : 1);

      setTuple(out.pelvisOffset, 0, -0.08 * env, 0);
      setTuple(out.rollRot, 0, spinProgress * Math.PI * 4, 0);
      setTuple(out.torsoRot, 0.18 * env, 0.22 * env, -0.12 * env);

      setTuple(out.rShoulder, -0.82 * env - 0.35 * (1 - env), 0.15, -1.18 * env - 0.2 * (1 - env));
      setTuple(out.rElbow, -0.12, 0, 0);
      setTuple(out.rHand, 0.38 * env, 0, -0.32 * env);

      if (weapon === 'daggers') {
        setTuple(out.lShoulder, -0.82 * env - 0.35 * (1 - env), -0.15, 1.18 * env + 0.2 * (1 - env));
        setTuple(out.lElbow, -0.12, 0, 0);
        setTuple(out.lHand, 0.38 * env, 0, 0.32 * env);
      } else {
        setTuple(out.lShoulder, -0.65 * env, -0.25, 0.75 * env);
        setTuple(out.lElbow, -0.55, 0, 0);
      }

      setTuple(out.rHip, -0.25 * env, 0, -0.14 * env);
      setTuple(out.rKnee, 0.42 * env, 0, 0);
      setTuple(out.lHip, 0.2 * env, 0, 0.14 * env);
      setTuple(out.lKnee, 0.36 * env, 0, 0);
      return;
    }

    if (state === 'leap_slam') {
      if (u < 0.14) {
        const c = easeOutCubic(u / 0.14);
        setTuple(out.pelvisOffset, 0, -0.24 * c, 0);
        setTuple(out.torsoRot, 0.32 * c, 0, 0);
        setTuple(out.rShoulder, -0.2 * c, 0, -0.35);
        setTuple(out.rHip, -0.55 * c, 0, -0.06);
        setTuple(out.rKnee, 0.95 * c, 0, 0);
        setTuple(out.lHip, -0.5 * c, 0, 0.06);
        setTuple(out.lKnee, 0.9 * c, 0, 0);
      } else if (u < 0.64) {
        const airU = (u - 0.14) / 0.5;
        const arcHeight = Math.sin(airU * Math.PI) * 1.48;
        const wind = easeOutCubic(Math.min(1, airU * 1.6));

        setTuple(out.pelvisOffset, 0, arcHeight, 0);
        setTuple(out.torsoRot, THREE.MathUtils.lerp(-0.26, 0.38, airU * airU), -0.15, 0);
        setTuple(out.headRot, -0.2, 0, 0);

        const strikeSnap = airU > 0.72 ? easeOutCubic((airU - 0.72) / 0.28) : 0;
        setTuple(
          out.rShoulder,
          THREE.MathUtils.lerp(-2.65 * wind, -0.32, strikeSnap),
          0.12,
          -0.16,
        );
        setTuple(out.rElbow, THREE.MathUtils.lerp(-0.45, -0.1, strikeSnap), 0, 0);
        setTuple(out.rHand, 0.45 * strikeSnap, 0, 0);

        setTuple(
          out.lShoulder,
          THREE.MathUtils.lerp(-2.2 * wind, -0.52, strikeSnap),
          -0.16,
          0.22,
        );
        setTuple(out.lElbow, -0.5, 0, 0);

        setTuple(out.rHip, -0.85 * (1 - strikeSnap * 0.3), 0, -0.06);
        setTuple(out.rKnee, 1.25 * (1 - strikeSnap * 0.3), 0, 0);
        setTuple(out.lHip, -0.35, 0, 0.06);
        setTuple(out.lKnee, 0.95, 0, 0);
      } else {
        const rec = easeInOutQuad((u - 0.64) / 0.36);
        this.computeIdlePose(this.idleScratchPose, weapon);
        setTuple(out.pelvisOffset, 0, -0.28, 0.2);
        setTuple(out.torsoRot, 0.54, 0.22, 0);
        setTuple(out.headRot, -0.32, -0.15, 0);
        setTuple(out.rShoulder, -0.28, 0.12, -0.12);
        setTuple(out.rElbow, -0.1, 0, 0);
        setTuple(out.rHand, 0.48, 0, 0);
        setTuple(out.lShoulder, -0.45, -0.2, 0.35);
        setTuple(out.lElbow, -0.4, 0, 0);
        setTuple(out.rHip, -0.78, 0, -0.08);
        setTuple(out.rKnee, 1.05, 0, 0);
        setTuple(out.lHip, 0.38, 0, 0.08);
        setTuple(out.lKnee, 0.72, 0, 0);
        blendPoses(out, out, this.idleScratchPose, rec);
      }
      return;
    }

    if (state === 'cast') {
      if (u < 0.3) {
        const g = easeOutCubic(u / 0.3);
        setTuple(out.pelvisOffset, 0, 0.05 * g, -0.05 * g);
        setTuple(out.torsoRot, -0.18 * g, -0.16 * g, 0);
        setTuple(out.headRot, -0.24 * g, 0.1 * g, 0);
        setTuple(out.rShoulder, -1.1 * g - 0.4 * (1 - g), 0.22 * g, -0.28);
        setTuple(out.rElbow, -0.95 * g - 0.5 * (1 - g), 0, 0.2);
        setTuple(out.lShoulder, -1.05 * g - 0.35 * (1 - g), -0.35 * g, 0.2);
        setTuple(out.lElbow, -1.15 * g - 0.6 * (1 - g), 0, -0.25);
      } else if (u < 0.7) {
        const s = easeOutCubic((u - 0.3) / 0.4);
        setTuple(out.pelvisOffset, 0, -0.05 * s, 0.12 * s);
        setTuple(
          out.torsoRot,
          THREE.MathUtils.lerp(-0.18, 0.22, s),
          THREE.MathUtils.lerp(-0.16, 0.14, s),
          0,
        );
        setTuple(out.headRot, THREE.MathUtils.lerp(-0.24, -0.08, s), -0.1 * s, 0);
        setTuple(out.rShoulder, THREE.MathUtils.lerp(-1.1, -1.35, s), 0.1, -0.24);
        setTuple(out.rElbow, THREE.MathUtils.lerp(-0.95, -0.24, s), 0, 0);
        setTuple(out.lShoulder, THREE.MathUtils.lerp(-1.05, -1.48, s), -0.08, 0.18);
        setTuple(out.lElbow, THREE.MathUtils.lerp(-1.15, -0.12, s), 0, 0);
        setTuple(out.lHand, -0.45 * s, 0, 0);
        setTuple(out.lHip, -0.28 * s, 0, 0.05);
        setTuple(out.lKnee, 0.34 * s, 0, 0);
        setTuple(out.rHip, 0.22 * s, 0, -0.05);
      } else {
        const r = easeInOutQuad((u - 0.7) / 0.3);
        this.computeIdlePose(this.idleScratchPose, weapon);
        setTuple(out.pelvisOffset, 0, -0.05, 0.12);
        setTuple(out.torsoRot, 0.22, 0.14, 0);
        setTuple(out.rShoulder, -1.35, 0.1, -0.24);
        setTuple(out.rElbow, -0.24, 0, 0);
        setTuple(out.lShoulder, -1.48, -0.08, 0.18);
        setTuple(out.lElbow, -0.12, 0, 0);
        setTuple(out.lHand, -0.45, 0, 0);
        blendPoses(out, out, this.idleScratchPose, r);
      }
      return;
    }

    if (state === 'hit') {
      const flinch = Math.sin(u * Math.PI);
      const snap = u < 0.25 ? easeOutCubic(u / 0.25) : 1 - easeInOutQuad((u - 0.25) / 0.75);

      this.computeIdlePose(out, weapon);
      out.pelvisOffset[1] -= 0.06 * snap;
      out.pelvisOffset[2] -= 0.14 * snap;
      out.torsoRot[0] -= 0.36 * snap;
      out.torsoRot[1] -= 0.28 * snap;
      out.torsoRot[2] += 0.1 * flinch;
      out.headRot[0] -= 0.3 * snap;
      out.rShoulder[2] -= 0.32 * snap;
      out.lShoulder[2] += 0.32 * snap;
      return;
    }

    if (u < 0.44) {
      const k = easeInOutQuad(u / 0.44);
      setTuple(out.pelvisOffset, 0, -0.44 * k, -0.06 * k);
      setTuple(out.torsoRot, -0.34 * k, -0.2 * k, 0.08 * k);
      setTuple(out.headRot, -0.45 * k, 0.15 * k, 0);
      setTuple(out.rShoulder, -0.2 * k, 0, -0.55 * k);
      setTuple(out.rElbow, -0.35 * k, 0, 0);
      setTuple(out.lShoulder, -0.2 * k, 0, 0.55 * k);
      setTuple(out.lElbow, -0.4 * k, 0, 0);
      setTuple(out.rHip, -0.28 * k, 0, -0.08 * k);
      setTuple(out.rKnee, 1.62 * k, 0, 0);
      setTuple(out.rBoot, 0.35 * k, 0, 0);
      setTuple(out.lHip, -0.22 * k, 0, 0.08 * k);
      setTuple(out.lKnee, 1.55 * k, 0, 0);
      setTuple(out.lBoot, 0.35 * k, 0, 0);
    } else {
      const f = easeInOutQuad((u - 0.44) / 0.56);
      setTuple(
        out.pelvisOffset,
        0.04 * f,
        THREE.MathUtils.lerp(-0.44, -0.76, f),
        THREE.MathUtils.lerp(-0.06, -0.18, f),
      );
      setTuple(
        out.torsoRot,
        THREE.MathUtils.lerp(-0.34, 1.42, f),
        THREE.MathUtils.lerp(-0.2, 0.12, f),
        THREE.MathUtils.lerp(0.08, 0.16, f),
      );
      setTuple(
        out.headRot,
        THREE.MathUtils.lerp(-0.45, -0.18, f),
        THREE.MathUtils.lerp(0.15, 0.52, f),
        0,
      );
      setTuple(
        out.rShoulder,
        THREE.MathUtils.lerp(-0.2, -1.15, f),
        0,
        THREE.MathUtils.lerp(-0.55, -0.78, f),
      );
      setTuple(out.rElbow, THREE.MathUtils.lerp(-0.35, -0.45, f), 0, 0);
      setTuple(
        out.lShoulder,
        THREE.MathUtils.lerp(-0.2, -0.95, f),
        0,
        THREE.MathUtils.lerp(0.55, 0.72, f),
      );
      setTuple(out.lElbow, THREE.MathUtils.lerp(-0.4, -0.58, f), 0, 0);
      setTuple(out.rHip, THREE.MathUtils.lerp(-0.28, 1.35, f), 0, -0.12);
      setTuple(out.rKnee, THREE.MathUtils.lerp(1.62, 0.25, f), 0, 0);
      setTuple(out.lHip, THREE.MathUtils.lerp(-0.22, 1.25, f), 0, 0.14);
      setTuple(out.lKnee, THREE.MathUtils.lerp(1.55, 0.42, f), 0, 0);
    }
  }

  private evaluateSpecialActionPose(
    action: Exclude<SpecialCombatAction, 'none'>,
    weapon: WeaponVisualType,
    out: RigPose,
  ): void {
    resetPose(out);
    const dur = SPECIAL_ACTION_DURATIONS[action];
    const u = clamp(this.specialElapsed / dur, 0, 1);

    if (action === 'parry_ward') {
      // Defensive runic ward brace: cross-guard / shield wall stance with recovery
      const hold =
        u < 0.16
          ? easeOutCubic(u / 0.16)
          : u < 0.72
            ? 1
            : 1 - easeInOutQuad((u - 0.72) / 0.28);

      this.computeIdlePose(this.idleScratchPose, weapon);
      setTuple(out.pelvisOffset, 0, -0.11, -0.06);
      setTuple(out.pelvisRot, 0.05, -0.24, 0);
      setTuple(out.torsoRot, -0.12, 0.34, 0.05);
      setTuple(out.headRot, 0.08, -0.28, 0);

      if (weapon === 'sword_shield') {
        // Kite shield centered dead-front + broadsword cocked high in riposte guard
        setTuple(out.lShoulder, -0.92, -0.58, 0.12);
        setTuple(out.lElbow, -1.05, 0.32, -0.28);
        setTuple(out.rShoulder, -1.05, -0.25, -0.55);
        setTuple(out.rElbow, -0.78, 0, 0.18);
      } else if (weapon === 'daggers') {
        // Crossed twin-blade X-ward block across face/chest
        setTuple(out.rShoulder, -1.08, 0.52, 0.36);
        setTuple(out.rElbow, -0.88, 0, 0);
        setTuple(out.lShoulder, -1.08, -0.52, -0.36);
        setTuple(out.lElbow, -0.88, 0, 0);
      } else {
        // Diagonal two-handed / staff ward parry across upper chest
        setTuple(out.rShoulder, -1.12, 0.48, 0.28);
        setTuple(out.rElbow, -0.92, 0, -0.35);
        setTuple(out.rHand, 0.18, 0, -0.45);
        setTuple(out.lShoulder, -1.02, -0.38, 0.24);
        setTuple(out.lElbow, -0.85, 0, -0.2);
      }

      setTuple(out.rHip, -0.36, 0, -0.08);
      setTuple(out.rKnee, 0.54, 0, 0);
      setTuple(out.lHip, 0.28, 0, 0.08);
      setTuple(out.lKnee, 0.36, 0, 0);

      blendPoses(out, this.idleScratchPose, out, hold);
      return;
    }

    if (action === 'parry_riposte') {
      // Defensive ward deflect shock (0..0.16) -> Blazing 360° golden counter-riposte spin slash!
      if (u < 0.16) {
        const w = easeOutCubic(u / 0.16);
        setTuple(out.pelvisOffset, 0, -0.14 * w, -0.1 * w);
        setTuple(out.torsoRot, -0.18 * w, -0.35 * w, 0);
        setTuple(out.rShoulder, -1.15 * w - 0.3 * (1 - w), 0.45 * w, 0.28 * w);
        setTuple(out.rElbow, -0.88, 0, -0.3);
        setTuple(out.lShoulder, -0.98 * w - 0.3 * (1 - w), -0.42 * w, 0.22);
        setTuple(out.lElbow, -0.85, 0, 0);
        setTuple(out.rHip, -0.38 * w, 0, -0.08);
        setTuple(out.rKnee, 0.58 * w, 0, 0);
      } else if (u < 0.78) {
        const s = easeOutCubic((u - 0.16) / 0.62);
        const env = Math.sin(Math.min(1, s * 2.5) * (Math.PI * 0.5));
        setTuple(out.pelvisOffset, 0, -0.1, THREE.MathUtils.lerp(-0.1, 0.22, s));
        // Full 360° (2π) golden counter-riposte spin!
        setTuple(out.rollRot, 0, s * Math.PI * 2, 0);
        setTuple(out.torsoRot, 0.24 * env, 0.32 * env, -0.12 * env);
        setTuple(out.headRot, -0.14 * env, -0.2 * env, 0);

        // Wide extended golden riposte blade sweep
        setTuple(out.rShoulder, -0.84 * env - 0.4 * (1 - env), 0.24, -1.16 * env - 0.2 * (1 - env));
        setTuple(out.rElbow, -0.1, 0, 0);
        setTuple(out.rHand, 0.42 * env, 0, -0.34 * env);

        if (weapon === 'daggers') {
          setTuple(out.lShoulder, -0.84 * env - 0.4 * (1 - env), -0.24, 1.16 * env + 0.2 * (1 - env));
          setTuple(out.lElbow, -0.1, 0, 0);
          setTuple(out.lHand, 0.42 * env, 0, 0.34 * env);
        } else {
          setTuple(out.lShoulder, -0.68 * env, -0.28, 0.78 * env);
          setTuple(out.lElbow, -0.52, 0, 0);
        }

        setTuple(out.rHip, -0.32 * env, 0, -0.12);
        setTuple(out.rKnee, 0.48 * env, 0, 0);
        setTuple(out.lHip, 0.26 * env, 0, 0.12);
        setTuple(out.lKnee, 0.36 * env, 0, 0);
      } else {
        const r = easeInOutQuad((u - 0.78) / 0.22);
        this.computeIdlePose(this.idleScratchPose, weapon);
        setTuple(out.pelvisOffset, 0, -0.1, 0.22);
        setTuple(out.rollRot, 0, Math.PI * 2, 0);
        setTuple(out.torsoRot, 0.24, 0.32, -0.12);
        setTuple(out.rShoulder, -0.84, 0.24, -1.16);
        setTuple(out.rElbow, -0.1, 0, 0);
        setTuple(out.rHand, 0.42, 0, -0.34);
        // Keep rollRot wrapped at 2π during tail blend by adding 2π to scratch pose rollRot[1]
        this.idleScratchPose.rollRot[1] = Math.PI * 2;
        blendPoses(out, out, this.idleScratchPose, r);
      }
      return;
    }

    // 'execute_finisher': Explosive vault -> Mid-air guillotine windup -> Cataclysmic overhead cleave!
    if (u < 0.14) {
      const c = easeOutCubic(u / 0.14);
      setTuple(out.pelvisOffset, 0, -0.26 * c, -0.05 * c);
      setTuple(out.torsoRot, 0.36 * c, -0.18 * c, 0);
      setTuple(out.rShoulder, -0.35 * c, 0, -0.42 * c);
      setTuple(out.rHip, -0.62 * c, 0, -0.08);
      setTuple(out.rKnee, 1.02 * c, 0, 0);
      setTuple(out.lHip, -0.54 * c, 0, 0.08);
      setTuple(out.lKnee, 0.94 * c, 0, 0);
    } else if (u < 0.62) {
      const airU = (u - 0.14) / 0.48;
      const arcHeight = Math.sin(airU * Math.PI) * 1.68;
      const wind = easeOutCubic(Math.min(1, airU * 1.75));
      const cleaveSnap = airU > 0.66 ? easeOutCubic((airU - 0.66) / 0.34) : 0;

      setTuple(out.pelvisOffset, 0, arcHeight, THREE.MathUtils.lerp(-0.05, 0.26, cleaveSnap));
      setTuple(
        out.torsoRot,
        THREE.MathUtils.lerp(-0.36 * wind, 0.56, cleaveSnap),
        THREE.MathUtils.lerp(-0.22, 0.28, cleaveSnap),
        0,
      );
      setTuple(out.headRot, THREE.MathUtils.lerp(-0.24, -0.28, cleaveSnap), 0, 0);

      // Massive two-handed / twin-blade guillotine raise -> downward execution cleave
      setTuple(
        out.rShoulder,
        THREE.MathUtils.lerp(-2.78 * wind, -0.26, cleaveSnap),
        0.14,
        -0.12,
      );
      setTuple(out.rElbow, THREE.MathUtils.lerp(-0.42, -0.08, cleaveSnap), 0, 0);
      setTuple(out.rHand, 0.54 * cleaveSnap, 0, 0);

      if (weapon === 'daggers') {
        setTuple(
          out.lShoulder,
          THREE.MathUtils.lerp(-2.78 * wind, -0.26, cleaveSnap),
          -0.14,
          0.12,
        );
        setTuple(out.lElbow, THREE.MathUtils.lerp(-0.42, -0.08, cleaveSnap), 0, 0);
        setTuple(out.lHand, 0.54 * cleaveSnap, 0, 0);
      } else {
        setTuple(
          out.lShoulder,
          THREE.MathUtils.lerp(-2.38 * wind, -0.46, cleaveSnap),
          -0.18,
          0.22,
        );
        setTuple(out.lElbow, -0.45, 0, 0);
      }

      setTuple(out.rHip, -0.92 * (1 - cleaveSnap * 0.25), 0, -0.08);
      setTuple(out.rKnee, 1.32 * (1 - cleaveSnap * 0.22), 0, 0);
      setTuple(out.lHip, THREE.MathUtils.lerp(-0.42, 0.42, cleaveSnap), 0, 0.08);
      setTuple(out.lKnee, THREE.MathUtils.lerp(1.02, 0.68, cleaveSnap), 0, 0);
    } else {
      const rec = easeInOutQuad((u - 0.62) / 0.38);
      this.computeIdlePose(this.idleScratchPose, weapon);
      setTuple(out.pelvisOffset, 0, -0.3, 0.28);
      setTuple(out.torsoRot, 0.58, 0.28, 0);
      setTuple(out.headRot, -0.34, -0.18, 0);
      setTuple(out.rShoulder, -0.26, 0.14, -0.1);
      setTuple(out.rElbow, -0.08, 0, 0);
      setTuple(out.rHand, 0.54, 0, 0);
      setTuple(out.lShoulder, -0.46, -0.18, 0.28);
      setTuple(out.lElbow, -0.38, 0, 0);
      setTuple(out.rHip, -0.82, 0, -0.08);
      setTuple(out.rKnee, 1.08, 0, 0);
      setTuple(out.lHip, 0.44, 0, 0.08);
      setTuple(out.lKnee, 0.74, 0, 0);
      blendPoses(out, out, this.idleScratchPose, rec);
    }
  }

  private applyPoseToNodes(
    p: RigPose,
    nodes: HeroSkeletonNodes,
    weaponSpinRad: number,
    weaponScale: number,
    bodyScale: number,
  ): void {
    nodes.pelvis.position.set(
      p.pelvisOffset[0],
      PELVIS_REST_Y + p.pelvisOffset[1],
      p.pelvisOffset[2],
    );
    nodes.pelvis.rotation.set(p.pelvisRot[0], p.pelvisRot[1], p.pelvisRot[2]);
    nodes.rollPivot.rotation.set(p.rollRot[0], p.rollRot[1], p.rollRot[2]);
    nodes.rollPivot.scale.setScalar(bodyScale);

    nodes.torso.rotation.set(p.torsoRot[0], p.torsoRot[1], p.torsoRot[2]);
    nodes.head.rotation.set(p.headRot[0], p.headRot[1], p.headRot[2]);

    nodes.rightShoulder.rotation.set(p.rShoulder[0], p.rShoulder[1], p.rShoulder[2]);
    nodes.rightElbow.rotation.set(p.rElbow[0], p.rElbow[1], p.rElbow[2]);
    nodes.rightHand.rotation.set(p.rHand[0], p.rHand[1], p.rHand[2]);

    nodes.leftShoulder.rotation.set(p.lShoulder[0], p.lShoulder[1], p.lShoulder[2]);
    nodes.leftElbow.rotation.set(p.lElbow[0], p.lElbow[1], p.lElbow[2]);
    nodes.leftHand.rotation.set(p.lHand[0], p.lHand[1], p.lHand[2]);

    // Apply 360° flourish twirl & spring-scale to weapon sockets cleanly
    nodes.mainWeaponSocket.rotation.set(WEAPON_SOCKET_BASE_ROT_X + weaponSpinRad, 0, 0);
    nodes.mainWeaponSocket.scale.setScalar(weaponScale);

    nodes.offWeaponSocket.rotation.set(WEAPON_SOCKET_BASE_ROT_X + weaponSpinRad, 0, 0);
    nodes.offWeaponSocket.scale.setScalar(weaponScale);
    nodes.shieldSocket.scale.setScalar(weaponScale);

    nodes.rightHip.rotation.set(p.rHip[0], p.rHip[1], p.rHip[2]);
    nodes.rightKnee.rotation.set(p.rKnee[0], p.rKnee[1], p.rKnee[2]);
    nodes.rightBoot.rotation.set(p.rBoot[0], p.rBoot[1], p.rBoot[2]);

    nodes.leftHip.rotation.set(p.lHip[0], p.lHip[1], p.lHip[2]);
    nodes.leftKnee.rotation.set(p.lKnee[0], p.lKnee[1], p.lKnee[2]);
    nodes.leftBoot.rotation.set(p.lBoot[0], p.lBoot[1], p.lBoot[2]);
  }

  private updateCapeDynamics(
    dt: number,
    moveNorm: number,
    pelvisVelY: number,
    nodes: HeroSkeletonNodes,
  ): void {
    const t = this.globalTime;
    const isRunning = this.currentState === 'run' || moveNorm > 0.08;
    const speedFactor = this.currentState === 'run' ? Math.max(0.5, moveNorm) : moveNorm;

    let targetRootPitch = 0.14 + speedFactor * 0.62;
    let waveFreq = 2.4 + speedFactor * 7.5;
    let waveAmp = 0.045 + speedFactor * 0.14;
    let targetRollFlare = 0;

    if (this.currentState === 'whirlwind' || this.specialAction === 'parry_riposte') {
      targetRootPitch = 1.08;
      waveFreq = 14;
      waveAmp = 0.18;
      targetRollFlare = 0.28;
    } else if (
      this.specialAction === 'execute_finisher' ||
      this.activeEmote === 'high_five_strike'
    ) {
      targetRootPitch = 1.12;
      waveFreq = 13;
      waveAmp = 0.2;
      targetRollFlare = 0.2;
    } else if (this.activeEmote === 'dance' || this.activeEmote === 'cheer') {
      targetRootPitch = 0.72;
      waveFreq = 9.5;
      waveAmp = 0.16;
      targetRollFlare = 0.16;
    } else if (
      this.activeEmote === 'sit_rest' ||
      this.activeEmote === 'kneel_pray' ||
      this.activeEmote === 'downed_kneel'
    ) {
      targetRootPitch = 0.08;
      waveFreq = 1.8;
      waveAmp = 0.02;
    } else if (this.currentState === 'dodge') {
      targetRootPitch = 0.85;
      waveFreq = 10;
      waveAmp = 0.16;
    } else if (
      this.currentState === 'cast' ||
      this.flourishActive ||
      this.specialAction === 'parry_ward' ||
      this.activeEmote === 'revive_channel'
    ) {
      targetRootPitch = Math.max(targetRootPitch, 0.78);
      waveFreq = Math.max(waveFreq, 9.2);
      waveAmp = Math.max(waveAmp, 0.15);
    } else if (this.currentState === 'death') {
      targetRootPitch = 0.06;
      waveAmp = 0.005;
    }

    targetRootPitch = clamp(targetRootPitch - pelvisVelY * 0.16, 0.04, 1.35);

    const smooth = 1 - Math.exp(-14 * Math.max(0.001, dt));

    for (let i = 0; i < 4; i++) {
      const wave = Math.sin(t * waveFreq - i * 0.95) * waveAmp * (i === 0 ? 0.5 : 1);
      const lateral =
        (isRunning || this.currentState === 'whirlwind' || this.flourishActive
          ? Math.cos(t * (waveFreq * 0.75) - i * 0.8) * (0.04 + speedFactor * 0.06)
          : Math.sin(t * 1.6 - i * 0.7) * 0.02) +
        (i > 0 ? targetRollFlare * 0.35 : targetRollFlare);

      const segDesiredPitch = i === 0 ? targetRootPitch + wave : targetRootPitch * 0.12 + wave;

      this.capePitch[i] = THREE.MathUtils.lerp(this.capePitch[i], segDesiredPitch, smooth);
      this.capeRoll[i] = THREE.MathUtils.lerp(this.capeRoll[i], lateral, smooth);

      nodes.capeSegments[i].rotation.set(
        this.capePitch[i],
        this.capeRoll[i] * 0.45,
        this.capeRoll[i],
      );
    }
  }

  private updateOrnaments(
    dt: number,
    nodes: HeroSkeletonNodes,
    weaponRig: ActiveWeaponRig | null,
  ): void {
    const t = this.globalTime;

    if (nodes.floatingHelmOrnament) {
      nodes.floatingHelmOrnament.position.y = 0.34 + Math.sin(t * 2.6) * 0.022;
      nodes.floatingHelmOrnament.rotation.y = Math.sin(t * 1.4) * 0.18;
    }

    if (!weaponRig) return;

    if (weaponRig.floatingOrb) {
      const castBoost = this.currentState === 'cast' || this.flourishActive ? 2.6 : 1;
      weaponRig.floatingOrb.position.y = 1.25 + Math.sin(t * 3.4) * 0.032;
      weaponRig.floatingOrb.rotation.y += dt * 1.8 * castBoost;
    }

    for (let i = 0; i < weaponRig.spinRings.length; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const boost = this.flourishActive ? 2.4 : 1;
      const ring = weaponRig.spinRings[i];
      ring.rotation.y += dt * 2.2 * dir * boost;
      ring.rotation.z += dt * 1.1 * dir * boost;
    }

    const deathDim = this.getDeathDimFactor();
    nodes.groundRingMat.opacity = (0.28 + Math.sin(t * 2.8) * 0.06) * deathDim;
  }
}
