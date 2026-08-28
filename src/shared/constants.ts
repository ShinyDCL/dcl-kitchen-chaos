import { Color4, Vector3 } from '@dcl/sdk/math'

export const GRID_SIZE = 2 // square grid (rows = columns)
export const PARCEL_SIZE = 16 // parcel size in meters
export const SCENE_SIZE = GRID_SIZE * PARCEL_SIZE // scene size in meters
export const SCENE_CENTER = SCENE_SIZE / 2 // center point in scene

// Every fixture (counter, stove, trash bin, and anything added later)
// shares the same footprint/height for layout purposes, even when the
// model itself is visually smaller (e.g. the trash bin) or different
// (the stove) — this keeps every fixture interchangeable in row/grid math.
export const FIXTURE_WIDTH = 1.4
export const FIXTURE_DEPTH = 1.1
export const FIXTURE_HEIGHT = 1

// Room layout — local-space distances from the scene root (0,0,0) to each
// wall/row. There's no way to derive these from the model file, so tune
// them to match the actual Scene.glb dimensions.
export const SIDE_WALL_DISTANCE = 6 // meters from center to the left/right counter rows, along X
export const FRONT_ROW_DISTANCE = 6 // meters from center to the front row, along Z
export const BACK_WALL_DISTANCE = 6 // meters from center to the back wall (plate counters), along Z

// Y-axis rotation (degrees) for a fixture whose unrotated model faces +Z —
// matching the original counter's front-facing convention (the old pickup
// trigger sat at +Z in front of the counter). Combine with
// Quaternion.fromEulerDegrees(0, angle, 0) to orient a fixture.
export const FACE_POSITIVE_Z = 0
export const FACE_POSITIVE_X = 90
export const FACE_NEGATIVE_Z = 180
export const FACE_NEGATIVE_X = 270

// How close the player needs to be for a fixture to become the focused one.
export const INTERACTION_RANGE = 2.5 // meters

// Visual highlight shown on top of the currently focused fixture.
export const HIGHLIGHT_WIDTH = FIXTURE_WIDTH
export const HIGHLIGHT_DEPTH = FIXTURE_DEPTH
export const HIGHLIGHT_THICKNESS = 0.02

// Minimum dot product between the player's forward vector and the direction
// to a fixture for that fixture to count as "faced". ~0.1 ≈ a wide ±84°
// cone — only rules out fixtures roughly behind the player, doesn't
// require anything close to precise aim.
export const FACING_THRESHOLD = 0.1

// --- Stove cooking ---

// Local offset (relative to the stove fixture) where the raw/cooked item
// model is placed while cooking — tune this so it sits on top of the pan
// model rather than the stove's base.
export const STOVE_ITEM_OFFSET = Vector3.create(0.25, FIXTURE_HEIGHT + 0.05, 0.25)

// Progress bar shown above a stove while cooking.
export const PROGRESS_BAR_WIDTH = 0.6
export const PROGRESS_BAR_HEIGHT = 0.1
export const PROGRESS_BAR_THICKNESS = 0.02
export const PROGRESS_BAR_Y_OFFSET = FIXTURE_HEIGHT + 0.6 // floats above the cooking item
export const PROGRESS_BAR_BACKGROUND_COLOR = Color4.create(0.15, 0.15, 0.15, 0.9)
export const PROGRESS_BAR_FILL_COLOR = Color4.create(0.165, 0.596, 0.133, 1)
export const PROGRESS_BAR_FILL_OVERSCALE = 1.01
export const PROGRESS_BAR_BACKGROUND_RECESS = 0.001

// Smoke particles shown above a stove while cooking. Rate/lifetime tuned
// to keep the steady-state count around 11 per stove (~33 scene-wide with
// 3 stoves cooking at once) — trivial against the particle budget.
// Emission point sits below STOVE_ITEM_OFFSET, inside the stove model, so
// particles drift horizontally before emerging above the pan — spawning
// directly at the item read as a single thin column.
export const SMOKE_OFFSET = Vector3.create(STOVE_ITEM_OFFSET.x, STOVE_ITEM_OFFSET.y - 0.1, STOVE_ITEM_OFFSET.z)
export const SMOKE_SPAWN_RADIUS = 0.12 // small spawn volume instead of a single point, for spread from frame one
export const SMOKE_RATE = 6 // particles per second
export const SMOKE_MAX_PARTICLES = 18 // hard cap per stove, safety net above the ~11 steady-state count
export const SMOKE_LIFETIME = 1.8 // seconds
export const SMOKE_INITIAL_SIZE = { start: 0.3125, end: 0.5 }
export const SMOKE_SIZE_OVER_TIME = { start: 0.75, end: 2.75 } // grows as it rises and disperses
export const SMOKE_GRAVITY = -0.05 // negative = drifts upward;
export const SMOKE_INITIAL_VELOCITY = { start: 0.03, end: 0.08 }
export const SMOKE_COLOR = Color4.create(0.85, 0.85, 0.85, 0.85) // birth color; fades to fully transparent over lifetime
export const SMOKE_TEXTURE = 'assets/scene/textures/Smoke.png'

// Delivery counter success flourish. Both animations are simple Transform
// lerps driven by a system that only runs while something is actually
// animating — no particles, cheap on mobile.
export const DELIVERY_ITEM_SIT_DURATION = 1 // seconds the delivered item sits unchanged before shrinking
export const DELIVERY_ITEM_SHRINK_DURATION = 0.4 // seconds — item shrinks away over this long, once sitting ends
export const DELIVERY_CHECKMARK_SCALE_SECONDS = 0.3 // seconds — result mark's scale-up and scale-down, each
export const DELIVERY_CHECKMARK_HOLD_SECONDS = 0.6 // seconds the result mark stays fully scaled up before shrinking away
export const DELIVERY_CHECKMARK_MODEL_SCALE = 1.5 // result mark's model is rendered at this multiple of its base size
export const DELIVERY_CHECKMARK_Y_OFFSET = FIXTURE_HEIGHT + 0.6 // above the delivery pad

// The 1.4s sit+shrink window can be fully eaten by network/CRDT latency
// before another client observes it — see reconcileDelivery in
// deliveryCounter.ts. Seen within this many seconds of closing, it's
// treated as late (not historical) and replays from when observed.
export const DELIVERY_LATE_ARRIVAL_GRACE_SECONDS = 5

// --- Order queue ---

// Active order count clamps to this range based on active player count — see orderQueue.ts.
export const MIN_QUEUE_SIZE = 1
export const MAX_QUEUE_SIZE = 5

// Coins paid to every active player per delivery, scaled by the order's recipe's difficulty tier.
export const BASE_ORDER_PAYOUT = 10

// Difficulty tier = 1 + floor(streak / STREAK_DIFFICULTY_STEP), capped at MAX_DIFFICULTY_TIER.
export const STREAK_DIFFICULTY_STEP = 3
export const MAX_DIFFICULTY_TIER = 3

// How long a completed slot shows its result (delivered or timed out) before the next order replaces it.
export const ORDER_RESULT_DISPLAY_SECONDS = 2

// How long a freshly generated order flashes its "New!" highlight.
export const ORDER_NEW_FLASH_SECONDS = 1

// --- Server heartbeat ---

// Server pulses GameState.serverHeartbeatAt this often; clients treat it as
// alive only if a pulse was observed within FRESHNESS_MS of their own
// clock (~3x the interval) — see client/serverReadiness.ts.
export const SERVER_HEARTBEAT_INTERVAL_MS = 2000
export const SERVER_HEARTBEAT_FRESHNESS_MS = 6000
