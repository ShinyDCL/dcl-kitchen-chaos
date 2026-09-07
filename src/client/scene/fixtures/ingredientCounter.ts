// Ingredient pickup counters — each has a display model showing what's
// available and, once interacted with, attaches the matching slice to the
// player's hand, discarding whatever was held before (attachItemToPlayerHand
// always clears the previous held item).

import { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FIXTURE_HEIGHT } from '../../../shared/constants'
import { MODELS, ModelPath } from '../../../shared/models'
import { evaluateIngredientCounterInteraction } from '../../interaction/interactionRules'
import { createFixture } from './fixture'

export interface IngredientDefinition {
  displayModel: ModelPath
  itemModel: ModelPath
}

export const RIGHT_SIDE_INGREDIENTS: IngredientDefinition[] = [
  { displayModel: MODELS.plateDisplay, itemModel: MODELS.plate },
  { displayModel: MODELS.bunBottomDisplay, itemModel: MODELS.bunBottom },
  { displayModel: MODELS.bunTopDisplay, itemModel: MODELS.bunTop },
  { displayModel: MODELS.eggDisplay, itemModel: MODELS.egg },
  { displayModel: MODELS.pattyDisplay, itemModel: MODELS.pattyRaw }
]

export const LEFT_SIDE_INGREDIENTS: IngredientDefinition[] = [
  { displayModel: MODELS.cheeseDisplay, itemModel: MODELS.cheeseSlice },
  { displayModel: MODELS.onionDisplay, itemModel: MODELS.onionSlice },
  { displayModel: MODELS.cucumberDisplay, itemModel: MODELS.cucumberSlice },
  { displayModel: MODELS.saladDisplay, itemModel: MODELS.saladLeaf },
  { displayModel: MODELS.tomatoDisplay, itemModel: MODELS.tomatoSlice }
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
    evaluateInteraction: () => evaluateIngredientCounterInteraction(definition.itemModel)
  })
}
