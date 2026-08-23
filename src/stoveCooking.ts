// Stove cooking: interacting with a stove while holding a cookable item
// (see cookableItems.ts) starts a timed cook. A raw model appears on the
// stove, a progress bar above it fills in as time passes, and a smoke
// particle emitter runs for the duration. When done, the model swaps to
// its cooked version, the checkmark appears, and smoke stops. A second
// interact while done picks up the cooked item and resets the stove.
// Interacting with a non-cookable item in hand, or while a cook is already
// in progress, does nothing.
//
// Visibility for the progress bar / checkmark is controlled on just two
// entities via VisibilityComponent's propagateToChildren — see the note
// above resetProgressBar/hideProgressBar. The smoke emitter is a single
// persistent ParticleSystem per stove (created once, like the progress
// bar), toggled on/off via its `active` field rather than recreated per
// cook.
//
// The progress bar and checkmark are plain code-built geometry, which is
// simple and cheap at this scale. Everything faces the player via the
// built-in Billboard component (BM_Y) rather than manual rotation math.
// The checkmark is two crossed thin boxes as a functional placeholder — a
// small 2D checkmark texture or tiny .glb would look sharper. The smoke
// emitter expects a soft round puff texture at assets/scene/textures/
// Smoke.png (see textures.ts) — without it, particles render as plain
// white squares.
//
// This is the ONLY system registered for stove cooking — a single
// engine.addSystem call advances every active cook's timer and fill.

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
  CHECKMARK_COLOR,
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
} from './constants'
import { attachItemToPlayerHand, takeHeldItem } from './heldItem'
import { CookableIngredientDefinition } from './ingredients'
import { getWorldPosition } from './worldPosition'

interface ProgressBar {
  root: Entity // background + fill, no own VisibilityComponent — controlled via root's propagateToChildren
  fill: Entity
  checkmarkAnchor: Entity // checkmark legs, no own VisibilityComponent — controlled via this entity's propagateToChildren
}

interface CookingState {
  itemEntity: Entity
  progressBar: ProgressBar
  smokeEmitter: Entity
  cookedModel: string
  cookDurationSeconds: number
  elapsedSeconds: number
  done: boolean
}

const progressBars = new Map<Entity, ProgressBar>()
const smokeEmitters = new Map<Entity, Entity>()
const cookingStates = new Map<Entity, CookingState>()
let systemRegistered = false

export type StoveStatus = 'idle' | 'cooking' | 'done'

export function getStoveStatus(stove: Entity): StoveStatus {
  const state = cookingStates.get(stove)
  if (!state) return 'idle'
  return state.done ? 'done' : 'cooking'
}

export function startCookingOnStove(stove: Entity, definition: CookableIngredientDefinition): void {
  startCooking(stove, definition)
}

export function collectFromStove(stove: Entity): void {
  const state = cookingStates.get(stove)
  if (!state) return
  collectCookedItem(stove, state)
}

function startCooking(stove: Entity, definition: CookableIngredientDefinition): void {
  takeHeldItem()

  const itemEntity = engine.addEntity()
  Transform.create(itemEntity, { position: STOVE_ITEM_OFFSET, parent: stove })
  GltfContainer.create(itemEntity, { src: definition.stoveModel })

  const progressBar = getOrCreateProgressBar(stove)
  resetProgressBar(progressBar)

  const smokeEmitter = getOrCreateSmokeEmitter(stove)
  ParticleSystem.getMutable(smokeEmitter).active = true

  cookingStates.set(stove, {
    itemEntity,
    progressBar,
    smokeEmitter,
    cookedModel: definition.cookedModel,
    cookDurationSeconds: definition.cookDurationSeconds,
    elapsedSeconds: 0,
    done: false
  })

  ensureSystemRegistered()
}

function collectCookedItem(stove: Entity, state: CookingState): void {
  engine.removeEntity(state.itemEntity)
  hideProgressBar(state.progressBar)
  attachItemToPlayerHand(state.cookedModel)
  cookingStates.delete(stove)
}

function getOrCreateProgressBar(stove: Entity): ProgressBar {
  const existing = progressBars.get(stove)
  if (existing) return existing

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

  const progressBar: ProgressBar = { root, fill, checkmarkAnchor }
  progressBars.set(stove, progressBar)
  return progressBar
}

/** Placeholder checkmark built from two crossed thin boxes — swap for a texture or small model for a cleaner look. */
function createCheckmark(parent: Entity): void {
  const shortLeg = engine.addEntity()
  Transform.create(shortLeg, {
    position: Vector3.create(-0.05, -0.02, 0),
    rotation: Quaternion.fromEulerDegrees(0, 0, 45),
    scale: Vector3.create(0.025, 0.08, 0.01),
    parent
  })
  MeshRenderer.setBox(shortLeg)
  Material.setPbrMaterial(shortLeg, {
    albedoColor: CHECKMARK_COLOR,
    emissiveColor: CHECKMARK_COLOR,
    emissiveIntensity: 0.6
  })

  const longLeg = engine.addEntity()
  Transform.create(longLeg, {
    position: Vector3.create(0.02, 0.02, 0),
    rotation: Quaternion.fromEulerDegrees(0, 0, -45),
    scale: Vector3.create(0.025, 0.14, 0.01),
    parent
  })
  MeshRenderer.setBox(longLeg)
  Material.setPbrMaterial(longLeg, {
    albedoColor: CHECKMARK_COLOR,
    emissiveColor: CHECKMARK_COLOR,
    emissiveIntensity: 0.6
  })
}

/** Persistent per-stove smoke emitter, created once and toggled via `active` rather than recreated per cook. */
function getOrCreateSmokeEmitter(stove: Entity): Entity {
  const existing = smokeEmitters.get(stove)
  if (existing) return existing

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

  smokeEmitters.set(stove, emitter)
  return emitter
}

function resetProgressBar(progressBar: ProgressBar): void {
  VisibilityComponent.getMutable(progressBar.root).visible = true
  VisibilityComponent.getMutable(progressBar.checkmarkAnchor).visible = false
  updateFill(progressBar, 0)
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

function ensureSystemRegistered(): void {
  if (systemRegistered) return
  engine.addSystem(cookingSystem)
  systemRegistered = true
}

function cookingSystem(dt: number): void {
  if (cookingStates.size === 0) return

  for (const [, state] of cookingStates) {
    if (state.done) continue

    state.elapsedSeconds += dt
    const progress = Math.min(state.elapsedSeconds / state.cookDurationSeconds, 1)
    updateFill(state.progressBar, progress)

    if (progress >= 1) {
      state.done = true
      GltfContainer.createOrReplace(state.itemEntity, { src: state.cookedModel })
      VisibilityComponent.getMutable(state.progressBar.checkmarkAnchor).visible = true
      ParticleSystem.getMutable(state.smokeEmitter).active = false
    }
  }
}

function fadeToTransparent(color: Color4): Color4 {
  return Color4.create(color.r, color.g, color.b, 0)
}
