// Order queue HUD — cards centered, newest first, top on desktop and bottom
// on mobile (orderQueueStyle.ts). Reads the synced OrderState entities every
// frame; no local prediction to protect, so no reconcile step.
//
// Result cards need no local timing: the server stamps expiredAt or
// deliveredAt and keeps the entity for the display window, so a card is only
// ever drawn from the state in front of it.
//
// This file owns which cards exist and their state; orderCard.tsx draws them.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

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
}

interface ActiveOrder {
  cardKey: string // orderNumber as a string — unique among the orders alive at once
  recipe: Recipe
  generatedAt: number
  orderNumber: number
  visualState: CardVisualState
  deliveredByName: string
}

/** Newest first by generatedAt. One entry per synced order, resolved or not — the server keeps a resolved one alive for its result display. */
function getActiveOrders(): ActiveOrder[] {
  const now = serverNow()
  const active: ActiveOrder[] = []

  for (const [, data] of engine.getEntitiesWith(OrderState)) {
    const recipe = getRecipeById(data.recipeId)
    if (!recipe) continue // shouldn't happen — recipeId always comes from the shared recipe pool
    const generatedAt = Number(data.generatedAt)
    const elapsedSeconds = (now - generatedAt) / 1000

    active.push({
      cardKey: String(data.orderNumber),
      recipe,
      generatedAt,
      orderNumber: data.orderNumber,
      visualState: getVisualState(Number(data.expiredAt), Number(data.deliveredAt), elapsedSeconds),
      deliveredByName: data.deliveredByName
    })
  }

  pruneOverlayColorTransitions(active)

  // orderNumber as a tiebreaker: orders generated in the same server tick
  // (e.g. filling the queue at session start) can share a generatedAt
  // millisecond; orderNumber is always a correct stand-in for creation order.
  return active.sort((a, b) => b.generatedAt - a.generatedAt || b.orderNumber - a.orderNumber)
}

/**
 * Both results are read off their stamp rather than timed locally: the server
 * holds the entity open for the display window (see orderQueue.ts), so no card
 * can be missed by a client whose clock disagrees about when it resolved. The
 * new-order flash stays local — it's cosmetic, and being a moment early or late
 * costs nothing.
 */
function getVisualState(expiredAt: number, deliveredAt: number, elapsedSeconds: number): CardVisualState {
  if (deliveredAt !== 0) return 'success'
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

/** Without this a transition entry would linger once its card is gone — and orderNumber restarts at 1 each session, so a stale one could be inherited. */
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
