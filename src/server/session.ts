// Owns the session boundary. A session starts clean when someone arrives at
// an empty scene, and ends once the scene has been empty for
// SESSION_GRACE_SECONDS. Without it the kitchen has no beginning: a player
// arriving alone inherits a stranger's difficulty tier and whatever was left
// on the stove.
//
// The reset runs on session START, never on end. A crash, a redeploy, or the
// platform's empty-scene shutdown can all stop the server before an end
// would ever fire, so resetting on arrival is what actually guarantees a
// clean kitchen — it doesn't matter how the last session finished.
//
// The grace period only holds off that reset; the game keeps running while
// the scene is empty. Someone who steps out and comes back inside the window
// may find orders expired and a pan burnt, but their level and their kitchen
// are still there, which is the part worth protecting.
//
// A player joining a session already in progress resets nothing — they join
// a service underway, which is the co-op read and also stops the reset
// becoming a griefing lever.
//
// Modules register what "clean" means for the state they own, same fan-out
// shape as presence.ts's onPlayerLeave.
//
// The end is still worth a hook, for a different job: throwing away entities
// nobody needs any more. That has to happen with the scene empty — deleting
// a synced entity out from under a present player is what clients can't see
// (see syncedStore.ts's clear) — and it costs nothing if it never runs,
// since a server that dies before its session ends frees everything anyway.

import { engine } from '@dcl/sdk/ecs'

import { SESSION_GRACE_SECONDS } from '../shared/constants'
import { countConnectedPlayers } from './players/presence'

type SessionHandler = () => void

const startHandlers: SessionHandler[] = []
const endHandlers: SessionHandler[] = []

let sessionActive = false
let emptySince: number | null = null // client-independent server clock; null while anyone is here

export function initSession(): void {
  engine.addSystem(sessionSystem)
}

/**
 * Registers state to clear when a new session begins. Modules call this from
 * their own init, so every handler is registered before the first tick —
 * see init.ts, which starts this module last.
 */
export function onSessionStart(handler: SessionHandler): void {
  startHandlers.push(handler)
}

/**
 * Registers teardown for once the scene has been empty for the grace period.
 * For discarding what a finished session leaves behind rather than for
 * correctness — anything the game needs to be right belongs in
 * onSessionStart, which is the one that always runs.
 */
export function onSessionEnd(handler: SessionHandler): void {
  endHandlers.push(handler)
}

function sessionSystem(): void {
  if (countConnectedPlayers() > 0) {
    emptySince = null
    if (!sessionActive) startSession()
    return
  }

  if (!sessionActive) return

  if (emptySince === null) {
    emptySince = Date.now()
    return
  }

  if (Date.now() - emptySince >= SESSION_GRACE_SECONDS * 1000) endSession()
}

function startSession(): void {
  sessionActive = true
  run('start', startHandlers)
}

function endSession(): void {
  sessionActive = false
  run('end', endHandlers)
}

/** Each handler is isolated for the same reason init.ts isolates each subsystem: one throw would otherwise skip every later handler, and the transition is already recorded so nothing would retry it. */
function run(label: string, handlers: SessionHandler[]): void {
  for (const handler of handlers) {
    try {
      handler()
    } catch (error) {
      console.error(`[server] session: a ${label} handler failed:`, error)
    }
  }
}
