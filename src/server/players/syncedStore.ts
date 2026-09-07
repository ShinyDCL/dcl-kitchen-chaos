// Shared per-player entity boilerplate: matched by the component's own
// playerId field, not network/sync id (see authoritative-server skill —
// explicit/hashed ids are unsafe on a long-running server). Used by
// heldItems.ts, playerCoins.ts.

import { Entity, EntityUtils, LastWriteWinElementSetComponentDefinition, RESERVED_STATIC_ENTITIES, engine } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

/** Call reconcile() once at init; look up/create entities by playerId (caller lower-cases it). */
export function createPerPlayerStore<T extends { playerId: string }>(
  component: LastWriteWinElementSetComponentDefinition<T>,
  makeDefault: (playerId: string) => T
) {
  const playerEntities = new Map<string, Entity>()

  function getEntity(playerId: string): Entity | undefined {
    return playerEntities.get(playerId)
  }

  function getOrCreateEntity(playerId: string): Entity {
    const cached = playerEntities.get(playerId)
    if (cached !== undefined && component.getOrNull(cached) !== null) return cached
    if (cached !== undefined) {
      playerEntities.delete(playerId)
      try {
        engine.removeEntity(cached)
      } catch {
        // already gone
      }
    }

    const entity = engine.addEntity()
    component.create(entity, makeDefault(playerId))
    syncEntity(entity, [component.componentId]) // no explicit id — auto-allocated, identity lives in playerId
    playerEntities.set(playerId, entity)
    return entity
  }

  /** Re-adopts entities that may exist in the CRDT snapshot from a prior server run. */
  function reconcile(): void {
    for (const [entity, data] of engine.getEntitiesWith(component)) {
      const [entityNumber] = EntityUtils.fromEntityId(entity)
      if (entityNumber < RESERVED_STATIC_ENTITIES) continue // runtime/avatar-owned — never adopt or remove these
      const playerId = data.playerId.toLowerCase()
      const existing = playerEntities.get(playerId)
      if (existing === undefined) {
        playerEntities.set(playerId, entity)
      } else if (existing !== entity) {
        engine.removeEntity(entity)
      }
    }
  }

  /**
   * Writes makeDefault back over every tracked entity — heldItems.ts empties
   * hands with this at the start of a session.
   *
   * Deliberately a rewrite rather than removing the entities: client
   * reconciliation ignores its own player's entity going missing (an
   * unsynced local prediction looks the same), so a removal would leave that
   * player rendering an item the server no longer thinks they hold. A
   * changed value is the update path clients already act on.
   */
  function resetAll(): void {
    for (const [playerId, entity] of playerEntities) {
      const mutable = component.getMutableOrNull(entity)
      if (mutable) Object.assign(mutable, makeDefault(playerId))
    }
  }

  /**
   * Removes every tracked entity. Only safe with the scene empty (session.ts
   * calls it on session end): client reconciliation ignores its own player's
   * entity going missing, since an unsynced local prediction looks the same,
   * so a present player would keep rendering what the removed entity held.
   * resetAll is the one to use while anyone is watching.
   *
   * Entities are otherwise never removed, and reconcile() re-adopts them from
   * the CRDT snapshot across restarts — so without this they accumulate one
   * per visitor for the life of the room, and every joining client downloads
   * the lot.
   */
  function clear(): void {
    for (const [, entity] of playerEntities) {
      try {
        engine.removeEntity(entity)
      } catch {
        // already gone
      }
    }
    playerEntities.clear()
  }

  return { getEntity, getOrCreateEntity, reconcile, resetAll, clear }
}
