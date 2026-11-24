// vi.test.ts — Tests for Vietnamese i18n helpers

import { describe, it, expect } from 'vitest';
import VI, { t, tBiome, tBiomeSub, tBoss, tClass, tRarity, tSkill, tDamage, tStatus } from './vi';

describe('t() — translation function', () => {
  it('returns a string for a known key', () => {
    const result = t('game.title');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns the Vietnamese translation for game.title', () => {
    expect(t('game.title')).toBe('Vực Thẳm Huyền Bí');
  });

  it('returns the key itself for an unknown key', () => {
    const unknownKey = 'this.key.does.not.exist';
    expect(t(unknownKey)).toBe(unknownKey);
  });

  it('returns the key for an empty-string key lookup', () => {
    // Empty string key is not in the dict; should return ''
    expect(t('')).toBe('');
  });

  it('replaces {var} placeholders when vars are provided', () => {
    // Build a key that contains a placeholder
    // We test with a known key that uses vars, or verify the mechanism directly
    // by testing with a custom string — but t() can only operate on the dict.
    // Use t() with a key that doesn't exist so the key itself is used as template.
    const result = t('Player {name} has {count} kills', { name: 'Alice', count: '5' });
    expect(result).toBe('Player Alice has 5 kills');
  });

  it('replaces multiple distinct {var} placeholders', () => {
    const result = t('Hello {player} — floor {floor}', { player: 'Bob', floor: '7' });
    expect(result).toBe('Hello Bob — floor 7');
  });

  it('leaves unreplaced placeholders unchanged when no vars given', () => {
    // No vars passed — the placeholder stays as-is
    const result = t('{key}');
    expect(result).toBe('{key}');
  });

  it('known HUD keys return strings', () => {
    const keys = ['hud.hp', 'hud.mana', 'hud.stamina', 'hud.level', 'hud.gold'];
    for (const key of keys) {
      const val = t(key);
      expect(typeof val).toBe('string');
      expect(val).not.toBe('');
      expect(val).not.toBe(key); // should be translated
    }
  });
});

describe('tBiome()', () => {
  it('returns a translated string for a known biome id', () => {
    const result = tBiome('cursedCatacombs');
    expect(typeof result).toBe('string');
    expect(result).toBe('Hầm Mộ Nguyền Rủa');
  });

  it('returns biome.unknownId for an unknown biome id', () => {
    const result = tBiome('nonExistentBiome');
    expect(result).toBe('biome.nonExistentBiome');
  });
});

describe('tBiomeSub()', () => {
  it('returns subtitle for a known biome id', () => {
    const result = tBiomeSub('abyssalForge');
    expect(typeof result).toBe('string');
    expect(result).toBe('Lửa Địa Ngục Vĩnh Cửu');
  });
});

describe('tBoss()', () => {
  it('returns translated boss name for lichKing', () => {
    const result = tBoss('lichKing');
    expect(typeof result).toBe('string');
    expect(result).toBe('Vua Xác Chết Bất Tử');
  });

  it('returns translated boss name for demonLord', () => {
    expect(tBoss('demonLord')).toBe('Chúa Quỷ Địa Ngục');
  });

  it('returns boss.unknownBoss for an unknown boss id', () => {
    expect(tBoss('unknownBoss')).toBe('boss.unknownBoss');
  });
});

describe('tRarity()', () => {
  it('returns a string for known rarity ids', () => {
    // Rarity keys exist in VI dict as 'rarity.*'
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    for (const r of rarities) {
      const result = tRarity(r);
      expect(typeof result).toBe('string');
      // Should be translated, not the key itself
      expect(result).not.toBe(`rarity.${r}`);
    }
  });

  it('returns rarity.nonexistent for unknown rarity', () => {
    expect(tRarity('nonexistent')).toBe('rarity.nonexistent');
  });
});

describe('tClass()', () => {
  it('returns translated class name for berserker', () => {
    expect(tClass('berserker')).toBe('Chiến Binh Cuồng Bạo');
  });
});

describe('tSkill()', () => {
  it('returns translated skill name for fireball', () => {
    expect(tSkill('fireball')).toBe('Cầu Lửa');
  });
});

describe('tDamage()', () => {
  it('returns a string for known damage types', () => {
    // damage.physical, damage.fire, etc. should exist
    const result = tDamage('physical');
    expect(typeof result).toBe('string');
  });

  it('falls back to key for unknown damage type', () => {
    expect(tDamage('nonexistentDamageType')).toBe('damage.nonexistentDamageType');
  });
});

describe('tStatus()', () => {
  it('returns a string for known status effects', () => {
    const result = tStatus('burning');
    expect(typeof result).toBe('string');
  });

  it('falls back to key for unknown status', () => {
    expect(tStatus('unknownEffect')).toBe('status.unknownEffect');
  });
});

describe('VI dictionary', () => {
  it('is a non-empty Record<string, string>', () => {
    expect(typeof VI).toBe('object');
    expect(Object.keys(VI).length).toBeGreaterThan(50);
  });

  it('all values are non-empty strings', () => {
    for (const [key, value] of Object.entries(VI)) {
      expect(typeof value).toBe('string');
      expect(value.length, `Key "${key}" has empty value`).toBeGreaterThan(0);
    }
  });
});
