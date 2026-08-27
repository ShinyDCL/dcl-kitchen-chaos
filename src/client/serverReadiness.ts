// Detects whether the auth server is actually alive, not just whether the
// CRDT room is connected — see the authoritative-server skill's Server
// Lifecycle section. isStateSyncronized() alone isn't enough: the room's
// CRDT snapshot can hold state left over from a previous server run, so a
// fresh client can see "valid" GameState while the real server is still
// cold-booting (up to ~15s in production) or hasn't started at all.
//
// Tracks the CLIENT-observed time the heartbeat last changed, not the
// heartbeat's own value — a stale snapshot from a long-gone server run
// then reads as dead (never observed changing), and server/client clock
// skew doesn't matter.

import { engine } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { SERVER_HEARTBEAT_FRESHNESS_MS } from '../shared/constants'
import { GameState } from '../shared/schemas'

let lastSeenValue = 0
let lastSeenAtClient = 0

export function isServerAlive(): boolean {
  if (!isStateSyncronized()) return false

  for (const [, data] of engine.getEntitiesWith(GameState)) {
    const heartbeat = Number(data.serverHeartbeatAt)
    if (heartbeat !== lastSeenValue) {
      lastSeenValue = heartbeat
      lastSeenAtClient = Date.now()
    }
    break // singleton — only one GameState entity ever exists
  }

  if (lastSeenAtClient === 0) return false // never observed a pulse yet
  return Date.now() - lastSeenAtClient < SERVER_HEARTBEAT_FRESHNESS_MS
}
