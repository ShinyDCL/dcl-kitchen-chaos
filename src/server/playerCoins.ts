// Owns every player's lifetime coin total: in-memory working copy, the
// synced PlayerCoins their HUD reads, and the Player Storage backing.
// Flushed on an interval (storageFlush.ts explains why) plus on leave.
//
// The synced entity isn't created until the stored total loads, so the HUD
// never shows a 0 that then jumps; grants arriving meanwhile wait in
// pendingGrants. lifetimeCoins only ever grows — see shared/schemas.ts.

import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'

import { PlayerCoins } from '../shared/schemas'
import { recordCoins } from './leaderboard'
import { createPerPlayerStore } from './perPlayerSyncedStore'
import { forgetPlayerActivity } from './playerActivity'
import { getConnectedPlayerIds } from './playerRoster'
import { createDebouncedFlush } from './storageFlush'

const STORAGE_KEY = 'lifetimeCoins'
const FLUSH_INTERVAL_SECONDS = 10
const CONNECTION_CHECK_INTERVAL_SECONDS = 1

let connectionCheckElapsed = 0
let previouslyConnected = new Set<string>()

const store = createPerPlayerStore(PlayerCoins, (playerId) => ({ playerId, lifetimeCoins: 0 }))

const totals = new Map<string, number>() // loaded players only — absence means "not loaded yet"
const pendingGrants = new Map<string, number>() // earned before the stored total arrived
const loading = new Set<string>()
const dirty = new Set<string>()

const flusher = createDebouncedFlush(FLUSH_INTERVAL_SECONDS, flushDirtyTotals)

export function initPlayerCoins(): void {
  store.reconcile()
  engine.addSystem(trackConnectedPlayers)
  engine.addSystem(flusher.system)
}

/** Adds `amount` to each player's lifetime total — called by orderQueue.ts for every recently-active player on a successful delivery. */
export function grantCoins(playerIds: string[], amount: number): void {
  if (amount <= 0) return

  for (const playerId of playerIds) {
    const id = playerId.toLowerCase()
    const current = totals.get(id)

    if (current === undefined) {
      // Not loaded yet — bank it rather than counting up from a 0 the load would overwrite.
      pendingGrants.set(id, (pendingGrants.get(id) ?? 0) + amount)
      continue
    }

    applyTotal(id, current + amount)
  }
}

function applyTotal(playerId: string, lifetimeCoins: number): void {
  totals.set(playerId, lifetimeCoins)
  dirty.add(playerId)

  const entity = store.getOrCreateEntity(playerId)
  const mutable = PlayerCoins.getMutableOrNull(entity)
  if (mutable) mutable.lifetimeCoins = lifetimeCoins

  recordCoins(playerId, lifetimeCoins)
}

/**
 * Loads newly-connected players and flushes departed ones. Throttled —
 * connects don't need frame precision and this rebuilds a Set each run.
 * The leave-flush fires on the tick they go, not every tick they sit dirty,
 * so a failing write retries on the interval instead of every frame.
 */
function trackConnectedPlayers(dt: number): void {
  connectionCheckElapsed += dt
  if (connectionCheckElapsed < CONNECTION_CHECK_INTERVAL_SECONDS) return
  connectionCheckElapsed = 0

  const connected = getConnectedPlayerIds()

  for (const playerId of connected) {
    if (totals.has(playerId) || loading.has(playerId)) continue
    void loadStoredTotal(playerId)
  }

  let anyDeparted = false
  for (const playerId of previouslyConnected) {
    if (!connected.has(playerId)) anyDeparted = true
  }
  if (anyDeparted) flusher.flushNow()

  for (const playerId of [...totals.keys()]) {
    if (connected.has(playerId) || dirty.has(playerId)) continue // keep dirty totals until their write lands
    totals.delete(playerId)
    forgetPlayerActivity(playerId)
  }

  previouslyConnected = connected
}

async function loadStoredTotal(playerId: string): Promise<void> {
  loading.add(playerId)
  let stored = 0
  try {
    const raw = await Storage.player.get<string>(playerId, STORAGE_KEY)
    const parsed = raw ? parseInt(raw, 10) : 0
    if (Number.isFinite(parsed) && parsed > 0) stored = parsed
  } catch {
    return // stay unloaded so the next tick retries; pendingGrants keeps anything earned meanwhile
  } finally {
    loading.delete(playerId)
  }

  const pending = pendingGrants.get(playerId) ?? 0
  pendingGrants.delete(playerId)

  if (pending === 0 && !getConnectedPlayerIds().has(playerId)) return // left mid-read, earned nothing

  applyTotal(playerId, stored + pending)
  if (pending === 0) dirty.delete(playerId) // just read this value — no need to write it back
}

async function flushDirtyTotals(): Promise<void> {
  for (const playerId of [...dirty]) {
    const total = totals.get(playerId)
    if (total === undefined) {
      dirty.delete(playerId)
      continue
    }

    const ok = await Storage.player.set(playerId, STORAGE_KEY, String(total))
    // Clear only on a confirmed write of a still-current value — set resolves
    // false rather than throwing, and the total may have grown mid-write.
    if (ok && totals.get(playerId) === total) dirty.delete(playerId)
  }
}
