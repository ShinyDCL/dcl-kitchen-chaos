// Ingredient pickup counters — each has a display model showing what's
// available and, once interacted with, attaches the matching slice to the
// player's hand. A definition with no displayModel/sliceModel (currently
// just bacon) still places the counter fixture and highlights it on
// proximity, but stays empty and non-interactive until its models exist.

import { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { COUNTER_HEIGHT } from './constants'
import { createFixture } from './fixtures'
import { attachItemToPlayerHand } from './heldItem'
import { MODELS } from './models'

export interface IngredientDefinition {
  displayModel?: string
  sliceModel?: string
}

export const RIGHT_SIDE_INGREDIENTS: IngredientDefinition[] = [
  { displayModel: MODELS.tomatoDisplay, sliceModel: MODELS.tomatoSlice },
  { displayModel: MODELS.onionDisplay, sliceModel: MODELS.onionSlice },
  { displayModel: MODELS.cucumberDisplay, sliceModel: MODELS.cucumberSlice },
  { displayModel: MODELS.saladDisplay, sliceModel: MODELS.saladLeaf },
  { displayModel: MODELS.cheeseDisplay, sliceModel: MODELS.cheeseSlice }
]

export const LEFT_SIDE_INGREDIENTS: IngredientDefinition[] = [
  { displayModel: MODELS.pattyDisplay, sliceModel: MODELS.pattyRaw },
  { displayModel: MODELS.bunBottomDisplay, sliceModel: MODELS.bunBottom },
  { displayModel: MODELS.bunTopDisplay, sliceModel: MODELS.bunTop },
  { displayModel: MODELS.eggDisplay, sliceModel: MODELS.egg },
  {} // TODO: bacon — no models yet. Counter is placed and highlights, but stays empty.
]

export function createIngredientCounter(
  position: Vector3,
  rotation: Quaternion,
  parent: Entity,
  definition: IngredientDefinition
): void {
  const sliceModel = definition.sliceModel

  createFixture({
    model: MODELS.counter,
    position,
    rotation,
    parent,
    height: COUNTER_HEIGHT,
    displayModel: definition.displayModel,
    onInteract: sliceModel ? () => attachItemToPlayerHand(sliceModel) : undefined
  })
}
