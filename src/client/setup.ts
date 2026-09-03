// Client bootstrap — called once from index.ts's main() on the client
// branch. Builds the scene, then starts the systems that reconcile visuals
// against server-synced state (see heldItem.ts's startRenderingHeldItems,
// preparationCounters.ts's startRenderingPreparationCounters,
// stoveCooking.ts's startRenderingStoves, and deliveryCounter.ts's
// startRenderingDeliveryCounter), then the order queue HUD, the
// Play/Spectate role UI, and mobile-specific input/camera setup.

import { engine, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { SCENE_CENTER } from '../shared/constants'
import { preloadAssets } from './assetPreload'
import { startRenderingDeliveryCounter } from './fixtures/deliveryCounter'
import { startRenderingPreparationCounters } from './fixtures/preparationCounters'
import { createSceneLayout } from './fixtures/sceneLayout'
import { startRenderingStoves } from './fixtures/stoveCooking'
import { startRenderingHeldItems } from './heldItem'
import { setupInfoDisplay } from './infoDisplay'
import { setupLeaderboardDisplay } from './leaderboardDisplay'
import { startMobileCamera } from './mobileCamera'
import { setupMobileControls } from './mobileControls'
import { startBackgroundMusic } from './sound'
import { setupOrdersUi } from './ui/ordersUi'
import { setupPlayerRoleUi } from './ui/playerRole'

export function initClient(): void {
  const scene = engine.addEntity()
  Transform.create(scene, {
    position: Vector3.create(SCENE_CENTER, 0, SCENE_CENTER)
  })
  GltfContainer.create(scene, { src: 'assets/scene/models/Scene.glb' })

  createSceneLayout(scene)
  setupLeaderboardDisplay(scene)
  setupInfoDisplay(scene)
  preloadAssets()
  startRenderingHeldItems()
  startRenderingPreparationCounters()
  startRenderingStoves()
  startRenderingDeliveryCounter()
  setupOrdersUi()
  setupPlayerRoleUi()
  setupMobileControls()
  startMobileCamera()
  startBackgroundMusic()
}
