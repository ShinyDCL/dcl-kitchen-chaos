// The top-right column: level indicator over coin total. Its own renderer
// in the 'interactable' area so it doesn't sit under Decentraland's own
// top-right icon column — unlike entryOverlay.tsx, which centers on the
// full device-safe area.
//
// Hidden until the server is alive, so the panels don't show placeholder
// zeros next to the "Loading..." prompt.

import { engine } from '@dcl/sdk/ecs'
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { onPlatformResolved } from '../platform/platformDetection'
import { isServerAlive } from '../serverReadiness'
import { CoinsPanel } from './coinsUi'
import { CornerPanelLayout } from './cornerPanelStyle'
import { LevelPanel } from './levelUi'

const COLUMN_EDGE_OFFSET = 24 // from the interactable area's top-right corner

const DESKTOP_PANEL_LAYOUT: CornerPanelLayout = { width: 160, height: 44, fontSize: 16 }
const MOBILE_PANEL_LAYOUT: CornerPanelLayout = { width: 220, height: 64, fontSize: 20 }

let currentLayout: CornerPanelLayout = DESKTOP_PANEL_LAYOUT

export function setupCornerPanels(): void {
  const owner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(owner, CornerPanelsRenderer, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'interactable'
  })

  onPlatformResolved((mobile) => {
    currentLayout = mobile ? MOBILE_PANEL_LAYOUT : DESKTOP_PANEL_LAYOUT
  })
}

function CornerPanelsRenderer() {
  if (!isServerAlive()) return null
  const layout = currentLayout

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: COLUMN_EDGE_OFFSET, right: COLUMN_EDGE_OFFSET },
        width: layout.width,
        height: 'auto',
        flexDirection: 'column',
        alignItems: 'flex-end'
      }}
    >
      {/* Level goes above coins: the "+N coins" toast hangs off the bottom of
          the coin panel, so anything below it would shift on every grant. */}
      <LevelPanel layout={layout} />
      <CoinsPanel layout={layout} />
    </UiEntity>
  )
}
