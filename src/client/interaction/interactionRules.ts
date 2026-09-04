// Single place defining what's allowed when the player interacts with each
// kind of fixture, given what they're currently holding and (for stateful
// fixtures) the fixture's own state. Read top-to-bottom per fixture kind —
// each function is a flat set of cases, message wording included inline.
// The counter/stove modules this file calls into only expose state
// queries and actions ("what's on this counter", "start cooking") — they
// don't make allow/disallow decisions themselves.

import { Entity } from '@dcl/sdk/ecs'

import { classifyItem, getCookableItemDefinition } from '../../shared/ingredients'
import { MODELS } from '../../shared/models'
import { deliverHeldItem } from '../scene/fixtures/deliveryCounter'
import { getPreparationCounterSnapshot, pickUpFromCounter, placeOnCounter } from '../scene/fixtures/preparationCounter'
import { collectFromStove, getStoveStatus, startCookingOnStove } from '../scene/fixtures/stove'
import {
  attachItemToPlayerHand,
  discardHeldItem,
  hasHeldItem,
  isHoldingAssembledItem,
  peekHeldItemModel
} from '../scene/heldItems'

export interface InteractionResult {
  allowed: boolean
  message?: string // shown if not allowed and the player presses interact
  perform?: () => void // called if allowed and the player presses interact
}

// --- Ingredient counters ---
// Allowed except while holding an assembled item — grabbing fresh would
// silently discard it.

export function evaluateIngredientCounterInteraction(sliceModel: string): InteractionResult {
  if (isHoldingAssembledItem()) return { allowed: false, message: 'Hands full' }
  return { allowed: true, perform: () => attachItemToPlayerHand(sliceModel) }
}

// --- Plate counters ---
// Allowed except while holding an assembled item — same reasoning as
// ingredient counters, including re-grabbing a fresh plate while already
// holding one.

export function evaluatePlateCounterInteraction(): InteractionResult {
  if (isHoldingAssembledItem()) return { allowed: false, message: 'Hands full' }
  return { allowed: true, perform: () => attachItemToPlayerHand(MODELS.plate) }
}

// --- Preparation counters ---
// Empty-handed: pick up whatever's on the counter (a plate underneath
// comes along with it) — blocked if there's nothing there.
// Holding a raw cookable: always blocked, cook it first.
// Holding anything else (plate included) or an assembled item: stacks on
// top of whatever's already on the counter.

export function evaluatePreparationCounterInteraction(counter: Entity): InteractionResult {
  const { ingredientCount } = getPreparationCounterSnapshot(counter)

  if (!hasHeldItem()) {
    if (ingredientCount === 0) return { allowed: false, message: 'Nothing to pick up' }
    return { allowed: true, perform: () => pickUpFromCounter(counter) }
  }

  if (isHoldingAssembledItem()) return { allowed: true, perform: () => placeOnCounter(counter) }

  // Exactly one model is held here, so peekHeldItemModel can't be null.
  const model = peekHeldItemModel()!
  if (classifyItem(model) === 'rawCookable') return { allowed: false, message: 'Cook this first' }

  // plate, nonCookable, or cookedCookable — all placeable directly on the counter
  return { allowed: true, perform: () => placeOnCounter(counter) }
}

// --- Stove ---
// Done -> collect. Cooking -> busy, regardless of what's held. Idle ->
// only a raw cookable in hand is allowed; everything else has its own message.

export function evaluateStoveInteraction(stove: Entity): InteractionResult {
  const status = getStoveStatus(stove)

  if (status === 'done') return { allowed: true, perform: () => collectFromStove(stove) }
  if (status === 'cooking') return { allowed: false, message: 'Stove is busy' }

  if (!hasHeldItem()) return { allowed: false, message: 'Nothing to cook' }
  if (isHoldingAssembledItem()) return { allowed: false, message: "Can't cook this" }

  const model = peekHeldItemModel()
  if (!model) return { allowed: false, message: "Can't cook this" }

  const category = classifyItem(model)
  if (category === 'cookedCookable') return { allowed: false, message: 'Already cooked' }
  if (category === 'nonCookable') return { allowed: false, message: 'Not cookable' }

  const definition = getCookableItemDefinition(model)
  if (!definition) return { allowed: false, message: "Can't cook this" }
  return { allowed: true, perform: () => startCookingOnStove(stove, definition) }
}

// --- Discard counter ---
// Allowed whenever holding anything (single item or assembled); discards it.

export function evaluateDiscardCounterInteraction(): InteractionResult {
  if (!hasHeldItem()) return { allowed: false, message: 'Nothing to discard' }
  return { allowed: true, perform: () => discardHeldItem() }
}

// --- Delivery counter ---
// Allowed whenever holding anything; the checkmark/crossmark flourish is
// decided server-side against the active order queue (see orderQueue.ts).

export function evaluateDeliveryCounterInteraction(): InteractionResult {
  if (!hasHeldItem()) return { allowed: false, message: 'Nothing to deliver' }
  return { allowed: true, perform: deliverHeldItem }
}
