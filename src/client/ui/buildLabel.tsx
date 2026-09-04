// Always-on build stamp in the bottom-right corner — see buildInfo.ts for
// why. Its own renderer rather than a corner of an existing one, so it stays
// visible through every UI state, including the entry overlay.
//
// 'interactable' inset keeps it clear of the client's own chrome, same as
// the top-right corner panels.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { BUILD_LABEL } from '../buildInfo'

const EDGE_OFFSET = 12
const WIDTH = 140
const HEIGHT = 20
const FONT_SIZE = 12
const BORDER_RADIUS = 4

const BACKGROUND = Color4.create(0, 0, 0, 0.4) // faint — readable over any scene without drawing the eye
const TEXT_COLOR = Color4.create(1, 1, 1, 0.65)

export function setupBuildLabel(): void {
  const owner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(owner, BuildLabel, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'interactable'
  })
}

function BuildLabel() {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { bottom: EDGE_OFFSET, right: EDGE_OFFSET },
        width: WIDTH,
        height: HEIGHT,
        borderRadius: BORDER_RADIUS
      }}
      uiBackground={{ color: BACKGROUND }}
      uiText={{ value: BUILD_LABEL, fontSize: FONT_SIZE, color: TEXT_COLOR, textAlign: 'middle-center' }}
    />
  )
}
