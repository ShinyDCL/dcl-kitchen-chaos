// Owns the order queue and mutates the streak field on gameState.ts's
// GameState. Active orders are ephemeral OrderState entities — created on
// generation, destroyed when delivered, or stamped expired and destroyed
// once that card has shown. No fixed slot count: growQueueSystem just
// compares live count against target.
//
// Target size is min(count + 1, MAX) — see getTargetQueueSize, so a solo
// player always has a choice. Sized by everyone in the scene, not by who
// has acted recently: sizing on activity deadlocks, since no orders means
// nothing to act on. An empty scene targets 0, so the queue drains on its
// own and nothing regenerates until someone arrives; session.ts is what
// actually clears it, on the next session's first frame.
//
// evaluateDelivery pays every recently-active player (playerActivity.ts)
// and broadcasts 'orderDelivered' on a match. Both a miss and a timeout
// nudge the streak down (see adjustStreak). Expiry and generation get no
// broadcast: an expiring order is stamped with expiredAt and left in place
// for ORDER_RESULT_DISPLAY_SECONDS, so its timed-out card is just synced
// state the client renders, and the slot it holds is itself the gap before
// a replacement. Delivery can't do the same (the entity has to go the
// moment it's delivered), so it holds off the next order with
// nextGenerationAt instead — one shared cooldown, not per-order, so
// overlapping deliveries just extend it.
//
// generateOrder also hands out the next orderNumber — see
// reconcileOrderEntities for why it's recovered, not restarted at 1.

import { engine, Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { ORDER_RESULT_DISPLAY_SECONDS } from '../../shared/constants'
import { getRequiredModelForIngredient } from '../../shared/ingredients'
import { room } from '../../shared/messages'
import { sameModels } from '../../shared/models'
import {
  getDifficultyForStreak,
  getRecipeById,
  MAX_STREAK,
  pickRandomRecipeByDifficulty,
  Recipe
} from '../../shared/recipes'
import { OrderState } from '../../shared/schemas'
import { getGameStateMutable } from '../gameState'
import { getRecentlyActivePlayerIds } from '../players/activity'
import { grantCoins } from '../players/coins'
import { getPlayerDisplayName } from '../players/presence'
import { onSessionStart } from '../session'
import { recordDelivery } from './deliveryStats'

// Queue size caps at this many, however many players are in the scene — see getTargetQueueSize.
const MAX_QUEUE_SIZE = 6

// Payout is the recipe's own `coins` (see shared/recipes.ts), paid in full
// to every recently-active player (playerActivity.ts) rather than to the
// deliverer alone — the game is co-op, and carrying the finished plate is
// the least of the work that went into it. Streak isn't multiplied in: it
// already raises pay by unlocking higher-difficulty recipes.
//
// Streak moves in both directions rather than resetting: a delivery is worth
// more than a mistake costs, so a team that mostly keeps up still climbs.
// Letting an order expire costs the same as delivering the wrong thing —
// otherwise the streak would only measure caution, since ignoring an order
// you weren't sure about would be free.
const STREAK_PER_DELIVERY = 2
const STREAK_PER_WRONG_DELIVERY = -1
const STREAK_PER_TIMEOUT = -1

const orderEntities = new Map<number, Entity>() // keyed by orderNumber
let nextOrderNumber = 1 // session-wide ticket counter — see OrderState.orderNumber
let nextGenerationAt = 0 // server timestamp — no new order before this

export function initOrderQueue(): void {
  reconcileOrderEntities()

  // A session starts on an empty pass and at level 1 — inheriting the last
  // group's difficulty tier is what made arriving alone read as broken.
  onSessionStart(() => {
    clearQueue()
    const gameState = getGameStateMutable()
    if (gameState) gameState.streak = 0
  })

  engine.addSystem(growQueueSystem)
}

/** Called from deliveryCounter.ts's deliverHeldItem handler. Returns whether the delivered stack matched an active order. */
export function evaluateDelivery(models: string[], delivererId: string): boolean {
  const gameState = getGameStateMutable()
  if (!gameState) return false

  const matched = findMatchingOrder(models)
  if (!matched) {
    adjustStreak(gameState, STREAK_PER_WRONG_DELIVERY)
    return false
  }

  adjustStreak(gameState, STREAK_PER_DELIVERY)
  recordDelivery()

  // grantCoins ignores a non-positive amount, so an unknown recipe (which
  // shouldn't happen — recipeId always comes from the shared pool) just pays nothing.
  const recipe = getRecipeById(matched.recipeId)
  grantCoins(getRecentlyActivePlayerIds(), recipe?.coins ?? 0)

  void room.send('orderDelivered', {
    recipeId: matched.recipeId,
    deliveredByName: getPlayerDisplayName(delivererId),
    generatedAt: matched.generatedAt,
    orderNumber: matched.orderNumber
  })

  removeOrder(matched.entity, matched.orderNumber)
  return true
}

function growQueueSystem(): void {
  const gameState = getGameStateMutable()
  if (!gameState) return

  for (const [orderNumber, entity] of orderEntities) {
    const data = OrderState.getOrNull(entity)
    if (!data) continue

    const expiredAt = Number(data.expiredAt)
    if (expiredAt === 0) {
      // Stamped, not removed — the card is drawn from this field, so the
      // entity has to outlive the deadline for clients to ever see it.
      if (isExpired(data.recipeId, Number(data.generatedAt))) {
        adjustStreak(gameState, STREAK_PER_TIMEOUT)
        OrderState.getMutable(entity).expiredAt = Date.now()
      }
      continue
    }

    // Result display over. No generation cooldown to set: this order held
    // its own slot for the whole window, so the queue is short right now
    // and refills on this same tick.
    if (Date.now() - expiredAt >= ORDER_RESULT_DISPLAY_SECONDS * 1000) discardOrder(entity, orderNumber)
  }

  if (Date.now() < nextGenerationAt) return // still cooling down after a recent resolution

  const target = getTargetQueueSize(gameState.playerCount)
  while (orderEntities.size < target) generateOrder(gameState.streak)
}

/** Applies a streak change, held between 0 and MAX_STREAK — see shared/recipes.ts for what each bound buys. */
function adjustStreak(gameState: { streak: number }, delta: number): void {
  gameState.streak = Math.max(0, Math.min(gameState.streak + delta, MAX_STREAK))
}

function isExpired(recipeId: string, generatedAt: number): boolean {
  const recipe = getRecipeById(recipeId)
  if (!recipe) return false
  const elapsedSeconds = (Date.now() - generatedAt) / 1000
  return elapsedSeconds >= recipe.timerSeconds
}

/** No players, no orders. Otherwise one more than the player count, capped at MAX_QUEUE_SIZE — always a choice to make. */
function getTargetQueueSize(playerCount: number): number {
  return playerCount <= 0 ? 0 : Math.min(playerCount + 1, MAX_QUEUE_SIZE)
}

function generateOrder(streak: number): void {
  const recipe = pickRandomRecipeByDifficulty(getDifficultyForStreak(streak))
  const orderNumber = nextOrderNumber++
  const generatedAt = Date.now()

  const entity = engine.addEntity()
  OrderState.create(entity, { orderNumber, recipeId: recipe.id, generatedAt, expiredAt: 0 })
  syncEntity(entity, [OrderState.componentId]) // no explicit id — auto-allocated, identity lives in orderNumber
  orderEntities.set(orderNumber, entity)
}

/** Drops every live order at once — no streak penalty and no regeneration cooldown, so whoever arrives next starts on a fresh queue immediately. */
function clearQueue(): void {
  for (const [, entity] of orderEntities) engine.removeEntity(entity)
  orderEntities.clear()
  nextGenerationAt = 0
}

/** Removes a delivered order and pushes back its replacement's earliest generation time — see the module comment. */
function removeOrder(entity: Entity, orderNumber: number): void {
  discardOrder(entity, orderNumber)
  nextGenerationAt = Math.max(nextGenerationAt, Date.now() + ORDER_RESULT_DISPLAY_SECONDS * 1000)
}

/** Drops an order's entity and nothing else — for one whose slot already served as the gap. */
function discardOrder(entity: Entity, orderNumber: number): void {
  orderEntities.delete(orderNumber)
  engine.removeEntity(entity)
}

function findMatchingOrder(
  models: string[]
): { entity: Entity; orderNumber: number; recipeId: string; generatedAt: number } | null {
  for (const [orderNumber, entity] of orderEntities) {
    const data = OrderState.getOrNull(entity)
    if (!data) continue
    if (Number(data.expiredAt) !== 0) continue // still on screen as a result card, but no longer deliverable

    const recipe = getRecipeById(data.recipeId)
    if (recipe && sameModels(getRequiredModels(recipe), models)) {
      return { entity, orderNumber, recipeId: data.recipeId, generatedAt: Number(data.generatedAt) }
    }
  }
  return null
}

/** Resolves recipe.ingredients (abstract keys) to the actual models a delivered stack must match. */
function getRequiredModels(recipe: Recipe): string[] {
  return recipe.ingredients.map((key) => getRequiredModelForIngredient(key) ?? key)
}

/**
 * Re-adopts order entities already in the CRDT snapshot from a previous
 * server run, and recovers nextOrderNumber from the highest orderNumber
 * handed out — otherwise a restart would reset the ticket counter to 1 and
 * duplicate numbers. An already-expired order is caught by the first
 * growQueueSystem tick same as any other; no special-casing needed here.
 *
 * expiredAt is rewritten rather than trusted: a snapshot left by a build
 * that predates the field would otherwise hand growQueueSystem a stamp it
 * never wrote, and a nonsense one in the future never satisfies the
 * discard check — the order would hold a queue slot as a timed-out card
 * indefinitely. Zeroing it puts every adopted order back on the path above.
 */
function reconcileOrderEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(OrderState)) {
    const [entityNumber] = EntityUtils.fromEntityId(entity)
    if (entityNumber < RESERVED_STATIC_ENTITIES) continue
    orderEntities.set(data.orderNumber, entity)
    if (data.orderNumber >= nextOrderNumber) nextOrderNumber = data.orderNumber + 1
    OrderState.getMutable(entity).expiredAt = 0
  }
}
