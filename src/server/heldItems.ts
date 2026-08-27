// Owns every player's HeldItem state. Clients never write this component
// directly (see shared/schemas.ts's validateBeforeChange) — setHeldItem is
// the only path in, and it's trusted outright: whatever `models` a client
// sends becomes their held item, with no check that they're real,
// obtainable models. placeOnCounter/deliverHeldItem verify against
// getHeldItemModels below instead of trusting a client's claim directly —
// but since that claim is checked against THIS record, a client that
// forges its own HeldItem via setHeldItem first would still pass. Closing
// that needs setHeldItem itself to validate against fixture state, not
// done yet.
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
import { isPlayerAllowedToAct } from './playerRoster'

const playerEntities = new Map<string, Entity>()

export function initHeldItems(): void {
  reconcilePlayerEntities()

  room.onMessage('setHeldItem', (data, context) => {
    if (!context || !isPlayerAllowedToAct(context.from)) return
    grantHeldItem(context.from.toLowerCase(), data.models)
  })
}

/** Sets a player's held item directly — used by other server modules that hand out an item as the result of a validated action (e.g. stoveCooking.ts's collectFromStove). */
export function grantHeldItem(playerId: string, models: string[]): void {
  const entity = getOrCreatePlayerEntity(playerId)
  const mutable = HeldItem.getMutableOrNull(entity)
  if (!mutable) return
  mutable.models = models
}

/** The player's actual server-held models — used to verify a client's claimed models before consuming them as a real item (placeOnCounter, deliverHeldItem), rather than trusting the claim outright. */
export function getHeldItemModels(playerId: string): string[] {
  const entity = playerEntities.get(playerId.toLowerCase())
  const models = entity !== undefined ? HeldItem.getOrNull(entity)?.models : undefined
  return models ? [...models] : []
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
