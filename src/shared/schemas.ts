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
