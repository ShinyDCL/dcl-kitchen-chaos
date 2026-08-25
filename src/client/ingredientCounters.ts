// Ingredient pickup counters — each has a display model showing what's
// available and, once interacted with, attaches the matching slice to the
// player's hand, discarding whatever was held before (attachItemToPlayerHand
// always clears the previous held item). A definition with no
// displayModel/sliceModel (currently just bacon) shows a "not available"
// message instead.

import { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FIXTURE_HEIGHT } from '../shared/constants'
import { MODELS } from '../shared/models'
import { createFixture } from './fixtures'
import { evaluateIngredientCounterInteraction } from './interactionRules'

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
  { displayModel: MODELS.eggDisplay, sliceModel: MODELS.egg }
]

export function createIngredientCounter(
  position: Vector3,
  rotation: Quaternion,
  parent: Entity,
  definition: IngredientDefinition
): void {
  createFixture({
    model: MODELS.counter,
    position,
    rotation,
    parent,
    height: FIXTURE_HEIGHT,
    displayModel: definition.displayModel,
    evaluateInteraction: () => evaluateIngredientCounterInteraction(definition.sliceModel)
  })
}
