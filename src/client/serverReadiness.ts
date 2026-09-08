// Whether the server is actually alive, not merely whether the CRDT room is
// connected — see the authoritative-server skill's Server Lifecycle section.
// isStateSyncronized() is not enough: the room's snapshot can hold state from a
// previous server run, so a fresh client sees valid-looking GameState while the
// real server is still cold-booting (~15s in production) or absent.
//
// Tracks the CLIENT-observed time the heartbeat last changed, not the
// heartbeat's own value, so a stale snapshot reads as dead rather than live.
// The first value seen is only a baseline: proving a server is running means
// watching one value become another, which costs one interval on a cold start.
//
// Those two numbers also give the clock offset serverNow() needs: every synced
// timestamp is on the server's clock, so comparing one against a raw Date.now()
// is wrong by however far this machine's clock has drifted.

import { engine } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'

import { SERVER_HEARTBEAT_FRESHNESS_MS } from '../shared/constants'
import { GameState } from '../shared/schemas'

let lastSeenValue = 0
let lastSeenAtClient = 0
let clockOffsetMs = 0
let baselineTaken = false // a value has been seen; on its own it proves nothing
let observedChange = false // a value actually changed, which only a live server does

export function isServerAlive(): boolean {
  if (!isStateSyncronized()) return false

  observeHeartbeat()

  if (!observedChange) return false // nothing has been seen changing yet
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
 * until a pulse is seen to change, one interval after the first sighting.
 */
export function serverNow(): number {
  observeHeartbeat()
  return Date.now() + clockOffsetMs
}

/**
 * Records the newest pulse and the client time it arrived, which together give
 * the offset.
 *
 * The first value is banked as a baseline and nothing else: a snapshot left by
 * a server that has since shut down looks brand new, and taking it as a pulse
 * would read as alive for a whole freshness window — long enough to open the
 * scene to a player with no server behind it, and to adopt a stale clock offset.
 */
function observeHeartbeat(): void {
  for (const [, data] of engine.getEntitiesWith(GameState)) {
    const heartbeat = Number(data.serverHeartbeatAt)
    if (baselineTaken && heartbeat === lastSeenValue) break

    lastSeenValue = heartbeat
    if (!baselineTaken) {
      baselineTaken = true
      break // could be a stale snapshot — record no time and no offset
    }

    observedChange = true
    lastSeenAtClient = Date.now()
    clockOffsetMs = heartbeat - lastSeenAtClient
    break // singleton — only one GameState entity ever exists
  }
}
