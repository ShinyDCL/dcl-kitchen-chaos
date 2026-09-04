// Shared chrome for the stacked panels in the top-right column — the
// Play/Spectate switcher, the level indicator and the coin total (see
// playerRole.tsx's RoleSwitcherRenderer, which stacks them). Kept in one
// place so the three can't drift apart, same reasoning as entryOverlayStyle.ts.

import { Color4 } from '@dcl/sdk/math'

export const PANEL_BACKGROUND = Color4.create(0, 0, 0, 0.6)
export const PANEL_BORDER_RADIUS = 10
export const PANEL_MARGIN_TOP = 8 // gap between stacked panels

/** The switcher's own dimensions, which the panels below it match — see playerRole.tsx's SwitcherLayout. */
export interface CornerPanelLayout {
  width: number
  height: number
  fontSize: number
}
