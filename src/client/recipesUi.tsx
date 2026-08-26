// Recipe queue HUD — cards along the top-left, newest on the left. Purely
// a rendering layer for now: SAMPLE_RECIPES is a frozen sample list, no
// server, no live countdown.
//
// Ingredients stack vertically (bottom-to-top) so cards stay narrow enough
// for several to fit on a phone screen. The stack uses absolute positioning
// with an explicitly computed height rather than flex + negative margins,
// since flex's 'auto' height isn't reliable with negative margins.
//
// screenInset: 'interactable' keeps the HUD clear of Decentraland's own UI
// (minimap, profile, sidebar) — 'device' only avoids hardware notches.
//
// DESKTOP_LAYOUT/MOBILE_LAYOUT hold platform-tuned sizing from on-device
// testing. getPlatform() resolves asynchronously, so currentLayout starts
// as desktop and updates once the platform is known.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlatform, isMobile } from '@dcl/sdk/platform'
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { getIngredientAtlasUvs, Recipe, SAMPLE_RECIPES } from '../shared/recipes'

const ATLAS_TEXTURE_SRC = 'assets/scene/textures/IngredientAtlas.png'

const MAX_VISIBLE_RECIPES = 5
const CARD_BORDER_RADIUS = 12 // no-op on mobile (unsupported there)
const CARD_BACKGROUND = Color4.create(0, 0, 0, 0.8)
const TIMER_BAR_HEIGHT = 8
const TIMER_BAR_BORDER_RADIUS = 4
const TIMER_BAR_MARGIN_TOP = 8

const SAMPLE_TIMER_MAX_SECONDS = 90 // just for a frozen sample fill % — not a real countdown yet

interface RecipeCardLayout {
  cardWidth: number
  cardPadding: number
  cardGap: number
  iconWidth: number
  iconHeight: number
  iconOverlap: number
  topOffset: number
  leftOffset: number
}

const DESKTOP_LAYOUT: RecipeCardLayout = {
  cardWidth: 96,
  cardPadding: 10,
  cardGap: 12,
  iconWidth: 64,
  iconHeight: 32, // half of the atlas's native 128x64 per ingredient cell
  iconOverlap: 14,
  topOffset: 24,
  leftOffset: 24
}

// Smaller, tighter-packed cards tuned from on-device testing.
const MOBILE_LAYOUT: RecipeCardLayout = {
  cardWidth: 76,
  cardPadding: 6,
  cardGap: 8,
  iconWidth: 56,
  iconHeight: 28,
  iconOverlap: 12,
  topOffset: 0,
  leftOffset: 24
}

let currentLayout: RecipeCardLayout = DESKTOP_LAYOUT

export function setupRecipesUi(): void {
  ReactEcsRenderer.setUiRenderer(RecipesUI, { virtualWidth: 1920, virtualHeight: 1080, screenInset: 'interactable' })
  startPlatformDetection()
}

/** Polls until getPlatform() resolves (null briefly at startup), then locks in the layout once. */
function startPlatformDetection(): void {
  engine.addSystem(function detectPlatform() {
    if (getPlatform() === null) return
    engine.removeSystem(detectPlatform)
    currentLayout = isMobile() ? MOBILE_LAYOUT : DESKTOP_LAYOUT
  })
}

function RecipesUI() {
  const layout = currentLayout
  const recipes = SAMPLE_RECIPES.slice(0, MAX_VISIBLE_RECIPES)

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: layout.topOffset, left: layout.leftOffset },
          width: 'auto',
          height: 'auto',
          flexDirection: 'row',
          // Default alignItems is 'stretch', which would force every card
          // to the tallest sibling's height — 'flex-start' lets each size
          // to its own content instead.
          alignItems: 'flex-start'
        }}
      >
        {recipes.map((recipe) => (
          <RecipeCard recipe={recipe} layout={layout} />
        ))}
      </UiEntity>
    </UiEntity>
  )
}

function RecipeCard({ recipe, layout }: { recipe: Recipe; layout: RecipeCardLayout }) {
  return (
    <UiEntity
      uiTransform={{
        width: layout.cardWidth,
        height: 'auto',
        flexDirection: 'column',
        alignItems: 'center',
        padding: layout.cardPadding,
        margin: { right: layout.cardGap },
        borderRadius: CARD_BORDER_RADIUS
      }}
      uiBackground={{ color: CARD_BACKGROUND }}
    >
      <IngredientStack ingredients={recipe.ingredients} layout={layout} />
      <TimerBar seconds={recipe.timerSeconds} />
    </UiEntity>
  )
}

/**
 * Stacks ingredients bottom-up: ingredients[0] sits at the bottom, each
 * next one overlaps higher up, last one on top in z-order. Height is
 * computed from the ingredient count so the card shrink-wraps exactly —
 * different recipes intentionally get different card heights.
 */
function IngredientStack({ ingredients, layout }: { ingredients: string[]; layout: RecipeCardLayout }) {
  const iconStep = layout.iconHeight - layout.iconOverlap
  const stackHeight = layout.iconHeight + (ingredients.length - 1) * iconStep

  return (
    <UiEntity uiTransform={{ width: layout.iconWidth, height: stackHeight }}>
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

function TimerBar({ seconds }: { seconds: number }) {
  const progress = Math.min(seconds / SAMPLE_TIMER_MAX_SECONDS, 1)

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: TIMER_BAR_HEIGHT,
        margin: { top: TIMER_BAR_MARGIN_TOP },
        borderRadius: TIMER_BAR_BORDER_RADIUS
      }}
      uiBackground={{ color: Color4.create(1, 1, 1, 0.2) }}
    >
      <UiEntity
        uiTransform={{ width: `${progress * 100}%`, height: '100%', borderRadius: TIMER_BAR_BORDER_RADIUS }}
        uiBackground={{ color: Color4.create(0.2, 0.85, 0.3, 1) }}
      />
    </UiEntity>
  )
}
