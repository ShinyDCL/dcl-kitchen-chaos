// Always-on build stamp in the bottom-right corner — see buildInfo.ts for
// why. Its own renderer rather than a corner of an existing one, so it stays
// visible through every UI state, including the entry overlay.
//
// Mobile sits flush against the safe area; desktop holds a small corner gap.
// The 'device' inset serves both: it clears the hardware margins that matter
// on a phone and is a no-op on desktop, where nothing is reserved along the
// bottom-right edge anyway.

import { engine } from '@dcl/sdk/ecs'
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { BUILD_LABEL } from '../buildInfo'
import { onPlatformResolved } from '../platform/platformDetection'
import { getPanelBackground, TEXT_COLOR } from './uiStyle'

/**
 * Off by default: on mobile the client draws its action button over the
 * bottom-right corner, on top of this. Flip to true when you need to
 * confirm which build is actually live — see buildInfo.ts.
 */
const SHOW_BUILD_LABEL = false

const DESKTOP_EDGE_OFFSET = 12
const MOBILE_EDGE_OFFSET = 0 // screen space is tighter, and the safe area is already a gap

const WIDTH = 140
const HEIGHT = 20
const FONT_SIZE = 12
const BORDER_RADIUS = 4

let edgeOffset = DESKTOP_EDGE_OFFSET

export function setupBuildLabel(): void {
  if (!SHOW_BUILD_LABEL) return

  const owner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(owner, BuildLabel, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'device'
  })

  onPlatformResolved((mobile) => {
    edgeOffset = mobile ? MOBILE_EDGE_OFFSET : DESKTOP_EDGE_OFFSET
  })
}

function BuildLabel() {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: edgeOffset, right: edgeOffset },
        width: WIDTH,
        height: HEIGHT,
        borderRadius: BORDER_RADIUS
      }}
      uiBackground={{ color: getPanelBackground() }}
      uiText={{ value: BUILD_LABEL, fontSize: FONT_SIZE, color: TEXT_COLOR, textAlign: 'middle-center' }}
    />
  )
}
