// Renders every player's held item, including the local player's own hand,
// reconciled against the server-synced HeldItem component rather than held
// as local truth — same pattern as preparationCounter.ts/stove.ts.
// Uses the parent+child AvatarAttach pattern: an invisible parent tracks
// the hand anchor, one or more visible model entities sit under it.
//
// Most pickups are a single model; taking a whole counter stack is an
// "assembled" stack — the first model's hand transform (itemPlacement.ts)
// anchors the stack, later ones stack above it via the same file's item
// heights. Assembled hands arrive through reconciliation rather than a
// local call, since pickups deliberately render nothing optimistically.
//
// Local mutators render the hand immediately for zero-latency feedback AND
// send setHeldItem so the server updates the synced component — unless the
// new models already match what's held, in which case applyLocally skips
// both (e.g. re-grabbing an ingredient already in hand). The
// reconciliation system (startRenderingHeldItems) compares every player's
// synced state against what's rendered and corrects mismatches — this is
// what makes the item visible to other players, and what corrects this
// client's own guess when the server disagrees (e.g. stove.ts's
// collectFromStove, which renders nothing optimistically to avoid
// duplicating a scarce item). setHeldItem itself still isn't validated —
// see server/heldItems.ts — so outside the stove flow this remains a
// visibility fix, not anti-cheat.

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
 * Removes the held item and returns its models, clearing the hand locally
 * WITHOUT broadcasting setHeldItem — for actions whose paired fixture
 * message carries no models of its own and reads the player's current
 * HeldItem server-side instead (placeOnCounter, deliverHeldItem).
 * Broadcasting here first would race ahead of that message and clear the
 * server's copy before its handler reads it, delivering/placing nothing.
 */
export function takeHeldItemModels(): string[] {
  const models = localState()?.models ?? []
  renderHeldItem(localPlayerId(), [])
  return models
}

let pendingRestoreModels: string[] | null = null

/**
 * For a fixture action whose server outcome isn't known yet. Clears the
 * hand prediction immediately WITHOUT broadcasting setHeldItem — the
 * paired intent's own server handler grants the empty hand on success or
 * sends actionRejected on failure, which restorePendingHeldItem uses to
 * put the item back. Broadcasting unconditionally is how items used to
 * vanish or duplicate in a race.
 *
 * pendingRestoreModels is a single slot: applyLocally and heldItemsSystem
 * null it out on an unrelated hand change, so a stale rejection can't
 * restore it over a hand that's since moved on.
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
 * Renders each player's held item, but only reacts when a player's synced
 * state has actually changed since last observed — not whenever it merely
 * differs from what's rendered. Right after this client's own optimistic
 * applyLocally, a live read is briefly stale; gating on an actual change
 * makes that a no-op instead of a spurious revert-then-reapply flicker.
 * Compares the synced array directly before copying it — copying every
 * player every frame just to discard most was needless churn.
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
 * Builds the visible model stack under a hand-anchor parent (already
 * AvatarAttach'd) and returns its child entities, stackRoot first. The
 * bottom item's configured hand transform anchors the whole stack; items
 * above it are positioned purely by cumulative height, not their own
 * individual hand offsets.
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
