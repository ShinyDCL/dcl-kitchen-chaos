// Entry role choice (Play/Spectate) and a persistent switcher — pure UI;
// the role state itself lives in playerRoleState.ts. Practice isn't wired
// in yet: it's meant to be a fully local tutorial flow with no server
// interaction, and gets its own entry point once built.
//
// Until the server is actually alive (see serverReadiness.ts — the CRDT
// room connecting isn't enough, a cold start can take ~15s), the entry
// overlay's slot shows serverLoadingUi.tsx's LoadingPrompt instead of
// RolePrompt, since there's nothing for the player to choose yet. Both
// share entryOverlayStyle.ts's panel transforms so they render at the
// same size.
//
// The area around the prompt stays click-through so choosing not to answer
// yet doesn't block movement or interaction.
//
// The switcher renderer also hosts coinsUi.tsx's CoinsPanel, so the two
// stack as one top-right column — see RoleSwitcherRenderer.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { PlayerRoleValue } from '../../shared/schemas'
import { onPlatformResolved } from '../platformDetection'
import { applyRole, getLocalPlayerRole, startPlayerRoleSync } from '../playerRoleState'
import { isServerAlive } from '../serverReadiness'
import { CoinsPanel } from './coinsUi'
import { ENTRY_PANEL_TRANSFORM, OVERLAY_WRAPPER_TRANSFORM, PANEL_BACKGROUND } from './entryOverlayStyle'
import { LoadingPrompt } from './serverLoadingUi'

const BUTTON_BORDER_RADIUS = 8

// Overrides Button's default DCL-brand red/white — pink echoes the delivery
// counter's glow, cream/brown echoes the counters and checkered floor.
const PLAY_BUTTON_COLOR = Color4.create(0.95, 0.25, 0.55, 1)
const SPECTATE_BUTTON_COLOR = Color4.create(0.95, 0.87, 0.74, 1)
const SPECTATE_BUTTON_TEXT_COLOR = Color4.create(0.32, 0.18, 0.1, 1)

const SWITCHER_BACKGROUND = Color4.create(0, 0, 0, 0.6)
const SWITCHER_BORDER_RADIUS = 10
const SWITCHER_EDGE_OFFSET = 24 // from the interactable area's top-right corner

interface SwitcherLayout {
  width: number
  height: number
  fontSize: number
  paddingHorizontal: number
  paddingVertical: number
}

const DESKTOP_SWITCHER_LAYOUT: SwitcherLayout = { width: 160, height: 44, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 }
const MOBILE_SWITCHER_LAYOUT: SwitcherLayout = { width: 220, height: 64, fontSize: 20, paddingHorizontal: 16, paddingVertical: 14 }

let currentSwitcherLayout: SwitcherLayout = DESKTOP_SWITCHER_LAYOUT

let showEntryOverlay = true

export function setupPlayerRoleUi(): void {
  // Two separate renderers, not one: the overlay centers on the whole
  // device-safe area so it lands in the true screen center, while the
  // switcher stays in the 'interactable' area so it doesn't sit under
  // Decentraland's own top-right icon column.
  const overlayOwner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(overlayOwner, EntryOverlayRenderer, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'device'
  })

  const switcherOwner = engine.addEntity()
  ReactEcsRenderer.addUiRenderer(switcherOwner, RoleSwitcherRenderer, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'interactable'
  })

  startPlayerRoleSync()
  onPlatformResolved((mobile) => {
    currentSwitcherLayout = mobile ? MOBILE_SWITCHER_LAYOUT : DESKTOP_SWITCHER_LAYOUT
  })
}

/** Called from the entry prompt's buttons — applies the choice and dismisses the prompt. */
function chooseRole(role: PlayerRoleValue): void {
  applyRole(role)
  showEntryOverlay = false
}

function EntryOverlayRenderer() {
  if (!showEntryOverlay) return null
  return isServerAlive() ? RolePrompt() : LoadingPrompt()
}

function RolePrompt() {
  return (
    <UiEntity uiTransform={OVERLAY_WRAPPER_TRANSFORM}>
      <UiEntity uiTransform={ENTRY_PANEL_TRANSFORM} uiBackground={{ color: PANEL_BACKGROUND }}>
        <Label
          value="Join the kitchen?"
          fontSize={32}
          color={Color4.White()}
          uiTransform={{ margin: { bottom: 28 } }}
        />
        <Button
          value="Play"
          variant="primary"
          fontSize={22}
          uiBackground={{ color: PLAY_BUTTON_COLOR }}
          onMouseDown={() => chooseRole(PlayerRoleValue.Play)}
          uiTransform={{ width: 240, height: 56, margin: { bottom: 20 }, borderRadius: BUTTON_BORDER_RADIUS }}
        />
        <Button
          value="Spectate"
          variant="secondary"
          fontSize={20}
          color={SPECTATE_BUTTON_TEXT_COLOR}
          uiBackground={{ color: SPECTATE_BUTTON_COLOR }}
          onMouseDown={() => chooseRole(PlayerRoleValue.Spectate)}
          uiTransform={{ width: 240, height: 56, borderRadius: BUTTON_BORDER_RADIUS }}
        />
      </UiEntity>
    </UiEntity>
  )
}

/**
 * Anchors the switcher and the coin panel as one top-right column, so the
 * coins sit under the button without hardcoding an offset that would go
 * wrong when the switcher swaps to its taller mobile layout.
 */
function RoleSwitcherRenderer() {
  if (showEntryOverlay) return null
  const layout = currentSwitcherLayout

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: SWITCHER_EDGE_OFFSET, right: SWITCHER_EDGE_OFFSET },
        width: layout.width,
        height: 'auto',
        flexDirection: 'column',
        alignItems: 'flex-end'
      }}
    >
      <RoleSwitcher />
      <CoinsPanel layout={{ width: layout.width, height: layout.height, fontSize: layout.fontSize }} />
    </UiEntity>
  )
}

function RoleSwitcher() {
  const isPlaying = getLocalPlayerRole() === PlayerRoleValue.Play
  const otherRole = isPlaying ? PlayerRoleValue.Spectate : PlayerRoleValue.Play
  const label = isPlaying ? 'Spectate' : 'Join'
  const layout = currentSwitcherLayout

  return (
    <UiEntity
      uiTransform={{
        width: layout.width,
        height: layout.height,
        justifyContent: 'center',
        alignItems: 'center',
        padding: { top: layout.paddingVertical, bottom: layout.paddingVertical, left: layout.paddingHorizontal, right: layout.paddingHorizontal },
        borderRadius: SWITCHER_BORDER_RADIUS
      }}
      uiBackground={{ color: SWITCHER_BACKGROUND }}
      onMouseDown={() => chooseRole(otherRole)}
    >
      {/* Bound to the button's own width/height (not 'auto') — an auto-sized parent around a percentage-width text child rendered with no visible background on desktop. */}
      <Label
        value={label}
        fontSize={layout.fontSize}
        color={Color4.White()}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: '100%' }}
      />
    </UiEntity>
  )
}
