// Tracks whatever item is currently attached to the player's right hand.
// Uses the parent+child AvatarAttach pattern: an
// invisible parent tracks the hand anchor (its own Transform gets
// overwritten every frame by AvatarAttach), and the visible model is a
// child of that parent with a per-item position/rotation/scale offset —
// see itemHandTransforms.ts, since each model's pivot and size differ.
//
// attachItemToPlayerHand swaps the held item out cleanly (removing the old
// parent+child pair before creating a new one); takeHeldItem removes it
// without replacing anything, for hand-offs like placing an item on a
// counter or starting to cook it. peekHeldItemModel checks what's held
// without removing it, for interactions that need to decide first.

import { AvatarAnchorPointType, AvatarAttach, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'

import { getHandTransform } from './itemHandTransforms'

interface HeldItem {
  parent: Entity
  child: Entity
  model: string
}

let heldItem: HeldItem | null = null

export function attachItemToPlayerHand(model: string): void {
  clearHeldItem()

  const parent = engine.addEntity()
  AvatarAttach.create(parent, {
    anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND
  })

  const handTransform = getHandTransform(model)
  const child = engine.addEntity()
  Transform.create(child, {
    position: handTransform.position,
    rotation: handTransform.rotation,
    scale: handTransform.scale,
    parent
  })
  GltfContainer.create(child, { src: model })

  heldItem = { parent, child, model }
}

/** True if the player currently has an item in hand. */
export function hasHeldItem(): boolean {
  return heldItem !== null
}

/** Returns the currently held item's model without removing it, or null if the hand is empty. */
export function peekHeldItemModel(): string | null {
  return heldItem?.model ?? null
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
  // Remove the child (visible model) and the parent (AvatarAttach anchor)
  engine.removeEntity(heldItem.child)
  engine.removeEntity(heldItem.parent)
  heldItem = null
}
