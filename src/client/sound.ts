// Sound effects and background music. Mobile needs both handled differently:
//
//   - a clip listed in assetPreload.ts's AssetLoad never plays there, so each
//     effect is preloaded by creating its AudioSource up front and only
//     desktop keeps an AssetLoad;
//   - its audio listener follows the camera, which mobileCamera.ts parks well
//     above and behind the player, and spatial sound breaks up as the listener
//     moves. So mobile plays everything global and derives the volume from the
//     player's own distance to the sound.
//
// The two delivery results never overlap: the newest replaces whatever was
// still playing.

import { AssetLoad, AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'

import { onPlatformResolved } from './platform/platformDetection'

const INTERACTION_SOUND = 'assets/scene/sounds/pickup.mp3'
const ACCEPT_SOUND = 'assets/scene/sounds/accept.mp3'
const REJECT_SOUND = 'assets/scene/sounds/reject.mp3'
const BACKGROUND_MUSIC = 'assets/scene/sounds/background.mp3'

// Tuned by ear per platform; both sit behind the effects.
const DESKTOP_MUSIC_VOLUME = 0.05
const MOBILE_MUSIC_VOLUME = 0.4

// Loudness at the player's elbow, which the falloff scales down from.
const MOBILE_EFFECT_VOLUME = 0.6

// The mobile falloff, in metres. The kitchen is about 11m across, so a
// delivery heard from the far wall lands around 0.4.
const MOBILE_FULL_VOLUME_DISTANCE = 4
const MOBILE_SILENT_DISTANCE = 16

function playSoundAt(entity: Entity | null, clipUrl: string): void {
  if (entity === null) return
  if (!AudioSource.has(entity)) AudioSource.create(entity, { audioClipUrl: clipUrl, playing: false })
  AudioSource.playSound(entity, clipUrl)
}

const mobileEntities = new Map<string, Entity>()

/** One entity per clip, whose AudioSource doubles as the preload. */
function mobileEntityFor(clipUrl: string): Entity {
  const existing = mobileEntities.get(clipUrl)
  if (existing !== undefined) return existing

  const entity = engine.addEntity()
  Transform.create(entity) // global playback, so there is no position to give it
  AudioSource.create(entity, {
    audioClipUrl: clipUrl,
    playing: false,
    loop: false,
    volume: 0,
    global: true,
    pitch: 1
  })
  mobileEntities.set(clipUrl, entity)
  return entity
}

/** Measured from the player, not from the camera the listener rides on. */
function mobileVolumeFor(soundPosition: Vector3): number {
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return 1

  const distance = Vector3.distance(player.position, soundPosition)
  if (distance <= MOBILE_FULL_VOLUME_DISTANCE) return 1
  if (distance >= MOBILE_SILENT_DISTANCE) return 0
  return 1 - (distance - MOBILE_FULL_VOLUME_DISTANCE) / (MOBILE_SILENT_DISTANCE - MOBILE_FULL_VOLUME_DISTANCE)
}

/** See the file header for why the distance ends up in the volume rather than in a position. */
function playOnMobile(clipUrl: string, soundPosition: Vector3): void {
  const falloff = mobileVolumeFor(soundPosition)
  if (falloff <= 0) return // too far to bother playing

  AudioSource.createOrReplace(mobileEntityFor(clipUrl), {
    audioClipUrl: clipUrl,
    playing: true,
    loop: false,
    volume: MOBILE_EFFECT_VOLUME * falloff,
    global: true,
    pitch: 1
  })
}

function stopOnMobile(clipUrl: string): void {
  const entity = mobileEntities.get(clipUrl)
  if (entity !== undefined) AudioSource.stopSound(entity)
}

// Each clip owns an entity so it stays preloaded, so the other result has to be
// stopped by hand — desktop gets that free from its one shared entity. The same
// result twice restarts instead, since replaying rewrites the component.
function playDeliveryResultOnMobile(clipUrl: string, soundPosition: Vector3): void {
  stopOnMobile(clipUrl === ACCEPT_SOUND ? REJECT_SOUND : ACCEPT_SOUND)
  playOnMobile(clipUrl, soundPosition)
}

let interactionSoundEntity: Entity | null = null

/** Plays the interaction feedback sound at the given world position — see focusManager.ts's generic interact hook. */
export function playInteractionSoundAt(position: Vector3): void {
  if (isMobile()) {
    playOnMobile(INTERACTION_SOUND, position)
    return
  }

  if (interactionSoundEntity === null) {
    interactionSoundEntity = engine.addEntity()
    Transform.create(interactionSoundEntity, { position })
  } else {
    Transform.getMutable(interactionSoundEntity).position = position
  }
  playSoundAt(interactionSoundEntity, INTERACTION_SOUND)
}

export function playAcceptSound(entity: Entity | null, soundPosition: Vector3): void {
  if (isMobile()) {
    playDeliveryResultOnMobile(ACCEPT_SOUND, soundPosition)
    return
  }
  playSoundAt(entity, ACCEPT_SOUND)
}

export function playRejectSound(entity: Entity | null, soundPosition: Vector3): void {
  if (isMobile()) {
    playDeliveryResultOnMobile(REJECT_SOUND, soundPosition)
    return
  }
  playSoundAt(entity, REJECT_SOUND)
}

/** Call once during client setup. Starts the music and, on mobile, preloads the effect clips. */
export function setupSound(): void {
  onPlatformResolved((mobile) => {
    if (mobile) {
      for (const clip of [INTERACTION_SOUND, ACCEPT_SOUND, REJECT_SOUND]) mobileEntityFor(clip)

      AudioSource.createOrReplace(engine.PlayerEntity, {
        audioClipUrl: BACKGROUND_MUSIC,
        playing: true,
        loop: true,
        volume: MOBILE_MUSIC_VOLUME,
        global: true // or it swells and fades as the camera moves relative to the player
      })
      return
    }

    // Desktop only — AssetLoad silences these on mobile.
    const audioPreload = engine.addEntity()
    AssetLoad.create(audioPreload, { assets: [INTERACTION_SOUND, ACCEPT_SOUND, REJECT_SOUND] })

    AudioSource.create(engine.CameraEntity, {
      audioClipUrl: BACKGROUND_MUSIC,
      playing: true,
      loop: true,
      volume: DESKTOP_MUSIC_VOLUME
    })
  })
}
