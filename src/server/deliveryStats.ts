// Owns the all-time successful-delivery count behind
// GameState.totalDeliveredOrders. Unlike GameState.streak it only grows and
// survives restarts. Scene Storage, since it's one scene-wide figure;
// persisted on change (see storageWrite.ts).

import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'

import { getGameStateMutable } from './playerRoster'
import { persist } from './storageWrite'

const STORAGE_KEY = 'totalDeliveredOrders'

let total = 0
let loaded = false
let pendingIncrements = 0 // deliveries banked before the stored total arrived

export function initDeliveryStats(): void {
  void loadStoredTotal()
}

/** Counts one successful delivery — called by orderQueue.ts's evaluateDelivery on a match. */
export function recordDelivery(): void {
  if (!loaded) {
    pendingIncrements += 1 // bank it rather than counting up from a 0 the load would overwrite
    return
  }

  total += 1
  publish()
  persistTotal()
}

function publish(): void {
  const gameState = getGameStateMutable()
  if (gameState && gameState.totalDeliveredOrders !== total) gameState.totalDeliveredOrders = total
}

/** The whole count, so a dropped write is healed by the next delivery's. */
function persistTotal(): void {
  persist('deliveryStats', () => Storage.set(STORAGE_KEY, String(total)))
}

async function loadStoredTotal(): Promise<void> {
  let raw: string | null
  try {
    raw = (await Storage.get<string>(STORAGE_KEY)) ?? null
  } catch {
    // Never persist without having read first, or the stored count would be
    // overwritten with roughly zero. Storage.get only throws on setup errors
    // (it returns null for both "absent" and a failed fetch), so retrying
    // wouldn't help — stay unloaded and bank deliveries instead.
    console.error('[server] deliveryStats: could not read the stored total; not persisting this run')
    return
  }

  const parsed = raw ? parseInt(raw, 10) : 0
  total = (Number.isFinite(parsed) && parsed > 0 ? parsed : 0) + pendingIncrements
  const banked = pendingIncrements
  pendingIncrements = 0
  loaded = true

  publish()
  if (banked > 0) persistTotal() // a plain read needs no write back
}
