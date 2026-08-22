// Which held items can be cooked on a stove, and what happens when they
// are. Any model not listed here (tomato, cucumber, onion, salad, cheese,
// bun top, bun bottom, and anything added later) does nothing when a
// player interacts with a stove while holding it.

import { MODELS } from './models'

export interface CookableItemDefinition {
  rawModel: string // model placed on the stove while cooking
  cookedModel: string // model swapped in once cooking finishes
  cookDurationSeconds: number // tune per item
}

export const COOKABLE_ITEMS: Record<string, CookableItemDefinition> = {
  // Patty: the raw model placed on the stove is the same one the player was holding.
  [MODELS.pattyRaw]: { rawModel: MODELS.pattyRaw, cookedModel: MODELS.pattyCooked, cookDurationSeconds: 5 },
  // Egg: the pickup model ("egg") swaps to a distinct raw-on-stove model.
  [MODELS.egg]: { rawModel: MODELS.eggRaw, cookedModel: MODELS.eggCooked, cookDurationSeconds: 5 }
}

export function getCookableItemDefinition(model: string): CookableItemDefinition | undefined {
  return COOKABLE_ITEMS[model]
}
