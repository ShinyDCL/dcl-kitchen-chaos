// Tracks when each player last did something, so order payouts can go to
// everyone who actually helped rather than everyone standing in the room.
// Delivery pays the full amount to every recently-active player (see
// orderQueue.ts) — paying only the deliverer would reward the least
// skilled step of the chain and turn a co-op game competitive.
//
// This is the only place the activity window still matters. Order queue
// size follows the plain connected count instead (gameState.ts's
// playerCount), because sizing on activity deadlocks: no active players
// means no orders, which means nothing to act on, which means nobody
// becomes active.
//
// onPlayerAction is how every contested fixture handler registers, so the
// activity stamp can't be forgotten by a handler added later. Stamping
// happens before the action's own validation, so a rejected attempt still
// counts as being active.

import { ISchema } from '@dcl/sdk/ecs'

import { ACTIVITY_WINDOW_MS } from '../../shared/constants'
import { Messages, room } from '../../shared/messages'
import { onSessionStart } from '../session'
import { getConnectedPlayerIds, onPlayerLeave } from './presence'

const lastActionAt = new Map<string, number>() // keyed by lower-cased playerId

type MessageData<K extends keyof typeof Messages> = (typeof Messages)[K] extends ISchema<infer T> ? T : never

export function initPlayerActivity(): void {
  // Bounds the map by who is present rather than by everyone who ever
  // visited this server run.
  onPlayerLeave((playerId) => lastActionAt.delete(playerId))

  // Belt and braces — a leave should already have cleared each entry.
  onSessionStart(() => lastActionAt.clear())
}

/**
 * Registers a handler and marks the sender active on the way through. The
 * body gets the lower-cased playerId other modules key by, plus the raw
 * address for the few spots needing it verbatim (room.send's `to`).
 */
export function onPlayerAction<K extends keyof typeof Messages>(
  eventType: K,
  handler: (data: MessageData<K>, playerId: string, address: string) => void
): void {
  room.onMessage(eventType, (data, context) => {
    if (!context) return
    const playerId = context.from.toLowerCase()
    lastActionAt.set(playerId, Date.now())
    handler(data, playerId, context.from)
  })
}

/** Connected players who acted within ACTIVITY_WINDOW_MS — who a delivery pays. */
export function getRecentlyActivePlayerIds(): string[] {
  const cutoff = Date.now() - ACTIVITY_WINDOW_MS
  const recentlyActive: string[] = []
  for (const playerId of getConnectedPlayerIds()) {
    if ((lastActionAt.get(playerId) ?? 0) >= cutoff) recentlyActive.push(playerId)
  }
  return recentlyActive
}
