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
  })
}

export const room = registerMessages(Messages)
