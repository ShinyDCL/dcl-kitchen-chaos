// Shared chrome for the stacked panels in the top-right column — the level
// indicator and the coin total (see cornerPanels.tsx, which stacks them).
// Kept in one place so the two can't drift apart, same reasoning as
// entryOverlayStyle.ts.

import { Color4 } from '@dcl/sdk/math'

export const PANEL_BACKGROUND = Color4.create(0, 0, 0, 0.6)
export const PANEL_BORDER_RADIUS = 10
export const PANEL_MARGIN_TOP = 8 // gap between stacked panels

/** Shared dimensions for every panel in the column, so they line up. */
export interface CornerPanelLayout {
  width: number
  height: number
  fontSize: number
}
