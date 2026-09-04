// Shared visual chrome for the full-screen entry overlay panel — used by
// entryOverlay.tsx's renderer and serverLoadingUi.tsx's LoadingPrompt
// so they render at the same position and size regardless of which one is
// currently shown in that slot.

import { Color4 } from '@dcl/sdk/math'

export const PANEL_BACKGROUND = Color4.create(0.1, 0.1, 0.1, 0.95)
export const PANEL_BORDER_RADIUS = 16

export const OVERLAY_WRAPPER_TRANSFORM = {
  width: '100%',
  height: '100%',
  positionType: 'absolute',
  justifyContent: 'center',
  alignItems: 'center'
} as const

export const ENTRY_PANEL_TRANSFORM = {
  width: 640,
  height: 'auto',
  flexDirection: 'column',
  alignItems: 'center',
  padding: { top: 44, bottom: 44, left: 32, right: 32 },
  borderRadius: PANEL_BORDER_RADIUS,
  pointerFilter: 'block'
} as const
