// Owns the all-time top-LEADERBOARD_SIZE board: the in-memory ranking, the
// synced Leaderboard clients render from, and its Scene Storage backing.
//
// It needs its own stored key rather than being recomputed at startup:
// Storage.player only reads keys for an address you already have (no
// enumeration API), so there'd be nothing to recompute from. Player storage
// stays the source of truth per balance; this is a cache of the top slice,
// which is what lets it include offline players.
//
// Synced component, not a broadcast — a joining client gets the board from
// the CRDT snapshot with no message.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'

import { LEADERBOARD_SIZE } from '../shared/constants'
import { Leaderboard, LEADERBOARD_SYNC_ID } from '../shared/schemas'
import { getPlayerName } from './playerRoster'
import { createDebouncedFlush } from './storageFlush'

const STORAGE_KEY = 'leaderboard'
const FLUSH_INTERVAL_SECONDS = 10

interface LeaderboardEntry {
  playerId: string // lower-cased
  name: string
  lifetimeCoins: number
}

const entries: LeaderboardEntry[] = [] // sorted descending, at most LEADERBOARD_SIZE
let needsPublish = false // changed in memory, not yet written to the synced component
let dirty = false // changed since last persisted
let loaded = false // stored board read at least once — never write before that
let leaderboardEntity: Entity | null = null

const flusher = createDebouncedFlush(FLUSH_INTERVAL_SECONDS, flushBoard)

export function initLeaderboard(): void {
  reconcileLeaderboardEntity()
  void loadStoredBoard()
  engine.addSystem(publishPendingBoard)
  engine.addSystem(flusher.system)
}

/** One component write per tick — a delivery pays every recently-active player, so recordCoins calls land in batches. */
function publishPendingBoard(): void {
  if (!needsPublish) return
  needsPublish = false

  entries.sort((a, b) => b.lifetimeCoins - a.lifetimeCoins)
  entries.length = Math.min(entries.length, LEADERBOARD_SIZE)

  const mutable = Leaderboard.getMutableOrNull(getOrCreateLeaderboardEntity())
  if (!mutable) return
  mutable.version += 1 // lets clients detect the change without diffing contents
  mutable.entries = entries.map((entry) => ({ ...entry }))
}

/**
 * Called by playerCoins.ts on every total change. Refreshes the name too —
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
  dirty = true
}

/** Whether a total is good enough to enter a board that isn't full yet, or to displace its last entry. */
function qualifies(lifetimeCoins: number): boolean {
  if (entries.length < LEADERBOARD_SIZE) return true
  return lifetimeCoins > entries[entries.length - 1].lifetimeCoins
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
    return // stay unloaded so flushBoard retries — writing now would overwrite the stored board
  }

  loaded = true // an empty or corrupt value is still a successful read; only a failed one retries
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
    const id = entry.playerId.toLowerCase()
    if (entries.some((existing) => existing.playerId === id)) continue // this run's value is fresher
    entries.push({ playerId: id, name: typeof entry.name === 'string' ? entry.name : 'A player', lifetimeCoins: entry.lifetimeCoins })
  }

  needsPublish = true // deliberately not dirty — nothing to write back
}

async function flushBoard(): Promise<void> {
  if (!loaded) {
    await loadStoredBoard() // boot read failed; this interval is the retry
    return
  }
  if (!dirty) return

  const snapshot = JSON.stringify(entries)
  const ok = await Storage.set(STORAGE_KEY, snapshot)
  if (ok && snapshot === JSON.stringify(entries)) dirty = false // still current, so safe to clear
}

function getOrCreateLeaderboardEntity(): Entity {
  if (leaderboardEntity !== null && Leaderboard.getOrNull(leaderboardEntity) !== null) return leaderboardEntity

  const entity = engine.addEntity()
  Leaderboard.create(entity, { version: 0, entries: [] })
  syncEntity(entity, [Leaderboard.componentId], LEADERBOARD_SYNC_ID)
  leaderboardEntity = entity
  return entity
}

/** Re-adopts the leaderboard entity if it already exists in the CRDT snapshot from a previous server run. */
function reconcileLeaderboardEntity(): void {
  for (const [entity] of engine.getEntitiesWith(Leaderboard)) {
    leaderboardEntity = entity
    return
  }
}
