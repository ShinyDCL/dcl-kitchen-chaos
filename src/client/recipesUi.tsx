// Recipe queue HUD — cards along the top-left, newest slot first. Reads
// straight from the synced RecipeSlotState entities every frame; no local
// prediction to protect, so no reconcile step like heldItem.ts's. Only
// visible to players in the 'play' role.
//
// The server broadcasts 'recipeDelivered'/'recipeExpired'/'recipeGenerated'
// once each, and each client times its result/new-recipe highlight locally
// from receipt — not a shared server deadline latency could cut short. A
// result card (success or timed out) and its slot's live card are
// independent entries (getActiveRecipes) — if a client sees the live
// update before its own result display ends (latency skew), both just
// render at once. pendingNewFlashSlots guards the case where
// 'recipeGenerated' beats the RecipeSlotState sync itself.
//
// Card background eases between normal/new/success via getCardBackground's
// per-card lerp state — cheap, since this UI rebuilds fully every frame.
//
// Ingredients stack bottom-to-top via absolute positioning with an
// explicitly computed height, not flex + negative margins — flex's 'auto'
// height isn't reliable with those.
//
// DESKTOP_LAYOUT/MOBILE_LAYOUT hold platform-tuned sizing; currentLayout
// starts as desktop and updates once getPlatform() resolves.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlatform, isMobile } from '@dcl/sdk/platform'
import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { RECIPE_NEW_FLASH_SECONDS, RECIPE_RESULT_DISPLAY_SECONDS } from '../shared/constants'
import { room } from '../shared/messages'
import { getIngredientAtlasUvs, getRecipeById, Recipe } from '../shared/recipes'
import { RecipeSlotState } from '../shared/schemas'
import { isLocalPlayerPlaying } from './playerRoleState'

const ATLAS_TEXTURE_SRC = 'assets/scene/textures/IngredientAtlas.png'

const SUCCESS_GREEN = Color4.create(0.2, 0.85, 0.3, 1) // shared base hue for every "success" signal on this HUD
const DANGER_RED = Color4.create(0.9, 0.2, 0.2, 1) // shared base hue for every "timed out/overdue" signal on this HUD

const CARD_BORDER_RADIUS = 12 // no-op on mobile (unsupported there)
const CARD_BACKGROUND = Color4.create(0, 0, 0, 0.8)
const CARD_SUCCESS_BACKGROUND = Color4.create(SUCCESS_GREEN.r, SUCCESS_GREEN.g, SUCCESS_GREEN.b, 0.9)
const CARD_TIMED_OUT_BACKGROUND = Color4.create(DANGER_RED.r, DANGER_RED.g, DANGER_RED.b, 0.9)
const CARD_NEW_BACKGROUND = Color4.create(0.15, 0.4, 0.85, 0.9) // blue — distinct from success green and the timer bar's red
const CARD_COLOR_TRANSITION_SECONDS = 0.3
const TIMER_BAR_HEIGHT = 8
const TIMER_BAR_BORDER_RADIUS = 4
const TIMER_BAR_MARGIN_TOP = 8

const SUCCESS_TITLE_FONT_SIZE = 14
const SUCCESS_TITLE_HEIGHT = 18 // explicit, not 'auto' — a Label's intrinsic height doesn't reliably stack siblings in a column
const SUCCESS_SUBTEXT_FONT_SIZE = 11
const SUCCESS_SUBTEXT_HEIGHT = 14
const SUCCESS_LINE_GAP = 2
const SUCCESS_MESSAGE_MARGIN_TOP = 2
const SUCCESS_TEXT_COLOR = Color4.White()
const DELIVERED_BY_NAME_MAX_LENGTH = 10 // truncated (no ellipsis) so a long display name can't overflow the card

// Shared by every simple one-line footer badge (New!, Timed Out!) — see StatusBadge.
const STATUS_BADGE_FONT_SIZE = 14
const STATUS_BADGE_HEIGHT = 18
const STATUS_BADGE_MARGIN_TOP = 2
const STATUS_BADGE_TEXT_COLOR = Color4.White()

// Order badge — a session-wide ticket number (climbs for the whole
// session, see server/recipeQueue.ts's orderNumber), overlaid on the
// card's top-left corner rather than its own row, since card height
// already varies by recipe (see the file header). A fixed dark color
// rather than the card's own background keeps it readable against all
// three card states. Width is fixed rather than 'auto' — an auto-sized
// parent around a text child doesn't reliably size itself in this
// renderer (see playerRole.tsx's switcher for the same gotcha) — sized
// generously enough for a 3-digit number without measuring text.
const ORDER_BADGE_WIDTH = 36
const ORDER_BADGE_HEIGHT = 20
const ORDER_BADGE_MARGIN = 2
const ORDER_BADGE_FONT_SIZE = 12
const ORDER_BADGE_BORDER_RADIUS = 10
const ORDER_BADGE_BACKGROUND = Color4.create(0, 0, 0, 0.85)
const ORDER_BADGE_TEXT_COLOR = Color4.White()

// Two fixed zones (green/red) instead of a single growing fill — a dark
// mask anchored to the right shrinks as progress increases, revealing
// whether the deadline reached is still safely green or overdue in red.
// Mask is nearly opaque so the edge stays sharp on a small bar.
const TIMER_ZONE_GREEN_PERCENT = 75
const TIMER_ZONE_RED_PERCENT = 25
const TIMER_MASK_COLOR = Color4.create(0, 0, 0, 0.92)

interface RecipeCardLayout {
  cardWidth: number
  cardPadding: number
  cardGap: number
  iconWidth: number
  iconHeight: number
  iconOverlap: number
  topOffset: number
  leftOffset: number
}

const DESKTOP_LAYOUT: RecipeCardLayout = {
  cardWidth: 96,
  cardPadding: 10,
  cardGap: 12,
  iconWidth: 64,
  iconHeight: 32, // half of the atlas's native 128x64 per ingredient cell
  iconOverlap: 16,
  topOffset: 24,
  leftOffset: 24
}

// Smaller, tighter-packed cards tuned from on-device testing.
const MOBILE_LAYOUT: RecipeCardLayout = {
  cardWidth: 76,
  cardPadding: 6,
  cardGap: 8,
  iconWidth: 56,
  iconHeight: 28,
  iconOverlap: 15,
  topOffset: 0,
  leftOffset: 24
}

let currentLayout: RecipeCardLayout = DESKTOP_LAYOUT

export function setupRecipesUi(): void {
  ReactEcsRenderer.setUiRenderer(RecipesUI, { virtualWidth: 1920, virtualHeight: 1080, screenInset: 'interactable' })
  startPlatformDetection()

  room.onMessage('recipeDelivered', (data) => {
    const recipe = getRecipeById(data.recipeId)
    if (!recipe) return // shouldn't happen — recipeId always comes from the shared recipe pool
    cardOverrides.set(data.slotIndex, {
      kind: 'success',
      recipe,
      deliveredByName: data.deliveredByName,
      generatedAt: Number(data.generatedAt),
      orderNumber: data.orderNumber,
      endsAt: Date.now() + RECIPE_RESULT_DISPLAY_SECONDS * 1000
    })
  })

  room.onMessage('recipeExpired', (data) => {
    const recipe = getRecipeById(data.recipeId)
    if (!recipe) return // shouldn't happen — recipeId always comes from the shared recipe pool
    cardOverrides.set(data.slotIndex, {
      kind: 'timedOut',
      recipe,
      deliveredByName: '',
      generatedAt: Number(data.generatedAt),
      orderNumber: data.orderNumber,
      endsAt: Date.now() + RECIPE_RESULT_DISPLAY_SECONDS * 1000
    })
  })

  room.onMessage('recipeGenerated', (data) => {
    pendingNewFlashSlots.add(data.slotIndex)
  })
}

/** Polls until getPlatform() resolves (null briefly at startup), then locks in the layout once. */
function startPlatformDetection(): void {
  engine.addSystem(function detectPlatform() {
    if (getPlatform() === null) return
    engine.removeSystem(detectPlatform)
    currentLayout = isMobile() ? MOBILE_LAYOUT : DESKTOP_LAYOUT
  })
}

interface CardOverride {
  kind: 'success' | 'timedOut'
  recipe: Recipe
  deliveredByName: string // '' for a timeout — nobody delivered it
  generatedAt: number // the recipe's own generatedAt, not the result's start time — keeps its row position instead of jumping to the front
  orderNumber: number
  endsAt: number
}

// Keyed by slotIndex — client-local timing, see the file header comment.
const cardOverrides = new Map<number, CardOverride>()

// Keyed by slotIndex — a slot that got 'recipeGenerated' but hasn't been
// rendered yet (still covered by its own success celebration). The flash
// timer only starts once actually rendered, so a refill right after this
// client's own delivery still gets its full flash instead of elapsing
// unseen underneath the longer celebration.
const pendingNewFlashSlots = new Set<number>()

// Keyed by slotIndex, value is when the "New!" flash ends locally, once started.
const newRecipeFlashUntil = new Map<number, number>()

type CardVisualState = 'normal' | 'new' | 'success' | 'timedOut'

interface ActiveRecipe {
  cardKey: string // unique per rendered card — a celebrating slot and its already-regenerated live slot can render simultaneously, so slotIndex alone isn't unique
  recipe: Recipe
  generatedAt: number
  orderNumber: number
  visualState: CardVisualState
  deliveredByName: string
}

/**
 * Newest first by generatedAt. A result override and its slot's live state
 * are independent entries, not mutually exclusive — if the server's
 * regenerated recipe becomes visible before this client's own result
 * display ends (latency skew), both simply show at once instead of one
 * hiding the other.
 */
function getActiveRecipes(): ActiveRecipe[] {
  const now = Date.now()
  const active: ActiveRecipe[] = []

  for (const [slotIndex, override] of cardOverrides) {
    if (now >= override.endsAt) {
      cardOverrides.delete(slotIndex)
      continue
    }
    active.push({
      cardKey: `${override.kind}-${slotIndex}`,
      recipe: override.recipe,
      generatedAt: override.generatedAt,
      orderNumber: override.orderNumber,
      visualState: override.kind,
      deliveredByName: override.deliveredByName
    })
  }

  for (const [, data] of engine.getEntitiesWith(RecipeSlotState)) {
    if (!data.active) continue
    const recipe = getRecipeById(data.recipeId)
    if (!recipe) continue // shouldn't happen — recipeId always comes from the shared recipe pool

    let isNew: boolean
    if (pendingNewFlashSlots.delete(data.slotIndex)) {
      newRecipeFlashUntil.set(data.slotIndex, now + RECIPE_NEW_FLASH_SECONDS * 1000)
      isNew = true
    } else {
      const flashUntil = newRecipeFlashUntil.get(data.slotIndex)
      isNew = flashUntil !== undefined && now < flashUntil
      if (flashUntil !== undefined && !isNew) newRecipeFlashUntil.delete(data.slotIndex)
    }

    active.push({
      cardKey: `live-${data.slotIndex}`,
      recipe,
      generatedAt: Number(data.generatedAt),
      orderNumber: data.orderNumber,
      visualState: isNew ? 'new' : 'normal',
      deliveredByName: ''
    })
  }

  return active.sort((a, b) => b.generatedAt - a.generatedAt)
}

// Keyed by slotIndex — an in-progress background ease; see getCardBackground.
interface CardColorTransition {
  fromColor: Color4
  toColor: Color4
  state: CardVisualState
  startedAt: number
}
const cardColorTransitions = new Map<string, CardColorTransition>()

function visualStateColor(state: CardVisualState): Color4 {
  if (state === 'success') return CARD_SUCCESS_BACKGROUND
  if (state === 'timedOut') return CARD_TIMED_OUT_BACKGROUND
  if (state === 'new') return CARD_NEW_BACKGROUND
  return CARD_BACKGROUND
}

/** The card background for this card, easing toward `state`'s color whenever `state` just changed, rather than snapping instantly. */
function getCardBackground(cardKey: string, state: CardVisualState): Color4 {
  const now = Date.now()
  const existing = cardColorTransitions.get(cardKey)
  const targetColor = visualStateColor(state)

  if (!existing || existing.state !== state) {
    // Start from the current eased color, not the old target, so a state change mid-fade doesn't jump.
    const fromColor = existing ? lerpTransitionColor(existing, now) : targetColor
    const transition: CardColorTransition = { fromColor, toColor: targetColor, state, startedAt: now }
    cardColorTransitions.set(cardKey, transition)
    return fromColor
  }

  return lerpTransitionColor(existing, now)
}

function lerpTransitionColor(transition: CardColorTransition, now: number): Color4 {
  const t = Math.min((now - transition.startedAt) / (CARD_COLOR_TRANSITION_SECONDS * 1000), 1)
  return Color4.lerp(transition.fromColor, transition.toColor, t)
}

function RecipesUI() {
  if (!isLocalPlayerPlaying()) return null // spectators (and anyone who hasn't chosen Play yet) don't see the queue at all

  const layout = currentLayout
  const recipes = getActiveRecipes()

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: layout.topOffset, left: layout.leftOffset },
          width: 'auto',
          height: 'auto',
          flexDirection: 'row',
          // Default alignItems is 'stretch', which would force every card
          // to the tallest sibling's height — 'flex-start' lets each size
          // to its own content instead.
          alignItems: 'flex-start'
        }}
      >
        {recipes.map(({ cardKey, recipe, generatedAt, orderNumber, visualState, deliveredByName }) => (
          <RecipeCard
            cardKey={cardKey}
            orderNumber={orderNumber}
            recipe={recipe}
            generatedAt={generatedAt}
            visualState={visualState}
            deliveredByName={deliveredByName}
            layout={layout}
          />
        ))}
      </UiEntity>
    </UiEntity>
  )
}

function RecipeCard({
  cardKey,
  orderNumber,
  recipe,
  generatedAt,
  visualState,
  deliveredByName,
  layout
}: {
  cardKey: string
  orderNumber: number
  recipe: Recipe
  generatedAt: number
  visualState: CardVisualState
  deliveredByName: string
  layout: RecipeCardLayout
}) {
  const background = getCardBackground(cardKey, visualState)

  return (
    <UiEntity
      uiTransform={{
        width: layout.cardWidth,
        height: 'auto',
        flexDirection: 'column',
        alignItems: 'center',
        padding: layout.cardPadding,
        margin: { right: layout.cardGap },
        borderRadius: CARD_BORDER_RADIUS
      }}
      uiBackground={{ color: background }}
    >
      <IngredientStack ingredients={recipe.ingredients} layout={layout} />
      {visualState === 'success' ? (
        <SuccessMessage deliveredByName={deliveredByName} />
      ) : visualState === 'timedOut' ? (
        <StatusBadge text="Timed Out!" />
      ) : visualState === 'new' ? (
        <StatusBadge text="New!" />
      ) : (
        <TimerBar timerSeconds={recipe.timerSeconds} generatedAt={generatedAt} />
      )}
      {/* Rendered last (and given a zIndex) so it paints over the ingredient stack rather than under it. */}
      <OrderBadge orderNumber={orderNumber} />
    </UiEntity>
  )
}

/** A pill, not a circle — a circle only has room for 1-2 digits before text starts clipping at the rounded edges; a pill can grow wider as the session-wide ticket number climbs. */
function OrderBadge({ orderNumber }: { orderNumber: number }) {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: ORDER_BADGE_MARGIN, left: ORDER_BADGE_MARGIN },
        zIndex: 10,
        width: ORDER_BADGE_WIDTH,
        height: ORDER_BADGE_HEIGHT,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: ORDER_BADGE_BORDER_RADIUS
      }}
      uiBackground={{ color: ORDER_BADGE_BACKGROUND }}
    >
      <Label
        value={`#${orderNumber}`}
        fontSize={ORDER_BADGE_FONT_SIZE}
        color={ORDER_BADGE_TEXT_COLOR}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: '100%' }}
      />
    </UiEntity>
  )
}

function SuccessMessage({ deliveredByName }: { deliveredByName: string }) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: SUCCESS_TITLE_HEIGHT + SUCCESS_LINE_GAP + SUCCESS_SUBTEXT_HEIGHT,
        flexDirection: 'column',
        alignItems: 'center',
        margin: { top: SUCCESS_MESSAGE_MARGIN_TOP }
      }}
    >
      <Label
        value="Success!"
        fontSize={SUCCESS_TITLE_FONT_SIZE}
        color={SUCCESS_TEXT_COLOR}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: SUCCESS_TITLE_HEIGHT }}
      />
      <Label
        value={`by ${deliveredByName.slice(0, DELIVERED_BY_NAME_MAX_LENGTH)}`}
        fontSize={SUCCESS_SUBTEXT_FONT_SIZE}
        color={SUCCESS_TEXT_COLOR}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: SUCCESS_SUBTEXT_HEIGHT, margin: { top: SUCCESS_LINE_GAP } }}
      />
    </UiEntity>
  )
}

/** A simple one-line footer badge — used for both the "New!" flash and the "Timed Out!" result. */
function StatusBadge({ text }: { text: string }) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: STATUS_BADGE_HEIGHT,
        alignItems: 'center',
        margin: { top: STATUS_BADGE_MARGIN_TOP }
      }}
    >
      <Label
        value={text}
        fontSize={STATUS_BADGE_FONT_SIZE}
        color={STATUS_BADGE_TEXT_COLOR}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: STATUS_BADGE_HEIGHT }}
      />
    </UiEntity>
  )
}

/**
 * Stacks ingredients bottom-up: ingredients[0] sits at the bottom, each
 * next one overlaps higher up, last one on top in z-order. Height is
 * computed from the ingredient count so the card shrink-wraps exactly —
 * different recipes intentionally get different card heights.
 */
function IngredientStack({ ingredients, layout }: { ingredients: string[]; layout: RecipeCardLayout }) {
  const iconStep = layout.iconHeight - layout.iconOverlap
  const stackHeight = layout.iconHeight + (ingredients.length - 1) * iconStep

  return (
    <UiEntity uiTransform={{ width: layout.iconWidth, height: stackHeight }}>
      {ingredients.map((ingredient, index) => (
        <UiEntity
          key={`${ingredient}-${index}`}
          uiTransform={{
            positionType: 'absolute',
            position: { bottom: index * iconStep, left: 0 },
            width: layout.iconWidth,
            height: layout.iconHeight,
            zIndex: index + 1 // later ingredients render in front
          }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: ATLAS_TEXTURE_SRC },
            uvs: getIngredientAtlasUvs(ingredient)
          }}
        />
      ))}
    </UiEntity>
  )
}

function TimerBar({ timerSeconds, generatedAt }: { timerSeconds: number; generatedAt: number }) {
  const elapsedSeconds = (Date.now() - generatedAt) / 1000
  const progress = Math.min(elapsedSeconds / timerSeconds, 1)
  const maskWidthPercent = (1 - progress) * 100

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: TIMER_BAR_HEIGHT,
        margin: { top: TIMER_BAR_MARGIN_TOP },
        flexDirection: 'row',
        borderRadius: TIMER_BAR_BORDER_RADIUS,
        overflow: 'hidden'
      }}
    >
      <UiEntity
        uiTransform={{ width: `${TIMER_ZONE_GREEN_PERCENT}%`, height: '100%' }}
        uiBackground={{ color: SUCCESS_GREEN }}
      />
      <UiEntity
        uiTransform={{ width: `${TIMER_ZONE_RED_PERCENT}%`, height: '100%' }}
        uiBackground={{ color: DANGER_RED }}
      />
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, right: 0 },
          width: `${maskWidthPercent}%`,
          height: '100%'
        }}
        uiBackground={{ color: TIMER_MASK_COLOR }}
      />
    </UiEntity>
  )
}
