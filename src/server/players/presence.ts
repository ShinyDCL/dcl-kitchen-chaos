// Who is in the scene, and their display names.
//
// Presence comes from two sources that answer different questions.
// onEnterScene/onLeaveScene are events — the only way to learn the moment
// someone arrives or leaves, which is what per-player setup and cleanup
// need. getConnectedPlayerIds reads PlayerIdentityData instead, which is
// the authoritative snapshot of who is here right now: it survives a
// server restart mid-session and can't drift if an event is ever missed.
// So events drive side effects, the snapshot drives counts and membership.
// Both filter NON_PLAYER_ADDRESSES, so a connection that isn't playing
// can't reach anything downstream.
//
// Everyone in the scene can act — there is no role and no permission check.
// Order queue size follows the plain count (see gameState.ts and
// orderQueue.ts), while payouts use the narrower activity window in
// playerActivity.ts.

import { AvatarBase, engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/players'

import { NON_PLAYER_ADDRESSES } from './nonPlayerAddresses'

type PlayerLifecycleHandler = (playerId: string) => void

/** Lower-cased once here, so an entry in the list can be pasted as-is. */
const nonPlayerIds = new Set<string>(NON_PLAYER_ADDRESSES.map((address) => address.toLowerCase()))

const leaveHandlers: PlayerLifecycleHandler[] = []

export function initPlayers(): void {
  // One subscription fanned out to the registered handlers, so the order
  // they run in is this module's business rather than registration timing.
  onLeaveScene((userId) => {
    const playerId = userId.toLowerCase()
    if (isNonPlayer(playerId)) return
    for (const handler of leaveHandlers) handler(playerId)
  })
}

/** Whether this address is on the nonPlayerAddresses.ts list — see there for what that means. */
function isNonPlayer(playerId: string): boolean {
  return nonPlayerIds.has(playerId)
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
  onEnterScene((player) => {
    const playerId = player.userId.toLowerCase()
    if (!isNonPlayer(playerId)) handler(playerId)
  })
}

/**
 * Lower-cased addresses of everyone currently in the scene.
 *
 * Requires AvatarBase as well as PlayerIdentityData, matching what the SDK
 * player helper treats as present. An arriving player holds an identity
 * entity for a frame or two before the avatar resolves (measured at ~65ms
 * on a deployed World), and counting that window would spike the total on
 * every single arrival. Returning a Set also means a player who briefly
 * holds two entities is counted once. NON_PLAYER_ADDRESSES are left out
 * entirely.
 */
export function getConnectedPlayerIds(): Set<string> {
  const connectedIds = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData, AvatarBase)) {
    const playerId = identity.address.toLowerCase()
    if (!isNonPlayer(playerId)) connectedIds.add(playerId)
  }
  return connectedIds
}

/**
 * The number behind the chef count. Deliberately the size of the same Set
 * rather than a cheaper entity tally, so the HUD can't disagree with
 * membership: a tally counted rows this Set would have deduped or skipped,
 * and the queue size and payouts read the Set.
 */
export function countConnectedPlayers(): number {
  return getConnectedPlayerIds().size
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
