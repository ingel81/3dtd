import type { MapBiome } from '../map-document';

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
 */

export interface AmbientSound {
  label: string;
  /** Under the app's base, as `/assets/sounds/...` paths elsewhere */
  file: string;
  /** Its level against the others, 0..1 */
  gain: number;
  /** Further recordings of it (files as `file`), played in turn with it */
  variants?: readonly string[];
}

export const AMBIENT_SOUNDS: Readonly<Record<string, AmbientSound>> = {
  wind: { label: 'Wind', file: 'assets/sounds/ambient/wind.mp3', variants: ['assets/sounds/ambient/wind-2.mp3'], gain: 0.7 },
  birdsong: { label: 'Birdsong', file: 'assets/sounds/ambient/birdsong.mp3', gain: 0.6 },
  'night-insects': { label: 'Crickets at night', file: 'assets/sounds/ambient/night-insects.mp3', gain: 0.45 },
  stream: { label: 'Stream', file: 'assets/sounds/ambient/stream.mp3', variants: ['assets/sounds/ambient/stream-2.mp3'], gain: 0.6 },
  surf: { label: 'Surf', file: 'assets/sounds/ambient/surf.mp3', variants: ['assets/sounds/ambient/surf-2.mp3'], gain: 0.7 },
  swamp: { label: 'Frogs and swamp', file: 'assets/sounds/ambient/swamp.mp3', gain: 0.55 },
  lava: { label: 'Lava rumbling', file: 'assets/sounds/ambient/lava.mp3', gain: 0.8 },
  fire: { label: 'Crackling fire', file: 'assets/sounds/ambient/fire.mp3', gain: 0.6 },
  city: { label: 'City hum', file: 'assets/sounds/ambient/city.mp3', gain: 0.5 },
  gulls: { label: 'Gulls', file: 'assets/sounds/ambient/gulls.mp3', gain: 0.55 },
  crows: { label: 'Crows and ravens', file: 'assets/sounds/ambient/crows.mp3', gain: 0.5 },
  'radio-hiss': { label: 'Radio hiss', file: 'assets/sounds/ambient/radio-hiss.mp3', gain: 0.4 },
  harbor: { label: 'Harbour (water at the quay, ropes)', file: 'assets/sounds/ambient/harbor.mp3', gain: 0.55 },
  cowbells: { label: 'Cowbells', file: 'assets/sounds/ambient/cowbells.mp3', gain: 0.5 },
  'pine-wind': { label: 'Wind in pines', file: 'assets/sounds/ambient/pine-wind.mp3', gain: 0.6 },
  rain: { label: 'Rain', file: 'assets/sounds/ambient/rain.mp3', gain: 0.6 },
  'cave-wind': { label: 'Cave wind', file: 'assets/sounds/ambient/cave-wind.mp3', gain: 0.6 },
};

/** The files of a sound: its own and its variants' */
export function soundFiles(entry: AmbientSound): readonly string[] {
  return entry.variants?.length ? [entry.file, ...entry.variants] : [entry.file];
}

/**
 * Sounds a map plays once at the start of each wave (`life.waveSound`):
 * whole files, no loop pad. Placeholders like the loops
 * (make_placeholders.py ONE_SHOTS), recordings replace them under the ids
 */
export const WAVE_SOUNDS: Readonly<Record<string, AmbientSound>> = {
  bell: { label: 'Church bell', file: 'assets/sounds/ambient/bell.mp3', gain: 0.8 },
  'siren-distant': { label: 'Distant siren', file: 'assets/sounds/ambient/siren-distant.mp3', gain: 0.7 },
  'ship-horn': { label: "Ship's horn", file: 'assets/sounds/ambient/ship-horn.mp3', gain: 0.8 },
};

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
