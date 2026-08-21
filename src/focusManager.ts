// Tracks all interactable counters and, every frame, focuses the single
// nearest one within INTERACTION_RANGE. When multiple counters are in range
// at once, prefers the one the player is roughly facing over pure nearest-
// distance, using a dot-product check rather than an actual raycast — no
// precise aim required, which matters for mobile touch controls.
// Also listens for the "interact" button (E on desktop, primary action
// button on mobile) and fires the focused counter's callback when pressed.
//
// This is the ONLY system registered for the pickup feature — a single
// engine.addSystem call handles proximity, facing, and input for every counter.

import { engine, Entity, InputAction, inputSystem, PointerEventType, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FACING_THRESHOLD, INTERACTION_RANGE } from './constants'
import { hideHighlight, showHighlightAt } from './highlight'
import { getWorldPosition } from './worldPosition'

interface FocusableCounter {
  id: number
  worldPosition: Vector3 // resolved once at registration — counters are static
  onInteract: () => void
}

interface CounterCandidate {
  counter: FocusableCounter
  distance: number
  facingScore: number
}

const counters: FocusableCounter[] = []
let nextId = 0
let focusedCounterId: number | null = null
let systemRegistered = false

/**
 * Registers a counter as interactable. Resolves the anchor's world position
 * once, immediately — counters don't move after scene setup, so there's no
 * need to re-walk the parent chain every frame.
 */
export function registerFocusableCounter(anchor: Entity, onInteract: () => void): void {
  counters.push({ id: nextId++, worldPosition: getWorldPosition(anchor), onInteract })
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

function getCandidatesInRange(playerPosition: Vector3, playerForward: Vector3): CounterCandidate[] {
  const candidates: CounterCandidate[] = []

  for (const counter of counters) {
    const distance = Vector3.distance(playerPosition, counter.worldPosition)
    if (distance > INTERACTION_RANGE) continue

    const directionToCounter = Vector3.normalize(Vector3.subtract(counter.worldPosition, playerPosition))
    const facingScore = Vector3.dot(playerForward, directionToCounter)

    candidates.push({ counter, distance, facingScore })
  }

  return candidates
}

function pickBestCandidate(candidates: CounterCandidate[]): FocusableCounter | null {
  if (candidates.length === 0) return null

  const facedCandidates = candidates.filter((c) => c.facingScore >= FACING_THRESHOLD)
  const pool = facedCandidates.length > 0 ? facedCandidates : candidates

  let best = pool[0]
  for (const candidate of pool) {
    if (candidate.distance < best.distance) best = candidate
  }

  return best.counter
}

function focusSystem(): void {
  const playerTransform = Transform.getOrNull(engine.PlayerEntity)
  if (!playerTransform) return

  const playerForward = getPlayerForward(playerTransform.rotation)
  const candidates = getCandidatesInRange(playerTransform.position, playerForward)
  const nearest = pickBestCandidate(candidates)

  if (nearest === null) {
    if (focusedCounterId !== null) {
      focusedCounterId = null
      hideHighlight()
    }
  } else if (nearest.id !== focusedCounterId) {
    focusedCounterId = nearest.id
    showHighlightAt(nearest.worldPosition)
  }

  if (focusedCounterId === null) return

  if (!inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) return

  counters.find((c) => c.id === focusedCounterId)?.onInteract()
}
