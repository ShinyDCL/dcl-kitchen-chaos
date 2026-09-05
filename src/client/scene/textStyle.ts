// The one colour for 3D text rendered into the world — info panel,
// leaderboard, fixture messages.
//
// Warmer than screen UI's TEXT_COLOR (ui/uiStyle.ts): world text sits on the
// kitchen cream counters rather than a dark panel, where white reads harsh.

import { Color4 } from '@dcl/sdk/math'

export const WORLD_TEXT_COLOR = Color4.fromHexString('#faf2e6')
