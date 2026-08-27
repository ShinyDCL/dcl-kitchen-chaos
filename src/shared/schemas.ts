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

// Reserved explicit sync ids for the scene's non-fixture singletons/fixed
// sets (GameState, the recipe queue slots) — contiguous from 100000, well
// clear of client/fixtures.ts's separate 0-based, dynamically-sized
// fixture id space, so neither can ever collide no matter how large the
// scene's fixture count grows. Every other component below either derives
// its id from a fixture (PreparationCounterState, StoveState,
// DeliveryState) or needs no explicit id at all (per-player components,
// matched by playerId instead).
export const GAME_STATE_SYNC_ID = 100000
export const RECIPE_SLOT_SYNC_ID_BASE = 100001 // + slotIndex, one id per MAX_QUEUE_SIZE slot

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
 * One entity per preparation counter — plate presence and the ingredient
 * stack on top of it. `counterId` (client/fixtures.ts's getFixtureSyncId)
 * doubles as this entity's explicit syncEntity id: counters are a small
 * fixed set for the scene's whole life, unlike per-player entities, so
 * there's no need for HeldItem's auto-allocate-and-match-by-field pattern.
 */
export const PreparationCounterState = engine.defineComponent('game::PreparationCounterState', {
  counterId: Schemas.Int,
  hasPlate: Schemas.Boolean,
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
 * client/sceneLayout.ts). `models` is what was last delivered (bottom to
 * top), empty meaning nothing to show right now. `startTimestamp` (server
 * clock, ms) is when that delivery landed; every client derives the item
 * sit/shrink animation and the checkmark/crossmark flourish from
 * `Date.now() - startTimestamp`. `success` (see recipeQueue.ts) picks
 * checkmark vs crossmark.
 */
export const DeliveryState = engine.defineComponent('game::DeliveryState', {
  models: Schemas.Array(Schemas.String),
  startTimestamp: Schemas.Int64,
  success: Schemas.Boolean
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
 * on a miss — see recipeQueue.ts.
 */
export const GameState = engine.defineComponent('game::GameState', {
  activePlayerCount: Schemas.Int,
  streak: Schemas.Int
})

lockToServer(GameState)

/** One entity per player's coin balance, matched by `playerId` like HeldItem/PlayerRole. Session-only — no Storage persistence yet. */
export const PlayerCoins = engine.defineComponent('game::PlayerCoins', {
  playerId: Schemas.String,
  coins: Schemas.Int
})

lockToServer(PlayerCoins)

/**
 * One entity per recipe queue slot (a fixed set — MAX_QUEUE_SIZE — same
 * explicit-id pattern as PreparationCounterState). `active` is toggled by
 * recipeQueue.ts; `recipeId` looks up shared/recipes.ts (inactive slots
 * leave it '' and clients skip rendering); `generatedAt` (server clock,
 * ms) drives the HUD's countdown. A delivery advances the slot
 * immediately — the HUD's success celebration is timed client-side off
 * the recipeDelivered broadcast, not a field on this component.
 */
export const RecipeSlotState = engine.defineComponent('game::RecipeSlotState', {
  slotIndex: Schemas.Int,
  active: Schemas.Boolean,
  recipeId: Schemas.String,
  generatedAt: Schemas.Int64
})

lockToServer(RecipeSlotState)
