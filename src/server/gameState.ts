// Owns the GameState singleton — the one synced entity every client reads
// for scene-wide state: how many players are here, the streak (written by
// orderQueue.ts), the all-time delivery count (deliveryStats.ts), and the
// server heartbeat.
//
// Other modules never touch the entity directly; they mutate through
// getGameStateMutable so entity creation and re-adoption stay in one place.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { SERVER_HEARTBEAT_INTERVAL_MS } from '../shared/constants'
import { GAME_STATE_SYNC_ID, GameState } from '../shared/schemas'
import { countConnectedPlayers } from './players/presence'

let gameStateEntity: Entity | null = null

export function initGameState(): void {
  reconcileGameStateEntity()

  engine.addSystem(recomputePlayerCount)
  engine.addSystem(pulseServerHeartbeat)
}

/** GameState's mutable data, for the modules that own a field on it (orderQueue.ts's streak, deliveryStats.ts's total). */
export function getGameStateMutable() {
  return GameState.getMutableOrNull(getOrCreateGameStateEntity())
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
  GameState.create(entity, { playerCount: 0, streak: 0, deliveries: 0, serverHeartbeatAt: Date.now() })
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
