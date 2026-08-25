// Owns every preparation counter's PreparationCounterState. Clients never
// write this component directly (see shared/schemas.ts's
// validateBeforeChange) — they send the counter's new full contents via
// setPreparationCounterState after deciding locally what changed (see
// client/preparationCounters.ts), and this just relays that into the
// synced state everyone renders from. Like server/heldItems.ts, this
// doesn't re-validate that the claimed transition was legal yet.
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
import { PreparationCounterState } from '../shared/schemas'

const counterEntities = new Map<number, Entity>()

export function initPreparationCounters(): void {
  reconcileCounterEntities()

  room.onMessage('setPreparationCounterState', (data, context) => {
    if (!context) return
    const entity = getOrCreateCounterEntity(data.counterId)
    const mutable = PreparationCounterState.getMutableOrNull(entity)
    if (!mutable) return
    mutable.hasPlate = data.hasPlate
    mutable.ingredientModels = data.ingredientModels
  })
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
