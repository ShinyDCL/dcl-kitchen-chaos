// Assembles the full kitchen layout: ingredient counters along the left and
// right walls, a front row alternating empty counters and stoves, and a
// 2x2 counter island in the middle. All positions/rotations are local to
// `parent` (the scene root), matching the existing world-placement pattern.

import { Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import {
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
  STOVE_WIDTH
} from './constants'
import { createFixture } from './fixtures'
import {
  createIngredientCounter,
  IngredientDefinition,
  LEFT_SIDE_INGREDIENTS,
  RIGHT_SIDE_INGREDIENTS
} from './ingredientCounters'
import { MODELS } from './models'

function rotationDegrees(degrees: number): Quaternion {
  return Quaternion.fromEulerDegrees(0, degrees, 0)
}

export function createSceneLayout(parent: Entity): void {
  createSideWall(parent, SIDE_WALL_DISTANCE, RIGHT_SIDE_INGREDIENTS, FACE_NEGATIVE_X)
  createSideWall(parent, -SIDE_WALL_DISTANCE, LEFT_SIDE_INGREDIENTS, FACE_POSITIVE_X)
  createFrontRow(parent)
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
 * Places the front row: counter, stove, counter, stove, counter, stove,
 * counter — 7 fixtures side-by-side, empty and non-interactive for now
 * (highlight only), all facing toward the room's center.
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
      height: kind === 'stove' ? STOVE_HEIGHT : COUNTER_HEIGHT
      // no displayModel, no onInteract — highlight-only until behavior is implemented
    })

    cursorX += width
  })
}

/**
 * Places a 2x2 counter island in the middle: two counters facing -Z, two
 * facing +Z, backs touching at Z=0 so the whole block reads as one island
 * with fronts facing outward on both sides.
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
        height: COUNTER_HEIGHT
        // no displayModel, no onInteract — highlight-only until behavior is implemented
      })
    }
  }
}
