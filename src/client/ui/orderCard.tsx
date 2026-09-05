// One order card and the pieces inside it. Pure presentation: every value
// it draws arrives as a prop, so it holds no state and imports nothing from
// ordersUi.tsx — that file owns which cards exist and what state each is in.
//
// New/success/timedOut render as a colorful overlay drawn ON TOP of the
// ingredient stack and progress bar, not a background color change — the
// ingredients are opaque textures, so a color behind them wouldn't show.

import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'

import { getIngredientAtlasUvs, Recipe } from '../../shared/recipes'
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
  cardKey,
  orderNumber,
  recipe,
  generatedAt,
  visualState,
  deliveredByName,
  overlayColor,
  layout
}: {
  cardKey: string
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
      key={cardKey}
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
 * A pill, not a circle — a circle only fits 1-2 digits before clipping; a
 * pill can grow with the ticket number. Uses uiText directly rather than a
 * nested Label, so there's one centering mechanism, not two stacked. Still
 * reads slightly off-center vertically — no line-height/baseline control
 * available, and padding nudges didn't help — left as-is.
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
 * Dims the ingredient stack/progress bar for text legibility — drawn above
 * them, below the status text. Rounds itself explicitly rather than
 * relying on the card's `overflow: 'hidden'`, which clips to a rectangle,
 * not the card's rounded shape (most visible on mobile).
 */
function StatusOverlayBackground({ color }: { color: Color4 }) {
  return <UiEntity uiTransform={STATUS_OVERLAY_BG_TRANSFORM} uiBackground={{ color }} />
}

/**
 * A one-line status message centered over the whole card — used for
 * "New!"/"Timed out!". Bold via the <b> tag PBUiText supports inline; there
 * is no font-weight prop and the Font enum has no bold face.
 */
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

/**
 * Stacks ingredients bottom-up, each one overlapping higher, last on top
 * in z-order. Container height is fixed to fit the longest recipe, so a
 * shorter stack just leaves empty space above it.
 */
function IngredientStack({ ingredients, layout }: { ingredients: string[]; layout: OrderCardLayout }) {
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
 * Vertical fill draining top-to-bottom — one color, square corners (this
 * renderer's overflow:'hidden' clips to a rectangle regardless of radius,
 * so rounding was never reliably achievable; see git history).
 *
 * The fill is a constant cardContentHeight tall, never resized — it
 * slides downward out of the track (position.bottom going negative) as
 * time passes, clipped by overflow:'hidden'. Animating height instead of
 * position was the root cause of a real jumpiness bug this once had.
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
  const elapsedSeconds = (Date.now() - generatedAt) / 1000
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
