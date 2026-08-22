// Preparation counters: empty counters where the player can stack items.
// Pressing the interact button while focused on one takes whatever's in
// the player's hand and places it on top of the counter's current stack,
// offset by the cumulative height of whatever's already placed there.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { COUNTER_HEIGHT } from './constants'
import { hasHeldItem, takeHeldItem } from './heldItem'
import { getItemHeight } from './itemHeights'

// Cumulative stack height per counter, keyed by the counter's own entity.
const stackHeights = new Map<Entity, number>()

/** Places whatever the player is holding on top of the given counter's stack. Does nothing if the player's hands are empty. */
export function placeHeldItemOnCounter(counter: Entity): void {
  if (!hasHeldItem()) return

  const model = takeHeldItem()
  if (!model) return

  const currentStackHeight = stackHeights.get(counter) ?? 0

  const item = engine.addEntity()
  Transform.create(item, {
    position: Vector3.create(0, COUNTER_HEIGHT + currentStackHeight, 0),
    parent: counter
  })
  GltfContainer.create(item, { src: model })

  stackHeights.set(counter, currentStackHeight + getItemHeight(model))
}
