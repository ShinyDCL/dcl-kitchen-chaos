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

// Reserved explicit sync ids for the scene's non-fixture singletons — clear
// of fixtures.ts's separate 0-based fixture id space so neither can ever
// collide. Every other component below either derives its id from a
// fixture, or needs no explicit id at all (matched by a field instead —
// playerId, orderNumber).
export const GAME_STATE_SYNC_ID = 100000
export const LEADERBOARD_SYNC_ID = 100001

/**
 * One entity per player who has held something this session. `models` is
 * the full stack in hand, bottom to top — empty means empty-handed.
 * Matched by the `playerId` field (a lower-cased wallet address), never by
 * network/sync id — see the authoritative-server skill's per-player
 * synced entity pattern.
 */
export const HeldItem = engine.defineComponent('game::HeldItem', {
  playerId: Schemas.String,
  models: Schemas.Array(Schemas.String)
})

lockToServer(HeldItem)

/**
 * One entity per preparation counter — the stack of models placed on it,
 * bottom to top. A plate is just another model in this stack now, not a
 * separate precondition (see server/fixtures/preparationCounters.ts).
 * `counterId` (client/fixtures/fixtures.ts's getFixtureSyncId) doubles as
 * this entity's explicit syncEntity id: counters are a small fixed set for
 * the scene's whole life, unlike per-player entities, so there's no need
 * for HeldItem's auto-allocate-and-match-by-field pattern.
 */
export const PreparationCounterState = engine.defineComponent('game::PreparationCounterState', {
  counterId: Schemas.Int,
  ingredientModels: Schemas.Array(Schemas.String)
})

lockToServer(PreparationCounterState)

/**
 * One entity per stove. `rawModel` is '' while idle, otherwise the
 * CookableIngredientDefinition.heldModel key (shared/ingredients.ts) for
 * whatever's cooking — cookedModel/cookDurationSeconds are looked up from
 * that, never sent over the wire. `startTimestamp` (server clock, ms) is
 * when the cook began; every client derives progress/done-ness from
 * `Date.now() - startTimestamp` locally instead of a per-tick synced
 * counter. `stoveId` doubles as this entity's explicit syncEntity id, same
 * reasoning as PreparationCounterState's counterId.
 */
export const StoveState = engine.defineComponent('game::StoveState', {
  stoveId: Schemas.Int,
  rawModel: Schemas.String,
  startTimestamp: Schemas.Int64
})

lockToServer(StoveState)

/**
 * Singleton — the scene only ever creates one delivery counter (see
 * client/fixtures/sceneLayout.ts). `models` is what was last delivered
 * (bottom to top), empty meaning nothing to show. Each client animates the
 * item and the checkmark/crossmark on its own local timer, started when it
 * observes a `deliveryId` change. `success` (see orderQueue.ts) picks the
 * mark. `deliveryId` is bumped by the server on every resolved delivery —
 * needed because two deliveries in a row can have identical `models`/
 * `success`, which content-diffing alone can't tell apart from a stale read.
 */
export const DeliveryState = engine.defineComponent('game::DeliveryState', {
  models: Schemas.Array(Schemas.String),
  success: Schemas.Boolean,
  deliveryId: Schemas.Int
})

lockToServer(DeliveryState)

export enum PlayerRoleValue {
  Play = 'play',
  Spectate = 'spectate'
}

/**
 * One entity per player who has picked a role this session, matched by the
 * `playerId` field — same per-player pattern as HeldItem, and for the same
 * reason (an explicit/hashed sync id is unsafe on a long-running server). A
 * player has no entity at all until they've made a choice; server code
 * treats that as not-yet-decided rather than defaulting to either role.
 */
export const PlayerRole = engine.defineComponent('game::PlayerRole', {
  playerId: Schemas.String,
  role: Schemas.EnumString(PlayerRoleValue, PlayerRoleValue.Spectate)
})

lockToServer(PlayerRole)

/**
 * Singleton. `activePlayerCount` is currently-connected 'play'-role
 * players, recomputed each tick so a disconnect is reflected for free.
 * `streak` counts consecutive successful deliveries scene-wide, reset to 0
 * on a miss — see orderQueue.ts. `totalDeliveredOrders` is the all-time
 * count, persisted by server/deliveryStats.ts, so unlike `streak` it
 * survives restarts. `serverHeartbeatAt` (server clock, ms) is pulsed
 * periodically so clients can tell the server is actually alive, not just
 * that the CRDT room is connected — see
 * client/serverReadiness.ts and the authoritative-server skill's Server
 * Lifecycle section.
 */
export const GameState = engine.defineComponent('game::GameState', {
  activePlayerCount: Schemas.Int,
  streak: Schemas.Int,
  totalDeliveredOrders: Schemas.Int,
  serverHeartbeatAt: Schemas.Int64
})

lockToServer(GameState)

/**
 * One entity per connected player's coin total, matched by `playerId` like
 * HeldItem/PlayerRole. Created only once server/playerCoins.ts has loaded
 * the stored total, so the HUD never shows a 0 that then jumps.
 * `lifetimeCoins` is only ever added to — if coins ever become spendable,
 * add a separate `spentCoins` and derive the balance, or the leaderboard's
 * lifetime ranking breaks.
 */
export const PlayerCoins = engine.defineComponent('game::PlayerCoins', {
  playerId: Schemas.String,
  lifetimeCoins: Schemas.Int
})

lockToServer(PlayerCoins)

/**
 * Singleton — the top LEADERBOARD_SIZE players by lifetime coins, sorted
 * descending by the server (see server/leaderboard.ts). Includes offline
 * players, which is why it can't be derived from the PlayerCoins entities
 * above (those exist only for connected players). `name` is captured
 * whenever an entry is written, since coins only change while a player is
 * connected and resolvable. `version` is bumped on every publish so a
 * client can detect a change with one integer compare instead of diffing —
 * same trick as DeliveryState's deliveryId.
 */
export const Leaderboard = engine.defineComponent('game::Leaderboard', {
  version: Schemas.Int,
  entries: Schemas.Array(
    Schemas.Map({
      playerId: Schemas.String,
      name: Schemas.String,
      lifetimeCoins: Schemas.Int
    })
  )
})

lockToServer(Leaderboard)

/**
 * One entity per currently-active order — created on generation, destroyed
 * on resolution (delivered or expired). No fixed slot count; live count vs.
 * target queue size is the whole model (see orderQueue.ts). Matched by
 * `orderNumber` (a session-wide ticket counter, never reused), same
 * per-entity-field-matching reasoning as HeldItem/PlayerRole's playerId.
 * `recipeId` looks up shared/recipes.ts; `generatedAt` (server clock, ms)
 * drives the HUD's countdown. Delivery result display is timed off the
 * orderDelivered broadcast; timing out is detected and timed purely from
 * generatedAt/timerSeconds, no broadcast — see ordersUi.tsx's getActiveOrders.
 */
export const OrderState = engine.defineComponent('game::OrderState', {
  orderNumber: Schemas.Int,
  recipeId: Schemas.String,
  generatedAt: Schemas.Int64
})

lockToServer(OrderState)
