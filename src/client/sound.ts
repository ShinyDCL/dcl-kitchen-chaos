// One-shot sound effects. The generic interaction sound is triggered from
// one shared, repositioned entity (see playInteractionSoundAt) since it
// can happen at any fixture; accept/reject are delivery-counter-specific
// and keep their own dedicated entities (see deliveryCounter.ts) so one
// can't cut the other off mid-playback. Background music is separate:
// attached to the camera instead of `global`, which didn't play reliably.

import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

export const INTERACTION_SOUND = 'assets/scene/sounds/pickup.mp3'
export const ACCEPT_SOUND = 'assets/scene/sounds/accept.mp3'
export const REJECT_SOUND = 'assets/scene/sounds/reject.mp3'
export const BACKGROUND_MUSIC = 'assets/scene/sounds/background.mp3'

const BACKGROUND_MUSIC_VOLUME = 0.05 // quieter than the sound effects so it sits behind them

function playSoundAt(entity: Entity | null, clipUrl: string): void {
  if (entity === null) return
  if (!AudioSource.has(entity)) AudioSource.create(entity, { audioClipUrl: clipUrl, playing: false })
  AudioSource.playSound(entity, clipUrl)
}

let interactionSoundEntity: Entity | null = null

/** Plays the interaction feedback sound at the given world position — see focusManager.ts's generic interact hook. */
export function playInteractionSoundAt(position: Vector3): void {
  if (interactionSoundEntity === null) {
    interactionSoundEntity = engine.addEntity()
    Transform.create(interactionSoundEntity, { position })
  } else {
    Transform.getMutable(interactionSoundEntity).position = position
  }
  playSoundAt(interactionSoundEntity, INTERACTION_SOUND)
}

export function playAcceptSound(entity: Entity | null): void {
  playSoundAt(entity, ACCEPT_SOUND)
}

export function playRejectSound(entity: Entity | null): void {
  playSoundAt(entity, REJECT_SOUND)
}

/** Call once during client setup. */
export function startBackgroundMusic(): void {
  AudioSource.create(engine.CameraEntity, {
    audioClipUrl: BACKGROUND_MUSIC,
    playing: true,
    loop: true,
    volume: BACKGROUND_MUSIC_VOLUME
  })
}
