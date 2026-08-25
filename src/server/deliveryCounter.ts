// Owns the scene's single DeliveryState. A true singleton (the scene only
// ever creates one delivery counter — see client/sceneLayout.ts), so
// unlike preparationCounters.ts/stoveCooking.ts there's no per-fixture Map:
// just one lazily-created entity, keyed by whatever explicit sync id the
// client's fixture happened to get (client/fixtures.ts's getFixtureSyncId)
// so it doesn't collide with any other fixture's explicit-id entity in the
// same global id space. Nothing scarce is handed out here (unlike the
// stove), so this is a plain relay: the client already took the item out
// of its own hand before sending, and this just timestamps it into the
// synced state everyone animates from.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { room } from '../shared/messages'
import { DeliveryState } from '../shared/schemas'

let deliveryEntity: Entity | null = null

export function initDeliveryCounter(): void {
  reconcileDeliveryEntity()

  room.onMessage('deliverHeldItem', (data, context) => {
    if (!context) return
    const entity = getOrCreateDeliveryEntity(data.deliveryCounterId)
    const mutable = DeliveryState.getMutableOrNull(entity)
    if (!mutable) return
    mutable.models = data.models
    mutable.startTimestamp = Date.now()
  })
}

function getOrCreateDeliveryEntity(deliveryCounterId: number): Entity {
  if (deliveryEntity !== null && DeliveryState.getOrNull(deliveryEntity) !== null) return deliveryEntity

  const entity = engine.addEntity()
  DeliveryState.create(entity, { models: [], startTimestamp: 0 })
  syncEntity(entity, [DeliveryState.componentId], deliveryCounterId)
  deliveryEntity = entity
  return entity
}

/** Re-adopts the delivery entity if it already exists in the CRDT snapshot from a previous server run. */
function reconcileDeliveryEntity(): void {
  for (const [entity] of engine.getEntitiesWith(DeliveryState)) {
    deliveryEntity = entity
    return
  }
}
