import type { ILightingDirector } from '../../contracts/types';
import type { EventAtmosphereMode } from './biomeProfiles';
import { LightingDirector } from './LightingDirector';

export { LightingDirector };
export type { EventAtmosphereMode };

export function createLightingDirector(): ILightingDirector {
  return new LightingDirector();
}
