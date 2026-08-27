// Owns the scene's single DeliveryState. A true singleton (see
// client/sceneLayout.ts), so unlike preparationCounters.ts/stoveCooking.ts
// there's no per-fixture Map — one lazily-created entity, keyed by
// whatever explicit sync id the client's fixture got (getFixtureSyncId).
// The claimed models are verified against the player's real held item
// (heldItems.ts's getHeldItemModels) before being trusted — a modified
// client could otherwise claim to be delivering items it never actually
// held, matching any recipe for free. A mismatch is rejected outright
// (actionRejected, restoring the client's optimistically-cleared hand);
// this is separate from a verified-but-wrong delivery (an honestly held
// combination that just doesn't match a recipe), which still "succeeds"
// visually and consumes the hand — recipeQueue.ts's evaluateDelivery
// decides that verdict (DeliveryState.success) so every client shows the
// right flourish.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { room } from '../shared/messages'
import { DeliveryState } from '../shared/schemas'
import { getHeldItemModels, grantHeldItem, sameModels } from './heldItems'
import { isPlayerAllowedToAct } from './playerRoster'
import { evaluateDelivery } from './recipeQueue'

let deliveryEntity: Entity | null = null

export function initDeliveryCounter(): void {
  reconcileDeliveryEntity()

  room.onMessage('deliverHeldItem', (data, context) => {
    if (!context || !isPlayerAllowedToAct(context.from)) return
    const playerId = context.from.toLowerCase()
    const heldModels = getHeldItemModels(playerId)
    if (!sameModels(heldModels, data.models)) {
      void room.send('actionRejected', {}, { to: [context.from] })
      return
    }

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
