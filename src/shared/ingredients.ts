// Single registry of every pickup-able ingredient. `model` is what a player
// carries and what sits on a counter; a cookable adds a `cooking` block for
// what the stove shows and what comes off it.
//
// Models are reused across states wherever that looks right — egg's cooked
// form is its raw model on purpose. `stoveModel` defaults to `model`, so only
// an ingredient that actually changes on the pan names one.
//
// Everything below derives from this object. MODEL_INDEX inverts it, so the
// model-keyed questions — what is this, can it be held, what does it cook into
// — are one lookup rather than three separate sets.

import { MODELS, Model } from './models'

/** Authored form; `stoveModel` is filled in from `model` when omitted. */
interface IngredientSpec {
  model: Model
  cooking?: {
    stoveModel?: Model
    cookedModel: Model
    durationSeconds: number
  }
}

export const INGREDIENTS = {
  plate: { model: MODELS.plate },
  tomato: { model: MODELS.tomatoSlice },
  cucumber: { model: MODELS.cucumberSlice },
  onion: { model: MODELS.onionSlice },
  salad: { model: MODELS.saladLeaf },
  cheese: { model: MODELS.cheeseSlice },
  bunTop: { model: MODELS.bunTop },
  bunBottom: { model: MODELS.bunBottom },
  patty: {
    model: MODELS.pattyRaw,
    cooking: { cookedModel: MODELS.pattyCooked, durationSeconds: 5 }
  },
  egg: {
    model: MODELS.egg,
    cooking: { stoveModel: MODELS.eggRaw, cookedModel: MODELS.eggRaw, durationSeconds: 5 }
  }
} satisfies Record<string, IngredientSpec>

/** Every ingredient name, so a table keyed per ingredient fails to compile when one is missing. */
export type Ingredient = keyof typeof INGREDIENTS

/** A cookable with `stoveModel` resolved and its raw model carried along. */
export interface CookableItem {
  model: Model
  stoveModel: Model
  cookedModel: Model
  durationSeconds: number
}

interface ModelInfo {
  cooked: boolean // this is a finished model, not something raw
  cookable?: CookableItem // set on a cookable's raw model
}

const MODEL_INDEX = new Map<string, ModelInfo>()

for (const spec of Object.values(INGREDIENTS) as IngredientSpec[]) {
  if (!spec.cooking) {
    MODEL_INDEX.set(spec.model, { cooked: false })
    continue
  }

  const cookable: CookableItem = {
    model: spec.model,
    stoveModel: spec.cooking.stoveModel ?? spec.model,
    cookedModel: spec.cooking.cookedModel,
    durationSeconds: spec.cooking.durationSeconds
  }
  MODEL_INDEX.set(spec.model, { cooked: false, cookable })
  MODEL_INDEX.set(cookable.cookedModel, { cooked: true })
}

// Granted by server/fixtures/stove.ts when a finished cook sits too long, so it
// is a cooked model that belongs to no single ingredient.
MODEL_INDEX.set(MODELS.burntCookable, { cooked: true })

/** The cookable this model is the raw form of, or undefined if it isn't one. */
export function getCookableItemDefinition(model: string): CookableItem | undefined {
  return MODEL_INDEX.get(model)?.cookable
}

/** The model an ingredient must appear as in a delivered stack — the cooked form for a cookable. */
export function getRequiredModelForIngredient(ingredient: Ingredient): Model {
  const spec: IngredientSpec = INGREDIENTS[ingredient]
  return spec.cooking?.cookedModel ?? spec.model
}

type ItemCategory = 'nonCookable' | 'rawCookable' | 'cookedCookable'

export function classifyItem(model: string): ItemCategory {
  const info = MODEL_INDEX.get(model)
  if (!info) return 'nonCookable'
  if (info.cooked) return 'cookedCookable'
  return info.cookable ? 'rawCookable' : 'nonCookable'
}

/** Whether a model is one a player can legitimately be holding — the server's guard against hand-crafted setHeldItem payloads. */
export function isHoldableModel(model: string): boolean {
  return MODEL_INDEX.has(model)
}
