// Tracks whatever item is currently attached to the player's right hand and
// swaps it out cleanly — deleting the old entity before attaching the new one.

import { AvatarAnchorPointType, AvatarAttach, engine, Entity, GltfContainer } from '@dcl/sdk/ecs'

let currentHeldItem: Entity | null = null

export function attachItemToPlayerHand(model: string): void {
  if (currentHeldItem !== null) {
    engine.removeEntity(currentHeldItem)
    currentHeldItem = null
  }

  const item = engine.addEntity()
  GltfContainer.create(item, { src: model })
  AvatarAttach.create(item, {
    anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND
  })

  currentHeldItem = item
}
