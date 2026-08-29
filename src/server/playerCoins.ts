// Owns every player's PlayerCoins balance. Session-only for now — no
// Storage persistence yet, that's a later phase. Per-player entity
// management is perPlayerSyncedStore.ts's shared pattern.

import { PlayerCoins } from '../shared/schemas'
import { createPerPlayerStore } from './perPlayerSyncedStore'

const store = createPerPlayerStore(PlayerCoins, (playerId) => ({ playerId, coins: 0 }))

export function initPlayerCoins(): void {
  store.reconcile()
}

/** Adds `amount` coins to each given player's balance — called by orderQueue.ts on a successful delivery. */
export function grantCoins(playerIds: string[], amount: number): void {
  for (const playerId of playerIds) {
    const entity = store.getOrCreateEntity(playerId.toLowerCase())
    const mutable = PlayerCoins.getMutableOrNull(entity)
    if (!mutable) continue
    mutable.coins += amount
  }
}
