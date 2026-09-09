// Delivery counter visuals: the delivered item sits, then shrinks away, while
// a result mark scales up, holds and drops. renderedSuccess stays null until
// the server responds, since guessing flashed the wrong mark first.
//
// Reconciled against the synced DeliveryState. Single fixture, so module-level
// state is fine here unlike stove.ts's per-stove Map. Both animations run on a
// local timer started when this client first sees a new `models` value.

import { engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlatform, isMobile } from '@dcl/sdk/platform'

import { FIXTURE_HEIGHT } from '../../../shared/constants'
import { room } from '../../../shared/messages'
import { MODELS, sameModels } from '../../../shared/models'
import { DeliveryState } from '../../../shared/schemas'
import { playAcceptSound, playRejectSound } from '../../sound'
import { createCameraFacingTransform } from '../cameraFacing'
import { takeHeldItemModels } from '../heldItems'
import { getItemHeight } from '../itemPlacement'
import { getWorldPosition } from '../worldPosition'
import { getFixtureSyncId } from './fixture'

const DELIVERY_ITEM_SIT_DURATION = 1 // seconds before shrinking starts
const DELIVERY_ITEM_SHRINK_DURATION = 0.4 // seconds
const DELIVERY_RESULT_MARK_SCALE_SECONDS = 0.3 // seconds — scale-up and scale-down, each
const DELIVERY_RESULT_MARK_HOLD_SECONDS = 0.6 // seconds at full scale
const DELIVERY_RESULT_MARK_MODEL_SCALE = 1.5
const MOBILE_RESULT_MARK_SCALE = 1.4 // bigger on mobile — see fixtureMessage.ts's MOBILE_SCALE
const DELIVERY_ITEM_Y_OFFSET = 0.05 // clearance above the counter top so the bottom item does not sit in the surface — same as the stove pan
const DELIVERY_RESULT_MARK_Y_OFFSET = FIXTURE_HEIGHT + 0.8

let deliveryCounterEntity: Entity | null = null
let resultMarkWorldPosition: Vector3 | null = null

// One entity for both results, so a newer delivery replaces the clip still
// playing rather than layering over it (see sound.ts).
let resultSoundEntity: Entity | null = null

/** Call once when the delivery counter fixture is created. */
export function registerDeliveryCounter(fixtureEntity: Entity): void {
  deliveryCounterEntity = fixtureEntity
  resultSoundEntity = createSoundAnchor(fixtureEntity)

  const worldPosition = getWorldPosition(fixtureEntity)
  resultMarkWorldPosition = Vector3.create(
    worldPosition.x,
    worldPosition.y + DELIVERY_RESULT_MARK_Y_OFFSET,
    worldPosition.z
  )
}

function createSoundAnchor(parent: Entity): Entity {
  const anchor = engine.addEntity()
  Transform.create(anchor, { position: Vector3.create(0, FIXTURE_HEIGHT, 0), parent })
  return anchor
}

/** Takes whatever's held, sends it to the server, and starts the animation locally. No-op if nothing's held. */
export function deliverHeldItem(): void {
  if (deliveryCounterEntity === null) return

  const models = takeHeldItemModels()
  if (models.length === 0) return

  void room.send('deliverHeldItem', { deliveryCounterId: getFixtureSyncId(deliveryCounterEntity) })
  startAnimating(models, null) // success unknown until the server responds
  tickDeliveryAnimation(0) // apply immediately, same as the system's per-frame call
}

/** Null until the component exists — a default would be indistinguishable from a real deliveryId of 0. */
function getSyncedState(): { models: string[]; success: boolean; deliveryId: number } | null {
  for (const [, data] of engine.getEntitiesWith(DeliveryState)) {
    return { models: [...data.models], success: data.success, deliveryId: data.deliveryId }
  }
  return null
}

// --- Rendering: local timer, reconciled against synced DeliveryState ---

interface RenderedItem {
  root: Entity
  entities: Entity[]
}

let renderedItem: RenderedItem | null = null
let renderedModels: string[] = []
let renderedSuccess: boolean | null = null // null until the server's verdict is known for the current delivery
let elapsed = 0 // seconds since this client started animating the current delivery
let lastSyncedDeliveryId: number | null = null // null until a synced value has been seen at all
let checkmarkEntity: Entity | null = null
let crossmarkEntity: Entity | null = null
let systemRegistered = false

/** Reconciles the delivery counter's synced state against what's currently rendered. Call once during client setup. */
export function startRenderingDeliveryCounter(): void {
  if (systemRegistered) return
  engine.addSystem(deliveryRenderSystem)
  engine.addSystem(prebuildResultMarksOnceReady)
  systemRegistered = true
}

// Builds the marks here rather than on first need, since isMobile() reads
// false until getPlatform() resolves — building on the first render tick
// (which happens almost immediately) would always bake in the desktop
// scale/facing.
function prebuildResultMarksOnceReady(): void {
  if (getPlatform() === null) return
  engine.removeSystem(prebuildResultMarksOnceReady)
  getOrCreateCheckmark()
  getOrCreateCrossmark()
}

function deliveryRenderSystem(dt: number): void {
  reconcileDelivery()
  tickDeliveryAnimation(dt)
}

/**
 * Reacts to deliveryId advancing rather than to a content diff: two deliveries
 * in a row can carry identical models and success, and a live read is briefly
 * stale right after this client's own optimistic deliverHeldItem.
 */
function reconcileDelivery(): void {
  const synced = getSyncedState()
  if (synced === null || synced.deliveryId === lastSyncedDeliveryId) return

  // The first value seen is only a baseline: deliveryId carries no time, so
  // replaying whatever the snapshot held would greet every joiner with a
  // stranger's delivery.
  const isBaseline = lastSyncedDeliveryId === null
  lastSyncedDeliveryId = synced.deliveryId

  if (sameModels(synced.models, renderedModels)) {
    renderedSuccess = synced.success // our own delivery, now confirmed — don't restart it
  } else if (!isBaseline) {
    startAnimating(synced.models, synced.success)
  }
}

/** Starts the local animation for a delivery this client hasn't animated yet. */
function startAnimating(models: string[], success: boolean | null): void {
  renderedModels = models
  renderedSuccess = success
  elapsed = 0
  soundPlayed = false
  rebuildItemEntities(models)
}

/** `position` is only used on mobile — see sound.ts. */
function playDeliveryResultSound(success: boolean, position: Vector3): void {
  if (success) playAcceptSound(resultSoundEntity, position)
  else playRejectSound(resultSoundEntity, position)
}

// Whichever of the two runs longer decides when a delivery is finished with.
const DELIVERY_ANIMATION_SECONDS = Math.max(
  DELIVERY_ITEM_SIT_DURATION + DELIVERY_ITEM_SHRINK_DURATION,
  DELIVERY_RESULT_MARK_SCALE_SECONDS * 2 + DELIVERY_RESULT_MARK_HOLD_SECONDS
)

function tickDeliveryAnimation(dt: number): void {
  if (renderedModels.length === 0) return
  elapsed += dt

  if (elapsed < DELIVERY_ITEM_SIT_DURATION + DELIVERY_ITEM_SHRINK_DURATION) {
    updateItemScale(elapsed)
  } else {
    teardownItemEntities()
  }

  revealDeliveryResult(elapsed, renderedSuccess)

  // Forget the finished stack, so a later delivery of the same recipe reads as
  // new rather than as this one being confirmed — and so this stops running
  // every frame. Held until the verdict lands, since reconcileDelivery matches
  // on these models to recognise our own delivery.
  if (renderedSuccess !== null && elapsed >= DELIVERY_ANIMATION_SECONDS) renderedModels = []
}

function rebuildItemEntities(models: string[]): void {
  teardownItemEntities()
  if (models.length === 0 || deliveryCounterEntity === null) return

  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(0, FIXTURE_HEIGHT + DELIVERY_ITEM_Y_OFFSET, 0),
    parent: deliveryCounterEntity
  })

  const entities: Entity[] = []
  let cumulativeHeight = 0
  for (const model of models) {
    const item = engine.addEntity()
    Transform.create(item, { position: Vector3.create(0, cumulativeHeight, 0), parent: root })
    GltfContainer.create(item, { src: model })
    entities.push(item)
    cumulativeHeight += getItemHeight(model)
  }

  renderedItem = { root, entities }
}

function teardownItemEntities(): void {
  if (renderedItem === null) return
  for (const entity of renderedItem.entities) engine.removeEntity(entity)
  engine.removeEntity(renderedItem.root)
  renderedItem = null
}

function updateItemScale(elapsedSeconds: number): void {
  if (renderedItem === null) return

  if (elapsedSeconds < DELIVERY_ITEM_SIT_DURATION) {
    Transform.getMutable(renderedItem.root).scale = Vector3.One()
    return
  }

  const shrinkT = Math.min((elapsedSeconds - DELIVERY_ITEM_SIT_DURATION) / DELIVERY_ITEM_SHRINK_DURATION, 1)
  const scale = 1 - shrinkT
  Transform.getMutable(renderedItem.root).scale = Vector3.create(scale, scale, scale)
}

let soundPlayed = false // avoids replaying the result sound every frame the mark stays visible

/** Shows and sounds the verdict together, so they stay in step instead of drifting apart in separate functions. */
function revealDeliveryResult(elapsedSeconds: number, success: boolean | null): void {
  if (resultMarkWorldPosition === null) return // registerDeliveryCounter wasn't called — shouldn't happen in practice

  // Marks may not be built yet (see prebuildResultMarksOnceReady) —
  // nothing to hide in that case.
  if (success === null) {
    if (checkmarkEntity !== null) VisibilityComponent.getMutable(checkmarkEntity).visible = false
    if (crossmarkEntity !== null) VisibilityComponent.getMutable(crossmarkEntity).visible = false
    return
  }

  const shown = success ? getOrCreateCheckmark() : getOrCreateCrossmark()
  const hidden = success ? getOrCreateCrossmark() : getOrCreateCheckmark()

  const totalDuration = DELIVERY_RESULT_MARK_SCALE_SECONDS * 2 + DELIVERY_RESULT_MARK_HOLD_SECONDS
  VisibilityComponent.getMutable(hidden).visible = false
  if (elapsedSeconds > totalDuration) {
    VisibilityComponent.getMutable(shown).visible = false
    return
  }

  if (!soundPlayed) {
    soundPlayed = true
    playDeliveryResultSound(success, resultMarkWorldPosition)
  }

  VisibilityComponent.getMutable(shown).visible = true
  const modelScale = DELIVERY_RESULT_MARK_MODEL_SCALE * (isMobile() ? MOBILE_RESULT_MARK_SCALE : 1)
  const scale = resultMarkScale(elapsedSeconds) * modelScale
  Transform.getMutable(shown).scale = Vector3.create(scale, scale, scale)
}

/** 0→1 over the scale-up, held at 1 through the hold, then 1→0 over the scale-down. */
function resultMarkScale(elapsed: number): number {
  if (elapsed < DELIVERY_RESULT_MARK_SCALE_SECONDS) return elapsed / DELIVERY_RESULT_MARK_SCALE_SECONDS

  const holdEnd = DELIVERY_RESULT_MARK_SCALE_SECONDS + DELIVERY_RESULT_MARK_HOLD_SECONDS
  if (elapsed < holdEnd) return 1

  return 1 - (elapsed - holdEnd) / DELIVERY_RESULT_MARK_SCALE_SECONDS
}

function getOrCreateCheckmark(): Entity {
  if (checkmarkEntity === null) checkmarkEntity = createResultMark(MODELS.checkmark)
  return checkmarkEntity
}

function getOrCreateCrossmark(): Entity {
  if (crossmarkEntity === null) crossmarkEntity = createResultMark(MODELS.crossmark)
  return crossmarkEntity
}

/** Anchor faces the camera; model is a child rotated 180° to face the right way. */
function createResultMark(model: string): Entity {
  const anchor = engine.addEntity()
  createCameraFacingTransform(anchor, { position: resultMarkWorldPosition ?? Vector3.Zero(), scale: Vector3.Zero() })
  VisibilityComponent.create(anchor, { visible: false, propagateToChildren: true })

  const mark = engine.addEntity()
  Transform.create(mark, { parent: anchor, rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  GltfContainer.create(mark, { src: model })

  return anchor
}
