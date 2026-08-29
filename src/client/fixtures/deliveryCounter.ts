// Delivery counter: placing a held item makes it sit, then shrink away,
// while a result mark scales up/holds/down alongside it — checkmark if it
// matched an active order (server-decided, see orderQueue.ts), crossmark
// otherwise. renderedSuccess stays null (neither mark shown) until the
// server responds, since guessing here used to flash the wrong mark first.
//
// Reconciled against the server-synced DeliveryState — see the
// authoritative-server skill. Single fixture, so module-level state is
// fine here unlike stoveCooking.ts's per-stove Map.
//
// Both animations are pure functions of `Date.now() - startTimestamp`, so
// only the delivery (models + one timestamp) ever crosses the network —
// every client derives the same frame from that shared instant, including
// one joining mid-animation. The hand-clear goes through
// takeHeldItemModelsPending rather than broadcasting, since the server
// verifies the claimed models against the real held item and can reject
// (restoring the hand) instead of trusting the claim outright.

import { engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlatform, isMobile } from '@dcl/sdk/platform'

import { FIXTURE_HEIGHT } from '../../shared/constants'
import { room } from '../../shared/messages'
import { MODELS, sameModels } from '../../shared/models'
import { DeliveryState } from '../../shared/schemas'
import { createCameraFacingTransform } from '../cameraFacing'
import { takeHeldItemModelsPending } from '../heldItem'
import { getItemHeight } from '../itemHeights'
import { isLocalPlayerPlaying } from '../playerRoleState'
import { playAcceptSound, playRejectSound } from '../sound'
import { getWorldPosition } from '../worldPosition'
import { getFixtureSyncId } from './fixtures'

const DELIVERY_ITEM_SIT_DURATION = 1 // seconds before shrinking starts
const DELIVERY_ITEM_SHRINK_DURATION = 0.4 // seconds
const DELIVERY_RESULT_MARK_SCALE_SECONDS = 0.3 // seconds — scale-up and scale-down, each
const DELIVERY_RESULT_MARK_HOLD_SECONDS = 0.6 // seconds at full scale
const DELIVERY_RESULT_MARK_MODEL_SCALE = 1.5
const MOBILE_RESULT_MARK_SCALE = 1.4 // bigger on mobile — see fixtureMessage.ts's MOBILE_SCALE
const DELIVERY_RESULT_MARK_Y_OFFSET = FIXTURE_HEIGHT + 0.8

// Grace window for a delivery observed just after its 1.4s window closed
// (latency) — replays from now instead of not showing at all.
const DELIVERY_LATE_ARRIVAL_GRACE_SECONDS = 5

let deliveryCounterEntity: Entity | null = null
let resultMarkWorldPosition: Vector3 | null = null

// Separate entity per sound role — one AudioSource would let a later call
// cut off a clip still playing (see sound.ts).
let acceptSoundEntity: Entity | null = null
let rejectSoundEntity: Entity | null = null

/** Call once when the delivery counter fixture is created. */
export function registerDeliveryCounter(fixtureEntity: Entity): void {
  deliveryCounterEntity = fixtureEntity
  acceptSoundEntity = createSoundAnchor(fixtureEntity)
  rejectSoundEntity = createSoundAnchor(fixtureEntity)

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

/** Takes whatever's held, sends it to the server, and renders the sit-then-shrink sequence locally right away. No-op if nothing's held. */
export function deliverHeldItem(): void {
  if (deliveryCounterEntity === null) return

  const models = takeHeldItemModelsPending()
  if (models.length === 0) return

  const startTimestamp = Date.now()
  void room.send('deliverHeldItem', { models, deliveryCounterId: getFixtureSyncId(deliveryCounterEntity) })

  renderedModels = models
  renderedStartTimestamp = startTimestamp
  renderedSuccess = null // unknown until the server responds
  tickDeliveryAnimation() // apply immediately, same as the system's per-frame call
}

function getSyncedState(): { models: string[]; startTimestamp: number; success: boolean } {
  for (const [, data] of engine.getEntitiesWith(DeliveryState)) {
    return { models: [...data.models], startTimestamp: Number(data.startTimestamp), success: data.success }
  }
  return { models: [], startTimestamp: 0, success: true }
}

function elapsedSince(startTimestamp: number): number {
  return (Date.now() - startTimestamp) / 1000
}

// --- Rendering, reconciled against the synced DeliveryState component ---

interface RenderedItem {
  root: Entity
  entities: Entity[]
}

let renderedItem: RenderedItem | null = null
let builtStartTimestamp = 0 // startTimestamp renderedItem reflects — detects a new delivery landing while one is still showing
let renderedModels: string[] = []
let renderedStartTimestamp = 0
let renderedSuccess: boolean | null = null // null until the server's verdict is known for the current delivery
let lastSyncedModels: string[] = []
let lastSyncedStartTimestamp = 0
let lastSyncedSuccess = true
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

function deliveryRenderSystem(): void {
  reconcileDelivery()
  tickDeliveryAnimation()
}

/**
 * Only reacts once the synced delivery has actually changed since last
 * observed, not whenever it merely differs from what's rendered — a live
 * read is briefly stale right after this client's own optimistic
 * deliverHeldItem, and reacting to that would flicker.
 *
 * Same models as already rendered means this is that optimistic guess
 * being corrected, not a new delivery — startTimestamp/success are
 * adopted in place, skipping tickDeliveryAnimation's rebuild, since
 * destroying and recreating the item entities is what caused the flicker.
 *
 * A delivery whose 1.4s window already closed by the time it's first
 * observed is re-anchored to start now, within
 * DELIVERY_LATE_ARRIVAL_GRACE_SECONDS, instead of never showing.
 */
function reconcileDelivery(): void {
  const synced = getSyncedState()
  const syncedChanged =
    !sameModels(synced.models, lastSyncedModels) ||
    synced.startTimestamp !== lastSyncedStartTimestamp ||
    synced.success !== lastSyncedSuccess
  if (!syncedChanged) return
  lastSyncedModels = synced.models
  lastSyncedStartTimestamp = synced.startTimestamp
  lastSyncedSuccess = synced.success

  const renderedMatches =
    sameModels(synced.models, renderedModels) &&
    synced.startTimestamp === renderedStartTimestamp &&
    synced.success === renderedSuccess
  if (renderedMatches) return

  if (sameModels(synced.models, renderedModels)) {
    renderedStartTimestamp = synced.startTimestamp
    renderedSuccess = synced.success
    builtStartTimestamp = synced.startTimestamp
    return
  }

  renderedModels = synced.models
  renderedStartTimestamp = arrivedLateButRecently(synced) ? Date.now() : synced.startTimestamp
  renderedSuccess = synced.success
}

function playDeliveryResultSound(success: boolean): void {
  if (success) playAcceptSound(acceptSoundEntity)
  else playRejectSound(rejectSoundEntity)
}

function arrivedLateButRecently(synced: { models: string[]; startTimestamp: number }): boolean {
  if (synced.models.length === 0) return false
  const windowDuration = DELIVERY_ITEM_SIT_DURATION + DELIVERY_ITEM_SHRINK_DURATION
  const elapsed = elapsedSince(synced.startTimestamp)
  return elapsed >= windowDuration && elapsed < windowDuration + DELIVERY_LATE_ARRIVAL_GRACE_SECONDS
}

/** Rebuilds when withinItemWindow flips OR a new delivery's timestamp differs from the one built — the latter covers a second delivery landing before the first finishes animating. */
function tickDeliveryAnimation(): void {
  const active = renderedModels.length > 0
  const withinItemWindow =
    active && elapsedSince(renderedStartTimestamp) < DELIVERY_ITEM_SIT_DURATION + DELIVERY_ITEM_SHRINK_DURATION

  const isNewDelivery = withinItemWindow && renderedStartTimestamp !== builtStartTimestamp
  if (withinItemWindow !== (renderedItem !== null) || isNewDelivery) {
    rebuildItemEntities(withinItemWindow ? renderedModels : [])
    builtStartTimestamp = renderedStartTimestamp
  }

  if (renderedItem !== null) updateItemScale(renderedStartTimestamp)
  revealDeliveryResult(active, renderedStartTimestamp, renderedSuccess)
}

function rebuildItemEntities(models: string[]): void {
  if (renderedItem !== null) {
    for (const entity of renderedItem.entities) engine.removeEntity(entity)
    engine.removeEntity(renderedItem.root)
    renderedItem = null
  }
  if (models.length === 0 || deliveryCounterEntity === null) return

  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(0, FIXTURE_HEIGHT, 0), parent: deliveryCounterEntity })

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

function updateItemScale(startTimestamp: number): void {
  if (renderedItem === null) return

  const elapsed = elapsedSince(startTimestamp)
  if (elapsed < DELIVERY_ITEM_SIT_DURATION) {
    Transform.getMutable(renderedItem.root).scale = Vector3.One()
    return
  }

  const shrinkT = Math.min((elapsed - DELIVERY_ITEM_SIT_DURATION) / DELIVERY_ITEM_SHRINK_DURATION, 1)
  const scale = 1 - shrinkT
  Transform.getMutable(renderedItem.root).scale = Vector3.create(scale, scale, scale)
}

let soundPlayedForStartTimestamp: number | null = null // avoids replaying the result sound every frame the mark stays visible

/** Shows and sounds the verdict together, so they stay in step instead of drifting apart in separate functions. */
function revealDeliveryResult(active: boolean, startTimestamp: number, success: boolean | null): void {
  if (resultMarkWorldPosition === null) return // registerDeliveryCounter wasn't called — shouldn't happen in practice

  // Hidden for spectators. Marks may not be built yet (see
  // prebuildResultMarksOnceReady) — nothing to hide in that case.
  if (!active || success === null || !isLocalPlayerPlaying()) {
    if (checkmarkEntity !== null) VisibilityComponent.getMutable(checkmarkEntity).visible = false
    if (crossmarkEntity !== null) VisibilityComponent.getMutable(crossmarkEntity).visible = false
    return
  }

  const shown = success ? getOrCreateCheckmark() : getOrCreateCrossmark()
  const hidden = success ? getOrCreateCrossmark() : getOrCreateCheckmark()

  const elapsed = elapsedSince(startTimestamp)
  const totalDuration = DELIVERY_RESULT_MARK_SCALE_SECONDS * 2 + DELIVERY_RESULT_MARK_HOLD_SECONDS
  VisibilityComponent.getMutable(hidden).visible = false
  if (elapsed < 0 || elapsed > totalDuration) {
    VisibilityComponent.getMutable(shown).visible = false
    return
  }

  if (soundPlayedForStartTimestamp !== startTimestamp) {
    soundPlayedForStartTimestamp = startTimestamp
    playDeliveryResultSound(success)
  }

  VisibilityComponent.getMutable(shown).visible = true
  const modelScale = DELIVERY_RESULT_MARK_MODEL_SCALE * (isMobile() ? MOBILE_RESULT_MARK_SCALE : 1)
  const scale = resultMarkScale(elapsed) * modelScale
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
