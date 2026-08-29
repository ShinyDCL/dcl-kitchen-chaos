// Owns the scene's single DeliveryState. A true singleton (see
// client/fixtures/sceneLayout.ts), so unlike preparationCounters.ts/stoveCooking.ts
// there's no per-fixture Map — one lazily-created entity, keyed by the
// client's fixture sync id.
//
// Delivers whatever the player's real HeldItem holds (heldItems.ts's
// getHeldItemModels), not a client-claimed stack.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { room } from '../../shared/messages'
import { DeliveryState } from '../../shared/schemas'
import { getHeldItemModels, grantHeldItem } from '../heldItems'
import { evaluateDelivery } from '../orderQueue'
import { isPlayerAllowedToAct } from '../playerRoster'

let deliveryEntity: Entity | null = null

export function initDeliveryCounter(): void {
  reconcileDeliveryEntity()

  room.onMessage('deliverHeldItem', (data, context) => {
    if (!context || !isPlayerAllowedToAct(context.from)) return
    const playerId = context.from.toLowerCase()
    const heldModels = getHeldItemModels(playerId)

    const success = evaluateDelivery(heldModels, context.from)
    grantHeldItem(playerId, [])

    const entity = getOrCreateDeliveryEntity(data.deliveryCounterId)
    const mutable = DeliveryState.getMutableOrNull(entity)
    if (!mutable) return
    mutable.models = heldModels
    mutable.startTimestamp = Date.now()
    mutable.success = success
  })
}

function getOrCreateDeliveryEntity(deliveryCounterId: number): Entity {
  if (deliveryEntity !== null && DeliveryState.getOrNull(deliveryEntity) !== null) return deliveryEntity

  const entity = engine.addEntity()
  DeliveryState.create(entity, { models: [], startTimestamp: 0, success: true })
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
