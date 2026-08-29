// getPlatform() is null for a moment at startup, so isMobile() reads false
// too early. Poll until it resolves. Shared by ordersUi.tsx and playerRole.tsx.

import { engine } from '@dcl/sdk/ecs'
import { getPlatform, isMobile } from '@dcl/sdk/platform'

/** Runs `callback` once, as soon as getPlatform() resolves. */
export function onPlatformResolved(callback: (mobile: boolean) => void): void {
  engine.addSystem(function waitForPlatform() {
    if (getPlatform() === null) return
    engine.removeSystem(waitForPlatform)
    callback(isMobile())
  })
}
