// Transform.position is local to its parent, so it isn't safe to use directly
// for world-space checks (distance, highlight placement) once entities are
// nested under an offset AND rotated parent — like counters/stoves under
// the scene root here, which are rotated to face the room's center.
//
// This walks the parent chain, composing both position and rotation: a
// child's local offset must be rotated by its parent's world rotation
// before being added to the parent's world position, or the result is
// wrong for any child with a nonzero local x/z offset under a rotated
// parent. getWorldRotation composes rotations via quaternion
// multiplication, which doesn't have this issue on its own — but
// getWorldPosition needs it to correctly place rotated offsets.
//
// Assumes no non-uniform scale on any ancestor.

import { Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

export function getWorldPosition(entity: Entity): Vector3 {
  const transform = Transform.getOrNull(entity)
  if (!transform) return Vector3.Zero()

  // `parent` is 0 (RootEntity) when unset — root has no Transform component,
  // so treating a falsy parent as "no parent to compose with" is correct.
  if (!transform.parent) return transform.position

  const parentWorldPosition = getWorldPosition(transform.parent)
  const parentWorldRotation = getWorldRotation(transform.parent)
  const rotatedLocalPosition = Vector3.rotate(transform.position, parentWorldRotation)
  return Vector3.add(parentWorldPosition, rotatedLocalPosition)
}

export function getWorldRotation(entity: Entity): Quaternion {
  const transform = Transform.getOrNull(entity)
  if (!transform) return Quaternion.Identity()

  const parentWorldRotation = transform.parent ? getWorldRotation(transform.parent) : Quaternion.Identity()
  return Quaternion.multiply(parentWorldRotation, transform.rotation)
}
