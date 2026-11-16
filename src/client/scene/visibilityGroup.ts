// Shows and hides a set of entities together, by writing VisibilityComponent
// on every one of them.
//
// Never left to propagateToChildren. Propagation is the documented behaviour,
// but it is the renderer's to honour, and the mobile client does not: a hidden
// parent left its children drawn — the stove's progress bar stuck on screen,
// a small result mark left on the delivery counter. So every entity that draws
// something (a model, a mesh, text) is a member and gets its own component,
// and the group is only ever toggled through here.
//
// Scale is the caller's business; pop-in/out animations scale an anchor and
// toggle its group alongside.

import { Entity, VisibilityComponent } from '@dcl/sdk/ecs'

export interface VisibilityGroup {
  readonly entities: readonly Entity[]
  visible: boolean
}

/** Gives each entity its own VisibilityComponent at `visible` (default hidden). Include the anchor along with whatever it draws. */
export function createVisibilityGroup(entities: Entity[], visible = false): VisibilityGroup {
  for (const entity of entities) VisibilityComponent.createOrReplace(entity, { visible })
  return { entities, visible }
}

/** Writes only on a change, so it is safe to call every frame. */
export function setGroupVisible(group: VisibilityGroup, visible: boolean): void {
  if (group.visible === visible) return
  group.visible = visible
  for (const entity of group.entities) VisibilityComponent.getMutable(entity).visible = visible
}
