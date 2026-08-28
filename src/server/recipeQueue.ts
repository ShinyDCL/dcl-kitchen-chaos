// Owns the recipe queue (MAX_QUEUE_SIZE fixed slots, same explicit-sync-id
// pattern as preparationCounters.ts) and mutates the streak field on
// playerRoster.ts's GameState.
//
// Target size is 0 with zero active players, else clamp(count, MIN, MAX) —
// see getTargetQueueSize. Growing only activates inactive slots. advanceSlot
// is the single hand-off point: a completed delivery or an expired recipe
// either regenerates the slot in place or retires it if over target, so
// shrinking/difficulty changes only ever apply from the next recipe, never
// mid-recipe. A timeout resets nothing — only a wrong delivery resets the
// streak.
//
// evaluateDelivery (called by deliveryCounter.ts, which owns DeliveryState/
// visual timing) pays every active player and broadcasts 'recipeDelivered'
// on a match; a miss just resets the streak. Clients time their own success/
// new-recipe highlight locally from these broadcasts instead of racing a
// shared server deadline latency could cut short.
//
// A match (evaluateDelivery) or an unmatched timeout (expireSlot) both
// deactivate their slot immediately but defer regenerating it for
// RECIPE_RESULT_DISPLAY_SECONDS (pendingRegenerations) — otherwise the new
// recipe's clock would already be running while every client's result
// display still hides it, showing the timer bar as already-elapsed the
// moment it appears. A timeout resets nothing else — only a wrong
// delivery resets the streak.
//
// generateRecipeForSlot also hands out the next session-wide orderNumber
// (a restaurant-style ticket number, distinct from slotIndex) — see
// reconcileSlotEntities for why it's recovered from existing state rather
// than always restarting at 1.

import { engine, Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'

import { BASE_RECIPE_PAYOUT, MAX_QUEUE_SIZE, MIN_QUEUE_SIZE, RECIPE_RESULT_DISPLAY_SECONDS } from '../shared/constants'
import { getRequiredModelForIngredient } from '../shared/ingredients'
import { room } from '../shared/messages'
import { sameModels } from '../shared/models'
import { getDifficultyForStreak, getRecipeById, pickRandomRecipeByDifficulty, Recipe } from '../shared/recipes'
import { RECIPE_SLOT_SYNC_ID_BASE, RecipeSlotState } from '../shared/schemas'
import { grantCoins } from './playerCoins'
import { getActivePlayerIds, getGameStateMutable, getPlayerDisplayName } from './playerRoster'

type SlotState = ReturnType<typeof RecipeSlotState.getMutable>
type GameStateMutable = NonNullable<ReturnType<typeof getGameStateMutable>>

const slotEntities = new Map<number, Entity>()
const pendingRegenerations = new Map<number, number>() // slotIndex -> server timestamp when it's eligible to regenerate
let nextOrderNumber = 1 // session-wide ticket counter — see RecipeSlotState.orderNumber

export function initRecipeQueue(): void {
  reconcileSlotEntities()
  for (let slotIndex = 0; slotIndex < MAX_QUEUE_SIZE; slotIndex++) getOrCreateSlotEntity(slotIndex)

  engine.addSystem(growQueueSystem)
}

/** Called from deliveryCounter.ts's deliverHeldItem handler. Returns whether the delivered stack matched an active recipe. */
export function evaluateDelivery(models: string[], delivererId: string): boolean {
  const gameState = getGameStateMutable()
  if (!gameState) return false

  const matched = findMatchingActiveSlot(models)
  if (!matched) {
    gameState.streak = 0
    return false
  }

  gameState.streak += 1
  const recipe = getRecipeById(matched.state.recipeId)
  grantCoins(getActivePlayerIds(), recipe ? BASE_RECIPE_PAYOUT * recipe.difficulty : BASE_RECIPE_PAYOUT)

  void room.send('recipeDelivered', {
    slotIndex: matched.state.slotIndex,
    recipeId: matched.state.recipeId,
    deliveredByName: getPlayerDisplayName(delivererId),
    generatedAt: matched.state.generatedAt,
    orderNumber: matched.state.orderNumber
  })

  matched.state.active = false
  matched.state.recipeId = ''
  pendingRegenerations.set(matched.state.slotIndex, Date.now() + RECIPE_RESULT_DISPLAY_SECONDS * 1000)

  return true
}

function growQueueSystem(): void {
  const gameState = getGameStateMutable()
  if (!gameState) return

  const target = getTargetQueueSize(gameState.activePlayerCount)
  const now = Date.now()

  for (let slotIndex = 0; slotIndex < MAX_QUEUE_SIZE; slotIndex++) {
    const state = RecipeSlotState.getMutableOrNull(getOrCreateSlotEntity(slotIndex))
    if (!state) continue

    const readyAt = pendingRegenerations.get(slotIndex)
    if (readyAt !== undefined) {
      if (now >= readyAt) {
        pendingRegenerations.delete(slotIndex)
        advanceSlot(state, gameState)
      }
      continue // still pausing after its own delivery, or just regenerated — either way, not a plain inactive slot to grow into below
    }

    if (!state.active) {
      if (slotIndex < target) generateRecipeForSlot(state, gameState.streak)
      continue
    }

    if (isSlotExpired(state)) expireSlot(state)
  }
}

function isSlotExpired(state: SlotState): boolean {
  const recipe = getRecipeById(state.recipeId)
  if (!recipe) return false
  const elapsedSeconds = (Date.now() - Number(state.generatedAt)) / 1000
  return elapsedSeconds >= recipe.timerSeconds
}

/**
 * A recipe's timer ran out before anyone delivered it. Mirrors
 * evaluateDelivery's match path — deactivate immediately, defer
 * regenerating for RECIPE_RESULT_DISPLAY_SECONDS — but touches nothing
 * else (no streak/coins; a timeout only resets the slot itself).
 */
function expireSlot(state: SlotState): void {
  void room.send('recipeExpired', {
    slotIndex: state.slotIndex,
    recipeId: state.recipeId,
    generatedAt: state.generatedAt,
    orderNumber: state.orderNumber
  })

  state.active = false
  state.recipeId = ''
  pendingRegenerations.set(state.slotIndex, Date.now() + RECIPE_RESULT_DISPLAY_SECONDS * 1000)
}

/**
 * Refills the slot if the queue isn't over target, otherwise retires it.
 * Counts active slots OTHER than this one, rather than relying on
 * state.active — the two callers reach here with different active
 * flags for THIS slot (isSlotExpired's is still true; the deferred
 * pendingRegenerations path already set it false back in
 * evaluateDelivery), which would otherwise make the target comparison
 * off-by-one for one of the two call sites.
 */
function advanceSlot(state: SlotState, gameState: GameStateMutable): void {
  const target = getTargetQueueSize(gameState.activePlayerCount)
  if (countOtherActiveSlots(state.slotIndex) < target) {
    generateRecipeForSlot(state, gameState.streak)
  } else {
    state.active = false
    state.recipeId = ''
  }
}

/** No active players means no recipes at all — MIN_QUEUE_SIZE only applies once there's at least one. */
function getTargetQueueSize(activePlayerCount: number): number {
  return activePlayerCount <= 0 ? 0 : clamp(activePlayerCount, MIN_QUEUE_SIZE, MAX_QUEUE_SIZE)
}

/** The single place a slot gets a new recipe — also broadcasts recipeGenerated for the client's "New!" flash. */
function generateRecipeForSlot(state: SlotState, streak: number): void {
  const recipe = pickRandomRecipeByDifficulty(getDifficultyForStreak(streak))
  state.active = true
  state.recipeId = recipe.id
  state.generatedAt = Date.now()
  state.orderNumber = nextOrderNumber++

  void room.send('recipeGenerated', { slotIndex: state.slotIndex, recipeId: recipe.id })
}

function findMatchingActiveSlot(models: string[]): { state: SlotState } | null {
  for (const entity of slotEntities.values()) {
    const state = RecipeSlotState.getMutableOrNull(entity)
    if (!state || !state.active) continue
    const recipe = getRecipeById(state.recipeId)
    if (recipe && sameModels(getRequiredModels(recipe), models)) return { state }
  }
  return null
}

/** Resolves recipe.ingredients (abstract keys) to the actual models a delivered stack must match. */
function getRequiredModels(recipe: Recipe): string[] {
  return recipe.ingredients.map((key) => getRequiredModelForIngredient(key) ?? key)
}

function countOtherActiveSlots(excludeSlotIndex: number): number {
  let count = 0
  for (const entity of slotEntities.values()) {
    const state = RecipeSlotState.getOrNull(entity)
    if (state?.active && state.slotIndex !== excludeSlotIndex) count++
  }
  return count
}

function getOrCreateSlotEntity(slotIndex: number): Entity {
  const cached = slotEntities.get(slotIndex)
  if (cached !== undefined && RecipeSlotState.getOrNull(cached) !== null) return cached

  const entity = engine.addEntity()
  RecipeSlotState.create(entity, { slotIndex, active: false, recipeId: '', generatedAt: 0, orderNumber: 0 })
  syncEntity(entity, [RecipeSlotState.componentId], RECIPE_SLOT_SYNC_ID_BASE + slotIndex)
  slotEntities.set(slotIndex, entity)
  return entity
}

/**
 * Re-adopts slot entities that may already exist in the CRDT snapshot from
 * a previous server run, and recovers nextOrderNumber from the highest
 * orderNumber already handed out — otherwise a restart would reset the
 * ticket counter to 1 and hand out duplicate numbers for new recipes.
 */
function reconcileSlotEntities(): void {
  for (const [entity, data] of engine.getEntitiesWith(RecipeSlotState)) {
    const [entityNumber] = EntityUtils.fromEntityId(entity)
    if (entityNumber < RESERVED_STATIC_ENTITIES) continue
    slotEntities.set(data.slotIndex, entity)
    if (data.orderNumber >= nextOrderNumber) nextOrderNumber = data.orderNumber + 1
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
