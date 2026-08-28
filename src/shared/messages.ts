// Client -> server intent messages. See the authoritative-server skill for
// the module-load timing rule: registerMessages() must run during initial
// module load, reached via a static `import './shared/messages'` at the
// top of index.ts rather than a dynamic import inside main().

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

import { PlayerRoleValue } from './schemas'

export const Messages = {
  // Sent when a player picks Play/Spectate from the entry menu, or later
  // switches roles. See server/playerRoster.ts.
  setPlayerRole: Schemas.Map({ role: Schemas.EnumString(PlayerRoleValue, PlayerRoleValue.Spectate) }),

  // The full stack now in the sender's hand, bottom to top; empty means
  // empty-handed. Only for actions with no paired fixture-side legality
  // check (ingredient pickups, trash discard) — actions contested by a
  // counter/stove instead grant/clear the hand from that fixture message's
  // own handler, with actionRejected as the rollback (see heldItem.ts's
  // takeHeldItemPending).
  setHeldItem: Schemas.Map({ models: Schemas.Array(Schemas.String) }),

  // Server -> sender only: their fixture intent (placing, starting a cook)
  // was rejected because someone else's action landed first. Restores
  // whatever was optimistically taken out of hand — see heldItem.ts's
  // takeHeldItemPending/restorePendingHeldItem.
  actionRejected: Schemas.Map({}),

  // Preparation counter intents. Each names the specific change rather
  // than asserting the counter's whole new contents, so the server can
  // apply it atomically against its own live state — see
  // server/preparationCounters.ts. This is what stops two players placing
  // different ingredients on the same counter at once from clobbering each
  // other: both used to compute their "new full state" from the same
  // stale synced snapshot and push it wholesale, so whichever message the
  // server processed last silently discarded the other's addition.
  placePlateOnCounter: Schemas.Map({ counterId: Schemas.Int }),
  pickUpPlateFromCounter: Schemas.Map({ counterId: Schemas.Int }),
  pickUpFromCounter: Schemas.Map({ counterId: Schemas.Int }),
  // A single ingredient is just a one-element models array — same as a
  // picked-up assembled stack, no separate message needed for the two.
  placeOnCounter: Schemas.Map({ counterId: Schemas.Int, models: Schemas.Array(Schemas.String) }),

  // Start cooking a raw cookable at this stove. rawModel identifies which
  // CookableIngredientDefinition (shared/ingredients.ts) — the server looks
  // up cookedModel/cookDurationSeconds itself rather than trusting a
  // client-supplied value, since collecting hands out the result.
  startCookingOnStove: Schemas.Map({ stoveId: Schemas.Int, rawModel: Schemas.String }),

  // Claim a finished stove's cooked item. The server checks the stove is
  // actually done and not already collected before granting the cooked
  // item to the sender's HeldItem — see server/stoveCooking.ts — which is
  // what stops two players racing the same finished stove from both
  // walking away with a copy.
  collectFromStove: Schemas.Map({ stoveId: Schemas.Int }),

  // Deliver whatever's held. The server verifies `models` against the
  // sender's real HeldItem before accepting it (see
  // server/deliveryCounter.ts) rather than trusting the claim, then
  // timestamps it into the synced DeliveryState everyone animates from.
  // deliveryCounterId just picks a syncEntity id that doesn't collide with
  // any other fixture's.
  deliverHeldItem: Schemas.Map({ models: Schemas.Array(Schemas.String), deliveryCounterId: Schemas.Int }),

  // Server -> all: broadcast on a matched delivery. Each client times its
  // own success display locally from receipt, not a shared deadline
  // latency could cut short — see orderQueue.ts/ordersUi.tsx.
  orderDelivered: Schemas.Map({
    slotIndex: Schemas.Int,
    recipeId: Schemas.String,
    deliveredByName: Schemas.String,
    generatedAt: Schemas.Int64, // the order's own generatedAt, so its card keeps its row position instead of jumping to the front
    orderNumber: Schemas.Int // the order's own ticket number, so its badge doesn't change during the result display
  }),

  // Server -> all: broadcast when a slot's timer runs out before anyone
  // delivers it. Same shape/purpose as orderDelivered minus
  // deliveredByName (nobody delivered it) — see ordersUi.tsx's 'timedOut'
  // visual state.
  orderExpired: Schemas.Map({
    slotIndex: Schemas.Int,
    recipeId: Schemas.String,
    generatedAt: Schemas.Int64,
    orderNumber: Schemas.Int
  }),

  // Server -> all: broadcast whenever a slot gets a fresh order. Same
  // local-timing reasoning as orderDelivered, for a brief "New!" flash.
  orderGenerated: Schemas.Map({ slotIndex: Schemas.Int, recipeId: Schemas.String })
}

export const room = registerMessages(Messages)
