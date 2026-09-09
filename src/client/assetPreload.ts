// Preloads assets not otherwise referenced until first use (pickup
// models, checkmark/crossmark, message, smoke, ingredient atlas), so that
// first use doesn't hitch. Fixture/display models aren't listed — already eager.
//
// Sounds must not be listed — a clip preloaded here never plays on mobile;
// sound.ts preloads them itself.

import { AssetLoad, engine } from '@dcl/sdk/ecs'

import { FIRE_TEXTURE, SMOKE_TEXTURE } from '../shared/constants'
import { MODELS } from '../shared/models'
import { ATLAS_TEXTURE_SRC } from './ui/orderQueueStyle'

export function preloadAssets(): void {
  AssetLoad.create(engine.RootEntity, {
    assets: [
      MODELS.cucumberSlice,
      MODELS.onionSlice,
      MODELS.tomatoSlice,
      MODELS.saladLeaf,
      MODELS.cheeseSlice,
      MODELS.bunBottom,
      MODELS.bunTop,
      MODELS.pattyRaw,
      MODELS.pattyCooked,
      MODELS.egg,
      MODELS.eggRaw,
      MODELS.burntCookable,
      MODELS.plate,
      MODELS.checkmark,
      MODELS.crossmark,
      MODELS.message,
      SMOKE_TEXTURE,
      FIRE_TEXTURE,
      ATLAS_TEXTURE_SRC
    ]
  })
}
