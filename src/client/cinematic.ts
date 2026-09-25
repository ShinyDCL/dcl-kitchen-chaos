// A scripted camera tour of the kitchen, for capturing footage. Press 1 to
// start it, 1 again to cut it short.
//
// Motion is handed to the renderer as Tweens rather than driven from a system.
// The renderer interpolates a tween and writes the result back every frame it
// draws, while a system writes Transform once per scene tick and that write
// trails the renderer — which is what reads as shake. Position and rotation
// ride in the same tween, so aim and movement stay in step.
//
// Each clip gets its own VirtualCamera with a zero-length transition, so moving
// between clips is a clean cut rather than a blend chasing a moving Transform.
//
// Desktop only. Mobile has no key to press, and mobileCamera.ts owns MainCamera
// there — two systems writing it would fight every frame.

import {
  EasingFunction,
  engine,
  Entity,
  InputAction,
  InputModifier,
  inputSystem,
  MainCamera,
  PointerEventType,
  Transform,
  Tween,
  TweenSequence,
  VirtualCamera
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { FIXTURE_HEIGHT, SCENE_CENTER, SCENE_SIZE } from '../shared/constants'
import { onPlatformResolved } from './platform/platformDetection'

/** The "1" key. E belongs to the fixtures. */
const CINEMATIC_KEY = InputAction.IA_ACTION_3

type ClipName = 'overheadSweep' | 'arc' | 'dispensers' | 'stoves' | 'deliveryPushIn' | 'pullBack'

/** The clips one press plays, in order, joined by hard cuts. Remove or reorder freely. */
const PLAYLIST: ClipName[] = ['overheadSweep', 'dispensers', 'stoves', 'deliveryPushIn', 'pullBack']

// The kitchen's own extents, from layout.ts's wall distances — shots are framed
// against the room, which is much smaller than the parcels it sits in.
const WALL = 5.45
const LEFT = SCENE_CENTER - WALL
const RIGHT = SCENE_CENTER + WALL
const BACK = SCENE_CENTER - WALL
const FRONT = SCENE_CENTER + WALL

/** Roughly the height of what sits on a counter — where most shots should aim. */
const COUNTER_TOP = FIXTURE_HEIGHT + 0.2

const KITCHEN_FLOOR = Vector3.create(SCENE_CENTER, 1, SCENE_CENTER)

// Where the tour ends up. Shared so the closing hold sits exactly where the
// pull-back left off, which is what makes the cut between them invisible.
const PULL_BACK_END = Vector3.create(SCENE_CENTER, 17, 28)
const PULL_BACK_TARGET = Vector3.create(SCENE_CENTER, 0.8, SCENE_CENTER)
const DELIVERY_COUNTER = Vector3.create(19.15, COUNTER_TOP, BACK)

/** VirtualCameras switch off outside the scene's parcels, so every point stays this far inside. */
const EDGE_MARGIN = 3
/** How long the cameras outlive the binding, so the renderer can blend back without a jump. */
const TEARDOWN_DELAY = 1
/** Points each curve is measured at to find its length. */
const CURVE_RESOLUTION = 240

type Ease = 'inOut' | 'in' | 'out' | 'linear'

interface Clip {
  seconds: number
  fov: number
  ease: Ease
  /**
   * How many straight tweens the clip is played as. A straight clip needs only
   * one, eased by the renderer itself; a curve needs enough that its corners
   * do not show. Every extra tween is a handoff the renderer has to make.
   */
  segments: number
  /**
   * Seconds to sit still on the closing pose. Part of this clip rather than a
   * clip of its own: switching cameras costs a visible hitch, and between two
   * identical poses there is no cut to hide it behind.
   */
  holdSeconds?: number
  /** Control points; the camera follows a smooth curve through them. */
  camera: Vector3[]
  /** Where the camera looks, as its own curve — moving it pans the shot. */
  target: Vector3[]
}

type Phase = 'idle' | 'playing' | 'returning'

let phase: Phase = 'idle'
let elapsed = 0
let clips: Clip[] = []
let cameras: Entity[] = []
let currentClip = -1

const clampToScene = (p: Vector3) =>
  Vector3.create(
    Math.min(Math.max(p.x, EDGE_MARGIN), SCENE_SIZE - EDGE_MARGIN),
    Math.max(p.y, 1),
    Math.min(Math.max(p.z, EDGE_MARGIN), SCENE_SIZE - EDGE_MARGIN)
  )

/** Left side at 180 degrees, entrance side at 270, right side at 360. */
function arcPosition(degrees: number, radius: number, height: number): Vector3 {
  const radians = degrees * (Math.PI / 180)
  return Vector3.create(SCENE_CENTER + radius * Math.cos(radians), height, SCENE_CENTER + radius * Math.sin(radians))
}

const CLIPS: Record<ClipName, Clip> = {
  // Rises across the room on a skew, from low and left of the entrance to high
  // and right, holding the kitchen. Climbing while crossing keeps the pan small,
  // so the move reads as a lift rather than a swing around the room — and the
  // gaze stays well off vertical, where a look-at rotation has no up vector.
  overheadSweep: {
    seconds: 2.9,
    fov: 70,
    ease: 'inOut',
    segments: 1,
    camera: [
      Vector3.create(SCENE_CENTER - 7, 5, SCENE_CENTER - 9),
      Vector3.create(SCENE_CENTER + 4, 15, SCENE_CENTER - 6)
    ],
    target: [Vector3.create(SCENE_CENTER, 1.2, SCENE_CENTER)]
  },
  // Half a turn, left side to right side, passing the entrance. A curve, so it
  // plays as many short linear tweens rather than one eased one.
  arc: {
    seconds: 4.5,
    fov: 60,
    ease: 'linear',
    segments: 16,
    camera: [180, 210, 240, 270, 300, 330, 360].map((degrees) => arcPosition(degrees, 9.5, 7)),
    target: [Vector3.create(SCENE_CENTER, 1.5, SCENE_CENTER)]
  },
  // Tracking the right-hand dispensers from just inside the room, tilted down.
  dispensers: {
    seconds: 3,
    fov: 65,
    ease: 'inOut',
    segments: 1,
    camera: [Vector3.create(RIGHT - 2.1, 3.1, BACK + 1.4), Vector3.create(RIGHT - 2.1, 3.1, FRONT - 1.4)],
    target: [Vector3.create(RIGHT, COUNTER_TOP, BACK + 1.4), Vector3.create(RIGHT, COUNTER_TOP, FRONT - 1.4)]
  },
  // The same move along the stove row, lower so the pans read.
  stoves: {
    seconds: 2.5,
    fov: 65,
    ease: 'inOut',
    segments: 1,
    camera: [Vector3.create(LEFT + 1.4, 2.5, FRONT - 1.9), Vector3.create(RIGHT - 1.4, 2.5, FRONT - 1.9)],
    target: [
      Vector3.create(LEFT + 1.4, COUNTER_TOP - 0.1, FRONT),
      Vector3.create(RIGHT - 1.4, COUNTER_TOP - 0.1, FRONT)
    ]
  },
  // A quick push in on the pass, tight lens — this is where an order finishes.
  deliveryPushIn: {
    seconds: 1.5,
    fov: 45,
    ease: 'inOut',
    segments: 1,
    camera: [Vector3.create(SCENE_CENTER + 0.2, 3.6, SCENE_CENTER - 0.6), Vector3.create(18.5, 1.85, 13)],
    target: [DELIVERY_COUNTER]
  },
  // Rise off the island and retreat to finish wide. Starts behind the centre on
  // z, so the retreat never crosses over the target.
  pullBack: {
    seconds: 4,
    fov: 55,
    ease: 'inOut',
    segments: 1,
    holdSeconds: 2.1,
    camera: [Vector3.create(SCENE_CENTER, 2.1, SCENE_CENTER + 2.5), PULL_BACK_END],
    target: [PULL_BACK_TARGET]
  }
}

/** A clip occupies its move plus whatever hold follows it. */
const clipLength = (clip: Clip) => clip.seconds + (clip.holdSeconds ?? 0)

// --- Paths --------------------------------------------------------------------

const EASES: Record<Ease, (t: number) => number> = {
  inOut: (t) => (1 - Math.cos(Math.PI * t)) / 2,
  in: (t) => 1 - Math.cos((Math.PI * t) / 2),
  out: (t) => Math.sin((Math.PI * t) / 2),
  linear: (t) => t
}

/** The renderer's own versions of the same curves, for clips played as a single tween. */
const RENDERER_EASES: Record<Ease, EasingFunction> = {
  inOut: EasingFunction.EF_EASESINE,
  in: EasingFunction.EF_EASEINSINE,
  out: EasingFunction.EF_EASEOUTSINE,
  linear: EasingFunction.EF_LINEAR
}

/** A point on the Catmull-Rom curve through `points`, t in 0..1. */
function catmullRom(points: Vector3[], t: number): Vector3 {
  const first = points[0]
  if (first === undefined) return Vector3.Zero()
  if (points.length === 1) return first

  const last = points.length - 1
  const scaled = Math.min(t, 0.99999) * last
  const index = Math.floor(scaled)
  const u = scaled - index
  const p0 = points[Math.max(index - 1, 0)] ?? first
  const p1 = points[index] ?? first
  const p2 = points[index + 1] ?? p1
  const p3 = points[Math.min(index + 2, last)] ?? p2
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u)

  return Vector3.create(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z))
}

/**
 * Points on the curve at the given fractions of its *length*. The curve's own
 * parameter runs faster through long spans than short ones, so spacing by it
 * makes the speed jump at every control point; spacing by distance does not.
 */
function atFractions(points: Vector3[], fractions: number[]): Vector3[] {
  const only = points[0]
  if (only !== undefined && points.length === 1) return fractions.map(() => only)

  const dense: Vector3[] = []
  const lengths: number[] = [0]
  for (let i = 0; i <= CURVE_RESOLUTION; i++) {
    dense.push(catmullRom(points, i / CURVE_RESOLUTION))
    const previous = dense[i - 1]
    const current = dense[i]
    if (i > 0 && previous !== undefined && current !== undefined) {
      lengths.push((lengths[i - 1] ?? 0) + Vector3.distance(previous, current))
    }
  }
  const total = lengths[CURVE_RESOLUTION] ?? 0

  return fractions.map((fraction) => {
    const wanted = fraction * total
    let i = 1
    while (i < CURVE_RESOLUTION && (lengths[i] ?? 0) < wanted) i++
    const from = dense[i - 1] ?? Vector3.Zero()
    const to = dense[i] ?? from
    const span = (lengths[i] ?? 0) - (lengths[i - 1] ?? 0)
    return Vector3.lerp(from, to, span > 0 ? (wanted - (lengths[i - 1] ?? 0)) / span : 0)
  })
}

/**
 * Plays a clip on its camera as renderer-side tweens that move and turn it
 * together: one tween for a straight clip, otherwise a Tween for the first
 * segment and a TweenSequence for the rest.
 */
function play(camera: Entity, clip: Clip): void {
  const n = clip.segments
  // One segment eases in the renderer; several are linear, with the easing
  // baked into how far apart the points sit.
  const fractions = Array.from({ length: n + 1 }, (_, k) => (n === 1 ? k : EASES[clip.ease](k / n)))
  const positions = atFractions(clip.camera, fractions).map(clampToScene)
  const targets = atFractions(clip.target, fractions)

  const rotations: Quaternion[] = []
  for (let k = 0; k <= n; k++) {
    const position = positions[k] ?? Vector3.Zero()
    let rotation = Quaternion.fromLookAt(position, targets[k] ?? KITCHEN_FLOOR)
    // A quaternion and its negation are the same rotation, but a tween between
    // opposite signs turns the long way round.
    const previous = rotations[k - 1]
    if (previous !== undefined && Quaternion.dot(previous, rotation) < 0) {
      rotation = Quaternion.create(-rotation.x, -rotation.y, -rotation.z, -rotation.w)
    }
    rotations.push(rotation)
  }

  const segmentMs = (clip.seconds * 1000) / n
  const segment = (k: number) => ({
    mode: Tween.Mode.MoveRotateScale({
      position: { start: positions[k] ?? Vector3.Zero(), end: positions[k + 1] ?? Vector3.Zero() },
      rotation: { start: rotations[k] ?? Quaternion.Identity(), end: rotations[k + 1] ?? Quaternion.Identity() }
    }),
    duration: segmentMs,
    easingFunction: n === 1 ? RENDERER_EASES[clip.ease] : EasingFunction.EF_LINEAR
  })

  const queue = Array.from({ length: n }, (_, k) => segment(k))
  if (clip.holdSeconds !== undefined) {
    // From the closing pose to itself, so the camera stays bound and simply
    // stops moving — no second camera, so nothing to flicker.
    const restPosition = positions[n] ?? Vector3.Zero()
    const restRotation = rotations[n] ?? Quaternion.Identity()
    queue.push({
      mode: Tween.Mode.MoveRotateScale({
        position: { start: restPosition, end: restPosition },
        rotation: { start: restRotation, end: restRotation }
      }),
      duration: clip.holdSeconds * 1000,
      easingFunction: EasingFunction.EF_LINEAR
    })
  }

  const transform = Transform.getMutable(camera)
  transform.position = positions[0] ?? Vector3.Zero()
  transform.rotation = rotations[0] ?? Quaternion.Identity()
  const [first, ...rest] = queue
  if (first === undefined) return
  Tween.createOrReplace(camera, { ...first, currentTime: 0, playing: true })
  if (rest.length > 0) TweenSequence.createOrReplace(camera, { sequence: rest })
}

// --- Playback -----------------------------------------------------------------

const totalSeconds = () => clips.reduce((sum, clip) => sum + clipLength(clip), 0)

function clipAt(t: number): number {
  let end = 0
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    end += clip === undefined ? 0 : clipLength(clip)
    if (t < end) return i
  }
  return clips.length - 1
}

function startClip(index: number): void {
  const camera = cameras[index]
  const clip = clips[index]
  if (camera === undefined || clip === undefined) return

  play(camera, clip)
  // Every clip is its own camera with a zero-length transition, so switching is a clean cut.
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: camera })
  currentClip = index
  console.log(`[CLIENT] cinematic clip ${index + 1}/${clips.length}: ${PLAYLIST[index]}`)
}

function begin(): void {
  clips = PLAYLIST.map((name) => CLIPS[name])
  cameras = clips.map((clip) => {
    const camera = engine.addEntity()
    Transform.create(camera, { position: clip.camera[0] })
    VirtualCamera.create(camera, {
      fov: clip.fov,
      defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0) }
    })
    return camera
  })

  // The player stays put while the camera is away.
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })

  phase = 'playing'
  elapsed = 0
  currentClip = -1
}

/** Gives the view and movement back to the player. */
function returnToPlayer(): void {
  const main = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (main !== null) main.virtualCameraEntity = undefined

  InputModifier.deleteFrom(engine.PlayerEntity)

  phase = 'returning'
  elapsed = 0
}

function finish(): void {
  for (const camera of cameras) engine.removeEntity(camera)
  cameras = []
  phase = 'idle'
}

/** Call once during client setup. */
export function setupCinematic(): void {
  onPlatformResolved((mobile) => {
    if (!mobile) engine.addSystem(cinematicSystem)
  })
}

function cinematicSystem(dt: number): void {
  if (inputSystem.isTriggered(CINEMATIC_KEY, PointerEventType.PET_DOWN)) {
    if (phase === 'idle') begin()
    else if (phase === 'playing') returnToPlayer()
  }

  if (phase === 'idle') return
  elapsed += dt

  if (phase === 'playing') {
    const clip = clipAt(elapsed)
    if (clip !== currentClip) startClip(clip)
    if (elapsed >= totalSeconds()) returnToPlayer()
    return
  }

  // returning: the cameras stay alive until the renderer has blended back to the player.
  if (elapsed >= TEARDOWN_DELAY) finish()
}
