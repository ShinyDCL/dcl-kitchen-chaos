// Order queue HUD — cards centered, newest first, top on desktop and bottom
// on mobile (orderQueueStyle.ts). Reads the synced OrderState entities every
// frame; no local prediction to protect, so no reconcile step.
//
// A delivery is timed locally from the 'orderDelivered' broadcast; timing out
// needs no local timing at all, since the server stamps expiredAt and keeps
// the entity for the display window. A delivery result and a live order are
// independent entries keyed by orderNumber, so both can render at once.
//
// This file owns which cards exist and their state; orderCard.tsx draws them.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { ORDER_RESULT_DISPLAY_SECONDS } from '../../shared/constants'
import { room } from '../../shared/messages'
import { getRecipeById, Recipe } from '../../shared/recipes'
import { OrderState } from '../../shared/schemas'
import { onPlatformResolved } from '../platform/platformDetection'
import { serverNow } from '../serverReadiness'
import { CardVisualState, OrderCard } from './orderCard'
import {
  DESKTOP_LAYOUT,
  MOBILE_LAYOUT,
  OrderCardLayout,
  OVERLAY_NEW_BACKGROUND,
  OVERLAY_TRANSPARENT
} from './orderQueueStyle'
import { DANGER_BACKGROUND, SUCCESS_BACKGROUND } from './uiStyle'

// How long a freshly generated order shows its new-order highlight.
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
    deliveryResults.set(data.orderNumber, {
      recipe,
      deliveredByName: data.deliveredByName,
      generatedAt: Number(data.generatedAt),
      orderNumber: data.orderNumber,
      endsAt: serverNow() + ORDER_RESULT_DISPLAY_SECONDS * 1000
    })
  })
}

interface DeliveryResult {
  recipe: Recipe
  deliveredByName: string
  generatedAt: number // the order's own generatedAt, not the result's start time — keeps its row position instead of jumping to the front
  orderNumber: number
  endsAt: number
}

// Keyed by orderNumber — client-local timing, see the file header comment.
// Deliveries only: a timeout is synced state, so it needs nothing here.
const deliveryResults = new Map<number, DeliveryResult>()

interface ActiveOrder {
  cardKey: string // orderNumber as a string — never reused, so unique across both delivery results and live orders
  recipe: Recipe
  generatedAt: number
  orderNumber: number
  visualState: CardVisualState
  deliveredByName: string
}

/**
 * Newest first by generatedAt. A delivery result and a *different*
 * order's live entry can render at once (e.g. a fresh order beating an
 * earlier result display ending). But the *same* order's result and live
 * entry are mutually exclusive: a delivered order's broadcast and its
 * entity's CRDT removal propagate on separate channels with no ordering
 * guarantee, so a brief window can show both — without deduping that's a
 * duplicate cardKey, confusing the keyed reconciler and thrashing
 * getStatusOverlayColor. So once an order has a delivery result, its live
 * entry is skipped.
 *
 * A timed-out order needs none of that: it's still a live entity, just one
 * carrying expiredAt.
 */
function getActiveOrders(): ActiveOrder[] {
  const now = serverNow()
  const active: ActiveOrder[] = []

  for (const [orderNumber, result] of deliveryResults) {
    if (now >= result.endsAt) {
      deliveryResults.delete(orderNumber)
      continue
    }
    active.push({
      cardKey: String(orderNumber),
      recipe: result.recipe,
      generatedAt: result.generatedAt,
      orderNumber,
      visualState: 'success',
      deliveredByName: result.deliveredByName
    })
  }

  for (const [, data] of engine.getEntitiesWith(OrderState)) {
    if (deliveryResults.has(data.orderNumber)) continue // already represented by its result above — see this function's comment

    const recipe = getRecipeById(data.recipeId)
    if (!recipe) continue // shouldn't happen — recipeId always comes from the shared recipe pool
    const generatedAt = Number(data.generatedAt)
    const elapsedSeconds = (now - generatedAt) / 1000

    active.push({
      cardKey: String(data.orderNumber),
      recipe,
      generatedAt,
      orderNumber: data.orderNumber,
      visualState: getLiveVisualState(Number(data.expiredAt), elapsedSeconds),
      deliveredByName: ''
    })
  }

  pruneOverlayColorTransitions(active)

  // orderNumber as a tiebreaker: orders generated in the same server tick
  // (e.g. filling the queue at session start) can share a generatedAt
  // millisecond; orderNumber is always a correct stand-in for creation order.
  return active.sort((a, b) => b.generatedAt - a.generatedAt || b.orderNumber - a.orderNumber)
}

/**
 * Timing out is read off expiredAt rather than compared against the
 * deadline locally: the server stamps the field and holds the entity open
 * for the result display (see orderQueue.ts), so the card can't be missed
 * by a client whose clock disagrees about when the timer ran out. The
 * new-order flash stays local — it's cosmetic, and being a moment early or
 * late costs nothing.
 */
function getLiveVisualState(expiredAt: number, elapsedSeconds: number): CardVisualState {
  if (expiredAt !== 0) return 'timedOut'
  return elapsedSeconds <= ORDER_NEW_FLASH_SECONDS ? 'new' : 'normal'
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
  if (state === 'success') return SUCCESS_BACKGROUND
  if (state === 'timedOut') return DANGER_BACKGROUND
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
