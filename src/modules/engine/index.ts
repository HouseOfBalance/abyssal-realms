import type { IEngineCore } from '../../contracts/types';
import { EngineCore } from './EngineCore';

export { EngineCore };
export { DLSS_PRESETS, DlssController } from './DlssController';

export function createEngineCore(): IEngineCore {
  return new EngineCore();
}
