// Owns the order queue and GameState's streak. Orders are ephemeral
// OrderState entities; growQueueSystem compares live count against a target
// of min(players + 1, MAX), so a solo player always has a choice. An empty
// scene targets 0, so the queue drains and nothing regenerates until someone
// arrives — session.ts is what clears it.
//
// evaluateDelivery pays every recently-active player (players/activity.ts).
// Neither outcome is broadcast: a resolved order is stamped with expiredAt or
// deliveredAt and left in place for ORDER_RESULT_DISPLAY_SECONDS, so its result
// card is synced state and the slot it holds is itself the gap before a
// replacement.

import { engine, Entity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { ORDER_RESULT_DISPLAY_SECONDS } from '../../shared/constants'
import { getRequiredModelForIngredient } from '../../shared/ingredients'
import { sameModels } from '../../shared/models'
import {
  getDifficultyForStreak,
  getRecipeById,
  MAX_STREAK,
  pickRandomRecipeByDifficulty,
  Recipe
} from '../../shared/recipes'
import { OrderState } from '../../shared/schemas'
import { isAdoptableEntity } from '../entityAdoption'
import { getGameStateMutable } from '../gameState'
import { getRecentlyActivePlayerIds } from '../players/activity'
import { grantCoins } from '../players/coins'
import { getPlayerDisplayName } from '../players/presence'
import { onSessionStart } from '../session'
import { recordDelivery } from './deliveryStats'

// Queue size caps at this many, however many players are in the scene — see getTargetQueueSize.
const MAX_QUEUE_SIZE = 6

// Payout is the recipe's own `coins` (see shared/recipes.ts), paid in full
// to every recently-active player (activity.ts) rather than to the
// deliverer alone — the game is co-op, and carrying the finished dish is
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
let nextOrderNumber = 1 // reset per session, so the HUD badge stays a short number

export function initOrderQueue(): void {
  reconcileOrderEntities()

  // A session starts on an empty pass and at level 1 — inheriting the last
  // group's difficulty tier is what made arriving alone read as broken.
  onSessionStart(() => {
    clearQueue()
    nextOrderNumber = 1 // safe: clearQueue just dropped every order, so nothing can collide
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

  // Stamped and kept, exactly like an expired order — see the module comment.
  const mutable = OrderState.getMutable(matched.entity)
  mutable.deliveredAt = Date.now()
  mutable.deliveredByName = getPlayerDisplayName(delivererId)

  return true
}

function growQueueSystem(): void {
  const gameState = getGameStateMutable()
  if (!gameState) return

  for (const [orderNumber, entity] of orderEntities) {
    const data = OrderState.getOrNull(entity)
    if (!data) continue

    const resolvedAt = Math.max(Number(data.expiredAt), Number(data.deliveredAt))
    if (resolvedAt === 0) {
      // Stamped, not removed — the card is drawn from this field, so the
      // entity has to outlive the deadline for clients to ever see it.
      if (isExpired(data.recipeId, Number(data.generatedAt))) {
        adjustStreak(gameState, STREAK_PER_TIMEOUT)
        OrderState.getMutable(entity).expiredAt = Date.now()
      }
      continue
    }

    // Result display over. Its own slot was the gap, so the queue is short
    // right now and refills on this same tick.
    if (Date.now() - resolvedAt >= ORDER_RESULT_DISPLAY_SECONDS * 1000) discardOrder(entity, orderNumber)
  }

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

/** Drops every live order at once — no streak penalty, so whoever arrives next starts on a fresh queue immediately. */
function clearQueue(): void {
  for (const [, entity] of orderEntities) engine.removeEntity(entity)
  orderEntities.clear()
}

/** Drops an order's entity once its slot has served as the gap before a replacement. */
function discardOrder(entity: Entity, orderNumber: number): void {
  orderEntities.delete(orderNumber)
  engine.removeEntity(entity)
}

function findMatchingOrder(models: string[]): { entity: Entity; recipeId: string } | null {
  for (const [, entity] of orderEntities) {
    const data = OrderState.getOrNull(entity)
    if (!data) continue
    // Already resolved: still on screen as a result card, but no longer deliverable.
    if (Number(data.expiredAt) !== 0 || Number(data.deliveredAt) !== 0) continue

    const recipe = getRecipeById(data.recipeId)
    if (recipe && sameModels(getRequiredModels(recipe), models)) return { entity, recipeId: data.recipeId }
  }
  return null
}

/** Resolves recipe.ingredients (abstract keys) to the actual models a delivered stack must match. */
function getRequiredModels(recipe: Recipe): string[] {
  return recipe.ingredients.map((key) => getRequiredModelForIngredient(key) ?? key)
}

/**
 * Re-adopts order entities from a previous server run and recovers
 * nextOrderNumber from the highest one handed out, so a restart cannot reissue
 * numbers.
 *
 * A resolved order is dropped rather than adopted — see below.
 */
function reconcileOrderEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(OrderState)) {
    if (!isAdoptableEntity(entity)) continue
    if (data.orderNumber >= nextOrderNumber) nextOrderNumber = data.orderNumber + 1

    // Reviving one would pay it out twice: expiredAt re-derives from
    // generatedAt, but deliveredAt has nothing to re-derive from. A snapshot
    // predating these fields decodes as nonsense, which reads as resolved and
    // is dropped here too. growQueueSystem refills the slot next tick.
    if (Number(data.expiredAt) !== 0 || Number(data.deliveredAt) !== 0) {
      engine.removeEntity(entity)
      continue
    }

    orderEntities.set(data.orderNumber, entity)
  }
}
