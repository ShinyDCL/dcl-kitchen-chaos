// The top-right column: level indicator over coin total. Its own renderer
// in the 'interactable' area so it doesn't sit under Decentraland's own
// top-right icon column — unlike entryOverlay.tsx, which centers on the
// full device-safe area.
//
// Hidden until the server is alive, so the panels don't show placeholder
// zeros next to the loading panel.

import { engine } from '@dcl/sdk/ecs'
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { onPlatformResolved } from '../platform/platformDetection'
import { isServerAlive } from '../serverReadiness'
import { CoinsPanel } from './coinsUi'
import { CornerPanelLayout } from './cornerPanelStyle'
import { LevelPanel } from './levelUi'
import { EMPHASIS_FONT_SIZE, MOBILE_TEXT_SCALE } from './uiStyle'

// barThickness matches the order card's progress bar (orderQueueStyle.ts:
// barWidth 10) on desktop. The card's bar stays at 10 on mobile while these
// panels scale up, so mobile keeps its own thicker value instead of reusing
// the card's.
// fontSize matches the order card’s status overlay (uiStyle.ts’s
// EMPHASIS_FONT_SIZE) so the two read as the same kind of text.
const DESKTOP_PANEL_LAYOUT: CornerPanelLayout = {
  width: 160,
  height: 44,
  fontSize: EMPHASIS_FONT_SIZE,
  barThickness: 10,
  barMarginTop: 10,
  edgeOffset: 24,
  bold: false
}
const MOBILE_PANEL_LAYOUT: CornerPanelLayout = {
  width: 220,
  height: 64,
  fontSize: Math.round(EMPHASIS_FONT_SIZE * MOBILE_TEXT_SCALE),
  barThickness: 14,
  barMarginTop: Math.round(10 * MOBILE_TEXT_SCALE),
  edgeOffset: 0, // flush to the corner; the screen is tighter and the client’s own inset still clears its icons
  bold: true
}

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
        position: { top: layout.edgeOffset, right: layout.edgeOffset },
        width: layout.width,
        height: 'auto',
        flexDirection: 'column',
        alignItems: 'flex-end'
      }}
    >
      {/* Level goes above coins: the coin-gain toast hangs off the bottom of
          the coin panel, so anything below it would shift on every grant. */}
      <LevelPanel layout={layout} />
      <CoinsPanel layout={layout} />
    </UiEntity>
  )
}
