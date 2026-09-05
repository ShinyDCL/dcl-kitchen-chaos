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
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { getDifficultyForStreak, getStreakProgress, MAX_DIFFICULTY_TIER } from '../../shared/recipes'
import { GameState } from '../../shared/schemas'
import { CornerPanelLayout } from './cornerPanelStyle'
import { emphasize, getPanelBackground, PANEL_BORDER_RADIUS, TEXT_COLOR, PROGRESS_FILL_COLOR, PROGRESS_TRACK_COLOR } from './uiStyle'

const HEIGHT_SCALE = 1.6 // taller than the sibling panels — it stacks a label over a bar

const BAR_WIDTH = '80%'

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
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: PANEL_BORDER_RADIUS
      }}
      uiBackground={{ color: getPanelBackground() }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: layout.fontSize + 4 }}
        uiText={{
          value: emphasize(`Level ${level}/${MAX_DIFFICULTY_TIER}`, layout.bold),
          fontSize: layout.fontSize,
          color: TEXT_COLOR,
          textAlign: 'middle-center'
        }}
      />
      <UiEntity
        uiTransform={{
          width: BAR_WIDTH,
          height: layout.barThickness,
          margin: { top: layout.barMarginTop }
        }}
        uiBackground={{ color: PROGRESS_TRACK_COLOR }}
      >
        {/* Plain width percentage — unlike the order card's timer this only moves
            when the streak changes, so there's no per-frame animation to keep smooth. */}
        <UiEntity
          uiTransform={{ width: `${progress * 100}%`, height: '100%' }}
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
