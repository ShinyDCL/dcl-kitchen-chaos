// Order queue HUD — cards centered horizontally, newest first, top on
// desktop and bottom on mobile (see orderQueueStyle.ts's DESKTOP_LAYOUT/
// MOBILE_LAYOUT — mobile is short on vertical room, so this stays clear of
// the top where the player's own view is centered). Reads straight from
// the synced OrderState entities every frame; no local prediction to
// protect, so no reconcile step like heldItem.ts's. Only visible to
// players in the 'play' role.
//
// The server broadcasts 'orderDelivered' once; each client times its
// result highlight locally from receipt. Timing out and the "New!" flash
// are derived locally from generatedAt instead — see getActiveOrders. A
// result card and a live order are
// independent entries (getActiveOrders), keyed by orderNumber (never
// reused) — both can render at once if a fresh order beats an earlier
// result display ending. The server delays a resolved order's replacement
// by ORDER_RESULT_DISPLAY_SECONDS (see orderQueue.ts) so that's rare.
//
// New/success/timedOut render as a colorful overlay drawn ON TOP of the
// ingredient stack and progress bar, not a background color change — the
// ingredients are opaque textures, so a color behind them wouldn't show.
// Eases in/out via getStatusOverlayColor.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { ORDER_RESULT_DISPLAY_SECONDS } from '../../shared/constants'
import { room } from '../../shared/messages'
import { getIngredientAtlasUvs, getRecipeById, Recipe } from '../../shared/recipes'
import { OrderState } from '../../shared/schemas'
import { onPlatformResolved } from '../platformDetection'
import { isLocalPlayerPlaying } from '../playerRoleState'
import {
  ATLAS_TEXTURE_SRC,
  CARD_BACKGROUND,
  CARD_BORDER_RADIUS,
  DELIVERED_BY_NAME_MAX_LENGTH,
  DESKTOP_LAYOUT,
  MOBILE_LAYOUT,
  ORDER_BADGE_BACKGROUND,
  ORDER_BADGE_BORDER_RADIUS,
  ORDER_BADGE_FONT_SIZE,
  ORDER_BADGE_HEIGHT,
  ORDER_BADGE_MARGIN,
  ORDER_BADGE_TEXT_COLOR,
  ORDER_BADGE_Z_INDEX,
  OrderCardLayout,
  OVERLAY_NEW_BACKGROUND,
  OVERLAY_SUCCESS_BACKGROUND,
  OVERLAY_TIMED_OUT_BACKGROUND,
  OVERLAY_TRANSPARENT,
  PROGRESS_FILL_COLOR,
  PROGRESS_TRACK_COLOR,
  STATUS_BADGE_FONT_SIZE,
  STATUS_BADGE_HEIGHT,
  STATUS_BADGE_TEXT_COLOR,
  STATUS_OVERLAY_BG_TRANSFORM,
  STATUS_OVERLAY_TEXT_TRANSFORM,
  SUCCESS_LINE_GAP,
  SUCCESS_SUBTEXT_FONT_SIZE,
  SUCCESS_SUBTEXT_HEIGHT,
  SUCCESS_TEXT_COLOR,
  SUCCESS_TITLE_FONT_SIZE,
  SUCCESS_TITLE_HEIGHT
} from './orderQueueStyle'

// How long a freshly generated order flashes its "New!" highlight.
const ORDER_NEW_FLASH_SECONDS = 1

const OVERLAY_COLOR_TRANSITION_SECONDS = 0.3

let currentLayout: OrderCardLayout = DESKTOP_LAYOUT

export function setupOrdersUi(): void {
  // 'device' only clears the hardware safe area (no-op on desktop), unlike
  // 'interactable' which also excludes the minimap/chat and would keep the
  // queue off true screen-center.
  ReactEcsRenderer.setUiRenderer(OrdersUI, { virtualWidth: 1920, virtualHeight: 1080, screenInset: 'device' })
  onPlatformResolved((mobile) => {
    currentLayout = mobile ? MOBILE_LAYOUT : DESKTOP_LAYOUT
  })

  room.onMessage('orderDelivered', (data) => {
    const recipe = getRecipeById(data.recipeId)
    if (!recipe) return // shouldn't happen — recipeId always comes from the shared recipe pool
    cardOverrides.set(data.orderNumber, {
      kind: 'success',
      recipe,
      deliveredByName: data.deliveredByName,
      generatedAt: Number(data.generatedAt),
      orderNumber: data.orderNumber,
      endsAt: Date.now() + ORDER_RESULT_DISPLAY_SECONDS * 1000
    })
  })
}

interface CardOverride {
  kind: 'success' | 'timedOut'
  recipe: Recipe
  deliveredByName: string // '' for a timeout — nobody delivered it
  generatedAt: number // the order's own generatedAt, not the result's start time — keeps its row position instead of jumping to the front
  orderNumber: number
  endsAt: number
}

// Keyed by orderNumber — client-local timing, see the file header comment.
const cardOverrides = new Map<number, CardOverride>()

type CardVisualState = 'normal' | 'new' | 'success' | 'timedOut'

interface ActiveOrder {
  cardKey: string // orderNumber as a string — never reused, so unique across both overrides and live orders
  recipe: Recipe
  generatedAt: number
  orderNumber: number
  visualState: CardVisualState
  deliveredByName: string
}

/**
 * Newest first by generatedAt. A result override and a *different*
 * order's live entry can render at once (e.g. a fresh order beating an
 * earlier result display ending). But the *same* order's override and
 * live entry are mutually exclusive: a delivered order's override and its
 * entity's CRDT removal propagate on separate channels with no ordering
 * guarantee, so a brief window can show both — without deduping that's a
 * duplicate cardKey, confusing the keyed reconciler and thrashing
 * getStatusOverlayColor. So once an order has an override, its live entry
 * is skipped.
 *
 * Timing out and the "New!" flash are both derived locally from
 * generatedAt, unlike delivery (unpredictable player action) — no
 * broadcast, no race against CRDT removal/creation.
 */
function getActiveOrders(): ActiveOrder[] {
  const now = Date.now()
  const active: ActiveOrder[] = []

  for (const [orderNumber, override] of cardOverrides) {
    if (now >= override.endsAt) {
      cardOverrides.delete(orderNumber)
      continue
    }
    active.push({
      cardKey: String(orderNumber),
      recipe: override.recipe,
      generatedAt: override.generatedAt,
      orderNumber,
      visualState: override.kind,
      deliveredByName: override.deliveredByName
    })
  }

  for (const [, data] of engine.getEntitiesWith(OrderState)) {
    if (cardOverrides.has(data.orderNumber)) continue // already represented by its override above — see this function's comment

    const recipe = getRecipeById(data.recipeId)
    if (!recipe) continue // shouldn't happen — recipeId always comes from the shared recipe pool
    const generatedAt = Number(data.generatedAt)
    const elapsedSeconds = (now - generatedAt) / 1000

    if (elapsedSeconds >= recipe.timerSeconds) {
      // Detected locally the moment this client's clock crosses the
      // deadline — see this function's comment. The skip above dedupes
      // against this once the server's own removal catches up.
      const override: CardOverride = {
        kind: 'timedOut',
        recipe,
        deliveredByName: '',
        generatedAt,
        orderNumber: data.orderNumber,
        endsAt: now + ORDER_RESULT_DISPLAY_SECONDS * 1000
      }
      cardOverrides.set(data.orderNumber, override)
      active.push({
        cardKey: String(data.orderNumber),
        recipe,
        generatedAt,
        orderNumber: data.orderNumber,
        visualState: 'timedOut',
        deliveredByName: ''
      })
      continue
    }

    active.push({
      cardKey: String(data.orderNumber),
      recipe,
      generatedAt,
      orderNumber: data.orderNumber,
      visualState: elapsedSeconds <= ORDER_NEW_FLASH_SECONDS ? 'new' : 'normal',
      deliveredByName: ''
    })
  }

  pruneOverlayColorTransitions(active)

  // orderNumber as a tiebreaker: orders generated in the same server tick
  // (e.g. filling the queue at session start) can share a generatedAt
  // millisecond; orderNumber is always a correct stand-in for creation order.
  return active.sort((a, b) => b.generatedAt - a.generatedAt || b.orderNumber - a.orderNumber)
}

// Keyed by cardKey — an in-progress overlay color ease; see getStatusOverlayColor.
interface OverlayColorTransition {
  fromColor: Color4
  toColor: Color4
  state: CardVisualState
  startedAt: number
}
const overlayColorTransitions = new Map<string, OverlayColorTransition>()

/** cardKey is a never-reused orderNumber, so without this, a transition entry would linger forever once its card is gone. */
function pruneOverlayColorTransitions(activeOrders: ActiveOrder[]): void {
  const activeCardKeys = new Set(activeOrders.map((order) => order.cardKey))
  for (const cardKey of overlayColorTransitions.keys()) {
    if (!activeCardKeys.has(cardKey)) overlayColorTransitions.delete(cardKey)
  }
}

function visualStateColor(state: CardVisualState): Color4 {
  if (state === 'success') return OVERLAY_SUCCESS_BACKGROUND
  if (state === 'timedOut') return OVERLAY_TIMED_OUT_BACKGROUND
  if (state === 'new') return OVERLAY_NEW_BACKGROUND
  return OVERLAY_TRANSPARENT
}

/** This card's overlay color, easing toward `state`'s color whenever `state` just changed, rather than snapping instantly. */
function getStatusOverlayColor(cardKey: string, state: CardVisualState): Color4 {
  const now = Date.now()
  const existing = overlayColorTransitions.get(cardKey)
  const targetColor = visualStateColor(state)

  if (!existing || existing.state !== state) {
    // Start from the current eased color, not the old target, so a state change mid-fade doesn't jump.
    const fromColor = existing ? lerpTransitionColor(existing, now) : targetColor
    const transition: OverlayColorTransition = { fromColor, toColor: targetColor, state, startedAt: now }
    overlayColorTransitions.set(cardKey, transition)
    return fromColor
  }

  return lerpTransitionColor(existing, now)
}

function lerpTransitionColor(transition: OverlayColorTransition, now: number): Color4 {
  const t = Math.min((now - transition.startedAt) / (OVERLAY_COLOR_TRANSITION_SECONDS * 1000), 1)
  return Color4.lerp(transition.fromColor, transition.toColor, t)
}

function OrdersUI() {
  if (!isLocalPlayerPlaying()) return null // spectators (and anyone who hasn't chosen Play yet) don't see the queue at all

  const layout = currentLayout
  const orders = getActiveOrders()

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: layout.verticalAnchor === 'top' ? { top: layout.edgeOffset } : { bottom: layout.edgeOffset },
          width: '100%',
          height: 'auto',
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'flex-start'
        }}
      >
        {orders.map(({ cardKey, recipe, generatedAt, orderNumber, visualState, deliveredByName }) => (
          <OrderCard
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

function OrderCard({
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
  layout: OrderCardLayout
}) {
  const overlayColor = getStatusOverlayColor(cardKey, visualState)

  return (
    <UiEntity
      key={cardKey}
      uiTransform={{
        width: layout.cardWidth,
        height: 'auto',
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: layout.cardPadding,
        margin: { right: layout.cardGap },
        borderRadius: CARD_BORDER_RADIUS,
        overflow: 'hidden' // clips the status overlay (and progress bar) to the card's rounded corners
      }}
      uiBackground={{ color: CARD_BACKGROUND }}
    >
      <IngredientStack ingredients={recipe.ingredients} layout={layout} />
      <ProgressBar generatedAt={generatedAt} timerSeconds={recipe.timerSeconds} layout={layout} />
      <StatusOverlayBackground color={overlayColor} />
      {visualState === 'success' ? (
        <SuccessMessage deliveredByName={deliveredByName} />
      ) : visualState === 'timedOut' ? (
        <StatusText text="Timed out!" />
      ) : visualState === 'new' ? (
        <StatusText text="New!" />
      ) : null}
      <OrderBadge orderNumber={orderNumber} layout={layout} />
    </UiEntity>
  )
}

/**
 * A pill, not a circle — a circle only fits 1-2 digits before clipping; a
 * pill can grow with the ticket number. Uses uiText directly rather than a
 * nested Label, so there's one centering mechanism, not two stacked. Still
 * reads slightly off-center vertically — no line-height/baseline control
 * available, and padding nudges didn't help — left as-is.
 */
function OrderBadge({ orderNumber, layout }: { orderNumber: number; layout: OrderCardLayout }) {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: ORDER_BADGE_MARGIN, left: ORDER_BADGE_MARGIN },
        zIndex: ORDER_BADGE_Z_INDEX,
        width: layout.badgeWidth,
        height: ORDER_BADGE_HEIGHT,
        borderRadius: ORDER_BADGE_BORDER_RADIUS
      }}
      uiBackground={{ color: ORDER_BADGE_BACKGROUND }}
      uiText={{
        value: `#${orderNumber}`,
        fontSize: ORDER_BADGE_FONT_SIZE,
        color: ORDER_BADGE_TEXT_COLOR,
        textAlign: 'middle-center'
      }}
    />
  )
}

/**
 * Dims the ingredient stack/progress bar for text legibility — drawn above
 * them, below the status text. Rounds itself explicitly rather than
 * relying on the card's `overflow: 'hidden'`, which clips to a rectangle,
 * not the card's rounded shape (most visible on mobile).
 */
function StatusOverlayBackground({ color }: { color: Color4 }) {
  return <UiEntity uiTransform={STATUS_OVERLAY_BG_TRANSFORM} uiBackground={{ color }} />
}

/** A one-line status message centered over the whole card — used for "New!"/"Timed out!". */
function StatusText({ text }: { text: string }) {
  return (
    <UiEntity uiTransform={STATUS_OVERLAY_TEXT_TRANSFORM}>
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

function SuccessMessage({ deliveredByName }: { deliveredByName: string }) {
  return (
    <UiEntity uiTransform={{ ...STATUS_OVERLAY_TEXT_TRANSFORM, flexDirection: 'column' }}>
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

/**
 * Stacks ingredients bottom-up, each one overlapping higher, last on top
 * in z-order. Container height is fixed to fit the longest recipe, so a
 * shorter stack just leaves empty space above it.
 */
function IngredientStack({ ingredients, layout }: { ingredients: string[]; layout: OrderCardLayout }) {
  const iconStep = layout.iconHeight - layout.iconOverlap

  return (
    <UiEntity uiTransform={{ width: layout.iconWidth, height: layout.cardContentHeight }}>
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

/**
 * Vertical fill draining top-to-bottom — one color, square corners (this
 * renderer's overflow:'hidden' clips to a rectangle regardless of radius,
 * so rounding was never reliably achievable; see git history).
 *
 * The fill is a constant cardContentHeight tall, never resized — it
 * slides downward out of the track (position.bottom going negative) as
 * time passes, clipped by overflow:'hidden'. Animating height instead of
 * position was the root cause of a real jumpiness bug this once had.
 */
function ProgressBar({
  generatedAt,
  timerSeconds,
  layout
}: {
  generatedAt: number
  timerSeconds: number
  layout: OrderCardLayout
}) {
  const elapsedSeconds = (Date.now() - generatedAt) / 1000
  const drainedFraction = Math.min(elapsedSeconds / timerSeconds, 1)
  const fillOffset = drainedFraction * layout.cardContentHeight

  return (
    <UiEntity
      uiTransform={{
        width: layout.barWidth,
        height: layout.cardContentHeight,
        margin: { left: layout.barGap },
        overflow: 'hidden'
      }}
      uiBackground={{ color: PROGRESS_TRACK_COLOR }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: -fillOffset, left: 0 },
          width: '100%',
          height: layout.cardContentHeight
        }}
        uiBackground={{ color: PROGRESS_FILL_COLOR }}
      />
    </UiEntity>
  )
}
