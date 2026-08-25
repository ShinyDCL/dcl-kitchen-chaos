// Client -> server intent messages. See the authoritative-server skill for
// the module-load timing rule: registerMessages() must run during initial
// module load, reached via a static `import './shared/messages'` at the
// top of index.ts rather than a dynamic import inside main().

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  // The full stack now in the sender's hand, bottom to top; an empty array
  // means they've emptied their hand (placed, cooked, discarded, ...).
  setHeldItem: Schemas.Map({ models: Schemas.Array(Schemas.String) }),

  // A preparation counter's new full contents, sent after the client
  // decides locally what changed (see client/preparationCounters.ts).
  setPreparationCounterState: Schemas.Map({
    counterId: Schemas.Int,
    hasPlate: Schemas.Boolean,
    ingredientModels: Schemas.Array(Schemas.String)
  }),

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
  collectFromStove: Schemas.Map({ stoveId: Schemas.Int })
}

export const room = registerMessages(Messages)
