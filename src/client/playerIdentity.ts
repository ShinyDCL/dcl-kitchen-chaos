// Thin seam over the network SDK's local-profile object, so call sites don't
// need to know the underlying field name if the profile shape ever changes.

import { myProfile } from '@dcl/sdk/network'

/** The local player's user ID — used to attribute synced state (e.g. who's holding an item) to a specific avatar. */
export function getLocalUserId(): string {
  return myProfile.userId
}
