// Who is in the scene, and their display names.
//
// Presence comes from two sources that answer different questions.
// onEnterScene/onLeaveScene are events — the only way to learn the moment
// someone arrives or leaves, which is what per-player setup and cleanup
// need. getConnectedPlayerIds reads PlayerIdentityData instead, which is
// the authoritative snapshot of who is here right now: it survives a
// server restart mid-session and can't drift if an event is ever missed.
// So events drive side effects, the snapshot drives counts and membership.
//
// Everyone in the scene can act — there is no role and no permission check.
// Order queue size follows the plain count (see gameState.ts and
// orderQueue.ts), while payouts use the narrower activity window in
// playerActivity.ts.

import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/players'

type PlayerLifecycleHandler = (playerId: string) => void

const leaveHandlers: PlayerLifecycleHandler[] = []

export function initPlayers(): void {
  // One subscription fanned out to the registered handlers, so the order
  // they run in is this module's business rather than registration timing.
  onLeaveScene((userId) => {
    const playerId = userId.toLowerCase()
    for (const handler of leaveHandlers) handler(playerId)
  })
}

/**
 * Registers a callback for when a player leaves, so modules holding
 * per-player state can drop it (playerCoins.ts, playerActivity.ts) instead
 * of leaking an entry per visitor for the life of the server.
 */
export function onPlayerLeave(handler: PlayerLifecycleHandler): void {
  leaveHandlers.push(handler)
}

/** Registers a callback for when a player enters, lower-cased to match every other id in server code. */
export function onPlayerEnter(handler: PlayerLifecycleHandler): void {
  onEnterScene((player) => handler(player.userId.toLowerCase()))
}

/** Lower-cased addresses of everyone currently in the scene. */
export function getConnectedPlayerIds(): Set<string> {
  const connectedIds = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    connectedIds.add(identity.address.toLowerCase())
  }
  return connectedIds
}

/** Counts without allocating the Set getConnectedPlayerIds builds — gameState.ts calls this every frame. */
export function countConnectedPlayers(): number {
  let count = 0
  for (const [] of engine.getEntitiesWith(PlayerIdentityData)) count++
  return count
}

/**
 * Resolved profile name, or null when it can't be read — getPlayer only
 * sees players currently in the scene, so an offline player is always null.
 * Matches case-insensitively and looks up by the address as PlayerIdentityData
 * actually spells it, since getPlayer compares userId exactly and callers
 * hold lower-cased ids.
 */
export function getPlayerName(playerId: string): string | null {
  const target = playerId.toLowerCase()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address.toLowerCase() !== target) continue
    const name = getPlayer({ userId: identity.address })?.name
    return name && name.length > 0 ? name : null
  }
  return null
}

/** Display name for a player address, used in the order HUD's "delivered by" message. */
export function getPlayerDisplayName(playerId: string): string {
  return getPlayerName(playerId) ?? 'A player'
}
