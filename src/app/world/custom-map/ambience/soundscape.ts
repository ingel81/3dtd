import type { CustomMapDocument, MapLifeArea, MapPoint } from '../map-document';
import { nearestOnShape } from '../map-life';
import { AMBIENT_SOUNDS, ambienceSounds } from './ambient-sounds';

/**
 * The ambient sound of a custom map (TODO E190, docs/CUSTOM_MAPS.md
 * "Umgebungston"): the map's bed over everything (`life.ambience`: the
 * biome's by day and by night, crossfading with the darkness, or one sound)
 * and the sound areas and routes (`life.areas`, kind `sound`), each loud
 * inside its outline or on its line and fading over AREA_REACH metres.
 * Heard from where the camera looks (the listener: a ground point and the
 * camera's height over it); from high up everything is quieter, and a sound
 * off to one side pans there. Plain Web Audio: one looping buffer source,
 * gain and stereo panner per voice into the destination the owner gives
 * (the game's master bus, or the editor's own context); a voice that falls
 * silent stops its source after a while and starts it again when heard.
 * Drawn nothing, decides nothing: the simulation never hears it.
 */

/** Seconds of each file before and after its loop (tools/ambient/make_placeholders.py PAD) */
export const LOOP_PAD = 0.1;
/** Metres over which an area's sound fades out beyond its outline or its line */
export const AREA_REACH = 70;
/** How often the gains follow the listener, seconds, and how fast they glide */
const STEP = 0.1;
const GLIDE = 0.35;
/** Seconds a silent voice keeps its source before it stops */
const SILENT_STOP = 3;

export interface SoundscapeOutput {
  context: BaseAudioContext;
  /** Where the voices go: the game's listener input (its master bus), or a gain of the editor's */
  destination: AudioNode;
}

export interface SoundscapeListener {
  /** Map point the camera looks at */
  at: MapPoint;
  /** The camera's height over that point, metres */
  height: number;
  /** The camera's right on the map (a unit vector), for panning */
  right: MapPoint;
  /** 0 by day, 1 at night (the map environment's darkness) */
  darkness: number;
}

interface Voice {
  key: string;
  sound: string;
  gain: GainNode;
  pan: StereoPannerNode;
  source: AudioBufferSourceNode | null;
  /** Seconds it has been silent */
  silent: number;
  /** What it plays: the bed (day or night) or an area */
  bed?: 'day' | 'night';
  area?: MapLifeArea;
  volume: number;
}

export type BufferLoader = (url: string) => Promise<AudioBuffer>;

export class Soundscape {
  private voices: Voice[] = [];
  private readonly buffers = new Map<string, AudioBuffer | null>();
  private readonly master: GainNode;
  private volume = 1;
  private elapsed = STEP;
  private readonly near: MapPoint = { x: 0, y: 0 };
  private disposed = false;

  constructor(
    private readonly out: SoundscapeOutput,
    private readonly load: BufferLoader = (url) => fetchBuffer(out.context, url),
  ) {
    this.master = out.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(out.destination);
  }

  /** The map's bed and sound areas anew (after an edit of its life or its biome) */
  setMap(doc: Pick<CustomMapDocument, 'life' | 'environment'>): void {
    const wanted: Omit<Voice, 'gain' | 'pan' | 'source' | 'silent'>[] = [];
    const amb = doc.life?.ambience;
    const bed = amb && amb.volume > 0 ? ambienceSounds(amb.sound, doc.environment.biome) : null;
    if (bed && amb) {
      wanted.push({ key: `bed-day:${bed.day}`, sound: bed.day, bed: 'day', volume: amb.volume });
      if (bed.night !== bed.day) wanted.push({ key: `bed-night:${bed.night}`, sound: bed.night, bed: 'night', volume: amb.volume });
    }
    for (const area of doc.life?.areas ?? []) {
      if (area.kind !== 'sound' || !area.sound || !AMBIENT_SOUNDS[area.sound]) continue;
      wanted.push({ key: `area:${area.id}:${area.sound}`, sound: area.sound, area, volume: area.volume ?? 0.7 });
    }
    // Voices that stay keep their source (no restart on every edit); the rest go
    const kept: Voice[] = [];
    for (const v of this.voices) {
      const w = wanted.find((x) => x.key === v.key);
      if (w) {
        Object.assign(v, w);
        kept.push(v);
      } else this.drop(v);
    }
    for (const w of wanted) {
      if (kept.some((v) => v.key === w.key)) continue;
      const gain = this.out.context.createGain();
      gain.gain.value = 0;
      const pan = this.out.context.createStereoPanner();
      gain.connect(pan).connect(this.master);
      kept.push({ ...w, gain, pan, source: null, silent: 0 });
      void this.buffer(w.sound);
    }
    this.voices = kept;
    this.elapsed = STEP;
  }

  /** Everything's level, 0..1 (the player's sound volume); 0 silences and, after a while, stops the sources */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.master.gain.setTargetAtTime(this.volume, this.out.context.currentTime, GLIDE / 3);
  }

  /** Every frame: the voices' gains and pans follow the listener a few times a second */
  update(dt: number, listener: SoundscapeListener): void {
    if (this.disposed) return;
    this.elapsed += dt;
    if (this.elapsed < STEP) return;
    const step = this.elapsed;
    this.elapsed = 0;
    const now = this.out.context.currentTime;
    // From high up the land is quieter: full up to 80 m over it, a third from 600 m
    const lift = Math.min(1, Math.max(0.35, 1 - (listener.height - 80) / 780));
    const night = Math.min(1, Math.max(0, (listener.darkness - 0.3) / 0.4));
    for (const v of this.voices) {
      const base = (AMBIENT_SOUNDS[v.sound]?.gain ?? 0.6) * v.volume * lift;
      let level = 0;
      let pan = 0;
      if (v.bed) level = base * (v.bed === 'night' ? night : this.voices.some((o) => o.bed === 'night') ? 1 - night : 1);
      else if (v.area) {
        const d = nearestOnShape(v.area, listener.at.x, listener.at.y, this.near);
        const f = Math.max(0, 1 - d / AREA_REACH);
        level = base * f * f;
        if (d > 1) {
          const dx = (this.near.x - listener.at.x) / d;
          const dy = (this.near.y - listener.at.y) / d;
          // Fully to the side only once well outside
          pan = (dx * listener.right.x + dy * listener.right.y) * Math.min(1, d / 30) * 0.8;
        }
      }
      const audible = level > 0.001 && this.volume > 0;
      v.silent = audible ? 0 : v.silent + step;
      if (audible && !v.source) this.start(v);
      if (!audible && v.source && v.silent > SILENT_STOP) this.stop(v);
      v.gain.gain.setTargetAtTime(level, now, GLIDE / 3);
      v.pan.pan.setTargetAtTime(pan, now, GLIDE / 3);
    }
  }

  /** Voices playing now, for tests and measurements */
  get playing(): number {
    return this.voices.filter((v) => v.source).length;
  }

  dispose(): void {
    this.disposed = true;
    for (const v of this.voices) this.drop(v);
    this.voices = [];
    this.master.disconnect();
  }

  private async buffer(sound: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(sound)) return this.buffers.get(sound) ?? null;
    this.buffers.set(sound, null);
    const entry = AMBIENT_SOUNDS[sound];
    try {
      const b = entry ? await this.load(entry.file) : null;
      this.buffers.set(sound, b);
      return b;
    } catch (err) {
      console.warn(`[Soundscape] ${sound} did not load`, err);
      return null;
    }
  }

  private start(v: Voice): void {
    const buffer = this.buffers.get(v.sound);
    if (!buffer) return;
    const s = this.out.context.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.loopStart = Math.min(LOOP_PAD, buffer.duration / 4);
    s.loopEnd = Math.max(s.loopStart + 0.1, buffer.duration - LOOP_PAD);
    s.connect(v.gain);
    // Somewhere in its loop, so two areas of one sound do not play in step
    s.start(0, s.loopStart + Math.random() * (s.loopEnd - s.loopStart));
    v.source = s;
  }

  private stop(v: Voice): void {
    try {
      v.source?.stop();
    } catch {
      // never started
    }
    v.source?.disconnect();
    v.source = null;
  }

  private drop(v: Voice): void {
    this.stop(v);
    v.gain.disconnect();
    v.pan.disconnect();
  }
}

const cache = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>();

/** A file decoded for this context, once per context and file */
function fetchBuffer(context: BaseAudioContext, url: string): Promise<AudioBuffer> {
  let files = cache.get(context);
  if (!files) cache.set(context, (files = new Map()));
  let p = files.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data));
    files.set(url, p);
    p.catch(() => files!.delete(url));
  }
  return p;
}
