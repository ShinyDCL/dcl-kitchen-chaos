// In-world info panel: players currently in the scene, and orders delivered over
// the scene's lifetime. Both read straight off the synced GameState (see
// server/gameState.ts and server/deliveryStats.ts), so they update the
// moment the server changes them, with no messages involved.
//
// Same construction as leaderboardDisplay.ts, and rebuilt only on change —
// here just two integer compares.

import { engine, Entity, TextAlignMode, TextShape, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { GameState } from '../../shared/schemas'
import { formatNumber } from '../numberFormat'
import { WORLD_TEXT_COLOR } from './textStyle'

// Local to the scene root — tune in-world, as with the leaderboard.
const PANEL_POSITION = Vector3.create(-0.8, 2.64, 6.25)
const PANEL_ROTATION_DEGREES = 0

const FONT_SIZE = 4

// Centred on its own origin, so a field's x is just where that number sits.
// Explicit rather than relying on the default, which the proto documents as
// centre-centre but which zero-defaults to TAM_TOP_LEFT as an unset enum.
const TEXT_ALIGN = TextAlignMode.TAM_MIDDLE_CENTER

// Same Y, separated on X. No `width` — it only bounds wrapping, which is off.
const FIELD_X = {
  playerCount: 0,
  totalDelivered: 1.6
}

const NOT_RENDERED = -1 // no GameState synced yet, and never a real count

let playerCountEntity: Entity | null = null
let totalDeliveredEntity: Entity | null = null
let renderedPlayerCount = NOT_RENDERED
let renderedTotalDelivered = NOT_RENDERED

export function setupInfoDisplay(parent: Entity): void {
  const root = engine.addEntity()
  Transform.create(root, {
    position: PANEL_POSITION,
    rotation: Quaternion.fromEulerDegrees(0, PANEL_ROTATION_DEGREES, 0),
    parent
  })

  playerCountEntity = createField(root, FIELD_X.playerCount)
  totalDeliveredEntity = createField(root, FIELD_X.totalDelivered)

  engine.addSystem(renderInfoDisplay)
}

function createField(root: Entity, x: number): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(x, 0, 0), parent: root })
  TextShape.create(entity, {
    text: '',
    fontSize: FONT_SIZE,
    textAlign: TEXT_ALIGN,
    textColor: WORLD_TEXT_COLOR
  })
  return entity
}

function renderInfoDisplay(): void {
  if (playerCountEntity === null || totalDeliveredEntity === null) return

  for (const [, data] of engine.getEntitiesWith(GameState)) {
    if (data.playerCount !== renderedPlayerCount) {
      renderedPlayerCount = data.playerCount
      setFieldText(playerCountEntity, formatNumber(data.playerCount))
    }
    if (data.totalDeliveredOrders !== renderedTotalDelivered) {
      renderedTotalDelivered = data.totalDeliveredOrders
      setFieldText(totalDeliveredEntity, formatNumber(data.totalDeliveredOrders))
    }
    break // singleton — only one GameState entity ever exists
  }
}

function setFieldText(entity: Entity, text: string): void {
  const mutable = TextShape.getMutableOrNull(entity)
  if (mutable) mutable.text = text
}
