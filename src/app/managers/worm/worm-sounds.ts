import { Vector3, type PositionalAudio } from 'three';
import type { SpatialAudioManager } from '../audio/spatial-audio.manager';
import type { LoopHandle } from '../audio/spatial-audio-loops';
import type { ThreeTilesEngine } from '../../three-engine';
import { WORM_SOUNDS } from '../../configs/audio.config';
import { seeded } from '../../utils/synth';
import type { WormGroup } from './worm-group';

/** Seed of a worm's draws, plus its spawn order (WormGroup.seq) */
const VOICE_SEED = 0x5ca7a;

/** The voice of one worm */
interface WormVoice {
  /** Game ms the next growl or clack is due at */
  nextMs: number;
  /** This worm's draws, per voice in this order: sample, volume, pitch, gap */
  readonly random: () => number;
  /** Its last one-shot, stopped when the worm goes */
  playing: PositionalAudio | null;
  /** The slither loop once createLoop gave it (WORM_SOUNDS.slither) */
  loop: LoopHandle | null;
  /** createLoop was asked for the slither loop */
  slithering: boolean;
  /** The worm went before createLoop came back: the loop stops as it arrives */
  ended: boolean;
  /** The present() call that last saw its worm */
  seen: number;
}

const between = (random: () => number, range: { readonly min: number; readonly max: number }) =>
  range.min + (range.max - range.min) * random();

/**
 * Skarnax's voice, for EnemyManager: now and then a growl or a clack at the
 * head of each worm (WormGroup, WORM_SOUNDS.voice), scheduled in game time
 * from presentFrame, and the slither of its body, a loop that follows the
 * same head (WORM_SOUNDS.slither). After a split every part walks with a head of its own;
 * the voice comes from the head nearest the listener, so a worm in pieces
 * keeps one voice. Each worm draws from a seed of its own, so a run repeats.
 *
 * presentFrame runs only in frames with a sub-step: in a pause nothing new
 * plays, a one-shot already playing plays out (2.3 s at most). A worm beaten,
 * through or removed stops its voice.
 */
export class WormSounds {
  private registeredWith: SpatialAudioManager | null = null;
  private readonly voices = new Map<WormGroup, WormVoice>();
  private pass = 0;
  private readonly listener = new Vector3();
  private readonly head = new Vector3();
  private readonly nearest = new Vector3();

  /**
   * Once per render frame, at game time `gameTimeMs`: each worm whose voice
   * is due growls or clacks at its head nearest the listener. The voice of
   * a worm no longer in `groups` (beaten, through, removed) stops.
   */
  present(groups: readonly WormGroup[], engine: ThreeTilesEngine, gameTimeMs: number): void {
    const audio = engine.spatialAudio ?? null;
    if (audio === null) return;
    const pass = ++this.pass;
    let listening = false;
    for (const group of groups) {
      if (group.remaining === 0) continue;
      let voice = this.voices.get(group);
      if (voice === undefined) {
        this.register(audio);
        const random = seeded(VOICE_SEED + group.seq);
        voice = {
          nextMs: gameTimeMs + between(random, WORM_SOUNDS.voice.firstMs),
          random,
          playing: null,
          loop: null,
          slithering: false,
          ended: false,
          seen: pass,
        };
        this.voices.set(group, voice);
      }
      voice.seen = pass;
      if (!listening) {
        audio.getListener().getWorldPosition(this.listener);
        listening = true;
      }
      // No head walks for a moment (it died, the next one leads from the next sub-step): the next frame tries again
      if (!this.nearestHead(group, engine)) continue;
      if (!voice.slithering) this.startSlither(voice, audio);
      else if (voice.loop !== null) audio.updateLoopPosition(voice.loop, this.nearest);
      if (gameTimeMs >= voice.nextMs) this.speak(group, voice, audio, gameTimeMs);
    }
    for (const [group, voice] of this.voices) {
      if (voice.seen !== pass) this.end(group, voice, audio);
    }
  }

  /** Every voice stops (wave end, reset, game over). */
  clear(audio: SpatialAudioManager | null): void {
    for (const [group, voice] of [...this.voices]) this.end(group, voice, audio);
  }

  private register(audio: SpatialAudioManager): void {
    if (this.registeredWith === audio) return;
    this.registeredWith = audio;
    const { id, url, refDistance: slitherRef, rolloffFactor: slitherRolloff, volume: slitherVolume } = WORM_SOUNDS.slither;
    audio.registerSound(id, url, { refDistance: slitherRef, rolloffFactor: slitherRolloff, volume: slitherVolume, loop: true });
    const { samples, refDistance, rolloffFactor, volume } = WORM_SOUNDS.voice;
    for (const sample of samples) {
      audio.registerSound(sample.id, sample.url, { refDistance, rolloffFactor, volume: volume * sample.gain });
    }
  }

  /** The head of `group` nearest the listener into `nearest`, local; false while none walks. */
  private nearestHead(group: WormGroup, engine: ThreeTilesEngine): boolean {
    const originHeight = engine.sync.getOrigin()?.height ?? 0;
    const { x, y, z } = this.listener;
    let best = Infinity;
    for (const chain of group.chains) {
      const enemy = group.segments[chain.first];
      if (!enemy?.alive) continue;
      const head = engine.sync.geoToLocalSimpleInto(enemy.position.lat, enemy.position.lon, 0, this.head);
      head.y = enemy.transform.terrainHeight + enemy.heightOffset + WORM_SOUNDS.voice.liftM - originHeight;
      const d = (head.x - x) ** 2 + (head.y - y) ** 2 + (head.z - z) ** 2;
      if (d < best) {
        best = d;
        this.nearest.set(head.x, head.y, head.z);
      }
    }
    return best < Infinity;
  }

  /** A growl or clack at `nearest`, drawn from the worm's seed, and the next one scheduled. */
  private speak(group: WormGroup, voice: WormVoice, audio: SpatialAudioManager, gameTimeMs: number): void {
    const { samples, volumeShare, playbackRate, gapMs } = WORM_SOUNDS.voice;
    const sample = samples[Math.min(samples.length - 1, Math.floor(voice.random() * samples.length))];
    const volume = between(voice.random, volumeShare);
    const rate = between(voice.random, playbackRate);
    voice.nextMs = gameTimeMs + between(voice.random, gapMs);
    // playAt reads the position after its awaits: a copy of its own
    void audio.playAt(sample.id, this.nearest.clone(), volume, rate).then((played) => {
      if (played === null) return;
      // The worm went while the sample was loading
      if (this.voices.get(group) !== voice) audio.stopOneShot(played);
      else voice.playing = played;
    });
  }

  /** The slither loop of a worm, at its head nearest the listener (`nearest`); present() moves it on. */
  private startSlither(voice: WormVoice, audio: SpatialAudioManager): void {
    voice.slithering = true;
    void audio.createLoop(WORM_SOUNDS.slither.id, this.nearest, { randomStart: true }).then((handle) => {
      if (handle === null) return;
      if (voice.ended) audio.stopLoop(handle);
      else voice.loop = handle;
    });
  }

  private end(group: WormGroup, voice: WormVoice, audio: SpatialAudioManager | null): void {
    this.voices.delete(group);
    voice.ended = true;
    if (voice.playing !== null) audio?.stopOneShot(voice.playing);
    voice.playing = null;
    if (voice.loop !== null) audio?.stopLoop(voice.loop);
    voice.loop = null;
  }
}
