// Renders every player's held item — including the local player's own
// hand — reconciled against the server-synced HeldItem component
// (shared/schemas.ts) rather than held as local truth, the same pattern
// preparationCounters.ts and stoveCooking.ts use. Uses the parent+child
// AvatarAttach pattern: an invisible parent tracks the hand anchor for a
// given avatarId, and one or more visible model entities sit under it.
//
// Most pickups are a single model (attachItemToPlayerHand). Picking up
// everything off a plate on a preparation counter is an "assembled" stack
// of models (attachAssembledItemToPlayerHand) — the first model uses its
// configured hand offset/rotation/scale (itemHandTransforms.ts) as the
// stack's base, and subsequent models stack directly above it using
// itemHeights.ts, the same way preparationCounters.ts stacks items on a
// counter.
//
// Local mutators (attachItemToPlayerHand, takeHeldItem, discardHeldItem,
// ...) render the local player's hand immediately for zero-latency
// feedback AND send a setHeldItem message so the server updates the synced
// component everyone reads. The reconciliation system started by
// startRenderingHeldItems compares every player's synced state (local
// player included) against what's currently rendered and corrects any
// mismatch — this is what makes the item visible to every OTHER player,
// and what corrects THIS client's own guess if the server ends up
// disagreeing with it (e.g. stoveCooking.ts's collectFromStove, which
// deliberately renders nothing optimistically because a race there would
// mean duplicating a scarce cooked item — see its comment). The server
// still doesn't validate WHICH model is legal for the general
// attach/discard path — see server/heldItems.ts — so outside of the stove
// collect flow this remains a visibility fix, not anti-cheat.
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

interface RenderedHeldItem {
  parent: Entity
  children: Entity[]
  models: string[]
}

const renderedHeldItems = new Map<string, RenderedHeldItem>() // keyed by lower-cased playerId

function localPlayerId(): string {
  return getLocalUserId().toLowerCase()
}

function localState(): RenderedHeldItem | undefined {
  return renderedHeldItems.get(localPlayerId())
}

export function attachItemToPlayerHand(model: string): void {
  attachModelsToPlayerHand([model])
}

/** Attaches a vertical stack of models as one assembled item — e.g. everything picked up off a plate. */
export function attachAssembledItemToPlayerHand(models: string[]): void {
  attachModelsToPlayerHand(models)
}

function attachModelsToPlayerHand(models: string[]): void {
  applyLocally(models)
}

/** Sends the local player's new hand contents to the server and renders it immediately, ahead of the round trip. */
function applyLocally(models: string[]): void {
  void room.send('setHeldItem', { models })
  renderHeldItem(localPlayerId(), models)
}

/** True if the player currently has anything in hand (single item or assembled stack). */
export function hasHeldItem(): boolean {
  return (localState()?.models.length ?? 0) > 0
}

/** True if the held item is a multi-model assembled stack rather than a single item. */
export function isHoldingAssembledItem(): boolean {
  return (localState()?.models.length ?? 0) > 1
}

/** Returns the held item's model if it's a single item, or null if empty-handed or holding an assembled stack. */
export function peekHeldItemModel(): string | null {
  const state = localState()
  if (!state || state.models.length !== 1) return null
  return state.models[0]
}

/** Removes a single-item hold and returns its model, or null if empty-handed or holding an assembled stack. */
export function takeHeldItem(): string | null {
  const model = peekHeldItemModel()
  if (model === null) return null
  applyLocally([])
  return model
}

/** Removes the held item (single or assembled) and returns its models in stacking order, or an empty array if empty-handed. */
export function takeHeldItemModels(): string[] {
  const models = localState()?.models ?? []
  applyLocally([])
  return models
}

/** Removes whatever's held (single or assembled) without returning anything. */
export function discardHeldItem(): void {
  applyLocally([])
}

// --- Rendering, reconciled against the synced HeldItem component ---

let systemRegistered = false

/** Starts rendering every player's held item, local player included. Call once during client setup. */
export function startRenderingHeldItems(): void {
  if (systemRegistered) return
  engine.addSystem(heldItemsSystem)
  systemRegistered = true
}

function heldItemsSystem(): void {
  const localId = localPlayerId()
  const seenPlayerIds = new Set<string>()

  for (const [, data] of engine.getEntitiesWith(HeldItem)) {
    const playerId = data.playerId.toLowerCase()
    seenPlayerIds.add(playerId)
    renderHeldItem(playerId, [...data.models])
  }

  for (const playerId of renderedHeldItems.keys()) {
    if (playerId === localId) continue // an unsynced local prediction is expected, not stale — see applyLocally
    if (!seenPlayerIds.has(playerId)) renderHeldItem(playerId, [])
  }
}

function renderHeldItem(playerId: string, models: string[]): void {
  const existing = renderedHeldItems.get(playerId)
  if (existing && sameModels(existing.models, models)) return
  if (existing) removeVisual(existing)

  if (models.length === 0) {
    renderedHeldItems.delete(playerId)
    return
  }
  renderedHeldItems.set(playerId, buildVisual(playerId, models))
}

function buildVisual(playerId: string, models: string[]): RenderedHeldItem {
  const parent = engine.addEntity()
  AvatarAttach.create(parent, { avatarId: playerId, anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })

  return { parent, children: buildHandStack(parent, models), models }
}

/**
 * Builds the visible model stack under a hand-anchor parent (already
 * AvatarAttach'd) and returns its child entities, stackRoot first. The
 * bottom item's configured hand transform anchors the whole stack; items
 * above it are positioned purely by cumulative height, not their own
 * individual hand offsets.
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

function removeVisual(item: RenderedHeldItem): void {
  for (const child of item.children) engine.removeEntity(child)
  engine.removeEntity(item.parent)
}

function sameModels(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((model, index) => model === b[index])
}
