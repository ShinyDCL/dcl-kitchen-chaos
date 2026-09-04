// Owns GameState: the scene-wide player count and the server heartbeat.
//
// Presence comes from two sources that answer different questions.
// onEnterScene/onLeaveScene are events — the only way to learn the moment
// someone arrives or leaves, which is what per-player setup and cleanup
// need. getConnectedPlayerIds reads PlayerIdentityData instead, which is
// the authoritative snapshot of who is here right now: it survives a
// server restart mid-session and can't drift if an event is ever missed.
// So events drive side effects, the snapshot drives the count.
//
// Everyone in the scene can act — there is no role and no permission
// check. Order queue size follows playerCount (see orderQueue.ts), while
// payouts use the narrower activity window in playerActivity.ts.

import { engine, Entity, PlayerIdentityData } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { getPlayer, onEnterScene, onLeaveScene } from '@dcl/sdk/players'

import { SERVER_HEARTBEAT_INTERVAL_MS } from '../shared/constants'
import { GAME_STATE_SYNC_ID, GameState } from '../shared/schemas'

type PlayerLifecycleHandler = (playerId: string) => void

const leaveHandlers: PlayerLifecycleHandler[] = []
let gameStateEntity: Entity | null = null

export function initPlayerRoster(): void {
  reconcileGameStateEntity()

  onLeaveScene((userId) => {
    const playerId = userId.toLowerCase()
    for (const handler of leaveHandlers) handler(playerId)
  })

  engine.addSystem(recomputePlayerCount)
  engine.addSystem(pulseServerHeartbeat)
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

/** Lower-cased addresses of everyone currently in the scene. */
export function getConnectedPlayerIds(): Set<string> {
  const connectedIds = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    connectedIds.add(identity.address.toLowerCase())
  }
  return connectedIds
}

/** Counts without allocating the Set getConnectedPlayerIds builds — this runs every frame. */
function countConnectedPlayers(): number {
  let count = 0
  for (const [] of engine.getEntitiesWith(PlayerIdentityData)) count++
  return count
}

function recomputePlayerCount(): void {
  const playerCount = countConnectedPlayers()

  const mutable = getGameStateMutable()
  if (mutable && mutable.playerCount !== playerCount) {
    mutable.playerCount = playerCount
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
  GameState.create(entity, { playerCount: 0, streak: 0, totalDeliveredOrders: 0, serverHeartbeatAt: Date.now() })
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
