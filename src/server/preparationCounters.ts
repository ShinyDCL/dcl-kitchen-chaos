// Owns every preparation counter's PreparationCounterState. Clients send a
// narrow intent (place a plate, pick up the ingredient stack, place this
// ingredient, ...) rather than a computed full snapshot, and each handler
// applies it atomically against the counter's own current state — see
// shared/messages.ts's comment for why: two clients computing "current
// state + my change" from the same stale synced snapshot and pushing the
// result wholesale is a lost-update race whenever they touch the same
// counter close together. Message handlers run one at a time, so two
// concurrent intents for the same counter are simply applied in the order
// the server receives them, each building on the true latest state.
//
// Pickups grant the item directly via heldItems.ts's grantHeldItem (like
// stoveCooking.ts's collectFromStove) rather than trusting the requesting
// client's own setHeldItem broadcast — for the same reason: two players
// both trying to pick up the same stack at once must result in only one of
// them actually getting it, which falls out for free here since the first
// message processed empties the counter and the second then finds nothing
// left to pick up.
//
// Unlike per-player entities, preparation counters are a small fixed set
// that exists for the scene's whole life, so each uses an EXPLICIT sync id
// — its counterId, assigned deterministically by client/fixtures.ts's
// getFixtureSyncId (every client builds the scene in the same order, so
// the same counter gets the same id everywhere) — rather than the
// per-player auto-allocate-and-match-by-field pattern.

import { engine, Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { room } from '../shared/messages'
import { MODELS } from '../shared/models'
import { PreparationCounterState } from '../shared/schemas'
import { grantHeldItem } from './heldItems'

const counterEntities = new Map<number, Entity>()

export function initPreparationCounters(): void {
  reconcileCounterEntities()

  room.onMessage('placePlateOnCounter', (data) => {
    const state = getMutableState(data.counterId)
    if (!state || state.hasPlate) return // already has a plate — ignore
    state.hasPlate = true
  })

  room.onMessage('pickUpPlateFromCounter', (data, context) => {
    if (!context) return
    const state = getMutableState(data.counterId)
    if (!state || !state.hasPlate) return // no plate to pick up — ignore
    state.hasPlate = false
    grantHeldItem(context.from.toLowerCase(), [MODELS.plate])
  })

  room.onMessage('pickUpAssembledFromCounter', (data, context) => {
    if (!context) return
    const state = getMutableState(data.counterId)
    if (!state || state.ingredientModels.length === 0) return // nothing to pick up — ignore
    const models = state.ingredientModels
    state.ingredientModels = []
    grantHeldItem(context.from.toLowerCase(), models)
  })

  room.onMessage('placeIngredientOnCounter', (data) => {
    const state = getMutableState(data.counterId)
    if (!state) return
    state.ingredientModels = [...state.ingredientModels, data.model]
  })

  room.onMessage('placeAssembledOnCounter', (data) => {
    const state = getMutableState(data.counterId)
    if (!state) return
    state.ingredientModels = [...state.ingredientModels, ...data.models]
  })
}

function getMutableState(counterId: number) {
  return PreparationCounterState.getMutableOrNull(getOrCreateCounterEntity(counterId))
}

function getOrCreateCounterEntity(counterId: number): Entity {
  const cached = counterEntities.get(counterId)
  if (cached !== undefined && PreparationCounterState.getOrNull(cached) !== null) return cached

  const entity = engine.addEntity()
  PreparationCounterState.create(entity, { counterId, hasPlate: false, ingredientModels: [] })
  syncEntity(entity, [PreparationCounterState.componentId], counterId)
  counterEntities.set(counterId, entity)
  return entity
}

/** Re-adopts counter entities that may already exist in the CRDT snapshot from a previous server run. */
function reconcileCounterEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(PreparationCounterState)) {
    const [entityNumber] = EntityUtils.fromEntityId(entity)
    if (entityNumber < RESERVED_STATIC_ENTITIES) continue
    counterEntities.set(data.counterId, entity)
  }
}
