// Stove cooking state: what should be shown and when. What it looks like
// lives in stoveVisuals.ts.
//
// Reconciled against the synced StoveState rather than held as local truth.
// startCookingOnStove renders optimistically — nothing scarce is at stake if
// it gets corrected. collectFromStove renders nothing: it hands out a scarce
// item and the server decides who wins a race for a finished stove, so this
// waits for the real outcome.
//
// Progress derives every frame from `Date.now() - startTimestamp` (server
// clock), so only a cook's start and reset cross the network. Done and burnt
// are recomputed from elapsed time too, so a late observer jumps straight to
// the right phase.

import { engine, Entity } from '@dcl/sdk/ecs'
import { getPlatform } from '@dcl/sdk/platform'

import { BURN_GRACE_SECONDS } from '../../../shared/constants'
import { CookableIngredientDefinition, getCookableItemDefinition } from '../../../shared/ingredients'
import { room } from '../../../shared/messages'
import { MODELS } from '../../../shared/models'
import { StoveState } from '../../../shared/schemas'
import { serverNow } from '../../serverReadiness'
import { takeHeldItemPending } from '../heldItems'
import { getFixtureSyncId } from './fixture'
import {
  clearStoveItem,
  getOrCreateVisuals,
  resetProgressBar,
  setBarVisible,
  setDrainFill,
  setFill,
  setFireActive,
  setSmokeActive,
  showStoveItem,
  swapStoveItemModel,
  tickCheckmark
} from './stoveVisuals'

type CookPhase = 'cooking' | 'done' | 'burnt'

interface RenderedCook {
  rawModel: string // '' means idle — mirrors the synced field this is reconciled against
  startTimestamp: number // what the bar is drawn from; slides toward targetStartTimestamp
  targetStartTimestamp: number // the server's authoritative start, once it has arrived
  phase: CookPhase // local-only: how far the done/burnt transition has progressed
}

interface SyncedCook {
  rawModel: string
  startTimestamp: number
}

const renderedCooks = new Map<Entity, RenderedCook>()
const lastSyncedStates = new Map<Entity, SyncedCook>()
const registeredStoves: Entity[] = []
const stovesById = new Map<number, Entity>() // avoids an O(stoves × synced entities) scan every frame

type StoveStatus = 'idle' | 'cooking' | 'done'

/** Registers a stove fixture so its state gets rendered and reconciled. Call once per stove during scene setup. */
export function registerStove(stove: Entity): void {
  registeredStoves.push(stove)
  renderedCooks.set(stove, emptyRenderedCook())
  lastSyncedStates.set(stove, { rawModel: '', startTimestamp: 0 })
  stovesById.set(getFixtureSyncId(stove), stove)
}

/** Reads renderedCooks — this client's belief, kept current by tickProgress — rather than a live poll, which is briefly stale right after an optimistic start and would flip the highlight back to idle rules. */
export function getStoveStatus(stove: Entity): StoveStatus {
  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()
  if (rendered.rawModel === '') return 'idle'
  // 'done' and 'burnt' are the same as far as interactionRules.ts is
  // concerned — collecting is allowed either way, just for a different
  // model — so both map to the public 'done' status.
  return rendered.phase === 'cooking' ? 'cooking' : 'done'
}

export function startCookingOnStove(stove: Entity, definition: CookableIngredientDefinition): void {
  takeHeldItemPending()
  void room.send('startCookingOnStove', { stoveId: getFixtureSyncId(stove), rawModel: definition.heldModel })
  applySyncedState(stove, { rawModel: definition.heldModel, startTimestamp: serverNow() })
}

/** Sends the collect intent to the server. Deliberately renders nothing optimistically — see the module comment. */
export function collectFromStove(stove: Entity): void {
  void room.send('collectFromStove', { stoveId: getFixtureSyncId(stove) })
}

// Reused every frame instead of allocating a fresh Map — safe since callers only read it synchronously within the same tick.
const syncedStatesScratch = new Map<Entity, SyncedCook>()

/** One pass over every synced StoveState, keyed by the local stove entity — avoids an O(stoves × synced entities) scan per stove. */
function getSyncedStates(): Map<Entity, SyncedCook> {
  syncedStatesScratch.clear()
  for (const [, data] of engine.getEntitiesWith(StoveState)) {
    const stove = stovesById.get(data.stoveId)
    if (stove) syncedStatesScratch.set(stove, { rawModel: data.rawModel, startTimestamp: Number(data.startTimestamp) })
  }
  return syncedStatesScratch
}

function elapsedSeconds(startTimestamp: number): number {
  return (serverNow() - startTimestamp) / 1000
}

// --- Rendering, reconciled against the synced StoveState component ---

let systemRegistered = false

/** Reconciles every registered stove's synced state against what's currently rendered. Call once during client setup. */
export function startRenderingStoves(): void {
  if (systemRegistered) return
  engine.addSystem(stoveCookingSystem)
  engine.addSystem(prebuildVisualsOnceReady)
  systemRegistered = true
}

// Builds progress bars here rather than in registerStove, since isMobile()
// reads false until getPlatform() resolves — building immediately at scene
// setup would always bake in the desktop scale/facing.
function prebuildVisualsOnceReady(): void {
  if (getPlatform() === null) return
  engine.removeSystem(prebuildVisualsOnceReady)
  for (const stove of registeredStoves) getOrCreateVisuals(stove)
}

function stoveCookingSystem(dt: number): void {
  const synced = getSyncedStates()
  for (const stove of registeredStoves) {
    reconcileTransition(stove, synced.get(stove) ?? { rawModel: '', startTimestamp: 0 })
    tickProgress(stove, dt)
    tickCheckmarkPop(stove, dt)
  }
}

/**
 * Applies a transition only when the synced value has actually changed since
 * last observed — a live read is briefly stale right after an optimistic
 * start, and reacting to that would flicker.
 *
 * A startTimestamp change alone is this client's guess being corrected, so it
 * is adopted as a target for slideTowardTarget rather than applied outright.
 */
function reconcileTransition(stove: Entity, synced: SyncedCook): void {
  const lastSynced = lastSyncedStates.get(stove) ?? { rawModel: '', startTimestamp: 0 }
  if (synced.rawModel === lastSynced.rawModel && synced.startTimestamp === lastSynced.startTimestamp) return
  lastSyncedStates.set(stove, synced)

  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()

  if (synced.rawModel === rendered.rawModel) {
    if (synced.startTimestamp !== rendered.targetStartTimestamp) {
      // Recorded as a target only — tickProgress spreads it over the rest of
      // the cook rather than snapping the bar backwards.
      renderedCooks.set(stove, { ...rendered, targetStartTimestamp: synced.startTimestamp })
    }
    return
  }

  applySyncedState(stove, synced)
}

/** Which phase a cook is in, purely from elapsed time — the same rule tickProgress steps through incrementally and applySyncedState jumps to directly for a late observer. */
function computePhase(elapsedSecondsValue: number, definition: CookableIngredientDefinition): CookPhase {
  if (elapsedSecondsValue < definition.cookDurationSeconds) return 'cooking'
  if (elapsedSecondsValue < definition.cookDurationSeconds + BURN_GRACE_SECONDS) return 'done'
  return 'burnt'
}

/**
 * Per-frame progress from what is currently rendered, never a fresh synced
 * read. Bar visibility is recomputed every frame so it restores after an
 * interruption.
 */
function tickProgress(stove: Entity, dt: number): void {
  const stored = renderedCooks.get(stove) ?? emptyRenderedCook()
  if (stored.rawModel === '') return // idle, nothing to advance

  const definition = getCookableItemDefinition(stored.rawModel)
  if (!definition) return // shouldn't happen — unknown rawModel

  const rendered: RenderedCook = { ...stored, startTimestamp: slideTowardTarget(stored, definition, dt) }

  const visuals = getOrCreateVisuals(stove)
  const elapsed = elapsedSeconds(rendered.startTimestamp)
  let phase = rendered.phase

  if (phase === 'cooking') {
    setFill(visuals, Math.min(elapsed / definition.cookDurationSeconds, 1))
    if (elapsed >= definition.cookDurationSeconds) {
      applyDoneVisual(stove, definition)
      phase = 'done'
    }
  } else if (phase === 'done') {
    const burnProgress = Math.min((elapsed - definition.cookDurationSeconds) / BURN_GRACE_SECONDS, 1)
    setDrainFill(visuals, burnProgress) // drains back down instead of staying full
    if (burnProgress >= 1) {
      applyBurntVisual(stove)
      phase = 'burnt'
    }
  }

  renderedCooks.set(stove, { ...rendered, phase })
  setBarVisible(visuals, phase !== 'burnt')
}

/**
 * Walks the rendered start toward the server's, spread across the rest of the
 * cook. The optimistic guess is always early (the server stamps on arrival,
 * and serverNow() trails by the heartbeat's own trip), so adopting it outright
 * rewinds the bar — ~240ms locally, which reads as a reset.
 *
 * Stepping by drift × dt / remaining holds drift/remaining constant, so the
 * slide lands exactly at completion. That keeps elapsed reaching
 * cookDurationSeconds precisely when the server says it does, never before —
 * the server ignores a collect sent early.
 */
function slideTowardTarget(rendered: RenderedCook, definition: CookableIngredientDefinition, dt: number): number {
  const drift = rendered.targetStartTimestamp - rendered.startTimestamp
  if (drift === 0) return rendered.startTimestamp

  const doneAt = rendered.targetStartTimestamp + definition.cookDurationSeconds * 1000
  const remainingMs = doneAt - serverNow()
  if (remainingMs <= 0) return rendered.targetStartTimestamp // no cook left to hide it in

  const stepMs = (drift * dt * 1000) / remainingMs
  if (Math.abs(stepMs) >= Math.abs(drift)) return rendered.targetStartTimestamp

  return rendered.startTimestamp + stepMs
}

/** Runs even while idle (unlike tickProgress) so the checkmark still eases out after a stove goes idle. */
function tickCheckmarkPop(stove: Entity, dt: number): void {
  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()
  const visuals = getOrCreateVisuals(stove)

  tickCheckmark(visuals, rendered.rawModel !== '' && rendered.phase === 'done', dt)
}

/** Applies a rawModel/startTimestamp change (idle->cooking or any->idle) to this stove's visuals. */
function applySyncedState(stove: Entity, synced: SyncedCook): void {
  const visuals = getOrCreateVisuals(stove)

  if (synced.rawModel === '') {
    clearStoveItem(visuals)
    // tickProgress owns bar visibility but early-returns while idle, so
    // it never re-runs to hide the bar — this is the one place that does.
    setBarVisible(visuals, false)
    setSmokeActive(visuals, false)
    setFireActive(visuals, false)
    renderedCooks.set(stove, emptyRenderedCook())
    return
  }

  const definition = getCookableItemDefinition(synced.rawModel)
  showStoveItem(visuals, definition?.stoveModel ?? synced.rawModel)

  // Seed the true elapsed progress right away instead of always starting
  // at 0 and correcting next tick — otherwise a late observer sees a
  // 0% flash before jumping to the real value.
  const elapsed = elapsedSeconds(synced.startTimestamp)
  resetProgressBar(visuals, definition ? Math.min(elapsed / definition.cookDurationSeconds, 1) : 0)
  setSmokeActive(visuals, true)

  const phase: CookPhase = definition ? computePhase(elapsed, definition) : 'cooking'
  renderedCooks.set(stove, {
    rawModel: synced.rawModel,
    startTimestamp: synced.startTimestamp,
    targetStartTimestamp: synced.startTimestamp,
    phase
  })
  if (phase === 'done' && definition) applyDoneVisual(stove, definition)
  if (phase === 'burnt') applyBurntVisual(stove)
}

/** Bar visibility is owned by tickProgress, checkmark's by tickCheckmarkPop — both called right after this. */
function applyDoneVisual(stove: Entity, definition: CookableIngredientDefinition): void {
  const visuals = getOrCreateVisuals(stove)
  swapStoveItemModel(visuals, definition.cookedModel)
  setSmokeActive(visuals, false)
}

/** Neglected too long — burnt model, fire replaces smoke. Visibility owned by tickProgress/tickCheckmarkPop. */
function applyBurntVisual(stove: Entity): void {
  const visuals = getOrCreateVisuals(stove)
  swapStoveItemModel(visuals, MODELS.burntCookable)
  setFireActive(visuals, true)
}

function emptyRenderedCook(): RenderedCook {
  return { rawModel: '', startTimestamp: 0, targetStartTimestamp: 0, phase: 'cooking' }
}
