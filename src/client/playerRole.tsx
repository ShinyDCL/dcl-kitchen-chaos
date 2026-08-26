// Entry role choice (Play/Spectate) and a persistent switcher, reconciled
// against the server-synced PlayerRole component (shared/schemas.ts) — the
// same optimistic-then-reconciled pattern heldItem.ts uses for the local
// player's hand. Practice is intentionally not wired in here yet: it's
// meant to be a fully local tutorial flow with no server interaction, and
// gets its own entry point once built.
//
// A player is spectator by default the moment they connect — applyRole
// sends that as soon as setupPlayerRoleUi runs, so a player who never
// touches the entry prompt still ends up with a real synced PlayerRole
// instead of leaving the server guessing. The prompt itself only asks
// whether they'd rather Play; dismissing it (either button) is separate
// from the role change itself, and the area around it stays click-through
// so choosing not to answer yet doesn't block movement or interaction.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlatform, isMobile } from '@dcl/sdk/platform'
import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

import { room } from '../shared/messages'
import { PlayerRole, PlayerRoleValue } from '../shared/schemas'
import { getLocalUserId } from './playerIdentity'

const PANEL_BACKGROUND = Color4.create(0.1, 0.1, 0.1, 0.95)
const PANEL_BORDER_RADIUS = 16
const BUTTON_BORDER_RADIUS = 8

const SWITCHER_BACKGROUND = Color4.create(0, 0, 0, 0.6)
const SWITCHER_BORDER_RADIUS = 10

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

let localRole: PlayerRoleValue = PlayerRoleValue.Spectate
let lastSyncedRole: PlayerRoleValue | null = null // last role actually observed from the synced component
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

  applyRole(PlayerRoleValue.Spectate)
  engine.addSystem(reconcileLocalRoleSystem)
  startPlatformDetection()
}

/** Polls until getPlatform() resolves (null briefly at startup), then locks in the switcher layout once. */
function startPlatformDetection(): void {
  engine.addSystem(function detectPlatform() {
    if (getPlatform() === null) return
    engine.removeSystem(detectPlatform)
    currentSwitcherLayout = isMobile() ? MOBILE_SWITCHER_LAYOUT : DESKTOP_SWITCHER_LAYOUT
  })
}

/**
 * Only reacts to the synced role when it has actually changed since last
 * observed — not whenever it merely differs from localRole. Right after
 * chooseRole's optimistic set, a live read of the synced PlayerRole is
 * briefly stale (the server hasn't processed setPlayerRole yet); comparing
 * against "what's rendered" instead of "what was last observed" would treat
 * that staleness as a real mismatch and revert the just-applied choice back
 * to the old role, only to flip again once the real update lands — the
 * button visibly twitches. Gating on an actual change makes the stale read
 * a no-op, so nothing reverts.
 */
function reconcileLocalRoleSystem(): void {
  const localId = getLocalUserId().toLowerCase()
  for (const [, data] of engine.getEntitiesWith(PlayerRole)) {
    if (data.playerId.toLowerCase() !== localId) continue
    if (data.role === lastSyncedRole) return // nothing new from the server since last frame
    lastSyncedRole = data.role
    localRole = data.role
    return
  }
}

/** Sets the local role and sends it to the server, without touching whether the entry prompt is showing. */
function applyRole(role: PlayerRoleValue): void {
  localRole = role
  void room.send('setPlayerRole', { role })
}

/** Called from the entry prompt's buttons — applies the choice and dismisses the prompt. */
function chooseRole(role: PlayerRoleValue): void {
  applyRole(role)
  showEntryOverlay = false
}

function EntryOverlayRenderer() {
  if (!showEntryOverlay) return null

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: 640,
          height: 'auto',
          flexDirection: 'column',
          alignItems: 'center',
          padding: { top: 44, bottom: 44, left: 32, right: 32 },
          borderRadius: PANEL_BORDER_RADIUS,
          pointerFilter: 'block'
        }}
        uiBackground={{ color: PANEL_BACKGROUND }}
      >
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
          onMouseDown={() => chooseRole(PlayerRoleValue.Play)}
          uiTransform={{ width: 240, height: 56, margin: { bottom: 20 }, borderRadius: BUTTON_BORDER_RADIUS }}
        />
        <Button
          value="Spectate"
          variant="secondary"
          fontSize={20}
          onMouseDown={() => chooseRole(PlayerRoleValue.Spectate)}
          uiTransform={{ width: 240, height: 56, borderRadius: BUTTON_BORDER_RADIUS }}
        />
      </UiEntity>
    </UiEntity>
  )
}

function RoleSwitcherRenderer() {
  if (showEntryOverlay) return null
  return RoleSwitcher()
}

function RoleSwitcher() {
  const isPlaying = localRole === PlayerRoleValue.Play
  const otherRole = isPlaying ? PlayerRoleValue.Spectate : PlayerRoleValue.Play
  const label = isPlaying ? 'Spectate' : 'Join'
  const layout = currentSwitcherLayout

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 24, right: 24 },
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
