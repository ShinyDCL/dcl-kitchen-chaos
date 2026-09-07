// Assembles the kitchen: ingredient counters along the left and right walls
// (both bookended by a preparation counter), a front row alternating
// preparation counters and stoves, a 2x2 preparation-counter island, a back
// wall carrying the discard and delivery counters, and a decorative counter in
// each corner. All positions are local to `parent`, the scene root.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FIXTURE_DEPTH, FIXTURE_HEIGHT, FIXTURE_WIDTH } from '../../shared/constants'
import { MODELS } from '../../shared/models'
import {
  evaluateDeliveryCounterInteraction,
  evaluateDiscardCounterInteraction,
  evaluatePreparationCounterInteraction,
  evaluateStoveInteraction
} from '../interaction/interactionRules'
import { registerDeliveryCounter } from './fixtures/deliveryCounter'
import { createFixture } from './fixtures/fixture'
import {
  createIngredientCounter,
  IngredientDefinition,
  LEFT_SIDE_INGREDIENTS,
  RIGHT_SIDE_INGREDIENTS
} from './fixtures/ingredientCounter'
import { registerPreparationCounter } from './fixtures/preparationCounter'
import { registerStove } from './fixtures/stove'

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

/** Static model with no focus highlight or interaction — unlike createFixture's, see fixture.ts. */
function createDecorativeModel(model: string, position: Vector3, rotation: Quaternion, parent: Entity): void {
  const entity = engine.addEntity()
  Transform.create(entity, { position, rotation, parent })
  GltfContainer.create(entity, { src: model })
}

export function createSceneLayout(parent: Entity): void {
  createSideWall(parent, SIDE_WALL_DISTANCE, RIGHT_SIDE_INGREDIENTS, FACE_NEGATIVE_X)
  createSideWall(parent, -SIDE_WALL_DISTANCE, LEFT_SIDE_INGREDIENTS, FACE_POSITIVE_X)
  createFrontRow(parent)
  createBackWall(parent)
  createIsland(parent)
  createCorners(parent)
}

/** A wall row at a fixed X: ingredient counters edge-to-edge along Z, centered on 0, bookended by a preparation counter at each end. */
function createSideWall(parent: Entity, x: number, ingredients: IngredientDefinition[], facingDegrees: number): void {
  const slotCount = ingredients.length + 2 // +2 for the bookending preparation counters
  const rotation = rotationDegrees(facingDegrees)
  const slotPosition = (slotIndex: number) => Vector3.create(x, 0, slotOffset(slotCount, slotIndex))

  createPreparationCounterFixture(slotPosition(0), rotation, parent)

  ingredients.forEach((definition, index) => {
    createIngredientCounter(slotPosition(index + 1), rotation, parent, definition)
  })

  createPreparationCounterFixture(slotPosition(slotCount - 1), rotation, parent)
}

/** The front row: seven fixtures alternating preparation counter and stove, all facing the room. */
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

/** The four corners — each at a side wall's X and the front row's or back wall's Z, so it belongs to both and to neither wall's builder. */
function createCorners(parent: Entity): void {
  const frontRotation = rotationDegrees(FACE_NEGATIVE_Z)
  const backRotation = rotationDegrees(FACE_POSITIVE_Z)

  for (const x of [-SIDE_WALL_DISTANCE, SIDE_WALL_DISTANCE]) {
    createDecorativeModel(MODELS.counterCorner, Vector3.create(x, 0, FRONT_ROW_DISTANCE), frontRotation, parent)
    createDecorativeModel(MODELS.counterCorner, Vector3.create(x, 0, -BACK_WALL_DISTANCE), backRotation, parent)
  }
}

/** The 2x2 island: two counters facing -Z, two facing +Z, backs touching at Z=0 so fronts face outward on both sides. */
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

/** The entrance wall: the discard and delivery counters, mirrored around X with a walkway between, each kept half a gap clear of its corner. */
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
