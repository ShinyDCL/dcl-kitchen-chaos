// Owns the plate/ingredient state of each preparation counter and the
// visuals that represent it. Doesn't decide what's allowed — see
// interactionRules.ts for that. Every action function here assumes the
// caller already checked it's allowed.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { FIXTURE_HEIGHT } from './constants'
import { attachAssembledItemToPlayerHand, attachItemToPlayerHand, takeHeldItem, takeHeldItemModels } from './heldItem'
import { getItemHeight } from './itemHeights'
import { MODELS } from './models'

interface CounterState {
  plateEntity: Entity | null
  ingredientEntities: Entity[]
  ingredientModels: string[]
}

const counterStates = new Map<Entity, CounterState>()

function getState(counter: Entity): CounterState {
  let state = counterStates.get(counter)
  if (!state) {
    state = { plateEntity: null, ingredientEntities: [], ingredientModels: [] }
    counterStates.set(counter, state)
  }
  return state
}

export interface PreparationCounterSnapshot {
  hasPlate: boolean
  ingredientCount: number
}

export function getPreparationCounterSnapshot(counter: Entity): PreparationCounterSnapshot {
  const state = getState(counter)
  return { hasPlate: state.plateEntity !== null, ingredientCount: state.ingredientModels.length }
}

function currentStackHeight(state: CounterState): number {
  let height = state.plateEntity ? getItemHeight(MODELS.plate) : 0
  for (const model of state.ingredientModels) height += getItemHeight(model)
  return height
}

function placeVisual(counter: Entity, model: string, yOffset: number): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(0, FIXTURE_HEIGHT + yOffset, 0), parent: counter })
  GltfContainer.create(entity, { src: model })
  return entity
}

export function placePlateOnCounter(counter: Entity): void {
  takeHeldItem()
  const state = getState(counter)
  state.plateEntity = placeVisual(counter, MODELS.plate, 0)
}

export function pickUpPlateFromCounter(counter: Entity): void {
  const state = getState(counter)
  attachItemToPlayerHand(MODELS.plate)
  if (state.plateEntity) engine.removeEntity(state.plateEntity)
  state.plateEntity = null
}

export function pickUpAssembledFromCounter(counter: Entity): void {
  const state = getState(counter)
  attachAssembledItemToPlayerHand([...state.ingredientModels])
  for (const entity of state.ingredientEntities) engine.removeEntity(entity)
  state.ingredientEntities = []
  state.ingredientModels = []
}

function appendIngredients(counter: Entity, state: CounterState, models: string[]): void {
  let yOffset = currentStackHeight(state)
  for (const model of models) {
    const entity = placeVisual(counter, model, yOffset)
    state.ingredientEntities.push(entity)
    state.ingredientModels.push(model)
    yOffset += getItemHeight(model)
  }
}

export function placeIngredientOnCounter(counter: Entity): void {
  const placedModel = takeHeldItem()
  if (!placedModel) return
  appendIngredients(counter, getState(counter), [placedModel])
}

/** Places every item from a held assembled stack onto the counter's existing stack, on top of whatever's already there. */
export function placeAssembledOnCounter(counter: Entity): void {
  const models = takeHeldItemModels()
  if (models.length === 0) return
  appendIngredients(counter, getState(counter), models)
}
