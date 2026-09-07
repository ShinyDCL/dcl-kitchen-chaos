// Draws the synced Leaderboard component; server/progression/leaderboard.ts
// owns the ranking.
//
// One single-line TextShape per cell, positioned by its own Transform under a
// shared root: column X from COLUMNS, row Y from ROW_HEIGHT. Rows are spaced
// with Transforms because this renderer ignores TextShape's lineSpacing — the
// SDK encodes and sends it, but it has no visible effect. textWrapping stays
// off too, so an over-long name cannot wrap and shove its row out of line.
//
// Rebuilt only when Leaderboard.version moves — one integer compare a frame.

import { engine, Entity, TextAlignMode, TextShape, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

import { LEADERBOARD_SIZE } from '../../shared/constants'
import { Leaderboard } from '../../shared/schemas'
import { formatNumber } from '../numberFormat'
import { WORLD_TEXT_COLOR } from './textStyle'

// Local to the scene root — well outside the kitchen walls, near the
// scene's -Z edge, turned to face back toward the room.
const BOARD_POSITION = Vector3.create(1, 3.63, -13.8)
const BOARD_ROTATION_DEGREES = 180

const FONT_SIZE = 1.8

// Vertical gap between rows, in metres — this is the row-spacing knob.
// Row 0 sits at the board root's own Y and rows descend from there.
const ROW_HEIGHT = 0.258

// Column anchors, in metres, relative to the board root. `x` is where the
// text meets its own alignment edge — MIDDLE_RIGHT ends at x, MIDDLE_LEFT
// starts at x — so the gutters come from the x values alone. `width` only
// bounds the space available to a line; it doesn't shift where text sits,
// which is why name's 2.6 can run past where the coins column begins.
// MIDDLE_* vertically, so a line centres on its own row's Y.
const COLUMNS = {
  rank: { x: 0, width: 0.2, align: TextAlignMode.TAM_MIDDLE_RIGHT },
  name: { x: 0.05, width: 2.6, align: TextAlignMode.TAM_MIDDLE_LEFT },
  coins: { x: 2.24, width: 1.6, align: TextAlignMode.TAM_MIDDLE_RIGHT }
}

const NAME_MAX_LENGTH = 14 // exact visible character count — tune against the real board width in-world

interface RowCells {
  rank: Entity
  name: Entity
  coins: Entity
}

const NO_BOARD_VERSION = -1 // no Leaderboard entity synced yet — nothing to draw

const rows: RowCells[] = []
let renderedVersion = NO_BOARD_VERSION

export function setupLeaderboardDisplay(parent: Entity): void {
  const root = engine.addEntity()
  Transform.create(root, {
    position: BOARD_POSITION,
    rotation: Quaternion.fromEulerDegrees(0, BOARD_ROTATION_DEGREES, 0),
    parent
  })

  for (let index = 0; index < LEADERBOARD_SIZE; index++) {
    const y = -index * ROW_HEIGHT
    rows.push({
      rank: createCell(root, COLUMNS.rank, y),
      name: createCell(root, COLUMNS.name, y),
      coins: createCell(root, COLUMNS.coins, y)
    })
  }

  engine.addSystem(renderLeaderboardDisplay)
}

function createCell(root: Entity, column: { x: number; width: number; align: TextAlignMode }, y: number): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(column.x, y, 0), parent: root })
  TextShape.create(entity, {
    text: '',
    fontSize: FONT_SIZE,
    width: column.width,
    textAlign: column.align,
    textColor: WORLD_TEXT_COLOR
  })
  return entity
}

function renderLeaderboardDisplay(): void {
  const version = getBoardVersion()
  if (version === renderedVersion) return
  renderedVersion = version

  const entries = getLeaderboardEntries()

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (!row) continue

    const { rank, name, coins } = row
    const entry = entries[index]

    if (!entry) {
      // Rows past the end blank out, so an empty board shows nothing at all.
      setCellText(rank, '')
      setCellText(name, '')
      setCellText(coins, '')
      continue
    }

    setCellText(rank, `${index + 1}.`)
    setCellText(name, truncateName(entry.name))
    setCellText(coins, formatNumber(entry.lifetimeCoins))
  }
}

function setCellText(entity: Entity, text: string): void {
  const mutable = TextShape.getMutableOrNull(entity)
  if (mutable) mutable.text = text
}

/** Hard crop, no ellipsis — the character an ellipsis would cost is spent on another letter of the actual name instead. */
function truncateName(name: string): string {
  return name.slice(0, NAME_MAX_LENGTH)
}

interface BoardEntry {
  name: string
  lifetimeCoins: number
}

const NO_ENTRIES: BoardEntry[] = []

/** The server's board revision — the every-frame path, so it stops at an integer rather than touching the entries. */
function getBoardVersion(): number {
  for (const [, data] of engine.getEntitiesWith(Leaderboard)) return data.version
  return NO_BOARD_VERSION
}

/** The synced board itself, already sorted descending by the server — returned as-is rather than copied. Only read after the version moved. */
function getLeaderboardEntries(): readonly BoardEntry[] {
  for (const [, data] of engine.getEntitiesWith(Leaderboard)) return data.entries
  return NO_ENTRIES
}
