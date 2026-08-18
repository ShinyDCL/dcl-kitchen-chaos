// A single, shared system drives every circle's color-transition animation.
// Individual triggers register/unregister themselves with this manager
// instead of each spinning up their own engine.addSystem call.

import { engine } from '@dcl/sdk/ecs'

export interface CircleAnimation {
  /** Advances the animation by dt. Returns true once it has finished. */
  update: (dt: number) => boolean
}

const activeAnimations = new Set<CircleAnimation>()
let systemRegistered = false

function circleAnimationSystem(dt: number) {
  for (const animation of activeAnimations) {
    const finished = animation.update(dt)
    if (finished) {
      activeAnimations.delete(animation)
    }
  }
}

function ensureSystemRegistered() {
  if (systemRegistered) return
  engine.addSystem(circleAnimationSystem)
  systemRegistered = true
}

export function registerCircleAnimation(animation: CircleAnimation) {
  activeAnimations.add(animation)
  ensureSystemRegistered()
}

export function unregisterCircleAnimation(animation: CircleAnimation) {
  activeAnimations.delete(animation)
}
