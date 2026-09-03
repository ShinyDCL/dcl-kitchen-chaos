// Tracks when each player last did something, so order payouts can go to
// everyone who actually helped rather than everyone standing in the room.
// Delivery pays the full amount to every recently-active player (see
// orderQueue.ts) — paying only the deliverer would reward the least
// skilled step of the chain and turn a co-op game competitive.
//
// onPlayerAction is how every contested fixture handler registers: it owns
// the may-this-player-act gate and the activity stamp, so a handler added
// later can't skip either. Stamping happens before the action's own
// validation, so a rejected attempt still counts as being active.

import { ISchema } from '@dcl/sdk/ecs'

import { ACTIVITY_WINDOW_MS } from '../shared/constants'
import { Messages, room } from '../shared/messages'
import { getActivePlayerIds, isPlayerAllowedToAct } from './playerRoster'

const lastActionAt = new Map<string, number>() // keyed by lower-cased playerId

type MessageData<K extends keyof typeof Messages> = (typeof Messages)[K] extends ISchema<infer T> ? T : never

/**
 * Registers a handler that runs only for a player allowed to act, marking
 * them active on the way through. The body gets the lower-cased playerId
 * other modules key by, plus the raw address for the few spots needing it
 * verbatim (room.send's `to`).
 */
export function onPlayerAction<K extends keyof typeof Messages>(
  eventType: K,
  handler: (data: MessageData<K>, playerId: string, address: string) => void
): void {
  room.onMessage(eventType, (data, context) => {
    if (!context || !isPlayerAllowedToAct(context.from)) return
    const playerId = context.from.toLowerCase()
    lastActionAt.set(playerId, Date.now())
    handler(data, playerId, context.from)
  })
}

/** Currently-connected 'play' players who acted within ACTIVITY_WINDOW_MS — who a delivery pays. */
export function getRecentlyActivePlayerIds(): string[] {
  const cutoff = Date.now() - ACTIVITY_WINDOW_MS
  return getActivePlayerIds().filter((playerId) => (lastActionAt.get(playerId) ?? 0) >= cutoff)
}

/** Drops a departed player's stamp — they're already excluded by getActivePlayerIds, this just keeps the map from growing. */
export function forgetPlayerActivity(playerId: string): void {
  lastActionAt.delete(playerId.toLowerCase())
}
