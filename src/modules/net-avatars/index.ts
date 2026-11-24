import type { HeroClassId, IHeroRig, IRemoteAvatarManager } from '../../contracts/types';
import { createHeroRig } from '../hero-model';
import { RemoteAvatarManager } from './RemoteAvatarManager';

export { RemoteAvatarManager };

export function createRemoteAvatarManager(
  rigFactory: (cls: HeroClassId) => IHeroRig = createHeroRig,
): IRemoteAvatarManager {
  return new RemoteAvatarManager(rigFactory);
}
