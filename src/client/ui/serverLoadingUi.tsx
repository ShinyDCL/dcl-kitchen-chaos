// "Loading..." prompt shown in the entry overlay's slot while the server
// isn't alive yet (see serverReadiness.ts) — playerRole.tsx decides when
// to show this instead of the role prompt; this only owns what it looks
// like. Shares entryOverlayStyle.ts's panel transforms with
// playerRole.tsx's RolePrompt so both render at the same size.
//
// The dot count is derived from Date.now() each frame rather than ticked
// by a system — this UI already fully rebuilds every frame, so a plain
// modulo is enough to cycle 0→1→2→3 dots.

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { ENTRY_PANEL_TRANSFORM, OVERLAY_WRAPPER_TRANSFORM, PANEL_BACKGROUND } from './entryOverlayStyle'

// Tuned to roughly match RolePrompt's content stack (title + two buttons +
// gaps) so this 'auto'-height panel comes out the same size.
const LOADING_CONTENT_HEIGHT = 204
const LOADING_DOT_INTERVAL_SECONDS = 0.5 // cycles 0→1→2→3 dots, ~2s per loop

export function LoadingPrompt() {
  const dotCount = Math.floor(Date.now() / (LOADING_DOT_INTERVAL_SECONDS * 1000)) % 4

  return (
    <UiEntity uiTransform={OVERLAY_WRAPPER_TRANSFORM}>
      <UiEntity uiTransform={ENTRY_PANEL_TRANSFORM} uiBackground={{ color: PANEL_BACKGROUND }}>
        <UiEntity
          uiTransform={{ width: '100%', height: LOADING_CONTENT_HEIGHT, justifyContent: 'center', alignItems: 'center' }}
        >
          <Label value={`Loading${'.'.repeat(dotCount)}`} fontSize={28} color={Color4.White()} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
