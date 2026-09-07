// Owns the successful-delivery count behind GameState.deliveries —
// how many orders this session's team has served, cleared with everything
// else when a new one starts (session.ts).
//
// Nothing here is persisted, unlike coins.ts and leaderboard.ts. Those are
// the long game; this is a live readout of the current service, and a count
// that survived restarts would be a scene statistic sitting on the same
// in-world panel as a session-scoped level.

import { getGameStateMutable } from '../gameState'
import { onSessionStart } from '../session'

let delivered = 0

export function initDeliveryStats(): void {
  onSessionStart(() => {
    delivered = 0
    publish()
  })
}

/** Counts one successful delivery — called by orderQueue.ts's evaluateDelivery on a match. */
export function recordDelivery(): void {
  delivered += 1
  publish()
}

function publish(): void {
  const gameState = getGameStateMutable()
  if (gameState && gameState.deliveries !== delivered) gameState.deliveries = delivered
}
