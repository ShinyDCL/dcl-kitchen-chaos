// Synced component definitions shared between client and server — see the
// authoritative-server skill. Definitions themselves must run on both sides
// (the client needs the componentId/type to read synced data), but
// validateBeforeChange calls are server-only and throw if called on a
// client, so each is gated behind isServer().

import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// Minimal structural type — every synced component below satisfies this,
// so this doesn't need to import the SDK's own component definition type.
type ServerOnlyComponent = {
  validateBeforeChange: (cb: (value: { senderAddress: string }) => boolean) => void
}

/** Every component here is server-owned: only the auth server may write it. Call once per component, right after defining it. */
function lockToServer(component: ServerOnlyComponent): void {
  if (isServer()) {
    component.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)
  }
}

// Explicit sync ids for the non-fixture singletons, clear of fixture.ts's
// separate 0-based id space. Everything else derives its id from a fixture
// or needs none, matching on a field instead.
export const GAME_STATE_SYNC_ID = 100000
export const LEADERBOARD_SYNC_ID = 100001

/**
 * One entity per player who has held something this session; `models` is the
 * stack in hand, bottom to top. Matched by `playerId`, never by network id —
 * see the authoritative-server skill's per-player synced entity pattern.
 */
export const HeldItem = engine.defineComponent('game::HeldItem', {
  playerId: Schemas.String,
  models: Schemas.Array(Schemas.String)
})

lockToServer(HeldItem)

/**
 * One entity per preparation counter — the stack placed on it, bottom to top.
 * `counterId` (fixture.ts's getFixtureSyncId) doubles as the explicit sync id:
 * counters are a fixed set for the scene's life, so no match-by-field needed.
 */
export const PreparationCounterState = engine.defineComponent('game::PreparationCounterState', {
  counterId: Schemas.Int,
  ingredientModels: Schemas.Array(Schemas.String)
})

lockToServer(PreparationCounterState)

/**
 * One entity per stove. `rawModel` is '' while idle, else the cookable's
 * heldModel key (shared/ingredients.ts) — cookedModel and duration are looked
 * up from it, never sent. `startTimestamp` (server clock) is the cook start;
 * clients derive progress from it rather than a per-tick synced counter.
 * `stoveId` doubles as the explicit sync id.
 */
export const StoveState = engine.defineComponent('game::StoveState', {
  stoveId: Schemas.Int,
  rawModel: Schemas.String,
  startTimestamp: Schemas.Int64
})

lockToServer(StoveState)

/**
 * Singleton — one delivery counter exists (see client/scene/layout.ts).
 * `models` is what was last delivered, `success` picks the mark, and each
 * client animates on its own timer when `deliveryId` changes. That counter is
 * bumped per delivery because two in a row can carry identical models and
 * success, which content-diffing cannot tell from a stale read.
 */
export const DeliveryState = engine.defineComponent('game::DeliveryState', {
  models: Schemas.Array(Schemas.String),
  success: Schemas.Boolean,
  deliveryId: Schemas.Int
})

lockToServer(DeliveryState)

/**
 * Singleton. `playerCount` and `deliveries` are session-scoped and cleared by
 * server/session.ts; the figures that outlive a session live in PlayerCoins
 * and Leaderboard. `streak` resets to 0 on a miss (orderQueue.ts).
 * `serverHeartbeatAt` is pulsed so clients can tell the server is alive, not
 * merely that the room is connected — see the skill's Server Lifecycle section.
 */
// Schemas.Map serializes positionally — no field names, no length prefixes
// — so field ORDER is the wire format. Only ever append new fields at the
// end: inserting one shifts every field after it, and a snapshot written by
// an older build then deserializes misaligned.
export const GameState = engine.defineComponent('game::GameState', {
  playerCount: Schemas.Int,
  streak: Schemas.Int,
  serverHeartbeatAt: Schemas.Int64,
  deliveries: Schemas.Int
})

lockToServer(GameState)

/**
 * One entity per connected player, matched by `playerId` like HeldItem. Not
 * created until the stored total loads, so the HUD never shows a 0 that jumps.
 * `lifetimeCoins` only grows — if coins become spendable, add `spentCoins` and
 * derive the balance, or the leaderboard's ranking breaks.
 */
export const PlayerCoins = engine.defineComponent('game::PlayerCoins', {
  playerId: Schemas.String,
  lifetimeCoins: Schemas.Int
})

lockToServer(PlayerCoins)

/**
 * Singleton — the top LEADERBOARD_SIZE by lifetime coins, sorted by the server.
 * Includes offline players, which is why it cannot be derived from PlayerCoins
 * above. `name` is captured on write, since coins only change while a player is
 * connected and resolvable. `version` is bumped per publish so a client detects
 * a change with one integer compare.
 *
 * An entry carries only what the board draws. The server keys its own rows by
 * address, but syncing that would hand every client the wallet of a player who
 * isn't even in the scene.
 */
export const Leaderboard = engine.defineComponent('game::Leaderboard', {
  version: Schemas.Int,
  entries: Schemas.Array(
    Schemas.Map({
      name: Schemas.String,
      lifetimeCoins: Schemas.Int
    })
  )
})

lockToServer(Leaderboard)

/**
 * One entity per active order, matched by `orderNumber` (unique within a
 * session). `recipeId` looks up shared/recipes.ts; `generatedAt` (server
 * clock) drives the HUD countdown.
 *
 * `expiredAt` and `deliveredAt` are both 0 while the order is live, and at
 * most one is ever set — whichever resolved it. The entity is kept either way
 * for the result display, so both result cards are state the client is handed
 * rather than a deadline it must catch. `deliveredByName` is stamped alongside
 * `deliveredAt` and stays empty otherwise.
 */
export const OrderState = engine.defineComponent('game::OrderState', {
  orderNumber: Schemas.Int,
  recipeId: Schemas.String,
  generatedAt: Schemas.Int64,
  expiredAt: Schemas.Int64,
  deliveredAt: Schemas.Int64,
  deliveredByName: Schemas.String
})

lockToServer(OrderState)
