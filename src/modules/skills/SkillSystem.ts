import type {
  Attributes,
  DerivedStats,
  HeroClassId,
  ISkillSystem,
  PassiveNode,
  SkillDefinition,
  SkillSlotIndex,
} from '../../contracts/types';
import { clamp } from '../../core/Constants';
import { ALL_ACTIVE_SKILLS, SKILLS_BY_CLASS, cloneSkillDefinition } from './activeSkills';
import { PASSIVE_CONSTELLATION_NODES, clonePassiveNode } from './passiveTree';

const VALID_SLOT_INDICES: readonly SkillSlotIndex[] = [0, 1, 2, 3, 4, 5];
const VALID_HERO_CLASSES: ReadonlySet<HeroClassId> = new Set([
  'vanguard',
  'shadowblade',
  'arcanist',
]);

const ATTRIBUTE_KEYS: ReadonlySet<keyof Attributes> = new Set<keyof Attributes>([
  'strength',
  'dexterity',
  'intelligence',
  'vitality',
]);

const COOLDOWN_READY_EPSILON = 1e-6;
const MAX_COOLDOWN_REDUCTION = 0.8;

interface SlotCooldownRecord {
  remaining: number;
  total: number;
}

function roundStatValue(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isValidSlotIndex(slot: number): slot is SkillSlotIndex {
  return Number.isInteger(slot) && slot >= 0 && slot <= 5;
}

function isAttributeKey(key: string): key is keyof Attributes {
  return ATTRIBUTE_KEYS.has(key as keyof Attributes);
}

export class SkillSystem implements ISkillSystem {
  private activeHeroClass: HeroClassId;
  private cooldowns: Record<SkillSlotIndex, SlotCooldownRecord>;
  private readonly passiveNodeMap: Map<string, PassiveNode>;
  private allocatedPassives: Record<string, number> = {};

  constructor(initialHeroClass: HeroClassId = 'vanguard') {
    this.activeHeroClass = VALID_HERO_CLASSES.has(initialHeroClass)
      ? initialHeroClass
      : 'vanguard';
    this.cooldowns = this.createInitialCooldownRecords();
    this.passiveNodeMap = new Map(
      PASSIVE_CONSTELLATION_NODES.map((node) => [node.id, node]),
    );
  }

  private createInitialCooldownRecords(): Record<SkillSlotIndex, SlotCooldownRecord> {
    return {
      0: { remaining: 0, total: 0 },
      1: { remaining: 0, total: 0 },
      2: { remaining: 0, total: 0 },
      3: { remaining: 0, total: 0 },
      4: { remaining: 0, total: 0 },
      5: { remaining: 0, total: 0 },
    };
  }

  public setHeroClass(heroClass: HeroClassId): void {
    if (!VALID_HERO_CLASSES.has(heroClass)) return;
    if (this.activeHeroClass !== heroClass) {
      this.activeHeroClass = heroClass;
      this.resetCooldowns();
    }
  }

  public resetCooldowns(): void {
    for (const slot of VALID_SLOT_INDICES) {
      this.cooldowns[slot].remaining = 0;
      this.cooldowns[slot].total = 0;
    }
  }

  /**
   * Scales all currently active slot cooldowns by `factor` (e.g. `0.5` halves remaining
   * cooldowns when activating `[R]` Awakening Overdrive; `0` refreshes all slots immediately).
   */
  public scaleActiveCooldowns(factor: number): void {
    if (!Number.isFinite(factor)) return;
    const clampedFactor = clamp(factor, 0, 10);

    for (const slot of VALID_SLOT_INDICES) {
      const cd = this.cooldowns[slot];
      if (cd.remaining <= 0) continue;

      const nextRemaining = roundStatValue(cd.remaining * clampedFactor);
      if (nextRemaining <= COOLDOWN_READY_EPSILON) {
        cd.remaining = 0;
        cd.total = 0;
      } else {
        cd.remaining = nextRemaining;
        if (nextRemaining > cd.total) {
          cd.total = nextRemaining;
        }
      }
    }
  }

  /**
   * Reduces all currently active slot cooldowns by a flat number of seconds.
   */
  public reduceActiveCooldowns(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.update(seconds);
  }

  private getSlotSkillDefinition(slot: SkillSlotIndex): SkillDefinition | null {
    if (!isValidSlotIndex(slot)) return null;
    const classSkills = SKILLS_BY_CLASS[this.activeHeroClass];
    const found = classSkills.find((s) => s.slotHint === slot);
    return found ?? classSkills[slot] ?? null;
  }

  public getEquippedSkills(heroClass: HeroClassId): SkillDefinition[] {
    if (VALID_HERO_CLASSES.has(heroClass) && this.activeHeroClass !== heroClass) {
      this.activeHeroClass = heroClass;
      this.resetCooldowns();
    }
    const targetClass = VALID_HERO_CLASSES.has(heroClass) ? heroClass : this.activeHeroClass;
    return [...SKILLS_BY_CLASS[targetClass]]
      .sort((a, b) => a.slotHint - b.slotHint)
      .map(cloneSkillDefinition);
  }

  public getAllSkills(): SkillDefinition[] {
    return ALL_ACTIVE_SKILLS.map(cloneSkillDefinition);
  }

  public canCast(slot: SkillSlotIndex, currentMana: number): boolean {
    if (!Number.isFinite(currentMana)) return false;
    const skill = this.getSlotSkillDefinition(slot);
    if (!skill) return false;

    const cd = this.cooldowns[slot];
    if (cd.remaining > COOLDOWN_READY_EPSILON) {
      return false;
    }

    return currentMana >= skill.manaCost;
  }

  public triggerCast(
    slot: SkillSlotIndex,
    cooldownReduction: number,
  ): { skill: SkillDefinition; manaSpent: number } | null {
    const skill = this.getSlotSkillDefinition(slot);
    if (!skill) return null;

    const cd = this.cooldowns[slot];
    if (cd.remaining > COOLDOWN_READY_EPSILON) {
      return null;
    }

    const rawCdr = Number.isFinite(cooldownReduction) ? cooldownReduction : 0;
    const clampedCdr = clamp(rawCdr, 0, MAX_COOLDOWN_REDUCTION);
    const effectiveCooldown = roundStatValue(Math.max(0, skill.cooldownSec * (1 - clampedCdr)));

    cd.remaining = effectiveCooldown <= COOLDOWN_READY_EPSILON ? 0 : effectiveCooldown;
    cd.total = effectiveCooldown <= COOLDOWN_READY_EPSILON ? 0 : effectiveCooldown;

    return {
      skill: cloneSkillDefinition(skill),
      manaSpent: skill.manaCost,
    };
  }

  public getCooldownState(slot: SkillSlotIndex): {
    remaining: number;
    total: number;
    ready: boolean;
  } {
    const skill = this.getSlotSkillDefinition(slot);
    if (!skill) {
      return { remaining: 0, total: 0, ready: false };
    }

    const cd = this.cooldowns[slot];
    const ready = cd.remaining <= COOLDOWN_READY_EPSILON;
    const remaining = ready ? 0 : cd.remaining;
    const total = cd.total > 0 ? cd.total : skill.cooldownSec;

    return { remaining, total, ready };
  }

  public getPassiveTree(): PassiveNode[] {
    return PASSIVE_CONSTELLATION_NODES.map(clonePassiveNode);
  }

  public getAllocatedPassives(): Record<string, number> {
    return { ...this.allocatedPassives };
  }

  public allocatePassive(nodeId: string, availablePoints: number): boolean {
    if (typeof nodeId !== 'string' || !Number.isFinite(availablePoints) || availablePoints < 1) {
      return false;
    }

    const node = this.passiveNodeMap.get(nodeId);
    if (!node) return false;

    const currentRank = this.allocatedPassives[nodeId] ?? 0;
    if (currentRank >= node.maxRank) {
      return false;
    }

    const prerequisitesMet = node.prerequisites.every(
      (prereqId) => (this.allocatedPassives[prereqId] ?? 0) >= 1,
    );
    if (!prerequisitesMet) {
      return false;
    }

    this.allocatedPassives[nodeId] = currentRank + 1;
    return true;
  }

  public resetPassives(): number {
    let refundedPoints = 0;
    for (const rank of Object.values(this.allocatedPassives)) {
      if (Number.isFinite(rank) && rank > 0) {
        refundedPoints += rank;
      }
    }
    this.allocatedPassives = {};
    return refundedPoints;
  }

  public computePassiveBonuses(): {
    attributes: Partial<Attributes>;
    stats: Partial<DerivedStats>;
    keystones: string[];
  } {
    const attributes: Partial<Attributes> = {};
    const stats: Partial<DerivedStats> = {};
    const keystones: string[] = [];

    for (const node of PASSIVE_CONSTELLATION_NODES) {
      const rank = this.allocatedPassives[node.id] ?? 0;
      if (rank <= 0) continue;

      for (const [statKey, perRankValue] of Object.entries(node.statModifiers)) {
        if (typeof perRankValue !== 'number' || !Number.isFinite(perRankValue)) continue;
        const scaledContribution = perRankValue * rank;

        if (isAttributeKey(statKey)) {
          const prev = attributes[statKey] ?? 0;
          attributes[statKey] = roundStatValue(prev + scaledContribution);
        } else {
          const derivedKey = statKey as keyof DerivedStats;
          const prev = stats[derivedKey] ?? 0;
          stats[derivedKey] = roundStatValue(prev + scaledContribution);
        }
      }

      if (node.isKeystone) {
        keystones.push(node.specialKeystoneId ?? node.id);
      }
    }

    return { attributes, stats, keystones };
  }

  public loadAllocatedPassives(saved: Record<string, number>): void {
    this.allocatedPassives = {};
    if (!saved || typeof saved !== 'object') return;

    for (const [nodeId, rawRank] of Object.entries(saved)) {
      const node = this.passiveNodeMap.get(nodeId);
      if (!node || typeof rawRank !== 'number' || !Number.isFinite(rawRank)) continue;

      const clampedRank = clamp(Math.floor(rawRank), 0, node.maxRank);
      if (clampedRank > 0) {
        this.allocatedPassives[nodeId] = clampedRank;
      }
    }
  }

  public update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    for (const slot of VALID_SLOT_INDICES) {
      const cd = this.cooldowns[slot];
      if (cd.remaining > 0) {
        const next = cd.remaining - dt;
        cd.remaining = next <= COOLDOWN_READY_EPSILON ? 0 : next;
      }
    }
  }

  public dispose(): void {
    this.resetCooldowns();
    this.allocatedPassives = {};
  }
}

export function createSkillSystem(): ISkillSystem {
  return new SkillSystem();
}
