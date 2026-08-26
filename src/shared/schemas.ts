// Synced component definitions shared between client and server — see the
// authoritative-server skill. Definitions themselves must run on both sides
// (the client needs the componentId/type to read synced data), but
// validateBeforeChange calls are server-only and throw if called on a
// client, so each is gated behind isServer().

import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

/**
 * One entity per player who has held something this session. `models` is
 * the full stack currently in that player's hand, bottom to top — empty
 * means empty-handed. Entities are matched by the `playerId` field (a
 * lower-cased wallet address), never by network/sync id — see the
 * authoritative-server skill's per-player synced entity pattern.
 */
export const HeldItem = engine.defineComponent('game::HeldItem', {
  playerId: Schemas.String,
  models: Schemas.Array(Schemas.String)
})

if (isServer()) {
  HeldItem.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

/**
 * One entity per preparation counter — plate presence and the ingredient
 * stack on top of it. `counterId` is the counter's stable fixture sync id
 * (client/fixtures.ts's getFixtureSyncId) and doubles as this entity's
 * explicit syncEntity id: counters are a small fixed set that exists for
 * the scene's whole life, unlike per-player entities, so there's no need
 * for the auto-allocate-and-match-by-field pattern HeldItem uses.
 */
export const PreparationCounterState = engine.defineComponent('game::PreparationCounterState', {
  counterId: Schemas.Int,
  hasPlate: Schemas.Boolean,
  ingredientModels: Schemas.Array(Schemas.String)
})

if (isServer()) {
  PreparationCounterState.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

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

if (isServer()) {
  StoveState.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

/**
 * Singleton — the scene only ever creates one delivery counter (see
 * client/sceneLayout.ts). `models` is what was last delivered (bottom to
 * top), empty meaning nothing to show right now. `startTimestamp` (server
 * clock, ms) is when that delivery landed; every client derives both the
 * item sit/shrink animation and the checkmark flourish from
 * `Date.now() - startTimestamp`, the same reasoning as StoveState, so
 * there's no separate phase/progress field to keep in sync.
 */
export const DeliveryState = engine.defineComponent('game::DeliveryState', {
  models: Schemas.Array(Schemas.String),
  startTimestamp: Schemas.Int64
})

if (isServer()) {
  DeliveryState.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

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

if (isServer()) {
  PlayerRole.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

// Reserved sync id for GameState, the one non-fixture singleton — kept well
// clear of client/fixtures.ts's contiguous-from-0 fixture id space so it
// can never collide no matter how many fixtures the scene grows to.
export const GAME_STATE_SYNC_ID = 100000

/**
 * Singleton — how many currently-connected players are in the 'play' role.
 * Server-derived each tick from live PlayerIdentityData (the engine's own
 * view of who's actually connected) intersected with PlayerRole, so a
 * disconnect is reflected for free with no explicit leave message needed.
 */
export const GameState = engine.defineComponent('game::GameState', {
  activePlayerCount: Schemas.Int
})

if (isServer()) {
  GameState.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}
