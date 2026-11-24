import type {
  Attributes,
  BiomeId,
  DamageType,
  HeroClassId,
  ItemRarity,
  Vec3,
} from '../contracts/types';
import { t } from './i18n/index.js';

export const HERO_CLASS_CONFIG: Record<
  HeroClassId,
  {
    title: string;
    subtitle: string;
    baseAttributes: Attributes;
    startingWeapon: 'greatsword' | 'daggers' | 'staff';
    primaryColorHex: number;
  }
> = {
  vanguard: {
    title: 'Vanguard',
    subtitle: 'Armored Juggernaut of the Shattered Crown',
    baseAttributes: { strength: 16, dexterity: 9, intelligence: 7, vitality: 15 },
    startingWeapon: 'greatsword',
    primaryColorHex: 0xc92a2a,
  },
  shadowblade: {
    title: 'Shadowblade',
    subtitle: 'Phantom Duelist of the Obsidian Veil',
    baseAttributes: { strength: 10, dexterity: 17, intelligence: 9, vitality: 11 },
    startingWeapon: 'daggers',
    primaryColorHex: 0x2f9e44,
  },
  arcanist: {
    title: 'Arcanist',
    subtitle: 'High Weaver of Astral Cataclysm',
    baseAttributes: { strength: 7, dexterity: 10, intelligence: 18, vitality: 10 },
    startingWeapon: 'staff',
    primaryColorHex: 0x339af0,
  },
};

export const RARITY_COLORS: Record<ItemRarity, { hex: number; css: string; label: string }> = {
  common: { hex: 0xd0d0d0, css: '#d0d0d0', label: t('rarity.common') },
  uncommon: { hex: 0x40c057, css: '#40c057', label: t('rarity.uncommon') },
  rare: { hex: 0x339af0, css: '#339af0', label: t('rarity.rare') },
  epic: { hex: 0xbe4bdb, css: '#be4bdb', label: t('rarity.epic') },
  legendary: { hex: 0xff922b, css: '#ff922b', label: t('rarity.legendary') },
};

export const DAMAGE_TYPE_COLORS: Record<DamageType, { hex: number; css: string }> = {
  physical: { hex: 0xf1e9d2, css: '#f1e9d2' },
  fire: { hex: 0xff6b35, css: '#ff6b35' },
  ice: { hex: 0x4dabf7, css: '#4dabf7' },
  lightning: { hex: 0xffd43b, css: '#ffd43b' },
  poison: { hex: 0x69db7c, css: '#69db7c' },
  void: { hex: 0xda77f2, css: '#da77f2' },
};

export const MYTHIC_COLOR = { hex: 0xff1e42, css: '#ff1e42', label: t('rarity.mythic') };

export const BIOME_CONFIG: Record<
  BiomeId,
  {
    name: string;
    subtitle: string;
    fogColorHex: number;
    fogDensity: number;
    ambientHex: number;
  }
> = {
  sanctuary: {
    name: 'Pháo Đài Những Người Đã Ngã',
    subtitle: 'Thánh Địa — Lò Sưởi Cuối Cùng Trên Vực Thẳm Tan Vỡ',
    fogColorHex: 0x0e1320,
    fogDensity: 0.012,
    ambientHex: 0x3b4868,
  },
  crypt: {
    name: 'Hầm Mộ Nguyền Rủa',
    subtitle: 'Tầng I — Nơi Linh Hồn Bị Giam Cầm',
    fogColorHex: 0x0b0d14,
    fogDensity: 0.022,
    ambientHex: 0x2a324b,
  },
  caverns: {
    name: 'Hang Động Nọc Độc',
    subtitle: 'Tầng II — Tiếng Vọng Dưới Những Rễ Cây Độc',
    fogColorHex: 0x08140e,
    fogDensity: 0.024,
    ambientHex: 0x1e3f2b,
  },
  forge: {
    name: 'Lò Rèn Vực Thẳm',
    subtitle: 'Tầng III — Lửa Địa Ngục Vĩnh Cửu',
    fogColorHex: 0x180907,
    fogDensity: 0.02,
    ambientHex: 0x4a2016,
  },
  void: {
    name: 'Trung Tâm Hư Không',
    subtitle: 'Tầng IV — Nơi Thực Tại Tan Vỡ',
    fogColorHex: 0x0e071a,
    fogDensity: 0.021,
    ambientHex: 0x351c57,
  },
  cathedral: {
    name: 'Tháp Băng Giá',
    subtitle: 'Tầng V — Nơi Thời Gian Đứng Yên',
    fogColorHex: 0x081522,
    fogDensity: 0.02,
    ambientHex: 0x244866,
  },
  observatory: {
    name: 'Thư Viện Huyền Bí',
    subtitle: 'Tầng VI — Tri Thức Cấm Đoán',
    fogColorHex: 0x0c0b1e,
    fogDensity: 0.017,
    ambientHex: 0x3a3264,
  },
  colosseum: {
    name: 'Vườn Tà Độc',
    subtitle: 'Đấu Trường Bất Tử — Thiên Nhiên Bị Hủy Hoại',
    fogColorHex: 0x1c060a,
    fogDensity: 0.019,
    ambientHex: 0x521620,
  },
};

export class SeededRng {
  private state: number;

  constructor(seed = 1337) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

export function distXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
