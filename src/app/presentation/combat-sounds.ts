import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { PROJECTILE_SOUNDS } from '../configs/projectile-types.config';
import type { TowerLoopSound } from './tower-loop-sounds';

/** The fire towers' flame while the beam burns */
export const FLAME_SOUND: TowerLoopSound = { loop: 'flame-loop' };
/** The Sentinel Laser: the beam ignites, its hum comes up under the onset */
export const LASER_SOUND: TowerLoopSound = { start: 'laser-start', loop: 'laser-loop', ramp: 0.5 };
/**
 * The Chainsaw: the saws spin up as the first enemy comes in reach, run while
 * the arms work and labour under load while they cut; with nothing left they
 * idle on a moment before they stop
 */
export const SAW_SOUND: TowerLoopSound = { start: 'saw-spinup', loop: 'saw-loop', ramp: 1.4, load: 'saw-cut', linger: 2 };
/** The Shawarma Slicer: the machine spins up and runs with its drive (the loop follows it) */
export const STREAM_SOUND: TowerLoopSound = { start: 'doner-spinup', loop: 'doner-loop' };

/**
 * The sounds the simulation plays by id (audio:play events and
 * `spatialAudio.*` ops) or that the presentation plays for its towers:
 * placing and selling, the working sounds of the flame, laser, saw and stream
 * towers (TowerLoopSounds), the tentacle's grab, the lightning
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
  // The towers' own sounds (ElevenLabs, E222) are at -14 LUFS like the rest; the loops a little under the shots,
  // they run for seconds. The Sentinel Laser: the beam's searing onset, the generator's throb under it
  audio.registerSound('laser-start', 'assets/sounds/towers/sentinel/beam_start.mp3', {
    refDistance: 40,
    rolloffFactor: 1.2,
    volume: 0.5,
  });
  audio.registerSound('laser-loop', 'assets/sounds/towers/sentinel/beam_loop.mp3', {
    refDistance: 30,
    rolloffFactor: 1.3,
    volume: 0.4,
    loop: true,
  });
  // The Chainsaw: servos and clutch as the three saws come up, the motors running, the saws biting
  audio.registerSound('saw-spinup', 'assets/sounds/towers/chainsaw/spinup.mp3', {
    refDistance: 35,
    rolloffFactor: 1.2,
    volume: 0.55,
  });
  audio.registerSound('saw-loop', 'assets/sounds/towers/chainsaw/run_loop.mp3', {
    refDistance: 30,
    rolloffFactor: 1.3,
    volume: 0.35,
    loop: true,
  });
  audio.registerSound('saw-cut', 'assets/sounds/towers/chainsaw/cut_loop.mp3', {
    refDistance: 30,
    rolloffFactor: 1.3,
    volume: 0.45,
    loop: true,
  });
  // The Shawarma Slicer: its motor and gearbox winding up, then the machine at full speed with the meat sizzling
  audio.registerSound('doner-spinup', 'assets/sounds/towers/shawarma/spinup.mp3', {
    refDistance: 35,
    rolloffFactor: 1.2,
    volume: 0.5,
  });
  audio.registerSound('doner-loop', 'assets/sounds/towers/shawarma/run_loop.mp3', {
    refDistance: 30,
    rolloffFactor: 1.3,
    volume: 0.4,
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
