// Tracks all interactable fixtures and, every frame, focuses the best one
// within INTERACTION_RANGE, scored as distance minus a bonus for facing it
// (see FACING_BONUS). Distance dominates, so the fixture you walked up to is
// normally the one you get; facing only decides it between two that are
// close to equidistant — standing in a corner with one counter ahead and
// another to the side.
//
// A focused fixture's `evaluate` callback re-runs every frame, not just on
// focus change — its InteractionResult can change while still looking at
// it (e.g. picking something up changes whether cooking is now allowed).
// On interact: `perform` runs if allowed (also playing the interaction
// sound at the fixture's position), otherwise `message` shows via the
// on-screen message UI.
//
// Gated on isServerAlive: a fixture action's optimistic hand change is only
// undone by the server's actionRejected (see heldItem.ts's
// takeHeldItemPending), so acting before the server is up leaves the hand
// showing the wrong thing with nothing to correct it. This is also what
// keeps the player from flailing at counters behind the "Loading..." overlay.

import { engine, Entity, InputAction, inputSystem, PointerEventType, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { getWorldPosition, getWorldRotation } from '../scene/worldPosition'
import { isServerAlive } from '../serverReadiness'
import { playInteractionSoundAt } from '../sound'
import { showMessage } from './fixtureMessage'
import { hideHighlight, setHighlightAllowed, showHighlightAt } from './highlight'
import { InteractionResult } from './interactionRules'

const INTERACTION_RANGE = 2.5 // meters

// What facing a fixture head-on is worth, in metres of distance. Big enough
// to settle a corner (two counters within a arm's reach of each other), small
// enough that one you are standing at still wins over one across the aisle.
// Clamped at 0, so facing away is never a penalty — it just earns nothing.
const FACING_BONUS = 0.6 // meters

// Without this, focus flickers between near-tied fixtures (e.g. the 2x2
// island) as per-frame noise — the avatar bob, small look adjustments —
// nudges the score. Keeps the current focus unless something clearly beats
// it, not just marginally.
const FOCUS_SWITCH_MARGIN = 0.3 // meters

interface FocusableFixture {
  id: number
  worldPosition: Vector3
  worldRotation: Quaternion
  evaluate: (() => InteractionResult) | undefined
}

interface FixtureCandidate {
  fixture: FocusableFixture
  score: number // lower wins; see FACING_BONUS
}

const fixtures: FocusableFixture[] = []
let nextId = 0
let focusedFixtureId: number | null = null
let systemRegistered = false

const ALWAYS_ALLOWED: InteractionResult = { allowed: true }

/**
 * Registers a fixture as focusable. Resolves the anchor's world position
 * once, immediately — fixtures don't move after scene setup.
 * @param evaluate optional — omit for a fixture that should highlight
 *   (always green) but has no interaction logic at all.
 */
export function registerFocusableFixture(anchor: Entity, evaluate?: () => InteractionResult): void {
  fixtures.push({
    id: nextId++,
    worldPosition: getWorldPosition(anchor),
    worldRotation: getWorldRotation(anchor),
    evaluate
  })
  ensureSystemRegistered()
}

function ensureSystemRegistered(): void {
  if (systemRegistered) return
  engine.addSystem(focusSystem)
  systemRegistered = true
}

function getPlayerForward(rotation: Quaternion): Vector3 {
  return Vector3.rotate(Vector3.Forward(), rotation)
}

function getCandidatesInRange(playerPosition: Vector3, playerForward: Vector3): FixtureCandidate[] {
  const candidates: FixtureCandidate[] = []

  for (const fixture of fixtures) {
    const distance = Vector3.distance(playerPosition, fixture.worldPosition)
    if (distance > INTERACTION_RANGE) continue

    const towardFixture = Vector3.normalize(Vector3.subtract(fixture.worldPosition, playerPosition))
    const facing = Math.max(0, Vector3.dot(playerForward, towardFixture))

    candidates.push({ fixture, score: distance - FACING_BONUS * facing })
  }

  return candidates
}

function pickBestCandidate(candidates: FixtureCandidate[], currentFocusId: number | null): FocusableFixture | null {
  let best = candidates[0]
  if (!best) return null // nothing in range

  for (const candidate of candidates) {
    if (candidate.score < best.score) best = candidate
  }

  // Stick with the current focus unless something beats it by more than FOCUS_SWITCH_MARGIN.
  const current = candidates.find((c) => c.fixture.id === currentFocusId)
  if (current && current.score <= best.score + FOCUS_SWITCH_MARGIN) return current.fixture

  return best.fixture
}

function focusSystem(): void {
  if (!isServerAlive()) {
    if (focusedFixtureId !== null) {
      focusedFixtureId = null
      hideHighlight()
    }
    return
  }

  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  if (!playerTransform) return

  const playerForward = getPlayerForward(playerTransform.rotation)
  const candidates = getCandidatesInRange(playerTransform.position, playerForward)
  const nearest = pickBestCandidate(candidates, focusedFixtureId)

  if (nearest === null) {
    if (focusedFixtureId !== null) {
      focusedFixtureId = null
      hideHighlight()
    }
    return
  }

  const result = nearest.evaluate ? nearest.evaluate() : ALWAYS_ALLOWED

  if (nearest.id !== focusedFixtureId) {
    focusedFixtureId = nearest.id
    showHighlightAt(nearest.worldPosition, nearest.worldRotation, result.allowed)
  } else {
    setHighlightAllowed(result.allowed)
  }

  if (!inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) return

  if (result.allowed) {
    result.perform?.()
    playInteractionSoundAt(nearest.worldPosition)
  } else if (result.message) {
    showMessage(result.message, nearest.worldPosition)
  }
}
