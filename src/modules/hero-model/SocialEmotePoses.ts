import * as THREE from 'three';
import type { SocialEmoteId, WeaponVisualType } from '../../contracts/types';
import { clamp } from '../../core/Constants';

export type EmoteVec3Tuple = [number, number, number];

export interface EmotePoseTarget {
  pelvisOffset: EmoteVec3Tuple;
  pelvisRot: EmoteVec3Tuple;
  rollRot: EmoteVec3Tuple;
  torsoRot: EmoteVec3Tuple;
  headRot: EmoteVec3Tuple;
  rShoulder: EmoteVec3Tuple;
  rElbow: EmoteVec3Tuple;
  rHand: EmoteVec3Tuple;
  lShoulder: EmoteVec3Tuple;
  lElbow: EmoteVec3Tuple;
  lHand: EmoteVec3Tuple;
  rHip: EmoteVec3Tuple;
  rKnee: EmoteVec3Tuple;
  rBoot: EmoteVec3Tuple;
  lHip: EmoteVec3Tuple;
  lKnee: EmoteVec3Tuple;
  lBoot: EmoteVec3Tuple;
}

/**
 * Timed one-shot emotes have a finite duration in seconds;
 * looping/persistent emotes use `null` and hold/cycle until canceled.
 */
export const SOCIAL_EMOTE_DURATIONS: Record<SocialEmoteId, number | null> = {
  wave: 1.85,
  cheer: 1.95,
  dance: null,
  taunt: 1.8,
  kneel_pray: null,
  sit_rest: null,
  laugh: 1.85,
  point: 1.65,
  high_five_ready: null,
  high_five_strike: 0.84,
  downed_kneel: null,
  revive_channel: null,
};

export function isLoopingIdleEmote(emote: SocialEmoteId): boolean {
  return (
    emote === 'dance' ||
    emote === 'sit_rest' ||
    emote === 'kneel_pray' ||
    emote === 'high_five_ready' ||
    emote === 'revive_channel'
  );
}

function set3(dst: EmoteVec3Tuple, x: number, y: number, z: number): void {
  dst[0] = x;
  dst[1] = y;
  dst[2] = z;
}

function zeroEmotePose(p: EmotePoseTarget): void {
  set3(p.pelvisOffset, 0, 0, 0);
  set3(p.pelvisRot, 0, 0, 0);
  set3(p.rollRot, 0, 0, 0);
  set3(p.torsoRot, 0, 0, 0);
  set3(p.headRot, 0, 0, 0);
  set3(p.rShoulder, 0, 0, 0);
  set3(p.rElbow, 0, 0, 0);
  set3(p.rHand, 0, 0, 0);
  set3(p.lShoulder, 0, 0, 0);
  set3(p.lElbow, 0, 0, 0);
  set3(p.lHand, 0, 0, 0);
  set3(p.rHip, 0, 0, 0);
  set3(p.rKnee, 0, 0, 0);
  set3(p.rBoot, 0, 0, 0);
  set3(p.lHip, 0, 0, 0);
  set3(p.lKnee, 0, 0, 0);
  set3(p.lBoot, 0, 0, 0);
}

function smoothEnvelope(elapsed: number, totalDur: number, fadeIn = 0.2, fadeOut = 0.28): number {
  if (elapsed < fadeIn) {
    const u = clamp(elapsed / Math.max(0.001, fadeIn), 0, 1);
    return 1 - Math.pow(1 - u, 3);
  }
  if (elapsed > totalDur - fadeOut) {
    const u = clamp((totalDur - elapsed) / Math.max(0.001, fadeOut), 0, 1);
    return u * u * (3 - 2 * u);
  }
  return 1;
}

export function evaluateSocialEmotePose(
  emote: SocialEmoteId,
  elapsed: number,
  weapon: WeaponVisualType,
  out: EmotePoseTarget,
): void {
  zeroEmotePose(out);

  switch (emote) {
    case 'wave': {
      // Friendly high overhead hand wave with warm contrapposto sway
      const env = smoothEnvelope(elapsed, 1.85, 0.22, 0.3);
      const waveOsc = Math.sin(elapsed * 9.2);
      const sway = Math.sin(elapsed * 3.1) * 0.03;

      set3(out.pelvisOffset, 0.03 * env, -0.02 * env, 0);
      set3(out.pelvisRot, 0, -0.08 * env, 0.05 * env);
      set3(out.torsoRot, -0.06 * env, -0.14 * env, (-0.08 + sway) * env);
      set3(out.headRot, -0.08 * env, 0.12 * env, (-0.1 + waveOsc * 0.04) * env);

      // Left arm raised high waving warmly side-to-side
      set3(
        out.lShoulder,
        -2.55 * env,
        -0.12 * env,
        (0.42 + waveOsc * 0.28) * env,
      );
      set3(out.lElbow, (-0.42 + waveOsc * 0.18) * env, 0, (-0.15 + waveOsc * 0.32) * env);
      set3(out.lHand, 0, 0, waveOsc * 0.25 * env);

      // Right weapon arm lowered comfortably at side
      set3(out.rShoulder, -0.26 * env, 0.15 * env, -0.28 * env);
      set3(out.rElbow, -0.52 * env, 0, 0.12 * env);

      set3(out.rHip, -0.06 * env, 0, -0.06 * env);
      set3(out.rKnee, 0.14 * env, 0, 0);
      set3(out.lHip, 0.05 * env, 0, 0.05 * env);
      set3(out.lKnee, 0.08 * env, 0, 0);
      return;
    }

    case 'cheer': {
      // Double-arm victory pump + joyful vertical hops!
      const env = smoothEnvelope(elapsed, 1.95, 0.18, 0.28);
      const pumpPhase = elapsed * 8.4;
      const hop = Math.max(0, Math.sin(pumpPhase));
      const pump = 0.5 + 0.5 * Math.sin(pumpPhase);

      set3(out.pelvisOffset, 0, (hop * 0.26 - (1 - hop) * 0.06) * env, 0);
      set3(out.torsoRot, (-0.22 - pump * 0.08) * env, Math.sin(elapsed * 4.2) * 0.12 * env, 0);
      set3(out.headRot, (-0.24 - pump * 0.06) * env, 0, 0);

      // Both arms pumping triumphantly skyward
      set3(out.rShoulder, (-2.35 - pump * 0.42) * env, 0.18 * env, (-0.34 - pump * 0.1) * env);
      set3(out.rElbow, (-0.48 + pump * 0.28) * env, 0, 0);
      set3(out.lShoulder, (-2.35 - pump * 0.42) * env, -0.18 * env, (0.34 + pump * 0.1) * env);
      set3(out.lElbow, (-0.48 + pump * 0.28) * env, 0, 0);

      // Springy knee tuck in air / bend on landing
      const kneeBend = hop > 0.1 ? hop * 0.52 : (1 - hop) * 0.28;
      set3(out.rHip, -kneeBend * 0.65 * env, 0, -0.08 * env);
      set3(out.rKnee, kneeBend * 1.15 * env, 0, 0);
      set3(out.lHip, -kneeBend * 0.55 * env, 0, 0.08 * env);
      set3(out.lKnee, kneeBend * 1.05 * env, 0, 0);
      return;
    }

    case 'dance': {
      // Rhythmic spinning tavern dance + funky alternating arm & hip groove!
      const intro = clamp(elapsed / 0.22, 0, 1);
      const beat = elapsed * 6.8;
      const halfBeat = beat * 0.5;
      const s = Math.sin(beat);
      const hs = Math.sin(halfBeat);
      const hc = Math.cos(halfBeat);

      // Smooth 360° tavern spin on every 4th measure, groovy sway in between
      const barPos = (elapsed % 3.2) / 3.2;
      const spinTurn =
        barPos > 0.68
          ? ((barPos - 0.68) / 0.32) * Math.PI * 2
          : hs * 0.28;

      set3(
        out.pelvisOffset,
        hs * 0.095 * intro,
        (Math.abs(s) * 0.095 - 0.07) * intro,
        0,
      );
      set3(out.pelvisRot, 0.05 * intro, -hs * 0.22 * intro, hs * 0.13 * intro);
      set3(out.rollRot, 0, spinTurn * intro, 0);
      set3(out.torsoRot, (0.06 - Math.abs(s) * 0.08) * intro, hs * 0.3 * intro, -hs * 0.12 * intro);
      set3(out.headRot, Math.abs(s) * 0.12 * intro, -hs * 0.18 * intro, hc * 0.1 * intro);

      // Alternating high-low tavern arm groove
      const rHigh = Math.max(0, hs);
      const lHigh = Math.max(0, -hs);
      set3(
        out.rShoulder,
        (-1.15 - rHigh * 1.25) * intro,
        0.25 * intro,
        (-0.48 - rHigh * 0.35) * intro,
      );
      set3(out.rElbow, (-0.95 + rHigh * 0.45) * intro, 0, hs * 0.25 * intro);

      set3(
        out.lShoulder,
        (-1.15 - lHigh * 1.25) * intro,
        -0.25 * intro,
        (0.48 + lHigh * 0.35) * intro,
      );
      set3(out.lElbow, (-0.95 + lHigh * 0.45) * intro, 0, hs * 0.25 * intro);

      // Step-kick tavern footwork
      set3(out.rHip, (-0.25 - rHigh * 0.55) * intro, 0, (-0.08 - rHigh * 0.12) * intro);
      set3(out.rKnee, (0.35 + rHigh * 0.78) * intro, 0, 0);
      set3(out.lHip, (-0.25 - lHigh * 0.55) * intro, 0, (0.08 + lHigh * 0.12) * intro);
      set3(out.lKnee, (0.35 + lHigh * 0.78) * intro, 0, 0);
      return;
    }

    case 'taunt': {
      // Cocky double chest-thump -> "Come at me!" beckon
      const env = smoothEnvelope(elapsed, 1.8, 0.16, 0.25);
      const u = clamp(elapsed / 1.8, 0, 1);

      set3(out.pelvisOffset, 0, -0.07 * env, 0.06 * env);
      set3(out.rHip, -0.22 * env, 0, -0.14 * env);
      set3(out.rKnee, 0.32 * env, 0, 0);
      set3(out.lHip, 0.16 * env, 0, 0.14 * env);
      set3(out.lKnee, 0.24 * env, 0, 0);

      // Right weapon held wide & cocky out to the side
      set3(out.rShoulder, -0.78 * env, -0.24 * env, -1.08 * env);
      set3(out.rElbow, -0.32 * env, 0, 0);

      if (u < 0.48) {
        // Double chest-thump with left gauntlet
        const thump = Math.abs(Math.sin((u / 0.48) * Math.PI * 2));
        set3(out.torsoRot, (-0.12 + thump * 0.1) * env, 0.18 * env, 0);
        set3(out.headRot, -0.16 * env, -0.15 * env, 0.08 * env);
        set3(out.lShoulder, -0.92 * env, -0.52 * env, (-0.42 + thump * 0.18) * env);
        set3(out.lElbow, (-1.62 + thump * 0.35) * env, 0, 0);
      } else {
        // Extended "Come at me!" beckon curl
        const beckon = 0.5 + 0.5 * Math.sin(((u - 0.48) / 0.52) * Math.PI * 4);
        set3(out.torsoRot, 0.14 * env, -0.26 * env, 0);
        set3(out.headRot, -0.18 * env, 0.24 * env, -0.08 * env);
        set3(out.lShoulder, -1.48 * env, 0.22 * env, 0.08 * env);
        set3(out.lElbow, (-0.28 - beckon * 0.68) * env, 0, 0);
        set3(out.lHand, -beckon * 0.45 * env, 0, 0);
      }
      return;
    }

    case 'kneel_pray': {
      // Solemn one-knee knight genuflect bow
      const k = 1 - Math.pow(1 - clamp(elapsed / 0.42, 0, 1), 3);
      const breath = Math.sin(elapsed * 2.0) * 0.02;

      set3(out.pelvisOffset, 0, -0.43 * k, 0);
      set3(out.torsoRot, (0.28 + breath) * k, 0, 0);
      set3(out.headRot, (0.38 + breath * 0.6) * k, 0, 0);

      // Hands clasped reverently in front over weapon guard
      set3(out.rShoulder, -0.98 * k, 0.38 * k, 0.22 * k);
      set3(out.rElbow, -0.92 * k, 0, -0.28 * k);
      set3(out.lShoulder, -0.98 * k, -0.38 * k, -0.22 * k);
      set3(out.lElbow, -0.95 * k, 0, 0.28 * k);

      // Right knee forward 90° knight brace; Left knee resting on dungeon stone
      set3(out.rHip, -1.18 * k, 0, -0.06 * k);
      set3(out.rKnee, 1.26 * k, 0, 0);
      set3(out.rBoot, -0.08 * k, 0, 0);

      set3(out.lHip, 0.24 * k, 0, 0.06 * k);
      set3(out.lKnee, 1.52 * k, 0, 0);
      set3(out.lBoot, 0.28 * k, 0, 0);
      return;
    }

    case 'sit_rest': {
      // Relaxed cross-legged campfire sit
      const k = 1 - Math.pow(1 - clamp(elapsed / 0.45, 0, 1), 3);
      const breath = Math.sin(elapsed * 1.8) * 0.025;
      const lookAround = Math.sin(elapsed * 0.85) * 0.18;

      set3(out.pelvisOffset, 0, -0.73 * k, -0.04 * k);
      set3(out.torsoRot, (0.1 + breath) * k, lookAround * 0.25 * k, 0);
      set3(out.headRot, (-0.04 + breath) * k, lookAround * k, 0);

      // Forearms resting comfortably on crossed knees
      set3(out.rShoulder, -0.58 * k, 0.22 * k, -0.28 * k);
      set3(out.rElbow, -0.84 * k, 0, 0.24 * k);
      set3(out.lShoulder, -0.58 * k, -0.22 * k, 0.28 * k);
      set3(out.lElbow, -0.84 * k, 0, -0.24 * k);

      // Cross-legged tailor sit geometry
      set3(out.rHip, -1.26 * k, -0.52 * k, -0.6 * k);
      set3(out.rKnee, 1.64 * k, 0, 0);
      set3(out.rBoot, 0.2 * k, 0, 0);

      set3(out.lHip, -1.22 * k, 0.52 * k, 0.6 * k);
      set3(out.lKnee, 1.62 * k, 0, 0);
      set3(out.lBoot, 0.2 * k, 0, 0);
      return;
    }

    case 'laugh': {
      // Hearty shoulders-shaking belly laugh!
      const env = smoothEnvelope(elapsed, 1.85, 0.18, 0.28);
      const chuckle = Math.sin(elapsed * 18.0);
      const heave = 0.5 + 0.5 * chuckle;

      set3(out.pelvisOffset, 0, (-0.04 + heave * 0.035) * env, -0.04 * env);
      set3(out.torsoRot, (-0.26 + chuckle * 0.07) * env, Math.sin(elapsed * 3.5) * 0.1 * env, 0);
      set3(out.headRot, (-0.32 + chuckle * 0.09) * env, 0, Math.sin(elapsed * 4.5) * 0.08 * env);

      // Left hand clutching belly, both shoulders shaking with laughter
      set3(out.lShoulder, (-0.64 + chuckle * 0.08) * env, -0.46 * env, -0.32 * env);
      set3(out.lElbow, -1.46 * env, 0, 0);

      set3(out.rShoulder, (-0.42 + chuckle * 0.1) * env, 0.18 * env, (-0.36 - heave * 0.08) * env);
      set3(out.rElbow, -0.72 * env, 0, 0.15 * env);

      set3(out.rHip, -0.14 * env, 0, -0.08 * env);
      set3(out.rKnee, 0.24 * env, 0, 0);
      set3(out.lHip, 0.08 * env, 0, 0.08 * env);
      set3(out.lKnee, 0.18 * env, 0, 0);
      return;
    }

    case 'point': {
      // Dramatic forward tactical arm point along +Z!
      const env = smoothEnvelope(elapsed, 1.65, 0.15, 0.26);

      set3(out.pelvisOffset, 0, -0.07 * env, 0.14 * env);
      set3(out.pelvisRot, 0.04 * env, -0.22 * env, 0);
      set3(out.torsoRot, 0.14 * env, -0.36 * env, 0);
      set3(out.headRot, -0.1 * env, 0.34 * env, 0);

      // Left arm extended straight horizontal dead-ahead (+Z)
      set3(out.lShoulder, -1.54 * env, 0.34 * env, 0.04 * env);
      set3(out.lElbow, -0.04 * env, 0, 0);
      set3(out.lHand, 0, 0, 0);

      // Right weapon poised back in heroic counter-balance
      set3(out.rShoulder, -0.24 * env, -0.22 * env, -0.52 * env);
      set3(out.rElbow, -0.58 * env, 0, 0.12 * env);

      set3(out.lHip, -0.36 * env, 0, 0.06 * env);
      set3(out.lKnee, 0.46 * env, 0, 0);
      set3(out.rHip, 0.28 * env, 0, -0.06 * env);
      set3(out.rKnee, 0.22 * env, 0, 0);
      return;
    }

    case 'high_five_ready': {
      // Weapon & hand raised high waiting for co-op Sworn Brethren partner!
      const k = 1 - Math.pow(1 - clamp(elapsed / 0.25, 0, 1), 3);
      const bob = Math.sin(elapsed * 4.6) * 0.07;

      set3(out.pelvisOffset, 0, (0.02 + Math.abs(bob) * 0.25) * k, 0.04 * k);
      set3(out.torsoRot, (-0.14 + bob * 0.3) * k, -0.12 * k, 0);
      set3(out.headRot, -0.16 * k, 0.1 * k, 0);

      // Right weapon & open left palm held high & inviting
      set3(out.rShoulder, (-2.05 + bob) * k, 0.2 * k, -0.32 * k);
      set3(out.rElbow, -0.38 * k, 0, 0);
      set3(out.lShoulder, (-2.28 + bob) * k, -0.14 * k, 0.22 * k);
      set3(out.lElbow, -0.22 * k, 0, 0);

      set3(out.rHip, -0.14 * k, 0, -0.07 * k);
      set3(out.rKnee, 0.22 * k, 0, 0);
      set3(out.lHip, 0.1 * k, 0, 0.07 * k);
      set3(out.lKnee, 0.16 * k, 0, 0);
      return;
    }

    case 'high_five_strike': {
      // Heroic leap-step mid-air weapon clash / high-five impact!
      const u = clamp(elapsed / 0.84, 0, 1);
      if (u < 0.22) {
        const c = 1 - Math.pow(1 - u / 0.22, 3);
        set3(out.pelvisOffset, 0, -0.18 * c, -0.06 * c);
        set3(out.torsoRot, -0.22 * c, -0.28 * c, 0);
        set3(out.rShoulder, -2.42 * c, 0.22 * c, -0.45 * c);
        set3(out.rElbow, -0.52 * c, 0, 0);
        set3(out.lShoulder, -2.35 * c, -0.22 * c, 0.45 * c);
        set3(out.lElbow, -0.48 * c, 0, 0);
        set3(out.rHip, -0.45 * c, 0, -0.06);
        set3(out.rKnee, 0.78 * c, 0, 0);
      } else if (u < 0.68) {
        const a = (u - 0.22) / 0.46;
        const leapArc = Math.sin(a * Math.PI) * 0.64;
        const strike = 1 - Math.pow(1 - Math.min(1, a * 2.1), 3);

        set3(out.pelvisOffset, 0, leapArc, THREE.MathUtils.lerp(-0.06, 0.26, strike));
        set3(
          out.torsoRot,
          THREE.MathUtils.lerp(-0.22, 0.22, strike),
          THREE.MathUtils.lerp(-0.28, 0.24, strike),
          0,
        );
        set3(out.headRot, -0.18, 0, 0);

        // Twin-blade / high-five apex clash forward-high!
        set3(
          out.rShoulder,
          THREE.MathUtils.lerp(-2.42, -1.62, strike),
          THREE.MathUtils.lerp(0.22, 0.38, strike),
          THREE.MathUtils.lerp(-0.45, 0.22, strike),
        );
        set3(out.rElbow, THREE.MathUtils.lerp(-0.52, -0.14, strike), 0, 0);
        set3(out.rHand, 0.36 * strike, 0, -0.18 * strike);

        set3(
          out.lShoulder,
          THREE.MathUtils.lerp(-2.35, -1.68, strike),
          THREE.MathUtils.lerp(-0.22, -0.34, strike),
          THREE.MathUtils.lerp(0.45, -0.18, strike),
        );
        set3(out.lElbow, THREE.MathUtils.lerp(-0.48, -0.12, strike), 0, 0);

        set3(out.rHip, -0.68 * (1 - a * 0.3), 0, -0.07);
        set3(out.rKnee, 1.05 * (1 - a * 0.3), 0, 0);
        set3(out.lHip, 0.24, 0, 0.07);
        set3(out.lKnee, 0.72, 0, 0);
      } else {
        const rec = 1 - ((u - 0.68) / 0.32);
        const s = rec * rec * (3 - 2 * rec);
        set3(out.pelvisOffset, 0, -0.12 * s, 0.22 * s);
        set3(out.torsoRot, 0.16 * s, 0.2 * s, 0);
        set3(out.rShoulder, -1.45 * s - 0.35 * (1 - s), 0.3 * s, 0.1 * s);
        set3(out.rElbow, -0.28, 0, 0);
        set3(out.lShoulder, -1.45 * s - 0.35 * (1 - s), -0.3 * s, -0.1 * s);
        set3(out.lElbow, -0.28, 0, 0);
        set3(out.rHip, -0.38 * s, 0, -0.06);
        set3(out.rKnee, 0.52 * s, 0, 0);
      }
      return;
    }

    case 'downed_kneel': {
      // Wounded one-knee bleedout slump (held until revived / playAnim('idle') / playEquipFlourish!)
      const k = 1 - Math.pow(1 - clamp(elapsed / 0.38, 0, 1), 3);
      const painBreath = Math.sin(elapsed * 3.2);

      set3(out.pelvisOffset, 0.03 * k, (-0.46 + painBreath * 0.018) * k, -0.04 * k);
      set3(out.pelvisRot, 0.08 * k, -0.1 * k, 0.08 * k);
      set3(out.torsoRot, (0.54 + painBreath * 0.05) * k, -0.14 * k, 0.14 * k);
      set3(out.headRot, (0.42 + painBreath * 0.06) * k, 0.16 * k, 0.1 * k);

      // Left arm clutching wounded ribs; right arm propping weapon downward on stone
      set3(out.lShoulder, -0.72 * k, -0.48 * k, -0.38 * k);
      set3(out.lElbow, -1.45 * k, 0, 0);

      const propPitch = weapon === 'staff' ? -0.62 : -0.78;
      set3(out.rShoulder, propPitch * k, 0.12 * k, -0.34 * k);
      set3(out.rElbow, -0.42 * k, 0, 0);

      // Right knee buckled to stone, left knee braced low
      set3(out.rHip, 0.28 * k, 0, -0.08 * k);
      set3(out.rKnee, 1.56 * k, 0, 0);
      set3(out.rBoot, 0.32 * k, 0, 0);

      set3(out.lHip, -1.08 * k, 0, 0.08 * k);
      set3(out.lKnee, 1.28 * k, 0, 0);
      set3(out.lBoot, -0.12 * k, 0, 0);
      return;
    }

    case 'revive_channel': {
      // Two-handed golden celestial prayer channel pose toward downed teammate!
      const k = 1 - Math.pow(1 - clamp(elapsed / 0.26, 0, 1), 3);
      const pulse = Math.sin(elapsed * 6.2) * 0.06;

      set3(out.pelvisOffset, 0, (-0.24 + pulse * 0.25) * k, 0.08 * k);
      set3(out.torsoRot, (0.28 - pulse * 0.3) * k, 0, 0);
      set3(out.headRot, 0.16 * k, 0, 0);

      // Both hands extended forward-downward channeling golden light
      set3(out.rShoulder, (-1.28 + pulse) * k, 0.3 * k, 0.16 * k);
      set3(out.rElbow, -0.34 * k, 0, -0.18 * k);
      set3(out.rHand, -0.32 * k, 0, 0);

      set3(out.lShoulder, (-1.28 + pulse) * k, -0.3 * k, -0.16 * k);
      set3(out.lElbow, -0.34 * k, 0, 0.18 * k);
      set3(out.lHand, -0.32 * k, 0, 0);

      set3(out.rHip, -0.52 * k, 0, -0.08 * k);
      set3(out.rKnee, 0.76 * k, 0, 0);
      set3(out.lHip, 0.34 * k, 0, 0.08 * k);
      set3(out.lKnee, 0.58 * k, 0, 0);
      return;
    }
  }
}
