// Hardcoded sample recipe data for the recipe queue UI. Ingredient keys
// match shared/ingredients.ts's INGREDIENTS, so recipes stay in the same
// vocabulary as the kitchen.

export interface Recipe {
  id: string
  ingredients: string[] // bottom-to-top assembly order; keys into shared/ingredients.ts's INGREDIENTS
  timerSeconds: number // frozen sample value for now — not yet a live countdown
}

export const SAMPLE_RECIPES: Recipe[] = [
  { id: 'classic', ingredients: ['bunBottom', 'patty', 'cheese', 'bunTop'], timerSeconds: 45 },
  { id: 'garden', ingredients: ['bunBottom', 'patty', 'tomato', 'onion', 'salad', 'bunTop'], timerSeconds: 60 },
  { id: 'breakfast', ingredients: ['bunBottom', 'egg', 'cheese', 'bunTop'], timerSeconds: 30 },
  { id: 'loaded', ingredients: ['bunBottom', 'patty', 'cheese', 'tomato', 'cucumber', 'onion', 'bunTop'], timerSeconds: 75 },
  { id: 'simple', ingredients: ['bunBottom', 'patty', 'bunTop'], timerSeconds: 20 }
]

// IngredientAtlas.png: 512x512, 4x8 grid of 128x64 cells. Only column 0
// and column 1's bottom row (bunTop) are populated — rest is reserved.
const ATLAS_COLUMNS = 4
const ATLAS_ROWS = 8

// [column, row-from-top], per IngredientAtlas.png's actual layout.
const INGREDIENT_ATLAS_POSITION: Record<string, [number, number]> = {
  cheese: [0, 0],
  salad: [0, 1],
  onion: [0, 2],
  tomato: [0, 3],
  cucumber: [0, 4],
  egg: [0, 5],
  patty: [0, 6],
  bunBottom: [0, 7],
  bunTop: [1, 7]
}

/** UV coordinates (bottom-left, top-left, top-right, bottom-right) for an ingredient's cell in IngredientAtlas.png. */
export function getIngredientAtlasUvs(ingredient: string): number[] {
  const position = INGREDIENT_ATLAS_POSITION[ingredient]
  if (!position) return [0, 0, 0, 0, 0, 0, 0, 0] // unknown ingredient — shouldn't happen with SAMPLE_RECIPES

  const [col, row] = position
  const stepU = 1 / ATLAS_COLUMNS
  const stepV = 1 / ATLAS_ROWS
  const left = col * stepU
  const right = (col + 1) * stepU
  const top = 1 - row * stepV
  const bottom = 1 - (row + 1) * stepV
  return [left, bottom, left, top, right, top, right, bottom]
}
