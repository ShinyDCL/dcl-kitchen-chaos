import { Color4, Vector3 } from '@dcl/sdk/math'

export const GRID_SIZE = 1 // square grid (rows = columns)
export const PARCEL_SIZE = 16 // parcel size in meters
export const SCENE_SIZE = GRID_SIZE * PARCEL_SIZE // scene size in meters
export const SCENE_CENTER = SCENE_SIZE / 2 // center point in scene

// Counter size
export const COUNTER_WIDTH = 1.4
export const COUNTER_DEPTH = 1.1
export const COUNTER_HEIGHT = 1

// Stove size — assumed to match the counter footprint until a real stove
// model is measured. Split out separately so it can diverge later without
// touching counter layout math.
export const STOVE_WIDTH = COUNTER_WIDTH
export const STOVE_DEPTH = COUNTER_DEPTH
export const STOVE_HEIGHT = COUNTER_HEIGHT

// Trash bin size — takes up the same footprint as a counter/stove for
// layout purposes, even though the model itself is visually smaller.
export const TRASH_BIN_WIDTH = COUNTER_WIDTH
export const TRASH_BIN_DEPTH = COUNTER_DEPTH
export const TRASH_BIN_HEIGHT = COUNTER_HEIGHT

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
export const HIGHLIGHT_WIDTH = COUNTER_WIDTH
export const HIGHLIGHT_DEPTH = COUNTER_DEPTH
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
export const STOVE_ITEM_OFFSET = Vector3.create(0.25, STOVE_HEIGHT + 0.05, 0.25)

// Progress bar shown above a stove while cooking.
export const PROGRESS_BAR_WIDTH = 0.6
export const PROGRESS_BAR_HEIGHT = 0.1
export const PROGRESS_BAR_THICKNESS = 0.02
export const PROGRESS_BAR_Y_OFFSET = STOVE_HEIGHT + 0.6 // floats above the cooking item
export const PROGRESS_BAR_BACKGROUND_COLOR = Color4.create(0.15, 0.15, 0.15, 0.9)
export const PROGRESS_BAR_FILL_COLOR = Color4.create(0.1, 0.9, 0.2, 1)

// Smoke particles shown above a stove while something is cooking. Kept
// light for mobile: rate/lifetime are tuned so the steady-state count per
// stove stays around 11, and with at most 3 stoves cooking at once that's
// roughly 33 live particles scene-wide — still trivial against the
// engine's particle budget.
// Emission point sits below STOVE_ITEM_OFFSET, inside the stove model
// (hidden from the player), so particles have drifted horizontally a bit
// by the time they emerge above the visible pan surface — spawning
// directly at the item made the smoke read as a single thin column.
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
