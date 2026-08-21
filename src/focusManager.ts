// Tracks all interactable fixtures (ingredient counters, stoves, empty
// counters — anything registered via registerFocusableFixture) and, every
// frame, focuses the single nearest one within INTERACTION_RANGE. When
// multiple fixtures are in range at once, prefers the one the player is
// roughly facing over pure nearest-distance, using a dot-product check
// rather than an actual raycast — no precise aim required, which matters
// for mobile touch controls.
// Also listens for the "interact" button (E on desktop, primary action
// button on mobile) and fires the focused fixture's callback when pressed,
// if it has one — fixtures without an onInteract (stoves, empty counters
// for now) still highlight but simply do nothing on press.
//
// This is the ONLY system registered for the pickup feature — a single
// engine.addSystem call handles proximity, facing, and input for every fixture.

import { engine, Entity, InputAction, inputSystem, PointerEventType, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FACING_THRESHOLD, INTERACTION_RANGE } from './constants'
import { hideHighlight, showHighlightAt } from './highlight'
import { getWorldPosition, getWorldRotation } from './worldPosition'

interface FocusableFixture {
  id: number
  worldPosition: Vector3
  worldRotation: Quaternion
  onInteract: (() => void) | undefined
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

/**
 * Registers a fixture as focusable. Resolves the anchor's world position
 * once, immediately — fixtures don't move after scene setup, so there's no
 * need to re-walk the parent chain every frame.
 * @param onInteract optional — omit for fixtures that should highlight but
 *   not respond to the interact button yet.
 */
export function registerFocusableFixture(anchor: Entity, onInteract?: () => void): void {
  fixtures.push({
    id: nextId++,
    worldPosition: getWorldPosition(anchor),
    worldRotation: getWorldRotation(anchor),
    onInteract
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

function pickBestCandidate(candidates: FixtureCandidate[]): FocusableFixture | null {
  if (candidates.length === 0) return null

  const facedCandidates = candidates.filter((c) => c.facingScore >= FACING_THRESHOLD)
  const pool = facedCandidates.length > 0 ? facedCandidates : candidates

  let best = pool[0]
  for (const candidate of pool) {
    if (candidate.distance < best.distance) best = candidate
  }

  return best.fixture
}

function focusSystem(): void {
  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  if (!playerTransform) return

  const playerForward = getPlayerForward(playerTransform.rotation)
  const candidates = getCandidatesInRange(playerTransform.position, playerForward)
  const nearest = pickBestCandidate(candidates)

  if (nearest === null) {
    if (focusedFixtureId !== null) {
      focusedFixtureId = null
      hideHighlight()
    }
  } else if (nearest.id !== focusedFixtureId) {
    focusedFixtureId = nearest.id
    showHighlightAt(nearest.worldPosition, nearest.worldRotation)
  }

  if (focusedFixtureId === null) return

  if (!inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) return

  fixtures.find((f) => f.id === focusedFixtureId)?.onInteract?.()
}
