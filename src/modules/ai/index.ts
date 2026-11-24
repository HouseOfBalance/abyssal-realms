import type { IEnemyAISystem } from '../../contracts/types';
import {
  ARCHETYPE_CONFIGS,
  BIOME_MONSTER_POOLS,
  biomeForFloorNumber,
  computeScaledEnemyStats,
  pickBiomeArchetype,
} from './archetypes';
import { EnemyAISystem } from './EnemyAISystem';

export {
  ARCHETYPE_CONFIGS,
  BIOME_MONSTER_POOLS,
  biomeForFloorNumber,
  computeScaledEnemyStats,
  EnemyAISystem,
  pickBiomeArchetype,
};

export function createEnemyAISystem(): IEnemyAISystem {
  return new EnemyAISystem();
}
