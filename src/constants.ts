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

// Room layout — local-space distances from the scene root (0,0,0) to each
// wall/row. There's no way to derive these from the model file, so tune
// them to match the actual Scene.glb dimensions.
export const SIDE_WALL_DISTANCE = 6 // meters from center to the left/right counter rows, along X
export const FRONT_ROW_DISTANCE = 6 // meters from center to the front row, along Z

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
