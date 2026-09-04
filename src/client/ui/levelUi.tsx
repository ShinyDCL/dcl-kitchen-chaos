// The kitchen's current difficulty level and how far it is through to the
// next one, shown above the coin total in the top-right column.
//
// Sits ABOVE the coin panel deliberately: the "+N coins" toast hangs off the
// bottom of that panel and comes and goes constantly, so anything below it
// would be shoved up and down on every delivery.
//
// Derived entirely from the synced GameState.streak — the level and the bar
// come from shared/recipes.ts's getDifficultyForStreak/getStreakProgress, so
// the rule lives next to the recipes it selects and no message is needed.
//
// Scene-wide state, not per-player, so spectators see it too.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { getDifficultyForStreak, getStreakProgress, MAX_DIFFICULTY_TIER } from '../../shared/recipes'
import { GameState } from '../../shared/schemas'
import { CornerPanelLayout, PANEL_BACKGROUND, PANEL_BORDER_RADIUS, PANEL_MARGIN_TOP } from './cornerPanelStyle'
import { PROGRESS_FILL_COLOR, PROGRESS_TRACK_COLOR } from './orderQueueStyle'

const HEIGHT_SCALE = 1.6 // taller than the sibling panels — it stacks a label over a bar
const LABEL_COLOR = Color4.create(1, 1, 1, 0.9)

const BAR_WIDTH = '80%'
const BAR_HEIGHT = 6
const BAR_RADIUS = 3
const BAR_MARGIN_TOP = 4

export function LevelPanel({ layout }: { layout: CornerPanelLayout }) {
  const streak = getSceneStreak()
  if (streak === null) return null // no GameState synced yet

  const level = getDifficultyForStreak(streak)
  const progress = getStreakProgress(streak)

  return (
    <UiEntity
      uiTransform={{
        width: layout.width,
        height: layout.height * HEIGHT_SCALE,
        margin: { top: PANEL_MARGIN_TOP },
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: PANEL_BORDER_RADIUS
      }}
      uiBackground={{ color: PANEL_BACKGROUND }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: layout.fontSize + 4 }}
        uiText={{
          value: `Level ${level}/${MAX_DIFFICULTY_TIER}`,
          fontSize: layout.fontSize,
          color: LABEL_COLOR,
          textAlign: 'middle-center'
        }}
      />
      <UiEntity
        uiTransform={{
          width: BAR_WIDTH,
          height: BAR_HEIGHT,
          margin: { top: BAR_MARGIN_TOP },
          borderRadius: BAR_RADIUS
        }}
        uiBackground={{ color: PROGRESS_TRACK_COLOR }}
      >
        {/* Plain width percentage — unlike the order card's timer this only moves
            when the streak changes, so there's no per-frame animation to keep smooth. */}
        <UiEntity
          uiTransform={{ width: `${progress * 100}%`, height: '100%', borderRadius: BAR_RADIUS }}
          uiBackground={{ color: PROGRESS_FILL_COLOR }}
        />
      </UiEntity>
    </UiEntity>
  )
}

/** The scene-wide streak, or null before GameState has synced. */
function getSceneStreak(): number | null {
  for (const [, data] of engine.getEntitiesWith(GameState)) return data.streak
  return null
}
