// One order card and its pieces. Pure presentation: every value arrives as a
// prop, so it holds no state and imports nothing from ordersUi.tsx.
//
// Status renders as a colored overlay drawn ON TOP of the ingredient stack
// and bar rather than a background change — the ingredients are opaque, so a
// color behind them would not show.

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { Ingredient } from '../../shared/ingredients'
import { getIngredientAtlasUvs, Recipe } from '../../shared/recipes'
import { serverNow } from '../serverReadiness'
import {
  ATLAS_TEXTURE_SRC,
  CARD_BORDER_RADIUS,
  DELIVERED_BY_NAME_MAX_LENGTH,
  ORDER_BADGE_BACKGROUND,
  ORDER_BADGE_Z_INDEX,
  OrderCardLayout,
  STATUS_OVERLAY_BG_TRANSFORM,
  STATUS_OVERLAY_TEXT_TRANSFORM
} from './orderQueueStyle'
import { emphasize, getPanelBackground, PROGRESS_FILL_COLOR, PROGRESS_TRACK_COLOR, TEXT_COLOR } from './uiStyle'

export type CardVisualState = 'normal' | 'new' | 'success' | 'timedOut'

export function OrderCard({
  orderNumber,
  recipe,
  generatedAt,
  visualState,
  deliveredByName,
  overlayColor,
  layout
}: {
  key?: string // consumed by the reconciler, never passed through to the component
  orderNumber: number
  recipe: Recipe
  generatedAt: number
  visualState: CardVisualState
  deliveredByName: string
  overlayColor: Color4 // eased by ordersUi.tsx, which owns the transition state
  layout: OrderCardLayout
}) {
  return (
    <UiEntity
      uiTransform={{
        width: layout.cardWidth,
        height: 'auto',
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: layout.cardPadding,
        margin: { right: layout.cardGap },
        borderRadius: CARD_BORDER_RADIUS,
        overflow: 'hidden' // clips the status overlay (and progress bar) to the card's rounded corners
      }}
      uiBackground={{ color: getPanelBackground() }}
    >
      <IngredientStack ingredients={recipe.ingredients} layout={layout} />
      <ProgressBar generatedAt={generatedAt} timerSeconds={recipe.timerSeconds} layout={layout} />
      <StatusOverlayBackground color={overlayColor} />
      {visualState === 'success' ? (
        <SuccessMessage deliveredByName={deliveredByName} layout={layout} />
      ) : visualState === 'timedOut' ? (
        <StatusText text="Timed out!" layout={layout} />
      ) : visualState === 'new' ? (
        <StatusText text="New!" layout={layout} />
      ) : null}
      <OrderBadge orderNumber={orderNumber} layout={layout} />
    </UiEntity>
  )
}

/**
 * A pill, not a circle — a circle clips past two digits. Uses uiText directly
 * rather than a nested Label, so there is one centering mechanism, not two.
 * Still reads slightly off-center vertically; no baseline control is available.
 */
function OrderBadge({ orderNumber, layout }: { orderNumber: number; layout: OrderCardLayout }) {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: layout.badgeMargin, left: layout.badgeMargin },
        zIndex: ORDER_BADGE_Z_INDEX,
        width: layout.badgeWidth,
        height: layout.badgeHeight,
        borderRadius: layout.badgeRadius
      }}
      uiBackground={{ color: ORDER_BADGE_BACKGROUND }}
      uiText={{
        value: `#${orderNumber}`,
        fontSize: layout.badgeFontSize,
        color: TEXT_COLOR,
        textAlign: 'middle-center'
      }}
    />
  )
}

/**
 * Dims the ingredient stack and bar for text legibility — above them, below the
 * status text. Rounds itself rather than relying on the card's overflow:
 * 'hidden', which clips to a rectangle, not the rounded shape.
 */
function StatusOverlayBackground({ color }: { color: Color4 }) {
  return <UiEntity uiTransform={STATUS_OVERLAY_BG_TRANSFORM} uiBackground={{ color }} />
}

/** A one-line status message centered over the card. Bold via the <b> tag PBUiText supports inline; there is no font-weight prop. */
function StatusText({ text, layout }: { text: string; layout: OrderCardLayout }) {
  return (
    <UiEntity uiTransform={STATUS_OVERLAY_TEXT_TRANSFORM}>
      <Label
        value={emphasize(text, layout.bold)}
        fontSize={layout.statusFontSize}
        color={TEXT_COLOR}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: layout.statusHeight }}
      />
    </UiEntity>
  )
}

function SuccessMessage({ deliveredByName, layout }: { deliveredByName: string; layout: OrderCardLayout }) {
  return (
    <UiEntity uiTransform={{ ...STATUS_OVERLAY_TEXT_TRANSFORM, flexDirection: 'column' }}>
      <Label
        value={emphasize('Success!', layout.bold)}
        fontSize={layout.statusFontSize}
        color={TEXT_COLOR}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: layout.successTitleHeight }}
      />
      <Label
        value={`by ${deliveredByName.slice(0, DELIVERED_BY_NAME_MAX_LENGTH)}`}
        fontSize={layout.successSubtextFontSize}
        color={TEXT_COLOR}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: layout.successSubtextHeight, margin: { top: layout.successLineGap } }}
      />
    </UiEntity>
  )
}

/** Stacks ingredients bottom-up, each overlapping the one below and later ones on top. Height is fixed to the longest recipe, so a shorter stack leaves space above. */
function IngredientStack({ ingredients, layout }: { ingredients: Ingredient[]; layout: OrderCardLayout }) {
  const iconStep = layout.iconHeight - layout.iconOverlap

  return (
    <UiEntity uiTransform={{ width: layout.iconWidth, height: layout.cardContentHeight }}>
      {ingredients.map((ingredient, index) => (
        <UiEntity
          key={`${ingredient}-${index}`}
          uiTransform={{
            positionType: 'absolute',
            position: { bottom: index * iconStep, left: 0 },
            width: layout.iconWidth,
            height: layout.iconHeight,
            zIndex: index + 1 // later ingredients render in front
          }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: ATLAS_TEXTURE_SRC },
            uvs: getIngredientAtlasUvs(ingredient)
          }}
        />
      ))}
    </UiEntity>
  )
}

/**
 * Vertical fill draining top-to-bottom, square-cornered — this renderer clips
 * to a rectangle regardless of radius.
 *
 * The fill stays a constant cardContentHeight tall and slides down out of the
 * track (position.bottom going negative), clipped by overflow: 'hidden'.
 * Animating height instead caused a real jumpiness bug.
 */
function ProgressBar({
  generatedAt,
  timerSeconds,
  layout
}: {
  generatedAt: number
  timerSeconds: number
  layout: OrderCardLayout
}) {
  const elapsedSeconds = (serverNow() - generatedAt) / 1000
  const drainedFraction = Math.min(elapsedSeconds / timerSeconds, 1)
  const fillOffset = drainedFraction * layout.cardContentHeight

  return (
    <UiEntity
      uiTransform={{
        width: layout.barWidth,
        height: layout.cardContentHeight,
        margin: { left: layout.barGap },
        overflow: 'hidden'
      }}
      uiBackground={{ color: PROGRESS_TRACK_COLOR }}
    >
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: -fillOffset, left: 0 },
          width: '100%',
          height: layout.cardContentHeight
        }}
        uiBackground={{ color: PROGRESS_FILL_COLOR }}
      />
    </UiEntity>
  )
}
