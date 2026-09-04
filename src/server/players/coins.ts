// Owns every player's lifetime coin total: in-memory working copy, the
// synced PlayerCoins their HUD reads, and the Player Storage backing.
// Persisted the moment it changes — the whole total each time, so a dropped
// write is healed by the next grant's (see storageWrite.ts).
//
// The synced entity isn't created until the stored total loads, so the HUD
// never shows a 0 that then jumps; grants arriving meanwhile wait in
// pendingGrants. lifetimeCoins only ever grows — see shared/schemas.ts.

import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'

import { PlayerCoins } from '../../shared/schemas'
import { recordCoins } from '../progression/leaderboard'
import { persist } from '../storageWrite'
import { getConnectedPlayerIds, onPlayerEnter } from './presence'
import { createPerPlayerStore } from './syncedStore'

const STORAGE_KEY = 'lifetimeCoins'
const CONNECTION_CHECK_INTERVAL_SECONDS = 1

let connectionCheckElapsed = 0

const store = createPerPlayerStore(PlayerCoins, (playerId) => ({ playerId, lifetimeCoins: 0 }))

const totals = new Map<string, number>() // loaded players only — absence means "not loaded yet"
const pendingGrants = new Map<string, number>() // earned before the stored total arrived
const loading = new Set<string>()

export function initPlayerCoins(): void {
  store.reconcile()
  // Load on arrival so the HUD is right immediately, rather than up to a
  // full check interval late.
  onPlayerEnter(loadIfNeeded)
  engine.addSystem(trackConnectedPlayers)
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

    applyTotal(id, current + amount, true)
  }
}

/** `persistTotal` is false when the value came straight from storage — writing it back would be a no-op round trip. */
function applyTotal(playerId: string, lifetimeCoins: number, persistTotal: boolean): void {
  totals.set(playerId, lifetimeCoins)

  const entity = store.getOrCreateEntity(playerId)
  const mutable = PlayerCoins.getMutableOrNull(entity)
  if (mutable) mutable.lifetimeCoins = lifetimeCoins

  recordCoins(playerId, lifetimeCoins)

  // The whole total, so a dropped write is healed by the next grant's.
  if (persistTotal) {
    persist(`coins ${playerId}`, () => Storage.player.set(playerId, STORAGE_KEY, String(lifetimeCoins)))
  }
}

/**
 * Prunes departed players, and backstops onPlayerEnter. The two disagree
 * briefly by design: onEnterScene waits for AvatarBase as well as
 * PlayerIdentityData, while the connected snapshot needs only the latter, so
 * this also catches anyone whose avatar data lagged. Throttled — it rebuilds
 * a Set each run.
 */
function trackConnectedPlayers(dt: number): void {
  connectionCheckElapsed += dt
  if (connectionCheckElapsed < CONNECTION_CHECK_INTERVAL_SECONDS) return
  connectionCheckElapsed = 0

  const connected = getConnectedPlayerIds()

  for (const playerId of connected) loadIfNeeded(playerId)

  for (const playerId of [...totals.keys()]) {
    if (connected.has(playerId)) continue
    totals.delete(playerId)
    pendingGrants.delete(playerId) // nothing in flight can flush these once the total is gone
  }
}

/** Starts a load unless the total is already there or on its way. */
function loadIfNeeded(playerId: string): void {
  if (totals.has(playerId) || loading.has(playerId)) return
  void loadStoredTotal(playerId)
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

  applyTotal(playerId, stored + pending, pending > 0)
}
