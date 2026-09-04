// On mobile, replaces the free-look camera with a fixed-angle follow
// camera while the player is in the play area (Overcooked-style): a locked
// tilt/facing that never rotates with input, only translating sideways/
// up-down to track the player — there is no spare screen space for a
// touch-drag camera alongside the cooking controls. Leaving the play area
// hands the normal free camera back, so the rest of the scene still walks
// and looks around normally. Desktop always keeps the free camera.
//
// Platform detection resolves asynchronously — poll until it resolves.

import { engine, Entity, MainCamera, Transform, VirtualCamera } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlatform, isMobile } from '@dcl/sdk/platform'

import { isPlayerInPlayArea } from './playArea'

const CAMERA_HEIGHT_OFFSET = 6 // meters above the player
const CAMERA_BACK_OFFSET = -4 // meters behind the player along -Z, so the fixed downward tilt looks across the kitchen toward the front wall (+Z)
export const CAMERA_TILT_DEGREES = 60 // fixed pitch, positive tilts down (negative would point up at the sky) — the point is a locked angle, never re-aimed at the player; exported for cameraFacing.ts

const CAMERA_OFFSET = Vector3.create(0, CAMERA_HEIGHT_OFFSET, CAMERA_BACK_OFFSET)
const CAMERA_ROTATION = Quaternion.fromEulerDegrees(CAMERA_TILT_DEGREES, 0, 0)

let cameraEntity: Entity | null = null
let active = false

/** Polls until getPlatform() resolves, then starts the locked follow camera on mobile only. Call once during client setup. */
export function startMobileCamera(): void {
  engine.addSystem(waitForPlatformSystem)
}

function waitForPlatformSystem(): void {
  if (getPlatform() === null) return
  engine.removeSystem(waitForPlatformSystem)
  if (isMobile()) engine.addSystem(mobileCameraSystem)
}

function mobileCameraSystem(): void {
  const inPlayArea = isPlayerInPlayArea()

  if (inPlayArea) {
    const camera = getOrCreateCameraEntity()
    followPlayer(camera)
    if (!active) MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: camera })
  } else if (active) {
    const mainCamera = MainCamera.getMutableOrNull(engine.CameraEntity)
    if (mainCamera) mainCamera.virtualCameraEntity = undefined
  }

  active = inPlayArea
}

function getOrCreateCameraEntity(): Entity {
  if (cameraEntity !== null) return cameraEntity

  const entity = engine.addEntity()
  Transform.create(entity, { rotation: CAMERA_ROTATION })
  VirtualCamera.create(entity, {
    defaultTransition: { transitionMode: VirtualCamera.Transition.Speed(10) }
  })
  cameraEntity = entity
  return entity
}

function followPlayer(camera: Entity): void {
  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  if (!playerTransform) return
  Transform.getMutable(camera).position = Vector3.add(playerTransform.position, CAMERA_OFFSET)
}
