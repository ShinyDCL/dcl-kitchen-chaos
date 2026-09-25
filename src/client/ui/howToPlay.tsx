// The how-to-play modal, and the button that opens it.
//
// No button label may be bold: <b> markup on a tappable element stops it
// receiving taps on mobile, while leaving it looking perfectly normal. Plain
// body copy is unaffected, so only the buttons here skip emphasize().
//
// The modal renders in its own layer over the device-safe area, like the entry
// overlay: the button's own column sits in the 'interactable' inset, which
// excludes the client's left-hand UI, and a panel centred inside that reads
// visibly off-centre.
//
// Text is left to wrap at the panel's edge (PBUiText defaults to TW_WRAP)
// rather than broken into authored lines, so one copy fits both platforms'
// font sizes and panel widths.

import { engine } from '@dcl/sdk/ecs'
import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { onPlatformResolved } from '../platform/platformDetection'
import { CornerPanelLayout } from './cornerPanelStyle'
import {
  emphasize,
  getPanelBackground,
  PANEL_BORDER_RADIUS,
  SUCCESS_BACKGROUND,
  TEXT_COLOR,
  withAlpha
} from './uiStyle'

const TITLE = 'How to play'
const INTRO = 'Each order shows a burger: build it, then deliver it.'

const STEPS = [
  '1.  Grab an ingredient from the counter.',
  '2.  Cook raw ingredients on a stove.',
  '3.  Stack the ingredients on an empty counter, bottom to top.',
  '4.  Deliver the finished stack.'
]

// Outlined so the panel reads as a control rather than another readout — the
// only thing separating it from the level and coin panels beside it.
const BUTTON_BORDER_WIDTH = 2
const BUTTON_BORDER_COLOR = withAlpha(TEXT_COLOR, 0.8)

// Its own radius, not PANEL_BORDER_RADIUS: same reasoning as the entry
// overlay's panel, whose rounding this matches.
const MODAL_BORDER_RADIUS = 24

// Text boxes are sized explicitly rather than left on 'auto': the Unity
// explorer handles an unset text dimension poorly, and seven auto-height
// blocks accumulate into visible dead space at the foot of the panel.
const LINE_HEIGHT_FACTOR = 1.35

interface ModalLayout {
  panelWidth: number
  padding: number
  titleFontSize: number
  bodyFontSize: number
  blockGap: number // above the interact line, the step list and the closing paragraph
  stepGap: number // between steps, tighter than blockGap so the list reads as one group
  okWidth: number
  okHeight: number
  /** Mobile pins the panel to the top, clear of the order queue along the bottom edge. */
  verticalAlign: 'center' | 'flex-start'
  topOffset: number
  bold: boolean
  /** The interact line differs per platform: mobile has no keyboard, and hides every gamepad button but one. */
  interactLine: string
}

const DESKTOP_MODAL_LAYOUT: ModalLayout = {
  panelWidth: 720,
  padding: 40,
  titleFontSize: 30,
  bodyFontSize: 20,
  blockGap: 24,
  stepGap: 10,
  okWidth: 160,
  okHeight: 48,
  verticalAlign: 'center',
  topOffset: 0,
  bold: false,
  interactLine: 'To interact, walk up to a counter or stove and press E.'
}

// Wider and larger throughout, like the rest of the mobile UI — the virtual
// canvas is narrower there, so desktop sizes come out small on a phone.
const MOBILE_MODAL_LAYOUT: ModalLayout = {
  panelWidth: 880,
  padding: 32,
  titleFontSize: 30,
  bodyFontSize: 22,
  blockGap: 18,
  stepGap: 8,
  okWidth: 200,
  okHeight: 56,
  verticalAlign: 'flex-start',
  topOffset: 24,
  bold: true,
  interactLine: 'To interact, walk up to a counter or stove and tap the action button.'
}

let currentLayout: ModalLayout = DESKTOP_MODAL_LAYOUT
let isOpen = false

/** Call once during client setup. Registers the modal's renderer; cornerPanels.tsx places the button. */
export function setupHowToPlay(): void {
  const owner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(owner, HowToPlayModal, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'device'
  })

  onPlatformResolved((mobile) => {
    currentLayout = mobile ? MOBILE_MODAL_LAYOUT : DESKTOP_MODAL_LAYOUT
  })
}

/** Sits above the level panel in the top-right column — see cornerPanels.tsx. */
export function HowToPlayButton({ layout }: { layout: CornerPanelLayout }) {
  return (
    <UiEntity
      uiTransform={{
        width: layout.width,
        height: layout.height,
        borderRadius: PANEL_BORDER_RADIUS,
        borderWidth: BUTTON_BORDER_WIDTH,
        borderColor: BUTTON_BORDER_COLOR
      }}
      uiBackground={{ color: getPanelBackground() }}
      uiText={{
        value: TITLE,
        fontSize: layout.fontSize,
        color: TEXT_COLOR,
        textAlign: 'middle-center'
      }}
      onMouseDown={() => {
        isOpen = true
      }}
    />
  )
}

function HowToPlayModal() {
  if (!isOpen) return null
  const layout = currentLayout

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: '100%',
        flexDirection: 'column', // explicit, so justifyContent is the vertical axis whatever the default is
        justifyContent: layout.verticalAlign,
        alignItems: 'center',
        padding: { top: layout.topOffset }
      }}
    >
      <UiEntity
        uiTransform={{
          width: layout.panelWidth,
          height: 'auto',
          flexDirection: 'column',
          alignItems: 'center',
          padding: {
            top: layout.padding,
            bottom: layout.padding,
            left: layout.padding,
            right: layout.padding
          },
          borderRadius: MODAL_BORDER_RADIUS,
          pointerFilter: 'block' // the panel swallows clicks; the area around it stays click-through, as the entry overlay does
        }}
        uiBackground={{ color: getPanelBackground() }}
      >
        <BodyText value={TITLE} fontSize={layout.titleFontSize} bold={layout.bold} align="middle-center" />
        <BodyText value={INTRO} fontSize={layout.bodyFontSize} bold={layout.bold} marginTop={layout.blockGap} />
        <BodyText
          value={layout.interactLine}
          fontSize={layout.bodyFontSize}
          bold={layout.bold}
          marginTop={layout.blockGap}
        />

        {STEPS.map((step, index) => (
          <BodyText
            key={step}
            value={step}
            fontSize={layout.bodyFontSize}
            bold={layout.bold}
            marginTop={index === 0 ? layout.blockGap : layout.stepGap}
          />
        ))}

        <UiEntity
          uiTransform={{
            width: layout.okWidth,
            height: layout.okHeight,
            margin: { top: layout.blockGap },
            borderRadius: PANEL_BORDER_RADIUS,
            borderWidth: BUTTON_BORDER_WIDTH,
            borderColor: BUTTON_BORDER_COLOR
          }}
          uiBackground={{ color: SUCCESS_BACKGROUND }}
          uiText={{
            value: 'Ok',
            fontSize: layout.bodyFontSize,
            color: TEXT_COLOR,
            textAlign: 'middle-center'
          }}
          onMouseDown={() => {
            isOpen = false
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}

/** A full-width line of panel copy. Copy long enough to wrap needs its height raised to match, or it clips. */
function BodyText({
  value,
  fontSize,
  bold,
  marginTop = 0,
  align = 'middle-left'
}: {
  key?: string
  value: string
  fontSize: number
  bold: boolean
  marginTop?: number
  align?: 'middle-left' | 'middle-center'
}) {
  return (
    <Label
      value={emphasize(value, bold)}
      fontSize={fontSize}
      color={TEXT_COLOR}
      textAlign={align}
      uiTransform={{
        width: '100%',
        height: Math.round(fontSize * LINE_HEIGHT_FACTOR),
        margin: { top: marginTop }
      }}
    />
  )
}
