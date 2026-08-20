// Lays out three counters in a row, each with its own Display model and a
// countdown trigger that attaches the matching slice to the player's hand.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { createColorChangingCircleTrigger } from './circleTrigger'
import { COUNTER_DEPTH, COUNTER_HEIGHT, COUNTER_WIDTH } from './constants'
import { attachItemToPlayerHand } from './heldItem'
import { MODELS } from './models'

interface CounterDefinition {
  displayModel: string
  sliceModel: string
}

const COUNTER_DEFINITIONS: CounterDefinition[] = [
  { displayModel: MODELS.tomatoDisplay, sliceModel: MODELS.tomatoSlice },
  { displayModel: MODELS.onionDisplay, sliceModel: MODELS.onionSlice },
  { displayModel: MODELS.cucumberDisplay, sliceModel: MODELS.cucumberSlice },
  { displayModel: MODELS.saladDisplay, sliceModel: MODELS.saladLeaf },
  { displayModel: MODELS.cheeseDisplay, sliceModel: MODELS.cheeseSlice },
  { displayModel: MODELS.pattyDisplay, sliceModel: MODELS.pattyRaw },
  { displayModel: MODELS.bunBottomDisplay, sliceModel: MODELS.bunBottom },
  { displayModel: MODELS.bunTopDisplay, sliceModel: MODELS.bunTop },
  { displayModel: MODELS.eggDisplay, sliceModel: MODELS.egg }
]

export function createCounters(parent: Entity): void {
  const totalWidth = (COUNTER_DEFINITIONS.length - 1) * COUNTER_WIDTH
  const startX = -totalWidth / 2

  COUNTER_DEFINITIONS.forEach((definition, index) => {
    const position = Vector3.create(startX + index * COUNTER_WIDTH, 0, 0)
    createCounter(position, parent, definition)
  })
}

function createCounter(position: Vector3, parent: Entity, definition: CounterDefinition): void {
  const counter = engine.addEntity()
  Transform.create(counter, { position, parent })
  GltfContainer.create(counter, { src: MODELS.counter })

  const display = engine.addEntity()
  Transform.create(display, {
    position: Vector3.create(0, COUNTER_HEIGHT, 0),
    parent: counter
  })
  GltfContainer.create(display, { src: definition.displayModel })

  const triggerPosition = Vector3.create(0, 0, COUNTER_DEPTH / 2 + COUNTER_WIDTH / 2)

  createColorChangingCircleTrigger(triggerPosition, counter, () => {
    attachItemToPlayerHand(definition.sliceModel)
  })
}
