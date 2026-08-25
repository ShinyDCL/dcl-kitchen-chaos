// Server entry point — dynamically imported from index.ts's isServer()
// branch so @dcl/sdk/server-touching code never reaches the client bundle.

import { initHeldItems } from './heldItems'
import { initPreparationCounters } from './preparationCounters'

export function initServer(): void {
  initHeldItems()
  initPreparationCounters()
}
