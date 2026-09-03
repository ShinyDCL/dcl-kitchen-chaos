// Owns the all-time successful-delivery count behind
// GameState.totalDeliveredOrders. Unlike GameState.streak it only grows and
// survives restarts. Scene Storage, since it's one scene-wide figure; same
// in-memory-plus-interval-flush shape as leaderboard.ts.

import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'

import { getGameStateMutable } from './playerRoster'
import { createDebouncedFlush } from './storageFlush'

const STORAGE_KEY = 'totalDeliveredOrders'
const FLUSH_INTERVAL_SECONDS = 10

let total = 0
let loaded = false
let pendingIncrements = 0 // deliveries banked before the stored total arrived
let dirty = false

const flusher = createDebouncedFlush(FLUSH_INTERVAL_SECONDS, flushTotal)

export function initDeliveryStats(): void {
  void loadStoredTotal()
  engine.addSystem(flusher.system)
}

/** Counts one successful delivery — called by orderQueue.ts's evaluateDelivery on a match. */
export function recordDelivery(): void {
  if (!loaded) {
    pendingIncrements += 1 // bank it rather than counting up from a 0 the load would overwrite
    return
  }

  total += 1
  dirty = true
  publish()
}

function publish(): void {
  const gameState = getGameStateMutable()
  if (gameState && gameState.totalDeliveredOrders !== total) gameState.totalDeliveredOrders = total
}

async function loadStoredTotal(): Promise<void> {
  let raw: string | null
  try {
    raw = (await Storage.get<string>(STORAGE_KEY)) ?? null
  } catch {
    return // stay unloaded so flushTotal retries — writing now would overwrite the stored count with ~0
  }

  const parsed = raw ? parseInt(raw, 10) : 0
  total = (Number.isFinite(parsed) && parsed > 0 ? parsed : 0) + pendingIncrements
  dirty = pendingIncrements > 0 // a plain read needs no write back
  pendingIncrements = 0
  loaded = true
  publish()
}

async function flushTotal(): Promise<void> {
  if (!loaded) {
    await loadStoredTotal() // boot read failed; this interval is the retry
    return
  }
  if (!dirty) return

  const snapshot = total
  const ok = await Storage.set(STORAGE_KEY, String(snapshot))
  // Clear only on a confirmed write of a still-current value — set resolves
  // false rather than throwing, and the total may have grown mid-write.
  if (ok && total === snapshot) dirty = false
}
