import type { BiomeId, Vec3 } from '../../contracts/types';
import { BIOME_CONFIG } from '../../core/Constants';

export type EventAtmosphereMode = 'none' | 'blood_moon' | 'darkness_escort' | 'awakening';

export interface BiomeLightingProfile {
  biome: BiomeId;
  fogColorHex: number;
  fogDensity: number;
  ambientColorHex: number;
  ambientIntensity: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  hemiIntensity: number;
  dirColorHex: number;
  dirIntensity: number;
  dirOffset: Vec3;
  torchWarmHex: number;
  torchHotHex: number;
  torchBaseIntensity: number;
  torchDistance: number;
  torchDecay: number;
  heroLanternHex: number;
  heroLanternHotHex: number;
  heroLanternIntensity: number;
  heroLanternDistance: number;
  heroLanternDecay: number;
}

export interface ResolvedAtmosphereTarget {
  fogColorHex: number;
  fogDensity: number;
  ambientColorHex: number;
  ambientIntensity: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  hemiIntensity: number;
  dirColorHex: number;
  dirIntensity: number;
  heroLanternHex: number;
  heroLanternHotHex: number;
  heroLanternIntensity: number;
  heroLanternDistance: number;
}

export const BIOME_LIGHTING_PROFILES: Record<BiomeId, BiomeLightingProfile> = {
  sanctuary: {
    biome: 'sanctuary',
    fogColorHex: BIOME_CONFIG.sanctuary.fogColorHex,
    fogDensity: BIOME_CONFIG.sanctuary.fogDensity,
    ambientColorHex: BIOME_CONFIG.sanctuary.ambientHex,
    ambientIntensity: 3.35,
    hemiSkyHex: 0x92ace0,
    hemiGroundHex: 0x2b2634,
    hemiIntensity: 1.62,
    dirColorHex: 0xdce8ff,
    dirIntensity: 2.75,
    dirOffset: { x: -17, y: 38, z: 21 },
    torchWarmHex: 0xff9240,
    torchHotHex: 0xffd685,
    torchBaseIntensity: 6.7,
    torchDistance: 16.0,
    torchDecay: 1.4,
    heroLanternHex: 0xffc278,
    heroLanternHotHex: 0xffe4b3,
    heroLanternIntensity: 5.2,
    heroLanternDistance: 16.0,
    heroLanternDecay: 1.35,
  },
  crypt: {
    biome: 'crypt',
    fogColorHex: BIOME_CONFIG.crypt.fogColorHex,
    fogDensity: BIOME_CONFIG.crypt.fogDensity,
    ambientColorHex: BIOME_CONFIG.crypt.ambientHex,
    ambientIntensity: 3.1,
    hemiSkyHex: 0x738bc4,
    hemiGroundHex: 0x1c1a24,
    hemiIntensity: 1.4,
    dirColorHex: 0xb8ceff,
    dirIntensity: 2.45,
    dirOffset: { x: -18, y: 34, z: 20 },
    torchWarmHex: 0xff7b29,
    torchHotHex: 0xffbe6b,
    torchBaseIntensity: 6.4,
    torchDistance: 14.5,
    torchDecay: 1.45,
    heroLanternHex: 0xffb366,
    heroLanternHotHex: 0xffd599,
    heroLanternIntensity: 5.5,
    heroLanternDistance: 15.5,
    heroLanternDecay: 1.35,
  },
  caverns: {
    biome: 'caverns',
    fogColorHex: BIOME_CONFIG.caverns.fogColorHex,
    fogDensity: BIOME_CONFIG.caverns.fogDensity,
    ambientColorHex: BIOME_CONFIG.caverns.ambientHex,
    ambientIntensity: 3.2,
    hemiSkyHex: 0x56b386,
    hemiGroundHex: 0x16221a,
    hemiIntensity: 1.38,
    dirColorHex: 0xa4ebd0,
    dirIntensity: 2.25,
    dirOffset: { x: -16, y: 35, z: 18 },
    torchWarmHex: 0xff8533,
    torchHotHex: 0xffc470,
    torchBaseIntensity: 6.2,
    torchDistance: 14.0,
    torchDecay: 1.45,
    heroLanternHex: 0xffb86c,
    heroLanternHotHex: 0xffda9e,
    heroLanternIntensity: 5.6,
    heroLanternDistance: 15.5,
    heroLanternDecay: 1.35,
  },
  forge: {
    biome: 'forge',
    fogColorHex: BIOME_CONFIG.forge.fogColorHex,
    fogDensity: BIOME_CONFIG.forge.fogDensity,
    ambientColorHex: BIOME_CONFIG.forge.ambientHex,
    ambientIntensity: 3.0,
    hemiSkyHex: 0xd46d46,
    hemiGroundHex: 0x2b130e,
    hemiIntensity: 1.45,
    dirColorHex: 0xffb680,
    dirIntensity: 2.55,
    dirOffset: { x: -19, y: 33, z: 19 },
    torchWarmHex: 0xff6a1f,
    torchHotHex: 0xffb84d,
    torchBaseIntensity: 6.8,
    torchDistance: 15.0,
    torchDecay: 1.42,
    heroLanternHex: 0xffc680,
    heroLanternHotHex: 0xffe4b5,
    heroLanternIntensity: 5.8,
    heroLanternDistance: 16.0,
    heroLanternDecay: 1.35,
  },
  void: {
    biome: 'void',
    fogColorHex: BIOME_CONFIG.void.fogColorHex,
    fogDensity: BIOME_CONFIG.void.fogDensity,
    ambientColorHex: BIOME_CONFIG.void.ambientHex,
    ambientIntensity: 3.15,
    hemiSkyHex: 0x8e63e3,
    hemiGroundHex: 0x19102b,
    hemiIntensity: 1.42,
    dirColorHex: 0xd4bcff,
    dirIntensity: 2.5,
    dirOffset: { x: -17, y: 36, z: 21 },
    torchWarmHex: 0xff883b,
    torchHotHex: 0xffc980,
    torchBaseIntensity: 6.3,
    torchDistance: 14.5,
    torchDecay: 1.45,
    heroLanternHex: 0xffba75,
    heroLanternHotHex: 0xffdcb0,
    heroLanternIntensity: 5.6,
    heroLanternDistance: 15.5,
    heroLanternDecay: 1.35,
  },
  cathedral: {
    biome: 'cathedral',
    fogColorHex: BIOME_CONFIG.cathedral.fogColorHex,
    fogDensity: BIOME_CONFIG.cathedral.fogDensity,
    ambientColorHex: BIOME_CONFIG.cathedral.ambientHex,
    ambientIntensity: 3.25,
    hemiSkyHex: 0x62b8e8,
    hemiGroundHex: 0x102234,
    hemiIntensity: 1.5,
    dirColorHex: 0xb5ecff,
    dirIntensity: 2.65,
    dirOffset: { x: -20, y: 36, z: 18 },
    torchWarmHex: 0xff8a3d,
    torchHotHex: 0xffcf82,
    torchBaseIntensity: 6.4,
    torchDistance: 15.0,
    torchDecay: 1.44,
    heroLanternHex: 0xffbe73,
    heroLanternHotHex: 0xffe0ad,
    heroLanternIntensity: 5.6,
    heroLanternDistance: 15.5,
    heroLanternDecay: 1.35,
  },
  observatory: {
    biome: 'observatory',
    fogColorHex: BIOME_CONFIG.observatory.fogColorHex,
    fogDensity: BIOME_CONFIG.observatory.fogDensity,
    ambientColorHex: BIOME_CONFIG.observatory.ambientHex,
    ambientIntensity: 3.2,
    hemiSkyHex: 0x9084eb,
    hemiGroundHex: 0x241d38,
    hemiIntensity: 1.52,
    dirColorHex: 0xe6d8ff,
    dirIntensity: 2.6,
    dirOffset: { x: -16, y: 38, z: 20 },
    torchWarmHex: 0xff9b42,
    torchHotHex: 0xffdf8e,
    torchBaseIntensity: 6.5,
    torchDistance: 15.0,
    torchDecay: 1.43,
    heroLanternHex: 0xffc078,
    heroLanternHotHex: 0xffe3b5,
    heroLanternIntensity: 5.6,
    heroLanternDistance: 16.0,
    heroLanternDecay: 1.35,
  },
  colosseum: {
    biome: 'colosseum',
    fogColorHex: BIOME_CONFIG.colosseum.fogColorHex,
    fogDensity: BIOME_CONFIG.colosseum.fogDensity,
    ambientColorHex: BIOME_CONFIG.colosseum.ambientHex,
    ambientIntensity: 3.15,
    hemiSkyHex: 0xc94e5a,
    hemiGroundHex: 0x2e1014,
    hemiIntensity: 1.48,
    dirColorHex: 0xffa691,
    dirIntensity: 2.65,
    dirOffset: { x: -18, y: 35, z: 19 },
    torchWarmHex: 0xff661f,
    torchHotHex: 0xffbd59,
    torchBaseIntensity: 7.0,
    torchDistance: 16.0,
    torchDecay: 1.4,
    heroLanternHex: 0xffc47d,
    heroLanternHotHex: 0xffe6ba,
    heroLanternIntensity: 5.8,
    heroLanternDistance: 16.0,
    heroLanternDecay: 1.35,
  },
};

export function getBiomeLightingProfile(biome: BiomeId): BiomeLightingProfile {
  const base = BIOME_LIGHTING_PROFILES[biome] ?? BIOME_LIGHTING_PROFILES.crypt;
  const cfg = BIOME_CONFIG[biome] ?? BIOME_CONFIG.crypt;
  return {
    ...base,
    fogColorHex: cfg.fogColorHex,
    fogDensity: cfg.fogDensity,
    ambientColorHex: cfg.ambientHex,
  };
}

export function resolveEventAtmosphereTarget(
  profile: BiomeLightingProfile,
  mode: EventAtmosphereMode,
): ResolvedAtmosphereTarget {
  switch (mode) {
    case 'blood_moon':
      // Crimson blackout for The Butcher invasion
      return {
        fogColorHex: 0x210307,
        fogDensity: Math.max(0.028, profile.fogDensity * 1.48),
        ambientColorHex: 0x2e050a,
        ambientIntensity: profile.ambientIntensity * 0.56,
        hemiSkyHex: 0x780e1a,
        hemiGroundHex: 0x120204,
        hemiIntensity: profile.hemiIntensity * 0.68,
        dirColorHex: 0xff2233,
        dirIntensity: profile.dirIntensity * 0.6,
        heroLanternHex: 0xff8742,
        heroLanternHotHex: 0xffba6b,
        heroLanternIntensity: profile.heroLanternIntensity * 0.92,
        heroLanternDistance: profile.heroLanternDistance * 0.88,
      };

    case 'darkness_escort':
      // Claustrophobic pitch-darkness for Soul Lantern Escort
      return {
        fogColorHex: 0x020308,
        fogDensity: Math.max(0.042, profile.fogDensity * 2.15),
        ambientColorHex: 0x090c16,
        ambientIntensity: profile.ambientIntensity * 0.2,
        hemiSkyHex: 0x161f36,
        hemiGroundHex: 0x040508,
        hemiIntensity: profile.hemiIntensity * 0.24,
        dirColorHex: 0x455b8f,
        dirIntensity: profile.dirIntensity * 0.18,
        heroLanternHex: 0xffcf7a,
        heroLanternHotHex: 0xfff0b8,
        heroLanternIntensity: profile.heroLanternIntensity * 1.25,
        heroLanternDistance: 9.5,
      };

    case 'awakening':
      // Golden-violet Archon radiance for [R] Abyssal Awakening
      return {
        fogColorHex: 0x1f1033,
        fogDensity: Math.max(0.01, profile.fogDensity * 0.82),
        ambientColorHex: 0x5c3a84,
        ambientIntensity: profile.ambientIntensity * 1.22,
        hemiSkyHex: 0xffcf75,
        hemiGroundHex: 0x4b2178,
        hemiIntensity: profile.hemiIntensity * 1.42,
        dirColorHex: 0xffe2a3,
        dirIntensity: profile.dirIntensity * 1.35,
        heroLanternHex: 0xffdf8e,
        heroLanternHotHex: 0xe5adff,
        heroLanternIntensity: profile.heroLanternIntensity * 1.5,
        heroLanternDistance: profile.heroLanternDistance * 1.26,
      };

    case 'none':
    default:
      return {
        fogColorHex: profile.fogColorHex,
        fogDensity: profile.fogDensity,
        ambientColorHex: profile.ambientColorHex,
        ambientIntensity: profile.ambientIntensity,
        hemiSkyHex: profile.hemiSkyHex,
        hemiGroundHex: profile.hemiGroundHex,
        hemiIntensity: profile.hemiIntensity,
        dirColorHex: profile.dirColorHex,
        dirIntensity: profile.dirIntensity,
        heroLanternHex: profile.heroLanternHex,
        heroLanternHotHex: profile.heroLanternHotHex,
        heroLanternIntensity: profile.heroLanternIntensity,
        heroLanternDistance: profile.heroLanternDistance,
      };
  }
}
