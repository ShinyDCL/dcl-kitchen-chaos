// Stove cooking: interacting with a stove while holding a cookable item
// (see cookableItems.ts) starts a timed cook. A raw model appears on the
// stove and a progress bar above it fills in as time passes; when done,
// the model swaps to its cooked version and a checkmark appears. A second
// interact while done picks up the cooked item and resets the stove.
// Interacting with a non-cookable item in hand, or while a cook is already
// in progress, does nothing.
//
// Visibility is controlled on just two entities — root (background + fill)
// and checkmarkAnchor (the two checkmark legs) — using VisibilityComponent's
// propagateToChildren so their child meshes don't need their own
// VisibilityComponent. checkmarkAnchor has its own component so it can be
// toggled independently of root (checkmark hidden while cooking, shown only
// once done), since a child's own VisibilityComponent overrides whatever
// its parent propagates.
//
// The progress bar is plain code-built geometry (a background box plus a
// scaling fill box), which is simple and cheap — with at most 3 stoves
// cooking at once, this has no meaningful performance cost. It faces the
// player via the built-in Billboard component (BM_Y) rather than manual
// rotation math, so the engine handles it natively. The checkmark is built
// the same way (two crossed thin boxes) as a functional placeholder; a
// small 2D checkmark texture on a plane, or a tiny checkmark .glb, would
// look sharper than tuning box rotations in code — worth doing if you want
// to polish this later.
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
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import {
  CHECKMARK_COLOR,
  PROGRESS_BAR_BACKGROUND_COLOR,
  PROGRESS_BAR_FILL_COLOR,
  PROGRESS_BAR_HEIGHT,
  PROGRESS_BAR_THICKNESS,
  PROGRESS_BAR_WIDTH,
  PROGRESS_BAR_Y_OFFSET,
  STOVE_ITEM_OFFSET
} from './constants'
import { CookableItemDefinition, getCookableItemDefinition } from './cookableItems'
import { attachItemToPlayerHand, hasHeldItem, peekHeldItemModel, takeHeldItem } from './heldItem'
import { getWorldPosition } from './worldPosition'

interface ProgressBar {
  root: Entity // background + fill, no own VisibilityComponent — controlled via root's propagateToChildren
  fill: Entity
  checkmarkAnchor: Entity // checkmark legs, no own VisibilityComponent — controlled via this entity's propagateToChildren
}

interface CookingState {
  itemEntity: Entity
  progressBar: ProgressBar
  cookedModel: string
  cookDurationSeconds: number
  elapsedSeconds: number
  done: boolean
}

const progressBars = new Map<Entity, ProgressBar>()
const cookingStates = new Map<Entity, CookingState>()
let systemRegistered = false

/** Call from a stove fixture's onInteract. */
export function handleStoveInteract(stove: Entity): void {
  const state = cookingStates.get(stove)

  if (state) {
    if (state.done) collectCookedItem(stove, state)
    return // still cooking — ignore interact until done
  }

  if (!hasHeldItem()) return

  const model = peekHeldItemModel()
  const definition = model ? getCookableItemDefinition(model) : undefined
  if (!definition) return // non-cookable item — nothing happens

  startCooking(stove, definition)
}

function startCooking(stove: Entity, definition: CookableItemDefinition): void {
  takeHeldItem()

  const itemEntity = engine.addEntity()
  Transform.create(itemEntity, { position: STOVE_ITEM_OFFSET, parent: stove })
  GltfContainer.create(itemEntity, { src: definition.rawModel })

  const progressBar = getOrCreateProgressBar(stove)
  resetProgressBar(progressBar)

  cookingStates.set(stove, {
    itemEntity,
    progressBar,
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
    }
  }
}
