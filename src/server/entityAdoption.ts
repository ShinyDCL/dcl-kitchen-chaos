// Guards the snapshot scans that re-adopt entities after a server restart.
//
// Every reconciler here walks engine.getEntitiesWith(SomeComponent) and takes
// ownership of what it finds — caching the handle, mutating it every frame,
// sometimes removing it. Entity numbers below RESERVED_STATIC_ENTITIES belong
// to the runtime (root, camera, avatars), so adopting one would mean writing
// to or deleting something the engine owns.
//
// In practice unreachable: these are scene-defined components, created only
// through engine.addEntity() (which never returns a reserved number) and
// locked to server writes by shared/schemas.ts. It is kept because the cost
// of the check is a comparison and the cost of being wrong is corrupting a
// runtime entity.

import { Entity, EntityUtils, RESERVED_STATIC_ENTITIES } from '@dcl/sdk/ecs'

/** Whether a scanned entity is one this scene may take ownership of, rather than a runtime/avatar-owned slot. */
export function isAdoptableEntity(entity: Entity): boolean {
  const [entityNumber] = EntityUtils.fromEntityId(entity)
  return entityNumber >= RESERVED_STATIC_ENTITIES
}
