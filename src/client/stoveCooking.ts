// Stove cooking: holding a cookable and interacting starts a timed cook —
// raw model appears, a progress bar fills, smoke runs. When done, the
// model swaps to cooked, a checkmark appears, and smoke stops. A second
// interact while done collects the item and resets the stove.
//
// Reconciled against the server-synced StoveState rather than held as
// local truth — see the authoritative-server skill. startCookingOnStove
// renders optimistically (nothing scarce at stake if corrected later).
// collectFromStove renders nothing optimistically: collecting hands out a
// scarce cooked item, and server/stoveCooking.ts decides who wins a race
// for a finished stove, so this waits for the real outcome via
// reconciliation, same as for every other player's stove.
//
// Progress is derived every frame from `Date.now() - startTimestamp`
// (server clock), so only the start/reset of a cook is ever sent over the
// network, never continuous progress.
//
// The smoke emitter is a single persistent ParticleSystem per stove,
// toggled via `active` rather than recreated per cook.

import {
  Billboard,
  BillboardMode,
  engine,
  Entity,
  GltfContainer,
  Material,
  MeshRenderer,
  ParticleSystem,
  PBParticleSystem_BlendMode,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import {
  PROGRESS_BAR_BACKGROUND_COLOR,
  PROGRESS_BAR_FILL_COLOR,
  PROGRESS_BAR_HEIGHT,
  PROGRESS_BAR_THICKNESS,
  PROGRESS_BAR_WIDTH,
  PROGRESS_BAR_Y_OFFSET,
  SMOKE_COLOR,
  SMOKE_GRAVITY,
  SMOKE_INITIAL_SIZE,
  SMOKE_INITIAL_VELOCITY,
  SMOKE_LIFETIME,
  SMOKE_MAX_PARTICLES,
  SMOKE_OFFSET,
  SMOKE_RATE,
  SMOKE_SIZE_OVER_TIME,
  SMOKE_SPAWN_RADIUS,
  SMOKE_TEXTURE,
  STOVE_ITEM_OFFSET
} from '../shared/constants'
import { CookableIngredientDefinition, getCookableItemDefinition } from '../shared/ingredients'
import { room } from '../shared/messages'
import { MODELS } from '../shared/models'
import { StoveState } from '../shared/schemas'
import { getFixtureSyncId } from './fixtures'
import { takeHeldItemPending } from './heldItem'
import { getWorldPosition } from './worldPosition'

interface ProgressBar {
  root: Entity // background + fill, no own VisibilityComponent — controlled via root's propagateToChildren
  fill: Entity
  checkmarkAnchor: Entity // checkmark legs, no own VisibilityComponent — controlled via this entity's propagateToChildren
}

interface StoveVisuals {
  progressBar: ProgressBar
  smokeEmitter: Entity
  itemEntity: Entity | null // the raw/cooked model currently sitting on the stove, or null while idle
}

interface RenderedCook {
  rawModel: string // '' means idle — mirrors the synced field this is reconciled against
  startTimestamp: number
  done: boolean // local-only: whether the done transition (cooked model swap, checkmark, smoke off) has been applied
}

const stoveVisuals = new Map<Entity, StoveVisuals>()
const renderedCooks = new Map<Entity, RenderedCook>()
const lastSyncedStates = new Map<Entity, { rawModel: string; startTimestamp: number }>()
const registeredStoves: Entity[] = []

export type StoveStatus = 'idle' | 'cooking' | 'done'

/** Registers a stove fixture so its state gets rendered and reconciled. Call once per stove during scene setup. */
export function registerStove(stove: Entity): void {
  registeredStoves.push(stove)
  renderedCooks.set(stove, emptyRenderedCook())
  lastSyncedStates.set(stove, { rawModel: '', startTimestamp: 0 })
  getOrCreateVisuals(stove) // build the persistent progress bar / smoke emitter up front, hidden/inactive
}

/**
 * Reads from renderedCooks — this client's current belief, kept correct
 * every frame by tickProgress — rather than a raw live poll of the synced
 * component. interactionRules.ts calls this to decide whether cooking is
 * allowed (drives the focus highlight's color/message); right after this
 * client's own optimistic startCookingOnStove call, a raw poll is briefly
 * stale (the server hasn't processed the intent yet), which would flip the
 * highlight back to "idle" rules for a moment until the real update caught
 * up.
 */
export function getStoveStatus(stove: Entity): StoveStatus {
  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()
  if (rendered.rawModel === '') return 'idle'
  return rendered.done ? 'done' : 'cooking'
}

export function startCookingOnStove(stove: Entity, definition: CookableIngredientDefinition): void {
  takeHeldItemPending()
  void room.send('startCookingOnStove', { stoveId: getFixtureSyncId(stove), rawModel: definition.heldModel })
  applySyncedState(stove, { rawModel: definition.heldModel, startTimestamp: Date.now() })
}

/** Sends the collect intent to the server. Deliberately renders nothing optimistically — see the module comment. */
export function collectFromStove(stove: Entity): void {
  void room.send('collectFromStove', { stoveId: getFixtureSyncId(stove) })
}

function getSyncedState(stove: Entity): { rawModel: string; startTimestamp: number } {
  const stoveId = getFixtureSyncId(stove)
  for (const [, data] of engine.getEntitiesWith(StoveState)) {
    if (data.stoveId === stoveId) return { rawModel: data.rawModel, startTimestamp: Number(data.startTimestamp) }
  }
  return { rawModel: '', startTimestamp: 0 }
}

function elapsedSeconds(startTimestamp: number): number {
  return (Date.now() - startTimestamp) / 1000
}

// --- Rendering, reconciled against the synced StoveState component ---

let systemRegistered = false

/** Reconciles every registered stove's synced state against what's currently rendered. Call once during client setup. */
export function startRenderingStoves(): void {
  if (systemRegistered) return
  engine.addSystem(stoveCookingSystem)
  systemRegistered = true
}

function stoveCookingSystem(): void {
  for (const stove of registeredStoves) {
    reconcileTransition(stove)
    tickProgress(stove)
  }
}

/**
 * Applies a rawModel/startTimestamp transition, but only when it has
 * actually changed since last observed — not whenever it merely differs
 * from what's rendered. Right after this client's own optimistic
 * startCookingOnStove, a live read is briefly stale; gating on an actual
 * change makes that a no-op instead of a spurious revert-then-reapply
 * flicker.
 *
 * If only startTimestamp changes for the same rawModel, that's this
 * client's optimistic guess being corrected to the server's authoritative
 * value — adopted without tearing down/rebuilding the item entity or bar,
 * since rebuilding caused a visible pop/rewind (most noticeable on
 * mobile's higher latency).
 */
function reconcileTransition(stove: Entity): void {
  const synced = getSyncedState(stove)
  const lastSynced = lastSyncedStates.get(stove) ?? { rawModel: '', startTimestamp: 0 }
  if (synced.rawModel === lastSynced.rawModel && synced.startTimestamp === lastSynced.startTimestamp) return
  lastSyncedStates.set(stove, synced)

  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()

  if (synced.rawModel === rendered.rawModel) {
    if (synced.startTimestamp !== rendered.startTimestamp) {
      renderedCooks.set(stove, { ...rendered, startTimestamp: synced.startTimestamp })
    }
    return
  }

  applySyncedState(stove, synced)
}

/** Continuous per-frame progress, derived purely from what's currently rendered — never from a fresh (possibly stale) synced read. */
function tickProgress(stove: Entity): void {
  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()
  if (rendered.rawModel === '') return // idle, nothing to advance

  const definition = getCookableItemDefinition(rendered.rawModel)
  if (!definition) return // shouldn't happen — unknown rawModel

  const progress = Math.min(elapsedSeconds(rendered.startTimestamp) / definition.cookDurationSeconds, 1)
  updateFill(getOrCreateVisuals(stove).progressBar, progress)

  if (progress >= 1 && !rendered.done) {
    applyDoneVisual(stove, definition)
    renderedCooks.set(stove, { ...rendered, done: true })
  }
}

/** Applies a rawModel/startTimestamp change (idle->cooking or any->idle) to this stove's visuals. */
function applySyncedState(stove: Entity, synced: { rawModel: string; startTimestamp: number }): void {
  const visuals = getOrCreateVisuals(stove)

  if (visuals.itemEntity !== null) {
    engine.removeEntity(visuals.itemEntity)
    visuals.itemEntity = null
  }

  if (synced.rawModel === '') {
    hideProgressBar(visuals.progressBar)
    ParticleSystem.getMutable(visuals.smokeEmitter).active = false
    renderedCooks.set(stove, emptyRenderedCook())
    return
  }

  const definition = getCookableItemDefinition(synced.rawModel)
  const stoveModel = definition?.stoveModel ?? synced.rawModel

  visuals.itemEntity = engine.addEntity()
  Transform.create(visuals.itemEntity, { position: STOVE_ITEM_OFFSET, parent: stove })
  GltfContainer.create(visuals.itemEntity, { src: stoveModel })

  // Seed the true elapsed progress right away instead of always starting
  // at 0 and correcting next tick — otherwise a late observer sees a
  // 0% flash before jumping to the real value.
  const progress = definition ? Math.min(elapsedSeconds(synced.startTimestamp) / definition.cookDurationSeconds, 1) : 0
  resetProgressBar(visuals.progressBar, progress)
  ParticleSystem.getMutable(visuals.smokeEmitter).active = true

  const alreadyDone = progress >= 1
  renderedCooks.set(stove, { rawModel: synced.rawModel, startTimestamp: synced.startTimestamp, done: alreadyDone })
  if (alreadyDone && definition) applyDoneVisual(stove, definition)
}

function applyDoneVisual(stove: Entity, definition: CookableIngredientDefinition): void {
  const visuals = getOrCreateVisuals(stove)
  if (visuals.itemEntity !== null) GltfContainer.createOrReplace(visuals.itemEntity, { src: definition.cookedModel })
  VisibilityComponent.getMutable(visuals.progressBar.checkmarkAnchor).visible = true
  ParticleSystem.getMutable(visuals.smokeEmitter).active = false
}

function emptyRenderedCook(): RenderedCook {
  return { rawModel: '', startTimestamp: 0, done: false }
}

function getOrCreateVisuals(stove: Entity): StoveVisuals {
  const existing = stoveVisuals.get(stove)
  if (existing) return existing

  const visuals: StoveVisuals = {
    progressBar: getOrCreateProgressBar(stove),
    smokeEmitter: getOrCreateSmokeEmitter(stove),
    itemEntity: null
  }
  stoveVisuals.set(stove, visuals)
  return visuals
}

function getOrCreateProgressBar(stove: Entity): ProgressBar {
  const stoveWorldPosition = getWorldPosition(stove)
  const worldPosition = Vector3.create(
    stoveWorldPosition.x,
    stoveWorldPosition.y + PROGRESS_BAR_Y_OFFSET,
    stoveWorldPosition.z
  )

  // No parent — lives in world space directly. Billboard (Y-axis only)
  // keeps everything parented to it upright and always facing the player,
  // handled by the engine rather than manual per-frame rotation math.
  const root = engine.addEntity()
  Transform.create(root, { position: worldPosition })
  Billboard.create(root, { billboardMode: BillboardMode.BM_Y })
  VisibilityComponent.create(root, { visible: false, propagateToChildren: true })

  const background = engine.addEntity()
  Transform.create(background, {
    scale: Vector3.create(PROGRESS_BAR_WIDTH, PROGRESS_BAR_HEIGHT, PROGRESS_BAR_THICKNESS),
    parent: root
  })
  MeshRenderer.setBox(background)
  Material.setPbrMaterial(background, {
    albedoColor: PROGRESS_BAR_BACKGROUND_COLOR,
    metallic: 0,
    roughness: 0.8
  })

  const fill = engine.addEntity()
  Transform.create(fill, { parent: root })
  MeshRenderer.setBox(fill)
  Material.setPbrMaterial(fill, {
    albedoColor: PROGRESS_BAR_FILL_COLOR,
    emissiveColor: PROGRESS_BAR_FILL_COLOR,
    emissiveIntensity: 0.4,
    metallic: 0,
    roughness: 0.6
  })

  const checkmarkAnchor = engine.addEntity()
  Transform.create(checkmarkAnchor, {
    position: Vector3.create(0, 0, -PROGRESS_BAR_THICKNESS),
    parent: root
  })
  // Own VisibilityComponent so this can be toggled independently of root
  // (hidden while cooking, shown only once done) — a child's own component
  // overrides whatever its parent propagates.
  VisibilityComponent.create(checkmarkAnchor, { visible: false, propagateToChildren: true })
  createCheckmark(checkmarkAnchor)

  return { root, fill, checkmarkAnchor }
}

function createCheckmark(parent: Entity): void {
  const checkmark = engine.addEntity()
  Transform.create(checkmark, { parent, rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  GltfContainer.create(checkmark, { src: MODELS.checkmark })
}

/** Persistent per-stove smoke emitter, created once and toggled via `active` rather than recreated per cook. */
function getOrCreateSmokeEmitter(stove: Entity): Entity {
  const emitter = engine.addEntity()
  Transform.create(emitter, { position: SMOKE_OFFSET, parent: stove })
  ParticleSystem.create(emitter, {
    active: false,
    rate: SMOKE_RATE,
    maxParticles: SMOKE_MAX_PARTICLES,
    lifetime: SMOKE_LIFETIME,
    shape: ParticleSystem.Shape.Sphere({ radius: SMOKE_SPAWN_RADIUS }),
    gravity: SMOKE_GRAVITY,
    initialVelocitySpeed: SMOKE_INITIAL_VELOCITY,
    initialSize: SMOKE_INITIAL_SIZE,
    sizeOverTime: SMOKE_SIZE_OVER_TIME,
    initialColor: { start: SMOKE_COLOR, end: SMOKE_COLOR },
    colorOverTime: { start: SMOKE_COLOR, end: fadeToTransparent(SMOKE_COLOR) },
    texture: { src: SMOKE_TEXTURE },
    blendMode: PBParticleSystem_BlendMode.PSB_ALPHA
  })

  return emitter
}

function resetProgressBar(progressBar: ProgressBar, progress: number): void {
  VisibilityComponent.getMutable(progressBar.root).visible = true
  VisibilityComponent.getMutable(progressBar.checkmarkAnchor).visible = false
  updateFill(progressBar, progress)
}

function hideProgressBar(progressBar: ProgressBar): void {
  VisibilityComponent.getMutable(progressBar.root).visible = false
  VisibilityComponent.getMutable(progressBar.checkmarkAnchor).visible = false
}

function updateFill(progressBar: ProgressBar, progress: number): void {
  const fillWidth = Math.max(PROGRESS_BAR_WIDTH * progress, 0.001) // avoid a zero-scale mesh
  const transform = Transform.getMutable(progressBar.fill)
  transform.scale = Vector3.create(fillWidth, PROGRESS_BAR_HEIGHT, PROGRESS_BAR_THICKNESS)
  // Keep the fill's left edge fixed to the background's left edge as it
  // grows, instead of scaling outward from the center.
  transform.position = Vector3.create(-PROGRESS_BAR_WIDTH / 2 + fillWidth / 2, 0, 0.001)
}

function fadeToTransparent(color: Color4): Color4 {
  return Color4.create(color.r, color.g, color.b, 0)
}
