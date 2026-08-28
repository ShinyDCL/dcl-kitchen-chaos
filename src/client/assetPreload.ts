// Preloads assets not otherwise referenced until first use (pickup
// models, checkmark/crossmark, smoke, ingredient atlas), so that first use
// doesn't hitch. Fixture/display models aren't listed — already eager.

import { AssetLoad, engine } from '@dcl/sdk/ecs'

import { SMOKE_TEXTURE } from '../shared/constants'
import { MODELS } from '../shared/models'
import { ATLAS_TEXTURE_SRC } from './ordersUi'

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
      MODELS.eggCooked,
      MODELS.plate,
      MODELS.checkmark,
      MODELS.crossmark,
      SMOKE_TEXTURE,
      ATLAS_TEXTURE_SRC
    ]
  })
}
