// Reusable "pop" scale for an entity whose visibility toggles at an
// unpredictable time (stove.ts's checkmark) — eases in from 0 when
// shown, eases back to 0 before hiding, rather than snapping. Unlike
// fixtureMessage.ts's pop (which knows its whole shown duration up front),
// this just reacts to a "should this be visible" boolean each frame.

export const POP_SCALE_SECONDS = 0.15

export interface PopState {
  visible: boolean // last target visibility fed into tickPopState
  elapsedSinceChange: number // seconds since `visible` last flipped
}

/** Starts fully hidden/settled — tickPopState eases in the first time `visible` is fed as true. */
export function createPopState(): PopState {
  return { visible: false, elapsedSinceChange: POP_SCALE_SECONDS }
}

export interface PopResult {
  scale: number // 0..1 — apply to the entity's Transform.scale
  shown: boolean // whether VisibilityComponent.visible should still be true (stays true briefly while easing out)
}

/** Call once per frame with the entity's desired visibility. */
export function tickPopState(state: PopState, visible: boolean, dt: number): PopResult {
  if (visible !== state.visible) {
    state.visible = visible
    state.elapsedSinceChange = 0
  } else if (state.elapsedSinceChange < POP_SCALE_SECONDS) {
    state.elapsedSinceChange += dt
  }

  const t = Math.min(state.elapsedSinceChange / POP_SCALE_SECONDS, 1)
  const scale = state.visible ? t : 1 - t
  return { scale, shown: scale > 0 }
}
