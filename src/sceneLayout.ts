// Assembles the full kitchen layout: ingredient counters along the left and
// right walls (left wall's last slot is a delivery counter instead of a
// 5th ingredient, since bacon isn't implemented), a front row alternating
// preparation counters and stoves, a plate/trash wall at the back, and a
// 2x2 preparation-counter island in the middle. All positions/rotations
// are local to `parent` (the scene root), matching the existing
// world-placement pattern.

import { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import {
  BACK_WALL_DISTANCE,
  COUNTER_DEPTH,
  COUNTER_HEIGHT,
  COUNTER_WIDTH,
  FACE_NEGATIVE_X,
  FACE_NEGATIVE_Z,
  FACE_POSITIVE_X,
  FACE_POSITIVE_Z,
  FRONT_ROW_DISTANCE,
  SIDE_WALL_DISTANCE,
  STOVE_HEIGHT,
  STOVE_WIDTH,
  TRASH_BIN_HEIGHT
} from './constants'
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
import { MODELS } from './models'

function rotationDegrees(degrees: number): Quaternion {
  return Quaternion.fromEulerDegrees(0, degrees, 0)
}

export function createSceneLayout(parent: Entity): void {
  createSideWall(parent, SIDE_WALL_DISTANCE, RIGHT_SIDE_INGREDIENTS, FACE_NEGATIVE_X)
  createLeftWall(parent)
  createFrontRow(parent)
  createBackWall(parent)
  createIsland(parent)
}

/**
 * Places a row of ingredient counters along one wall (fixed X), spaced
 * edge-to-edge along Z and centered on Z=0, all facing toward the room's
 * center.
 */
function createSideWall(parent: Entity, x: number, ingredients: IngredientDefinition[], facingDegrees: number): void {
  const totalDepth = (ingredients.length - 1) * COUNTER_WIDTH
  const startZ = -totalDepth / 2
  const rotation = rotationDegrees(facingDegrees)

  ingredients.forEach((definition, index) => {
    const position = Vector3.create(x, 0, startZ + index * COUNTER_WIDTH)
    createIngredientCounter(position, rotation, parent, definition)
  })
}

/**
 * Places the left wall: 4 ingredient counters plus a delivery counter in
 * the 5th slot — where bacon's counter used to be — using the same 5-slot
 * spacing as the right wall so both walls stay aligned.
 */
function createLeftWall(parent: Entity): void {
  const slotCount = RIGHT_SIDE_INGREDIENTS.length
  const totalDepth = (slotCount - 1) * COUNTER_WIDTH
  const startZ = -totalDepth / 2
  const rotation = rotationDegrees(FACE_POSITIVE_X)
  const x = -SIDE_WALL_DISTANCE

  LEFT_SIDE_INGREDIENTS.forEach((definition, index) => {
    const position = Vector3.create(x, 0, startZ + index * COUNTER_WIDTH)
    createIngredientCounter(position, rotation, parent, definition)
  })

  const deliveryPosition = Vector3.create(x, 0, startZ + LEFT_SIDE_INGREDIENTS.length * COUNTER_WIDTH)
  const deliveryCounter = createFixture({
    model: MODELS.counter,
    position: deliveryPosition,
    rotation,
    parent,
    height: COUNTER_HEIGHT,
    displayModel: MODELS.deliveryPad,
    evaluateInteraction: () => evaluateDeliveryCounterInteraction()
  })

  registerDeliveryCounter(deliveryCounter)
}

/**
 * Places the front row: counter, stove, counter, stove, counter, stove,
 * counter — 7 fixtures side-by-side, all facing toward the room's center.
 * The counters are preparation counters.
 */
function createFrontRow(parent: Entity): void {
  const sequence: Array<'counter' | 'stove'> = ['counter', 'stove', 'counter', 'stove', 'counter', 'stove', 'counter']
  const widths = sequence.map((kind) => (kind === 'stove' ? STOVE_WIDTH : COUNTER_WIDTH))
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
  const rotation = rotationDegrees(FACE_POSITIVE_Z)

  let cursorX = -totalWidth / 2
  sequence.forEach((kind) => {
    const width = kind === 'stove' ? STOVE_WIDTH : COUNTER_WIDTH
    const position = Vector3.create(cursorX + width / 2, 0, -FRONT_ROW_DISTANCE)

    createFixture({
      model: kind === 'stove' ? MODELS.stove : MODELS.counter,
      position,
      rotation,
      parent,
      height: kind === 'stove' ? STOVE_HEIGHT : COUNTER_HEIGHT,
      evaluateInteraction: kind === 'counter' ? evaluatePreparationCounterInteraction : evaluateStoveInteraction
    })

    cursorX += width
  })
}

/**
 * Places a 2x2 counter island in the middle: two counters facing -Z, two
 * facing +Z, backs touching at Z=0 so the whole block reads as one island
 * with fronts facing outward on both sides. All four are preparation
 * counters.
 */
function createIsland(parent: Entity): void {
  const halfWidth = COUNTER_WIDTH / 2
  const halfDepth = COUNTER_DEPTH / 2

  const rows: Array<{ z: number; facingDegrees: number }> = [
    { z: -halfDepth, facingDegrees: FACE_NEGATIVE_Z },
    { z: halfDepth, facingDegrees: FACE_POSITIVE_Z }
  ]

  for (const row of rows) {
    const rotation = rotationDegrees(row.facingDegrees)
    for (const x of [-halfWidth, halfWidth]) {
      createFixture({
        model: MODELS.counter,
        position: Vector3.create(x, 0, row.z),
        rotation,
        parent,
        height: COUNTER_HEIGHT,
        evaluateInteraction: evaluatePreparationCounterInteraction
      })
    }
  }
}

/**
 * Places the back wall: 2 plate counters plus a trash bin — the trash bin
 * uses the same width/depth/height allotment as a counter even though its
 * model is visually smaller, so it lines up seamlessly in the same row.
 */
function createBackWall(parent: Entity): void {
  const sequence: Array<'plate' | 'trash'> = ['plate', 'plate', 'trash']
  const totalWidth = sequence.length * COUNTER_WIDTH
  const startX = -totalWidth / 2
  const rotation = rotationDegrees(FACE_NEGATIVE_Z)

  sequence.forEach((kind, index) => {
    const position = Vector3.create(startX + index * COUNTER_WIDTH + COUNTER_WIDTH / 2, 0, BACK_WALL_DISTANCE)

    if (kind === 'plate') {
      createFixture({
        model: MODELS.counter,
        position,
        rotation,
        parent,
        height: COUNTER_HEIGHT,
        displayModel: MODELS.plateDisplay,
        evaluateInteraction: () => evaluatePlateCounterInteraction()
      })
    } else {
      createFixture({
        model: MODELS.trashBin,
        position,
        rotation,
        parent,
        height: TRASH_BIN_HEIGHT,
        evaluateInteraction: () => evaluateTrashBinInteraction()
      })
    }
  })
}
