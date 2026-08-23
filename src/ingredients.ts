// Single registry of every pickup-able ingredient. Non-cookable ones just
// have a model; cookable ones have a raw/cooked model pair and a cook
// time. classifyItem() and getCookableItemDefinition() are both derived
// from this one object, so there's one place to add or edit an ingredient.

import { MODELS } from './models'

export interface CookableIngredientDefinition {
  cookable: true
  rawModel: string // model shown on the stove and held before cooking
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
  patty: { cookable: true, rawModel: MODELS.pattyRaw, cookedModel: MODELS.pattyCooked, cookDurationSeconds: 5 },
  egg: { cookable: true, rawModel: MODELS.egg, cookedModel: MODELS.eggCooked, cookDurationSeconds: 5 }
}

const RAW_MODEL_TO_DEFINITION = new Map<string, CookableIngredientDefinition>()
const COOKED_MODELS = new Set<string>()

for (const definition of Object.values(INGREDIENTS)) {
  if (definition.cookable) {
    RAW_MODEL_TO_DEFINITION.set(definition.rawModel, definition)
    COOKED_MODELS.add(definition.cookedModel)
  }
}

export function getCookableItemDefinition(rawModel: string): CookableIngredientDefinition | undefined {
  return RAW_MODEL_TO_DEFINITION.get(rawModel)
}

export type ItemCategory = 'nonCookable' | 'rawCookable' | 'cookedCookable' | 'plate'

export function classifyItem(model: string): ItemCategory {
  if (model === MODELS.plate) return 'plate'
  if (RAW_MODEL_TO_DEFINITION.has(model)) return 'rawCookable'
  if (COOKED_MODELS.has(model)) return 'cookedCookable'
  return 'nonCookable'
}
