// Owns every player's HeldItem state. Clients never write this component
// directly (see shared/schemas.ts's validateBeforeChange) — they send a
// setHeldItem message with their new hand contents, and this is the only
// place that turns that into the synced state everyone renders from. The
// server doesn't validate WHICH model is legal to hold yet — that needs
// fixture state (counters/stove) to be server-owned too, which isn't built
// yet — so for now this only guarantees the state itself is trustworthy,
// not that every pickup was a legal game action.
//
// One HeldItem entity per player, matched by the playerId field rather
// than by network id — see the authoritative-server skill's per-player
// synced entity pattern for why an explicit/hashed sync id is unsafe on a
// long-running server (address collisions, reconnect races, stale handles
// after entity-slot recycling).

import { engine, Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { room } from '../shared/messages'
import { HeldItem } from '../shared/schemas'

const playerEntities = new Map<string, Entity>()

export function initHeldItems(): void {
  reconcilePlayerEntities()

  room.onMessage('setHeldItem', (data, context) => {
    if (!context) return
    const entity = getOrCreatePlayerEntity(context.from.toLowerCase())
    const mutable = HeldItem.getMutableOrNull(entity)
    if (!mutable) return
    mutable.models = data.models
  })
}

function getOrCreatePlayerEntity(playerId: string): Entity {
  const cached = playerEntities.get(playerId)
  if (cached !== undefined && HeldItem.getOrNull(cached) !== null) return cached
  if (cached !== undefined) {
    playerEntities.delete(playerId)
    try {
      engine.removeEntity(cached)
    } catch {
      // already gone
    }
  }

  const entity = engine.addEntity()
  HeldItem.create(entity, { playerId, models: [] })
  syncEntity(entity, [HeldItem.componentId]) // no explicit id — auto-allocated, identity lives in playerId
  playerEntities.set(playerId, entity)
  return entity
}

/** Re-adopts HeldItem entities that may already exist in the CRDT snapshot from a previous server run. */
function reconcilePlayerEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(HeldItem)) {
    const [entityNumber] = EntityUtils.fromEntityId(entity)
    if (entityNumber < RESERVED_STATIC_ENTITIES) continue // runtime/avatar-owned — never adopt or remove these
    const playerId = data.playerId.toLowerCase()
    const existing = playerEntities.get(playerId)
    if (existing === undefined) {
      playerEntities.set(playerId, entity)
    } else if (existing !== entity) {
      engine.removeEntity(entity)
    }
  }
}
