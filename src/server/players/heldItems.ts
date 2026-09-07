// Owns every player's HeldItem state. Clients never write this component
// directly (see shared/schemas.ts's validateBeforeChange) — setHeldItem is
// the only path in, and it's trusted outright: whatever `models` a client
// sends becomes their held item. No anti-cheat around this — small fun
// game, not worth the complexity.
//
// Per-player entity management is perPlayerSyncedStore.ts's shared pattern.

import { HeldItem } from '../../shared/schemas'
import { onSessionEnd, onSessionStart } from '../session'
import { onPlayerAction } from './activity'
import { getConnectedPlayerIds } from './presence'
import { createPerPlayerStore } from './syncedStore'

const store = createPerPlayerStore(HeldItem, (playerId) => ({ playerId, models: [] }))

export function initHeldItems(): void {
  store.reconcile()

  // Nobody starts a session holding last session's burger. Blanked rather
  // than removed: a session starts because someone just walked in, and a
  // client ignores its own entity disappearing — it reads the same as an
  // unsynced local prediction — so removal would leave them holding a ghost.
  //
  // Keyed on who is connected rather than on what the store still tracks:
  // the previous session end removed those entities, so there may be nothing
  // tracked to blank while a returning player is still rendering an item.
  // resetAll then mops up entities adopted from a snapshot after a restart.
  onSessionStart(() => {
    for (const playerId of getConnectedPlayerIds()) grantHeldItem(playerId, [])
    store.resetAll()
  })

  // Safe here and only here — the scene is empty, so nobody is left rendering
  // an item whose entity just vanished.
  onSessionEnd(() => store.clear())

  onPlayerAction('setHeldItem', (data, playerId) => {
    grantHeldItem(playerId, data.models)
  })
}

/** Sets a player's held item directly — used by other server modules that hand out an item as the result of a validated action (e.g. stove.ts's collectFromStove). */
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
