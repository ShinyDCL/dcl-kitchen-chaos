// Owns the scene's single DeliveryState. A true singleton (see
// client/fixtures/layout.ts), so unlike preparationCounter.ts/stove.ts
// there's no per-fixture Map — one lazily-created entity, keyed by the
// client's fixture sync id.
//
// Delivers whatever the player's real HeldItem holds (heldItems.ts's
// getHeldItemModels), not a client-claimed stack.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { DeliveryState } from '../../shared/schemas'
import { isAdoptableEntity } from '../entityAdoption'
import { onPlayerAction } from '../players/activity'
import { getHeldItemModels, grantHeldItem } from '../players/heldItems'
import { evaluateDelivery } from '../progression/orderQueue'
import { onSessionStart } from '../session'

let deliveryEntity: Entity | null = null

export function initDeliveryCounter(): void {
  reconcileDeliveryEntity()

  // Clears the last delivery still on show. deliveryId is deliberately left
  // alone — it's a monotonic change detector, and rewinding it would read as
  // a fresh delivery to every client.
  onSessionStart(() => {
    if (deliveryEntity === null) return
    const mutable = DeliveryState.getMutableOrNull(deliveryEntity)
    if (mutable) mutable.models = []
  })

  onPlayerAction('deliverHeldItem', (data, playerId, address) => {
    const heldModels = getHeldItemModels(playerId)

    const success = evaluateDelivery(heldModels, address)
    grantHeldItem(playerId, [])

    const entity = getOrCreateDeliveryEntity(data.deliveryCounterId)
    const mutable = DeliveryState.getMutableOrNull(entity)
    if (!mutable) return
    mutable.models = heldModels
    mutable.success = success
    mutable.deliveryId += 1
  })
}

function getOrCreateDeliveryEntity(deliveryCounterId: number): Entity {
  if (deliveryEntity !== null && DeliveryState.getOrNull(deliveryEntity) !== null) return deliveryEntity

  const entity = engine.addEntity()
  DeliveryState.create(entity, { models: [], success: true, deliveryId: 0 })
  syncEntity(entity, [DeliveryState.componentId], deliveryCounterId)
  deliveryEntity = entity
  return entity
}

/** Re-adopts the delivery entity if it already exists in the CRDT snapshot from a previous server run. */
function reconcileDeliveryEntity(): void {
  for (const [entity] of engine.getEntitiesWith(DeliveryState)) {
    if (!isAdoptableEntity(entity)) continue
    deliveryEntity = entity
    return
  }
}
