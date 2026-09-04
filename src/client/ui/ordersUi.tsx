// Order queue HUD — cards centered horizontally, newest first, top on
// desktop and bottom on mobile (see orderQueueStyle.ts's DESKTOP_LAYOUT/
// MOBILE_LAYOUT — mobile is short on vertical room, so this stays clear of
// the top where the player's own view is centered). Reads straight from
// the synced OrderState entities every frame; no local prediction to
// protect, so no reconcile step like heldItems.ts's.
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
// This file owns which cards exist and what state each is in; orderCard.tsx
// draws them. The overlay color is eased here (getStatusOverlayColor) and
// passed down, so the card component stays stateless.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { ORDER_RESULT_DISPLAY_SECONDS } from '../../shared/constants'
import { room } from '../../shared/messages'
import { getRecipeById, Recipe } from '../../shared/recipes'
import { OrderState } from '../../shared/schemas'
import { onPlatformResolved } from '../platform/platformDetection'
import { CardVisualState, OrderCard } from './orderCard'
import {
  DESKTOP_LAYOUT,
  MOBILE_LAYOUT,
  OrderCardLayout,
  OVERLAY_NEW_BACKGROUND,
  OVERLAY_SUCCESS_BACKGROUND,
  OVERLAY_TIMED_OUT_BACKGROUND,
  OVERLAY_TRANSPARENT
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
            overlayColor={getStatusOverlayColor(cardKey, visualState)}
            layout={layout}
          />
        ))}
      </UiEntity>
    </UiEntity>
  )
}
