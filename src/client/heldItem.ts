// Tracks whatever item is currently attached to the LOCAL player's right
// hand, and renders it instantly with no network round-trip. Uses the
// parent+child AvatarAttach pattern: an invisible parent tracks the hand
// anchor, and one or more visible model entities sit under it.
//
// Most pickups are a single model (attachItemToPlayerHand). Picking up
// everything off a plate on a preparation counter is an "assembled" stack
// of models (attachAssembledItemToPlayerHand) — the first model uses its
// configured hand offset/rotation/scale (itemHandTransforms.ts) as the
// stack's base, and subsequent models stack directly above it using
// itemHeights.ts, the same way preparationCounters.ts stacks items on a
// counter.
//
// This is server-authoritative multiplayer (see the authoritative-server
// skill), not the serverless syncEntity pattern — so the local player's own
// hand renders immediately from local state, and every change also sends a
// setHeldItem message so the server can update the synced HeldItem
// component (shared/schemas.ts) that everyone else reads. The second half
// of this file, starting at startRenderingRemoteHeldItems, reacts to that
// synced component to build/tear down the same kind of hand-anchored
// visual for every OTHER player, since their state only arrives over the
// network. The server doesn't validate WHICH model is legal to hold yet —
// see server/heldItems.ts — so this is a visibility fix, not anti-cheat.
//
// takeHeldItem only returns a model for a single-item hold — it returns
// null for an assembled stack, since there's no single model to hand back;
// callers that need to know whether an assembled item is held should check
// isHoldingAssembledItem(). takeHeldItemModels returns every model
// regardless of shape. discardHeldItem removes whatever's held (single or
// assembled) without returning anything.

import { AvatarAnchorPointType, AvatarAttach, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { room } from '../shared/messages'
import { HeldItem } from '../shared/schemas'
import { getHandTransform } from './itemHandTransforms'
import { getItemHeight } from './itemHeights'
import { getLocalUserId } from './playerIdentity'

// --- Local player's own held item ---

interface LocalHeldItem {
  parent: Entity
  children: Entity[]
  models: string[]
}

let heldItem: LocalHeldItem | null = null

export function attachItemToPlayerHand(model: string): void {
  attachModelsToPlayerHand([model])
}

/** Attaches a vertical stack of models as one assembled item — e.g. everything picked up off a plate. */
export function attachAssembledItemToPlayerHand(models: string[]): void {
  attachModelsToPlayerHand(models)
}

function attachModelsToPlayerHand(models: string[]): void {
  clearLocalVisuals()
  if (models.length === 0) return

  const parent = engine.addEntity()
  AvatarAttach.create(parent, { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })

  heldItem = { parent, children: buildHandStack(parent, models), models }
  void room.send('setHeldItem', { models })
}

/**
 * Builds the visible model stack under a hand-anchor parent (already
 * AvatarAttach'd, either to the local player by default or to a specific
 * avatarId for a remote one) and returns its child entities, stackRoot
 * first. The bottom item's configured hand transform anchors the whole
 * stack; items above it are positioned purely by cumulative height, not
 * their own individual hand offsets.
 */
function buildHandStack(parent: Entity, models: string[]): Entity[] {
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

  return children
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

/** Removes the held item (single or assembled) and returns its models in stacking order, or an empty array if empty-handed. */
export function takeHeldItemModels(): string[] {
  const models = heldItem?.models ?? []
  clearHeldItem()
  return models
}

/** Removes whatever's held (single or assembled) without returning anything. */
export function discardHeldItem(): void {
  clearHeldItem()
}

function clearHeldItem(): void {
  if (heldItem === null) return
  clearLocalVisuals()
  void room.send('setHeldItem', { models: [] })
}

function clearLocalVisuals(): void {
  if (heldItem === null) return
  for (const child of heldItem.children) engine.removeEntity(child)
  engine.removeEntity(heldItem.parent)
  heldItem = null
}

// --- Every other player's held item, driven by the synced HeldItem component ---

interface RemoteHeldItem {
  parent: Entity
  children: Entity[]
  models: string[]
}

const remoteHeldItems = new Map<string, RemoteHeldItem>() // keyed by lower-cased playerId
let remoteSystemRegistered = false

/** Starts rendering every other player's held item. Call once during client setup. */
export function startRenderingRemoteHeldItems(): void {
  if (remoteSystemRegistered) return
  engine.addSystem(remoteHeldItemsSystem)
  remoteSystemRegistered = true
}

function remoteHeldItemsSystem(): void {
  const localPlayerId = getLocalUserId().toLowerCase()
  const seenPlayerIds = new Set<string>()

  for (const [, data] of engine.getEntitiesWith(HeldItem)) {
    const playerId = data.playerId.toLowerCase()
    if (playerId === localPlayerId) continue // rendered instantly above, not from synced state
    seenPlayerIds.add(playerId)
    syncRemoteHeldItem(playerId, [...data.models])
  }

  for (const playerId of remoteHeldItems.keys()) {
    if (!seenPlayerIds.has(playerId)) removeRemoteHeldItem(playerId)
  }
}

function syncRemoteHeldItem(playerId: string, models: string[]): void {
  const existing = remoteHeldItems.get(playerId)
  if (existing && sameModels(existing.models, models)) return
  if (existing) removeRemoteVisual(existing)

  if (models.length === 0) {
    remoteHeldItems.delete(playerId)
    return
  }
  remoteHeldItems.set(playerId, buildRemoteVisual(playerId, models))
}

function removeRemoteHeldItem(playerId: string): void {
  const existing = remoteHeldItems.get(playerId)
  if (!existing) return
  removeRemoteVisual(existing)
  remoteHeldItems.delete(playerId)
}

function buildRemoteVisual(playerId: string, models: string[]): RemoteHeldItem {
  const parent = engine.addEntity()
  AvatarAttach.create(parent, { avatarId: playerId, anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })

  return { parent, children: buildHandStack(parent, models), models }
}

function removeRemoteVisual(item: RemoteHeldItem): void {
  for (const child of item.children) engine.removeEntity(child)
  engine.removeEntity(item.parent)
}

function sameModels(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((model, index) => model === b[index])
}
