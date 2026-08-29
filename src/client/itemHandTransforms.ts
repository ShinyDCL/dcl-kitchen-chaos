// Per-item position/rotation/scale offset applied when a pickup item is
// attached to the player's hand. Each model has a different pivot point
// and size, so a single global offset doesn't fit all of them — edit
// individual entries below as needed.
//
// Every entry always has a concrete rotation/scale (defaulting to identity/
// one via handTransform()) rather than leaving them undefined — Transform.
// create merges the object you pass over its internal defaults, so an
// explicitly-present `rotation: undefined` overwrites the default instead
// of falling back to it, which crashes when the engine reads it.

import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { MODELS } from '../shared/models'

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
    Vector3.create(0.04, 0.34, 0),
    Quaternion.fromEulerDegrees(0, 0, 90),
    Vector3.create(0.7, 0.7, 0.7)
  )
}

/** Falls back to DEFAULT_HAND_TRANSFORM for any model not listed above (e.g. a new item added to models.ts but not tuned yet). */
export function getHandTransform(model: string): HandTransform {
  return ITEM_HAND_TRANSFORMS[model] ?? DEFAULT_HAND_TRANSFORM
}
