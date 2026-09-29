import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { PROJECTILE_SOUNDS } from '../configs/projectile-types.config';

/**
 * The sounds the simulation plays by id (audio:play events and
 * `spatialAudio.*` ops) or that the presentation plays for its towers:
 * placing and selling, the flame loop, the tentacle's grab, the lightning
 * chain, and each projectile's shot. Registered once per audio manager on
 * the main thread; the simulation registers nothing.
 */
export function registerCombatSounds(audio: SpatialAudioManager): void {
  audio.registerSound('tower-placed', 'assets/sounds/effects/building_placed.mp3', {
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.6,
  });
  audio.registerSound('tower-sold', 'assets/sounds/effects/building_selled.mp3', {
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.6,
  });
  audio.registerSound('flame-loop', 'assets/sounds/towers/fire/flame_loop.mp3', {
    refDistance: 30,
    rolloffFactor: 1.2,
    volume: 0.5,
    loop: true,
  });
  audio.registerSound('tentacle-grab', 'assets/sounds/towers/tentacle/tentacle-01.mp3', {
    refDistance: 25,
    rolloffFactor: 1.5,
    volume: 0.7,
  });
  audio.registerSound('lightning-chain', 'assets/sounds/towers/lightning/lightning_chain.mp3', {
    refDistance: 40,
    rolloffFactor: 1.2,
    volume: 0.6,
  });

  // Projectile samples can run ~1 s, which would put them in the medium
  // bucket (4 polyphony, ~50 ms anti-flood). At 8 max-upgraded towers in
  // continuous fire that caps out instantly: combat sounds need loose
  // throttling regardless of sample length.
  for (const [id, config] of Object.entries(PROJECTILE_SOUNDS)) {
    audio.registerSound(id, config.url, {
      refDistance: config.refDistance,
      rolloffFactor: config.rolloffFactor,
      volume: config.volume,
      minIntervalMs: 10,
      maxInstances: 12,
    });
  }
}
