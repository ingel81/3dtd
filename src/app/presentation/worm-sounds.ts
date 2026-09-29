import { Vector3, type PositionalAudio } from 'three';
import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import type { LoopHandle } from '../managers/audio/spatial-audio-loops';
import { WORM_SOUNDS } from '../configs/audio.config';
import { seeded } from '../utils/synth';
import { W_GROUP, W_HEAD, W_REMAINING, W_SEQ, WORM_STRIDE, type SimTable } from '../sim/protocol/packet';

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
  /** present() found a head for it this frame, `nearest` holds it */
  heard: boolean;
  readonly nearest: Vector3;
  nearestSq: number;
}

const between = (random: () => number, range: { readonly min: number; readonly max: number }) =>
  range.min + (range.max - range.min) * random();

/**
 * Where the head of a chain is heard: local position of enemy `num`'s head
 * (WORM_SOUNDS.voice.liftM above its body) into `out`; false when the enemy
 * is not in this frame's table or not alive.
 */
export type WormHeadLocator = (num: number, out: Vector3) => boolean;

/**
 * Skarnax's voice (FramePresenter), from the worm table: now and then a
 * growl or a clack at the head of each worm (WORM_SOUNDS.voice), scheduled
 * in game time, and the slither of its body, a loop that follows the same
 * head (WORM_SOUNDS.slither). After a split every part walks with a head of
 * its own; the voice comes from the head nearest the listener, so a worm in
 * pieces keeps one voice. Each worm draws from a seed of its own
 * (W_SEQ), so a run repeats.
 *
 * Runs only in presented frames: in a pause nothing new plays, a one-shot
 * already playing plays out (2.3 s at most). A worm no longer in the table
 * (beaten, through, removed) stops its voice.
 */
export class WormSounds {
  private registeredWith: SpatialAudioManager | null = null;
  private readonly voices = new Map<number, WormVoice>();
  private pass = 0;
  private readonly listener = new Vector3();
  private readonly head = new Vector3();

  /** Once per presented frame, at game time `gameTimeMs`. */
  present(worms: SimTable, headAt: WormHeadLocator, audio: SpatialAudioManager | null, gameTimeMs: number): void {
    if (audio === null) return;
    const pass = ++this.pass;
    let listening = false;
    const d = worms.data;
    // One row per chain: find each worm's head nearest the listener
    for (let r = 0; r < worms.count; r++) {
      const o = r * WORM_STRIDE;
      if (d[o + W_REMAINING] === 0) continue;
      const group = d[o + W_GROUP];
      let voice = this.voices.get(group);
      if (voice === undefined) {
        this.register(audio);
        const random = seeded(VOICE_SEED + d[o + W_SEQ]);
        voice = {
          nextMs: gameTimeMs + between(random, WORM_SOUNDS.voice.firstMs),
          random,
          playing: null,
          loop: null,
          slithering: false,
          ended: false,
          seen: 0,
          heard: false,
          nearest: new Vector3(),
          nearestSq: Infinity,
        };
        this.voices.set(group, voice);
      }
      if (voice.seen !== pass) {
        voice.seen = pass;
        voice.heard = false;
        voice.nearestSq = Infinity;
      }
      if (!listening) {
        audio.getListener().getWorldPosition(this.listener);
        listening = true;
      }
      const headNum = d[o + W_HEAD];
      if (headNum < 0 || !headAt(headNum, this.head)) continue;
      const dSq = this.head.distanceToSquared(this.listener);
      if (dSq < voice.nearestSq) {
        voice.nearestSq = dSq;
        voice.nearest.copy(this.head);
        voice.heard = true;
      }
    }
    for (const [group, voice] of this.voices) {
      if (voice.seen !== pass) {
        this.end(group, voice, audio);
        continue;
      }
      // No head walks for a moment (it died, the next one leads from the next sub-step): the next frame tries again
      if (!voice.heard) continue;
      if (!voice.slithering) this.startSlither(voice, audio);
      else if (voice.loop !== null) audio.updateLoopPosition(voice.loop, voice.nearest);
      if (gameTimeMs >= voice.nextMs) this.speak(group, voice, audio, gameTimeMs);
    }
  }

  /** Every voice stops (reset, game over). */
  clear(audio: SpatialAudioManager | null): void {
    for (const [group, voice] of [...this.voices]) this.end(group, voice, audio);
  }

  get size(): number {
    return this.voices.size;
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

  /** A growl or clack at the nearest head, drawn from the worm's seed, and the next one scheduled. */
  private speak(group: number, voice: WormVoice, audio: SpatialAudioManager, gameTimeMs: number): void {
    const { samples, volumeShare, playbackRate, gapMs } = WORM_SOUNDS.voice;
    const sample = samples[Math.min(samples.length - 1, Math.floor(voice.random() * samples.length))];
    const volume = between(voice.random, volumeShare);
    const rate = between(voice.random, playbackRate);
    voice.nextMs = gameTimeMs + between(voice.random, gapMs);
    // playAt reads the position after its awaits: a copy of its own
    void audio.playAt(sample.id, voice.nearest.clone(), volume, rate).then((played) => {
      if (played === null) return;
      // The worm went while the sample was loading
      if (this.voices.get(group) !== voice) audio.stopOneShot(played);
      else voice.playing = played;
    });
  }

  /** The slither loop of a worm at its nearest head; present() moves it on. */
  private startSlither(voice: WormVoice, audio: SpatialAudioManager): void {
    voice.slithering = true;
    void audio.createLoop(WORM_SOUNDS.slither.id, voice.nearest, { randomStart: true }).then((handle) => {
      if (handle === null) return;
      if (voice.ended) audio.stopLoop(handle);
      else voice.loop = handle;
    });
  }

  private end(group: number, voice: WormVoice, audio: SpatialAudioManager | null): void {
    this.voices.delete(group);
    voice.ended = true;
    if (voice.playing !== null) audio?.stopOneShot(voice.playing);
    voice.playing = null;
    if (voice.loop !== null) audio?.stopLoop(voice.loop);
    voice.loop = null;
  }
}
