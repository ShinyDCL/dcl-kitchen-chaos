// Focuses the best fixture within INTERACTION_RANGE every frame, scored as
// distance minus a bonus for facing it (FACING_BONUS). Distance dominates;
// facing only decides between two near-equidistant fixtures, such as a corner
// with one counter ahead and another to the side.
//
// The focused fixture's `evaluate` re-runs every frame, since its result can
// change while focus is held — picking something up changes whether cooking is
// allowed.
//
// Gated on isServerAlive: most actions render their result immediately, and
// every reconciler reacts only when the synced state changes. With no server
// nothing changes, so those predictions are never corrected and a phantom item
// is left in hand or on a counter.

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

// Without this, focus flickers between near-tied fixtures (e.g. the island's
// adjacent counters) as per-frame noise — the avatar bob, small look adjustments —
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
 * Registers a fixture as focusable. Resolves the anchor's world position once —
 * fixtures don't move after scene setup.
 * @param evaluate omit for a fixture that highlights but has no interaction.
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
