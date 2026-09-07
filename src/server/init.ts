// Server entry point — dynamically imported from index.ts's isServer()
// branch so @dcl/sdk/server-touching code never reaches the client bundle.
//
// Each subsystem starts in isolation: without this, one throw (a Storage
// hiccup, a bad stored value) skips every later init AND rejects main(),
// taking down the whole scene — including gameState's heartbeat, which
// leaves every client stuck on the loading panel. A failed subsystem is
// logged and the rest still runs.

import { initDeliveryCounter } from './fixtures/deliveryCounter'
import { initPreparationCounters } from './fixtures/preparationCounter'
import { initStoves } from './fixtures/stove'
import { initGameState } from './gameState'
import { initPlayerActivity } from './players/activity'
import { initPlayerCoins } from './players/coins'
import { initHeldItems } from './players/heldItems'
import { initPlayers } from './players/presence'
import { initDeliveryStats } from './progression/deliveryStats'
import { initLeaderboard } from './progression/leaderboard'
import { initOrderQueue } from './progression/orderQueue'
import { initSession } from './session'

export function initServer(): void {
  start('players', initPlayers) // registers the lifecycle events others hook
  start('gameState', initGameState) // owns GameState, which the rest write into
  start('playerActivity', initPlayerActivity)
  start('deliveryStats', initDeliveryStats)
  start('leaderboard', initLeaderboard) // before playerCoins — it records into the board as totals load
  start('playerCoins', initPlayerCoins)
  start('orderQueue', initOrderQueue)
  start('heldItems', initHeldItems)
  start('preparationCounters', initPreparationCounters)
  start('stoves', initStoves)
  start('deliveryCounter', initDeliveryCounter)
  start('session', initSession) // last — everything above registers its reset with it
}

/** Needs logsPermissions in scene.json to be readable in production — see the authoritative-server skill. */
function start(name: string, init: () => void): void {
  try {
    init()
  } catch (error) {
    console.error(`[server] ${name} failed to start:`, error)
  }
}
