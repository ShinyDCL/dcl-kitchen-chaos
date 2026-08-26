// Server entry point — dynamically imported from index.ts's isServer()
// branch so @dcl/sdk/server-touching code never reaches the client bundle.

import { initDeliveryCounter } from './deliveryCounter'
import { initHeldItems } from './heldItems'
import { initPlayerCoins } from './playerCoins'
import { initPlayerRoster } from './playerRoster'
import { initPreparationCounters } from './preparationCounters'
import { initRecipeQueue } from './recipeQueue'
import { initStoveCooking } from './stoveCooking'

export function initServer(): void {
  initPlayerRoster()
  initPlayerCoins()
  initRecipeQueue()
  initHeldItems()
  initPreparationCounters()
  initStoveCooking()
  initDeliveryCounter()
}
