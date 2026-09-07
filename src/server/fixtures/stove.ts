// Owns every stove's StoveState. Unlike heldItems.ts/preparationCounter.ts,
// collectFromStove re-derives the outcome from the server's own state
// rather than trusting the client, since it hands out a scarce cooked
// item: resetting rawModel to '' before granting it means a second,
// already-queued collect for the same cook sees an idle stove and no-ops
// — what stops two players racing a finished stove from both winning.
// Collecting past BURN_GRACE_SECONDS after done grants the universal
// burnt model instead of the real cookedModel — same "done" gate, no
// separate stored flag, since it's derived from elapsed time either way.
//
// startCookingOnStove grants the empty hand only once the cook actually
// starts, replying actionRejected otherwise so the client restores what it
// took out — see heldItem.ts's takeHeldItemPending.
//
// Explicit sync id per stove, same reasoning as preparationCounter.ts:
// stoves are a small fixed set for the scene's whole life, so no
// per-connection auto-alloc/match-by-field is needed.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { BURN_GRACE_SECONDS } from '../../shared/constants'
import { getCookableItemDefinition } from '../../shared/ingredients'
import { room } from '../../shared/messages'
import { MODELS } from '../../shared/models'
import { StoveState } from '../../shared/schemas'
import { isAdoptableEntity } from '../entityAdoption'
import { onPlayerAction } from '../players/activity'
import { grantHeldItem } from '../players/heldItems'
import { onSessionStart } from '../session'

const stoveEntities = new Map<number, Entity>()

export function initStoves(): void {
  reconcileStoveEntities()

  // Back to idle — a new session doesn't inherit the last one's cooking,
  // which after any real gap would be burnt anyway.
  onSessionStart(() => {
    for (const [, entity] of stoveEntities) {
      const state = StoveState.getMutableOrNull(entity)
      if (!state) continue
      state.rawModel = ''
      state.startTimestamp = 0
    }
  })

  onPlayerAction('startCookingOnStove', (data, playerId, address) => {
    const definition = getCookableItemDefinition(data.rawModel)
    if (!definition) {
      void room.send('actionRejected', {}, { to: [address] }) // not a real cookable
      return
    }

    const entity = getOrCreateStoveEntity(data.stoveId)
    const state = StoveState.getMutableOrNull(entity)
    if (!state || state.rawModel !== '') {
      void room.send('actionRejected', {}, { to: [address] }) // already cooking or done
      return
    }

    state.rawModel = data.rawModel
    state.startTimestamp = Date.now()
    grantHeldItem(playerId, [])
  })

  onPlayerAction('collectFromStove', (data, playerId) => {
    const entity = stoveEntities.get(data.stoveId)
    if (entity === undefined) return

    const state = StoveState.getMutableOrNull(entity)
    if (!state || state.rawModel === '') return // idle — nothing to collect

    const definition = getCookableItemDefinition(state.rawModel)
    if (!definition) return // shouldn't happen — unknown rawModel

    const elapsedSeconds = (Date.now() - Number(state.startTimestamp)) / 1000
    if (elapsedSeconds < definition.cookDurationSeconds) return // not done yet — ignore

    const isBurnt = elapsedSeconds >= definition.cookDurationSeconds + BURN_GRACE_SECONDS
    state.rawModel = '' // reset first so a second, already-queued collect sees idle and no-ops
    grantHeldItem(playerId, [isBurnt ? MODELS.burntCookable : definition.cookedModel])
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
    if (!isAdoptableEntity(entity)) continue
    stoveEntities.set(data.stoveId, entity)
  }
}
