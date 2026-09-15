import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { WormSounds } from './worm-sounds';
import { WORM_SOUNDS } from '../../configs/audio.config';
import type { WormGroup } from './worm-group';
import type { ThreeTilesEngine } from '../../three-engine';

const ORIGIN_HEIGHT = 100;
const { liftM, samples, firstMs, gapMs, volumeShare, playbackRate } = WORM_SOUNDS.voice;
/** One gameplay sub-step, see GameClock */
const STEP_MS = 1000 / 60;

/** A segment enemy at local (x, z): lon is x, lat is z in the stand-in conversion */
function segment(x: number, z: number, terrainHeight = ORIGIN_HEIGHT) {
  return { alive: true, position: { lat: z, lon: x }, transform: { terrainHeight }, heightOffset: 0 };
}

type Segment = ReturnType<typeof segment>;

/** A worm with one chain per [first, last] pair over `segments`; `seq` its spawn order */
function worm(segments: (Segment | null)[], chains: [number, number][] = [[0, segments.length - 1]], seq = 1) {
  return {
    seq,
    remaining: segments.filter((s) => s !== null).length,
    segments,
    chains: chains.map(([first, last]) => ({ first, last, front: 0 })),
  };
}

/** What one growl or clack was: game time, sample, where, volume share, rate */
interface Voice {
  atMs: number;
  id: string;
  position: Vector3;
  volume: number;
  rate: number;
}

function setup(listener = new Vector3(0, 0, 0)) {
  let voices = 0;
  let holdNext = false;
  let held: ((voice: unknown) => void) | null = null;
  const played: Voice[] = [];
  let nowMs = 0;
  const audio = {
    registerSound: vi.fn(),
    playAt: vi.fn((id: string, position: Vector3, volume: number, rate: number) => {
      played.push({ atMs: nowMs, id, position, volume, rate });
      if (!holdNext) return Promise.resolve({ voice: ++voices });
      holdNext = false;
      return new Promise((resolve) => (held = resolve));
    }),
    stopOneShot: vi.fn(),
    getListener: () => ({ getWorldPosition: (target: Vector3) => target.copy(listener) }),
  };
  const engine = {
    spatialAudio: audio,
    sync: {
      getOrigin: () => ({ lat: 0, lon: 0, height: ORIGIN_HEIGHT }),
      geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3) => target.set(lon, height, lat),
    },
  } as unknown as ThreeTilesEngine;
  const sounds = new WormSounds();
  /** One render frame at game time `ms` */
  const present = (groups: unknown[], ms = nowMs) => {
    nowMs = ms;
    sounds.present(groups as WormGroup[], engine, ms);
  };
  /** Frames of one sub-step each over `ms` of game time */
  const run = (groups: unknown[], ms: number) => {
    for (let k = Math.round(ms / STEP_MS); k > 0; k--) present(groups, nowMs + STEP_MS);
  };
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** Let the next playAt wait until `release` */
  const holdNextVoice = () => {
    holdNext = true;
    return (voice: unknown) => held!(voice);
  };
  return { audio, sounds, present, run, settle, holdNextVoice, played, listener };
}

describe('WormSounds', () => {
  it('registers each sample once, as a one-shot evened out by its gain', () => {
    const { audio, present } = setup();
    present([worm([segment(10, 0)])]);
    present([worm([segment(10, 0)], undefined, 2)]);
    const { refDistance, rolloffFactor, volume } = WORM_SOUNDS.voice;
    expect(audio.registerSound.mock.calls).toEqual(
      samples.map((s) => [s.id, s.url, { refDistance, rolloffFactor, volume: volume * s.gain }]),
    );
  });

  it('registers nothing and plays nothing while there is no worm', () => {
    const { audio, present, run } = setup();
    present([]);
    run([], 30_000);
    expect(audio.registerSound).not.toHaveBeenCalled();
    expect(audio.playAt).not.toHaveBeenCalled();
  });

  it('growls first soon after the worm appears, then now and then, with gaps in game time', () => {
    const { present, run, played } = setup();
    const group = worm([segment(10, 5), segment(10, -2)]);
    present([group], 0);
    run([group], 120_000);
    expect(played[0].atMs).toBeGreaterThanOrEqual(firstMs.min);
    expect(played[0].atMs).toBeLessThanOrEqual(firstMs.max + STEP_MS);
    for (let k = 1; k < played.length; k++) {
      const gap = played[k].atMs - played[k - 1].atMs;
      expect(gap).toBeGreaterThanOrEqual(gapMs.min);
      expect(gap).toBeLessThanOrEqual(gapMs.max + STEP_MS);
    }
    // 120 s at 6 to 15 s apart
    expect(played.length).toBeGreaterThanOrEqual(8);
    expect(played.length).toBeLessThanOrEqual(21);
    // At the head, above its ground
    expect(played[0].position).toEqual(new Vector3(10, liftM, 5));
  });

  it('draws the sample, a share of the volume and a pitch per voice', () => {
    const { run, played } = setup();
    const group = worm([segment(10, 5)]);
    run([group], 300_000);
    const ids = new Set(played.map((v) => v.id));
    expect(ids.size).toBeGreaterThanOrEqual(2);
    for (const id of ids) expect(samples.map((s) => s.id)).toContain(id);
    for (const { volume, rate } of played) {
      expect(volume).toBeGreaterThanOrEqual(volumeShare.min);
      expect(volume).toBeLessThanOrEqual(volumeShare.max);
      expect(rate).toBeGreaterThanOrEqual(playbackRate.min);
      expect(rate).toBeLessThanOrEqual(playbackRate.max);
    }
    expect(new Set(played.map((v) => v.rate)).size).toBe(played.length);
  });

  it('repeats for the same worm in the same run and differs for another', () => {
    const voicesOf = (seq: number) => {
      const { run, played } = setup();
      run([worm([segment(10, 5)], undefined, seq)], 60_000);
      return played.map(({ atMs, id, rate }) => ({ atMs, id, rate }));
    };
    expect(voicesOf(3)).toEqual(voicesOf(3));
    expect(voicesOf(3)).not.toEqual(voicesOf(4));
  });

  it('counts game time only: frames without it bring nothing new, as in a pause', () => {
    const { present, played } = setup();
    const group = worm([segment(10, 5)]);
    present([group], 0);
    present([group], firstMs.max);
    expect(played).toHaveLength(1);
    for (let k = 0; k < 100; k++) present([group], firstMs.max);
    expect(played).toHaveLength(1);
  });

  it('comes from the head nearest the listener once the worm split', () => {
    const { present, played, listener } = setup(new Vector3(0, 0, 50));
    // Slot 2 died: the front part leads with slot 0, the rear part with slot 3
    const group = worm([segment(0, 60), segment(0, 53), null, segment(0, 20), segment(0, 13)], [[0, 1], [3, 4]]);
    present([group], 0);
    present([group], firstMs.max);
    expect(played.at(-1)!.position).toEqual(new Vector3(0, liftM, 60));

    listener.set(0, 0, 15);
    present([group], firstMs.max + gapMs.max);
    expect(played.at(-1)!.position).toEqual(new Vector3(0, liftM, 20));
  });

  it('never sits on a tail, however near the listener: the first segment of each chain leads it', () => {
    const { present, played } = setup(new Vector3(0, 0, 53));
    // Slot 2 died: slot 1 ends the front part (its tail), slot 4 the rear part
    const group = worm([segment(0, 60), segment(0, 53), null, segment(0, 20), segment(0, 13)], [[0, 1], [3, 4]]);
    present([group], 0);
    present([group], firstMs.max);
    // On the tail at 53 the listener hears the front head at 60, 7 m off
    expect(played.at(-1)!.position).toEqual(new Vector3(0, liftM, 60));
  });

  it('waits while no head walks for a moment and speaks once one does', () => {
    const { present, played } = setup();
    const head = segment(10, 0);
    const group = worm([head, segment(10, -7)]);
    present([group], 0);
    head.alive = false;
    present([group], firstMs.max);
    expect(played).toHaveLength(0);
    head.alive = true;
    present([group], firstMs.max + STEP_MS);
    expect(played).toHaveLength(1);
  });

  it('stops its voice when the worm is beaten or gone, and on clear', async () => {
    const { audio, sounds, present, settle } = setup();
    const a = worm([segment(10, 0)], undefined, 1);
    const b = worm([segment(-10, 0)], undefined, 2);
    present([a, b], 0);
    present([a, b], firstMs.max);
    await settle();
    expect(audio.playAt).toHaveBeenCalledTimes(2);

    // Beaten: still listed until the next tick, with nothing left
    a.remaining = 0;
    present([a, b]);
    expect(audio.stopOneShot.mock.calls).toEqual([[{ voice: 1 }]]);

    sounds.clear(audio as never);
    expect(audio.stopOneShot.mock.calls).toEqual([[{ voice: 1 }], [{ voice: 2 }]]);
    present([]);
    expect(audio.stopOneShot).toHaveBeenCalledTimes(2);
  });

  it('stops a voice that starts after its worm went', async () => {
    const { audio, present, settle, holdNextVoice } = setup();
    const release = holdNextVoice();
    const group = worm([segment(10, 0)]);
    present([group], 0);
    present([group], firstMs.max);
    present([]);
    release({ voice: 'late' });
    await settle();
    expect(audio.stopOneShot.mock.calls).toEqual([[{ voice: 'late' }]]);
  });

  it('does nothing without spatial audio', () => {
    const sounds = new WormSounds();
    expect(() => sounds.present([worm([segment(1, 1)])] as unknown as WormGroup[], {} as ThreeTilesEngine, 5000)).not.toThrow();
  });
});
