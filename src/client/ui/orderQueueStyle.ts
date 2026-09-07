// Visual constants for the order queue HUD (ordersUi.tsx) — colors, sizes,
// z-indices, and per-platform card layout. No behavior here, just style.

import { Color4 } from '@dcl/sdk/math'

import { SAMPLE_RECIPES } from '../../shared/recipes'
import { PANEL_BORDER_RADIUS } from './uiStyle'

export const ATLAS_TEXTURE_SRC = 'assets/scene/textures/IngredientAtlas.png'

export const CARD_BORDER_RADIUS = PANEL_BORDER_RADIUS // shared with the other panels — see uiStyle.ts

export const OVERLAY_TRANSPARENT = Color4.create(0, 0, 0, 0) // 'normal' state — no tint, ingredients fully visible
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

export const DELIVERED_BY_NAME_MAX_LENGTH = 10 // truncated (no ellipsis) so a long display name can't overflow the card


// Session-wide ticket number, overlaid on the card's top-left corner.
// Width is fixed (per layout) rather than 'auto' — an auto-sized parent
// around a text child doesn't reliably size itself here.
export const ORDER_BADGE_BACKGROUND = Color4.create(0, 0, 0, 0.85)


/**
 * Text and badge sizing. Separate from the card's box dimensions only
 * because it all scales together off one factor — see cardText().
 */
export interface CardTextLayout {
  successTitleHeight: number // explicit, not 'auto' — a Label's intrinsic height doesn't reliably stack siblings in a column
  successSubtextFontSize: number
  successSubtextHeight: number
  successLineGap: number
  statusFontSize: number
  statusHeight: number // tall enough for "Timed out!" to wrap to 2 lines, so middle-center centers the wrapped block
  badgeHeight: number
  badgeFontSize: number
  badgeMargin: number
  badgeRadius: number // half badgeHeight — what makes it a pill rather than a rounded box
}

/** Every text size in the card, scaled off the desktop baseline. */
// Desktop keeps the sizes the card was designed at. Mobile is tuned
// separately rather than scaled from them: it needs a bigger order number
// and status text than a pure multiple would give, and deriving both from
// one baseline meant every mobile tweak silently moved desktop too.
const DESKTOP_CARD_TEXT: CardTextLayout = {
  successTitleHeight: 24,
  successSubtextFontSize: 11,
  successSubtextHeight: 14,
  successLineGap: 2,
  statusFontSize: 20,
  statusHeight: 52,
  badgeHeight: 20,
  badgeFontSize: 12,
  badgeMargin: 2,
  badgeRadius: 10 // half badgeHeight
}

const MOBILE_CARD_TEXT: CardTextLayout = {
  successTitleHeight: 29,
  successSubtextFontSize: 15,
  successSubtextHeight: 20,
  successLineGap: 3,
  statusFontSize: 24,
  statusHeight: 73,
  badgeHeight: 31,
  badgeFontSize: 22,
  badgeMargin: 3,
  badgeRadius: 15.5 // half badgeHeight
}

export interface OrderCardLayout extends CardTextLayout {
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
  bold: boolean // mobile only — see uiStyle's emphasize
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
  ...DESKTOP_CARD_TEXT,
  bold: false,
  verticalAnchor: 'top',
  edgeOffset: 24
}

// Anchored to the bottom, not the top, leaving the player’s own (already
// cramped) central view clear. Sized ~1.25x the original on-device tuning —
// mobile’s virtual canvas is narrower (1600 vs 1920), so the cards were
// reading small next to the rest of the HUD.
export const MOBILE_LAYOUT: OrderCardLayout = {
  cardWidth: 110,
  cardPadding: 10,
  cardGap: 10,
  ...iconLayout(35, 21),
  iconWidth: 70,
  barWidth: 10,
  barGap: 10,
  badgeWidth: 58,
  ...MOBILE_CARD_TEXT,
  bold: true,
  verticalAnchor: 'bottom',
  edgeOffset: 0 // flush to the safe area — the renderer's 'device' inset already clears the hardware margins
}
