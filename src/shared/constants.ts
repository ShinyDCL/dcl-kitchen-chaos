export const GRID_SIZE = 2 // square grid (rows = columns)
export const PARCEL_SIZE = 16 // parcel size in meters
export const SCENE_SIZE = GRID_SIZE * PARCEL_SIZE // scene size in meters
export const SCENE_CENTER = SCENE_SIZE / 2 // center point in scene

// Shared fixture footprint (also used by highlight.ts, not just layout).
export const FIXTURE_WIDTH = 1.4
export const FIXTURE_DEPTH = 1.1
export const FIXTURE_HEIGHT = 1

// Smoke particle texture — used by both stoveCooking.ts and assetPreload.ts.
export const SMOKE_TEXTURE = 'assets/scene/textures/Smoke.png'

// Result display duration — client and server must agree on this.
export const ORDER_RESULT_DISPLAY_SECONDS = 2

// Server heartbeat — see client/serverReadiness.ts.
export const SERVER_HEARTBEAT_INTERVAL_MS = 2000
export const SERVER_HEARTBEAT_FRESHNESS_MS = 6000
