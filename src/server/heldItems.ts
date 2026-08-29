// Owns every player's HeldItem state. Clients never write this component
// directly (see shared/schemas.ts's validateBeforeChange) — setHeldItem is
// the only path in, and it's trusted outright: whatever `models` a client
// sends becomes their held item. No anti-cheat around this — small fun
// game, not worth the complexity.
//
// Per-player entity management is perPlayerSyncedStore.ts's shared pattern.

import { room } from '../shared/messages'
import { HeldItem } from '../shared/schemas'
import { createPerPlayerStore } from './perPlayerSyncedStore'
import { isPlayerAllowedToAct } from './playerRoster'

const store = createPerPlayerStore(HeldItem, (playerId) => ({ playerId, models: [] }))

export function initHeldItems(): void {
  store.reconcile()

  room.onMessage('setHeldItem', (data, context) => {
    if (!context || !isPlayerAllowedToAct(context.from)) return
    grantHeldItem(context.from.toLowerCase(), data.models)
  })
}

/** Sets a player's held item directly — used by other server modules that hand out an item as the result of a validated action (e.g. stoveCooking.ts's collectFromStove). */
export function grantHeldItem(playerId: string, models: string[]): void {
  const entity = store.getOrCreateEntity(playerId)
  const mutable = HeldItem.getMutableOrNull(entity)
  if (!mutable) return
  mutable.models = models
}

/** The player's actual held models — consumed by placeOnCounter/deliverHeldItem instead of a client-sent stack. */
export function getHeldItemModels(playerId: string): string[] {
  const entity = store.getEntity(playerId.toLowerCase())
  const models = entity !== undefined ? HeldItem.getOrNull(entity)?.models : undefined
  return models ? [...models] : []
}
