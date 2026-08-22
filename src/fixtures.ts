// Generic fixture creation shared by every placeable object in the scene —
// ingredient counters, empty counters, stoves, and anything added later.
// A fixture always gets a model and a focus anchor registered with
// focusManager so it highlights on proximity. Everything else is optional:
// pass displayModel for fixtures that show something on top (ingredient
// trays), and onInteract for fixtures that do something today — it
// receives the fixture's own entity, e.g. so a preparation counter knows
// which counter to stack an item onto. Fixtures without onInteract still
// highlight on proximity, they just don't respond to the interact button
// yet — this is how stoves work until their behavior is implemented.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { registerFocusableFixture } from './focusManager'

export interface FixtureOptions {
  model: string
  position: Vector3
  rotation?: Quaternion
  parent: Entity
  height: number // vertical offset for the display model and the focus highlight
  displayModel?: string
  onInteract?: (fixtureEntity: Entity) => void
}

export function createFixture(options: FixtureOptions): Entity {
  const { model, position, rotation, parent, height, displayModel, onInteract } = options

  const fixture = engine.addEntity()
  Transform.create(fixture, { position, rotation, parent })
  GltfContainer.create(fixture, { src: model })

  if (displayModel) {
    const display = engine.addEntity()
    Transform.create(display, {
      position: Vector3.create(0, height, 0),
      parent: fixture
    })
    GltfContainer.create(display, { src: displayModel })
  }

  // Anchor entity marking where the focus highlight should appear — its world
  // position is resolved via the parent chain, so it stays correct regardless
  // of this fixture's own rotation or its parent's position.
  const focusAnchor = engine.addEntity()
  Transform.create(focusAnchor, {
    position: Vector3.create(0, height, 0),
    parent: fixture
  })
  registerFocusableFixture(focusAnchor, onInteract ? () => onInteract(fixture) : undefined)

  return fixture
}
