// Transform.position is local to its parent, so it isn't safe to use directly
// for world-space checks (distance, highlight placement) once entities are
// nested under an offset parent — like counters under the scene root here.
// This walks the parent chain and sums local positions to get world position.
//
// Assumes no rotation or non-uniform scale on any ancestor. All parents in
// this scene only carry a position offset, so a positional sum is enough;
// if that ever changes, this needs a real matrix composition instead.

import { Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

export function getWorldPosition(entity: Entity): Vector3 {
  const transform = Transform.getOrNull(entity)
  if (!transform) return Vector3.Zero()

  // `parent` is 0 (RootEntity) when unset — root has no Transform component,
  // so treating a falsy parent as "no offset to add" is correct, not a bug.
  const parentWorldPosition = transform.parent ? getWorldPosition(transform.parent) : Vector3.Zero()
  return Vector3.add(transform.position, parentWorldPosition)
}
