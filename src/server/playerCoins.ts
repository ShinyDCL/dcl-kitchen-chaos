// Owns every player's PlayerCoins balance. Session-only for now — no
// Storage persistence yet, that's a later phase. One entity per player,
// matched by the `playerId` field, same auto-alloc pattern as
// heldItems.ts/playerRoster.ts.

import { engine, Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { PlayerCoins } from '../shared/schemas'

const playerEntities = new Map<string, Entity>()

export function initPlayerCoins(): void {
  reconcilePlayerEntities()
}

/** Adds `amount` coins to each given player's balance — called by orderQueue.ts on a successful delivery. */
export function grantCoins(playerIds: string[], amount: number): void {
  for (const playerId of playerIds) {
    const entity = getOrCreatePlayerEntity(playerId.toLowerCase())
    const mutable = PlayerCoins.getMutableOrNull(entity)
    if (!mutable) continue
    mutable.coins += amount
  }
}

function getOrCreatePlayerEntity(playerId: string): Entity {
  const cached = playerEntities.get(playerId)
  if (cached !== undefined && PlayerCoins.getOrNull(cached) !== null) return cached
  if (cached !== undefined) {
    playerEntities.delete(playerId)
    try {
      engine.removeEntity(cached)
    } catch {
      // already gone
    }
  }

  const entity = engine.addEntity()
  PlayerCoins.create(entity, { playerId, coins: 0 })
  syncEntity(entity, [PlayerCoins.componentId]) // no explicit id — auto-allocated, identity lives in playerId
  playerEntities.set(playerId, entity)
  return entity
}

/** Re-adopts PlayerCoins entities that may already exist in the CRDT snapshot from a previous server run. */
function reconcilePlayerEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(PlayerCoins)) {
    const [entityNumber] = EntityUtils.fromEntityId(entity)
    if (entityNumber < RESERVED_STATIC_ENTITIES) continue
    const playerId = data.playerId.toLowerCase()
    const existing = playerEntities.get(playerId)
    if (existing === undefined) {
      playerEntities.set(playerId, entity)
    } else if (existing !== entity) {
      engine.removeEntity(entity)
    }
  }
}
