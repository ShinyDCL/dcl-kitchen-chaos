// Tracks all interactable fixtures and, every frame, focuses the single
// nearest one within INTERACTION_RANGE, preferring one the player is
// roughly facing (FACING_THRESHOLD) when several are in range.
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
const FACING_THRESHOLD = 0.1 // dot product; ~0.1 ≈ wide ±84° cone

// Without this, focus flickers between near-tied fixtures (e.g. the 2x2
// island) as per-frame noise (avatar bob, mouse-look drift) flips which is
// a hair closer. Keeps the current focus unless something is clearly
// nearer, not just marginally.
const FOCUS_SWITCH_MARGIN = 0.3 // meters

interface FocusableFixture {
  id: number
  worldPosition: Vector3
  worldRotation: Quaternion
  evaluate: (() => InteractionResult) | undefined
}

interface FixtureCandidate {
  fixture: FocusableFixture
  distance: number
  facingScore: number
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

    const directionToFixture = Vector3.normalize(Vector3.subtract(fixture.worldPosition, playerPosition))
    const facingScore = Vector3.dot(playerForward, directionToFixture)

    candidates.push({ fixture, distance, facingScore })
  }

  return candidates
}

function pickBestCandidate(candidates: FixtureCandidate[], currentFocusId: number | null): FocusableFixture | null {
  if (candidates.length === 0) return null

  const facedCandidates = candidates.filter((c) => c.facingScore >= FACING_THRESHOLD)
  const pool = facedCandidates.length > 0 ? facedCandidates : candidates

  let best = pool[0]
  for (const candidate of pool) {
    if (candidate.distance < best.distance) best = candidate
  }

  // Stick with the current focus unless something beats it by more than FOCUS_SWITCH_MARGIN.
  const current = pool.find((c) => c.fixture.id === currentFocusId)
  if (current && current.distance <= best.distance + FOCUS_SWITCH_MARGIN) return current.fixture

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
