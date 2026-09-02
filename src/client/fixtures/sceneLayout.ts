// Assembles the full kitchen layout: ingredient counters along the left and
// right walls (the right wall's first slot is a plate counter, ahead of its
// ingredients; both walls are bookended by a preparation counter), a front
// row alternating preparation counters and stoves, a 2x2 preparation-counter
// island in the middle, a back/entrance wall with a discard counter and the
// delivery counter (each inset from its corner, open walkway between), and
// a decorative counter in each of the room's four corners. All
// positions/rotations are local to `parent` (the scene root), matching
// the existing world-placement pattern.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FIXTURE_DEPTH, FIXTURE_HEIGHT, FIXTURE_WIDTH } from '../../shared/constants'
import { MODELS } from '../../shared/models'
import {
  evaluateDeliveryCounterInteraction,
  evaluateDiscardCounterInteraction,
  evaluatePlateCounterInteraction,
  evaluatePreparationCounterInteraction,
  evaluateStoveInteraction
} from '../interactionRules'
import { registerDeliveryCounter } from './deliveryCounter'
import { createFixture } from './fixtures'
import {
  createIngredientCounter,
  IngredientDefinition,
  LEFT_SIDE_INGREDIENTS,
  RIGHT_SIDE_INGREDIENTS
} from './ingredientCounters'
import { registerPreparationCounter } from './preparationCounters'
import { registerStove } from './stoveCooking'

// Local-space distances from the scene root to each wall/row — tuned to
// match Scene.glb, can't be derived from the model file.
const SIDE_WALL_DISTANCE = 5.45 // meters, along X
const FRONT_ROW_DISTANCE = 5.45 // meters, along Z
const BACK_WALL_DISTANCE = 5.45 // meters, along Z

// The discard/delivery counter models are wider than a standard fixture — also tuned to match Scene.glb.
const BACK_WALL_COUNTER_WIDTH = 3.5 // meters

// Y-axis rotation (degrees) for a fixture whose unrotated model faces +Z.
const FACE_POSITIVE_Z = 0
const FACE_POSITIVE_X = 90
const FACE_NEGATIVE_Z = 180
const FACE_NEGATIVE_X = 270

function rotationDegrees(degrees: number): Quaternion {
  return Quaternion.fromEulerDegrees(0, degrees, 0)
}

/** Center of the `index`-th of `count` FIXTURE_WIDTH-wide slots, as a whole row centered on 0. */
function slotOffset(count: number, index: number): number {
  return (index - (count - 1) / 2) * FIXTURE_WIDTH
}

/** The createFixture + registerPreparationCounter pairing shared by every preparation counter in the layout. */
function createPreparationCounterFixture(position: Vector3, rotation: Quaternion, parent: Entity): void {
  const fixture = createFixture({
    model: MODELS.counter,
    position,
    rotation,
    parent,
    height: FIXTURE_HEIGHT,
    evaluateInteraction: evaluatePreparationCounterInteraction
  })
  registerPreparationCounter(fixture)
}

/** Static model with no focus highlight or interaction — unlike createFixture's, see fixtures.ts. */
function createDecorativeModel(model: string, position: Vector3, rotation: Quaternion, parent: Entity): void {
  const entity = engine.addEntity()
  Transform.create(entity, { position, rotation, parent })
  GltfContainer.create(entity, { src: model })
}

export function createSceneLayout(parent: Entity): void {
  createSideWall(parent, SIDE_WALL_DISTANCE, RIGHT_SIDE_INGREDIENTS, FACE_NEGATIVE_X, true)
  createSideWall(parent, -SIDE_WALL_DISTANCE, LEFT_SIDE_INGREDIENTS, FACE_POSITIVE_X)
  createFrontRow(parent)
  createBackWall(parent)
  createIsland(parent)
  createCorners(parent)
}

/**
 * Places a row of ingredient counters along one wall (fixed X), spaced
 * edge-to-edge along Z and centered on Z=0, all facing toward the room's
 * center, bookended by a preparation counter at each end. When
 * includePlateCounter is set, a plate counter takes the next slot ahead of
 * the ingredients.
 */
function createSideWall(
  parent: Entity,
  x: number,
  ingredients: IngredientDefinition[],
  facingDegrees: number,
  includePlateCounter = false
): void {
  const slotCount = ingredients.length + (includePlateCounter ? 1 : 0) + 2 // +2 for the bookending preparation counters
  const rotation = rotationDegrees(facingDegrees)
  const slotPosition = (slotIndex: number) => Vector3.create(x, 0, slotOffset(slotCount, slotIndex))

  createPreparationCounterFixture(slotPosition(0), rotation, parent)

  let nextSlot = 1
  if (includePlateCounter) {
    createFixture({
      model: MODELS.counter,
      position: slotPosition(nextSlot),
      rotation,
      parent,
      height: FIXTURE_HEIGHT,
      displayModel: MODELS.plateDisplay,
      evaluateInteraction: evaluatePlateCounterInteraction
    })
    nextSlot += 1
  }

  ingredients.forEach((definition, index) => {
    createIngredientCounter(slotPosition(nextSlot + index), rotation, parent, definition)
  })

  createPreparationCounterFixture(slotPosition(slotCount - 1), rotation, parent)
}

/**
 * Places the front row: counter, stove, counter, stove, counter, stove,
 * counter — 7 fixtures side-by-side, all facing toward the room's center.
 * The counters are preparation counters.
 */
function createFrontRow(parent: Entity): void {
  const sequence: Array<'counter' | 'stove'> = ['counter', 'stove', 'counter', 'stove', 'counter', 'stove', 'counter']
  const rotation = rotationDegrees(FACE_NEGATIVE_Z)

  sequence.forEach((kind, index) => {
    const position = Vector3.create(slotOffset(sequence.length, index), 0, FRONT_ROW_DISTANCE)

    if (kind === 'counter') {
      createPreparationCounterFixture(position, rotation, parent)
      return
    }

    const fixture = createFixture({
      model: MODELS.stove,
      position,
      rotation,
      parent,
      height: FIXTURE_HEIGHT,
      evaluateInteraction: evaluateStoveInteraction
    })
    registerStove(fixture)
  })
}

/**
 * Fills the room's four corners — each sits at a side wall's X and the
 * front row's/back wall's Z, so it reads as belonging to both. Placed
 * separately from createSideWall/createFrontRow/createBackWall rather than
 * bundled into any one of them, since no single wall owns a corner.
 */
function createCorners(parent: Entity): void {
  const frontRotation = rotationDegrees(FACE_NEGATIVE_Z)
  const backRotation = rotationDegrees(FACE_POSITIVE_Z)

  for (const x of [-SIDE_WALL_DISTANCE, SIDE_WALL_DISTANCE]) {
    createDecorativeModel(MODELS.counterCorner, Vector3.create(x, 0, FRONT_ROW_DISTANCE), frontRotation, parent)
    createDecorativeModel(MODELS.counterCorner, Vector3.create(x, 0, -BACK_WALL_DISTANCE), backRotation, parent)
  }
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
      createPreparationCounterFixture(Vector3.create(x, 0, row.z), rotation, parent)
    }
  }
}

/**
 * Places the back wall (the entrance wall): a discard counter and the
 * delivery counter, mirrored around X and each kept half a gap clear of the
 * corner beside it — accounting for BACK_WALL_COUNTER_WIDTH, since these
 * two are wider than a standard fixture — with an open walkway between them.
 */
function createBackWall(parent: Entity): void {
  const rotation = rotationDegrees(FACE_POSITIVE_Z)
  const halfGap = FIXTURE_DEPTH / 2
  const insetX = SIDE_WALL_DISTANCE - halfGap - BACK_WALL_COUNTER_WIDTH / 2

  createFixture({
    model: MODELS.discardCounter,
    position: Vector3.create(-insetX, 0, -BACK_WALL_DISTANCE),
    rotation,
    parent,
    height: FIXTURE_HEIGHT,
    evaluateInteraction: evaluateDiscardCounterInteraction
  })

  const deliveryCounter = createFixture({
    model: MODELS.deliveryCounter,
    position: Vector3.create(insetX, 0, -BACK_WALL_DISTANCE),
    rotation: rotationDegrees(FACE_NEGATIVE_Z), // DeliveryCounter.glb faces the opposite way from the discard counter
    parent,
    height: FIXTURE_HEIGHT,
    evaluateInteraction: evaluateDeliveryCounterInteraction
  })
  registerDeliveryCounter(deliveryCounter)
}
