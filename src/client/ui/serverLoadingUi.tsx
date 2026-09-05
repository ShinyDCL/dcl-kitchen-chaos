// "Loading..." prompt shown in the entry overlay's slot while the server
// isn't alive yet (see serverReadiness.ts) — entryOverlay.tsx decides when
// to show it and which layout to pass; this only owns what it looks like.
// Uses entryOverlayStyle.ts's panel transforms.
//
// The dot count is derived from Date.now() each frame rather than ticked
// by a system — this UI already fully rebuilds every frame, so a plain
// modulo is enough to cycle 0→1→2→3 dots.
//
// The word and the dots are separate fixed-width labels: appending to one
// centered string changes its width every half second, which shifts the
// whole thing sideways and reads as jitter.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { ENTRY_PANEL_TRANSFORM, OVERLAY_WRAPPER_TRANSFORM } from './entryOverlayStyle'
import { emphasize, getPanelBackground, TEXT_COLOR } from './uiStyle'

// Vertical room around the text, so the 'auto'-height panel comes out a
// deliberate size rather than hugging the label.
const LOADING_CONTENT_HEIGHT = 204

const LOADING_DOT_INTERVAL_SECONDS = 0.5 // cycles 0→1→2→3 dots, ~2s per loop

export interface LoadingLayout {
  fontSize: number
  wordWidth: number // fixed box for “Loading”, right-aligned so the word ends at the seam
  dotsSlotWidth: number // must fit three BOLD dots at fontSize, or the third one clips
  bold: boolean // mobile only — see uiStyle's emphasize
}

export const DESKTOP_LOADING_LAYOUT: LoadingLayout = { fontSize: 28, wordWidth: 130, dotsSlotWidth: 46, bold: false }

// Bumped on mobile like the rest of the UI, or this would be the only piece
// staying at its desktop size while everything around it grows.
export const MOBILE_LOADING_LAYOUT: LoadingLayout = { fontSize: 35, wordWidth: 163, dotsSlotWidth: 58, bold: true }

export function LoadingPrompt({ layout }: { layout: LoadingLayout }) {
  const dotCount = Math.floor(Date.now() / (LOADING_DOT_INTERVAL_SECONDS * 1000)) % 4

  return (
    <UiEntity uiTransform={OVERLAY_WRAPPER_TRANSFORM}>
      <UiEntity uiTransform={ENTRY_PANEL_TRANSFORM} uiBackground={{ color: getPanelBackground() }}>
        <UiEntity
          uiTransform={{
            width: '100%',
            height: LOADING_CONTENT_HEIGHT,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          <Label
            value={emphasize('Loading', layout.bold)}
            fontSize={layout.fontSize}
            color={TEXT_COLOR}
            textAlign="middle-right"
            uiTransform={{ width: layout.wordWidth, height: '100%' }}
          />
          <Label
            value={emphasize('.'.repeat(dotCount), layout.bold)}
            fontSize={layout.fontSize}
            color={TEXT_COLOR}
            textAlign="middle-left"
            uiTransform={{ width: layout.dotsSlotWidth, height: '100%' }}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
