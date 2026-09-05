// Addresses that connect to the scene without playing it — currently a
// third-party metrics bot that comes and goes on its own schedule. Counted
// as players, each of its visits moved the chef count and resized the order
// queue for everyone actually playing.
//
// presence.ts filters these out of both of its paths, so nothing downstream
// treats one as a participant: no chef count, no queue slot, no payout, and
// no stored coin total.
//
// Just the list — add or remove an address here, nothing else to change.
// Case doesn't matter; presence.ts lower-cases on load.

export const NON_PLAYER_ADDRESSES = [
  '0x5c61f3a6bee08f43f886bf20adac296495ee77a2' // metrics bot
]
