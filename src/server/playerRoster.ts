// Owns every player's PlayerRole and the derived GameState.activePlayerCount.
// Unlike heldItems.ts, there's no legality check here — a role choice is
// never contested, so the handler just writes what the client sent.
//
// activePlayerCount comes from intersecting PlayerRole ('play' entries)
// with engine.getEntitiesWith(PlayerIdentityData) — the engine's own live
// view of who is actually connected right now. This is what makes a
// disconnect (tab closed, connection dropped, no explicit "leave" message)
// reflected for free: the moment a player's PlayerIdentityData entity is
// gone, they drop out of the count on the very next tick.

import { engine, Entity, EntityUtils, PlayerIdentityData, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

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
}

function recomputeActivePlayerCount(): void {
  const connectedIds = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    connectedIds.add(identity.address.toLowerCase())
  }

  let activePlayerCount = 0
  for (const [, role] of engine.getEntitiesWith(PlayerRole)) {
    if (role.role === PlayerRoleValue.Play && connectedIds.has(role.playerId.toLowerCase())) {
      activePlayerCount++
    }
  }

  const mutable = GameState.getMutableOrNull(getOrCreateGameStateEntity())
  if (mutable && mutable.activePlayerCount !== activePlayerCount) {
    mutable.activePlayerCount = activePlayerCount
  }
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
  GameState.create(entity, { activePlayerCount: 0 })
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
