// Local player's role state, synced against the server's PlayerRole
// component (shared/schemas.ts). Kept separate from playerRole.tsx (the
// UI) so non-UI gameplay code — focusManager.ts's spectator gate — doesn't
// need to pull in the react-ecs/JSX import graph just to read the local
// role.
//
// A player is spectator by default the moment they connect —
// startPlayerRoleSync sends that immediately, so a player who never
// touches the entry prompt still ends up with a real synced PlayerRole
// instead of leaving the server guessing.

import { engine } from '@dcl/sdk/ecs'

import { room } from '../shared/messages'
import { PlayerRole, PlayerRoleValue } from '../shared/schemas'
import { getLocalUserId } from './playerIdentity'

let localRole: PlayerRoleValue = PlayerRoleValue.Spectate
let lastSyncedRole: PlayerRoleValue | null = null // last role actually observed from the synced component

/** Whether the local player is allowed to interact with fixtures — see focusManager.ts's spectator gate. */
export function isLocalPlayerPlaying(): boolean {
  return localRole === PlayerRoleValue.Play
}

/** The local player's current role, for UI that needs to know which one is active. */
export function getLocalPlayerRole(): PlayerRoleValue {
  return localRole
}

/** Sets the local role and sends it to the server. */
export function applyRole(role: PlayerRoleValue): void {
  localRole = role
  void room.send('setPlayerRole', { role })
}

/** Starts as spectator immediately and keeps localRole reconciled against the synced PlayerRole. Call once during client setup. */
export function startPlayerRoleSync(): void {
  applyRole(PlayerRoleValue.Spectate)
  engine.addSystem(reconcileLocalRoleSystem)
}

/**
 * Only reacts to the synced role when it has actually changed since last
 * observed — not whenever it merely differs from localRole. Right after
 * applyRole's optimistic set, a live read of the synced PlayerRole is
 * briefly stale (the server hasn't processed setPlayerRole yet); comparing
 * against "what's rendered" instead of "what was last observed" would treat
 * that staleness as a real mismatch and revert the just-applied choice back
 * to the old role, only to flip again once the real update lands — visibly
 * twitching. Gating on an actual change makes the stale read a no-op.
 */
function reconcileLocalRoleSystem(): void {
  const localId = getLocalUserId().toLowerCase()
  for (const [, data] of engine.getEntitiesWith(PlayerRole)) {
    if (data.playerId.toLowerCase() !== localId) continue
    if (data.role === lastSyncedRole) return // nothing new from the server since last frame
    lastSyncedRole = data.role
    localRole = data.role
    return
  }
}
