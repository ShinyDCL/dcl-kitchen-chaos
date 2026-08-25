// Owns the visuals for each preparation counter, reconciled against the
// server-synced PreparationCounterState (shared/schemas.ts) rather than
// held as local truth — see the authoritative-server skill. Doesn't decide
// what's allowed — see interactionRules.ts for that. Every action function
// here assumes the caller already checked it's allowed.
//
// Each action function does two things: sends a narrow intent to the
// server (place a plate, pick up the ingredient stack, place this
// ingredient, ...) and rebuilds this client's own visuals immediately, for
// zero-latency feedback. The intent is deliberately NOT the counter's
// whole computed new state — the server applies each intent atomically
// against its own live state (see server/preparationCounters.ts), which is
// what lets two players place different ingredients on the same counter at
// the same time and have both stick, instead of whichever client's
// computed-full-state push lands last silently discarding the other's.
// A single reconciliation system, started by
// startRenderingPreparationCounters, is what makes the counter visible to
// every OTHER player, and what folds in whatever else changed concurrently
// (another player's own addition, a lost pickup race) that this client's
// local prediction couldn't have known about yet.
//
// It only reacts when the synced state itself has changed since the last
// frame it was observed (lastSyncedStates) — NOT whenever it merely
// differs from what's currently rendered. Right after this client's own
// optimistic render, the synced read is briefly stale (the server hasn't
// processed the intent yet), which would otherwise look identical to a
// real mismatch and cause a spurious revert-then-reapply flicker: the
// still-stale read reverts the optimistic visual, then the real update
// lands a moment later and reapplies it. Gating on an actual change in the
// synced value means a merely-stale read is a no-op, and once the real
// update does arrive it's compared against the (usually already-matching)
// local prediction inside renderCounter, so nothing visibly rebuilds at
// all in the common, uncontested case.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { FIXTURE_HEIGHT } from '../shared/constants'
import { room } from '../shared/messages'
import { MODELS } from '../shared/models'
import { PreparationCounterState } from '../shared/schemas'
import { getFixtureSyncId } from './fixtures'
import { attachAssembledItemToPlayerHand, attachItemToPlayerHand, takeHeldItem, takeHeldItemModels } from './heldItem'
import { getItemHeight } from './itemHeights'

interface CounterContents {
  hasPlate: boolean
  ingredientModels: string[]
}

interface RenderedCounter extends CounterContents {
  plateEntity: Entity | null
  ingredientEntities: Entity[]
}

const registeredCounters: Entity[] = []
const renderedStates = new Map<Entity, RenderedCounter>()
const lastSyncedStates = new Map<Entity, CounterContents>()

/** Registers a preparation counter fixture so its state gets rendered and reconciled. Call once per counter during scene setup. */
export function registerPreparationCounter(counter: Entity): void {
  registeredCounters.push(counter)
  renderedStates.set(counter, emptyRenderedCounter())
  lastSyncedStates.set(counter, emptyContents())
}

/** Reconciles every registered counter's synced state against what's currently rendered. Call once during client setup. */
export function startRenderingPreparationCounters(): void {
  if (reconcileSystemRegistered) return
  engine.addSystem(reconcileCountersSystem)
  reconcileSystemRegistered = true
}

let reconcileSystemRegistered = false

function reconcileCountersSystem(): void {
  for (const counter of registeredCounters) {
    const synced = getSyncedContents(counter)
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
 * (interactionRules.ts, which drives the focus highlight's color/message) —
 * from renderedStates, this client's current belief, NOT a raw live poll of
 * the synced component. Right after this client's own optimistic action, a
 * raw poll is briefly stale (the server hasn't processed the intent yet);
 * evaluating "is placing/picking up allowed" against that stale snapshot
 * instead of the already-updated prediction is what caused the highlight
 * to flip allowed/disallowed (and its message) for a moment after placing
 * or picking something up, until the real update caught up.
 */
export function getPreparationCounterSnapshot(counter: Entity): PreparationCounterSnapshot {
  const { hasPlate, ingredientModels } = getRenderedContents(counter)
  return { hasPlate, ingredientCount: ingredientModels.length }
}

function getRenderedContents(counter: Entity): CounterContents {
  const rendered = renderedStates.get(counter)
  return rendered ? { hasPlate: rendered.hasPlate, ingredientModels: [...rendered.ingredientModels] } : emptyContents()
}

function getSyncedContents(counter: Entity): CounterContents {
  const counterId = getFixtureSyncId(counter)
  for (const [, data] of engine.getEntitiesWith(PreparationCounterState)) {
    if (data.counterId === counterId) return { hasPlate: data.hasPlate, ingredientModels: [...data.ingredientModels] }
  }
  return { hasPlate: false, ingredientModels: [] }
}

export function placePlateOnCounter(counter: Entity): void {
  takeHeldItem()
  void room.send('placePlateOnCounter', { counterId: getFixtureSyncId(counter) })
  const { ingredientModels } = getRenderedContents(counter)
  renderCounter(counter, { hasPlate: true, ingredientModels })
}

export function pickUpPlateFromCounter(counter: Entity): void {
  attachItemToPlayerHand(MODELS.plate)
  void room.send('pickUpPlateFromCounter', { counterId: getFixtureSyncId(counter) })
  const { ingredientModels } = getRenderedContents(counter)
  renderCounter(counter, { hasPlate: false, ingredientModels })
}

/** Picks up just the ingredient stack as an assembled item — the plate stays on the counter. */
export function pickUpAssembledFromCounter(counter: Entity): void {
  const { hasPlate, ingredientModels } = getRenderedContents(counter)
  attachAssembledItemToPlayerHand(ingredientModels)
  void room.send('pickUpAssembledFromCounter', { counterId: getFixtureSyncId(counter) })
  renderCounter(counter, { hasPlate, ingredientModels: [] })
}

export function placeIngredientOnCounter(counter: Entity): void {
  const placedModel = takeHeldItem()
  if (!placedModel) return
  void room.send('placeIngredientOnCounter', { counterId: getFixtureSyncId(counter), model: placedModel })
  const { hasPlate, ingredientModels } = getRenderedContents(counter)
  renderCounter(counter, { hasPlate, ingredientModels: [...ingredientModels, placedModel] })
}

/** Places every item from a held assembled stack onto the counter's existing stack, on top of whatever's already there. */
export function placeAssembledOnCounter(counter: Entity): void {
  const models = takeHeldItemModels()
  if (models.length === 0) return
  void room.send('placeAssembledOnCounter', { counterId: getFixtureSyncId(counter), models })
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
