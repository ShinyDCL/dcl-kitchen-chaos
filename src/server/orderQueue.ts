// Owns the order queue and mutates the streak field on playerRoster.ts's
// GameState. Active orders are ephemeral OrderState entities — created on
// generation, destroyed on resolution (delivered or expired). No fixed
// slot count: growQueueSystem just compares live count against target.
//
// Target size is 0 with zero active players, else min(count + 1, MAX) —
// see getTargetQueueSize, so a solo player always has a choice. A timeout
// resets nothing — only a wrong delivery resets the streak.
//
// evaluateDelivery pays every active player and broadcasts
// 'orderDelivered' on a match; a miss resets the streak. Clients time
// their own result/new-order highlight locally from these broadcasts
// (see ordersUi.tsx). A resolved order's replacement is held off for
// ORDER_RESULT_DISPLAY_SECONDS (nextGenerationAt) so it doesn't appear
// while the old result card is still showing — one shared cooldown, not
// per-order, so overlapping resolutions just extend it.
//
// generateOrder also hands out the next orderNumber — see
// reconcileOrderEntities for why it's recovered, not restarted at 1.

import { engine, Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { ORDER_RESULT_DISPLAY_SECONDS } from '../shared/constants'
import { getRequiredModelForIngredient } from '../shared/ingredients'
import { room } from '../shared/messages'
import { sameModels } from '../shared/models'
import { getDifficultyForStreak, getRecipeById, pickRandomRecipeByDifficulty, Recipe } from '../shared/recipes'
import { OrderState } from '../shared/schemas'
import { grantCoins } from './playerCoins'
import { getActivePlayerIds, getGameStateMutable, getPlayerDisplayName } from './playerRoster'

// Queue size caps at this many by active player count — see getTargetQueueSize.
const MAX_QUEUE_SIZE = 6

const BASE_ORDER_PAYOUT = 10 // per delivery, scaled by recipe difficulty

const orderEntities = new Map<number, Entity>() // keyed by orderNumber
let nextOrderNumber = 1 // session-wide ticket counter — see OrderState.orderNumber
let nextGenerationAt = 0 // server timestamp — no new order before this

export function initOrderQueue(): void {
  reconcileOrderEntities()
  engine.addSystem(growQueueSystem)
}

/** Called from deliveryCounter.ts's deliverHeldItem handler. Returns whether the delivered stack matched an active order. */
export function evaluateDelivery(models: string[], delivererId: string): boolean {
  const gameState = getGameStateMutable()
  if (!gameState) return false

  const matched = findMatchingOrder(models)
  if (!matched) {
    gameState.streak = 0
    return false
  }

  gameState.streak += 1
  const recipe = getRecipeById(matched.recipeId)
  grantCoins(getActivePlayerIds(), recipe ? BASE_ORDER_PAYOUT * recipe.difficulty : BASE_ORDER_PAYOUT)

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
    if (data && isExpired(data.recipeId, Number(data.generatedAt))) {
      void room.send('orderExpired', { recipeId: data.recipeId, generatedAt: data.generatedAt, orderNumber })
      removeOrder(entity, orderNumber)
    }
  }

  if (Date.now() < nextGenerationAt) return // still cooling down after a recent resolution

  const target = getTargetQueueSize(gameState.activePlayerCount)
  while (orderEntities.size < target) generateOrder(gameState.streak)
}

function isExpired(recipeId: string, generatedAt: number): boolean {
  const recipe = getRecipeById(recipeId)
  if (!recipe) return false
  const elapsedSeconds = (Date.now() - generatedAt) / 1000
  return elapsedSeconds >= recipe.timerSeconds
}

/** No players, no orders. Otherwise one more than the player count, capped at MAX_QUEUE_SIZE — always a choice to make. */
function getTargetQueueSize(activePlayerCount: number): number {
  return activePlayerCount <= 0 ? 0 : Math.min(activePlayerCount + 1, MAX_QUEUE_SIZE)
}

/** Creates a new order and broadcasts orderGenerated for the client's "New!" flash. */
function generateOrder(streak: number): void {
  const recipe = pickRandomRecipeByDifficulty(getDifficultyForStreak(streak))
  const orderNumber = nextOrderNumber++
  const generatedAt = Date.now()

  const entity = engine.addEntity()
  OrderState.create(entity, { orderNumber, recipeId: recipe.id, generatedAt })
  syncEntity(entity, [OrderState.componentId]) // no explicit id — auto-allocated, identity lives in orderNumber
  orderEntities.set(orderNumber, entity)

  void room.send('orderGenerated', { recipeId: recipe.id, orderNumber })
}

/** Removes a resolved order and pushes back its replacement's earliest generation time — see the module comment. */
function removeOrder(entity: Entity, orderNumber: number): void {
  orderEntities.delete(orderNumber)
  engine.removeEntity(entity)
  nextGenerationAt = Math.max(nextGenerationAt, Date.now() + ORDER_RESULT_DISPLAY_SECONDS * 1000)
}

function findMatchingOrder(
  models: string[]
): { entity: Entity; orderNumber: number; recipeId: string; generatedAt: number } | null {
  for (const [orderNumber, entity] of orderEntities) {
    const data = OrderState.getOrNull(entity)
    if (!data) continue
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
 */
function reconcileOrderEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(OrderState)) {
    const [entityNumber] = EntityUtils.fromEntityId(entity)
    if (entityNumber < RESERVED_STATIC_ENTITIES) continue
    orderEntities.set(data.orderNumber, entity)
    if (data.orderNumber >= nextOrderNumber) nextOrderNumber = data.orderNumber + 1
  }
}
