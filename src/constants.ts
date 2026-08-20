export const GRID_SIZE = 1 // square grid (rows = columns)
export const PARCEL_SIZE = 16 // parcel size in meters
export const SCENE_SIZE = GRID_SIZE * PARCEL_SIZE // scene size in meters
export const SCENE_CENTER = SCENE_SIZE / 2 // center point in scene

// Counter size
export const COUNTER_WIDTH = 1.4
export const COUNTER_DEPTH = 1.1
export const COUNTER_HEIGHT = 1

// Horizontal distance between counter centers when laid out in a line.
export const COUNTER_SPACING = 2.5

export const CIRCLE_DIAMETER = 1 // meters
export const CIRCLE_THICKNESS = 0.02 // thin "disc" — no native ring/torus primitive

// Trigger volume: same footprint as COUNTER_WIDTH on both axes, tall enough
// to reliably catch the avatar. Do not resize this.
export const TRIGGER_HEIGHT = 2

export const TRANSITION_DURATION = 0.5 // seconds for the color countdown
