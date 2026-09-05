// Shared visual chrome for the full-screen entry overlay panel — used by
// entryOverlay.tsx's renderer and serverLoadingUi.tsx's LoadingPrompt
// so they render at the same position and size regardless of which one is
// currently shown in that slot.

// Its own radius, not uiStyle’s PANEL_BORDER_RADIUS: this is a full-screen
// modal, and the smaller panels’ rounding reads too tight at this size.
const ENTRY_PANEL_BORDER_RADIUS = 24

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
  borderRadius: ENTRY_PANEL_BORDER_RADIUS,
  pointerFilter: 'block'
} as const
