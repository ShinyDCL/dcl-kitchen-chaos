// Transform for a world-space entity that should face the camera. Desktop
// gets a dynamic BM_Y billboard, since that camera orbits freely. Mobile's
// camera (mobileCamera.ts) has a fixed rotation, so it just gets a static
// facing rotation instead — set once, never re-evaluated on Play/Spectate
// (those elements are hidden entirely while spectating anyway).

import { Billboard, BillboardMode, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { CAMERA_TILT_DEGREES } from './mobileCamera'

interface CameraFacingOptions {
  position: Vector3
  scale?: Vector3
  parent?: Entity
}

export function createCameraFacingTransform(entity: Entity, options: CameraFacingOptions): void {
  if (isMobile()) {
    Transform.create(entity, { ...options, rotation: Quaternion.fromEulerDegrees(CAMERA_TILT_DEGREES, 0, 0) })
  } else {
    Transform.create(entity, options)
    Billboard.create(entity, { billboardMode: BillboardMode.BM_Y })
  }
}
