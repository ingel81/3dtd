/**
 * Map mood from the Warcraft tileset and the map's fog settings: sky, sun,
 * fog density (exponential, per metre, as `MapEnvironment.fogDensity`) and a
 * tint. Tilesets set the base; a map with its own fog (w3i fog style linear
 * or exponential) overrides the density from its fog end distance.
 */

import type { MapEnvironment } from '../../custom-map/map-document';
import type { W3iInfo } from '../formats/w3i';

interface TilesetMood {
  name: string;
  env: MapEnvironment;
  water: string;
}

const day = (tint: string, fog = 0.0005, elevation = 50): MapEnvironment => ({
  sky: 'day',
  sunAzimuth: 135,
  sunElevation: elevation,
  fogDensity: fog,
  tint,
});

export const TILESETS: Record<string, TilesetMood> = {
  A: { name: 'Ashenvale', env: { ...day('#e8f0ff', 0.0008, 40), sky: 'dusk' }, water: '#2c5a6e' },
  B: { name: 'Barrens', env: day('#fff1d8', 0.0004, 60), water: '#4d6a55' },
  C: { name: 'Felwood', env: { ...day('#e6ffd8', 0.0012, 30), sky: 'dusk' }, water: '#3b5a2a' },
  D: { name: 'Dungeon', env: { ...day('#ffe2c4', 0.0015, 35), sky: 'night' }, water: '#2b3a40' },
  F: { name: 'Lordaeron Fall', env: { ...day('#ffe8cc', 0.0006, 40), sky: 'dusk' }, water: '#355f73' },
  G: { name: 'Underground', env: { ...day('#e0e4ff', 0.0015, 35), sky: 'night' }, water: '#28404a' },
  I: { name: 'Icecrown Glacier', env: { ...day('#e4ecff', 0.001, 30), sky: 'overcast' }, water: '#3d6c86' },
  J: { name: 'Dalaran Ruins', env: { ...day('#f0eee6', 0.0008, 45), sky: 'overcast' }, water: '#3a6478' },
  K: { name: 'Black Citadel', env: { ...day('#ffd6d0', 0.0012, 30), sky: 'night' }, water: '#3a2e30' },
  L: { name: 'Lordaeron Summer', env: day('#ffffff', 0.0004, 55), water: '#30657d' },
  N: { name: 'Northrend', env: { ...day('#eef4ff', 0.0008, 35), sky: 'overcast' }, water: '#3d6c86' },
  O: { name: 'Outland', env: { ...day('#ffd8c8', 0.0008, 40), sky: 'dusk' }, water: '#4a3a5e' },
  Q: { name: 'Village Fall', env: { ...day('#ffe8cc', 0.0006, 40), sky: 'dusk' }, water: '#355f73' },
  V: { name: 'Village', env: day('#ffffff', 0.0004, 55), water: '#30657d' },
  W: { name: 'Lordaeron Winter', env: { ...day('#f0f4ff', 0.0008, 35), sky: 'overcast' }, water: '#3d6c86' },
  X: { name: 'Dalaran', env: day('#fff8ee', 0.0006, 50), water: '#2f6a8a' },
  Y: { name: 'Cityscape', env: day('#fff8ee', 0.0005, 50), water: '#2f6a8a' },
  Z: { name: 'Sunken Ruins', env: day('#e8fff6', 0.0006, 50), water: '#2a7a80' },
};

const FALLBACK: TilesetMood = { name: 'Unknown', env: day('#ffffff'), water: '#30657d' };

export function tilesetMood(letter: string): TilesetMood {
  return TILESETS[letter] ?? FALLBACK;
}

/**
 * Environment for a map; `metresPerUnit` converts the w3i fog distances.
 * Exponential fog thins the view to about a tenth at density * distance = 1.5,
 * which is where Warcraft's linear fog ends.
 */
export function mapEnvironment(tileset: string, info: W3iInfo | null, metresPerUnit: number): MapEnvironment {
  const env = { ...tilesetMood(tileset).env };
  if (info && info.fogStyle && info.fogStyle > 0 && info.fogEnd > 0) {
    const end = info.fogEnd * metresPerUnit;
    env.fogDensity = Math.min(0.02, Math.max(0.0001, 1.5 / end));
  }
  return env;
}

export function waterColor(tileset: string, info: W3iInfo | null): string {
  const base = tilesetMood(tileset).water;
  const tint = info?.waterTint;
  if (!tint || (tint[0] === 255 && tint[1] === 255 && tint[2] === 255)) return base;
  const n = parseInt(base.slice(1), 16);
  const ch = (shift: number, t: number): string =>
    Math.round((((n >> shift) & 255) * t) / 255)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16, tint[0])}${ch(8, tint[1])}${ch(0, tint[2])}`;
}
