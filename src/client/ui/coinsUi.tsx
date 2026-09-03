// The local player's lifetime coin total, shown under the Play/Spectate
// switcher (playerRole.tsx renders both as one top-right column), plus a
// brief "+123 coins" whenever it goes up.
//
// The notification needs no message: this client already has its own
// PlayerCoins synced, so a frame-to-frame increase *is* the notification.
// The first observation only seeds the baseline, or a returning player
// would see their whole restored balance flash as a grant.
//
// Spectators see this too — it's a lifetime total, not a session one.

import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'

import { PlayerCoins } from '../../shared/schemas'
import { formatNumber } from '../numberFormat'
import { getLocalUserId } from '../playerIdentity'
import { OVERLAY_SUCCESS_BACKGROUND, SUCCESS_TEXT_COLOR } from './orderQueueStyle'

const PANEL_BACKGROUND = Color4.create(0, 0, 0, 0.6) // matches the switcher's
const PANEL_BORDER_RADIUS = 10
const PANEL_MARGIN_TOP = 8

const TOAST_SECONDS = 2
const TOAST_FADE_FRACTION = 0.4 // last 40% of its life fades out

// Reuses the order card's success overlay, so a coin gain reads as the same
// kind of event as a successful delivery and the two can't drift apart.
const TOAST_BACKGROUND = OVERLAY_SUCCESS_BACKGROUND
const TOAST_TEXT_COLOR = SUCCESS_TEXT_COLOR

const COIN_TEXT_COLOR = Color4.create(1, 0.85, 0.35, 1) // warm gold

let lastSeenCoins: number | null = null
let toastAmount = 0
let toastEndsAt = 0

export interface CoinsPanelLayout {
  width: number
  height: number
  fontSize: number
}

export function CoinsPanel({ layout }: { layout: CoinsPanelLayout }) {
  const coins = getLocalPlayerCoins()
  if (coins === null) return null // total hasn't loaded server-side yet

  trackCoinChange(coins)

  return (
    <UiEntity uiTransform={{ width: layout.width, height: 'auto', flexDirection: 'column', alignItems: 'flex-end' }}>
      <UiEntity
        uiTransform={{
          width: layout.width,
          height: layout.height,
          margin: { top: PANEL_MARGIN_TOP },
          borderRadius: PANEL_BORDER_RADIUS
        }}
        uiBackground={{ color: PANEL_BACKGROUND }}
        uiText={{
          value: `${formatNumber(coins)} coins`,
          fontSize: layout.fontSize,
          color: COIN_TEXT_COLOR,
          textAlign: 'middle-center'
        }}
      />
      <CoinToast layout={layout} />
    </UiEntity>
  )
}

/** The "+123 coins" panel under the counter — nothing rendered when no grant is in flight. */
function CoinToast({ layout }: { layout: CoinsPanelLayout }) {
  const fade = getToastFade()
  if (fade === null) return null

  return (
    <UiEntity
      uiTransform={{
        width: layout.width,
        height: layout.height,
        margin: { top: PANEL_MARGIN_TOP },
        borderRadius: PANEL_BORDER_RADIUS
      }}
      uiBackground={{ color: withAlpha(TOAST_BACKGROUND, TOAST_BACKGROUND.a * fade) }}
      uiText={{
        value: `+${formatNumber(toastAmount)} coins`,
        fontSize: layout.fontSize,
        color: withAlpha(TOAST_TEXT_COLOR, fade),
        textAlign: 'middle-center'
      }}
    />
  )
}

/** How opaque the toast should be right now: 1 while it holds, easing to 0 over its tail. Null once expired. */
function getToastFade(): number | null {
  if (toastEndsAt === 0) return null

  const remainingSeconds = (toastEndsAt - Date.now()) / 1000
  if (remainingSeconds <= 0) {
    toastEndsAt = 0
    return null
  }

  const remainingFraction = remainingSeconds / TOAST_SECONDS
  return Math.min(remainingFraction / TOAST_FADE_FRACTION, 1)
}

function withAlpha(color: Color4, alpha: number): Color4 {
  return Color4.create(color.r, color.g, color.b, alpha)
}

/** Starts a toast when the total rises. A newer grant replaces the one showing rather than queueing behind it. */
function trackCoinChange(coins: number): void {
  if (lastSeenCoins === null) {
    lastSeenCoins = coins // first sight — a restored total isn't a grant
    return
  }
  if (coins > lastSeenCoins) {
    toastAmount = coins - lastSeenCoins
    toastEndsAt = Date.now() + TOAST_SECONDS * 1000
  }
  lastSeenCoins = coins
}

function getLocalPlayerCoins(): number | null {
  const localId = getLocalUserId().toLowerCase()
  for (const [, data] of engine.getEntitiesWith(PlayerCoins)) {
    if (data.playerId.toLowerCase() === localId) return data.lifetimeCoins
  }
  return null
}
