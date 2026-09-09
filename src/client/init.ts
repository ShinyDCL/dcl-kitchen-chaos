// Client bootstrap — called once from index.ts's main() on the client
// branch. Builds the scene, then starts the systems that reconcile visuals
// against server-synced state (see heldItems.ts's startRenderingHeldItems,
// preparationCounter.ts's startRenderingPreparationCounters,
// stove.ts's startRenderingStoves, and deliveryCounter.ts's
// startRenderingDeliveryCounter), then the order queue HUD, the entry
// overlay and corner panels, and mobile-specific input/camera setup.

import { engine, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

import { SCENE_CENTER } from '../shared/constants'
import { preloadAssets } from './assetPreload'
import { startMobileCamera } from './platform/mobileCamera'
import { setupMobileControls } from './platform/mobileControls'
import { startRenderingDeliveryCounter } from './scene/fixtures/deliveryCounter'
import { startRenderingPreparationCounters } from './scene/fixtures/preparationCounter'
import { startRenderingStoves } from './scene/fixtures/stove'
import { startRenderingHeldItems } from './scene/heldItems'
import { setupInfoDisplay } from './scene/infoDisplay'
import { createSceneLayout } from './scene/layout'
import { setupLeaderboardDisplay } from './scene/leaderboardDisplay'
import { startPlayArea } from './scene/playArea'
import { setupSound } from './sound'
import { setupBuildLabel } from './ui/buildLabel'
import { setupCornerPanels } from './ui/cornerPanels'
import { setupEntryOverlay } from './ui/entryOverlay'
import { setupOrdersUi } from './ui/ordersUi'

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
  setupEntryOverlay()
  setupCornerPanels()
  setupBuildLabel()
  startPlayArea() // before the mobile camera, which reads it
  setupMobileControls()
  startMobileCamera()
  setupSound()
}
