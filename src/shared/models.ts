export const MODELS = {
  // Fixtures
  counter: 'assets/scene/models/Counter.glb',
  stove: 'assets/scene/models/Stove.glb',
  discardCounter: 'assets/scene/models/DiscardCounter.glb',
  checkmark: 'assets/scene/models/Checkmark.glb',
  crossmark: 'assets/scene/models/Crossmark.glb',
  message: 'assets/scene/models/Message.glb',
  counterCorner: 'assets/scene/models/CounterCorner.glb',

  // Pickup items (attached to player's hand)
  cucumberSlice: 'assets/scene/models/CucumberSlice.glb',
  onionSlice: 'assets/scene/models/OnionSlice.glb',
  tomatoSlice: 'assets/scene/models/TomatoSlice.glb',
  saladLeaf: 'assets/scene/models/SaladLeaf.glb',
  cheeseSlice: 'assets/scene/models/CheeseSlice.glb',
  bunBottom: 'assets/scene/models/BunBottom.glb',
  bunTop: 'assets/scene/models/BunTop.glb',
  pattyRaw: 'assets/scene/models/PattyRaw.glb',
  pattyCooked: 'assets/scene/models/PattyCooked.glb',
  egg: 'assets/scene/models/Egg.glb',
  eggRaw: 'assets/scene/models/EggRaw.glb',
  burntCookable: 'assets/scene/models/BurntCookable.glb',
  plate: 'assets/scene/models/Plate.glb',

  // Display items
  bunBottomDisplay: 'assets/scene/models/BunBottomDisplay.glb',
  pattyDisplay: 'assets/scene/models/PattyDisplay.glb',
  cheeseDisplay: 'assets/scene/models/CheeseDisplay.glb',
  tomatoDisplay: 'assets/scene/models/TomatoDisplay.glb',
  onionDisplay: 'assets/scene/models/OnionDisplay.glb',
  cucumberDisplay: 'assets/scene/models/CucumberDisplay.glb',
  saladDisplay: 'assets/scene/models/SaladDisplay.glb',
  eggDisplay: 'assets/scene/models/EggDisplay.glb',
  bunTopDisplay: 'assets/scene/models/BunTopDisplay.glb',
  plateDisplay: 'assets/scene/models/PlateDisplay.glb',
  deliveryCounter: 'assets/scene/models/DeliveryCounter.glb'
} as const

/** A known model path — for fields/params authored directly from MODELS, so a typo'd literal fails to compile instead of misclassifying at runtime. Held/synced item data stays plain `string`, since that crosses the network. */
export type ModelPath = (typeof MODELS)[keyof typeof MODELS]

/** Order-sensitive equality for a stack of model paths — used wherever a held/placed/delivered item stack needs to be compared against another (client and server). */
export function sameModels(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((model, index) => model === b[index])
}
