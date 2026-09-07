export const GRID_SIZE = 2 // square grid (rows = columns)
export const PARCEL_SIZE = 16 // parcel size in meters
export const SCENE_SIZE = GRID_SIZE * PARCEL_SIZE // scene size in meters
export const SCENE_CENTER = SCENE_SIZE / 2 // center point in scene

// Shared fixture footprint (also used by highlight.ts, not just layout).
export const FIXTURE_WIDTH = 1.4
export const FIXTURE_DEPTH = 1.1
export const FIXTURE_HEIGHT = 1

// Smoke/fire particle textures — used by both stove.ts and assetPreload.ts.
export const SMOKE_TEXTURE = 'assets/scene/textures/Smoke.png'
export const FIRE_TEXTURE = 'assets/scene/textures/SpriteFire.png'

// How long a finished cook can sit before it burns — client (visuals) and
// server (which model collectFromStove grants) must agree on this.
export const BURN_GRACE_SECONDS = 10

// Result card display duration, and the server's minimum gap before
// regenerating — must agree, so a fresh order doesn't appear mid-display
// (see orderQueue.ts).
export const ORDER_RESULT_DISPLAY_SECONDS = 2

// How long after their last action a player still counts toward order
// payouts — see server/playerActivity.ts.
export const ACTIVITY_WINDOW_MS = 3 * 60 * 1000

// How long the scene must stay empty before the session ends and the next
// arrival gets a clean kitchen — see server/session.ts. Long enough that
// stepping outside the scene for a moment doesn't wipe a run.
export const SESSION_GRACE_SECONDS = 30

// The server truncates the board to this and the client builds this many
// rows — they must agree, or the board silently shows fewer.
export const LEADERBOARD_SIZE = 10

// Server heartbeat — see client/serverReadiness.ts.
export const SERVER_HEARTBEAT_INTERVAL_MS = 2000
export const SERVER_HEARTBEAT_FRESHNESS_MS = 6000
