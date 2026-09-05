// Shared chrome for the stacked panels in the top-right column — the level
// indicator and the coin total (see cornerPanels.tsx, which stacks them).
// Kept in one place so the two can't drift apart, same reasoning as
// entryOverlayStyle.ts.

export const PANEL_MARGIN_TOP = 8 // gap ABOVE a panel — only on ones with a sibling above, never the first in the column, or it would push the whole column down

/** Shared dimensions for every panel in the column, so they line up. */
export interface CornerPanelLayout {
  width: number
  height: number
  fontSize: number
  barThickness: number // level panel's progress bar — matched to the order card's bar, see cornerPanels.tsx
  barMarginTop: number // gap between the level label and its bar
  edgeOffset: number // distance from the interactable area’s top-right corner
  bold: boolean // mobile only — thin text is harder to read at arm’s length
}

