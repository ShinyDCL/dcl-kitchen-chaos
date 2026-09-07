// The kitchen floor as a TriggerArea — the SDK's native zone primitive
// (ADR-258), not a hand-rolled per-frame position check.
//
// Client-side only: it drives presentation (mobileCamera.ts locks its follow
// camera while the player is inside), so there is nothing worth cheating
// here and nothing to tell the server.
//
// The box covers the kitchen interior, which the walls put at roughly
// SCENE_CENTER +/- 5.45m (see layout.ts). Its volume is the entity's
// Transform: scale is the full extents, position the center.

import { ColliderLayer, engine, Transform, TriggerArea, triggerAreaEventsSystem } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { SCENE_CENTER } from '../../shared/constants'

/** Full extents of the play area box, in meters. */
const PLAY_AREA_SIZE = Vector3.create(12, 6, 12)

/** Center of the box in scene coordinates — y is half the height, so the box sits on the floor rather than half-buried. */
const PLAY_AREA_CENTER = Vector3.create(SCENE_CENTER, PLAY_AREA_SIZE.y / 2, SCENE_CENTER)

let playerInside = false

/** Whether the local player is standing in the play area. */
export function isPlayerInPlayArea(): boolean {
  return playerInside
}

/** Call once during client setup. */
export function startPlayArea(): void {
  const zone = engine.addEntity()
  Transform.create(zone, { position: PLAY_AREA_CENTER, scale: PLAY_AREA_SIZE })

  // CL_MAIN_PLAYER, not CL_PLAYER: the local avatar only, so a remote player
  // walking in can't flip the local camera and no per-event filtering is needed.
  TriggerArea.setBox(zone, ColliderLayer.CL_MAIN_PLAYER)

  triggerAreaEventsSystem.onTriggerEnter(zone, () => {
    playerInside = true
  })

  triggerAreaEventsSystem.onTriggerExit(zone, () => {
    playerInside = false
  })
}
