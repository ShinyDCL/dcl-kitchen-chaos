// The entry overlay, now only ever a "Loading..." state: there is no role
// to choose, so once the server is alive (serverReadiness.ts — the CRDT
// room connecting isn't enough, a cold start can take ~15s) the overlay
// simply goes away and the player is in.
//
// Centered on the device-safe area, and the area around the panel stays
// click-through so it never blocks movement while the server is still waking.
//
// Owns the platform lookup and hands the layout down, as cornerPanels.tsx and
// ordersUi.tsx do for theirs.

import { engine } from '@dcl/sdk/ecs'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'

import { onPlatformResolved } from '../platform/platformDetection'
import { isServerAlive } from '../serverReadiness'
import { DESKTOP_LOADING_LAYOUT, LoadingLayout, LoadingPrompt, MOBILE_LOADING_LAYOUT } from './serverLoadingUi'

let currentLayout: LoadingLayout = DESKTOP_LOADING_LAYOUT

export function setupEntryOverlay(): void {
  const owner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(owner, EntryOverlayRenderer, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'device'
  })

  onPlatformResolved((mobile) => {
    currentLayout = mobile ? MOBILE_LOADING_LAYOUT : DESKTOP_LOADING_LAYOUT
  })
}

function EntryOverlayRenderer() {
  return isServerAlive() ? null : LoadingPrompt({ layout: currentLayout })
}
