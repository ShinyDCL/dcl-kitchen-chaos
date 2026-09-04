// Owns every preparation counter's PreparationCounterState. Clients send a
// narrow intent (place an item, pick up the stack, ...) rather than a
// computed full snapshot, and each handler applies it atomically against
// the counter's own current state — see shared/messages.ts's comment for
// why: two clients computing "current state + my change" from the same
// stale snapshot and pushing the result wholesale is a lost-update race.
// Message handlers run one at a time, so concurrent intents for the same
// counter just apply in receipt order, each against the true latest state.
//
// Every handler grants/clears the held item itself via grantHeldItem,
// never trusting the client's own setHeldItem broadcast:
// - Pickups grant only on success, so two players racing the same stack
//   leaves the second with nothing left to take. Picking up the stack
//   takes everything on it, plate included — a plate is just whichever
//   model the player placed first, not a tracked precondition.
// - placeOnCounter places the player's real held item (heldItems.ts's
//   getHeldItemModels), not a client-claimed stack.
//
// Unlike per-player entities, counters are a small fixed set for the
// scene's whole life, so each uses an EXPLICIT sync id — its counterId,
// assigned deterministically by client/fixtures/fixtures.ts's getFixtureSyncId —
// rather than the per-player auto-allocate-and-match-by-field pattern.

import { engine, Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { PreparationCounterState } from '../../shared/schemas'
import { onPlayerAction } from '../players/activity'
import { getHeldItemModels, grantHeldItem } from '../players/heldItems'

const counterEntities = new Map<number, Entity>()

export function initPreparationCounters(): void {
  reconcileCounterEntities()

  onPlayerAction('pickUpFromCounter', (data, playerId) => {
    const state = getMutableState(data.counterId)
    if (!state || state.ingredientModels.length === 0) return // nothing to pick up — ignore
    const models = state.ingredientModels
    state.ingredientModels = []
    grantHeldItem(playerId, models)
  })

  onPlayerAction('placeOnCounter', (data, playerId) => {
    const heldModels = getHeldItemModels(playerId)
    const state = getMutableState(data.counterId)
    if (!state) return
    state.ingredientModels = [...state.ingredientModels, ...heldModels]
    grantHeldItem(playerId, [])
  })
}

function getMutableState(counterId: number) {
  return PreparationCounterState.getMutableOrNull(getOrCreateCounterEntity(counterId))
}

function getOrCreateCounterEntity(counterId: number): Entity {
  const cached = counterEntities.get(counterId)
  if (cached !== undefined && PreparationCounterState.getOrNull(cached) !== null) return cached

  const entity = engine.addEntity()
  PreparationCounterState.create(entity, { counterId, ingredientModels: [] })
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
