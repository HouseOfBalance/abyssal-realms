import { describe, expect, it } from 'vitest';
import type { HeroClassId, SkillSlotIndex } from '../../contracts/types';
import { SkillSystem, createSkillSystem } from './index';

describe('SkillSystem — Active Skills & Cooldowns', () => {
  it('provides 18 distinct active skills (6 per hero class across slots 0..5)', () => {
    const sys = createSkillSystem();
    const allSkills = sys.getAllSkills();
    expect(allSkills).toHaveLength(18);

    const uniqueIds = new Set(allSkills.map((s) => s.id));
    expect(uniqueIds.size).toBe(18);

    const classes: HeroClassId[] = ['vanguard', 'shadowblade', 'arcanist'];
    for (const heroClass of classes) {
      const equipped = sys.getEquippedSkills(heroClass);
      expect(equipped).toHaveLength(6);
      expect(equipped.map((s) => s.slotHint)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(equipped[0].manaCost).toBe(0);
      for (const skill of equipped) {
        expect(skill.heroClass).toBe(heroClass);
        expect(skill.name.length).toBeGreaterThan(2);
        expect(skill.description.length).toBeGreaterThan(10);
        expect(skill.icon.length).toBeGreaterThan(0);
        expect(skill.baseDamageMultiplier).toBeGreaterThan(0);
      }
    }

    const skillNames = allSkills.map((s) => s.name);
    expect(skillNames).toContain('Nhảy Địa Chấn');
    expect(skillNames).toContain('Lốc Xoáy Cuồng Phong');
    expect(skillNames).toContain('Mưa Bóng Tối');
    expect(skillNames).toContain('Nổ Độc Khắp Nơi');
    expect(skillNames).toContain('Thảm Họa Thiên Thạch');
    expect(skillNames).toContain('Sét Dây Chuyền');
  });

  it('enforces mana costs, cooldownReduction scaling, and dt cooldown ticks', () => {
    const sys = createSkillSystem();
    const arcanistSkills = sys.getEquippedSkills('arcanist');
    const meteor = arcanistSkills[5];
    expect(meteor.name).toBe('Thảm Họa Thiên Thạch');

    // Basic skill (slot 0) costs 0 mana
    expect(sys.canCast(0, 0)).toBe(true);

    // Ultimate (slot 5) requires 40 mana
    expect(sys.canCast(5, 25)).toBe(false);
    expect(sys.canCast(5, meteor.manaCost)).toBe(true);

    // Cast with 20% cooldown reduction
    const castRes = sys.triggerCast(5, 0.2);
    expect(castRes).not.toBeNull();
    expect(castRes?.skill.id).toBe(meteor.id);
    expect(castRes?.manaSpent).toBe(meteor.manaCost);

    const expectedCd = meteor.cooldownSec * 0.8; // 15 * 0.8 = 12s
    const cdAfterCast = sys.getCooldownState(5);
    expect(cdAfterCast.ready).toBe(false);
    expect(cdAfterCast.total).toBeCloseTo(expectedCd, 5);
    expect(cdAfterCast.remaining).toBeCloseTo(expectedCd, 5);

    // Cannot cast again while on cooldown
    expect(sys.canCast(5, 999)).toBe(false);
    expect(sys.triggerCast(5, 0)).toBeNull();

    // Advance 5 seconds
    sys.update(5.0);
    expect(sys.getCooldownState(5).remaining).toBeCloseTo(7.0, 5);
    expect(sys.getCooldownState(5).ready).toBe(false);

    // Advance remaining 7 seconds
    sys.update(7.0);
    const cdReady = sys.getCooldownState(5);
    expect(cdReady.remaining).toBe(0);
    expect(cdReady.ready).toBe(true);
    expect(sys.canCast(5, meteor.manaCost)).toBe(true);
  });

  it('caps extreme cooldownReduction values (including stacked Awakening >1.0) at 0.80 and ignores invalid dt', () => {
    const sys = new SkillSystem('shadowblade');
    const skills = sys.getEquippedSkills('shadowblade');
    const ultimate = skills[5];

    // Exact 0.80 CDR during [R] Awakening Overdrive
    sys.triggerCast(5 as SkillSlotIndex, 0.8);
    expect(sys.getCooldownState(5).remaining).toBeCloseTo(ultimate.cooldownSec * 0.2, 5);

    // Reset and verify stacked CDR > 1.0 (e.g. 0.65 passive/gear + 0.50 Awakening = 1.15) clamps cleanly to 0.80
    sys.resetCooldowns();
    sys.triggerCast(5 as SkillSlotIndex, 1.15);
    expect(sys.getCooldownState(5).remaining).toBeCloseTo(ultimate.cooldownSec * 0.2, 5);

    sys.update(-5);
    sys.update(Number.NaN);
    expect(sys.getCooldownState(5).remaining).toBeCloseTo(ultimate.cooldownSec * 0.2, 5);
  });

  it('scales and refreshes active cooldowns via scaleActiveCooldowns and reduceActiveCooldowns', () => {
    const sys = new SkillSystem('vanguard');
    const skills = sys.getEquippedSkills('vanguard');
    const leap = skills[5]; // 14s base cooldown
    const whirlwind = skills[4]; // 7.5s base cooldown

    sys.triggerCast(5, 0);
    sys.triggerCast(4, 0);
    expect(sys.getCooldownState(5).remaining).toBeCloseTo(leap.cooldownSec, 5);
    expect(sys.getCooldownState(4).remaining).toBeCloseTo(whirlwind.cooldownSec, 5);

    // Awakening Overdrive halves active remaining cooldowns while preserving total >= remaining
    sys.scaleActiveCooldowns(0.5);
    expect(sys.getCooldownState(5).remaining).toBeCloseTo(leap.cooldownSec * 0.5, 5);
    expect(sys.getCooldownState(5).total).toBeGreaterThanOrEqual(sys.getCooldownState(5).remaining);
    expect(sys.getCooldownState(4).remaining).toBeCloseTo(whirlwind.cooldownSec * 0.5, 5);

    // Flat cooldown shave (e.g. parry counter bonus)
    sys.reduceActiveCooldowns(2.0);
    expect(sys.getCooldownState(5).remaining).toBeCloseTo(leap.cooldownSec * 0.5 - 2.0, 5);

    // Invalid scale factor is ignored safely
    sys.scaleActiveCooldowns(Number.NaN);
    expect(sys.getCooldownState(5).remaining).toBeCloseTo(leap.cooldownSec * 0.5 - 2.0, 5);

    // Zero factor refreshes all active cooldowns immediately
    sys.scaleActiveCooldowns(0);
    expect(sys.getCooldownState(5).ready).toBe(true);
    expect(sys.getCooldownState(5).remaining).toBe(0);
    expect(sys.getCooldownState(4).ready).toBe(true);
  });
});

describe('SkillSystem — 24-Node Constellation Passive Tree', () => {
  it('defines 24 well-spaced constellation nodes across 3 branches and 3 keystones', () => {
    const sys = createSkillSystem();
    const tree = sys.getPassiveTree();
    expect(tree).toHaveLength(24);

    expect(tree.filter((n) => n.branch === 'warlord')).toHaveLength(8);
    expect(tree.filter((n) => n.branch === 'assassin')).toHaveLength(8);
    expect(tree.filter((n) => n.branch === 'archmage')).toHaveLength(8);

    const keystones = tree.filter((n) => n.isKeystone);
    expect(keystones).toHaveLength(3);
    expect(keystones.map((k) => k.specialKeystoneId).sort()).toEqual([
      'blood_pact',
      'elemental_overload',
      'phantom_crit',
    ]);

    // Ensure every prerequisite references a valid node ID and no two nodes overlap
    const idSet = new Set(tree.map((n) => n.id));
    expect(idSet.size).toBe(24);
    for (let i = 0; i < tree.length; i++) {
      for (const req of tree[i].prerequisites) {
        expect(idSet.has(req)).toBe(true);
      }
      for (let j = i + 1; j < tree.length; j++) {
        const dist = Math.hypot(
          tree[i].position.x - tree[j].position.x,
          tree[i].position.y - tree[j].position.y,
        );
        expect(dist).toBeGreaterThan(35);
      }
    }
  });

  it('validates prerequisites, maxRank, respec refunds, keystones, and save loading', () => {
    const sys = createSkillSystem();

    // Cannot allocate keystone before prerequisites
    expect(sys.allocatePassive('blood_pact', 5)).toBe(false);
    // Cannot allocate with 0 points
    expect(sys.allocatePassive('warlord_might', 0)).toBe(false);

    // Path down Warlord spine to Blood Pact
    expect(sys.allocatePassive('warlord_might', 1)).toBe(true);
    expect(sys.allocatePassive('warlord_might', 1)).toBe(true);
    expect(sys.allocatePassive('warlord_might', 1)).toBe(true);
    // Exceeding maxRank (3) returns false
    expect(sys.allocatePassive('warlord_might', 1)).toBe(false);

    expect(sys.allocatePassive('warlord_brutal_cleave', 1)).toBe(true);
    expect(sys.allocatePassive('warlord_juggernaut_fury', 1)).toBe(true);
    expect(sys.allocatePassive('blood_pact', 1)).toBe(true);
    // Keystone maxRank is 1
    expect(sys.allocatePassive('blood_pact', 1)).toBe(false);

    const bonuses = sys.computePassiveBonuses();
    // warlord_might (3 * 4 = 12 STR) + warlord_brutal_cleave (1 * 3 = 3 STR) = 15 STR
    expect(bonuses.attributes.strength).toBe(15);
    expect(bonuses.attributes.vitality).toBe(8);
    expect(bonuses.stats.lifeSteal).toBeCloseTo(0.08, 5);
    expect(bonuses.keystones).toEqual(['blood_pact']);

    // Respec refunds all 6 spent ranks
    const refunded = sys.resetPassives();
    expect(refunded).toBe(6);
    expect(sys.getAllocatedPassives()).toEqual({});
    expect(sys.computePassiveBonuses().keystones).toEqual([]);

    // Load saved passives clamping invalid/over-max values
    sys.loadAllocatedPassives({
      archmage_insight: 99,
      elemental_overload: 1,
      non_existent_node: 3,
      assassin_precision: -2,
    });
    expect(sys.getAllocatedPassives()).toEqual({
      archmage_insight: 3,
      elemental_overload: 1,
    });
    expect(sys.computePassiveBonuses().keystones).toEqual(['elemental_overload']);
  });
});
