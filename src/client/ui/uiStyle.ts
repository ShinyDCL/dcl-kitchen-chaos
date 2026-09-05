// Shared vocabulary for screen-space UI: panel chrome, semantic hues and
// progress-bar colours. Anything used by more than one UI module belongs
// here; anything specific to one stays with it (the order queue's blue
// "New!" tint, its card sizing).
//
// In-world 3D text is deliberately not covered — see scene/textStyle.ts.

import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

// --- Panel chrome ---

// The same alpha reads far more opaque on mobile than on desktop, so the
// two are tuned separately rather than shared.
const DESKTOP_PANEL_BACKGROUND = Color4.create(0, 0, 0, 0.95)
const MOBILE_PANEL_BACKGROUND = Color4.create(0, 0, 0, 0.85)

/**
 * A function, not a constant, so no call site needs a platform check. The
 * UI rebuilds every frame, so a call before getPlatform() resolves
 * self-corrects.
 */
export function getPanelBackground(): Color4 {
  return isMobile() ? MOBILE_PANEL_BACKGROUND : DESKTOP_PANEL_BACKGROUND
}

/** Default for all screen UI text. Dimmed variants derive from it via withAlpha. */
export const TEXT_COLOR = Color4.White()

/** No-op on mobile, which does not support borderRadius. */
export const PANEL_BORDER_RADIUS = 12

/** Readout text in the corner panels. The order card sizes its own, per platform. */
export const EMPHASIS_FONT_SIZE = 17

/** Mobile runs on a narrower virtual canvas, so UI text is scaled up to stay readable. */
export const MOBILE_TEXT_SCALE = 1.4

/**
 * PBUiText supports <b> inline; there is no font-weight prop and the Font
 * enum has no bold face. Used on mobile only — each layout carries the flag.
 */
export function emphasize(text: string, bold: boolean): string {
  return bold ? `<b>${text}</b>` : text
}

// --- Semantic hues ---

/** Matches the ingredient atlas's salad/cucumber green, red pulled down so it reads green not yellow-green. */
export const SUCCESS_GREEN = Color4.create(0.3, 0.72, 0.28, 1)

/** Timed out / overdue. */
export const DANGER_RED = Color4.create(0.9, 0.2, 0.2, 1)

// Slightly translucent so a hint of what's beneath reads through.
const STATE_OVERLAY_ALPHA = 0.95

export const SUCCESS_BACKGROUND = withAlpha(SUCCESS_GREEN, STATE_OVERLAY_ALPHA)
export const DANGER_BACKGROUND = withAlpha(DANGER_RED, STATE_OVERLAY_ALPHA)

// --- Progress bars (order card timer, level panel) ---

export const PROGRESS_FILL_COLOR = SUCCESS_GREEN
export const PROGRESS_TRACK_COLOR = Color4.create(0, 0, 0, 0.92) // empty portion, nearly opaque so the fill edge stays sharp

/** Same colour at a different opacity — for a fade, or for text meant to sit back. */
export function withAlpha(color: Color4, alpha: number): Color4 {
  return Color4.create(color.r, color.g, color.b, alpha)
}
