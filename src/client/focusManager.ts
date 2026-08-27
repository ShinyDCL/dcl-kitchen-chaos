// Tracks all interactable fixtures and, every frame, focuses the single
// nearest one within INTERACTION_RANGE, preferring one the player is
// roughly facing (FACING_THRESHOLD) when several are in range.
//
// A focused fixture's `evaluate` callback re-runs every frame, not just on
// focus change — its InteractionResult can change while still looking at
// it (e.g. picking something up changes whether cooking is now allowed).
// On interact: `perform` runs if allowed, otherwise `message` shows via
// the on-screen message UI.
//
// Spectators are gated out here (isLocalPlayerPlaying) rather than
// per-fixture in interactionRules.ts, so one check covers every kind.
// Rendering (held items, counter/stove/delivery visuals) reconciles from
// synced state regardless of role, so it's unaffected.

import { engine, Entity, InputAction, inputSystem, PointerEventType, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FACING_THRESHOLD, INTERACTION_RANGE } from '../shared/constants'
import { showMessage } from './fixtureMessage'
import { hideHighlight, setHighlightAllowed, showHighlightAt } from './highlight'
import { InteractionResult } from './interactionRules'
import { isLocalPlayerPlaying } from './playerRoleState'
import { getWorldPosition, getWorldRotation } from './worldPosition'

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
  if (!isLocalPlayerPlaying()) {
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
  const nearest = pickBestCandidate(candidates)

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
  } else if (result.message) {
    showMessage(result.message, nearest.worldPosition)
  }
}
