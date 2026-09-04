// Per-item placement data: how tall each pickup item's model is, and how it
// sits in the player's hand. Both are per-model tuning tables with the same
// shape and the same fallback story, so they live together — a new item
// added to models.ts needs an entry in each.

import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { MODELS } from '../../shared/models'

// --- Stacking height ---
//
// Height (in meters) of each item's model, used to stack items on
// preparation counters without them clipping into each other. Values are
// placeholders until the real models are measured — edit individual entries
// as accurate heights become available.

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

// --- Hand attachment ---
//
// Position/rotation/scale offset applied when an item is attached to the
// player's hand. Each model has a different pivot point and size, so a
// single global offset doesn't fit all of them.
//
// Every entry always has a concrete rotation/scale (defaulting to identity/
// one via handTransform()) rather than leaving them undefined — Transform.
// create merges the object you pass over its internal defaults, so an
// explicitly-present `rotation: undefined` overwrites the default instead
// of falling back to it, which crashes when the engine reads it.

export interface HandTransform {
  position: Vector3
  rotation: Quaternion
  scale: Vector3
}

function handTransform(
  position: Vector3,
  rotation: Quaternion = Quaternion.Identity(),
  scale: Vector3 = Vector3.One()
): HandTransform {
  return { position, rotation, scale }
}

const DEFAULT_HAND_TRANSFORM: HandTransform = handTransform(Vector3.create(0, 0, 0))

export const ITEM_HAND_TRANSFORMS: Record<string, HandTransform> = {
  [MODELS.cucumberSlice]: handTransform(Vector3.create(0.05, 0.32, 0), Quaternion.fromEulerDegrees(40, 0, 90)),
  [MODELS.onionSlice]: handTransform(Vector3.create(0.06, 0.25, 0), Quaternion.fromEulerDegrees(0, 0, 90)),
  [MODELS.tomatoSlice]: handTransform(Vector3.create(0.03, 0.33, 0), Quaternion.fromEulerDegrees(60, 0, 90)),
  [MODELS.saladLeaf]: handTransform(Vector3.create(-0.02, 0.32, -0.03), Quaternion.fromEulerDegrees(0, 180, 90)),
  [MODELS.cheeseSlice]: handTransform(Vector3.create(0.06, 0.3, 0), Quaternion.fromEulerDegrees(0, 0, 90)),
  [MODELS.bunBottom]: handTransform(Vector3.create(0.07, 0.3, 0), Quaternion.fromEulerDegrees(0, 0, 90)),
  [MODELS.bunTop]: handTransform(Vector3.create(0.09, 0.31, 0), Quaternion.fromEulerDegrees(0, 0, 90)),
  [MODELS.pattyRaw]: handTransform(Vector3.create(0.08, 0.28, 0), Quaternion.fromEulerDegrees(0, 0, 90)),
  [MODELS.pattyCooked]: handTransform(Vector3.create(0.08, 0.28, 0), Quaternion.fromEulerDegrees(0, 0, 90)),
  [MODELS.egg]: handTransform(Vector3.create(0.05, 0.45, 0), Quaternion.fromEulerDegrees(180, 0, 0)),
  [MODELS.eggRaw]: handTransform(Vector3.create(0.05, 0.31, 0), Quaternion.fromEulerDegrees(0, 0, 90)),
  [MODELS.burntCookable]: handTransform(Vector3.create(0.06, 0.28, 0), Quaternion.fromEulerDegrees(0, 0, 90)),
  [MODELS.plate]: handTransform(
    Vector3.create(0.04, 0.32),
    Quaternion.fromEulerDegrees(0, 0, 90),
    Vector3.create(0.8, 0.8, 0.8)
  )
}

/** Falls back to DEFAULT_HAND_TRANSFORM for any model not listed above (e.g. a new item added to models.ts but not tuned yet). */
export function getHandTransform(model: string): HandTransform {
  return ITEM_HAND_TRANSFORMS[model] ?? DEFAULT_HAND_TRANSFORM
}
