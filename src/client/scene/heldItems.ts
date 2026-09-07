// Renders every player's held item, the local hand included, reconciled
// against the synced HeldItem component rather than held as local truth.
// Parent+child AvatarAttach: an invisible parent tracks the hand anchor,
// visible models sit under it, stacked by itemPlacement.ts's heights from the
// first model's hand transform.
//
// Local mutators render immediately and send setHeldItem, skipping both when
// the models already match what is held. Reconciliation is what makes an item
// visible to other players and what corrects this client when the server
// disagrees. setHeldItem is unvalidated (see server/players/heldItems.ts), so
// outside the stove flow this is a visibility fix, not anti-cheat.

import { AvatarAnchorPointType, AvatarAttach, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { room } from '../../shared/messages'
import { sameModels } from '../../shared/models'
import { HeldItem } from '../../shared/schemas'
import { getLocalUserId } from '../playerIdentity'
import { getHandTransform } from './itemPlacement'
import { getItemHeight } from './itemPlacement'

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
  applyLocally([model])
}

/** Sends the local player's new hand contents to the server and renders it immediately, ahead of the round trip. */
function applyLocally(models: string[]): void {
  if (sameModels(models, localState()?.models ?? [])) return // already holding this — nothing would change, so skip the network round trip

  pendingRestoreModels = null // this hand change fully commits, superseding any still-outstanding pending restore — see takeHeldItemPending's comment
  void room.send('setHeldItem', { models })
  renderHeldItem(localPlayerId(), models)
}

/** True if the player currently has anything in hand (single item or assembled stack). */
export function hasHeldItem(): boolean {
  return (localState()?.models.length ?? 0) > 0
}

/** How many models are in hand: 0 empty, 1 for a single item, more for an assembled stack. */
export function getHeldItemCount(): number {
  return localState()?.models.length ?? 0
}

/** True if the held item is a multi-model assembled stack rather than a single item. */
export function isHoldingAssembledItem(): boolean {
  return (localState()?.models.length ?? 0) > 1
}

/** Returns the held item's model if it's a single item, or null if empty-handed or holding an assembled stack. */
export function peekHeldItemModel(): string | null {
  const state = localState()
  if (!state || state.models.length !== 1) return null
  return state.models[0] ?? null
}

/** Removes whatever's held (single or assembled) without returning anything. */
export function discardHeldItem(): void {
  applyLocally([])
}

/**
 * Clears the hand locally and returns its models WITHOUT broadcasting
 * setHeldItem — for actions whose paired message carries no models and reads
 * the HeldItem server-side instead (placeOnCounter, deliverHeldItem).
 * Broadcasting would race ahead and clear the server's copy before its handler
 * reads it, delivering or placing nothing.
 */
export function takeHeldItemModels(): string[] {
  const models = localState()?.models ?? []
  renderHeldItem(localPlayerId(), [])
  return models
}

let pendingRestoreModels: string[] | null = null

/**
 * For a fixture action whose outcome isn't known yet. Clears the prediction
 * WITHOUT broadcasting: the paired handler grants the empty hand on success or
 * sends actionRejected on failure, which restorePendingHeldItem acts on.
 * Broadcasting unconditionally is how items used to vanish or duplicate.
 *
 * A single slot — applyLocally and heldItemsSystem null it out on an unrelated
 * hand change, so a stale rejection can't restore over a hand that moved on.
 */
export function takeHeldItemPending(): string | null {
  const model = peekHeldItemModel()
  if (model === null) return null
  pendingRestoreModels = [model]
  renderHeldItem(localPlayerId(), [])
  return model
}

/** Restores whatever the most recent *Pending call cleared, when its paired fixture action was rejected by the server. */
function restorePendingHeldItem(): void {
  if (pendingRestoreModels === null) return
  renderHeldItem(localPlayerId(), pendingRestoreModels)
  pendingRestoreModels = null
}

// --- Rendering, reconciled against the synced HeldItem component ---

let systemRegistered = false

/** Starts rendering every player's held item, local player included. Call once during client setup. */
export function startRenderingHeldItems(): void {
  if (systemRegistered) return
  engine.addSystem(heldItemsSystem)
  room.onMessage('actionRejected', () => restorePendingHeldItem())
  systemRegistered = true
}

const lastSyncedHeldItems = new Map<string, string[]>() // last models actually observed from the synced component, per playerId

/**
 * Reacts only when a player's synced state has actually changed since last
 * observed, not whenever it differs from what is rendered: right after this
 * client's own applyLocally a live read is briefly stale, and reacting would
 * flicker. Compares before copying, so unchanged players cost no allocation.
 */
function heldItemsSystem(): void {
  const localId = localPlayerId()
  const seenPlayerIds = new Set<string>()

  for (const [, data] of engine.getEntitiesWith(HeldItem)) {
    const playerId = data.playerId.toLowerCase()
    seenPlayerIds.add(playerId)

    const lastSynced = lastSyncedHeldItems.get(playerId)
    if (lastSynced && sameModels(data.models, lastSynced)) continue // nothing new from the server since last frame
    const models = [...data.models]
    lastSyncedHeldItems.set(playerId, models)

    // An authoritative update to our own hand supersedes any still-outstanding pending restore — see takeHeldItemPending's comment.
    if (playerId === localId) pendingRestoreModels = null

    renderHeldItem(playerId, models)
  }

  // playerId is never reused, so without this a disconnected player lingers here forever.
  for (const playerId of renderedHeldItems.keys()) {
    if (playerId === localId) continue // an unsynced local prediction is expected, not stale — see applyLocally
    if (!seenPlayerIds.has(playerId)) renderHeldItem(playerId, [])
  }
  for (const playerId of lastSyncedHeldItems.keys()) {
    if (playerId === localId) continue
    if (!seenPlayerIds.has(playerId)) lastSyncedHeldItems.delete(playerId)
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
 * Builds the visible model stack under an already-attached hand anchor and
 * returns its children, stackRoot first. The bottom item's configured hand
 * transform anchors the whole stack; items above it are placed by cumulative
 * height alone, not their own hand offsets.
 */
function buildHandStack(parent: Entity, models: string[]): Entity[] {
  const baseTransform = getHandTransform(models[0] ?? '')
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
