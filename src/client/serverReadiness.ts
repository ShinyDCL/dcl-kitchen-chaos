// Detects whether the auth server is actually alive, not just whether the
// CRDT room is connected — see the authoritative-server skill's Server
// Lifecycle section. isStateSyncronized() alone isn't enough: the room's
// CRDT snapshot can hold state left over from a previous server run, so a
// fresh client can see "valid" GameState while the real server is still
// cold-booting (up to ~15s in production) or hasn't started at all.
//
// Tracks the CLIENT-observed time the heartbeat last changed, not the
// heartbeat's own value — a stale snapshot from a long-gone server run
// then reads as dead (never observed changing).
//
// The same two numbers also give the clock offset, which serverNow() needs:
// every timestamp the server syncs (an order's generatedAt) is on the
// server's clock, so anything comparing one against Date.now() is wrong by
// however far this machine's clock has drifted.

import { engine } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { SERVER_HEARTBEAT_FRESHNESS_MS } from '../shared/constants'
import { GameState } from '../shared/schemas'

let lastSeenValue = 0
let lastSeenAtClient = 0
let clockOffsetMs = 0

export function isServerAlive(): boolean {
  if (!isStateSyncronized()) return false

  observeHeartbeat()

  if (lastSeenAtClient === 0) return false // never observed a pulse yet
  return Date.now() - lastSeenAtClient < SERVER_HEARTBEAT_FRESHNESS_MS
}

/**
 * Date.now() shifted onto the server's clock. Use it for anything compared
 * against a synced timestamp — an order's generatedAt is written on the
 * server, so a client whose clock trails the server's would otherwise think
 * an order still had time left after the server had already expired it, and
 * the card would vanish without ever showing its timed-out state.
 *
 * Off by the one-way trip the heartbeat took to arrive (tens of ms), which
 * is small next to the clock drift it corrects. Returns Date.now() unchanged
 * until the first pulse lands.
 */
export function serverNow(): number {
  observeHeartbeat()
  return Date.now() + clockOffsetMs
}

/** Records the newest pulse and the client time it arrived, which together give the offset. */
function observeHeartbeat(): void {
  for (const [, data] of engine.getEntitiesWith(GameState)) {
    const heartbeat = Number(data.serverHeartbeatAt)
    if (heartbeat !== lastSeenValue) {
      lastSeenValue = heartbeat
      lastSeenAtClient = Date.now()
      clockOffsetMs = heartbeat - lastSeenAtClient
    }
    break // singleton — only one GameState entity ever exists
  }
}
