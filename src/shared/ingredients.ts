// Single registry of every pickup-able ingredient. Non-cookable ones just
// have a model; cookable ones have three models — the one held before
// cooking (heldModel, also used as the lookup key), the one shown on the
// stove while cooking (stoveModel — may differ from heldModel, e.g. egg's
// held model is "egg" but its stove model is "eggRaw"), and the one
// swapped in once done (cookedModel) — plus a cook time.
//
// classifyItem() and getCookableItemDefinition() are both derived from
// this one object, so there's one place to add or edit an ingredient.
//
// Bacon isn't listed here yet — no models exist for it. Its ingredient
// counter slot is handled separately in ingredientCounters.ts (shows
// "Not available yet" until it's added here with real models).

import { MODELS } from './models'

export interface CookableIngredientDefinition {
  cookable: true
  heldModel: string // model held before cooking; used as the lookup key
  stoveModel: string // model placed on the stove while cooking
  cookedModel: string // model swapped in once cooking finishes
  cookDurationSeconds: number
}

interface NonCookableIngredientDefinition {
  cookable: false
  model: string
}

type IngredientDefinition = CookableIngredientDefinition | NonCookableIngredientDefinition

export const INGREDIENTS: Record<string, IngredientDefinition> = {
  tomato: { cookable: false, model: MODELS.tomatoSlice },
  cucumber: { cookable: false, model: MODELS.cucumberSlice },
  onion: { cookable: false, model: MODELS.onionSlice },
  salad: { cookable: false, model: MODELS.saladLeaf },
  cheese: { cookable: false, model: MODELS.cheeseSlice },
  bunTop: { cookable: false, model: MODELS.bunTop },
  bunBottom: { cookable: false, model: MODELS.bunBottom },
  patty: {
    cookable: true,
    heldModel: MODELS.pattyRaw,
    stoveModel: MODELS.pattyRaw,
    cookedModel: MODELS.pattyCooked,
    cookDurationSeconds: 5
  },
  egg: {
    cookable: true,
    heldModel: MODELS.egg,
    stoveModel: MODELS.eggRaw,
    cookedModel: MODELS.eggCooked,
    cookDurationSeconds: 5
  }
}

const HELD_MODEL_TO_DEFINITION = new Map<string, CookableIngredientDefinition>()
const COOKED_MODELS = new Set<string>()

for (const definition of Object.values(INGREDIENTS)) {
  if (definition.cookable) {
    HELD_MODEL_TO_DEFINITION.set(definition.heldModel, definition)
    COOKED_MODELS.add(definition.cookedModel)
  }
}

export function getCookableItemDefinition(heldModel: string): CookableIngredientDefinition | undefined {
  return HELD_MODEL_TO_DEFINITION.get(heldModel)
}

/** The model an ingredient key (shared/recipes.ts) must resolve to — the cooked model for a cookable, otherwise its one model. */
export function getRequiredModelForIngredient(key: string): string | undefined {
  const definition = INGREDIENTS[key]
  if (!definition) return undefined
  return definition.cookable ? definition.cookedModel : definition.model
}

export type ItemCategory = 'nonCookable' | 'rawCookable' | 'cookedCookable' | 'plate'

export function classifyItem(model: string): ItemCategory {
  if (model === MODELS.plate) return 'plate'
  if (HELD_MODEL_TO_DEFINITION.has(model)) return 'rawCookable'
  if (COOKED_MODELS.has(model)) return 'cookedCookable'
  return 'nonCookable'
}
