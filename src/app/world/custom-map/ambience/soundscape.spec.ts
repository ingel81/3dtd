import { describe, expect, it } from 'vitest';
import type { MapEnvironment, MapLife } from '../map-document';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AMBIENT_SOUNDS, WAVE_SOUNDS, ambienceSounds, soundFiles } from './ambient-sounds';
import { AREA_REACH, CROSSFADE, LOOP_PAD, Soundscape, type SoundscapeListener } from './soundscape';

/** Just enough Web Audio for the soundscape: gains and pans hold their last target, sources say whether they play */
function fakeAudio() {
  const sources: { sound: unknown; playing: boolean; loopStart: number; loopEnd: number; offset: number; when: number; duration?: number }[] = [];
  const param = () => ({ value: 0, curves: [] as { at: number; rising: boolean }[], setTargetAtTime(v: number) { this.value = v; }, setValueCurveAtTime(c: Float32Array, at: number) { this.curves.push({ at, rising: c[0] < c[c.length - 1] }); } });
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined });
  const gains: { gain: { value: number; curves: { at: number; rising: boolean }[] } }[] = [];
  const pans: { pan: { value: number } }[] = [];
  const context = {
    currentTime: 0,
    createGain: () => {
      const g = { ...node(), gain: param() };
      gains.push(g);
      return g;
    },
    createStereoPanner: () => {
      const p = { ...node(), pan: param() };
      pans.push(p);
      return p;
    },
    createBufferSource: () => {
      const s = { ...node(), buffer: null as unknown, loop: false, loopStart: 0, loopEnd: 0, start(when: number, offset: number, duration?: number) { entry.playing = true; entry.when = when; entry.offset = offset; entry.duration = duration; entry.loopStart = this.loopStart; entry.loopEnd = this.loopEnd; entry.sound = this.buffer; }, stop() { entry.playing = false; } };
      const entry = { sound: null as unknown, playing: false, loopStart: 0, loopEnd: 0, offset: 0, when: 0, duration: undefined as number | undefined };
      sources.push(entry);
      return s;
    },
  } as unknown as BaseAudioContext;
  return { context, destination: node() as unknown as AudioNode, sources, gains, pans };
}

const env = (biome: MapEnvironment['biome']) => ({ biome }) as MapEnvironment;
const listener = (x: number, y: number, extra: Partial<SoundscapeListener> = {}): SoundscapeListener => ({ at: { x, y }, height: 60, right: { x: 1, y: 0 }, darkness: 0, ...extra });
const tick = async (s: Soundscape, l: SoundscapeListener, seconds = 0.2) => {
  // The loads settle over a few microtasks
  for (let k = 0; k < 5; k++) await Promise.resolve();
  s.update(seconds, l);
};
/** Voices in the order setMap made them: the bed (day, night), then the areas; master gain first */
const levels = (a: ReturnType<typeof fakeAudio>) => a.gains.slice(1).map((g) => Math.round(g.gain.value * 1000) / 1000);

describe('Soundscape', () => {
  it("plays the biome's bed by day and by night, crossfading with the darkness", async () => {
    const a = fakeAudio();
    const s = new Soundscape(a, (url) => Promise.resolve({ duration: 16.2, url } as unknown as AudioBuffer));
    s.setVolume(1);
    const life: MapLife = { ambience: { sound: 'biome', volume: 0.5 } };
    s.setMap({ life, environment: env('temperate') });
    await tick(s, listener(0, 0));
    const day = AMBIENT_SOUNDS['birdsong'].gain * 0.5;
    expect(levels(a)).toEqual([Math.round(day * 1000) / 1000, 0]);
    // The bed loops between its pads, from somewhere in its loop
    expect(a.sources).toHaveLength(1);
    expect(a.sources[0]).toMatchObject({ playing: true, loopStart: LOOP_PAD, loopEnd: 16.2 - LOOP_PAD });
    await tick(s, listener(0, 0, { darkness: 1 }));
    expect(levels(a)[0]).toBe(0);
    expect(levels(a)[1]).toBeCloseTo(AMBIENT_SOUNDS['night-insects'].gain * 0.5, 3);
    // The moon has none
    expect(ambienceSounds('biome', 'moon')).toBeNull();
    s.dispose();
  });

  it("hears an area's sound in full inside it, fading over its reach, panned to its side, stopped when long silent", async () => {
    const a = fakeAudio();
    const s = new Soundscape(a, () => Promise.resolve({ duration: 16.2 } as unknown as AudioBuffer));
    s.setVolume(1);
    const life: MapLife = { areas: [{ id: 's', kind: 'sound', shape: 'route', points: [{ x: 0, y: -50 }, { x: 0, y: 50 }], sound: 'stream', volume: 1 }] };
    s.setMap({ life, environment: env('temperate') });
    const full = AMBIENT_SOUNDS['stream'].gain;
    await tick(s, listener(0, 0));
    expect(levels(a)[0]).toBeCloseTo(full, 3);
    // Half its reach to the east: a quarter, from the west (the listener's left)
    await tick(s, listener(AREA_REACH / 2, 0));
    expect(levels(a)[0]).toBeCloseTo(full * 0.25, 3);
    expect(a.pans[0].pan.value).toBeLessThan(-0.5);
    // From high up quieter
    await tick(s, listener(0, 0, { height: 600 }));
    expect(levels(a)[0]).toBeLessThan(full * 0.5);
    // Out of reach: silent, the source stops after three seconds
    await tick(s, listener(AREA_REACH + 10, 0));
    expect(levels(a)[0]).toBe(0);
    expect(s.playing).toBe(1);
    for (let k = 0; k < 20; k++) s.update(0.2, listener(AREA_REACH + 10, 0));
    expect(s.playing).toBe(0);
    // Back in: it starts again
    await tick(s, listener(0, 0));
    expect(s.playing).toBe(1);
    s.dispose();
  });

  it("fades a sound area out over its own reach", async () => {
    const a = fakeAudio();
    const s = new Soundscape(a, () => Promise.resolve({ duration: 16.2 } as unknown as AudioBuffer));
    s.setVolume(1);
    const area = { id: 's', kind: 'sound' as const, shape: 'route' as const, points: [{ x: 0, y: -50 }, { x: 0, y: 50 }], sound: 'fire', volume: 1, reach: 200 };
    s.setMap({ life: { areas: [area] }, environment: env('temperate') });
    // 100 m off: half its reach, a quarter; past the default 70 m and still heard
    await tick(s, listener(100, 0));
    expect(levels(a)[0]).toBeCloseTo(AMBIENT_SOUNDS['fire'].gain * 0.25, 3);
    s.setMap({ life: { areas: [{ ...area, reach: 20 }] }, environment: env('temperate') });
    await tick(s, listener(25, 0));
    expect(levels(a)[0]).toBe(0);
    s.dispose();
  });

  it('keeps the voices an edit leaves, starts none at volume 0 and none for an unknown sound', async () => {
    const a = fakeAudio();
    let loads = 0;
    const s = new Soundscape(a, () => (loads++, Promise.resolve({ duration: 16.2 } as unknown as AudioBuffer)));
    const area = { id: 's', kind: 'sound' as const, shape: 'area' as const, points: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 0, y: 10 }], sound: 'fire' };
    s.setMap({ life: { areas: [area, { ...area, id: 'x', sound: 'dragons' }] }, environment: env('temperate') });
    s.setVolume(0);
    await tick(s, listener(0, 0));
    expect(s.playing).toBe(0);
    s.setVolume(1);
    await tick(s, listener(0, 0));
    expect(s.playing).toBe(1);
    // A new volume keeps the playing voice and loads nothing again
    s.setMap({ life: { areas: [{ ...area, volume: 0.3 }] }, environment: env('temperate') });
    await tick(s, listener(0, 0));
    expect(a.sources.filter((x) => x.playing)).toHaveLength(1);
    expect(loads).toBe(1);
    s.dispose();
  });

  it("plays the wave sound once from its area's place, quieter far off and panned there, or alike everywhere", async () => {
    const a = fakeAudio();
    const s = new Soundscape(a, (url) => Promise.resolve({ duration: 7, url } as unknown as AudioBuffer));
    s.setVolume(1);
    const church = { id: 'church', kind: 'fog' as const, shape: 'area' as const, points: [{ x: 290, y: -10 }, { x: 310, y: -10 }, { x: 300, y: 10 }] };
    s.setMap({ life: { waveSound: { sound: 'bell', volume: 0.5, area: 'church' }, areas: [church] }, environment: env('arctic') });
    await tick(s, listener(0, 0));
    await s.playWave();
    const bell = a.sources.find((x) => (x.sound as { url: string }).url.endsWith('bell.mp3'))!;
    expect(bell.playing).toBe(true);
    const gain = a.gains[a.gains.length - 1].gain.value;
    // 290 m off: a share between WAVE_FAR and full, to the east (the listener's right)
    expect(gain).toBeLessThan(WAVE_SOUNDS['bell'].gain * 0.5 * 0.6);
    expect(gain).toBeGreaterThan(WAVE_SOUNDS['bell'].gain * 0.5 * 0.35);
    expect(a.pans[a.pans.length - 1].pan.value).toBeGreaterThan(0.5);
    // Without an area (or with one that is gone) alike everywhere, in the middle
    s.setMap({ life: { waveSound: { sound: 'bell', volume: 0.5, area: 'gone' } }, environment: env('arctic') });
    await s.playWave();
    expect(a.gains[a.gains.length - 1].gain.value).toBeCloseTo(WAVE_SOUNDS['bell'].gain * 0.5, 3);
    expect(a.pans[a.pans.length - 1].pan.value).toBe(0);
    // None set, an unknown sound or volume 0: nothing
    const before = a.sources.length;
    s.setMap({ life: { waveSound: { sound: 'dragons', volume: 1 } }, environment: env('arctic') });
    await s.playWave();
    s.setMap({ life: {}, environment: env('arctic') });
    await s.playWave();
    expect(a.sources.length).toBe(before);
    s.dispose();
  });

  it('has a file for every sound', () => {
    for (const entry of [...Object.values(AMBIENT_SOUNDS), ...Object.values(WAVE_SOUNDS)]) {
      for (const file of soundFiles(entry)) expect(existsSync(resolve('public', file)), file).toBe(true);
    }
  });

  it('plays the variants of a sound in turn, each crossfading into the next before its loop ends', async () => {
    const a = fakeAudio();
    const s = new Soundscape(a, (url) => Promise.resolve({ duration: 20.2, url } as unknown as AudioBuffer));
    s.setVolume(1);
    s.setMap({ life: { ambience: { sound: 'wind', volume: 1 } }, environment: env('mountain') });
    await tick(s, listener(0, 0));
    expect(a.sources).toHaveLength(1);
    const first = a.sources[0];
    const files = [AMBIENT_SOUNDS['wind'].file, ...AMBIENT_SOUNDS['wind'].variants!];
    const at = (k: number) => files.indexOf((a.sources[k].sound as { url: string }).url);
    // A turn ends at its loop's end, not looping
    expect(first.offset + first.duration!).toBeCloseTo(20.2 - LOOP_PAD, 5);
    const ends = first.when + first.duration!;
    // The next one is scheduled once its start is near, CROSSFADE before the first ends, from the loop's start, fading in
    (a.context as { currentTime: number }).currentTime = ends - CROSSFADE - 0.5;
    s.update(0.2, listener(0, 0));
    expect(a.sources).toHaveLength(2);
    expect(a.sources[1]).toMatchObject({ offset: LOOP_PAD, when: ends - CROSSFADE, playing: true });
    expect(at(1)).toBe((at(0) + 1) % 2);
    const fade = a.gains[a.gains.length - 1].gain.curves;
    expect(fade[0]).toEqual({ at: ends - CROSSFADE, rising: true });
    expect(fade[1].rising).toBe(false);
    // And the one after goes back to the first recording
    (a.context as { currentTime: number }).currentTime = a.sources[1].when + a.sources[1].duration! - CROSSFADE - 0.5;
    s.update(0.2, listener(0, 0));
    expect(at(2)).toBe(at(0));
    // Out of hearing it all stops
    s.dispose();
    expect(a.sources.every((x) => !x.playing)).toBe(true);
  });
});
