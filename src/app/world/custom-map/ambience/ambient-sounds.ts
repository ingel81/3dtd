import type { MapBiome, MapWeather } from '../map-document';

/**
 * Ambient sounds of custom maps (TODO E190): loops a map plays over the
 * whole map (its biome's or one it names, `life.ambience`) or in a life
 * area of kind `sound`. Today synthesised placeholders
 * (tools/ambient/make_placeholders.py); generated loops replace the files
 * under the same ids (the sound audition's `amb_<id>`, its install pads them
 * as below). Each file holds its
 * loop with LOOP_PAD seconds of it repeated before and after (soundscape.ts).
 * A sound with `variants` plays its recordings in turn, crossfading at each
 * loop's end, so a long listen does not hear the same 20 s again and again.
 * A sound with `calls` (birds, gulls, crows) is single calls scattered at
 * irregular gaps, each from another side and distance (Soundscape), over its
 * loop if it has one: a looped chorus of calls repeats its pattern and wears
 * on the ear within a minute (E211).
 */

export interface AmbientCalls {
  /** One call each (assets/sounds/ambient/calls/), whole files, about -20 LUFS */
  files: readonly string[];
  /** Their level against the others, 0..1 (as `gain`) */
  gain: number;
  /** Seconds between two calls, at random within */
  gap: readonly [number, number];
  /** Chance that another call answers soon after one, within `answer` seconds */
  reply: number;
  answer: readonly [number, number];
}

/** A sound of the map; its name is the dictionary's (i18n `editor.life.sounds`, by id) */
export interface AmbientSound {
  /** The loop, under the app's base as `/assets/sounds/...` paths elsewhere; none for a sound of calls only */
  file?: string;
  /** Its level against the others, 0..1 */
  gain: number;
  /** Further recordings of it (files as `file`), played in turn with it */
  variants?: readonly string[];
  calls?: AmbientCalls;
}

const CALLS = 'assets/sounds/ambient/calls/';
const callFiles = (...names: string[]) => names.map((n) => `${CALLS}${n}.mp3`);

const LOOPS = {
  wind: { file: 'assets/sounds/ambient/wind.mp3', variants: ['assets/sounds/ambient/wind-2.mp3'], gain: 0.7 },
  // A light breeze under songbirds now and then, a few seconds apart, sometimes one answering another
  birdsong: {
    file: 'assets/sounds/ambient/wind.mp3',
    variants: ['assets/sounds/ambient/wind-2.mp3'],
    gain: 0.2,
    calls: {
      files: callFiles('bird-blackbird', 'bird-robin', 'bird-chaffinch', 'bird-wren', 'bird-great-tit', 'bird-wood-pigeon', 'bird-song-thrush', 'bird-yellowhammer'),
      gain: 0.45,
      gap: [5, 16],
      reply: 0.3,
      answer: [0.8, 2.5],
    },
  },
  'night-insects': { file: 'assets/sounds/ambient/night-insects.mp3', gain: 0.3 },
  stream: { file: 'assets/sounds/ambient/stream.mp3', variants: ['assets/sounds/ambient/stream-2.mp3'], gain: 0.6 },
  surf: { file: 'assets/sounds/ambient/surf.mp3', variants: ['assets/sounds/ambient/surf-2.mp3'], gain: 0.7 },
  swamp: { file: 'assets/sounds/ambient/swamp.mp3', gain: 0.55 },
  lava: { file: 'assets/sounds/ambient/lava.mp3', gain: 0.6 },
  fire: { file: 'assets/sounds/ambient/fire.mp3', gain: 0.6 },
  city: { file: 'assets/sounds/ambient/city.mp3', gain: 0.5 },
  gulls: {
    gain: 0,
    calls: { files: callFiles('gull-single', 'gull-laugh', 'gull-pair'), gain: 0.5, gap: [5, 15], reply: 0.35, answer: [0.6, 2] },
  },
  crows: {
    gain: 0,
    calls: { files: callFiles('crow-caw', 'crow-three', 'raven-croak'), gain: 0.45, gap: [7, 20], reply: 0.25, answer: [1, 3] },
  },
  // A siren wailing far off now and then, sometimes another one answering from elsewhere: a city that is gone
  'sirens-far': {
    gain: 0,
    calls: { files: ['assets/sounds/ambient/siren-distant.mp3'], gain: 0.3, gap: [50, 120], reply: 0.35, answer: [2, 8] },
  },
  'radio-hiss': { file: 'assets/sounds/ambient/radio-hiss.mp3', gain: 0.4 },
  harbor: { file: 'assets/sounds/ambient/harbor.mp3', gain: 0.55 },
  cowbells: { file: 'assets/sounds/ambient/cowbells.mp3', gain: 0.5 },
  'pine-wind': { file: 'assets/sounds/ambient/pine-wind.mp3', gain: 0.6 },
  rain: { file: 'assets/sounds/ambient/rain.mp3', gain: 0.6 },
  // A storm's downpour with gusts (the storm weather plays it, WEATHER_BEDS)
  'storm-rain': { file: 'assets/sounds/ambient/storm-rain.mp3', gain: 0.75 },
  'cave-wind': { file: 'assets/sounds/ambient/cave-wind.mp3', gain: 0.6 },
} satisfies Record<string, AmbientSound>;

/** The loops a map may play over itself or an area, by id */
export const AMBIENT_SOUNDS: Readonly<Record<string, AmbientSound>> = LOOPS;
export type AmbientSoundId = keyof typeof LOOPS;

/** The files of a sound's loop: its own and its variants' (none for calls only) */
export function soundFiles(entry: AmbientSound): readonly string[] {
  if (!entry.file) return [];
  return entry.variants?.length ? [entry.file, ...entry.variants] : [entry.file];
}

/**
 * Sounds a map plays once at the start of each wave (`life.waveSound`):
 * whole files, no loop pad. Placeholders like the loops
 * (make_placeholders.py ONE_SHOTS), recordings replace them under the ids
 */
const ONE_SHOTS = {
  bell: { file: 'assets/sounds/ambient/bell.mp3', gain: 0.8 },
  'siren-distant': { file: 'assets/sounds/ambient/siren-distant.mp3', gain: 0.7 },
  'ship-horn': { file: 'assets/sounds/ambient/ship-horn.mp3', gain: 0.8 },
} satisfies Record<string, AmbientSound>;

export const WAVE_SOUNDS: Readonly<Record<string, AmbientSound>> = ONE_SHOTS;
export type WaveSoundId = keyof typeof ONE_SHOTS;

/**
 * What a weather plays over the whole map, at its strength k (soundscape.ts):
 * rain a quieter bed of rain, a storm its downpour and the wind, louder the
 * stronger. Snow and fog are silent
 */
export const WEATHER_BEDS: Readonly<Partial<Record<MapWeather, readonly { sound: string; volume: (k: number) => number }[]>>> = {
  rain: [{ sound: 'rain', volume: (k) => 0.35 + 0.45 * k }],
  storm: [
    { sound: 'storm-rain', volume: (k) => 0.6 + 0.4 * k },
    { sound: 'wind', volume: (k) => 0.25 + 0.45 * k },
  ],
};

/**
 * Thunder after a storm's lightning (soundscape.ts thunder), whole files
 * (assets/sounds/ambient/thunder/, ElevenLabs, 2026-10-18): the crack of a
 * strike close by, the boom rolling over the land from a kilometre or so,
 * the low rumble from far off. Two recordings each
 */
export const THUNDER_SOUNDS = {
  crack: ['assets/sounds/ambient/thunder/crack-1.mp3', 'assets/sounds/ambient/thunder/crack-2.mp3'],
  roll: ['assets/sounds/ambient/thunder/roll-1.mp3', 'assets/sounds/ambient/thunder/roll-2.mp3'],
  rumble: ['assets/sounds/ambient/thunder/rumble-1.mp3', 'assets/sounds/ambient/thunder/rumble-2.mp3'],
} as const;

export type ThunderKind = keyof typeof THUNDER_SOUNDS;

/** Which thunder a strike `distance` metres off sounds like: a cloud flash never cracks */
export function thunderKind(distance: number, cloud: boolean): ThunderKind {
  if (!cloud && distance < 700) return 'crack';
  return distance < 2000 ? 'roll' : 'rumble';
}

/** A loop's or a wave sound's entry by id */
export function soundEntry(id: string): AmbientSound | undefined {
  return AMBIENT_SOUNDS[id] ?? WAVE_SOUNDS[id];
}

/** `life.ambience.sound` for the biome's own bed */
export const BIOME_AMBIENCE = 'biome';

/** What a biome sounds like by day and by night; none on the moon */
const BIOME_SOUNDS: Readonly<Record<MapBiome, { day: string; night: string } | null>> = {
  temperate: { day: 'birdsong', night: 'night-insects' },
  mountain: { day: 'wind', night: 'wind' },
  swamp: { day: 'swamp', night: 'swamp' },
  desert: { day: 'wind', night: 'night-insects' },
  arctic: { day: 'wind', night: 'wind' },
  city: { day: 'city', night: 'city' },
  apocalypse: { day: 'wind', night: 'wind' },
  hell: { day: 'lava', night: 'lava' },
  moon: null,
  mars: { day: 'wind', night: 'wind' },
};

/** The sounds of a map's whole-map ambience by day and by night: the biome's, or the one it names; null for none */
export function ambienceSounds(sound: string, biome: MapBiome | undefined): { day: string; night: string } | null {
  if (sound === BIOME_AMBIENCE) return BIOME_SOUNDS[biome ?? 'temperate'] ?? null;
  return AMBIENT_SOUNDS[sound] ? { day: sound, night: sound } : null;
}
