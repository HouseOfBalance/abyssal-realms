import * as THREE from 'three';
import type { HeroClassId, ItemRarity } from '../../contracts/types';
import { HERO_CLASS_CONFIG, RARITY_COLORS } from '../../core/Constants';

export interface BaseEmissiveData {
  hex: number;
  intensity: number;
  isVisorOrRune?: boolean;
}

export interface ClassPalette {
  primaryArmor: THREE.MeshStandardMaterial;
  secondaryArmor: THREE.MeshStandardMaterial;
  trimGold: THREE.MeshStandardMaterial;
  darkUnderlayer: THREE.MeshStandardMaterial;
  capeMain: THREE.MeshStandardMaterial;
  capeTrim: THREE.MeshStandardMaterial;
  skinOrMask: THREE.MeshStandardMaterial;
  visorGlow: THREE.MeshStandardMaterial;
  groundAuraColorHex: number;
}

export interface WeaponMaterialSet {
  bladeSteel: THREE.MeshStandardMaterial;
  darkIron: THREE.MeshStandardMaterial;
  goldHilt: THREE.MeshStandardMaterial;
  leatherGrip: THREE.MeshStandardMaterial;
  woodShaft: THREE.MeshStandardMaterial;
  runeEmissive: THREE.MeshStandardMaterial;
  crystalCore: THREE.MeshStandardMaterial;
  rarityHex: number;
  baseRuneIntensity: number;
}

const RARITY_INTENSITY: Record<ItemRarity, number> = {
  common: 0.18,
  uncommon: 0.65,
  rare: 1.15,
  epic: 1.75,
  legendary: 2.5,
};

function createProceduralNoiseTexture(
  size: number,
  pattern: 'metal' | 'leather' | 'cloth',
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let seed = pattern === 'metal' ? 0x12345678 : pattern === 'leather' ? 0x87654321 : 0x55aa99cc;
  const nextRand = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let val = 200;
      if (pattern === 'metal') {
        // Brushed anisotropic metallic streaks + subtle micro-pitting
        const streak = Math.sin((y / size) * Math.PI * 16 + nextRand() * 0.5) * 14;
        const grain = (nextRand() - 0.5) * 20;
        val = Math.max(140, Math.min(255, Math.round(218 + streak + grain)));
      } else if (pattern === 'leather') {
        // Quilted diamond pebble grain
        const diagA = Math.abs(((x + y) % 8) - 4);
        const diagB = Math.abs(((x - y + size) % 8) - 4);
        const stitch = Math.min(diagA, diagB) === 0 ? -26 : 0;
        const pebble = (nextRand() - 0.5) * 28;
        val = Math.max(120, Math.min(255, Math.round(205 + stitch + pebble)));
      } else {
        // Woven cloth crosshatch + subtle damask wave
        const weave = ((x + y) % 2 === 0 ? 8 : -8) + Math.sin((x / size) * Math.PI * 6) * 10;
        const fuzz = (nextRand() - 0.5) * 16;
        val = Math.max(145, Math.min(255, Math.round(215 + weave + fuzz)));
      }
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.needsUpdate = true;
  return tex;
}

export class HeroMaterialManager {
  private readonly textures: THREE.Texture[] = [];
  private readonly armorMaterials = new Set<THREE.MeshStandardMaterial>();
  private readonly weaponMaterials = new Set<THREE.MeshStandardMaterial>();

  private readonly metalTex: THREE.DataTexture;
  private readonly leatherTex: THREE.DataTexture;
  private readonly clothTex: THREE.DataTexture;

  constructor() {
    this.metalTex = createProceduralNoiseTexture(64, 'metal');
    this.leatherTex = createProceduralNoiseTexture(64, 'leather');
    this.clothTex = createProceduralNoiseTexture(64, 'cloth');
    this.textures.push(this.metalTex, this.leatherTex, this.clothTex);
  }

  private registerArmorMat(
    params: THREE.MeshStandardMaterialParameters,
    isVisorOrRune = false,
  ): THREE.MeshStandardMaterial {
    const hasEmissive = params.emissive !== undefined;
    const mat = new THREE.MeshStandardMaterial({
      ...params,
      emissiveIntensity: hasEmissive ? (params.emissiveIntensity ?? 1) : 0,
    });
    const baseData: BaseEmissiveData = {
      hex: mat.emissive.getHex(),
      intensity: mat.emissiveIntensity,
      isVisorOrRune,
    };
    mat.userData.baseEmissive = baseData;
    this.armorMaterials.add(mat);
    return mat;
  }

  private registerWeaponMat(
    params: THREE.MeshStandardMaterialParameters,
    isVisorOrRune = false,
  ): THREE.MeshStandardMaterial {
    const hasEmissive = params.emissive !== undefined;
    const mat = new THREE.MeshStandardMaterial({
      ...params,
      emissiveIntensity: hasEmissive ? (params.emissiveIntensity ?? 1) : 0,
    });
    const baseData: BaseEmissiveData = {
      hex: mat.emissive.getHex(),
      intensity: mat.emissiveIntensity,
      isVisorOrRune,
    };
    mat.userData.baseEmissive = baseData;
    this.weaponMaterials.add(mat);
    return mat;
  }

  buildClassPalette(heroClass: HeroClassId): ClassPalette {
    this.disposeArmorMaterials();

    if (heroClass === 'vanguard') {
      // Heavy gothic steel/iron plate, brass/gold trim, fiery crimson cape & glowing visor
      return {
        primaryArmor: this.registerArmorMat({
          color: 0x7c8594,
          metalness: 0.86,
          roughness: 0.26,
          bumpMap: this.metalTex,
          bumpScale: 0.015,
        }),
        secondaryArmor: this.registerArmorMat({
          color: 0x2b2f3a,
          metalness: 0.78,
          roughness: 0.36,
          bumpMap: this.metalTex,
          bumpScale: 0.012,
        }),
        trimGold: this.registerArmorMat({
          color: 0xd4a44a,
          metalness: 0.9,
          roughness: 0.24,
          emissive: 0x3b2205,
          emissiveIntensity: 0.15,
        }),
        darkUnderlayer: this.registerArmorMat({
          color: 0x1b1a1e,
          metalness: 0.35,
          roughness: 0.72,
          bumpMap: this.leatherTex,
          bumpScale: 0.018,
        }),
        capeMain: this.registerArmorMat({
          color: 0xb01e24,
          metalness: 0.08,
          roughness: 0.76,
          bumpMap: this.clothTex,
          bumpScale: 0.02,
          emissive: 0x380508,
          emissiveIntensity: 0.2,
          side: THREE.DoubleSide,
        }),
        capeTrim: this.registerArmorMat({
          color: 0xd9a84e,
          metalness: 0.82,
          roughness: 0.32,
          side: THREE.DoubleSide,
        }),
        skinOrMask: this.registerArmorMat({
          color: 0x24262e,
          metalness: 0.7,
          roughness: 0.4,
        }),
        visorGlow: this.registerArmorMat(
          {
            color: 0xff5a36,
            emissive: 0xff2f19,
            emissiveIntensity: 2.1,
            metalness: 0.1,
            roughness: 0.15,
          },
          true,
        ),
        groundAuraColorHex: HERO_CLASS_CONFIG.vanguard.primaryColorHex,
      };
    }

    if (heroClass === 'shadowblade') {
      // Hooded obsidian leather, dark night-steel blades/studs, glowing emerald visor & shadow cloak
      return {
        primaryArmor: this.registerArmorMat({
          color: 0x23282e,
          metalness: 0.28,
          roughness: 0.56,
          bumpMap: this.leatherTex,
          bumpScale: 0.022,
        }),
        secondaryArmor: this.registerArmorMat({
          color: 0x14181d,
          metalness: 0.45,
          roughness: 0.44,
          bumpMap: this.leatherTex,
          bumpScale: 0.016,
        }),
        trimGold: this.registerArmorMat({
          color: 0x557564,
          metalness: 0.82,
          roughness: 0.28,
          emissive: 0x0b2917,
          emissiveIntensity: 0.25,
        }),
        darkUnderlayer: this.registerArmorMat({
          color: 0x0f1215,
          metalness: 0.15,
          roughness: 0.82,
          bumpMap: this.clothTex,
          bumpScale: 0.015,
        }),
        capeMain: this.registerArmorMat({
          color: 0x18211e,
          metalness: 0.1,
          roughness: 0.8,
          bumpMap: this.clothTex,
          bumpScale: 0.02,
          emissive: 0x061a0e,
          emissiveIntensity: 0.22,
          side: THREE.DoubleSide,
        }),
        capeTrim: this.registerArmorMat({
          color: 0x2f9e44,
          metalness: 0.45,
          roughness: 0.4,
          emissive: 0x165c26,
          emissiveIntensity: 0.55,
          side: THREE.DoubleSide,
        }),
        skinOrMask: this.registerArmorMat({
          color: 0x16191e,
          metalness: 0.2,
          roughness: 0.7,
        }),
        visorGlow: this.registerArmorMat(
          {
            color: 0x69db7c,
            emissive: 0x2f9e44,
            emissiveIntensity: 2.4,
            metalness: 0.1,
            roughness: 0.12,
          },
          true,
        ),
        groundAuraColorHex: HERO_CLASS_CONFIG.shadowblade.primaryColorHex,
      };
    }

    // 'arcanist': Astral circlet, midnight-sapphire & gold ornate robes, luminous cyan/blue runes
    return {
      primaryArmor: this.registerArmorMat({
        color: 0x1b2d52,
        metalness: 0.22,
        roughness: 0.58,
        bumpMap: this.clothTex,
        bumpScale: 0.022,
        emissive: 0x081530,
        emissiveIntensity: 0.25,
      }),
      secondaryArmor: this.registerArmorMat({
        color: 0x2d1b4e,
        metalness: 0.25,
        roughness: 0.52,
        bumpMap: this.clothTex,
        bumpScale: 0.018,
        emissive: 0x120829,
        emissiveIntensity: 0.22,
      }),
      trimGold: this.registerArmorMat({
        color: 0xe6be68,
        metalness: 0.92,
        roughness: 0.2,
        emissive: 0x422d08,
        emissiveIntensity: 0.22,
      }),
      darkUnderlayer: this.registerArmorMat({
        color: 0x101424,
        metalness: 0.18,
        roughness: 0.75,
      }),
      capeMain: this.registerArmorMat({
        color: 0x16284c,
        metalness: 0.16,
        roughness: 0.65,
        bumpMap: this.clothTex,
        bumpScale: 0.02,
        emissive: 0x091b3a,
        emissiveIntensity: 0.3,
        side: THREE.DoubleSide,
      }),
      capeTrim: this.registerArmorMat({
        color: 0x4dabf7,
        metalness: 0.65,
        roughness: 0.25,
        emissive: 0x1c7ed6,
        emissiveIntensity: 0.8,
        side: THREE.DoubleSide,
      }),
      skinOrMask: this.registerArmorMat({
        color: 0xd4c3b3,
        metalness: 0.08,
        roughness: 0.62,
      }),
      visorGlow: this.registerArmorMat(
        {
          color: 0x74c0fc,
          emissive: 0x339af0,
          emissiveIntensity: 2.5,
          metalness: 0.15,
          roughness: 0.1,
        },
        true,
      ),
      groundAuraColorHex: HERO_CLASS_CONFIG.arcanist.primaryColorHex,
    };
  }

  buildWeaponMaterials(rarity: ItemRarity): WeaponMaterialSet {
    this.disposeWeaponMaterials();

    const rarityHex = RARITY_COLORS[rarity]?.hex ?? RARITY_COLORS.common.hex;
    const baseRuneIntensity = RARITY_INTENSITY[rarity] ?? RARITY_INTENSITY.common;

    return {
      bladeSteel: this.registerWeaponMat({
        color: rarity === 'legendary' ? 0xeef2f8 : 0xb8c2d0,
        metalness: 0.92,
        roughness: 0.18,
        bumpMap: this.metalTex,
        bumpScale: 0.01,
      }),
      darkIron: this.registerWeaponMat({
        color: 0x2c313c,
        metalness: 0.84,
        roughness: 0.34,
        bumpMap: this.metalTex,
        bumpScale: 0.014,
      }),
      goldHilt: this.registerWeaponMat({
        color: rarity === 'legendary' ? 0xffc04d : 0xcfa046,
        metalness: 0.9,
        roughness: 0.24,
        emissive: rarity === 'legendary' ? 0x4a2500 : 0x241600,
        emissiveIntensity: rarity === 'legendary' ? 0.35 : 0.12,
      }),
      leatherGrip: this.registerWeaponMat({
        color: 0x3b261a,
        metalness: 0.12,
        roughness: 0.82,
        bumpMap: this.leatherTex,
        bumpScale: 0.018,
      }),
      woodShaft: this.registerWeaponMat({
        color: 0x342218,
        metalness: 0.15,
        roughness: 0.72,
      }),
      runeEmissive: this.registerWeaponMat(
        {
          color: rarityHex,
          emissive: rarityHex,
          emissiveIntensity: baseRuneIntensity,
          metalness: 0.25,
          roughness: 0.15,
        },
        true,
      ),
      crystalCore: this.registerWeaponMat(
        {
          color: rarityHex,
          emissive: rarityHex,
          emissiveIntensity: baseRuneIntensity * 1.25 + 0.35,
          metalness: 0.15,
          roughness: 0.08,
          transparent: true,
          opacity: 0.92,
        },
        true,
      ),
      rarityHex,
      baseRuneIntensity,
    };
  }

  applyHitFlashAndDeathDim(
    flashAlpha: number,
    flashColor: THREE.Color,
    deathDimFactor: number,
    pulseWave: number,
  ): void {
    const tmpColor = new THREE.Color();
    const applyToSet = (set: Set<THREE.MeshStandardMaterial>) => {
      for (const mat of set) {
        const base = mat.userData.baseEmissive as BaseEmissiveData | undefined;
        if (!base) continue;

        tmpColor.setHex(base.hex);
        const pulse = base.isVisorOrRune ? 1 + pulseWave * 0.16 : 1;
        let targetIntensity = base.intensity * pulse * deathDimFactor;

        if (flashAlpha > 0) {
          tmpColor.lerp(flashColor, flashAlpha);
          targetIntensity = targetIntensity + flashAlpha * 1.35;
        }

        mat.emissive.copy(tmpColor);
        mat.emissiveIntensity = targetIntensity;
      }
    };

    applyToSet(this.armorMaterials);
    applyToSet(this.weaponMaterials);
  }

  disposeArmorMaterials(): void {
    for (const mat of this.armorMaterials) {
      mat.dispose();
    }
    this.armorMaterials.clear();
  }

  disposeWeaponMaterials(): void {
    for (const mat of this.weaponMaterials) {
      mat.dispose();
    }
    this.weaponMaterials.clear();
  }

  dispose(): void {
    this.disposeArmorMaterials();
    this.disposeWeaponMaterials();
    for (const tex of this.textures) {
      tex.dispose();
    }
    this.textures.length = 0;
  }
}
