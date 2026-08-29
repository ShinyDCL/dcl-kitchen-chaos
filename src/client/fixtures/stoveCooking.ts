// Stove cooking: holding a cookable and interacting starts a timed cook —
// raw model appears, a progress bar fills, smoke runs. When done, the
// model swaps to cooked, a checkmark appears, and smoke stops. Left too
// long, the bar drains back down while shifting toward red; once it empties
// (BURN_GRACE_SECONDS after done) the model swaps to the burnt cookable,
// the checkmark hides, and fire particles start. Collecting works the same
// way in either state — server/fixtures/stoveCooking.ts decides which
// model that actually grants — and resets the stove, stopping the fire.
//
// Reconciled against the server-synced StoveState rather than held as
// local truth — see the authoritative-server skill. startCookingOnStove
// renders optimistically (nothing scarce at stake if corrected later).
// collectFromStove renders nothing optimistically: collecting hands out a
// scarce item, and server/fixtures/stoveCooking.ts decides who wins a race
// for a finished stove, so this waits for the real outcome via
// reconciliation, same as for every other player's stove.
//
// Progress is derived every frame from `Date.now() - startTimestamp`
// (server clock), so only the start/reset of a cook is ever sent over the
// network, never continuous progress. The done/burnt phase is likewise
// recomputed from elapsed time, not stored, so a late observer (or a
// reconciliation correction) can jump straight to the right one.
//
// The smoke and fire emitters are each a single persistent ParticleSystem
// per stove, toggled via `active` rather than recreated per cook.

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

import { BURN_GRACE_SECONDS, FIRE_TEXTURE, FIXTURE_HEIGHT, SMOKE_TEXTURE } from '../../shared/constants'
import { CookableIngredientDefinition, getCookableItemDefinition } from '../../shared/ingredients'
import { room } from '../../shared/messages'
import { MODELS } from '../../shared/models'
import { StoveState } from '../../shared/schemas'
import { takeHeldItemPending } from '../heldItem'
import { getWorldPosition } from '../worldPosition'
import { getFixtureSyncId } from './fixtures'

const STOVE_ITEM_OFFSET = Vector3.create(0.25, FIXTURE_HEIGHT + 0.05, 0.25) // sits on the pan, not the stove base

const PROGRESS_BAR_WIDTH = 0.6
const PROGRESS_BAR_HEIGHT = 0.1
const PROGRESS_BAR_THICKNESS = 0.02
const PROGRESS_BAR_Y_OFFSET = FIXTURE_HEIGHT + 0.6
const PROGRESS_BAR_BACKGROUND_COLOR = Color4.create(0.15, 0.15, 0.15, 0.9)
const PROGRESS_BAR_FILL_COLOR = Color4.create(0.165, 0.596, 0.133, 1) // #2a9822
const PROGRESS_BAR_DRAIN_START_COLOR = Color4.create(0.9, 0.75, 0.06, 1) // drain starts yellow, not green — a green bar moving backward reads as confusing, not urgent
const PROGRESS_BAR_BURNT_COLOR = Color4.create(0.85, 0.18, 0.12, 1) // drained-bar color once fully burnt
const PROGRESS_BAR_FILL_OVERSCALE = 1.01 // fill slightly bigger than background so no sliver/z-fight shows at the seam
const PROGRESS_BAR_BACKGROUND_RECESS = 0.001 // background set back in Z once so the two boxes don't z-fight

// Smoke particles above a stove while cooking. Tuned for ~11 steady-state
// per stove. Emission point sits inside the stove model so particles drift
// out from under the pan instead of spawning as one thin visible column.
const SMOKE_OFFSET = Vector3.create(STOVE_ITEM_OFFSET.x, STOVE_ITEM_OFFSET.y - 0.1, STOVE_ITEM_OFFSET.z)
const SMOKE_SPAWN_RADIUS = 0.12
const SMOKE_RATE = 6 // particles per second
const SMOKE_MAX_PARTICLES = 18
const SMOKE_LIFETIME = 1.8 // seconds
const SMOKE_INITIAL_SIZE = { start: 0.3125, end: 0.5 }
const SMOKE_SIZE_OVER_TIME = { start: 0.75, end: 2.75 }
const SMOKE_GRAVITY = -0.05 // negative = drifts upward
const SMOKE_INITIAL_VELOCITY = { start: 0.03, end: 0.08 }
const SMOKE_COLOR = Color4.create(0.85, 0.85, 0.85, 0.85) // birth color; fades to fully transparent over lifetime

// Fire particles once a finished cook has burnt. Same spawn point/spread as
// smoke, but a bit more velocity/upward pull so flames reach a little
// higher than the smoke plume did while cooking.
const FIRE_SPAWN_RADIUS = 0.09
const FIRE_RATE = 10 // particles per second
const FIRE_MAX_PARTICLES = 25
const FIRE_LIFETIME = 1.8 // seconds
const FIRE_INITIAL_SIZE = { start: 0.85, end: 1.2 }
const FIRE_SIZE_OVER_TIME = { start: 1, end: 0.3 }
const FIRE_GRAVITY = -0.18 // negative = drifts upward, stronger pull than smoke's so flames reach higher
const FIRE_INITIAL_VELOCITY = { start: 0.14, end: 0.28 }
const FIRE_INITIAL_COLOR = { start: Color4.create(1, 0.9, 0.7, 1), end: Color4.create(1, 0.7, 0.3, 1) }
const FIRE_COLOR_OVER_TIME = { start: Color4.create(1, 0.8, 0.5, 1), end: Color4.create(0.4, 0.1, 0, 0) }
const FIRE_SPRITE_SHEET = { tilesX: 4, tilesY: 3, framesPerSecond: 12 }

interface ProgressBar {
  root: Entity // background + fill, no own VisibilityComponent — controlled via root's propagateToChildren
  fill: Entity
  checkmarkAnchor: Entity // checkmark legs, no own VisibilityComponent — controlled via this entity's propagateToChildren
}

interface StoveVisuals {
  progressBar: ProgressBar
  smokeEmitter: Entity
  fireEmitter: Entity
  itemEntity: Entity | null // the raw/cooked/burnt model currently sitting on the stove, or null while idle
}

type CookPhase = 'cooking' | 'done' | 'burnt'

interface RenderedCook {
  rawModel: string // '' means idle — mirrors the synced field this is reconciled against
  startTimestamp: number
  phase: CookPhase // local-only: how far the done/burnt transition has progressed
}

const stoveVisuals = new Map<Entity, StoveVisuals>()
const renderedCooks = new Map<Entity, RenderedCook>()
const lastSyncedStates = new Map<Entity, { rawModel: string; startTimestamp: number }>()
const registeredStoves: Entity[] = []
const stovesById = new Map<number, Entity>() // avoids an O(stoves × synced entities) scan every frame

export type StoveStatus = 'idle' | 'cooking' | 'done'

/** Registers a stove fixture so its state gets rendered and reconciled. Call once per stove during scene setup. */
export function registerStove(stove: Entity): void {
  registeredStoves.push(stove)
  renderedCooks.set(stove, emptyRenderedCook())
  lastSyncedStates.set(stove, { rawModel: '', startTimestamp: 0 })
  stovesById.set(getFixtureSyncId(stove), stove)
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
  // 'done' and 'burnt' are the same as far as interactionRules.ts is
  // concerned — collecting is allowed either way, just for a different
  // model — so both map to the public 'done' status.
  return rendered.phase === 'cooking' ? 'cooking' : 'done'
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

/** One pass over every synced StoveState, keyed by the local stove entity — built fresh each frame instead of re-scanned per stove. */
function getSyncedStates(): Map<Entity, { rawModel: string; startTimestamp: number }> {
  const states = new Map<Entity, { rawModel: string; startTimestamp: number }>()
  for (const [, data] of engine.getEntitiesWith(StoveState)) {
    const stove = stovesById.get(data.stoveId)
    if (stove) states.set(stove, { rawModel: data.rawModel, startTimestamp: Number(data.startTimestamp) })
  }
  return states
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
  const synced = getSyncedStates()
  for (const stove of registeredStoves) {
    reconcileTransition(stove, synced.get(stove) ?? { rawModel: '', startTimestamp: 0 })
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
function reconcileTransition(stove: Entity, synced: { rawModel: string; startTimestamp: number }): void {
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

/** Which phase a cook is in, purely from elapsed time — the same rule tickProgress steps through incrementally and applySyncedState jumps to directly for a late observer. */
function computePhase(elapsedSecondsValue: number, definition: CookableIngredientDefinition): CookPhase {
  if (elapsedSecondsValue < definition.cookDurationSeconds) return 'cooking'
  if (elapsedSecondsValue < definition.cookDurationSeconds + BURN_GRACE_SECONDS) return 'done'
  return 'burnt'
}

/** Continuous per-frame progress, derived purely from what's currently rendered — never from a fresh (possibly stale) synced read. */
function tickProgress(stove: Entity): void {
  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()
  if (rendered.rawModel === '') return // idle, nothing to advance

  const definition = getCookableItemDefinition(rendered.rawModel)
  if (!definition) return // shouldn't happen — unknown rawModel

  const elapsed = elapsedSeconds(rendered.startTimestamp)

  if (rendered.phase === 'cooking') {
    updateFill(getOrCreateVisuals(stove).progressBar, Math.min(elapsed / definition.cookDurationSeconds, 1))
    if (elapsed >= definition.cookDurationSeconds) {
      applyDoneVisual(stove, definition)
      renderedCooks.set(stove, { ...rendered, phase: 'done' })
    }
    return
  }

  if (rendered.phase === 'done') {
    const burnProgress = Math.min((elapsed - definition.cookDurationSeconds) / BURN_GRACE_SECONDS, 1)
    const progressBar = getOrCreateVisuals(stove).progressBar
    updateFill(progressBar, 1 - burnProgress) // drains back down instead of staying full
    updateFillColor(progressBar, Color4.lerp(PROGRESS_BAR_DRAIN_START_COLOR, PROGRESS_BAR_BURNT_COLOR, burnProgress))
    if (burnProgress >= 1) {
      applyBurntVisual(stove)
      renderedCooks.set(stove, { ...rendered, phase: 'burnt' })
    }
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
    ParticleSystem.getMutable(visuals.fireEmitter).active = false
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
  const elapsed = elapsedSeconds(synced.startTimestamp)
  resetProgressBar(visuals.progressBar, definition ? Math.min(elapsed / definition.cookDurationSeconds, 1) : 0)
  ParticleSystem.getMutable(visuals.smokeEmitter).active = true

  const phase: CookPhase = definition ? computePhase(elapsed, definition) : 'cooking'
  renderedCooks.set(stove, { rawModel: synced.rawModel, startTimestamp: synced.startTimestamp, phase })
  if (phase === 'done' && definition) applyDoneVisual(stove, definition)
  if (phase === 'burnt') applyBurntVisual(stove)
}

function applyDoneVisual(stove: Entity, definition: CookableIngredientDefinition): void {
  const visuals = getOrCreateVisuals(stove)
  if (visuals.itemEntity !== null) GltfContainer.createOrReplace(visuals.itemEntity, { src: definition.cookedModel })
  VisibilityComponent.getMutable(visuals.progressBar.checkmarkAnchor).visible = true
  ParticleSystem.getMutable(visuals.smokeEmitter).active = false
}

/** Neglected too long — burnt model, checkmark and bar hidden (hideProgressBar covers both), fire replaces smoke. */
function applyBurntVisual(stove: Entity): void {
  const visuals = getOrCreateVisuals(stove)
  if (visuals.itemEntity !== null) GltfContainer.createOrReplace(visuals.itemEntity, { src: MODELS.burntCookable })
  hideProgressBar(visuals.progressBar)
  ParticleSystem.getMutable(visuals.fireEmitter).active = true
}

function emptyRenderedCook(): RenderedCook {
  return { rawModel: '', startTimestamp: 0, phase: 'cooking' }
}

function getOrCreateVisuals(stove: Entity): StoveVisuals {
  const existing = stoveVisuals.get(stove)
  if (existing) return existing

  const visuals: StoveVisuals = {
    progressBar: getOrCreateProgressBar(stove),
    smokeEmitter: getOrCreateSmokeEmitter(stove),
    fireEmitter: getOrCreateFireEmitter(stove),
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
    position: Vector3.create(0, 0, PROGRESS_BAR_BACKGROUND_RECESS),
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
    position: Vector3.create(0, 0.2, -0.06),
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

/** Persistent per-stove fire emitter for a neglected, burnt cook — same spawn anchor as smoke, toggled via `active`. */
function getOrCreateFireEmitter(stove: Entity): Entity {
  const emitter = engine.addEntity()
  Transform.create(emitter, { position: SMOKE_OFFSET, parent: stove })
  ParticleSystem.create(emitter, {
    active: false,
    loop: true,
    prewarm: false,
    faceTravelDirection: false,
    rate: FIRE_RATE,
    maxParticles: FIRE_MAX_PARTICLES,
    lifetime: FIRE_LIFETIME,
    shape: ParticleSystem.Shape.Sphere({ radius: FIRE_SPAWN_RADIUS }),
    gravity: FIRE_GRAVITY,
    initialVelocitySpeed: FIRE_INITIAL_VELOCITY,
    initialSize: FIRE_INITIAL_SIZE,
    sizeOverTime: FIRE_SIZE_OVER_TIME,
    initialColor: FIRE_INITIAL_COLOR,
    colorOverTime: FIRE_COLOR_OVER_TIME,
    texture: { src: FIRE_TEXTURE },
    blendMode: PBParticleSystem_BlendMode.PSB_ADD,
    spriteSheet: FIRE_SPRITE_SHEET
  })

  return emitter
}

function resetProgressBar(progressBar: ProgressBar, progress: number): void {
  VisibilityComponent.getMutable(progressBar.root).visible = true
  VisibilityComponent.getMutable(progressBar.checkmarkAnchor).visible = false
  updateFill(progressBar, progress)
  updateFillColor(progressBar, PROGRESS_BAR_FILL_COLOR) // reset in case a previous cook left it mid-drain toward red
}

function hideProgressBar(progressBar: ProgressBar): void {
  VisibilityComponent.getMutable(progressBar.root).visible = false
  VisibilityComponent.getMutable(progressBar.checkmarkAnchor).visible = false
}

function updateFill(progressBar: ProgressBar, progress: number): void {
  const fillWidth = Math.max(PROGRESS_BAR_WIDTH * progress, 0.001) // avoid a zero-scale mesh
  const transform = Transform.getMutable(progressBar.fill)
  transform.scale = Vector3.create(
    fillWidth * PROGRESS_BAR_FILL_OVERSCALE,
    PROGRESS_BAR_HEIGHT * PROGRESS_BAR_FILL_OVERSCALE,
    PROGRESS_BAR_THICKNESS * PROGRESS_BAR_FILL_OVERSCALE
  )
  transform.position = Vector3.create(-PROGRESS_BAR_WIDTH / 2 + fillWidth / 2, 0, 0)
}

/** Only called during the done->burnt drain, where the color actually changes frame to frame — cooking keeps the material set once at creation. */
function updateFillColor(progressBar: ProgressBar, color: Color4): void {
  Material.setPbrMaterial(progressBar.fill, {
    albedoColor: color,
    emissiveColor: color,
    emissiveIntensity: 0.4,
    metallic: 0,
    roughness: 0.6
  })
}

function fadeToTransparent(color: Color4): Color4 {
  return Color4.create(color.r, color.g, color.b, 0)
}
