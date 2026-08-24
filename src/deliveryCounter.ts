// Delivery counter: interacting while holding something takes it out of
// the player's hand and places it on the counter, where it sits unchanged
// for DELIVERY_ITEM_SIT_DURATION, then shrinks away over
// DELIVERY_ITEM_SHRINK_DURATION while a checkmark (the same model used on
// stoves) spins and scales up above the pad. No scoring/order system yet.
//
// Only one delivery counter exists in the scene, so this keeps simple
// module-level state rather than a Map keyed by fixture, unlike
// stoveCooking.ts's per-stove state. Re-interacting while an item is
// sitting/shrinking naturally shows "Nothing to deliver" — the player's
// hand is already empty at that point (see interactionRules.ts), so no
// extra locking is needed.
//
// Two small systems, each a no-op when nothing's happening: one drives the
// placed item's sit/shrink/removal, the other drives the checkmark's
// spin+scale. No particles, no per-frame allocation — cheap on mobile.

import { engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import {
  DELIVERY_CHECKMARK_DURATION,
  DELIVERY_CHECKMARK_Y_OFFSET,
  DELIVERY_ITEM_SHRINK_DURATION,
  DELIVERY_ITEM_SIT_DURATION,
  FIXTURE_HEIGHT
} from './constants'
import { takeHeldItemModels } from './heldItem'
import { getItemHeight } from './itemHeights'
import { MODELS } from './models'
import { getWorldPosition } from './worldPosition'

let deliveryCounterEntity: Entity | null = null
let checkmarkWorldPosition: Vector3 | null = null

// --- Placed item: sit, then shrink ---

type ItemPhase = 'idle' | 'sitting' | 'shrinking'
let itemPhase: ItemPhase = 'idle'
let itemsRoot: Entity | null = null
let itemEntities: Entity[] = []
let itemElapsedSeconds = 0
let itemSystemRegistered = false

// --- Checkmark: spin + scale ---

let checkmarkEntity: Entity | null = null
let checkmarkAnimating = false
let checkmarkElapsedSeconds = 0
let checkmarkSystemRegistered = false

/** Call once when the delivery counter fixture is created. */
export function registerDeliveryCounter(fixtureEntity: Entity): void {
  deliveryCounterEntity = fixtureEntity
  const worldPosition = getWorldPosition(fixtureEntity)
  checkmarkWorldPosition = Vector3.create(
    worldPosition.x,
    worldPosition.y + DELIVERY_CHECKMARK_Y_OFFSET,
    worldPosition.z
  )
}

/** Takes whatever's held, places it on the counter, and starts the sit-then-shrink sequence. No-op if nothing's held. */
export function deliverHeldItem(): void {
  if (deliveryCounterEntity === null) return

  const models = takeHeldItemModels()
  if (models.length === 0) return

  itemsRoot = engine.addEntity()
  Transform.create(itemsRoot, { position: Vector3.create(0, FIXTURE_HEIGHT, 0), parent: deliveryCounterEntity })

  itemEntities = []
  let cumulativeHeight = 0
  for (const model of models) {
    const item = engine.addEntity()
    Transform.create(item, { position: Vector3.create(0, cumulativeHeight, 0), parent: itemsRoot })
    GltfContainer.create(item, { src: model })
    itemEntities.push(item)
    cumulativeHeight += getItemHeight(model)
  }

  itemPhase = 'sitting'
  itemElapsedSeconds = 0
  ensureItemSystemRegistered()
}

function ensureItemSystemRegistered(): void {
  if (itemSystemRegistered) return
  engine.addSystem(itemSystem)
  itemSystemRegistered = true
}

function itemSystem(dt: number): void {
  if (itemPhase === 'idle') return
  itemElapsedSeconds += dt

  if (itemPhase === 'sitting') {
    if (itemElapsedSeconds >= DELIVERY_ITEM_SIT_DURATION) {
      itemPhase = 'shrinking'
      itemElapsedSeconds = 0
      playCheckmarkAnimation()
    }
    return
  }

  // shrinking
  const t = Math.min(itemElapsedSeconds / DELIVERY_ITEM_SHRINK_DURATION, 1)
  if (itemsRoot !== null) {
    const scale = 1 - t
    Transform.getMutable(itemsRoot).scale = Vector3.create(scale, scale, scale)
  }

  if (t >= 1) {
    for (const item of itemEntities) engine.removeEntity(item)
    if (itemsRoot !== null) engine.removeEntity(itemsRoot)
    itemEntities = []
    itemsRoot = null
    itemPhase = 'idle'
  }
}

function playCheckmarkAnimation(): void {
  if (!checkmarkWorldPosition) return // registerDeliveryCounter wasn't called — shouldn't happen in practice

  const checkmark = getOrCreateCheckmark()
  Transform.getMutable(checkmark).scale = Vector3.Zero()
  VisibilityComponent.getMutable(checkmark).visible = true
  checkmarkElapsedSeconds = 0
  checkmarkAnimating = true

  ensureCheckmarkSystemRegistered()
}

function getOrCreateCheckmark(): Entity {
  if (checkmarkEntity !== null) return checkmarkEntity

  const checkmark = engine.addEntity()
  Transform.create(checkmark, {
    position: checkmarkWorldPosition ?? Vector3.Zero(),
    scale: Vector3.Zero(),
    rotation: Quaternion.fromEulerDegrees(0, 90, 0)
  })
  GltfContainer.create(checkmark, { src: MODELS.checkmark })
  VisibilityComponent.create(checkmark, { visible: false })

  checkmarkEntity = checkmark
  return checkmark
}

function ensureCheckmarkSystemRegistered(): void {
  if (checkmarkSystemRegistered) return
  engine.addSystem(checkmarkAnimationSystem)
  checkmarkSystemRegistered = true
}

function checkmarkAnimationSystem(dt: number): void {
  if (!checkmarkAnimating || checkmarkEntity === null) return

  checkmarkElapsedSeconds += dt
  const t = Math.min(checkmarkElapsedSeconds / DELIVERY_CHECKMARK_DURATION, 1)

  // Scale up then back down across the duration — a simple triangle curve
  // peaking at the midpoint.
  const scale = t < 0.5 ? t / 0.5 : (1 - t) / 0.5
  Transform.getMutable(checkmarkEntity).scale = Vector3.create(scale, scale, scale)

  if (t >= 1) {
    checkmarkAnimating = false
    VisibilityComponent.getMutable(checkmarkEntity).visible = false
  }
}
