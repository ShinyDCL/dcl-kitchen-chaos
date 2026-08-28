// Ingredient pickup counters — each has a display model showing what's
// available and, once interacted with, attaches the matching slice to the
// player's hand, discarding whatever was held before (attachItemToPlayerHand
// always clears the previous held item). A definition with no
// displayModel/sliceModel would show a "not available" message instead —
// currently unused, since every listed ingredient has real models.

import { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FIXTURE_HEIGHT } from '../../shared/constants'
import { MODELS } from '../../shared/models'
import { evaluateIngredientCounterInteraction } from '../interactionRules'
import { createFixture } from './fixtures'

export interface IngredientDefinition {
  displayModel?: string
  sliceModel?: string
}

export const RIGHT_SIDE_INGREDIENTS: IngredientDefinition[] = [
  { displayModel: MODELS.bunBottomDisplay, sliceModel: MODELS.bunBottom },
  { displayModel: MODELS.bunTopDisplay, sliceModel: MODELS.bunTop },
  { displayModel: MODELS.eggDisplay, sliceModel: MODELS.egg },
  { displayModel: MODELS.pattyDisplay, sliceModel: MODELS.pattyRaw }
]

export const LEFT_SIDE_INGREDIENTS: IngredientDefinition[] = [
  { displayModel: MODELS.cheeseDisplay, sliceModel: MODELS.cheeseSlice },
  { displayModel: MODELS.onionDisplay, sliceModel: MODELS.onionSlice },
  { displayModel: MODELS.cucumberDisplay, sliceModel: MODELS.cucumberSlice },
  { displayModel: MODELS.saladDisplay, sliceModel: MODELS.saladLeaf },
  { displayModel: MODELS.tomatoDisplay, sliceModel: MODELS.tomatoSlice }
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
