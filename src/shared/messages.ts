// Client -> server intent messages. See the authoritative-server skill for
// the module-load timing rule: registerMessages() must run during initial
// module load, reached via a static `import './shared/messages'` at the
// top of index.ts rather than a dynamic import inside main().

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  // The stack now in the sender's hand, bottom to top. Only for actions with
  // no paired fixture-side check (ingredient pickups, discard) — contested
  // actions grant or clear the hand from the fixture handler instead.
  setHeldItem: Schemas.Map({ models: Schemas.Array(Schemas.String) }),

  // Server -> sender only: their intent lost a race. Restores whatever was
  // optimistically taken out of hand — see heldItems.ts's takeHeldItemPending.
  actionRejected: Schemas.Map({}),

  // Preparation counter intents name the specific change rather than the
  // counter's whole new contents, so the server applies each atomically
  // against its own live state. Two players pushing a computed "full state"
  // from the same stale snapshot would silently discard each other's.
  pickUpFromCounter: Schemas.Map({ counterId: Schemas.Int }),
  // The server places whatever the sender's real HeldItem holds.
  placeOnCounter: Schemas.Map({ counterId: Schemas.Int }),

  // Start cooking a raw cookable at this stove. rawModel identifies which
  // CookableIngredientDefinition (shared/ingredients.ts) — the server looks
  // up cookedModel/cookDurationSeconds itself rather than trusting a
  // client-supplied value, since collecting hands out the result.
  startCookingOnStove: Schemas.Map({ stoveId: Schemas.Int, rawModel: Schemas.String }),

  // Claim a finished stove's cooked item. The server checks the stove is
  // actually done and not already collected before granting the cooked
  // item to the sender's HeldItem — see server/fixtures/stove.ts — which is
  // what stops two players racing the same finished stove from both
  // walking away with a copy.
  collectFromStove: Schemas.Map({ stoveId: Schemas.Int }),

  // Deliver whatever's held. The server reads the sender's real HeldItem
  // (see server/fixtures/deliveryCounter.ts) and timestamps it into the
  // synced DeliveryState everyone animates from. deliveryCounterId just
  // avoids colliding with another fixture's sync id.
  deliverHeldItem: Schemas.Map({ deliveryCounterId: Schemas.Int })
}

export const room = registerMessages(Messages)
