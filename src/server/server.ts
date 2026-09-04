// Server entry point — dynamically imported from index.ts's isServer()
// branch so @dcl/sdk/server-touching code never reaches the client bundle.
//
// Each subsystem starts in isolation: without this, one throw (a Storage
// hiccup, a bad stored value) skips every later init AND rejects main(),
// taking down the whole scene — including playerRoster's heartbeat, which
// leaves every client stuck on serverLoadingUi's "Loading...". A failed
// subsystem is logged and the rest still runs.

import { initDeliveryStats } from './deliveryStats'
import { initDeliveryCounter } from './fixtures/deliveryCounter'
import { initPreparationCounters } from './fixtures/preparationCounters'
import { initStoveCooking } from './fixtures/stoveCooking'
import { initHeldItems } from './heldItems'
import { initLeaderboard } from './leaderboard'
import { initOrderQueue } from './orderQueue'
import { initPlayerActivity } from './playerActivity'
import { initPlayerCoins } from './playerCoins'
import { initPlayerRoster } from './playerRoster'

export function initServer(): void {
  start('playerRoster', initPlayerRoster) // owns GameState and the player lifecycle events others hook
  start('playerActivity', initPlayerActivity)
  start('deliveryStats', initDeliveryStats)
  start('leaderboard', initLeaderboard) // before playerCoins — it records into the board as totals load
  start('playerCoins', initPlayerCoins)
  start('orderQueue', initOrderQueue)
  start('heldItems', initHeldItems)
  start('preparationCounters', initPreparationCounters)
  start('stoveCooking', initStoveCooking)
  start('deliveryCounter', initDeliveryCounter)
}

/** Needs logsPermissions in scene.json to be readable in production — see the authoritative-server skill. */
function start(name: string, init: () => void): void {
  try {
    init()
  } catch (error) {
    console.error(`[server] ${name} failed to start:`, error)
  }
}
