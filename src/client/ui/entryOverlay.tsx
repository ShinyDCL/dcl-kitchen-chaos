// The entry overlay, now only ever a "Loading..." state: there is no role
// to choose, so once the server is alive (serverReadiness.ts — the CRDT
// room connecting isn't enough, a cold start can take ~15s) the overlay
// simply goes away and the player is in.
//
// Centered on the whole device-safe area so it lands in the true screen
// center, and the area around the panel stays click-through so it never
// blocks movement while the server is still waking.

import { engine } from '@dcl/sdk/ecs'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'

import { isServerAlive } from '../serverReadiness'
import { LoadingPrompt } from './serverLoadingUi'

export function setupEntryOverlay(): void {
  const owner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(owner, EntryOverlayRenderer, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'device'
  })
}

function EntryOverlayRenderer() {
  return isServerAlive() ? null : LoadingPrompt()
}
