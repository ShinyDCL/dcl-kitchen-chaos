// Tracks whatever item is currently attached to the player's right hand.
// Uses the parent+child AvatarAttach pattern: an invisible parent tracks
// the hand anchor, and one or more visible model entities sit under it.
//
// Most pickups are a single model (attachItemToPlayerHand). Picking up
// everything off a plate on a preparation counter is an "assembled" stack
// of models (attachAssembledItemToPlayerHand) — the first model uses its
// configured hand offset/rotation/scale (itemHandTransforms.ts) as the
// stack's base, and subsequent models stack directly above it using
// itemHeights.ts, the same way preparationCounterState.ts stacks items on
// a counter.
//
// takeHeldItem only returns a model for a single-item hold — it returns
// null for an assembled stack, since there's no single model to hand back;
// callers that need to know whether an assembled item is held should check
// isHoldingAssembledItem(). discardHeldItem removes whatever's held
// (single or assembled) without returning anything.

import { AvatarAnchorPointType, AvatarAttach, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { getHandTransform } from './itemHandTransforms'
import { getItemHeight } from './itemHeights'

interface HeldItem {
  parent: Entity
  children: Entity[]
  models: string[]
}

let heldItem: HeldItem | null = null

export function attachItemToPlayerHand(model: string): void {
  attachModelsToPlayerHand([model])
}

/** Attaches a vertical stack of models as one assembled item — e.g. everything picked up off a plate. */
export function attachAssembledItemToPlayerHand(models: string[]): void {
  attachModelsToPlayerHand(models)
}

function attachModelsToPlayerHand(models: string[]): void {
  clearHeldItem()
  if (models.length === 0) return

  const parent = engine.addEntity()
  AvatarAttach.create(parent, {
    anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND
  })

  // The bottom item's configured hand transform anchors the whole stack;
  // items above it are positioned purely by cumulative height, not their
  // own individual hand offsets.
  const baseTransform = getHandTransform(models[0])
  const stackRoot = engine.addEntity()
  Transform.create(stackRoot, {
    position: baseTransform.position,
    rotation: baseTransform.rotation,
    scale: baseTransform.scale,
    parent
  })

  const children: Entity[] = [stackRoot]
  let cumulativeHeight = 0
  for (const model of models) {
    const item = engine.addEntity()
    Transform.create(item, { position: Vector3.create(0, cumulativeHeight, 0), parent: stackRoot })
    GltfContainer.create(item, { src: model })
    children.push(item)
    cumulativeHeight += getItemHeight(model)
  }

  heldItem = { parent, children, models }
}

/** True if the player currently has anything in hand (single item or assembled stack). */
export function hasHeldItem(): boolean {
  return heldItem !== null
}

/** True if the held item is a multi-model assembled stack rather than a single item. */
export function isHoldingAssembledItem(): boolean {
  return (heldItem?.models.length ?? 0) > 1
}

/** Returns the held item's model if it's a single item, or null if empty-handed or holding an assembled stack. */
export function peekHeldItemModel(): string | null {
  if (!heldItem || heldItem.models.length !== 1) return null
  return heldItem.models[0]
}

/** Removes a single-item hold and returns its model, or null if empty-handed or holding an assembled stack. */
export function takeHeldItem(): string | null {
  const model = peekHeldItemModel()
  if (model === null) return null
  clearHeldItem()
  return model
}

/** Removes whatever's held (single or assembled) without returning anything. */
export function discardHeldItem(): void {
  clearHeldItem()
}

function clearHeldItem(): void {
  if (heldItem === null) return
  for (const child of heldItem.children) engine.removeEntity(child)
  engine.removeEntity(heldItem.parent)
  heldItem = null
}

/** Removes the held item (single or assembled) and returns its models in stacking order, or an empty array if empty-handed. */
export function takeHeldItemModels(): string[] {
  const models = heldItem?.models ?? []
  clearHeldItem()
  return models
}
