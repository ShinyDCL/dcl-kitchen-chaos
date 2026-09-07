// Owns the session boundary: a session starts when someone arrives at an
// empty scene, and ends once the scene has been empty for
// SESSION_GRACE_SECONDS. Joining one already running resets nothing.
//
// The reset runs on session START, never on end — a crash, a redeploy or the
// platform's empty-scene shutdown can stop the server before an end would
// fire, so resetting on arrival is what guarantees a clean kitchen.
//
// The grace period only defers that reset; the game keeps running while the
// scene is empty, so orders can still expire and a pan can still burn.

import { engine } from '@dcl/sdk/ecs'

import { SESSION_GRACE_SECONDS } from '../shared/constants'
import { countConnectedPlayers } from './players/presence'

type SessionHandler = () => void

const startHandlers: SessionHandler[] = []
const endHandlers: SessionHandler[] = []

let sessionActive = false
let emptySince: number | null = null // null while anyone is here

export function initSession(): void {
  engine.addSystem(sessionSystem)
}

/** Registers state to clear when a new session begins. Called from each module's init, so every handler exists before the first tick — see init.ts, which starts this module last. */
export function onSessionStart(handler: SessionHandler): void {
  startHandlers.push(handler)
}

/** Registers teardown for once the grace period expires — for discarding what a finished session leaves behind, not for correctness. Anything the game needs to be right belongs in onSessionStart, the one that always runs. */
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

/** Isolated per handler: the transition is already recorded, so one throw would skip the rest with nothing to retry them. */
function run(label: string, handlers: SessionHandler[]): void {
  for (const handler of handlers) {
    try {
      handler()
    } catch (error) {
      console.error(`[server] session: a ${label} handler failed:`, error)
    }
  }
}
