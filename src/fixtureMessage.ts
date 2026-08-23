// Floating message shown above whichever fixture the player just tried to
// interact with and couldn't — a small billboarded label (background box +
// 3D text) positioned above that fixture, shown for MESSAGE_DURATION_SECONDS
// or until replaced by a new message. Mirrors the stove's progress bar: one
// persistent world-space entity, billboarded via BM_Y.

import {
  Billboard,
  BillboardMode,
  engine,
  Entity,
  Material,
  MeshRenderer,
  TextShape,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

const MESSAGE_DURATION_SECONDS = 2
const MESSAGE_Y_OFFSET = 0.5 // above the fixture's highlight/world position
const BACKGROUND_COLOR = Color4.create(0, 0, 0, 1)
const TEXT_COLOR = Color4.White()
const BACKGROUND_WIDTH = 1.1 // fixed width — tune alongside FONT_SIZE if messages get longer than ~25 chars
const BACKGROUND_HEIGHT = 0.24
const BACKGROUND_THICKNESS = 0.02
const FONT_SIZE = 1

let root: Entity | null = null
let textEntity: Entity | null = null
let remainingSeconds = 0
let systemRegistered = false

/** Shows a short message above the given world position, replacing any message already showing and resetting its timer. */
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

  ensureSystemRegistered()
}

function getOrCreateMessageEntities(): { root: Entity; textEntity: Entity } {
  if (root !== null && textEntity !== null) return { root, textEntity }

  root = engine.addEntity()
  Transform.create(root, { position: Vector3.Zero() })
  Billboard.create(root, { billboardMode: BillboardMode.BM_Y })
  VisibilityComponent.create(root, { visible: false, propagateToChildren: true })

  const background = engine.addEntity()
  Transform.create(background, {
    scale: Vector3.create(BACKGROUND_WIDTH, BACKGROUND_HEIGHT, BACKGROUND_THICKNESS),
    parent: root
  })
  MeshRenderer.setBox(background)
  Material.setPbrMaterial(background, {
    albedoColor: BACKGROUND_COLOR,
    metallic: 0,
    roughness: 1
  })

  textEntity = engine.addEntity()
  Transform.create(textEntity, {
    position: Vector3.create(0, 0, -BACKGROUND_THICKNESS),
    parent: root
  })
  TextShape.create(textEntity, {
    text: '',
    fontSize: FONT_SIZE,
    textColor: TEXT_COLOR
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
  }
}

function hideMessage(): void {
  if (root !== null) {
    VisibilityComponent.getMutable(root).visible = false
  }
  if (textEntity !== null) {
    TextShape.getMutable(textEntity).text = ''
  }
}
