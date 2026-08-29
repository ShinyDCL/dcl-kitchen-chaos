// Single place defining what's allowed when the player interacts with each
// kind of fixture, given what they're currently holding and (for stateful
// fixtures) the fixture's own state. Read top-to-bottom per fixture kind —
// each function is a flat set of cases, message wording included inline.
// The counter/stove modules this file calls into only expose state
// queries and actions ("what's on this counter", "start cooking") — they
// don't make allow/disallow decisions themselves.

import { Entity } from '@dcl/sdk/ecs'

import { classifyItem, getCookableItemDefinition } from '../shared/ingredients'
import { MODELS } from '../shared/models'
import { deliverHeldItem } from './fixtures/deliveryCounter'
import {
  getPreparationCounterSnapshot,
  pickUpFromCounter,
  pickUpPlateFromCounter,
  placeOnCounter,
  placePlateOnCounter
} from './fixtures/preparationCounters'
import { collectFromStove, getStoveStatus, startCookingOnStove } from './fixtures/stoveCooking'
import {
  attachItemToPlayerHand,
  discardHeldItem,
  hasHeldItem,
  isHoldingAssembledItem,
  peekHeldItemModel
} from './heldItem'

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
// Empty-handed: empty counter -> place a plate first; plate only -> pick
// it up; plate + ingredients -> pick up the assembled stack, plate stays.
// Holding a plate: empty counter -> place it; already has a plate -> blocked.
// Holding a raw cookable: always blocked — message depends on plate presence.
// Holding non-cookable/cooked: stacks on the plate if one is present.
// Holding an assembled item: blocked, can't be placed back down.

export function evaluatePreparationCounterInteraction(counter: Entity): InteractionResult {
  const { hasPlate, ingredientCount } = getPreparationCounterSnapshot(counter)

  if (!hasHeldItem()) {
    if (!hasPlate) return { allowed: false, message: 'Place a plate first' }
    if (ingredientCount > 0) return { allowed: true, perform: () => pickUpFromCounter(counter) }
    return { allowed: true, perform: () => pickUpPlateFromCounter(counter) }
  }

  if (isHoldingAssembledItem()) {
    return hasPlate
      ? { allowed: true, perform: () => placeOnCounter(counter) }
      : { allowed: false, message: 'Place a plate first' }
  }

  const model = peekHeldItemModel()
  if (!model) return { allowed: false, message: "Can't place this here" }

  const category = classifyItem(model)

  if (category === 'plate') {
    if (hasPlate) return { allowed: false, message: 'Counter already has a plate' }
    return { allowed: true, perform: () => placePlateOnCounter(counter) }
  }

  if (category === 'rawCookable') {
    return hasPlate
      ? { allowed: false, message: 'Cook this first' }
      : { allowed: false, message: 'Place a plate first' }
  }

  // nonCookable or cookedCookable — both placeable directly on a plate
  if (!hasPlate) return { allowed: false, message: 'Place a plate first' }
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
  if (category === 'plate') return { allowed: false, message: "Can't cook a plate" }
  if (category === 'cookedCookable') return { allowed: false, message: 'Already cooked' }
  if (category === 'nonCookable') return { allowed: false, message: "Doesn't need cooking" }

  const definition = getCookableItemDefinition(model)
  if (!definition) return { allowed: false, message: "Can't cook this" }
  return { allowed: true, perform: () => startCookingOnStove(stove, definition) }
}

// --- Trash bin ---
// Allowed whenever holding anything (single item or assembled); discards it.

export function evaluateTrashBinInteraction(): InteractionResult {
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
