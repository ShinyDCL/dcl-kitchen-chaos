// Recipe definitions for the order queue — orderQueue.ts picks from
// these by difficulty tier to fill queue slots; ordersUi.tsx resolves a
// slot's recipeId back to one to render it. Ingredient keys match
// shared/ingredients.ts's INGREDIENTS.

// Difficulty tier = 1 + floor(streak / STREAK_DIFFICULTY_STEP), capped at MAX_DIFFICULTY_TIER.
const STREAK_DIFFICULTY_STEP = 3
const MAX_DIFFICULTY_TIER = 3

export interface Recipe {
  id: string
  ingredients: string[] // bottom-to-top assembly order; keys into shared/ingredients.ts's INGREDIENTS
  timerSeconds: number // shown as a countdown in the HUD; not currently a hard expiry
  difficulty: number // 1..MAX_DIFFICULTY_TIER — which streak tier this can be picked for
}

export const SAMPLE_RECIPES: Recipe[] = [
  // Difficulty 1 — quick, one or no cooked ingredients.
  { id: 'cheesemelt', ingredients: ['bunBottom', 'cheese', 'bunTop'], timerSeconds: 30, difficulty: 1 },
  { id: 'simple', ingredients: ['bunBottom', 'patty', 'bunTop'], timerSeconds: 35, difficulty: 1 },
  { id: 'classic', ingredients: ['bunBottom', 'patty', 'cheese', 'bunTop'], timerSeconds: 45, difficulty: 1 },
  { id: 'breakfast', ingredients: ['bunBottom', 'egg', 'cheese', 'bunTop'], timerSeconds: 35, difficulty: 1 },
  {
    id: 'veggie',
    ingredients: ['bunBottom', 'salad', 'tomato', 'cucumber', 'bunTop'],
    timerSeconds: 18,
    difficulty: 1
  },

  // Difficulty 2 — more toppings, or two cooked ingredients to juggle.
  {
    id: 'garden',
    ingredients: ['bunBottom', 'patty', 'tomato', 'onion', 'salad', 'bunTop'],
    timerSeconds: 60,
    difficulty: 2
  },
  { id: 'double', ingredients: ['bunBottom', 'patty', 'patty', 'cheese', 'bunTop'], timerSeconds: 60, difficulty: 2 },
  { id: 'brunch', ingredients: ['bunBottom', 'patty', 'egg', 'cheese', 'bunTop'], timerSeconds: 65, difficulty: 2 },
  { id: 'picnic', ingredients: ['bunBottom', 'patty', 'onion', 'cucumber', 'bunTop'], timerSeconds: 58, difficulty: 2 },
  { id: 'eggstra', ingredients: ['bunBottom', 'egg', 'egg', 'cheese', 'bunTop'], timerSeconds: 62, difficulty: 2 },

  // Difficulty 3 — long ingredient stacks, both cookables, or multiple duplicate cookables.
  {
    id: 'loaded',
    ingredients: ['bunBottom', 'patty', 'cheese', 'tomato', 'cucumber', 'onion', 'bunTop'],
    timerSeconds: 85,
    difficulty: 3
  },
  {
    id: 'supreme',
    ingredients: ['bunBottom', 'patty', 'egg', 'cheese', 'tomato', 'onion', 'salad', 'bunTop'],
    timerSeconds: 100,
    difficulty: 3
  },
  {
    id: 'megastack',
    ingredients: ['bunBottom', 'patty', 'patty', 'cheese', 'tomato', 'onion', 'cucumber', 'bunTop'],
    timerSeconds: 95,
    difficulty: 3
  },
  {
    id: 'farmhouse',
    ingredients: ['bunBottom', 'patty', 'egg', 'cheese', 'tomato', 'salad', 'bunTop'],
    timerSeconds: 88,
    difficulty: 3
  },
  {
    id: 'tripledeck',
    ingredients: ['bunBottom', 'patty', 'patty', 'patty', 'cheese', 'cheese', 'bunTop'],
    timerSeconds: 105,
    difficulty: 3
  }
]

const RECIPES_BY_ID = new Map(SAMPLE_RECIPES.map((recipe) => [recipe.id, recipe]))

/** Looks up a recipe by id — resolves a synced OrderSlotState's recipeId for rendering. */
export function getRecipeById(id: string): Recipe | undefined {
  return RECIPES_BY_ID.get(id)
}

/** Difficulty tier for the current streak: 1 + one tier per STREAK_DIFFICULTY_STEP successful deliveries, capped at MAX_DIFFICULTY_TIER. */
export function getDifficultyForStreak(streak: number): number {
  return Math.min(1 + Math.floor(streak / STREAK_DIFFICULTY_STEP), MAX_DIFFICULTY_TIER)
}

/** Picks a random recipe at the given difficulty, falling back to the whole pool if that tier is empty (e.g. no recipes defined for it yet). */
export function pickRandomRecipeByDifficulty(difficulty: number): Recipe {
  const pool = SAMPLE_RECIPES.filter((recipe) => recipe.difficulty === difficulty)
  const source = pool.length > 0 ? pool : SAMPLE_RECIPES
  return source[Math.floor(Math.random() * source.length)]
}

// IngredientAtlas.png: 256x512, 2x8 grid of 128x64 cells. Only column 0
// and column 1's bottom row (bunTop) are populated — rest is reserved.
const ATLAS_COLUMNS = 2
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
