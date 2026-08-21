export const GRID_SIZE = 1 // square grid (rows = columns)
export const PARCEL_SIZE = 16 // parcel size in meters
export const SCENE_SIZE = GRID_SIZE * PARCEL_SIZE // scene size in meters
export const SCENE_CENTER = SCENE_SIZE / 2 // center point in scene

// Counter size
export const COUNTER_WIDTH = 1.4
export const COUNTER_DEPTH = 1.1
export const COUNTER_HEIGHT = 1

// How close the player needs to be for a counter to become the focused one.
export const INTERACTION_RANGE = 2.5 // meters

// Visual highlight shown on top of the currently focused counter.
export const HIGHLIGHT_WIDTH = COUNTER_WIDTH //* 1.05
export const HIGHLIGHT_DEPTH = COUNTER_DEPTH // * 1.05
export const HIGHLIGHT_THICKNESS = 0.02

// Minimum dot product between the player's forward vector and the direction
// to a counter for that counter to count as "faced". ~0.1 ≈ a wide ±84°
// cone — only rules out counters roughly behind the player, doesn't
// require anything close to precise aim.
export const FACING_THRESHOLD = 0.1
