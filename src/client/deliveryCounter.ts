// Delivery counter: interacting while holding something places it on the
// counter, where it sits for DELIVERY_ITEM_SIT_DURATION, then shrinks away
// over DELIVERY_ITEM_SHRINK_DURATION while a result mark spins and scales
// up — a checkmark if the delivery matched an active recipe (server-
// decided, see recipeQueue.ts), or a crossmark otherwise. renderedSuccess
// defaults optimistically to true since the real verdict is server-only;
// the ~1s sit delay is normally enough for it to land first, and
// reconciliation corrects it if not.
//
// Reconciled against the server-synced DeliveryState rather than held as
// local truth — see the authoritative-server skill. Only one delivery
// counter exists in the scene, so this keeps simple module-level state
// rather than a Map keyed by fixture, unlike stoveCooking.ts's per-stove
// state.
//
// Both animations are pure functions of `Date.now() - startTimestamp`, so
// only the delivery itself (models + one timestamp) is ever sent over the
// network — every client derives the same animation frame from that one
// shared instant, and a client joining mid-animation picks it up at the
// right point instead of restarting it. deliverHeldItem still renders the
// item locally right away for zero-latency feedback. The hand-clear goes
// through takeHeldItemModelsPending rather than broadcasting, since the
// server now verifies the claimed models against the player's real held
// item before accepting (see server/deliveryCounter.ts) and rejects
// (restoring the hand) rather than trusting the claim outright.

import { Billboard, BillboardMode, engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import {
  DELIVERY_CHECKMARK_DURATION,
  DELIVERY_CHECKMARK_Y_OFFSET,
  DELIVERY_ITEM_SHRINK_DURATION,
  DELIVERY_ITEM_SIT_DURATION,
  DELIVERY_LATE_ARRIVAL_GRACE_SECONDS,
  FIXTURE_HEIGHT
} from '../shared/constants'
import { room } from '../shared/messages'
import { MODELS, sameModels } from '../shared/models'
import { DeliveryState } from '../shared/schemas'
import { getFixtureSyncId } from './fixtures'
import { takeHeldItemModelsPending } from './heldItem'
import { getItemHeight } from './itemHeights'
import { getWorldPosition } from './worldPosition'

let deliveryCounterEntity: Entity | null = null
let checkmarkWorldPosition: Vector3 | null = null

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

/** Takes whatever's held, sends it to the server, and renders the sit-then-shrink sequence locally right away. No-op if nothing's held. */
export function deliverHeldItem(): void {
  if (deliveryCounterEntity === null) return

  const models = takeHeldItemModelsPending()
  if (models.length === 0) return

  const startTimestamp = Date.now()
  void room.send('deliverHeldItem', { models, deliveryCounterId: getFixtureSyncId(deliveryCounterEntity) })

  renderedModels = models
  renderedStartTimestamp = startTimestamp
  renderedSuccess = true // optimistic guess — see header comment
  tickDeliveryAnimation() // builds/scales from the values just set, same as the system's per-frame call
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
let builtStartTimestamp = 0 // startTimestamp currently reflected by renderedItem — detects a new delivery arriving while one is still showing
let renderedModels: string[] = []
let renderedStartTimestamp = 0
let renderedSuccess = true
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
  systemRegistered = true
}

function deliveryRenderSystem(): void {
  reconcileDelivery()
  tickDeliveryAnimation()
}

/**
 * Points renderedModels/renderedStartTimestamp at the synced delivery, but
 * only when it has actually changed since last observed — not whenever it
 * merely differs from what's rendered. Right after this client's own
 * optimistic deliverHeldItem, a live read is briefly stale; gating on an
 * actual change makes that a no-op instead of a spurious revert-then-
 * reapply flicker.
 *
 * If a delivery's 1.4s window already closed by the time it's first
 * observed (latency ate the whole window), it's re-anchored to start now
 * instead of never showing — but only within
 * DELIVERY_LATE_ARRIVAL_GRACE_SECONDS of closing, so a player joining long
 * after the fact sees stale state as nothing, not a replay.
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

  renderedModels = synced.models
  renderedStartTimestamp = arrivedLateButRecently(synced) ? Date.now() : synced.startTimestamp
  renderedSuccess = synced.success
}

function arrivedLateButRecently(synced: { models: string[]; startTimestamp: number }): boolean {
  if (synced.models.length === 0) return false
  const windowDuration = DELIVERY_ITEM_SIT_DURATION + DELIVERY_ITEM_SHRINK_DURATION
  const elapsed = elapsedSince(synced.startTimestamp)
  return elapsed >= windowDuration && elapsed < windowDuration + DELIVERY_LATE_ARRIVAL_GRACE_SECONDS
}

/**
 * Continuous per-frame animation, derived purely from what's rendered —
 * never a fresh synced read. Rebuilds when withinItemWindow flips OR a new
 * delivery's timestamp differs from the one built — the latter covers a
 * second delivery landing while the first is still animating, where
 * withinItemWindow stays true throughout and would otherwise never
 * trigger a rebuild.
 */
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
  updateResultMark(active, renderedStartTimestamp, renderedSuccess)
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

/** The result mark's whole spin+scale animation is a pure function of elapsed time, so there's no separate "is it animating" state to track. */
function updateResultMark(active: boolean, startTimestamp: number, success: boolean): void {
  if (checkmarkWorldPosition === null) return // registerDeliveryCounter wasn't called — shouldn't happen in practice

  const shown = success ? getOrCreateCheckmark() : getOrCreateCrossmark()
  const hidden = success ? getOrCreateCrossmark() : getOrCreateCheckmark()

  if (!active) {
    VisibilityComponent.getMutable(shown).visible = false
    VisibilityComponent.getMutable(hidden).visible = false
    return
  }

  // Scale up then back down across the duration — a simple triangle curve
  // peaking at the midpoint. Starts once the item finishes sitting.
  const t = (elapsedSince(startTimestamp) - DELIVERY_ITEM_SIT_DURATION) / DELIVERY_CHECKMARK_DURATION
  VisibilityComponent.getMutable(hidden).visible = false
  if (t < 0 || t > 1) {
    VisibilityComponent.getMutable(shown).visible = false
    return
  }

  VisibilityComponent.getMutable(shown).visible = true
  const scale = t < 0.5 ? t / 0.5 : (1 - t) / 0.5
  Transform.getMutable(shown).scale = Vector3.create(scale, scale, scale)
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

function getOrCreateCrossmark(): Entity {
  if (crossmarkEntity !== null) return crossmarkEntity

  const crossmark = engine.addEntity()
  Transform.create(crossmark, {
    position: checkmarkWorldPosition ?? Vector3.Zero(),
    scale: Vector3.Zero()
  })
  GltfContainer.create(crossmark, { src: MODELS.crossmark })
  VisibilityComponent.create(crossmark, { visible: false })
  Billboard.create(crossmark, { billboardMode: BillboardMode.BM_Y })

  crossmarkEntity = crossmark
  return crossmark
}
