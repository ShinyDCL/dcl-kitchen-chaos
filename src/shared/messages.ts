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
  pickUpAssembledFromCounter: Schemas.Map({ counterId: Schemas.Int }),
  placeIngredientOnCounter: Schemas.Map({ counterId: Schemas.Int, model: Schemas.String }),
  placeAssembledOnCounter: Schemas.Map({ counterId: Schemas.Int, models: Schemas.Array(Schemas.String) }),

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

  // Deliver whatever's just been taken out of the sender's hand (already
  // removed client-side via takeHeldItemModels before this is sent). The
  // server just timestamps it into the synced DeliveryState everyone
  // animates from — unlike the stove, nothing scarce is handed out here,
  // so no legality check is needed beyond that. deliveryCounterId is only
  // used to pick a syncEntity id that doesn't collide with any other
  // fixture's — see server/deliveryCounter.ts.
  deliverHeldItem: Schemas.Map({ models: Schemas.Array(Schemas.String), deliveryCounterId: Schemas.Int }),

  // Server -> all: broadcast on a matched delivery. Each client times its
  // own success celebration locally from receipt, not a shared deadline
  // latency could cut short — see recipeQueue.ts/recipesUi.tsx.
  recipeDelivered: Schemas.Map({
    slotIndex: Schemas.Int,
    recipeId: Schemas.String,
    deliveredByName: Schemas.String,
    generatedAt: Schemas.Int64 // the delivered recipe's own generatedAt, so its card keeps its row position instead of jumping to the front
  }),

  // Server -> all: broadcast whenever a slot gets a fresh recipe. Same
  // local-timing reasoning as recipeDelivered, for a brief "New!" flash.
  recipeGenerated: Schemas.Map({ slotIndex: Schemas.Int, recipeId: Schemas.String })
}

export const room = registerMessages(Messages)
