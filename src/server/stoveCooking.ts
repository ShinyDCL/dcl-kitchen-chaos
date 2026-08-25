// Owns every stove's StoveState. Unlike heldItems.ts/preparationCounters.ts,
// this doesn't just relay whatever the client asserts: collecting a
// finished stove hands out a scarce item (the cooked result), so
// collectFromStove re-derives the outcome from the server's own state
// instead of trusting the client, and rejects a second collect against the
// same cook — resetting rawModel to '' before granting the item means a
// second, already-queued collect message for the same cook sees an idle
// stove and no-ops, which is what stops two players racing a finished
// stove from both walking away with a copy. Starting a cook is only
// rejected if the stove isn't actually idle or rawModel isn't a real
// cookable — there's nothing scarce to duplicate there, so that part does
// mirror the simpler relay pattern.
//
// Explicit sync id per stove, same reasoning as preparationCounters.ts:
// stoves are a small fixed set that exists for the scene's whole life, so
// no per-connection auto-alloc/match-by-field is needed.

import { engine, Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { getCookableItemDefinition } from '../shared/ingredients'
import { room } from '../shared/messages'
import { StoveState } from '../shared/schemas'
import { grantHeldItem } from './heldItems'

const stoveEntities = new Map<number, Entity>()

export function initStoveCooking(): void {
  reconcileStoveEntities()

  room.onMessage('startCookingOnStove', (data, context) => {
    if (!context) return
    const definition = getCookableItemDefinition(data.rawModel)
    if (!definition) return // not a real cookable — ignore

    const entity = getOrCreateStoveEntity(data.stoveId)
    const state = StoveState.getMutableOrNull(entity)
    if (!state || state.rawModel !== '') return // already cooking or done — ignore

    state.rawModel = data.rawModel
    state.startTimestamp = Date.now()
  })

  room.onMessage('collectFromStove', (data, context) => {
    if (!context) return
    const entity = stoveEntities.get(data.stoveId)
    if (entity === undefined) return

    const state = StoveState.getMutableOrNull(entity)
    if (!state || state.rawModel === '') return // idle — nothing to collect

    const definition = getCookableItemDefinition(state.rawModel)
    if (!definition) return // shouldn't happen — unknown rawModel

    const elapsedSeconds = (Date.now() - Number(state.startTimestamp)) / 1000
    if (elapsedSeconds < definition.cookDurationSeconds) return // not done yet — ignore

    state.rawModel = '' // reset first so a second, already-queued collect sees idle and no-ops
    grantHeldItem(context.from.toLowerCase(), [definition.cookedModel])
  })
}

function getOrCreateStoveEntity(stoveId: number): Entity {
  const cached = stoveEntities.get(stoveId)
  if (cached !== undefined && StoveState.getOrNull(cached) !== null) return cached

  const entity = engine.addEntity()
  StoveState.create(entity, { stoveId, rawModel: '', startTimestamp: 0 })
  syncEntity(entity, [StoveState.componentId], stoveId)
  stoveEntities.set(stoveId, entity)
  return entity
}

/** Re-adopts stove entities that may already exist in the CRDT snapshot from a previous server run. */
function reconcileStoveEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(StoveState)) {
    const [entityNumber] = EntityUtils.fromEntityId(entity)
    if (entityNumber < RESERVED_STATIC_ENTITIES) continue
    stoveEntities.set(data.stoveId, entity)
  }
}
