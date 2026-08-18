import {
  engine,
  Entity,
  Material,
  MeshRenderer,
  Transform,
  TriggerArea,
  triggerAreaEventsSystem,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

import { CircleAnimation, registerCircleAnimation, unregisterCircleAnimation } from './animationManager'
import { CIRCLE_DIAMETER, CIRCLE_THICKNESS, COUNTER_WIDTH, TRANSITION_DURATION, TRIGGER_HEIGHT } from './constants'

const COLOR_START = Color4.create(0, 0.4, 1, 1)
const COLOR_END = Color4.create(0, 1, 0.3, 1)

// A countdown circle + its invisible trigger volume. The circle is hidden
// until the player steps into the trigger; then it animates color over
// TRANSITION_DURATION seconds. On completion it hides itself and fires
// onComplete(). Leaving early cancels and resets the countdown.

export function createColorChangingCircleTrigger(
  position: Vector3,
  parent: Entity,
  onComplete: () => void
): { circle: Entity; trigger: Entity } {
  const circle = createCircleEntity(position, parent)
  const trigger = createTriggerEntity(position, parent)

  let elapsed = 0
  let running = false

  const animation: CircleAnimation = {
    update(dt: number): boolean {
      elapsed += dt
      const t = Math.min(elapsed / TRANSITION_DURATION, 1)

      Material.setPbrMaterial(circle, {
        albedoColor: Color4.lerp(COLOR_START, COLOR_END, t),
        metallic: 0,
        roughness: 0.7
      })

      if (t >= 1) {
        running = false
        VisibilityComponent.getMutable(circle).visible = false
        onComplete()
        return true // done — animationManager removes it from the active set
      }
      return false
    }
  }

  function startCountdown() {
    if (running) return
    running = true
    elapsed = 0
    VisibilityComponent.getMutable(circle).visible = true
    Material.setPbrMaterial(circle, { albedoColor: COLOR_START, metallic: 0, roughness: 0.7 })
    registerCircleAnimation(animation)
  }

  function cancelCountdown() {
    if (!running) return
    running = false
    unregisterCircleAnimation(animation)
    VisibilityComponent.getMutable(circle).visible = false
  }

  triggerAreaEventsSystem.onTriggerEnter(trigger, (result) => {
    if (result.trigger?.entity !== engine.PlayerEntity) return
    startCountdown()
  })

  triggerAreaEventsSystem.onTriggerExit(trigger, (result) => {
    if (result.trigger?.entity !== engine.PlayerEntity) return
    cancelCountdown()
  })

  return { circle, trigger }
}

function createCircleEntity(position: Vector3, parent: Entity): Entity {
  const circle = engine.addEntity()
  Transform.create(circle, {
    position,
    scale: Vector3.create(CIRCLE_DIAMETER, CIRCLE_THICKNESS, CIRCLE_DIAMETER),
    parent
  })
  // Default cylinder is radiusTop = radiusBottom = 0.5 (1m diameter) before scaling
  MeshRenderer.setCylinder(circle)
  Material.setPbrMaterial(circle, { albedoColor: COLOR_START, metallic: 0, roughness: 0.7 })
  VisibilityComponent.create(circle, { visible: false }) // hidden until player enters trigger
  return circle
}

function createTriggerEntity(position: Vector3, parent: Entity): Entity {
  const trigger = engine.addEntity()
  Transform.create(trigger, {
    // Unchanged from the original: same footprint on both horizontal axes.
    position: Vector3.create(position.x, TRIGGER_HEIGHT / 2, position.z),
    scale: Vector3.create(COUNTER_WIDTH, TRIGGER_HEIGHT, COUNTER_WIDTH),
    parent
  })
  TriggerArea.setBox(trigger)
  return trigger
}
