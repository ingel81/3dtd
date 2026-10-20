import { describe, expect, it } from 'vitest';
import { en } from './messages/en';
import { de } from './messages/de';
import { FIXED_PLACE_NAMES, placeName } from './place-names';
import { UNKNOWN_LOCATION_NAME } from '../services/location/geocoding.service';
import { NO_LOCATION_NAME } from '../services/location/location-management.service';
import { UNNAMED_STREET } from '../interfaces/street-network-provider.interface';
import { SPAWN_LABEL_FALLBACK } from '../utils/spawn-label';
import { worldPlaceName } from '../world/world-ref';

describe('place names (TODO E245)', () => {
  it('knows the names the game gives places and spawns as data', () => {
    const made = [UNKNOWN_LOCATION_NAME, NO_LOCATION_NAME, UNNAMED_STREET, SPAWN_LABEL_FALLBACK, worldPlaceName({ kind: 'devworld', terrain: 'flat', seed: 1 } as never)];
    expect(made.filter((name) => !FIXED_PLACE_NAMES.includes(name!))).toEqual([]);
  });

  it('reads in English as the data has it, in German in its own words, and leaves a real name alone', () => {
    for (const name of FIXED_PLACE_NAMES) expect(placeName(en, name)).toBe(name);
    expect(placeName(de, 'Map center')).toBe('Kartenmitte');
    expect(placeName(de, 'Heilbronn')).toBe('Heilbronn');
  });
});
