// Client bootstrap — called once from index.ts's main() on the client
// branch. Builds the scene, then starts the systems that reconcile visuals
// against server-synced state (see heldItem.ts's startRenderingHeldItems,
// preparationCounters.ts's startRenderingPreparationCounters,
// stoveCooking.ts's startRenderingStoves, and deliveryCounter.ts's
// startRenderingDeliveryCounter), then the recipe queue HUD.

import { engine, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { SCENE_CENTER } from '../shared/constants'
import { startRenderingDeliveryCounter } from './deliveryCounter'
import { startRenderingHeldItems } from './heldItem'
import { startRenderingPreparationCounters } from './preparationCounters'
import { setupRecipesUi } from './recipesUi'
import { createSceneLayout } from './sceneLayout'
import { startRenderingStoves } from './stoveCooking'

export function initClient(): void {
  const scene = engine.addEntity()
  Transform.create(scene, {
    position: Vector3.create(SCENE_CENTER, 0, SCENE_CENTER)
  })
  GltfContainer.create(scene, { src: 'assets/scene/models/Scene.glb' })

  createSceneLayout(scene)
  startRenderingHeldItems()
  startRenderingPreparationCounters()
  startRenderingStoves()
  startRenderingDeliveryCounter()
  setupRecipesUi()
}
