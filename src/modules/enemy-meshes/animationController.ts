import type { EnemyAnimState } from '../../contracts/types';
import { clamp } from '../../core/Constants';
import type { ArticulatedEnemyRig } from './rigTypes';

const ATTACK_DURATION_SEC = 0.56;
const CAST_CYCLE_SEC = 0.78;
const HIT_DURATION_SEC = 0.3;
const HIT_SQUASH_DURATION_SEC = 0.24;

const MONSTER_COLLAPSE_SEC = 0.5;
const MONSTER_DISSOLVE_TOTAL_SEC = 1.26;
const BOSS_COLLAPSE_SEC = 0.9;
const BOSS_DISSOLVE_TOTAL_SEC = 2.55;

/**
 * Procedural skeletal animation state machine driving all 7 `EnemyAnimState`s
 * (`idle`, `walk`, `windup`, `attack`, `cast`, `hit`, `death`) across bipeds,
 * heavy monoliths, floating wraiths/liches, 8-legged arachnids, and quadrupeds,
 * plus death edge-burn dissolve progression and punchy hit squash-and-stretch impulses.
 */
export class EnemyAnimationController {
  private state: EnemyAnimState = 'idle';
  private speed = 1;
  private animTime = 0;
  private totalTime = 0;
  private oneShotCompleted = false;

  private telegraphFactor = 0;
  private deathDimFactor = 0;
  private dissolveProgress = 0;

  // Hit squash-and-stretch impulse state
  private hitSquashActive = false;
  private hitSquashElapsed = 0;
  private hitJoltSign: 1 | -1 = 1;

  constructor(private readonly rig: ArticulatedEnemyRig) {
    this.applyCurrentFrame();
  }

  getState(): EnemyAnimState {
    return this.state;
  }

  getTelegraphStrength(): number {
    return this.telegraphFactor;
  }

  getDeathDimFactor(): number {
    return this.deathDimFactor;
  }

  getDissolveProgress(): number {
    return this.dissolveProgress;
  }

  getTotalTime(): number {
    return this.totalTime;
  }

  /**
   * Fires a punchy volume-preserving squash-and-stretch impulse on `modelRoot`
   * plus a subtle alternating torso shudder. Immediately applies frame-0 squash!
   */
  triggerHitSquash(): void {
    this.hitSquashActive = true;
    this.hitSquashElapsed = 0;
    this.hitJoltSign = this.hitJoltSign === 1 ? -1 : 1;
    this.applyCurrentFrame();
  }

  playAnim(nextState: EnemyAnimState, speed = 1): void {
    const validSpeed = Number.isFinite(speed) && speed > 0 ? clamp(speed, 0.1, 5.0) : 1.0;
    this.speed = validSpeed;

    if (this.state === nextState) {
      if (nextState === 'hit' && this.animTime > 0.14) {
        this.animTime = 0;
        this.oneShotCompleted = false;
      } else if (nextState === 'attack' && this.oneShotCompleted) {
        this.animTime = 0;
        this.oneShotCompleted = false;
      }
      return;
    }

    this.state = nextState;
    this.animTime = 0;
    this.oneShotCompleted = false;

    if (nextState !== 'death') {
      this.deathDimFactor = 0;
      this.dissolveProgress = 0;
    }
    this.applyCurrentFrame();
  }

  update(dt: number): void {
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const scaledDt = safeDt * this.speed;
    this.animTime += scaledDt;
    this.totalTime += safeDt;

    if (this.hitSquashActive) {
      this.hitSquashElapsed += safeDt;
      if (this.hitSquashElapsed >= HIT_SQUASH_DURATION_SEC) {
        this.hitSquashActive = false;
        this.hitSquashElapsed = 0;
      }
    }

    // Auto-recover from `hit` or one-shot `attack` when finished
    if (this.state === 'hit' && this.animTime >= HIT_DURATION_SEC) {
      this.state = 'idle';
      this.animTime = 0;
    } else if (this.state === 'attack' && this.animTime >= ATTACK_DURATION_SEC) {
      this.oneShotCompleted = true;
    }

    this.applyCurrentFrame();
  }

  private resetToRestPose(): void {
    for (const snap of this.rig.restSnapshots) {
      snap.node.position.copy(snap.pos);
      snap.node.rotation.copy(snap.rot);
      snap.node.scale.copy(snap.scale);
    }
    this.rig.modelRoot.position.set(0, this.rig.hoverBaseY, 0);
    this.rig.modelRoot.rotation.set(0, 0, 0);
    this.rig.modelRoot.scale.setScalar(this.rig.baseScale);
  }

  private applyCurrentFrame(): void {
    this.resetToRestPose();
    this.telegraphFactor = 0;

    let orbitSpeedMul = 1.0;
    let weakpointPulseMul = 1.0;

    switch (this.state) {
      case 'idle':
        this.poseIdle(this.totalTime);
        break;
      case 'walk':
        this.poseWalk(this.animTime);
        orbitSpeedMul = 1.25;
        break;
      case 'windup':
        this.poseWindup(this.animTime);
        orbitSpeedMul = 2.2;
        weakpointPulseMul = 1.8;
        break;
      case 'attack':
        if (this.oneShotCompleted) {
          this.poseIdle(this.totalTime);
        } else {
          this.poseAttack(clamp(this.animTime / ATTACK_DURATION_SEC, 0, 1));
          orbitSpeedMul = 2.4;
          weakpointPulseMul = 1.5;
        }
        break;
      case 'cast':
        this.poseCast(this.animTime);
        orbitSpeedMul = 3.0;
        weakpointPulseMul = 2.0;
        break;
      case 'hit':
        this.poseHit(clamp(this.animTime / HIT_DURATION_SEC, 0, 1));
        break;
      case 'death':
        this.poseDeath(this.animTime);
        orbitSpeedMul = 0.15;
        weakpointPulseMul = 0.1;
        break;
    }

    this.applySecondaryMotion(this.totalTime, orbitSpeedMul, weakpointPulseMul);
    this.applyHitSquashImpulse();
  }

  /* ==========================================================================
   * PUNCHY VOLUME-PRESERVING HIT SQUASH & STRETCH IMPULSE
   * ======================================================================== */
  private applyHitSquashImpulse(): void {
    if (!this.hitSquashActive) return;

    const tau = clamp(this.hitSquashElapsed / HIT_SQUASH_DURATION_SEC, 0, 1);
    const aliveWeight = clamp(1 - this.dissolveProgress, 0.15, 1);
    const envelope = Math.pow(1 - tau, 1.45) * aliveWeight;
    // tau = 0 -> -0.20 (sharp impact squash); tau ~ 0.44 -> +0.085 (elastic rebound stretch); tau = 1 -> 0
    const squash = -0.2 * Math.cos(tau * Math.PI * 2.25) * envelope;

    const scaleY = clamp(1 + squash, 0.65, 1.35);
    const scaleXZ = 1 / Math.sqrt(scaleY);
    const s = this.rig.baseScale;

    this.rig.modelRoot.scale.set(s * scaleXZ, s * scaleY, s * scaleXZ);

    // Crisp alternating torso micro-jolt
    const jolt = this.hitJoltSign * 0.08 * Math.pow(1 - tau, 2) * aliveWeight;
    this.rig.torso.rotation.z += jolt;
    this.rig.torso.rotation.y -= jolt * 0.65;
  }

  /* ==========================================================================
   * IDLE POSE
   * ======================================================================== */
  private poseIdle(t: number): void {
    const r = this.rig;
    const breath = Math.sin(t * 2.4);
    const slowSway = Math.sin(t * 1.35);

    switch (r.locomotion) {
      case 'floating': {
        r.modelRoot.position.y = r.hoverBaseY + Math.sin(t * 2.6) * 0.09 * r.baseScale;
        r.torso.rotation.x += breath * 0.04;
        r.head.rotation.y += slowSway * 0.08;
        if (r.leftArm) r.leftArm.shoulder.rotation.z += (breath + 1) * 0.04;
        if (r.rightArm) r.rightArm.shoulder.rotation.z -= (breath + 1) * 0.04;
        break;
      }
      case 'arachnid': {
        r.pelvis.position.y += breath * 0.02;
        r.head.rotation.y += slowSway * 0.07;
        if (r.jaw) r.jaw.rotation.y = Math.sin(t * 4.2) * 0.06;
        for (const leg of r.spiderLegs) {
          const ph = leg.rowIndex * 0.9 + (leg.side === 1 ? 0 : Math.PI);
          leg.femur.rotation.z += Math.sin(t * 2.4 + ph) * 0.03 * leg.side;
        }
        break;
      }
      case 'quadruped': {
        r.torso.scale.set(1 + breath * 0.025, 1 + breath * 0.03, 1);
        r.head.rotation.x += breath * 0.04;
        if (r.jaw) r.jaw.rotation.x += Math.max(0, Math.sin(t * 4.5)) * 0.12;
        break;
      }
      case 'heavy_biped':
      case 'biped': {
        r.pelvis.position.y += breath * 0.015;
        r.torso.rotation.x += breath * 0.03;
        r.head.rotation.y += slowSway * 0.07;
        if (r.rightArm) r.rightArm.shoulder.rotation.x += breath * 0.04;
        if (r.leftArm) r.leftArm.shoulder.rotation.x -= breath * 0.03;
        break;
      }
    }
  }

  /* ==========================================================================
   * WALK / CHASE POSE
   * ======================================================================== */
  private poseWalk(t: number): void {
    const r = this.rig;

    switch (r.locomotion) {
      case 'biped': {
        const w = t * 7.5;
        const s = Math.sin(w);
        const c = Math.cos(w);
        r.pelvis.position.y += Math.abs(s) * 0.045 - 0.02;
        r.torso.rotation.x += 0.1;
        r.torso.rotation.y += s * 0.09;

        if (r.leftLeg && r.rightLeg) {
          r.leftLeg.hip.rotation.x += s * 0.62;
          r.leftLeg.knee.rotation.x += Math.max(0, -c) * 0.65;
          r.rightLeg.hip.rotation.x -= s * 0.62;
          r.rightLeg.knee.rotation.x += Math.max(0, c) * 0.65;
        }

        if (r.attackStyle === 'bow_shot') {
          if (r.leftArm) r.leftArm.shoulder.rotation.x += s * 0.06;
          if (r.rightArm) r.rightArm.shoulder.rotation.x -= s * 0.08;
        } else {
          if (r.leftArm) r.leftArm.shoulder.rotation.x -= s * 0.32;
          if (r.rightArm) r.rightArm.shoulder.rotation.x += s * 0.36;
        }
        break;
      }

      case 'heavy_biped': {
        const w = t * 4.6;
        const s = Math.sin(w);
        const c = Math.cos(w);
        r.pelvis.position.y -= Math.pow(Math.cos(w), 2) * 0.055;
        r.torso.rotation.z += s * 0.075;
        r.torso.rotation.y += s * 0.1;
        r.torso.rotation.x += 0.08;

        if (r.leftLeg && r.rightLeg) {
          r.leftLeg.hip.rotation.x += s * 0.48;
          r.leftLeg.knee.rotation.x += Math.max(0, -c) * 0.5;
          r.rightLeg.hip.rotation.x -= s * 0.48;
          r.rightLeg.knee.rotation.x += Math.max(0, c) * 0.5;
        }
        if (r.leftArm) r.leftArm.shoulder.rotation.x -= s * 0.28;
        if (r.rightArm) r.rightArm.shoulder.rotation.x += s * 0.28;
        break;
      }

      case 'floating': {
        const w = t * 5.2;
        r.modelRoot.position.y = r.hoverBaseY + Math.sin(w) * 0.07 * r.baseScale;
        r.pelvis.rotation.x += 0.22;
        r.head.rotation.x -= 0.18;
        r.torso.rotation.z += Math.sin(w * 0.5) * 0.06;
        for (const seg of r.tailSegments) {
          seg.rotation.x += 0.25 + Math.sin(w) * 0.08;
        }
        if (r.leftArm) r.leftArm.shoulder.rotation.x += 0.18 + Math.sin(w) * 0.08;
        if (r.rightArm) r.rightArm.shoulder.rotation.x += 0.18 - Math.sin(w) * 0.08;
        break;
      }

      case 'arachnid': {
        const w = t * 11.5;
        r.pelvis.position.y += Math.sin(w * 2) * 0.025;
        r.pelvis.rotation.z += Math.sin(w) * 0.05;
        r.pelvis.rotation.y += Math.cos(w) * 0.05;

        for (const leg of r.spiderLegs) {
          const groupPhase = (leg.rowIndex + (leg.side === 1 ? 0 : 1)) % 2 === 0 ? 0 : Math.PI;
          const phase = w + groupPhase;
          const stride = Math.sin(phase);
          const lift = Math.max(0, Math.cos(phase));

          leg.coxa.rotation.y += stride * 0.26 * leg.side;
          leg.femur.rotation.z -= lift * 0.34 * leg.side;
          leg.tibia.rotation.z += lift * 0.28 * leg.side;
        }
        break;
      }

      case 'quadruped': {
        const w = t * 9.5;
        const s = Math.sin(w);
        const c = Math.cos(w);
        r.pelvis.position.y += Math.abs(s) * 0.06;
        r.pelvis.rotation.x += c * 0.11;
        r.head.rotation.x -= c * 0.09;

        for (const qLeg of r.quadLegs) {
          const ph = (qLeg.isFront ? 0 : Math.PI * 0.88) + (qLeg.side === 1 ? 0 : 0.45);
          const ls = Math.sin(w + ph);
          qLeg.upper.rotation.x += ls * 0.65;
          qLeg.lower.rotation.x += Math.max(0, -Math.cos(w + ph)) * (qLeg.isFront ? -0.55 : 0.55);
        }
        break;
      }
    }
  }

  /* ==========================================================================
   * WINDUP — Coiled Anticipation Pose + Glowing Telegraph Warning!
   * ======================================================================== */
  private poseWindup(t: number): void {
    const r = this.rig;
    const ramp = clamp(t / 0.22, 0, 1);
    const pulse = 0.8 + 0.2 * Math.sin(t * 24);
    this.telegraphFactor = ramp * pulse;

    r.modelRoot.position.x = Math.sin(t * 48) * 0.014 * ramp * r.baseScale;

    switch (r.attackStyle) {
      case 'melee_slash': {
        r.modelRoot.position.z = -0.08 * ramp * r.baseScale;
        r.torso.rotation.y += 0.52 * ramp;
        r.torso.rotation.x -= 0.18 * ramp;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.x -= 1.85 * ramp;
          r.rightArm.shoulder.rotation.z -= 0.4 * ramp;
          r.rightArm.elbow.rotation.x -= 0.35 * ramp;
        }
        if (r.leftArm) {
          r.leftArm.shoulder.rotation.y += 0.35 * ramp;
        }
        if (r.jaw) r.jaw.rotation.x += 0.45 * ramp;
        break;
      }

      case 'melee_slam':
      case 'boss_sweeping': {
        r.modelRoot.position.z = -0.1 * ramp * r.baseScale;
        r.torso.rotation.x -= 0.26 * ramp;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.x -= 2.05 * ramp;
          r.rightArm.shoulder.rotation.z -= 0.35 * ramp;
          r.rightArm.elbow.rotation.x += 0.2 * ramp;
        }
        if (r.leftArm) {
          r.leftArm.shoulder.rotation.x -= 1.35 * ramp;
          r.leftArm.shoulder.rotation.z += 0.35 * ramp;
        }
        for (const w of r.wings) {
          w.pivot.rotation.z -= w.side * 0.38 * ramp;
          w.pivot.rotation.y -= w.side * 0.25 * ramp;
        }
        break;
      }

      case 'bow_shot': {
        r.torso.rotation.y -= 0.35 * ramp;
        if (r.leftArm) {
          r.leftArm.shoulder.rotation.x = -1.48 * ramp + r.leftArm.shoulder.rotation.x * (1 - ramp);
        }
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.x = -1.42 * ramp + r.rightArm.shoulder.rotation.x * (1 - ramp);
          r.rightArm.shoulder.rotation.y += 0.38 * ramp;
          r.rightArm.elbow.rotation.x -= 0.45 * ramp;
        }
        break;
      }

      case 'staff_cast': {
        r.modelRoot.position.y += 0.14 * ramp * r.baseScale;
        r.head.rotation.x -= 0.28 * ramp;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.x -= 1.45 * ramp;
        }
        if (r.leftArm) {
          r.leftArm.shoulder.rotation.x -= 1.25 * ramp;
          r.leftArm.shoulder.rotation.z += 0.45 * ramp;
        }
        break;
      }

      case 'twin_dash': {
        r.modelRoot.position.y = r.hoverBaseY - 0.08 * ramp * r.baseScale;
        r.modelRoot.position.z = -0.14 * ramp * r.baseScale;
        r.torso.rotation.x += 0.35 * ramp;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.y += 0.85 * ramp;
          r.rightArm.shoulder.rotation.x -= 0.55 * ramp;
        }
        if (r.leftArm) {
          r.leftArm.shoulder.rotation.y -= 0.85 * ramp;
          r.leftArm.shoulder.rotation.x -= 0.55 * ramp;
        }
        break;
      }

      case 'arachnid_strike': {
        r.pelvis.rotation.x -= 0.42 * ramp;
        r.pelvis.position.y += 0.12 * ramp;
        if (r.jaw) r.jaw.rotation.x -= 0.35 * ramp;
        for (const leg of r.spiderLegs) {
          if (leg.rowIndex <= 1) {
            leg.femur.rotation.z -= leg.side * (0.65 - leg.rowIndex * 0.25) * ramp;
            leg.coxa.rotation.y += leg.side * 0.25 * ramp;
          }
        }
        break;
      }

      case 'bite_lunge': {
        r.pelvis.position.y -= 0.14 * ramp;
        r.pelvis.rotation.x += 0.18 * ramp;
        r.head.rotation.x -= 0.28 * ramp;
        if (r.jaw) r.jaw.rotation.x += 0.68 * ramp;
        for (const qLeg of r.quadLegs) {
          if (qLeg.isFront) {
            qLeg.upper.rotation.x -= 0.45 * ramp;
            qLeg.lower.rotation.x += 0.55 * ramp;
          }
        }
        break;
      }
    }
  }

  /* ==========================================================================
   * ATTACK — Snappy Strike Lunge & Follow-Through
   * ======================================================================== */
  private poseAttack(u: number): void {
    const r = this.rig;
    const strike =
      u < 0.28
        ? Math.sin((u / 0.28) * Math.PI * 0.5)
        : Math.cos(((u - 0.28) / 0.72) * Math.PI * 0.5);

    this.telegraphFactor = Math.max(0, (1 - u * 2.2) * 0.55);

    switch (r.attackStyle) {
      case 'melee_slash': {
        r.modelRoot.position.z = 0.24 * strike * r.baseScale;
        r.torso.rotation.y -= 0.78 * strike;
        r.torso.rotation.x += 0.28 * strike;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.x -= 0.45 * strike;
          r.rightArm.shoulder.rotation.y -= 0.95 * strike;
          r.rightArm.elbow.rotation.x += 0.35 * strike;
        }
        break;
      }

      case 'melee_slam':
      case 'boss_sweeping': {
        r.modelRoot.position.z = 0.22 * strike * r.baseScale;
        r.torso.rotation.x += 0.46 * strike;
        r.pelvis.position.y -= 0.08 * strike;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.x -= 0.55 * strike;
          r.rightArm.elbow.rotation.x += 0.4 * strike;
        }
        if (r.leftArm) {
          r.leftArm.shoulder.rotation.x -= 0.45 * strike;
        }
        for (const w of r.wings) {
          w.pivot.rotation.y += w.side * 0.42 * strike;
        }
        break;
      }

      case 'bow_shot': {
        r.modelRoot.position.z = -0.06 * strike * r.baseScale;
        if (r.leftArm) r.leftArm.shoulder.rotation.x = -1.45;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.x = -1.45 - 0.35 * strike;
          r.rightArm.elbow.rotation.x += 0.55 * strike;
        }
        break;
      }

      case 'staff_cast': {
        r.modelRoot.position.z = 0.14 * strike * r.baseScale;
        r.torso.rotation.x += 0.25 * strike;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.x -= 0.95 * strike;
        }
        if (r.leftArm) {
          r.leftArm.shoulder.rotation.x -= 0.85 * strike;
        }
        break;
      }

      case 'twin_dash': {
        r.modelRoot.position.z = 0.36 * strike * r.baseScale;
        r.torso.rotation.x += 0.38 * strike;
        if (r.rightArm) {
          r.rightArm.shoulder.rotation.z -= 1.15 * strike;
          r.rightArm.shoulder.rotation.x -= 0.65 * strike;
        }
        if (r.leftArm) {
          r.leftArm.shoulder.rotation.z += 1.15 * strike;
          r.leftArm.shoulder.rotation.x -= 0.65 * strike;
        }
        break;
      }

      case 'arachnid_strike': {
        r.modelRoot.position.z = 0.26 * strike * r.baseScale;
        r.pelvis.rotation.x += 0.24 * strike;
        if (r.jaw) r.jaw.rotation.x += 0.35 * strike;
        for (const leg of r.spiderLegs) {
          if (leg.rowIndex <= 1) {
            leg.coxa.rotation.y += leg.side * 0.45 * strike;
            leg.femur.rotation.z += leg.side * 0.28 * strike;
          }
        }
        break;
      }

      case 'bite_lunge': {
        r.modelRoot.position.z = 0.34 * strike * r.baseScale;
        r.modelRoot.position.y += Math.sin(u * Math.PI) * 0.22 * r.baseScale;
        if (r.jaw) {
          r.jaw.rotation.x = u < 0.22 ? 0.7 : 0.02;
        }
        for (const qLeg of r.quadLegs) {
          qLeg.upper.rotation.x += (qLeg.isFront ? -0.65 : 0.65) * strike;
        }
        break;
      }
    }
  }

  /* ==========================================================================
   * CAST — Arcane / Necrotic / Boss Phase Invocation
   * ======================================================================== */
  private poseCast(t: number): void {
    const r = this.rig;
    const wave = Math.sin((t / CAST_CYCLE_SEC) * Math.PI * 2);
    const lift = clamp(t / 0.3, 0, 1);
    this.telegraphFactor = 0.45 + 0.25 * (wave * 0.5 + 0.5);

    r.modelRoot.position.y = r.hoverBaseY + (0.14 * lift + 0.04 * wave) * r.baseScale;
    r.head.rotation.x -= 0.3 * lift;
    r.torso.rotation.x -= 0.14 * lift;

    if (r.rightArm) {
      r.rightArm.shoulder.rotation.x -= 1.55 * lift + wave * 0.12;
      r.rightArm.shoulder.rotation.z -= 0.25 * lift;
    }
    if (r.leftArm) {
      r.leftArm.shoulder.rotation.x -= 1.45 * lift - wave * 0.12;
      r.leftArm.shoulder.rotation.z += 0.35 * lift;
    }
    for (const w of r.wings) {
      w.pivot.rotation.z -= w.side * (0.4 * lift + wave * 0.12);
    }
  }

  /* ==========================================================================
   * HIT — Sharp Stagger Recoil
   * ======================================================================== */
  private poseHit(u: number): void {
    const r = this.rig;
    const flinch = Math.sin(u * Math.PI);

    r.modelRoot.position.z = -0.14 * flinch * r.baseScale;
    r.torso.rotation.x -= 0.34 * flinch;
    r.torso.rotation.z += 0.14 * flinch;
    r.head.rotation.x -= 0.28 * flinch;

    if (r.leftArm) r.leftArm.shoulder.rotation.z += 0.35 * flinch;
    if (r.rightArm) r.rightArm.shoulder.rotation.z -= 0.35 * flinch;
  }

  /* ==========================================================================
   * DEATH — Collapse + GLSL Procedural Noise Edge-Burn Disintegration
   * ======================================================================== */
  private poseDeath(t: number): void {
    const r = this.rig;
    const collapseDur = r.isBoss ? BOSS_COLLAPSE_SEC : MONSTER_COLLAPSE_SEC;
    const dissolveTotalDur = r.isBoss ? BOSS_DISSOLVE_TOTAL_SEC : MONSTER_DISSOLVE_TOTAL_SEC;
    const dissolveDelay = r.isBoss ? 0.14 : 0.08;

    const collapse = clamp(t / collapseDur, 0, 1);
    const easeCollapse = 1 - Math.pow(1 - collapse, 3);

    const rawDissolve = clamp(
      (t - dissolveDelay) / Math.max(0.2, dissolveTotalDur - dissolveDelay),
      0,
      1,
    );
    // Smooth S-curve disintegration sweep
    this.dissolveProgress = rawDissolve * rawDissolve * (3 - 2 * rawDissolve);

    const settle = clamp((t - collapseDur * 0.85) / Math.max(0.3, dissolveTotalDur - collapseDur * 0.85), 0, 1);
    const easeSettle = settle * settle;

    this.deathDimFactor = clamp(collapse * 0.45 + this.dissolveProgress * 0.55, 0, 1);

    // Subtle ash-settle keeping corpse visible on floor while GLSL edge-burn shader disintegrates it
    const sinkDepth = r.bodyHeight * r.baseScale * 0.24 * easeSettle;

    switch (r.locomotion) {
      case 'arachnid': {
        r.pelvis.position.y = r.pelvis.position.y * (1 - easeCollapse * 0.65);
        r.modelRoot.position.y = -sinkDepth;
        for (const leg of r.spiderLegs) {
          leg.femur.rotation.z -= leg.side * 0.75 * easeCollapse;
          leg.tibia.rotation.z += leg.side * 0.95 * easeCollapse;
        }
        break;
      }

      case 'quadruped': {
        r.pelvis.position.y = r.pelvis.position.y * (1 - easeCollapse * 0.68);
        r.pelvis.rotation.z = 1.42 * easeCollapse;
        r.modelRoot.position.y = -sinkDepth;
        break;
      }

      case 'floating': {
        r.modelRoot.position.y = r.hoverBaseY * (1 - easeCollapse) - sinkDepth;
        r.modelRoot.rotation.y = easeCollapse * 1.15;
        r.pelvis.position.y = r.pelvis.position.y * (1 - easeCollapse * 0.72);
        r.torso.rotation.x += 1.25 * easeCollapse;
        if (r.leftArm) r.leftArm.shoulder.rotation.z += 0.65 * easeCollapse;
        if (r.rightArm) r.rightArm.shoulder.rotation.z -= 0.65 * easeCollapse;
        break;
      }

      case 'biped':
      case 'heavy_biped': {
        if (r.leftLeg && r.rightLeg) {
          r.leftLeg.hip.rotation.x -= 0.65 * easeCollapse;
          r.leftLeg.knee.rotation.x += 1.25 * easeCollapse;
          r.rightLeg.hip.rotation.x -= 0.5 * easeCollapse;
          r.rightLeg.knee.rotation.x += 1.1 * easeCollapse;
        }
        r.pelvis.position.y = r.pelvis.position.y * (1 - easeCollapse * 0.76);
        r.pelvis.rotation.x += 1.42 * easeCollapse;
        if (r.leftArm) r.leftArm.shoulder.rotation.z += 0.85 * easeCollapse;
        if (r.rightArm) r.rightArm.shoulder.rotation.z -= 0.85 * easeCollapse;
        r.modelRoot.position.y = -sinkDepth;
        break;
      }
    }
  }

  /* ==========================================================================
   * CONTINUOUS SECONDARY MOTION (Orbiters, Wings, Tendrils, Capes, Weakpoints)
   * ======================================================================== */
  private applySecondaryMotion(t: number, orbitSpeedMul: number, weakpointPulseMul: number): void {
    const r = this.rig;

    for (const orb of r.orbiters) {
      const ang = orb.phase + t * orb.speed * orbitSpeedMul;
      const yBob = Math.sin(t * 3.1 + orb.phase) * orb.bobAmp;
      orb.item.position.set(
        Math.cos(ang) * orb.radius,
        yBob * (1 - this.deathDimFactor),
        Math.sin(ang) * orb.radius,
      );
      orb.item.rotation.y = -ang + Math.PI * 0.5;
      orb.item.rotation.z = Math.sin(t * 2.4 + orb.phase) * orb.tiltAmp;
    }

    for (const w of r.wings) {
      const tierPhase = (w.tierIndex ?? 0) * 0.75;
      const flap = Math.sin(t * 2.8 - tierPhase) * 0.12 * (1 - this.deathDimFactor);
      w.pivot.rotation.y += w.side * flap;
      w.pivot.rotation.z -= w.side * flap * 0.5;
    }

    for (const gear of r.spinningGears) {
      const spinAngle = t * gear.speed * orbitSpeedMul * (1 - this.deathDimFactor * 0.85);
      gear.node.rotation[gear.axis] = spinAngle;
    }

    for (const tendril of r.tendrils) {
      tendril.segments.forEach((seg, idx) => {
        const wave = Math.sin(t * 3.6 - idx * 0.75 + tendril.phase) * (1 - this.deathDimFactor);
        seg.rotation.x += wave * 0.14;
        seg.rotation.z += Math.cos(t * 2.9 - idx * 0.65 + tendril.phase) * 0.12;
      });
    }

    r.capeSegments.forEach((cape, idx) => {
      const billow = Math.sin(t * 3.2 + idx * 0.9) * 0.08 * (1 - this.deathDimFactor);
      cape.rotation.x += billow + (this.state === 'walk' ? 0.18 : 0);
    });

    if (r.crown && r.crown.name === 'shattered_crown') {
      r.crown.position.y += Math.sin(t * 3.0) * 0.025 * (1 - this.deathDimFactor);
      r.crown.rotation.y += t * 0.45;
    }

    if (r.locomotion === 'quadruped') {
      r.tailSegments.forEach((seg, idx) => {
        seg.rotation.y += Math.sin(t * 4.8 - idx * 0.7) * 0.22 * (1 - this.deathDimFactor);
      });
    } else if (r.locomotion === 'arachnid' && r.tailSegments[0]) {
      const sacPulse = 1 + Math.sin(t * 3.6) * 0.045 * (1 - this.deathDimFactor);
      r.tailSegments[0].scale.set(sacPulse, sacPulse, 1);
    }

    for (const wp of r.weakpoints) {
      const beat = 0.5 + 0.5 * Math.sin(t * 5.2 + wp.phase);
      const s = wp.baseScale * (1 + beat * 0.16 * weakpointPulseMul) * (1 - this.deathDimFactor * 0.5);
      wp.mesh.scale.setScalar(Math.max(0.05, s));
      wp.mesh.rotation.y = t * 1.8 + wp.phase;
    }
  }
}
