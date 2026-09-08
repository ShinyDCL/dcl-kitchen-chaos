// Owns the all-time top-LEADERBOARD_SIZE board: the in-memory ranking, the
// synced Leaderboard clients render from, and its Scene Storage backing.
//
// It needs its own stored key rather than being recomputed at startup, since
// Storage.player only reads keys for an address you already have (there is no
// enumeration API). Player storage stays the source of truth per balance; this
// is a cache of the top slice, which is what lets it include offline players.
//
// A synced component, not a broadcast — a joining client gets the board from
// the CRDT snapshot with no message.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { Storage } from '@dcl/sdk/server'

import { LEADERBOARD_SIZE } from '../../shared/constants'
import { Leaderboard, LEADERBOARD_SYNC_ID } from '../../shared/schemas'
import { isAdoptableEntity } from '../entityAdoption'
import { getPlayerName } from '../players/presence'
import { persist } from '../storageWrite'

const STORAGE_KEY = 'leaderboard'

interface LeaderboardEntry {
  playerId: string // lower-cased
  name: string
  lifetimeCoins: number
}

const entries: LeaderboardEntry[] = [] // sorted descending, at most LEADERBOARD_SIZE
let needsPublish = false // changed in memory, not yet written to the synced component
let loaded = false // stored board read at least once — never write before that
let leaderboardEntity: Entity | null = null

export function initLeaderboard(): void {
  reconcileLeaderboardEntity()
  void loadStoredBoard()
  engine.addSystem(publishPendingBoard)
}

/** One component write per tick — a delivery pays every recently-active player, so recordCoins calls land in batches. */
function publishPendingBoard(): void {
  if (!needsPublish) return

  entries.sort((a, b) => b.lifetimeCoins - a.lifetimeCoins)
  entries.length = Math.min(entries.length, LEADERBOARD_SIZE)

  const mutable = Leaderboard.getMutableOrNull(getOrCreateLeaderboardEntity())
  if (!mutable) return // still pending, so the next tick retries rather than dropping the change

  needsPublish = false
  mutable.version += 1 // lets clients detect the change without diffing contents
  mutable.entries = entries.map(({ name, lifetimeCoins }) => ({ name, lifetimeCoins })) // playerId stays server-side

  // The whole board, so a dropped write is healed by the next change's.
  // Several recordCoins calls per delivery collapse into one write here, and
  // the SDK's per-key queue coalesces whatever still overlaps.
  if (loaded) persist('leaderboard', () => Storage.set(STORAGE_KEY, JSON.stringify(entries)))
}

/**
 * Called by coins.ts on every total change. Refreshes the name too —
 * coins only change while a player is connected, which is exactly when
 * their name resolves, so this is where a rename gets picked up.
 */
export function recordCoins(playerId: string, lifetimeCoins: number): void {
  const id = playerId.toLowerCase()
  const existing = entries.find((entry) => entry.playerId === id)

  if (existing) {
    if (existing.lifetimeCoins === lifetimeCoins) {
      if (!refreshName(existing)) return // unchanged coins and unchanged name
    } else {
      existing.lifetimeCoins = lifetimeCoins
      refreshName(existing)
    }
  } else {
    if (!qualifies(lifetimeCoins)) return
    entries.push({ playerId: id, name: getPlayerName(id) ?? 'A player', lifetimeCoins })
  }

  needsPublish = true
}

/** Whether a total is good enough to enter a board that isn't full yet, or to displace a row on a full one. */
function qualifies(lifetimeCoins: number): boolean {
  // Connecting alone loads a player at 0 and records it — without this, merely
  // joining put everyone on the board (and persisted it).
  if (lifetimeCoins <= 0) return false
  if (entries.length < LEADERBOARD_SIZE) return true

  // Beating any row, rather than the last one specifically: recordCoins appends,
  // so within a tick the tail is whoever was just added, not the lowest. A
  // delivery pays several players at once, and comparing against the wrong
  // threshold dropped the second newcomer of the batch. Over-length is fine —
  // publishPendingBoard truncates on the same tick.
  return entries.some((entry) => lifetimeCoins > entry.lifetimeCoins)
}

/** Updates the name if it resolves to something new, returning whether it changed. An unresolvable name leaves the stored one alone. */
function refreshName(entry: LeaderboardEntry): boolean {
  const name = getPlayerName(entry.playerId)
  if (name === null || name === entry.name) return false
  entry.name = name
  return true
}

/** Seeds from Storage at startup. Merges rather than replaces, so a delivery landing before the read wins over the stored total. */
async function loadStoredBoard(): Promise<void> {
  let raw: string | null
  try {
    raw = (await Storage.get<string>(STORAGE_KEY)) ?? null
  } catch {
    // Never persist without having read first, or the stored board would be
    // overwritten by whatever this run happens to accumulate.
    console.error('[server] leaderboard: could not read the stored board; not persisting this run')
    return
  }

  loaded = true // an empty or corrupt value is still a successful read
  mergeStoredEntries(raw)

  // Runs on every path above, not just when rows were merged: anything
  // recorded while the read was in flight is still unpersisted, since
  // publishPendingBoard suppresses writes until `loaded`. An empty board
  // publishes nothing, so no synced entity is created for it.
  if (entries.length > 0) needsPublish = true
}

/** Folds the stored rows in, keeping this run's value for any player already recorded — that one is fresher. */
function mergeStoredEntries(raw: string | null): void {
  if (!raw) return

  let stored: LeaderboardEntry[]
  try {
    stored = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(stored)) return

  for (const entry of stored) {
    if (typeof entry?.playerId !== 'string' || typeof entry?.lifetimeCoins !== 'number') continue
    if (entry.lifetimeCoins <= 0) continue // drops 0-coin rows an older build persisted
    const id = entry.playerId.toLowerCase()
    if (entries.some((existing) => existing.playerId === id)) continue
    entries.push({
      playerId: id,
      name: typeof entry.name === 'string' ? entry.name : 'A player',
      lifetimeCoins: entry.lifetimeCoins
    })
  }
}

function getOrCreateLeaderboardEntity(): Entity {
  if (leaderboardEntity !== null && Leaderboard.getOrNull(leaderboardEntity) !== null) return leaderboardEntity

  const entity = engine.addEntity()
  Leaderboard.create(entity, { version: 0, entries: [] })
  syncEntity(entity, [Leaderboard.componentId], LEADERBOARD_SYNC_ID)
  leaderboardEntity = entity
  return entity
}

/**
 * Re-adopts the leaderboard entity if it already exists in the CRDT snapshot
 * from a previous server run.
 *
 * Rows are blanked, not trusted: entries are a positional Schemas.Map, so a
 * snapshot from a build with a different field layout decodes as nonsense.
 * publishPendingBoard heals it a tick after the stored read — but not when
 * storage is empty or unreadable. The version bump forces a redraw.
 */
function reconcileLeaderboardEntity(): void {
  for (const [entity] of engine.getEntitiesWith(Leaderboard)) {
    if (!isAdoptableEntity(entity)) continue
    leaderboardEntity = entity

    const mutable = Leaderboard.getMutableOrNull(entity)
    if (mutable) {
      mutable.entries = []
      mutable.version += 1
    }
    return
  }
}
