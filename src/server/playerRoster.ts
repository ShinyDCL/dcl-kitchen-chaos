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

import { engine, Entity, EntityUtils, PlayerIdentityData, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/src/players'

import { SERVER_HEARTBEAT_INTERVAL_MS } from '../shared/constants'
import { room } from '../shared/messages'
import { GAME_STATE_SYNC_ID, GameState, PlayerRole, PlayerRoleValue } from '../shared/schemas'

const playerEntities = new Map<string, Entity>()
let gameStateEntity: Entity | null = null

export function initPlayerRoster(): void {
  reconcilePlayerEntities()
  reconcileGameStateEntity()

  room.onMessage('setPlayerRole', (data, context) => {
    if (!context) return
    const entity = getOrCreatePlayerEntity(context.from.toLowerCase())
    const mutable = PlayerRole.getMutableOrNull(entity)
    if (!mutable) return
    mutable.role = data.role
  })

  engine.addSystem(recomputeActivePlayerCount)
  engine.addSystem(pulseServerHeartbeat)
}

/** Whether the given player is currently allowed to act on fixtures — i.e. their PlayerRole is 'play'. */
export function isPlayerAllowedToAct(playerId: string): boolean {
  const entity = playerEntities.get(playerId.toLowerCase())
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

/** GameState's mutable data, for other modules that own a field on it (recipeQueue.ts's streak). */
export function getGameStateMutable() {
  return GameState.getMutableOrNull(getOrCreateGameStateEntity())
}

/** Display name for a player address, used in the recipe HUD's "delivered by" message. */
export function getPlayerDisplayName(playerId: string): string {
  const name = getPlayer({ userId: playerId })?.name
  return name && name.length > 0 ? name : 'A player'
}

function getConnectedPlayerIds(): Set<string> {
  const connectedIds = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    connectedIds.add(identity.address.toLowerCase())
  }
  return connectedIds
}

function recomputeActivePlayerCount(): void {
  const activePlayerCount = getActivePlayerIds().length

  const mutable = getGameStateMutable()
  if (mutable && mutable.activePlayerCount !== activePlayerCount) {
    mutable.activePlayerCount = activePlayerCount
  }
}

let lastHeartbeatAt = 0

/** Pulses GameState.serverHeartbeatAt every SERVER_HEARTBEAT_INTERVAL_MS so clients can detect this server is actually alive — see client/serverReadiness.ts. */
function pulseServerHeartbeat(): void {
  const now = Date.now()
  if (now - lastHeartbeatAt < SERVER_HEARTBEAT_INTERVAL_MS) return
  lastHeartbeatAt = now

  const mutable = getGameStateMutable()
  if (mutable) mutable.serverHeartbeatAt = now
}

function getOrCreatePlayerEntity(playerId: string): Entity {
  const cached = playerEntities.get(playerId)
  if (cached !== undefined && PlayerRole.getOrNull(cached) !== null) return cached
  if (cached !== undefined) {
    playerEntities.delete(playerId)
    try {
      engine.removeEntity(cached)
    } catch {
      // already gone
    }
  }

  const entity = engine.addEntity()
  PlayerRole.create(entity, { playerId, role: PlayerRoleValue.Spectate })
  syncEntity(entity, [PlayerRole.componentId]) // no explicit id — auto-allocated, identity lives in playerId
  playerEntities.set(playerId, entity)
  return entity
}

/** Re-adopts PlayerRole entities that may already exist in the CRDT snapshot from a previous server run. */
function reconcilePlayerEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(PlayerRole)) {
    const [entityNumber] = EntityUtils.fromEntityId(entity)
    if (entityNumber < RESERVED_STATIC_ENTITIES) continue
    const playerId = data.playerId.toLowerCase()
    const existing = playerEntities.get(playerId)
    if (existing === undefined) {
      playerEntities.set(playerId, entity)
    } else if (existing !== entity) {
      engine.removeEntity(entity)
    }
  }
}

function getOrCreateGameStateEntity(): Entity {
  if (gameStateEntity !== null && GameState.getOrNull(gameStateEntity) !== null) return gameStateEntity

  const entity = engine.addEntity()
  // Publish the first heartbeat immediately so a client connecting right
  // after a cold start doesn't have to wait a full interval to see one.
  GameState.create(entity, { activePlayerCount: 0, streak: 0, serverHeartbeatAt: Date.now() })
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
