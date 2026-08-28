// Server entry point — dynamically imported from index.ts's isServer()
// branch so @dcl/sdk/server-touching code never reaches the client bundle.

import { initDeliveryCounter } from './fixtures/deliveryCounter'
import { initPreparationCounters } from './fixtures/preparationCounters'
import { initStoveCooking } from './fixtures/stoveCooking'
import { initHeldItems } from './heldItems'
import { initOrderQueue } from './orderQueue'
import { initPlayerCoins } from './playerCoins'
import { initPlayerRoster } from './playerRoster'

export function initServer(): void {
  initPlayerRoster()
  initPlayerCoins()
  initOrderQueue()
  initHeldItems()
  initPreparationCounters()
  initStoveCooking()
  initDeliveryCounter()
}
