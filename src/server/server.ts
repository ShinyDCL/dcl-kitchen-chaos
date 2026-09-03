// Server entry point — dynamically imported from index.ts's isServer()
// branch so @dcl/sdk/server-touching code never reaches the client bundle.

import { initDeliveryCounter } from './fixtures/deliveryCounter'
import { initPreparationCounters } from './fixtures/preparationCounters'
import { initStoveCooking } from './fixtures/stoveCooking'
import { initDeliveryStats } from './deliveryStats'
import { initHeldItems } from './heldItems'
import { initLeaderboard } from './leaderboard'
import { initOrderQueue } from './orderQueue'
import { initPlayerCoins } from './playerCoins'
import { initPlayerRoster } from './playerRoster'

export function initServer(): void {
  initPlayerRoster() // owns GameState, which deliveryStats writes into
  initDeliveryStats()
  initLeaderboard() // before playerCoins — it records into the board as totals load
  initPlayerCoins()
  initOrderQueue()
  initHeldItems()
  initPreparationCounters()
  initStoveCooking()
  initDeliveryCounter()
}
