// Owns the visuals for each preparation counter, reconciled against the
// server-synced PreparationCounterState rather than held as local truth —
// see the authoritative-server skill. Doesn't decide what's allowed — see
// interactionRules.ts. Every action function assumes the caller already
// checked it's allowed.
//
// Each action function sends a narrow intent (place a plate, pick up the
// ingredient stack, ...), not the counter's whole computed new state — the
// server applies each atomically against its own live state (see
// server/fixtures/preparationCounters.ts), which is what lets two players place
// different ingredients on the same counter at once and have both stick,
// instead of whichever client's full-state push lands last discarding the
// other's. The reconciliation system (startRenderingPreparationCounters)
// is what makes a counter visible to other players, and what folds in
// concurrent changes this client's own prediction couldn't have known
// about.
//
// It only reacts when the synced state has actually changed since last
// observed (lastSyncedStates) — not whenever it merely differs from what's
// rendered. Right after this client's own optimistic render, a synced read
// is briefly stale; gating on an actual change makes that a no-op instead
// of a spurious revert-then-reapply flicker.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { FIXTURE_HEIGHT } from '../../shared/constants'
import { room } from '../../shared/messages'
import { MODELS } from '../../shared/models'
import { PreparationCounterState } from '../../shared/schemas'
import { takeHeldItemModelsPending, takeHeldItemPending } from '../heldItem'
import { getItemHeight } from '../itemHeights'
import { getFixtureSyncId } from './fixtures'

interface CounterContents {
  hasPlate: boolean
  ingredientModels: string[]
}

interface RenderedCounter extends CounterContents {
  plateEntity: Entity | null
  ingredientEntities: Entity[]
}

const renderedStates = new Map<Entity, RenderedCounter>()
const lastSyncedStates = new Map<Entity, CounterContents>()
const countersById = new Map<number, Entity>() // avoids an O(counters × synced entities) scan every frame

/** Registers a preparation counter fixture so its state gets rendered and reconciled. Call once per counter during scene setup. */
export function registerPreparationCounter(counter: Entity): void {
  renderedStates.set(counter, emptyRenderedCounter())
  lastSyncedStates.set(counter, emptyContents())
  countersById.set(getFixtureSyncId(counter), counter)
}

/** Reconciles every registered counter's synced state against what's currently rendered. Call once during client setup. */
export function startRenderingPreparationCounters(): void {
  if (reconcileSystemRegistered) return
  engine.addSystem(reconcileCountersSystem)
  reconcileSystemRegistered = true
}

let reconcileSystemRegistered = false

function reconcileCountersSystem(): void {
  for (const [, data] of engine.getEntitiesWith(PreparationCounterState)) {
    const counter = countersById.get(data.counterId)
    if (!counter) continue // synced state for a counter this client hasn't registered

    const synced: CounterContents = { hasPlate: data.hasPlate, ingredientModels: [...data.ingredientModels] }
    const lastSynced = lastSyncedStates.get(counter) ?? emptyContents()
    if (sameContents(synced, lastSynced)) continue // nothing new from the server since last frame

    lastSyncedStates.set(counter, synced)
    renderCounter(counter, synced)
  }
}

export interface PreparationCounterSnapshot {
  hasPlate: boolean
  ingredientCount: number
}

/**
 * Reads the counter's contents for interaction-legality decisions
 * (interactionRules.ts, driving the focus highlight's color/message) from
 * renderedStates — this client's current belief — rather than a raw live
 * poll of the synced component, which is briefly stale right after this
 * client's own optimistic action and would flip the highlight
 * allowed/disallowed for a moment until the real update caught up.
 */
export function getPreparationCounterSnapshot(counter: Entity): PreparationCounterSnapshot {
  const { hasPlate, ingredientModels } = getRenderedContents(counter)
  return { hasPlate, ingredientCount: ingredientModels.length }
}

function getRenderedContents(counter: Entity): CounterContents {
  const rendered = renderedStates.get(counter)
  return rendered ? { hasPlate: rendered.hasPlate, ingredientModels: [...rendered.ingredientModels] } : emptyContents()
}

export function placePlateOnCounter(counter: Entity): void {
  takeHeldItemPending()
  void room.send('placePlateOnCounter', { counterId: getFixtureSyncId(counter) })
  const { ingredientModels } = getRenderedContents(counter)
  renderCounter(counter, { hasPlate: true, ingredientModels })
}

// Pickups below deliberately don't render the hand optimistically — the
// server's grantHeldItem only fires if the pickup is legal, and
// heldItem.ts's reconciliation fills the hand once confirmed. Predicting
// it here would broadcast an unconditional setHeldItem regardless of
// success, which is how a losing player used to end up with a duplicate.

export function pickUpPlateFromCounter(counter: Entity): void {
  void room.send('pickUpPlateFromCounter', { counterId: getFixtureSyncId(counter) })
  const { ingredientModels } = getRenderedContents(counter)
  renderCounter(counter, { hasPlate: false, ingredientModels })
}

/** Picks up just the ingredient stack (as an assembled item) — the plate stays on the counter. */
export function pickUpFromCounter(counter: Entity): void {
  const { hasPlate, ingredientModels } = getRenderedContents(counter)
  void room.send('pickUpFromCounter', { counterId: getFixtureSyncId(counter) })
  renderCounter(counter, { hasPlate, ingredientModels: [] })
}

/** Places whatever's held — a single ingredient or an assembled stack — onto the counter's existing stack, on top of whatever's already there. */
export function placeOnCounter(counter: Entity): void {
  const models = takeHeldItemModelsPending()
  if (models.length === 0) return
  void room.send('placeOnCounter', { counterId: getFixtureSyncId(counter), models })
  const { hasPlate, ingredientModels } = getRenderedContents(counter)
  renderCounter(counter, { hasPlate, ingredientModels: [...ingredientModels, ...models] })
}

// --- Rendering: full rebuild whenever a counter's contents differ from what's rendered ---

function renderCounter(counter: Entity, contents: CounterContents): void {
  const rendered = renderedStates.get(counter) ?? emptyRenderedCounter()
  if (sameContents(rendered, contents)) return

  teardownVisuals(rendered)

  const newRendered: RenderedCounter = {
    hasPlate: contents.hasPlate,
    ingredientModels: [...contents.ingredientModels],
    plateEntity: null,
    ingredientEntities: []
  }

  let yOffset = 0
  if (contents.hasPlate) {
    newRendered.plateEntity = placeVisual(counter, MODELS.plate, yOffset)
    yOffset += getItemHeight(MODELS.plate)
  }
  for (const model of contents.ingredientModels) {
    newRendered.ingredientEntities.push(placeVisual(counter, model, yOffset))
    yOffset += getItemHeight(model)
  }

  renderedStates.set(counter, newRendered)
}

function teardownVisuals(rendered: RenderedCounter): void {
  if (rendered.plateEntity) engine.removeEntity(rendered.plateEntity)
  for (const entity of rendered.ingredientEntities) engine.removeEntity(entity)
}

function placeVisual(counter: Entity, model: string, yOffset: number): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(0, FIXTURE_HEIGHT + yOffset, 0), parent: counter })
  GltfContainer.create(entity, { src: model })
  return entity
}

function emptyRenderedCounter(): RenderedCounter {
  return { hasPlate: false, ingredientModels: [], plateEntity: null, ingredientEntities: [] }
}

function emptyContents(): CounterContents {
  return { hasPlate: false, ingredientModels: [] }
}

function sameContents(a: CounterContents, b: CounterContents): boolean {
  if (a.hasPlate !== b.hasPlate) return false
  if (a.ingredientModels.length !== b.ingredientModels.length) return false
  return a.ingredientModels.every((model, index) => model === b.ingredientModels[index])
}
