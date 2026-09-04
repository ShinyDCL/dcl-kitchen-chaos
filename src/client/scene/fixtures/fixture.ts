// Generic fixture creation shared by every placeable object in the scene.
// A fixture always gets a model and a focus anchor registered with
// focusManager so it highlights on proximity. Pass evaluateInteraction for
// a fixture that has interaction logic — it's called every frame the
// fixture is focused (see focusManager.ts) and returns an InteractionResult
// telling the caller whether interacting is currently allowed, what
// message to show if not, and what to run if it is. Fixtures without
// evaluateInteraction still highlight (always green) but do nothing on
// interact.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { registerFocusableFixture } from '../../interaction/focusManager'
import { InteractionResult } from '../../interaction/interactionRules'

export interface FixtureOptions {
  model: string
  position: Vector3
  rotation?: Quaternion
  parent: Entity
  height: number // vertical offset for the display model and the focus highlight
  displayModel?: string
  evaluateInteraction?: (fixtureEntity: Entity) => InteractionResult
}

let nextFixtureSyncId = 0
const fixtureSyncIds = new Map<Entity, number>()

export function createFixture(options: FixtureOptions): Entity {
  const { model, position, rotation, parent, height, displayModel, evaluateInteraction } = options

  const fixture = engine.addEntity()
  Transform.create(fixture, { position, rotation, parent })
  GltfContainer.create(fixture, { src: model })
  fixtureSyncIds.set(fixture, nextFixtureSyncId++)

  if (displayModel) {
    const display = engine.addEntity()
    Transform.create(display, {
      position: Vector3.create(0, height, 0),
      parent: fixture
    })
    GltfContainer.create(display, { src: displayModel })
  }

  const focusAnchor = engine.addEntity()
  Transform.create(focusAnchor, {
    position: Vector3.create(0, height, 0),
    parent: fixture
  })
  registerFocusableFixture(focusAnchor, evaluateInteraction ? () => evaluateInteraction(fixture) : undefined)

  return fixture
}

/**
 * Stable numeric ID assigned in scene-build order — identical on every
 * client, since createSceneLayout runs the same fixture-creation calls in
 * the same order for everyone. Used as the explicit syncEntity id for
 * fixture-owned state (PreparationCounterState, StoveState, DeliveryState).
 */
export function getFixtureSyncId(fixture: Entity): number {
  const id = fixtureSyncIds.get(fixture)
  if (id === undefined) throw new Error('Entity is not a registered fixture')
  return id
}
