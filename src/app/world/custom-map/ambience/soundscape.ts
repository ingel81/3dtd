import type { CustomMapDocument, MapLife, MapLifeArea, MapPoint } from '../map-document';
import { LIFE_SOUND_REACH, nearestOnShape } from '../map-life';
import { AMBIENT_SOUNDS, WAVE_SOUNDS, ambienceSounds, soundEntry, soundFiles } from './ambient-sounds';

/**
 * The ambient sound of a custom map (TODO E190, docs/CUSTOM_MAPS.md
 * "Umgebungston"): the map's bed over everything (`life.ambience`: the
 * biome's by day and by night, crossfading with the darkness, or one sound)
 * and the sound areas and routes (`life.areas`, kind `sound`), each loud
 * inside its outline or on its line and fading over its reach (AREA_REACH
 * metres unless it sets its own),
 * and the sound once at each wave's start (`life.waveSound`, playWave).
 * Heard from where the camera looks (the listener: a ground point and the
 * camera's height over it); from high up everything is quieter, and a sound
 * off to one side pans there. Plain Web Audio: one looping buffer source,
 * gain and stereo panner per voice into the destination the owner gives
 * (a sound with variants: one source per turn, the next crossfading in
 * CROSSFADE seconds before the loop ends)
 * (the game's master bus, or the editor's own context); a voice that falls
 * silent stops its source after a while and starts it again when heard.
 * Drawn nothing, decides nothing: the simulation never hears it.
 */

/** Seconds of each file before and after its loop (tools/ambient/make_placeholders.py PAD) */
export const LOOP_PAD = 0.1;
/** Metres over which an area's sound fades out beyond its outline or its line, unless it sets its own `reach` */
export const AREA_REACH = LIFE_SOUND_REACH.default;
/** How often the gains follow the listener, seconds, and how fast they glide */
const STEP = 0.1;
const GLIDE = 0.35;
/** Seconds a silent voice keeps its source before it stops */
const SILENT_STOP = 3;
/** Seconds two variants of a sound overlap, and how far ahead the next one is scheduled */
export const CROSSFADE = 2;
const SCHEDULE_AHEAD = 1;
/** Metres over which a wave sound from an area falls to its least share, and that share (a bell carries) */
const WAVE_REACH = 400;
const WAVE_FAR = 0.35;

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
  /** A sound with variants: the turns scheduled (the playing one and the next) */
  turns?: { source: AudioBufferSourceNode; gain: GainNode; end: number }[];
  /** When the next turn starts and which variant it plays */
  next?: { at: number; variant: number };
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
  /** The map's wave sound and the area it comes from */
  private wave: { sound: string; volume: number; area: MapLifeArea | null } | null = null;
  /** Where the listener was at the last update, for a wave sound between updates */
  private heard: Omit<SoundscapeListener, 'darkness'> = { at: { x: 0, y: 0 }, height: 80, right: { x: 1, y: 0 } };

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
      void this.sound(w.sound);
    }
    this.voices = kept;
    this.elapsed = STEP;
    this.wave = waveSoundOf(doc.life);
    if (this.wave) void this.sound(this.wave.sound);
  }

  /**
   * The map's wave sound once, as a wave starts: from its area's place
   * (panned, quieter far off, never below WAVE_FAR) or alike everywhere,
   * quieter from high up like the rest. Nothing without one
   */
  async playWave(): Promise<void> {
    const w = this.wave;
    if (!w || this.disposed || this.volume <= 0) return;
    const buffer = (await this.sound(w.sound))?.[0];
    if (!buffer || this.disposed || this.wave !== w) return;
    const l = this.heard;
    const lift = Math.min(1, Math.max(0.35, 1 - (l.height - 80) / 780));
    let level = (WAVE_SOUNDS[w.sound]?.gain ?? 0.7) * w.volume * lift;
    let pan = 0;
    if (w.area) {
      const d = nearestOnShape(w.area, l.at.x, l.at.y, this.near);
      level *= WAVE_FAR + (1 - WAVE_FAR) * Math.max(0, 1 - d / WAVE_REACH);
      if (d > 1) pan = (((this.near.x - l.at.x) * l.right.x + (this.near.y - l.at.y) * l.right.y) / d) * Math.min(1, d / 30) * 0.8;
    }
    const context = this.out.context;
    const gain = context.createGain();
    gain.gain.value = level;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    const s = context.createBufferSource();
    s.buffer = buffer;
    s.connect(gain).connect(panner).connect(this.master);
    s.onended = () => {
      s.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    s.start();
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
    this.heard = { at: { x: listener.at.x, y: listener.at.y }, height: listener.height, right: { x: listener.right.x, y: listener.right.y } };
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
        const f = Math.max(0, 1 - d / (v.area.reach ?? AREA_REACH));
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
      if (v.next && v.next.at - now < SCHEDULE_AHEAD) this.turn(v);
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

  /** A sound's buffers (its own, then its variants'), each file loaded once; null when one did not load */
  private async sound(id: string): Promise<AudioBuffer[] | null> {
    const entry = soundEntry(id);
    if (!entry) return null;
    const all = await Promise.all(soundFiles(entry).map((file) => this.file(file)));
    return all.every((b) => b) ? (all as AudioBuffer[]) : null;
  }

  private async file(url: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(url)) return this.buffers.get(url) ?? null;
    this.buffers.set(url, null);
    try {
      const b = await this.load(url);
      this.buffers.set(url, b);
      return b;
    } catch (err) {
      console.warn(`[Soundscape] ${url} did not load`, err);
      return null;
    }
  }

  /** The loaded buffers of a sound, null until all are there */
  private loaded(id: string): AudioBuffer[] | null {
    const entry = soundEntry(id);
    if (!entry) return null;
    const all = soundFiles(entry).map((f) => this.buffers.get(f));
    return all.every((b) => b) ? (all as AudioBuffer[]) : null;
  }

  private start(v: Voice): void {
    const buffers = this.loaded(v.sound);
    if (!buffers) return;
    if (buffers.length > 1) {
      // Variants in turn: from a random one, somewhere in its loop
      const variant = Math.floor(Math.random() * buffers.length);
      const [from, to] = loopOf(buffers[variant]);
      v.turns = [];
      v.next = { at: this.out.context.currentTime, variant };
      this.turn(v, from + Math.random() * Math.max(0, to - from - CROSSFADE * 3));
      return;
    }
    const buffer = buffers[0];
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

  /**
   * The next turn of a sound with variants: its next recording from `offset`
   * (the loop's start but for the first turn) to the loop's end, fading in
   * over CROSSFADE (but the first) and out over its last CROSSFADE seconds,
   * while the turn after fades in
   */
  private turn(v: Voice, offset?: number): void {
    const buffers = this.loaded(v.sound);
    const next = v.next;
    if (!buffers || !next || !v.turns) return;
    const context = this.out.context;
    const b = buffers[next.variant % buffers.length];
    const [from, to] = loopOf(b);
    const start = offset ?? from;
    const length = Math.max(CROSSFADE * 2, to - start);
    const at = Math.max(next.at, context.currentTime);
    const gain = context.createGain();
    gain.gain.value = offset === undefined ? 0 : 1;
    if (offset === undefined) gain.gain.setValueCurveAtTime(equalPower(true), at, CROSSFADE);
    gain.gain.setValueCurveAtTime(equalPower(false), at + length - CROSSFADE, CROSSFADE);
    const s = context.createBufferSource();
    s.buffer = b;
    s.connect(gain).connect(v.gain);
    s.start(at, start, length);
    const now = context.currentTime;
    for (const t of v.turns) if (t.end <= now) this.end(t);
    v.turns = v.turns.filter((t) => t.end > now);
    v.turns.push({ source: s, gain, end: at + length });
    v.source = s;
    v.next = { at: at + length - CROSSFADE, variant: next.variant + 1 };
  }

  private end(t: { source: AudioBufferSourceNode; gain: GainNode }): void {
    try {
      t.source.stop();
    } catch {
      // never started
    }
    t.source.disconnect();
    t.gain.disconnect();
  }

  private stop(v: Voice): void {
    if (v.turns) {
      for (const t of v.turns) this.end(t);
      v.turns = undefined;
      v.next = undefined;
      v.source = null;
      return;
    }
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

/** Where a padded file's loop runs, seconds */
function loopOf(b: AudioBuffer): [number, number] {
  const from = Math.min(LOOP_PAD, b.duration / 4);
  return [from, Math.max(from + 0.1, b.duration - LOOP_PAD)];
}

/** An equal-power fade, in (0 to 1) or out: two unrelated recordings cross at an even loudness */
function equalPower(rising: boolean): Float32Array {
  const n = 32;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1);
    out[k] = rising ? Math.sin((f * Math.PI) / 2) : Math.cos((f * Math.PI) / 2);
  }
  return out;
}

/** The map's wave sound with the area it names (none when that area is gone or the sound unknown) */
function waveSoundOf(life: MapLife | undefined): { sound: string; volume: number; area: MapLifeArea | null } | null {
  const w = life?.waveSound;
  if (!w || !(w.volume > 0) || !WAVE_SOUNDS[w.sound]) return null;
  return { sound: w.sound, volume: w.volume, area: (w.area && life?.areas?.find((a) => a.id === w.area)) || null };
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
