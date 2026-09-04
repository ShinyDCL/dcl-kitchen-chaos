// Visual constants for the order queue HUD (ordersUi.tsx) — colors, sizes,
// z-indices, and per-platform card layout. No behavior here, just style.

import { Color4 } from '@dcl/sdk/math'

import { SAMPLE_RECIPES } from '../../shared/recipes'

export const ATLAS_TEXTURE_SRC = 'assets/scene/textures/IngredientAtlas.png'

const SUCCESS_GREEN = Color4.create(0.3, 0.72, 0.28, 1) // shared "success" hue — matches the atlas's salad/cucumber green, red pulled down so it reads green not yellow-green
const DANGER_RED = Color4.create(0.9, 0.2, 0.2, 1) // shared "timed out/overdue" hue

export const CARD_BORDER_RADIUS = 12 // no-op on mobile (unsupported there)
export const CARD_BACKGROUND = Color4.create(0, 0, 0, 0.8) // the card's own constant background — never transitions

export const OVERLAY_TRANSPARENT = Color4.create(0, 0, 0, 0) // 'normal' state — no tint, ingredients fully visible
export const OVERLAY_SUCCESS_BACKGROUND = Color4.create(SUCCESS_GREEN.r, SUCCESS_GREEN.g, SUCCESS_GREEN.b, 0.95)
export const OVERLAY_TIMED_OUT_BACKGROUND = Color4.create(DANGER_RED.r, DANGER_RED.g, DANGER_RED.b, 0.95)
export const OVERLAY_NEW_BACKGROUND = Color4.create(0.15, 0.4, 0.85, 0.95) // blue — distinct from success green and timed out red

const STATUS_OVERLAY_BG_Z_INDEX = 10 // above the ingredient stack/progress bar, dims them for text legibility
const STATUS_OVERLAY_TEXT_Z_INDEX = 15 // above the overlay background, below the order badge
export const ORDER_BADGE_Z_INDEX = 20 // above the status overlay

// Shared by every full-card overlay (the dimming layer and both status
// texts) so the positioning props aren't repeated at each call site.
const FULL_CARD_OVERLAY_POSITION = {
  positionType: 'absolute',
  position: { top: 0, left: 0 },
  width: '100%',
  height: '100%'
} as const

export const STATUS_OVERLAY_BG_TRANSFORM = {
  ...FULL_CARD_OVERLAY_POSITION,
  zIndex: STATUS_OVERLAY_BG_Z_INDEX,
  borderRadius: CARD_BORDER_RADIUS
} as const

export const STATUS_OVERLAY_TEXT_TRANSFORM = {
  ...FULL_CARD_OVERLAY_POSITION,
  zIndex: STATUS_OVERLAY_TEXT_Z_INDEX,
  justifyContent: 'center',
  alignItems: 'center'
} as const

export const SUCCESS_TITLE_FONT_SIZE = 20
export const SUCCESS_TITLE_HEIGHT = 24 // explicit, not 'auto' — a Label's intrinsic height doesn't reliably stack siblings in a column
export const SUCCESS_SUBTEXT_FONT_SIZE = 11
export const SUCCESS_SUBTEXT_HEIGHT = 14
export const SUCCESS_LINE_GAP = 2
export const SUCCESS_TEXT_COLOR = Color4.White()
export const DELIVERED_BY_NAME_MAX_LENGTH = 10 // truncated (no ellipsis) so a long display name can't overflow the card

// "Timed out!" wraps to 2 lines at this size on both card widths — sized
// for that, so middle-center centers the wrapped block, not just line 1.
export const STATUS_BADGE_FONT_SIZE = 20
export const STATUS_BADGE_HEIGHT = 52
export const STATUS_BADGE_TEXT_COLOR = Color4.White()

// Session-wide ticket number, overlaid on the card's top-left corner.
// Width is fixed (per layout) rather than 'auto' — an auto-sized parent
// around a text child doesn't reliably size itself here.
export const ORDER_BADGE_HEIGHT = 20
export const ORDER_BADGE_MARGIN = 2
export const ORDER_BADGE_FONT_SIZE = 12
export const ORDER_BADGE_BORDER_RADIUS = 10
export const ORDER_BADGE_BACKGROUND = Color4.create(0, 0, 0, 0.85)
export const ORDER_BADGE_TEXT_COLOR = Color4.White()

export const PROGRESS_TRACK_COLOR = Color4.create(0, 0, 0, 0.92) // empty portion, nearly opaque so the fill edge stays sharp
export const PROGRESS_FILL_COLOR = SUCCESS_GREEN

export interface OrderCardLayout {
  cardWidth: number
  cardPadding: number
  cardGap: number
  cardContentHeight: number // fixed — shared by the ingredient stack and the progress bar
  iconWidth: number
  iconHeight: number
  iconOverlap: number
  barWidth: number
  barGap: number // space between the ingredient stack and the progress bar
  badgeWidth: number // OrderBadge's width — sized generously enough for a 3-digit number without measuring text
  verticalAnchor: 'top' | 'bottom' // which screen edge the queue hugs
  edgeOffset: number // distance from that edge
}

// The tallest recipe defined — card content height (and progress bar
// length) is fixed to fit this, so cards line up evenly regardless of recipe.
const MAX_RECIPE_INGREDIENT_COUNT = Math.max(...SAMPLE_RECIPES.map((recipe) => recipe.ingredients.length))

// iconHeight/iconOverlap and cardContentHeight must stay consistent (a
// mismatch clips the stack or leaves a gap), so both come from one call
// instead of separately-written fields that could drift apart.
function iconLayout(
  iconHeight: number,
  iconOverlap: number
): Pick<OrderCardLayout, 'iconHeight' | 'iconOverlap' | 'cardContentHeight'> {
  return {
    iconHeight,
    iconOverlap,
    cardContentHeight: iconHeight + (MAX_RECIPE_INGREDIENT_COUNT - 1) * (iconHeight - iconOverlap)
  }
}

export const DESKTOP_LAYOUT: OrderCardLayout = {
  cardWidth: 104,
  cardPadding: 10,
  cardGap: 12,
  ...iconLayout(32, 16), // 32 = half of the atlas's native 128x64 per ingredient cell
  iconWidth: 64,
  barWidth: 10,
  barGap: 10,
  badgeWidth: 44,
  verticalAnchor: 'top',
  edgeOffset: 24
}

// Smaller, tighter-packed cards tuned from on-device testing. Anchored to
// the bottom, not the top, leaving the player's own (already cramped)
// central view clear.
export const MOBILE_LAYOUT: OrderCardLayout = {
  cardWidth: 88,
  cardPadding: 8,
  cardGap: 8,
  ...iconLayout(28, 17),
  iconWidth: 56,
  barWidth: 8,
  barGap: 8,
  badgeWidth: 36,
  verticalAnchor: 'bottom',
  edgeOffset: 12
}
