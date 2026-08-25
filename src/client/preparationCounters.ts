// Owns the visuals for each preparation counter, reconciled against the
// server-synced PreparationCounterState (shared/schemas.ts) rather than
// held as local truth — see the authoritative-server skill. Doesn't decide
// what's allowed — see interactionRules.ts for that. Every action function
// here assumes the caller already checked it's allowed.
//
// Each action function does two things: sends the counter's new full
// contents to the server via setPreparationCounterState, and rebuilds this
// client's own visuals immediately, for zero-latency feedback (see
// applyLocally). A single reconciliation system, started by
// startRenderingPreparationCounters, compares every registered counter's
// synced state against what's currently rendered and rebuilds on any
// mismatch — for the acting client this is normally a same-state no-op,
// but it's what makes the counter visible to every OTHER player once their
// update arrives, and what corrects this client's own guess if two
// players' actions on the same counter race (the server's version wins).

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

/** Registers a preparation counter fixture so its state gets rendered and reconciled. Call once per counter during scene setup. */
export function registerPreparationCounter(counter: Entity): void {
  registeredCounters.push(counter)
  renderedStates.set(counter, emptyRenderedCounter())
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
    renderCounter(counter, getSyncedContents(counter))
  }
}

export interface PreparationCounterSnapshot {
  hasPlate: boolean
  ingredientCount: number
}

export function getPreparationCounterSnapshot(counter: Entity): PreparationCounterSnapshot {
  const { hasPlate, ingredientModels } = getSyncedContents(counter)
  return { hasPlate, ingredientCount: ingredientModels.length }
}

function getSyncedContents(counter: Entity): CounterContents {
  const counterId = getFixtureSyncId(counter)
  for (const [, data] of engine.getEntitiesWith(PreparationCounterState)) {
    if (data.counterId === counterId) return { hasPlate: data.hasPlate, ingredientModels: [...data.ingredientModels] }
  }
  return { hasPlate: false, ingredientModels: [] }
}

/** Sends the new contents to the server and rebuilds this client's own visuals immediately, ahead of the round trip. */
function applyLocally(counter: Entity, contents: CounterContents): void {
  void room.send('setPreparationCounterState', { counterId: getFixtureSyncId(counter), ...contents })
  renderCounter(counter, contents)
}

export function placePlateOnCounter(counter: Entity): void {
  takeHeldItem()
  const { ingredientModels } = getSyncedContents(counter)
  applyLocally(counter, { hasPlate: true, ingredientModels })
}

export function pickUpPlateFromCounter(counter: Entity): void {
  attachItemToPlayerHand(MODELS.plate)
  const { ingredientModels } = getSyncedContents(counter)
  applyLocally(counter, { hasPlate: false, ingredientModels })
}

/** Picks up just the ingredient stack as an assembled item — the plate stays on the counter. */
export function pickUpAssembledFromCounter(counter: Entity): void {
  const { hasPlate, ingredientModels } = getSyncedContents(counter)
  attachAssembledItemToPlayerHand(ingredientModels)
  applyLocally(counter, { hasPlate, ingredientModels: [] })
}

export function placeIngredientOnCounter(counter: Entity): void {
  const placedModel = takeHeldItem()
  if (!placedModel) return
  const { hasPlate, ingredientModels } = getSyncedContents(counter)
  applyLocally(counter, { hasPlate, ingredientModels: [...ingredientModels, placedModel] })
}

/** Places every item from a held assembled stack onto the counter's existing stack, on top of whatever's already there. */
export function placeAssembledOnCounter(counter: Entity): void {
  const models = takeHeldItemModels()
  if (models.length === 0) return
  const { hasPlate, ingredientModels } = getSyncedContents(counter)
  applyLocally(counter, { hasPlate, ingredientModels: [...ingredientModels, ...models] })
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

function sameContents(a: CounterContents, b: CounterContents): boolean {
  if (a.hasPlate !== b.hasPlate) return false
  if (a.ingredientModels.length !== b.ingredientModels.length) return false
  return a.ingredientModels.every((model, index) => model === b.ingredientModels[index])
}
