// Client bootstrap — called once from index.ts's main() on the client
// branch. Builds the scene and starts the systems that render state coming
// from the server (see heldItem.ts's startRenderingRemoteHeldItems).

import { engine, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { SCENE_CENTER } from '../shared/constants'
import { startRenderingRemoteHeldItems } from './heldItem'
import { createSceneLayout } from './sceneLayout'

export function initClient(): void {
  const scene = engine.addEntity()
  Transform.create(scene, {
    position: Vector3.create(SCENE_CENTER, 0, SCENE_CENTER)
  })
  GltfContainer.create(scene, { src: 'assets/scene/models/Scene.glb' })

  createSceneLayout(scene)
  startRenderingRemoteHeldItems()
}
