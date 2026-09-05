// Recipe definitions for the order queue — orderQueue.ts picks from
// these by difficulty tier to fill queue slots; ordersUi.tsx resolves a
// slot's recipeId back to one to render it. Ingredient keys match
// shared/ingredients.ts's INGREDIENTS.

// Difficulty tier = 1 + floor(streak / STREAK_DIFFICULTY_STEP), capped at
// MAX_DIFFICULTY_TIER. At +2 a delivery, top tier lands after 14 clean ones,
// with promotions at roughly 4, 7, 11 and 14.
const STREAK_DIFFICULTY_STEP = 7
export const MAX_DIFFICULTY_TIER = 5

/**
 * Streak ceiling: the top tier's threshold plus one more step of headroom,
 * so a run at max difficulty can absorb a few mistakes before demoting
 * instead of dropping on the first one — but can't bank an unlosable lead.
 */
export const MAX_STREAK = MAX_DIFFICULTY_TIER * STREAK_DIFFICULTY_STEP

export interface Recipe {
  id: string
  ingredients: string[] // bottom-to-top assembly order; keys into shared/ingredients.ts's INGREDIENTS
  timerSeconds: number // shown as a countdown in the HUD; not currently a hard expiry
  difficulty: number // 1..MAX_DIFFICULTY_TIER — which streak tier this can be picked for
  coins: number // the whole payout for delivering it — see the scale below
}

// Coin values follow 3 x ingredients + 7 x cooked items + 2 x (difficulty - 1),
// spanning 9 (cheesemelt) to 50 (tripledeck/towering/brunchStack). Three per
// ingredient is one grab and one place; a cookable is worth roughly triple,
// since it also costs a stove trip, a wait and a collect. The difficulty term
// only stops the tiers inverting outright — a long salad is genuinely less
// work than a short burger with a patty, and the payout says so.
//
// This is the entire payout: streak isn't multiplied in, because it already
// raises pay by unlocking higher-difficulty recipes (see
// getDifficultyForStreak). Keep new recipes on the same scale.

export const SAMPLE_RECIPES: [Recipe, ...Recipe[]] = [
  // Tier 1 - 3-4 ingredients, at most one cooked, and no repeated ingredient.
  { id: 'cheesemelt', ingredients: ['bunBottom', 'cheese', 'bunTop'], timerSeconds: 30, difficulty: 1, coins: 9 },
  { id: 'simple', ingredients: ['bunBottom', 'patty', 'bunTop'], timerSeconds: 35, difficulty: 1, coins: 16 },
  { id: 'eggMuffin', ingredients: ['bunBottom', 'egg', 'bunTop'], timerSeconds: 35, difficulty: 1, coins: 16 },
  {
    id: 'classic',
    ingredients: ['bunBottom', 'patty', 'cheese', 'bunTop'],
    timerSeconds: 42,
    difficulty: 1,
    coins: 19
  },
  {
    id: 'breakfast',
    ingredients: ['bunBottom', 'egg', 'cheese', 'bunTop'],
    timerSeconds: 40,
    difficulty: 1,
    coins: 19
  },
  {
    id: 'gardenBite',
    ingredients: ['bunBottom', 'salad', 'tomato', 'bunTop'],
    timerSeconds: 30,
    difficulty: 1,
    coins: 12
  },
  { id: 'gardenSalad', ingredients: ['plate', 'salad', 'tomato'], timerSeconds: 24, difficulty: 1, coins: 9 },
  { id: 'sideSalad', ingredients: ['plate', 'cucumber', 'onion'], timerSeconds: 24, difficulty: 1, coins: 9 },
  { id: 'choppedSalad', ingredients: ['plate', 'tomato', 'onion'], timerSeconds: 24, difficulty: 1, coins: 9 },

  // Tier 2 - 4-5 ingredients, still at most one cooked and no repeats.
  {
    id: 'tomatoMelt',
    ingredients: ['bunBottom', 'tomato', 'cheese', 'bunTop'],
    timerSeconds: 32,
    difficulty: 2,
    coins: 14
  },
  { id: 'gardenEgg', ingredients: ['bunBottom', 'egg', 'salad', 'bunTop'], timerSeconds: 38, difficulty: 2, coins: 21 },
  {
    id: 'cheeseburger',
    ingredients: ['bunBottom', 'patty', 'tomato', 'bunTop'],
    timerSeconds: 40,
    difficulty: 2,
    coins: 21
  },
  {
    id: 'veggie',
    ingredients: ['bunBottom', 'salad', 'tomato', 'cucumber', 'bunTop'],
    timerSeconds: 36,
    difficulty: 2,
    coins: 17
  },
  {
    id: 'classicPlus',
    ingredients: ['bunBottom', 'patty', 'cheese', 'onion', 'bunTop'],
    timerSeconds: 48,
    difficulty: 2,
    coins: 24
  },
  {
    id: 'eggClassic',
    ingredients: ['bunBottom', 'egg', 'cheese', 'tomato', 'bunTop'],
    timerSeconds: 46,
    difficulty: 2,
    coins: 24
  },
  {
    id: 'freshSalad',
    ingredients: ['plate', 'salad', 'tomato', 'cucumber'],
    timerSeconds: 28,
    difficulty: 2,
    coins: 14
  },
  {
    id: 'crispSalad',
    ingredients: ['plate', 'cucumber', 'onion', 'salad'],
    timerSeconds: 28,
    difficulty: 2,
    coins: 14
  },
  {
    id: 'dicedSalad',
    ingredients: ['plate', 'tomato', 'onion', 'cucumber'],
    timerSeconds: 28,
    difficulty: 2,
    coins: 14
  },

  // Tier 3 - 5-6 ingredients; repeated cookables (double patty, two eggs) start here.
  {
    id: 'picnic',
    ingredients: ['bunBottom', 'patty', 'onion', 'cucumber', 'bunTop'],
    timerSeconds: 55,
    difficulty: 3,
    coins: 26
  },
  {
    id: 'garden',
    ingredients: ['bunBottom', 'patty', 'tomato', 'onion', 'salad', 'bunTop'],
    timerSeconds: 62,
    difficulty: 3,
    coins: 29
  },
  {
    id: 'double',
    ingredients: ['bunBottom', 'patty', 'patty', 'cheese', 'bunTop'],
    timerSeconds: 60,
    difficulty: 3,
    coins: 33
  },
  {
    id: 'brunch',
    ingredients: ['bunBottom', 'patty', 'egg', 'cheese', 'bunTop'],
    timerSeconds: 62,
    difficulty: 3,
    coins: 33
  },
  {
    id: 'eggstra',
    ingredients: ['bunBottom', 'egg', 'egg', 'cheese', 'bunTop'],
    timerSeconds: 58,
    difficulty: 3,
    coins: 33
  },
  {
    id: 'stackedCheese',
    ingredients: ['bunBottom', 'patty', 'cheese', 'patty', 'bunTop'],
    timerSeconds: 62,
    difficulty: 3,
    coins: 33
  },
  {
    id: 'cobbSalad',
    ingredients: ['plate', 'salad', 'tomato', 'cucumber', 'onion'],
    timerSeconds: 42,
    difficulty: 3,
    coins: 19
  },
  {
    id: 'doubleTomatoSalad',
    ingredients: ['plate', 'tomato', 'salad', 'tomato', 'cucumber'],
    timerSeconds: 44,
    difficulty: 3,
    coins: 19
  },
  {
    id: 'doubleOnionSalad',
    ingredients: ['plate', 'onion', 'salad', 'cucumber', 'onion'],
    timerSeconds: 44,
    difficulty: 3,
    coins: 19
  },

  // Tier 4 - 6-7 ingredients, two cooked or a long topping stack.
  {
    id: 'loaded',
    ingredients: ['bunBottom', 'patty', 'cheese', 'tomato', 'cucumber', 'onion', 'bunTop'],
    timerSeconds: 80,
    difficulty: 4,
    coins: 34
  },
  {
    id: 'ranchBurger',
    ingredients: ['bunBottom', 'patty', 'cheese', 'onion', 'salad', 'tomato', 'bunTop'],
    timerSeconds: 82,
    difficulty: 4,
    coins: 34
  },
  {
    id: 'pattyMelt',
    ingredients: ['bunBottom', 'patty', 'onion', 'patty', 'cheese', 'bunTop'],
    timerSeconds: 70,
    difficulty: 4,
    coins: 38
  },
  {
    id: 'eggSandwich',
    ingredients: ['bunBottom', 'egg', 'onion', 'egg', 'cheese', 'bunTop'],
    timerSeconds: 68,
    difficulty: 4,
    coins: 38
  },
  {
    id: 'farmhouse',
    ingredients: ['bunBottom', 'patty', 'egg', 'cheese', 'tomato', 'salad', 'bunTop'],
    timerSeconds: 88,
    difficulty: 4,
    coins: 41
  },
  {
    id: 'doubleDecker',
    ingredients: ['bunBottom', 'patty', 'cheese', 'bunBottom', 'patty', 'cheese', 'bunTop'],
    timerSeconds: 85,
    difficulty: 4,
    coins: 41
  },
  {
    id: 'harvestSalad',
    ingredients: ['plate', 'salad', 'tomato', 'cucumber', 'onion', 'salad'],
    timerSeconds: 62,
    difficulty: 4,
    coins: 24
  },
  {
    id: 'megaSalad',
    ingredients: ['plate', 'tomato', 'onion', 'tomato', 'cucumber', 'onion'],
    timerSeconds: 64,
    difficulty: 4,
    coins: 24
  },
  {
    id: 'gardenFeast',
    ingredients: ['plate', 'cucumber', 'salad', 'onion', 'tomato', 'salad'],
    timerSeconds: 62,
    difficulty: 4,
    coins: 24
  },

  // Tier 5 - 7-8 ingredients. Three cooked only at 7 ingredients, which is what holds the 50-coin ceiling.
  {
    id: 'supreme',
    ingredients: ['bunBottom', 'patty', 'egg', 'cheese', 'tomato', 'onion', 'salad', 'bunTop'],
    timerSeconds: 100,
    difficulty: 5,
    coins: 46
  },
  {
    id: 'megastack',
    ingredients: ['bunBottom', 'patty', 'patty', 'cheese', 'tomato', 'onion', 'cucumber', 'bunTop'],
    timerSeconds: 98,
    difficulty: 5,
    coins: 46
  },
  {
    id: 'farmstack',
    ingredients: ['bunBottom', 'egg', 'cheese', 'patty', 'onion', 'tomato', 'salad', 'bunTop'],
    timerSeconds: 102,
    difficulty: 5,
    coins: 46
  },
  {
    id: 'tripledeck',
    ingredients: ['bunBottom', 'patty', 'patty', 'patty', 'cheese', 'cheese', 'bunTop'],
    timerSeconds: 105,
    difficulty: 5,
    coins: 50
  },
  {
    id: 'towering',
    ingredients: ['bunBottom', 'patty', 'tomato', 'patty', 'onion', 'patty', 'bunTop'],
    timerSeconds: 105,
    difficulty: 5,
    coins: 50
  },
  {
    id: 'brunchStack',
    ingredients: ['bunBottom', 'egg', 'patty', 'egg', 'cheese', 'onion', 'bunTop'],
    timerSeconds: 100,
    difficulty: 5,
    coins: 50
  },
  {
    id: 'deluxeSalad',
    ingredients: ['plate', 'salad', 'cucumber', 'tomato', 'salad', 'onion', 'cucumber'],
    timerSeconds: 85,
    difficulty: 5,
    coins: 29
  },
  {
    id: 'supremeSalad',
    ingredients: ['plate', 'tomato', 'cucumber', 'onion', 'salad', 'tomato', 'cucumber'],
    timerSeconds: 88,
    difficulty: 5,
    coins: 29
  },
  {
    id: 'harvestFeast',
    ingredients: ['plate', 'onion', 'salad', 'cucumber', 'tomato', 'onion', 'salad'],
    timerSeconds: 86,
    difficulty: 5,
    coins: 29
  }
]

const RECIPES_BY_ID = new Map(SAMPLE_RECIPES.map((recipe) => [recipe.id, recipe]))

/** Looks up a recipe by id — resolves a synced OrderState's recipeId for rendering. */
export function getRecipeById(id: string): Recipe | undefined {
  return RECIPES_BY_ID.get(id)
}

/** Difficulty tier for the current streak: one tier per STREAK_DIFFICULTY_STEP, capped at MAX_DIFFICULTY_TIER. Clamps at 0 so a negative streak can't ask for a tier no recipe has. */
export function getDifficultyForStreak(streak: number): number {
  return Math.min(1 + Math.floor(Math.max(streak, 0) / STREAK_DIFFICULTY_STEP), MAX_DIFFICULTY_TIER)
}

/**
 * How far through the current tier the streak sits, 0..1 — drives the HUD's
 * level bar. Reads 1 at the top tier rather than wrapping: the streak keeps
 * climbing to MAX_STREAK past that point, so a plain modulo would make the
 * bar appear to reset exactly when the team is doing best.
 */
export function getStreakProgress(streak: number): number {
  if (getDifficultyForStreak(streak) >= MAX_DIFFICULTY_TIER) return 1
  return (Math.max(streak, 0) % STREAK_DIFFICULTY_STEP) / STREAK_DIFFICULTY_STEP
}

/** Picks a random recipe at the given difficulty, falling back to the whole pool if that tier is empty (e.g. no recipes defined for it yet). */
export function pickRandomRecipeByDifficulty(difficulty: number): Recipe {
  const pool = SAMPLE_RECIPES.filter((recipe) => recipe.difficulty === difficulty)
  const source = pool.length > 0 ? pool : SAMPLE_RECIPES
  return source[Math.floor(Math.random() * source.length)] ?? SAMPLE_RECIPES[0]
}

// IngredientAtlas.png: 256x512, 2x8 grid of 128x64 cells. Only column 0
// and column 1's bottom two rows (bunTop, plate) are populated — rest is reserved.
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
  bunTop: [1, 7],
  plate: [1, 6]
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
