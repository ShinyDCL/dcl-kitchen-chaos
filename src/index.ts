import { engine, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { SCENE_CENTER } from './constants'
import { createCounters } from './counters'

export function main() {
  const scene = engine.addEntity()
  Transform.create(scene, {
    position: Vector3.create(SCENE_CENTER, 0, SCENE_CENTER)
  })
  GltfContainer.create(scene, { src: 'assets/scene/models/Scene.glb' })

  createCounters(scene)
}
