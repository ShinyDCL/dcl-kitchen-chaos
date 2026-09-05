// Stove cooking state: holding a cookable and interacting starts a timed
// cook — raw model appears, a progress bar fills, smoke runs. When done,
// the model swaps to cooked, a checkmark appears, and smoke stops. Left too
// long, the bar drains back down while shifting toward red; once it empties
// (BURN_GRACE_SECONDS after done) the model swaps to the burnt cookable,
// the checkmark hides, and fire particles start. Collecting works the same
// way in either state — server/fixtures/stove.ts decides which
// model that actually grants — and resets the stove, stopping the fire.
//
// What any of that looks like lives in stoveVisuals.ts; this file decides
// what should be shown and when.
//
// Reconciled against the server-synced StoveState rather than held as
// local truth — see the authoritative-server skill. startCookingOnStove
// renders optimistically (nothing scarce at stake if corrected later).
// collectFromStove renders nothing optimistically: collecting hands out a
// scarce item, and server/fixtures/stove.ts decides who wins a race
// for a finished stove, so this waits for the real outcome via
// reconciliation, same as for every other player's stove.
//
// Progress is derived every frame from `Date.now() - startTimestamp`
// (server clock), so only the start/reset of a cook is ever sent over the
// network, never continuous progress. The done/burnt phase is likewise
// recomputed from elapsed time, not stored, so a late observer (or a
// reconciliation correction) can jump straight to the right one.

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
  startTimestamp: number
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

export type StoveStatus = 'idle' | 'cooking' | 'done'

/** Registers a stove fixture so its state gets rendered and reconciled. Call once per stove during scene setup. */
export function registerStove(stove: Entity): void {
  registeredStoves.push(stove)
  renderedCooks.set(stove, emptyRenderedCook())
  lastSyncedStates.set(stove, { rawModel: '', startTimestamp: 0 })
  stovesById.set(getFixtureSyncId(stove), stove)
}

/**
 * Reads from renderedCooks — this client's current belief, kept correct
 * every frame by tickProgress — rather than a raw live poll of the synced
 * component. interactionRules.ts calls this to decide whether cooking is
 * allowed (drives the focus highlight's color/message); right after this
 * client's own optimistic startCookingOnStove call, a raw poll is briefly
 * stale (the server hasn't processed the intent yet), which would flip the
 * highlight back to "idle" rules for a moment until the real update caught
 * up.
 */
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
    tickProgress(stove)
    tickCheckmarkPop(stove, dt)
  }
}

/**
 * Applies a rawModel/startTimestamp transition, but only when it has
 * actually changed since last observed — not whenever it merely differs
 * from what's rendered. Right after this client's own optimistic
 * startCookingOnStove, a live read is briefly stale; gating on an actual
 * change makes that a no-op instead of a spurious revert-then-reapply
 * flicker.
 *
 * If only startTimestamp changes for the same rawModel, that's this
 * client's optimistic guess being corrected to the server's authoritative
 * value — adopted without tearing down/rebuilding the item entity or bar,
 * since rebuilding caused a visible pop/rewind (most noticeable on
 * mobile's higher latency).
 */
function reconcileTransition(stove: Entity, synced: SyncedCook): void {
  const lastSynced = lastSyncedStates.get(stove) ?? { rawModel: '', startTimestamp: 0 }
  if (synced.rawModel === lastSynced.rawModel && synced.startTimestamp === lastSynced.startTimestamp) return
  lastSyncedStates.set(stove, synced)

  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()

  if (synced.rawModel === rendered.rawModel) {
    if (synced.startTimestamp !== rendered.startTimestamp) {
      renderedCooks.set(stove, { ...rendered, startTimestamp: synced.startTimestamp })
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
 * Continuous per-frame progress, derived purely from what's currently
 * rendered — never from a fresh (possibly stale) synced read.
 *
 * Also recomputes bar visibility every frame (not just on phase
 * transitions), so it restores correctly after an interruption.
 */
function tickProgress(stove: Entity): void {
  const rendered = renderedCooks.get(stove) ?? emptyRenderedCook()
  if (rendered.rawModel === '') return // idle, nothing to advance

  const definition = getCookableItemDefinition(rendered.rawModel)
  if (!definition) return // shouldn't happen — unknown rawModel

  const visuals = getOrCreateVisuals(stove)
  const elapsed = elapsedSeconds(rendered.startTimestamp)
  let phase = rendered.phase

  if (phase === 'cooking') {
    setFill(visuals, Math.min(elapsed / definition.cookDurationSeconds, 1))
    if (elapsed >= definition.cookDurationSeconds) {
      applyDoneVisual(stove, definition)
      phase = 'done'
      renderedCooks.set(stove, { ...rendered, phase })
    }
  } else if (phase === 'done') {
    const burnProgress = Math.min((elapsed - definition.cookDurationSeconds) / BURN_GRACE_SECONDS, 1)
    setDrainFill(visuals, burnProgress) // drains back down instead of staying full
    if (burnProgress >= 1) {
      applyBurntVisual(stove)
      phase = 'burnt'
      renderedCooks.set(stove, { ...rendered, phase })
    }
  }

  setBarVisible(visuals, phase !== 'burnt')
}

/**
 * Runs every frame regardless of idle state (unlike tickProgress) so the
 * checkmark still eases out when a stove goes idle, instead of being cut
 * off by tickProgress's early return.
 */
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
  renderedCooks.set(stove, { rawModel: synced.rawModel, startTimestamp: synced.startTimestamp, phase })
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
  return { rawModel: '', startTimestamp: 0, phase: 'cooking' }
}
