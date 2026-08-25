// A single reusable focus-highlight entity, moved to whichever fixture is
// currently focused. Colored green when interacting is currently allowed,
// red when it isn't — see focusManager.ts, which re-evaluates this every
// frame the fixture stays focused (not just on focus change), since
// allowed/disallowed can change while looking at the same fixture (e.g.
// the player picks something up while still facing a stove).

import { engine, Entity, Material, MeshRenderer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { HIGHLIGHT_DEPTH, HIGHLIGHT_THICKNESS, HIGHLIGHT_WIDTH } from '../shared/constants'

const ALLOWED_COLOR = Color4.create(0, 1, 0.3, 1)
const DISALLOWED_COLOR = Color4.create(0.5, 0.5, 0.5, 1)

let highlightEntity: Entity | null = null
let currentAllowed: boolean | null = null // avoids redundant Material writes when the color hasn't changed

function getOrCreateHighlight(): Entity {
  if (highlightEntity !== null) return highlightEntity

  const highlight = engine.addEntity()
  Transform.create(highlight, {
    scale: Vector3.create(HIGHLIGHT_WIDTH, HIGHLIGHT_THICKNESS, HIGHLIGHT_DEPTH)
  })
  MeshRenderer.setBox(highlight)
  VisibilityComponent.create(highlight, { visible: false })

  highlightEntity = highlight
  return highlight
}

/** Moves the shared highlight to sit on top of the given world position/rotation, shows it, and applies the allowed/disallowed color. */
export function showHighlightAt(worldPosition: Vector3, rotation: Quaternion, allowed: boolean): void {
  const highlight = getOrCreateHighlight()
  const transform = Transform.getMutable(highlight)
  transform.position = worldPosition
  transform.rotation = rotation
  VisibilityComponent.getMutable(highlight).visible = true
  applyAllowedColor(allowed)
}

/** Updates just the allowed/disallowed color of the currently-shown highlight, without moving it. */
export function setHighlightAllowed(allowed: boolean): void {
  applyAllowedColor(allowed)
}

export function hideHighlight(): void {
  if (highlightEntity === null) return
  VisibilityComponent.getMutable(highlightEntity).visible = false
  currentAllowed = null // force the color to reapply next time it's shown
}

function applyAllowedColor(allowed: boolean): void {
  if (currentAllowed === allowed) return
  currentAllowed = allowed

  const highlight = getOrCreateHighlight()
  const color = allowed ? ALLOWED_COLOR : DISALLOWED_COLOR
  Material.setPbrMaterial(highlight, {
    albedoColor: color,
    emissiveColor: color,
    emissiveIntensity: 0.1,
    metallic: 0,
    roughness: 0.8
  })
}
