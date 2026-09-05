// Floating message shown above whichever fixture the player just tried to
// interact with and couldn't — a small billboarded label (Message.glb
// background + 3D text) positioned above that fixture, shown for
// MESSAGE_DURATION_SECONDS or until replaced by a new message. Mirrors the
// stove's progress bar: one persistent world-space entity, billboarded via
// BM_Y. Pops in/out (see messageTimerSystem) rather than snapping visible.
//
// Scaled up on mobile — world-space text reads smaller from mobileCamera.ts's
// more distant camera. Camera-facing itself is handled by cameraFacing.ts.

import { engine, Entity, GltfContainer, TextShape, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { MODELS } from '../../shared/models'
import { createCameraFacingTransform } from '../scene/cameraFacing'
import { WORLD_TEXT_COLOR } from '../scene/textStyle'

const MESSAGE_DURATION_SECONDS = 2
const MESSAGE_POP_SECONDS = 0.15 // quick scale in/out at the start/end of MESSAGE_DURATION_SECONDS
const MESSAGE_Y_OFFSET = 0.7 // above the fixture's highlight/world position
const TEXT_Y_OFFSET = 0.225 // nudges text up to sit centered on the background model — tune to taste
const BACKGROUND_THICKNESS = 0.019 // z-offset so the text sits slightly in front of the background model
const FONT_SIZE = 1.1
const MOBILE_SCALE = 2 // bigger on mobile — see header

let root: Entity | null = null
let textEntity: Entity | null = null
let remainingSeconds = 0
let systemRegistered = false

/** Shows a short message above the given world position, replacing any message already showing and resetting its timer (and pop-in). */
export function showMessage(text: string, worldPosition: Vector3): void {
  const entities = getOrCreateMessageEntities()

  TextShape.getMutable(entities.textEntity).text = text
  Transform.getMutable(entities.root).position = Vector3.create(
    worldPosition.x,
    worldPosition.y + MESSAGE_Y_OFFSET,
    worldPosition.z
  )
  VisibilityComponent.getMutable(entities.root).visible = true
  remainingSeconds = MESSAGE_DURATION_SECONDS
  applyPopScale() // apply immediately, same as the system's per-frame call — avoids one frame at the old scale

  ensureSystemRegistered()
}

function getOrCreateMessageEntities(): { root: Entity; textEntity: Entity } {
  if (root !== null && textEntity !== null) return { root, textEntity }

  const scale = isMobile() ? MOBILE_SCALE : 1
  const textYOffset = TEXT_Y_OFFSET * scale
  const backgroundThickness = BACKGROUND_THICKNESS * scale

  root = engine.addEntity()
  createCameraFacingTransform(root, { position: Vector3.Zero() })
  VisibilityComponent.create(root, { visible: false, propagateToChildren: true })

  const background = engine.addEntity()
  Transform.create(background, { scale: Vector3.create(scale, scale, scale), parent: root })
  GltfContainer.create(background, { src: MODELS.message })

  textEntity = engine.addEntity()
  Transform.create(textEntity, {
    position: Vector3.create(0, textYOffset, -backgroundThickness),
    parent: root
  })
  TextShape.create(textEntity, {
    text: '',
    fontSize: FONT_SIZE * scale,
    textColor: WORLD_TEXT_COLOR
  })

  return { root, textEntity }
}

function ensureSystemRegistered(): void {
  if (systemRegistered) return
  engine.addSystem(messageTimerSystem)
  systemRegistered = true
}

function messageTimerSystem(dt: number): void {
  if (remainingSeconds <= 0) return
  if (Number.isFinite(dt)) {
    remainingSeconds -= dt
  }
  if (remainingSeconds <= 0) {
    hideMessage()
    return
  }
  applyPopScale()
}

/**
 * Root's scale eases 0→1 over the first MESSAGE_POP_SECONDS, holds, then
 * 1→0 over the last — scaling the root, not background/text directly,
 * keeps their own fixed sizes untouched at rest.
 */
function applyPopScale(): void {
  if (root === null) return
  const elapsed = MESSAGE_DURATION_SECONDS - remainingSeconds
  const popIn = Math.min(elapsed / MESSAGE_POP_SECONDS, 1)
  const popOut = Math.min(remainingSeconds / MESSAGE_POP_SECONDS, 1)
  const pop = Math.min(popIn, popOut)
  Transform.getMutable(root).scale = Vector3.create(pop, pop, pop)
}

function hideMessage(): void {
  if (root !== null) {
    VisibilityComponent.getMutable(root).visible = false
  }
  if (textEntity !== null) {
    TextShape.getMutable(textEntity).text = ''
  }
}
