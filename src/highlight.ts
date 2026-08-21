// A single reusable focus-highlight entity. Rather than creating/destroying
// a highlight per counter, we create it once and move it to whichever
// counter is currently focused — satisfying "only one highlight at a time"
// by construction.

import { engine, Entity, Material, MeshRenderer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

import { HIGHLIGHT_DEPTH, HIGHLIGHT_THICKNESS, HIGHLIGHT_WIDTH } from './constants'

const HIGHLIGHT_COLOR = Color4.create(0, 1, 0.3, 1)

let highlightEntity: Entity | null = null

function getOrCreateHighlight(): Entity {
  if (highlightEntity !== null) return highlightEntity

  const highlight = engine.addEntity()
  Transform.create(highlight, {
    scale: Vector3.create(HIGHLIGHT_WIDTH, HIGHLIGHT_THICKNESS, HIGHLIGHT_DEPTH)
  })
  MeshRenderer.setBox(highlight)
  Material.setPbrMaterial(highlight, {
    albedoColor: HIGHLIGHT_COLOR,
    emissiveColor: HIGHLIGHT_COLOR,
    emissiveIntensity: 0.1,
    metallic: 0,
    roughness: 0.8
  })
  VisibilityComponent.create(highlight, { visible: false })

  highlightEntity = highlight
  return highlight
}

/** Moves the shared highlight to sit on top of the given world position and shows it, matching the given rotation. */
export function showHighlightAt(worldPosition: Vector3, rotation: Quaternion): void {
  const highlight = getOrCreateHighlight()
  const transform = Transform.getMutable(highlight)
  transform.position = worldPosition
  transform.rotation = rotation
  VisibilityComponent.getMutable(highlight).visible = true
}

export function hideHighlight(): void {
  if (highlightEntity === null) return
  VisibilityComponent.getMutable(highlightEntity).visible = false
}
