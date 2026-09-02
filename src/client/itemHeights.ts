// Height (in meters) of each pickup item's 3D model, used to stack items on
// preparation counters without them clipping into each other. Every value
// below is a 0.1m placeholder until the real models are measured — edit
// individual entries as accurate heights become available.

import { MODELS } from '../shared/models'

export const DEFAULT_ITEM_HEIGHT = 0.1

export const ITEM_HEIGHTS: Record<string, number> = {
  [MODELS.cucumberSlice]: 0.06,
  [MODELS.onionSlice]: 0.07,
  [MODELS.tomatoSlice]: 0.07,
  [MODELS.saladLeaf]: 0.06,
  [MODELS.cheeseSlice]: 0.06,
  [MODELS.bunBottom]: 0.06,
  [MODELS.bunTop]: 0.12,
  [MODELS.pattyRaw]: 0.07,
  [MODELS.pattyCooked]: 0.07,
  [MODELS.eggRaw]: 0.06,
  [MODELS.plate]: 0.06
}

/** Falls back to DEFAULT_ITEM_HEIGHT for any model not listed above (e.g. a new item added to models.ts but not measured yet). */
export function getItemHeight(model: string): number {
  return ITEM_HEIGHTS[model] ?? DEFAULT_ITEM_HEIGHT
}
