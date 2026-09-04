// Owns every player's PlayerRole and the derived GameState.activePlayerCount.
// No legality check on the role itself — it's never contested.
//
// activePlayerCount intersects PlayerRole ('play' entries) with live
// PlayerIdentityData (who's actually connected), so a disconnect drops a
// player from the count for free, no explicit "leave" message needed.
//
// isPlayerAllowedToAct is the server-side half of spectator gating — the
// client already hides highlight/interaction (see focusManager.ts), but
// every server module calls this too so a modified client can't bypass it.

import { engine, Entity, PlayerIdentityData } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/src/players'

import { SERVER_HEARTBEAT_INTERVAL_MS } from '../shared/constants'
import { room } from '../shared/messages'
import { GAME_STATE_SYNC_ID, GameState, PlayerRole, PlayerRoleValue } from '../shared/schemas'
import { createPerPlayerStore } from './perPlayerSyncedStore'

const store = createPerPlayerStore(PlayerRole, (playerId) => ({ playerId, role: PlayerRoleValue.Spectate }))
let gameStateEntity: Entity | null = null

export function initPlayerRoster(): void {
  store.reconcile()
  reconcileGameStateEntity()

  room.onMessage('setPlayerRole', (data, context) => {
    if (!context) return
    const entity = store.getOrCreateEntity(context.from.toLowerCase())
    const mutable = PlayerRole.getMutableOrNull(entity)
    if (!mutable) return
    mutable.role = data.role
  })

  engine.addSystem(recomputeActivePlayerCount)
  engine.addSystem(pulseServerHeartbeat)
}

/** Whether the given player is currently allowed to act on fixtures — i.e. their PlayerRole is 'play'. */
export function isPlayerAllowedToAct(playerId: string): boolean {
  const entity = store.getEntity(playerId.toLowerCase())
  if (entity === undefined) return false
  return PlayerRole.getOrNull(entity)?.role === PlayerRoleValue.Play
}

/** Lower-cased playerIds of every currently-connected 'play'-role player. */
export function getActivePlayerIds(): string[] {
  const connectedIds = getConnectedPlayerIds()
  const activeIds: string[] = []
  for (const [, role] of engine.getEntitiesWith(PlayerRole)) {
    if (role.role === PlayerRoleValue.Play && connectedIds.has(role.playerId.toLowerCase())) {
      activeIds.push(role.playerId.toLowerCase())
    }
  }
  return activeIds
}

/** GameState's mutable data, for other modules that own a field on it (orderQueue.ts's streak). */
export function getGameStateMutable() {
  return GameState.getMutableOrNull(getOrCreateGameStateEntity())
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

/** Lower-cased addresses of everyone currently connected, whatever their role. */
export function getConnectedPlayerIds(): Set<string> {
  const connectedIds = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    connectedIds.add(identity.address.toLowerCase())
  }
  return connectedIds
}

/** Short-circuits on the first entity, unlike getConnectedPlayerIds — this runs every frame and an empty scene shouldn't pay for a Set. */
function hasConnectedPlayers(): boolean {
  for (const [] of engine.getEntitiesWith(PlayerIdentityData)) return true
  return false
}

function recomputeActivePlayerCount(): void {
  // Skips building the Set and array getActivePlayerIds allocates when the
  // scene is empty — the answer is 0 either way.
  const activePlayerCount = hasConnectedPlayers() ? getActivePlayerIds().length : 0

  const mutable = getGameStateMutable()
  if (mutable && mutable.activePlayerCount !== activePlayerCount) {
    mutable.activePlayerCount = activePlayerCount
  }
}

let lastHeartbeatAt = 0

/**
 * Pulses GameState.serverHeartbeatAt every SERVER_HEARTBEAT_INTERVAL_MS so
 * clients can detect this server is actually alive — see
 * client/serverReadiness.ts.
 *
 * Deliberately unconditional, even with nobody in the scene: the platform
 * already shuts an empty server down after ~2 minutes, so gating this on
 * player presence would save almost nothing while putting the one signal
 * the entry overlay depends on at risk.
 */
function pulseServerHeartbeat(): void {
  const now = Date.now()
  if (now - lastHeartbeatAt < SERVER_HEARTBEAT_INTERVAL_MS) return
  lastHeartbeatAt = now

  const mutable = getGameStateMutable()
  if (mutable) mutable.serverHeartbeatAt = now
}

function getOrCreateGameStateEntity(): Entity {
  if (gameStateEntity !== null && GameState.getOrNull(gameStateEntity) !== null) return gameStateEntity

  const entity = engine.addEntity()
  // Publish the first heartbeat immediately so a client connecting right
  // after a cold start doesn't have to wait a full interval to see one.
  GameState.create(entity, { activePlayerCount: 0, streak: 0, totalDeliveredOrders: 0, serverHeartbeatAt: Date.now() })
  syncEntity(entity, [GameState.componentId], GAME_STATE_SYNC_ID)
  gameStateEntity = entity
  return entity
}

/** Re-adopts the GameState entity if it already exists in the CRDT snapshot from a previous server run. */
function reconcileGameStateEntity(): void {
  for (const [entity] of engine.getEntitiesWith(GameState)) {
    gameStateEntity = entity
    return
  }
}
