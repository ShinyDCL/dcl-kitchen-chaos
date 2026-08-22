// Tracks whatever item is currently attached to the player's right hand.
// attachItemToPlayerHand swaps it out cleanly (deleting the old entity
// before attaching the new one); takeHeldItem removes it without
// replacing anything, for hand-offs like placing an item on a counter.

import { AvatarAnchorPointType, AvatarAttach, engine, Entity, GltfContainer } from '@dcl/sdk/ecs'

interface HeldItem {
  entity: Entity
  model: string
}

let heldItem: HeldItem | null = null

export function attachItemToPlayerHand(model: string): void {
  clearHeldItem()

  const entity = engine.addEntity()
  GltfContainer.create(entity, { src: model })
  AvatarAttach.create(entity, {
    anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND
  })

  heldItem = { entity, model }
}

/** True if the player currently has an item in hand. */
export function hasHeldItem(): boolean {
  return heldItem !== null
}

/** Removes the held item from the player's hand and returns its model, or null if the hand is empty. */
export function takeHeldItem(): string | null {
  if (heldItem === null) return null
  const model = heldItem.model
  clearHeldItem()
  return model
}

function clearHeldItem(): void {
  if (heldItem === null) return
  engine.removeEntity(heldItem.entity)
  heldItem = null
}
