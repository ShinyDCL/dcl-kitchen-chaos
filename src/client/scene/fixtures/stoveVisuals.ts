// Everything a stove looks like: the item sitting on the pan, the progress
// bar and its checkmark, and the smoke/fire emitters. stove.ts owns
// the state and decides what should be shown; this owns how.
//
// The entities are built once per stove and then only toggled — the two
// particle emitters are persistent ParticleSystems switched via `active`
// rather than recreated per cook, and the bar's fill is rescaled rather
// than rebuilt.
//
// Callers never touch the entities directly, so the tuning constants below
// stay private to this file.

import {
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
import { isMobile } from '@dcl/sdk/platform'

import { FIRE_TEXTURE, FIXTURE_HEIGHT, SMOKE_TEXTURE } from '../../../shared/constants'
import { MODELS } from '../../../shared/models'
import { createCameraFacingTransform } from '../cameraFacing'
import { createPopState, PopState, tickPopState } from '../popScale'
import { getWorldPosition } from '../worldPosition'

const STOVE_ITEM_OFFSET = Vector3.create(0.24, FIXTURE_HEIGHT + 0.05, 0.22) // sits on the pan, not the stove base

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
const MOBILE_PROGRESS_BAR_SCALE = 1.4 // bigger on mobile — also scales the checkmark, a child of this root

// Smoke particles above a stove while cooking. Tuned for ~11 steady-state
// per stove. Emission point sits inside the stove model so particles drift
// out from under the pan instead of spawning as one thin visible column.
const SMOKE_OFFSET = Vector3.create(STOVE_ITEM_OFFSET.x, STOVE_ITEM_OFFSET.y - 0.05, STOVE_ITEM_OFFSET.z)
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
const FIRE_SPAWN_RADIUS = 0.07
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
  checkmarkPop: PopState // see tickCheckmark — the bar itself just snaps visible/hidden, no pop
}

export interface StoveVisuals {
  stove: Entity
  progressBar: ProgressBar
  smokeEmitter: Entity
  fireEmitter: Entity
  itemEntity: Entity | null // the raw/cooked/burnt model currently sitting on the stove, or null while idle
}

const stoveVisuals = new Map<Entity, StoveVisuals>()

export function getOrCreateVisuals(stove: Entity): StoveVisuals {
  const existing = stoveVisuals.get(stove)
  if (existing) return existing

  const visuals: StoveVisuals = {
    stove,
    progressBar: createProgressBar(stove),
    smokeEmitter: createSmokeEmitter(stove),
    fireEmitter: createFireEmitter(stove),
    itemEntity: null
  }
  stoveVisuals.set(stove, visuals)
  return visuals
}

// --- What's on the pan ---

/** Replaces whatever was on the stove with a fresh entity for `model`. */
export function showStoveItem(visuals: StoveVisuals, model: string): void {
  clearStoveItem(visuals)
  visuals.itemEntity = engine.addEntity()
  Transform.create(visuals.itemEntity, { position: STOVE_ITEM_OFFSET, parent: visuals.stove })
  GltfContainer.create(visuals.itemEntity, { src: model })
}

/** Swaps the model in place (raw -> cooked -> burnt) without rebuilding the entity. */
export function swapStoveItemModel(visuals: StoveVisuals, model: string): void {
  if (visuals.itemEntity !== null) GltfContainer.createOrReplace(visuals.itemEntity, { src: model })
}

export function clearStoveItem(visuals: StoveVisuals): void {
  if (visuals.itemEntity === null) return
  engine.removeEntity(visuals.itemEntity)
  visuals.itemEntity = null
}

// --- Emitters ---

export function setSmokeActive(visuals: StoveVisuals, active: boolean): void {
  ParticleSystem.getMutable(visuals.smokeEmitter).active = active
}

export function setFireActive(visuals: StoveVisuals, active: boolean): void {
  ParticleSystem.getMutable(visuals.fireEmitter).active = active
}

// --- Progress bar ---

export function setBarVisible(visuals: StoveVisuals, visible: boolean): void {
  VisibilityComponent.getMutable(visuals.progressBar.root).visible = visible
}

/** Seeds fill/color for a fresh cook — visibility is owned by the caller's per-frame tick. */
export function resetProgressBar(visuals: StoveVisuals, progress: number): void {
  setFill(visuals, progress)
  setFillColor(visuals, PROGRESS_BAR_FILL_COLOR) // reset in case a previous cook left it mid-drain toward red
}

export function setFill(visuals: StoveVisuals, progress: number): void {
  const fillWidth = Math.max(PROGRESS_BAR_WIDTH * progress, 0.001) // avoid a zero-scale mesh
  const transform = Transform.getMutable(visuals.progressBar.fill)
  transform.scale = Vector3.create(
    fillWidth * PROGRESS_BAR_FILL_OVERSCALE,
    PROGRESS_BAR_HEIGHT * PROGRESS_BAR_FILL_OVERSCALE,
    PROGRESS_BAR_THICKNESS * PROGRESS_BAR_FILL_OVERSCALE
  )
  transform.position = Vector3.create(-PROGRESS_BAR_WIDTH / 2 + fillWidth / 2, 0, 0)
}

/** The done->burnt drain: the bar empties while shifting yellow -> red. `burnProgress` runs 0..1. */
export function setDrainFill(visuals: StoveVisuals, burnProgress: number): void {
  setFill(visuals, 1 - burnProgress)
  setFillColor(visuals, Color4.lerp(PROGRESS_BAR_DRAIN_START_COLOR, PROGRESS_BAR_BURNT_COLOR, burnProgress))
}

/** Steps the checkmark's pop animation and applies it. Called every frame, so it still eases out after a stove goes idle. */
export function tickCheckmark(visuals: StoveVisuals, shown: boolean, dt: number): void {
  const { checkmarkPop, checkmarkAnchor } = visuals.progressBar
  const checkmark = tickPopState(checkmarkPop, shown, dt)
  VisibilityComponent.getMutable(checkmarkAnchor).visible = checkmark.shown
  Transform.getMutable(checkmarkAnchor).scale = Vector3.create(checkmark.scale, checkmark.scale, checkmark.scale)
}

/** Only called during the done->burnt drain, where the color actually changes frame to frame — cooking keeps the material set once at creation. */
function setFillColor(visuals: StoveVisuals, color: Color4): void {
  Material.setPbrMaterial(visuals.progressBar.fill, {
    albedoColor: color,
    emissiveColor: color,
    emissiveIntensity: 0.4,
    metallic: 0,
    roughness: 0.6
  })
}

// --- Construction ---

function createProgressBar(stove: Entity): ProgressBar {
  const stoveWorldPosition = getWorldPosition(stove)
  const worldPosition = Vector3.create(
    stoveWorldPosition.x,
    stoveWorldPosition.y + PROGRESS_BAR_Y_OFFSET,
    stoveWorldPosition.z
  )

  // No parent — createCameraFacingTransform handles facing the camera.
  const root = engine.addEntity()
  const scale = isMobile() ? MOBILE_PROGRESS_BAR_SCALE : 1
  createCameraFacingTransform(root, { position: worldPosition, scale: Vector3.create(scale, scale, scale) })
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

  return { root, fill, checkmarkAnchor, checkmarkPop: createPopState() }
}

function createCheckmark(parent: Entity): void {
  const checkmark = engine.addEntity()
  Transform.create(checkmark, { parent, rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  GltfContainer.create(checkmark, { src: MODELS.checkmark })
}

/** Persistent per-stove smoke emitter, created once and toggled via `active` rather than recreated per cook. */
function createSmokeEmitter(stove: Entity): Entity {
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
function createFireEmitter(stove: Entity): Entity {
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

function fadeToTransparent(color: Color4): Color4 {
  return Color4.create(color.r, color.g, color.b, 0)
}
