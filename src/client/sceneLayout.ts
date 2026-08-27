// Assembles the full kitchen layout: ingredient counters along the left and
// right walls (the right wall's first slot is a plate counter, ahead of
// its ingredients), a front row alternating preparation counters and
// stoves, a 2x2 preparation-counter island in the middle, and a back/
// entrance wall with a trash bin, a walkway gap, and the delivery counter.
// All positions/rotations are local to `parent` (the scene root), matching
// the existing world-placement pattern.

import { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import {
  BACK_WALL_DISTANCE,
  FACE_NEGATIVE_X,
  FACE_NEGATIVE_Z,
  FACE_POSITIVE_X,
  FACE_POSITIVE_Z,
  FIXTURE_DEPTH,
  FIXTURE_HEIGHT,
  FIXTURE_WIDTH,
  FRONT_ROW_DISTANCE,
  SIDE_WALL_DISTANCE
} from '../shared/constants'
import { MODELS } from '../shared/models'
import { registerDeliveryCounter } from './deliveryCounter'
import { createFixture } from './fixtures'
import {
  createIngredientCounter,
  IngredientDefinition,
  LEFT_SIDE_INGREDIENTS,
  RIGHT_SIDE_INGREDIENTS
} from './ingredientCounters'
import {
  evaluateDeliveryCounterInteraction,
  evaluatePlateCounterInteraction,
  evaluatePreparationCounterInteraction,
  evaluateStoveInteraction,
  evaluateTrashBinInteraction
} from './interactionRules'
import { registerPreparationCounter } from './preparationCounters'
import { registerStove } from './stoveCooking'

function rotationDegrees(degrees: number): Quaternion {
  return Quaternion.fromEulerDegrees(0, degrees, 0)
}

export function createSceneLayout(parent: Entity): void {
  createSideWall(parent, SIDE_WALL_DISTANCE, RIGHT_SIDE_INGREDIENTS, FACE_NEGATIVE_X, true)
  createSideWall(parent, -SIDE_WALL_DISTANCE, LEFT_SIDE_INGREDIENTS, FACE_POSITIVE_X)
  createFrontRow(parent)
  createBackWall(parent)
  createIsland(parent)
}

/**
 * Places a row of ingredient counters along one wall (fixed X), spaced
 * edge-to-edge along Z and centered on Z=0, all facing toward the room's
 * center. When includePlateCounter is set, a plate counter takes the first
 * slot ahead of the ingredients.
 */
function createSideWall(
  parent: Entity,
  x: number,
  ingredients: IngredientDefinition[],
  facingDegrees: number,
  includePlateCounter = false
): void {
  const slotCount = ingredients.length + (includePlateCounter ? 1 : 0)
  const totalDepth = (slotCount - 1) * FIXTURE_WIDTH
  const startZ = -totalDepth / 2
  const rotation = rotationDegrees(facingDegrees)

  let nextSlot = 0
  if (includePlateCounter) {
    createFixture({
      model: MODELS.counter,
      position: Vector3.create(x, 0, startZ),
      rotation,
      parent,
      height: FIXTURE_HEIGHT,
      displayModel: MODELS.plateDisplay,
      evaluateInteraction: () => evaluatePlateCounterInteraction()
    })
    nextSlot = 1
  }

  ingredients.forEach((definition, index) => {
    const position = Vector3.create(x, 0, startZ + (nextSlot + index) * FIXTURE_WIDTH)
    createIngredientCounter(position, rotation, parent, definition)
  })
}

/**
 * Places the front row: counter, stove, counter, stove, counter, stove,
 * counter — 7 fixtures side-by-side, all facing toward the room's center.
 * The counters are preparation counters.
 */
function createFrontRow(parent: Entity): void {
  const sequence: Array<'counter' | 'stove'> = ['counter', 'stove', 'counter', 'stove', 'counter', 'stove', 'counter']
  const totalWidth = sequence.length * FIXTURE_WIDTH
  const rotation = rotationDegrees(FACE_NEGATIVE_Z)

  sequence.forEach((kind, index) => {
    const position = Vector3.create(-totalWidth / 2 + index * FIXTURE_WIDTH + FIXTURE_WIDTH / 2, 0, FRONT_ROW_DISTANCE)

    const fixture = createFixture({
      model: kind === 'stove' ? MODELS.stove : MODELS.counter,
      position,
      rotation,
      parent,
      height: FIXTURE_HEIGHT,
      evaluateInteraction: kind === 'counter' ? evaluatePreparationCounterInteraction : evaluateStoveInteraction
    })

    if (kind === 'counter') registerPreparationCounter(fixture)
    else registerStove(fixture)
  })
}

/**
 * Places a 2x2 counter island in the middle: two counters facing -Z, two
 * facing +Z, backs touching at Z=0 so the whole block reads as one island
 * with fronts facing outward on both sides. All four are preparation
 * counters.
 */
function createIsland(parent: Entity): void {
  const halfWidth = FIXTURE_WIDTH / 2
  const halfDepth = FIXTURE_DEPTH / 2

  const rows: Array<{ z: number; facingDegrees: number }> = [
    { z: -halfDepth, facingDegrees: FACE_NEGATIVE_Z },
    { z: halfDepth, facingDegrees: FACE_POSITIVE_Z }
  ]

  for (const row of rows) {
    const rotation = rotationDegrees(row.facingDegrees)
    for (const x of [-halfWidth, halfWidth]) {
      const fixture = createFixture({
        model: MODELS.counter,
        position: Vector3.create(x, 0, row.z),
        rotation,
        parent,
        height: FIXTURE_HEIGHT,
        evaluateInteraction: evaluatePreparationCounterInteraction
      })
      registerPreparationCounter(fixture)
    }
  }
}

/**
 * Places the back wall (the entrance wall): a trash bin, a 4-counter-wide
 * gap left open as a walkway, then the delivery counter. The trash bin
 * uses the same width/depth/height allotment as a counter even though its
 * model is visually smaller, so it still lines up with the delivery
 * counter's slot.
 */
function createBackWall(parent: Entity): void {
  const sequence: Array<'trash' | 'gap' | 'delivery'> = ['trash', 'gap', 'gap', 'gap', 'gap', 'delivery']
  const totalWidth = sequence.length * FIXTURE_WIDTH
  const startX = -totalWidth / 2
  const rotation = rotationDegrees(FACE_POSITIVE_Z)

  sequence.forEach((kind, index) => {
    if (kind === 'gap') return
    const position = Vector3.create(startX + index * FIXTURE_WIDTH + FIXTURE_WIDTH / 2, 0, -BACK_WALL_DISTANCE)

    if (kind === 'trash') {
      createFixture({
        model: MODELS.trashBin,
        position,
        rotation,
        parent,
        height: FIXTURE_HEIGHT,
        evaluateInteraction: () => evaluateTrashBinInteraction()
      })
    } else {
      const deliveryCounter = createFixture({
        model: MODELS.counter,
        position,
        rotation,
        parent,
        height: FIXTURE_HEIGHT,
        displayModel: MODELS.deliveryPad,
        evaluateInteraction: () => evaluateDeliveryCounterInteraction()
      })
      registerDeliveryCounter(deliveryCounter)
    }
  })
}
